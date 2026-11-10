/**
 * The write protocol of the player mutations (`idempotent.ts`, `requests.ts`): a request id counts as applied
 * only when its effect was committed, an undo never masks the outcome of the request and never fails because
 * the week moved, and a request that died half way is completed by its replay or taken back once it is old.
 * The shop endpoints are the vehicle (seed 1: Charms Lantern and Whetstone at 40 gold).
 */
import { describe, expect, it } from 'vitest';
import type { MeResponse, MutationResponse, WeekSummary } from '../src/api-types';
import type { PendingLock, WeekItem } from '../src/db';
import { MAX_REQUEST_IDS } from '../src/idempotent';
import {
  applyFields,
  MAX_APPLIED_REQUESTS,
  PENDING_TTL_MS,
  recordPatch,
  settleLocks,
  undoChange,
  undoPatch,
  unlockPatch,
} from '../src/requests';
import { makeGame, playLife } from './game-harness';
import type { CommandInput, Game, Reply } from './game-harness';
import { auditSchema } from './support';
import { AUTHOR_ID, REVIEWER_ID } from './webhooks';

let counter = 0;
const rid = (): string => `lock-${String((counter += 1)).padStart(10, '0')}`;

const WEEK = '2026-46';

async function openShop(gold = 500): Promise<Game> {
  const g = makeGame();
  await g.signIn(AUTHOR_ID);
  await g.signIn(REVIEWER_ID);
  await playLife(g, 17);
  await playLife(g, 31);
  await setProfile(g, { gold });
  return g;
}

async function setProfile(g: Game, patch: Parameters<Game['db']['saveProfile']>[2]): Promise<void> {
  const profile = await g.db.getProfile(AUTHOR_ID, true);
  await g.db.saveProfile(AUTHOR_ID, profile?.version ?? 0, patch);
}

const weekItem = async (g: Game): Promise<WeekItem> =>
  (await g.db.getWeekItem(AUTHOR_ID, WEEK)) as WeekItem;
const week = async (g: Game) => (await g.get('/week')).body as unknown as WeekSummary;
const me = async (g: Game) => (await g.get('/me')).body as unknown as MeResponse;
const result = (reply: Reply) => reply.body as unknown as MutationResponse;

const throttled = (): Error =>
  Object.assign(new Error('throttled'), { name: 'ThrottlingException' });
const isProfileWrite = (input: CommandInput): boolean =>
  input.Key?.SK === 'PROFILE' &&
  Object.values(input.ExpressionAttributeNames ?? {}).includes('charms');
const isWeekWrite = (input: CommandInput): boolean =>
  String(input.Key?.SK ?? '').startsWith('WEEK#') && input.UpdateExpression !== undefined;

const buy = (index: number, requestId = rid()) => ({ requestId, kind: 'charm', index });

