import { afterEach, describe, expect, it, vi } from 'vitest';
import { D2_XP } from './d2table';
import { actWindow, score, sizePoints, sizeTier, streakPoints, utcDay, zoneFor } from './score';
import { applyScoreResult, createPlayerState, createPRState } from './state';
import {
  AUTHOR_ID,
  BOSS_NOW,
  bot,
  charm,
  closedEvent,
  facts,
  human,
  inlineEvent,
  mergedEvent,
  mergedFacts,
  NOW,
  openedEvent,
  OTHER_REVIEWER_ID,
  playerAtLevel,
  prStateFor,
  RAID_NOW,
  reviewEvent,
  REVIEWER_ID,
  settledPlayer,
  syncEvent,
  verifiedKill,
} from './test-builders';
import type {
  GameEvent,
  PlayerState,
  PRState,
  ReviewerCounters,
  ReviewRecord,
  ScoreResult,
} from './types';

const ZONE_L1 = Math.pow(2, 1.6);

function run(event: GameEvent, player: PlayerState, pr?: PRState, now: number = NOW): ScoreResult {
  const state = pr ?? ('pr' in event ? createPRState(event.pr) : prStateFor(facts()));
  return score(event, player, state, now);
}

function pointsLines(result: ScoreResult) {
  return result.breakdown.filter((line) => line.kind === 'points');
}

function withReviews(reviews: ReviewRecord[], overrides: Partial<PRState> = {}): PRState {
  return prStateFor(mergedFacts(), { reviews, ...overrides });
}

