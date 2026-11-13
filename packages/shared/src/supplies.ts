import {
  AFFIX_RULES,
  MATERIAL_KINDS,
  SIZE_TIER_LOC,
  SUPPLY_DROPS,
  SUPPLY_KINDS,
} from './constants';
import type { SupplyKind } from './constants';
import { affixCount } from './gear';
import type { GameEvent, MaterialAmounts, PlayerState, Result, Satchel, Supplies } from './types';

/**
 * Supplies (game-design.md 6.1, Requirement 15.1 and 4.11): the drop table for each scored event, and the
 * satchel the drops are banked in. This is the ONE place the drop numbers are applied: `score()` calls the
 * functions below, and the backend banks `ScoreResult.supplies` with `addSupplies`.
 *
 * Drops depend on the event only. They never read Power, so no Charm can farm them.
 *
 * | Event                          | Drop                                              |
 * | merged PR                      | Ore x(1 + size tier 0 to 3), Timber x1            |
 * | merged PR with the party bonus | Provisions x2                                     |
 * | merged PR that was a Riposte   | Flux x1                                           |
 * | review (approve or changes)    | Lore x2                                           |
 * | review (comment)               | Lore x1                                           |
 * | inline comment                 | Ink x1, the first 5 per PR per reviewer           |
 * | first event of the UTC day     | Provisions x1                                     |
 */

// ---------------------------------------------------------------------------------------------
// Satchel
// ---------------------------------------------------------------------------------------------

/** Six supplies, all zero. */
export function emptySupplies(): Supplies {
  return { ore: 0, timber: 0, lore: 0, ink: 0, provisions: 0, flux: 0 };
}

/** A satchel with nothing in it. */
export function emptySatchel(): Satchel {
  return { ...emptySupplies(), silver: 0, mithril: 0, rune: 0, dragon: 0 };
}

/** What the player carries, with every material present (absent entries read as zero). */
export function satchelOf(player: Pick<PlayerState, 'satchel'>): Satchel {
  return { ...emptySatchel(), ...player.satchel };
}

