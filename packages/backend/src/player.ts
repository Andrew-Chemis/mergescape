import {
  createPlayerState,
  featBonusFor,
  forgeOf,
  loadoutOf,
  satchelOf,
  zoneExponentFor,
} from '@mergescape/shared';
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
    // The depth layers. The set bonus and the Feat Power bonus are worked out, never stored.
    gear: loadoutOf(profile.gear.pieces, profile.gear.capeColor ?? undefined),
    feats: { unlocked: profile.featsUnlocked, powerBonus: featBonusFor(profile.featsUnlocked) },
    satchel: profile.satchel,
    expedition: profile.expedition,
    inventory: profile.inventory,
    ...(profile.pets !== null ? { pets: profile.pets } : {}),
    charmPacks: profile.charmPacks,
    forge: profile.forge,
    titles: profile.titles,
    pinnedFeats: profile.pinnedFeats,
    ...(profile.featCounters !== null ? { featCounters: profile.featCounters } : {}),
    ...(profile.tzOffsetMinutes !== null ? { tzOffsetMinutes: profile.tzOffsetMinutes } : {}),
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

/** The id of the Feat whose coin the badge shows. */
export const OLD_COIN_FEAT = 'the-old-coin';

/**
 * The profile fields an expedition, Forge, gear, Feat or pack action changed between two states of the same
 * player: the satchel, the latest expedition, the inventory and worn gear, pets, Charm packs, the Forge, Feats
 * and titles, pins and the Feat counters. Only changed fields are present. Gold, Charms and the like belong
 * to `shopPatch`; an action that changes both (opening a Charm pack) uses both.
 */
export function depthPatch(before: PlayerState, after: PlayerState): ProfilePatch {
  const patch: ProfilePatch = {};
  if (!same(after.satchel, before.satchel)) {
    patch.satchel = satchelOf(after);
  }
  if (!same(after.expedition, before.expedition) && after.expedition) {
    patch.expedition = after.expedition;
  }
  if (!same(after.inventory, before.inventory)) {
    patch.inventory = after.inventory ?? [];
  }
  if (!same(after.gear, before.gear)) {
    patch.gear = {
      pieces: after.gear.pieces,
      ...(after.gear.capeColor !== undefined ? { capeColor: after.gear.capeColor } : {}),
    };
  }
  if (!same(after.pets, before.pets)) {
    patch.pets = after.pets ?? [];
  }
  if (!same(after.charmPacks, before.charmPacks)) {
    patch.charmPacks = after.charmPacks ?? [];
  }
  if (!same(after.forge, before.forge)) {
    patch.forge = forgeOf(after);
  }
  if (!same(after.feats.unlocked, before.feats.unlocked)) {
    patch.featsUnlocked = after.feats.unlocked;
    patch.oldCoin = after.feats.unlocked.includes(OLD_COIN_FEAT);
  }
  if (!same(after.titles, before.titles)) {
    patch.titles = after.titles ?? [];
  }
  if (!same(after.pinnedFeats, before.pinnedFeats)) {
    patch.pinnedFeats = after.pinnedFeats ?? [];
  }
  if (!same(after.featCounters, before.featCounters) && after.featCounters) {
    patch.featCounters = after.featCounters;
  }
  return patch;
}
