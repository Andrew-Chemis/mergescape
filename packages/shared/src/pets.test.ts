import { describe, expect, it } from 'vitest';
import { FEAT_PET_IDS, PET_IDS } from './constants';
import { durationReduction, packOddsBonus } from './expeditions';
import { loadoutOf, makePiece } from './gear';
import {
  activePassive,
  applyPetWeekly,
  CORE_PETS,
  equipPet,
  equippedPet,
  grantPet,
  isPetId,
  ownedPets,
  ownsEveryCorePet,
  petDefinition,
  petExpeditionReduction,
  PETS,
  petPackBonus,
  petPiece,
  petWeeklySupplies,
  STARTER_PETS,
} from './pets';
import { computePower } from './power';
import { createPlayerState } from './state';
import { emptySatchel, satchelOf } from './supplies';
import type { PlayerState } from './types';

function withPet(petId: string): PlayerState {
  const definition = petDefinition(petId)!;
  return {
    ...createPlayerState(1),
    gear: { pieces: [petPiece(definition)], setBonus: 0 },
  };
}

describe('the pets (game-design.md 7.3, Requirement 16.5)', () => {
  it('there are six v1 pets with the listed names, plus five cosmetic Feat pets', () => {
    expect(CORE_PETS.map((pet) => pet.name)).toEqual([
      'Linter Cat',
      'Rubber Duck',
      'Flaky Wisp',
      'Goblin Runt',
      "Garbage Collector's Mote",
      'Owl',
    ]);
    expect(CORE_PETS.map((pet) => pet.id)).toEqual([...PET_IDS]);
    expect(PETS.filter((pet) => !pet.core).map((pet) => pet.id)).toEqual([...FEAT_PET_IDS]);
    expect(new Set(PETS.map((pet) => pet.id)).size).toBe(PETS.length);
  });

  it('every v1 pet has one small passive; the Feat pets have none', () => {
    for (const pet of CORE_PETS) {
      expect(pet.passive, pet.id).not.toBeNull();
      expect(pet.passiveText, pet.id).not.toBe('');
    }
    for (const pet of PETS.filter((entry) => !entry.core)) {
      expect(pet.passive, pet.id).toBeNull();
      expect(pet.passiveText).toBe('');
    }
  });

  it('a passive may only touch supplies, expedition duration or pack odds (never XP or gold)', () => {
    const kinds = new Set<string>();
    for (const pet of CORE_PETS) {
      const passive = pet.passive!;
      kinds.add(passive.kind);
      expect(['weekly_supply', 'expedition_time', 'pack_odds']).toContain(passive.kind);
      // The only fields a passive has are the ones those three effects need.
      expect(Object.keys(passive).sort()).toEqual(
        {
          weekly_supply: ['amount', 'kind', 'supply'],
          expedition_time: ['kind', 'reduction'],
          pack_odds: ['kind', 'points'],
        }[passive.kind],
      );
    }
    expect([...kinds].sort()).toEqual(['expedition_time', 'pack_odds', 'weekly_supply']);
    // Small: weekly supplies of 1 or 2, under 10% faster, a few points of odds.
    expect(petDefinition('linter-cat')!.passive).toEqual({
      kind: 'weekly_supply',
      supply: 'ink',
      amount: 1,
    });
    expect(petDefinition('flaky-wisp')!.passive).toEqual({
      kind: 'expedition_time',
      reduction: 0.05,
    });
    expect(petDefinition('owl')!.passive).toEqual({ kind: 'pack_odds', points: 3 });
  });

  it('knows its catalogue', () => {
    expect(isPetId('owl')).toBe(true);
    expect(isPetId('coin-mote')).toBe(true);
    expect(isPetId('dog')).toBe(false);
    expect(petDefinition('dog')).toBeUndefined();
  });
});

describe('owning pets', () => {
  it('a new character owns the Linter Cat', () => {
    expect(ownedPets(createPlayerState(1))).toEqual(STARTER_PETS);
    expect('pets' in createPlayerState(1)).toBe(false);
    expect(ownsEveryCorePet(createPlayerState(1))).toBe(false);
  });

  it('granting adds a pet once and ignores duplicates and unknown ids', () => {
    const player = createPlayerState(1);
    const duck = grantPet(player, 'rubber-duck');
    expect(duck.added).toBe(true);
    expect(duck.player.pets).toEqual(['linter-cat', 'rubber-duck']);
    expect(grantPet(duck.player, 'rubber-duck')).toEqual({ player: duck.player, added: false });
    expect(grantPet(player, 'linter-cat').added).toBe(false);
    expect(grantPet(player, 'dog')).toEqual({ player, added: false });
  });

  it('owning every v1 pet is the Collector test; Feat pets do not count', () => {
    let player = createPlayerState(1);
    for (const id of PET_IDS) {
      expect(ownsEveryCorePet(player)).toBe(false);
      player = grantPet(player, id).player;
    }
    expect(ownsEveryCorePet(player)).toBe(true);
    expect(ownsEveryCorePet({ pets: [...PET_IDS.slice(1)] })).toBe(false);
    expect(ownsEveryCorePet({ pets: [...FEAT_PET_IDS] })).toBe(false);
  });

  it('a pet piece carries the Power of its tier and points back at the pet', () => {
    expect(petPiece(petDefinition('linter-cat')!)).toMatchObject({
      slot: 'pet',
      power: 0.05,
      tier: 'leather',
      ref: 'linter-cat',
      name: 'Linter Cat',
    });
    expect(petPiece(petDefinition('garbage-collectors-mote')!).power).toBe(0.4);
    expect(petPiece(petDefinition('owl')!).power).toBe(0.1);
  });
});

