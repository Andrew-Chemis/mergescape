import { ACT_WINDOW_UTC_DAYS } from './constants';
import type { ActId } from './constants';

export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;

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
