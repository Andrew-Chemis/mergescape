import { describe, expect, it } from 'vitest';
import {
  EXPEDITION_HOURS,
  EXPEDITION_PLANS,
  LOOT_KINDS,
  LOOT_WEIGHT_TOTAL,
  PET_IDS,
  REGION_IDS,
  REGION_RULES,
} from './constants';
import type { ExpeditionHours, RegionId } from './constants';
import { HOUR_MS } from './calendar';
import { CHARMS } from './charms';
import { held } from './test-builders';
import {
  applyLoot,
  collectExpedition,
  durationReduction,
  expeditionDurationMs,
  expeditionPlan,
  expeditionStatus,
  FORMER_OWNERS,
  isExpeditionChoice,
  isRegionId,
  lootPackOptions,
  lootWeights,
  openLootPack,
  packOddsBonus,
  reclaimedPiece,
  regionDefinition,
  regionList,
  REGIONS,
  regionUnlocked,
  rollLoot,
  sendExpedition,
  yieldPerProvision,
} from './expeditions';
import { makePiece, WORN_SLOTS } from './gear';
import { createPlayerState } from './state';
import { addSupplies, satchelOf } from './supplies';
import type { ExpeditionState, GearPiece, LootItem, PlayerState } from './types';

const T0 = Date.UTC(2026, 10, 9, 12, 0, 0);

function expedition(
  region: RegionId,
  hours: ExpeditionHours,
  seed: number,
  overrides: Partial<ExpeditionState> = {},
): ExpeditionState {
  return {
    region,
    hours,
    forage: false,
    sentAt: T0,
    returnsAt: T0 + hours * HOUR_MS,
    seed,
    provisionsPaid: EXPEDITION_PLANS[hours].provisions,
    packBonus: 0,
    collected: false,
    ...overrides,
  };
}

/** A character with Provisions and Renown to go anywhere. */
function traveller(overrides: Partial<PlayerState> = {}): PlayerState {
  return addSupplies({ ...createPlayerState(7), renown: 64, ...overrides }, { provisions: 20 });
}

function wearing(pieces: GearPiece[]): Partial<PlayerState> {
  return { gear: { pieces, setBonus: 0 } };
}

describe('regions (game-design.md 6.2)', () => {
  it('there are eight, with the Renown gates of Requirement 15.3', () => {
    expect(REGIONS.map((region) => [region.id, region.renown])).toEqual([
      ['koko-woods', 0],
      ['crossroads-of-wix', 2],
      ['orrl-falls', 8],
      ['silverhall', 16],
      ['koko-deep-woods', 24],
      ['mazu-deep', 32],
      ['quu-spire', 48],
      ['garbage-collector', 64],
    ]);
    expect(REGIONS.map((region) => region.name)).toEqual([
      'Koko Woods',
      'Crossroads of Wix',
      'Orrl Falls',
      'Silverhall',
      'Koko Deep Woods',
      'Mazu Deep',
      'Quu Spire',
      'The Garbage Collector',
    ]);
  });

  it("every region's loot table sums to 100%, with rarer bands smaller", () => {
    for (const id of REGION_IDS) {
      const weights = REGION_RULES[id].weights;
      expect(
        LOOT_KINDS.reduce((sum, kind) => sum + weights[kind], 0),
        id,
      ).toBe(LOOT_WEIGHT_TOTAL);
      expect(weights.material, id).toBeGreaterThan(weights.gear);
      expect(weights.gear, id).toBeGreaterThan(weights.charm_pack);
      expect(weights.charm_pack, id).toBeGreaterThan(weights.pet);
      expect(weights.pet, id).toBeGreaterThan(weights.unique);
    }
  });

  it('every region has a materials table of valid ranges and a catalogued unique', () => {
    for (const region of REGIONS) {
      expect(region.materials.length, region.id).toBeGreaterThan(0);
      for (const row of region.materials) {
        expect(row.weight).toBeGreaterThan(0);
        expect(row.min).toBeGreaterThanOrEqual(1);
        expect(row.max).toBeGreaterThanOrEqual(row.min);
      }
      expect(region.pets.length).toBeGreaterThan(0);
      expect(region.pets.every((pet) => (PET_IDS as readonly string[]).includes(pet))).toBe(true);
    }
    // Only the Crossroads can give the coin; only the Garbage Collector gives Reclaimed gear.
    expect(REGIONS.filter((region) => region.coin).map((region) => region.id)).toEqual([
      'crossroads-of-wix',
    ]);
    expect(REGIONS.filter((region) => region.unique === 'reclaimed').map((r) => r.id)).toEqual([
      'garbage-collector',
    ]);
  });

  it('unlock by Renown', () => {
    const player = createPlayerState(1);
    expect(regionUnlocked(player, 'koko-woods')).toBe(true);
    expect(regionUnlocked(player, 'crossroads-of-wix')).toBe(false);
    expect(regionUnlocked({ renown: 2 }, 'crossroads-of-wix')).toBe(true);
    expect(regionUnlocked({ renown: 63 }, 'garbage-collector')).toBe(false);
    expect(regionUnlocked({ renown: 64 }, 'garbage-collector')).toBe(true);
    expect(regionList({ renown: 9 }).filter((entry) => entry.unlocked)).toHaveLength(3);
  });

  it('recognises region ids and durations', () => {
    expect(isRegionId('mazu-deep')).toBe(true);
    expect(isRegionId('atlantis')).toBe(false);
    expect(isRegionId(3)).toBe(false);
    expect([4, 12, 24, 48, 'forage'].every(isExpeditionChoice)).toBe(true);
    expect([5, '4', 'Forage', null, undefined].some(isExpeditionChoice)).toBe(false);
    expect(regionDefinition('silverhall').lean).toMatch(/Silver/);
  });
});

