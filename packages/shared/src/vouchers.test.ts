import { describe, expect, it } from 'vitest';
import { addCharm, freeCharmSlots } from './charms';
import { OVERCLOCK_ZONE_EXPONENT, ZONE_EXPONENT } from './constants';
import { score } from './score';
import { createPlayerState, createPRState } from './state';
import {
  AUTHOR_ID,
  facts,
  held,
  NOW,
  openedEvent,
  playerAtLevel,
  settledPlayer,
} from './test-builders';
import {
  applyVoucher,
  canSeeNextMogul,
  charmSlotCount,
  interestCap,
  ownsVoucher,
  rerollBase,
  shrineCost,
  unownedVouchers,
  VOUCHERS,
  voucherDefinition,
  voucherOf,
  voucherPrice,
  zoneExponentFor,
} from './vouchers';
import type { VoucherId } from './types';

function owning(...ids: VoucherId[]) {
  return { ...settledPlayer(AUTHOR_ID), vouchers: ids };
}

describe('the six Vouchers (design.md 6.5, Requirement 9.5)', () => {
  it('are exactly these six', () => {
    expect(VOUCHERS.map((voucher) => [voucher.id, voucher.name])).toEqual([
      ['charm-belt', 'Charm Belt'],
      ['cheaper-rerolls', 'Cheaper Re-rolls'],
      ['scouts-eye', "Scout's Eye"],
      ['deep-pockets', 'Deep Pockets'],
      ['shrine-pass', 'Shrine Pass'],
      ['overclock', 'Overclock'],
    ]);
    expect(voucherDefinition('overclock')?.description).toMatch(/1\.6.*1\.65/);
    expect(voucherDefinition('nope')).toBeUndefined();
    expect(voucherOf(voucherDefinition('overclock')!)).toEqual({
      id: 'overclock',
      name: 'Overclock',
    });
  });

  it('cost 150 plus 50 for each already owned', () => {
    const prices = [0, 1, 2, 3, 4, 5].map((owned) =>
      voucherPrice({ ...settledPlayer(), vouchers: VOUCHERS.slice(0, owned).map((v) => v.id) }),
    );
    expect(prices).toEqual([150, 200, 250, 300, 350, 400]);
  });

  it('each can be bought once', () => {
    const first = applyVoucher(settledPlayer(), 'charm-belt');
    expect(first.ok && first.player.vouchers).toEqual(['charm-belt']);
    const again = applyVoucher(owning('charm-belt'), 'charm-belt');
    expect(again).toEqual({ ok: false, error: 'already_owned' });
    expect(unownedVouchers(owning('charm-belt', 'overclock')).map((v) => v.id)).toEqual([
      'cheaper-rerolls',
      'scouts-eye',
      'deep-pockets',
      'shrine-pass',
    ]);
    expect(ownsVoucher(owning('shrine-pass'), 'shrine-pass')).toBe(true);
    expect(ownsVoucher(settledPlayer(), 'shrine-pass')).toBe(false);
  });
});

describe('effects', () => {
  it('Charm Belt: a sixth Charm slot', () => {
    expect(charmSlotCount(settledPlayer())).toBe(5);
    expect(charmSlotCount(owning('charm-belt'))).toBe(6);
    const full = {
      ...settledPlayer(),
      charms: (['rubber-duck', 'lantern', 'small-hands', 'hot-potato', 'grey-beard'] as const).map(
        (id) => held(id),
      ),
    };
    expect(freeCharmSlots(full)).toBe(0);
    expect(addCharm(full, held('oracle'))).toEqual({ ok: false, error: 'no_free_slot' });
    const belted = { ...full, vouchers: ['charm-belt' as const] };
    expect(freeCharmSlots(belted)).toBe(1);
    expect(addCharm(belted, held('oracle'))).toMatchObject({ ok: true, outcome: 'added' });
  });

  it('Cheaper Re-rolls: the first re-roll costs 10 instead of 20', () => {
    expect(rerollBase(settledPlayer())).toBe(20);
    expect(rerollBase(owning('cheaper-rerolls'))).toBe(10);
  });

  it("Scout's Eye and the Oracle Charm: see next week's Mogul", () => {
    expect(canSeeNextMogul(settledPlayer())).toBe(false);
    expect(canSeeNextMogul(owning('scouts-eye'))).toBe(true);
    expect(canSeeNextMogul({ ...settledPlayer(), charms: [held('oracle')] })).toBe(true);
    expect(canSeeNextMogul({ ...settledPlayer(), charms: [held('lantern')] })).toBe(false);
  });

  it('Deep Pockets: interest cap 20 instead of 10', () => {
    expect(interestCap(settledPlayer())).toBe(10);
    expect(interestCap(owning('deep-pockets'))).toBe(20);
  });

  it('Shrine Pass: Pledge removal is free instead of 50', () => {
    expect(shrineCost(settledPlayer())).toBe(50);
    expect(shrineCost(owning('shrine-pass'))).toBe(0);
  });

  it('Overclock: Zone exponent 1.65', () => {
    expect(zoneExponentFor([])).toBe(ZONE_EXPONENT);
    expect(zoneExponentFor(['charm-belt'])).toBe(ZONE_EXPONENT);
    expect(zoneExponentFor(['charm-belt', 'overclock'])).toBe(OVERCLOCK_ZONE_EXPONENT);
  });
});

describe('Overclock changes Zone only for events scored after the purchase (Requirement 9.6)', () => {
  it('sets the exponent on the player at purchase', () => {
    const before = createPlayerState(AUTHOR_ID);
    expect(before.zoneExponent).toBe(1.6);
    const bought = applyVoucher(before, 'overclock');
    expect(bought.ok && bought.player.zoneExponent).toBe(1.65);
    expect(before.zoneExponent).toBe(1.6);
    const other = applyVoucher(before, 'deep-pockets');
    expect(other.ok && other.player.zoneExponent).toBe(1.6);
  });

  it('an event scored before the purchase keeps its Zone; the next one uses 1.65', () => {
    const player = playerAtLevel(23, AUTHOR_ID);
    const pr = createPRState(facts());
    const earlier = score(openedEvent(), player, pr, NOW);
    const bought = applyVoucher(player, 'overclock');
    if (!bought.ok) throw new Error('expected a purchase');
    const later = score(openedEvent(), bought.player, pr, NOW);
    expect(earlier.zone).toBeCloseTo(Math.pow(24, 1.6), 9);
    expect(later.zone).toBeCloseTo(Math.pow(24, 1.65), 9);
    expect(later.zone).toBeGreaterThan(earlier.zone);
    // The earlier result is a value: buying afterwards cannot change it.
    expect(earlier.xp).toBe(Math.floor(10 * Math.pow(24, 1.6)));
  });
});
