import {
  AFFIXES,
  AFFIX_RULES,
  EXPEDITION_HOURS,
  EXPEDITION_PLANS,
  EXPEDITION_RULES,
  FORAGE_PLAN,
  LOOT_KINDS,
  LOOT_WEIGHT_TOTAL,
  REGION_IDS,
  REGION_RULES,
  SHOP,
} from './constants';
import type { ExpeditionHours, LootKind, RegionId, RegionRules } from './constants';
import { HOUR_MS } from './calendar';
import { makeCharm } from './charms';
import { affixCount, makePiece, slotNoun, uniqueDefinition, uniquePiece, WORN_SLOTS } from './gear';
import { grantPet, petExpeditionReduction, petPackBonus } from './pets';
import type { Grant } from './shop';
import { drawDistinctCharms, grantCharm } from './shop';
import { deriveSeed, mulberry32, weightedPick } from './rng';
import { addSupplies, spendSupplies } from './supplies';
import type { Charm, ExpeditionState, GearPiece, LootItem, PlayerState, Result } from './types';

/**
 * Expeditions (game-design.md 6.2, Requirement 15): send the character to a region for 4, 12, 24 or 48 real
 * hours, paying Provisions, and receive a seeded loot roll on return. The seed is stored when the
 * expedition is sent; the loot is rolled from it on collection and stored, so a refresh never re-rolls.
 * Everything here is pure: the caller owns the clock (`now`, epoch milliseconds) and persistence.
 */

// ---------------------------------------------------------------------------------------------
// Regions
// ---------------------------------------------------------------------------------------------

export interface RegionDefinition extends RegionRules {
  id: RegionId;
  name: string;
  theme: string;
  /** What the region leans toward, as the Scriptorium's Index reveals it. */
  lean: string;
}

const REGION_TEXT: Readonly<Record<RegionId, { name: string; theme: string; lean: string }>> = {
  'koko-woods': {
    name: 'Koko Woods',
    theme: 'Starter forest, friendly',
    lean: 'Timber, Provisions, Leather gear',
  },
  'crossroads-of-wix': {
    name: 'Crossroads of Wix',
    theme: 'Trading post; every road from here',
    lean: 'Mixed, best Charm-pack odds',
  },
  'orrl-falls': {
    name: 'Orrl Falls',
    theme: 'Waterfall mines',
    lean: 'Ore, Iron gear',
  },
  silverhall: {
    name: 'Silverhall',
    theme: 'Abandoned dwarven hall',
    lean: 'Silver (crafting tier), Flux',
  },
  'koko-deep-woods': {
    name: 'Koko Deep Woods',
    theme: 'Night version of the starter forest',
    lean: 'Lore, Ink, Herald gear',
  },
  'mazu-deep': {
    name: 'Mazu Deep',
    theme: 'Sea trench, pressure',
    lean: 'Mithril, trinkets',
  },
  'quu-spire': {
    name: 'Quu Spire',
    theme: 'Tower that goes down, not up',
    lean: 'Rune, uniques',
  },
  'garbage-collector': {
    name: 'The Garbage Collector',
    theme: 'The Spire floor; it eats unreferenced things',
    lean: 'Dragon materials; the only source of Reclaimed uniques',
  },
};

/** The eight regions, in unlock order. */
export const REGIONS: readonly RegionDefinition[] = REGION_IDS.map((id) => ({
  id,
  ...REGION_RULES[id],
  ...REGION_TEXT[id],
}));

export function isRegionId(value: unknown): value is RegionId {
  return typeof value === 'string' && (REGION_IDS as readonly string[]).includes(value);
}

export function regionDefinition(id: RegionId): RegionDefinition {
  return REGIONS.find((region) => region.id === id) as RegionDefinition;
}

/** True when the player's Renown reaches the region's gate. */
export function regionUnlocked(player: Pick<PlayerState, 'renown'>, id: RegionId): boolean {
  return player.renown >= REGION_RULES[id].renown;
}

