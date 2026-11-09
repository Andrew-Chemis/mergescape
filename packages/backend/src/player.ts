import { createPlayerState, zoneExponentFor } from '@mergescape/shared';
import type { PlayerState, RunState } from '@mergescape/shared';
import type { ProfileItem, ProfilePatch, WeekScorerState } from './db';

/**
 * The scorer's view of a stored profile: everything the profile persists. The week-scoped part (the
 * played Pledges and their progress, the Leather Jacket chain, Loaded Dice) comes from the run, through
 * `playerWithRun` after `runWithScorerState`.
 */
export function toPlayerState(profile: ProfileItem): PlayerState {
  const base = createPlayerState(profile.id);
  return {
    ...base,
    xp: profile.xp,
    skillXp: { ...profile.skillXp },
    zoneExponent: zoneExponentFor(profile.vouchers),
    counters: {
      opens:
        profile.opensDay !== null
          ? { day: profile.opensDay, count: profile.opensCount }
          : base.counters.opens,
      dailyFirstDay: profile.dailyFirstDay,
      streakWeeks: profile.streakWeeks,
    },
    charms: profile.charms,
    gold: profile.gold,
    renown: profile.renown,
    vouchers: profile.vouchers,
    deck: profile.deck,
    cosmetics: profile.cosmetics,
    repoMerges: profile.repoMerges,
    moguls: {
      ...base.moguls,
      bag: profile.mogulBag,
      benched: profile.mogulBenched,
      boardWeek: profile.mogulBoardWeek,
    },
  };
}

/**
 * The run with the week-scoped scorer state read back from the profile. It applies only when it was
 * stamped with this run's week, so Monday resets it without a write.
 */
export function runWithScorerState(run: RunState, profile: ProfileItem): RunState {
  const state = profile.weekState;
  if (state === null || state.week !== run.weekKey) {
    return run;
  }
  return {
    ...run,
    mogulChain: state.mogulChain,
    pledgeProgress: state.pledgeProgress,
    pledgesCompleted: state.pledgesCompleted,
    loadedDiceUsed: state.loadedDiceUsed,
  };
}

/** The week-scoped scorer state of `player`, stamped with the week it belongs to. */
export function scorerStateOf(weekKey: string, player: PlayerState): WeekScorerState {
  return {
    week: weekKey,
    pledgeProgress: { ...player.pledges.progress },
    pledgesCompleted: [...player.pledges.completed],
    mogulChain: player.moguls.chain,
    loadedDiceUsed: player.week.loadedDiceUsed,
  };
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * The profile fields a shop or shrine action changed between two states of the same player: gold, Charms,
 * Vouchers, the Pledge deck and cosmetics. Only changed fields are present.
 */
export function shopPatch(before: PlayerState, after: PlayerState): ProfilePatch {
  const patch: ProfilePatch = {};
  if (after.gold !== before.gold) {
    patch.gold = after.gold;
  }
  if (!same(after.charms, before.charms)) {
    patch.charms = after.charms;
  }
  if (!same(after.vouchers, before.vouchers)) {
    patch.vouchers = after.vouchers;
  }
  if (!same(after.deck, before.deck)) {
    patch.deck = after.deck;
  }
  if (!same(after.cosmetics, before.cosmetics)) {
    patch.cosmetics = after.cosmetics;
  }
  return patch;
}