describe('an undo that cannot be done', () => {
  it('answers the refusal it was going to, and the replay is a refusal too, never a false 200', async () => {
    const g = await openShop(50);
    const request = buy(0);
    let throttle = false;
    g.intercept.api = async (input) => {
      if (!throttle && isProfileWrite(input)) {
        // The gold goes elsewhere, and from now on the table throttles every write to the week.
        throttle = true;
        await setProfile(g, { gold: 5 });
      } else if (throttle && isWeekWrite(input)) {
        throw throttled();
      }
    };
    const refused = await g.post('/shop/buy', request);
    g.intercept.api = undefined;
    // The undo failed (and said so), but the request still answers what it was going to answer.
    expect(refused).toEqual({ status: 409, body: { error: 'insufficient_gold' } });
    expect(g.logs.join('\n')).toContain('mutation.undo_failed');
    // The lock is still there: the id is not applied, and nothing was spent.
    expect(Object.keys((await weekItem(g)).pending)).toEqual([request.requestId]);
    expect((await weekItem(g)).requestIds).toEqual([]);
    expect((await me(g)).gold).toBe(5);

    // The client sends the same request again: still refused, and this time the lock comes off.
    expect(await g.post('/shop/buy', request)).toEqual({
      status: 409,
      body: { error: 'insufficient_gold' },
    });
    expect((await weekItem(g)).pending).toEqual({});
    expect((await week(g)).shop?.charms.some((slot) => slot.sold)).toBe(false);

    await setProfile(g, { gold: 60 });
    const again = await g.post('/shop/buy', request);
    expect(again.status).toBe(200);
    expect(result(again).me.gold).toBe(20);
  });

  it('is taken back by the next load once the lock is older than any request can live', async () => {
    const g = await openShop(50);
    let throttle = false;
    g.intercept.api = async (input) => {
      if (!throttle && isProfileWrite(input)) {
        throttle = true;
        await setProfile(g, { gold: 5 });
      } else if (throttle && isWeekWrite(input)) {
        throw throttled();
      }
    };
    await g.post('/shop/buy', buy(0));
    g.intercept.api = undefined;

    // A request that may still be running keeps its lock: the slot reads as sold.
    g.clock.now += PENDING_TTL_MS - 1000;
    expect((await week(g)).shop?.charms[0]?.sold).toBe(true);
    // Older than the Lambda timeout, it cannot be running: the next load takes it back.
    g.clock.now += 2000;
    expect((await week(g)).shop?.charms[0]?.sold).toBe(false);
    expect((await weekItem(g)).pending).toEqual({});
    expect((await weekItem(g)).requestIds).toEqual([]);
  });
});

describe('an undo while the week moves', () => {
  it('puts the shelf back and keeps what another write changed in the meantime', async () => {
    const g = await openShop(50);
    const request = buy(0);
    let raced = false;
    g.intercept.api = async (input) => {
      if (!raced && isProfileWrite(input)) {
        raced = true;
        await setProfile(g, { gold: 5 });
        // Another writer touches the week: the lock's version is gone.
        const current = await weekItem(g);
        expect(
          await g.db.saveWeek(
            AUTHOR_ID,
            WEEK,
            { version: current.version },
            { freePack: 'pledge' },
          ),
        ).toBe(true);
      }
    };
    const refused = await g.post('/shop/buy', request);
    g.intercept.api = undefined;
    expect(refused).toEqual({ status: 409, body: { error: 'insufficient_gold' } });
    const after = await weekItem(g);
    // The slot is unsold again and the id is free, and the other writer's field is untouched.
    expect(after.run.shop?.charms.some((slot) => slot.sold)).toBe(false);
    expect(after.pending).toEqual({});
    expect(after.requestIds).toEqual([]);
    expect(after.freePack).toBe('pledge');
    expect(g.logs).toEqual([]);
  });

  it('takes back only its own slot when another purchase has been made on top of it', async () => {
    const g = await openShop(50);
    const request = buy(0);
    let raced = false;
    g.intercept.api = async (input) => {
      if (!raced && isProfileWrite(input)) {
        raced = true;
        await setProfile(g, { gold: 5 });
        // A second purchase (slot 1) locked the week on top of this one's change.
        const current = await weekItem(g);
        const shop = structuredClone(current.run.shop) as NonNullable<typeof current.run.shop>;
        (shop.charms[1] as { sold: boolean }).sold = true;
        await g.db.saveWeek(AUTHOR_ID, WEEK, { version: current.version }, { shop });
      }
    };
    await g.post('/shop/buy', request);
    g.intercept.api = undefined;
    const sold = (await weekItem(g)).run.shop?.charms.map((slot) => slot.sold);
    expect(sold).toEqual([false, true]);
  });

  it('leaves a shop that an Act clear replaced alone', async () => {
    const g = await openShop(50);
    let raced = false;
    let replacement: unknown;
    g.intercept.api = async (input) => {
      if (!raced && isProfileWrite(input)) {
        raced = true;
        await setProfile(g, { gold: 5 });
        // The Act clear opens a different shop while the purchase waits for its profile write.
        const current = await weekItem(g);
        const shop = { ...structuredClone(current.run.shop), rerolls: 9, charms: [] };
        replacement = shop;
        await g.db.saveWeek(AUTHOR_ID, WEEK, { version: current.version }, { shop } as never);
      }
    };
    await g.post('/shop/buy', buy(0));
    g.intercept.api = undefined;
    expect((await weekItem(g)).run.shop).toEqual(replacement);
  });
});

