import type { PRMergedEvent, PRState, VerifiedKillEvent } from './types';

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
