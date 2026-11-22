import { describe, expect, it } from 'vitest';
import { D2_XP, levelFor, MAX_LEVEL, progressWithinLevel, xpToNext } from './d2table';

describe('D2_XP table', () => {
  it('has an unused index 0 plus levels 1 to 99', () => {
    expect(D2_XP).toHaveLength(100);
    expect(D2_XP[0]).toBe(0);
    expect(D2_XP[1]).toBe(0);
  });

  it('matches the spot checks in research.md section 2', () => {
    expect(D2_XP[2]).toBe(500);
    expect(D2_XP[10]).toBe(57_715);
    expect(D2_XP[30]).toBe(4_663_553);
    expect(D2_XP[50]).toBe(47_116_709);
    expect(D2_XP[70]).toBe(285_041_630);
    expect(D2_XP[99]).toBe(3_520_485_254);
    expect(D2_XP[99]! - D2_XP[98]!).toBe(291_058_498);
  });

  it('matches the milestone rows in design.md section 5.1', () => {
    const rows: Record<number, number> = {
      20: 537_513,
      40: 17_270_791,
      60: 117_772_849,
      80: 681_027_665,
      90: 1_618_470_619,
    };
    for (const [level, xp] of Object.entries(rows)) {
      expect(D2_XP[Number(level)]).toBe(xp);
    }
  });

  it('is strictly increasing from level 2', () => {
    for (let level = 2; level <= MAX_LEVEL; level++) {
      expect(D2_XP[level]!).toBeGreaterThan(D2_XP[level - 1]!);
    }
  });
});

describe('levelFor', () => {
  it('handles the documented anchors', () => {
    expect(levelFor(0)).toBe(1);
    expect(levelFor(3_520_485_253)).toBe(98);
    expect(levelFor(3_520_485_254)).toBe(99);
  });

  it('flips exactly at every level threshold', () => {
    for (let level = 2; level <= MAX_LEVEL; level++) {
      expect(levelFor(D2_XP[level]!)).toBe(level);
      expect(levelFor(D2_XP[level]! - 1)).toBe(level - 1);
    }
  });

  it('caps at 99 while XP keeps accumulating', () => {
    expect(levelFor(3_520_485_255)).toBe(99);
    expect(levelFor(Number.MAX_SAFE_INTEGER)).toBe(99);
  });

  it('treats negative XP as level 1', () => {
    expect(levelFor(-1)).toBe(1);
  });
});

describe('xpToNext', () => {
  it('is the distance to the next threshold', () => {
    expect(xpToNext(0)).toBe(500);
    expect(xpToNext(242)).toBe(258);
    expect(xpToNext(500)).toBe(1000);
    expect(xpToNext(3_520_485_253)).toBe(1);
  });

  it('is 0 at level 99', () => {
    expect(xpToNext(3_520_485_254)).toBe(0);
    expect(xpToNext(4_000_000_000)).toBe(0);
  });
});

describe('progressWithinLevel', () => {
  it('reports exact numbers for the XP bar (design.md 4.5 example 1: 242 XP is 48% to level 2)', () => {
    const progress = progressWithinLevel(242);
    expect(progress).toEqual({ level: 1, xpIntoLevel: 242, xpSpan: 500, fraction: 0.484 });
  });

  it('starts a level at 0', () => {
    expect(progressWithinLevel(500)).toEqual({
      level: 2,
      xpIntoLevel: 0,
      xpSpan: 1000,
      fraction: 0,
    });
  });

  it('stays below 1 just before a level-up', () => {
    expect(progressWithinLevel(499).fraction).toBeLessThan(1);
  });

  it('is full with no span at level 99', () => {
    expect(progressWithinLevel(3_520_485_254 + 10)).toEqual({
      level: 99,
      xpIntoLevel: 10,
      xpSpan: 0,
      fraction: 1,
    });
  });
});
