import { ACT_CLEAR_GOLD, INTEREST, POINTS_PER_GOLD } from './constants';
import type { ActId } from './constants';
import type { CharmSale } from './charms';
import { interestCap } from './vouchers';
import type { PlayerState, Result, ScoreResult } from './types';

/**
 * Gold (Requirement 8.1 and 8.2). This is the ONLY module that changes a player's gold: every earn and
 * spend in the package goes through `applyGoldDelta`. A test scans the rest of `src` for gold writes.
 *
 * Gold comes from exactly four places: 1 per 10 points scored (floored per event), act-clear payouts
 * (Scout 20, Raid 40, Boss 100), interest at each act clear (1 per 25 held, capped), and selling Charms.
 * Under the Founder the first two are multiplied by 4 (`mogulGoldMultiplier`); interest is not.
 */

/** What the gold was for; kept on the ledger entry so the Combat Log and tests can say why. */
export type GoldReason =
  'points' | 'act_clear' | 'interest' | 'sell' | 'purchase' | 'reroll' | 'shrine';

/** One change to a player's gold. */
export interface GoldEntry {
  reason: GoldReason;
  delta: number;
  /** Gold after the change. */
  balance: number;
}

export type GoldError = 'invalid_amount' | 'insufficient_gold';

/** The wallet a new character starts with. */
export function startingWallet(): { gold: number } {
  return { gold: 0 };
}

/**
 * Add `delta` (negative to spend) to the gold of anything that holds some. Deltas must be whole numbers; a
 * spend larger than the balance fails with `insufficient_gold` and changes nothing.
 */
export function applyGoldDelta<T extends { readonly gold: number }>(
  player: T,
  delta: number,
  reason: GoldReason,
): Result<{ player: T; entry: GoldEntry }, GoldError> {
  if (!Number.isInteger(delta)) {
    return { ok: false, error: 'invalid_amount' };
  }
  const balance = player.gold + delta;
  if (balance < 0) {
    return { ok: false, error: 'insufficient_gold' };
  }
  return { ok: true, player: { ...player, gold: balance }, entry: { reason, delta, balance } };
}

/** Spend `price` gold (a whole number, 0 allowed): `applyGoldDelta` with a negative delta. */
export function spendGold<T extends { readonly gold: number }>(
  player: T,
  price: number,
  reason: GoldReason,
): Result<{ player: T; entry: GoldEntry }, GoldError> {
  return applyGoldDelta(player, 0 - price, reason);
}

/** A credit that cannot fail: the amount is clamped to a whole number of at least 0. */
function earn<T extends { readonly gold: number }>(
  player: T,
  amount: number,
  reason: GoldReason,
): { player: T; entry: GoldEntry } {
  const delta = Math.max(0, Math.floor(amount));
  const balance = player.gold + delta;
  return { player: { ...player, gold: balance }, entry: { reason, delta, balance } };
}

// ---------------------------------------------------------------------------------------------
// Earning
// ---------------------------------------------------------------------------------------------

/** Gold for an event's points: `floor(points / 10)`, then the Mogul multiplier (Founder x4). */
export function goldForPoints(points: number, multiplier: number = 1): number {
  return Math.floor(points / POINTS_PER_GOLD) * multiplier;
}

/** Credit a scored event's gold: its points, with the multiplier the scorer recorded on the result. */
export function creditScoreResult(
  player: PlayerState,
  result: Pick<ScoreResult, 'points' | 'goldMultiplier'>,
): { player: PlayerState; entry: GoldEntry } {
  return earn(player, goldForPoints(result.points, result.goldMultiplier), 'points');
}

/** The payout for clearing an act (20, 40, 100), times the Mogul multiplier. */
export function actClearPayout(act: ActId, multiplier: number = 1): number {
  return ACT_CLEAR_GOLD[act] * multiplier;
}

/** Interest on gold held: 1 per 25, capped at `cap` (10, or 20 with Deep Pockets). */
export function interestOn(held: number, cap: number = INTEREST.cap): number {
  return Math.min(cap, Math.floor(held / INTEREST.heldPerGold));
}

/**
 * Pay what an act clear earns: interest on the gold held at that moment (before the payout, as in
 * Balatro's cash-out), then the act's payout. Returns the new player and the two ledger entries.
 */
export function payActClear(
  player: PlayerState,
  act: ActId,
  multiplier: number = 1,
): { player: PlayerState; entries: GoldEntry[] } {
  const withInterest = earn(player, interestOn(player.gold, interestCap(player)), 'interest');
  const withPayout = earn(withInterest.player, actClearPayout(act, multiplier), 'act_clear');
  return { player: withPayout.player, entries: [withInterest.entry, withPayout.entry] };
}

/** Credit the proceeds of selling a Charm (a player's sale or an auto-sold third copy). */
export function creditSale(
  player: PlayerState,
  sale: Pick<CharmSale, 'proceeds'>,
): { player: PlayerState; entry: GoldEntry } {
  return earn(player, sale.proceeds, 'sell');
}
