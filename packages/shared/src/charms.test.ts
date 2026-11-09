import { describe, expect, it } from 'vitest';
import {
  addCharm,
  CHARMS,
  charmDefinition,
  charmPowerLines,
  charmSellPrice,
  charmsOfRarity,
  copiesOf,
  freeCharmSlots,
  hasCharm,
  hasCharmEffect,
  loadedDiceFires,
  loadedDiceReady,
  makeCharm,
  partyBonusPoints,
  riposteMultiplier,
  sellCharm,
  sumCharmEffect,
} from './charms';
import type { CharmId } from './charms';
import { CHARM_POWER_BY_RARITY, CHARM_PRICE_BY_RARITY, POWER_CAP } from './constants';
import { riposteCreditEvents, verifiedKillEvents } from './credit';
import { computePower, powerBreakdown } from './power';
import { score } from './score';
import { applyScoreResult, createPlayerState, createPRState } from './state';
import {
  AUTHOR_ID,
  charm,
  facts,
  held,
  human,
  inlineEvent,
  mergedEvent,
  mergedFacts,
  NOW,
  openedEvent,
  OTHER_REVIEWER_ID,
  prStateFor,
  reviewEvent,
  REVIEWER_ID,
  settledPlayer,
} from './test-builders';
import type {
  Charm,
  GameEvent,
  PlayerState,
  PRState,
  PullRequestFacts,
  ReviewerCounters,
  ReviewRecord,
  ReviewSubmittedEvent,
  ScoreResult,
} from './types';

function playerWith(id: number, ...charms: Charm[]): PlayerState {
  return { ...settledPlayer(id), charms };
}

function run(event: GameEvent, player: PlayerState, pr?: PRState, now: number = NOW): ScoreResult {
  const state = pr ?? ('pr' in event ? createPRState(event.pr) : prStateFor(facts()));
  return score(event, player, state, now);
}

function stats(additions: number, deletions: number): PullRequestFacts['stats'] {
  return { additions, deletions, changedFiles: 1, commits: 1 };
}

function reviewWithInline(inline: number): PRState {
  const counters: ReviewerCounters = { decisions: 0, comments: 0, inline };
  return prStateFor(facts(), { reviewerCounters: { [String(REVIEWER_ID)]: counters } });
}

/** The Power lines of a result's breakdown, as label/value pairs. */
function powerLines(result: ScoreResult): [string, number][] {
  return result.breakdown
    .filter((line) => line.kind === 'power')
    .map((line) => [line.label, line.value]);
}

describe('the twelve Charms (design.md 6.3 as audited)', () => {
  it('are exactly these twelve, with these rarities', () => {
    expect(CHARMS.map((entry) => [entry.id, entry.name, entry.rarity])).toEqual([
      ['rubber-duck', 'Rubber Duck', 'common'],
      ['lantern', 'Lantern', 'common'],
      ['whetstone', 'Whetstone', 'common'],
      ['small-hands', 'Small Hands', 'uncommon'],
      ['second-pair-of-eyes', 'Second Pair of Eyes', 'uncommon'],
      ['familiar-path', 'Familiar Path', 'uncommon'],
      ['hot-potato', 'Hot Potato', 'rare'],
      ['grey-beard', 'Grey Beard', 'rare'],
      ['long-lens', 'Long Lens', 'rare'],
      ['jesters-rebase', "Jester's Rebase", 'legendary'],
      ['loaded-dice', 'Loaded Dice', 'legendary'],
      ['oracle', 'Oracle', 'legendary'],
    ]);
  });

  it('has no Night Owl or Clean Sweep (removed by the audit)', () => {
    const text = JSON.stringify(CHARMS.map((entry) => [entry.id, entry.name, entry.description]));
    expect(text).not.toMatch(/night owl|clean sweep/i);
  });

  it('has base and conditional Power as designed', () => {
    const power = (id: CharmId) => {
      const entry = charmDefinition(id)!;
      return [entry.basePower, entry.conditionalPower];
    };
    expect(power('rubber-duck')).toEqual([CHARM_POWER_BY_RARITY.common, 0.25]);
    expect(power('lantern')).toEqual([0, 0.5]);
    expect(power('small-hands')).toEqual([0, 0.75]);
    expect(power('hot-potato')).toEqual([0, 1.5]);
    expect(power('grey-beard')).toEqual([0, 1]);
    expect(power('whetstone')).toEqual([0, 0.5]);
    expect(power('familiar-path')).toEqual([0, 0.5]);
    expect(power('long-lens')).toEqual([0, 1]);
    for (const id of ['second-pair-of-eyes', 'jesters-rebase', 'loaded-dice', 'oracle'] as const) {
      expect(power(id)).toEqual([0, 0]);
    }
  });

  it('looks up by id and by rarity', () => {
    expect(charmDefinition('lantern')?.name).toBe('Lantern');
    expect(charmDefinition('night-owl')).toBeUndefined();
    expect(charmsOfRarity('legendary').map((entry) => entry.id)).toEqual([
      'jesters-rebase',
      'loaded-dice',
      'oracle',
    ]);
    expect(makeCharm(charmDefinition('rubber-duck')!)).toEqual({
      id: 'rubber-duck',
      name: 'Rubber Duck',
      rarity: 'common',
      power: 0.25,
    });
  });

  it('a Charm with an unknown id still contributes its stored power', () => {
    const lines = charmPowerLines({ ...settledPlayer(), charms: [charm(1.5, 'Mystery')] });
    expect(lines).toEqual([{ label: 'Mystery', value: 1.5, kind: 'power' }]);
  });
});

