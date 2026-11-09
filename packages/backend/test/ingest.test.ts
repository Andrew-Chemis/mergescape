import {
  applyScoreResult,
  createPlayerState,
  createPRState,
  levelFor,
  normalize,
  POINTS_PER_GOLD,
  score,
  verifiedKillEvents,
} from '@mergescape/shared';
import type { GameEvent, PlayerState, PRState } from '@mergescape/shared';
import { describe, expect, it, vi } from 'vitest';
import { DELIVERY_TTL_SECONDS } from '../src/db';
import { createIngestHandler, MAX_BODY_BYTES } from '../src/handlers/ingest';
import type { FunctionUrlEvent } from '../src/http';
import { INGEST_ROLE, makeIngestHarness, START } from './harness';
import type { Harness } from './harness';
import { auditSchema, itemsWithPrefix } from './support';
import {
  AUTHOR_ID,
  BOT_ID,
  delivery,
  eventNameOf,
  fixtureDelivery,
  fixtureJson,
  INSTALLATION_ACCOUNT_ID,
  INSTALLATION_ID,
  MERGER_ID,
  PR_NUMBER,
  REPO_ID,
  REVIEWER_ID,
  sign,
  WEBHOOK_SECRET,
} from './webhooks';

const MINUTE = 60_000;

/** Deliver one event and advance the clock one minute (so every delivery has its own timestamp). */
async function deliver(h: Harness, event: FunctionUrlEvent) {
  const result = await h.handler(event);
  h.clock.now += MINUTE;
  return result;
}

interface Step {
  fixture: string;
  edit?: (payload: Record<string, unknown>) => void;
}

function play(h: Harness, steps: Step[]) {
  return steps.reduce(async (previous, step) => {
    await previous;
    const result = await deliver(h, fixtureDelivery(step.fixture, step.edit));
    expect(result.statusCode).toBe(200);
  }, Promise.resolve());
}

// ---------------------------------------------------------------------------------------------
// The oracle: the same deliveries run straight through the shared scorer, with no DynamoDB involved.
// ---------------------------------------------------------------------------------------------

interface Expected {
  players: Map<number, PlayerState & { gold: number }>;
  /** Combat Log rows expected per player id. */
  rows: Map<number, string[]>;
}

function oracle(steps: Step[], linked: readonly number[]): Expected {
  const players = new Map<number, PlayerState & { gold: number }>();
  const rows = new Map<number, string[]>();
  const get = (id: number) => {
    let player = players.get(id);
    if (!player) {
      player = { ...createPlayerState(id), gold: 0 };
      players.set(id, player);
    }
    return player;
  };
  let pr: PRState | undefined;

  const credit = (event: GameEvent, id: number, now: number) => {
    if (!('pr' in event)) {
      return;
    }
    pr ??= createPRState(event.pr);
    const isLinked =
      linked.includes(id) &&
      !('isBot' in event.actor && event.actor.isBot && id === event.actor.id);
    const player = isLinked ? get(id) : createPlayerState(id);
    const result = score(event, player, pr, now);
    const next = applyScoreResult(player, pr, result);
    pr = next.pr;
    if (isLinked) {
      players.set(id, {
        ...next.player,
        gold: get(id).gold + Math.floor(result.points / POINTS_PER_GOLD),
      });
      if (result.skip === null) {
        rows.set(id, [...(rows.get(id) ?? []), event.kind]);
      }
    }
  };

  steps.forEach((step, index) => {
    const now = START + index * MINUTE;
    const payload = fixtureJson(step.fixture);
    step.edit?.(payload);
    for (const event of normalize(eventNameOf(step.fixture), payload)) {
      if (!('pr' in event)) {
        continue;
      }
      const actorId = event.actor.id;
      // Bots and unlinked actors are not credited, but the PR side (reviews, pushes) still updates.
      const actorLinked = !event.actor.isBot && linked.includes(actorId);
      pr ??= createPRState(event.pr);
      if (actorLinked) {
        credit(event, actorId, now);
      } else {
        const result = score(event, createPlayerState(actorId), pr, now);
        pr = applyScoreResult(createPlayerState(actorId), pr, result).pr;
      }
      if (event.kind === 'pr_merged' && pr) {
        for (const kill of verifiedKillEvents(event, pr)) {
          if (linked.includes(kill.actor.id)) {
            credit(kill, kill.actor.id, now);
          }
        }
      }
    }
  });
  return { players, rows };
}