function wholeAmount(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

/**
 * Bank `amounts` in the satchel. Banking cannot fail: amounts are clamped to whole numbers of at least
 * zero, and nothing is capped or decays. Pure; returns a new player.
 */
export function addSupplies<T extends Pick<PlayerState, 'satchel'>>(
  player: T,
  amounts: MaterialAmounts,
): T {
  const satchel = satchelOf(player);
  for (const kind of MATERIAL_KINDS) {
    satchel[kind] += wholeAmount(amounts[kind]);
  }
  return { ...player, satchel };
}

export type SupplyError = 'invalid_amount' | 'insufficient_supplies';

/** The part of `cost` the satchel cannot cover; empty when the player can afford it. */
export function missingSupplies(
  player: Pick<PlayerState, 'satchel'>,
  cost: MaterialAmounts,
): MaterialAmounts {
  const satchel = satchelOf(player);
  const missing: MaterialAmounts = {};
  for (const kind of MATERIAL_KINDS) {
    const short = wholeAmount(cost[kind]) - satchel[kind];
    if (short > 0) {
      missing[kind] = short;
    }
  }
  return missing;
}

/**
 * Spend `cost` from the satchel. Each amount must be a whole number of at least zero (`invalid_amount`),
 * and the satchel must hold all of it (`insufficient_supplies`); either failure changes nothing. Use
 * `missingSupplies` to say what is short.
 */
export function spendSupplies<T extends Pick<PlayerState, 'satchel'>>(
  player: T,
  cost: MaterialAmounts,
): Result<{ player: T; spent: MaterialAmounts }, SupplyError> {
  const asked = MATERIAL_KINDS.map((kind) => cost[kind]);
  if (asked.some((amount) => amount !== undefined && !(Number.isInteger(amount) && amount >= 0))) {
    return { ok: false, error: 'invalid_amount' };
  }
  if (Object.keys(missingSupplies(player, cost)).length > 0) {
    return { ok: false, error: 'insufficient_supplies' };
  }
  const satchel = satchelOf(player);
  const spent: MaterialAmounts = {};
  for (const kind of MATERIAL_KINDS) {
    const amount = wholeAmount(cost[kind]);
    if (amount > 0) {
      satchel[kind] -= amount;
      spent[kind] = amount;
    }
  }
  return { ok: true, player: { ...player, satchel }, spent };
}

// ---------------------------------------------------------------------------------------------
// The drop table
// ---------------------------------------------------------------------------------------------

/** Size tier 0 to 3 for the Ore drop: lines changed at or above 50, 300 and 1,000 each add one. */
export function sizeTier(linesChanged: number): number {
  return SIZE_TIER_LOC.filter((threshold) => linesChanged >= threshold).length;
}

/** What a scored merge drops: Ore by size tier, Timber, and Provisions and Flux for the party and Riposte. */
export function mergeDrop(input: {
  /** Additions plus deletions. */
  lines: number;
  /** At least one approval from another human (the party bonus). */
  party: boolean;
  /** Another human requested changes and the PR merged. */
  riposte: boolean;
}): Partial<Supplies> {
  const drop: Partial<Supplies> = {
    ore: SUPPLY_DROPS.mergeOreBase + sizeTier(input.lines),
    timber: SUPPLY_DROPS.mergeTimber,
  };
  if (input.party) {
    drop.provisions = SUPPLY_DROPS.partyProvisions;
  }
  if (input.riposte) {
    drop.flux = SUPPLY_DROPS.riposteFlux;
  }
  return drop;
}

/** Lore for a scored review: 2 for an approval or changes requested, 1 for a comment-only review. */
export function reviewDrop(decision: boolean): Partial<Supplies> {
  return { lore: decision ? SUPPLY_DROPS.reviewDecisionLore : SUPPLY_DROPS.reviewCommentLore };
}

/**
 * Ink for a scored inline comment. `inlineBefore` is how many inline comments the reviewer had left on
 * the PR before this one; the first 5 drop Ink and the rest (still scored, up to the points cap) drop none.
 */
export function inlineDrop(inlineBefore: number): Partial<Supplies> {
  return inlineBefore < SUPPLY_DROPS.inkCapPerPr ? { ink: SUPPLY_DROPS.inlineInk } : {};
}

/** The Provisions the first scored event of each UTC day drops. */
export function dailyFirstDrop(): Partial<Supplies> {
  return { provisions: SUPPLY_DROPS.dailyFirstProvisions };
}

/** The supply each kind of event is known for: the one a Hoarder piece adds to. */
const MAIN_SUPPLY: Readonly<Partial<Record<GameEvent['kind'], SupplyKind>>> = {
  pr_merged: 'ore',
  review_submitted: 'lore',
  review_comment_created: 'ink',
};

/**
 * What Hoarder gear adds to an event's drop: +1 of the event's main supply per Hoarder piece (Ore for a
 * merge, Lore for a review, Ink for an inline comment). It adds only where the event already dropped that
 * supply, so the Ink cap of 5 per PR still holds, and it never adds Provisions or Flux: the expedition
 * currency stays earned by merging with review and addressing feedback.
 */
export function hoarderDrop(
  player: Pick<PlayerState, 'gear'>,
  event: GameEvent,
  drop: Partial<Supplies>,
): Partial<Supplies> {
  const main = MAIN_SUPPLY[event.kind];
  const pieces = affixCount(player, 'hoarder');
  if (main === undefined || pieces === 0 || (drop[main] ?? 0) <= 0) {
    return {};
  }
  return { [main]: pieces * AFFIX_RULES.hoarderSupplies };
}

/** Add drops together into a full set of six supplies. */
export function sumSupplies(...drops: readonly Partial<Supplies>[]): Supplies {
  const total = emptySupplies();
  for (const drop of drops) {
    for (const kind of SUPPLY_KINDS) {
      total[kind] += drop[kind] ?? 0;
    }
  }
  return total;
}