describe('Rubber Duck: +0.25, and +0.25 more on reviews with 3+ inline comments', () => {
  const player = playerWith(REVIEWER_ID, held('rubber-duck'));

  it('gives +0.25 on any event', () => {
    expect(run(openedEvent(), playerWith(AUTHOR_ID, held('rubber-duck'))).power).toBe(1.25);
    expect(run(inlineEvent(), player).power).toBe(1.25);
  });

  it('adds 0.25 when the reviewer has left 3 or more inline comments, and not before', () => {
    expect(run(reviewEvent('APPROVED'), player, reviewWithInline(2)).power).toBe(1.25);
    const three = run(reviewEvent('APPROVED'), player, reviewWithInline(3));
    expect(three.power).toBe(1.5);
    expect(powerLines(three)).toContainEqual(['Rubber Duck (3+ inline comments)', 0.5]);
    expect(run(reviewEvent('COMMENTED'), player, reviewWithInline(10)).power).toBe(1.5);
  });

  it('counts the reviewer who is acting, not another reviewer', () => {
    const pr = prStateFor(facts(), {
      reviewerCounters: { [String(OTHER_REVIEWER_ID)]: { decisions: 0, comments: 0, inline: 9 } },
    });
    expect(run(reviewEvent('APPROVED'), player, pr).power).toBe(1.25);
  });

  it('does not apply the extra to an inline comment or a merge', () => {
    expect(run(inlineEvent(), player, reviewWithInline(5)).power).toBe(1.25);
    const author = playerWith(AUTHOR_ID, held('rubber-duck'));
    expect(run(mergedEvent(), author).power).toBe(1.25);
  });
});

describe('Lantern: +0.5 on the first scored event of each day', () => {
  it('applies to the first event of the UTC day and the daily bonus goes with it', () => {
    const fresh = { ...createPlayerState(AUTHOR_ID), charms: [held('lantern')] };
    const first = run(openedEvent(), fresh);
    expect(first.power).toBe(1.5);
    expect(powerLines(first)).toContainEqual(['Lantern (first event of the day)', 0.5]);
    expect(first.points).toBe(10 + 20);
  });

  it('does not apply once the daily bonus is claimed, and applies again the next day', () => {
    const fresh = { ...createPlayerState(AUTHOR_ID), charms: [held('lantern')] };
    const first = run(openedEvent(), fresh);
    const { player } = applyScoreResult(fresh, createPRState(facts()), first);
    expect(run(openedEvent(), player).power).toBe(1);
    const tomorrow = NOW + 24 * 60 * 60 * 1000;
    expect(run(openedEvent(), player, undefined, tomorrow).power).toBe(1.5);
  });

  it('applies to a review as well as an authoring event', () => {
    const fresh = { ...createPlayerState(REVIEWER_ID), charms: [held('lantern')] };
    expect(run(reviewEvent('APPROVED'), fresh).power).toBe(1.5);
  });

  it('never applies to the weekly streak', () => {
    const fresh = { ...createPlayerState(AUTHOR_ID), charms: [held('lantern')] };
    const streak: GameEvent = { kind: 'weekly_streak', actor: human(AUTHOR_ID), qualified: true };
    expect(run(streak, fresh).power).toBe(1);
  });
});

describe('Small Hands: +0.75 on merges under 150 lines', () => {
  const player = playerWith(AUTHOR_ID, held('small-hands'));
  const merge = (lines: number) =>
    run(mergedEvent(mergedFacts({ stats: stats(lines, 0) })), player).power;

  it('applies below the threshold and not at it', () => {
    expect(merge(149)).toBe(1.75);
    expect(merge(150)).toBe(1);
    expect(merge(1)).toBe(1.75);
  });

  it('counts additions plus deletions', () => {
    const split = mergedEvent(mergedFacts({ stats: stats(100, 49) }));
    expect(run(split, player).power).toBe(1.75);
    const over = mergedEvent(mergedFacts({ stats: stats(100, 50) }));
    expect(run(over, player).power).toBe(1);
  });

  it('does not apply to opens or reviews', () => {
    expect(run(openedEvent(), player).power).toBe(1);
    expect(run(reviewEvent('APPROVED'), playerWith(REVIEWER_ID, held('small-hands'))).power).toBe(
      1,
    );
  });
});

