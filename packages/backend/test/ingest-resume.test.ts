/**
 * A delivery that fails half way is finished by its redelivery, and what it had already done is not done
 * twice: the lease on the claim (a Lambda that is killed releases nothing), the credits that survive a failure
 * after the profile commit, the counters added once per delivery, the Act clear that pays once, and the
 * signed body that cannot be replayed under a fresh delivery id.
 */
import { DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DELIVERY_LEASE_MS, DELIVERY_TTL_SECONDS } from '../src/db';
import { ensureRun } from '../src/runs';
import { makeIngestHarness, SEED, START } from './harness';
import type { Harness } from './harness';
import { auditSchema, TABLE_NAME } from './support';
import {
  AUTHOR_ID,
  delivery,
  fixtureDelivery,
  fixtureText,
  PR_NUMBER,
  REPO_ID,
  REVIEWER_ID,
} from './webhooks';

afterEach(() => {
  vi.restoreAllMocks();
});

interface Input {
  Key?: { PK?: string; SK?: string };
  Item?: { PK?: string; SK?: string };
  UpdateExpression?: string;
  ExpressionAttributeNames?: Record<string, string>;
  ExpressionAttributeValues?: Record<string, unknown>;
}

const throttled = (): Error =>
  Object.assign(new Error('throttled'), { name: 'ThrottlingException' });

/** Fail the first call `when` matches, then behave. */
function failOnce(h: Harness, when: (input: Input) => boolean): void {
  const send = h.fake.send.bind(h.fake);
  let armed = true;
  vi.spyOn(h.fake, 'send').mockImplementation((command: unknown) => {
    const input = (command as { input: Input }).input;
    if (armed && when(input)) {
      armed = false;
      return Promise.reject(throttled());
    }
    return send(command);
  });
}

const names = (input: Input): string[] => Object.values(input.ExpressionAttributeNames ?? {});
const onWeek = (input: Input): boolean => String(input.Key?.SK ?? '').startsWith('WEEK#');
const onProfile = (input: Input): boolean => input.Key?.SK === 'PROFILE';
const isEventRow = (input: Input): boolean => String(input.Item?.SK ?? '').startsWith('EVT#');

const xp = async (h: Harness, id = AUTHOR_ID): Promise<number | undefined> =>
  (await h.db.getProfile(id, true))?.xp;
const rows = async (h: Harness, id = AUTHOR_ID) => (await h.db.listEvents(id, { limit: 50 })).rows;
const weekly = async (h: Harness) => (await h.db.getWeekItem(AUTHOR_ID, '2026-46'))?.run.weeklyXp;
const guidOf = (event: ReturnType<typeof fixtureDelivery>): string =>
  event.headers['x-github-delivery'] ?? '';

describe('the lease on a claimed delivery', () => {
  /** A Lambda killed mid-delivery: its first write after the claims fails, and so does everything after. */
  function killAfterClaim(h: Harness): void {
    const send = h.fake.send.bind(h.fake);
    let dead = false;
    vi.spyOn(h.fake, 'send').mockImplementation((command: unknown) => {
      const input = (command as { input: Input }).input;
      const writes = input.UpdateExpression !== undefined || input.Item !== undefined;
      const key = input.Key?.PK ?? input.Item?.PK ?? '';
      if (writes && !key.startsWith('DELIVERY#')) {
        dead = true;
      }
      return dead ? Promise.reject(new Error('the Lambda was killed')) : send(command);
    });
  }

  it('lets the redelivery of a delivery that timed out before its first commit through, after the lease', async () => {
    const h = makeIngestHarness();
    await h.signIn(AUTHOR_ID);
    const event = fixtureDelivery('pull_request.opened');
    killAfterClaim(h);
    expect((await h.handler(event)).statusCode).toBe(500);
    vi.restoreAllMocks();
    expect(h.fake.peek(`DELIVERY#${guidOf(event)}`, 'META')).toMatchObject({
      status: 'processing',
      lease_until: START + DELIVERY_LEASE_MS,
    });
    expect(await xp(h)).toBe(0);

    // While the lease runs the delivery may still be alive: a redelivery is a duplicate.
    h.clock.now = START + DELIVERY_LEASE_MS - 1;
    expect((await h.handler(event)).statusCode).toBe(200);
    expect(h.metrics.totals.get('duplicates')).toBe(1);
    expect(await xp(h)).toBe(0);

    // Once it has run out nothing can be alive: the redelivery takes the claim over and finishes.
    h.clock.now = START + DELIVERY_LEASE_MS + 1;
    expect((await h.handler(event)).statusCode).toBe(200);
    expect(await xp(h)).toBe(90);
    expect(await rows(h)).toHaveLength(1);
    expect(h.fake.peek(`DELIVERY#${guidOf(event)}`, 'META')).toMatchObject({ status: 'done' });

    // And now it is a duplicate for good.
    h.clock.now += 100 * DELIVERY_LEASE_MS;
    await h.handler(event);
    expect(await xp(h)).toBe(90);
    expect(h.metrics.totals.get('duplicates')).toBe(2);
    auditSchema(h.fake);
  });

  it('keeps the records of a finished delivery for seven days', async () => {
    const h = makeIngestHarness();
    await h.signIn(AUTHOR_ID);
    const event = fixtureDelivery('pull_request.opened');
    await h.handler(event);
    expect(h.fake.peek(`DELIVERY#${guidOf(event)}`, 'META')).toMatchObject({
      status: 'done',
      ttl: START / 1000 + DELIVERY_TTL_SECONDS,
    });
  });
});

