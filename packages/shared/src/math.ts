/** Round away float noise from sums of 0.05-style increments. */
export function tidy(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

/** `value` held within `min..max` (inclusive). */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** `value` held within 0..1, for progress fractions and ratios. */
export function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

/** The sum of `pick` over `items` (0 for an empty list). */
export function sumBy<T>(items: readonly T[], pick: (item: T) => number): number {
  return items.reduce((sum, item) => sum + pick(item), 0);
}

/** True for a plain object: not null, not an array. The guard for JSON read from storage or the wire. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
