/**
 * 16x16 palette-indexed sprites (Requirement 10.4), ported from the mock page
 * (.kiro/specs/mergescape/mocks.html). Each sprite is 16 rows of 16 characters; a letter indexes a
 * palette entry and `.` is transparent. The renderer merges horizontal runs of one colour into a single
 * SVG `<path>`, so a sprite is a handful of elements, and draws them with `shape-rendering: crispEdges`
 * at integer scales only.
 *
 * The hero is palette-swapped per gear tier (Requirement 5.4); every other sprite has one palette.
 */
import { clamp01, GEAR_TIER_LEVELS, GEAR_TIERS } from '@mergescape/shared';
import type { GearSlot, GearTier as GearTierId, MonsterId } from '@mergescape/shared';

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
/**
 * Worn gear drives the hero's look (Requirement 16.4), and Silver is a gear tier the level ladder above
 * has no step for, so it is a palette of its own: the seven level palettes plus this one.
 */
export const GEAR_ONLY_PALETTES = ['silver'] as const;
export type HeroPalette = (typeof HERO_PALETTES)[number] | (typeof GEAR_ONLY_PALETTES)[number];

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
    '.C.AAAAAAAA..W..',
    '.CASAAAAAASACW..',
    '.CASAAAAAASACW..',
    '.CS.AAAAAA.SCW..',
    '.C..AAAAAA..CW..',
    '.cc.BBBBBB.cc...',
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
  silver: { A: '#b9c4d4', W: '#eef3fa' },
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

/** A colour mixed toward black (`amount` 0 to 1), for the shadow tone of a flat colour. */
export function shade(hex: string, amount: number): string {
  const channel = (offset: number): string => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16);
    const dark = Math.round(value * (1 - clamp01(amount)));
    return dark.toString(16).padStart(2, '0');
  };
  return `#${channel(1)}${channel(3)}${channel(5)}`;
}

/** A colour mixed toward white (`amount` 0 to 1), for the highlight tone. */
export function lighten(hex: string, amount: number): string {
  const channel = (offset: number): string => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16);
    const light = Math.round(value + (255 - value) * clamp01(amount));
    return light.toString(16).padStart(2, '0');
  };
  return `#${channel(1)}${channel(3)}${channel(5)}`;
}

function paletteFor(name: SpriteName, hero: HeroPalette, cape?: string): Palette {
  const own = SPRITE_PALETTES[name] ?? {};
  const isHero = name === 'hero' || name === 'hero-asleep';
  const tier = isHero ? HERO_TIER_PALETTES[hero] : {};
  // The cape (letters C and c) is drawn only when one is worn.
  const clothing: Palette = isHero && cape ? { C: cape, c: shade(cape, 0.35) } : {};
  return { ...BASE_PALETTE, ...own, ...tier, ...clothing };
}

/** Paths already built, by `name|palette|cape`: a screen draws the same few sprites many times over. */
const PATH_CACHE = new Map<string, readonly SpritePath[]>();
/** Well above the game's real combinations of sprite, palette and cape; the cap only guards against odd input. */
const PATH_CACHE_LIMIT = 512;

/**
 * The colour paths of a sprite, in first-seen letter order. Unknown letters are skipped, so a bad
 * definition renders as holes instead of throwing. The result is shared between callers: do not change it.
 */
export function spritePaths(
  name: SpriteName,
  hero: HeroPalette = 'rags',
  cape?: string,
): readonly SpritePath[] {
  const key = `${name}|${hero}|${cape ?? ''}`;
  let paths = PATH_CACHE.get(key);
  if (paths === undefined) {
    paths = pathsOf(ROWS[name], paletteFor(name, hero, cape), TRANSLUCENT[name]);
    if (PATH_CACHE.size >= PATH_CACHE_LIMIT) {
      PATH_CACHE.clear();
    }
    PATH_CACHE.set(key, paths);
  }
  return paths;
}

