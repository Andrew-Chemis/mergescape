import { describe, expect, it } from 'vitest';
import { DAY_MS } from './calendar';
import { DECK_CAP, PLEDGE_HAND_SIZE } from './constants';
import {
  addToDeck,
  autoPlayPledges,
  drawHand,
  evaluatePledges,
  lifetimeMerges,
  playPledge,
  pledgeCard,
  pledgeDefinition,
  PLEDGES,
  pledgePower,
  pledgeWindowOpen,
  removeFromDeck,
  starterDeck,
  upgradeInDeck,
} from './pledges';
import type { PledgeId } from './pledges';
import { score } from './score';
import { applyScoreResult, createPlayerState, createPRState } from './state';
import {
  AUTHOR_ID,
  facts,
  human,
  inlineEvent,
  makeRun,
  mergedEvent,
  mergedFacts,
  NOW,
  OTHER_REVIEWER_ID,
  prStateFor,
  reviewEvent,
  REVIEWER_ID,
  settledPlayer,
} from './test-builders';
import type {
  GameEvent,
  PlayerState,
  Pledge,
  PRState,
  ReviewRecord,
  PullRequestFacts,
  ScoreResult,
} from './types';

const MONDAY = Date.UTC(2026, 10, 9, 0, 0, 0);
const WEDNESDAY = MONDAY + 2 * DAY_MS;

function card(id: PledgeId): Pledge {
  return pledgeCard(pledgeDefinition(id)!);
}

/** A settled player who has played these Pledges this week. */
function playing(id: number, ...ids: PledgeId[]): PlayerState {
  return {
    ...settledPlayer(id),
    pledges: { played: ids.map(card), progress: {}, completed: [] },
  };
}

interface Step {
  result: ScoreResult;
  player: PlayerState;
  pr: PRState;
}

/** Score one event and apply it, so the next step sees the progress. */
function step(player: PlayerState, event: GameEvent, pr?: PRState): Step {
  const state = pr ?? ('pr' in event ? createPRState(event.pr) : prStateFor(facts()));
  const result = score(event, player, state, NOW);
  const applied = applyScoreResult(player, state, result);
  return { result, player: applied.player, pr: applied.pr };
}

function lines(additions: number, deletions: number = 0): PullRequestFacts['stats'] {
  return { additions, deletions, changedFiles: 1, commits: 1 };
}

const approved: ReviewRecord[] = [{ reviewerId: REVIEWER_ID, state: 'APPROVED' }];

/** A merge of `size` lines; reviewed by an approver unless `reviews` says otherwise. */
function merge(player: PlayerState, size: number, reviews = approved): Step {
  const pr = mergedFacts({ stats: lines(size) });
  return step(player, mergedEvent(pr), prStateFor(pr, { reviews }));
}

describe('the eight Pledges (design.md 6.4)', () => {
  it('are Strike, Defend, Big Game Hunter, Mentor, Tidy, Pair Up (Strike+), Fine Comb and Well Reviewed', () => {
    expect(PLEDGES.map((entry) => [entry.id, entry.name, entry.upgraded])).toEqual([
      ['strike', 'Strike', false],
      ['defend', 'Defend', false],
      ['big-game-hunter', 'Big Game Hunter', false],
      ['mentor', 'Mentor', false],
      ['tidy', 'Tidy', false],
      ['pair-up', 'Pair Up', true],
      ['fine-comb', 'Fine Comb', false],
      ['well-reviewed', 'Well Reviewed', false],
    ]);
    expect(pledgeDefinition('pair-up')?.upgradeOf).toBe('strike');
    expect(pledgeDefinition('clean-sweep')).toBeUndefined();
    expect(card('pair-up')).toEqual({ id: 'pair-up', name: 'Pair Up', upgraded: true });
  });

  it('has no Clean Sweep (removed by the audit)', () => {
    expect(JSON.stringify(PLEDGES.map((entry) => [entry.id, entry.description]))).not.toMatch(
      /clean sweep/i,
    );
  });
});

