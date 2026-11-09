import { describe, expect, it } from 'vitest';
import { actWindow, DAY_MS, utcDay } from './calendar';
import { addCharm, charmSlotsUsed, copiesOf, freeCharmSlots } from './charms';
import {
  activeMogul,
  applyFounderBoard,
  isMogulId,
  MOGUL_COSMETICS,
  MOGUL_DISCLAIMER,
  MOGUL_IDS,
  mogulChainAfter,
  mogulDefinition,
  mogulFactors,
  mogulGoldMultiplier,
  mogulPowerLines,
  MOGULS,
  mogulSizeLines,
  revealedNextMogul,
  selectMogul,
} from './moguls';
import { score, sizePoints } from './score';
import { applyScoreResult, createPlayerState, createPRState } from './state';
import {
  AUTHOR_ID,
  BOSS_NOW,
  facts,
  held,
  human,
  makeRun,
  mergedEvent,
  mergedFacts,
  NOW,
  openedEvent,
  OTHER_REVIEWER_ID,
  prStateFor,
  RAID_NOW,
  reviewEvent,
  REVIEWER_ID,
  settledPlayer,
} from './test-builders';
import { NAME_DENYLIST, productionSources, SOURCES } from './test-sources';
import type {
  GameEvent,
  MogulId,
  PlayerState,
  PullRequestFacts,
  ReviewRecord,
  ScoreResult,
} from './types';

const WEDNESDAY = Date.UTC(2026, 10, 11, 0, 0, 0);
const FRIDAY = Date.UTC(2026, 10, 13, 0, 0, 0);

/**
 * A player under a Mogul whose daily first-event bonus is already claimed on the day of `now`, so only the
 * event scores. The default is the Boss window's Friday; pass NOW for the Monday tests.
 */
function under(
  mogul: MogulId | null,
  overrides: Partial<PlayerState> = {},
  id = AUTHOR_ID,
  now: number = BOSS_NOW,
): PlayerState {
  const base = settledPlayer(id, overrides);
  return {
    ...base,
    counters: { ...base.counters, dailyFirstDay: utcDay(now) },
    moguls: { ...base.moguls, current: mogul },
  };
}

const jacket = (): PlayerState => under('leather-jacket', {}, AUTHOR_ID, NOW);

function stats(additions: number, deletions: number = 0): PullRequestFacts['stats'] {
  return { additions, deletions, changedFiles: 1, commits: 1 };
}

const approval: ReviewRecord = { reviewerId: REVIEWER_ID, state: 'APPROVED' };

function mergeScore(
  player: PlayerState,
  pr: PullRequestFacts,
  reviews: ReviewRecord[] = [approval],
  now: number = BOSS_NOW,
): ScoreResult {
  return score(mergedEvent(pr), player, prStateFor(pr, { reviews }), now);
}

/** A reviewed merge's points: 90 merge + size + 30 party. */
function reviewedPoints(lines: number): number {
  return 90 + sizePoints(lines) + 30;
}

describe('the six Moguls (Requirement 7.1, design.md 6.2 as audited)', () => {
  it('are The Rocket Man, The Leather Jacket, The Turtleneck, The Hoodie, The Founder, The Two-Pizza Boss', () => {
    expect(MOGULS.map((entry) => [entry.id, entry.name, entry.scope])).toEqual([
      ['rocket-man', 'The Rocket Man', 'boss'],
      ['leather-jacket', 'The Leather Jacket', 'week'],
      ['turtleneck', 'The Turtleneck', 'boss'],
      ['hoodie', 'The Hoodie', 'boss'],
      ['founder', 'The Founder', 'week'],
      ['two-pizza-boss', 'The Two-Pizza Boss', 'boss'],
    ]);
    expect(MOGUL_IDS).toHaveLength(6);
    expect(mogulDefinition('hoodie').modifier).toMatch(/48 hours of their first review/);
    expect(isMogulId('founder')).toBe(true);
    expect(isMogulId('toString')).toBe(false);
    expect(isMogulId('release-dragon')).toBe(false);
  });

  it('carries the satire disclaimer verbatim', () => {
    expect(MOGUL_DISCLAIMER).toBe(
      'The Moguls are fictional caricatures. Any resemblance to persons living, dead or on a podcast is satire.',
    );
  });

  it('has one invented cosmetic per Mogul', () => {
    expect(MOGUL_COSMETICS.map((entry) => entry.mogul)).toEqual([...MOGUL_IDS]);
    expect(new Set(MOGUL_COSMETICS.map((entry) => entry.id)).size).toBe(6);
  });
});