describe('Second Pair of Eyes: the party bonus is 60 points', () => {
  const approved: ReviewRecord[] = [{ reviewerId: REVIEWER_ID, state: 'APPROVED' }];
  const merge = (player: PlayerState, reviews: ReviewRecord[] = approved) =>
    run(mergedEvent(), player, prStateFor(mergedFacts(), { reviews }));

  it('doubles the party bonus term and names the Charm', () => {
    const plain = merge(settledPlayer(AUTHOR_ID));
    const eyes = merge(playerWith(AUTHOR_ID, held('second-pair-of-eyes')));
    expect(eyes.points - plain.points).toBe(30);
    expect(eyes.breakdown).toContainEqual({
      label: 'Reviewed by another human (Second Pair of Eyes)',
      value: 60,
      kind: 'points',
    });
  });

  it('a second copy adds another 30', () => {
    const stacked = playerWith(AUTHOR_ID, held('second-pair-of-eyes', 2));
    expect(partyBonusPoints(stacked)).toBe(90);
    expect(partyBonusPoints(settledPlayer())).toBe(30);
  });

  it('does nothing without a party bonus and gives no Power', () => {
    const player = playerWith(AUTHOR_ID, held('second-pair-of-eyes'));
    const comment = merge(player, [{ reviewerId: REVIEWER_ID, state: 'COMMENTED' }]);
    expect(comment.breakdown.map((line) => line.label)).not.toContain(
      'Reviewed by another human (Second Pair of Eyes)',
    );
    expect(comment.power).toBe(1);
  });

  it('is halved with the rest of the party bonus on a solo kill is moot: a solo kill has no party bonus', () => {
    const solo = merge(playerWith(AUTHOR_ID, held('second-pair-of-eyes')), []);
    expect(solo.breakdown.map((line) => line.label)).not.toContain('Reviewed by another human');
  });
});

describe('Hot Potato: +1.5 approving a PR under 200 lines within 2 hours of its opening', () => {
  const player = playerWith(REVIEWER_ID, held('hot-potato'));
  const approve = (
    lines: number,
    submittedAt: string | null,
    openedAt: string | null = '2026-11-09T09:00:00Z',
    state: ReviewSubmittedEvent['state'] = 'APPROVED',
  ) => {
    const pr = facts({ stats: stats(lines, 0), openedAt });
    return run({ ...reviewEvent(state, human(REVIEWER_ID), pr), submittedAt }, player).power;
  };

  it('applies to a fast approval of a small PR', () => {
    expect(approve(199, '2026-11-09T09:30:00Z')).toBe(2.5);
    expect(approve(50, '2026-11-09T11:00:00Z')).toBe(2.5);
  });

  it('does not apply at 200 lines or after 2 hours', () => {
    expect(approve(200, '2026-11-09T09:30:00Z')).toBe(1);
    expect(approve(100, '2026-11-09T11:00:01Z')).toBe(1);
  });

  it('only for approvals', () => {
    expect(approve(100, '2026-11-09T09:30:00Z', '2026-11-09T09:00:00Z', 'CHANGES_REQUESTED')).toBe(
      1,
    );
    expect(approve(100, '2026-11-09T09:30:00Z', '2026-11-09T09:00:00Z', 'COMMENTED')).toBe(1);
  });

  it('needs both times: an unknown open or review time never counts', () => {
    expect(approve(100, null)).toBe(1);
    expect(approve(100, '2026-11-09T09:30:00Z', null)).toBe(1);
  });

  it('reads the PR size from the stored state when the review payload carries none', () => {
    const pr = facts({ stats: null });
    const big = prStateFor(pr, { additions: 900, deletions: 0 });
    const small = prStateFor(pr, { additions: 20, deletions: 0 });
    const event = reviewEvent('APPROVED', human(REVIEWER_ID), pr);
    expect(run(event, player, big).power).toBe(1);
    expect(run(event, player, small).power).toBe(2.5);
  });
});

