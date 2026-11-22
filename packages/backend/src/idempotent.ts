/**
 * The write protocol of every player mutation that carries a client request id: the shop, shrine and Pledge
 * actions (`mutations.ts`) and the depth layers (`depth.ts`). Each takes a request id and either applies once
 * or answers the same way again. A mutation changes the player's profile (gold, Charms, the satchel and the
 * rest) and sometimes their `WEEK#` item (the shelves, the hand and offers). Without transactions the order
 * is what keeps it honest, and what makes a request id mean "applied":
 *
 *   A request id counts as applied only when its EFFECT has been committed: the profile write that carries it
 *   also records the id on the profile (`applied_requests`, the last few), in the same version-guarded
 *   write. The week's list of request ids (the last 20, `request_ids`) is the long memory; the profile's
 *   marker is the proof, and it is what the week is reconciled with.
 *
 *   1. a request that changes the week takes the week lock first: one write, conditional on the week's
 *      `version`, that applies the change and records the request under `pending` with the fields it changed,
 *      before and after. Of two requests that raced for the same shelf slot exactly one passes, the other
 *      re-reads and gets the refusal it deserves. A request that changes nothing on the week takes no lock;
 *   2. the profile write comes next, conditional on the profile `version` (a scored event may have landed
 *      in between), and it carries the commit marker. If it conflicts, the fresh profile is read: with the
 *      marker already on it the request was applied by someone else (a replay racing the original) and
 *      answers as a replay; without it the request is planned again on the fresh profile. If that fails now
 *      (the gold went elsewhere) the lock is undone and the request answers with the refusal, or `conflict`
 *      when the profile never stopped moving;
 *   3. the lock is promoted: the id joins `request_ids` and leaves `pending`. This is bookkeeping, the
 *      commit already happened, so a failure is logged and the next load of the week finishes it (it finds the
 *      marker on the profile);
 *   4. the caller's `afterProfile` step writes the durable records that follow the profile (the
 *      `EXPEDITION#` / `JOB#` item of a trip or order that was started or collected, a `FEAT#` item per Feat
 *      unlocked). The profile already holds all of it, so a failure there is logged, not repeated.
 *
 * What happens when it goes wrong:
 *
 *   - the undo of a refused or failed request is field by field, not a restore of the whole week: it takes
 *     back only the leaves the request changed (`undoChange`), whatever else has written to the week since
 *     (another request's lock, an Act clear, the auto-play), and it retries when the week moves under it.
 *     It never masks the outcome: if the undo itself fails (throttling) the request still answers what it
 *     was going to, and the lock it could not remove is taken back by the next load after `PENDING_TTL_MS`;
 *   - a request that dies after its lock and before its profile write (the Lambda is killed) leaves a lock
 *     and no marker. Its id is NOT applied: a replay finds the lock and no marker, plans the request again on
 *     the week as it was before the lock, and carries on from the profile write; and a lock nobody replays is
 *     taken back by the next load once it is older than any request can live;
 *   - a request that dies after its profile write has the marker, so a replay answers as applied.
 *
 * The profile is the authority for what the player has, so a crash between steps leaves a state that a retry
 * completes. Every rule is a shared pure function; the callers only choose which one (`plan`), and this
 * module orders the writes.
 */
import { playerWithRun } from '@mergescape/shared';
import type { PlayerState } from '@mergescape/shared';
import type { Db, ProfilePatch, WeekFields, WeekItem, WeekPatch } from './db';
import type { Logger } from './log';
import { RETRY, versionedWrite, withVersionRetry } from './optimistic';
import { runWithScorerState, toPlayerState } from './player';
import {
  applyFields,
  MAX_APPLIED_REQUESTS,
  recordPatch,
  sameStored,
  unlockPatch,
} from './requests';
import { currentOf, loadCurrent } from './runs';
import type { Current, RunContext } from './runs';

export { MAX_REQUEST_IDS } from './requests';

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