describe('the deck (Requirement 9.2)', () => {
  it('starts with Strike, Defend, Big Game Hunter, Mentor, Tidy', () => {
    expect(starterDeck().map((entry) => entry.id)).toEqual([
      'strike',
      'defend',
      'big-game-hunter',
      'mentor',
      'tidy',
    ]);
    expect(createPlayerState(1).deck).toEqual(starterDeck());
  });

  it('is capped at 20', () => {
    let deck: readonly Pledge[] = starterDeck();
    while (deck.length < DECK_CAP) {
      const added = addToDeck(deck, card('tidy'));
      if (!added.ok) throw new Error('expected room');
      deck = added.deck;
    }
    expect(deck).toHaveLength(20);
    expect(addToDeck(deck, card('strike'))).toEqual({ ok: false, error: 'deck_full' });
  });

  it('removes one copy of a card, and reports a card it does not have', () => {
    const deck = [card('strike'), card('tidy'), card('tidy')];
    const removed = removeFromDeck(deck, 'tidy');
    expect(removed.ok && removed.deck.map((entry) => entry.id)).toEqual(['strike', 'tidy']);
    expect(removed.ok && removed.removed.id).toBe('tidy');
    expect(removeFromDeck(deck, 'mentor')).toEqual({ ok: false, error: 'not_in_deck' });
  });

  it('upgrades Strike to Pair Up in place and nothing else', () => {
    const deck = starterDeck();
    const upgraded = upgradeInDeck(deck, 'strike');
    expect(upgraded.ok && upgraded.deck.map((entry) => entry.id)).toEqual([
      'pair-up',
      'defend',
      'big-game-hunter',
      'mentor',
      'tidy',
    ]);
    expect(upgradeInDeck(deck, 'tidy')).toEqual({ ok: false, error: 'no_upgrade' });
    expect(upgradeInDeck(deck, 'pair-up')).toEqual({ ok: false, error: 'not_in_deck' });
  });
});

describe('drawing the hand (Requirement 9.3)', () => {
  it('draws 5 from the starter deck without replacement: all five, once each', () => {
    const hand = drawHand(starterDeck(), 99);
    expect(hand).toHaveLength(PLEDGE_HAND_SIZE);
    expect(hand.map((entry) => entry.id).sort()).toEqual(
      starterDeck()
        .map((entry) => entry.id)
        .sort(),
    );
  });

  it('draws 5 of a bigger deck, never more copies of a card than the deck holds', () => {
    const deck = [
      ...starterDeck(),
      ...Array.from({ length: 5 }, () => card('tidy')),
      ...Array.from({ length: 5 }, () => card('strike')),
    ];
    for (let seed = 1; seed <= 50; seed += 1) {
      const hand = drawHand(deck, seed);
      expect(hand).toHaveLength(5);
      const count = (id: string) => hand.filter((entry) => entry.id === id).length;
      expect(count('tidy')).toBeLessThanOrEqual(6);
      expect(count('mentor')).toBeLessThanOrEqual(1);
      expect(count('defend')).toBeLessThanOrEqual(1);
    }
  });

  it('is deterministic in the seed and varies with it', () => {
    const deck = Array.from({ length: 20 }, (_, index) =>
      card(PLEDGES[index % PLEDGES.length]!.id),
    );
    const ids = (seed: number) =>
      drawHand(deck, seed)
        .map((entry) => entry.id)
        .join();
    expect(ids(7)).toBe(ids(7));
    expect(new Set(Array.from({ length: 30 }, (_, seed) => ids(seed))).size).toBeGreaterThan(5);
  });

  it('draws what there is from a small deck', () => {
    expect(drawHand([card('strike'), card('tidy')], 3)).toHaveLength(2);
    expect(drawHand([], 3)).toEqual([]);
  });
});

