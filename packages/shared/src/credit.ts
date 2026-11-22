import type { PRMergedEvent, PRState, RiposteCreditEvent, VerifiedKillEvent } from './types';

/**
 * Distinct human reviewers, in review order, whose review of `state` on the PR earns the merge credit.
 * Neither the PR's author nor the credited actor of the merge qualifies: the actor is the author, or on a
 * bot's PR the human who merged it, and a merger must not collect a verified kill (or a Riposte credit) on
 * top of the merge they are already scored for.
 */
function creditedReviewers(
  event: PRMergedEvent,
  pr: PRState,
  state: 'APPROVED' | 'CHANGES_REQUESTED',
): number[] {
  const ids = new Set<number>();
  for (const review of pr.reviews) {
    if (
      review.state === state &&
      review.reviewerId !== event.pr.author.id &&
      review.reviewerId !== event.actor.id
    ) {
      ids.add(review.reviewerId);
    }
  }
  return [...ids];
}

/**
 * Verified kills for a merge: one event per distinct human who approved the PR and is neither its author
 * nor the credited actor of the merge. The caller scores each against that approver's own PlayerState. The
 * normaliser cannot build these because a merge payload does not list the reviews; they come from the
 * stored `PRState.reviews`.
 */
export function verifiedKillEvents(event: PRMergedEvent, pr: PRState): VerifiedKillEvent[] {
  return creditedReviewers(event, pr, 'APPROVED').map((id) => ({
    kind: 'verified_kill' as const,
    actor: { id, isBot: false },
    pr: event.pr,
  }));
}

/**
 * Riposte credits for a merge: one event per distinct human, other than the author and the credited actor,
 * who requested changes on the PR. Only a player holding Jester's Rebase scores one: the Riposte is granted
 * when the PR they challenged merges, never when they request changes. The caller scores each against that
 * reviewer's own PlayerState, as it does for `verifiedKillEvents`.
 */
export function riposteCreditEvents(event: PRMergedEvent, pr: PRState): RiposteCreditEvent[] {
  return creditedReviewers(event, pr, 'CHANGES_REQUESTED').map((id) => ({
    kind: 'riposte_credit' as const,
    actor: { id, isBot: false },
    pr: event.pr,
  }));
}
