/**
 * The README badge (Requirement 11, design.md section 11): a 20 px shields-style SVG with the label
 * "mergescape" on the left and "Lv 41 Warden · Renown 17" on the right.
 *
 * Privacy (Requirement 11.1): the badge shows level, Vocation and Renown and nothing else. Its only inputs
 * are three validated values and, for the accessible name, the stored login; the numbers are rebuilt as
 * integers and the Vocation must be one of the five known names, so nothing a profile holds beyond those
 * fields can reach the markup, and every piece of text is XML-escaped anyway. An unknown login renders the
 * neutral "unranked" badge and echoes nothing at all.
 *
 * The SVG has no script, style element, image, link or font file: a system font stack, presentation
 * attributes and a clip path. Colours come from the game palette (`packages/client/src/lib/theme.css`).
 */
import type { Vocation } from './api-types';

/** `Cache-Control` of every badge, unranked ones included: six hours (Requirement 11.1 and 11.3). */
export const BADGE_CACHE_CONTROL = 'public, max-age=21600';

/** `Content-Type` of a badge. */
export const BADGE_CONTENT_TYPE = 'image/svg+xml; charset=utf-8';

export const VOCATIONS: readonly Vocation[] = [
  'Journeyman',
  'Smith',
  'Warden',
  'Herald',
  'Pilgrim',
];

/** Game palette (theme.css): `--stone`, `--fg`, `--wood`, `--gold`, `--ink-dim`. */
export const BADGE_COLORS = {
  labelBackground: '#2a2420',
  labelText: '#efe6d3',
  rankedBackground: '#5a3b1e',
  rankedText: '#f2c14e',
  unrankedBackground: '#5f4f36',
  unrankedText: '#efe6d3',
} as const;

const HEIGHT = 20;
const FONT_SIZE = 11;
const PADDING = 5;
const FONT_FAMILY = 'Verdana,Geneva,DejaVu Sans,sans-serif';
const LABEL = 'mergescape';
const SEPARATOR = '·';

/** The stored values the badge may show. */
export interface BadgeData {
  level: number;
  vocation: string;
  renown: number;
}

/**
 * Where pinned Feats will draw (Requirement 17.7, task 22): icon id to the `d` of a 16 by 16 path. Empty
 * until the Feat icons exist, so a pin that is not listed here is ignored, never echoed.
 */
export const PIN_ICONS: Readonly<Record<string, string>> = {};

/** At most this many pinned Feat icons are drawn. */
export const MAX_PINS = 3;
const PIN_SIZE = 14;
const PIN_GAP = 3;

export interface BadgeOptions {
  /** The stored login, for the accessible name only. Omit it for the unranked badge. */
  login?: string;
  /** Pinned Feat ids, most important first. */
  pins?: readonly string[];
  /** The icon table (tests pass their own; production uses `PIN_ICONS`). */
  icons?: Readonly<Record<string, string>>;
}

/**
 * Escapes text for XML content and attribute values. Anything outside printable ASCII becomes a character
 * reference, so the document is pure ASCII whatever charset a proxy assumes.
 */
export function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    .replace(/[^ -~]/gu, (character) => `&#${character.codePointAt(0) ?? 0};`);
}

/** Advance widths of Verdana in 1/1000 em, for the characters a badge can contain. */
const GLYPH_WIDTHS: Readonly<Record<string, number>> = {
  ' ': 352,
  '-': 361,
  [SEPARATOR]: 440,
  a: 601,
  b: 623,
  c: 521,
  d: 623,
  e: 596,
  f: 352,
  g: 623,
  h: 633,
  i: 274,
  j: 344,
  k: 592,
  l: 274,
  m: 973,
  n: 633,
  o: 607,
  p: 623,
  q: 623,
  r: 427,
  s: 521,
  t: 394,
  u: 633,
  v: 592,
  w: 818,
  x: 592,
  y: 592,
  z: 525,
  A: 684,
  B: 686,
  C: 698,
  D: 770,
  E: 632,
  F: 575,
  G: 775,
  H: 752,
  I: 421,
  J: 574,
  K: 656,
  L: 557,
  M: 863,
  N: 748,
  O: 787,
  P: 603,
  Q: 787,
  R: 695,
  S: 684,
  T: 616,
  U: 732,
  V: 684,
  W: 989,
  X: 685,
  Y: 615,
  Z: 685,
};
const DIGIT_WIDTH = 636;
const FALLBACK_WIDTH = 600;