/** The week fields a plan changes, and the values they had before (what an undo puts back). */
export interface WeekChange {
  patch: WeekFields;
  undo: WeekFields;
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

/** Tries of a read-modify-write of the week's bookkeeping before it is left to the next load. */
const WEEK_REWRITE_ATTEMPTS = 4;

const isEmpty = (patch: object): boolean => Object.keys(patch).length === 0;

/** What the profile write settled on: the plan it wrote, or that the request turned out to be applied already. */
type Written<P extends object> =
  { final: Applied<P>; wrote: true } | { final: Applied<P>; wrote: false; replay: true };

/** The request was applied before (its id is in the week's list, or the profile carries its marker). */
const isApplied = ({ week, profile }: Current, requestId: string): boolean =>
  week.requestIds.includes(requestId) || profile.appliedRequests.includes(requestId);

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
    const loaded = await loadCurrent(ctx, userId);
    if (!loaded) {
      return NO_PROFILE;
    }
    if (isApplied(loaded, requestId)) {
      return { status: 200, current: loaded, planned: null, wrote: false };
    }
    // A lock under this id and no marker: a request that died after its lock (or one that is still running).
    // It is planned again as it was planned, on the week as it was before the lock; its change is on the week.
    const lock = loaded.week.pending[requestId];
    const current = lock
      ? currentOf(loaded.profile, applyFields(loaded.week, lock.before))
      : loaded;
    const unlock = (): Promise<void> => undoLock(ctx, userId, current.run.weekKey, requestId, spec);

    const planned = spec.plan(current.player, current);
    if (!planned.ok) {
      if (lock) {
        await unlock();
      }
      return { status: planned.status, error: planned.error };
    }
    const week = spec.weekChange?.(current, planned) ?? NO_WEEK_CHANGE;
    if (lock && !sameStored(week.patch, lock.after)) {
      // Not the request that took the lock any more (the profile moved on): let go of it and start again.
      await unlock();
      return RETRY;
    }
    if (
      !lock &&
      isEmpty(week.patch) &&
      isEmpty(spec.profilePatch(current.player, planned.player))
    ) {
      // Nothing to change (a repeat collect, unpinning what is not pinned): answer without a write.
      return { status: 200, current: loaded, planned, wrote: false };
    }
    return applyUnderLock(ctx, userId, requestId, spec, current, planned, week, lock !== undefined);
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
  held: boolean,
): Promise<MutationOutcome<P> | typeof RETRY> {
  const { weekKey } = current.run;
  const changesWeek = !isEmpty(week.patch);

  // Step 1: the week lock, which applies the change and records who made it.
  if (changesWeek && !held) {
    const locked = await ctx.db.saveWeek(
      userId,
      weekKey,
      { version: current.week.version },
      {
        ...week.patch,
        pending: {
          ...current.week.pending,
          [requestId]: { at: ctx.now, before: week.undo, after: week.patch },
        },
      },
    );
    if (!locked) {
      return RETRY;
    }
  }
  const holdsLock = changesWeek || held;

  // Step 2: the profile write with the commit marker. A failure of it puts the week back.
  let written: Written<P> | Refusal;
  try {
    written = await writeProfile(ctx, userId, requestId, spec, current, planned);
  } catch (error) {
    if (holdsLock) {
      await undoLock(ctx, userId, weekKey, requestId, spec);
    }
    throw error;
  }
  if (!('final' in written)) {
    if (holdsLock) {
      await undoLock(ctx, userId, weekKey, requestId, spec);
    }
    return written;
  }

  // Step 3: the id is applied for good. The commit has happened, so this is bookkeeping.
  await recordApplied(ctx, userId, weekKey, requestId, spec);

  // Step 4: the records. The profile already holds all of it, so a failure here is logged, not repeated.
  const { final } = written;
  if (written.wrote && spec.afterProfile) {
    try {
      await spec.afterProfile(final);
    } catch (error) {
      ctx.log.error(`${spec.name}.records_failed`, { userId }, error);
    }
  }

  const settled = await loadCurrent(ctx, userId);
  if (!settled) {
    return NO_PROFILE;
  }
  return written.wrote
    ? { status: 200, current: settled, planned: final, wrote: true }
    : { status: 200, current: settled, planned: null, wrote: false };
}

