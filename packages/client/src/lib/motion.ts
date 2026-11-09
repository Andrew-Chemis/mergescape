/** Motion preference (Requirement 10.5). Read when an animation starts, so a changed OS setting applies next time. */
export function prefersReducedMotion(win: Window | undefined = globalThis.window): boolean {
  try {
    return win?.matchMedia('(prefers-reduced-motion: reduce)').matches ?? false;
  } catch {
    return false;
  }
}

/** The score ticker rolls Points, Power, Zone and XP in over about this long (game-design.md section 9). */
export const TICKER_TOTAL_MS = 1200;

/** How long the level-up message stays on screen. */
export const LEVEL_UP_MS = 2400;
