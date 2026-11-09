import { FEAT_PET_IDS, PET_IDS } from './constants';
import type { GearTier, PetId, SupplyKind } from './constants';
import { makePiece } from './gear';
import { addSupplies } from './supplies';
import type { GearPiece, PlayerState, Supplies } from './types';

/**
 * Pets (game-design.md 7.3, Requirement 16.5). A pet fills the fifth gear slot and carries the slot Power of
 * its tier like any other piece. Each of the six v1 pets also has one small passive, and a passive may only
 * touch three things: the supplies banked, the length of an expedition, and the odds of a Charm pack in
 * loot. A passive never grants XP or gold, and it never changes a score. The five pets that only Feats
 * award are cosmetic and have no passive.
 *
 * A passive applies only while its pet is equipped.
 */

/** What a pet's passive does. The union is the whole list of things a passive is allowed to touch. */
export type PetPassive =
  /** Banks `amount` of one supply once a week, at the run rollover (`applyPetWeekly`). */
  | { kind: 'weekly_supply'; supply: SupplyKind; amount: number }
  /** Shortens every expedition by this fraction. */
  | { kind: 'expedition_time'; reduction: number }
  /** Adds this many points to the Charm-pack odds of every loot roll. */
  | { kind: 'pack_odds'; points: number };

export interface PetDefinition {
  id: PetId | (typeof FEAT_PET_IDS)[number];
  name: string;
  /** The slot Power it carries, as a piece of this tier. */
  tier: GearTier;
  /** One of the six v1 pets (as opposed to a Feat-only cosmetic pet). */
  core: boolean;
  passive: PetPassive | null;
  /** Player-facing text of the passive; empty when there is none. */
  passiveText: string;
  /** Where the pet comes from. */
  source: string;
  description: string;
}

export const PETS: readonly PetDefinition[] = [
  {
    id: 'linter-cat',
    name: 'Linter Cat',
    tier: 'leather',
    core: true,
    passive: { kind: 'weekly_supply', supply: 'ink', amount: 1 },
    passiveText: '+1 Ink each week.',
    source: 'Starter',
    description: 'Follows you. Has opinions about your semicolons.',
  },
  {
    id: 'rubber-duck',
    name: 'Rubber Duck',
    tier: 'leather',
    core: true,
    passive: { kind: 'weekly_supply', supply: 'lore', amount: 1 },
    passiveText: '+1 Lore each week.',
    source: 'Koko Woods, Crossroads of Wix',
    description: 'Literal. Listens to the whole explanation and never interrupts.',
  },
  {
    id: 'flaky-wisp',
    name: 'Flaky Wisp',
    tier: 'iron',
    core: true,
    passive: { kind: 'expedition_time', reduction: 0.05 },
    passiveText: 'Expeditions return 5% sooner, usually.',
    source: 'Crossroads of Wix, Orrl Falls, Silverhall, Mazu Deep',
    description: 'Passes through walls on most runs. Retry if it does not.',
  },
  {
    id: 'goblin-runt',
    name: 'Goblin Runt',
    tier: 'iron',
    core: true,
    passive: { kind: 'weekly_supply', supply: 'ore', amount: 2 },
    passiveText: '+2 Ore each week.',
    source: 'The Goblin Slayer Feat',
    description: 'The smallest of a thousand Merge Goblins. It kept the pickaxe.',
  },
  {
    id: 'garbage-collectors-mote',
    name: "Garbage Collector's Mote",
    tier: 'dragon',
    core: true,
    passive: { kind: 'weekly_supply', supply: 'flux', amount: 1 },
    passiveText: '+1 Flux each week.',
    source: 'The Garbage Collector',
    description: 'A speck of what the Spire ate. It remembers being referenced.',
  },
  {
    id: 'owl',
    name: 'Owl',
    tier: 'iron',
    core: true,
    passive: { kind: 'pack_odds', points: 3 },
    passiveText: '+3 points of Charm-pack odds on expeditions.',
    source: 'Koko Deep Woods, Quu Spire, Mazu Deep, or the Night Owl Feat',
    description: 'Wise, nocturnal and tired of your hours. Go to bed.',
  },
  {
    id: 'many-armed-goblin',
    name: 'Many-Armed Goblin',
    tier: 'silver',
    core: false,
    passive: null,
    passiveText: '',
    source: 'The Thousand-Hand Smith Feat',
    description: 'A goblin with a hand for every file. Cosmetic.',
  },
  {
    id: 'polyglot-parrot',
    name: 'Polyglot Parrot',
    tier: 'silver',
    core: false,
    passive: null,
    passiveText: '',
    source: 'The Omnilinguist Feat',
    description: 'Swears fluently in twelve repositories. Cosmetic.',
  },
  {
    id: 'hot-potato',
    name: 'Hot Potato',
    tier: 'leather',
    core: false,
    passive: null,
    passiveText: '',
    source: 'The Fast Hands Feat',
    description: 'Still warm. Somebody should look at it. Cosmetic.',
  },
  {
    id: 'pager-gremlin',
    name: 'Pager Gremlin',
    tier: 'leather',
    core: false,
    passive: null,
    passiveText: '',
    source: 'The Friday Deploy Feat',
    description: 'Wakes at 16:01 on a Friday. Cosmetic, and a warning.',
  },
  {
    id: 'coin-mote',
    name: 'Coin Mote',
    tier: 'silver',
    core: false,
    passive: null,
    passiveText: '',
    source: 'The Old Coin Feat',
    description: 'A spark of the coin dated 7960. Cosmetic.',
  },
];

