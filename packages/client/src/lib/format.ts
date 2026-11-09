/** Formatting helpers. Locale is fixed to en-US so numbers read the same everywhere (and in tests). */
import { MINUTE_MS, SKILL_LABELS, SKILLS, SUPPLY_KINDS } from '@mergescape/shared';
import type { MaterialKind, Supplies } from '@mergescape/shared';
import type { LogEntry } from './types';
import { MONSTER_NAMES } from './names';

const SECOND_MS = 1000;
const INT = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const DECIMAL = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });

/** `1,234,567`. */
export function formatInt(value: number): string {
  return INT.format(value);
}

/** Up to two decimals, trailing zeros dropped: `3.75`, `395.6`, `4`. */
export function formatDecimal(value: number): string {
  return DECIMAL.format(value);
}

/** `+344,172`. */
export function formatGain(value: number): string {
  return `+${formatInt(value)}`;
}

/** `1 minute ago`-style, coarse on purpose. */
export function relativeTime(iso: string, now: number): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) {
    return '';
  }
  const seconds = Math.max(0, Math.round((now - then) / SECOND_MS));
  if (seconds < 45) {
    return 'just now';
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `${minutes} min ago`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return `${hours} h ago`;
  }
  const days = Math.round(hours / 24);
  if (days === 1) {
    return 'yesterday';
  }
  if (days < 7) {
    return `${days} days ago`;
  }
  return new Date(then).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** Where an event happened: `octo/api #412`, `PR #412`, or `PR #412 in a private repo`. */
export function targetLabel(entry: LogEntry): string {
  if (entry.prNumber === undefined) {
    return '';
  }
  if (entry.repoName) {
    return `${entry.repoName} #${entry.prNumber}`;
  }
  return entry.repoPrivate ? `PR #${entry.prNumber} in a private repo` : `PR #${entry.prNumber}`;
}

/** The one-line summary of a Combat Log row. Built from counts and ids only; no PR title exists. */
export function summarize(entry: LogEntry): string {
  const target = targetLabel(entry);
  switch (entry.kind) {
    case 'pr_opened':
      return `Opened ${target}`;
    case 'pr_merged': {
      const lines =
        entry.additions !== undefined && entry.deletions !== undefined
          ? ` (+${formatInt(entry.additions)} / −${formatInt(entry.deletions)})`
          : '';
      return `Merged ${target}${lines}`;
    }
    case 'review_submitted': {
      const verb = {
        APPROVED: 'Approved',
        CHANGES_REQUESTED: 'Requested changes on',
        COMMENTED: 'Reviewed',
      }[entry.reviewState ?? 'COMMENTED'];
      const inline =
        entry.inlineComments && entry.inlineComments > 0 ? ` · ${entry.inlineComments} inline` : '';
      return `${verb} ${target}${inline}`;
    }
    case 'review_comment_created':
      return `Inline comment on ${target}`;
    case 'verified_kill':
      return `Verified kill: ${target} merged`;
    case 'riposte_credit':
      return `Riposte: ${target} merged after your changes`;
    case 'weekly_streak':
      return 'Weekly streak';
  }
}

/** Monster name for a row, or the fallback for rows without one. */
export function monsterLabel(entry: LogEntry): string {
  return entry.monster ? MONSTER_NAMES[entry.monster] : 'Adventurer';
}

/** Skills that received XP from this row, in display order. */
export function creditedSkills(entry: LogEntry): { label: string; xp: number }[] {
  return SKILLS.filter((skill) => entry.skillXp[skill] > 0).map((skill) => ({
    label: SKILL_LABELS[skill],
    xp: entry.skillXp[skill],
  }));
}

/** The name of every satchel material: the six supplies events drop, then the four tiers expeditions give. */
export const MATERIAL_LABELS: Readonly<Record<MaterialKind, string>> = {
  ore: 'Ore',
  timber: 'Timber',
  lore: 'Lore',
  ink: 'Ink',
  provisions: 'Provisions',
  flux: 'Flux',
  silver: 'Silver',
  mithril: 'Mithril',
  rune: 'Rune',
  dragon: 'Dragon scale',
};

/** `+3 Ore, +1 Timber`: the supplies a row dropped (game-design.md section 6.1). Empty when none. */
export function suppliesText(supplies: Supplies): string {
  return SUPPLY_KINDS.filter((kind) => supplies[kind] > 0)
    .map((kind) => `+${supplies[kind]} ${MATERIAL_LABELS[kind]}`)
    .join(', ');
}

// ---------------------------------------------------------------------------------------------
// Days and durations
// ---------------------------------------------------------------------------------------------

/** The two ways a calendar day is written: `Nov 3, 2026`, and `Fri, Oct 30` for a day this year. */
const DAY_STYLES = {
  date: { year: 'numeric', month: 'short', day: 'numeric' },
  weekday: { weekday: 'short', day: 'numeric', month: 'short' },
} as const satisfies Record<string, Intl.DateTimeFormatOptions>;

/** The UTC calendar day of an ISO timestamp, so it reads the same everywhere. Empty for a bad timestamp. */
export function formatDay(iso: string, style: keyof typeof DAY_STYLES = 'date'): string {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) {
    return '';
  }
  return new Date(at).toLocaleDateString('en-US', { ...DAY_STYLES[style], timeZone: 'UTC' });
}

/**
 * `ms` (never below 0) rounded with `round` to a whole number of `unitMs`, then split into hours, minutes
 * and seconds; the minutes and seconds are the remainders. Each formatter below picks its own unit and
 * rounding.
 */
function splitMs(
  ms: number,
  unitMs: number,
  round: (value: number) => number,
): { hours: number; minutes: number; seconds: number } {
  const total = round(Math.max(0, ms) / unitMs) * (unitMs / SECOND_MS);
  return {
    hours: Math.floor(total / 3600),
    minutes: Math.floor((total % 3600) / 60),
    seconds: total % 60,
  };
}

/** `9 h`, `40 min`, `under a minute`: coarse on purpose, rounded up so "Returns in" never promises early. */
export function formatCoarse(ms: number): string {
  const { hours, minutes } = splitMs(ms, MINUTE_MS, Math.ceil);
  if (hours === 0) {
    return minutes === 0 ? 'under a minute' : `${minutes} min`;
  }
  return `${minutes === 0 ? hours : hours + 1} h`;
}

/** `3 h 36 min`: a trip's length to the minute, for the picker when Quick gear shortens it. */
export function formatLong(ms: number): string {
  const { hours, minutes } = splitMs(ms, MINUTE_MS, Math.round);
  if (hours === 0) {
    return `${minutes} min`;
  }
  return minutes === 0 ? `${hours} h` : `${hours} h ${minutes} min`;
}

/** `3:12:05`: the live countdown on the Expedition and Forge screens. */
export function formatCountdown(ms: number): string {
  const { hours, minutes, seconds } = splitMs(ms, SECOND_MS, Math.ceil);
  return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}
