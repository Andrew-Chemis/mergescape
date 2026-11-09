/**
 * Seeded randomness for the run layer: the shop, Pledge draws, Mogul bag and Founder's Board all derive
 * from the week's seed, so a reload or a retry never changes what the player was shown.
 */

/** mulberry32: a small, fast 32-bit generator. Returns floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A salt for `deriveSeed`: a number, or a short label that is hashed. */
export type SeedPart = number | string;

function hashString(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(index), 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Mix a seed with salts into a new unsigned 32-bit seed. Different salts give unrelated streams, so the
 * shop visit, the pack slot and the re-roll count can each own a generator derived from one week seed.
 */
export function deriveSeed(seed: number, ...parts: SeedPart[]): number {
  let hash = seed >>> 0;
  for (const part of parts) {
    const salt = typeof part === 'string' ? hashString(part) : part >>> 0;
    hash = Math.imul(hash ^ salt, 0x9e3779b1);
    hash ^= hash >>> 15;
    hash = Math.imul(hash, 0x85ebca6b);
    hash ^= hash >>> 13;
  }
  return hash >>> 0;
}

/** A shuffled copy (Fisher-Yates) of `items`. */
export function shuffle<T>(items: readonly T[], random: () => number): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    const held = result[index] as T;
    result[index] = result[other] as T;
    result[other] = held;
  }
  return result;
}

/** One entry drawn by weight (at least one entry; the weights need not sum to anything in particular). */
export function weightedPick<T>(
  entries: readonly { value: T; weight: number }[],
  random: () => number,
): T {
  const total = entries.reduce((sum, entry) => sum + entry.weight, 0);
  let threshold = random() * total;
  let chosen = entries[0] as { value: T; weight: number };
  for (const entry of entries) {
    chosen = entry;
    threshold -= entry.weight;
    if (threshold < 0) {
      break;
    }
  }
  return chosen.value;
}
