import type { PRMergedEvent, PRState, RiposteCreditEvent, VerifiedKillEvent } from './types';

/**
 * Verified kills for a merge: one event per distinct human who approved the PR and is not its author.
 * The caller scores each against that approver's own PlayerState. The normaliser cannot build these
 * because a merge payload does not list the reviews; they come from the stored `PRState.reviews`.
 */
export function verifiedKillEvents(event: PRMergedEvent, pr: PRState): VerifiedKillEvent[] {
  const approvers = new Set<number>();
  for (const review of pr.reviews) {
    if (review.state === 'APPROVED' && review.reviewerId !== event.pr.author.id) {
      approvers.add(review.reviewerId);
    }
  }
  return [...approvers].map((id) => ({
    kind: 'verified_kill' as const,
    actor: { id, isBot: false },
    pr: event.pr,
  }));
}

/**
 * Riposte credits for a merge: one event per distinct human, other than the author, who requested changes
 * on the PR. Only a player holding Jester's Rebase scores one: the Riposte is granted when the PR they
 * challenged merges, never when they request changes. The caller scores each against that reviewer's own
 * PlayerState, as it does for `verifiedKillEvents`.
 */
export function riposteCreditEvents(event: PRMergedEvent, pr: PRState): RiposteCreditEvent[] {
  const requesters = new Set<number>();
  for (const review of pr.reviews) {
    if (review.state === 'CHANGES_REQUESTED' && review.reviewerId !== event.pr.author.id) {
      requesters.add(review.reviewerId);
    }
  }
  return [...requesters].map((id) => ({
    kind: 'riposte_credit' as const,
    actor: { id, isBot: false },
    pr: event.pr,
  }));
}
