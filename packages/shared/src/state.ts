import { ZONE_EXPONENT } from './constants';
import { starterDeck } from './pledges';
import { emptySkillXp, SKILLS } from './skills';
import type { PlayerState, PRState, PullRequestFacts, ScoreResult } from './types';

/**
 * A level-1 character: no Charms, gear, Vouchers, Feats or Moguls, the five-card starter Pledge deck
 * (Requirement 9.2) and an empty week.
 */
export function createPlayerState(id: number): PlayerState {
  return {
    id,
    xp: 0,
    skillXp: emptySkillXp(),
    zoneExponent: ZONE_EXPONENT,
    counters: { opens: { day: '', count: 0 }, dailyFirstDay: null, streakWeeks: 0 },
    charms: [],
    gear: { pieces: [], setBonus: 0 },
    pledges: { played: [], progress: {}, completed: [] },
    feats: { unlocked: [], powerBonus: 0 },
    moguls: { current: null, bag: [], chain: 0, benched: null, boardWeek: null },
    week: { loadedDiceUsed: false },
    vouchers: [],
    deck: starterDeck(),
    repoMerges: {},
  };
}

/** The scorer's view of a PR seen for the first time (no reviews, no pushes). */
export function createPRState(facts: PullRequestFacts): PRState {
  return {
    repoId: facts.repoId,
    number: facts.number,
    authorId: facts.author.id,
    additions: facts.stats?.additions ?? 0,
    deletions: facts.stats?.deletions ?? 0,
    reviewRoundCount: 0,
    syncCount: 0,
    reviews: [],
    reviewerCounters: {},
  };
}

/**
 * Apply a ScoreResult to the states it was computed from: XP, skill XP and every
 * counter update (including Pledge progress, the Leather Jacket chain, Loaded Dice and repository merge
 * counts). Pure; the backend does the same with DynamoDB writes, tests and previews use this.
 */
export function applyScoreResult(
  player: PlayerState,
  pr: PRState,
  result: ScoreResult,
): { player: PlayerState; pr: PRState } {
  const skillXp = { ...player.skillXp };
  for (const skill of SKILLS) {
    skillXp[skill] += result.skillXp[skill];
  }
  const { player: playerUpdates, pr: prUpdates } = result.counterUpdates;
  const earned: PlayerState = {
    ...player,
    xp: player.xp + result.xp,
    skillXp,
    counters: { ...player.counters, ...playerUpdates },
  };
  const { pledges, mogulChain, loadedDiceUsed, repoMerges } = result.counterUpdates;
  const nextPlayer: PlayerState = {
    ...earned,
    pledges: pledges ?? earned.pledges,
    moguls: mogulChain === undefined ? earned.moguls : { ...earned.moguls, chain: mogulChain },
    week: loadedDiceUsed ? { ...earned.week, loadedDiceUsed: true } : earned.week,
    repoMerges: repoMerges
      ? { ...earned.repoMerges, [String(repoMerges.repoId)]: repoMerges.count }
      : earned.repoMerges,
  };

  const reviewerCounters = { ...pr.reviewerCounters };
  if (prUpdates.reviewerCounters) {
    reviewerCounters[String(prUpdates.reviewerCounters.reviewerId)] =
      prUpdates.reviewerCounters.counters;
  }
  const nextPr: PRState = {
    ...pr,
    syncCount: prUpdates.syncCount ?? pr.syncCount,
    reviewRoundCount: prUpdates.reviewRoundCount ?? pr.reviewRoundCount,
    reviews: prUpdates.review ? [...pr.reviews, prUpdates.review] : pr.reviews,
    reviewerCounters,
  };
  return { player: nextPlayer, pr: nextPr };
}