describe('playing the hand (Requirement 9.3)', () => {
  const hand = [card('strike'), card('defend'), card('mentor'), card('tidy'), card('strike')];
  const run = makeRun({ hand });
  const player = settledPlayer();

  it('lets the player play up to 3, one of each Pledge, until Tuesday 23:59:59', () => {
    const first = playPledge(run, player, 'strike', MONDAY);
    if (!first.ok) throw new Error('expected a play');
    const second = playPledge(first.run, first.player, 'defend', MONDAY + 2 * 3600_000);
    if (!second.ok) throw new Error('expected a play');
    const third = playPledge(second.run, second.player, 'tidy', WEDNESDAY - 1);
    if (!third.ok) throw new Error('expected a play');
    expect(third.run.played.map((entry) => entry.id)).toEqual(['strike', 'defend', 'tidy']);
    expect(third.player.pledges.played).toEqual(third.run.played);
    expect(playPledge(third.run, third.player, 'mentor', WEDNESDAY - 1)).toEqual({
      ok: false,
      error: 'play_limit',
    });
  });

  it('refuses a card not in the hand, a card already played, and any play from Wednesday', () => {
    expect(playPledge(run, player, 'big-game-hunter', MONDAY)).toEqual({
      ok: false,
      error: 'not_in_hand',
    });
    const played = playPledge(run, player, 'strike', MONDAY);
    if (!played.ok) throw new Error('expected a play');
    expect(playPledge(played.run, played.player, 'strike', MONDAY)).toEqual({
      ok: false,
      error: 'already_played',
    });
    expect(playPledge(run, player, 'defend', WEDNESDAY)).toEqual({
      ok: false,
      error: 'window_closed',
    });
  });

  it('the window is Monday 00:00 to Tuesday 23:59:59.999 UTC', () => {
    expect(pledgeWindowOpen(MONDAY)).toBe(true);
    expect(pledgeWindowOpen(WEDNESDAY - 1)).toBe(true);
    expect(pledgeWindowOpen(WEDNESDAY)).toBe(false);
    expect(pledgeWindowOpen(MONDAY + 6 * DAY_MS + 23 * 3600_000)).toBe(false);
    expect(pledgeWindowOpen(MONDAY + 7 * DAY_MS)).toBe(true);
  });
});

describe('the auto-play rule', () => {
  const hand = [card('strike'), card('defend'), card('strike'), card('mentor'), card('tidy')];
  const run = makeRun({ hand });
  const player = settledPlayer();

  it('does nothing while plays are open', () => {
    const result = autoPlayPledges(run, player, WEDNESDAY - 1);
    expect(result.run).toBe(run);
    expect(result.player).toBe(player);
  });

  it('plays the top 3 of the hand in draw order once the window has closed', () => {
    const result = autoPlayPledges(run, player, WEDNESDAY);
    expect(result.run.played.map((entry) => entry.id)).toEqual(['strike', 'defend', 'mentor']);
    expect(result.player.pledges.played).toEqual(result.run.played);
  });

  it('fills only the open slots when the player played some, and never plays a card twice', () => {
    const manual = playPledge(run, player, 'tidy', MONDAY);
    if (!manual.ok) throw new Error('expected a play');
    const result = autoPlayPledges(manual.run, manual.player, WEDNESDAY);
    expect(result.run.played.map((entry) => entry.id)).toEqual(['tidy', 'strike', 'defend']);
  });

  it('is idempotent and a no-op when nothing is left to play', () => {
    const once = autoPlayPledges(run, player, WEDNESDAY);
    const twice = autoPlayPledges(once.run, once.player, WEDNESDAY + DAY_MS);
    expect(twice.run).toBe(once.run);
    const tiny = makeRun({ hand: [card('strike')], played: [card('strike')] });
    expect(autoPlayPledges(tiny, player, WEDNESDAY).run).toBe(tiny);
  });
});

