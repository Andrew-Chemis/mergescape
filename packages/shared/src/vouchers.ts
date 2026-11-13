import {
  CHARM_SLOTS,
  CHARM_SLOTS_WITH_BELT,
  INTEREST,
  OVERCLOCK_ZONE_EXPONENT,
  SHOP,
  ZONE_EXPONENT,
} from './constants';
import { hasCharmEffect } from './charms';
import type { PlayerState, Result, Voucher, VoucherId } from './types';

/**
 * The six Vouchers (design.md 6.5, Requirement 9.5): permanent upgrades, each bought once. This module
 * defines them and reads their effects; buying one is `buyVoucher` in shop.ts, and the only effect that
 * changes stored state is Overclock's Zone exponent (applied by `applyVoucher`).
 */

export interface VoucherDefinition extends Voucher {
  description: string;
}

export const VOUCHERS: readonly VoucherDefinition[] = [
  { id: 'charm-belt', name: 'Charm Belt', description: 'A sixth Charm slot.' },
  {
    id: 'cheaper-rerolls',
    name: 'Cheaper Re-rolls',
    description: `Shop re-rolls start at ${SHOP.rerollBaseWithCheaperRerolls} gold instead of ${SHOP.rerollBase}.`,
  },
  {
    id: 'scouts-eye',
    name: "Scout's Eye",
    description: "See next week's Mogul before it arrives.",
  },
  {
    id: 'deep-pockets',
    name: 'Deep Pockets',
    description: `Interest at each act clear is capped at ${INTEREST.capWithDeepPockets} gold instead of ${INTEREST.cap}.`,
  },
  {
    id: 'shrine-pass',
    name: 'Shrine Pass',
    description: 'Remove Pledges from your deck at the shrine for free.',
  },
  {
    id: 'overclock',
    name: 'Overclock',
    description: `The Zone exponent rises from ${ZONE_EXPONENT} to ${OVERCLOCK_ZONE_EXPONENT} for every event scored after you buy it.`,
  },
];

const BY_ID: ReadonlyMap<string, VoucherDefinition> = new Map(
  VOUCHERS.map((voucher) => [voucher.id, voucher]),
);

export function voucherDefinition(id: string): VoucherDefinition | undefined {
  return BY_ID.get(id);
}

/** The shop-facing form of a definition (id and name). */
export function voucherOf(definition: VoucherDefinition): Voucher {
  return { id: definition.id, name: definition.name };
}

export function ownsVoucher(player: PlayerState, id: VoucherId): boolean {
  return player.vouchers.includes(id);
}

/** Vouchers the player can still buy, in catalogue order. */
export function unownedVouchers(player: PlayerState): VoucherDefinition[] {
  return VOUCHERS.filter((voucher) => !ownsVoucher(player, voucher.id));
}

/** 150 gold plus 50 for every Voucher already owned (Requirement 9.5). */
export function voucherPrice(player: PlayerState): number {
  return SHOP.voucherBase + SHOP.voucherStep * player.vouchers.length;
}

/** The Zone exponent a set of Vouchers implies: 1.65 with Overclock, otherwise 1.6. */
export function zoneExponentFor(vouchers: readonly VoucherId[]): number {
  return vouchers.includes('overclock') ? OVERCLOCK_ZONE_EXPONENT : ZONE_EXPONENT;
}

/**
 * Add a Voucher to the player. Overclock also sets `zoneExponent` to 1.65 on the player, so events
 * scored before the purchase keep their Zone and only later events use the new exponent (Requirement 9.6).
 * Gold is not touched here; `buyVoucher` in shop.ts pays for it.
 */
export function applyVoucher(
  player: PlayerState,
  id: VoucherId,
): Result<{ player: PlayerState }, 'already_owned'> {
  if (ownsVoucher(player, id)) {
    return { ok: false, error: 'already_owned' };
  }
  const vouchers = [...player.vouchers, id];
  return {
    ok: true,
    player: { ...player, vouchers, zoneExponent: zoneExponentFor(vouchers) },
  };
}

// ---------------------------------------------------------------------------------------------
// Effect readers
// ---------------------------------------------------------------------------------------------

/** Charm slots: 5, or 6 with the Charm Belt. */
export function charmSlotCount(player: PlayerState): number {
  return ownsVoucher(player, 'charm-belt') ? CHARM_SLOTS_WITH_BELT : CHARM_SLOTS;
}

/** Gold the interest at an act clear is capped at: 10, or 20 with Deep Pockets. */
export function interestCap(player: PlayerState): number {
  return ownsVoucher(player, 'deep-pockets') ? INTEREST.capWithDeepPockets : INTEREST.cap;
}

/** Gold the first re-roll of a visit costs. */
export function rerollBase(player: PlayerState): number {
  return ownsVoucher(player, 'cheaper-rerolls')
    ? SHOP.rerollBaseWithCheaperRerolls
    : SHOP.rerollBase;
}

/** Gold the shrine charges to remove a Pledge: 50, free with the Shrine Pass. */
export function shrineCost(player: PlayerState): number {
  return ownsVoucher(player, 'shrine-pass') ? 0 : SHOP.pledgeRemoval;
}

/**
 * True when the player may see next week's Mogul: the Scout's Eye voucher or the Oracle Charm. The Oracle
 * is data only; the backend asks this and reveals `moguls.bag[0]`.
 */
export function canSeeNextMogul(player: PlayerState): boolean {
  return ownsVoucher(player, 'scouts-eye') || hasCharmEffect(player, 'seesNextMogul');
}
