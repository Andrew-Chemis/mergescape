/**
 * 16x16 palette-indexed sprites (Requirement 10.4), ported from the mock page
 * (.kiro/specs/mergescape/mocks.html). Each sprite is 16 rows of 16 characters; a letter indexes a
 * palette entry and `.` is transparent. The renderer merges horizontal runs of one colour into a single
 * SVG `<path>`, so a sprite is a handful of elements, and draws them with `shape-rendering: crispEdges`
 * at integer scales only.
 *
 * The hero is palette-swapped per gear tier (Requirement 5.4); every other sprite has one palette.
 */
import { GEAR_TIER_LEVELS } from '@mergescape/shared';
import type { MonsterId } from '@mergescape/shared';

// ---------------------------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------------------------

export const MONSTER_SPRITES = [
  'goblin',
  'imp',
  'wraith',
  'golem',
  'hydra',
  'creep',
  'dragon',
  'monolith',
] as const;
export const MOGUL_SPRITES = ['rocket', 'jacket', 'turtle', 'hoodie', 'founder', 'pizza'] as const;
export const CHARM_SPRITES = ['duck', 'hands', 'potato'] as const;

export type MonsterSprite = (typeof MONSTER_SPRITES)[number];
export type MogulSprite = (typeof MOGUL_SPRITES)[number];
export type CharmSprite = (typeof CHARM_SPRITES)[number];
export type SpriteName = 'hero' | 'hero-asleep' | MonsterSprite | MogulSprite | CharmSprite;

/** Every sprite name, hero first. */
export const SPRITE_NAMES: readonly SpriteName[] = [
  'hero',
  'hero-asleep',
  ...MONSTER_SPRITES,
  ...MOGUL_SPRITES,
  ...CHARM_SPRITES,
];

/** The hero's seven gear-tier palettes, in tier order. */
export const HERO_PALETTES = [
  'rags',
  'leather',
  'iron',
  'mithril',
  'rune',
  'dragon',
  'cape',
] as const;
export type HeroPalette = (typeof HERO_PALETTES)[number];

/** Bestiary id (shared package) to sprite. */
export const MONSTER_SPRITE: Readonly<Record<MonsterId, SpriteName>> = {
  'merge-goblin': 'goblin',
  'nitpick-imp': 'imp',
  'flaky-test-wraith': 'wraith',
  'legacy-golem': 'golem',
  'rebase-hydra': 'hydra',
  'scope-creep': 'creep',
  'release-dragon': 'dragon',
  'silent-monolith': 'monolith',
  'rocket-man': 'rocket',
  'leather-jacket': 'jacket',
  turtleneck: 'turtle',
  hoodie: 'hoodie',
  founder: 'founder',
  'two-pizza-boss': 'pizza',
};

/** Charm id to icon, for the three Charm icons drawn so far. Other Charms have no icon yet. */
const CHARM_ICONS: Readonly<Record<string, CharmSprite>> = {
  'rubber-duck': 'duck',
  'small-hands': 'hands',
  'hot-potato': 'potato',
};

export function charmSprite(charmId: string): CharmSprite | null {
  return CHARM_ICONS[charmId] ?? null;
}

// ---------------------------------------------------------------------------------------------
// Pixel data (letters index the palettes below)
// ---------------------------------------------------------------------------------------------

type BaseSpriteName = Exclude<SpriteName, 'hero-asleep'>;