/**
 * The width of `text` at the badge's font size, in pixels. It is an estimate of Verdana (shields.io does
 * the same); `textLength` on each `<text>` makes the renderer fit the real font to it.
 */
export function textWidth(text: string): number {
  let units = 0;
  for (const character of text) {
    units += /[0-9]/.test(character) ? DIGIT_WIDTH : (GLYPH_WIDTHS[character] ?? FALLBACK_WIDTH);
  }
  return Math.round((units * FONT_SIZE) / 1000);
}

function wholeNumber(value: number, minimum: number): number {
  return Number.isSafeInteger(value) && value >= minimum ? value : minimum;
}

/** The text of the right-hand side: `Lv 41 Warden · Renown 17`, or `unranked` when there is no player. */
export function badgeValue(data: BadgeData | null): string {
  if (data === null) {
    return 'unranked';
  }
  const vocation = VOCATIONS.find((known) => known === data.vocation) ?? 'Journeyman';
  return `Lv ${wholeNumber(data.level, 1)} ${vocation} ${SEPARATOR} Renown ${wholeNumber(data.renown, 0)}`;
}

function pinIcons(options: BadgeOptions): string[] {
  const icons = options.icons ?? PIN_ICONS;
  const drawn: string[] = [];
  for (const id of options.pins ?? []) {
    const path = Object.hasOwn(icons, id) ? icons[id] : undefined;
    if (path !== undefined && drawn.length < MAX_PINS) {
      drawn.push(path);
    }
  }
  return drawn;
}

/** The badge as an SVG document. `data` is null for a login nobody has signed in with. */
export function renderBadge(data: BadgeData | null, options: BadgeOptions = {}): string {
  const value = badgeValue(data);
  const ranked = data !== null;
  const pins = ranked ? pinIcons(options) : [];

  const labelWidth = textWidth(LABEL) + 2 * PADDING;
  const valueTextWidth = textWidth(value);
  const pinsWidth = pins.length > 0 ? pins.length * (PIN_SIZE + PIN_GAP) : 0;
  const valueWidth = valueTextWidth + 2 * PADDING + pinsWidth;
  const width = labelWidth + valueWidth;

  const owner = ranked && options.login ? ` (${options.login})` : '';
  const name = escapeXml(`${LABEL}: ${value}${owner}`);
  const labelX = labelWidth / 2;
  const valueX = labelWidth + PADDING + valueTextWidth / 2;
  const background = ranked ? BADGE_COLORS.rankedBackground : BADGE_COLORS.unrankedBackground;
  const foreground = ranked ? BADGE_COLORS.rankedText : BADGE_COLORS.unrankedText;
  const text = (x: number, content: string, length: number, fill: string, shadow: boolean) =>
    `<text${shadow ? ' aria-hidden="true"' : ''} x="${x}" y="${shadow ? 15 : 14}" fill="${fill}"${
      shadow ? ' fill-opacity=".3"' : ''
    } textLength="${length}" lengthAdjust="spacingAndGlyphs">${escapeXml(content)}</text>`;
  const icons = pins
    .map((path, index) => {
      const x = labelWidth + PADDING + valueTextWidth + PIN_GAP + index * (PIN_SIZE + PIN_GAP);
      return `<path transform="translate(${x} 3) scale(${PIN_SIZE / 16})" d="${escapeXml(path)}" fill="${foreground}"/>`;
    })
    .join('');

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${HEIGHT}" role="img" aria-label="${name}">`,
    `<title>${name}</title>`,
    '<linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient>',
    `<clipPath id="r"><rect width="${width}" height="${HEIGHT}" rx="3" fill="#fff"/></clipPath>`,
    `<g clip-path="url(#r)"><rect width="${labelWidth}" height="${HEIGHT}" fill="${BADGE_COLORS.labelBackground}"/><rect x="${labelWidth}" width="${valueWidth}" height="${HEIGHT}" fill="${background}"/><rect width="${width}" height="${HEIGHT}" fill="url(#s)"/></g>`,
    `<g text-anchor="middle" font-family="${FONT_FAMILY}" text-rendering="geometricPrecision" font-size="${FONT_SIZE}">`,
    text(labelX, LABEL, labelWidth - 2 * PADDING, '#010101', true),
    text(labelX, LABEL, labelWidth - 2 * PADDING, BADGE_COLORS.labelText, false),
    text(valueX, value, valueTextWidth, '#010101', true),
    text(valueX, value, valueTextWidth, foreground, false),
    icons,
    '</g>',
    '</svg>',
  ].join('');
}