function counters(reviewerId: number, value: ReviewerCounters): Partial<PRState> {
  return { reviewerCounters: { [String(reviewerId)]: value } };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('helpers', () => {
  it('utcDay formats the UTC calendar day', () => {
    expect(utcDay(Date.UTC(2026, 10, 9, 23, 59, 59))).toBe('2026-11-09');
    expect(utcDay(Date.UTC(2026, 10, 10, 0, 0, 0))).toBe('2026-11-10');
  });

  it('actWindow maps UTC weekdays to Scout, Raid and Boss', () => {
    const day = (d: number) => Date.UTC(2026, 10, d, 12);
    expect([9, 10].map((d) => actWindow(day(d)))).toEqual(['scout', 'scout']); // Mon, Tue
    expect([11, 12].map((d) => actWindow(day(d)))).toEqual(['raid', 'raid']); // Wed, Thu
    expect([13, 14, 15].map((d) => actWindow(day(d)))).toEqual(['boss', 'boss', 'boss']); // Fri-Sun
  });

  it('sizePoints follows round(40 * log2(1 + lines / 50)) capped at 120 (design.md 4.2)', () => {
    expect(sizePoints(0)).toBe(0);
    expect(sizePoints(50)).toBe(40);
    expect(sizePoints(120)).toBe(71);
    expect(sizePoints(300)).toBe(112);
    expect(sizePoints(350)).toBe(120);
    expect(sizePoints(1000)).toBe(120);
    expect(sizePoints(4000)).toBe(120);
  });

  it('sizeTier steps at 50, 300 and 1000 lines', () => {
    expect([0, 49, 50, 299, 300, 999, 1000, 5000].map(sizeTier)).toEqual([0, 0, 1, 1, 2, 2, 3, 3]);
  });

  it('zoneFor is (level + 1) ^ exponent', () => {
    expect(zoneFor(1, 1.6)).toBeCloseTo(3.0314331330207964, 12);
    expect(zoneFor(99, 1.6)).toBeCloseTo(Math.pow(100, 1.6), 9);
    expect(zoneFor(23, 1.65)).toBeCloseTo(Math.pow(24, 1.65), 9);
  });

  it('streakPoints is 50 per week, capped at 10 weeks', () => {
    expect([1, 2, 10, 11, 52].map(streakPoints)).toEqual([50, 100, 500, 500, 500]);
  });
});

describe('PR opened (10, Smithing, max 5 per UTC day)', () => {
  it('scores 10 for Smithing and records the open', () => {
    const result = run(openedEvent(), settledPlayer());
    expect(result.skip).toBeNull();
    expect(result.points).toBe(10);
    expect(result.skill).toBe('smithing');
    expect(result.xp).toBe(Math.floor(10 * ZONE_L1));
    expect(result.counterUpdates.player.opens).toEqual({ day: '2026-11-09', count: 1 });
    expect(pointsLines(result)).toEqual([{ label: 'PR opened', value: 10, kind: 'points' }]);
    expect(result.monster).toBe('merge-goblin');
    expect(result.supplies).toEqual({ ore: 0, timber: 0, lore: 0, ink: 0, provisions: 0, flux: 0 });
  });

  it('scores the 5th open of the day and refuses the 6th (cap boundary)', () => {
    const day = '2026-11-09';
    const fifth = run(
      openedEvent(),
      settledPlayer(AUTHOR_ID, {
        counters: { opens: { day, count: 4 }, dailyFirstDay: day, streakWeeks: 0 },
      }),
    );
    expect(fifth.points).toBe(10);
    expect(fifth.counterUpdates.player.opens).toEqual({ day, count: 5 });

    const sixth = run(
      openedEvent(),
      settledPlayer(AUTHOR_ID, {
        counters: { opens: { day, count: 5 }, dailyFirstDay: day, streakWeeks: 0 },
      }),
    );
    expect(sixth.skip).toBe('cap');
    expect(sixth.points).toBe(0);
    expect(sixth.xp).toBe(0);
    expect(sixth.counterUpdates).toEqual({ player: {}, pr: {} });
  });

  it('a capped open does not claim the daily first-event bonus', () => {
    const day = '2026-11-09';
    const result = run(openedEvent(), createPlayerState(AUTHOR_ID), undefined, NOW);
    expect(result.counterUpdates.player.dailyFirstDay).toBe(day);
    const capped = run(openedEvent(), {
      ...createPlayerState(AUTHOR_ID),
      counters: { opens: { day, count: 5 }, dailyFirstDay: null, streakWeeks: 0 },
    });
    expect(capped.skip).toBe('cap');
    expect(capped.counterUpdates.player.dailyFirstDay).toBeUndefined();
  });

  it('counts opens per UTC day: a stale day resets the count', () => {
    const player = settledPlayer(AUTHOR_ID, {
      counters: {
        opens: { day: '2026-11-08', count: 5 },
        dailyFirstDay: '2026-11-09',
        streakWeeks: 0,
      },
    });
    const result = run(openedEvent(), player);
    expect(result.points).toBe(10);
    expect(result.counterUpdates.player.opens).toEqual({ day: '2026-11-09', count: 1 });
  });

  it('drafts earn nothing on opening but score when marked ready for review', () => {
    const draft = run(openedEvent(facts({ draft: true })), settledPlayer());
    expect(draft.skip).toBe('draft');
    expect(draft.points).toBe(0);
    expect(draft.counterUpdates).toEqual({ player: {}, pr: {} });

    const ready = run(openedEvent(facts({ draft: false }), 'ready_for_review'), settledPlayer());
    expect(ready.points).toBe(10);
  });

  it('is halved off the default branch', () => {
    const result = run(openedEvent(facts({ baseRefIsDefault: false })), settledPlayer());
    expect(result.points).toBe(5);
    expect(pointsLines(result)[0]?.label).toBe('PR opened (non-default branch x0.5)');
  });

  it('works when the payload had no size stats', () => {
    expect(run(openedEvent(facts({ stats: null })), settledPlayer()).points).toBe(10);
  });
});

describe('PR merged (90 + size + party, Smithing)', () => {
  const approved: ReviewRecord = { reviewerId: REVIEWER_ID, state: 'APPROVED' };

  it('scores merge + size + party for a reviewed 120-line merge (191)', () => {
    const event = mergedEvent(
      mergedFacts({ stats: { additions: 100, deletions: 20, changedFiles: 3, commits: 2 } }),
    );
    const result = run(event, settledPlayer(), withReviews([approved]));
    expect(result.points).toBe(90 + 71 + 30);
    expect(pointsLines(result).map((line) => [line.label, line.value])).toEqual([
      ['PR merged', 90],
      ['Size (log-scaled, 120 lines)', 71],
      ['Reviewed by another human', 30],
    ]);
    expect(result.skill).toBe('smithing');
    expect(result.supplies).toMatchObject({ ore: 2, timber: 1, provisions: 2, flux: 0 });
  });

  it('halves merge, size and party on a solo kill (merged by the author, no other human review)', () => {
    const result = run(mergedEvent(), settledPlayer());
    expect(result.points).toBe(45 + 35);
    expect(pointsLines(result).map((line) => line.label)).toEqual([
      'PR merged (solo kill x0.5)',
      'Size (log-scaled, 120 lines) (solo kill x0.5)',
    ]);
    expect(result.supplies.provisions).toBe(0);
  });

  it('a COMMENTED review from another human is enough to avoid the solo halving', () => {
    const result = run(
      mergedEvent(),
      settledPlayer(),
      withReviews([{ reviewerId: REVIEWER_ID, state: 'COMMENTED' }]),
    );
    expect(result.points).toBe(90 + 71);
  });

  it('the author reviewing their own PR does not count as another human', () => {
    const result = run(
      mergedEvent(),
      settledPlayer(),
      withReviews([{ reviewerId: AUTHOR_ID, state: 'APPROVED' }]),
    );
    expect(result.points).toBe(45 + 35);
  });

  it('is not a solo kill when another human merged it, and the author is still credited', () => {
    const pr = mergedFacts({ mergedBy: human(OTHER_REVIEWER_ID) });
    expect(run(mergedEvent(pr), settledPlayer()).points).toBe(90 + 71);
  });

  it('is not a solo kill when the merger is unknown', () => {
    expect(run(mergedEvent(mergedFacts({ mergedBy: null })), settledPlayer()).points).toBe(90 + 71);
  });

  it('adds a Riposte when another human requested changes, and a party bonus once they approve', () => {
    const changesOnly = run(
      mergedEvent(),
      settledPlayer(),
      withReviews([{ reviewerId: REVIEWER_ID, state: 'CHANGES_REQUESTED' }]),
    );
    expect(changesOnly.points).toBe(90 + 71 + 15);
    expect(changesOnly.supplies.flux).toBe(1);
    expect(changesOnly.supplies.provisions).toBe(0);

    const both = run(
      mergedEvent(),
      settledPlayer(),
      withReviews([{ reviewerId: REVIEWER_ID, state: 'CHANGES_REQUESTED' }, approved]),
    );
    expect(both.points).toBe(90 + 71 + 30 + 15);
    expect(pointsLines(both).at(-1)).toEqual({
      label: 'Riposte (feedback addressed)',
      value: 15,
      kind: 'points',
    });
  });

  it('size points cap at 120 and a 1000-line merge fights a Legacy Golem', () => {
    const big = mergedFacts({
      stats: { additions: 900, deletions: 100, changedFiles: 30, commits: 9 },
    });
    const result = run(mergedEvent(big), settledPlayer(), withReviews([approved]));
    expect(result.points).toBe(90 + 120 + 30);
    expect(result.supplies.ore).toBe(4);
    expect(result.monster).toBe('legacy-golem');
  });

  it('a zero-line merge has no size term', () => {
    const empty = mergedFacts({
      stats: { additions: 0, deletions: 0, changedFiles: 0, commits: 1 },
    });
    const result = run(mergedEvent(empty), settledPlayer(), withReviews([approved]));
    expect(result.points).toBe(90 + 30);
    expect(result.supplies.ore).toBe(1);
  });

  it('falls back to the stored size when the event carries none', () => {
    const result = run(
      mergedEvent(mergedFacts({ stats: null })),
      settledPlayer(),
      withReviews([approved], { additions: 250, deletions: 50 }),
    );
    expect(result.points).toBe(90 + 112 + 30);
  });

  it('halves every term off the default branch, and quarters merge and size on a solo kill', () => {
    const reviewed = run(
      mergedEvent(mergedFacts({ baseRefIsDefault: false })),
      settledPlayer(),
      withReviews([approved]),
    );
    expect(reviewed.points).toBe(45 + 35 + 15);

    const solo = run(mergedEvent(mergedFacts({ baseRefIsDefault: false })), settledPlayer());
    expect(solo.points).toBe(22 + 17);
    expect(pointsLines(solo)[0]?.label).toBe('PR merged (solo kill x0.5, non-default branch x0.5)');
  });

  it('halves the Riposte off the default branch', () => {
    const result = run(
      mergedEvent(mergedFacts({ baseRefIsDefault: false })),
      settledPlayer(),
      withReviews([{ reviewerId: REVIEWER_ID, state: 'CHANGES_REQUESTED' }]),
    );
    expect(result.points).toBe(45 + 35 + 7);
  });

  it('an event that did not merge scores nothing', () => {
    const result = run(mergedEvent(mergedFacts({ merged: false })), settledPlayer());
    expect(result.skip).toBe('not_scoring');
    expect(result.points).toBe(0);
  });

  it('credits a human merger of a bot-authored PR in full (no solo halving), ignoring their own review', () => {
    const merger = human(5);
    const pr = mergedFacts({ author: bot(9), mergedBy: merger });
    const result = run(
      mergedEvent(pr, merger),
      settledPlayer(5),
      prStateFor(pr, { reviews: [{ reviewerId: 5, state: 'APPROVED' }] }),
    );
    expect(result.skip).toBeNull();
    expect(result.points).toBe(90 + 71);
  });

  it('awards nothing to a bot actor', () => {
    const pr = mergedFacts({ author: bot(9), mergedBy: bot(9) });
    const result = run(mergedEvent(pr), createPlayerState(9));
    expect(result.skip).toBe('bot');
    expect(result.xp).toBe(0);
    expect(result.counterUpdates).toEqual({ player: {}, pr: {} });
  });
});

describe('Reviews (APPROVED/CHANGES_REQUESTED 40, COMMENTED 15, Vigilance)', () => {
  const reviewer = (overrides: Partial<PlayerState> = {}) => settledPlayer(REVIEWER_ID, overrides);

  it.each([
    ['APPROVED', 40, 2, 'Review: approved'],
    ['CHANGES_REQUESTED', 40, 2, 'Review: changes requested'],
    ['COMMENTED', 15, 1, 'Review: comment'],
  ] as const)('%s review scores %i points and %i Lore', (state, points, lore, label) => {
    const result = run(reviewEvent(state), reviewer());
    expect(result.points).toBe(points);
    expect(result.skill).toBe('vigilance');
    expect(result.supplies.lore).toBe(lore);
    expect(pointsLines(result)[0]?.label).toBe(label);
    expect(result.counterUpdates.pr.review).toEqual({ reviewerId: REVIEWER_ID, state });
  });

  it('allows 2 scoring reviews per PR per reviewer (re-review counts), then refuses but still records', () => {
    let player = reviewer();
    let pr = createPRState(facts());
    const first = score(reviewEvent('CHANGES_REQUESTED'), player, pr, NOW);
    expect(first.points).toBe(40);
    expect(first.counterUpdates.pr.reviewerCounters?.counters).toEqual({
      decisions: 1,
      comments: 0,
      inline: 0,
    });
    ({ player, pr } = applyScoreResult(player, pr, first));

    const second = score(reviewEvent('APPROVED'), player, pr, NOW);
    expect(second.points).toBe(40);
    ({ player, pr } = applyScoreResult(player, pr, second));
    expect(pr.reviewerCounters[String(REVIEWER_ID)]?.decisions).toBe(2);

    const third = score(reviewEvent('APPROVED'), player, pr, NOW);
    expect(third.skip).toBe('cap');
    expect(third.xp).toBe(0);
    expect(third.counterUpdates.pr.review).toEqual({ reviewerId: REVIEWER_ID, state: 'APPROVED' });
    expect(third.counterUpdates.pr.reviewerCounters).toBeUndefined();
  });

  it('allows 1 comment-only review per PR per reviewer', () => {
    const first = run(reviewEvent('COMMENTED'), reviewer());
    expect(first.points).toBe(15);
    const pr = prStateFor(facts(), counters(REVIEWER_ID, { decisions: 0, comments: 1, inline: 0 }));
    const second = run(reviewEvent('COMMENTED'), reviewer(), pr);
    expect(second.skip).toBe('cap');
    expect(second.points).toBe(0);
  });

  it('keeps the decision and comment caps independent of each other', () => {
    const pr = prStateFor(facts(), counters(REVIEWER_ID, { decisions: 0, comments: 1, inline: 0 }));
    expect(run(reviewEvent('APPROVED'), reviewer(), pr).points).toBe(40);
    const pr2 = prStateFor(
      facts(),
      counters(REVIEWER_ID, { decisions: 2, comments: 0, inline: 0 }),
    );
    expect(run(reviewEvent('COMMENTED'), reviewer(), pr2).points).toBe(15);
  });

  it('caps each reviewer separately', () => {
    const pr = prStateFor(
      facts(),
      counters(REVIEWER_ID, { decisions: 2, comments: 1, inline: 10 }),
    );
    const other = settledPlayer(OTHER_REVIEWER_ID);
    expect(run(reviewEvent('APPROVED', human(OTHER_REVIEWER_ID)), other, pr).points).toBe(40);
  });

  it('counts review rounds on CHANGES_REQUESTED only', () => {
    const pr = prStateFor(facts(), { reviewRoundCount: 1 });
    expect(
      run(reviewEvent('CHANGES_REQUESTED'), reviewer(), pr).counterUpdates.pr.reviewRoundCount,
    ).toBe(2);
    expect(run(reviewEvent('APPROVED'), reviewer(), pr).counterUpdates.pr.reviewRoundCount).toBe(1);
  });

  it('records a capped CHANGES_REQUESTED as a review round', () => {
    const pr = prStateFor(facts(), counters(REVIEWER_ID, { decisions: 2, comments: 0, inline: 0 }));
    const result = run(reviewEvent('CHANGES_REQUESTED'), reviewer(), pr);
    expect(result.skip).toBe('cap');
    expect(result.counterUpdates.pr.reviewRoundCount).toBe(1);
  });

  it('is halved off the default branch', () => {
    const pr = facts({ baseRefIsDefault: false });
    expect(run(reviewEvent('APPROVED', human(REVIEWER_ID), pr), reviewer()).points).toBe(20);
    expect(run(reviewEvent('COMMENTED', human(REVIEWER_ID), pr), reviewer()).points).toBe(7);
  });

  it('does not reward reviewing your own PR and does not record it', () => {
    const result = run(reviewEvent('COMMENTED', human(AUTHOR_ID)), settledPlayer(AUTHOR_ID));
    expect(result.skip).toBe('own_pr');
    expect(result.points).toBe(0);
    expect(result.counterUpdates).toEqual({ player: {}, pr: {} });
  });

  it('awards nothing to a bot reviewer', () => {
    const result = run(reviewEvent('APPROVED', bot(77)), createPlayerState(77));
    expect(result.skip).toBe('bot');
    expect(result.counterUpdates).toEqual({ player: {}, pr: {} });
  });
});

describe('Inline review comments (5, Oratory, max 10 per PR per reviewer)', () => {
  const commenter = () => settledPlayer(REVIEWER_ID);

  it('scores 5 for Oratory and 1 Ink', () => {
    const result = run(inlineEvent(), commenter());
    expect(result.points).toBe(5);
    expect(result.skill).toBe('oratory');
    expect(result.supplies.ink).toBe(1);
    expect(result.counterUpdates.pr.reviewerCounters).toEqual({
      reviewerId: REVIEWER_ID,
      counters: { decisions: 0, comments: 0, inline: 1 },
    });
  });

  it('scores the 10th comment on a PR and refuses the 11th (cap boundary)', () => {
    const ninth = prStateFor(
      facts(),
      counters(REVIEWER_ID, { decisions: 0, comments: 0, inline: 9 }),
    );
    const tenth = run(inlineEvent(), commenter(), ninth);
    expect(tenth.points).toBe(5);
    expect(tenth.counterUpdates.pr.reviewerCounters?.counters.inline).toBe(10);

    const full = prStateFor(
      facts(),
      counters(REVIEWER_ID, { decisions: 0, comments: 0, inline: 10 }),
    );
    const eleventh = run(inlineEvent(), commenter(), full);
    expect(eleventh.skip).toBe('cap');
    expect(eleventh.points).toBe(0);
    expect(eleventh.counterUpdates).toEqual({ player: {}, pr: {} });
  });

  it('drops Ink after 5 comments per PR (game-design.md 6.1)', () => {
    const fifth = prStateFor(
      facts(),
      counters(REVIEWER_ID, { decisions: 0, comments: 0, inline: 4 }),
    );
    expect(run(inlineEvent(), commenter(), fifth).supplies.ink).toBe(1);
    const sixth = prStateFor(
      facts(),
      counters(REVIEWER_ID, { decisions: 0, comments: 0, inline: 5 }),
    );
    const result = run(inlineEvent(), commenter(), sixth);
    expect(result.points).toBe(5);
    expect(result.supplies.ink).toBe(0);
  });

  it('is halved (rounded down) off the default branch', () => {
    const result = run(
      inlineEvent(human(REVIEWER_ID), facts({ baseRefIsDefault: false })),
      commenter(),
    );
    expect(result.points).toBe(2);
  });

  it('does not reward commenting on your own PR', () => {
    const result = run(inlineEvent(human(AUTHOR_ID)), settledPlayer(AUTHOR_ID));
    expect(result.skip).toBe('own_pr');
  });

  it('awards nothing to a bot commenter', () => {
    expect(run(inlineEvent(bot(77)), createPlayerState(77)).skip).toBe('bot');
  });
});

describe('Verified kill (+25, Vigilance)', () => {
  it('scores 25 for the approver of a PR that merged', () => {
    const result = run(verifiedKill(), settledPlayer(REVIEWER_ID));
    expect(result.points).toBe(25);
    expect(result.skill).toBe('vigilance');
    expect(result.xp).toBe(Math.floor(25 * ZONE_L1));
  });

  it('is halved off the default branch', () => {
    const pr = mergedFacts({ baseRefIsDefault: false });
    expect(run(verifiedKill(human(REVIEWER_ID), pr), settledPlayer(REVIEWER_ID)).points).toBe(12);
  });

  it('needs a merged PR', () => {
    const result = run(verifiedKill(human(REVIEWER_ID), facts()), settledPlayer(REVIEWER_ID));
    expect(result.skip).toBe('not_scoring');
  });

  it('is not awarded to the PR author', () => {
    expect(run(verifiedKill(human(AUTHOR_ID)), settledPlayer(AUTHOR_ID)).skip).toBe('own_pr');
  });

  it('is not awarded to a bot', () => {
    expect(run(verifiedKill(bot(5)), createPlayerState(5)).skip).toBe('bot');
  });

  it('uses the stored size for its monster when the event carries none', () => {
    const pr = mergedFacts({ stats: null });
    const state = prStateFor(pr, { additions: 800, deletions: 400 });
    expect(
      run(verifiedKill(human(REVIEWER_ID), pr), settledPlayer(REVIEWER_ID), state).monster,
    ).toBe('legacy-golem');
  });
});

describe('Daily first event (+20, Endurance, once per UTC day)', () => {
  it('adds 20 to the first scored event of the day and splits the XP into Endurance', () => {
    const player = createPlayerState(REVIEWER_ID);
    const result = run(reviewEvent('APPROVED'), player);
    expect(result.points).toBe(60);
    expect(pointsLines(result).map((line) => line.value)).toEqual([40, 20]);
    expect(pointsLines(result)[1]?.label).toBe('First event of the day');
    expect(result.counterUpdates.player.dailyFirstDay).toBe('2026-11-09');
    expect(result.supplies.provisions).toBe(1);
    expect(result.xp).toBe(Math.floor(60 * ZONE_L1));
    expect(result.skillXp.endurance).toBe(Math.floor(20 * ZONE_L1));
    expect(result.skillXp.vigilance).toBe(result.xp - result.skillXp.endurance);
    expect(result.skill).toBe('vigilance');
  });

  it('does not repeat on the same UTC day, and returns the next day', () => {
    const player = createPlayerState(REVIEWER_ID);
    const first = run(reviewEvent('APPROVED'), player);
    const afterFirst = applyScoreResult(player, createPRState(facts()), first).player;
    const sameDay = run(inlineEvent(), afterFirst, undefined, NOW + 3600_000);
    expect(sameDay.points).toBe(5);
    expect(sameDay.counterUpdates.player.dailyFirstDay).toBeUndefined();
    const nextDay = run(inlineEvent(), afterFirst, undefined, NOW + 24 * 3600_000);
    expect(nextDay.points).toBe(25);
    expect(nextDay.counterUpdates.player.dailyFirstDay).toBe('2026-11-10');
  });

  it('is not claimed by events that score nothing', () => {
    const player = createPlayerState(AUTHOR_ID);
    const results = [
      run(openedEvent(facts({ draft: true })), player),
      run(closedEvent(), player),
      run(syncEvent(), player),
      run(mergedEvent(mergedFacts({ merged: false })), player),
    ];
    for (const result of results) {
      expect(result.counterUpdates.player.dailyFirstDay).toBeUndefined();
    }
  });

  it('is not halved off the default branch', () => {
    const pr = facts({ baseRefIsDefault: false });
    const result = run(
      reviewEvent('APPROVED', human(REVIEWER_ID), pr),
      createPlayerState(REVIEWER_ID),
    );
    expect(result.points).toBe(20 + 20);
  });

  it('floors the Endurance share so skill XP always sums to the total', () => {
    const player = {
      ...playerAtLevel(23, REVIEWER_ID, { charms: [charm(2.5)] }),
      counters: { opens: { day: '', count: 0 }, dailyFirstDay: null, streakWeeks: 0 },
    };
    const result = run(reviewEvent('APPROVED'), player);
    const sum = Object.values(result.skillXp).reduce((a, b) => a + b, 0);
    expect(sum).toBe(result.xp);
    expect(result.skillXp.endurance).toBe(Math.floor(20 * 3.5 * Math.pow(24, 1.6)));
  });
});

describe('Weekly streak (50 x consecutive weeks, cap 10, Endurance)', () => {
  const streakEvent = (qualified: boolean, actor = human(AUTHOR_ID)): GameEvent => ({
    kind: 'weekly_streak',
    actor,
    qualified,
  });
  const withStreak = (weeks: number): PlayerState => ({
    ...createPlayerState(AUTHOR_ID),
    counters: { opens: { day: '', count: 0 }, dailyFirstDay: null, streakWeeks: weeks },
  });

  it.each([
    [0, 50, 1],
    [2, 150, 3],
    [8, 450, 9],
    [9, 500, 10],
    [10, 500, 11],
    [30, 500, 31],
  ])('a streak of %i prior weeks pays %i points and records %i weeks', (prior, points, weeks) => {
    const result = run(streakEvent(true), withStreak(prior), prStateFor(facts()));
    expect(result.points).toBe(points);
    expect(result.skill).toBe('endurance');
    expect(result.counterUpdates.player.streakWeeks).toBe(weeks);
    expect(result.monster).toBeNull();
  });

  it('does not claim the daily first-event bonus', () => {
    const result = run(streakEvent(true), withStreak(0), prStateFor(facts()));
    expect(result.points).toBe(50);
    expect(result.counterUpdates.player.dailyFirstDay).toBeUndefined();
  });

  it('a week without enough activity resets the streak and scores nothing', () => {
    const result = run(streakEvent(false), withStreak(7), prStateFor(facts()));
    expect(result.skip).toBe('not_scoring');
    expect(result.xp).toBe(0);
    expect(result.counterUpdates.player).toEqual({ streakWeeks: 0 });
  });

  it('ignores a bot', () => {
    expect(run(streakEvent(true, bot(1)), withStreak(0), prStateFor(facts())).skip).toBe('bot');
  });
});

describe('Events that never score', () => {
  it('closing a PR unmerged earns 0 and changes nothing', () => {
    const result = run(closedEvent(), createPlayerState(AUTHOR_ID));
    expect(result.skip).toBe('not_scoring');
    expect(result.xp).toBe(0);
    expect(result.skill).toBeNull();
    expect(result.monster).toBeNull();
    expect(result.breakdown).toEqual([]);
    expect(result.counterUpdates).toEqual({ player: {}, pr: {} });
  });

  it('synchronize is counted for the Flaky Test Wraith and never scored', () => {
    const pr = prStateFor(facts(), { syncCount: 2 });
    const result = run(syncEvent(), createPlayerState(AUTHOR_ID), pr);
    expect(result.skip).toBe('not_scoring');
    expect(result.xp).toBe(0);
    expect(result.counterUpdates).toEqual({ player: {}, pr: { syncCount: 3 } });
  });

  it('synchronize on a bot-authored PR is still counted', () => {
    const event = syncEvent(facts({ author: bot(9) }));
    expect(run(event, createPlayerState(9)).counterUpdates.pr.syncCount).toBe(1);
  });

  it('installation events are not scoring events', () => {
    const installation: GameEvent = {
      kind: 'installation',
      action: 'created',
      installationId: 1,
      accountId: 2,
      repositoryIds: [3],
      sender: human(4),
    };
    const repos: GameEvent = {
      kind: 'installation_repositories',
      installationId: 1,
      accountId: 2,
      added: [3],
      removed: [],
      sender: human(4),
    };
    for (const event of [installation, repos]) {
      const result = run(event, createPlayerState(4));
      expect(result.skip).toBe('not_scoring');
      expect(result.xp).toBe(0);
    }
  });
});

describe('Zone, Power and XP', () => {
  it('uses the level before the event: level 1 at 0 XP, level 2 at 500 XP', () => {
    const level1 = run(openedEvent(), settledPlayer());
    expect(level1.level).toBe(1);
    expect(level1.zone).toBeCloseTo(ZONE_L1, 12);
    const level2 = run(openedEvent(), settledPlayer(AUTHOR_ID, { xp: 500 }));
    expect(level2.level).toBe(2);
    expect(level2.zone).toBeCloseTo(Math.pow(3, 1.6), 12);
    expect(run(openedEvent(), settledPlayer(AUTHOR_ID, { xp: 499 })).level).toBe(1);
  });

  it('uses the Zone exponent stored on the player (Overclock 1.65)', () => {
    const player = playerAtLevel(23, AUTHOR_ID, { zoneExponent: 1.65 });
    const result = run(openedEvent(), player);
    expect(result.zone).toBeCloseTo(Math.pow(24, 1.65), 9);
    expect(result.xp).toBe(Math.floor(10 * Math.pow(24, 1.65)));
  });

  it('keeps the level at 99 for Zone while XP accumulates', () => {
    const player = settledPlayer(AUTHOR_ID, { xp: D2_XP[99]! + 1_000_000 });
    const result = run(openedEvent(), player);
    expect(result.level).toBe(99);
    expect(result.zone).toBeCloseTo(Math.pow(100, 1.6), 9);
  });

  it('multiplies by Power from the player hooks, capped at 9', () => {
    const power = (charms: ReturnType<typeof charm>[]) =>
      run(openedEvent(), settledPlayer(AUTHOR_ID, { charms })).power;
    expect(power([])).toBe(1);
    expect(power([charm(1.5), charm(1)])).toBe(3.5);
    expect(power([charm(5), charm(5)])).toBe(9);
    const capped = run(openedEvent(), settledPlayer(AUTHOR_ID, { charms: [charm(5), charm(5)] }));
    expect(capped.xp).toBe(Math.floor(10 * 9 * ZONE_L1));
  });

  it('floors XP', () => {
    const result = run(openedEvent(), settledPlayer());
    expect(10 * ZONE_L1).toBeGreaterThan(30);
    expect(result.xp).toBe(30);
  });
});

describe('breakdown', () => {
  it('lists points, then Power, then one Zone line, then XP (total first, then per skill)', () => {
    const player = playerAtLevel(23, REVIEWER_ID, { charms: [charm(1.5, 'Rubber Duck')] });
    const result = run(reviewEvent('APPROVED'), player);
    expect(result.breakdown.map((line) => line.kind)).toEqual([
      'points',
      'power',
      'power',
      'zone',
      'xp',
      'xp',
    ]);
    const sum = (kind: string) =>
      result.breakdown.filter((line) => line.kind === kind).reduce((s, line) => s + line.value, 0);
    expect(sum('points')).toBe(result.points);
    expect(sum('power')).toBeCloseTo(result.power, 9);
    expect(result.breakdown.find((line) => line.kind === 'zone')).toEqual({
      label: 'Zone (level 23)',
      value: result.zone,
      kind: 'zone',
    });
    const xpLines = result.breakdown.filter((line) => line.kind === 'xp');
    expect(xpLines).toEqual([
      { label: 'XP', value: result.xp, kind: 'xp' },
      { label: 'Vigilance XP', value: result.xp, kind: 'xp' },
    ]);
  });

  it('lists Endurance XP separately when the daily bonus applies', () => {
    const result = run(reviewEvent('APPROVED'), createPlayerState(REVIEWER_ID));
    const labels = result.breakdown.filter((line) => line.kind === 'xp').map((line) => line.label);
    expect(labels).toEqual(['XP', 'Vigilance XP', 'Endurance XP']);
  });
});

describe('monster choice (design.md 7.1)', () => {
  const approved: ReviewRecord = { reviewerId: REVIEWER_ID, state: 'APPROVED' };
  const monsterOf = (
    pr: ReturnType<typeof mergedFacts>,
    state: PRState = withReviews([approved]),
    player: PlayerState = settledPlayer(),
    now: number = NOW,
  ) => run(mergedEvent(pr), player, state, now).monster;

  it('Merge Goblin is the default for an ordinary merge (including 300-999 lines)', () => {
    expect(monsterOf(mergedFacts())).toBe('merge-goblin');
    const mid = mergedFacts({
      stats: { additions: 600, deletions: 399, changedFiles: 9, commits: 3 },
    });
    expect(monsterOf(mid)).toBe('merge-goblin');
  });

  it('Legacy Golem needs a merged PR of at least 1,000 lines', () => {
    const lines = (n: number) =>
      mergedFacts({ stats: { additions: n, deletions: 0, changedFiles: 9, commits: 3 } });
    expect(monsterOf(lines(999))).toBe('merge-goblin');
    expect(monsterOf(lines(1000))).toBe('legacy-golem');
  });

  it('Flaky Test Wraith needs at least 4 pushes', () => {
    expect(monsterOf(mergedFacts(), withReviews([approved], { syncCount: 3 }))).toBe(
      'merge-goblin',
    );
    expect(monsterOf(mergedFacts(), withReviews([approved], { syncCount: 4 }))).toBe(
      'flaky-test-wraith',
    );
  });

  it('Rebase Hydra needs at least 3 review rounds and outranks the Wraith', () => {
    expect(monsterOf(mergedFacts(), withReviews([approved], { reviewRoundCount: 2 }))).toBe(
      'merge-goblin',
    );
    expect(
      monsterOf(mergedFacts(), withReviews([approved], { reviewRoundCount: 3, syncCount: 9 })),
    ).toBe('rebase-hydra');
  });

  it('Scope Creep needs more than 14 days between opening and merge', () => {
    const merged = '2026-11-09T11:00:00Z';
    expect(monsterOf(mergedFacts({ openedAt: '2026-10-26T11:00:00Z', mergedAt: merged }))).toBe(
      'merge-goblin',
    );
    expect(monsterOf(mergedFacts({ openedAt: '2026-10-26T10:59:59Z', mergedAt: merged }))).toBe(
      'scope-creep',
    );
    expect(monsterOf(mergedFacts({ openedAt: null }))).toBe('merge-goblin');
    expect(monsterOf(mergedFacts({ mergedAt: null }))).toBe('merge-goblin');
  });

  it('The Silent Monolith is a merge with no review of any kind in the Raid window', () => {
    expect(monsterOf(mergedFacts(), withReviews([]), settledPlayer(), RAID_NOW)).toBe(
      'silent-monolith',
    );
    expect(monsterOf(mergedFacts(), withReviews([]), settledPlayer(), NOW)).toBe('merge-goblin');
    expect(monsterOf(mergedFacts(), withReviews([approved]), settledPlayer(), RAID_NOW)).toBe(
      'merge-goblin',
    );
  });

  it("Act III's merge fights the week's Mogul when one is set", () => {
    const withMogul = settledPlayer(AUTHOR_ID, { moguls: { current: 'founder', bag: [] } });
    expect(monsterOf(mergedFacts(), withReviews([approved]), withMogul, BOSS_NOW)).toBe('founder');
    expect(monsterOf(mergedFacts(), withReviews([approved]), withMogul, NOW)).toBe('merge-goblin');
    expect(monsterOf(mergedFacts(), withReviews([approved]), settledPlayer(), BOSS_NOW)).toBe(
      'merge-goblin',
    );
    const review = run(
      reviewEvent('APPROVED'),
      settledPlayer(REVIEWER_ID, { moguls: { current: 'founder', bag: [] } }),
      undefined,
      BOSS_NOW,
    );
    expect(review.monster).toBe('merge-goblin');
  });

  it('Nitpick Imp appears once a reviewer has left 5 inline comments', () => {
    const at = (inline: number) =>
      prStateFor(facts(), counters(REVIEWER_ID, { decisions: 0, comments: 0, inline }));
    const commenter = settledPlayer(REVIEWER_ID);
    expect(run(inlineEvent(), commenter, at(3)).monster).toBe('merge-goblin');
    expect(run(inlineEvent(), commenter, at(4)).monster).toBe('nitpick-imp');
    expect(run(reviewEvent('APPROVED'), commenter, at(4)).monster).toBe('merge-goblin');
    expect(run(reviewEvent('APPROVED'), commenter, at(5)).monster).toBe('nitpick-imp');
  });

  it('a review that makes the 3rd round fights the Hydra', () => {
    const pr = prStateFor(facts(), { reviewRoundCount: 2 });
    expect(run(reviewEvent('CHANGES_REQUESTED'), settledPlayer(REVIEWER_ID), pr).monster).toBe(
      'rebase-hydra',
    );
    expect(run(reviewEvent('APPROVED'), settledPlayer(REVIEWER_ID), pr).monster).toBe(
      'merge-goblin',
    );
  });

  it('an opened PR fights a Merge Goblin and the Wraith once it has been pushed 4 times', () => {
    expect(run(openedEvent(), settledPlayer()).monster).toBe('merge-goblin');
    const pushed = prStateFor(facts(), { syncCount: 4 });
    expect(run(openedEvent(), settledPlayer(), pushed).monster).toBe('flaky-test-wraith');
  });

  it('Legacy Golem is for merges only: a 5,000-line PR being opened is a Goblin', () => {
    const big = facts({ stats: { additions: 5000, deletions: 0, changedFiles: 90, commits: 9 } });
    expect(run(openedEvent(big), settledPlayer()).monster).toBe('merge-goblin');
  });
});

describe('purity', () => {
  function deepFreeze<T>(value: T): T {
    if (value !== null && typeof value === 'object') {
      Object.freeze(value);
      for (const child of Object.values(value as Record<string, unknown>)) {
        deepFreeze(child);
      }
    }
    return value;
  }

  it('never mutates its inputs', () => {
    const event = deepFreeze(mergedEvent());
    const player = deepFreeze(createPlayerState(AUTHOR_ID));
    const pr = deepFreeze(
      prStateFor(event.pr, { reviews: [{ reviewerId: REVIEWER_ID, state: 'CHANGES_REQUESTED' }] }),
    );
    expect(() => score(event, player, pr, NOW)).not.toThrow();
  });

  it('does not read the clock', () => {
    const event = reviewEvent('APPROVED');
    const player = createPlayerState(REVIEWER_ID);
    const pr = createPRState(event.pr);
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2001-01-01T00:00:00Z'));
    const a = score(event, player, pr, NOW);
    vi.setSystemTime(new Date('2099-12-31T23:59:59Z'));
    const b = score(event, player, pr, NOW);
    expect(b).toEqual(a);
    const now = vi.spyOn(Date, 'now');
    score(event, player, pr, NOW);
    expect(now).not.toHaveBeenCalled();
  });

  it('returns fresh objects on every call', () => {
    const a = run(openedEvent(), settledPlayer());
    const b = run(openedEvent(), settledPlayer());
    expect(a).toEqual(b);
    a.counterUpdates.player.streakWeeks = 99;
    expect(b.counterUpdates.player.streakWeeks).toBeUndefined();
  });
});

describe('design.md 4.5 worked examples', () => {
  // The design table prints rounded figures (Zone 162.6 at level 23, 721 at level 60; the formula
  // (L+1)^1.6 gives 161.56 and 718.67). Example 1 reproduces to the digit; the others are asserted
  // exactly against the formula and within 1% of the printed figure.
  const within1Percent = (actual: number, printed: number) =>
    expect(Math.abs(actual - printed) / printed).toBeLessThan(0.01);

  it('1. first merged PR, 120 LoC, solo: (90+71) x 0.5 = 80 points, Power 1, level 1, 242 XP, 48% to level 2', () => {
    const pr = mergedFacts({
      stats: { additions: 100, deletions: 20, changedFiles: 3, commits: 1 },
    });
    const result = run(mergedEvent(pr), settledPlayer());
    expect(result.points).toBe(80);
    expect(result.power).toBe(1);
    expect(result.level).toBe(1);
    expect(result.zone).toBeCloseTo(3.03, 2);
    expect(result.xp).toBe(242);
    expect(Math.round((result.xp / 500) * 100)).toBe(48);
  });

  it('2. merged 300 LoC PR approved by a teammate, level 23, Power 3.5: 232 points', () => {
    const pr = mergedFacts({
      stats: { additions: 250, deletions: 50, changedFiles: 6, commits: 4 },
    });
    const player = playerAtLevel(23, AUTHOR_ID, { charms: [charm(2.5)] });
    const result = run(
      mergedEvent(pr),
      player,
      prStateFor(pr, { reviews: [{ reviewerId: REVIEWER_ID, state: 'APPROVED' }] }),
    );
    expect(result.points).toBe(90 + 112 + 30);
    expect(result.power).toBe(3.5);
    expect(result.level).toBe(23);
    expect(result.xp).toBe(Math.floor(232 * 3.5 * Math.pow(24, 1.6)));
    expect(result.xp).toBe(131_187);
    within1Percent(result.xp, 132_000);
  });

  it('3. approve a PR at level 23, Power 3.5: 40 points', () => {
    const player = playerAtLevel(23, REVIEWER_ID, { charms: [charm(2.5)] });
    const result = run(reviewEvent('APPROVED'), player);
    expect(result.points).toBe(40);
    expect(result.xp).toBe(Math.floor(40 * 3.5 * Math.pow(24, 1.6)));
    expect(result.xp).toBe(22_618);
    within1Percent(result.xp, 22_760);
  });

  it('4. approve + 6 inline comments at level 60, Power 5: 40 + 30 = 70 points', () => {
    let player = playerAtLevel(60, REVIEWER_ID, { charms: [charm(4)] });
    let pr = createPRState(facts());
    let points = 0;
    let xp = 0;
    const events: GameEvent[] = [
      reviewEvent('APPROVED'),
      ...Array.from({ length: 6 }, () => inlineEvent()),
    ];
    for (const event of events) {
      const result = score(event, player, pr, NOW);
      expect(result.skip).toBeNull();
      points += result.points;
      xp += result.xp;
      ({ player, pr } = applyScoreResult(player, pr, result));
    }
    const zone = Math.pow(61, 1.6);
    expect(points).toBe(70);
    expect(xp).toBe(Math.floor(40 * 5 * zone) + 6 * Math.floor(5 * 5 * zone));
    expect(xp).toBe(251_529);
    within1Percent(xp, 252_000);
    expect(player.xp).toBe(D2_XP[60]! + xp);
  });
});