describe('durations, costs and the yield curve (Requirements 15.2 and 15.7)', () => {
  it('4, 12, 24 and 48 hours cost 1, 2, 4 and 6 Provisions and roll 3 to 6 items', () => {
    expect(EXPEDITION_HOURS.map((hours) => expeditionPlan(hours).provisions)).toEqual([1, 2, 4, 6]);
    expect(EXPEDITION_HOURS.map((hours) => expeditionPlan(hours).items)).toEqual([3, 4, 5, 6]);
  });

  it('the Forage is a free 4 h trip', () => {
    expect(expeditionPlan('forage')).toEqual({
      choice: 'forage',
      hours: 4,
      forage: true,
      provisions: 0,
      items: 3,
    });
  });

  it('yield per Provision strictly decreases across 4, 12, 24 and 48 hours', () => {
    const yields = EXPEDITION_HOURS.map(yieldPerProvision);
    expect(yields).toEqual([3, 2, 1.25, 1]);
    for (let at = 1; at < yields.length; at += 1) {
      expect(yields[at]).toBeLessThan(yields[at - 1] as number);
    }
    // ... while a longer trip still brings back more in total.
    const items = EXPEDITION_HOURS.map((hours) => expeditionPlan(hours).items);
    for (let at = 1; at < items.length; at += 1) {
      expect(items[at]).toBeGreaterThan(items[at - 1] as number);
    }
  });
});

