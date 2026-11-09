import { weekKeyStartMs, WEEK_MS } from '@mergescape/shared';

/** Monday 00:00 UTC of the week a stored key (`2026-46`) names. Throws: the keys in the table come from `isoWeekKey`. */
function startOf(weekKey: string): number {
  const start = weekKeyStartMs(weekKey);
  if (start === null) {
    throw new RangeError('not a week key');
  }
  return start;
}

/** Whole weeks from the week named by `from` to the week named by `to`. */
export function weeksBetween(from: string, to: string): number {
  return Math.round((startOf(to) - startOf(from)) / WEEK_MS);
}

/** The contract spells the week `2026-W46`; the item key is `2026-46`. */
export function displayWeekKey(weekKey: string): string {
  return weekKey.replace(/^(\d{4})-/, '$1-W');
}