describe('a request that died after taking the week lock', () => {
  /** The Lambda is killed when it reaches the profile write: that call and everything after it fails. */
  async function crashAtProfileWrite(g: Game, request: Record<string, unknown>): Promise<Reply> {
    let dead = false;
    g.intercept.api = (input) => {
      if (isProfileWrite(input)) {
        dead = true;
      }
      if (dead) {
        throw new Error('the Lambda was killed');
      }
    };
    const reply = await g.post('/shop/buy', request);
    g.intercept.api = undefined;
    return reply;
  }

  it('is completed once by its replay: the lock is kept, the profile written, the id applied', async () => {
    const g = await openShop(500);
    const request = buy(0);
    expect((await crashAtProfileWrite(g, request)).status).toBe(500);
    // The week holds the change and the lock; the profile holds nothing, so the id is not applied.
    const locked = await weekItem(g);
    expect(Object.keys(locked.pending)).toEqual([request.requestId]);
    expect(locked.requestIds).toEqual([]);
    expect(locked.run.shop?.charms[0]?.sold).toBe(true);
    expect((await me(g)).gold).toBe(500);

    const replay = await g.post('/shop/buy', request);
    expect(replay.status).toBe(200);
    expect(result(replay).me.gold).toBe(460);
    expect(result(replay).me.charms.map((held) => held.id)).toEqual(['lantern']);
    expect(result(replay).week.shop?.charms[0]?.sold).toBe(true);
    const done = await weekItem(g);
    expect(done.pending).toEqual({});
    expect(done.requestIds).toEqual([request.requestId]);
    expect((await g.db.getProfile(AUTHOR_ID, true))?.appliedRequests).toContain(request.requestId);

    // Another replay changes nothing, and the slot cannot be bought again.
    expect(await g.post('/shop/buy', request)).toEqual(replay);
    expect((await me(g)).gold).toBe(460);
    expect(await g.post('/shop/buy', buy(0))).toEqual({ status: 409, body: { error: 'sold_out' } });
    auditSchema(g.fake);
  });

  it('is taken back when nobody replays it, and the same id then starts afresh', async () => {
    const g = await openShop(500);
    const request = buy(1);
    await crashAtProfileWrite(g, request);
    g.clock.now += PENDING_TTL_MS + 1000;
    expect((await week(g)).shop?.charms[1]?.sold).toBe(false);
    expect((await weekItem(g)).pending).toEqual({});
    expect((await me(g)).gold).toBe(500);
    const retry = await g.post('/shop/buy', request);
    expect(retry.status).toBe(200);
    expect(result(retry).me.gold).toBe(460);
  });

  it('is planned again by its replay, and let go of when the plan no longer holds', async () => {
    const g = await openShop(50);
    const request = buy(0);
    await crashAtProfileWrite(g, request);
    // While the request was dead the gold went elsewhere: the replay is refused and the lock comes off.
    await setProfile(g, { gold: 5 });
    expect(await g.post('/shop/buy', request)).toEqual({
      status: 409,
      body: { error: 'insufficient_gold' },
    });
    expect((await weekItem(g)).pending).toEqual({});
    expect((await week(g)).shop?.charms[0]?.sold).toBe(false);
  });
});

