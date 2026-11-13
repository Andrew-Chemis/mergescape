import {
  AFFIX_ORDER,
  AFFIXES,
  BELLOWS_TIME_FACTOR,
  CAPE_COLORS,
  GEAR_TIERS,
  RECIPE_INPUTS,
  STATION_HOURS,
  STATION_IDS,
  STATION_SLOTS,
  STATION_UPGRADES,
} from './constants';
import type { Affix, CapeColor, GearTier, RegionId, StationId, UpgradeId } from './constants';
import { HOUR_MS } from './calendar';
import { regionDefinition } from './expeditions';
import { gearName, loadoutOf, makePiece, tierUnlocked } from './gear';
import { deriveSeed, mulberry32 } from './rng';
import { spendSupplies } from './supplies';
import type {
  ForgeJob,
  ForgeState,
  GearPiece,
  GearSlot,
  MaterialAmounts,
  PlayerState,
  Result,
} from './types';

/**
 * The Forge (game-design.md 7.2, Requirement 16.2, 16.3 and 16.6): three Town stations that turn supplies into
 * gear over real time. Each station runs one order at a time; a finished order waits in the station until
 * it is collected and nothing is lost. Everything here is pure: the caller owns the clock (`now`, epoch
 * milliseconds) and persistence (the `JOB#<station>` item holds a `ForgeJob`).
 *
 * | Station     | Makes                                  | Time          | Upgrade                              |
 * | Forge       | Weapon, Body                           | 2 h to 24 h   | Bellows (Flux x3): 25% less time     |
 * | Loom        | Cape                                   | 2 h to 24 h   | Dyes (Ink x10): cape colours         |
 * | Scriptorium | Trinket; rolls an affix onto a piece   | 4 h to 12 h   | Index (Lore x50): shows region leans |
 */

// ---------------------------------------------------------------------------------------------
// Recipes
// ---------------------------------------------------------------------------------------------

/** Make a piece of a slot and tier. */
export interface CraftRecipe {
  kind: 'craft';
  /** `<station>:<slot>:<tier>`, for example `forge:weapon:iron`. */
  id: string;
  station: StationId;
  name: string;
  slot: GearSlot;
  tier: GearTier;
  inputs: MaterialAmounts;
  /** Hours before the Bellows. */
  hours: number;
}

/** Roll an affix onto an owned piece (Flux; a piece that already has one costs more to re-roll). */
export interface AffixRecipe {
  kind: 'affix';
  id: 'scriptorium:affix';
  station: 'scriptorium';
  name: string;
  /** The base cost; re-rolling an existing affix costs `AFFIX_ORDER.rerollFlux` instead. */
  inputs: MaterialAmounts;
  hours: number;
}

export type Recipe = CraftRecipe | AffixRecipe;

function craftRecipes(): CraftRecipe[] {
  return STATION_IDS.flatMap((station) =>
    STATION_SLOTS[station].flatMap((slot) =>
      GEAR_TIERS.map((tier): CraftRecipe => ({
        kind: 'craft',
        id: `${station}:${slot}:${tier}`,
        station,
        name: gearName(tier, slot),
        slot,
        tier,
        inputs: { ...RECIPE_INPUTS[tier] },
        hours: STATION_HOURS[station][tier],
      })),
    ),
  );
}

export const AFFIX_RECIPE: AffixRecipe = {
  kind: 'affix',
  id: 'scriptorium:affix',
  station: 'scriptorium',
  name: 'Roll an affix',
  inputs: { flux: AFFIX_ORDER.flux },
  hours: AFFIX_ORDER.hours,
};

/** Every recipe: 12 at the Forge, 6 at the Loom, 6 and the affix order at the Scriptorium. */
export const RECIPES: readonly Recipe[] = [...craftRecipes(), AFFIX_RECIPE];

const RECIPE_BY_ID: ReadonlyMap<string, Recipe> = new Map(
  RECIPES.map((recipe) => [recipe.id, recipe]),
);

export function recipeDefinition(id: string): Recipe | undefined {
  return RECIPE_BY_ID.get(id);
}

export function recipesFor(station: StationId): Recipe[] {
  return RECIPES.filter((recipe) => recipe.station === station);
}