describe('the loot roll (Requirement 15.4)', () => {
  it('the same seed, region and duration give identical loot; another seed does not', () => {
    const a = rollLoot(expedition('orrl-falls', 24, 12345));
    expect(rollLoot(expedition('orrl-falls', 24, 12345))).toEqual(a);
    expect(rollLoot(expedition('orrl-falls', 24, 54321))).not.toEqual(a);
  });

  it('region and duration are part of the roll', () => {
    const base = rollLoot(expedition('orrl-falls', 24, 99));
    expect(rollLoot(expedition('silverhall', 24, 99))).not.toEqual(base);
    expect(rollLoot(expedition('orrl-falls', 48, 99)).slice(0, 5)).not.toEqual(base);
  });

  it('rolls 3, 4, 5 or 6 items by duration, and 3 for a Forage', () => {
    for (const hours of EXPEDITION_HOURS) {
      expect(rollLoot(expedition('koko-woods', hours, 7))).toHaveLength(
        EXPEDITION_PLANS[hours].items,
      );
    }
    expect(rollLoot(expedition('koko-woods', 4, 7, { forage: true }))).toHaveLength(3);
  });

  it('a Forage yields only materials and plain gear', () => {
    for (let seed = 1; seed <= 400; seed += 1) {
      for (const item of rollLoot(expedition('crossroads-of-wix', 4, seed, { forage: true }))) {
        expect(['material', 'gear']).toContain(item.kind);
      }
    }
  });

  it('follows the rarity bands of the region', () => {
    const rolls = 6000;
    for (const id of [
      'koko-woods',
      'crossroads-of-wix',
      'quu-spire',
      'garbage-collector',
    ] as const) {
      const tally: Record<string, number> = {};
      for (let seed = 1; seed <= rolls; seed += 1) {
        for (const item of rollLoot(expedition(id, 48, seed))) {
          tally[item.kind] = (tally[item.kind] ?? 0) + 1;
        }
      }
      const items = rolls * 6;
      const weights = REGION_RULES[id].weights;
      for (const kind of LOOT_KINDS) {
        const expected = weights[kind] / LOOT_WEIGHT_TOTAL;
        const seen = (tally[kind] ?? 0) / items;
        // Loose tolerance: the point is the shape (materials most, uniques very rare), not the decimals.
        expect(Math.abs(seen - expected), `${id} ${kind}`).toBeLessThan(
          kind === 'material' || kind === 'gear' ? 0.02 : 0.01,
        );
      }
    }
  });

  it('materials are the region lean and within their ranges', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 300; seed += 1) {
      for (const item of rollLoot(expedition('silverhall', 48, seed))) {
        if (item.kind === 'material') {
          const row = REGION_RULES.silverhall.materials.find(
            (entry) => entry.material === item.material,
          );
          expect(row, item.material).toBeDefined();
          expect(item.quantity).toBeGreaterThanOrEqual(row!.min);
          expect(item.quantity).toBeLessThanOrEqual(row!.max);
          seen.add(item.material);
        }
      }
    }
    expect([...seen].sort()).toEqual(['flux', 'ore', 'provisions', 'silver']);
  });

  it("gear is the region's lean slot and tier; the Crossroads and the Collector mix slots", () => {
    const slotsAt = (id: RegionId): Set<string> => {
      const slots = new Set<string>();
      for (let seed = 1; seed <= 400; seed += 1) {
        for (const item of rollLoot(expedition(id, 48, seed))) {
          if (item.kind === 'gear') {
            expect(item.piece.tier).toBe(REGION_RULES[id].gearTier);
            expect(item.piece.power).toBeGreaterThan(0);
            slots.add(item.piece.slot);
          }
        }
      }
      return slots;
    };
    expect([...slotsAt('orrl-falls')]).toEqual(['weapon']);
    expect([...slotsAt('mazu-deep')]).toEqual(['trinket']);
    expect([...slotsAt('koko-deep-woods')]).toEqual(['cape']);
    expect([...slotsAt('crossroads-of-wix')].sort()).toEqual([...WORN_SLOTS].sort());
    expect([...slotsAt('garbage-collector')].sort()).toEqual([...WORN_SLOTS].sort());
  });

  it('about one piece in five carries an affix, and every piece has a distinct id', () => {
    let gear = 0;
    let affixed = 0;
    const ids = new Set<string>();
    for (let seed = 1; seed <= 3000; seed += 1) {
      for (const item of rollLoot(expedition('orrl-falls', 48, seed, { sentAt: T0 + seed }))) {
        if (item.kind === 'gear') {
          gear += 1;
          affixed += item.piece.affix === undefined ? 0 : 1;
          ids.add(item.piece.id);
        }
      }
    }
    expect(affixed / gear).toBeGreaterThan(0.17);
    expect(affixed / gear).toBeLessThan(0.23);
    expect(ids.size).toBe(gear);
  });

  it('pets come from the region pet pool', () => {
    const pets = new Set<string>();
    for (let seed = 1; seed <= 6000; seed += 1) {
      for (const item of rollLoot(expedition('crossroads-of-wix', 48, seed))) {
        if (item.kind === 'pet') {
          pets.add(item.petId);
        }
      }
    }
    expect([...pets].sort()).toEqual(['flaky-wisp', 'rubber-duck']);
  });

  it('a region unique is its catalogued piece; Charm packs carry a seed', () => {
    const uniques: GearPiece[] = [];
    let pack: LootItem | undefined;
    for (let seed = 1; seed <= 6000 && (uniques.length < 3 || !pack); seed += 1) {
      for (const item of rollLoot(expedition('quu-spire', 48, seed))) {
        if (item.kind === 'unique') {
          uniques.push(item.piece);
        }
        pack ??= item.kind === 'charm_pack' ? item : undefined;
      }
    }
    expect(uniques.length).toBeGreaterThanOrEqual(3);
    for (const piece of uniques) {
      expect(piece).toMatchObject({
        name: 'Plumb-Bob of Quu',
        slot: 'weapon',
        tier: 'rune',
        unique: 'region',
        ref: 'plumb-of-quu',
      });
    }
    expect(pack?.kind).toBe('charm_pack');
  });

  it('the Garbage Collector alone gives Reclaimed uniques, named for a former owner on the list', () => {
    const pieces: GearPiece[] = [];
    for (let seed = 1; seed <= 3000; seed += 1) {
      for (const item of rollLoot(expedition('garbage-collector', 48, seed))) {
        if (item.kind === 'unique') {
          pieces.push(item.piece);
        }
      }
    }
    expect(pieces.length).toBeGreaterThan(100);
    for (const piece of pieces) {
      expect(piece.unique).toBe('reclaimed');
      expect(piece.tier).toBe('dragon');
      expect(piece.power).toBe(0.4);
      expect(WORN_SLOTS).toContain(piece.slot);
      expect(FORMER_OWNERS).toContain(piece.owner);
      expect(piece.name).toContain(piece.owner as string);
    }
    expect(new Set(pieces.map((piece) => piece.owner)).size).toBeGreaterThan(30);
    // No other region gives Reclaimed gear.
    for (const id of REGION_IDS.filter((region) => region !== 'garbage-collector')) {
      for (let seed = 1; seed <= 500; seed += 1) {
        for (const item of rollLoot(expedition(id, 48, seed))) {
          if (item.kind === 'unique') {
            expect(item.piece.unique).toBe('region');
          }
        }
      }
    }
  });

  it('the coin dated 7960 can be found at the Crossroads and nowhere else, and never on a Forage', () => {
    const coinAt = (id: RegionId, forage: boolean, seeds: number): number => {
      let found = 0;
      for (let seed = 1; seed <= seeds; seed += 1) {
        found += rollLoot(expedition(id, 48, seed, { forage })).filter(
          (item) => item.kind === 'coin',
        ).length;
      }
      return found;
    };
    const found = coinAt('crossroads-of-wix', false, 20000);
    // 0.1% of 6 items per roll: about 120 in 20,000 rolls.
    expect(found).toBeGreaterThan(60);
    expect(found).toBeLessThan(200);
    expect(
      rollLoot(expedition('crossroads-of-wix', 48, 1)).every((item) => item.kind !== 'coin'),
    ).toBe(true);
    expect(coinAt('crossroads-of-wix', true, 20000)).toBe(0);
    expect(coinAt('koko-woods', false, 20000)).toBe(0);
    const coin = (function first(): LootItem | undefined {
      for (let seed = 1; seed <= 20000; seed += 1) {
        const hit = rollLoot(expedition('crossroads-of-wix', 48, seed)).find(
          (i) => i.kind === 'coin',
        );
        if (hit) {
          return hit;
        }
      }
      return undefined;
    })();
    expect(coin).toEqual({ kind: 'coin', year: 7960 });
  });

  it('Charm-pack odds rise with the captured bonus, taking from materials', () => {
    const base = lootWeights('crossroads-of-wix', 0, false);
    expect(base).toEqual(REGION_RULES['crossroads-of-wix'].weights);
    const lucky = lootWeights('crossroads-of-wix', 15, false);
    expect(lucky.charm_pack).toBe(base.charm_pack + 150);
    expect(lucky.material).toBe(base.material - 150);
    expect(LOOT_KINDS.reduce((sum, kind) => sum + lucky[kind], 0)).toBe(LOOT_WEIGHT_TOTAL);
    // A negative bonus is ignored.
    expect(lootWeights('crossroads-of-wix', -5, false)).toEqual(base);
    // A Forage never rolls packs, pets or uniques.
    expect(lootWeights('crossroads-of-wix', 15, true)).toMatchObject({
      charm_pack: 0,
      pet: 0,
      unique: 0,
    });

    let packs = 0;
    let boosted = 0;
    for (let seed = 1; seed <= 4000; seed += 1) {
      packs += rollLoot(expedition('crossroads-of-wix', 48, seed)).filter(
        (item) => item.kind === 'charm_pack',
      ).length;
      boosted += rollLoot(expedition('crossroads-of-wix', 48, seed, { packBonus: 15 })).filter(
        (item) => item.kind === 'charm_pack',
      ).length;
    }
    expect(boosted).toBeGreaterThan(packs * 2);
  });
});

