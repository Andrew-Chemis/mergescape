import { describe, expect, it } from 'vitest';
import { deriveSeed, mulberry32, shuffle, weightedPick } from './rng';

describe('mulberry32', () => {
  it('is deterministic and stays in [0, 1)', () => {
    const a = mulberry32(12345);
    const b = mulberry32(12345);
    const draws = Array.from({ length: 2000 }, () => a());
    expect(draws).toEqual(Array.from({ length: 2000 }, () => b()));
    expect(draws.every((value) => value >= 0 && value < 1)).toBe(true);
    const mean = draws.reduce((sum, value) => sum + value, 0) / draws.length;
    expect(Math.abs(mean - 0.5)).toBeLessThan(0.03);
  });

  it('is the standard mulberry32 (seed 1 starts 0.6270739...) and its stream is pinned', () => {
    // The first value is the published reference output. The next two pin this implementation so a change
    // to the generator cannot silently reshuffle every stored week's shop and Pledge hand.
    const random = mulberry32(1);
    const first = random();
    expect(first).toBeCloseTo(0.6270739405881613, 12);
    expect([random(), random()].map((value) => Math.round(value * 1e6) / 1e6)).toEqual([
      0.002736, 0.527447,
    ]);
  });

  it('different seeds give different streams', () => {
    expect(mulberry32(1)()).not.toBe(mulberry32(2)());
  });
});

describe('deriveSeed', () => {
  it('is deterministic, unsigned 32-bit, and separated by every salt', () => {
    expect(deriveSeed(7, 'shop', 1)).toBe(deriveSeed(7, 'shop', 1));
    const seeds = new Set([
      deriveSeed(7, 'shop', 1),
      deriveSeed(7, 'shop', 2),
      deriveSeed(7, 'pack', 1),
      deriveSeed(8, 'shop', 1),
      deriveSeed(7),
      deriveSeed(7, 'shop'),
    ]);
    expect(seeds.size).toBe(6);
    for (const seed of seeds) {
      expect(Number.isInteger(seed) && seed >= 0 && seed <= 0xffffffff).toBe(true);
    }
  });
});

describe('shuffle and weightedPick', () => {
  it('shuffle returns a permutation and leaves the input alone', () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8];
    const shuffled = shuffle(items, mulberry32(9));
    expect([...shuffled].sort()).toEqual(items);
    expect(items).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(shuffle([], mulberry32(1))).toEqual([]);
  });

  it('shuffle reaches every position', () => {
    const firsts = new Set(
      Array.from({ length: 200 }, (_, seed) => shuffle([1, 2, 3, 4], mulberry32(seed))[0]),
    );
    expect(firsts.size).toBe(4);
  });

  it('weightedPick follows the weights and can pick the last entry', () => {
    const random = mulberry32(5);
    const counts = { a: 0, b: 0, c: 0 };
    for (let index = 0; index < 20_000; index += 1) {
      counts[
        weightedPick(
          [
            { value: 'a' as const, weight: 70 },
            { value: 'b' as const, weight: 25 },
            { value: 'c' as const, weight: 5 },
          ],
          random,
        )
      ] += 1;
    }
    expect(Math.abs(counts.a / 200 - 70)).toBeLessThan(2);
    expect(Math.abs(counts.b / 200 - 25)).toBeLessThan(2);
    expect(counts.c).toBeGreaterThan(0);
    expect(weightedPick([{ value: 'only', weight: 0 }], () => 0.5)).toBe('only');
  });
});