// ---------------------------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------------------------

/** The player's Forge: no orders and no upgrades when nothing is stored. */
export function forgeOf(player: Pick<PlayerState, 'forge'>): ForgeState {
  return player.forge ?? { stations: {}, upgrades: [] };
}

export function hasUpgrade(player: Pick<PlayerState, 'forge'>, upgrade: UpgradeId): boolean {
  return forgeOf(player).upgrades.includes(upgrade);
}

/** Hours a recipe takes this player: the Bellows cuts a quarter off every Forge order. */
export function recipeHours(player: Pick<PlayerState, 'forge'>, recipe: Recipe): number {
  return recipe.station === 'forge' && hasUpgrade(player, 'bellows')
    ? recipe.hours * BELLOWS_TIME_FACTOR
    : recipe.hours;
}

export function jobDurationMs(player: Pick<PlayerState, 'forge'>, recipe: Recipe): number {
  return Math.round(recipeHours(player, recipe) * HOUR_MS);
}

/** `free` (no order, or the last one collected), `working`, or `ready` to collect. */
export function stationStatus(
  player: Pick<PlayerState, 'forge'>,
  station: StationId,
  now: number,
): 'free' | 'working' | 'ready' {
  const job = forgeOf(player).stations[station];
  if (job === undefined || job.collected) {
    return 'free';
  }
  return now < job.doneAt ? 'working' : 'ready';
}

export type ForgeError =
  | 'unknown_recipe'
  /** The station has an order that is working or waiting to be collected. */
  | 'station_busy'
  /** The tier is not unlocked yet (its level, or the region that gives it). */
  | 'tier_locked'
  | 'insufficient_supplies'
  /** An affix order needs a piece from the inventory. */
  | 'piece_required'
  | 'piece_not_found'
  | 'no_job'
  | 'not_ready';

export interface StartOptions {
  /** The seed of the order; the backend should pass a random one. Derived from the player and clock when absent. */
  seed?: number;
  /** For an affix order: the inventory piece to work on. */
  pieceId?: string;
}

/**
 * Start an order at a station. The recipe must exist, the station must be free, the tier must be unlocked
 * and the inputs must be in the satchel; they are spent now. An affix order also takes a piece from the
 * inventory, which the station holds until collection. The order finishes `hours` later (25% sooner for
 * Forge orders with the Bellows).
 */
export function startJob(
  player: PlayerState,
  recipeId: string,
  now: number,
  options: StartOptions = {},
): Result<{ player: PlayerState; job: ForgeJob }, ForgeError> {
  const recipe = recipeDefinition(recipeId);
  if (recipe === undefined) {
    return { ok: false, error: 'unknown_recipe' };
  }
  if (stationStatus(player, recipe.station, now) !== 'free') {
    return { ok: false, error: 'station_busy' };
  }
  const inventory = player.inventory ?? [];
  let inputs = recipe.inputs;
  let held: GearPiece | undefined;
  if (recipe.kind === 'craft') {
    if (!tierUnlocked(player, recipe.tier)) {
      return { ok: false, error: 'tier_locked' };
    }
  } else {
    if (options.pieceId === undefined) {
      return { ok: false, error: 'piece_required' };
    }
    held = inventory.find((piece) => piece.id === options.pieceId);
    if (held === undefined) {
      return { ok: false, error: 'piece_not_found' };
    }
    inputs = { flux: held.affix === undefined ? AFFIX_ORDER.flux : AFFIX_ORDER.rerollFlux };
  }
  const paid = spendSupplies(player, inputs);
  if (!paid.ok) {
    return { ok: false, error: 'insufficient_supplies' };
  }
  const job: ForgeJob = {
    recipe: recipe.id,
    station: recipe.station,
    startedAt: now,
    doneAt: now + jobDurationMs(player, recipe),
    seed: options.seed ?? deriveSeed(player.id, 'forge', recipe.id, now),
    collected: false,
  };
  let next = paid.player;
  if (held !== undefined) {
    job.piece = held;
    next = { ...next, inventory: inventory.filter((piece) => piece.id !== held.id) };
  }
  const forge = forgeOf(player);
  return {
    ok: true,
    player: {
      ...next,
      forge: { ...forge, stations: { ...forge.stations, [recipe.station]: job } },
    },
    job,
  };
}