describe('a replay that is no longer the request that took the lock', () => {
  it('lets go of the old lock and applies the request afresh, once', async () => {
    const g = await openShop(500);
    const request = buy(0);
    let dead = false;
    g.intercept.api = (input) => {
      if (isProfileWrite(input)) {
        dead = true;
      }
      if (dead) {
        throw new Error('the Lambda was killed');
      }
    };
    expect((await g.post('/shop/buy', request)).status).toBe(500);
    g.intercept.api = undefined;
    // The lock on the week records a change the plan would not make today.
    const locked = await weekItem(g);
    const lock = locked.pending[request.requestId] as NonNullable<(typeof locked.pending)[string]>;
    await g.db.saveWeek(
      AUTHOR_ID,
      WEEK,
      { version: locked.version },
      {
        pending: { [request.requestId]: { ...lock, after: { ...lock.after, freePack: 'pledge' } } },
      },
    );
    const replay = await g.post('/shop/buy', request);
    expect(replay.status).toBe(200);
    expect(result(replay).me.gold).toBe(460);
    expect(result(replay).me.charms).toHaveLength(1);
    expect((await weekItem(g)).pending).toEqual({});
    expect((await weekItem(g)).requestIds).toEqual([request.requestId]);
  });
});

describe('a week that keeps moving under the bookkeeping', () => {
  it('leaves the id to the next load after a few tries, still answering 200 for a committed request', async () => {
    const g = await openShop(500);
    const request = buy(0);
    let committed = false;
    let bumped = 0;
    let busy = false;
    g.intercept.api = async (input) => {
      if (isProfileWrite(input)) {
        committed = true;
      } else if (committed && !busy && bumped < 4 && isWeekWrite(input)) {
        // Another writer gets to the week first, every time the request tries to record itself.
        busy = true;
        bumped += 1;
        const current = await weekItem(g);
        await g.db.saveWeek(AUTHOR_ID, WEEK, { version: current.version }, { freePack: null });
        busy = false;
      }
    };
    const reply = await g.post('/shop/buy', request);
    g.intercept.api = undefined;
    expect(reply.status).toBe(200);
    expect(bumped).toBe(4);
    expect(g.logs.join(', ')).toContain('mutation.record_failed');
    // The next load finishes it.
    await week(g);
    expect((await weekItem(g)).requestIds).toEqual([request.requestId]);
    expect((await weekItem(g)).pending).toEqual({});
  });
});

describe('a request that died after its profile write', () => {
  it('has its marker on the profile, so a replay is a replay even though the week was never told', async () => {
    const g = await openShop(500);
    const request = buy(0);
    let committed = false;
    g.intercept.api = (input) => {
      if (isProfileWrite(input)) {
        committed = true;
      } else if (committed) {
        throw new Error('the Lambda was killed');
      }
    };
    expect((await g.post('/shop/buy', request)).status).toBe(500);
    g.intercept.api = undefined;
    expect((await me(g)).gold).toBe(460);
    expect(Object.keys((await weekItem(g)).pending)).toEqual([]);
    // The lock is promoted by the next load; either way the replay answers as applied and spends nothing.
    const replay = await g.post('/shop/buy', request);
    expect(replay.status).toBe(200);
    expect(result(replay).me.gold).toBe(460);
    expect((await weekItem(g)).requestIds).toEqual([request.requestId]);
  });

  it('is finished by the next load when only its bookkeeping failed, and says so in the log', async () => {
    const g = await openShop(500);
    const request = buy(0);
    let committed = false;
    let failed = false;
    g.intercept.api = (input) => {
      if (isProfileWrite(input)) {
        committed = true;
      } else if (committed && !failed && isWeekWrite(input)) {
        failed = true;
        throw throttled();
      }
    };
    const reply = await g.post('/shop/buy', request);
    g.intercept.api = undefined;
    // The commit happened, so the answer is 200 whatever the bookkeeping did.
    expect(reply.status).toBe(200);
    expect(failed).toBe(true);
    expect(g.logs.join('\n')).toContain('mutation.record_failed');
    // The next load found the marker on the profile and promoted the id.
    const after = await weekItem(g);
    expect(after.pending).toEqual({});
    expect(after.requestIds).toEqual([request.requestId]);
    expect(await g.post('/shop/buy', request)).toEqual(reply);
  });
});

