/**
 * The Mogul reveal (game-design.md section 9, moment 5): the first time a new week is viewed, the Mogul
 * rises behind the Boss node with its one-liner. The week it last played for is remembered in
 * localStorage so a reload does not replay it. Every storage access is guarded: private windows and
 * blocked site data throw, and then the reveal simply plays each time.
 */

export const REVEAL_KEY = 'mergescape.mogulSeen';

function storage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

/** The week key the reveal last played for, or null. */
export function seenWeek(store: Pick<Storage, 'getItem'> | undefined = storage()): string | null {
  try {
    return store?.getItem(REVEAL_KEY) ?? null;
  } catch {
    return null;
  }
}

/** True when this week has not been revealed yet on this device. */
export function isNewWeek(
  weekKey: string,
  store: Pick<Storage, 'getItem'> | undefined = storage(),
): boolean {
  return seenWeek(store) !== weekKey;
}

/** Remember that the reveal played for this week. Returns false when storage refused. */
export function markWeekSeen(
  weekKey: string,
  store: Pick<Storage, 'setItem'> | undefined = storage(),
): boolean {
  try {
    store?.setItem(REVEAL_KEY, weekKey);
    return store !== undefined;
  } catch {
    return false;
  }
}
