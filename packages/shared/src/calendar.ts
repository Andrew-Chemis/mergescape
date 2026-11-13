import { ACT_WINDOW_UTC_DAYS } from './constants';
import type { ActId } from './constants';

export const MINUTE_MS = 60 * 1000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;
export const WEEK_MS = 7 * DAY_MS;

/** UTC calendar day of an epoch-millisecond instant, `YYYY-MM-DD`. */
export function utcDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

/** Calendar window of the weekly run an instant falls in: Mon-Tue scout, Wed-Thu raid, Fri-Sun boss. */
export function actWindow(now: number): ActId {
  const weekday = new Date(now).getUTCDay();
  if (ACT_WINDOW_UTC_DAYS.scout.includes(weekday)) {
    return 'scout';
  }
  return ACT_WINDOW_UTC_DAYS.raid.includes(weekday) ? 'raid' : 'boss';
}

/** Monday 00:00 UTC of the week an instant falls in, as epoch milliseconds. Runs start here. */
export function weekStartUtc(now: number): number {
  const date = new Date(now);
  const sinceMonday = (date.getUTCDay() + 6) % 7;
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - sinceMonday);
}

const WEEK_KEY = /^(\d{4})-W?(\d{2})$/;

/**
 * Monday 00:00 UTC of the ISO week a week key names, as epoch milliseconds: the inverse of `isoWeekKey`.
 * Takes the stored `2026-46` and the contract's `2026-W46`; null for anything else, a week outside 1..53, or
 * a week 53 that the year does not have (`2025-53` is not a week: the day it would name belongs to 2026-W01).
 */
export function weekKeyStartMs(key: string): number | null {
  const match = WEEK_KEY.exec(key);
  if (match === null) {
    return null;
  }
  const week = Number(match[2]);
  if (week < 1 || week > 53) {
    return null;
  }
  // 4 January is always in week 1: step back to its Monday, then forward whole weeks.
  const year = Number(match[1]);
  const start = weekStartUtc(Date.UTC(year, 0, 4)) + (week - 1) * WEEK_MS;
  // A week belongs to the year that contains its Thursday; a key whose Thursday is in the next year named
  // a week that year does not have.
  return new Date(start + 3 * DAY_MS).getUTCFullYear() === year ? start : null;
}