describe('passives only apply while the pet is equipped', () => {
  it('an empty pet slot has no passive', () => {
    const player = createPlayerState(1);
    expect(equippedPet(player)).toBeUndefined();
    expect(activePassive(player)).toBeNull();
    expect(petWeeklySupplies(player)).toEqual({});
    expect(petExpeditionReduction(player)).toBe(0);
    expect(petPackBonus(player)).toBe(0);
  });

  it('a pet-slot piece that points at nothing known has no passive', () => {
    const player: PlayerState = {
      ...createPlayerState(1),
      gear: { pieces: [{ id: 'p', slot: 'pet', power: 0.05 }], setBonus: 0 },
    };
    expect(equippedPet(player)).toBeUndefined();
    expect(activePassive(player)).toBeNull();
  });

  it('a Feat pet equips without a passive', () => {
    const player = withPet('hot-potato');
    expect(equippedPet(player)?.name).toBe('Hot Potato');
    expect(activePassive(player)).toBeNull();
    expect(petWeeklySupplies(player)).toEqual({});
  });

  it('the Linter Cat banks 1 Ink each week and changes nothing else', () => {
    const cat = withPet('linter-cat');
    expect(petWeeklySupplies(cat)).toEqual({ ink: 1 });
    const week1 = applyPetWeekly({ ...cat, xp: 500, gold: 12 });
    const week2 = applyPetWeekly(week1);
    expect(satchelOf(week2).ink).toBe(2);
    expect(week2.xp).toBe(500);
    expect(week2.gold).toBe(12);
    expect({ ...satchelOf(week2), ink: 0 }).toEqual(emptySatchel());
  });

  it('the other weekly pets bank their supply', () => {
    expect(petWeeklySupplies(withPet('rubber-duck'))).toEqual({ lore: 1 });
    expect(petWeeklySupplies(withPet('goblin-runt'))).toEqual({ ore: 2 });
    expect(petWeeklySupplies(withPet('garbage-collectors-mote'))).toEqual({ flux: 1 });
    expect(petWeeklySupplies(withPet('flaky-wisp'))).toEqual({});
  });

  it('the Flaky Wisp shortens expeditions and the Owl raises Charm-pack odds', () => {
    expect(petExpeditionReduction(withPet('flaky-wisp'))).toBe(0.05);
    expect(durationReduction(withPet('flaky-wisp'))).toBe(0.05);
    expect(petPackBonus(withPet('owl'))).toBe(3);
    expect(packOddsBonus(withPet('owl'))).toBe(3);
    expect(petPackBonus(withPet('flaky-wisp'))).toBe(0);
    expect(petExpeditionReduction(withPet('owl'))).toBe(0);
  });
});

describe('equipPet', () => {
  it('puts an owned pet in the pet slot with its passive and tier Power', () => {
    const player = createPlayerState(1);
    const equipped = equipPet(player, 'linter-cat');
    expect(equipped.ok).toBe(true);
    if (equipped.ok) {
      expect(equipped.player.gear.pieces).toEqual([petPiece(petDefinition('linter-cat')!)]);
      expect(petWeeklySupplies(equipped.player)).toEqual({ ink: 1 });
      expect(computePower(equipped.player)).toBe(1.05);
    }
  });

  it('replaces the pet already there and keeps the rest of the loadout', () => {
    const sword = makePiece({ id: 'w', slot: 'weapon', tier: 'leather' });
    const start: PlayerState = {
      ...grantPet(createPlayerState(1), 'rubber-duck').player,
      gear: loadoutOf([sword, petPiece(petDefinition('linter-cat')!)], 'azure'),
    };
    const swapped = equipPet(start, 'rubber-duck');
    expect(swapped.ok).toBe(true);
    if (swapped.ok) {
      expect(swapped.player.gear.pieces.map((piece) => piece.id)).toEqual(['w', 'pet-rubber-duck']);
      expect(swapped.player.gear.capeColor).toBe('azure');
    }
  });

  it('refuses a pet the player does not own, an unknown id, and a tier not yet unlocked', () => {
    const player = createPlayerState(1);
    expect(equipPet(player, 'owl')).toEqual({ ok: false, error: 'not_owned' });
    expect(equipPet(player, 'dog')).toEqual({ ok: false, error: 'not_owned' });
    const mote: PlayerState = grantPet(player, 'garbage-collectors-mote').player;
    expect(equipPet(mote, 'garbage-collectors-mote')).toEqual({ ok: false, error: 'tier_locked' });
    expect(equipPet({ ...mote, renown: 64 }, 'garbage-collectors-mote').ok).toBe(true);
  });
});