describe('Grey Beard: +1.0 on any PR in a repo with 50+ merges', () => {
  const repoKey = String(facts().repoId);
  const withMerges = (count: number, key: string = repoKey): PlayerState => ({
    ...playerWith(AUTHOR_ID, held('grey-beard')),
    repoMerges: { [key]: count },
  });

  it('applies from the 50th merge in that repository, to every event kind on it', () => {
    expect(run(openedEvent(), withMerges(49)).power).toBe(1);
    const fifty = run(openedEvent(), withMerges(50));
    expect(fifty.power).toBe(2);
    expect(powerLines(fifty)).toContainEqual(['Grey Beard (50+ merges in this repo)', 1]);
    expect(run(mergedEvent(), withMerges(80)).power).toBe(2);
    expect(run(reviewEvent('APPROVED'), withMerges(50)).power).toBe(2);
  });

  it('is per repository', () => {
    expect(run(openedEvent(), withMerges(500, '99999')).power).toBe(1);
  });

  it('never applies to the weekly streak', () => {
    const streak: GameEvent = { kind: 'weekly_streak', actor: human(AUTHOR_ID), qualified: true };
    expect(run(streak, withMerges(500)).power).toBe(1);
  });

  it('a scored merge increments the repository count, so the 50th merge earns it', () => {
    let player = withMerges(48);
    const merge = (event: GameEvent) => {
      const pr = createPRState(facts());
      const result = score(event, player, pr, NOW);
      player = applyScoreResult(player, pr, result).player;
      return result;
    };
    const merges = [merge(mergedEvent()), merge(mergedEvent()), merge(mergedEvent())];
    expect(merges.map((result) => result.power)).toEqual([1, 1, 2]);
    expect(player.repoMerges[repoKey]).toBe(51);
    expect(merges[0]!.counterUpdates.repoMerges).toEqual({ repoId: facts().repoId, count: 49 });
  });
});

describe('Whetstone: +0.5 on an approval, backed by an inline comment, of a newer author', () => {
  const veteran = (): PlayerState => ({
    ...playerWith(REVIEWER_ID, held('whetstone')),
    repoMerges: { '1001': 12 },
  });
  const approve = (
    player: PlayerState,
    inline: number,
    authorMerges: number | undefined,
    state: ReviewSubmittedEvent['state'] = 'APPROVED',
  ) =>
    run(
      reviewEvent(state),
      player,
      prStateFor(facts(), {
        ...(authorMerges === undefined ? {} : { authorMerges }),
        reviewerCounters: { [String(REVIEWER_ID)]: { decisions: 0, comments: 0, inline } },
      }),
    );

  it('applies to an approval with an inline comment of an author with fewer merges', () => {
    const result = approve(veteran(), 1, 11);
    expect(result.power).toBe(1.5);
    expect(powerLines(result)).toContainEqual(['Whetstone (mentoring approval)', 0.5]);
  });

  it('is never a stamp: no inline comment, no Power', () => {
    expect(approve(veteran(), 0, 3).power).toBe(1);
  });

  it('needs an author with fewer merges than you, and treats an unknown count as a newcomer', () => {
    expect(approve(veteran(), 3, 12).power).toBe(1);
    expect(approve(veteran(), 3, 80).power).toBe(1);
    expect(approve(veteran(), 3, undefined).power).toBe(1.5);
    // A reviewer with no merges of their own mentors nobody.
    expect(approve(playerWith(REVIEWER_ID, held('whetstone')), 3, undefined).power).toBe(1);
  });

  it('applies to approvals only, not requested changes, comments, merges or opens', () => {
    expect(approve(veteran(), 3, 1, 'CHANGES_REQUESTED').power).toBe(1);
    expect(approve(veteran(), 3, 1, 'COMMENTED').power).toBe(1);
    const author = { ...playerWith(AUTHOR_ID, held('whetstone')), repoMerges: { '1001': 12 } };
    expect(run(mergedEvent(), author).power).toBe(1);
    expect(run(openedEvent(), author).power).toBe(1);
  });

  it('counts the reviewer who is acting, not another reviewer', () => {
    const pr = prStateFor(facts(), {
      authorMerges: 1,
      reviewerCounters: { [String(OTHER_REVIEWER_ID)]: { decisions: 0, comments: 0, inline: 9 } },
    });
    expect(run(reviewEvent('APPROVED'), veteran(), pr).power).toBe(1);
  });
});