const BASE_ROWS: Readonly<Record<BaseSpriteName, readonly string[]>> = {
  hero: [
    '....HHHHHH......',
    '...HHHHHHHH.....',
    '...HSSSSSSH.....',
    '...HSESSESH.....',
    '...HSSSSSSH.....',
    '....SSMMSS......',
    '.....SSSS.......',
    '...AAAAAAAA..W..',
    '..ASAAAAAASA.W..',
    '..ASAAAAAASA.W..',
    '..S.AAAAAA.S.W..',
    '....AAAAAA...W..',
    '....BBBBBB......',
    '....BB..BB......',
    '....BB..BB......',
    '...FFF..FFF.....',
  ],
  goblin: [
    '................',
    '.....GG..GG.....',
    '....GGGGGGGG....',
    '...GGGGGGGGGG...',
    '...GEGGGGGGEG...',
    '...GGGGGGGGGG...',
    '....GGTTTTGG....',
    '.....GGGGGG.....',
    '..G..GGGGGG..PP.',
    '..GGGGGGGGGGPPP.',
    '.....GGGGGG..PP.',
    '.....GGGGGG.....',
    '.....GG..GG.....',
    '.....GG..GG.....',
    '....GGG..GGG....',
    '................',
  ],
  imp: [
    '................',
    '....R......R....',
    '.....R....R.....',
    '.....RRRRRR.....',
    '....RRRRRRRR....',
    '....RYRRRRYR....',
    '....RRRRRRRR....',
    '.....RRWWRR.....',
    '......RRRR......',
    '..Q...RRRR...Q..',
    '..Q.RRRRRRRR.Q..',
    '....R.RRRR.R....',
    '......RRRR......',
    '......R..R......',
    '.....RR..RR.....',
    '................',
  ],
  wraith: [
    '.....WWWWWW.....',
    '....WWWWWWWW....',
    '...WWWWWWWWWW...',
    '...WWEWWWWEWW...',
    '...WWWWWWWWWW...',
    '...WWWWWWWWWW...',
    '..WWWWWWWWWWWW..',
    '..WWWWWWWWWWWW..',
    '..WWWWWWWWWWWW..',
    '..WWWRWWGWWRWW..',
    '..WWWWWWWWWWWW..',
    '...WWWWWWWWWW...',
    '...WW.WWWW.WW...',
    '...W..WW.W..W...',
    '......W..W......',
    '................',
  ],
  golem: [
    '....SSSSSSSS....',
    '...SSSSSSSSSS...',
    '...SSOSSSSOSS...',
    '...SSSSSSSSSS...',
    '..SSSSSSSSSSSS..',
    '.SSSSSSSSSSSSSS.',
    'SSS.SSSSSSSS.SSS',
    'SSS.SSRSSRSS.SSS',
    'SSS.SSSSSSSS.SSS',
    'SSS.SSRSSSSS.SSS',
    '.SS.SSSSSSSS.SS.',
    '....SSSSSSSS....',
    '....SSS..SSS....',
    '....SSS..SSS....',
    '...SSSS..SSSS...',
    '................',
  ],
  hydra: [
    '.HH....HH....HH.',
    'HEHH..HEHH..HEHH',
    'HHHH..HHHH..HHHH',
    '.HH....HH....HH.',
    '.HH....HH....HH.',
    '..HH...HH...HH..',
    '...HH..HH..HH...',
    '....HHHHHHHH....',
    '.....HHHHHH.....',
    '.....HHHHHH.....',
    '....HHHHHHHH....',
    '...HHHHHHHHHH...',
    '..HHHHHHHHHHHH..',
    '.HHHHHHHHHHHHHH.',
    'HHHHHHHHHHHHHHHH',
    '................',
  ],
  creep: [
    '..V......V......',
    '..V.V....V.V....',
    '...VV.VV.VV.....',
    '....VVVVVV......',
    '...VVEVVEVV.....',
    '..VVVVVVVVVV....',
    '.V..VVVVVV..V...',
    '.V..VVVVVV..V...',
    '....VVVVVV......',
    '...TTTTTTTTT....',
    '...TKTTTTTTT....',
    '...TTTTTTTTT....',
    '...TTTTTTTTT....',
    '...TKKTTTTTT....',
    '...TTTTTTTTT....',
    '................',
  ],
  dragon: [
    '..D..........D..',
    '..DD........DD..',
    '..DDD......DDD..',
    '...DDD....DDD...',
    '...DDDDDDDDDD...',
    '....DDDDDDDD....',
    '....DEDDDDED....',
    '....DDDDDDDD....',
    '.....DDTTDD.....',
    '.....DDDDDD..DD.',
    '....DDDDDDDDDD..',
    '....DDDDDDDD....',
    '....DD....DD....',
    '...DDD....DDD...',
    '..GGGGGGGGGGGG..',
    '..G.GGGG.GGG.G..',
  ],
  rocket: [
    '.....HHHH.......',
    '....HHHHHH..N...',
    '....SSSSSS..N...',
    '....SESSES..N...',
    '....SSSSSS..N...',
    '.....SSSS...N...',
    '...LLLLLLLL.N...',
    '..LLLLLLLLLLN...',
    '..LSLLLLLLSLN...',
    '..LSLLLLLLSLF...',
    '..S.LLLLLL.SF...',
    '....LLLLLL..O...',
    '....LL..LL......',
    '....LL..LL......',
    '...LLL..LLL.....',
    '................',
  ],
  jacket: [
    '....GGGGGG......',
    '...GGGGGGGG.....',
    '...GSSSSSSG.....',
    '...GSESSESG.....',
    '....SSSSSS......',
    '.....SSSS.......',
    '...JJJJJJJJ.....',
    '..JJJWWJJJJJ....',
    '..JJJWWJJJJJ....',
    '..SJJWWJJJS.....',
    '.CCCJJJJJJ.S....',
    '.CCC.JJJJ.......',
    '....BBBBBB......',
    '....BB..BB......',
    '....BB..BB......',
    '...FFF..FFF.....',
  ],
  turtle: [
    '....HHHH........',
    '...HHHHHH.......',
    '...HSSSSSH......',
    '...HOSSOSH..S...',
    '...HSSSSSH..S...',
    '....GGGGG...S...',
    '....TTTTTT..S...',
    '...TTTTTTTT.S...',
    '..TTTTTTTTTTS...',
    '..STTTTTTTTT....',
    '..S.TTTTTT......',
    '....TTTTTT......',
    '....DDDDDD......',
    '....DD..DD......',
    '....DD..DD......',
    '...FFF..FFF.....',
  ],
  hoodie: [
    '....HHHHHH......',
    '...HHHHHHHH.....',
    '...HVVVVVVH.....',
    '...HSSSSSSH.....',
    '...HSESSESH.....',
    '....SSSSSS......',
    '.....SSSS.......',
    '...UUUUUUUU.....',
    '..UUUUUUUUUU....',
    '..SUUUUUUUUS....',
    '..S.UUUUUU.S....',
    '....UUUUUU......',
    '....DDDDDD......',
    '....DD..DD......',
    '....DD..DD......',
    '...FFF..FFF.....',
  ],
  founder: [
    '....HHHHHH......',
    '...HHHHHHHH.....',
    '...HSSSSSSH.....',
    '...HSESSESH.....',
    '...HSSSSSSH.....',
    '....SSMMSS......',
    '.....SSSS.......',
    '...CCCCCCCC.....',
    '..CCCCCCCCCC....',
    '..SCCCOOCCCS....',
    '..SSSOOOOSSS....',
    '....CCOOCC......',
    '....BBBBBB......',
    '....BB..BB......',
    '....BB..BB......',
    '...FFF..FFF.....',
  ],
  pizza: [
    '.....SSSS.......',
    '....SSSSSS......',
    '....SSSSSS......',
    '....SESSES......',
    '....SSSSSS......',
    '.....SMMS.......',
    '......SS........',
    '...BBWWWWBB.....',
    '..BBBBWWBBBB....',
    '..SBBBBBBBBS....',
    '..S.BBBBBB.S....',
    '.PPPPPPPP.......',
    '.PPPPPPPP.......',
    '.PPPPPPPP.......',
    '....BB..BB......',
    '...FFF..FFF.....',
  ],
  monolith: [
    '.....KKKKKK.....',
    '....KKKKKKKK....',
    '....KKKKKKKK....',
    '....KKKKKKKK....',
    '....KKKKKKKK....',
    '....KKKKKKKR....',
    '....KKKKKKKK....',
    '....KKKKKKKK....',
    '....KKKKKKKK....',
    '....KKKKKKKK....',
    '....KKKKKKKK....',
    '....KKKKKKKK....',
    '....KKKKKKKK....',
    '...KKKKKKKKKK...',
    '..KKKKKKKKKKKK..',
    '................',
  ],
  duck: [
    '................',
    '................',
    '......YYYY......',
    '.....YYYYYY.....',
    '.....YEYYYY.....',
    '.....YYYYOO.....',
    '.....YYYYYY.....',
    '......YYYY......',
    '..Y..YYYYYY.....',
    '..YYYYYYYYYYY...',
    '..YYYYYYYYYYY...',
    '...YYYYYYYYY....',
    '....YYYYYYY.....',
    '................',
    '................',
    '................',
  ],
  hands: [
    '................',
    '................',
    '................',
    '....SS...SS.....',
    '...SSSS.SSSS....',
    '...SSSS.SSSS....',
    '...SSSS.SSSS....',
    '..SSSSS.SSSSS...',
    '..SSSSS.SSSSS...',
    '...SSSS.SSSS....',
    '...SSSS.SSSS....',
    '................',
    '................',
    '................',
    '................',
    '................',
  ],
  potato: [
    '................',
    '................',
    '................',
    '......BBBB......',
    '....BBBBBBBB....',
    '...BBBBBBBBBB...',
    '...BBBBOBBBBB...',
    '..BBBBBBBBBBBB..',
    '..BBBOBBBBBBBB..',
    '...BBBBBBBOBB...',
    '...BBBBBBBBBB...',
    '....BBBBBBBB....',
    '......BBBB......',
    '................',
    '................',
    '................',
  ],
};