describe('the invented former owners', () => {
  it('there are about forty, all distinct and plainly fictional', () => {
    expect(FORMER_OWNERS.length).toBeGreaterThanOrEqual(38);
    expect(FORMER_OWNERS.length).toBeLessThanOrEqual(45);
    expect(new Set(FORMER_OWNERS).size).toBe(FORMER_OWNERS.length);
    for (const name of FORMER_OWNERS) {
      // Not shaped like a GitHub login: letters and spaces, hyphens and apostrophes only.
      expect(name).toMatch(/^[A-Za-z][A-Za-z' -]+$/);
      expect(name).toContain(' ');
    }
  });

  it('names a Reclaimed piece after its owner', () => {
    const piece = reclaimedPiece('x-1', 'cape', 'Bessik the Unfiled');
    expect(piece).toMatchObject({
      name: "Reclaimed Cape, once Bessik the Unfiled's",
      owner: 'Bessik the Unfiled',
      unique: 'reclaimed',
      tier: 'dragon',
      slot: 'cape',
    });
  });
});

describe('sendExpedition', () => {
  it('pays Provisions, stores a seed and the return time, and marks the player away', () => {
    const player = traveller();
    const sent = sendExpedition(player, 'orrl-falls', 24, T0, 777);
    expect(sent.ok).toBe(true);
    if (!sent.ok) {
      return;
    }
    expect(sent.expedition).toEqual({
      region: 'orrl-falls',
      hours: 24,
      forage: false,
      sentAt: T0,
      returnsAt: T0 + 24 * HOUR_MS,
      seed: 777,
      provisionsPaid: 4,
      packBonus: 0,
      collected: false,
    });
    expect(satchelOf(sent.player).provisions).toBe(16);
    expect(sent.player.expedition).toEqual(sent.expedition);
    expect(player.expedition).toBeUndefined();
  });

  it('derives a stable seed when none is given, different for a different trip', () => {
    const player = traveller();
    const a = sendExpedition(player, 'koko-woods', 4, T0);
    const b = sendExpedition(player, 'koko-woods', 4, T0);
    const c = sendExpedition(player, 'koko-woods', 12, T0);
    const d = sendExpedition(player, 'koko-woods', 'forage', T0);
    expect([a, b, c, d].every((r) => r.ok)).toBe(true);
    if (a.ok && b.ok && c.ok && d.ok) {
      expect(a.expedition.seed).toBe(b.expedition.seed);
      expect(c.expedition.seed).not.toBe(a.expedition.seed);
      expect(d.expedition.seed).not.toBe(a.expedition.seed);
      expect(Number.isInteger(a.expedition.seed) && a.expedition.seed >= 0).toBe(true);
    }
  });

  it('keeps a given seed as an unsigned 32-bit number', () => {
    const sent = sendExpedition(traveller(), 'koko-woods', 4, T0, -1);
    expect(sent.ok && sent.expedition.seed).toBe(4294967295);
  });

  it('the Forage is free even with no Provisions', () => {
    const broke: PlayerState = { ...createPlayerState(1) };
    const sent = sendExpedition(broke, 'koko-woods', 'forage', T0, 1);
    expect(sent.ok).toBe(true);
    if (sent.ok) {
      expect(sent.expedition).toMatchObject({ hours: 4, forage: true, provisionsPaid: 0 });
      expect(sent.expedition.returnsAt).toBe(T0 + 4 * HOUR_MS);
    }
  });

  it('a paid trip needs the Provisions', () => {
    const broke: PlayerState = addSupplies(createPlayerState(1), { provisions: 5 });
    expect(sendExpedition(broke, 'koko-woods', 48, T0)).toEqual({
      ok: false,
      error: 'insufficient_provisions',
    });
    expect(sendExpedition(broke, 'koko-woods', 24, T0).ok).toBe(true);
    expect(sendExpedition(createPlayerState(1), 'koko-woods', 4, T0)).toEqual({
      ok: false,
      error: 'insufficient_provisions',
    });
  });

  it('is locked below the Renown gate, before Provisions are looked at', () => {
    const player = traveller({ renown: 7 });
    expect(sendExpedition(player, 'orrl-falls', 4, T0)).toEqual({
      ok: false,
      error: 'region_locked',
    });
    expect(sendExpedition({ ...player, renown: 8 }, 'orrl-falls', 4, T0).ok).toBe(true);
    expect(sendExpedition(createPlayerState(1), 'garbage-collector', 4, T0)).toEqual({
      ok: false,
      error: 'region_locked',
    });
  });

  it('allows one expedition at a time: away, then returned but uncollected', () => {
    const sent = sendExpedition(traveller(), 'koko-woods', 4, T0, 1);
    expect(sent.ok).toBe(true);
    if (!sent.ok) {
      return;
    }
    expect(sendExpedition(sent.player, 'koko-woods', 4, T0 + HOUR_MS)).toEqual({
      ok: false,
      error: 'in_progress',
    });
    expect(sendExpedition(sent.player, 'koko-woods', 4, T0 + 4 * HOUR_MS)).toEqual({
      ok: false,
      error: 'uncollected',
    });
    // Collected, or an old null record, the character is in Town again.
    expect(sendExpedition({ ...sent.player, expedition: null }, 'koko-woods', 4, T0).ok).toBe(true);
  });

  it('Quick gear shortens the trip and Lucky gear raises the Charm-pack odds, both captured at send', () => {
    const quick = makePiece({ id: 'q', slot: 'weapon', tier: 'iron', affix: 'quick' });
    const lucky = makePiece({ id: 'l', slot: 'body', tier: 'iron', affix: 'lucky' });
    const player = traveller(wearing([quick, lucky]));
    expect(durationReduction(player)).toBeCloseTo(0.1, 10);
    expect(packOddsBonus(player)).toBe(5);
    const sent = sendExpedition(player, 'koko-woods', 24, T0, 5);
    expect(sent.ok).toBe(true);
    if (sent.ok) {
      expect(sent.expedition.returnsAt - T0).toBe(Math.round(24 * HOUR_MS * 0.9));
      expect(sent.expedition.packBonus).toBe(5);
    }
  });

  it('the reductions are capped', () => {
    const many = (affix: 'quick' | 'lucky'): GearPiece[] =>
      ['weapon', 'body', 'cape', 'trinket'].map((slot, index) =>
        makePiece({ id: `${affix}${index}`, slot: slot as GearPiece['slot'], tier: 'iron', affix }),
      );
    expect(durationReduction(traveller(wearing(many('quick'))))).toBeCloseTo(0.4, 10);
    expect(durationReduction(createPlayerState(1))).toBe(0);
    expect(packOddsBonus(traveller(wearing(many('lucky'))))).toBe(15);
    expect(expeditionDurationMs(createPlayerState(1), 12)).toBe(12 * HOUR_MS);
    expect(expeditionDurationMs(traveller(wearing(many('quick'))), 48)).toBe(
      Math.round(48 * HOUR_MS * 0.6),
    );
  });

  it('an expedition does not touch scoring state', () => {
    const player = traveller({ xp: 1234, gold: 56 });
    const sent = sendExpedition(player, 'koko-woods', 4, T0, 1);
    expect(sent.ok && sent.player.xp).toBe(1234);
    expect(sent.ok && sent.player.gold).toBe(56);
    expect(sent.ok && sent.player.counters).toEqual(player.counters);
  });
});

describe('collectExpedition (Requirement 15.5)', () => {
  function sentTrip(
    region: RegionId = 'koko-woods',
    hours: ExpeditionHours = 24,
    seed = 4242,
  ): { player: PlayerState; trip: ExpeditionState } {
    const sent = sendExpedition(traveller(), region, hours, T0, seed);
    if (!sent.ok) {
      throw new Error(sent.error);
    }
    return { player: sent.player, trip: sent.expedition };
  }

  it('cannot be collected before the character is back', () => {
    const { player, trip } = sentTrip();
    expect(collectExpedition(player, trip, trip.returnsAt - 1)).toEqual({
      ok: false,
      error: 'not_returned',
    });
    expect(expeditionStatus(trip, trip.returnsAt - 1)).toBe('away');
  });

  it('rolls once, stores the loot and puts it in the player hands', () => {
    const { player, trip } = sentTrip();
    const collected = collectExpedition(player, trip, trip.returnsAt);
    expect(collected.ok).toBe(true);
    if (!collected.ok) {
      return;
    }
    expect(collected.applied).toBe(true);
    expect(collected.loot).toEqual(rollLoot(trip));
    expect(collected.expedition).toEqual({ ...trip, collected: true, loot: collected.loot });
    expect(collected.player.expedition).toEqual(collected.expedition);
    expect(expeditionStatus(trip, trip.returnsAt)).toBe('returned');
    expect(expeditionStatus(collected.expedition, trip.returnsAt)).toBe('collected');

    const materials = collected.loot.filter((item) => item.kind === 'material');
    expect(materials.length).toBeGreaterThan(0);
    const gained = materials.reduce(
      (sum, item) => sum + (item.kind === 'material' ? item.quantity : 0),
      0,
    );
    const before = satchelOf(player);
    const after = satchelOf(collected.player);
    const total = (s: typeof before) =>
      s.ore + s.timber + s.lore + s.ink + s.provisions + s.flux + s.silver;
    expect(total(after) - total(before)).toBe(gained);
  });

  it('is idempotent: collecting twice rolls and grants once, with identical loot', () => {
    const { player, trip } = sentTrip();
    const first = collectExpedition(player, trip, trip.returnsAt + HOUR_MS);
    expect(first.ok).toBe(true);
    if (!first.ok) {
      return;
    }
    const second = collectExpedition(first.player, first.expedition, trip.returnsAt + 99 * HOUR_MS);
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.applied).toBe(false);
      expect(second.loot).toEqual(first.loot);
      expect(second.player).toBe(first.player);
      expect(second.duplicatePets).toEqual([]);
    }
    // Even replayed from the original uncollected record the loot is the same.
    const replay = collectExpedition(player, trip, trip.returnsAt + 5 * HOUR_MS);
    expect(replay.ok && replay.loot).toEqual(first.loot);
  });

  it('an already-collected record without stored loot reads as empty', () => {
    const { player, trip } = sentTrip();
    const bare = collectExpedition(player, { ...trip, collected: true }, trip.returnsAt);
    expect(bare.ok && bare.loot).toEqual([]);
    expect(bare.ok && bare.applied).toBe(false);
  });

  it('never expires: collect a month later and the character can then go again', () => {
    const { player, trip } = sentTrip('koko-woods', 4, 11);
    const late = collectExpedition(player, trip, trip.returnsAt + 30 * 24 * HOUR_MS);
    expect(late.ok).toBe(true);
    if (late.ok) {
      expect(
        sendExpedition(late.player, 'koko-woods', 'forage', trip.returnsAt + 31 * 24 * HOUR_MS).ok,
      ).toBe(true);
    }
  });
});

