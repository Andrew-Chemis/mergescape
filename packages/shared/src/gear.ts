import { GEAR_TIER_RULES } from './constants';
import type { Affix, GearTier } from './constants';
import type { GearPiece, GearSlot, PlayerState } from './types';

/**
 * Gear (game-design.md 7.1, Requirement 16.1): the five slots, the tier ladder with Power per piece, the
 * catalogue of named uniques, and the helpers that build a piece. Equipping and the Power wiring are
 * further down this file.
 */

// ---------------------------------------------------------------------------------------------
// Slots and tiers
// ---------------------------------------------------------------------------------------------

/** The five slots, in display order. Pets live in the last (see pets.ts). */
export const GEAR_SLOTS: readonly GearSlot[] = ['weapon', 'body', 'cape', 'trinket', 'pet'];

/** The slots the Forge, Loom and Scriptorium and the expeditions make pieces for (everything but the pet). */
export const WORN_SLOTS: readonly GearSlot[] = ['weapon', 'body', 'cape', 'trinket'];

const SLOT_NOUNS: Readonly<Record<GearSlot, string>> = {
  weapon: 'Blade',
  body: 'Armour',
  cape: 'Cape',
  trinket: 'Trinket',
  pet: 'Companion',
};

const TIER_ADJECTIVES: Readonly<Record<GearTier, string>> = {
  leather: 'Leather',
  iron: 'Iron',
  silver: 'Silver',
  mithril: 'Mithril',
  rune: 'Rune',
  dragon: 'Dragon',
};

/** The noun a slot's pieces are named with ("Blade", "Armour", "Cape", "Trinket"). */
export function slotNoun(slot: GearSlot): string {
  return SLOT_NOUNS[slot];
}

/** Power of one piece of a tier (+0.05 Leather up to +0.40 Dragon). */
export function tierPower(tier: GearTier): number {
  return GEAR_TIER_RULES[tier].power;
}

/** The plain name of a crafted or found piece, for example "Iron Blade". */
export function gearName(tier: GearTier, slot: GearSlot): string {
  return `${TIER_ADJECTIVES[tier]} ${SLOT_NOUNS[slot]}`;
}

export interface PieceInput {
  id: string;
  slot: GearSlot;
  tier: GearTier;
  look?: GearTier;
  affix?: Affix;
  name?: string;
  unique?: GearPiece['unique'];
  owner?: string;
  ref?: string;
}

/** Build a piece; its Power is its tier's. Absent options stay absent so stored pieces stay small. */
export function makePiece(input: PieceInput): GearPiece {
  const piece: GearPiece = {
    id: input.id,
    slot: input.slot,
    power: tierPower(input.tier),
    tier: input.tier,
    name: input.name ?? gearName(input.tier, input.slot),
  };
  if (input.look !== undefined) {
    piece.look = input.look;
  }
  if (input.affix !== undefined) {
    piece.affix = input.affix;
  }
  if (input.unique !== undefined) {
    piece.unique = input.unique;
  }
  if (input.owner !== undefined) {
    piece.owner = input.owner;
  }
  if (input.ref !== undefined) {
    piece.ref = input.ref;
  }
  return piece;
}

/** Pieces carrying `affix` among those equipped. */
export function affixCount(player: Pick<PlayerState, 'gear'>, affix: Affix): number {
  return player.gear.pieces.filter((piece) => piece.affix === affix).length;
}

// ---------------------------------------------------------------------------------------------
// Named uniques
// ---------------------------------------------------------------------------------------------

export interface UniqueDefinition {
  id: string;
  name: string;
  slot: GearSlot;
  /** The tier whose Power the piece carries: a unique never has more than its slot's normal Power. */
  tier: GearTier;
  /** The tier it looks like, when it differs from `tier`. */
  look?: GearTier;
  affix?: Affix;
  /** `region` uniques come from expeditions; `feat` uniques are Feat rewards. */
  source: 'region' | 'feat';
  description: string;
}