/** The hero with closed eyes (the sleeping character on an empty Town). */
const ROWS: Readonly<Record<SpriteName, readonly string[]>> = {
  ...BASE_ROWS,
  'hero-asleep': BASE_ROWS.hero.map((row) => row.replace('SESSES', 'SMSSMS')),
};

// ---------------------------------------------------------------------------------------------
// Palettes
// ---------------------------------------------------------------------------------------------

type Palette = Readonly<Record<string, string>>;

/** Colours shared by every sprite unless the sprite's own palette overrides a letter. */
const BASE_PALETTE: Palette = {
  H: '#4a2a12',
  S: '#e8b28a',
  E: '#111',
  M: '#a05a3a',
  B: '#3b2f2a',
  F: '#241a16',
  W: '#c9c9c9',
  G: '#5fae46',
  T: '#fff',
  P: '#a371f7',
  R: '#d13b3b',
  Y: '#ffe26a',
  Q: '#fff',
  O: '#ff9c2b',
  K: '#15110f',
  V: '#4f8a3e',
  D: '#7a4bd6',
};

const SPRITE_PALETTES: Readonly<Partial<Record<SpriteName, Palette>>> = {
  goblin: { E: '#ff3b3b' },
  imp: { W: '#fff', R: '#d13b3b' },
  wraith: { W: '#bfeff5', E: '#000', R: '#ff5c5c', G: '#49c178' },
  golem: { S: '#7d7a74', O: '#ff9c2b', R: '#e0a84a' },
  hydra: { H: '#3e8f7b', E: '#ffe26a' },
  creep: { T: '#ead98f', K: '#8a7d5a', E: '#ffe26a' },
  dragon: { E: '#ffe26a', T: '#fff', G: '#f2c14e' },
  monolith: { K: '#1c1a1f', R: '#ff3b3b' },
  rocket: { H: '#3a2a1a', L: '#c8ccd2', N: '#f4f4f4', F: '#ff8a3d', O: '#ffd23f' },
  jacket: { G: '#c4c4c4', J: '#1d1d1f', W: '#f4f4f4', C: '#76b900', B: '#2a2a2e' },
  turtle: { H: '#9a9a9a', O: '#222', G: '#b5b5b5', T: '#111', D: '#3b5a8a' },
  hoodie: { H: '#5a3a1a', V: '#e6eef5', U: '#8a8f98', D: '#2c3e66' },
  founder: { H: '#5a3a1a', C: '#6e7480', O: '#7ff0ff' },
  pizza: { B: '#2f6fb5', W: '#f4f4f4', P: '#d9b26f', M: '#a05a3a' },
  duck: { Y: '#ffd23f', E: '#000', O: '#ff8a3d' },
  hands: { S: '#e8b28a' },
  potato: { B: '#b97b3a', O: '#7a4a1e' },
};

