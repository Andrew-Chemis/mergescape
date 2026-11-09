import {
  ACT_IDS,
  ACT_TARGET_FRACTION,
  BIOMES,
  FLAT_TARGET_XP,
  FREE_PLEDGE_PACK_ACT,
  LEGENDARY_OFFER_EVERY_RENOWN,
  MEDIAN_WEEKS,
  MIN_HISTORY_WEEKS,
  RENOWN_PER_BIOME,
  TARGET_MAX_PREVIOUS_MULTIPLE,
} from './constants';
import type { ActId } from './constants';
import { WEEK_MS } from './calendar';
import { payActClear } from './economy';
import type { GoldEntry } from './economy';
import { applyFounderBoard, mogulGoldMultiplier, selectMogul } from './moguls';
import type { BoardEvent } from './moguls';
import { drawHand } from './pledges';
import { deriveSeed } from './rng';
import { generateStock, legendaryOffer } from './shop';
import type { Charm, PackKind, PlayerState, RunState } from './types';

/**
 * The weekly run (Requirement 6, design.md 6.1): the ISO week key, act targets, starting a run at
 * rollover, clearing acts as weekly XP crosses their targets, Renown and the biome.
 */

// ---------------------------------------------------------------------------------------------
// Week key
// ---------------------------------------------------------------------------------------------

/**
 * ISO 8601 week key `yyyy-ww` of an instant, in UTC: weeks start Monday 00:00 UTC and belong to the year
 * that contains their Thursday. Monday 2026-11-09 is `2026-46`.
 */
