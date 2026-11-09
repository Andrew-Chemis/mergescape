import { describe, expect, it } from 'vitest';
import { GEAR_TIERS, REGION_RULES } from './constants';
import {
  affixCount,
  GEAR_SLOTS,
  gearName,
  makePiece,
  slotNoun,
  tierPower,
  UNIQUES,
  uniqueDefinition,
  uniquePiece,
  WORN_SLOTS,
} from './gear';
import { createPlayerState } from './state';

describe('slots and tiers (game-design.md 7.1)', () => {
  it('has five slots, the last being the pet', () => {
    expect(GEAR_SLOTS).toEqual(['weapon', 'body', 'cape', 'trinket', 'pet']);
    expect(WORN_SLOTS).toEqual(['weapon', 'body', 'cape', 'trinket']);
  });

  it('Power per piece: Leather 0.05 up to Dragon 0.40', () => {
    expect(GEAR_TIERS.map(tierPower)).toEqual([0.05, 0.1, 0.15, 0.2, 0.3, 0.4]);
  });

  it('names pieces by tier and slot', () => {
    expect(gearName('iron', 'weapon')).toBe('Iron Blade');
    expect(gearName('dragon', 'body')).toBe('Dragon Armour');
    expect(gearName('leather', 'cape')).toBe('Leather Cape');
    expect(gearName('rune', 'trinket')).toBe('Rune Trinket');
    expect(slotNoun('pet')).toBe('Companion');
  });
});

describe('makePiece', () => {
  it('takes its Power from its tier and leaves unused options absent', () => {
    expect(makePiece({ id: 'a', slot: 'weapon', tier: 'silver' })).toEqual({
      id: 'a',
      slot: 'weapon',
      power: 0.15,
      tier: 'silver',
      name: 'Silver Blade',
    });
  });

  it('carries every option it is given', () => {
    expect(
      makePiece({
        id: 'b',
        slot: 'body',
        tier: 'iron',
        look: 'dragon',
        affix: 'stout',
        name: 'Plate',
        unique: 'feat',
        owner: 'Somebody Invented',
        ref: 'monolith-plate',
      }),
    ).toEqual({
      id: 'b',
      slot: 'body',
      power: 0.1,
      tier: 'iron',
      look: 'dragon',
      affix: 'stout',
      name: 'Plate',
      unique: 'feat',
      owner: 'Somebody Invented',
      ref: 'monolith-plate',
    });
  });
});

describe('affixCount', () => {
  it('counts equipped pieces with the affix', () => {
    const player = {
      ...createPlayerState(1),
      gear: {
        pieces: [
          makePiece({ id: '1', slot: 'weapon', tier: 'iron', affix: 'keen' }),
          makePiece({ id: '2', slot: 'body', tier: 'iron', affix: 'keen' }),
          makePiece({ id: '3', slot: 'cape', tier: 'iron' }),
        ],
        setBonus: 0,
      },
    };
    expect(affixCount(player, 'keen')).toBe(2);
    expect(affixCount(player, 'lucky')).toBe(0);
    expect(affixCount(createPlayerState(1), 'keen')).toBe(0);
  });
});

describe('named uniques', () => {
  it('has a unique for every expedition region but the Garbage Collector, and eleven Feat rewards', () => {
    const regionUniques = Object.values(REGION_RULES)
      .map((rules) => rules.unique)
      .filter((id) => id !== 'reclaimed');
    expect(regionUniques).toHaveLength(7);
    for (const id of regionUniques) {
      expect(uniqueDefinition(id)?.source, id).toBe('region');
    }
    expect(UNIQUES.filter((unique) => unique.source === 'feat')).toHaveLength(11);
    expect(new Set(UNIQUES.map((unique) => unique.id)).size).toBe(UNIQUES.length);
    expect(uniqueDefinition('nope')).toBeUndefined();
  });

  it('is never worn in the pet slot and never carries more than its slot normal Power', () => {
    for (const unique of UNIQUES) {
      expect(WORN_SLOTS).toContain(unique.slot);
      const piece = uniquePiece(unique, `u-${unique.id}`);
      expect(piece.power).toBe(tierPower(unique.tier));
      expect(piece.power).toBeLessThanOrEqual(0.4);
      expect(piece.unique).toBe(unique.source);
      expect(piece.ref).toBe(unique.id);
    }
  });

  it('the Monolith Plate looks like Dragon and weighs like Iron', () => {
    const piece = uniquePiece(uniqueDefinition('monolith-plate')!, 'x');
    expect(piece).toMatchObject({ look: 'dragon', tier: 'iron', power: 0.1, slot: 'body' });
  });

  it('the Feat uniques carry the affixes the design names', () => {
    expect(uniqueDefinition('the-red-pen')?.affix).toBe('stout');
    expect(uniqueDefinition('scalpel')?.affix).toBe('keen');
  });
});
