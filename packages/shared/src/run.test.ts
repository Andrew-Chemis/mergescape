import { describe, expect, it } from 'vitest';
import { applyFounderBoard } from './moguls';
import {
  addWeeklyXp,
  actTargets,
  biomeFor,
  clearAct,
  isoWeekKey,
  median,
  playerWithRun,
  runWithPlayer,
  startRun,
} from './run';
import { score } from './score';
import { buyCharm, buyPack, generateStock, packOptions, pickPackOption } from './shop';
import { applyScoreResult, createPlayerState, createPRState } from './state';
import { charmDefinition, makeCharm } from './charms';
import { D2_XP } from './d2table';
import { goldForPoints } from './economy';
import {
  AUTHOR_ID,
  held,
  makeRun,
  mergedEvent,
  mergedFacts,
  prStateFor,
  REVIEWER_ID,
  settledPlayer,
} from './test-builders';
import { ACT_IDS, BIOMES } from './constants';
import type { MogulId, PlayerState, RunState, ShopStock } from './types';

const at = (iso: string) => Date.parse(iso);

describe('isoWeekKey (Requirement 6.1: ISO week, UTC, Monday start)', () => {
  it.each([
    ['2026-11-09T00:00:00Z', '2026-46'],
    ['2026-11-09T12:00:00Z', '2026-46'],
    ['2026-11-15T23:59:59Z', '2026-46'],
    ['2026-11-16T00:00:00Z', '2026-47'],
    ['2026-11-08T23:59:59Z', '2026-45'],
    ['2026-01-01T00:00:00Z', '2026-01'],
    ['2025-12-29T00:00:00Z', '2026-01'],
    ['2024-12-30T00:00:00Z', '2025-01'],
    ['2021-01-03T00:00:00Z', '2020-53'],
    ['2026-12-31T00:00:00Z', '2026-53'],
    ['2027-01-03T23:59:59Z', '2026-53'],
    ['2027-01-04T00:00:00Z', '2027-01'],
    ['2028-02-29T10:00:00Z', '2028-09'],
  ])('%s is %s', (iso, key) => {
    expect(isoWeekKey(at(iso))).toBe(key);
  });
});

