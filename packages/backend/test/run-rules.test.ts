/**
 * The rules that reach into storage through the ingest and rollover paths: the Founder's Board, Riposte
 * credits, the Mentor Pledge's view of the author, and a rollover that fails for one profile.
 */
import { charmDefinition, makeCharm } from '@mergescape/shared';
import type { Charm } from '@mergescape/shared';
import { describe, expect, it } from 'vitest';
import type { LogResponse, MeResponse, WeekSummary } from '../src/api-types';
import { DAY, HOUR, makeGame } from './game-harness';
import type { Game } from './game-harness';
import { START } from './harness';
import { auditSchema } from './support';
import { AUTHOR_ID, fixtureDelivery, MERGER_ID, REVIEWER_ID } from './webhooks';

const charm = (id: Parameters<typeof charmDefinition>[0]): Charm =>
  makeCharm(charmDefinition(id) as NonNullable<ReturnType<typeof charmDefinition>>);

const me = async (g: Game, id = AUTHOR_ID) =>
  (await g.get('/me', id)).body as unknown as MeResponse;
const week = async (g: Game, id = AUTHOR_ID) =>
  (await g.get('/week', id)).body as unknown as WeekSummary;
const rows = async (g: Game, id = AUTHOR_ID) =>
  ((await g.get('/log', id)).body as unknown as LogResponse).entries;

async function setProfile(
  g: Game,
  patch: Parameters<Game['db']['saveProfile']>[2],
  id = AUTHOR_ID,
): Promise<void> {
  const profile = await g.db.getProfile(id, true);
  await g.db.saveProfile(id, profile?.version ?? 0, patch);
}

const FOUNDER_SEED = 13;

describe("the Founder's Board", () => {
  it('takes a Charm on Wednesday, returns it on Friday with +0.25 Power, and stores both', async () => {
    const g = makeGame();
    g.seeds.push(FOUNDER_SEED);
    await g.signIn(AUTHOR_ID);
    expect((await week(g)).mogul).toBe('founder');
    await setProfile(g, { charms: [charm('rubber-duck')] });

    g.clock.now = START + DAY; // Tuesday: the Board has not acted
    expect((await me(g)).charms.map((held) => held.id)).toEqual(['rubber-duck']);

    g.clock.now = START + 2 * DAY; // Wednesday
    expect((await me(g)).charms).toEqual([]);
    const away = await g.db.getProfile(AUTHOR_ID, true);
    expect(away?.mogulBenched?.charm.id).toBe('rubber-duck');
    expect(away?.mogulBoardWeek).toBe('2026-46');

    // Reading again settles nothing new: the Board acted once.
    const calls = g.fake.calls.length;
    await me(g);
    expect(g.fake.calls.slice(calls).every((call) => call.operation === 'GetItem')).toBe(true);

    g.clock.now = START + 4 * DAY; // Friday
    const back = (await me(g)).charms;
    expect(back.map((held) => held.id)).toEqual(['rubber-duck']);
    expect(back[0]?.power).toBe(0.5);
    const home = await g.db.getProfile(AUTHOR_ID, true);
    expect(home?.mogulBenched).toBeNull();
    auditSchema(g.fake);
  });

  it('pays four times the gold for points in a Founder week', async () => {
    const g = makeGame();
    g.seeds.push(FOUNDER_SEED);
    await g.signIn(AUTHOR_ID);
    await g.deliver(fixtureDelivery('pull_request.opened'));
    // The open scores 10 points, halved to 5 by the Founder, plus the 20 of the day's first event: 25.
    // At 1 gold per 10 points that is 2, times four: 8 gold (an ordinary week pays 3).
    const [opened] = await rows(g);
    expect(opened?.points).toBe(25);
    expect((await me(g)).gold).toBe(8);
  });
});

describe('Riposte credits', () => {
  async function life(g: Game): Promise<void> {
    for (const fixture of [
      'pull_request.opened',
      'pull_request_review.changes_requested',
      'pull_request_review.approved',
      'pull_request.closed.merged',
    ]) {
      expect((await g.deliver(fixtureDelivery(fixture))).statusCode).toBe(200);
    }
  }

  it("gives a reviewer holding Jester's Rebase a Riposte when their challenged PR merges", async () => {
    const g = makeGame();
    await g.signIn(AUTHOR_ID);
    await g.signIn(REVIEWER_ID);
    await setProfile(g, { charms: [charm('jesters-rebase')] }, REVIEWER_ID);
    await life(g);

    const reviewer = await rows(g, REVIEWER_ID);
    const riposte = reviewer.find((row) => row.kind === 'riposte_credit');
    expect(riposte).toBeDefined();
    // 15 points x4 for the Charm, on top of a verified kill for the approval.
    expect(riposte?.points).toBe(60);
    expect(riposte?.breakdown[0]?.label).toContain('Riposte');
    expect(reviewer.some((row) => row.kind === 'verified_kill')).toBe(true);
    expect(riposte?.id).toMatch(/-rc$/);
    // Nothing about it is scored at review time.
    const decisions = reviewer.filter((row) => row.kind === 'review_submitted');
    expect(decisions.every((row) => row.points <= 40 + 20)).toBe(true);
    auditSchema(g.fake);
  });

  it('writes nothing for a reviewer without the Charm', async () => {
    const g = makeGame();
    await g.signIn(AUTHOR_ID);
    await g.signIn(REVIEWER_ID);
    await life(g);
    const reviewer = await rows(g, REVIEWER_ID);
    expect(reviewer.some((row) => row.kind === 'riposte_credit')).toBe(false);
  });
});

