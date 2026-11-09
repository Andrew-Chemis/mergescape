import { HOUR_MS } from './calendar';
import type { PRMergedEvent, PRState, PullRequestFacts, ReviewRecord } from './types';

/**
 * Facts about an event that more than one rule reads (the scorer, Charm conditions, Pledges and Mogul
 * modifiers), derived in one place so they cannot drift apart.
 */

/**
 * Lines changed (additions + deletions) as the event reports them. Review payloads carry no stats, so the
 * stored `PRState` answers for those.
 */
export function eventLines(pr: PullRequestFacts, state: PRState): number {
  const stats = pr.stats ?? state;
  return stats.additions + stats.deletions;
}

export interface MergeFacts {
  additions: number;
  deletions: number;
  /** Additions + deletions. */
  lines: number;
  /** Reviews by humans other than the credited actor. */
  otherReviews: readonly ReviewRecord[];
  /** Distinct human reviewers other than the credited actor. */
  distinctReviewers: number;
  /** At least one APPROVED review from another human (the party bonus). */
  party: boolean;
  /** At least one CHANGES_REQUESTED review from another human (a Riposte). */
  riposte: boolean;
  /** Merged by its author with no other human review: the solo-kill halving applies. */
  soloKill: boolean;
}

export function mergeFacts(event: PRMergedEvent, pr: PRState): MergeFacts {
  const otherReviews = pr.reviews.filter((review) => review.reviewerId !== event.actor.id);
  const stats = event.pr.stats ?? pr;
  return {
    additions: stats.additions,
    deletions: stats.deletions,
    lines: stats.additions + stats.deletions,
    otherReviews,
    distinctReviewers: new Set(otherReviews.map((review) => review.reviewerId)).size,
    party: otherReviews.some((review) => review.state === 'APPROVED'),
    riposte: otherReviews.some((review) => review.state === 'CHANGES_REQUESTED'),
    soloKill:
      event.pr.mergedBy !== null &&
      event.pr.mergedBy.id === event.pr.author.id &&
      otherReviews.length === 0,
  };
}

/** Hours from `from` to `to` (ISO instants); null when either is missing or unparseable. */
export function hoursBetween(from: string | null, to: string | null): number | null {
  if (from === null || to === null) {
    return null;
  }
  const hours = (Date.parse(to) - Date.parse(from)) / HOUR_MS;
  return Number.isNaN(hours) ? null : hours;
}