/** Hero body (A) and weapon (W) colours per gear tier; the cape tier also trims the hair (H). */
const HERO_TIER_PALETTES: Readonly<Record<HeroPalette, Palette>> = {
  rags: { A: '#7a5330', W: '#9c7b55' },
  leather: { A: '#8c5a2b', W: '#bfb9ae' },
  iron: { A: '#8e8e8e', W: '#d6d6d6' },
  mithril: { A: '#2f6f73', W: '#78c9cf' },
  rune: { A: '#3a8fb5', W: '#9fe6ff' },
  dragon: { A: '#b3272b', W: '#ff8a3d' },
  cape: { A: '#b3272b', W: '#f2c14e', H: '#f2c14e' },
};

/** Ghost-like sprites draw this colour letter translucent. */
const TRANSLUCENT: Readonly<Partial<Record<SpriteName, { letter: string; opacity: number }>>> = {
  wraith: { letter: 'W', opacity: 0.78 },
};

// ---------------------------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------------------------

export const SPRITE_GRID = 16;

/** One merged-colour path of a sprite: every pixel of one colour as horizontal 1-pixel-high runs. */
export interface SpritePath {
  fill: string;
  /** Fill opacity; absent means opaque. */
  opacity?: number;
  /** Path data in sprite pixels (viewBox 0 0 16 16). */
  d: string;
}