describe('copy review (Requirement 7.5): no real names, company names or trademarks', () => {
  // A denylist of obvious real names and brands. Word-boundary, case-insensitive. "Oracle" is a real
  // company too: the Oracle Charm is a design name outside the Mogul copy, so it is denied only here.
  const DENY = NAME_DENYLIST;
  const pattern = new RegExp(`\\b(${DENY.join('|')})\\b`, 'i');

  it('finds nothing in moguls.ts', () => {
    const source = SOURCES['./moguls.ts'];
    expect(source).toBeTypeOf('string');
    expect(source!.match(pattern)).toBeNull();
  });

  it('finds nothing in the exported copy', () => {
    const copy = JSON.stringify([MOGULS, MOGUL_COSMETICS, MOGUL_DISCLAIMER]);
    expect(copy.match(pattern)).toBeNull();
  });

  it('the scan itself catches a name (positive control)', () => {
    expect('The Leather Jacket, played by Jensen Huang'.match(pattern)).not.toBeNull();
    expect('Metaverse'.match(pattern)).toBeNull();
    expect('MTA Oracle'.match(pattern)).not.toBeNull();
  });

  it('no other shared source names a real person or brand either (Oracle, a Charm name, aside)', () => {
    const generic = new RegExp(
      `\\b(${DENY.filter((name) => name !== 'oracle').join('|')})\\b`,
      'i',
    );
    const offenders = productionSources()
      .filter(([, source]) => generic.test(source))
      .map(([file]) => file);
    expect(offenders).toEqual([]);
  });
});

describe('selection without repeats (Requirement 7.2)', () => {
  /** Run `weeks` weekly picks the way the rollover does, feeding the bag back. */
  function picks(weeks: number, seed0 = 1): MogulId[] {
    let bag: readonly MogulId[] = [];
    const drawn: MogulId[] = [];
    for (let week = 0; week < weeks; week += 1) {
      const next = selectMogul(bag, seed0 + week);
      drawn.push(next.mogul);
      bag = next.bag;
    }
    return drawn;
  }

  it('over 12 weeks each Mogul appears exactly twice, and exactly once per 6-week cycle', () => {
    const drawn = picks(12);
    for (const id of MOGUL_IDS) {
      expect(drawn.filter((entry) => entry === id)).toHaveLength(2);
    }
    expect(new Set(drawn.slice(0, 6)).size).toBe(6);
    expect(new Set(drawn.slice(6)).size).toBe(6);
  });

  it('holds across many seeds, and never repeats a Mogul back to back at the cycle boundary', () => {
    for (let seed = 1; seed <= 60; seed += 1) {
      const drawn = picks(18, seed * 1000);
      for (let cycle = 0; cycle < 3; cycle += 1) {
        expect(new Set(drawn.slice(cycle * 6, cycle * 6 + 6)).size).toBe(6);
      }
      for (let at = 1; at < drawn.length; at += 1) {
        expect(drawn[at]).not.toBe(drawn[at - 1]);
      }
    }
  });

  it('keeps the bag non-empty and bag[0] is the next draw', () => {
    let bag: readonly MogulId[] = [];
    for (let week = 0; week < 14; week += 1) {
      const next = selectMogul(bag, 40 + week);
      expect(next.bag.length).toBeGreaterThan(0);
      expect(new Set(next.bag).size).toBe(next.bag.length);
      const following = selectMogul(next.bag, 99);
      expect(following.mogul).toBe(next.bag[0]);
      bag = next.bag;
    }
  });

  it('is deterministic in the seed, and a new profile (empty bag) starts a fresh cycle', () => {
    expect(selectMogul([], 5)).toEqual(selectMogul([], 5));
    expect(selectMogul([], 5).bag).toHaveLength(5);
    const orders = new Set(Array.from({ length: 30 }, (_, seed) => selectMogul([], seed).mogul));
    expect(orders.size).toBeGreaterThan(2);
  });

  it('ignores unknown or duplicated ids in a stored bag', () => {
    const next = selectMogul(['hoodie', 'hoodie', 'ghost' as MogulId, 'founder'], 3);
    expect(next.mogul).toBe('hoodie');
    expect(next.bag).toEqual(['founder']);
    expect(selectMogul(['ghost' as MogulId], 3).bag).toHaveLength(5);
  });

  it('a bag of one is refilled at once, so next week is always known', () => {
    const next = selectMogul(['turtleneck'], 11);
    expect(next.mogul).toBe('turtleneck');
    expect(next.bag).toHaveLength(6);
    expect(next.bag[0]).not.toBe('turtleneck');
  });

  it("reveals next week's Mogul only with the Oracle Charm or Scout's Eye", () => {
    const bag: MogulId[] = ['hoodie', 'founder'];
    const blind = { ...settledPlayer(), moguls: { ...createPlayerState(1).moguls, bag } };
    expect(revealedNextMogul(blind)).toBeNull();
    expect(revealedNextMogul({ ...blind, charms: [held('oracle')] })).toBe('hoodie');
    expect(revealedNextMogul({ ...blind, vouchers: ['scouts-eye'] })).toBe('hoodie');
    const empty = { ...settledPlayer(), vouchers: ['scouts-eye' as const] };
    expect(revealedNextMogul(empty)).toBeNull();
  });
});

