import { describe, expect, it } from 'vitest';
import { GEAR_TIERS, POWER_CAP, REGION_RULES } from './constants';
import type { Affix, GearTier } from './constants';
import { D2_XP } from './d2table';
import {
  affixCount,
  equipGear,
  GEAR_SLOTS,
  gearName,
  gearPower,
  gearPowerLines,
  highestEquippedTier,
  loadoutOf,
  makePiece,
  setBonusFor,
  slotNoun,
  tierPower,
  tierUnlocked,
  unequipGear,
  UNIQUES,
  uniqueDefinition,
  uniquePiece,
  WORN_SLOTS,
  wornPower,
} from './gear';
import { petDefinition, petPiece } from './pets';
import { computePower, powerBreakdown } from './power';
import { createPlayerState, createPRState } from './state';
import {
  charm,
  facts,
  mergedEvent,
  mergedFacts,
  NOW,
  openedEvent,
  reviewEvent,
} from './test-builders';
import type { GameEvent, GearPiece, GearSlot, PlayerState, PowerContext } from './types';

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

// ---------------------------------------------------------------------------------------------
// Task 21: tiers unlocked, the set bonus, equipping and Power
// ---------------------------------------------------------------------------------------------

function piece(slot: GearSlot, tier: GearTier, id = `${slot}-${tier}`, affix?: Affix): GearPiece {
  return makePiece({ id, slot, tier, affix });
}

const PET_OF_TIER = {
  leather: 'linter-cat',
  iron: 'owl',
  dragon: 'garbage-collectors-mote',
} as const;

function fullSet(tier: keyof typeof PET_OF_TIER): GearPiece[] {
  return [
    piece('weapon', tier),
    piece('body', tier),
    piece('cape', tier),
    piece('trinket', tier),
    petPiece(petDefinition(PET_OF_TIER[tier])!),
  ];
}

function powerCtx(event: GameEvent): PowerContext {
  return { event, pr: createPRState(facts()), now: NOW };
}

describe('tier unlocks (game-design.md 7.1)', () => {
  const at = (level: number, renown = 0) => ({ xp: D2_XP[level]!, renown });

  it('a tier opens at its level', () => {
    expect(GEAR_TIERS.filter((tier) => tierUnlocked(at(1), tier))).toEqual(['leather']);
    expect(tierUnlocked(at(9), 'iron')).toBe(false);
    expect(tierUnlocked(at(10), 'iron')).toBe(true);
    expect(tierUnlocked(at(29), 'silver')).toBe(false);
    expect(tierUnlocked(at(30), 'silver')).toBe(true);
    expect(tierUnlocked(at(50), 'mithril')).toBe(true);
    expect(tierUnlocked(at(70), 'rune')).toBe(true);
    expect(tierUnlocked(at(89), 'dragon')).toBe(false);
    expect(tierUnlocked(at(90), 'dragon')).toBe(true);
  });

  it('Silver opens at Silverhall and Dragon at the Garbage Collector, whatever the level', () => {
    expect(tierUnlocked(at(1, 15), 'silver')).toBe(false);
    expect(tierUnlocked(at(1, 16), 'silver')).toBe(true);
    expect(tierUnlocked(at(1, 63), 'dragon')).toBe(false);
    expect(tierUnlocked(at(1, 64), 'dragon')).toBe(true);
    // The other tiers have no region unlock.
    expect(tierUnlocked(at(1, 99), 'mithril')).toBe(false);
    expect(tierUnlocked(at(1, 99), 'rune')).toBe(false);
  });
});