function paletteFor(name: SpriteName, hero: HeroPalette): Palette {
  const own = SPRITE_PALETTES[name] ?? {};
  const tier = name === 'hero' || name === 'hero-asleep' ? HERO_TIER_PALETTES[hero] : {};
  return { ...BASE_PALETTE, ...own, ...tier };
}

/**
 * The colour paths of a sprite, in first-seen letter order. Unknown letters are skipped, so a bad
 * definition renders as holes instead of throwing.
 */
export function spritePaths(name: SpriteName, hero: HeroPalette = 'rags'): SpritePath[] {
  const palette = paletteFor(name, hero);
  const translucent = TRANSLUCENT[name];
  const byLetter = new Map<string, string>();
  ROWS[name].forEach((row, y) => {
    let x = 0;
    while (x < SPRITE_GRID) {
      const letter = row[x] ?? '.';
      if (letter === '.' || palette[letter] === undefined) {
        x += 1;
        continue;
      }
      let end = x + 1;
      while (end < SPRITE_GRID && row[end] === letter) {
        end += 1;
      }
      byLetter.set(letter, `${byLetter.get(letter) ?? ''}M${x} ${y}h${end - x}v1h-${end - x}z`);
      x = end;
    }
  });
  return [...byLetter].map(([letter, d]) => ({
    fill: palette[letter] as string,
    ...(translucent?.letter === letter ? { opacity: translucent.opacity } : {}),
    d,
  }));
}

/** Pixel scales are integers so every sprite pixel lands on whole screen pixels. */
export function integerScale(scale: number): number {
  return Number.isFinite(scale) ? Math.max(1, Math.round(scale)) : 1;
}

export interface RenderOptions {
  palette?: HeroPalette;
  scale?: number;
  /** Accessible name. Omit for a decorative sprite (hidden from assistive technology). */
  label?: string;
}

function escapeAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

/**
 * Inline SVG markup for a sprite. Pure string output, used by tests and anything outside Svelte; the
 * `<Sprite>` component renders the same paths declaratively.
 */
export function renderSprite(name: SpriteName, options: RenderOptions = {}): string {
  const size = SPRITE_GRID * integerScale(options.scale ?? 4);
  const a11y =
    options.label === undefined
      ? 'aria-hidden="true" focusable="false"'
      : `role="img" aria-label="${escapeAttribute(options.label)}"`;
  const paths = spritePaths(name, options.palette)
    .map((path) => {
      const opacity = path.opacity === undefined ? '' : ` fill-opacity="${path.opacity}"`;
      return `<path fill="${path.fill}"${opacity} d="${path.d}"/>`;
    })
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${SPRITE_GRID} ${SPRITE_GRID}" shape-rendering="crispEdges" ${a11y}>${paths}</svg>`;
}

// ---------------------------------------------------------------------------------------------
// Gear tiers (Requirement 5.4)
// ---------------------------------------------------------------------------------------------

export type GearTierName = (typeof GEAR_TIER_LEVELS)[number]['tier'];

const TIER_PALETTE: Readonly<Record<GearTierName, HeroPalette>> = {
  Rags: 'rags',
  Leather: 'leather',
  Iron: 'iron',
  Mithril: 'mithril',
  Rune: 'rune',
  Dragon: 'dragon',
  Trimmed: 'cape',
};

export interface GearTier {
  level: number;
  tier: GearTierName;
  palette: HeroPalette;
}

/** The gear tier a character of this level wears: the last entry whose level threshold is reached. */
export function gearTierFor(level: number): GearTier {
  let current: (typeof GEAR_TIER_LEVELS)[number] = GEAR_TIER_LEVELS[0];
  for (const entry of GEAR_TIER_LEVELS) {
    if (level >= entry.level) {
      current = entry;
    }
  }
  return { level: current.level, tier: current.tier, palette: TIER_PALETTE[current.tier] };
}

/** The next tier above this level, or null once Trimmed. */
export function nextGearTier(level: number): GearTier | null {
  const next = GEAR_TIER_LEVELS.find((entry) => entry.level > level);
  return next ? { level: next.level, tier: next.tier, palette: TIER_PALETTE[next.tier] } : null;
}

/** Palette of the hero at this character level. */
export function heroPaletteFor(level: number): HeroPalette {
  return gearTierFor(level).palette;
}

/** Palette of a named tier, for rendering the tier ladder. */
export function paletteForTier(tier: GearTierName): HeroPalette {
  return TIER_PALETTE[tier];
}