/** Every region with whether the player can be sent there now. */
export function regionList(
  player: Pick<PlayerState, 'renown'>,
): { region: RegionDefinition; unlocked: boolean }[] {
  return REGIONS.map((region) => ({ region, unlocked: regionUnlocked(player, region.id) }));
}

// ---------------------------------------------------------------------------------------------
// Durations, costs and yield
// ---------------------------------------------------------------------------------------------

/** A duration in hours, or `forage` for the free 4 h trip. */
export type ExpeditionChoice = ExpeditionHours | 'forage';

export function isExpeditionChoice(value: unknown): value is ExpeditionChoice {
  return value === 'forage' || (EXPEDITION_HOURS as readonly unknown[]).includes(value);
}

export interface ExpeditionPlan {
  choice: ExpeditionChoice;
  /** Nominal hours, before Quick gear and pet passives. */
  hours: ExpeditionHours;
  forage: boolean;
  /** Provisions paid: 1, 2, 4 or 6; the Forage is free. */
  provisions: number;
  /** Loot items rolled: 3 to 6. */
  items: number;
}

export function expeditionPlan(choice: ExpeditionChoice): ExpeditionPlan {
  if (choice === 'forage') {
    return {
      choice,
      hours: FORAGE_PLAN.hours,
      forage: true,
      provisions: FORAGE_PLAN.provisions,
      items: FORAGE_PLAN.items,
    };
  }
  return { choice, hours: choice, forage: false, ...EXPEDITION_PLANS[choice] };
}

/** Items per Provision of a paid trip: 3, 2, 1.25 and 1 for 4, 12, 24 and 48 hours (strictly falling). */
export function yieldPerProvision(hours: ExpeditionHours): number {
  const plan = EXPEDITION_PLANS[hours];
  return plan.items / plan.provisions;
}

/** Fraction an expedition is shortened by: 10% per Quick piece plus the equipped pet's passive, capped. */
export function durationReduction(player: Pick<PlayerState, 'gear'>): number {
  return Math.min(
    EXPEDITION_RULES.reductionCap,
    affixCount(player, 'quick') * AFFIX_RULES.quickReduction + petExpeditionReduction(player),
  );
}

/** Points of Charm-pack odds added to every roll: 5 per Lucky piece plus the pet's passive, capped. */
export function packOddsBonus(player: Pick<PlayerState, 'gear'>): number {
  return Math.min(
    EXPEDITION_RULES.packOddsCapPoints,
    affixCount(player, 'lucky') * AFFIX_RULES.luckyPackPoints + petPackBonus(player),
  );
}

/** How long a trip of `hours` takes this player, in milliseconds. */
export function expeditionDurationMs(
  player: Pick<PlayerState, 'gear'>,
  hours: ExpeditionHours,
): number {
  return Math.round(hours * HOUR_MS * (1 - durationReduction(player)));
}

// ---------------------------------------------------------------------------------------------
// Loot
// ---------------------------------------------------------------------------------------------

/**
 * Invented former owners of Reclaimed gear (game-design.md 6.2, Requirement 16.3). Every name is made up for
 * the game; none is a real person or a GitHub login. The Garbage Collector names one per Reclaimed piece.
 */
export const FORMER_OWNERS: readonly string[] = [
  'Ambrel of the Low Road',
  'Bessik the Unfiled',
  'Corvane Ashgrave',
  'Dunmar the Late',
  'Eskild Brightmoth',
  'Fenwyn of the Third Floor',
  'Gorrim the Forgotten Intern',
  'Halvard Quillmender',
  'Ilsabet the Uncommitted',
  'Jorrun Slatefoot',
  'Kestrin of the Dead Branch',
  'Lorwen the Orphaned',
  'Mirelle Tallowick',
  'Nobbin the Deprecated',
  'Ostrel Mapmender',
  'Pell the Third Cartographer',
  'Quillon Dross',
  'Rhosyn the Stale',
  'Sabeth of the Long Review',
  'Tamsin Wickerlow',
  'Ulrick the Detached',
  'Vesper Thornmarsh',
  'Wulfric the Merged',
  'Xanthe Rootwarden',
  'Yarrow the Squashed',
  'Zephra the Fixup',
  'Aldous Pennywhistle',
  'Brindle the Unreferenced',
  'Cobb Marrowgate',
  'Dagny of the Lost Fork',
  'Ewart Candlewick',
  'Fiora the Freshly Rebased',
  'Gwendolt the Patient',
  'Hobart Linnet',
  'Isolde the Stashed',
  'Jessamy Hollowell',
  'Kit the Cherry-Picker',
  'Lumen Ravelstone',
  'Morwenna of the Closed Tab',
  'Orwick the Stale-Branched',
];