describe('Strike: merge 3 PRs, +300 points on the 3rd', () => {
  it('pays +300 on the 3rd merge only, as a flat bonus', () => {
    let player = playing(AUTHOR_ID, 'strike');
    const results: ScoreResult[] = [];
    for (let index = 0; index < 4; index += 1) {
      const next = merge(player, 40);
      results.push(next.result);
      player = next.player;
    }
    const bonus = (result: ScoreResult) =>
      result.breakdown.filter((line) => line.label === 'Pledge: Strike');
    expect(results.map((result) => bonus(result).length)).toEqual([0, 0, 1, 0]);
    expect(bonus(results[2]!)[0]).toEqual({ label: 'Pledge: Strike', value: 300, kind: 'points' });
    expect(results[2]!.points - results[1]!.points).toBe(300);
    expect(player.pledges.completed).toEqual(['strike']);
    expect(player.pledges.progress).toEqual({ strike: 3 });
  });

  it('ignores a Pledge that was not played', () => {
    const unplayed = merge(settledPlayer(AUTHOR_ID), 40);
    expect(unplayed.result.counterUpdates.pledges).toBeUndefined();
  });

  it('counts only merges that score at full value: not a solo merge, not off the default branch', () => {
    const player = playing(AUTHOR_ID, 'strike');
    // A self-merged 1-line PR is a solo kill (halved), so it is no progress.
    const solo = merge(player, 1, []);
    expect(solo.result.skip).toBeNull();
    expect(solo.player.pledges.progress).toEqual({});
    expect(solo.result.counterUpdates.pledges).toBeUndefined();
    // Nor is a reviewed merge into a non-default branch (halved).
    const offBranch = mergedFacts({ stats: lines(40), baseRefIsDefault: false });
    const stacked = step(
      player,
      mergedEvent(offBranch),
      prStateFor(offBranch, { reviews: approved }),
    );
    expect(stacked.player.pledges.progress).toEqual({});
    // A reviewed merge into the default branch is.
    expect(merge(player, 1).player.pledges.progress).toEqual({ strike: 1 });
    // A merge by a bot on the author's behalf with no human review is solo, so it is not either.
    const queued = mergedFacts({ stats: lines(40), mergedBy: { id: 77, isBot: true } });
    expect(step(player, mergedEvent(queued), prStateFor(queued)).player.pledges.progress).toEqual(
      {},
    );
  });

  it('cannot be farmed with three self-merged 1-line PRs into a scratch branch', () => {
    let player = playing(AUTHOR_ID, 'strike', 'tidy');
    let points = 0;
    for (let index = 0; index < 3; index += 1) {
      const pr = mergedFacts({ stats: lines(1), baseRefIsDefault: false });
      const next = step(player, mergedEvent(pr), prStateFor(pr));
      player = next.player;
      points += next.result.points;
    }
    expect(player.pledges.completed).toEqual([]);
    expect(points).toBeLessThan(100);
  });
});

describe('the flat Pledge bonus is halved like the merge that completes it', () => {
  const ready = (id: PledgeId, progress: number): PlayerState => ({
    ...playing(AUTHOR_ID, id),
    pledges: { played: [card(id)], progress: { [id]: progress }, completed: [] },
  });

  it('halves a bonus earned off the default branch', () => {
    const pr = mergedFacts({ stats: lines(40), baseRefIsDefault: false });
    const result = step(
      ready('pair-up', 2),
      mergedEvent(pr),
      prStateFor(pr, { reviews: approved }),
    ).result;
    expect(result.breakdown).toContainEqual({
      label: 'Pledge: Pair Up (non-default branch x0.5)',
      value: 300,
      kind: 'points',
    });
  });

  it('halves a bonus earned on a solo kill', () => {
    const pr = mergedFacts({ stats: lines(40) });
    const read = {
      reviewerCounters: { [String(REVIEWER_ID)]: { decisions: 0, comments: 0, inline: 3 } },
    };
    const result = step(ready('well-reviewed', 1), mergedEvent(pr), prStateFor(pr, read)).result;
    expect(result.breakdown).toContainEqual({
      label: 'Pledge: Well Reviewed (solo kill x0.5)',
      value: 125,
      kind: 'points',
    });
  });

  it('is full on a reviewed merge into the default branch', () => {
    const pr = mergedFacts({ stats: lines(40) });
    const result = step(
      ready('pair-up', 2),
      mergedEvent(pr),
      prStateFor(pr, { reviews: approved }),
    ).result;
    expect(result.breakdown).toContainEqual({
      label: 'Pledge: Pair Up',
      value: 600,
      kind: 'points',
    });
  });
});

