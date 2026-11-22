import { HOUR_MS } from './calendar';
import type { PRMergedEvent, PRState, PullRequestFacts, ReviewRecord } from './types';

/**
 * Facts about an event that more than one rule reads (the scorer, Charm conditions, Pledges and Mogul
 * modifiers), derived in one place so they cannot drift apart.
 */

/**
 * Lines changed (additions + deletions) as the event reports them. Review payloads carry no stats, so the
 * stored `PRState` answers for those. Null when neither knows: the app never saw the PR's size, and a
 * placeholder 0 must not read as "a tiny PR".
 */
export function eventLines(pr: PullRequestFacts, state: PRState): number | null {
  if (pr.stats !== null) {
    return pr.stats.additions + pr.stats.deletions;
  }
  return state.sizeKnown === false ? null : state.additions + state.deletions;
}

/** "Under `limit` lines" (strict): false when the size is unknown. */
export function linesUnder(lines: number | null, limit: number): boolean {
  return lines !== null && lines < limit;
}

/** "At least `min` lines": false when the size is unknown. */
export function linesAtLeast(lines: number | null, min: number): boolean {
  return lines !== null && lines >= min;
}

/** "Under `limit` lines" for a merge: false when its size is unknown. */
export function mergeUnder(merge: MergeFacts, limit: number): boolean {
  return merge.sizeKnown && merge.lines < limit;
}

/**
 * True when the PR's author is known to have fewer merges than `playerMerges` (Whetstone, the Mentor Pledge
 * and the Mentor Feat). An author whose count is not known (not a player) does not qualify.
 */
export function authorHasFewerMerges(pr: PRState, playerMerges: number): boolean {
  return typeof pr.authorMerges === 'number' && pr.authorMerges < playerMerges;
}

export interface MergeFacts {
  additions: number;
  deletions: number;
  /** Additions + deletions; 0 when the size is unknown. */
  lines: number;
  /** False when neither the event nor the stored PR knows the size: every "under N lines" rule must fail. */
  sizeKnown: boolean;
  /** Reviews by humans other than the credited actor. */
  otherReviews: readonly ReviewRecord[];
  /** Distinct human reviewers other than the credited actor. */
  distinctReviewers: number;
  /** At least one APPROVED review from another human (the party bonus). */
  party: boolean;
  /** At least one CHANGES_REQUESTED review from another human (a Riposte). */
  riposte: boolean;
  /** The PR's base ref is the repository default branch; off it every point of the PR is halved. */
  defaultBranch: boolean;
  /**
   * Merged by the credited actor (or by a bot on their behalf) with no other human review: the solo-kill
   * halving applies. The credited actor is the PR's author, or the human who merged a bot's PR.
   */
  soloKill: boolean;
}

export function mergeFacts(event: PRMergedEvent, pr: PRState): MergeFacts {
  const otherReviews = pr.reviews.filter((review) => review.reviewerId !== event.actor.id);
  const stats = event.pr.stats ?? pr;
  const merger = event.pr.mergedBy;
  return {
    additions: stats.additions,
    deletions: stats.deletions,
    lines: stats.additions + stats.deletions,
    sizeKnown: eventLines(event.pr, pr) !== null,
    defaultBranch: event.pr.baseRefIsDefault,
    otherReviews,
    distinctReviewers: new Set(otherReviews.map((review) => review.reviewerId)).size,
    party: otherReviews.some((review) => review.state === 'APPROVED'),
    riposte: otherReviews.some((review) => review.state === 'CHANGES_REQUESTED'),
    soloKill:
      merger !== null &&
      otherReviews.length === 0 &&
      (merger.id === event.actor.id || merger.isBot),
  };
}

/**
 * Epoch milliseconds of the earliest review with a known time, or null. The epoch itself is the
 * placeholder stored when a payload carried no time, so it counts as unknown.
 */
export function firstReviewTime(pr: PRState): number | null {
  let earliest: number | null = null;
  for (const review of pr.reviews) {
    const time = review.submittedAt ? Date.parse(review.submittedAt) : Number.NaN;
    if (time > 0 && (earliest === null || time < earliest)) {
      earliest = time;
    }
  }
  return earliest;
}

/** Hours from `from` to `to` (ISO instants); null when either is missing or unparseable. */
export function hoursBetween(from: string | null, to: string | null): number | null {
  if (from === null || to === null) {
    return null;
  }
  const hours = (Date.parse(to) - Date.parse(from)) / HOUR_MS;
  return Number.isNaN(hours) ? null : hours;
}