/**
 * Step 2: write the profile under its version, with the request's commit marker, planning again on the fresh
 * profile whenever a scored event landed in between. The plan that finally went through comes back, or the
 * refusal the fresh profile earned, or the news that the fresh profile carries the marker already.
 */
async function writeProfile<P extends object>(
  ctx: MutationContext,
  userId: number,
  requestId: string,
  spec: MutationSpec<P>,
  current: Current,
  planned: Applied<P>,
): Promise<Written<P> | Refusal> {
  let expected = current.profile.version;
  let applied = current.profile.appliedRequests;
  let from = current.player;
  let final = planned;
  const written = await withVersionRetry<Written<P> | Refusal>(async () => {
    const patch: ProfilePatch = {
      ...spec.profilePatch(from, final.player),
      appliedRequests: [...applied, requestId].slice(-MAX_APPLIED_REQUESTS),
    };
    if (await versionedWrite(() => ctx.db.saveProfile(userId, expected, patch))) {
      return { final, wrote: true };
    }
    const fresh = await ctx.db.getProfile(userId, true);
    if (!fresh) {
      return NO_PROFILE;
    }
    if (fresh.appliedRequests.includes(requestId)) {
      return { final, wrote: false, replay: true };
    }
    const player = playerWithRun(toPlayerState(fresh), runWithScorerState(current.run, fresh));
    const again = spec.plan(player, current);
    if (!again.ok) {
      return { status: again.status, error: again.error };
    }
    expected = fresh.version;
    applied = fresh.appliedRequests;
    from = player;
    final = again;
    return RETRY;
  });
  return written === RETRY ? CONFLICT : written;
}

/**
 * Read-modify-write of the week's bookkeeping, a few tries because the week moves (other requests, the
 * auto-play). `patchFor` returns null when there is nothing (left) to write. Returns false when the tries ran
 * out; throws only what the table throws.
 */
async function rewriteWeek(
  db: Db,
  userId: number,
  weekKey: string,
  patchFor: (week: WeekItem) => WeekPatch | null,
): Promise<boolean> {
  for (let tried = 0; tried < WEEK_REWRITE_ATTEMPTS; tried += 1) {
    const week = await db.getWeekItem(userId, weekKey);
    const patch = week ? patchFor(week) : null;
    if (!week || patch === null) {
      return true;
    }
    if (await db.saveWeek(userId, weekKey, { version: week.version }, patch)) {
      return true;
    }
  }
  return false;
}

/**
 * Take a request's change back from the week, field by field, and release its lock. Never throws and never
 * changes the outcome of the request: if it cannot (the table is throttling), the lock stays and the next
 * load of the week takes it back once it is old enough.
 */
async function undoLock<P extends object>(
  ctx: MutationContext,
  userId: number,
  weekKey: string,
  requestId: string,
  spec: MutationSpec<P>,
): Promise<void> {
  try {
    const done = await rewriteWeek(ctx.db, userId, weekKey, (week) => unlockPatch(week, requestId));
    if (!done) {
      ctx.log.error(`${spec.name}.undo_failed`, { userId });
    }
  } catch (error) {
    ctx.log.error(`${spec.name}.undo_failed`, { userId }, error);
  }
}

/** Record the request id as applied on the week and release its lock. Best effort: the profile has the marker. */
async function recordApplied<P extends object>(
  ctx: MutationContext,
  userId: number,
  weekKey: string,
  requestId: string,
  spec: MutationSpec<P>,
): Promise<void> {
  try {
    const done = await rewriteWeek(ctx.db, userId, weekKey, (week) => recordPatch(week, requestId));
    if (!done) {
      ctx.log.error(`${spec.name}.record_failed`, { userId });
    }
  } catch (error) {
    ctx.log.error(`${spec.name}.record_failed`, { userId }, error);
  }
}