describe('when a modifier applies (Requirement 7.4)', () => {
  it('boss-window Moguls apply only Friday to Sunday; the week Moguls from Monday', () => {
    const event = mergedEvent();
    expect(actWindow(BOSS_NOW)).toBe('boss');
    for (const id of ['rocket-man', 'turtleneck', 'hoodie', 'two-pizza-boss'] as const) {
      expect(activeMogul(under(id), event, NOW)).toBeNull();
      expect(activeMogul(under(id), event, RAID_NOW)).toBeNull();
      expect(activeMogul(under(id), event, BOSS_NOW)).toBe(id);
    }
    for (const id of ['leather-jacket', 'founder'] as const) {
      expect(activeMogul(under(id), event, NOW)).toBe(id);
      expect(activeMogul(under(id), event, BOSS_NOW)).toBe(id);
    }
  });

  it('there is no modifier without a Mogul, and never on the weekly streak', () => {
    expect(activeMogul(under(null), mergedEvent(), BOSS_NOW)).toBeNull();
    const streak: GameEvent = { kind: 'weekly_streak', actor: human(AUTHOR_ID), qualified: true };
    expect(activeMogul(under('founder'), streak, NOW)).toBeNull();
    const result = score(streak, under('founder'), prStateFor(facts()), NOW);
    expect(result.points).toBe(50);
    expect(result.goldMultiplier).toBe(1);
  });

  it('a boss-window Mogul changes nothing on Monday', () => {
    const pr = mergedFacts({ stats: stats(50) });
    const plain = mergeScore(settledPlayer(AUTHOR_ID), pr, [approval], NOW);
    for (const id of ['rocket-man', 'turtleneck', 'hoodie', 'two-pizza-boss'] as const) {
      const result = mergeScore(under(id, {}, AUTHOR_ID, NOW), pr, [approval], NOW);
      expect(result.points).toBe(plain.points);
      expect(result.power).toBe(plain.power);
    }
  });
});

describe('The Rocket Man: deletions count double toward size; net negative merges +1 Power', () => {
  const rocket = under('rocket-man');

  it('counts each deletion twice toward size points', () => {
    expect(mogulSizeLines('rocket-man', 30, 100)).toEqual({ lines: 230, weighted: true });
    expect(mogulSizeLines('rocket-man', 100, 0)).toEqual({ lines: 100, weighted: true });
    expect(mogulSizeLines('founder', 30, 100)).toEqual({ lines: 130, weighted: false });
    expect(mogulSizeLines(null, 30, 100)).toEqual({ lines: 130, weighted: false });
    const pr = mergedFacts({ stats: stats(30, 100) });
    const plain = mergeScore(under(null), pr);
    const result = mergeScore(rocket, pr);
    expect(result.points - plain.points).toBe(sizePoints(230) - sizePoints(130));
    expect(result.breakdown.map((line) => line.label)).toContain(
      'Size (log-scaled, 230 lines, deletions count double)',
    );
  });

  it('gives +1 Power to a merge with more deletions than additions, and only then', () => {
    const net = (additions: number, deletions: number) =>
      mergeScore(rocket, mergedFacts({ stats: stats(additions, deletions) }));
    expect(net(10, 11).power).toBe(2);
    expect(net(10, 11).breakdown).toContainEqual({
      label: 'The Rocket Man (net negative lines)',
      value: 1,
      kind: 'power',
    });
    expect(net(10, 10).power).toBe(1);
    expect(net(11, 10).power).toBe(1);
    const review = score(
      reviewEvent('APPROVED'),
      under('rocket-man', {}, REVIEWER_ID),
      prStateFor(facts()),
      BOSS_NOW,
    );
    expect(review.power).toBe(1);
  });

  it('reads the size from the stored PR when the merge payload carries none', () => {
    const pr = mergedFacts({ stats: null });
    const net = score(
      mergedEvent(pr),
      rocket,
      prStateFor(pr, { additions: 5, deletions: 50 }),
      BOSS_NOW,
    );
    expect(net.power).toBe(2);
    const gross = score(
      mergedEvent(pr),
      rocket,
      prStateFor(pr, { additions: 50, deletions: 5 }),
      BOSS_NOW,
    );
    expect(gross.power).toBe(1);
  });

  it('has no night or hour-of-day bonus (removed by the audit)', () => {
    const night = Date.UTC(2026, 10, 14, 3, 0, 0);
    const day = Date.UTC(2026, 10, 14, 15, 0, 0);
    const pr = mergedFacts({ stats: stats(10, 90) });
    expect(mergeScore(rocket, pr, [approval], night).points).toBe(
      mergeScore(rocket, pr, [approval], day).points,
    );
  });
});