describe('Familiar Path: +0.5 on any PR in a repo with 10+ merges', () => {
  const repoKey = String(facts().repoId);
  const withMerges = (count: number, key: string = repoKey): PlayerState => ({
    ...playerWith(AUTHOR_ID, held('familiar-path')),
    repoMerges: { [key]: count },
  });

  it('applies from the 10th merge in that repository, to every event kind on it', () => {
    expect(run(openedEvent(), withMerges(9)).power).toBe(1);
    const ten = run(openedEvent(), withMerges(10));
    expect(ten.power).toBe(1.5);
    expect(powerLines(ten)).toContainEqual(['Familiar Path (10+ merges in this repo)', 0.5]);
    expect(run(mergedEvent(), withMerges(30)).power).toBe(1.5);
    expect(run(reviewEvent('APPROVED'), withMerges(10)).power).toBe(1.5);
  });

  it('is per repository, and never applies to the weekly streak', () => {
    expect(run(openedEvent(), withMerges(500, '99999')).power).toBe(1);
    const streak: GameEvent = { kind: 'weekly_streak', actor: human(AUTHOR_ID), qualified: true };
    expect(run(streak, withMerges(500)).power).toBe(1);
  });

  it('stacks with Grey Beard in the same repository', () => {
    const both: PlayerState = {
      ...playerWith(AUTHOR_ID, held('familiar-path'), held('grey-beard')),
      repoMerges: { [repoKey]: 60 },
    };
    expect(run(openedEvent(), both).power).toBe(2.5);
  });
});

describe('Long Lens: +1.0 on a thorough review of a PR of 500+ lines', () => {
  const player = playerWith(REVIEWER_ID, held('long-lens'));
  const review = (
    lines: number,
    inline: number,
    state: ReviewSubmittedEvent['state'] = 'APPROVED',
  ) => {
    const pr = facts({ stats: stats(lines, 0) });
    const before = prStateFor(pr, {
      reviewerCounters: { [String(REVIEWER_ID)]: { decisions: 0, comments: 0, inline } },
    });
    return run(reviewEvent(state, human(REVIEWER_ID), pr), player, before);
  };

  it('applies to a decision on a big PR after 3 inline comments', () => {
    const result = review(500, 3);
    expect(result.power).toBe(2);
    expect(powerLines(result)).toContainEqual(['Long Lens (thorough review of 500+ lines)', 1]);
    expect(review(2000, 10, 'CHANGES_REQUESTED').power).toBe(2);
  });

  it('needs the size, the inline comments and a decision, so it cannot be farmed with stamps', () => {
    expect(review(499, 3).power).toBe(1);
    expect(review(5000, 2).power).toBe(1);
    expect(review(5000, 0).power).toBe(1);
    expect(review(5000, 9, 'COMMENTED').power).toBe(1);
  });

  it('reads the PR size from the stored state when the review payload carries none', () => {
    const pr = facts({ stats: null });
    const big = prStateFor(pr, {
      additions: 900,
      reviewerCounters: { [String(REVIEWER_ID)]: { decisions: 0, comments: 0, inline: 3 } },
    });
    expect(run(reviewEvent('APPROVED', human(REVIEWER_ID), pr), player, big).power).toBe(2);
  });

  it('does not apply to merges', () => {
    const author = playerWith(AUTHOR_ID, held('long-lens'));
    expect(run(mergedEvent(mergedFacts({ stats: stats(900, 0) })), author).power).toBe(1);
  });
});

describe('the Charms added in task 24 obey the incentive audit (game-design.md 8.3)', () => {
  it('say nothing of night, closing, speed or volume', () => {
    for (const id of ['whetstone', 'familiar-path', 'long-lens'] as const) {
      const text = charmDefinition(id)!.description;
      expect(text, id).not.toMatch(/night|closed|close |within|fast|quick|most/i);
    }
  });

  it('do not look at the clock: the same event scores the same at any hour of the day', () => {
    const player: PlayerState = {
      ...playerWith(REVIEWER_ID, held('whetstone'), held('familiar-path'), held('long-lens')),
      repoMerges: { '1001': 40 },
    };
    const big = facts({ stats: stats(900, 0) });
    const pr = prStateFor(big, {
      authorMerges: 2,
      reviewerCounters: { [String(REVIEWER_ID)]: { decisions: 0, comments: 0, inline: 4 } },
    });
    const approval = reviewEvent('APPROVED', human(REVIEWER_ID), big);
    const powers = [0, 3, 12, 23].map(
      (hour) => run(approval, player, pr, NOW + hour * 60 * 60 * 1000).power,
    );
    expect(new Set(powers).size).toBe(1);
    expect(powers[0]).toBe(3);
  });
});