/** A former owner drawn from the curated list with the given random source. */
export function formerOwner(random: () => number): string {
  return FORMER_OWNERS[Math.floor(random() * FORMER_OWNERS.length)] as string;
}

/**
 * The loot weights of a roll, per mille. Charm-pack odds rise by `packBonus` points (10 per mille each),
 * taken from the materials share. A Forage keeps only materials and gear.
 */
export function lootWeights(
  region: RegionId,
  packBonus: number,
  forage: boolean,
): Record<LootKind, number> {
  const base = REGION_RULES[region].weights;
  if (forage) {
    return { material: base.material, gear: base.gear, charm_pack: 0, pet: 0, unique: 0 };
  }
  const shift = Math.min(base.material, Math.max(0, packBonus) * (LOOT_WEIGHT_TOTAL / 100));
  return { ...base, material: base.material - shift, charm_pack: base.charm_pack + shift };
}

function pick<T>(items: readonly T[], random: () => number): T {
  return items[Math.floor(random() * items.length)] as T;
}

function rollItem(
  kind: LootKind,
  expedition: ExpeditionState,
  index: number,
  random: () => number,
): LootItem {
  const rules = REGION_RULES[expedition.region];
  const id = `x${expedition.sentAt.toString(36)}-${index}`;
  switch (kind) {
    case 'material': {
      const row = weightedPick(
        rules.materials.map((entry) => ({ value: entry, weight: entry.weight })),
        random,
      );
      const quantity = row.min + Math.floor(random() * (row.max - row.min + 1));
      return { kind, material: row.material, quantity };
    }
    case 'gear': {
      const slot = rules.gearSlot === 'any' ? pick(WORN_SLOTS, random) : rules.gearSlot;
      const affixed = random() * 100 < EXPEDITION_RULES.foundAffixPercent;
      const affix = pick(AFFIXES, random);
      return {
        kind,
        piece: makePiece({ id, slot, tier: rules.gearTier, affix: affixed ? affix : undefined }),
      };
    }
    case 'charm_pack':
      return { kind, seed: Math.floor(random() * 2 ** 32) };
    case 'pet':
      return { kind, petId: pick(rules.pets, random) };
    case 'unique': {
      if (rules.unique === 'reclaimed') {
        const slot = pick(WORN_SLOTS, random);
        const owner = formerOwner(random);
        return { kind, piece: reclaimedPiece(id, slot, owner) };
      }
      const definition = uniqueDefinition(rules.unique);
      return { kind, piece: uniquePiece(definition as NonNullable<typeof definition>, id) };
    }
  }
}

/** A Reclaimed piece: Dragon tier, named for its invented former owner. */
export function reclaimedPiece(id: string, slot: GearPiece['slot'], owner: string): GearPiece {
  return makePiece({
    id,
    slot,
    tier: 'dragon',
    name: `Reclaimed ${slotNoun(slot)}, once ${owner}'s`,
    unique: 'reclaimed',
    owner,
    ref: 'reclaimed',
  });
}

/**
 * Roll an expedition's loot: 3 to 6 items, each drawn from the region's rarity bands (materials, gear for
 * the region's lean slot, Charm packs, pets, uniques). A pure function of the stored seed, the region and
 * the duration, plus the Charm-pack bonus captured at send, so the same expedition always yields the same
 * loot. A Forage rolls materials and plain gear only. At the Crossroads each item has a 0.1% chance of
 * being the coin dated 7960 instead.
 */
