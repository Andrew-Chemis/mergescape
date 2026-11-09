/** Small helpers for the Settings screen: the file name of an export and the player's timezone. */
import { weekStartUtc } from '@mergescape/shared';

/** `mergescape-octo-dev-2026-11-11.json`; the login is already safe for a file name on GitHub. */
export function exportFileName(login: string, at: Date): string {
  const safe = login.replace(/[^A-Za-z0-9._-]/g, '_');
  return `mergescape-${safe}-${at.toISOString().slice(0, 10)}.json`;
}

export interface TimezoneInfo {
  /** IANA name such as `Europe/London`, or `your local time` when the browser will not say. */
  name: string;
  /** `UTC+01:00`. */
  offset: string;
  /** When Monday 00:00 UTC lands for this player, e.g. `Sun 4:00 PM`. */
  mondayLocal: string;
}

/** `UTC+05:30` for a `Date.getTimezoneOffset()` value (minutes behind UTC, so -330). */
export function formatOffset(offsetMinutes: number): string {
  const ahead = -offsetMinutes;
  const sign = ahead < 0 ? '-' : '+';
  const abs = Math.abs(ahead);
  const hours = String(Math.floor(abs / 60)).padStart(2, '0');
  const minutes = String(abs % 60).padStart(2, '0');
  return `UTC${sign}${hours}:${minutes}`;
}

/** The player's timezone, for the line that explains the game runs on UTC. */
export function timezoneInfo(now: Date = new Date()): TimezoneInfo {
  let name = 'your local time';
  try {
    name = Intl.DateTimeFormat().resolvedOptions().timeZone || name;
  } catch {
    // Keep the generic name.
  }
  // This week's Monday 00:00 UTC, shown in the player's own zone (so daylight saving is the current one).
  const monday = new Date(weekStartUtc(now.getTime()));
  const mondayLocal = monday.toLocaleString('en-US', {
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
  return { name, offset: formatOffset(now.getTimezoneOffset()), mondayLocal };
}