async function expectProfilesMatch(h: Harness, expected: Expected) {
  for (const [id, player] of expected.players) {
    const profile = await h.db.getProfile(id, true);
    expect(profile, `profile ${id}`).not.toBeNull();
    expect(profile?.xp, `xp of ${id}`).toBe(player.xp);
    expect(profile?.skillXp, `skill xp of ${id}`).toEqual(player.skillXp);
    expect(profile?.gold, `gold of ${id}`).toBe(player.gold);
    expect(profile?.level).toBe(levelFor(player.xp));
    expect(profile?.streakWeeks).toBe(player.counters.streakWeeks);
  }
}

async function eventKinds(h: Harness, id: number): Promise<string[]> {
  const { rows } = await h.db.listEvents(id, { limit: 50 });
  return rows.map((row) => row.kind).reverse();
}

// ---------------------------------------------------------------------------------------------
// Fixture-driven end to end
// ---------------------------------------------------------------------------------------------

const PR_LIFE: Step[] = [
  { fixture: 'pull_request.opened' },
  { fixture: 'pull_request_review.approved' },
  { fixture: 'pull_request_review_comment.created' },
  { fixture: 'pull_request.synchronize' },
  { fixture: 'pull_request.closed.merged' },
];

describe('ingest: signed fixture deliveries end to end', () => {
  it('credits the author, the reviewer and the verified kill exactly as the scorer says', async () => {
    const h = makeIngestHarness();
    await h.signIn(AUTHOR_ID);
    await h.signIn(REVIEWER_ID);
    await play(h, PR_LIFE);

    const expected = oracle(PR_LIFE, [AUTHOR_ID, REVIEWER_ID]);
    await expectProfilesMatch(h, expected);

    // Anchors that do not depend on the oracle: level 1 Zone is 2^1.6 = 3.0314.
    const author = await h.db.getProfile(AUTHOR_ID, true);
    const reviewer = await h.db.getProfile(REVIEWER_ID, true);
    // opened: (10 + 20 daily) * 3.0314 = 90; merged with a party bonus: (90 + 112 + 30) * 3.0314 = 703
    expect(author?.xp).toBe(90 + 703);
    // review 60 pts -> 181, inline 5 -> 15, verified kill 25 -> 75
    expect(reviewer?.xp).toBe(181 + 15 + 75);
    expect(author?.gold).toBe(Math.floor(30 / POINTS_PER_GOLD) + Math.floor(232 / POINTS_PER_GOLD));

    expect(await eventKinds(h, AUTHOR_ID)).toEqual(['pr_opened', 'pr_merged']);
    expect(await eventKinds(h, REVIEWER_ID)).toEqual([
      'review_submitted',
      'review_comment_created',
      'verified_kill',
    ]);
    expect(h.metrics.totals.get('events_scored')).toBe(5);
    // Only the credited actor counts as a drop, and both players here are linked.
    expect(h.metrics.totals.get('dropped_unlinked')).toBeUndefined();
    auditSchema(h.fake);
  });

  it('stores the shared PR facts, the human review record and the inline tally', async () => {
    const h = makeIngestHarness();
    await h.signIn(AUTHOR_ID);
    await h.signIn(REVIEWER_ID);
    await play(h, PR_LIFE);

    const pr = await h.db.getPR(REPO_ID, PR_NUMBER);
    expect(pr.meta).toMatchObject({
      installationId: INSTALLATION_ID,
      repoId: REPO_ID,
      number: PR_NUMBER,
      authorId: AUTHOR_ID,
      merged: true,
      mergedById: MERGER_ID,
      additions: 250,
      deletions: 50,
      syncCount: 1,
      reviewRoundCount: 0,
      draft: false,
      baseRefIsDefault: true,
    });
    expect(pr.reviews).toEqual([
      {
        reviewerId: REVIEWER_ID,
        reviewerIsBot: false,
        state: 'APPROVED',
        submittedAt: '2026-11-09T10:00:00Z',
      },
    ]);
    expect(pr.inline).toEqual([{ reviewerId: REVIEWER_ID, count: 1 }]);
  });

  it('writes the Combat Log row the client renders', async () => {
    const h = makeIngestHarness();
    await h.signIn(AUTHOR_ID);
    await h.signIn(REVIEWER_ID);
    await play(h, PR_LIFE);

    const { rows } = await h.db.listEvents(AUTHOR_ID, { limit: 10 });
    const merged = rows[0];
    expect(merged).toMatchObject({
      kind: 'pr_merged',
      repoId: REPO_ID,
      repoPrivate: false,
      prNumber: PR_NUMBER,
      points: 232,
      power: 1,
      level: 1,
      xp: 703,
      skill: 'smithing',
      monster: 'merge-goblin',
      additions: 250,
      deletions: 50,
    });
    expect(merged?.breakdown.map((line) => line.label)).toEqual([
      'PR merged',
      'Size (log-scaled, 300 lines)',
      'Reviewed by another human',
      'Base Power',
      'Zone (level 1)',
      'XP',
      'Smithing XP',
    ]);
    const review = (await h.db.listEvents(REVIEWER_ID, { limit: 10 })).rows.find(
      (row) => row.kind === 'review_submitted',
    );
    expect(review).toMatchObject({
      reviewState: 'APPROVED',
      skill: 'vigilance',
      inlineComments: 0,
    });
  });

  it('records a changes-requested review round and the riposte on the later merge', async () => {
    const steps: Step[] = [
      { fixture: 'pull_request.opened' },
      { fixture: 'pull_request_review.changes_requested' },
      { fixture: 'pull_request_review.approved' },
      { fixture: 'pull_request.closed.merged' },
    ];
    const h = makeIngestHarness();
    await h.signIn(AUTHOR_ID);
    await h.signIn(REVIEWER_ID);
    await play(h, steps);
    await expectProfilesMatch(h, oracle(steps, [AUTHOR_ID, REVIEWER_ID]));
    expect((await h.db.getPR(REPO_ID, PR_NUMBER)).meta?.reviewRoundCount).toBe(1);
    const merged = (await h.db.listEvents(AUTHOR_ID, { limit: 10 })).rows[0];
    expect(merged?.breakdown.map((line) => line.label)).toContain('Riposte (feedback addressed)');
    // Two decisions by one reviewer are exactly the cap; a third would not score.
    expect(await eventKinds(h, REVIEWER_ID)).toEqual([
      'review_submitted',
      'review_submitted',
      'verified_kill',
    ]);
  });

  it('applies the per-reviewer cap derived from the stored review records', async () => {
    const approve = { fixture: 'pull_request_review.approved' };
    const steps: Step[] = [{ fixture: 'pull_request.opened' }, approve, approve, approve];
    const h = makeIngestHarness();
    await h.signIn(AUTHOR_ID);
    await h.signIn(REVIEWER_ID);
    await play(h, steps);
    await expectProfilesMatch(h, oracle(steps, [AUTHOR_ID, REVIEWER_ID]));
    // The third approval is recorded but earns nothing.
    expect(await eventKinds(h, REVIEWER_ID)).toEqual(['review_submitted', 'review_submitted']);
    expect((await h.db.getPR(REPO_ID, PR_NUMBER)).reviews).toHaveLength(3);
  });

  it('halves the points of a solo kill', async () => {
    // merged-by-author is PR #20; edit the opened PR to match so both refer to the same record.
    const sameNumber = (payload: Record<string, unknown>) => {
      payload.number = 20;
      (payload.pull_request as Record<string, unknown>).number = 20;
    };
    const steps: Step[] = [
      { fixture: 'pull_request.opened', edit: sameNumber },
      { fixture: 'pull_request.closed.merged-by-author' },
    ];
    const h = makeIngestHarness();
    await h.signIn(AUTHOR_ID);
    await play(h, steps);
    await expectProfilesMatch(h, oracle(steps, [AUTHOR_ID]));
    const merged = (await h.db.listEvents(AUTHOR_ID, { limit: 10 })).rows[0];
    expect(merged?.breakdown.some((line) => line.label.includes('solo kill'))).toBe(true);
  });

  it('credits a human merger of a bot-authored PR and nobody for a bot-merged bot PR', async () => {
    const steps: Step[] = [
      { fixture: 'pull_request.closed.merged.bot-author' },
      { fixture: 'pull_request.closed.merged.bot-both' },
    ];
    const h = makeIngestHarness();
    await h.signIn(MERGER_ID);
    await play(h, steps);
    await expectProfilesMatch(h, oracle(steps, [MERGER_ID]));
    const rows = (await h.db.listEvents(MERGER_ID, { limit: 10 })).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'pr_merged', prNumber: 22 });
    expect(h.metrics.totals.get('dropped_bot')).toBe(1);
    // The bot-authored PR is recorded because its merger is a player; the bot-merged one is not.
    expect((await h.db.getPR(REPO_ID, 22)).meta?.authorId).toBe(BOT_ID);
    expect((await h.db.getPR(REPO_ID, 23)).meta).toBeNull();
  });

  it('counts a draft opened and then ready_for_review once', async () => {
    const steps: Step[] = [
      { fixture: 'pull_request.opened.draft' },
      { fixture: 'pull_request.ready_for_review' },
    ];
    const h = makeIngestHarness();
    await h.signIn(AUTHOR_ID);
    await play(h, steps);
    await expectProfilesMatch(h, oracle(steps, [AUTHOR_ID]));
    expect(await eventKinds(h, AUTHOR_ID)).toEqual(['pr_opened']);
    expect((await h.db.getPR(REPO_ID, 18)).meta?.draft).toBe(false);
  });

  it('never calls an API the ingest role lacks, and keeps the table inside the schema', async () => {
    const h = makeIngestHarness();
    await h.signIn(AUTHOR_ID);
    await h.signIn(REVIEWER_ID);
    await play(h, PR_LIFE);
    const used = new Set(h.fake.calls.map((call) => call.operation));
    for (const operation of used) {
      expect(INGEST_ROLE).toContain(operation);
    }
    auditSchema(h.fake);
  });

  it('stores no title, body, repository name or login from the payload', async () => {
    const h = makeIngestHarness();
    await h.signIn(AUTHOR_ID);
    await h.signIn(REVIEWER_ID);
    await play(h, PR_LIFE);
    const dump = JSON.stringify(h.fake.snapshot(), (_key, value: unknown) =>
      value instanceof Set ? [...value] : value,
    );
    for (const forbidden of ['SENTINEL', 'example/repo', 'github.example.invalid']) {
      expect(dump, forbidden).not.toContain(forbidden);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// Rejections write nothing
// ---------------------------------------------------------------------------------------------

describe('ingest: rejected deliveries write nothing', () => {
  async function untouched(h: Harness, event: FunctionUrlEvent, status: number) {
    const before = h.fake.snapshot();
    const result = await h.handler(event);
    expect(result.statusCode).toBe(status);
    expect(h.fake.writeCalls).toBe(0);
    expect(h.fake.snapshot()).toEqual(before);
  }

  it('answers 401 for a wrong signature', async () => {
    const h = makeIngestHarness();
    await h.signIn(AUTHOR_ID);
    h.fake.calls.length = 0;
    const result = await h.handler(
      fixtureDelivery('pull_request.opened', undefined, {
        signature: sign('not-the-secret', 'anything'),
      }),
    );
    expect(result.statusCode).toBe(401);
    expect(h.fake.calls).toHaveLength(0);
    expect(itemsWithPrefix(h.fake, 'DELIVERY#')).toHaveLength(0);
    expect(itemsWithPrefix(h.fake, 'PR#')).toHaveLength(0);
    expect((await h.db.getProfile(AUTHOR_ID))?.xp).toBe(0);
  });

  it('answers 401 for a missing, malformed or truncated signature header', async () => {
    const h = makeIngestHarness();
    await h.signIn(AUTHOR_ID);
    const body = JSON.stringify(fixtureJson('pull_request.opened'));
    h.fake.calls.length = 0;
    for (const signature of [
      null,
      '',
      'sha256=',
      'sha1=abcd',
      'sha256=zz',
      sign(WEBHOOK_SECRET, body).slice(0, -2),
    ]) {
      const result = await h.handler(delivery({ eventName: 'pull_request', body, signature }));
      expect(result.statusCode, String(signature)).toBe(401);
    }
    expect(h.fake.calls).toHaveLength(0);
  });

  it('answers 401 when the body differs from the signed one', async () => {
    const h = makeIngestHarness();
    await h.signIn(AUTHOR_ID);
    const signed = JSON.stringify(fixtureJson('pull_request.opened'));
    const tampered = signed.replace('"number":17', '"number":18');
    expect(tampered).not.toBe(signed);
    h.fake.calls.length = 0;
    const result = await h.handler(
      delivery({
        eventName: 'pull_request',
        body: tampered,
        signature: sign(WEBHOOK_SECRET, signed),
      }),
    );
    expect(result.statusCode).toBe(401);
    expect(h.fake.calls).toHaveLength(0);
  });

  it('answers 413 above 256 KB, even for a correctly signed body', async () => {
    const h = makeIngestHarness();
    await h.signIn(AUTHOR_ID);
    const big = JSON.stringify({
      ...fixtureJson('pull_request.opened'),
      padding: 'x'.repeat(MAX_BODY_BYTES),
    });
    expect(Buffer.byteLength(big)).toBeGreaterThan(MAX_BODY_BYTES);
    h.fake.calls.length = 0;
    const result = await h.handler(delivery({ eventName: 'pull_request', body: big }));
    expect(result.statusCode).toBe(413);
    expect(h.fake.calls).toHaveLength(0);
    // The same limit applies to a base64 body, measured after decoding.
    const encoded = await h.handler(
      delivery({ eventName: 'pull_request', body: big, base64: true }),
    );
    expect(encoded.statusCode).toBe(413);
  });

  it('accepts a body of exactly 256 KB', async () => {
    const h = makeIngestHarness();
    const base = JSON.stringify({ ping: true, padding: '' });
    const body = JSON.stringify({ ping: true, padding: 'x'.repeat(MAX_BODY_BYTES - base.length) });
    expect(Buffer.byteLength(body)).toBe(MAX_BODY_BYTES);
    const result = await h.handler(delivery({ eventName: 'ping', body }));
    expect(result.statusCode).toBe(200);
  });

  it('answers 405 to anything but POST', async () => {
    const h = makeIngestHarness();
    await untouched(h, fixtureDelivery('pull_request.opened', undefined, { method: 'GET' }), 405);
  });

  it('answers 400 when the delivery id is missing or not a GUID', async () => {
    const h = makeIngestHarness();
    await h.signIn(AUTHOR_ID);
    for (const deliveryId of [null, 'x#y', 'a'.repeat(100)]) {
      h.fake.calls.length = 0;
      const result = await h.handler(
        fixtureDelivery('pull_request.opened', undefined, { deliveryId }),
      );
      expect(result.statusCode).toBe(400);
      expect(h.fake.calls).toHaveLength(0);
    }
  });

  it('acknowledges ping and unsubscribed events without touching the table', async () => {
    const h = makeIngestHarness();
    await untouched(
      h,
      delivery({ eventName: 'ping', body: '{"zen":"Keep it logically awesome."}' }),
      200,
    );
    await untouched(h, delivery({ eventName: 'issues', body: '{"action":"opened"}' }), 200);
    expect(h.fake.calls).toHaveLength(0);
  });

  it('answers 400 to signed non-JSON without logging the body', async () => {
    const h = makeIngestHarness();
    const secretText = 'TOP-SECRET-MARKER';
    const result = await h.handler(
      delivery({ eventName: 'pull_request', body: `{"x": ${secretText}` }),
    );
    expect(result.statusCode).toBe(400);
    expect(h.fake.calls).toHaveLength(0);
    expect(h.logs.join('\n')).not.toContain(secretText);
  });

  it('ignores actions the game does not score without writing', async () => {
    const h = makeIngestHarness();
    await h.signIn(AUTHOR_ID);
    h.fake.calls.length = 0;
    for (const fixture of [
      'pull_request.edited',
      'pull_request_review.dismissed',
      'pull_request_review_comment.edited',
      'installation.new_permissions_accepted',
    ]) {
      expect((await h.handler(fixtureDelivery(fixture))).statusCode).toBe(200);
    }
    expect(h.fake.calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------------------------
// Dedupe
// ---------------------------------------------------------------------------------------------

describe('ingest: replay', () => {
  it('a repeated delivery id answers 200 and changes nothing', async () => {
    const h = makeIngestHarness();
    await h.signIn(AUTHOR_ID);
    const first = fixtureDelivery('pull_request.opened');
    expect((await deliver(h, first)).statusCode).toBe(200);
    const xp = (await h.db.getProfile(AUTHOR_ID, true))?.xp;
    expect(xp).toBeGreaterThan(0);
    const before = h.fake.snapshot();

    h.fake.calls.length = 0;
    expect((await deliver(h, first)).statusCode).toBe(200);
    expect(h.fake.snapshot()).toEqual(before);
    // The only write attempted is the dedupe claim, which the table rejects.
    expect(h.fake.writeCalls).toBe(1);
    expect(h.metrics.totals.get('duplicates')).toBe(1);
    expect((await h.db.getProfile(AUTHOR_ID, true))?.xp).toBe(xp);
  });

  it('keeps each dedupe record for seven days', async () => {
    const h = makeIngestHarness();
    await h.signIn(AUTHOR_ID);
    const event = fixtureDelivery('pull_request.opened');
    await deliver(h, event);
    const guid = event.headers['x-github-delivery'] ?? '';
    expect(h.fake.peek(`DELIVERY#${guid}`, 'META')?.ttl).toBe(START / 1000 + DELIVERY_TTL_SECONDS);
  });

  it('replays of an unlinked-only delivery stay write-free', async () => {
    const h = makeIngestHarness();
    const event = fixtureDelivery('pull_request.opened');
    await deliver(h, event);
    await deliver(h, event);
    expect(h.fake.writeCalls).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------
// Attribution (Requirements 2.5 to 2.7)
// ---------------------------------------------------------------------------------------------

describe('ingest: attribution', () => {
  it('drops an event nobody has signed in for without a single write', async () => {
    const h = makeIngestHarness();
    for (const step of PR_LIFE) {
      expect((await deliver(h, fixtureDelivery(step.fixture))).statusCode).toBe(200);
    }
    expect(h.fake.size).toBe(0);
    expect(h.fake.writeCalls).toBe(0);
    expect(h.metrics.totals.get('dropped_unlinked')).toBe(4);
  });

  it('with an unlinked reviewer, writes only the shared PR# records and still scores the author', async () => {
    const h = makeIngestHarness();
    await h.signIn(AUTHOR_ID);
    await play(h, PR_LIFE);

    // No EVT#, profile or any USER# item for the unlinked reviewer or merger.
    expect(itemsWithPrefix(h.fake, `USER#${REVIEWER_ID}`)).toHaveLength(0);
    expect(itemsWithPrefix(h.fake, `USER#${MERGER_ID}`)).toHaveLength(0);
    // The author's profile, this week's run, the two Combat Log rows and the onboarding expedition are
    // all there is.
    expect(itemsWithPrefix(h.fake, 'USER#').map((item) => item.PK)).toEqual(
      new Array<string>(5).fill(`USER#${AUTHOR_ID}`),
    );
    // The PR facts and the human review record exist, because the author is a player.
    const pr = await h.db.getPR(REPO_ID, PR_NUMBER);
    expect(pr.meta?.merged).toBe(true);
    expect(pr.reviews.map((review) => review.reviewerId)).toEqual([REVIEWER_ID]);
    // The unlinked review still gives the author the party bonus; the inline comment is not recorded.
    expect(pr.inline).toEqual([]);
    await expectProfilesMatch(h, oracle(PR_LIFE, [AUTHOR_ID]));
    const merged = (await h.db.listEvents(AUTHOR_ID, { limit: 5 })).rows[0];
    expect(merged?.breakdown.map((line) => line.label)).toContain('Reviewed by another human');
    expect(h.metrics.totals.get('dropped_unlinked')).toBe(2); // the review and the inline comment
    auditSchema(h.fake);
  });

  it('with only the reviewer linked, records the PR and credits the review and the verified kill', async () => {
    const h = makeIngestHarness();
    await h.signIn(REVIEWER_ID);
    await play(h, PR_LIFE);
    await expectProfilesMatch(h, oracle(PR_LIFE, [REVIEWER_ID]));
    expect(await eventKinds(h, REVIEWER_ID)).toEqual([
      'review_submitted',
      'review_comment_created',
      'verified_kill',
    ]);
    // The opened event came first and nobody linked was involved: only the reviewer's records exist.
    expect((await h.db.getPR(REPO_ID, PR_NUMBER)).meta?.merged).toBe(true);
    expect(
      itemsWithPrefix(h.fake, 'USER#').every((item) => item.PK === `USER#${REVIEWER_ID}`),
    ).toBe(true);
  });

  it('writes nothing for a bot review, and a bot is never recorded as a reviewer', async () => {
    const h = makeIngestHarness();
    await h.signIn(AUTHOR_ID);
    await deliver(h, fixtureDelivery('pull_request.opened'));
    h.fake.calls.length = 0;
    await deliver(h, fixtureDelivery('pull_request_review.commented-by-bot'));
    await deliver(h, fixtureDelivery('pull_request_review_comment.created.by-bot'));
    expect(
      h.fake.calls.filter((call) => call.operation !== 'GetItem' && call.operation !== 'Query'),
    ).toHaveLength(0);
    expect((await h.db.getPR(REPO_ID, PR_NUMBER)).reviews).toEqual([]);
    expect(h.metrics.totals.get('dropped_bot')).toBe(2);
  });

  it('drops events from an installation the player cannot see (Requirement 2.6)', async () => {
    const h = makeIngestHarness();
    await h.signIn(AUTHOR_ID, [123]);
    h.fake.calls.length = 0;
    await deliver(h, fixtureDelivery('pull_request.opened'));
    expect(h.fake.writeCalls).toBe(0);
    expect(h.metrics.totals.get('dropped_installation')).toBe(1);
    expect((await h.db.getProfile(AUTHOR_ID))?.xp).toBe(0);
  });

  it('accepts an installation on the player own account before the next sign-in', async () => {
    const h = makeIngestHarness();
    await h.signIn(AUTHOR_ID, []);
    await h.db.upsertInstallation({
      id: INSTALLATION_ID,
      accountId: AUTHOR_ID,
      repoIds: [REPO_ID],
      suspended: false,
    });
    await deliver(h, fixtureDelivery('pull_request.opened'));
    expect((await h.db.getProfile(AUTHOR_ID))?.xp).toBe(90);
  });

  it('drops events from a suspended or deleted installation even if the profile lists it', async () => {
    const h = makeIngestHarness();
    await h.signIn(AUTHOR_ID);
    await h.db.setInstallationSuspended({ id: INSTALLATION_ID, accountId: 1, suspended: true });
    await deliver(h, fixtureDelivery('pull_request.opened'));
    expect((await h.db.getProfile(AUTHOR_ID))?.xp).toBe(0);

    await h.db.removeInstallation(INSTALLATION_ID, h.clock.now);
    await deliver(h, fixtureDelivery('pull_request.opened'));
    expect((await h.db.getProfile(AUTHOR_ID))?.xp).toBe(0);
    expect(h.metrics.totals.get('dropped_installation')).toBe(2);
  });
});

// ---------------------------------------------------------------------------------------------
// Installation events (Requirement 1.7)
// ---------------------------------------------------------------------------------------------

describe('ingest: installation events', () => {
  it('maps an installation, edits its repositories, suspends it and removes it', async () => {
    const h = makeIngestHarness();
    const now = () => h.clock.now;
    await h.signIn(AUTHOR_ID, []);

    await deliver(h, fixtureDelivery('installation.created'));
    const created = await h.db.getInstallation(INSTALLATION_ID, now());
    expect(created).toMatchObject({
      accountId: INSTALLATION_ACCOUNT_ID,
      suspended: false,
      deleted: false,
    });
    expect(created?.repoIds.length).toBeGreaterThan(0);
    // The installer (the fixture sender, a linked player) can see it without signing in again.
    expect((await h.db.getProfile(AUTHOR_ID))?.installations).toEqual([INSTALLATION_ID]);

    const before = created?.repoIds ?? [];
    await deliver(h, fixtureDelivery('installation_repositories.added'));
    const added = (await h.db.getInstallation(INSTALLATION_ID, now()))?.repoIds ?? [];
    expect(added.length).toBeGreaterThan(before.length);
    await deliver(h, fixtureDelivery('installation_repositories.removed'));
    expect((await h.db.getInstallation(INSTALLATION_ID, now()))?.repoIds.length).toBeLessThan(
      added.length,
    );

    await deliver(h, fixtureDelivery('installation.suspend'));
    expect((await h.db.getInstallation(INSTALLATION_ID, now()))?.suspended).toBe(true);

    await deliver(h, fixtureDelivery('installation.deleted'));
    expect(await h.db.getInstallation(INSTALLATION_ID, now())).toMatchObject({
      deleted: true,
      repoIds: [],
    });
    // Removal is a tombstone because the ingest role cannot DeleteItem; the TTL sweep finishes it.
    expect(h.fake.expireTtl(now() / 1000 + 1)).toBe(1);
    expect(await h.db.getInstallation(INSTALLATION_ID, now())).toBeNull();
    auditSchema(h.fake);
  });

  it('does not touch a stranger profile when someone else installs the App', async () => {
    const h = makeIngestHarness();
    await deliver(h, fixtureDelivery('installation.created'));
    expect(itemsWithPrefix(h.fake, 'USER#')).toHaveLength(0);
    expect(itemsWithPrefix(h.fake, 'INSTALL#')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------------------------
// Failure handling and concurrency
// ---------------------------------------------------------------------------------------------

describe('ingest: failures and concurrency', () => {
  it('releases the delivery when it fails before any credit, so a redelivery works', async () => {
    const h = makeIngestHarness();
    await h.signIn(AUTHOR_ID);
    const event = fixtureDelivery('pull_request.opened');
    // The first profile write (the credit) is throttled once.
    const send = h.fake.send.bind(h.fake);
    let failed = false;
    vi.spyOn(h.fake, 'send').mockImplementation((command: unknown) => {
      const input = (command as { input: { UpdateExpression?: string; Key?: { SK?: string } } })
        .input;
      if (!failed && input.UpdateExpression?.includes('ADD') && input.Key?.SK === 'PROFILE') {
        failed = true;
        return Promise.reject(
          Object.assign(new Error('throttled'), { name: 'ThrottlingException' }),
        );
      }
      return send(command);
    });

    expect((await deliver(h, event)).statusCode).toBe(500);
    expect(h.logs.join('\n')).toContain('ThrottlingException');
    expect((await h.db.getProfile(AUTHOR_ID, true))?.xp).toBe(0);

    expect((await deliver(h, event)).statusCode).toBe(200);
    expect((await h.db.getProfile(AUTHOR_ID, true))?.xp).toBe(90);
    // A third delivery of the same id is now a duplicate.
    await deliver(h, event);
    expect((await h.db.getProfile(AUTHOR_ID, true))?.xp).toBe(90);
    expect(h.metrics.totals.get('duplicates')).toBe(1);
  });

  it('keeps the claim once XP was credited, so a redelivery cannot credit twice', async () => {
    const h = makeIngestHarness();
    await h.signIn(AUTHOR_ID);
    const event = fixtureDelivery('pull_request.opened');
    const send = h.fake.send.bind(h.fake);
    let failed = false;
    vi.spyOn(h.fake, 'send').mockImplementation((command: unknown) => {
      const input = (command as { input: { Item?: { SK?: string } } }).input;
      if (!failed && input.Item?.SK?.startsWith('EVT#')) {
        failed = true;
        return Promise.reject(Object.assign(new Error('boom'), { name: 'InternalServerError' }));
      }
      return send(command);
    });
    expect((await deliver(h, event)).statusCode).toBe(500);
    expect((await h.db.getProfile(AUTHOR_ID, true))?.xp).toBe(90);
    expect((await deliver(h, event)).statusCode).toBe(200);
    expect((await h.db.getProfile(AUTHOR_ID, true))?.xp).toBe(90);
  });

  it('answers 500 and logs only the error name when the secret cannot be read', async () => {
    const h = makeIngestHarness();
    const broken = createIngestHandler({
      db: h.db,
      metrics: h.metrics,
      log: { error: (event, _context, error) => h.logs.push(`${event}:${(error as Error).name}`) },
      secrets: { get: () => Promise.reject(new Error('parameter /mergescape/x contents')) },
    });
    const result = await broken(fixtureDelivery('pull_request.opened'));
    expect(result.statusCode).toBe(500);
    expect(h.logs).toEqual(['ingest.failed:Error']);
    expect(h.fake.calls).toHaveLength(0);
  });

  it('serialises two concurrent credits for one player with the version lock', async () => {
    const h = makeIngestHarness();
    await h.signIn(AUTHOR_ID);
    h.fake.calls.length = 0;
    const opened = (number: number) =>
      fixtureDelivery('pull_request.opened', (payload) => {
        payload.number = number;
        (payload.pull_request as Record<string, unknown>).number = number;
      });
    const results = await Promise.all([h.handler(opened(31)), h.handler(opened(32))]);
    expect(results.map((result) => result.statusCode)).toEqual([200, 200]);

    const profile = await h.db.getProfile(AUTHOR_ID, true);
    // One open earned the daily bonus (30 points -> 90 XP), the other did not (10 points -> 30 XP).
    expect(profile?.xp).toBe(120);
    expect(profile?.opensCount).toBe(2);
    // Version 1 is the lazy start of the week; each credit then adds one.
    expect(profile?.version).toBe(3);
    const rows = (await h.db.listEvents(AUTHOR_ID, { limit: 5 })).rows;
    expect(rows).toHaveLength(2);
    const daily = rows.filter((row) =>
      row.breakdown.some((line) => line.label === 'First event of the day'),
    );
    expect(daily).toHaveLength(1);
    // The loser of the race re-read and re-scored, so there were more profile writes than the one lazy
    // start and the two events.
    const profileWrites = h.fake.calls.filter(
      (call) =>
        call.operation === 'UpdateItem' && (call.input.Key as { SK?: string }).SK === 'PROFILE',
    );
    expect(profileWrites.length).toBeGreaterThan(3);
    // The week got both events' XP exactly once, whatever the interleaving.
    expect((await h.db.getWeek(AUTHOR_ID, '2026-46'))?.weeklyXp).toBe(120);
  });

  it('stores nothing from the payload in the logs when a delivery fails', async () => {
    const h = makeIngestHarness();
    await h.signIn(AUTHOR_ID);
    vi.spyOn(h.fake, 'send').mockRejectedValue(new Error('SENTINEL-TITLE leaked into an error'));
    await h.handler(fixtureDelivery('pull_request.opened'));
    expect(h.logs.join('\n')).not.toContain('SENTINEL');
  });
});
