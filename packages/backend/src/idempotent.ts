/**
 * The write protocol of every player mutation that carries a client request id: the shop, shrine and Pledge
 * actions (`mutations.ts`) and the depth layers (`depth.ts`). Each takes a request id and either applies once
 * or answers the same way again. A mutation changes the player's `WEEK#` item (request ids, and for the shop
 * the shelves, hand and offers) and their profile (gold, Charms, the satchel and the rest). Without
 * transactions the order is what keeps it honest:
 *
 *   1. the week write comes first and is conditional on the week's `version`. It is the lock: of two requests
 *      that raced for the same shelf slot or the same trip exactly one passes, the other re-reads and gets the
 *      refusal it deserves. It also records the request id, which is what makes a replay a no-op;
 *   2. the caller's `beforeProfile` step follows (the depth layers claim a collected trip or order here, with
 *      one conditional write, so the loot is rolled and stored once);
 *   3. the profile write comes next, conditional on the profile `version` (a scored event may have landed in
 *      between). If it conflicts, the request is planned again on the fresh profile. If that fails now (the
 *      gold went elsewhere, another request collected the same trip) step 1 is undone and the request
 *      answers with the refusal, or `conflict` when the profile never stopped moving. A request the profile
 *      already holds the result of answers without writing again;
 *   4. the caller's `afterProfile` step writes the durable records that follow the profile (the `EXPEDITION#`
 *      / `JOB#` item of a trip or order that was started, a `FEAT#` item per Feat unlocked). The profile
 *      already holds all of it, so a failure there is logged, not repeated.
 *
 * The profile is the authority for what the player has, so a crash between steps leaves a state that a retry
 * completes. Every rule is a shared pure function; the callers only choose which one (`plan`), and this
 * module orders the writes.
 */
import { playerWithRun } from '@mergescape/shared';
import type { PlayerState } from '@mergescape/shared';
import type { ProfilePatch, WeekPatch } from './db';
import type { Logger } from './log';
import { RETRY, versionedWrite, withVersionRetry } from './optimistic';
import { runWithScorerState, toPlayerState } from './player';
import { loadCurrent } from './runs';
import type { Current, RunContext } from './runs';

/** Request ids kept per week for replays (docs/api-contract.md). */
export const MAX_REQUEST_IDS = 20;

export interface MutationContext extends RunContext {
  log: Logger;
}

/** A request that cannot be applied: 404 when something it needs is missing, 409 for a rule or a lost race. */
export interface Refusal {
  status: 404 | 409;
  error: string;
}

/** A request applied to a player: the player afterwards, and whatever else the caller carries (`P`). */
export type Applied<P extends object> = { ok: true; player: PlayerState } & P;

export type Plan<P extends object> = Applied<P> | ({ ok: false } & Refusal);

/** The week fields a plan changes besides the request ids, and the patch that puts them back. */
export interface WeekChange {
  patch: WeekPatch;
  undo: WeekPatch;
}

export interface MutationSpec<P extends object> {
  /** Names the log events (`<name>.undo_failed`, `<name>.records_failed`). */
  name: string;
  /** Apply the request to `player` with the shared rules. Pure; `current` is the state it was loaded from. */
  plan(player: PlayerState, current: Current): Plan<P>;
  /** The profile fields that differ between two states of the player. */
  profilePatch(before: PlayerState, after: PlayerState): ProfilePatch;
  /** Week fields the first plan changes; they are written with the lock and put back by the undo. */
  weekChange?(current: Current, planned: Applied<P>): WeekChange;
  /** After the lock and before the profile write: claim what the request collects. */
  beforeProfile?(planned: Applied<P>): Promise<void>;
  /** After a profile write, with the plan that was written: the durable records. */
  afterProfile?(planned: Applied<P>): Promise<void>;
}

export type MutationOutcome<P extends object> =
  | {
      status: 200;
      /** The player after the writes, or as loaded when nothing had to be written. */
      current: Current;
      /** The plan that was applied; null when `requestId` had already been applied (a replay). */
      planned: Applied<P> | null;
      /** True when this request wrote to the profile. */
      wrote: boolean;
    }
  | Refusal;

const NO_PROFILE: Refusal = { status: 404, error: 'no_profile' };
const CONFLICT: Refusal = { status: 409, error: 'conflict' };
const NO_WEEK_CHANGE: WeekChange = { patch: {}, undo: {} };

const isEmpty = (patch: object): boolean => Object.keys(patch).length === 0;

/** What the profile write settled on: the plan it wrote (or found already written) and whether it wrote. */
interface Written<P extends object> {
  final: Applied<P>;
  wrote: boolean;
}

