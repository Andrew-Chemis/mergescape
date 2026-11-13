/**
 * The bookkeeping of the week lock behind every player mutation (`idempotent.ts` says why it exists): pure
 * functions over a `WEEK#` item, so the rules for "this lock is finished", "this lock was abandoned" and
 * "take this change back" can be tested without a table.
 *
 * A request that changes the week holds a lock on it, `pending[requestId]`, from the week write until the
 * profile write that completes it. The lock records the fields it changed, before and after, so that it can be
 * taken back field by field whatever else has written to the week since.
 */
import { isDeepStrictEqual } from 'node:util';
import type { PendingLock, WeekFields, WeekItem, WeekPatch } from './db';

/** Request ids kept per week for replays (docs/api-contract.md). */
export const MAX_REQUEST_IDS = 20;

/** Commit markers kept on the profile: the request ids of its last few mutations. */
export const MAX_APPLIED_REQUESTS = 10;

/**
 * How long a lock is honoured before it counts as abandoned. The api Lambda is killed at 10 s, so a lock older
 * than 30 s does not belong to a request that is still running: whoever finds it next takes its change back.
 */
export const PENDING_TTL_MS = 30_000;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** A copy in JSON terms, the form a value has once it is stored (no `undefined` members). */
export const stored = <T>(value: T): T => JSON.parse(JSON.stringify(value ?? null)) as T;

/** True when two values are the same once stored. */
export const sameStored = (a: unknown, b: unknown): boolean =>
  isDeepStrictEqual(stored(a), stored(b));

/** The value of one game field of a week; a field the week does not have reads as `null`. */
function fieldOf(week: WeekItem, name: keyof WeekFields): unknown {
  switch (name) {
    case 'act':
      return week.run.act;
    case 'clearedActs':
      return week.run.clearedActs;
    case 'played':
      return week.run.played;
    case 'shop':
      return week.run.shop;
    case 'freePack':
      return week.freePack;
    case 'legendary':
      return week.legendary;
  }
}

/** The week with `fields` written to it (`null` removes a field), as a save of the same patch would leave it. */
export function applyFields(week: WeekItem, fields: WeekFields): WeekItem {
  const run = { ...week.run };
  const next: WeekItem = { ...week, run };
  const has = (name: keyof WeekFields): boolean => Object.hasOwn(fields, name);
  if (has('act')) {
    run.act = fields.act ?? null;
  }
  if (has('clearedActs')) {
    run.clearedActs = [...(fields.clearedActs ?? [])];
  }
  if (has('played')) {
    run.played = [...(fields.played ?? [])];
  }
  if (has('shop')) {
    run.shop = fields.shop ?? null;
  }
  if (has('freePack')) {
    next.freePack = fields.freePack ?? null;
  }
  if (has('legendary')) {
    next.legendary = fields.legendary ?? null;
  }
  return next;
}

/**
 * `current` with the change that turned `before` into `after` taken back, leaf by leaf. A leaf the change did
 * not touch keeps what it holds now, so does one that has been changed again since (what is there is somebody
 * else's), and a change that is a whole value (a re-rolled shop) is taken back only if nothing has touched
 * it. Items a change appended to a list (a played Pledge) are taken out of the list wherever they now are.
 */
export function undoChange(before: unknown, after: unknown, current: unknown): unknown {
  if (isDeepStrictEqual(before, after)) {
    return current;
  }
  if (isDeepStrictEqual(current, after)) {
    return before;
  }
  if (isObject(before) && isObject(after) && isObject(current)) {
    const next: Record<string, unknown> = { ...current };
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      const value = undoChange(before[key], after[key], current[key]);
      if (value === undefined) {
        delete next[key];
      } else {
        next[key] = value;
      }
    }
    return next;
  }
  if (Array.isArray(before) && Array.isArray(after) && Array.isArray(current)) {
    if (before.length === after.length && after.length === current.length) {
      return after.map((_, index) => undoChange(before[index], after[index], current[index]));
    }
    if (after.length > before.length && isDeepStrictEqual(after.slice(0, before.length), before)) {
      const rest = [...current];
      for (const added of after.slice(before.length)) {
        const at = rest.findLastIndex((item) => isDeepStrictEqual(item, added));
        if (at >= 0) {
          rest.splice(at, 1);
        }
      }
      return rest;
    }
  }
  return current;
}

const FIELD_NAMES = ['act', 'clearedActs', 'played', 'shop', 'freePack', 'legendary'] as const;

/** The patch that takes a lock's change back from `week`: only the fields that would differ afterwards. */
export function undoPatch(week: WeekItem, lock: PendingLock): WeekFields {
  const patch: WeekFields = {};
  for (const name of FIELD_NAMES) {
    if (!Object.hasOwn(lock.before, name) && !Object.hasOwn(lock.after, name)) {
      continue;
    }
    const now = stored(fieldOf(week, name));
    const back = stored(undoChange(lock.before[name] ?? null, lock.after[name] ?? null, now));
    if (!isDeepStrictEqual(back, now)) {
      Object.assign(patch, { [name]: back });
    }
  }
  return patch;
}

/** What to do with one lock: it is finished, it is to be taken back, or it stays. */
export type LockFate = 'promote' | 'undo' | 'keep';

/**
 * The patch that settles the locks of a week as `decide` says, or null when nothing changes. A promoted
 * request id joins the applied ids (the last `MAX_REQUEST_IDS`), an undone lock takes its change back
 * (`undoPatch`), and both leave the lock map.
 */
export function settleLocks(
  week: WeekItem,
  decide: (id: string, lock: PendingLock) => LockFate,
): WeekPatch | null {
  const pending = { ...week.pending };
  const requestIds = [...week.requestIds];
  let fields: WeekFields = {};
  let current = week;
  let changed = false;
  // Newest lock first, so changes that overlap are taken back in the reverse of the order they were made.
  const ids = Object.keys(pending).sort((a, b) => (pending[b]?.at ?? 0) - (pending[a]?.at ?? 0));
  for (const id of ids) {
    const lock = pending[id];
    const fate = lock === undefined ? 'keep' : decide(id, lock);
    if (lock === undefined || fate === 'keep') {
      continue;
    }
    if (fate === 'promote') {
      if (!requestIds.includes(id)) {
        requestIds.push(id);
      }
    } else {
      const back = undoPatch(current, lock);
      fields = { ...fields, ...back };
      current = applyFields(current, back);
    }
    delete pending[id];
    changed = true;
  }
  return changed ? { ...fields, requestIds: requestIds.slice(-MAX_REQUEST_IDS), pending } : null;
}

/**
 * The patch that records `requestId` as applied: it joins the applied ids and leaves the lock map. Null when
 * the week already says so.
 */
export function recordPatch(week: WeekItem, requestId: string): WeekPatch | null {
  const recorded = week.requestIds.includes(requestId);
  if (recorded && week.pending[requestId] === undefined) {
    return null;
  }
  const pending = { ...week.pending };
  delete pending[requestId];
  return {
    requestIds: (recorded ? week.requestIds : [...week.requestIds, requestId]).slice(
      -MAX_REQUEST_IDS,
    ),
    pending,
  };
}

/** The patch that takes back the lock of `requestId`, or null when it holds none. */
export function unlockPatch(week: WeekItem, requestId: string): WeekPatch | null {
  return settleLocks(week, (id) => (id === requestId ? 'undo' : 'keep'));
}
