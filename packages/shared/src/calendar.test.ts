import { describe, expect, it } from 'vitest';
import {
  actWindow,
  DAY_MS,
  HOUR_MS,
  MINUTE_MS,
  utcDay,
  WEEK_MS,
  weekKeyStartMs,
  weekStartUtc,
} from './calendar';
import { isoWeekKey } from './run';

describe('calendar', () => {
  it('finds Monday 00:00 UTC of the week', () => {
    const monday = Date.UTC(2026, 10, 9);
    expect(weekStartUtc(monday)).toBe(monday);
    expect(weekStartUtc(monday + 3 * DAY_MS + 5 * HOUR_MS)).toBe(monday);
    expect(weekStartUtc(monday + 7 * DAY_MS - 1)).toBe(monday);
    expect(weekStartUtc(monday + 7 * DAY_MS)).toBe(monday + 7 * DAY_MS);
    expect(weekStartUtc(Date.UTC(2024, 11, 31, 10))).toBe(Date.UTC(2024, 11, 30));
  });

  it('keeps the day and act helpers', () => {
    expect(utcDay(Date.UTC(2026, 10, 9, 23, 59))).toBe('2026-11-09');
    expect(actWindow(Date.UTC(2026, 10, 15))).toBe('boss');
  });

  it('builds the duration constants from one another', () => {
    expect(MINUTE_MS).toBe(60_000);
    expect(HOUR_MS).toBe(60 * MINUTE_MS);
    expect(DAY_MS).toBe(24 * HOUR_MS);
    expect(WEEK_MS).toBe(7 * DAY_MS);
  });
});

describe('weekKeyStartMs', () => {
  it('is the Monday of the week of every instant whose key it parses, across year edges', () => {
    // Every day, and an odd hour on each, from 2018 to 2031: covers 52- and 53-week years and leap days.
    const first = Date.UTC(2018, 0, 1);
    const last = Date.UTC(2031, 11, 31);
    for (let at = first; at <= last; at += DAY_MS) {
      for (const instant of [at, at + 17 * HOUR_MS + 59 * MINUTE_MS]) {
        expect(weekKeyStartMs(isoWeekKey(instant)), isoWeekKey(instant)).toBe(
          weekStartUtc(instant),
        );
      }
    }
  });

  it('reads the stored key and the contract spelling alike', () => {
    expect(weekKeyStartMs('2026-46')).toBe(Date.UTC(2026, 10, 9));
    expect(weekKeyStartMs('2026-W46')).toBe(Date.UTC(2026, 10, 9));
    // Week 1 of 2026 starts on Monday 29 December 2025, and 2026 has 53 weeks.
    expect(weekKeyStartMs('2026-01')).toBe(Date.UTC(2025, 11, 29));
    expect(weekKeyStartMs('2026-53')).toBe(Date.UTC(2026, 11, 28));
    expect(weekKeyStartMs('2027-01')).toBe(Date.UTC(2027, 0, 4));
  });

  it('is null for a key that is not a week', () => {
    for (const bad of ['', 'nope', '2026', '26-46', '2026-0', '2026-4', '2026-00', '2026-54']) {
      expect(weekKeyStartMs(bad), bad).toBeNull();
    }
    for (const bad of ['2026-W00', '2026-W54', '2026-W4', '2026-46x', ' 2026-46', '2026-46-1']) {
      expect(weekKeyStartMs(bad), bad).toBeNull();
    }
  });
});
