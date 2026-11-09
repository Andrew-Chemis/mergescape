/**
 * The weekly run in the database (tasks.md 15): starting a week for a player, closing the last one, and
 * loading the player's current state for scoring and for the endpoints.
 *
 * Starting a week is shared by the Monday rollover and by a lazy start (a new player, or a missed
 * rollover), so both are `ensureRun`. The same profile write also banks the equipped pet's weekly supply
 * and checks the Feats the new week can reach (the weekly streak, Renown), once per run start. It is idempotent and safe to repeat after a crash at any point:
 *
 *   1. read the profile and this week's `WEEK#` item;
 *   2. if the profile's `run_week` is this week, there is nothing to do;
 *   3. otherwise plan the transition from the profile as it is now (streak, Vocation, history, Mogul bag,
 *      new run) with the seed stored on the `WEEK#` item if one exists, else a fresh one;
 *   4. create the `WEEK#` item (conditional on it not existing: whoever creates it fixes the seed);
 *   5. write the profile, guarded by its `version` and by `run_week` not being this week yet, which is
 *      the single step that credits the streak. A crash after 4 leaves a week the next call finishes with
 *      the same seed, so the plan is the same.
 *
 * Week-scoped scorer state lives on the profile stamped with its week (see `player.ts`), so the Monday
 * transition resets it by changing `run_week` alone.
 */
import {
  addSupplies,
  applyFounderBoard,
  applyPetWeekly,
  applyScoreResult,
  autoPlayPledges,
  evaluateFeats,
  isoWeekKey,
  levelFor,
  MEDIAN_WEEKS,
  playerWithRun,
  recordWorldEvent,
  score,
  startRun,
  weekStartUtc,
} from '@mergescape/shared';
import type {
  FeatUnlock,
  PlayerState,
  PRState,
  RunState,
  WeeklyStreakEvent,
} from '@mergescape/shared';
import type { Db, EventRow, ProfileItem, ProfilePatch, WeekItem } from './db';
import { applyFeats, writeFeats } from './feat-flow';
import { RETRY, versionedWrite, withVersionRetry } from './optimistic';
import { depthPatch, runWithScorerState, toPlayerState } from './player';
import { vocationFor } from './vocation';
import { weeksBetween } from './weeks';

/** The weekly streak needs "at least one merged PR or three reviews that week" (types.ts, WeeklyStreakEvent). */
export const STREAK_MIN_MERGES = 1;
export const STREAK_MIN_REVIEWS = 3;

export interface RunContext {
  db: Db;
  /** Epoch milliseconds. */
  now: number;
  /** A fresh random unsigned 32-bit seed for a new run. */
  newSeed: () => number;
}

/** The profile and week as stored, with the week for `profile.runWeek` being the current one. */
export interface Rolled {
  profile: ProfileItem;
  week: WeekItem;
}

/** A player ready to score or to serve: the stored items and the scorer's view of them. */
export interface Current extends Rolled {
  /** With the run's state applied, the Founder's Board settled and unplayed Pledges auto-played. */
  player: PlayerState;
  /** The week's run with the scorer state filled in (and any auto-played Pledges). */
  run: RunState;
}

// ---------------------------------------------------------------------------------------------
// The transition, as a pure plan
// ---------------------------------------------------------------------------------------------

export interface RolloverPlan {
  run: RunState;
  /** What to write to the profile; null when only the week item is missing. */
  profilePatch: ProfilePatch | null;
  /** The Combat Log row of the weekly streak, when last week qualified. */
  streakRow: EventRow | null;
  /** Feats the weekly streak and the new week unlocked; their `FEAT#` records follow the profile write. */
  unlocked: FeatUnlock[];
}

/** A PRState for the events that belong to no PR (the weekly streak never reads one). */
function noPr(playerId: number): PRState {
  return {
    repoId: 0,
    number: 0,
    authorId: playerId,
    additions: 0,
    deletions: 0,
    reviewRoundCount: 0,
    syncCount: 0,
    reviews: [],
    reviewerCounters: {},
  };
}