describe("the Mentor Pledge's view of the author", () => {
  async function approvalProgress(authorMerges: number, reviewerMerges: number): Promise<number> {
    const g = makeGame();
    await g.signIn(AUTHOR_ID);
    await g.signIn(REVIEWER_ID);
    await setProfile(g, { repoMerges: { '1': authorMerges } }, AUTHOR_ID);
    await setProfile(g, { repoMerges: { '1': reviewerMerges } }, REVIEWER_ID);
    expect(
      (
        await g.post(
          '/pledges/play',
          { requestId: 'play-mentor-0001', pledgeId: 'mentor' },
          REVIEWER_ID,
        )
      ).status,
    ).toBe(200);
    await g.deliver(fixtureDelivery('pull_request.opened'));
    await g.deliver(fixtureDelivery('pull_request_review.approved'));
    return (await week(g, REVIEWER_ID)).pledgeProgress.mentor?.progress ?? -1;
  }

  it('counts an approval of an author with fewer merges than the reviewer', async () => {
    expect(await approvalProgress(2, 9)).toBe(1);
  });

  it('does not count an approval of an author with as many merges or more', async () => {
    expect(await approvalProgress(9, 9)).toBe(0);
    expect(await approvalProgress(12, 9)).toBe(0);
  });
});

describe('a rollover that fails for one profile', () => {
  const NEXT = Date.UTC(2026, 10, 16, 0, 5, 0);

  it('rolls the others, fails the invocation so Lambda retries, and then finishes the rest', async () => {
    const g = makeGame();
    for (const id of [AUTHOR_ID, REVIEWER_ID, MERGER_ID]) {
      await g.signIn(id);
    }
    g.clock.now = NEXT;
    g.intercept.api = (input) => {
      if (input.Item?.PK === `USER#${REVIEWER_ID}` && input.Item.SK?.startsWith('WEEK#')) {
        const error = new Error('throttled');
        error.name = 'ProvisionedThroughputExceededException';
        throw error;
      }
    };
    await expect(g.rollover()).rejects.toThrow('Rollover failed for 1 profile(s)');
    // Logged by numeric id and error name only.
    expect(g.logs).toEqual([
      JSON.stringify({
        event: 'rollover.failed',
        userId: REVIEWER_ID,
        error: 'ProvisionedThroughputExceededException',
      }),
    ]);
    expect((await g.db.getWeek(AUTHOR_ID, '2026-47'))?.weekKey).toBe('2026-47');
    expect((await g.db.getWeek(MERGER_ID, '2026-47'))?.weekKey).toBe('2026-47');
    expect(await g.db.getWeek(REVIEWER_ID, '2026-47')).toBeNull();
    const seeds = [AUTHOR_ID, MERGER_ID].map((id) => g.fake.peek(`USER#${id}`, 'WEEK#2026-47'));

    // The retry (EventBridge invokes asynchronously) finishes the straggler and touches no one else.
    g.intercept.api = undefined;
    await expect(g.rollover()).resolves.toEqual({ statusCode: 200, processed: 3 });
    expect(await g.db.getWeek(REVIEWER_ID, '2026-47')).not.toBeNull();
    expect([AUTHOR_ID, MERGER_ID].map((id) => g.fake.peek(`USER#${id}`, 'WEEK#2026-47'))).toEqual(
      seeds,
    );
  });

  it('scans only GSI1, in pages, as the api role', async () => {
    const g = makeGame();
    const ids = [AUTHOR_ID, REVIEWER_ID, MERGER_ID, 4004004, 5005005];
    for (const id of ids) {
      await g.signIn(id);
    }
    g.clock.now = NEXT;
    await g.rollover();
    const scans = g.fake.calls.filter((call) => call.operation === 'Scan');
    expect(scans.length).toBeGreaterThan(0);
    expect(scans.every((call) => call.role === 'api' && call.input.IndexName === 'GSI1')).toBe(
      true,
    );

    const found: number[] = [];
    for await (const id of g.db.scanProfileIds(2)) {
      found.push(id);
    }
    expect(found.sort()).toEqual([...ids].sort());
    // Pages of 2 over 5 profiles: at least 3 requests.
    expect(
      g.fake.calls.filter((call) => call.operation === 'Scan').length - scans.length,
    ).toBeGreaterThanOrEqual(3);
    expect(HOUR).toBeGreaterThan(0);
  });
});