describe('the full-set bonus', () => {
  it('+0.25 for five slots of one tier, nothing otherwise', () => {
    expect(setBonusFor(fullSet('iron'))).toBe(0.25);
    expect(setBonusFor(fullSet('dragon'))).toBe(0.25);
    expect(setBonusFor(fullSet('iron').slice(0, 4))).toBe(0);
    expect(setBonusFor([...fullSet('iron').slice(0, 4), piece('pet', 'leather')])).toBe(0);
    expect(setBonusFor([])).toBe(0);
    // Two of one slot do not make a set.
    expect(setBonusFor([...fullSet('iron').slice(0, 4), piece('weapon', 'iron', 'second')])).toBe(
      0,
    );
    // Pieces that predate tiers never complete a set.
    expect(
      setBonusFor(fullSet('iron').map((entry) => ({ id: entry.id, slot: entry.slot, power: 0.1 }))),
    ).toBe(0);
  });

  it('a Monolith Plate counts as Iron for the set', () => {
    const set = [
      ...fullSet('iron').filter((entry) => entry.slot !== 'body'),
      uniquePiece(uniqueDefinition('monolith-plate')!, 'plate'),
    ];
    expect(setBonusFor(set)).toBe(0.25);
  });

  it('loadoutOf works the bonus out and keeps the cape colour when given', () => {
    expect(loadoutOf(fullSet('leather'))).toEqual({ pieces: fullSet('leather'), setBonus: 0.25 });
    expect(loadoutOf([], 'azure')).toEqual({ pieces: [], setBonus: 0, capeColor: 'azure' });
  });

  it('five Dragon pieces and the set make the +2.25 gear budget', () => {
    const player = { ...createPlayerState(1), gear: loadoutOf(fullSet('dragon')) };
    expect(gearPower(player)).toBe(2.25);
    expect(computePower(player)).toBe(3.25);
  });
});

describe('the sprite tier', () => {
  it('is the highest equipped tier, by look', () => {
    expect(highestEquippedTier(createPlayerState(1))).toBeNull();
    const one = { ...createPlayerState(1), gear: loadoutOf([piece('weapon', 'iron')]) };
    expect(highestEquippedTier(one)).toBe('iron');
    const mixed = {
      ...createPlayerState(1),
      gear: loadoutOf([
        piece('weapon', 'iron'),
        piece('cape', 'mithril'),
        piece('body', 'leather'),
      ]),
    };
    expect(highestEquippedTier(mixed)).toBe('mithril');
    const plate = {
      ...createPlayerState(1),
      gear: loadoutOf([
        uniquePiece(uniqueDefinition('monolith-plate')!, 'p'),
        piece('cape', 'silver'),
      ]),
    };
    expect(highestEquippedTier(plate)).toBe('dragon');
    const old = {
      ...createPlayerState(1),
      gear: { pieces: [{ id: 'a', slot: 'weapon' as const, power: 1 }], setBonus: 0 },
    };
    expect(highestEquippedTier(old)).toBeNull();
  });
});