export const UNIQUES: readonly UniqueDefinition[] = [
  // Region uniques (very rare expedition finds). The Garbage Collector gives Reclaimed gear instead.
  {
    id: 'fernblade',
    name: 'Fernblade',
    slot: 'weapon',
    tier: 'leather',
    source: 'region',
    description: 'A stick that has decided it is a sword. Koko Woods agrees.',
  },
  {
    id: 'pedlars-button',
    name: "Pedlar's Lucky Button",
    slot: 'trinket',
    tier: 'iron',
    affix: 'lucky',
    source: 'region',
    description: 'Sold at the Crossroads of Wix to at least four different travellers.',
  },
  {
    id: 'cascade-pick',
    name: 'Cascade Pick',
    slot: 'weapon',
    tier: 'iron',
    affix: 'stout',
    source: 'region',
    description: 'Still damp. The Orrl Falls keep trying to take it back.',
  },
  {
    id: 'hallkeepers-mail',
    name: "Hallkeeper's Mail",
    slot: 'body',
    tier: 'silver',
    source: 'region',
    description: 'Worn by whoever was left in charge of Silverhall.',
  },
  {
    id: 'moth-lantern-cloak',
    name: 'Moth-Lantern Cloak',
    slot: 'cape',
    tier: 'silver',
    source: 'region',
    description: 'Moths follow it. Moths are not a reliable escort.',
  },
  {
    id: 'pressure-pearl',
    name: 'Pressure Pearl',
    slot: 'trinket',
    tier: 'mithril',
    affix: 'keen',
    source: 'region',
    description: 'Formed under a weight you would not enjoy.',
  },
  {
    id: 'plumb-of-quu',
    name: 'Plumb-Bob of Quu',
    slot: 'weapon',
    tier: 'rune',
    source: 'region',
    description: 'The Quu Spire goes down, and this is how it knows.',
  },
  // Feat rewards (game-design.md 8.2).
  {
    id: 'monolith-plate',
    name: 'Monolith Plate',
    slot: 'body',
    tier: 'iron',
    look: 'dragon',
    source: 'feat',
    description: 'Looks like Dragon, weighs like Iron. Archivists get the view and the pension.',
  },
  {
    id: 'the-red-pen',
    name: 'The Red Pen',
    slot: 'weapon',
    tier: 'mithril',
    affix: 'stout',
    source: 'feat',
    description: 'For a hundred thousand lines nobody will miss.',
  },
  {
    id: 'streamers-cape',
    name: "Streamer's Cape",
    slot: 'cape',
    tier: 'silver',
    source: 'feat',
    description: 'Animated. Please do not merge a hundred a week on purpose.',
  },
  {
    id: 'scalpel',
    name: 'Scalpel',
    slot: 'weapon',
    tier: 'iron',
    affix: 'keen',
    source: 'feat',
    description: 'Small, sharp and always reviewed.',
  },
  {
    id: 'loupe',
    name: 'Loupe',
    slot: 'trinket',
    tier: 'iron',
    source: 'feat',
    description: 'For reading the line everyone scrolled past.',
  },
  {
    id: 'mentors-mantle',
    name: "Mentor's Mantle",
    slot: 'cape',
    tier: 'silver',
    source: 'feat',
    description: 'Warm, and slightly too big for whoever wears it next.',
  },
  {
    id: 'anniversary-cape',
    name: 'Anniversary Cape',
    slot: 'cape',
    tier: 'iron',
    source: 'feat',
    description: 'The trim changes every year. The wearer mostly does not.',
  },
  {
    id: 'three-headed-axe',
    name: 'Three-Headed Axe',
    slot: 'weapon',
    tier: 'silver',
    source: 'feat',
    description: 'Each head has an opinion about the rebase.',
  },
  {
    id: 'golden-parachute',
    name: 'Golden Parachute',
    slot: 'trinket',
    tier: 'mithril',
    source: 'feat',
    description: 'Opens late. Pays well.',
  },
  {
    id: 'hourglass-of-scope',
    name: 'Hourglass of Scope',
    slot: 'trinket',
    tier: 'leather',
    source: 'feat',
    description: 'We are sorry. It was a small change, once.',
  },
  {
    id: 'hermits-hood',
    name: "Hermit's Hood",
    slot: 'cape',
    tier: 'leather',
    source: 'feat',
    description: 'Fifty merges and nobody to hand it to. Cosy in here.',
  },
];

const UNIQUE_BY_ID: ReadonlyMap<string, UniqueDefinition> = new Map(
  UNIQUES.map((unique) => [unique.id, unique]),
);

export function uniqueDefinition(id: string): UniqueDefinition | undefined {
  return UNIQUE_BY_ID.get(id);
}

/** A concrete piece of a named unique. `id` must be unique among the player's gear. */
export function uniquePiece(definition: UniqueDefinition, id: string): GearPiece {
  return makePiece({
    id,
    slot: definition.slot,
    tier: definition.tier,
    look: definition.look,
    affix: definition.affix,
    name: definition.name,
    unique: definition.source,
    ref: definition.id,
  });
}
