import { deriveSeed, mulberry32, pledgeCard, PLEDGES, shuffle, SHOP } from '@mergescape/shared';
import type { Pledge, RunState } from '@mergescape/shared';

/**
 * The 3 Pledges of the free pack the Raid clear grants (design.md 6.1). It is a Pledge pack that was never
 * on a shelf, so `packOptions` in shared cannot open it. The options come from the week's seed alone, so
 * they are the same on every read and do not change when later acts clear.
 */
export function freePackOptions(run: RunState): Pledge[] {
  return shuffle(PLEDGES, mulberry32(deriveSeed(run.shopSeed, 'free-pack')))
    .slice(0, SHOP.packOptions)
    .map((definition) => pledgeCard(definition));
}