describe('equipGear', () => {
  const owner = (pieces: GearPiece[], overrides: Partial<PlayerState> = {}): PlayerState => ({
    ...createPlayerState(1),
    xp: D2_XP[30]!,
    inventory: pieces,
    ...overrides,
  });

  it('wears an owned piece in its slot', () => {
    const sword = piece('weapon', 'iron');
    const result = equipGear(owner([sword, piece('body', 'iron')]), sword.id);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.player.gear.pieces).toEqual([sword]);
      expect(result.player.inventory?.map((entry) => entry.id)).toEqual(['body-iron']);
      expect(result.player.gear.setBonus).toBe(0);
    }
  });

  it('swaps: the piece that was worn goes back to the inventory', () => {
    const old = piece('weapon', 'leather');
    const next = piece('weapon', 'iron');
    const worn = owner([next], { gear: loadoutOf([old, piece('cape', 'leather')]) });
    const result = equipGear(worn, next.id);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.player.gear.pieces.map((entry) => entry.id).sort()).toEqual(
        ['cape-leather', 'weapon-iron'].sort(),
      );
      expect(result.player.inventory).toEqual([old]);
    }
  });

  it('completing a set earns the bonus, and a different tier takes it away', () => {
    const base = fullSet('leather').filter((entry) => entry.slot !== 'weapon');
    const start = owner([piece('weapon', 'leather'), piece('weapon', 'iron', 'iron-sword')], {
      gear: loadoutOf(base),
    });
    const full = equipGear(start, 'weapon-leather');
    expect(full.ok && full.player.gear.setBonus).toBe(0.25);
    const broken = full.ok ? equipGear(full.player, 'iron-sword') : full;
    expect(broken.ok && broken.player.gear.setBonus).toBe(0);
  });

  it('keeps the cape colour', () => {
    const sword = piece('weapon', 'leather');
    const result = equipGear(
      owner([sword], { gear: { pieces: [], setBonus: 0, capeColor: 'ash' } }),
      sword.id,
    );
    expect(result.ok && result.player.gear.capeColor).toBe('ash');
  });

  it('refuses a piece the player does not own, one already worn, a pet and a locked tier', () => {
    const worn = piece('weapon', 'iron');
    const player = owner([], { gear: loadoutOf([worn]) });
    expect(equipGear(player, 'nope')).toEqual({ ok: false, error: 'not_owned' });
    expect(equipGear(createPlayerState(1), 'nope')).toEqual({ ok: false, error: 'not_owned' });
    expect(equipGear(player, worn.id)).toEqual({ ok: false, error: 'already_equipped' });
    const pet = petPiece(petDefinition('owl')!);
    expect(equipGear(owner([pet]), pet.id)).toEqual({ ok: false, error: 'pet_slot' });
    const dragon = piece('weapon', 'dragon');
    expect(equipGear(owner([dragon], { xp: 0 }), dragon.id)).toEqual({
      ok: false,
      error: 'tier_locked',
    });
    expect(equipGear(owner([dragon], { xp: 0, renown: 64 }), dragon.id).ok).toBe(true);
  });

  it('a piece that predates tiers can always be worn', () => {
    const legacy: GearPiece = { id: 'legacy', slot: 'trinket', power: 0.3 };
    expect(equipGear(owner([legacy], { xp: 0 }), 'legacy').ok).toBe(true);
  });

  it('unequips back into the inventory; a pet just leaves its slot', () => {
    const sword = piece('weapon', 'iron');
    const pet = petPiece(petDefinition('owl')!);
    const player = owner([], { gear: loadoutOf([sword, pet]) });
    const off = unequipGear(player, 'weapon');
    expect(off.ok && off.player.inventory).toEqual([sword]);
    expect(off.ok && off.player.gear.pieces).toEqual([pet]);
    const petOff = unequipGear(player, 'pet');
    expect(petOff.ok && petOff.player.inventory).toEqual([]);
    expect(petOff.ok && petOff.player.gear.pieces).toEqual([sword]);
    expect(unequipGear(player, 'cape')).toEqual({ ok: false, error: 'nothing_equipped' });
    const bare = unequipGear({ ...createPlayerState(1), gear: loadoutOf([sword]) }, 'weapon');
    expect(bare.ok && bare.player.inventory).toEqual([sword]);
  });

  it('gear affects only events scored afterwards: equipping changes the next Power, not the last', () => {
    const player = owner([piece('weapon', 'iron')]);
    const before = computePower(player);
    const equipped = equipGear(player, 'weapon-iron');
    expect(before).toBe(1);
    expect(equipped.ok && computePower(equipped.player)).toBe(1.1);
  });
});

describe('wornPower', () => {
  it('is the pieces plus the set bonus, free of float noise, and 0 for nothing worn', () => {
    expect(wornPower([], 0)).toBe(0);
    expect(wornPower([piece('weapon', 'leather'), piece('body', 'iron')], 0)).toBe(0.15);
    const leather = WORN_SLOTS.map((slot) => piece(slot, 'leather'));
    expect(wornPower(leather, 0.25)).toBe(0.45);
    expect(wornPower([piece('weapon', 'leather')], 0.1)).toBe(0.15);
  });

  it('is the Gear line of gearPowerLines', () => {
    const worn = [piece('weapon', 'iron'), piece('body', 'iron')];
    const player: PlayerState = { ...createPlayerState(1), gear: loadoutOf(worn) };
    expect(gearPowerLines(player)).toEqual([
      { label: 'Gear', value: wornPower(worn, player.gear.setBonus), kind: 'power' },
    ]);
  });
});