describe('The Leather Jacket: +0.1 Power per successive reviewed merge this week, cap +1.5', () => {
  const reviewedMerge = (player: PlayerState, now: number = NOW) => {
    const pr = mergedFacts({ stats: stats(40) });
    const state = prStateFor(pr, { reviews: [approval] });
    const result = score(mergedEvent(pr), player, state, now);
    return { result, player: applyScoreResult(player, state, result).player };
  };
  const soloMerge = (player: PlayerState) => {
    const pr = mergedFacts({ stats: stats(40) });
    const state = prStateFor(pr);
    const result = score(mergedEvent(pr), player, state, NOW);
    return { result, player: applyScoreResult(player, state, result).player };
  };

  it('grows by one per reviewed merge and lifts the Power of everything scored after it', () => {
    let player = jacket();
    const powers: number[] = [];
    for (let index = 0; index < 4; index += 1) {
      const next = reviewedMerge(player);
      powers.push(next.result.power);
      player = next.player;
    }
    expect(powers).toEqual([1, 1.1, 1.2, 1.3]);
    expect(player.moguls.chain).toBe(4);
    const review = score(
      reviewEvent('APPROVED'),
      { ...player, id: REVIEWER_ID },
      prStateFor(facts()),
      NOW,
    );
    expect(review.power).toBe(1.4);
    expect(review.breakdown).toContainEqual({
      label: 'The Leather Jacket (4 reviewed merges in a row)',
      value: 0.4,
      kind: 'power',
    });
  });

  it('applies from Monday, not only in the Boss window', () => {
    expect(actWindow(NOW)).toBe('scout');
    const chained = { ...jacket(), moguls: { ...jacket().moguls, chain: 3 } };
    expect(reviewedMerge(chained, NOW).result.power).toBeCloseTo(1.3, 9);
  });

  it('is capped at +1.5', () => {
    const base = jacket();
    const at = (chain: number) =>
      reviewedMerge({ ...base, moguls: { ...base.moguls, chain } }).result.power;
    expect(at(15)).toBe(2.5);
    expect(at(16)).toBe(2.5);
    expect(at(40)).toBe(2.5);
  });

  it('a solo merge resets the chain', () => {
    let player = jacket();
    player = reviewedMerge(player).player;
    player = reviewedMerge(player).player;
    expect(player.moguls.chain).toBe(2);
    const solo = soloMerge(player);
    expect(solo.result.power).toBe(1.2);
    expect(solo.result.counterUpdates.mogulChain).toBe(0);
    expect(solo.player.moguls.chain).toBe(0);
    expect(reviewedMerge(solo.player).result.power).toBe(1);
  });

  it('a merge that is neither reviewed nor solo leaves the chain alone, and closing a PR never breaks it', () => {
    const player = { ...jacket(), moguls: { ...jacket().moguls, chain: 5 } };
    const pr = mergedFacts({ stats: stats(40), mergedBy: human(OTHER_REVIEWER_ID) });
    const neither = score(mergedEvent(pr), player, prStateFor(pr), NOW);
    expect(neither.counterUpdates.mogulChain).toBeUndefined();
    const closed = score(
      { kind: 'pr_closed', actor: human(AUTHOR_ID), pr: facts() },
      player,
      prStateFor(facts()),
      NOW,
    );
    expect(closed.counterUpdates.mogulChain).toBeUndefined();
    expect(
      mogulChainAfter('leather-jacket', openedEvent(), prStateFor(facts()), player),
    ).toBeNull();
    expect(mogulChainAfter('founder', mergedEvent(), prStateFor(mergedFacts()), player)).toBeNull();
  });

  it('mogulPowerLines is empty at chain 0 and for other Moguls', () => {
    const ctx = { event: mergedEvent(), pr: prStateFor(mergedFacts()), now: NOW };
    expect(mogulPowerLines(jacket(), ctx)).toEqual([]);
    expect(mogulPowerLines(under('hoodie'), ctx)).toEqual([]);
  });

  it('labels a chain of one in the singular', () => {
    const player = { ...jacket(), moguls: { ...jacket().moguls, chain: 1 } };
    const lines = mogulPowerLines(player, {
      event: openedEvent(),
      pr: prStateFor(facts()),
      now: NOW,
    });
    expect(lines[0]?.label).toBe('The Leather Jacket (1 reviewed merge in a row)');
  });
});