describe("Jester's Rebase: Riposte x4, and changes you request earn a Riposte when the PR merges", () => {
  const changesRequested: ReviewRecord[] = [
    { reviewerId: REVIEWER_ID, state: 'CHANGES_REQUESTED' },
  ];
  const merge = (player: PlayerState) =>
    run(mergedEvent(), player, prStateFor(mergedFacts(), { reviews: changesRequested }));

  it('multiplies the author Riposte by 4', () => {
    const plain = merge(settledPlayer(AUTHOR_ID));
    const rebase = merge(playerWith(AUTHOR_ID, held('jesters-rebase')));
    expect(plain.breakdown).toContainEqual({
      label: 'Riposte (feedback addressed)',
      value: 15,
      kind: 'points',
    });
    expect(rebase.breakdown).toContainEqual({
      label: "Riposte (feedback addressed, Jester's Rebase x4)",
      value: 60,
      kind: 'points',
    });
    expect(rebase.points - plain.points).toBe(45);
    expect(riposteMultiplier(playerWith(AUTHOR_ID, held('jesters-rebase')))).toBe(4);
    expect(riposteMultiplier(settledPlayer())).toBe(1);
  });

  it('a Riposte credit for the reviewer who requested changes scores 60 when the PR merged', () => {
    const merged = mergedEvent();
    const pr = prStateFor(merged.pr, { reviews: changesRequested });
    const [credit] = riposteCreditEvents(merged, pr);
    expect(credit).toEqual({ kind: 'riposte_credit', actor: human(REVIEWER_ID), pr: merged.pr });
    const result = run(credit!, playerWith(REVIEWER_ID, held('jesters-rebase')), pr);
    expect(result.skip).toBeNull();
    expect(result.points).toBe(60);
    expect(result.skill).toBe('vigilance');
    expect(result.breakdown[0]).toEqual({
      label: "Riposte (changes you requested merged, Jester's Rebase x4)",
      value: 60,
      kind: 'points',
    });
  });

  it('scores nothing without the Charm, for the author, for a bot, or for an unmerged PR', () => {
    const merged = mergedEvent();
    const pr = prStateFor(merged.pr, { reviews: changesRequested });
    const credit = riposteCreditEvents(merged, pr)[0]!;
    expect(run(credit, settledPlayer(REVIEWER_ID), pr).skip).toBe('not_scoring');
    const own = { ...credit, actor: human(AUTHOR_ID) };
    expect(run(own, playerWith(AUTHOR_ID, held('jesters-rebase')), pr).skip).toBe('own_pr');
    const bot = { ...credit, actor: { id: REVIEWER_ID, isBot: true } };
    expect(run(bot, playerWith(REVIEWER_ID, held('jesters-rebase')), pr).skip).toBe('bot');
    const open = { ...credit, pr: facts() };
    expect(run(open, playerWith(REVIEWER_ID, held('jesters-rebase')), pr).skip).toBe('not_scoring');
  });

  it('a credit with no size in the payload reads it from the stored PR (for the monster)', () => {
    const merged = mergedEvent(mergedFacts({ stats: null }));
    const pr = prStateFor(merged.pr, { additions: 1500, deletions: 0, reviews: changesRequested });
    const [credit] = riposteCreditEvents(merged, pr);
    const result = run(credit!, playerWith(REVIEWER_ID, held('jesters-rebase')), pr);
    expect(result.monster).toBe('legacy-golem');
  });

  it('requesting changes earns nothing at review time (the Riposte still requires a merge)', () => {
    const review = run(
      reviewEvent('CHANGES_REQUESTED'),
      playerWith(REVIEWER_ID, held('jesters-rebase')),
    );
    expect(review.points).toBe(40);
    expect(review.breakdown.map((line) => line.label).join()).not.toMatch(/Riposte/);
  });

  it('riposteCreditEvents lists each distinct other human who requested changes once', () => {
    const merged = mergedEvent();
    const pr = prStateFor(merged.pr, {
      reviews: [
        { reviewerId: REVIEWER_ID, state: 'CHANGES_REQUESTED' },
        { reviewerId: REVIEWER_ID, state: 'CHANGES_REQUESTED' },
        { reviewerId: OTHER_REVIEWER_ID, state: 'APPROVED' },
        { reviewerId: AUTHOR_ID, state: 'CHANGES_REQUESTED' },
        { reviewerId: 9, state: 'CHANGES_REQUESTED' },
      ],
    });
    expect(riposteCreditEvents(merged, pr).map((event) => event.actor.id)).toEqual([
      REVIEWER_ID,
      9,
    ]);
    expect(riposteCreditEvents(merged, prStateFor(merged.pr))).toEqual([]);
    expect(verifiedKillEvents(merged, pr).map((event) => event.actor.id)).toEqual([
      OTHER_REVIEWER_ID,
    ]);
  });
});

