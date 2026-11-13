import { describe, expect, it } from 'vitest';
import {
  authorHasFewerMerges,
  eventLines,
  firstReviewTime,
  hoursBetween,
  linesAtLeast,
  linesUnder,
  mergeFacts,
  mergeUnder,
} from './facts';
import { createPRState } from './state';
import {
  AUTHOR_ID,
  bot,
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

  it('is null when neither the event nor the stored PR knows the size', () => {
    const unseen = createPRState(facts({ stats: null }));
    expect(unseen).toMatchObject({ additions: 0, deletions: 0, sizeKnown: false });
    expect(eventLines(facts({ stats: null }), unseen)).toBeNull();
    // The payload still wins over an unknown stored size, and a known stored size answers for a review.
    expect(eventLines(facts(), unseen)).toBe(120);
    expect(eventLines(facts({ stats: null }), { ...unseen, additions: 30, sizeKnown: true })).toBe(
      30,
    );
    expect(
      eventLines(facts({ stats: null }), prStateFor(facts(), { additions: 5, deletions: 0 })),
    ).toBe(5);
  });
});

describe('size and author comparisons', () => {
  it('"under N" is false for an unknown size, "at least N" too, both strict where they say so', () => {
    expect(linesUnder(149, 150)).toBe(true);
    expect(linesUnder(150, 150)).toBe(false);
    expect(linesUnder(null, 150)).toBe(false);
    expect(linesAtLeast(150, 150)).toBe(true);
    expect(linesAtLeast(149, 150)).toBe(false);
    expect(linesAtLeast(null, 0)).toBe(false);
  });

  it('mergeUnder needs a known size', () => {
    const known = mergeFacts(
      mergedEvent(mergedFacts({ stats: null })),
      prStateFor(facts(), { additions: 10, deletions: 0 }),
    );
    expect(known.sizeKnown).toBe(true);
    expect(mergeUnder(known, 150)).toBe(true);
    const unseen = createPRState(facts({ stats: null }));
    const unknown = mergeFacts(mergedEvent(mergedFacts({ stats: null })), unseen);
    expect(unknown).toMatchObject({ lines: 0, sizeKnown: false });
    expect(mergeUnder(unknown, 150)).toBe(false);
  });

  it('authorHasFewerMerges needs a known count: unknown (null or absent) never qualifies', () => {
    const pr = (authorMerges?: number | null) =>
      prStateFor(facts(), authorMerges === undefined ? {} : { authorMerges });
    expect(authorHasFewerMerges(pr(3), 10)).toBe(true);
    expect(authorHasFewerMerges(pr(0), 10)).toBe(true);
    expect(authorHasFewerMerges(pr(10), 10)).toBe(false);
    expect(authorHasFewerMerges(pr(30), 10)).toBe(false);
    expect(authorHasFewerMerges(pr(null), 10)).toBe(false);
    expect(authorHasFewerMerges(pr(), 10)).toBe(false);
    expect(authorHasFewerMerges(pr(0), 0)).toBe(false);
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

  it('is judged against the credited actor: the human merger of a bot PR merged it alone', () => {
    const merger = human(5);
    const pr = mergedFacts({ author: bot(9), mergedBy: merger });
    const own = { reviewerId: 5, state: 'APPROVED' } as const;
    const other = { reviewerId: REVIEWER_ID, state: 'APPROVED' } as const;
    expect(mergeFacts(mergedEvent(pr, merger), prStateFor(pr, { reviews: [own] }))).toMatchObject({
      soloKill: true,
      party: false,
    });
    expect(
      mergeFacts(mergedEvent(pr, merger), prStateFor(pr, { reviews: [own, other] })),
    ).toMatchObject({ soloKill: false, party: true });
  });

  it('counts a bot merger as the author merging, but not another human', () => {
    const byBot = mergedEvent(mergedFacts({ mergedBy: bot(77) }));
    expect(mergeFacts(byBot, prStateFor(byBot.pr)).soloKill).toBe(true);
    const reviewed = prStateFor(byBot.pr, {
      reviews: [{ reviewerId: REVIEWER_ID, state: 'APPROVED' }],
    });
    expect(mergeFacts(byBot, reviewed).soloKill).toBe(false);
  });

  it('reports the default branch', () => {
    expect(mergeFacts(mergedEvent(mergedFacts()), prStateFor(facts())).defaultBranch).toBe(true);
    const off = mergedEvent(mergedFacts({ baseRefIsDefault: false }));
    expect(mergeFacts(off, prStateFor(off.pr)).defaultBranch).toBe(false);
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
