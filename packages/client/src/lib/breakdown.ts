/**
 * Turns a `ScoreResult.breakdown` into the rows the Combat Log and the ticker draw, in the order the
 * scorer produced them: Points lines, the Points subtotal, Power lines, the Power subtotal, the Zone
 * line, then XP (the total first, then one line per skill credited).
 */
import type { BreakdownLine } from '@mergescape/shared';
import { formatDecimal, formatInt } from './format';
import type { LogEntry } from './types';

export type BreakdownScore = Pick<LogEntry, 'breakdown' | 'points' | 'power'>;

export interface BreakdownRow {
  /** 0 Points, 1 Power, 2 Zone, 3 XP: the ticker reveals one group at a time. */
  group: 0 | 1 | 2 | 3;
  kind: BreakdownLine['kind'];
  label: string;
  value: string;
  /** A subtotal (Points, Power) or the XP total. */
  emphasis: 'line' | 'subtotal' | 'total';
}

export const BREAKDOWN_GROUPS = 4;

const MINUS = '−';
const TIMES = '×';

function signed(value: number): string {
  return value < 0 ? `${MINUS}${formatDecimal(-value)}` : `+${formatDecimal(value)}`;
}

export function breakdownRows(score: BreakdownScore): BreakdownRow[] {
  const rows: BreakdownRow[] = [];
  const lines = score.breakdown;
  const ofKind = (kind: BreakdownLine['kind']) => lines.filter((line) => line.kind === kind);

  for (const line of ofKind('points')) {
    rows.push({
      group: 0,
      kind: 'points',
      label: line.label,
      value: signed(line.value),
      emphasis: 'line',
    });
  }
  rows.push({
    group: 0,
    kind: 'points',
    label: 'Points',
    value: `= ${formatInt(score.points)}`,
    emphasis: 'subtotal',
  });

  ofKind('power').forEach((line, index) => {
    rows.push({
      group: 1,
      kind: 'power',
      label: line.label,
      // The base 1 is the starting value; every later term adds to it.
      value: index === 0 ? formatDecimal(line.value) : signed(line.value),
      emphasis: 'line',
    });
  });
  rows.push({
    group: 1,
    kind: 'power',
    label: 'Power',
    value: `${TIMES} ${formatDecimal(score.power)}`,
    emphasis: 'subtotal',
  });

  for (const line of ofKind('zone')) {
    rows.push({
      group: 2,
      kind: 'zone',
      label: line.label,
      value: `${TIMES} ${formatDecimal(line.value)}`,
      emphasis: 'subtotal',
    });
  }

  ofKind('xp').forEach((line, index) => {
    rows.push({
      group: 3,
      kind: 'xp',
      label: line.label,
      value: index === 0 ? `= ${formatInt(line.value)}` : `+${formatInt(line.value)}`,
      emphasis: index === 0 ? 'total' : 'line',
    });
  });

  return rows;
}