export function rollLoot(expedition: ExpeditionState): LootItem[] {
  const plan = expeditionPlan(expedition.forage ? 'forage' : expedition.hours);
  const rules = REGION_RULES[expedition.region];
  const random = mulberry32(
    deriveSeed(expedition.seed, expedition.region, expedition.forage ? 'forage' : expedition.hours),
  );
  const weights = lootWeights(expedition.region, expedition.packBonus, expedition.forage);
  const bands = LOOT_KINDS.map((kind) => ({ value: kind, weight: weights[kind] }));
  const loot: LootItem[] = [];
  for (let index = 0; index < plan.items; index += 1) {
    if (
      rules.coin &&
      !expedition.forage &&
      random() * LOOT_WEIGHT_TOTAL < EXPEDITION_RULES.oldCoinPerMille
    ) {
      loot.push({ kind: 'coin', year: EXPEDITION_RULES.oldCoinYear });
    } else {
      loot.push(rollItem(weightedPick(bands, random), expedition, index, random));
    }
  }
  return loot;
}

/** The Flux paid in place of each duplicate pet is `EXPEDITION_RULES.duplicatePetFlux`. */
export interface LootApplied {
  player: PlayerState;
  /** Pet ids the player already owned, paid as Flux instead. */
  duplicatePets: string[];
}

/**
 * Put loot in the player's hands: materials into the satchel, gear and uniques into the inventory, Charm
 * packs into the unopened packs, new pets into the collection (a pet already owned pays Flux). The coin
 * dated 7960 changes nothing here; the Old Coin Feat reads it from the loot.
 */
export function applyLoot(player: PlayerState, loot: readonly LootItem[]): LootApplied {
  let next = player;
  const duplicatePets: string[] = [];
  for (const item of loot) {
    switch (item.kind) {
      case 'material':
        next = addSupplies(next, { [item.material]: item.quantity });
        break;
      case 'gear':
      case 'unique':
        next = { ...next, inventory: [...(next.inventory ?? []), item.piece] };
        break;
      case 'charm_pack':
        next = { ...next, charmPacks: [...(next.charmPacks ?? []), item.seed] };
        break;
      case 'pet': {
        const granted = grantPet(next, item.petId);
        if (granted.added) {
          next = granted.player;
        } else {
          duplicatePets.push(item.petId);
          next = addSupplies(next, { flux: EXPEDITION_RULES.duplicatePetFlux });
        }
        break;
      }
      case 'coin':
        break;
    }
  }
  return { player: next, duplicatePets };
}

// ---------------------------------------------------------------------------------------------
// Sending and collecting
// ---------------------------------------------------------------------------------------------

export type ExpeditionError =
  /** An expedition is still away. */
  | 'in_progress'
  /** The last expedition has returned but its loot is not collected. */
  | 'uncollected'
  | 'region_locked'
  | 'insufficient_provisions';

/** `away` until `returnsAt`, then `returned` until the loot is collected. */
export function expeditionStatus(
  expedition: ExpeditionState,
  now: number,
): 'away' | 'returned' | 'collected' {
  if (expedition.collected) {
    return 'collected';
  }
  return now < expedition.returnsAt ? 'away' : 'returned';
}

/**
 * Send the character on an expedition. One at a time: the previous one must be collected first. The region
 * must be unlocked by Renown, and Provisions are paid (1, 2, 4 or 6; the Forage is free). The expedition
 * stores a seed, so its loot is fixed from this moment. Quick gear and pet passives shorten the trip, and
 * Lucky gear and pet passives raise the Charm-pack odds; both are captured here and never re-read.
 *
 * @param seed an unsigned 32-bit seed for the roll. The backend should pass a random one; when omitted it
 *             is derived from the player, region, choice and `now`.
 */