describe('a delivery that fails after its profile commit', () => {
  it('is finished by the redelivery: the Combat Log row is written, and the XP is not credited twice', async () => {
    const h = makeIngestHarness();
    await h.signIn(AUTHOR_ID);
    const event = fixtureDelivery('pull_request.opened');
    failOnce(h, isEventRow);
    expect((await h.handler(event)).statusCode).toBe(500);
    expect(await xp(h)).toBe(90);
    expect(await rows(h)).toHaveLength(0);

    vi.restoreAllMocks();
    expect((await h.handler(event)).statusCode).toBe(200);
    // The profile was not scored again; the row and the week's XP were finished, once.
    expect(await xp(h)).toBe(90);
    expect(await rows(h)).toHaveLength(1);
    expect(await weekly(h)).toBe(90);
    expect((await h.db.getProfile(AUTHOR_ID, true))?.creditedDeliveries).toEqual([guidOf(event)]);
    // The week knows which credits it has counted.
    expect(h.fake.peek(`USER#${AUTHOR_ID}`, 'WEEK#2026-46')?.credited).toEqual(
      new Set([guidOf(event)]),
    );

    await h.handler(event);
    expect(await xp(h)).toBe(90);
    expect(await weekly(h)).toBe(90);
    expect(h.metrics.totals.get('events_scored')).toBe(1);
    auditSchema(h.fake);
  });

  it('no longer loses the week XP when the week credit fails: it is not swallowed, the redelivery adds it', async () => {
    const h = makeIngestHarness();
    await h.signIn(AUTHOR_ID);
    const event = fixtureDelivery('pull_request.opened');
    failOnce(h, (input) => onWeek(input) && names(input).includes('weekly_xp'));
    expect((await h.handler(event)).statusCode).toBe(500);
    expect(h.logs.join('\n')).toContain('ThrottlingException');
    // The profile is credited and the row is written; the week is not.
    expect(await xp(h)).toBe(90);
    expect(await rows(h)).toHaveLength(1);
    expect(await weekly(h)).toBe(0);

    vi.restoreAllMocks();
    expect((await h.handler(event)).statusCode).toBe(200);
    expect(await xp(h)).toBe(90);
    expect(await rows(h)).toHaveLength(1);
    expect(await weekly(h)).toBe(90);
    // The same again is a duplicate and adds nothing.
    await h.handler(event);
    expect(await weekly(h)).toBe(90);
  });

  it('scores afresh, and does not trust the ledger, when the attempt died before its commit', async () => {
    const h = makeIngestHarness();
    await h.signIn(AUTHOR_ID);
    const event = fixtureDelivery('pull_request.opened');
    // The Lambda dies after the ledger entry is written and before the profile write.
    failOnce(h, (input) => onProfile(input) && names(input).includes('credited'));
    expect((await h.handler(event)).statusCode).toBe(500);
    expect(await xp(h)).toBe(0);
    expect(await rows(h)).toHaveLength(0);
    const ledger = h.fake.peek(`DELIVERY#${guidOf(event)}`, 'META')?.credits as Record<
      string,
      unknown
    >;
    expect(Object.keys(ledger)).toEqual([guidOf(event)]);

    vi.restoreAllMocks();
    expect((await h.handler(event)).statusCode).toBe(200);
    expect(await xp(h)).toBe(90);
    expect(await rows(h)).toHaveLength(1);
    expect(await weekly(h)).toBe(90);
  });
});

