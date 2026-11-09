/**
 * Diablo II (Lord of Destruction) experience table, copied verbatim from research.md section 2.
 * Index = level; the value is the cumulative XP required to reach that level. Index 0 is unused.
 * Source: https://classic.battle.net/Diablo2exp/basics/levels.shtml
 */
export const D2_XP: readonly number[] = [
  0, // index 0 unused
  0,
  500,
  1500,
  3750,
  7875,
  14175,
  22680,
  32886,
  44396,
  57715,
  72144,
  90180,
  112725,
  140906,
  176132,
  220165,
  275207,
  344008,
  430010,
  537513,
  671891,
  839864,
  1049830,
  1312287,
  1640359,
  2050449,
  2563061,
  3203826,
  3902260,
  4663553,
  5493363,
  6397855,
  7383752,
  8458379,
  9629723,
  10906488,
  12298162,
  13815086,
  15468534,
  17270791,
  19235252,
  21376515,
  23710491,
  26254525,
  29027522,
  32050088,
  35344686,
  38935798,
  42850109,
  47116709,
  51767302,
  56836449,
  62361819,
  68384473,
  74949165,
  82104680,
  89904191,
  98405658,
  107672256,
  117772849,
  128782495,
  140783010,
  153863570,
  168121381,
  183662396,
  200602101,
  219066380,
  239192444,
  261129853,
  285041630,
  311105466,
  339515048,
  370481492,
  404234916,
  441026148,
  481128591,
  524840254,
  572485967,
  624419793,
  681027665,
  742730244,
  809986056,
  883294891,
  963201521,
  1050299747,
  1145236814,
  1248718217,
  1361512946,
  1484459201,
  1618470619,
  1764543065,
  1923762030,
  2097310703,
  2286478756,
  2492671933,
  2717422497,
  2962400612,
  3229426756,
  3520485254,
];

/** Highest reachable level. XP keeps accumulating beyond it. */
export const MAX_LEVEL = 99;

/** Cumulative XP needed to reach `level` (clamped to 1..99). */
function xpAt(level: number): number {
  return D2_XP[Math.min(MAX_LEVEL, Math.max(1, level))]!;
}

/** Largest level L in 1..99 with `D2_XP[L] <= xp`, found by binary search. */
export function levelFor(xp: number): number {
  let lo = 1;
  let hi = MAX_LEVEL;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (xpAt(mid) <= xp) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return lo;
}

/** XP still needed to reach the next level; 0 at level 99. */
export function xpToNext(xp: number): number {
  const level = levelFor(xp);
  return level >= MAX_LEVEL ? 0 : xpAt(level + 1) - xp;
}

export interface LevelProgress {
  level: number;
  /** XP earned since reaching `level`. */
  xpIntoLevel: number;
  /** XP between `level` and the next one; 0 at level 99. */
  xpSpan: number;
  /** `xpIntoLevel / xpSpan` in [0, 1); exactly 1 at level 99. */
  fraction: number;
}

/** Where `xp` sits inside its current level, for the Character screen XP bar. */
export function progressWithinLevel(xp: number): LevelProgress {
  const level = levelFor(xp);
  const xpIntoLevel = xp - xpAt(level);
  if (level >= MAX_LEVEL) {
    return { level, xpIntoLevel, xpSpan: 0, fraction: 1 };
  }
  const xpSpan = xpAt(level + 1) - xpAt(level);
  return { level, xpIntoLevel, xpSpan, fraction: xpIntoLevel / xpSpan };
}