const PET_BY_ID: ReadonlyMap<string, PetDefinition> = new Map(PETS.map((pet) => [pet.id, pet]));

/** The six v1 pets, in catalogue order. */
export const CORE_PETS: readonly PetDefinition[] = PETS.filter((pet) => pet.core);

/** Every character starts with the Linter Cat. */
export const STARTER_PETS: readonly string[] = ['linter-cat'];

export function petDefinition(id: string): PetDefinition | undefined {
  return PET_BY_ID.get(id);
}

export function isPetId(value: string): boolean {
  return PET_BY_ID.has(value);
}

/** The pet ids a player owns: the stored list, or the starter when nothing is stored. */
export function ownedPets(player: Pick<PlayerState, 'pets'>): readonly string[] {
  return player.pets ?? STARTER_PETS;
}

/** True when the player owns all six v1 pets (the Collector Feat). */
export function ownsEveryCorePet(player: Pick<PlayerState, 'pets'>): boolean {
  const owned = ownedPets(player);
  return PET_IDS.every((id) => owned.includes(id));
}

export type PetGrant = { player: PlayerState; added: boolean };

/**
 * Give the player a pet. A pet already owned is not added again (`added` false) so the caller can pay
 * something else instead; an id outside the catalogue is not added either.
 */
export function grantPet(player: PlayerState, petId: string): PetGrant {
  const owned = ownedPets(player);
  if (!isPetId(petId) || owned.includes(petId)) {
    return { player, added: false };
  }
  return { player: { ...player, pets: [...owned, petId] }, added: true };
}

/** The pet-slot piece for a pet: its tier's Power, with the pet's id as `ref`. */
export function petPiece(definition: PetDefinition): GearPiece {
  return makePiece({
    id: `pet-${definition.id}`,
    slot: 'pet',
    tier: definition.tier,
    name: definition.name,
    ref: definition.id,
  });
}

// ---------------------------------------------------------------------------------------------
// Passives
// ---------------------------------------------------------------------------------------------

/** The equipped pet's definition, or undefined when the pet slot is empty. */
export function equippedPet(player: Pick<PlayerState, 'gear'>): PetDefinition | undefined {
  const piece = player.gear.pieces.find((entry) => entry.slot === 'pet');
  return piece?.ref === undefined ? undefined : petDefinition(piece.ref);
}

/** The passive of the equipped pet, or null. */
export function activePassive(player: Pick<PlayerState, 'gear'>): PetPassive | null {
  return equippedPet(player)?.passive ?? null;
}

/** Fraction an equipped pet shortens expeditions by (0 for most pets). */
export function petExpeditionReduction(player: Pick<PlayerState, 'gear'>): number {
  const passive = activePassive(player);
  return passive?.kind === 'expedition_time' ? passive.reduction : 0;
}

/** Points of Charm-pack odds an equipped pet adds (0 for most pets). */
export function petPackBonus(player: Pick<PlayerState, 'gear'>): number {
  const passive = activePassive(player);
  return passive?.kind === 'pack_odds' ? passive.points : 0;
}

/** The supplies the equipped pet banks at each weekly rollover (empty for most pets). */
export function petWeeklySupplies(player: Pick<PlayerState, 'gear'>): Partial<Supplies> {
  const passive = activePassive(player);
  return passive?.kind === 'weekly_supply' ? { [passive.supply]: passive.amount } : {};
}

/** Bank the equipped pet's weekly supplies. Call once per run rollover. */
export function applyPetWeekly(player: PlayerState): PlayerState {
  return addSupplies(player, petWeeklySupplies(player));
}
