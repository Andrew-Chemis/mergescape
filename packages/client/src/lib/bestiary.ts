/**
 * The Bestiary's non-Mogul creatures with the line that says when each one turns up (design.md 7.1).
 * Purely cosmetic, which is why a creature that has never appeared still shows its hint: the grid is a
 * collection to fill, and knowing the condition is half the fun. The Moguls come from `@mergescape/shared`.
 */
import type { MonsterId } from '@mergescape/shared';

export interface Creature {
  id: MonsterId;
  kind: 'mob' | 'elite';
  /** When this one spawns, in the words of design.md 7.1. */
  spawns: string;
}

export const CREATURES: readonly Creature[] = [
  { id: 'merge-goblin', kind: 'mob', spawns: 'Any ordinary merged pull request under 300 lines.' },
  { id: 'nitpick-imp', kind: 'mob', spawns: 'A review with five or more inline comments.' },
  {
    id: 'flaky-test-wraith',
    kind: 'mob',
    spawns: 'A pull request with four or more pushes before it merges.',
  },
  { id: 'legacy-golem', kind: 'mob', spawns: 'A merged pull request of 1,000 lines or more.' },
  { id: 'rebase-hydra', kind: 'elite', spawns: 'A pull request that went three review rounds.' },
  { id: 'scope-creep', kind: 'elite', spawns: 'A pull request left open for over 14 days.' },
  {
    id: 'release-dragon',
    kind: 'elite',
    spawns: 'In the Raid act, a merge that closes five or more linked pull requests or issues.',
  },
  {
    id: 'silent-monolith',
    kind: 'elite',
    spawns: 'In the Raid act, a pull request merged with no review of any kind.',
  },
];

/** True once the player has met the creature: a kill, or a first-seen date. */
export function isMet(
  id: MonsterId,
  kills: Partial<Record<MonsterId, number>>,
  firstSeen: Partial<Record<MonsterId, string>>,
): boolean {
  return (kills[id] ?? 0) > 0 || firstSeen[id] !== undefined;
}

/** `Nov 3, 2026`, in UTC so the date reads the same everywhere. */
export function formatDay(iso: string): string {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) {
    return '';
  }
  return new Date(at).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}
