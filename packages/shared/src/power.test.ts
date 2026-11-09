import { describe, expect, it } from 'vitest';
import { computePower, powerBreakdown } from './power';
import { createPlayerState } from './state';
import { charm } from './test-builders';

describe('computePower', () => {
  it('is 1 for a new character', () => {
    const player = createPlayerState(1);
    expect(computePower(player)).toBe(1);
    expect(powerBreakdown(player)).toEqual([{ label: 'Base Power', value: 1, kind: 'power' }]);
  });

  it('adds Charm powers', () => {
    const player = {
      ...createPlayerState(1),
      charms: [charm(1.5, 'Rubber Duck'), charm(1, 'Lantern')],
    };
    expect(computePower(player)).toBe(3.5);
    expect(powerBreakdown(player).map((line) => [line.label, line.value])).toEqual([
      ['Base Power', 1],
      ['Rubber Duck', 1.5],
      ['Lantern', 1],
    ]);
  });

  it('adds equipped gear, the set bonus, the Pledge bonus and the Feat bonus', () => {
    const player = {
      ...createPlayerState(1),
      gear: {
        pieces: [
          { id: 'mithril-sword', slot: 'weapon' as const, power: 0.4 },
          { id: 'mithril-plate', slot: 'body' as const, power: 0.3 },
        ],
        setBonus: 0.25,
      },
      pledges: { played: [], powerBonus: 0.5 },
      feats: { unlocked: ['megalith'], powerBonus: 0.3 },
    };
    expect(computePower(player)).toBeCloseTo(1 + 0.4 + 0.3 + 0.25 + 0.5 + 0.3, 6);
    expect(powerBreakdown(player).map((line) => line.label)).toEqual([
      'Base Power',
      'mithril-sword',
      'mithril-plate',
      'Gear set bonus',
      'Pledge bonus',
      'Feat bonus',
    ]);
  });

  it('removes float noise from sums of small increments', () => {
    const player = {
      ...createPlayerState(1),
      charms: [charm(0.1), charm(0.1), charm(0.1)],
    };
    expect(computePower(player)).toBe(1.3);
  });

  it('is capped at 9 and the breakdown shows the cap so its lines still sum to Power', () => {
    const player = { ...createPlayerState(1), charms: [charm(6), charm(6)] };
    expect(computePower(player)).toBe(9);
    const lines = powerBreakdown(player);
    expect(lines.at(-1)).toEqual({ label: 'Power cap', value: -4, kind: 'power' });
    expect(lines.reduce((sum, line) => sum + line.value, 0)).toBe(9);
  });

  it('reaches exactly 9 without a cap line', () => {
    const player = { ...createPlayerState(1), charms: [charm(8)] };
    expect(computePower(player)).toBe(9);
    expect(powerBreakdown(player).map((line) => line.label)).not.toContain('Power cap');
  });
});
