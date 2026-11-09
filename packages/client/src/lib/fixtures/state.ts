/**
 * Fixture state: a realistic `MeResponse`, `LogResponse` and `InstallationsResponse`, so every screen
 * renders without a network (Requirement 10.7). Shapes are the ones in ../types.ts; the Combat Log rows
 * come from the real scorer (see raw-log.ts).
 *
 * Variants:
 * - `active`     a level-41 Smith with three Charms, a run in progress and 14 Combat Log rows
 * - `noevents`   a brand-new character with the App installed: Town shows the sleeping hero
 * - `noinstall`  a brand-new character with no installations: Town shows the install call to action
 */
import type { Charm, Pledge } from '@mergescape/shared';
import type {
  InstallationsResponse,
  LogEntry,
  LogResponse,
  MeResponse,
  WeekSummary,
} from '../types';
import { FINAL_SKILL_XP, FINAL_XP, RAW_LOG } from './raw-log';

export type FixtureVariant = 'active' | 'noevents' | 'noinstall';

export const FIXTURE_VARIANTS: readonly FixtureVariant[] = ['active', 'noevents', 'noinstall'];

/** Rows per page in the fixture log, small enough that the fixture spans two pages. */
export const FIXTURE_PAGE_SIZE = 8;

export const FIXTURE_LOGIN = 'octo-dev';
export const FIXTURE_GITHUB_ID = 4242;

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

export const FIXTURE_CHARMS: readonly Charm[] = [
  { id: 'rubber-duck', name: 'Rubber Duck', rarity: 'common', power: 0.25 },
  { id: 'small-hands', name: 'Small Hands', rarity: 'uncommon', power: 0.5 },
  { id: 'hot-potato', name: 'Hot Potato', rarity: 'rare', power: 1 },
];

const HAND: readonly Pledge[] = [
  { id: 'strike', name: 'Strike', upgraded: false },
  { id: 'defend', name: 'Defend', upgraded: false },
  { id: 'big-game-hunter', name: 'Big Game Hunter', upgraded: false },
  { id: 'mentor', name: 'Mentor', upgraded: false },
  { id: 'tidy', name: 'Tidy', upgraded: false },
];

/** ISO week key `yyyy-ww` (weeks start Monday, Thursday decides the year). */
export function isoWeekKey(now: number): string {
  const date = new Date(now);
  const day = (date.getUTCDay() + 6) % 7; // Monday = 0
  const thursday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  thursday.setUTCDate(thursday.getUTCDate() - day + 3);
  const yearStart = Date.UTC(thursday.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((thursday.getTime() - yearStart) / DAY + 1) / 7);
  return `${thursday.getUTCFullYear()}-${String(week).padStart(2, '0')}`;
}

/** The Combat Log rows, newest first, stamped relative to `now`. */
export function fixtureLogEntries(now: number, variant: FixtureVariant = 'active'): LogEntry[] {
  if (variant !== 'active') {
    return [];
  }
  return RAW_LOG.map(({ minutesAgo, row }, index) => {
    const at = new Date(now - minutesAgo * MINUTE).toISOString();
    return { ...row, id: `${at}#fixture-${String(index + 1).padStart(4, '0')}`, at };
  });
}

/** XP earned so far in the fixture run: the sum of the log rows from the weekly streak up. */
export const FIXTURE_WEEKLY_XP = 1_606_611;

/** Run targets for a player whose 8-week median is 2,370,000 XP (60% / 100% / 150%). */
const TARGETS = { scout: 1_422_000, raid: 2_370_000, boss: 3_555_000 } as const;

export function fixtureWeek(now: number): WeekSummary {
  return {
    weekKey: isoWeekKey(now),
    act: 'raid',
    clearedActs: ['scout'],
    // What the log rows since Monday add up to; the fixture run is not tied to the calendar.
    weeklyXp: FIXTURE_WEEKLY_XP,
    targets: { ...TARGETS },
    mogul: 'rocket-man',
    hand: [...HAND],
    played: HAND.slice(0, 3).map((p) => ({ ...p })),
    shopOpen: true,
  };
}

export function fixtureMe(now: number, variant: FixtureVariant = 'active'): MeResponse {
  if (variant !== 'active') {
    return {
      githubId: FIXTURE_GITHUB_ID,
      login: FIXTURE_LOGIN,
      createdAt: new Date(now - 20 * MINUTE).toISOString(),
      xp: 0,
      skillXp: { smithing: 0, vigilance: 0, oratory: 0, endurance: 0 },
      gold: 0,
      renown: 0,
      vocation: 'Journeyman',
      charms: [],
      charmSlots: 5,
      week: null,
    };
  }
  return {
    githubId: FIXTURE_GITHUB_ID,
    login: FIXTURE_LOGIN,
    createdAt: new Date(now - 190 * DAY).toISOString(),
    xp: FINAL_XP,
    skillXp: { ...FINAL_SKILL_XP },
    gold: 2340,
    renown: 17,
    vocation: 'Smith',
    charms: FIXTURE_CHARMS.map((c) => ({ ...c })),
    charmSlots: 5,
    week: fixtureWeek(now),
  };
}

export function fixtureInstallations(variant: FixtureVariant = 'active'): InstallationsResponse {
  if (variant === 'noinstall') {
    return { installations: [] };
  }
  return {
    installations: [
      { installationId: 5001, accountId: FIXTURE_GITHUB_ID, repoCount: 4, suspended: false },
    ],
  };
}

/** One page of a log, using the entry offset as the opaque cursor. */
export function pageOf(
  entries: readonly LogEntry[],
  cursor: string | null | undefined,
  pageSize: number = FIXTURE_PAGE_SIZE,
): LogResponse {
  const offset = cursor ? Math.max(0, Number.parseInt(cursor, 10) || 0) : 0;
  const end = offset + pageSize;
  return {
    entries: entries.slice(offset, end),
    nextCursor: end < entries.length ? String(end) : null,
  };
}