describe('Tidy: merge 3 PRs each under 150 lines, +200 points on the 3rd', () => {
  it('counts only merges under 150 lines', () => {
    let player = playing(AUTHOR_ID, 'tidy');
    player = merge(player, 149).player;
    player = merge(player, 150).player;
    player = merge(player, 400).player;
    expect(player.pledges.progress).toEqual({ tidy: 1 });
    player = merge(player, 10).player;
    const third = merge(player, 100);
    expect(third.result.breakdown).toContainEqual({
      label: 'Pledge: Tidy',
      value: 200,
      kind: 'points',
    });
    expect(third.player.pledges.completed).toEqual(['tidy']);
  });

  it('counts only merges that score at full value, like Strike', () => {
    const player = playing(AUTHOR_ID, 'tidy');
    expect(merge(player, 10, []).player.pledges.progress).toEqual({});
    const offBranch = mergedFacts({ stats: lines(10), baseRefIsDefault: false });
    const stacked = step(
      player,
      mergedEvent(offBranch),
      prStateFor(offBranch, { reviews: approved }),
    );
    expect(stacked.player.pledges.progress).toEqual({});
    expect(merge(player, 10).player.pledges.progress).toEqual({ tidy: 1 });
  });

  it('does not count a merge whose size the app never saw: unknown is not "under 150 lines"', () => {
    const player = playing(AUTHOR_ID, 'tidy');
    const pr = mergedFacts({ stats: null });
    const unseen = { ...createPRState(pr), reviews: approved };
    expect(unseen.sizeKnown).toBe(false);
    expect(step(player, mergedEvent(pr), unseen).player.pledges.progress).toEqual({});
    expect(
      step(player, mergedEvent(pr), { ...unseen, sizeKnown: true }).player.pledges.progress,
    ).toEqual({ tidy: 1 });
  });
});

describe('Pair Up (Strike+): merge 3 PRs each with the party bonus, +600 points', () => {
  it('counts merges with an approval from another human, not solo or comment-only', () => {
    let player = playing(AUTHOR_ID, 'pair-up');
    player = merge(player, 40, []).player;
    player = merge(player, 40, [{ reviewerId: REVIEWER_ID, state: 'COMMENTED' }]).player;
    expect(player.pledges.progress).toEqual({});
    player = merge(player, 40).player;
    player = merge(player, 40).player;
    const third = merge(player, 40);
    expect(third.result.breakdown).toContainEqual({
      label: 'Pledge: Pair Up',
      value: 600,
      kind: 'points',
    });
  });

  it('completes alongside Strike and Tidy on the same merge, each paying once', () => {
    const start: PlayerState = {
      ...playing(AUTHOR_ID, 'strike', 'tidy', 'pair-up'),
      pledges: {
        played: ['strike', 'tidy', 'pair-up'].map((id) => card(id as PledgeId)),
        progress: { strike: 2, tidy: 2, 'pair-up': 2 },
        completed: [],
      },
    };
    const result = merge(start, 40).result;
    expect(
      result.breakdown.filter((line) => line.label.startsWith('Pledge:')).map((line) => line.value),
    ).toEqual([300, 200, 600]);
  });
});

