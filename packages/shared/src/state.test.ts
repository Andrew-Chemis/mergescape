import { describe, expect, it } from 'vitest';
import { verifiedKillEvents } from './credit';
import { score } from './score';
import { applyScoreResult, createPlayerState, createPRState } from './state';
import {
  AUTHOR_ID,
  facts,
  human,
  mergedEvent,
  mergedFacts,
  NOW,
  OTHER_REVIEWER_ID,
  prStateFor,
  reviewEvent,
  REVIEWER_ID,
  settledPlayer,
} from './test-builders';

describe('createPlayerState', () => {
  it('is a level-1 character with the default Zone exponent', () => {
    expect(createPlayerState(42)).toEqual({
      id: 42,
      xp: 0,
      skillXp: { smithing: 0, vigilance: 0, oratory: 0, endurance: 0 },
      zoneExponent: 1.6,
      counters: { opens: { day: '', count: 0 }, dailyFirstDay: null, streakWeeks: 0 },
      charms: [],
      gear: { pieces: [], setBonus: 0 },
      pledges: { played: [], powerBonus: 0 },
      feats: { unlocked: [], powerBonus: 0 },
      moguls: { current: null, bag: [] },
      week: { loadedDiceUsed: false },
      repoMerges: {},
    });
  });
});

describe('createPRState', () => {
  it('starts with no reviews and takes size from the payload when present', () => {
    expect(createPRState(facts())).toEqual({
      repoId: 1001,
      number: 7,
      authorId: AUTHOR_ID,
      additions: 100,
      deletions: 20,
      reviewRoundCount: 0,
      syncCount: 0,
      reviews: [],
      reviewerCounters: {},
    });
  });

  it('scores size as 0 when the payload carried none (review events)', () => {
    const state = createPRState(facts({ stats: null }));
    expect(state.additions).toBe(0);
    expect(state.deletions).toBe(0);
  });
});

describe('applyScoreResult', () => {
  it('adds XP and skill XP, records the review and the reviewer counters', () => {
    const player = settledPlayer(REVIEWER_ID);
    const pr = createPRState(facts());
    const result = score(reviewEvent('CHANGES_REQUESTED'), player, pr, NOW);
    const next = applyScoreResult(player, pr, result);
    expect(next.player.xp).toBe(result.xp);
    expect(next.player.skillXp.vigilance).toBe(result.xp);
    expect(next.pr.reviews).toEqual([{ reviewerId: REVIEWER_ID, state: 'CHANGES_REQUESTED' }]);
    expect(next.pr.reviewRoundCount).toBe(1);
    expect(next.pr.reviewerCounters[String(REVIEWER_ID)]).toEqual({
      decisions: 1,
      comments: 0,
      inline: 0,
    });
  });

  it('applies player counters and splits the daily bonus into Endurance', () => {
    const player = createPlayerState(AUTHOR_ID);
    const pr = createPRState(facts());
    const result = score(mergedEvent(mergedFacts()), player, pr, NOW);
    const next = applyScoreResult(player, pr, result);
    expect(next.player.counters.dailyFirstDay).toBe('2026-11-09');
    expect(next.player.skillXp.endurance).toBeGreaterThan(0);
    expect(next.player.skillXp.smithing + next.player.skillXp.endurance).toBe(next.player.xp);
  });

  it('leaves its inputs untouched and changes nothing for an unscored event', () => {
    const player = settledPlayer(AUTHOR_ID);
    const pr = createPRState(facts());
    const result = score(mergedEvent(mergedFacts({ merged: false })), player, pr, NOW);
    const next = applyScoreResult(player, pr, result);
    expect(next.player).toEqual(player);
    expect(next.pr).toEqual(pr);
    expect(next.player).not.toBe(player);
  });
});

describe('verifiedKillEvents', () => {
  const merged = mergedEvent(mergedFacts());

  it('emits one event per distinct human approver who is not the author', () => {
    const pr = prStateFor(merged.pr, {
      reviews: [
        { reviewerId: REVIEWER_ID, state: 'CHANGES_REQUESTED' },
        { reviewerId: REVIEWER_ID, state: 'APPROVED' },
        { reviewerId: REVIEWER_ID, state: 'APPROVED' },
        { reviewerId: OTHER_REVIEWER_ID, state: 'COMMENTED' },
        { reviewerId: AUTHOR_ID, state: 'APPROVED' },
        { reviewerId: 9, state: 'APPROVED' },
      ],
    });
    const events = verifiedKillEvents(merged, pr);
    expect(events).toEqual([
      { kind: 'verified_kill', actor: human(REVIEWER_ID), pr: merged.pr },
      { kind: 'verified_kill', actor: human(9), pr: merged.pr },
    ]);
  });

  it('emits nothing when nobody approved', () => {
    expect(verifiedKillEvents(merged, prStateFor(merged.pr))).toEqual([]);
  });
});