describe('The Turtleneck: PRs under 100 lines x3, over 400 x0.5, one-comment approvals x2', () => {
  const turtleneck = under('turtleneck');
  const merge = (lines: number) => mergeScore(turtleneck, mergedFacts({ stats: stats(lines) }));

  it('triples a merge under 100 lines', () => {
    const small = merge(99);
    expect(small.points).toBe(
      Math.floor(90 * 3) + Math.floor(sizePoints(99) * 3) + Math.floor(30 * 3),
    );
    expect(small.breakdown[0]).toEqual({
      label: 'PR merged (The Turtleneck: under 100 lines x3)',
      value: 270,
      kind: 'points',
    });
  });

  it('halves a merge over 400 lines, and leaves 100 to 400 alone', () => {
    expect(merge(100).points).toBe(reviewedPoints(100));
    expect(merge(400).points).toBe(reviewedPoints(400));
    const large = merge(401);
    expect(large.points).toBe(
      Math.floor(90 * 0.5) + Math.floor(sizePoints(401) * 0.5) + Math.floor(30 * 0.5),
    );
    expect(large.breakdown[0]?.label).toBe('PR merged (The Turtleneck: over 400 lines x0.5)');
  });

  it('an approval with exactly one inline comment is a design review and scores x2', () => {
    const approve = (inline: number, state: 'APPROVED' | 'CHANGES_REQUESTED' = 'APPROVED') =>
      score(
        reviewEvent(state),
        under('turtleneck', {}, REVIEWER_ID),
        prStateFor(facts(), {
          reviewerCounters: { [String(REVIEWER_ID)]: { decisions: 0, comments: 0, inline } },
        }),
        BOSS_NOW,
      );
    expect(approve(1).points).toBe(80);
    expect(approve(1).breakdown[0]).toEqual({
      label: 'Review: approved (The Turtleneck: design review x2)',
      value: 80,
      kind: 'points',
    });
    expect(approve(0).points).toBe(40);
    expect(approve(2).points).toBe(40);
    expect(approve(1, 'CHANGES_REQUESTED').points).toBe(40);
  });

  it('an approval with no inline comments on record is not a design review', () => {
    const result = score(
      reviewEvent('APPROVED'),
      under('turtleneck', {}, REVIEWER_ID),
      prStateFor(facts()),
      BOSS_NOW,
    );
    expect(result.points).toBe(40);
  });

  it('does not touch opens or inline comments', () => {
    expect(mogulFactors('turtleneck', openedEvent(), prStateFor(facts()))).toEqual([]);
  });
});