describe('Defend: 5 scoring reviews, then +1 Power on all reviews for the rest of the week', () => {
  const review = (player: PlayerState, state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED') =>
    step(player, reviewEvent(state), prStateFor(facts()));

  it('counts approvals and changes-requested reviews, not comment-only reviews', () => {
    let player = playing(REVIEWER_ID, 'defend');
    player = review(player, 'COMMENTED').player;
    expect(player.pledges.progress).toEqual({});
    player = review(player, 'APPROVED').player;
    player = review(player, 'CHANGES_REQUESTED').player;
    expect(player.pledges.progress).toEqual({ defend: 2 });
  });

  it('does not count a review that earned nothing because its cap was reached', () => {
    const player = playing(REVIEWER_ID, 'defend');
    const capped = prStateFor(facts(), {
      reviewerCounters: { [String(REVIEWER_ID)]: { decisions: 2, comments: 0, inline: 0 } },
    });
    const result = step(player, reviewEvent('APPROVED'), capped);
    expect(result.result.skip).toBe('cap');
    expect(result.player.pledges.progress).toEqual({});
  });

  it('adds +1 Power from the review after the 5th, on reviews only', () => {
    let player = playing(REVIEWER_ID, 'defend');
    for (let index = 0; index < 5; index += 1) {
      const next = review(player, 'APPROVED');
      expect(next.result.power).toBe(1);
      player = next.player;
    }
    expect(player.pledges.completed).toEqual(['defend']);
    const sixth = review(player, 'APPROVED');
    expect(sixth.result.power).toBe(2);
    expect(sixth.result.breakdown).toContainEqual({
      label: 'Pledge bonus',
      value: 1,
      kind: 'power',
    });
    expect(pledgePower(player)).toBe(0);
    const merged = step(player, mergedEvent(), prStateFor(mergedFacts()));
    expect(merged.result.power).toBe(1);
  });
});

describe('Big Game Hunter: review a PR of 800+ lines, that review x3', () => {
  const bigReview = (size: number, player: PlayerState = playing(REVIEWER_ID, 'big-game-hunter')) =>
    step(player, reviewEvent('APPROVED', human(REVIEWER_ID), facts({ stats: lines(size) })));

  it('triples the review at 800 lines and not at 799', () => {
    expect(bigReview(799).result.points).toBe(40);
    const big = bigReview(800);
    expect(big.result.points).toBe(120);
    expect(big.result.breakdown[0]).toEqual({
      label: 'Review: approved (Pledge: Big Game Hunter x3)',
      value: 120,
      kind: 'points',
    });
    expect(big.player.pledges.completed).toEqual(['big-game-hunter']);
  });

  it('reads the size from the stored PR when the review payload has none', () => {
    const noStats = facts({ stats: null });
    const pr = prStateFor(noStats, { additions: 900, deletions: 0, sizeKnown: true });
    const result = step(
      playing(REVIEWER_ID, 'big-game-hunter'),
      reviewEvent('APPROVED', human(REVIEWER_ID), noStats),
      pr,
    );
    expect(result.result.points).toBe(120);
    // A size the app never saw is not 800 lines.
    const unseen = step(
      playing(REVIEWER_ID, 'big-game-hunter'),
      reviewEvent('APPROVED', human(REVIEWER_ID), noStats),
      createPRState(noStats),
    );
    expect(unseen.result.points).toBe(40);
  });

  it('pays once a week: the second big review is a normal review', () => {
    const first = bigReview(900);
    const second = bigReview(900, first.player);
    expect(second.result.points).toBe(40);
  });
});

describe('Mentor: approve 2 PRs from authors with fewer merges than you, +0.5 Power', () => {
  const experienced = (id: number): PlayerState => ({
    ...playing(id, 'mentor'),
    repoMerges: { '1001': 7, '2002': 3 },
  });
  const approve = (player: PlayerState, authorMerges: number | null | undefined) =>
    step(
      player,
      reviewEvent('APPROVED'),
      prStateFor(facts(), authorMerges === undefined ? {} : { authorMerges }),
    );

  it('counts approvals of newer authors only', () => {
    expect(lifetimeMerges(experienced(REVIEWER_ID))).toBe(10);
    let player = experienced(REVIEWER_ID);
    player = approve(player, 10).player;
    player = approve(player, 25).player;
    expect(player.pledges.progress).toEqual({});
    player = approve(player, 9).player;
    expect(player.pledges.progress).toEqual({ mentor: 1 });
  });

  it('does not count a changes-requested review or a first-timer reviewer', () => {
    const changes = step(
      experienced(REVIEWER_ID),
      reviewEvent('CHANGES_REQUESTED'),
      prStateFor(facts(), { authorMerges: 0 }),
    );
    expect(changes.player.pledges.progress).toEqual({});
    const rookie = approve(playing(REVIEWER_ID, 'mentor'), 0);
    expect(rookie.player.pledges.progress).toEqual({});
  });

  it('counts a known newcomer with no merges, but not an author whose count is unknown', () => {
    expect(approve(experienced(REVIEWER_ID), 0).player.pledges.progress).toEqual({ mentor: 1 });
    // An author who is not a player has no known count: unknown must not read as a newcomer.
    expect(approve(experienced(REVIEWER_ID), undefined).player.pledges.progress).toEqual({});
    expect(approve(experienced(REVIEWER_ID), null).player.pledges.progress).toEqual({});
  });

  it('adds +0.5 Power to every event from the next one on', () => {
    let player = experienced(REVIEWER_ID);
    player = approve(player, 1).player;
    const second = approve(player, 1);
    expect(second.result.power).toBe(1);
    expect(second.player.pledges.completed).toEqual(['mentor']);
    const after = step(second.player, mergedEvent(), prStateFor(mergedFacts()));
    expect(after.result.power).toBe(1.5);
    expect(after.result.breakdown).toContainEqual({
      label: 'Pledge bonus',
      value: 0.5,
      kind: 'power',
    });
    expect(pledgePower(second.player)).toBe(0.5);
  });
});

describe('Fine Comb: 3 reviews after 3+ inline comments each, +0.5 Power on reviews', () => {
  const counters = (inline: number): Partial<PRState> => ({
    reviewerCounters: { [String(REVIEWER_ID)]: { decisions: 0, comments: 0, inline } },
  });
  const review = (
    player: PlayerState,
    inline: number,
    state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' = 'APPROVED',
  ) => step(player, reviewEvent(state), prStateFor(facts(), counters(inline)));

  it('counts a scoring review only after the reviewer left 3 inline comments on that PR', () => {
    let player = playing(REVIEWER_ID, 'fine-comb');
    player = review(player, 2).player;
    expect(player.pledges.progress).toEqual({});
    player = review(player, 3).player;
    expect(player.pledges.progress).toEqual({ 'fine-comb': 1 });
    player = review(player, 10, 'CHANGES_REQUESTED').player;
    expect(player.pledges.progress).toEqual({ 'fine-comb': 2 });
  });

  it('does not count a bare comment review, however many inline comments came first', () => {
    const next = review(playing(REVIEWER_ID, 'fine-comb'), 10, 'COMMENTED');
    expect(next.player.pledges.progress).toEqual({});
  });

  it('counts the reviewer who is acting, not another reviewer on the same PR', () => {
    const other = prStateFor(facts(), {
      reviewerCounters: { [String(OTHER_REVIEWER_ID)]: { decisions: 0, comments: 0, inline: 9 } },
    });
    const next = step(playing(REVIEWER_ID, 'fine-comb'), reviewEvent('APPROVED'), other);
    expect(next.player.pledges.progress).toEqual({});
  });

  it('ignores merges', () => {
    const next = merge(playing(AUTHOR_ID, 'fine-comb'), 40);
    expect(next.player.pledges.progress).toEqual({});
  });

  it('adds +0.5 Power to reviews only, from the next event on', () => {
    let player = playing(REVIEWER_ID, 'fine-comb');
    player = review(player, 3).player;
    player = review(player, 3).player;
    const third = review(player, 3);
    expect(third.result.power).toBe(1);
    expect(third.player.pledges.completed).toEqual(['fine-comb']);
    const next = review(third.player, 0);
    expect(next.result.power).toBe(1.5);
    expect(next.result.breakdown).toContainEqual({
      label: 'Pledge bonus',
      value: 0.5,
      kind: 'power',
    });
    expect(pledgePower(third.player)).toBe(0);
    const merged = step(third.player, mergedEvent(), prStateFor(mergedFacts()));
    expect(merged.result.power).toBe(1);
  });
});

describe('Well Reviewed: merge 2 PRs that each drew 3+ inline comments, +250 points', () => {
  const read = (inline: number, reviewerId: number = REVIEWER_ID): Partial<PRState> => ({
    reviews: approved,
    reviewerCounters: { [String(reviewerId)]: { decisions: 1, comments: 0, inline } },
  });
  const mergeRead = (player: PlayerState, inline: number, size = 40) => {
    const pr = mergedFacts({ stats: lines(size) });
    return step(player, mergedEvent(pr), prStateFor(pr, read(inline)));
  };

  it('counts a merge that some reviewer read closely, whoever reviewed it', () => {
    let player = playing(AUTHOR_ID, 'well-reviewed');
    player = mergeRead(player, 2).player;
    expect(player.pledges.progress).toEqual({});
    player = mergeRead(player, 3).player;
    expect(player.pledges.progress).toEqual({ 'well-reviewed': 1 });
    const other = step(
      player,
      mergedEvent(mergedFacts()),
      prStateFor(mergedFacts(), read(4, OTHER_REVIEWER_ID)),
    );
    expect(other.player.pledges.progress).toEqual({ 'well-reviewed': 2 });
  });

  it('pays +250 on the second, whatever the size: size earns nothing here', () => {
    let player = playing(AUTHOR_ID, 'well-reviewed');
    player = mergeRead(player, 5, 10).player;
    const second = mergeRead(player, 5, 10);
    expect(second.result.breakdown).toContainEqual({
      label: 'Pledge: Well Reviewed',
      value: 250,
      kind: 'points',
    });
    // A huge PR that nobody read counts for nothing.
    const unread = merge(playing(AUTHOR_ID, 'well-reviewed'), 5000);
    expect(unread.player.pledges.progress).toEqual({});
  });

  it('ignores reviews', () => {
    const next = step(
      playing(REVIEWER_ID, 'well-reviewed'),
      reviewEvent('APPROVED'),
      prStateFor(facts(), read(9)),
    );
    expect(next.player.pledges.progress).toEqual({});
  });
});

describe('the Pledges added in task 24 obey the incentive audit (game-design.md 8.3)', () => {
  it('say nothing of night, closing, speed or volume', () => {
    for (const id of ['fine-comb', 'well-reviewed'] as const) {
      const text = pledgeDefinition(id)!.description;
      expect(text, id).not.toMatch(/night|closed|close |fast|within|most/i);
    }
  });
});

describe('progress evaluators', () => {
  it('ignore events that are not scored merges or reviews', () => {
    const player = playing(AUTHOR_ID, 'strike', 'defend');
    const inline = evaluatePledges(player, inlineEvent(), prStateFor(facts()));
    expect(inline).toEqual({ factors: [], bonuses: [], next: null });
    const opened = evaluatePledges(
      player,
      { kind: 'pr_opened', actor: human(AUTHOR_ID), trigger: 'opened', pr: facts() },
      prStateFor(facts()),
    );
    expect(opened.next).toBeNull();
  });

  it('skip unknown ids and Pledges already completed', () => {
    const player: PlayerState = {
      ...settledPlayer(AUTHOR_ID),
      pledges: {
        played: [card('strike'), { id: 'future-pledge', name: 'Future', upgraded: false }],
        progress: { strike: 3 },
        completed: ['strike'],
      },
    };
    expect(evaluatePledges(player, mergedEvent(), prStateFor(mergedFacts())).next).toBeNull();
  });

  it('each completion bonus applies at most once per week, however many events follow', () => {
    let player = playing(AUTHOR_ID, 'strike');
    let bonuses = 0;
    for (let index = 0; index < 10; index += 1) {
      const next = merge(player, 40);
      bonuses += next.result.breakdown.filter((line) => line.label === 'Pledge: Strike').length;
      player = next.player;
    }
    expect(bonuses).toBe(1);
    expect(player.pledges.progress).toEqual({ strike: 3 });
  });

  it('progress is plain data carried by the result, with the other players inputs untouched', () => {
    const player = playing(AUTHOR_ID, 'strike');
    const next = merge(player, 40);
    expect(next.result.counterUpdates.pledges).toEqual({
      played: [card('strike')],
      progress: { strike: 1 },
      completed: [],
    });
    expect(player.pledges.progress).toEqual({});
  });
});

describe('pledgePower', () => {
  it('sums the Power of completed Pledges that apply to the event kind', () => {
    const player: PlayerState = {
      ...settledPlayer(),
      pledges: { played: [], progress: {}, completed: ['defend', 'mentor', 'strike', 'ghost'] },
    };
    expect(pledgePower(player)).toBe(0.5);
    const ctx = (event: GameEvent) => ({ event, pr: prStateFor(facts()), now: NOW });
    expect(pledgePower(player, ctx(reviewEvent('APPROVED')))).toBe(1.5);
    expect(pledgePower(player, ctx(mergedEvent()))).toBe(0.5);
    expect(pledgePower(player, ctx(inlineEvent(human(OTHER_REVIEWER_ID))))).toBe(0.5);
  });
});