describe('applyLoot', () => {
  const loot: LootItem[] = [
    { kind: 'material', material: 'ore', quantity: 3 },
    { kind: 'material', material: 'dragon', quantity: 2 },
    { kind: 'gear', piece: makePiece({ id: 'g1', slot: 'body', tier: 'leather' }) },
    {
      kind: 'unique',
      piece: makePiece({ id: 'u1', slot: 'cape', tier: 'iron', unique: 'region' }),
    },
    { kind: 'charm_pack', seed: 99 },
    { kind: 'pet', petId: 'rubber-duck' },
    { kind: 'coin', year: 7960 },
  ];

  it('files each kind where it belongs', () => {
    const applied = applyLoot(createPlayerState(1), loot);
    expect(satchelOf(applied.player)).toMatchObject({ ore: 3, dragon: 2 });
    expect(applied.player.inventory?.map((piece) => piece.id)).toEqual(['g1', 'u1']);
    expect(applied.player.charmPacks).toEqual([99]);
    expect(applied.player.pets).toEqual(['linter-cat', 'rubber-duck']);
    expect(applied.duplicatePets).toEqual([]);
  });

  it('pays Flux for a pet already owned, including the starter', () => {
    const applied = applyLoot(createPlayerState(1), [
      { kind: 'pet', petId: 'linter-cat' },
      { kind: 'pet', petId: 'rubber-duck' },
      { kind: 'pet', petId: 'rubber-duck' },
    ]);
    expect(applied.duplicatePets).toEqual(['linter-cat', 'rubber-duck']);
    expect(satchelOf(applied.player).flux).toBe(4);
    expect(applied.player.pets).toEqual(['linter-cat', 'rubber-duck']);
  });

  it('appends to what the player already holds', () => {
    const start: PlayerState = {
      ...createPlayerState(1),
      inventory: [makePiece({ id: 'old', slot: 'weapon', tier: 'iron' })],
      charmPacks: [1],
    };
    const applied = applyLoot(start, loot);
    expect(applied.player.inventory?.map((piece) => piece.id)).toEqual(['old', 'g1', 'u1']);
    expect(applied.player.charmPacks).toEqual([1, 99]);
  });
});

