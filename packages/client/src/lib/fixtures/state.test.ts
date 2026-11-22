import { describe, expect, it, vi } from 'vitest';
import {
  levelFor,
  progressWithinLevel,
  SKILLS,
  VOCATION_THRESHOLDS,
  ZONE_EXPONENT,
} from '@mergescape/shared';
import type { SkillXp } from '@mergescape/shared';
import { breakdownRows } from '../breakdown';
import type { LogEntry } from '../types';
import { createFixtureApi } from './api';
import {
  fixtureCharm,
  fixtureInstallations,
  fixtureLogEntries,
  fixtureMe,
  FIXTURE_PAGE_SIZE,
  FIXTURE_WEEKLY_XP,
  pageOf,
} from './state';
import { FINAL_SKILL_XP, FINAL_XP } from './raw-log';

const NOW = Date.UTC(2026, 10, 11, 14, 5, 0);
const entries = fixtureLogEntries(NOW);

const sum = (values: number[]) => Math.round(values.reduce((a, b) => a + b, 0) * 1e6) / 1e6;
const linesOf = (entry: LogEntry, kind: LogEntry['breakdown'][number]['kind']) =>
  entry.breakdown.filter((line) => line.kind === kind);

describe('fixture Combat Log rows (the scorer ran, nothing was typed by hand)', () => {
  it('has 14 rows, newest first, with unique ids', () => {
    expect(entries).toHaveLength(14);
    const times = entries.map((entry) => Date.parse(entry.at));
    expect([...times].sort((a, b) => b - a)).toEqual(times);
    expect(new Set(entries.map((entry) => entry.id)).size).toBe(entries.length);
    for (const entry of entries) {
      expect(entry.id.startsWith(entry.at)).toBe(true);
    }
  });

  it.each(entries.map((entry) => [entry.id, entry] as const))('%s adds up', (_id, entry) => {
    // Points = sum of the points lines; Power = sum of the power lines; XP = floor(P x Power x Zone).
    expect(sum(linesOf(entry, 'points').map((line) => line.value))).toBe(entry.points);
    expect(sum(linesOf(entry, 'power').map((line) => line.value))).toBeCloseTo(entry.power, 9);
    expect(linesOf(entry, 'zone')).toHaveLength(1);
    expect(linesOf(entry, 'zone')[0]?.value).toBeCloseTo(entry.zone, 9);
    expect(entry.zone).toBeCloseTo((entry.level + 1) ** ZONE_EXPONENT, 9);
    expect(Math.floor(entry.points * entry.power * entry.zone)).toBe(entry.xp);
    expect(linesOf(entry, 'xp')[0]?.value).toBe(entry.xp);
    // The credited skills add up to the row's XP.
    const skills = Object.values(entry.skillXp) as number[];
    expect(sum(skills)).toBe(entry.xp);
  });

  it('keeps the breakdown in the order points, power, zone, xp', () => {
    for (const entry of entries) {
      const order = entry.breakdown.map((line) => line.kind);
      const rank = { points: 0, power: 1, zone: 2, xp: 3 } as const;
      expect(order.map((kind) => rank[kind])).toEqual(
        [...order.map((kind) => rank[kind])].sort((a, b) => a - b),
      );
    }
  });

  it('covers the Bestiary the scorer picks from and a private repo with no name', () => {
    const monsters = new Set(entries.map((entry) => entry.monster));
    for (const expected of [
      'merge-goblin',
      'nitpick-imp',
      'flaky-test-wraith',
      'legacy-golem',
      'rebase-hydra',
      'scope-creep',
    ]) {
      expect(monsters).toContain(expected);
    }
    const priv = entries.find((entry) => entry.repoPrivate);
    expect(priv).toBeDefined();
    expect(priv?.repoName).toBeUndefined();
  });

  it('leaves no PR title, body or comment text anywhere in a row (Requirement 3.3)', () => {
    const allowed = new Set([
      'id',
      'at',
      'kind',
      'reviewState',
      'prNumber',
      'repoId',
      'repoPrivate',
      'repoName',
      'additions',
      'deletions',
      'inlineComments',
      'monster',
      'skill',
      'points',
      'power',
      'zone',
      'level',
      'xp',
      'skillXp',
      'supplies',
      'breakdown',
    ]);
    for (const entry of entries) {
      for (const key of Object.keys(entry)) {
        expect(allowed.has(key), `unexpected field ${key}`).toBe(true);
      }
    }
  });

  it('has a breakdown the Combat Log can draw for every row', () => {
    for (const entry of entries) {
      expect(breakdownRows(entry).length).toBeGreaterThanOrEqual(6);
    }
  });
});