export function isoWeekKey(now: number): string {
  const date = new Date(now);
  const sinceMonday = (date.getUTCDay() + 6) % 7;
  const thursday = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - sinceMonday + 3),
  );
  const yearStart = Date.UTC(thursday.getUTCFullYear(), 0, 1);
  const week = Math.floor((thursday.getTime() - yearStart) / WEEK_MS) + 1;
  return `${thursday.getUTCFullYear()}-${String(week).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------------------------
// Targets
// ---------------------------------------------------------------------------------------------

/** Median of a list of numbers (the mean of the middle two for an even count); 0 for an empty list. */
export function median(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] as number)
    : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
}

/**
 * Act targets for a new run (Requirement 6.2 to 6.4). `history` is the weekly XP of every closed week,
 * oldest first (zero weeks included).
 * - With fewer than 3 weeks of history the base is a flat 2,000 XP; otherwise it is the median of the
 *   last 8 weeks. A median of 0 (a long idle spell) also uses the flat base, because a target of 0 would
 *   be cleared by any single event.
 * - Scout, Raid and Boss are 60%, 100% and 150% of the base, rounded.
 * - No target exceeds 2x the previous week's actual XP, so a quiet week does not leave an impossible
 *   next one. A previous week of exactly 0 XP carries no cap, for the same reason as the median.
 */
export function actTargets(history: readonly number[]): Record<ActId, number> {
  const recentMedian = median(history.slice(-MEDIAN_WEEKS));
  const base =
    history.length < MIN_HISTORY_WEEKS || recentMedian <= 0 ? FLAT_TARGET_XP : recentMedian;
  const previous = history.at(-1) ?? 0;
  const ceiling = previous > 0 ? TARGET_MAX_PREVIOUS_MULTIPLE * previous : Infinity;
  const target = (act: ActId): number =>
    Math.min(Math.round(ACT_TARGET_FRACTION[act] * base), ceiling);
  return { scout: target('scout'), raid: target('raid'), boss: target('boss') };
}

// ---------------------------------------------------------------------------------------------
// Renown and biome
// ---------------------------------------------------------------------------------------------

/** The biome Town shows: changes every 8 Renown, in the order of `BIOMES`, staying on the last. */
export function biomeFor(renown: number): (typeof BIOMES)[number] {
  return BIOMES[
    Math.min(Math.floor(renown / RENOWN_PER_BIOME), BIOMES.length - 1)
  ] as (typeof BIOMES)[number];
}

// ---------------------------------------------------------------------------------------------
// Carrying week-scoped scorer state between the WEEK# item and the PlayerState
// ---------------------------------------------------------------------------------------------

/**
 * The player as the scorer should see them this week: the Mogul, the Leather Jacket chain, the played
 * Pledges with their progress, and Loaded Dice's charge, read from the run item. Call it after loading
 * the profile and the current run, before `score()`.
 */
export function playerWithRun(player: PlayerState, run: RunState): PlayerState {
  return {
    ...player,
    moguls: { ...player.moguls, current: run.mogul, chain: run.mogulChain ?? 0 },
    pledges: {
      played: run.played,
      progress: run.pledgeProgress ?? {},
      completed: run.pledgesCompleted ?? [],
    },
    week: { loadedDiceUsed: run.loadedDiceUsed ?? false },
  };
}

/** The run item with the week-scoped scorer state copied back from the player (after `applyScoreResult`). */
export function runWithPlayer(run: RunState, player: PlayerState): RunState {
  return {
    ...run,
    mogulChain: player.moguls.chain,
    pledgeProgress: { ...player.pledges.progress },
    pledgesCompleted: [...player.pledges.completed],
    loadedDiceUsed: player.week.loadedDiceUsed,
  };
}

/** Add XP to the run's weekly total. The backend does this with an atomic ADD; tests and previews use it. */
export function addWeeklyXp(run: RunState, xp: number): RunState {
  return { ...run, weeklyXp: run.weeklyXp + xp };
}

// ---------------------------------------------------------------------------------------------
// Starting a run (the Monday rollover)
// ---------------------------------------------------------------------------------------------

export interface StartRunInput {
  player: PlayerState;
  /** The rollover instant, epoch milliseconds (Monday 00:05 UTC). */
  now: number;
  /** A fresh random uint32 for the week. It is stored as `shopSeed` and every draw derives from it. */
  seed: number;
  /** Weekly XP of every closed week, oldest first. */
  history: readonly number[];
}

export interface StartRunResult {
  run: RunState;
  /** The player with the new Mogul, bag, empty Pledge progress and a fresh Loaded Dice charge. */
  player: PlayerState;
  /** A Charm the Founder's Board still held from last week comes back here. */
  boardEvents: BoardEvent[];
}

/**
 * Begin the week's run (Requirement 6.1): targets from the history, this week's Mogul drawn from the bag,
 * a hand of 5 Pledges drawn from the deck, and the seed stored for the shop. The run starts at the Scout
 * act with the shop closed. Deterministic in `seed`, so a retried rollover creates the same run.
 */
export function startRun(input: StartRunInput): StartRunResult {
  const { now, seed, history } = input;
  const weekKey = isoWeekKey(now);
  // Last week's Founder must not act in this week, so settle the Board with no current Mogul.
  const settled = applyFounderBoard(
    { ...input.player, moguls: { ...input.player.moguls, current: null } },
    weekKey,
    now,
    seed,
  );
  const drawn = selectMogul(settled.player.moguls.bag, deriveSeed(seed, 'mogul'));
  const run: RunState = {
    weekKey,
    act: ACT_IDS[0],
    clearedActs: [],
    weeklyXp: 0,
    targets: actTargets(history),
    mogul: drawn.mogul,
    hand: drawHand(settled.player.deck, deriveSeed(seed, 'hand')),
    played: [],
    shopSeed: seed,
    shop: null,
    loadedDiceUsed: false,
    mogulChain: 0,
    pledgeProgress: {},
    pledgesCompleted: [],
  };
  const withRun = playerWithRun(settled.player, run);
  return {
    run,
    player: { ...withRun, moguls: { ...withRun.moguls, bag: drawn.bag } },
    boardEvents: settled.events,
  };
}

// ---------------------------------------------------------------------------------------------
// Clearing acts
// ---------------------------------------------------------------------------------------------

export interface ActClear {
  act: ActId;
  /** The next act, or null after the Boss. */
  next: ActId | null;
  /** Interest, then the payout, in the order they were paid. */
  entries: GoldEntry[];
  /** Renown after this clear (unchanged unless the Boss cleared). */
  renown: number;
  /** A Legendary Charm offered on every 4th Renown point, or null. */
  legendary: Charm | null;
  /** A free pack granted by this clear (a Pledge pack after the Raid), or null. */
  freePack: PackKind | null;
}

/**
 * Clear the current act if weekly XP has reached its target (Requirement 6.5): pay interest and the act's
 * payout (x4 under the Founder), advance to the next act, open the shop, and on the Boss add 1 Renown and
 * offer a Legendary Charm every 4th. Returns null when the target is not reached or the run is over.
 *
 * At most one act clears per call, so acts are never skipped: call it once after each scored event adds
 * its XP to `run.weeklyXp`. If one event clears an act and the next target is already met too, the next
 * act clears on the next scored event. A week ending with an act uncleared costs nothing (Requirement 6.6).
 */
export function clearAct(
  run: RunState,
  player: PlayerState,
): { run: RunState; player: PlayerState; clear: ActClear } | null {
  const act = run.act;
  if (act === null || run.weeklyXp < run.targets[act]) {
    return null;
  }
  const paid = payActClear(player, act, mogulGoldMultiplier(run.mogul));
  const bossCleared = act === 'boss';
  const renown = paid.player.renown + (bossCleared ? 1 : 0);
  const cleared = { ...paid.player, renown };
  const clearedActs = [...run.clearedActs, act];
  const next = ACT_IDS[ACT_IDS.indexOf(act) + 1] ?? null;
  return {
    player: cleared,
    run: {
      ...run,
      act: next,
      clearedActs,
      shop: generateStock(cleared, run.shopSeed, clearedActs.length),
    },
    clear: {
      act,
      next,
      entries: paid.entries,
      renown,
      legendary:
        bossCleared && renown % LEGENDARY_OFFER_EVERY_RENOWN === 0
          ? legendaryOffer(deriveSeed(run.shopSeed, 'renown', renown))
          : null,
      freePack: act === FREE_PLEDGE_PACK_ACT ? 'pledge' : null,
    },
  };
}