export function sendExpedition(
  player: PlayerState,
  region: RegionId,
  choice: ExpeditionChoice,
  now: number,
  seed?: number,
): Result<{ player: PlayerState; expedition: ExpeditionState }, ExpeditionError> {
  const current = player.expedition;
  if (current !== undefined && current !== null && !current.collected) {
    return { ok: false, error: now < current.returnsAt ? 'in_progress' : 'uncollected' };
  }
  if (!regionUnlocked(player, region)) {
    return { ok: false, error: 'region_locked' };
  }
  const plan = expeditionPlan(choice);
  const paid = spendSupplies(player, { provisions: plan.provisions });
  if (!paid.ok) {
    return { ok: false, error: 'insufficient_provisions' };
  }
  const expedition: ExpeditionState = {
    region,
    hours: plan.hours,
    forage: plan.forage,
    sentAt: now,
    returnsAt: now + expeditionDurationMs(player, plan.hours),
    seed:
      seed === undefined
        ? deriveSeed(player.id, 'expedition', region, String(choice), now)
        : seed >>> 0,
    provisionsPaid: plan.provisions,
    packBonus: packOddsBonus(player),
    collected: false,
  };
  return { ok: true, player: { ...paid.player, expedition }, expedition };
}

export interface CollectedExpedition {
  player: PlayerState;
  /** The expedition with `collected` set and its `loot` stored. */
  expedition: ExpeditionState;
  loot: LootItem[];
  /** False when the expedition was already collected: nothing was granted a second time. */
  applied: boolean;
  duplicatePets: string[];
}

/**
 * Collect a returned expedition: roll its loot from the stored seed, store it on the expedition and put it
 * in the player's hands. Idempotent: collecting an expedition that is already collected returns the stored
 * loot with `applied` false and changes nothing, so a retried request never rolls or grants twice. An
 * expedition that has not yet returned fails with `not_returned`.
 */
export function collectExpedition(
  player: PlayerState,
  expedition: ExpeditionState,
  now: number,
): Result<CollectedExpedition, 'not_returned'> {
  if (expedition.collected) {
    return {
      ok: true,
      player,
      expedition,
      loot: expedition.loot ?? [],
      applied: false,
      duplicatePets: [],
    };
  }
  if (now < expedition.returnsAt) {
    return { ok: false, error: 'not_returned' };
  }
  const loot = rollLoot(expedition);
  const applied = applyLoot(player, loot);
  const collected: ExpeditionState = { ...expedition, collected: true, loot };
  return {
    ok: true,
    player: { ...applied.player, expedition: collected },
    expedition: collected,
    loot,
    applied: true,
    duplicatePets: applied.duplicatePets,
  };
}

// ---------------------------------------------------------------------------------------------
// Charm packs from loot
// ---------------------------------------------------------------------------------------------

/** The 3 Charms of an unopened loot pack: a pure function of the pack's seed. */
export function lootPackOptions(seed: number): Charm[] {
  return drawDistinctCharms(SHOP.packOptions, mulberry32(deriveSeed(seed, 'loot-pack'))).map(
    makeCharm,
  );
}

export type LootPackError = 'no_such_pack' | 'bad_option' | 'no_free_slot';

/**
 * Open the loot pack with `seed` and keep the Charm `charmId` (one of its 3 options). The pack is consumed
 * only when the Charm is granted; a full Charm bar leaves it unopened. A duplicate stacks or sells like
 * any Charm (see `grantCharm`).
 */
export function openLootPack(
  player: PlayerState,
  seed: number,
  charmId: string,
): Result<{ player: PlayerState; grant: Grant }, LootPackError> {
  const packs = player.charmPacks ?? [];
  const at = packs.indexOf(seed);
  if (at < 0) {
    return { ok: false, error: 'no_such_pack' };
  }
  const charm = lootPackOptions(seed).find((option) => option.id === charmId);
  if (charm === undefined) {
    return { ok: false, error: 'bad_option' };
  }
  const granted = grantCharm(player, charm);
  if (!granted.ok) {
    return granted;
  }
  const remaining = packs.filter((_, index) => index !== at);
  return {
    ok: true,
    player: { ...granted.player, charmPacks: remaining },
    grant: granted,
  };
}