describe('fixture profile', () => {
  const me = fixtureMe(NOW);

  it('is a level-41 Smith whose skill XP adds up to its XP', () => {
    expect(levelFor(me.xp)).toBe(41);
    expect(me.xp).toBe(FINAL_XP);
    expect(sum(SKILLS.map((skill) => me.skillXp[skill]))).toBe(me.xp);
    expect(me.skillXp).toEqual(FINAL_SKILL_XP);
    expect(me.skillXp.smithing / me.xp).toBeGreaterThanOrEqual(VOCATION_THRESHOLDS.smith);
    expect(me.vocation).toBe('Smith');
  });

  it('stands just short of level 42, so one more merge levels up', () => {
    expect(progressWithinLevel(me.xp).fraction).toBeGreaterThan(0.85);
    const next = (entries[0] as LogEntry).xp;
    expect(levelFor(me.xp + next)).toBe(42);
  });

  it('holds three Charms in five slots and a run in progress', () => {
    expect(me.charms).toHaveLength(3);
    expect(me.charmSlots).toBe(5);
    expect(me.week?.act).toBe('raid');
    expect(me.week?.clearedActs).toEqual(['scout']);
    expect(me.week?.weeklyXp).toBe(FIXTURE_WEEKLY_XP);
    expect(me.week?.weeklyXp).toBeGreaterThan(me.week?.targets.scout ?? Infinity);
    expect(me.week?.weeklyXp).toBeLessThan(me.week?.targets.raid ?? 0);
    expect(me.week?.targets.boss).toBe(Math.round((me.week?.targets.raid ?? 0) * 1.5));
    expect(me.week?.targets.scout).toBe(Math.round((me.week?.targets.raid ?? 0) * 0.6));
    expect(me.week?.played).toHaveLength(3);
    expect(me.week?.hand).toHaveLength(5);
  });

  it('has empty variants for a new character', () => {
    for (const variant of ['noevents', 'noinstall'] as const) {
      const fresh = fixtureMe(NOW, variant);
      expect(fresh.xp).toBe(0);
      expect(levelFor(fresh.xp)).toBe(1);
      expect(fresh.charms).toEqual([]);
      expect(fresh.week).toBeNull();
      expect(fixtureLogEntries(NOW, variant)).toEqual([]);
    }
    expect(fixtureInstallations('noinstall').installations).toEqual([]);
    expect(fixtureInstallations('noevents').installations).toHaveLength(1);
    expect(fixtureInstallations().installations).toHaveLength(1);
  });
});

describe('pagination', () => {
  it('splits the log into two pages with no overlap', () => {
    const first = pageOf(entries, null);
    expect(first.entries).toHaveLength(FIXTURE_PAGE_SIZE);
    expect(first.nextCursor).not.toBeNull();
    const second = pageOf(entries, first.nextCursor);
    expect(second.entries).toHaveLength(entries.length - FIXTURE_PAGE_SIZE);
    expect(second.nextCursor).toBeNull();
    expect([...first.entries, ...second.entries]).toEqual(entries);
  });

  it('treats a junk cursor as the first page', () => {
    expect(pageOf(entries, 'zzz').entries[0]).toEqual(entries[0]);
  });
});

