/** Round away float noise from sums of 0.05-style increments. */
export function tidy(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}
