import { ZONE_EXPONENT } from './constants';
import { emptySkillXp, SKILLS } from './skills';
import type { PlayerState, PRState, PullRequestFacts, ScoreResult } from './types';

/** A level-1 character with no Charms, gear, Pledges, Feats or Moguls. */
export function createPlayerState(id: number): PlayerState {
  return {
    id,
    xp: 0,
    skillXp: emptySkillXp(),
    zoneExponent: ZONE_EXPONENT,
    counters: { opens: { day: '', count: 0 }, dailyFirstDay: null, streakWeeks: 0 },
    charms: [],
    gear: { pieces: [], setBonus: 0 },
    pledges: { played: [], powerBonus: 0 },
    feats: { unlocked: [], powerBonus: 0 },
    moguls: { current: null, bag: [] },
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
 * Apply a ScoreResult to the states it was computed from: XP, skill XP and every counter update.
 * Pure; the backend does the same with DynamoDB writes, tests and previews use this.
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
  const nextPlayer: PlayerState = {
    ...player,
    xp: player.xp + result.xp,
    skillXp,
    counters: { ...player.counters, ...playerUpdates },
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