describe('an Act clear', () => {
  /** The author is 50 XP short of the Scout target, so the next opened PR (90 XP) clears the act. */
  async function almostCleared(): Promise<Harness> {
    const h = makeIngestHarness();
    await h.signIn(AUTHOR_ID);
    await ensureRun({ db: h.db, now: START, newSeed: () => SEED }, AUTHOR_ID);
    await h.db.addWeekCredit(AUTHOR_ID, '2026-46', { xp: 1150, merge: false, review: false });
    return h;
  }
  const gold = async (h: Harness) => (await h.db.getProfile(AUTHOR_ID, true))?.gold;
  const week = async (h: Harness) => h.db.getWeekItem(AUTHOR_ID, '2026-46');

  it('pays its gold once even when claiming the act fails, and the redelivery claims it', async () => {
    const h = await almostCleared();
    const event = fixtureDelivery('pull_request.opened');
    failOnce(h, (input) => onWeek(input) && names(input).includes('cleared_acts'));
    expect((await h.handler(event)).statusCode).toBe(500);
    // Paid, not yet claimed: the act is still the Scout.
    const paid = await gold(h);
    expect(paid).toBeGreaterThanOrEqual(20);
    expect((await week(h))?.run.act).toBe('scout');
    expect((await h.db.getProfile(AUTHOR_ID, true))?.actsPaid).toEqual(['2026-46:scout']);

    vi.restoreAllMocks();
    expect((await h.handler(event)).statusCode).toBe(200);
    expect((await week(h))?.run).toMatchObject({ act: 'raid', clearedActs: ['scout'] });
    expect(await gold(h)).toBe(paid);
    expect(await xp(h)).toBe(90);
  });

  it('never clears an act whose payout failed, so the act cannot be cleared with nothing paid', async () => {
    const h = await almostCleared();
    const event = fixtureDelivery('pull_request.opened');
    failOnce(h, (input) => onProfile(input) && names(input).includes('acts_paid'));
    expect((await h.handler(event)).statusCode).toBe(500);
    expect((await week(h))?.run.act).toBe('scout');
    expect((await h.db.getProfile(AUTHOR_ID, true))?.actsPaid).toEqual([]);
    const before = await gold(h);

    vi.restoreAllMocks();
    expect((await h.handler(event)).statusCode).toBe(200);
    expect((await week(h))?.run).toMatchObject({ act: 'raid', clearedActs: ['scout'] });
    expect(await gold(h)).toBeGreaterThanOrEqual((before ?? 0) + 20);
    expect((await h.db.getProfile(AUTHOR_ID, true))?.actsPaid).toEqual(['2026-46:scout']);
  });

  it('pays nobody a deleted player: no ghost profile comes back with the gold', async () => {
    const h = await almostCleared();
    const event = fixtureDelivery('pull_request.opened');
    // The player deletes their account between the XP credit and the payout.
    const send = h.fake.send.bind(h.fake);
    const remover = h.fake.forRole('account-delete', ['DeleteItem']);
    let removed = false;
    vi.spyOn(h.fake, 'send').mockImplementation(async (command: unknown) => {
      const input = (command as { input: Input }).input;
      if (!removed && onProfile(input) && names(input).includes('acts_paid')) {
        removed = true;
        await remover.send(new DeleteCommand({ TableName: TABLE_NAME, Key: input.Key as never }));
      }
      return send(command);
    });
    expect((await h.handler(event)).statusCode).toBe(200);
    vi.restoreAllMocks();
    expect(removed).toBe(true);
    expect(h.fake.peek(`USER#${AUTHOR_ID}`, 'PROFILE')).toBeUndefined();
    // The act was not claimed for a player who is gone either way it is only the profile that matters here.
    expect(await h.db.getProfile(AUTHOR_ID, true)).toBeNull();
  });
});