describe('gear Power: Keen and Stout feed it conditionally', () => {
  const keen = piece('weapon', 'iron', 'k', 'keen');
  const stout = piece('body', 'iron', 's', 'stout');
  const player: PlayerState = { ...createPlayerState(1), gear: loadoutOf([keen, stout]) };

  it('baseline: the pieces and no conditional lines', () => {
    expect(gearPowerLines(player)).toEqual([{ label: 'Gear', value: 0.2, kind: 'power' }]);
    expect(gearPower(player)).toBe(0.2);
    expect(gearPowerLines(createPlayerState(1))).toEqual([]);
    expect(gearPower(createPlayerState(1))).toBe(0);
  });

  it('Keen adds 0.1 on a review, Stout 0.1 on a merge, and neither on anything else', () => {
    const review = gearPowerLines(player, powerCtx(reviewEvent('APPROVED')));
    expect(review.map((line) => [line.label, line.value])).toEqual([
      ['Gear', 0.2],
      ['Gear: Keen (review)', 0.1],
    ]);
    const merge = gearPowerLines(player, powerCtx(mergedEvent(mergedFacts())));
    expect(merge.map((line) => [line.label, line.value])).toEqual([
      ['Gear', 0.2],
      ['Gear: Stout (merge)', 0.1],
    ]);
    expect(gearPowerLines(player, powerCtx(openedEvent()))).toEqual([
      { label: 'Gear', value: 0.2, kind: 'power' },
    ]);
    expect(gearPower(player, powerCtx(reviewEvent('COMMENTED')))).toBe(0.3);
  });

  it('stacks per piece with a count in the label', () => {
    const two: PlayerState = {
      ...createPlayerState(1),
      gear: loadoutOf([keen, piece('cape', 'iron', 'k2', 'keen')]),
    };
    expect(gearPowerLines(two, powerCtx(reviewEvent('APPROVED'))).at(-1)).toEqual({
      label: 'Gear: Keen x2 (review)',
      value: 0.2,
      kind: 'power',
    });
  });

  it('an affix-only loadout still lists its conditional line (no zero Gear line)', () => {
    const free: PlayerState = {
      ...createPlayerState(1),
      gear: { pieces: [{ id: 'z', slot: 'weapon', power: 0, affix: 'keen' }], setBonus: 0 },
    };
    expect(gearPowerLines(free, powerCtx(reviewEvent('APPROVED')))).toEqual([
      { label: 'Gear: Keen (review)', value: 0.1, kind: 'power' },
    ]);
  });

  it('is wired into computePower and the Combat Log breakdown, with the cap staying at 9', () => {
    const event = reviewEvent('APPROVED');
    expect(computePower(player, powerCtx(event))).toBe(1.3);
    expect(powerBreakdown(player, powerCtx(event)).map((line) => line.label)).toEqual([
      'Base Power',
      'Gear',
      'Gear: Keen (review)',
    ]);
    // 1 + 4 (Charms at their budget) + 2.25 (a full Dragon set) + 0.5 (Feats) + the Leather Jacket's
    // 1.5 is 9.25: only a Mogul line can take the sources past 9.
    const base = createPlayerState(1);
    const capped: PlayerState = {
      ...base,
      charms: [charm(4)],
      gear: loadoutOf(fullSet('dragon')),
      feats: { unlocked: [], powerBonus: 0.5 },
      moguls: { ...base.moguls, current: 'leather-jacket', chain: 15 },
    };
    const context = powerCtx(reviewEvent('APPROVED'));
    expect(computePower(capped, context)).toBe(9);
    expect(powerBreakdown(capped, context).at(-1)).toEqual({
      label: 'Power cap',
      value: -0.25,
      kind: 'power',
    });
    expect(POWER_CAP).toBe(9);
  });

  it('holds gear to +2.25 even with Keen pieces on a review', () => {
    const dragon = fullSet('dragon').map((entry) => ({ ...entry, affix: 'keen' as const }));
    const maxed: PlayerState = { ...createPlayerState(1), gear: loadoutOf(dragon) };
    const lines = powerBreakdown(maxed, powerCtx(reviewEvent('APPROVED')));
    expect(lines.map((line) => [line.label, line.value])).toEqual([
      ['Base Power', 1],
      ['Gear', 2.25],
      ['Gear: Keen x5 (review)', 0.5],
      ['Gear cap', -0.5],
    ]);
    expect(computePower(maxed, powerCtx(reviewEvent('APPROVED')))).toBe(3.25);
  });

  it('a full Dragon set under the best Charms and Feats still ends at 9', () => {
    const all: PlayerState = {
      ...createPlayerState(1),
      charms: [charm(4)],
      gear: loadoutOf(fullSet('dragon')),
      feats: { unlocked: [], powerBonus: 0.5 },
      pledges: {
        played: [],
        progress: {},
        completed: [],
      },
    };
    // 1 + 4 + 2.25 + 0.5 = 7.75; with the Pledge budget of +1 it would be 8.75, still under 9. More
    // Charm Power than the +4 budget changes nothing.
    expect(computePower(all)).toBe(7.75);
    expect(computePower({ ...all, charms: [charm(5)] })).toBe(7.75);
    expect(computePower({ ...all, charms: [charm(6)] })).toBe(7.75);
    const pledged = { ...all, pledges: { ...all.pledges, completed: ['mentor', 'defend'] } };
    expect(computePower(pledged)).toBe(7.75 + 0.5);
    expect(computePower(pledged, powerCtx(reviewEvent('APPROVED')))).toBe(8.75);
  });
});
