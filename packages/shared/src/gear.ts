import { AFFIX_RULES, GEAR_SET_BONUS, GEAR_TIER_RULES, GEAR_TIERS } from './constants';
import type { Affix, GearTier } from './constants';
import { levelFor } from './d2table';
import { tidy } from './math';
import type {
  BreakdownLine,
  GearLoadout,
  GearPiece,
  GearSlot,
  PlayerState,
  PowerContext,
  Result,
} from './types';

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

// ---------------------------------------------------------------------------------------------
// Loadout: tiers, the set bonus and equipping (Requirement 16.1 and 16.4)
// ---------------------------------------------------------------------------------------------

/**
 * True when the player can wear a tier: they have reached its level, or the region that gives it (Silver
 * from Silverhall at Renown 16, Dragon from The Garbage Collector at Renown 64).
 */
export function tierUnlocked(player: Pick<PlayerState, 'xp' | 'renown'>, tier: GearTier): boolean {
  const rules = GEAR_TIER_RULES[tier];
  return (
    levelFor(player.xp) >= rules.unlockLevel ||
    (rules.unlockRenown !== null && player.renown >= rules.unlockRenown)
  );
}

/**
 * The full-set bonus of a set of pieces: +0.25 when all five slots are filled by pieces of one tier (the
 * tier whose Power each carries, so a Monolith Plate counts as Iron), otherwise 0.
 */
export function setBonusFor(pieces: readonly GearPiece[]): number {
  const tiers = new Set(pieces.map((piece) => piece.tier));
  const slots = new Set(pieces.map((piece) => piece.slot));
  const full = GEAR_SLOTS.every((slot) => slots.has(slot));
  return full && tiers.size === 1 && !tiers.has(undefined) ? GEAR_SET_BONUS : 0;
}

/** A loadout for these pieces, with the set bonus worked out; `capeColor` is kept when given. */
export function loadoutOf(pieces: readonly GearPiece[], capeColor?: string): GearLoadout {
  const loadout: GearLoadout = { pieces, setBonus: setBonusFor(pieces) };
  if (capeColor !== undefined) {
    loadout.capeColor = capeColor;
  }
  return loadout;
}

/** The highest tier the character looks like, for the sprite (a Monolith Plate looks like Dragon). */
export function highestEquippedTier(player: Pick<PlayerState, 'gear'>): GearTier | null {
  let best = -1;
  for (const piece of player.gear.pieces) {
    const tier = piece.look ?? piece.tier;
    best = tier === undefined ? best : Math.max(best, GEAR_TIERS.indexOf(tier));
  }
  return GEAR_TIERS[best] ?? null;
}

export type EquipError = 'not_owned' | 'already_equipped' | 'pet_slot' | 'tier_locked';

/**
 * Equip a piece from the inventory into its slot. The piece must be owned and not already worn, must not
 * be a pet (use `equipPet`), and its tier must be unlocked. A piece already in the slot goes back to the
 * inventory. The set bonus is recomputed; the Power counts for events scored afterwards only.
 */
export function equipGear(
  player: PlayerState,
  pieceId: string,
): Result<{ player: PlayerState }, EquipError> {
  const inventory = player.inventory ?? [];
  const piece = inventory.find((entry) => entry.id === pieceId);
  if (piece === undefined) {
    return {
      ok: false,
      error: player.gear.pieces.some((entry) => entry.id === pieceId)
        ? 'already_equipped'
        : 'not_owned',
    };
  }
  if (piece.slot === 'pet') {
    return { ok: false, error: 'pet_slot' };
  }
  if (piece.tier !== undefined && !tierUnlocked(player, piece.tier)) {
    return { ok: false, error: 'tier_locked' };
  }
  const replaced = player.gear.pieces.find((entry) => entry.slot === piece.slot);
  const worn = [...player.gear.pieces.filter((entry) => entry.slot !== piece.slot), piece];
  const kept = inventory.filter((entry) => entry.id !== pieceId);
  return {
    ok: true,
    player: {
      ...player,
      gear: loadoutOf(worn, player.gear.capeColor),
      inventory: replaced === undefined ? kept : [...kept, replaced],
    },
  };
}

/** Take the piece in a slot off and put it back in the inventory (a pet simply leaves the slot). */
export function unequipGear(
  player: PlayerState,
  slot: GearSlot,
): Result<{ player: PlayerState }, 'nothing_equipped'> {
  const piece = player.gear.pieces.find((entry) => entry.slot === slot);
  if (piece === undefined) {
    return { ok: false, error: 'nothing_equipped' };
  }
  const worn = player.gear.pieces.filter((entry) => entry.slot !== slot);
  return {
    ok: true,
    player: {
      ...player,
      gear: loadoutOf(worn, player.gear.capeColor),
      inventory: slot === 'pet' ? player.inventory : [...(player.inventory ?? []), piece],
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Power (Requirement 4.5)
// ---------------------------------------------------------------------------------------------

/**
 * The gear terms of Power as Combat Log lines. "Gear" is the unconditional line: every equipped piece plus
 * the set bonus. With an event context, Keen pieces add +0.1 each on a review and Stout pieces +0.1 each on
 * a merge, as lines of their own. Terms that are zero are omitted.
 */
export function gearPowerLines(player: PlayerState, ctx?: PowerContext): BreakdownLine[] {
  const base = tidy(
    player.gear.pieces.reduce((sum, piece) => sum + piece.power, 0) + player.gear.setBonus,
  );
  const lines: BreakdownLine[] = [];
  if (base !== 0) {
    lines.push({ label: 'Gear', value: base, kind: 'power' });
  }
  if (ctx !== undefined) {
    const conditional: [Affix, string, string, boolean, number][] = [
      ['keen', 'Keen', 'review', ctx.event.kind === 'review_submitted', AFFIX_RULES.keenPower],
      ['stout', 'Stout', 'merge', ctx.event.kind === 'pr_merged', AFFIX_RULES.stoutPower],
    ];
    for (const [affix, name, when, applies, power] of conditional) {
      const count = applies ? affixCount(player, affix) : 0;
      if (count > 0) {
        const label = count > 1 ? `${name} x${count}` : name;
        lines.push({
          label: `Gear: ${label} (${when})`,
          value: tidy(power * count),
          kind: 'power',
        });
      }
    }
  }
  return lines;
}

/** The Power gear contributes to an event (0 with nothing equipped): the sum of `gearPowerLines`. */
export function gearPower(player: PlayerState, ctx?: PowerContext): number {
  return tidy(gearPowerLines(player, ctx).reduce((sum, line) => sum + line.value, 0));
}