describe('Loaded Dice: once a week one event has Power 10', () => {
  const dice = { ...playerWith(AUTHOR_ID, held('loaded-dice')) };

  it('replaces the first scored event Power with 10, past the cap, and spends the charge', () => {
    const first = run(openedEvent(), dice);
    expect(first.power).toBe(10);
    expect(first.counterUpdates.loadedDiceUsed).toBe(true);
    expect(powerLines(first).at(-1)).toEqual(['Loaded Dice', 9]);
    expect(first.xp).toBe(Math.floor(10 * 10 * first.zone));
    const sum = powerLines(first).reduce((total, [, value]) => total + value, 0);
    expect(sum).toBe(10);
  });

  it('once spent, later events score normally until the week turns', () => {
    const pr = createPRState(facts());
    const first = run(openedEvent(), dice, pr);
    const after = applyScoreResult(dice, pr, first).player;
    expect(after.week.loadedDiceUsed).toBe(true);
    const second = run(openedEvent(), after, pr);
    expect(second.power).toBe(1);
    expect(second.counterUpdates.loadedDiceUsed).toBeUndefined();
    const nextWeek = { ...after, week: { loadedDiceUsed: false } };
    expect(run(openedEvent(), nextWeek, pr).power).toBe(10);
  });

  it('overrides even a maxed Power', () => {
    const maxed = { ...dice, charms: [...dice.charms, charm(12)] };
    const result = run(openedEvent(), maxed);
    expect(result.power).toBe(10);
    expect(powerLines(result).map(([label]) => label)).toContain('Power cap');
  });

  it('is not spent by an event that scores nothing, or by the weekly streak', () => {
    const closed = run({ kind: 'pr_closed', actor: human(AUTHOR_ID), pr: facts() }, dice);
    expect(closed.skip).toBe('not_scoring');
    expect(closed.counterUpdates.loadedDiceUsed).toBeUndefined();
    expect(closed.power).toBe(1);
    const streak: GameEvent = { kind: 'weekly_streak', actor: human(AUTHOR_ID), qualified: true };
    const result = run(streak, dice);
    expect(result.power).toBe(1);
    expect(result.counterUpdates.loadedDiceUsed).toBeUndefined();
  });

  it('is only ready while held and unspent, and only fires for an event', () => {
    expect(loadedDiceReady(dice)).toBe(true);
    expect(loadedDiceReady(settledPlayer())).toBe(false);
    expect(loadedDiceReady({ ...dice, week: { loadedDiceUsed: true } })).toBe(false);
    expect(loadedDiceFires(dice)).toBe(false);
    expect(computePower(dice)).toBe(1);
  });
});

describe('Oracle: data only', () => {
  it('has no effect on scoring', () => {
    const oracle = playerWith(AUTHOR_ID, held('oracle'));
    const plain = run(openedEvent(), settledPlayer(AUTHOR_ID));
    const result = run(openedEvent(), oracle);
    expect(result.power).toBe(plain.power);
    expect(result.points).toBe(plain.points);
    expect(hasCharm(oracle, 'oracle')).toBe(true);
  });
});

describe('Charm effects as data', () => {
  it('only the four rule-changing Charms carry effects, and each carries its own', () => {
    const withEffects = CHARMS.filter((definition) => definition.effects !== undefined);
    expect(withEffects.map((definition) => definition.id)).toEqual([
      'second-pair-of-eyes',
      'jesters-rebase',
      'loaded-dice',
      'oracle',
    ]);
    expect(charmDefinition('second-pair-of-eyes')?.effects).toEqual({ partyPoints: 30 });
    expect(charmDefinition('jesters-rebase')?.effects).toEqual({ riposte: true });
    expect(charmDefinition('loaded-dice')?.effects).toEqual({ loadedDice: true });
    expect(charmDefinition('oracle')?.effects).toEqual({ seesNextMogul: true });
  });

  it('hasCharmEffect is true only while a held Charm carries the effect', () => {
    const nothing = settledPlayer(AUTHOR_ID);
    const lantern = playerWith(AUTHOR_ID, held('lantern'));
    const rebase = playerWith(AUTHOR_ID, held('jesters-rebase'), held('lantern'));
    const stacked = playerWith(AUTHOR_ID, held('jesters-rebase', 2));
    for (const key of ['riposte', 'partyPoints', 'seesNextMogul', 'loadedDice'] as const) {
      expect(hasCharmEffect(nothing, key), key).toBe(false);
      expect(hasCharmEffect(lantern, key), key).toBe(false);
    }
    expect(hasCharmEffect(rebase, 'riposte')).toBe(true);
    expect(hasCharmEffect(rebase, 'loadedDice')).toBe(false);
    expect(hasCharmEffect(stacked, 'riposte')).toBe(true);
    expect(hasCharmEffect(playerWith(AUTHOR_ID, held('oracle')), 'seesNextMogul')).toBe(true);
    expect(hasCharmEffect(playerWith(AUTHOR_ID, held('loaded-dice')), 'loadedDice')).toBe(true);
  });

  it('sumCharmEffect adds an amount per copy, and skips Charms the catalogue does not know', () => {
    expect(sumCharmEffect(settledPlayer(AUTHOR_ID), 'partyPoints')).toBe(0);
    expect(sumCharmEffect(playerWith(AUTHOR_ID, held('lantern')), 'partyPoints')).toBe(0);
    expect(sumCharmEffect(playerWith(AUTHOR_ID, held('second-pair-of-eyes')), 'partyPoints')).toBe(
      30,
    );
    expect(
      sumCharmEffect(
        playerWith(AUTHOR_ID, held('second-pair-of-eyes', 2), held('lantern'), charm(1)),
        'partyPoints',
      ),
    ).toBe(60);
    expect(hasCharmEffect(playerWith(AUTHOR_ID, charm(1, 'Oracle')), 'seesNextMogul')).toBe(false);
  });
});