describe('createFixtureApi', () => {
  it('answers the three reads', async () => {
    const api = createFixtureApi({ now: NOW });
    expect((await api.me()).login).toBe('octo-dev');
    expect((await api.log()).entries).toHaveLength(FIXTURE_PAGE_SIZE);
    expect((await api.installations()).installations).toHaveLength(1);
  });

  it('honours the page size and simulated latency', async () => {
    vi.useFakeTimers();
    const api = createFixtureApi({ now: NOW, pageSize: 3, latencyMs: 50 });
    const pending = api.log();
    await vi.advanceTimersByTimeAsync(50);
    expect((await pending).entries).toHaveLength(3);
  });

  it('lets one row arrive after liveAfterMs and levels the character up', async () => {
    vi.useFakeTimers({ now: NOW });
    const api = createFixtureApi({ now: NOW, liveAfterMs: 5000 });
    const before = await api.me();
    expect((await api.log()).entries[0]?.prNumber).toBe(412);

    await vi.advanceTimersByTimeAsync(5000);
    const after = await api.me();
    const log = await api.log();
    expect(log.entries[0]?.id.endsWith('#fixture-live')).toBe(true);
    expect(log.entries[0]?.prNumber).toBe(431);
    expect(after.xp).toBe(before.xp + (log.entries[0]?.xp ?? 0));
    expect(levelFor(before.xp)).toBe(41);
    expect(levelFor(after.xp)).toBe(42);
    expect(after.week?.weeklyXp).toBe((before.week?.weeklyXp ?? 0) + (log.entries[0]?.xp ?? 0));
    expect(after.gold).toBeGreaterThan(before.gold);
  });

  it('never invents a live row for the empty variants', async () => {
    vi.useFakeTimers({ now: NOW });
    const api = createFixtureApi({ now: NOW, variant: 'noevents', liveAfterMs: 1 });
    await vi.advanceTimersByTimeAsync(10);
    expect((await api.log()).entries).toEqual([]);
    const skillXp: SkillXp = (await api.me()).skillXp;
    expect(skillXp.smithing).toBe(0);
  });
});

describe('fixture run, shop, Pledges and Bestiary (docs/api-contract.md shapes)', () => {
  const me = fixtureMe(NOW);
  const week = me.week as NonNullable<typeof me.week>;

  it('has an open shop with 2 Charms, 2 Packs (one bought with options), a Voucher and the numbers around them', () => {
    const shop = week.shop as NonNullable<typeof week.shop>;
    expect(shop.visit).toBe(1);
    expect(shop.charms).toHaveLength(2);
    expect(shop.charms.map((c) => [c.index, c.charm.id, c.price, c.sold])).toEqual([
      [0, 'grey-beard', 120, false],
      [1, 'lantern', 40, false],
    ]);
    expect(shop.packs).toHaveLength(2);
    expect(shop.packs[0]).toMatchObject({ kind: 'pledge', price: 60, bought: true, picked: false });
    expect(shop.packs[0]?.options).toHaveLength(3);
    expect(shop.packs[1]).toMatchObject({
      kind: 'charm',
      price: 100,
      bought: false,
      options: null,
    });
    expect(shop.voucher).toEqual({ id: 'charm-belt', price: 200, sold: false });
    expect(shop.rerollCost).toBe(20);
    expect(shop.shrineCost).toBe(50);
    expect(shop.interestPreview).toBe(10);
    expect(Object.keys(shop.sellPrices).sort()).toEqual([
      'hot-potato',
      'rubber-duck',
      'small-hands',
    ]);
    expect(shop.sellPrices['hot-potato']).toBe(60);
    expect(week.freePack).toBeNull();
    expect(week.freePackOptions).toBeNull();
    expect(week.legendaryOffer).toBeNull();
    expect(week.nextMogul).toBeNull();
  });

  it('prices the Voucher at 150 plus 50 for each one owned', () => {
    expect(me.vouchers).toHaveLength(1);
    expect(week.shop?.voucher?.price).toBe(150 + 50 * me.vouchers.length);
  });

  it('has the Pledge hand, the played Pledges and their progress', () => {
    expect(week.hand.map((p) => p.id)).toEqual([
      'strike',
      'defend',
      'big-game-hunter',
      'mentor',
      'tidy',
    ]);
    expect(week.played.map((p) => p.id)).toEqual(['strike', 'defend', 'big-game-hunter']);
    expect(week.pledgeProgress).toEqual({
      strike: { progress: 2, target: 3, completed: false },
      defend: { progress: 5, target: 5, completed: true },
      'big-game-hunter': { progress: 0, target: 1, completed: false },
    });
    expect(me.deck).toHaveLength(5);
  });

  it('has kills and first-seen for the Bestiary, with the Silent Monolith never met', () => {
    expect(me.kills['merge-goblin']).toBe(1204);
    expect(me.kills['silent-monolith']).toBeUndefined();
    expect(me.firstSeen['silent-monolith']).toBeUndefined();
    for (const id of Object.keys(me.kills)) {
      expect(me.firstSeen[id as keyof typeof me.firstSeen], id).toBeDefined();
    }
    // Renown is the Moguls beaten.
    const moguls = [
      'rocket-man',
      'leather-jacket',
      'turtleneck',
      'hoodie',
      'founder',
      'two-pizza-boss',
    ] as const;
    expect(moguls.reduce((sum, id) => sum + (me.kills[id] ?? 0), 0)).toBe(me.renown);
    expect(me.biome).toBe('Flaky Marsh');
  });

  it('has a Monday variant: window open, nothing played, no shop, the next Mogul known', () => {
    const monday = fixtureMe(NOW, 'monday').week as NonNullable<typeof week>;
    expect(monday).toMatchObject({
      act: 'scout',
      clearedActs: [],
      played: [],
      pledgeWindowOpen: true,
      shop: null,
      mogul: 'hoodie',
      nextMogul: 'founder',
    });
    expect(monday.hand).toHaveLength(5);
  });

  it('accepts run overrides for a free pack or a Legendary offer', () => {
    const legendary = fixtureCharm('oracle');
    const over = fixtureMe(NOW, 'active', { freePack: 'pledge', legendaryOffer: legendary });
    expect(over.week?.freePack).toBe('pledge');
    expect(over.week?.legendaryOffer?.id).toBe('oracle');
  });

  it('gives a free pack its three options, as the api does, unless told otherwise', () => {
    const over = fixtureMe(NOW, 'active', { freePack: 'pledge' }).week;
    expect(over?.freePackOptions).toHaveLength(3);
    expect(over?.freePackOptions?.every((option) => option.kind === 'pledge')).toBe(true);
    expect(
      fixtureMe(NOW, 'active', { freePack: 'pledge', freePackOptions: null }).week?.freePackOptions,
    ).toBeNull();
    expect(fixtureMe(NOW).week?.freePackOptions).toBeNull();
  });
});

