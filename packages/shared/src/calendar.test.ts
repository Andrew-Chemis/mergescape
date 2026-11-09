import { describe, expect, it } from 'vitest';
import { actWindow, DAY_MS, HOUR_MS, utcDay, weekStartUtc } from './calendar';

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
});