describe('The Hoodie: x2 within 48 h of the first review, x0.75 otherwise', () => {
  const hoodie = under('hoodie');
  const merged = '2026-11-14T12:00:00Z';
  const at = (hoursBefore: number) =>
    new Date(Date.parse(merged) - hoursBefore * 3600_000).toISOString();
  const pr = mergedFacts({ stats: stats(40), mergedAt: merged });
  const merge = (reviews: ReviewRecord[], facts_: PullRequestFacts = pr) =>
    mergeScore(hoodie, facts_, reviews);
  const approvedAt = (submittedAt: string | null): ReviewRecord => ({
    reviewerId: REVIEWER_ID,
    state: 'APPROVED',
    submittedAt,
  });
  const fast = reviewedPoints(40) * 2;
  const slow = Math.floor(90 * 0.75) + Math.floor(sizePoints(40) * 0.75) + Math.floor(30 * 0.75);

  it('doubles a merge within 48 hours of its first review, 48 hours included', () => {
    expect(merge([approvedAt(at(1))]).points).toBe(fast);
    expect(merge([approvedAt(at(48))]).points).toBe(fast);
    expect(merge([approvedAt(at(47.9))]).breakdown[0]?.label).toBe(
      'PR merged (The Hoodie: merged within 48 h of first review x2)',
    );
  });

  it('measures from the first review, whoever gave it', () => {
    const reviews = [
      approvedAt(at(100)),
      { reviewerId: OTHER_REVIEWER_ID, state: 'COMMENTED' as const, submittedAt: at(2) },
    ];
    expect(merge(reviews).points).toBe(slow);
    expect(merge([approvedAt(at(2)), approvedAt(at(100))]).points).toBe(slow);
  });

  it('scores x0.75 when the first review was longer ago, or there is no usable review time', () => {
    expect(merge([approvedAt(at(48.5))]).points).toBe(slow);
    expect(merge([approvedAt(at(48.5))]).breakdown[0]?.label).toBe(
      'PR merged (The Hoodie: not merged fast x0.75)',
    );
    expect(merge([]).points).toBeLessThan(slow);
    expect(merge([approval]).points).toBe(slow);
    expect(merge([approvedAt(null)]).points).toBe(slow);
    expect(merge([approvedAt('1970-01-01T00:00:00Z')]).points).toBe(slow);
    expect(merge([approvedAt('not a date')]).points).toBe(slow);
    expect(
      merge([approvedAt(at(1))], mergedFacts({ stats: stats(40), mergedAt: null })).points,
    ).toBe(slow);
  });

  it('leaves reviews and opens alone: only merges are fast or slow', () => {
    const review = score(
      reviewEvent('APPROVED'),
      under('hoodie', {}, REVIEWER_ID),
      prStateFor(facts()),
      BOSS_NOW,
    );
    expect(review.points).toBe(40);
    expect(mogulFactors('hoodie', openedEvent(), prStateFor(facts()))).toEqual([]);
  });
});

