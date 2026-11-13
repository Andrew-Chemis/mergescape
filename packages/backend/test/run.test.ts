/**
 * Tasks 15 and 16 end to end: a full week of fixture events through the ingest Lambda, the shop and Pledge
 * endpoints on the api Lambda, and the Monday rollover, all over one in-memory table with an injected
 * clock. The ingest and api Lambdas each run under their own IAM role (the fake refuses what the role
 * lacks), so this also proves the new code uses only the operations Requirement 12.2 grants.
 */
import { interestOn, levelFor, startRun, zoneFor } from '@mergescape/shared';
import { DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { describe, expect, it } from 'vitest';
import type { LogResponse, MeResponse, MutationResponse, WeekSummary } from '../src/api-types';
import { toPlayerState } from '../src/player';
import { ensureRun, loadCurrent } from '../src/runs';
import { API_ROLE, DAY, HOUR, makeGame, playLife } from './game-harness';
import type { Game } from './game-harness';
import { INGEST_ROLE, START } from './harness';
import { auditSchema, itemsWithPrefix, TABLE_NAME } from './support';
import { AUTHOR_ID, fixtureDelivery, REVIEWER_ID } from './webhooks';

const MONDAY_NEXT = Date.UTC(2026, 10, 16, 0, 5, 0);

async function me(game: Game, id = AUTHOR_ID): Promise<MeResponse> {
  return (await game.get('/me', id)).body as unknown as MeResponse;
}

async function week(game: Game, id = AUTHOR_ID): Promise<WeekSummary> {
  return (await game.get('/week', id)).body as unknown as WeekSummary;
}

async function log(game: Game, id = AUTHOR_ID): Promise<LogResponse['entries']> {
  return ((await game.get('/log', id)).body as unknown as LogResponse).entries;
}

function renumber(number: number) {
  return (payload: Record<string, unknown>): void => {
    if (typeof payload.number === 'number') {
      payload.number = number;
    }
    (payload.pull_request as Record<string, unknown>).number = number;
  };
}

/** Deliver one fixture for PR `number` and report what it did to the author. */
async function step(game: Game, fixture: string, number: number) {
  const before = { me: await me(game), rows: (await log(game)).length };
  const result = await game.deliver(fixtureDelivery(fixture, renumber(number)));
  expect(result.statusCode).toBe(200);
  const after = { me: await me(game), entries: await log(game) };
  const row = after.entries.length > before.rows ? after.entries[0] : undefined;
  return { before: before.me, after: after.me, row };
}

describe('a week of events', () => {
  it('clears the acts in order, pays gold and interest, opens the shop and awards Renown', async () => {
    const g = makeGame();
    await g.signIn(AUTHOR_ID);
    await g.signIn(REVIEWER_ID);

    // Monday 12:00. A player with no run yet gets one on the spot.
    const first = await week(g);
    expect(first).toMatchObject({
      weekKey: '2026-W46',
      act: 'scout',
      clearedActs: [],
      weeklyXp: 0,
      targets: { scout: 1200, raid: 2000, boss: 3000 },
      mogul: 'two-pizza-boss',
      nextMogul: null,
      pledgeWindowOpen: true,
      pledgeProgress: {},
      shop: null,
      freePack: null,
      legendaryOffer: null,
    });
    expect(first.hand.map((pledge) => pledge.id)).toEqual([
      'tidy',
      'big-game-hunter',
      'strike',
      'mentor',
      'defend',
    ]);
    expect(
      (await g.post('/pledges/play', { requestId: 'play-strike-0001', pledgeId: 'strike' })).status,
    ).toBe(200);

    // The first PR: 90 XP to open it (a daily-first bonus included) and 703 to merge it.
    let result = await step(g, 'pull_request.opened', 17);
    expect(result.row).toMatchObject({ kind: 'pr_opened', points: 30, xp: 90 });
    await step(g, 'pull_request_review.approved', 17);
    await step(g, 'pull_request_review_comment.created', 17);
    result = await step(g, 'pull_request.closed.merged', 17);
    expect(result.row).toMatchObject({ kind: 'pr_merged', points: 232, xp: 703 });
    expect(result.after).toMatchObject({ xp: 793, gold: 26 });
    expect((await week(g)).weeklyXp).toBe(793);
    expect((await week(g)).act).toBe('scout');
    expect((await week(g)).shop).toBeNull();

    // The second PR crosses the Scout target of 1,200 on its merge: Act I clears.
    result = await step(g, 'pull_request.opened', 31);
    expect(result.after.week?.act).toBe('scout');
    await step(g, 'pull_request_review.approved', 31);
    const beforeClear = (await me(g)).gold;
    result = await step(g, 'pull_request.closed.merged', 31);
    const mergeGold = Math.floor((result.row?.points ?? 0) / 10);
    const interest = interestOn(beforeClear + mergeGold);
    expect(interest).toBeGreaterThan(0);
    // Gold: the merge's points, interest on what was held, and the Scout payout of 20.
    expect(result.after.gold).toBe(beforeClear + mergeGold + interest + 20);
    const cleared = result.after.week;
    expect(cleared).toMatchObject({ act: 'raid', clearedActs: ['scout'] });
    expect(cleared?.weeklyXp).toBeGreaterThanOrEqual(1200);

    // The shop is open with a visit's stock: 2 Charms, 2 packs, 1 Voucher.
    expect(cleared?.shop).toMatchObject({
      visit: 1,
      rerollCost: 20,
      shrineCost: 50,
      sellPrices: {},
      interestPreview: interestOn(result.after.gold),
    });
    expect(cleared?.shop?.charms).toHaveLength(2);
    expect(cleared?.shop?.packs).toHaveLength(2);
    expect(cleared?.shop?.voucher).not.toBeNull();
    expect(cleared?.freePack).toBeNull();

    // Buy a Charm; replaying the same request id changes nothing and answers the same.
    const goldBefore = result.after.gold;
    const charm = cleared?.shop?.charms[0];
    const buy = { requestId: 'buy-charm-000001', kind: 'charm', index: 0 };
    const bought = await g.post('/shop/buy', buy);
    expect(bought.status).toBe(200);
    const boughtMe = (bought.body as unknown as MutationResponse).me;
    expect(boughtMe.gold).toBe(goldBefore - (charm?.price ?? 0));
    expect(boughtMe.charms.map((held) => held.id)).toEqual([charm?.charm.id]);
    expect((bought.body as unknown as MutationResponse).week.shop?.charms[0]?.sold).toBe(true);
    const replay = await g.post('/shop/buy', buy);
    expect(replay.status).toBe(200);
    expect(replay.body).toEqual(bought.body);
    expect((await me(g)).gold).toBe(goldBefore - (charm?.price ?? 0));

    // Spending more than is held is a 409 and changes nothing.
    const voucher = cleared?.shop?.voucher;
    expect(voucher?.price).toBeGreaterThan(boughtMe.gold);
    const broke = await g.post('/shop/buy', { requestId: 'buy-voucher-0001', kind: 'voucher' });
    expect(broke).toEqual({ status: 409, body: { error: 'insufficient_gold' } });
    expect((await me(g)).gold).toBe(boughtMe.gold);

    // Wednesday: the unplayed hand auto-plays after Tuesday, and the third merge completes Strike.
    g.clock.now = START + 2 * DAY;
    const wed = await week(g);
    expect(wed.pledgeWindowOpen).toBe(false);
    expect(wed.played.map((pledge) => pledge.id)).toEqual(['strike', 'tidy', 'big-game-hunter']);
    expect(wed.pledgeProgress.strike).toEqual({ progress: 2, target: 3, completed: false });
    expect(
      (await g.post('/pledges/play', { requestId: 'play-late-000001', pledgeId: 'mentor' })).body,
    ).toEqual({ error: 'window_closed' });

    // Opening the next PR crosses the Raid target of 2,000: Act II clears, paying interest and 40, and
    // the free Pledge pack arrives.
    const payout = (r: Awaited<ReturnType<typeof step>>, clearGold: number): number => {
      const eventGold = Math.floor((r.row?.points ?? 0) / 10);
      return r.before.gold + eventGold + interestOn(r.before.gold + eventGold) + clearGold;
    };
    result = await step(g, 'pull_request.opened', 32);
    expect(result.after.gold).toBe(payout(result, 40));
    expect(result.after.week).toMatchObject({ act: 'boss', clearedActs: ['scout', 'raid'] });
    expect(result.after.week?.shop?.visit).toBe(2);
    expect(result.after.week?.freePack).toBe('pledge');
    expect(result.after.week?.freePackOptions).toHaveLength(3);

    // Take the free pack: one of its 3 Pledges joins the deck.
    const pickFree = await g.post('/shop/pick', {
      requestId: 'pick-free-000001',
      index: -1,
      option: 0,
    });
    expect(pickFree.status).toBe(200);
    const afterPick = pickFree.body as unknown as MutationResponse;
    expect(afterPick.week.freePack).toBeNull();
    expect(afterPick.me.deck).toHaveLength(6);

    // The merge completes Strike (the third merge since it was played) and, on a weekly XP of 3,000, the
    // Boss act: 100 gold, Renown +1, and the run is over with the shop still open.
    await step(g, 'pull_request_review.approved', 32);
    result = await step(g, 'pull_request.closed.merged', 32);
    expect(result.row?.breakdown.some((line) => line.label === 'Pledge: Strike')).toBe(true);
    expect(result.after.week?.pledgeProgress.strike).toEqual({
      progress: 3,
      target: 3,
      completed: true,
    });
    expect(result.after.gold).toBe(payout(result, 100));
    expect(result.after).toMatchObject({ renown: 1, biome: 'Town' });
    expect(result.after.week).toMatchObject({ act: null, clearedActs: ['scout', 'raid', 'boss'] });
    expect(result.after.week?.shop?.visit).toBe(3);
    // A Legendary Charm is offered on every 4th Renown, not the first.
    expect(result.after.week?.legendaryOffer).toBeNull();

    // Friday, in the Boss window: the Mogul's modifier applies and its kill is recorded in the Bestiary.
    g.clock.now = START + 4 * DAY;
    await step(g, 'pull_request.opened', 33);
    await step(g, 'pull_request_review.approved', 33);
    result = await step(g, 'pull_request.closed.merged', 33);
    expect(result.row?.monster).toBe('two-pizza-boss');
    expect(
      result.row?.breakdown.some((line) => line.label.includes('The Two-Pizza Boss: party bonus')),
    ).toBe(true);
    expect(result.after.kills['two-pizza-boss']).toBe(1);
    expect(result.after.firstSeen['two-pizza-boss']).toBe(
      new Date(result.row ? Date.parse(result.row.at) : 0).toISOString(),
    );
    expect(result.after.kills['merge-goblin']).toBeGreaterThan(0);
    // Nothing clears twice: Renown stays 1 and the three acts stay cleared.
    expect(result.after.renown).toBe(1);
    expect(result.after.week?.clearedActs).toEqual(['scout', 'raid', 'boss']);

    // The Combat Log explains the XP, and every stored item stays inside the schema.
    const rows = await log(g);
    expect(rows.every((row) => row.xp > 0)).toBe(true);
    expect(result.after.xp).toBe(rows.reduce((sum, row) => sum + row.xp, 0));
    auditSchema(g.fake);

    // Each Lambda stayed inside its role: only the api scanned, and only the GSI.
    const scans = g.fake.calls.filter((call) => call.operation === 'Scan');
    expect(scans).toHaveLength(0);
    for (const call of g.fake.calls) {
      if (call.role === 'ingest') {
        expect(INGEST_ROLE).toContain(call.operation);
      } else {
        expect(API_ROLE).toContain(call.operation);
      }
    }
  });
});

describe('the Monday rollover', () => {
  async function playedWeek(): Promise<Game> {
    const g = makeGame();
    await g.signIn(AUTHOR_ID);
    await g.signIn(REVIEWER_ID);
    await playLife(g, 17);
    return g;
  }

  it('creates next week once: a new run, targets from the history, the streak and a Vocation', async () => {
    const g = await playedWeek();
    const lastWeek = await week(g);
    const before = await me(g);
    // Vocation changes at the rollover, not mid-week.
    expect(before.vocation).toBe('Journeyman');
    g.seeds.push(7);

    g.clock.now = MONDAY_NEXT;
    const result = await g.rollover();
    expect(result).toEqual({ statusCode: 200, processed: 2 });

    const next = await week(g);
    expect(next).toMatchObject({
      weekKey: '2026-W47',
      act: 'scout',
      clearedActs: [],
      weeklyXp: 0,
      shop: null,
      // The bag was shuffled when the first run started: next week's Mogul was its head.
      mogul: 'rocket-man',
      pledgeWindowOpen: true,
    });
    // One closed week is not three, so the flat 2,000 base applies, but no target may exceed twice last
    // week's 793 XP.
    expect(lastWeek.weeklyXp).toBe(793);
    expect(next.targets).toEqual({ scout: 1200, raid: 1586, boss: 1586 });
    expect(next.hand).toHaveLength(5);

    // Last week had a merge, so the streak scored: 50 points x Power 1 x Zone for the level.
    const after = await me(g);
    const level = levelFor(before.xp);
    const streakXp = Math.floor(50 * zoneFor(level, 1.6));
    expect(after.xp).toBe(before.xp + streakXp);
    expect(after.skillXp.endurance).toBe(before.skillXp.endurance + streakXp);
    // 733 of the 793 XP earned was Smithing (92%), so the closed week makes them a Smith.
    expect(after.vocation).toBe('Smith');
    expect(after.gold).toBe(before.gold + 5);
    const streakRow = (await log(g))[0];
    expect(streakRow).toMatchObject({ kind: 'weekly_streak', points: 50, xp: streakXp });
    expect(streakRow?.repoId).toBeUndefined();
    expect((await g.db.getProfile(AUTHOR_ID, true))?.streakWeeks).toBe(1);
    expect((await g.db.getProfile(AUTHOR_ID, true))?.history).toEqual([lastWeek.weeklyXp]);

    // The reviewer scored reviews and a verified kill but never merged: three scoring events do not make
    // three reviews, so their streak is not credited.
    expect((await g.db.getProfile(REVIEWER_ID, true))?.streakWeeks).toBe(0);
    auditSchema(g.fake);
  });

  it('is idempotent: running it again, or racing it with an event, starts nothing twice', async () => {
    const g = await playedWeek();
    g.clock.now = MONDAY_NEXT;
    g.seeds.push(11);
    await g.rollover();
    const items = () =>
      itemsWithPrefix(g.fake, `USER#${AUTHOR_ID}`).filter((item) =>
        String(item.SK).startsWith('WEEK#'),
      );
    expect(items().map((item) => item.SK)).toEqual(['WEEK#2026-46', 'WEEK#2026-47']);
    const run = items()[1];
    const profile = await g.db.getProfile(AUTHOR_ID, true);

    g.seeds.push(99);
    await g.rollover();
    await Promise.all([g.rollover(), g.rollover()]);
    expect(items()[1]).toEqual(run);
    expect(await g.db.getProfile(AUTHOR_ID, true)).toEqual(profile);
    expect(run?.shop_seed).toBe(11);
    // One streak row, whatever the retries.
    expect((await log(g)).filter((row) => row.kind === 'weekly_streak')).toHaveLength(1);
  });

  it('finishes a rollover that crashed after creating the week, with the same seed', async () => {
    const g = await playedWeek();
    g.clock.now = MONDAY_NEXT;
    const profile = await g.db.getProfile(AUTHOR_ID, true);
    // The crash: the new week item exists (seed 21) but the profile was never moved on.
    const started = startRun({
      player: toPlayerState(profile as NonNullable<typeof profile>),
      now: MONDAY_NEXT,
      seed: 21,
      history: [],
    });
    await g.db.createWeek(AUTHOR_ID, started.run);
    g.seeds.push(55);
    await g.rollover();

    const done = await g.db.getProfile(AUTHOR_ID, true);
    expect(done?.runWeek).toBe('2026-47');
    expect((await g.db.getWeekItem(AUTHOR_ID, '2026-47'))?.run.shopSeed).toBe(21);
    // The same plan as the one that made the week: the Mogul bag moved on exactly once.
    expect(done?.mogulBag).toEqual(started.player.moguls.bag);
    expect(done?.streakWeeks).toBe(1);
  });

  it('breaks the streak after a week with no activity and pads skipped weeks with zero', async () => {
    const g = await playedWeek();
    g.clock.now = MONDAY_NEXT;
    await g.rollover();
    // A quiet week: nothing scored, so the next rollover breaks the streak.
    g.clock.now = MONDAY_NEXT + 7 * DAY;
    await g.rollover();
    expect((await g.db.getProfile(AUTHOR_ID, true))?.streakWeeks).toBe(0);
    // Then two weeks pass with no rollover at all: the player's next request starts the run lazily.
    g.clock.now = MONDAY_NEXT + 21 * DAY + 3 * HOUR;
    const lazy = await week(g);
    expect(lazy.weekKey).toBe('2026-W50');
    const profile = await g.db.getProfile(AUTHOR_ID, true);
    // 793 from week 46, then weeks 47, 48 and 49 with nothing in them.
    expect(profile?.history).toEqual([793, 0, 0, 0]);
  });

  it('starts the new week with Pledge progress, the played hand and Loaded Dice reset', async () => {
    const g = makeGame();
    await g.signIn(AUTHOR_ID);
    await g.signIn(REVIEWER_ID);
    await g.post('/pledges/play', { requestId: 'play-strike-0002', pledgeId: 'strike' });
    await playLife(g, 17);
    const old = await week(g);
    expect(old.pledgeProgress.strike?.progress).toBe(1);
    // The week-scoped scorer state sits on the profile, stamped with the week it belongs to.
    expect((await g.db.getProfile(AUTHOR_ID, true))?.weekState?.week).toBe('2026-46');

    g.clock.now = MONDAY_NEXT;
    await g.rollover();
    const next = await week(g);
    expect(next.played).toEqual([]);
    expect(next.pledgeProgress).toEqual({});

    // Play it again and merge once: progress counts from zero, not from last week's one.
    await g.post('/pledges/play', { requestId: 'play-strike-0003', pledgeId: 'strike' });
    await playLife(g, 40);
    expect((await week(g)).pledgeProgress.strike).toEqual({
      progress: 1,
      target: 3,
      completed: false,
    });
  });

  it('sets targets from the 8-week median, never above twice the previous week', async () => {
    const g = makeGame();
    await g.signIn(AUTHOR_ID);
    await g.signIn(REVIEWER_ID);
    const history = [3000, 4000, 5000, 3500];
    for (const [id, thisWeek] of [
      [AUTHOR_ID, 3600],
      [REVIEWER_ID, 800],
    ] as const) {
      await week(g, id);
      const profile = await g.db.getProfile(id, true);
      await g.db.saveProfile(id, profile?.version ?? 0, { history });
      await g.db.addWeekCredit(id, '2026-46', { xp: thisWeek, merge: false, review: false });
    }
    g.clock.now = MONDAY_NEXT;
    await g.rollover();

    // Median of 3000, 4000, 5000, 3500, 3600 is 3600: 60%, 100%, 150%.
    expect((await week(g, AUTHOR_ID)).targets).toEqual({ scout: 2160, raid: 3600, boss: 5400 });
    // A quiet week of 800 XP caps every target at 1,600 (a vacation does not wreck the next week).
    expect((await week(g, REVIEWER_ID)).targets).toEqual({ scout: 1600, raid: 1600, boss: 1600 });
    expect((await g.db.getProfile(AUTHOR_ID, true))?.history).toEqual([...history, 3600]);
  });
});

describe('a request whose clock is just behind the rollover', () => {
  const LAST_SECOND = MONDAY_NEXT - 6 * 60_000;

  async function playedWeek(): Promise<Game> {
    const g = makeGame();
    await g.signIn(AUTHOR_ID);
    await g.signIn(REVIEWER_ID);
    await playLife(g, 17);
    return g;
  }

  const context = (g: Game, now: number) => ({ db: g.db, now, newSeed: () => 99 });

  it('never rolls a profile that is already in the next week back, so the streak is not paid twice', async () => {
    const g = await playedWeek();
    g.clock.now = MONDAY_NEXT;
    await g.rollover();
    const profile = await g.db.getProfile(AUTHOR_ID, true);
    const rows = (await log(g)).length;
    const writes = g.fake.writeCalls;
    expect(profile).toMatchObject({ runWeek: '2026-47', streakWeeks: 1 });

    // A request that read its clock at 23:59 Sunday arrives after the rollover.
    const rolled = await ensureRun(context(g, LAST_SECOND), AUTHOR_ID);
    expect(rolled?.week.run.weekKey).toBe('2026-47');
    expect(rolled?.profile).toEqual(profile);
    const current = await loadCurrent(context(g, LAST_SECOND), AUTHOR_ID);
    expect(current?.run.weekKey).toBe('2026-47');

    // Nothing was written: no second streak, no second XP, no row.
    expect(g.fake.writeCalls).toBe(writes);
    expect(await g.db.getProfile(AUTHOR_ID, true)).toEqual(profile);
    expect((await log(g)).length).toBe(rows);
    expect((await g.db.getProfile(AUTHOR_ID, true))?.history).toEqual([793]);
  });

  it('builds a week that is missing for a profile that is ahead of its clock, for the week the profile is in', async () => {
    const g = await playedWeek();
    g.clock.now = MONDAY_NEXT;
    await g.rollover();
    const profile = await g.db.getProfile(AUTHOR_ID, true);
    // The profile is in 2026-47 but its week item is gone.
    await g.fake.forRole('test', ['DeleteItem']).send(
      new DeleteCommand({
        TableName: TABLE_NAME,
        Key: { PK: `USER#${AUTHOR_ID}`, SK: 'WEEK#2026-47' },
      }),
    );
    expect(await g.db.getWeekItem(AUTHOR_ID, '2026-47')).toBeNull();

    const served = await ensureRun(context(g, LAST_SECOND), AUTHOR_ID);
    expect(served?.week.run.weekKey).toBe('2026-47');
    expect(served?.week.run.shopSeed).toBe(99);
    // The profile is untouched: it was already rolled, only its week item was made again.
    expect(await g.db.getProfile(AUTHOR_ID, true)).toEqual(profile);
    expect((await g.db.getWeekItem(AUTHOR_ID, '2026-47'))?.run.weekKey).toBe('2026-47');
  });

  it('reads the profile first and the week after it, one after the other', async () => {
    const g = await playedWeek();
    const events: string[] = [];
    const watched = Object.create(g.db) as typeof g.db;
    for (const name of ['getProfile', 'getWeekItem'] as const) {
      const original = g.db[name].bind(g.db) as (...args: unknown[]) => Promise<unknown>;
      (watched as unknown as Record<string, unknown>)[name] = async (...args: unknown[]) => {
        events.push(`${name} start`);
        const found = await original(...args);
        events.push(`${name} end`);
        return found;
      };
    }
    await ensureRun({ db: watched, now: g.clock.now, newSeed: () => 1 }, AUTHOR_ID);
    expect(events.slice(0, 4)).toEqual([
      'getProfile start',
      'getProfile end',
      'getWeekItem start',
      'getWeekItem end',
    ]);
  });
});

describe('the Act clears paid in a week', () => {
  it('are forgotten at the rollover, so next week can pay its own', async () => {
    const g = makeGame();
    await g.signIn(AUTHOR_ID);
    await g.signIn(REVIEWER_ID);
    await playLife(g, 17);
    await playLife(g, 31);
    // The Scout act was cleared and paid.
    expect((await g.db.getProfile(AUTHOR_ID, true))?.actsPaid).toEqual(['2026-46:scout']);
    g.clock.now = MONDAY_NEXT;
    await g.rollover();
    expect((await g.db.getProfile(AUTHOR_ID, true))?.actsPaid).toEqual([]);
    auditSchema(g.fake);
  });
});
