import { BASE_POWER, POWER_CAP } from './constants';
import type { BreakdownLine, PlayerState } from './types';

/** Round away float noise from sums of 0.05-style increments. */
function tidy(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

/**
 * The terms of `Power = 1 + Σ(Charm powers) + Σ(gear power incl. set bonus) + Pledge bonus + Feat bonus`,
 * capped at 9 (Requirement 4.5), as Combat Log lines. Terms that are zero are omitted. When the cap bites a
 * final negative "Power cap" line makes the lines sum to the capped Power.
 *
 * Charms, gear, Pledges and Feats are hook points: later tasks fill the `PlayerState` fields and, where a
 * condition applies, extend this function. For now they are read as plain stored values.
 */
export function powerBreakdown(player: PlayerState): BreakdownLine[] {
  const lines: BreakdownLine[] = [{ label: 'Base Power', value: BASE_POWER, kind: 'power' }];
  for (const charm of player.charms) {
    lines.push({ label: charm.name, value: charm.power, kind: 'power' });
  }
  for (const piece of player.gear.pieces) {
    lines.push({ label: piece.id, value: piece.power, kind: 'power' });
  }
  const extras: [string, number][] = [
    ['Gear set bonus', player.gear.setBonus],
    ['Pledge bonus', player.pledges.powerBonus],
    ['Feat bonus', player.feats.powerBonus],
  ];
  for (const [label, value] of extras) {
    if (value !== 0) {
      lines.push({ label, value, kind: 'power' });
    }
  }
  const raw = tidy(lines.reduce((sum, line) => sum + line.value, 0));
  if (raw > POWER_CAP) {
    lines.push({ label: 'Power cap', value: tidy(POWER_CAP - raw), kind: 'power' });
  }
  return lines;
}

/** Pure Power for a player; 1 for a new character, never above 9. */
export function computePower(player: PlayerState): number {
  return Math.min(
    POWER_CAP,
    tidy(powerBreakdown(player).reduce((sum, line) => sum + line.value, 0)),
  );
}
