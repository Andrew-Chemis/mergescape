import { DAY_MS, weekStartUtc } from '@mergescape/shared';

const WEEK_MS = 7 * DAY_MS;
const WEEK_KEY = /^(\d{4})-(\d{2})$/;

/** Monday 00:00 UTC of the ISO week named by a stored week key (`2026-46`), as epoch milliseconds. */
export function weekKeyStartMs(weekKey: string): number {
  const match = WEEK_KEY.exec(weekKey);
  if (!match) {
    throw new RangeError('not a week key');
  }
  const year = Number(match[1]);
  const week = Number(match[2]);
  // ISO week 1 is the week that contains January 4th.
  return weekStartUtc(Date.UTC(year, 0, 4)) + (week - 1) * WEEK_MS;
}

/** Whole weeks from the week named by `from` to the week named by `to`. */
export function weeksBetween(from: string, to: string): number {
  return Math.round((weekKeyStartMs(to) - weekKeyStartMs(from)) / WEEK_MS);
}

/** The contract spells the week `2026-W46`; the item key is `2026-46`. */
export function displayWeekKey(weekKey: string): string {
  return weekKey.replace(/^(\d{4})-/, '$1-W');
}