describe('median', () => {
  it('handles empty, odd, even and unsorted lists', () => {
    expect(median([])).toBe(0);
    expect(median([5])).toBe(5);
    expect(median([9, 1, 5])).toBe(5);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
});

describe('act targets (Requirement 6.2 to 6.4)', () => {
  const targets = (history: number[]) => Object.values(actTargets(history));

  it('a new player has a flat 2,000: 1,200 / 2,000 / 3,000', () => {
    expect(actTargets([])).toEqual({ scout: 1200, raid: 2000, boss: 3000 });
  });

  it('under 3 weeks of history is still flat (and still capped by 2x last week)', () => {
    expect(targets([100000, 100000])).toEqual([1200, 2000, 3000]);
    expect(targets([300])).toEqual([600, 600, 600]);
    expect(targets([800])).toEqual([1200, 1600, 1600]);
  });

  it('from 3 weeks on it is 60 / 100 / 150% of the median', () => {
    expect(targets([500, 1000, 1500])).toEqual([600, 1000, 1500]);
    expect(targets([2000, 2000, 2000])).toEqual([1200, 2000, 3000]);
  });

  it('uses only the last 8 weeks', () => {
    const history = [1_000_000, 1_000_000, 1_000_000, 100, 200, 300, 400, 500, 600, 700, 800];
    expect(median(history.slice(-8))).toBe(450);
    expect(targets(history)).toEqual([270, 450, 675]);
  });

  it('rounds each target', () => {
    expect(targets([1001, 1001, 1001])).toEqual([601, 1001, 1502]);
  });

  it('never exceeds 2x last week: a vacation week eases the next run', () => {
    const quiet = [...Array(7).fill(2000), 100];
    expect(median(quiet.slice(-8))).toBe(2000);
    expect(targets(quiet)).toEqual([200, 200, 200]);
    const lull = [2000, 2000, 2000, 2000, 2000, 2000, 2000, 700];
    expect(targets(lull)).toEqual([1200, 1400, 1400]);
  });

  it('a big last week does not lift the ceiling above the median-based target', () => {
    expect(targets([100, 100, 100, 5000])).toEqual([60, 100, 150]);
  });

  it('a last week of exactly 0 carries no cap, and an idle median falls back to the flat base', () => {
    expect(targets([2000, 2000, 2000, 0])).toEqual([1200, 2000, 3000]);
    expect(targets([0, 0, 0, 0])).toEqual([1200, 2000, 3000]);
  });
});

describe('Renown and biome (Requirement 6.8)', () => {
  it('changes every 8 Renown in the order Town, Sewers of Legacy, Flaky Marsh, Dependency Mines, Release Peaks, The Rebase Abyss', () => {
    expect([0, 7, 8, 15, 16, 24, 32, 39, 40, 41].map(biomeFor)).toEqual([
      BIOMES[0],
      BIOMES[0],
      BIOMES[1],
      BIOMES[1],
      BIOMES[2],
      BIOMES[3],
      BIOMES[4],
      BIOMES[4],
      BIOMES[5],
      BIOMES[5],
    ]);
    expect(biomeFor(10_000)).toBe('The Rebase Abyss');
  });
});

describe('startRun (Requirement 6.1)', () => {
  const player = createPlayerState(AUTHOR_ID);
  const monday = at('2026-11-09T00:05:00Z');

  it('creates the week: key, Scout act, targets, a Mogul, a hand of 5, the seed, a closed shop', () => {
    const { run } = startRun({ player, now: monday, seed: 4242, history: [] });
    expect(run).toMatchObject({
      weekKey: '2026-46',
      act: 'scout',
      clearedActs: [],
      weeklyXp: 0,
      targets: { scout: 1200, raid: 2000, boss: 3000 },
      played: [],
      shopSeed: 4242,
      shop: null,
      mogulChain: 0,
      pledgeProgress: {},
      pledgesCompleted: [],
      loadedDiceUsed: false,
    });
    expect(run.hand).toHaveLength(5);
    expect(run.hand.map((card) => card.id).sort()).toEqual(
      ['big-game-hunter', 'defend', 'mentor', 'strike', 'tidy'].sort(),
    );
    expect([
      'rocket-man',
      'leather-jacket',
      'turtleneck',
      'hoodie',
      'founder',
      'two-pizza-boss',
    ]).toContain(run.mogul);
  });

  it('gives the player the Mogul, the rest of the bag, and an empty week', () => {
    const dirty: PlayerState = {
      ...player,
      week: { loadedDiceUsed: true },
      pledges: { played: [], progress: { strike: 2 }, completed: ['strike'] },
      moguls: { ...player.moguls, chain: 9 },
    };
    const result = startRun({ player: dirty, now: monday, seed: 4242, history: [] });
    expect(result.player.moguls.current).toBe(result.run.mogul);
    expect(result.player.moguls.bag).toHaveLength(5);
    expect(result.player.moguls.bag).not.toContain(result.run.mogul);
    expect(result.player.moguls.chain).toBe(0);
    expect(result.player.pledges).toEqual({ played: [], progress: {}, completed: [] });
    expect(result.player.week.loadedDiceUsed).toBe(false);
    expect(dirty.moguls.chain).toBe(9);
  });

  it('is deterministic in the seed, so a retried rollover creates the same run', () => {
    const a = startRun({ player, now: monday, seed: 77, history: [1000, 2000, 3000] });
    const b = startRun({ player, now: monday, seed: 77, history: [1000, 2000, 3000] });
    expect(b).toEqual(a);
    const other = startRun({ player, now: monday, seed: 78, history: [1000, 2000, 3000] });
    expect(other.run.shopSeed).toBe(78);
  });

  it('walks the whole Mogul bag across weeks: six weeks, six different Moguls', () => {
    let current = player;
    const drawn: MogulId[] = [];
    for (let week = 0; week < 6; week += 1) {
      const next = startRun({
        player: current,
        now: monday + week * 7 * 86_400_000,
        seed: 100 + week,
        history: [],
      });
      drawn.push(next.run.mogul);
      current = next.player;
    }
    expect(new Set(drawn).size).toBe(6);
  });

  it('draws a smaller hand from a smaller deck', () => {
    const small = { ...player, deck: player.deck.slice(0, 2) };
    expect(startRun({ player: small, now: monday, seed: 1, history: [] }).run.hand).toHaveLength(2);
  });

  it("returns a Charm last week's Board still held, and the old Founder does not act in the new week", () => {
    const stale: PlayerState = {
      ...player,
      charms: [held('lantern')],
      moguls: {
        ...player.moguls,
        current: 'founder',
        boardWeek: '2026-45',
        benched: { charm: held('hot-potato'), weekKey: '2026-45' },
      },
    };
    const result = startRun({
      player: stale,
      now: at('2026-11-11T00:05:00Z'),
      seed: 5,
      history: [],
    });
    expect(result.boardEvents.map((event) => event.kind)).toEqual(['returned']);
    expect(result.player.charms.map((entry) => entry.id)).toEqual(['lantern', 'hot-potato']);
    expect(result.player.moguls.benched).toBeNull();
  });
});

describe('carrying week state between the run item and the player', () => {
  it('playerWithRun reads the Mogul, chain, Pledges and dice from the run; absent fields are initial', () => {
    const player = createPlayerState(AUTHOR_ID);
    const run = makeRun({
      mogul: 'founder',
      played: [{ id: 'strike', name: 'Strike', upgraded: false }],
      mogulChain: 4,
      pledgeProgress: { strike: 2 },
      pledgesCompleted: ['tidy'],
      loadedDiceUsed: true,
    });
    const hydrated = playerWithRun(player, run);
    expect(hydrated.moguls).toMatchObject({ current: 'founder', chain: 4 });
    expect(hydrated.pledges).toEqual({
      played: run.played,
      progress: { strike: 2 },
      completed: ['tidy'],
    });
    expect(hydrated.week.loadedDiceUsed).toBe(true);
    const bare = playerWithRun(player, makeRun());
    expect(bare.moguls.chain).toBe(0);
    expect(bare.pledges).toEqual({ played: [], progress: {}, completed: [] });
    expect(bare.week.loadedDiceUsed).toBe(false);
  });

  it('runWithPlayer copies the scorer state back, and the two round-trip', () => {
    const run = makeRun({ mogul: 'hoodie', weeklyXp: 55 });
    const player = playerWithRun(createPlayerState(1), run);
    const moved: PlayerState = {
      ...player,
      moguls: { ...player.moguls, chain: 3 },
      pledges: { ...player.pledges, progress: { tidy: 1 }, completed: ['defend'] },
      week: { loadedDiceUsed: true },
    };
    const saved = runWithPlayer(run, moved);
    expect(saved).toMatchObject({
      weeklyXp: 55,
      mogulChain: 3,
      pledgeProgress: { tidy: 1 },
      pledgesCompleted: ['defend'],
      loadedDiceUsed: true,
    });
    expect(playerWithRun(createPlayerState(1), saved).week.loadedDiceUsed).toBe(true);
    expect(addWeeklyXp(saved, 45).weeklyXp).toBe(100);
  });
});

describe('clearing acts (Requirement 6.5 to 6.7)', () => {
  const player = (gold: number, overrides: Partial<PlayerState> = {}): PlayerState => ({
    ...settledPlayer(AUTHOR_ID),
    gold,
    ...overrides,
  });
  const at = (weeklyXp: number, overrides: Partial<RunState> = {}) =>
    makeRun({ weeklyXp, targets: { scout: 100, raid: 200, boss: 300 }, ...overrides });

  it('does nothing until weekly XP reaches the current act target', () => {
    expect(clearAct(at(99), player(0))).toBeNull();
    expect(clearAct(at(100), player(0))).not.toBeNull();
    expect(clearAct(at(10_000, { act: null }), player(0))).toBeNull();
  });

  it('Scout: pays interest on the gold held, then 20; opens visit 1 of the shop; the Raid is next', () => {
    const cleared = clearAct(at(100), player(100))!;
    expect(cleared.clear).toMatchObject({
      act: 'scout',
      next: 'raid',
      renown: 0,
      legendary: null,
      freePack: null,
    });
    expect(cleared.clear.entries.map((entry) => entry.delta)).toEqual([4, 20]);
    expect(cleared.player.gold).toBe(124);
    expect(cleared.run.act).toBe('raid');
    expect(cleared.run.clearedActs).toEqual(['scout']);
    expect(cleared.run.shop).not.toBeNull();
    expect(cleared.run.shop!.charms).toHaveLength(2);
    expect(cleared.player.renown).toBe(0);
  });

  it('Raid: pays 40, grants a free Pledge pack, and opens visit 2', () => {
    const cleared = clearAct(at(200, { act: 'raid', clearedActs: ['scout'] }), player(0))!;
    expect(cleared.clear).toMatchObject({ act: 'raid', next: 'boss', freePack: 'pledge' });
    expect(cleared.player.gold).toBe(40);
    expect(cleared.run.clearedActs).toEqual(['scout', 'raid']);
    expect(cleared.run.shop).not.toEqual(clearAct(at(100), player(0))!.run.shop);
  });

  it('Boss: pays 100, adds 1 Renown, ends the run, and leaves the shop open', () => {
    const cleared = clearAct(
      at(300, { act: 'boss', clearedActs: ['scout', 'raid'] }),
      player(0, { renown: 4 }),
    )!;
    expect(cleared.clear).toMatchObject({ act: 'boss', next: null, renown: 5, legendary: null });
    expect(cleared.player.gold).toBe(100);
    expect(cleared.player.renown).toBe(5);
    expect(cleared.run.act).toBeNull();
    expect(cleared.run.shop).not.toBeNull();
    expect(clearAct(cleared.run, cleared.player)).toBeNull();
  });

  it('offers a Legendary Charm on every 4th Renown point', () => {
    const boss = (renown: number) =>
      clearAct(at(300, { act: 'boss', clearedActs: ['scout', 'raid'] }), player(0, { renown }))!
        .clear;
    expect(boss(0).legendary).toBeNull();
    expect(boss(2).legendary).toBeNull();
    expect(boss(3).legendary?.rarity).toBe('legendary');
    expect(boss(4).legendary).toBeNull();
    expect(boss(7).legendary).not.toBeNull();
    expect(boss(11).legendary).not.toBeNull();
    expect(boss(3).legendary).toEqual(boss(3).legendary);
  });

  it('never skips an act: one clear per call, even when XP is past every target', () => {
    let run = at(10_000);
    let current = player(0);
    const order: string[] = [];
    for (let call = 0; call < 5; call += 1) {
      const next = clearAct(run, current);
      if (next === null) break;
      order.push(next.clear.act);
      run = next.run;
      current = next.player;
    }
    expect(order).toEqual(['scout', 'raid', 'boss']);
    expect(ACT_IDS).toEqual(['scout', 'raid', 'boss']);
    expect(current.renown).toBe(1);
  });

  it('pays x4 under the Founder, interest unchanged; Deep Pockets raises the interest cap', () => {
    const founder = clearAct(at(100, { mogul: 'founder' }), player(100))!;
    expect(founder.clear.entries.map((entry) => entry.delta)).toEqual([4, 80]);
    const pockets = clearAct(at(100), player(1000, { vouchers: ['deep-pockets'] }))!;
    expect(pockets.clear.entries[0]?.delta).toBe(20);
    const plain = clearAct(at(100), player(1000))!;
    expect(plain.clear.entries[0]?.delta).toBe(10);
  });

  it('a week that ends with an act uncleared costs nothing', () => {
    const run = at(150);
    const current = player(55);
    const cleared = clearAct(run, current)!;
    expect(cleared.run.act).toBe('raid');
    expect(clearAct(cleared.run, cleared.player)).toBeNull();
    expect(cleared.player.gold).toBeGreaterThanOrEqual(55);
  });

  it('the shop stays open after the clear, and what was in it never changes', () => {
    const cleared = clearAct(at(100), player(0))!;
    const again = clearAct(at(100), player(0))!;
    expect(again.run.shop).toEqual(cleared.run.shop);
    const bought = buyCharm({ ...cleared.player, gold: 1000 }, cleared.run, 0);
    expect(bought.ok).toBe(true);
  });

  describe('a pack bought but not yet picked from', () => {
    /** The Scout act cleared and pack 0 bought and opened; the player has not kept an option yet. */
    const withBoughtPack = () => {
      const scout = clearAct(at(100), player(1000))!;
      const bought = buyPack(scout.player, scout.run, 0);
      if (!bought.ok) throw new Error('expected the pack to be bought');
      return { scout, bought };
    };

    it('survives the next act clear: same slot, same 3 options, still pickable', () => {
      const { bought } = withBoughtPack();
      const raid = clearAct({ ...bought.run, weeklyXp: 200 }, bought.player)!;
      const carried = raid.run.shop!.packs[0]!;
      expect(carried).toMatchObject({ sold: true, picked: false, visit: 1 });
      expect(packOptions(raid.run, 0)).toEqual(bought.options);
      // The other shelf slot is the new visit's own stock, and so is everything else.
      const fresh = generateStock(raid.player, raid.run.shopSeed, 2);
      expect(raid.run.shop!.packs[1]).toEqual(fresh.packs[1]);
      expect(raid.run.shop!.charms).toEqual(fresh.charms);
      expect(raid.run.shop!.voucher).toEqual(fresh.voucher);
      const kept = pickPackOption(raid.player, raid.run, 0, 0);
      expect(kept.ok).toBe(true);
    });

    it('keeps surviving until it is picked, then the next clear stocks a fresh pack', () => {
      const { bought } = withBoughtPack();
      const raid = clearAct({ ...bought.run, weeklyXp: 200 }, bought.player)!;
      const boss = clearAct({ ...raid.run, weeklyXp: 300 }, raid.player)!;
      expect(boss.run.shop!.packs[0]).toMatchObject({ sold: true, picked: false, visit: 1 });
      expect(packOptions(boss.run, 0)).toEqual(bought.options);
      const kept = pickPackOption(boss.player, boss.run, 0, 1);
      if (!kept.ok) throw new Error('expected the pick to succeed');
      expect(kept.run.shop!.packs[0]!.picked).toBe(true);
    });

    it('is not carried once picked: the next visit stocks that slot again', () => {
      const { bought } = withBoughtPack();
      const picked = pickPackOption(bought.player, bought.run, 0, 0);
      if (!picked.ok) throw new Error('expected the pick to succeed');
      const raid = clearAct({ ...picked.run, weeklyXp: 200 }, picked.player)!;
      const fresh = generateStock(raid.player, raid.run.shopSeed, 2);
      expect(raid.run.shop!.packs).toEqual(fresh.packs);
    });

    it('an unbought pack is simply replaced', () => {
      const scout = clearAct(at(100), player(1000))!;
      const raid = clearAct({ ...scout.run, weeklyXp: 200 }, scout.player)!;
      expect(raid.run.shop!.packs).toEqual(generateStock(raid.player, raid.run.shopSeed, 2).packs);
    });
  });

  it('buying a third copy needs the gold up front: the refund does not pay for it', () => {
    const stock: ShopStock = {
      charms: [{ item: makeCharm(charmDefinition('hot-potato')!), price: 120, sold: false }],
      packs: [],
      voucher: null,
      rerolls: 0,
    };
    const run = at(100, { shop: stock, clearedActs: ['scout'] });
    const owner = player(100, { charms: [held('hot-potato', 2)] });
    expect(buyCharm(owner, run, 0)).toEqual({ ok: false, error: 'insufficient_gold' });
  });
});

describe('a week of events (Requirement 6: act transitions, gold and Renown)', () => {
  it('clears Scout, Raid and Boss in order as weekly XP crosses the targets, and pays what it should', () => {
    const start = { ...settledPlayer(AUTHOR_ID), xp: D2_XP[20]! };
    let { run, player } = startRun({
      player: start,
      now: Date.parse('2026-11-09T00:05:00Z'),
      seed: 31,
      history: [],
    });
    run = { ...run, targets: { scout: 400_000, raid: 900_000, boss: 1_500_000 } };
    let expectedGold = 0;
    const clears: { act: string; call: number }[] = [];
    for (let call = 1; call <= 40; call += 1) {
      const pr = mergedFacts({
        number: call,
        stats: { additions: 120, deletions: 30, changedFiles: 3, commits: 2 },
      });
      const state = prStateFor(pr, { reviews: [{ reviewerId: REVIEWER_ID, state: 'APPROVED' }] });
      const when = Date.parse('2026-11-09T12:00:00Z') + call * 3_600_000;
      const result = score(mergedEvent(pr), player, state, when);
      player = applyScoreResult(player, state, result).player;
      run = runWithPlayer(addWeeklyXp(run, result.xp), player);
      expectedGold += goldForPoints(result.points, result.goldMultiplier);
      const cleared = clearAct(run, player);
      if (cleared !== null) {
        clears.push({ act: cleared.clear.act, call });
        expectedGold += cleared.clear.entries.reduce((sum, entry) => sum + entry.delta, 0);
        run = cleared.run;
        player = cleared.player;
      }
    }
    expect(clears.map((entry) => entry.act)).toEqual(['scout', 'raid', 'boss']);
    expect(clears[0]!.call).toBeLessThan(clears[1]!.call);
    expect(clears[1]!.call).toBeLessThan(clears[2]!.call);
    expect(run.act).toBeNull();
    expect(player.renown).toBe(1);
    expect(player.gold).toBe(expectedGold);
    expect(run.clearedActs).toEqual(['scout', 'raid', 'boss']);
  });

  it('keeps the Founder Board honest across a run: gold x4 through the week and the Charm returns stronger', () => {
    let player: PlayerState = {
      ...settledPlayer(AUTHOR_ID),
      charms: [held('lantern')],
    };
    const started = startRun({
      player,
      now: Date.parse('2026-11-09T00:05:00Z'),
      seed: 3,
      history: [],
    });
    player = { ...started.player, moguls: { ...started.player.moguls, current: 'founder' } };
    const wednesday = applyFounderBoard(
      player,
      started.run.weekKey,
      Date.parse('2026-11-11T08:00:00Z'),
      3,
    );
    expect(wednesday.player.charms).toHaveLength(0);
    const friday = applyFounderBoard(
      wednesday.player,
      started.run.weekKey,
      Date.parse('2026-11-13T08:00:00Z'),
      3,
    );
    expect(friday.player.charms.map((entry) => entry.power)).toEqual([0.25]);
    const result = score(
      mergedEvent(),
      { ...friday.player, counters: { ...friday.player.counters, dailyFirstDay: '2026-11-13' } },
      createPRState(mergedFacts()),
      Date.parse('2026-11-13T09:00:00Z'),
    );
    expect(result.goldMultiplier).toBe(4);
  });
});