describe('Charm packs from loot', () => {
  it('have three distinct, stable options', () => {
    const options = lootPackOptions(555);
    expect(options).toHaveLength(3);
    expect(new Set(options.map((charm) => charm.id)).size).toBe(3);
    expect(lootPackOptions(555)).toEqual(options);
    expect(lootPackOptions(556)).not.toEqual(options);
  });

  it('keeping one grants it and consumes the pack', () => {
    const [pick] = lootPackOptions(555);
    const player: PlayerState = { ...createPlayerState(1), charmPacks: [555, 600] };
    const opened = openLootPack(player, 555, pick!.id);
    expect(opened.ok).toBe(true);
    if (opened.ok) {
      expect(opened.player.charms.map((charm) => charm.id)).toEqual([pick!.id]);
      expect(opened.player.charmPacks).toEqual([600]);
      expect(opened.grant.outcome).toBe('added');
    }
  });

  it('rejects a pack the player does not have and an option not in the pack', () => {
    const player: PlayerState = { ...createPlayerState(1), charmPacks: [555] };
    const [pick] = lootPackOptions(555);
    expect(openLootPack(createPlayerState(1), 555, pick!.id)).toEqual({
      ok: false,
      error: 'no_such_pack',
    });
    expect(openLootPack(player, 556, pick!.id)).toEqual({ ok: false, error: 'no_such_pack' });
    expect(openLootPack(player, 555, 'not-a-charm')).toEqual({ ok: false, error: 'bad_option' });
  });

  it('leaves the pack unopened when the Charm bar is full', () => {
    const [pick] = lootPackOptions(555);
    const others = CHARMS.filter((charm) => charm.id !== pick!.id)
      .slice(0, 5)
      .map((charm) => held(charm.id));
    const full: PlayerState = { ...createPlayerState(1), charmPacks: [555], charms: others };
    expect(openLootPack(full, 555, pick!.id)).toEqual({ ok: false, error: 'no_free_slot' });
  });
});