/**
 * Run one mutation for a player. On 200 the caller builds the response from `current`, read back after the
 * writes (and the replayed state when `requestId` was already applied).
 */
export async function runIdempotentMutation<P extends object>(
  ctx: MutationContext,
  userId: number,
  requestId: string,
  spec: MutationSpec<P>,
): Promise<MutationOutcome<P>> {
  const outcome = await withVersionRetry<MutationOutcome<P>>(async () => {
    const current = await loadCurrent(ctx, userId);
    if (!current) {
      return NO_PROFILE;
    }
    if (current.week.requestIds.includes(requestId)) {
      return { status: 200, current, planned: null, wrote: false };
    }
    const planned = spec.plan(current.player, current);
    if (!planned.ok) {
      return { status: planned.status, error: planned.error };
    }
    const week = spec.weekChange?.(current, planned) ?? NO_WEEK_CHANGE;
    if (isEmpty(week.patch) && isEmpty(spec.profilePatch(current.player, planned.player))) {
      // Nothing to change (a repeat collect, unpinning what is not pinned): answer without a write.
      return { status: 200, current, planned, wrote: false };
    }
    return applyUnderLock(ctx, userId, requestId, spec, current, planned, week);
  });
  return outcome === RETRY ? CONFLICT : outcome;
}

/** Steps 1 to 4 for one plan; `RETRY` when the week lock was lost to another request. */
async function applyUnderLock<P extends object>(
  ctx: MutationContext,
  userId: number,
  requestId: string,
  spec: MutationSpec<P>,
  current: Current,
  planned: Applied<P>,
  week: WeekChange,
): Promise<MutationOutcome<P> | typeof RETRY> {
  const { weekKey } = current.run;
  const previousIds = current.week.requestIds;
  const requestIds = [...previousIds, requestId].slice(-MAX_REQUEST_IDS);

  // Step 1: the week write, which is the lock and the replay record.
  const locked = await ctx.db.saveWeek(
    userId,
    weekKey,
    { version: current.week.version },
    { ...week.patch, requestIds },
  );
  if (!locked) {
    return RETRY;
  }
  const undo = async (): Promise<void> => {
    // Put the week back as it was (it is still the version our write made it).
    const restored = await ctx.db.saveWeek(
      userId,
      weekKey,
      { version: current.week.version + 1 },
      { ...week.undo, requestIds: previousIds },
    );
    if (!restored) {
      ctx.log.error(`${spec.name}.undo_failed`, { userId });
    }
  };

  // Steps 2 and 3. A failure of either puts the week back.
  let written: Written<P> | Refusal;
  try {
    await spec.beforeProfile?.(planned);
    written = await writeProfile(ctx, userId, spec, current, planned);
  } catch (error) {
    await undo();
    throw error;
  }
  if (!('final' in written)) {
    await undo();
    return written;
  }

  // Step 4: the records. The profile already holds all of it, so a failure here is logged, not repeated.
  const { final, wrote } = written;
  if (wrote && spec.afterProfile) {
    try {
      await spec.afterProfile(final);
    } catch (error) {
      ctx.log.error(`${spec.name}.records_failed`, { userId }, error);
    }
  }

  const settled = await loadCurrent(ctx, userId);
  return settled ? { status: 200, current: settled, planned: final, wrote } : NO_PROFILE;
}

/**
 * Step 3: write the profile under its version, planning again on the fresh profile whenever a scored event
 * landed in between. The plan that finally went through comes back with whether anything was written (the
 * fresh profile may already hold the result), or the refusal the fresh profile earned.
 */
async function writeProfile<P extends object>(
  ctx: MutationContext,
  userId: number,
  spec: MutationSpec<P>,
  current: Current,
  planned: Applied<P>,
): Promise<Written<P> | Refusal> {
  let expected = current.profile.version;
  let from = current.player;
  let final = planned;
  const written = await withVersionRetry<Written<P> | Refusal>(async () => {
    const patch = spec.profilePatch(from, final.player);
    if (isEmpty(patch)) {
      return { final, wrote: false };
    }
    if (await versionedWrite(() => ctx.db.saveProfile(userId, expected, patch))) {
      return { final, wrote: true };
    }
    const fresh = await ctx.db.getProfile(userId, true);
    if (!fresh) {
      return NO_PROFILE;
    }
    const player = playerWithRun(toPlayerState(fresh), runWithScorerState(current.run, fresh));
    const again = spec.plan(player, current);
    if (!again.ok) {
      return { status: again.status, error: again.error };
    }
    expected = fresh.version;
    from = player;
    final = again;
    return RETRY;
  });
  return written === RETRY ? CONFLICT : written;
}
