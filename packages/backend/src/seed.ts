import { randomInt } from 'node:crypto';

/** A fresh random unsigned 32-bit seed for a week's run (shop stock, Pledge draw and Mogul bag derive from it). */
export function randomSeed(): number {
  return randomInt(0, 0x1_0000_0000);
}