describe('the counters of a delivery', () => {
  it('count a push once when the delivery is processed again after a failure', async () => {
    const h = makeIngestHarness();
    await h.signIn(AUTHOR_ID);
    await h.handler(fixtureDelivery('pull_request.opened'));
    const push = fixtureDelivery('pull_request.synchronize');
    // Everything is done when the delivery is marked done: that write fails.
    failOnce(
      h,
      (input) =>
        String(input.Key?.PK ?? '').startsWith('DELIVERY#') &&
        input.ExpressionAttributeValues !== undefined &&
        Object.values(input.ExpressionAttributeValues).includes('done'),
    );
    expect((await h.handler(push)).statusCode).toBe(500);
    expect((await h.db.getPR(REPO_ID, PR_NUMBER)).meta?.syncCount).toBe(1);

    vi.restoreAllMocks();
    expect((await h.handler(push)).statusCode).toBe(200);
    expect((await h.db.getPR(REPO_ID, PR_NUMBER)).meta?.syncCount).toBe(1);
    await h.handler(push);
    expect((await h.db.getPR(REPO_ID, PR_NUMBER)).meta?.syncCount).toBe(1);
    auditSchema(h.fake);
  });

  it('count a review round once when the review credit fails and the delivery is redelivered', async () => {
    const h = makeIngestHarness();
    await h.signIn(AUTHOR_ID);
    await h.signIn(REVIEWER_ID);
    await h.handler(fixtureDelivery('pull_request.opened'));
    const review = fixtureDelivery('pull_request_review.changes_requested');
    failOnce(
      h,
      (input) => onProfile(input) && input.Key !== undefined && names(input).includes('credited'),
    );
    expect((await h.handler(review)).statusCode).toBe(500);
    expect((await h.db.getPR(REPO_ID, PR_NUMBER)).meta?.reviewRoundCount).toBe(1);

    vi.restoreAllMocks();
    expect((await h.handler(review)).statusCode).toBe(200);
    expect((await h.db.getPR(REPO_ID, PR_NUMBER)).meta?.reviewRoundCount).toBe(1);
    expect((await h.db.getPR(REPO_ID, PR_NUMBER)).reviews).toHaveLength(1);
    expect((await rows(h, REVIEWER_ID)).map((row) => row.kind)).toEqual(['review_submitted']);
  });
});

describe('a signed body replayed under a fresh delivery id', () => {
  it('is a duplicate, and writes nothing under the new id', async () => {
    const h = makeIngestHarness();
    await h.signIn(AUTHOR_ID);
    const body = fixtureText('pull_request.opened');
    const first = delivery({ eventName: 'pull_request', body });
    expect((await h.handler(first)).statusCode).toBe(200);
    expect(await xp(h)).toBe(90);

    const replay = delivery({
      eventName: 'pull_request',
      body,
      deliveryId: '11111111-2222-4333-8444-555555555555',
    });
    const before = h.fake.snapshot().length;
    expect((await h.handler(replay)).statusCode).toBe(200);
    expect(h.metrics.totals.get('duplicates')).toBe(1);
    expect(await xp(h)).toBe(90);
    expect(await rows(h)).toHaveLength(1);
    expect(h.fake.peek('DELIVERY#11111111-2222-4333-8444-555555555555', 'META')).toBeUndefined();
    expect(h.fake.snapshot()).toHaveLength(before);
    // The body is remembered like the delivery id: seven days.
    const bodyRecords = h.fake
      .snapshot()
      .filter((item) => String(item.PK).startsWith('DELIVERY#body-'));
    expect(bodyRecords).toHaveLength(1);
    expect(bodyRecords[0]).toMatchObject({
      status: 'done',
      ttl: START / 1000 + DELIVERY_TTL_SECONDS,
    });
  });

  it('does not stop the redelivery of a delivery that failed: the body is released with the id', async () => {
    const h = makeIngestHarness();
    await h.signIn(AUTHOR_ID);
    const event = fixtureDelivery('pull_request.opened');
    failOnce(h, (input) => onProfile(input) && names(input).includes('credited'));
    expect((await h.handler(event)).statusCode).toBe(500);
    vi.restoreAllMocks();
    expect((await h.handler(event)).statusCode).toBe(200);
    expect(await xp(h)).toBe(90);
  });

  it('lets a body through again when its delivery id turned out to belong to something else', async () => {
    const h = makeIngestHarness();
    await h.signIn(AUTHOR_ID);
    const taken = '22222222-3333-4444-8555-666666666666';
    await h.handler(fixtureDelivery('pull_request.opened', undefined, { deliveryId: taken }));
    // A different body under the id that is already done: refused, and its body is not held against it.
    const other = fixtureDelivery('pull_request.synchronize', undefined, { deliveryId: taken });
    const before = h.metrics.totals.get('duplicates') ?? 0;
    await h.handler(other);
    expect(h.metrics.totals.get('duplicates')).toBe(before + 1);
    const retry = delivery({ eventName: 'pull_request', body: other.body ?? '' });
    await h.handler(retry);
    expect((await h.db.getPR(REPO_ID, PR_NUMBER)).meta?.syncCount).toBe(1);
  });

  it('writes nothing for an unlinked actor, however often the body is replayed', async () => {
    const h = makeIngestHarness();
    const body = fixtureText('pull_request.opened');
    for (let i = 0; i < 3; i += 1) {
      expect((await h.handler(delivery({ eventName: 'pull_request', body }))).statusCode).toBe(200);
    }
    expect(h.fake.writeCalls).toBe(0);
  });
});