describe('The Founder: points x0.5, gold x4, and the Board takes a Charm on Wednesday', () => {
  const founder = under('founder', {}, AUTHOR_ID, NOW);

  it('halves every event point term from Monday, not the daily bonus', () => {
    const merge = mergeScore(founder, mergedFacts({ stats: stats(40) }), [approval], NOW);
    expect(merge.points).toBe(
      Math.floor(90 * 0.5) + Math.floor(sizePoints(40) * 0.5) + Math.floor(30 * 0.5),
    );
    const review = score(
      reviewEvent('APPROVED'),
      under('founder', {}, REVIEWER_ID, NOW),
      prStateFor(facts()),
      NOW,
    );
    expect(review.points).toBe(20);
    expect(review.breakdown[0]?.label).toBe('Review: approved (The Founder x0.5)');
    const fresh = {
      ...createPlayerState(AUTHOR_ID),
      moguls: { ...createPlayerState(1).moguls, current: 'founder' as const },
    };
    expect(score(openedEvent(), fresh, createPRState(facts()), NOW).points).toBe(5 + 20);
  });

  it('multiplies the gold earned from points by 4 (result.goldMultiplier), and nothing else', () => {
    expect(mergeScore(founder, mergedFacts({ stats: stats(40) })).goldMultiplier).toBe(4);
    expect(mergeScore(under('hoodie'), mergedFacts({ stats: stats(40) })).goldMultiplier).toBe(1);
    expect(mergeScore(settledPlayer(AUTHOR_ID), mergedFacts()).goldMultiplier).toBe(1);
    expect(mogulGoldMultiplier('founder')).toBe(4);
    expect(mogulGoldMultiplier('hoodie')).toBe(1);
    expect(mogulGoldMultiplier(null)).toBe(1);
  });

  describe('the Board', () => {
    const charmed = (): PlayerState => ({
      ...under('founder'),
      charms: [held('rubber-duck'), held('lantern'), held('hot-potato')],
    });
    const settle = (player: PlayerState, now: number, seed = 7) =>
      applyFounderBoard(player, '2026-46', now, seed);

    it('does nothing on Monday and Tuesday', () => {
      const result = settle(charmed(), WEDNESDAY - 1);
      expect(result.events).toEqual([]);
      expect(result.player.charms).toHaveLength(3);
      expect(result.player.moguls.boardWeek).toBeNull();
    });

    it('removes one random Charm on Wednesday, keeps its slot, and is seeded', () => {
      const result = settle(charmed(), WEDNESDAY);
      expect(result.events).toHaveLength(1);
      expect(result.events[0]?.kind).toBe('removed');
      expect(result.player.charms).toHaveLength(2);
      expect(result.player.moguls.benched?.charm.id).toBe(result.events[0]?.charm.id);
      expect(result.player.moguls.benched?.weekKey).toBe('2026-46');
      expect(result.player.moguls.boardWeek).toBe('2026-46');
      expect(settle(charmed(), WEDNESDAY).events[0]?.charm.id).toBe(result.events[0]?.charm.id);
      const picked = new Set(
        Array.from(
          { length: 40 },
          (_, seed) => settle(charmed(), WEDNESDAY, seed).events[0]?.charm.id,
        ),
      );
      expect(picked.size).toBe(3);
    });

    it('acts once: a second call changes nothing', () => {
      const first = settle(charmed(), WEDNESDAY);
      const second = settle(first.player, WEDNESDAY + DAY_MS);
      expect(second.events).toEqual([]);
      expect(second.player).toEqual(first.player);
    });

    it('returns the Charm on Friday with +0.25 Power, and does not act again that week', () => {
      const removed = settle(charmed(), WEDNESDAY);
      const taken = removed.events[0]!.charm;
      const back = settle(removed.player, FRIDAY);
      expect(back.events).toEqual([
        { kind: 'returned', charm: { ...taken, power: taken.power + 0.25 } },
      ]);
      expect(back.player.charms).toHaveLength(3);
      expect(back.player.moguls.benched).toBeNull();
      const saturday = settle(back.player, FRIDAY + DAY_MS);
      expect(saturday.events).toEqual([]);
      expect(saturday.player).toEqual(back.player);
    });

    it('does not return it before Friday', () => {
      const removed = settle(charmed(), WEDNESDAY);
      expect(settle(removed.player, FRIDAY - 1).events).toEqual([]);
    });

    it('first called after Friday: removes and returns in one call, with the same end result', () => {
      const result = settle(charmed(), FRIDAY + 3600_000);
      expect(result.events.map((event) => event.kind)).toEqual(['removed', 'returned']);
      expect(result.player.charms).toHaveLength(3);
      // Rubber Duck 0.25 + 0.25 from the Board, whichever Charm the seed took.
      const total = result.player.charms.reduce((sum, entry) => sum + entry.power, 0);
      expect(total).toBeCloseTo(0.5, 9);
      expect(result.player.moguls.benched).toBeNull();
    });

    it('returns a Charm left from an earlier week at once', () => {
      const stale = {
        ...under('hoodie'),
        moguls: {
          ...under('hoodie').moguls,
          benched: { charm: held('lantern'), weekKey: '2026-45' },
          boardWeek: '2026-45',
        },
      };
      const result = settle(stale, NOW);
      expect(result.events.map((event) => event.kind)).toEqual(['returned']);
      expect(result.player.charms.map((entry) => [entry.id, entry.power])).toEqual([
        ['lantern', 0.25],
      ]);
    });

    it('does nothing in a week of another Mogul, and takes nothing from an empty hand', () => {
      const hoodie = { ...charmed(), moguls: { ...charmed().moguls, current: 'hoodie' as const } };
      expect(settle(hoodie, FRIDAY).events).toEqual([]);
      const bare = under('founder');
      const result = settle(bare, WEDNESDAY);
      expect(result.events).toEqual([]);
      expect(result.player.moguls.boardWeek).toBe('2026-46');
      expect(result.player.moguls.benched).toBeNull();
    });

    it('keeps the removed Charm slot, so nothing can be bought into it', () => {
      const five: PlayerState = {
        ...under('founder'),
        charms: (
          ['rubber-duck', 'lantern', 'small-hands', 'hot-potato', 'grey-beard'] as const
        ).map((id) => held(id)),
      };
      const removed = settle(five, WEDNESDAY);
      expect(removed.player.charms).toHaveLength(4);
      expect(charmSlotsUsed(removed.player)).toBe(5);
      expect(freeCharmSlots(removed.player)).toBe(0);
      expect(addCharm(removed.player, held('oracle'))).toEqual({
        ok: false,
        error: 'no_free_slot',
      });
      const back = settle(removed.player, FRIDAY);
      expect(charmSlotsUsed(back.player)).toBe(5);
    });

    it('stacked Charms travel as one', () => {
      const stacked = { ...under('founder'), charms: [held('lantern', 2)] };
      const removed = settle(stacked, WEDNESDAY);
      expect(copiesOf(removed.player.moguls.benched!.charm)).toBe(2);
      const back = settle(removed.player, FRIDAY);
      expect(copiesOf(back.player.charms[0]!)).toBe(2);
    });
  });
});

