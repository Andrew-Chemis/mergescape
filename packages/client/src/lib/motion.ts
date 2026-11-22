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

/**
 * How long the level-up message stays on screen: game-design.md section 3 makes every Sensation moment a
 * one to two second affair, and it can be dismissed sooner (a click on it, or Escape).
 */
export const LEVEL_UP_MS = 2000;

/** How long the hero's sprite blinks when a level-up swaps its gear tier. */
export const TIER_SWAP_MS = 900;