/**
 * Close last week and open this one for a player (Requirements 5.3, 6.1, 6.2, 7.2, 9.3), as data.
 *
 * - Last week's weekly XP joins the profile's history (8 entries); skipped weeks count as zero.
 * - The weekly streak is scored for last week (1 merge or 3 reviews qualifies); a week with no activity
 *   breaks it. Its XP and gold go to the character only, not to last week's total or this week's.
 * - Vocation is recomputed from skill XP, and the Mogul bag, the Founder's Board and the Pledge hand move
 *   on through the shared `startRun`.
 *
 * @param previous the `WEEK#` item of `profile.runWeek`, if any
 * @param profileRolled the profile is already in this week (only the week item is missing)
 */
export function planRollover(
  profile: ProfileItem,
  previous: WeekItem | null,
  seed: number,
  now: number,
  profileRolled: boolean,
): RolloverPlan {
  const weekKey = isoWeekKey(now);
  let player = toPlayerState(profile);
  if (profileRolled) {
    return {
      run: startRun({ player, now, seed, history: profile.history }).run,
      profilePatch: null,
      streakRow: null,
      unlocked: [],
    };
  }

  const before = player;
  const unlocked: FeatUnlock[] = [];
  let history = [...profile.history];
  let streakRow: EventRow | null = null;
  if (profile.runWeek !== null) {
    const gap = Math.max(1, weeksBetween(profile.runWeek, weekKey));
    history = [
      ...history,
      previous?.run.weeklyXp ?? 0,
      ...new Array<number>(gap - 1).fill(0),
    ].slice(-MEDIAN_WEEKS);

    const qualified =
      gap === 1 &&
      previous !== null &&
      (previous.merges >= STREAK_MIN_MERGES || previous.reviews >= STREAK_MIN_REVIEWS);
    const event: WeeklyStreakEvent = {
      kind: 'weekly_streak',
      actor: { id: profile.id, isBot: false },
      qualified,
    };
    const pr = noPr(profile.id);
    const result = score(event, player, pr, now);
    const evaluation = evaluateFeats(player, event, pr, result, now);
    player = addSupplies(applyScoreResult(player, pr, result).player, result.supplies);
    // The weekly streak can unlock the streak Feats (Perennial, Evergreen).
    const streakFeats = applyFeats(player, evaluation, now);
    player = streakFeats.player;
    unlocked.push(...streakFeats.unlocked);
    if (result.skip === null && result.skill !== null) {
      streakRow = {
        userId: profile.id,
        // Fixed to the start of the week, so a retried rollover rewrites the same row.
        ts: new Date(weekStartUtc(now)).toISOString(),
        deliveryId: `streak-${weekKey}`,
        kind: 'weekly_streak',
        points: result.points,
        power: result.power,
        zone: result.zone,
        level: result.level,
        xp: result.xp,
        skill: result.skill,
        skillXp: result.skillXp,
        supplies: result.supplies,
        monster: null,
        breakdown: result.breakdown,
      };
    }
  }

  const started = startRun({ player, now, seed, history });
  // Once per run start (this write is the single step that moves the profile into the week): the pet's
  // weekly supply, then a look at the Feats the new week can have reached.
  const petted = applyPetWeekly(started.player);
  const refreshed = applyFeats(petted, recordWorldEvent(petted, { kind: 'refresh' }, now), now);
  const next = refreshed.player;
  unlocked.push(...refreshed.unlocked);
  return {
    run: started.run,
    streakRow,
    unlocked,
    profilePatch: {
      ...depthPatch(before, next),
      xp: next.xp,
      skillXp: next.skillXp,
      level: levelFor(next.xp),
      gold: next.gold,
      counters: { streakWeeks: next.counters.streakWeeks },
      charms: next.charms,
      mogulBag: next.moguls.bag,
      mogulBenched: next.moguls.benched,
      mogulBoardWeek: next.moguls.boardWeek,
      vocation: vocationFor(next.skillXp),
      runWeek: weekKey,
      history,
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Doing it
// ---------------------------------------------------------------------------------------------

/**
 * Make sure the player has this week's run, starting it (and closing last week) if not. Returns null when
 * the player has no profile. Safe to call concurrently and to repeat; see the module comment.
 */
export async function ensureRun(ctx: RunContext, userId: number): Promise<Rolled | null> {
  const weekKey = isoWeekKey(ctx.now);
  const rolled = await withVersionRetry<Rolled | null>(async () => {
    // The week key depends only on the clock, so the two reads need not wait for each other.
    const [profile, existing] = await Promise.all([
      ctx.db.getProfile(userId, true),
      ctx.db.getWeekItem(userId, weekKey),
    ]);
    if (!profile) {
      return null;
    }
    const profileRolled = profile.runWeek === weekKey;
    if (existing && profileRolled) {
      return { profile, week: existing };
    }

    const previous =
      profile.runWeek !== null && !profileRolled
        ? await ctx.db.getWeekItem(userId, profile.runWeek)
        : null;
    const seed = existing?.run.shopSeed ?? ctx.newSeed();
    const plan = planRollover(profile, previous, seed, ctx.now, profileRolled);
    if (!existing && !(await ctx.db.createWeek(userId, plan.run))) {
      return RETRY; // someone else created it first: start over with their seed
    }
    const { profilePatch } = plan;
    if (profilePatch) {
      if (plan.streakRow) {
        await ctx.db.putEvent(plan.streakRow);
      }
      const written = await versionedWrite(() =>
        ctx.db.saveProfile(userId, profile.version, profilePatch, {
          expression: 'attribute_not_exists(#r) OR #r <> :r',
          names: { '#r': 'run_week' },
          values: { ':r': weekKey },
        }),
      );
      if (written) {
        await writeFeats(ctx.db, userId, plan.unlocked, ctx.now, `rollover-${weekKey}`);
      }
    }
    // Go round again to read the result back: it also covers a writer that beat us to the profile.
    return RETRY;
  });
  if (rolled === RETRY) {
    throw new Error('Could not start the run');
  }
  return rolled;
}

/**
 * Load a player for scoring or serving: ensure the run, then settle the two things that depend only on
 * the clock and are stored (the Founder's Board's Charm moves on Wednesday and Friday, unplayed Pledges
 * auto-play after Tuesday). Both are idempotent, so this is safe on every load. Returns null for a player
 * with no profile.
 */
export async function loadCurrent(ctx: RunContext, userId: number): Promise<Current | null> {
  const current = await withVersionRetry<Current | null>(async () => {
    const rolled = await ensureRun(ctx, userId);
    if (!rolled) {
      return null;
    }
    const { profile, week } = rolled;
    const run = runWithScorerState(week.run, profile);
    const base = playerWithRun(toPlayerState(profile), run);
    const board = applyFounderBoard(base, run.weekKey, ctx.now, run.shopSeed);
    const auto = autoPlayPledges(run, board.player, ctx.now);
    const boardChanged = board.player !== base;
    const playedChanged = auto.run !== run;
    if (!boardChanged && !playedChanged) {
      return { profile, week, player: base, run };
    }

    if (
      boardChanged &&
      !(await versionedWrite(() =>
        ctx.db.saveProfile(userId, profile.version, {
          charms: board.player.charms,
          mogulBenched: board.player.moguls.benched,
          mogulBoardWeek: board.player.moguls.boardWeek,
        }),
      ))
    ) {
      return RETRY;
    }
    if (
      playedChanged &&
      !(await ctx.db.saveWeek(
        userId,
        run.weekKey,
        { version: week.version },
        { played: auto.run.played },
      ))
    ) {
      return RETRY;
    }
    // Go round again to read the settled state back.
    return RETRY;
  });
  if (current === RETRY) {
    throw new Error('The run kept changing');
  }
  return current;
}
