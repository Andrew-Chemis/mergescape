import { describe, expect, it } from 'vitest';
import { CHARMS } from './charms';
import { BIOMES, GEAR_TIERS, MONSTER_IDS, PET_IDS, REGION_IDS } from './constants';
import { REGIONS } from './expeditions';
import { FEATS } from './feats';
import { UNIQUES, WORN_SLOTS } from './gear';
import { MOGULS } from './moguls';
import { PETS } from './pets';
import { PLEDGES } from './pledges';

/**
 * The content check of task 24: the shared package against the v1 column of the content budget
 * (game-design.md section 11). `docs/content-inventory.md` records these counts; this test keeps them
 * honest, so content cannot quietly fall below the budget. Exceeding it is fine and is how the later
 * columns (month 6 and month 12) are reached.
 */

/** The v1 column of game-design.md section 11. */
const V1_BUDGET = {
  monsters: 8,
  moguls: 6,
  charms: 12,
  pledges: 8,
  regions: 4,
  gearPieces: 30,
  pets: 6,
  feats: 40,
  biomes: 3,
} as const;

/** What the shared package holds today. Gear pieces are the crafted tiers in the four worn slots plus the named uniques. */
const COUNTS = {
  monsters: MONSTER_IDS.length,
  moguls: MOGULS.length,
  charms: CHARMS.length,
  pledges: PLEDGES.length,
  regions: REGIONS.length,
  gearPieces: GEAR_TIERS.length * WORN_SLOTS.length + UNIQUES.length,
  pets: PETS.length,
  feats: FEATS.length,
  biomes: BIOMES.length,
} as const;

describe('content against the v1 budget (game-design.md section 11)', () => {
  it.each(Object.keys(V1_BUDGET) as (keyof typeof V1_BUDGET)[])(
    'has at least the v1 count of %s',
    (kind) => {
      expect(COUNTS[kind]).toBeGreaterThanOrEqual(V1_BUDGET[kind]);
    },
  );

  it('matches the budget exactly where the budget is the design: monsters, Moguls, Charms, Pledges, Feats', () => {
    expect(COUNTS).toMatchObject({
      monsters: 8,
      moguls: 6,
      charms: 12,
      pledges: 8,
      feats: 40,
    });
  });

  it('holds the counts the content inventory records', () => {
    expect(COUNTS).toEqual({
      monsters: 8,
      moguls: 6,
      charms: 12,
      pledges: 8,
      regions: 8,
      gearPieces: 42,
      pets: 11,
      feats: 40,
      biomes: 6,
    });
  });

  it('counts the same regions and pets from the id lists and from the definitions', () => {
    expect(REGION_IDS).toHaveLength(REGIONS.length);
    expect(PET_IDS.length).toBeLessThanOrEqual(PETS.length);
    expect(PETS.filter((pet) => pet.core)).toHaveLength(PET_IDS.length);
  });

  it('has no duplicate ids in any catalogue', () => {
    const ids = (list: readonly { id: string }[]) => list.map((entry) => entry.id);
    for (const catalogue of [CHARMS, PLEDGES, MOGULS, FEATS, PETS, UNIQUES, REGIONS]) {
      expect(new Set(ids(catalogue)).size).toBe(catalogue.length);
    }
    expect(new Set(MONSTER_IDS).size).toBe(MONSTER_IDS.length);
  });

  it('spreads the Charms evenly over the four rarities', () => {
    expect(new Set(CHARMS.map((charm) => charm.rarity))).toEqual(
      new Set(['common', 'uncommon', 'rare', 'legendary']),
    );
    // Three of each rarity: no shop shelf offers the same Common Charm again and again.
    for (const rarity of ['common', 'uncommon', 'rare', 'legendary'] as const) {
      expect(CHARMS.filter((charm) => charm.rarity === rarity)).toHaveLength(3);
    }
  });
});