describe('Power cap', () => {
  it('stays at 9 with every conditional Charm firing at once', () => {
    const stacked: Charm[] = [held('rubber-duck', 2), held('hot-potato', 2), charm(8, 'Pile')];
    const pr = facts({ stats: stats(10, 0) });
    const player = { ...playerWith(REVIEWER_ID, ...stacked) };
    const result = run(
      reviewEvent('APPROVED', human(REVIEWER_ID), pr),
      player,
      reviewWithInline(3),
    );
    expect(result.power).toBe(POWER_CAP);
    expect(computePower(player)).toBe(POWER_CAP);
    expect(powerBreakdown(player).at(-1)?.label).toBe('Power cap');
  });
});

describe('slots, stacking and auto-sell (Requirement 9.1)', () => {
  const five = (): PlayerState => ({
    ...settledPlayer(),
    charms: (['rubber-duck', 'lantern', 'small-hands', 'hot-potato', 'grey-beard'] as const).map(
      (id) => ({ ...held(id), copies: 1 }),
    ),
  });
  const oracle = held('oracle');

  it('has 5 slots and reports the free ones', () => {
    expect(freeCharmSlots(settledPlayer())).toBe(5);
    expect(freeCharmSlots(five())).toBe(0);
  });

  it('adds a new Charm into a free slot and refuses when full', () => {
    const added = addCharm(settledPlayer(), held('lantern'));
    expect(added).toMatchObject({ ok: true, outcome: 'added', sale: null });
    expect(added.ok && added.player.charms).toEqual([{ ...held('lantern'), copies: 1 }]);
    expect(addCharm(five(), oracle)).toEqual({ ok: false, error: 'no_free_slot' });
  });

  it('stacks a duplicate once into the same slot, even when full, and doubles its Power', () => {
    const full = five();
    const stacked = addCharm(full, held('rubber-duck'));
    expect(stacked).toMatchObject({ ok: true, outcome: 'stacked', sale: null });
    if (!stacked.ok) throw new Error('expected a stack');
    expect(stacked.player.charms).toHaveLength(5);
    expect(copiesOf(stacked.player.charms[0]!)).toBe(2);
    expect(computePower(stacked.player)).toBe(1 + 0.5);
  });

  it('auto-sells a third copy at half price and returns the sale instead of changing gold', () => {
    const twice = { ...settledPlayer(), charms: [held('hot-potato', 2)] };
    const third = addCharm(twice, held('hot-potato'));
    expect(third).toMatchObject({ ok: true, outcome: 'auto_sold' });
    if (!third.ok) throw new Error('expected an auto-sale');
    expect(third.sale).toEqual({
      charmId: 'hot-potato',
      name: 'Hot Potato',
      rarity: 'rare',
      proceeds: 60,
      reason: 'duplicate',
    });
    expect(third.player).toBe(twice);
  });

  it('sells half price: 20, 35, 60, 125', () => {
    expect(
      (['common', 'uncommon', 'rare', 'legendary'] as const).map((rarity) =>
        charmSellPrice(rarity),
      ),
    ).toEqual([20, 35, 60, 125]);
    expect(CHARM_PRICE_BY_RARITY.common / 2).toBe(20);
  });

  it('sells one copy of a stack, then the slot, and reports a missing Charm', () => {
    const player = { ...settledPlayer(), charms: [held('lantern', 2), held('oracle')] };
    const first = sellCharm(player, 'lantern');
    if (!first.ok) throw new Error('expected a sale');
    expect(first.sale).toMatchObject({ charmId: 'lantern', proceeds: 20, reason: 'player' });
    expect(first.player.charms.map((entry) => [entry.id, copiesOf(entry)])).toEqual([
      ['lantern', 1],
      ['oracle', 1],
    ]);
    const second = sellCharm(first.player, 'lantern');
    expect(second.ok && second.player.charms.map((entry) => entry.id)).toEqual(['oracle']);
    expect(sellCharm(player, 'rubber-duck')).toEqual({ ok: false, error: 'not_held' });
  });
});
