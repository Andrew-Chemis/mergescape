import { BASE_POWER, CHARM_RULES, POWER_CAP } from './constants';
import { charmPowerLines, loadedDiceFires } from './charms';
import { tidy } from './math';
import { mogulPowerLines } from './moguls';
import { pledgePower } from './pledges';
import type { BreakdownLine, GameEvent, PlayerState, PowerContext, PRState } from './types';

/**
 * The Power context for an event, or undefined when the event gets only baseline Power. The weekly streak
 * is rollover bookkeeping for the week that just closed: no event-conditional Charm applies to it and it
 * must not spend Loaded Dice's weekly charge.
 */
export function powerContext(event: GameEvent, pr: PRState, now: number): PowerContext | undefined {
  return event.kind === 'weekly_streak' ? undefined : { event, pr, now };
}

/** The sum of a breakdown's Power lines, free of float noise. */
export function powerOf(lines: readonly BreakdownLine[]): number {
  return tidy(lines.reduce((sum, line) => sum + line.value, 0));
}

/**
 * The terms of `Power = 1 + Σ(Charm powers) + Σ(gear power incl. set bonus) + Pledge bonus + Feat bonus`,
 * capped at 9 (Requirement 4.5), as Combat Log lines, one per contributing source: each Charm, then the
 * gear total, the Pledge bonus and the Feat bonus. Terms that are zero are omitted. When the cap bites a
 * final negative "Power cap" line makes the lines sum to the capped Power.
 *
 * Without a context this is the unconditional baseline (what the Character sheet shows): Charms'
 * conditional Power, Defend's review-only bonus and the Mogul modifiers need an event. With a context:
 * - event-conditional Charms (Rubber Duck's extra, Lantern, Small Hands, Hot Potato, Grey Beard) apply;
 * - the Rocket Man's and the Leather Jacket's Power lines apply when their Mogul is active;
 * - Loaded Dice, once a week, replaces the capped Power with 10 through a final positive line. This is the
 *   one way past the cap of 9, and the line makes the lines sum to exactly 10.
 */
export function powerBreakdown(player: PlayerState, ctx?: PowerContext): BreakdownLine[] {
  const lines: BreakdownLine[] = [{ label: 'Base Power', value: BASE_POWER, kind: 'power' }];
  lines.push(...charmPowerLines(player, ctx));
  const gear = tidy(
    player.gear.pieces.reduce((sum, piece) => sum + piece.power, 0) + player.gear.setBonus,
  );
  const flat: [string, number][] = [
    ['Gear', gear],
    ['Pledge bonus', pledgePower(player, ctx)],
    ['Feat bonus', player.feats.powerBonus],
  ];
  for (const [label, value] of flat) {
    if (value !== 0) {
      lines.push({ label, value, kind: 'power' });
    }
  }
  if (ctx !== undefined) {
    lines.push(...mogulPowerLines(player, ctx));
  }
  const raw = powerOf(lines);
  if (raw > POWER_CAP) {
    lines.push({ label: 'Power cap', value: tidy(POWER_CAP - raw), kind: 'power' });
  }
  if (loadedDiceFires(player, ctx)) {
    lines.push({
      label: 'Loaded Dice',
      value: tidy(CHARM_RULES.loadedDicePower - Math.min(raw, POWER_CAP)),
      kind: 'power',
    });
  }
  return lines;
}

/** Pure Power for a player: 1 for a new character, at most 9 (10 on the event Loaded Dice fires on). */
export function computePower(player: PlayerState, ctx?: PowerContext): number {
  return powerOf(powerBreakdown(player, ctx));
}
