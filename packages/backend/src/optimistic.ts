/**
 * Optimistic concurrency as the repository offers it. A read-modify-write holds the `version` (or the
 * existence) of what it read and writes conditionally on it; when another writer got in between, the write
 * is refused and the whole step starts again from a fresh read. `withVersionRetry` is that loop and
 * `versionedWrite` turns the profile's refusal into a value, so a step reads as "write, or go round again".
 */
import { VersionConflictError } from './db';

/** Tries of one optimistic read-modify-write before giving up (each retry means another writer got in between). */
export const MAX_ATTEMPTS = 6;

/** What an attempt returns when it lost a race and should be run again from a fresh read. */
export const RETRY = Symbol('retry');

/**
 * Run `attempt` until it returns something other than `RETRY`, at most `attempts` times. Returns `RETRY` when
 * every try lost its race, so the caller chooses between throwing and a typed answer.
 */
export async function withVersionRetry<T>(
  attempt: () => Promise<T | typeof RETRY>,
  attempts: number = MAX_ATTEMPTS,
): Promise<T | typeof RETRY> {
  for (let tried = 0; tried < attempts; tried += 1) {
    const outcome = await attempt();
    if (outcome !== RETRY) {
      return outcome;
    }
  }
  return RETRY;
}

/** Run a write guarded by the profile `version`: true when it applied, false when another writer got there first. */
export async function versionedWrite(write: () => Promise<unknown>): Promise<boolean> {
  try {
    await write();
    return true;
  } catch (error) {
    if (error instanceof VersionConflictError) {
      return false;
    }
    throw error;
  }
}
