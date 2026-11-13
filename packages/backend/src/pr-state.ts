import { createPRState } from '@mergescape/shared';
import type { PRState, PullRequestFacts, ReviewerCounters, ReviewRecord } from '@mergescape/shared';
import type { PRBundle } from './db';

/**
 * The scorer's view of a PR, rebuilt from the stored records (Requirement 3.2: per-reviewer caps are
 * derived from the review records, not stored). Decisions and comment reviews are counted from the
 * `REVIEW#` records, inline comments are summed from the `INLINE#` records. Bot reviews are never
 * recorded; they are filtered here as well in case an old record exists.
 *
 * @param bundle everything stored for the PR (an empty bundle for an unseen PR)
 * @param facts the PR facts on the event being scored; its size wins over the stored one
 * @param authorMerges lifetime merges of the PR's author when they are a player (the Mentor Pledge compares
 *   them to the reviewer's own); null for an author the game does not know
 */
export function buildPRState(
  bundle: PRBundle,
  facts: PullRequestFacts,
  authorMerges: number | null = null,
): PRState {
  const base = createPRState(facts);
  const meta = bundle.meta;
  const reviewerCounters: Record<string, ReviewerCounters> = {};
  const counters = (reviewerId: number): ReviewerCounters => {
    const key = String(reviewerId);
    return (reviewerCounters[key] ??= { decisions: 0, comments: 0, inline: 0 });
  };

  const reviews: ReviewRecord[] = [];
  for (const review of bundle.reviews) {
    if (review.reviewerIsBot) {
      continue;
    }
    reviews.push({
      reviewerId: review.reviewerId,
      state: review.state,
      submittedAt: review.submittedAt,
    });
    const entry = counters(review.reviewerId);
    if (review.state === 'COMMENTED') {
      entry.comments += 1;
    } else {
      entry.decisions += 1;
    }
  }
  for (const inline of bundle.inline) {
    counters(inline.reviewerId).inline += inline.count;
  }

  return {
    ...base,
    authorId: meta?.authorId ?? base.authorId,
    additions: facts.stats?.additions ?? meta?.additions ?? 0,
    deletions: facts.stats?.deletions ?? meta?.deletions ?? 0,
    // The size is known when this event or the stored PR carries it; a review event that finds neither must
    // not read the zeros above as a tiny PR.
    sizeKnown:
      facts.stats !== null || (meta !== null && meta.additions !== null && meta.deletions !== null),
    reviewRoundCount: meta?.reviewRoundCount ?? 0,
    syncCount: meta?.syncCount ?? 0,
    reviews,
    reviewerCounters,
    authorMerges,
  };
}
