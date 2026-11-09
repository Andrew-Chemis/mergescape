import { createPlayerState, levelFor, POINTS_PER_GOLD } from '@mergescape/shared';
import type { PlayerState, ScoreResult } from '@mergescape/shared';
import type { ProfileItem, ScoreWrite } from './db';

/**
 * Gold for an event: 1 per `POINTS_PER_GOLD` points, floored per event (Requirement 8.1).
 * Task 14 moves gold into `shared/economy.ts` (`applyGoldDelta`); this is the single call site until then.
 */
export function goldForPoints(points: number): number {
  return Math.floor(points / POINTS_PER_GOLD);
}

/** The scorer's view of a stored profile. Everything the profile does not persist yet keeps its default. */
export function toPlayerState(profile: ProfileItem): PlayerState {
  const base = createPlayerState(profile.id);
  return {
    ...base,
    xp: profile.xp,
    skillXp: { ...profile.skillXp },
    counters: {
      opens:
        profile.opensDay !== null
          ? { day: profile.opensDay, count: profile.opensCount }
          : base.counters.opens,
      dailyFirstDay: profile.dailyFirstDay,
      streakWeeks: profile.streakWeeks,
    },
  };
}

/** What a score result changes on the profile it was computed for. */
export function toScoreWrite(profile: ProfileItem, result: ScoreResult): ScoreWrite {
  return {
    xp: result.xp,
    skillXp: result.skillXp,
    gold: goldForPoints(result.points),
    level: levelFor(profile.xp + result.xp),
    counters: result.counterUpdates.player,
  };
}