describe('The Two-Pizza Boss: 2+ reviewers x2.5, solo x0.25, party bonus x3', () => {
  const pizza = under('two-pizza-boss');
  const pr = mergedFacts({ stats: stats(40) });
  const comment = (id: number): ReviewRecord => ({ reviewerId: id, state: 'COMMENTED' });
  const approve = (id: number): ReviewRecord => ({ reviewerId: id, state: 'APPROVED' });

  it('scores a merge with 2+ distinct human reviewers x2.5, with the party bonus x3 on top of it', () => {
    const team = mergeScore(pizza, pr, [approve(REVIEWER_ID), comment(OTHER_REVIEWER_ID)]);
    expect(team.points).toBe(
      Math.floor(90 * 2.5) + Math.floor(sizePoints(40) * 2.5) + Math.floor(30 * 2.5 * 3),
    );
    expect(team.breakdown.map((line) => line.label)).toEqual([
      'PR merged (The Two-Pizza Boss: 2+ reviewers x2.5)',
      `Size (log-scaled, 40 lines) (The Two-Pizza Boss: 2+ reviewers x2.5)`,
      'Reviewed by another human (The Two-Pizza Boss: 2+ reviewers x2.5, The Two-Pizza Boss: party bonus x3)',
      ...team.breakdown.slice(3).map((line) => line.label),
    ]);
  });

  it('counts distinct reviewers: one reviewer twice is not a team', () => {
    const one = mergeScore(pizza, pr, [approve(REVIEWER_ID), approve(REVIEWER_ID)]);
    expect(one.points).toBe(90 + sizePoints(40) + 30 * 3);
  });

  it('triples only the party bonus for a single approver', () => {
    const duo = mergeScore(pizza, pr, [approve(REVIEWER_ID)]);
    expect(duo.points).toBe(90 + sizePoints(40) + 90);
  });

  it('two reviewers without an approval are a team but have no party bonus', () => {
    const comments = mergeScore(pizza, pr, [comment(REVIEWER_ID), comment(OTHER_REVIEWER_ID)]);
    expect(comments.points).toBe(Math.floor(90 * 2.5) + Math.floor(sizePoints(40) * 2.5));
  });

  it('scores a solo merge x0.25 on top of the solo-kill halving, not zero', () => {
    const solo = mergeScore(pizza, pr, []);
    const eighth = Math.floor(90 * 0.125) + Math.floor(sizePoints(40) * 0.125);
    expect(solo.points).toBe(eighth);
    expect(solo.points).toBeGreaterThan(0);
  });

  it('ignores reviews and opens', () => {
    const review = score(
      reviewEvent('APPROVED'),
      under('two-pizza-boss', {}, REVIEWER_ID),
      prStateFor(facts()),
      BOSS_NOW,
    );
    expect(review.points).toBe(40);
    expect(mogulFactors('two-pizza-boss', openedEvent(), prStateFor(facts()))).toEqual([]);
  });
});

describe('the Mogul in the Run', () => {
  it('the Run Map shows the Mogul from Monday: it is on the run and the player hook', () => {
    expect(makeRun({ mogul: 'hoodie' }).mogul).toBe('hoodie');
  });

  it('modifiers never penalise closing a PR unmerged', () => {
    for (const id of MOGUL_IDS) {
      const closed = score(
        { kind: 'pr_closed', actor: human(AUTHOR_ID), pr: facts() },
        under(id),
        prStateFor(facts()),
        BOSS_NOW,
      );
      expect(closed.points).toBe(0);
      expect(closed.counterUpdates.mogulChain).toBeUndefined();
    }
  });
});