describe('the same request id, at once', () => {
  it('applies once however many copies race', async () => {
    const g = await openShop(500);
    const request = buy(0);
    const replies = await Promise.all([1, 2, 3, 4].map(() => g.post('/shop/buy', request)));
    expect(replies.map((reply) => reply.status)).toEqual([200, 200, 200, 200]);
    const after = await me(g);
    expect(after.gold).toBe(460);
    expect(after.charms.map((held) => held.id)).toEqual(['lantern']);
    expect((await weekItem(g)).requestIds).toEqual([request.requestId]);
    expect((await weekItem(g)).pending).toEqual({});
    expect((await g.db.getProfile(AUTHOR_ID, true))?.appliedRequests).toEqual([request.requestId]);
  });

  it('applies a mutation that changes only the profile once, too', async () => {
    const g = await openShop(500);
    await g.post('/shop/buy', buy(0));
    const sell = { requestId: rid(), charmId: 'lantern' };
    const replies = await Promise.all([1, 2, 3].map(() => g.post('/shop/sell', sell)));
    expect(replies.map((reply) => reply.status)).toEqual([200, 200, 200]);
    // Sold once, for half the price.
    expect((await me(g)).gold).toBe(500 - 40 + 20);
  });
});

describe('the memory of applied requests', () => {
  it('keeps the last 20 ids on the week and the last few markers on the profile', async () => {
    const g = await openShop(5000);
    const ids: string[] = [];
    for (let i = 0; i < MAX_REQUEST_IDS + 3; i += 1) {
      const requestId = rid();
      ids.push(requestId);
      expect((await g.post('/shop/reroll', { requestId })).status).toBe(200);
    }
    expect((await weekItem(g)).requestIds).toEqual(ids.slice(-MAX_REQUEST_IDS));
    const profile = await g.db.getProfile(AUTHOR_ID, true);
    expect(profile?.appliedRequests).toEqual(ids.slice(-MAX_APPLIED_REQUESTS));
    // An id older than the markers but inside the week's 20 is still a replay.
    const gold = (await me(g)).gold;
    const old = ids[ids.length - MAX_APPLIED_REQUESTS - 2] as string;
    expect((await g.post('/shop/reroll', { requestId: old })).status).toBe(200);
    expect((await me(g)).gold).toBe(gold);
  });
});

// ---------------------------------------------------------------------------------------------
// The pure parts
// ---------------------------------------------------------------------------------------------

describe('undoChange', () => {
  it('puts back a leaf the change made, and only that leaf', () => {
    const before = { charms: [{ sold: false }, { sold: false }], rerolls: 0 };
    const after = { charms: [{ sold: true }, { sold: false }], rerolls: 0 };
    const current = { charms: [{ sold: true }, { sold: true }], rerolls: 3 };
    expect(undoChange(before, after, current)).toEqual({
      charms: [{ sold: false }, { sold: true }],
      rerolls: 3,
    });
  });

  it('puts back a whole value only if nothing has touched it since', () => {
    expect(undoChange({ a: 1 }, { a: 2 }, { a: 2 })).toEqual({ a: 1 });
    expect(undoChange(null, 'pledge', 'pledge')).toBeNull();
    expect(undoChange(null, 'pledge', 'charm')).toBe('charm');
    expect(undoChange('x', 'y', null)).toBeNull();
  });

  it('removes what the change appended to a list, wherever it now is', () => {
    expect(undoChange(['a'], ['a', 'b'], ['a', 'b'])).toEqual(['a']);
    expect(undoChange(['a'], ['a', 'b'], ['a', 'c', 'b', 'd'])).toEqual(['a', 'c', 'd']);
    // Gone already: nothing to remove.
    expect(undoChange(['a'], ['a', 'b'], ['a'])).toEqual(['a']);
    // A list that changed in some other way stays as it is.
    expect(undoChange(['a', 'b'], ['b', 'a'], ['x'])).toEqual(['x']);
  });

  it('drops a key the change added and restores one it removed', () => {
    expect(undoChange({ a: 1 }, { a: 1, b: 2 }, { a: 1, b: 2, c: 3 })).toEqual({ a: 1, c: 3 });
    expect(undoChange({ a: 1, b: 2 }, { a: 1 }, { a: 1, c: 3 })).toEqual({ a: 1, b: 2, c: 3 });
  });
});