/** Roll an affix from a seed, never the one the piece already has. */
export function rollAffix(seed: number, current?: Affix): Affix {
  const pool = AFFIXES.filter((affix) => affix !== current);
  return pool[Math.floor(mulberry32(deriveSeed(seed, 'affix'))() * pool.length)] as Affix;
}

export interface CollectedJob {
  player: PlayerState;
  /** The order with `collected` set and its `output` stored. */
  job: ForgeJob;
  /** What the order made: a new piece, or the worked piece with its new affix. */
  piece: GearPiece;
  /** False when the order was already collected: nothing was granted a second time. */
  applied: boolean;
}

/**
 * Collect a finished order into the inventory. Idempotent: collecting an order that is already collected
 * returns the stored piece with `applied` false and changes nothing. Before `doneAt` it fails with
 * `not_ready`; a finished order waits for as long as it takes.
 */
export function collectJob(
  player: PlayerState,
  station: StationId,
  now: number,
): Result<CollectedJob, ForgeError> {
  const job = forgeOf(player).stations[station];
  if (job === undefined) {
    return { ok: false, error: 'no_job' };
  }
  if (job.collected) {
    return { ok: true, player, job, piece: job.output as GearPiece, applied: false };
  }
  if (now < job.doneAt) {
    return { ok: false, error: 'not_ready' };
  }
  const recipe = recipeDefinition(job.recipe) as Recipe;
  const worked = job.piece as GearPiece;
  const piece =
    recipe.kind === 'craft'
      ? makePiece({
          id: `forge-${station}-${job.startedAt.toString(36)}`,
          slot: recipe.slot,
          tier: recipe.tier,
        })
      : { ...worked, affix: rollAffix(job.seed, worked.affix) };
  const done: ForgeJob = { ...job, collected: true, output: piece };
  const forge = forgeOf(player);
  return {
    ok: true,
    player: {
      ...player,
      inventory: [...(player.inventory ?? []), piece],
      forge: { ...forge, stations: { ...forge.stations, [station]: done } },
    },
    job: done,
    piece,
    applied: true,
  };
}

// ---------------------------------------------------------------------------------------------
// Upgrades and dyes
// ---------------------------------------------------------------------------------------------

export type UpgradeError = 'already_owned' | 'insufficient_supplies';

/** Buy a station upgrade, once: Bellows (Flux x3), Dyes (Ink x10) or Index (Lore x50). */
export function buyUpgrade(
  player: PlayerState,
  upgrade: UpgradeId,
): Result<{ player: PlayerState }, UpgradeError> {
  if (hasUpgrade(player, upgrade)) {
    return { ok: false, error: 'already_owned' };
  }
  const paid = spendSupplies(player, STATION_UPGRADES[upgrade].cost);
  if (!paid.ok) {
    return { ok: false, error: 'insufficient_supplies' };
  }
  const forge = forgeOf(player);
  return {
    ok: true,
    player: { ...paid.player, forge: { ...forge, upgrades: [...forge.upgrades, upgrade] } },
  };
}

export function isCapeColor(value: unknown): value is CapeColor {
  return typeof value === 'string' && (CAPE_COLORS as readonly string[]).includes(value);
}

/** Choose the cape colour (cosmetic; needs the Dyes), or `null` for the natural cape. */
export function setCapeColor(
  player: PlayerState,
  color: CapeColor | null,
): Result<{ player: PlayerState }, 'dyes_missing'> {
  if (!hasUpgrade(player, 'dyes')) {
    return { ok: false, error: 'dyes_missing' };
  }
  return {
    ok: true,
    player: { ...player, gear: loadoutOf(player.gear.pieces, color ?? undefined) },
  };
}

/**
 * What a region leans toward, shown only with the Scriptorium's Index (game-design.md 7.2); null without it.
 */
export function regionLean(player: Pick<PlayerState, 'forge'>, region: RegionId): string | null {
  return hasUpgrade(player, 'index') ? regionDefinition(region).lean : null;
}
