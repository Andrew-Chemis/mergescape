import { BASE_POWER, CHARM_RULES, POWER_BUDGET, POWER_CAP } from './constants';
import { charmPowerLines, loadedDiceFires } from './charms';
import { featPowerBonus } from './feats';
import { gearPowerLines } from './gear';
import { sumBy, tidy } from './math';
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
  return tidy(sumBy(lines, (line) => line.value));
}

/**
 * A source's Power lines, followed by a negative "<name> cap" line that brings their sum down to `budget`
 * when it is over (design.md 4.3: Charms +4, gear +2.25, Pledges +1, Feats +0.5), so the Combat Log shows
 * the clamp and the lines still sum to the Power.
 */
function withinBudget(name: string, lines: BreakdownLine[], budget: number): BreakdownLine[] {
  const total = powerOf(lines);
  return total > budget
    ? [...lines, { label: `${name} cap`, value: tidy(budget - total), kind: 'power' }]
    : lines;
}

/**
 * The terms of `Power = 1 + Σ(Charm powers) + Σ(gear power incl. set bonus) + Pledge bonus + Feat bonus`,
 * capped at 9 (Requirement 4.5), as Combat Log lines, one per contributing source: each Charm, then the
 * "Gear" total (and, in an event context, the Keen and Stout lines), the Pledge bonus and the Feat bonus.
 * Each source is held to its budget (`POWER_BUDGET`: Charms +4, gear +2.25, Pledges +1, Feats +0.5) by a
 * "Charm cap", "Gear cap", "Pledge cap" or "Feat cap" line when it is over. Terms that are zero are
 * omitted. When the global cap bites a final negative "Power cap" line makes the lines sum to the capped
 * Power.
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
  lines.push(...withinBudget('Charm', charmPowerLines(player, ctx), POWER_BUDGET.charms));
  lines.push(...withinBudget('Gear', gearPowerLines(player, ctx), POWER_BUDGET.gear));
  const flat: [string, string, number, number][] = [
    ['Pledge bonus', 'Pledge', pledgePower(player, ctx), POWER_BUDGET.pledges],
    ['Feat bonus', 'Feat', featPowerBonus(player), POWER_BUDGET.feats],
  ];
  for (const [label, name, value, budget] of flat) {
    if (value !== 0) {
      lines.push(...withinBudget(name, [{ label, value, kind: 'power' }], budget));
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