/** Merge a grid of letters into one path per colour, horizontal runs of one pixel height. */
function pathsOf(
  rows: readonly string[],
  palette: Palette,
  translucent?: { letter: string; opacity: number },
): SpritePath[] {
  const byLetter = new Map<string, string>();
  rows.forEach((row, y) => {
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
  /** Cape colour for the hero (a hex string); no cape is drawn without one. */
  cape?: string;
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
  const paths = spritePaths(name, options.palette, options.cape)
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

// ---------------------------------------------------------------------------------------------
// Gear and pets (task 23; Requirements 10.4, 16.1 and 16.5)
// ---------------------------------------------------------------------------------------------

/**
 * Four worn slots, three shapes each, and six tier palettes: 24 pieces that every crafted or found piece
 * draws from. Named uniques are palette variants of those shapes (18 of them, plus one Reclaimed variant
 * per slot), and the six core pets have shapes of their own. A row is 16 characters; letters index the
 * palette (M main, L light, D dark, T trim, G gem, E eye) and `.` is transparent.
 */
export const WORN_SLOT_SPRITES = ['weapon', 'body', 'cape', 'trinket'] as const;
export type WornSlotSprite = (typeof WORN_SLOT_SPRITES)[number];

export type GearShape =
  | 'dagger'
  | 'sword'
  | 'greatsword'
  | 'tunic'
  | 'hauberk'
  | 'cuirass'
  | 'cloak'
  | 'cape'
  | 'mantle'
  | 'charm'
  | 'amulet'
  | 'medallion';

/** A shape is drawn on fewer than 16 rows and centred vertically on the grid. */
function fit(rows: readonly string[]): readonly string[] {
  const missing = Math.max(0, SPRITE_GRID - rows.length);
  const top = Math.floor(missing / 2);
  const blank = '.'.repeat(SPRITE_GRID);
  return [...Array<string>(top).fill(blank), ...rows, ...Array<string>(missing - top).fill(blank)];
}

export const GEAR_SHAPES: Readonly<Record<GearShape, readonly string[]>> = {
  dagger: fit([
    '.......LL.......',
    '.......LM.......',
    '.......LM.......',
    '.......LM.......',
    '.......LM.......',
    '.......LM.......',
    '.......LD.......',
    '......TTTT......',
    '.......DD.......',
    '.......DD.......',
    '......TGGT......',
  ]),
  sword: fit([
    '.......LD.......',
    '......LMMD......',
    '......LMMD......',
    '......LMMD......',
    '......LMMD......',
    '......LMMD......',
    '......LMMD......',
    '......LMMD......',
    '...TTTTTTTTTT...',
    '.......DD.......',
    '.......DD.......',
    '......TGGT......',
  ]),
  greatsword: fit([
    '.......LL.......',
    '......LMMD......',
    '......LMMD......',
    '.....LMLLMD.....',
    '.....LMLLMD.....',
    '.....LMLLMD.....',
    '.....LMLLMD.....',
    '.....LMLLMD.....',
    '.....LMMMMD.....',
    '.TT.TTTTTTTT.TT.',
    '..TTTTTGGTTTTT..',
    '.......DD.......',
    '.......DD.......',
    '......TDDT......',
    '......TGGT......',
  ]),
  tunic: fit([
    '....LMM..MML....',
    '...LMMMMMMMML...',
    '..LMMMMMMMMMML..',
    '.LMMMMMMMMMMMML.',
    '.LMMDMMMMMMDMML.',
    '.LMM.MMMMMM.MML.',
    '.DDD.MMMMMM.DDD.',
    '....MMMMMMMM....',
    '....TTTTTTTT....',
    '....MMMMMMMM....',
    '....MMMMMMMM....',
    '....DDDDDDDD....',
  ]),
  hauberk: fit([
    '..TTT.LMML.TTT..',
    '..TLTLMLMMLTLT..',
    '..TTLMLMLMLLTT..',
    '.LMMLMLMLMLMMML.',
    '.MLMLMLMLMLMLMM.',
    '.LMMMLMLMLMMMML.',
    '.DDD.LMLMLM.DDD.',
    '....MLMLMLML....',
    '....TTTTTTTT....',
    '....LMLMLMLM....',
    '....MLMLMLML....',
    '....DMDMDMDM....',
    '....D.D..D.D....',
  ]),
  cuirass: fit([
    '.TTTT.LMML.TTTT.',
    'TTLLTTLMMLTTLLTT',
    'TLMMTLMMMMLTMMLT',
    'TMMDTMMMMMMTDMMT',
    '.TDD.LMGGML.DDT.',
    '.....LMGGML.....',
    '.....MMMMMM.....',
    '....LMMMMMML....',
    '....TTTTTTTT....',
    '....MMLMMLMM....',
    '...TMMLMMLMMT...',
    '...TMMDMMDMMT...',
    '...DD.DDDD.DD...',
  ]),
  cloak: fit([
    '.....TT..TT.....',
    '....TLLTTLLT....',
    '...LMMMMMMMML...',
    '..LMMMMMMMMMML..',
    '..LMMMMDDMMMML..',
    '..LMMMMDDMMMML..',
    '.LMMMMMDDMMMMML.',
    '.LMMMMMMMMMMMML.',
    '.LMMMMMMMMMMMML.',
    'LMMMMMMMMMMMMMML',
    'DMMMMMMMMMMMMMMD',
    'DDDDDDDDDDDDDDDD',
  ]),
  cape: fit([
    '....TT....TT....',
    '...TLLTTTTLLT...',
    '...LMMMMMMMML...',
    '..LMMMMMMMMMML..',
    '..LMMMMMDMMMML..',
    '..LMMMMMDMMMML..',
    '..LMMMMDDMMMML..',
    '..LMMMMDMMMMML..',
    '.LMMMMMDMMMMMML.',
    '.LMMMMMDMMMMMML.',
    '.LMMMMMMMMMMMML.',
    '.LMMMMMMMMMMMML.',
    '.TTTTTTTTTTTTTT.',
    '.DMMMMMMMMMMMMD.',
    '.DDDDDDDDDDDDDD.',
  ]),
  mantle: fit([
    '...DD.TTTT.DD...',
    '..DLLDTGGTDLLD..',
    '..DLMMLTTLMMLD..',
    '..LMMMMMMMMMML..',
    '.TLMMMMMMMMMMLT.',
    '.TLMMMMMDMMMMLT.',
    '.TLMMMMDDMMMMLT.',
    '.TLMMMMDDMMMMLT.',
    '.TLMMMMMDMMMMLT.',
    '.TLMMMMMMMMMMLT.',
    '.TLMMMMMMMMMMLT.',
    '.TLMMMMMMMMMMLT.',
    '.TTTTTTTTTTTTTT.',
    '.DMMMMMMMMMMMMD.',
    '.DDDDDDDDDDDDDD.',
  ]),
  charm: fit([
    '.....D....D.....',
    '......D..D......',
    '......D..D......',
    '.......DD.......',
    '.......DD.......',
    '......TTTT......',
    '.....TLMMLT.....',
    '.....TMGGMT.....',
    '.....TMGGMT.....',
    '.....TLMMLT.....',
    '......TTTT......',
  ]),
  amulet: fit([
    '...D........D...',
    '....D......D....',
    '.....D....D.....',
    '......D..D......',
    '.......DD.......',
    '.......TT.......',
    '......TLLT......',
    '.....TLGGLT.....',
    '....TLGGGGLT....',
    '.....TMGGMT.....',
    '......TMMT......',
    '.......TT.......',
  ]),
  medallion: fit([
    '.......TT.......',
    '.....T.TT.T.....',
    '......TTTT......',
    '....TTLLLLTT....',
    '...TLLMMMMLLT...',
    '..TTLMMGGMMLTT..',
    '.TTLMMGGGGMMLTT.',
    '.TLMMMGGGGMMMLT.',
    '.TTLMMGGGGMMLTT.',
    '..TTLMMGGMMLTT..',
    '...TLLMMMMLLT...',
    '....TTLLLLTT....',
    '......TTTT......',
    '.....T.TT.T.....',
    '.......TT.......',
  ]),
};

/** Which three shapes each slot has: tiers pair up (Leather and Iron, Silver and Mithril, Rune and Dragon). */
const SLOT_SHAPES: Readonly<Record<WornSlotSprite, readonly [GearShape, GearShape, GearShape]>> = {
  weapon: ['dagger', 'sword', 'greatsword'],
  body: ['tunic', 'hauberk', 'cuirass'],
  cape: ['cloak', 'cape', 'mantle'],
  trinket: ['charm', 'amulet', 'medallion'],
};

const TIER_SHAPE_INDEX: Readonly<Record<GearTierId, 0 | 1 | 2>> = {
  leather: 0,
  iron: 0,
  silver: 1,
  mithril: 1,
  rune: 2,
  dragon: 2,
};

/** Cloth, metal and trim colours per gear tier (the hero's own tier palettes use the same hues). */
export const GEAR_TIER_PALETTES: Readonly<Record<GearTierId, Palette>> = {
  leather: { M: '#8c5a2b', L: '#b98a52', D: '#4a2f16', T: '#6b4423', G: '#e0b866' },
  iron: { M: '#8e8e8e', L: '#d6d6d6', D: '#4a4a4f', T: '#6b5a47', G: '#d9772e' },
  silver: { M: '#b9c4d4', L: '#f2f6fb', D: '#66728a', T: '#8fa0b8', G: '#7fd1ff' },
  mithril: { M: '#2f6f73', L: '#78c9cf', D: '#16393b', T: '#9be7e0', G: '#e8fffd' },
  rune: { M: '#3a8fb5', L: '#9fe6ff', D: '#1c4560', T: '#5a6cff', G: '#ffe26a' },
  dragon: { M: '#b3272b', L: '#ff8a3d', D: '#5b1418', T: '#f2c14e', G: '#ffe26a' },
};

interface UniqueLook {
  shape: GearShape;
  /** The tier palette the variant starts from. */
  base: GearTierId;
  /** Letters that replace the tier's own. */
  accent: Palette;
}

/** Named uniques (shared `UNIQUES`) as palette variants of a shape. Each shape belongs to the piece's slot. */
const UNIQUE_LOOKS: Readonly<Record<string, UniqueLook>> = {
  fernblade: {
    shape: 'dagger',
    base: 'leather',
    accent: { M: '#5fae46', L: '#a6e06b', G: '#d4f58a' },
  },
  'pedlars-button': { shape: 'charm', base: 'iron', accent: { G: '#ffd23f', T: '#c9a15f' } },
  'cascade-pick': {
    shape: 'sword',
    base: 'iron',
    accent: { M: '#5ec8ff', L: '#c7efff', G: '#ffffff' },
  },
  'hallkeepers-mail': { shape: 'hauberk', base: 'silver', accent: { T: '#c9a15f', G: '#f2c14e' } },
  'moth-lantern-cloak': {
    shape: 'mantle',
    base: 'silver',
    accent: { M: '#5a4a8a', L: '#a99be0', G: '#ffe26a' },
  },
  'pressure-pearl': { shape: 'amulet', base: 'mithril', accent: { G: '#f4f8ff', T: '#2f6f73' } },
  'plumb-of-quu': {
    shape: 'greatsword',
    base: 'rune',
    accent: { M: '#3a3f5a', L: '#9fe6ff', G: '#a371f7' },
  },
  'monolith-plate': { shape: 'cuirass', base: 'dragon', accent: { G: '#ff3b3b', T: '#3a3a42' } },
  'the-red-pen': {
    shape: 'dagger',
    base: 'mithril',
    accent: { M: '#d13b3b', L: '#ff8a7a', T: '#2f6f73' },
  },
  'streamers-cape': {
    shape: 'cape',
    base: 'silver',
    accent: { M: '#a371f7', L: '#ff7ad9', T: '#5ec8ff' },
  },
  scalpel: { shape: 'dagger', base: 'iron', accent: { M: '#e6eef5', L: '#ffffff', T: '#5ec8ff' } },
  loupe: { shape: 'charm', base: 'iron', accent: { G: '#bfeff5', T: '#c9a15f' } },
  'mentors-mantle': {
    shape: 'mantle',
    base: 'silver',
    accent: { M: '#2f8f4f', L: '#7fd19a', T: '#f2c14e' },
  },
  'anniversary-cape': {
    shape: 'cape',
    base: 'iron',
    accent: { M: '#b3272b', L: '#ff8a7a', T: '#f2c14e' },
  },
  'three-headed-axe': {
    shape: 'greatsword',
    base: 'silver',
    accent: { T: '#7a4bd6', G: '#7a4bd6' },
  },
  'golden-parachute': {
    shape: 'medallion',
    base: 'mithril',
    accent: { M: '#f2c14e', L: '#ffe9a8', T: '#b8862b', G: '#ffffff' },
  },
  'hourglass-of-scope': {
    shape: 'amulet',
    base: 'leather',
    accent: { M: '#e8d9a8', L: '#fff3c9', G: '#d9922b' },
  },
  'hermits-hood': { shape: 'cloak', base: 'leather', accent: { M: '#4a5a3a', L: '#7a8f5a' } },
};

/** Reclaimed gear (The Garbage Collector): the Dragon shape of the slot in the Spire's violet and ash. */
const RECLAIMED_LOOK: Palette = {
  M: '#3a2a4a',
  L: '#6a4a8a',
  D: '#150e1c',
  T: '#a371f7',
  G: '#ffe26a',
};

/** What the sprite sheet holds: crafted tiers, uniques and Reclaimed variants. */
export const GEAR_SPRITE_IDS: readonly string[] = [
  ...WORN_SLOT_SPRITES.flatMap((slot) => GEAR_TIERS.map((tier) => `${slot}-${tier}`)),
  ...Object.keys(UNIQUE_LOOKS).map((ref) => `unique-${ref}`),
  ...WORN_SLOT_SPRITES.map((slot) => `reclaimed-${slot}`),
];

function wornSlotOf(slot: GearSlot): WornSlotSprite | null {
  return slot === 'pet' ? null : slot;
}

/** The shape a sprite id draws, and the palette it draws it in. Null for an id that is not on the sheet. */
function gearDefinition(id: string): { shape: GearShape; palette: Palette } | null {
  const reclaimed = /^reclaimed-(\w+)$/.exec(id);
  if (reclaimed) {
    const slot = reclaimed[1] as WornSlotSprite;
    return SLOT_SHAPES[slot] ? { shape: SLOT_SHAPES[slot][2], palette: RECLAIMED_LOOK } : null;
  }
  const unique = /^unique-(.+)$/.exec(id);
  if (unique) {
    const look = UNIQUE_LOOKS[unique[1] as string];
    return look
      ? { shape: look.shape, palette: { ...GEAR_TIER_PALETTES[look.base], ...look.accent } }
      : null;
  }
  const crafted = /^(\w+)-(\w+)$/.exec(id);
  const slot = crafted?.[1] as WornSlotSprite | undefined;
  const tier = crafted?.[2] as GearTierId | undefined;
  if (slot && tier && SLOT_SHAPES[slot] && GEAR_TIER_PALETTES[tier]) {
    return { shape: SLOT_SHAPES[slot][TIER_SHAPE_INDEX[tier]], palette: GEAR_TIER_PALETTES[tier] };
  }
  return null;
}

/** The slot a gear shape belongs to. */
export function shapeSlot(shape: GearShape): WornSlotSprite {
  return WORN_SLOT_SPRITES.find((slot) =>
    (SLOT_SHAPES[slot] as readonly GearShape[]).includes(shape),
  ) as WornSlotSprite;
}

/** The shape and colours of one id on the sprite sheet, or null. Exposed for tests. */
export function gearSheetEntry(
  id: string,
): { shape: GearShape; rows: readonly string[]; palette: Palette } | null {
  const definition = gearDefinition(id);
  return definition
    ? { shape: definition.shape, rows: GEAR_SHAPES[definition.shape], palette: definition.palette }
    : null;
}

// --- Pets -----------------------------------------------------------------------------------

/** The six core pets (shared `PET_IDS`), each with a shape and palette of its own. */
export const PET_SPRITE_IDS = [
  'linter-cat',
  'rubber-duck',
  'flaky-wisp',
  'goblin-runt',
  'garbage-collectors-mote',
  'owl',
] as const;
export type PetSpriteId = (typeof PET_SPRITE_IDS)[number];

const PET_ROWS: Readonly<Record<PetSpriteId, readonly string[]>> = {
  'linter-cat': fit([
    '.....D....D.....',
    '.....DD..DD.....',
    '....DMMMMMMD....',
    '....MMMMMMMM....',
    '....MEMMMMEM....',
    '....MMMMNMMM....',
    '.....MMMMMM.....',
    '....MMMLLMMM....',
    '...MMMMLLMMMM...',
    '...MMMMMMMMMMD..',
    '...MMMMMMMMMMMD.',
    '...MM.MMMM.MM.D.',
    '..LLL.LLLL.LLL..',
  ]),
  'rubber-duck': fit([
    '......MMMM......',
    '.....MMMMMM.....',
    '.....MMEMMMTT...',
    '.....MMMMMMT....',
    '......MMMM......',
    '....MMMMMMMM....',
    '...MMMMMMMMMMD..',
    '..DMMLLMMMMMMMD.',
    '..DMMLLLMMMMMMD.',
    '...DMMMMMMMMMD..',
    '....DDMMMMMDD...',
    '......TT.TT.....',
  ]),
  'flaky-wisp': fit([
    '.......LL.......',
    '......LMML......',
    '.....LMMMML.....',
    '....LMEMMEML....',
    '....LMMMMMML....',
    '....LMMMMMML....',
    '.....MMMMMM.....',
    '.....MMMMMM.....',
    '......MMMM......',
    '.......MM.......',
    '......D..D......',
    '.....D....D.....',
  ]),
  'goblin-runt': fit([
    '.LL..MMMMMM..LL.',
    '..LLMMMMMMMMLL..',
    '....MEMMMMEM....',
    '....MMMMMMMM....',
    '....MMTTTTMM....',
    '.....MMMMMM.....',
    '...DDMMMMMMDD...',
    '..DDDMMMMMMDDD..',
    '...D.MMLLMM.D...',
    '.....MMMMMM.....',
    '.....MM..MM.....',
    '....DDD..DDD....',
  ]),
  'garbage-collectors-mote': fit([
    '.......G........',
    '.......G........',
    '...G...L...G....',
    '....G.LLL.G.....',
    '.....LLMLL......',
    '..GGLLMMMLLGG...',
    '.....LLMLL......',
    '....G.LLL.G.....',
    '...G...L...G....',
    '.......D........',
    '.......D........',
  ]),
  owl: fit([
    '....D......D....',
    '....DD....DD....',
    '....DMMMMMMD....',
    '....MLLMMLLM....',
    '...MLEEMMEELM...',
    '...MLEKMMKELM...',
    '....MLLMMLLM....',
    '.....MMTTMM.....',
    '....MMLLLLMM....',
    '...MMLMLLMLMM...',
    '...MMLLMMLLMM...',
    '...DMMLLLLMMD...',
    '....DMMMMMMD....',
    '....TT....TT....',
  ]),
};

const PET_PALETTES: Readonly<Record<PetSpriteId, Palette>> = {
  'linter-cat': { M: '#8a93a6', L: '#c9d1e0', D: '#3a3f4c', E: '#ffe26a', N: '#e89aa0' },
  'rubber-duck': { M: '#ffd23f', L: '#ffe98a', D: '#c99a1b', E: '#111111', T: '#ff8a3d' },
  'flaky-wisp': { M: '#9fe6ff', L: '#e6fbff', D: '#3a8fb5', E: '#111111' },
  'goblin-runt': { M: '#5fae46', L: '#8fd16f', D: '#2f6a24', E: '#ff3b3b', T: '#ffffff' },
  'garbage-collectors-mote': { M: '#a371f7', L: '#e0ccff', D: '#4a2a8a', G: '#ffe26a' },
  owl: { M: '#a07a4a', L: '#dcc296', D: '#4e3a1e', E: '#ffe26a', K: '#111111', T: '#ff9c2b' },
};

/** Pets only Feats award have no art of their own yet: a drawn sprite that suits them, or none. */
const FEAT_PET_FALLBACKS: Readonly<Record<string, SpriteName | null>> = {
  'many-armed-goblin': 'goblin',
  'hot-potato': 'potato',
  'pager-gremlin': 'imp',
  'polyglot-parrot': null,
  'coin-mote': null,
};

export function isPetSpriteId(value: string): value is PetSpriteId {
  return (PET_SPRITE_IDS as readonly string[]).includes(value);
}

/** The shape and colours a core pet draws with, for tests. */
export function petSheetEntry(id: PetSpriteId): { rows: readonly string[]; palette: Palette } {
  return { rows: PET_ROWS[id], palette: PET_PALETTES[id] };
}

// --- What a piece draws ------------------------------------------------------------------------

/** The fields of a `GearPiece` the art depends on (a pet is `{ slot: 'pet', ref: petId }`). */
export interface GearSpriteInput {
  slot: GearSlot;
  tier?: GearTierId | undefined;
  look?: GearTierId | undefined;
  unique?: 'region' | 'feat' | 'reclaimed' | undefined;
  ref?: string | undefined;
}

export type GearSpriteRender =
  /** A sprite drawn from the sheet above. */
  | { kind: 'paths'; id: string; paths: SpritePath[] }
  /** A pet that borrows a sprite already drawn. */
  | { kind: 'sprite'; name: SpriteName }
  /** Nothing drawn for it yet: the caller shows an initial. */
  | { kind: 'none' };

/** The sheet id a worn piece draws as. Null for a pet (see `gearSpriteFor`). */
export function gearSpriteId(piece: GearSpriteInput): string | null {
  const slot = wornSlotOf(piece.slot);
  if (!slot) {
    return null;
  }
  if (piece.unique === 'reclaimed') {
    return `reclaimed-${slot}`;
  }
  if (piece.ref && UNIQUE_LOOKS[piece.ref]) {
    return `unique-${piece.ref}`;
  }
  return `${slot}-${piece.look ?? piece.tier ?? 'leather'}`;
}

/**
 * What to draw for a piece. `capeColor` (a hex colour from the Dyes) repaints the cape's cloth; it has no
 * effect on any other slot.
 */
export function gearSpriteFor(
  piece: GearSpriteInput,
  options: { capeColor?: string | null } = {},
): GearSpriteRender {
  if (piece.slot === 'pet') {
    const pet = piece.ref ?? '';
    if (isPetSpriteId(pet)) {
      return {
        kind: 'paths',
        id: `pet-${pet}`,
        paths: pathsOf(PET_ROWS[pet], { ...BASE_PALETTE, ...PET_PALETTES[pet] }),
      };
    }
    const fallback = FEAT_PET_FALLBACKS[pet];
    return fallback ? { kind: 'sprite', name: fallback } : { kind: 'none' };
  }
  const id = gearSpriteId(piece);
  const definition = id ? gearDefinition(id) : null;
  if (!id || !definition) {
    return { kind: 'none' };
  }
  let palette = definition.palette;
  if (piece.slot === 'cape' && options.capeColor) {
    palette = {
      ...palette,
      M: options.capeColor,
      L: lighten(options.capeColor, 0.35),
      D: shade(options.capeColor, 0.45),
    };
  }
  return { kind: 'paths', id, paths: pathsOf(GEAR_SHAPES[definition.shape], palette) };
}