describe('week locks', () => {
  const lock = (at: number, before: object, after: object): PendingLock =>
    ({ at, before, after }) as PendingLock;
  const base = (): WeekItem => ({
    run: {
      weekKey: WEEK,
      act: 'raid',
      clearedActs: ['scout'],
      weeklyXp: 0,
      targets: { scout: 1, raid: 2, boss: 3 },
      mogul: 'two-pizza-boss',
      hand: [],
      played: [],
      shopSeed: 1,
      shop: null,
    },
    version: 4,
    requestIds: ['old'],
    pending: {},
    merges: 0,
    reviews: 0,
    freePack: null,
    legendary: null,
  });

  it('applyFields writes the fields a patch names, null removing one', () => {
    const next = applyFields(base(), {
      freePack: 'pledge',
      act: null,
      played: [],
      legendary: null,
    });
    expect(next.freePack).toBe('pledge');
    expect(next.run.act).toBeNull();
    expect(base().freePack).toBeNull();
    expect(applyFields(next, { freePack: null }).freePack).toBeNull();
  });

  it('undoPatch is empty when the change is already gone, and names only fields that differ', () => {
    const item = { ...base(), freePack: 'pledge' as const };
    expect(undoPatch(item, lock(1, { freePack: null }, { freePack: 'pledge' }))).toEqual({
      freePack: null,
    });
    expect(undoPatch(base(), lock(1, { freePack: null }, { freePack: 'pledge' }))).toEqual({});
  });

  it('settles each lock by what the profile and the clock say, oldest change taken back last', () => {
    const item: WeekItem = {
      ...base(),
      freePack: 'pledge',
      pending: {
        done: lock(100, {}, {}),
        stale: lock(200, { freePack: null }, { freePack: 'pledge' }),
        live: lock(1000, {}, {}),
      },
    };
    const patch = settleLocks(item, (id, held) =>
      id === 'done' ? 'promote' : held.at < 500 ? 'undo' : 'keep',
    );
    expect(patch).toEqual({
      freePack: null,
      requestIds: ['old', 'done'],
      pending: { live: lock(1000, {}, {}) },
    });
    expect(settleLocks(item, () => 'keep')).toBeNull();
    expect(settleLocks(base(), () => 'promote')).toBeNull();
  });

  it('recordPatch adds the id once and drops its lock; unlockPatch only touches a held lock', () => {
    const item: WeekItem = { ...base(), pending: { x: lock(1, {}, {}) } };
    expect(recordPatch(item, 'x')).toEqual({ requestIds: ['old', 'x'], pending: {} });
    expect(recordPatch({ ...item, requestIds: ['old', 'x'], pending: {} }, 'x')).toBeNull();
    expect(
      recordPatch({ ...item, requestIds: ['x'], pending: { x: lock(1, {}, {}) } }, 'x'),
    ).toEqual({
      requestIds: ['x'],
      pending: {},
    });
    const many = {
      ...base(),
      requestIds: Array.from({ length: MAX_REQUEST_IDS }, (_, i) => `r${i}`),
    };
    expect(recordPatch(many, 'new')?.requestIds).toHaveLength(MAX_REQUEST_IDS);
    expect(unlockPatch(base(), 'nobody')).toBeNull();
    expect(unlockPatch(item, 'x')).toMatchObject({ pending: {} });
  });
});
