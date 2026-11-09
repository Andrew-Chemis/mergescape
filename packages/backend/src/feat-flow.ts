/**
 * Feats in the database (tasks.md 22, Requirement 17): what happens after the shared evaluation says a Feat
 * unlocked. The rules are in `@mergescape/shared` (`evaluateFeats`, `recordWorldEvent`,
 * `applyFeatEvaluation`); this module only settles rewards that can unlock another Feat, writes the
 * `FEAT#` record of each unlock, and applies a world event (a Boss clear) to a stored profile.
 *
 * The profile is the lock. An unlock is decided against the profile as read and written with that read's
 * `version`, so of two events that race for the same Feat exactly one writes it: the other re-reads,
 * finds it unlocked, and unlocks nothing. The `FEAT#` item is written after the profile write, with
 * `attribute_not_exists`, as the audit record of which event unlocked it; a repeat writes nothing.
 */
import { applyFeatEvaluation, recordWorldEvent } from '@mergescape/shared';
import type { FeatEvaluation, FeatUnlock, PlayerState, WorldEvent } from '@mergescape/shared';
import { VersionConflictError } from './db';
import type { Db } from './db';
import { depthPatch, toPlayerState } from './player';

/** Retries of one optimistic read-modify-write before giving up. */
const MAX_ATTEMPTS = 6;

/**
 * Apply a Feat evaluation to the player, and settle what its rewards set off. A pet that a Feat awards can
 * complete the Collector, so when one was handed out the Feats are checked once more with a `refresh`.
 * Returns the player and every Feat that unlocked, in order.
 */
export function applyFeats(
  player: PlayerState,
  evaluation: FeatEvaluation,
  now: number,
): { player: PlayerState; unlocked: FeatUnlock[] } {
  let next = applyFeatEvaluation(player, evaluation);
  const unlocked = [...evaluation.unlocked];
  if (evaluation.unlocked.some((feat) => feat.reward.pet !== null)) {
    const again = recordWorldEvent(next, { kind: 'refresh' }, now);
    next = applyFeatEvaluation(next, again);
    unlocked.push(...again.unlocked);
  }
  return { player: next, unlocked };
}

/**
 * Record each unlock as a `FEAT#` item naming the event that caused it. A Feat already recorded is left
 * as it is. Call it only after the profile write that unlocked them has succeeded.
 */
export async function writeFeats(
  db: Db,
  userId: number,
  unlocked: readonly FeatUnlock[],
  nowMs: number,
  source: string,
): Promise<void> {
  for (const feat of unlocked) {
    await db.putFeat(userId, feat.id, nowMs, source);
  }
}

/**
 * Apply a world event (a Boss clear) to a stored profile: update the counters it feeds, unlock the Feats
 * it reaches, and write all of it under the profile's version, re-reading when another writer got there
 * first. The event is read against the profile AFTER the change it reports (the Renown already raised).
 * Returns the Feats that unlocked, after their `FEAT#` records are written.
 */
export async function settleWorld(
  db: Db,
  userId: number,
  world: WorldEvent,
  nowMs: number,
  source: string,
): Promise<FeatUnlock[]> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const profile = await db.getProfile(userId, true);
    if (!profile) {
      return [];
    }
    const player = toPlayerState(profile);
    const settled = applyFeats(player, recordWorldEvent(player, world, nowMs), nowMs);
    const patch = depthPatch(player, settled.player);
    if (Object.keys(patch).length === 0) {
      return [];
    }
    try {
      await db.saveProfile(userId, profile.version, patch);
    } catch (error) {
      if (error instanceof VersionConflictError) {
        continue;
      }
      throw error;
    }
    await writeFeats(db, userId, settled.unlocked, nowMs, source);
    return settled.unlocked;
  }
  throw new VersionConflictError();
}
