import { describe, expect, it } from 'vitest';
import { eventLines, firstReviewTime, hoursBetween, mergeFacts } from './facts';
import {
  AUTHOR_ID,
  facts,
  human,
  mergedEvent,
  mergedFacts,
  OTHER_REVIEWER_ID,
  prStateFor,
  REVIEWER_ID,
} from './test-builders';

describe('eventLines', () => {
  it('prefers the payload size and falls back to the stored PR', () => {
    const stored = prStateFor(facts(), { additions: 7, deletions: 3 });
    expect(
      eventLines(
        facts({ stats: { additions: 40, deletions: 10, changedFiles: 1, commits: 1 } }),
        stored,
      ),
    ).toBe(50);
    expect(eventLines(facts({ stats: null }), stored)).toBe(10);
  });
});

describe('mergeFacts', () => {
  it('derives party, riposte, reviewers and the solo kill from the reviews of other humans', () => {
    const merged = mergedEvent(mergedFacts());
    const pr = prStateFor(merged.pr, {
      reviews: [
        { reviewerId: REVIEWER_ID, state: 'CHANGES_REQUESTED' },
        { reviewerId: REVIEWER_ID, state: 'APPROVED' },
        { reviewerId: OTHER_REVIEWER_ID, state: 'COMMENTED' },
        { reviewerId: AUTHOR_ID, state: 'APPROVED' },
      ],
    });
    expect(mergeFacts(merged, pr)).toMatchObject({
      lines: 120,
      distinctReviewers: 2,
      party: true,
      riposte: true,
      soloKill: false,
    });
  });

  it('is a solo kill when the author merged with no other human review, even with an own review', () => {
    const merged = mergedEvent(mergedFacts());
    const own = prStateFor(merged.pr, { reviews: [{ reviewerId: AUTHOR_ID, state: 'APPROVED' }] });
    expect(mergeFacts(merged, own)).toMatchObject({
      soloKill: true,
      party: false,
      distinctReviewers: 0,
    });
    const byOther = mergedEvent(mergedFacts({ mergedBy: human(REVIEWER_ID) }));
    expect(mergeFacts(byOther, prStateFor(byOther.pr)).soloKill).toBe(false);
    const nobody = mergedEvent(mergedFacts({ mergedBy: null }));
    expect(mergeFacts(nobody, prStateFor(nobody.pr)).soloKill).toBe(false);
  });

  it('reads the size from the stored PR when the payload has none', () => {
    const merged = mergedEvent(mergedFacts({ stats: null }));
    expect(
      mergeFacts(merged, prStateFor(merged.pr, { additions: 30, deletions: 12 })),
    ).toMatchObject({
      additions: 30,
      deletions: 12,
      lines: 42,
    });
  });
});

describe('firstReviewTime', () => {
  const review = (submittedAt: string | null | undefined) => ({
    reviewerId: REVIEWER_ID,
    state: 'APPROVED' as const,
    ...(submittedAt === undefined ? {} : { submittedAt }),
  });

  it('is the earliest usable review time', () => {
    const pr = prStateFor(facts(), {
      reviews: [
        review('2026-11-09T10:00:00Z'),
        review('2026-11-09T08:00:00Z'),
        review('2026-11-09T09:00:00Z'),
      ],
    });
    expect(firstReviewTime(pr)).toBe(Date.parse('2026-11-09T08:00:00Z'));
  });

  it('ignores missing, unparseable and epoch placeholder times', () => {
    const pr = prStateFor(facts(), {
      reviews: [
        review(undefined),
        review(null),
        review('nonsense'),
        review('1970-01-01T00:00:00Z'),
      ],
    });
    expect(firstReviewTime(pr)).toBeNull();
    expect(firstReviewTime(prStateFor(facts()))).toBeNull();
  });
});

describe('hoursBetween', () => {
  it('measures in hours and is null for missing or unparseable times', () => {
    expect(hoursBetween('2026-11-09T09:00:00Z', '2026-11-09T10:30:00Z')).toBe(1.5);
    expect(hoursBetween(null, '2026-11-09T10:30:00Z')).toBeNull();
    expect(hoursBetween('2026-11-09T09:00:00Z', null)).toBeNull();
    expect(hoursBetween('later', '2026-11-09T10:30:00Z')).toBeNull();
  });
});
