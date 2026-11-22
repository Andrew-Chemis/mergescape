import type { LogEntry } from './types';

/** The rows of `incoming` whose ids are not in `existing`, in their original order. */
export function unseenEntries(
  existing: readonly LogEntry[],
  incoming: readonly LogEntry[],
): LogEntry[] {
  const known = new Set(existing.map((entry) => entry.id));
  return incoming.filter((entry) => !known.has(entry.id));
}