describe('fixture writes keep the fixture shop clickable offline', () => {
  const make = (options: Parameters<typeof createFixtureApi>[0] = {}) =>
    createFixtureApi({ now: NOW, ...options });

  it('buys a Charm: gold down, Charm held, shelf marked sold; a second buy is sold_out', async () => {
    const api = make();
    const answer = await api.shopBuy({ kind: 'charm', index: 1 });
    expect(answer.me.gold).toBe(2300);
    expect(answer.me.charms.map((c) => c.id)).toEqual([
      'rubber-duck',
      'small-hands',
      'hot-potato',
      'lantern',
    ]);
    expect(answer.week.shop?.charms[1]?.sold).toBe(true);
    expect(answer.week.shop?.sellPrices['lantern']).toBe(20);
    expect(answer.me.week).toEqual(answer.week);
    await expect(api.shopBuy({ kind: 'charm', index: 1 })).rejects.toMatchObject({
      status: 409,
      code: 'sold_out',
    });
    expect((await api.me()).gold).toBe(2300);
  });

  it('refuses with a typed code and changes nothing: a missing slot, too little gold', async () => {
    const api = make();
    await expect(api.shopBuy({ kind: 'charm', index: 7 })).rejects.toMatchObject({
      status: 409,
      code: 'no_such_slot',
    });

    const poor = make();
    // Spend the gold on Re-rolls until it cannot cover the next one (20, 30, 40, ...).
    let result: Awaited<ReturnType<typeof poor.shopReroll>> | null = null;
    for (let i = 0; i < 40; i += 1) {
      try {
        result = await poor.shopReroll();
      } catch (error) {
        expect(error).toMatchObject({ status: 409, code: 'insufficient_gold' });
        break;
      }
    }
    expect(result?.me.gold).toBeLessThan(result?.week.shop?.rerollCost ?? 0);
    const before = (await poor.me()).gold;
    await expect(poor.shopBuy({ kind: 'charm', index: 0 })).rejects.toMatchObject({
      code: 'insufficient_gold',
    });
    expect((await poor.me()).gold).toBe(before);
  });

  it('fills the Charm slots, then says no_free_slot', async () => {
    const api = make();
    await api.shopBuy({ kind: 'charm', index: 1 });
    await api.shopBuy({ kind: 'charm', index: 0 });
    expect((await api.me()).charms).toHaveLength(5);
    // The Charm pack's first card is one the player does not hold, and there is no slot for it.
    await api.shopBuy({ kind: 'pack', index: 1 });
    await expect(api.shopPick({ index: 1, option: 0 })).rejects.toMatchObject({
      code: 'no_free_slot',
    });
    // A refused keep leaves the pack unopened, so it can be picked again after making room.
    expect((await api.getWeek()).shop?.packs[1]).toMatchObject({ bought: true, picked: false });
    await api.shopSell('rubber-duck');
    expect((await api.shopPick({ index: 1, option: 0 })).me.charms).toHaveLength(5);
  });

  it('buys and opens a Pledge pack: keep exactly one, the deck grows, the pack is spent', async () => {
    const api = make();
    const bought = await api.shopBuy({ kind: 'pack', index: 1 });
    expect(bought.me.gold).toBe(2240);
    expect(bought.week.shop?.packs[1]).toMatchObject({ bought: true, picked: false });
    expect(bought.week.shop?.packs[1]?.options).toHaveLength(3);

    const kept = await api.shopPick({ index: 0, option: 0 });
    expect(kept.me.deck).toHaveLength(6);
    expect(kept.week.shop?.packs[0]).toMatchObject({ picked: true, options: null });
    await expect(api.shopPick({ index: 0, option: 0 })).rejects.toMatchObject({
      code: 'already_picked',
    });
    await expect(api.shopPick({ index: 1, option: 9 })).rejects.toMatchObject({
      code: 'bad_option',
    });
    await expect(api.shopBuy({ kind: 'pack', index: 1 })).rejects.toMatchObject({
      code: 'sold_out',
    });
  });

  it('refuses to open a pack that was never bought, and a pick at the wrong index', async () => {
    const api = make();
    await expect(api.shopPick({ index: 1, option: 0 })).rejects.toMatchObject({
      code: 'pack_not_bought',
    });
    await expect(api.shopPick({ index: 5, option: 0 })).rejects.toMatchObject({
      code: 'no_such_slot',
    });
  });

  it('buys the Voucher: Charm Belt adds a sixth slot', async () => {
    const api = make();
    const answer = await api.shopBuy({ kind: 'voucher' });
    expect(answer.me.gold).toBe(2140);
    expect(answer.me.charmSlots).toBe(6);
    expect(answer.me.vouchers).toContain('charm-belt');
    expect(answer.week.shop?.voucher?.sold).toBe(true);
    await expect(api.shopBuy({ kind: 'voucher' })).rejects.toMatchObject({ code: 'sold_out' });
  });

  it('re-rolls at 20, then 30, with the Voucher and an opened pack staying put', async () => {
    const api = make();
    const first = await api.shopReroll();
    expect(first.me.gold).toBe(2320);
    expect(first.week.shop?.rerollCost).toBe(30);
    expect(first.week.shop?.charms.map((c) => c.charm.id)).not.toEqual(['grey-beard', 'lantern']);
    expect(first.week.shop?.packs[0]).toMatchObject({
      kind: 'pledge',
      bought: true,
      picked: false,
    });
    expect(first.week.shop?.voucher?.id).toBe('charm-belt');
    const second = await api.shopReroll();
    expect(second.me.gold).toBe(2290);
    expect(second.week.shop?.rerollCost).toBe(40);
  });

  it('sells a Charm for its sell price, and refuses one it does not hold', async () => {
    const api = make();
    const answer = await api.shopSell('hot-potato');
    expect(answer.me.gold).toBe(2400);
    expect(answer.me.charms.map((c) => c.id)).toEqual(['rubber-duck', 'small-hands']);
    await expect(api.shopSell('hot-potato')).rejects.toMatchObject({ code: 'not_held' });
  });

  it('removes a Pledge at the shrine for 50, and says not_in_deck for one that is gone', async () => {
    const api = make();
    const answer = await api.shrineRemove('mentor');
    expect(answer.me.gold).toBe(2290);
    expect(answer.me.deck.map((p) => p.id)).not.toContain('mentor');
    await expect(api.shrineRemove('mentor')).rejects.toMatchObject({ code: 'not_in_deck' });
  });

  it('plays Pledges while the window is open, up to 3, and answers the typed errors', async () => {
    const api = make({ variant: 'monday' });
    const one = await api.pledgePlay('strike');
    expect(one.week.played.map((p) => p.id)).toEqual(['strike']);
    expect(one.week.pledgeProgress['strike']).toEqual({ progress: 0, target: 3, completed: false });
    await expect(api.pledgePlay('strike')).rejects.toMatchObject({ code: 'already_played' });
    await expect(api.pledgePlay('pair-up')).rejects.toMatchObject({ code: 'not_in_hand' });
    await api.pledgePlay('defend');
    await api.pledgePlay('mentor');
    await expect(api.pledgePlay('tidy')).rejects.toMatchObject({ code: 'play_limit' });
  });

  it('refuses a play once the window has closed, and any shop call with no shop open', async () => {
    const closed = make({ variant: 'monday', week: { pledgeWindowOpen: false } });
    await expect(closed.pledgePlay('strike')).rejects.toMatchObject({
      status: 409,
      code: 'window_closed',
    });
    await expect(closed.shopReroll()).rejects.toMatchObject({ code: 'shop_closed' });
    await expect(closed.shopBuy({ kind: 'charm', index: 0 })).rejects.toMatchObject({
      code: 'shop_closed',
    });
  });

  it('takes the free Raid pack (index -1) once, and a Legendary offer once', async () => {
    const api = make({ week: { freePack: 'pledge', legendaryOffer: fixtureCharm('oracle') } });
    await expect(api.shopPick({ index: -1, option: 7 })).rejects.toMatchObject({
      code: 'bad_option',
    });
    const free = await api.shopPick({ index: -1, option: 1 });
    expect(free.week.freePack).toBeNull();
    expect(free.week.freePackOptions).toBeNull();
    expect(free.me.deck).toHaveLength(6);
    await expect(api.shopPick({ index: -1, option: 1 })).rejects.toMatchObject({
      code: 'no_free_pack',
    });

    const legendary = await api.shopBuy({ kind: 'legendary' });
    expect(legendary.week.legendaryOffer).toBeNull();
    expect(legendary.me.charms.map((c) => c.id)).toContain('oracle');
    await expect(api.shopBuy({ kind: 'legendary' })).rejects.toMatchObject({
      code: 'no_legendary_offer',
    });
  });

  it('leaves the fixture untouched when a write is refused part way', async () => {
    const api = make({ week: { legendaryOffer: fixtureCharm('oracle') } });
    await api.shopBuy({ kind: 'charm', index: 1 });
    await api.shopBuy({ kind: 'charm', index: 0 }); // 5 of 5 slots
    const before = await api.me();
    await expect(api.shopBuy({ kind: 'legendary' })).rejects.toMatchObject({
      code: 'no_free_slot',
    });
    expect(await api.me()).toEqual(before);
  });

  it('exports a document with the contract keys and deletes on a matching login', async () => {
    const api = make();
    const exported = await api.exportData();
    expect(Object.keys(exported).sort()).toEqual([
      'events',
      'expeditions',
      'exportedAt',
      'feats',
      'jobs',
      'profile',
      'weeks',
    ]);
    expect((exported['profile'] as { login: string }).login).toBe('octo-dev');
    expect(exported['events']).toHaveLength(14);

    await expect(api.deleteAccount('someone')).rejects.toMatchObject({
      status: 400,
      code: 'confirm_mismatch',
    });
    await api.deleteAccount(' Octo-Dev ');
    const fresh = await api.me();
    expect(fresh.xp).toBe(0);
    expect(fresh.week).toBeNull();
    expect((await api.log()).entries).toEqual([]);
    await expect(api.getWeek()).rejects.toMatchObject({ status: 404 });
  });

  it('serves GET /week as the same run as /me', async () => {
    const api = make();
    expect(await api.getWeek()).toEqual((await api.me()).week);
  });
});
