import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FEATS } from '@mergescape/shared';
import {
  badgeValue,
  BADGE_COLORS,
  COIN_GLYPH,
  escapeXml,
  FEAT_GLYPHS,
  MAX_PINS,
  OLD_COIN_ID,
  PIN_ICONS,
  renderBadge,
  textWidth,
  VOCATIONS,
} from '../src/badge';

// ---------------------------------------------------------------------------------------------
// A small XML well-formedness check (there is no XML parser in the toolchain)
// ---------------------------------------------------------------------------------------------

interface Parsed {
  /** Every element name in document order. */
  elements: string[];
  /** The raw text of every text node. */
  texts: string[];
  /** Every attribute as `element.name`, with its value. */
  attributes: { element: string; name: string; value: string }[];
}

const ENTITIES = /&(?:amp|lt|gt|quot|apos|#\d+);/g;
const TOKEN = /<(\/?)([A-Za-z][\w:-]*)((?:\s+[\w:-]+="[^"<]*")*)\s*(\/?)>|([^<]+)/gy;

/** Throws unless `xml` is one well-formed element tree with valid escaping and quoted attributes. */
function parseXml(xml: string): Parsed {
  const parsed: Parsed = { elements: [], texts: [], attributes: [] };
  const stack: string[] = [];
  let position = 0;
  let roots = 0;
  while (position < xml.length) {
    TOKEN.lastIndex = position;
    const match = TOKEN.exec(xml);
    if (!match) {
      throw new Error(`not well formed near "${xml.slice(position, position + 30)}"`);
    }
    position = TOKEN.lastIndex;
    const [, closing, name, attributes, selfClosing, text] = match;
    if (text !== undefined) {
      if (/[<>"]/.test(text.replace(ENTITIES, '')) || /&/.test(text.replace(ENTITIES, ''))) {
        throw new Error(`bad character data "${text}"`);
      }
      parsed.texts.push(text);
      continue;
    }
    if (closing) {
      if (stack.pop() !== name) {
        throw new Error(`mismatched </${name}>`);
      }
      continue;
    }
    if (stack.length === 0) {
      roots += 1;
    }
    parsed.elements.push(name ?? '');
    for (const attribute of (attributes ?? '').matchAll(/([\w:-]+)="([^"<]*)"/g)) {
      const value = attribute[2] ?? '';
      if (/&/.test(value.replace(ENTITIES, ''))) {
        throw new Error(`bad attribute value "${value}"`);
      }
      parsed.attributes.push({ element: name ?? '', name: attribute[1] ?? '', value });
    }
    if (!selfClosing) {
      stack.push(name ?? '');
    }
  }
  if (stack.length > 0 || roots !== 1) {
    throw new Error('unbalanced document');
  }
  return parsed;
}

function attributeOf(parsed: Parsed, element: string, name: string): string[] {
  return parsed.attributes
    .filter((attribute) => attribute.element === element && attribute.name === name)
    .map((attribute) => attribute.value);
}

/** The visible and hidden strings of a badge, in document order. */
function wordsOf(svg: string): string[] {
  const parsed = parseXml(svg);
  return parsed.texts;
}

function luminance(hex: string): number {
  const channel = (offset: number): number => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05);
}

const RANKED = { level: 41, vocation: 'Warden', renown: 17 };

describe('renderBadge', () => {
  it('is a 20 px shields-style badge: "mergescape" on the left, level, Vocation and Renown on the right', () => {
    const svg = renderBadge(RANKED, { login: 'octo-cat' });
    const parsed = parseXml(svg);
    expect(parsed.elements[0]).toBe('svg');
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(attributeOf(parsed, 'svg', 'height')).toEqual(['20']);
    expect(attributeOf(parsed, 'svg', 'role')).toEqual(['img']);
    // The title, then each text twice (a shadow, hidden from screen readers, and the text itself).
    expect(wordsOf(svg)).toEqual([
      'mergescape: Lv 41 Warden &#183; Renown 17 (octo-cat)',
      'mergescape',
      'mergescape',
      'Lv 41 Warden &#183; Renown 17',
      'Lv 41 Warden &#183; Renown 17',
    ]);
    expect(attributeOf(parsed, 'svg', 'aria-label')).toEqual([
      'mergescape: Lv 41 Warden &#183; Renown 17 (octo-cat)',
    ]);
  });

  it('sizes the background rectangles to the widths it states', () => {
    const parsed = parseXml(renderBadge(RANKED));
    const [width] = attributeOf(parsed, 'svg', 'width').map(Number);
    const rects = parsed.attributes.filter(
      (attribute) => attribute.element === 'rect' && attribute.name === 'width',
    );
    expect(width).toBeGreaterThan(150);
    // The clip path, the label, the value and the gloss: the label and value add up to the whole.
    const [, label, value, gloss] = rects.map((rect) => Number(rect.value));
    expect((label ?? 0) + (value ?? 0)).toBe(width);
    expect(gloss).toBe(width);
  });

  it('renders the neutral unranked badge when there is no player, echoing nothing', () => {
    const svg = renderBadge(null, { login: 'someone-else' });
    expect(wordsOf(svg)).toEqual([
      'mergescape: unranked',
      'mergescape',
      'mergescape',
      'unranked',
      'unranked',
    ]);
    expect(svg).not.toContain('someone-else');
    expect(svg).not.toContain(BADGE_COLORS.rankedBackground);
    expect(svg).toContain(BADGE_COLORS.unrankedBackground);
  });

  it('shows every Vocation by name and falls back to Journeyman for anything else', () => {
    for (const vocation of VOCATIONS) {
      expect(badgeValue({ level: 5, vocation, renown: 2 })).toBe(`Lv 5 ${vocation} · Renown 2`);
    }
    for (const hostile of ['<img src=x onerror=alert(1)>', '', 'warden', 'Warden ', '__proto__']) {
      expect(badgeValue({ level: 5, vocation: hostile, renown: 2 })).toBe(
        'Lv 5 Journeyman · Renown 2',
      );
    }
  });

  it('rebuilds level and Renown as whole numbers', () => {
    const odd = [Number.NaN, -5, 1.5, Number.POSITIVE_INFINITY, 1e21];
    for (const value of odd) {
      expect(badgeValue({ level: value, vocation: 'Smith', renown: value })).toBe(
        'Lv 1 Smith · Renown 0',
      );
    }
    expect(badgeValue({ level: 99, vocation: 'Smith', renown: 0 })).toBe('Lv 99 Smith · Renown 0');
  });

  it('escapes the login and stays well formed, and the document is pure ASCII', () => {
    const hostile = `"><script>alert(1)</script>&'`;
    const svg = renderBadge(RANKED, { login: hostile });
    expect(() => parseXml(svg)).not.toThrow();
    expect(svg).not.toContain('<script');
    expect(svg).toContain('&quot;&gt;&lt;script&gt;');
    expect(svg).toMatch(/^[\x20-\x7e]*$/);
    expect(escapeXml('· \u{1f600}')).toBe('&#183; &#128512;');
  });

  it('has no script, style, image, link, font file or event handler', () => {
    for (const svg of [renderBadge(RANKED, { login: 'octo-cat' }), renderBadge(null)]) {
      const parsed = parseXml(svg);
      for (const forbidden of ['script', 'style', 'image', 'a', 'use', 'foreignObject', 'iframe']) {
        expect(parsed.elements).not.toContain(forbidden);
      }
      expect(svg).not.toMatch(/\son\w+=|href|xlink|@import|<!|<\?|url\((?!#)/i);
      // Everything the document references is inside it.
      expect(svg.match(/url\(([^)]*)\)/g)).toEqual(['url(#r)', 'url(#s)']);
    }
  });

  it('uses the game palette, and its text meets 4.5:1 contrast on every background', () => {
    const theme = readFileSync(
      fileURLToPath(new URL('../../client/src/lib/theme.css', import.meta.url)),
      'utf8',
    ).toLowerCase();
    for (const colour of Object.values(BADGE_COLORS)) {
      expect(theme).toContain(colour);
    }
    expect(contrast(BADGE_COLORS.labelText, BADGE_COLORS.labelBackground)).toBeGreaterThan(4.5);
    expect(contrast(BADGE_COLORS.rankedText, BADGE_COLORS.rankedBackground)).toBeGreaterThan(4.5);
    expect(contrast(BADGE_COLORS.unrankedText, BADGE_COLORS.unrankedBackground)).toBeGreaterThan(
      4.5,
    );
  });

  it('uses a system font stack', () => {
    expect(renderBadge(RANKED)).toContain('font-family="Verdana,Geneva,DejaVu Sans,sans-serif"');
  });
});

describe('pinned Feat icons (Requirement 17.7)', () => {
  const icons = { first_blood: 'M0 0h16v16H0z', mentor: 'M8 0l8 16H0z', dragon: 'M1 1h14v14H1z' };

  it('has a glyph for every Feat in the catalogue, one per category, and the coin for the Old Coin', () => {
    expect(Object.keys(PIN_ICONS).sort()).toEqual(FEATS.map((feat) => feat.id).sort());
    for (const feat of FEATS) {
      expect(PIN_ICONS[feat.id]).toBe(
        feat.id === OLD_COIN_ID ? COIN_GLYPH : FEAT_GLYPHS[feat.category],
      );
    }
    expect(PIN_ICONS[OLD_COIN_ID]).toBe(COIN_GLYPH);
  });

  it('draws pinned Feats of the catalogue by default and ignores a pin it does not know', () => {
    const plain = renderBadge(RANKED, { login: 'octo-cat' });
    const pinned = renderBadge(RANKED, {
      login: 'octo-cat',
      pins: ['surgeon', 'not-a-feat', 'goblin-slayer'],
    });
    expect(parseXml(pinned).elements.filter((element) => element === 'path')).toHaveLength(2);
    expect(pinned).toContain(FEAT_GLYPHS.craft);
    expect(pinned).toContain(FEAT_GLYPHS.world);
    expect(pinned).not.toContain('not-a-feat');
    expect(renderBadge(RANKED, { login: 'octo-cat', pins: ['not-a-feat'] })).toBe(plain);
  });

  it('draws the Old Coin after the pins once found, and only once if it is pinned as well', () => {
    const coin = renderBadge(RANKED, { coin: true });
    expect(coin).toContain(COIN_GLYPH);
    const three = renderBadge(RANKED, {
      pins: ['surgeon', 'goblin-slayer', 'mentor'],
      coin: true,
    });
    // Three pins and the coin.
    expect(parseXml(three).elements.filter((element) => element === 'path')).toHaveLength(4);
    const pinnedCoin = renderBadge(RANKED, { pins: [OLD_COIN_ID, 'surgeon'], coin: true });
    expect(pinnedCoin.split(COIN_GLYPH).length - 1).toBe(1);
    expect(parseXml(pinnedCoin).elements.filter((element) => element === 'path')).toHaveLength(2);
    // No coin flag, no coin; and never on the unranked badge.
    expect(renderBadge(RANKED, {})).not.toContain(COIN_GLYPH);
    expect(renderBadge(null, { coin: true })).toBe(renderBadge(null));
  });

  it('draws one glyph for a Feat pinned twice', () => {
    const svg = renderBadge(RANKED, { pins: ['surgeon', 'surgeon'] });
    expect(parseXml(svg).elements.filter((element) => element === 'path')).toHaveLength(1);
  });

  it('draws the known pins, at most three, and widens the badge to fit them', () => {
    const plain = parseXml(renderBadge(RANKED));
    const pinned = renderBadge(RANKED, {
      pins: ['first_blood', 'nope', 'mentor', 'dragon', 'first_blood'],
      icons,
    });
    const parsed = parseXml(pinned);
    expect(parsed.elements.filter((element) => element === 'path')).toHaveLength(MAX_PINS);
    expect(Number(attributeOf(parsed, 'svg', 'width')[0])).toBeGreaterThan(
      Number(attributeOf(plain, 'svg', 'width')[0]),
    );
  });

  it('ignores ids it does not know, including names every object has, and never echoes them', () => {
    const svg = renderBadge(RANKED, {
      pins: ['__proto__', 'constructor', 'toString', '<script>'],
      icons,
    });
    expect(svg).toBe(renderBadge(RANKED));
    expect(svg).not.toContain('script');
  });

  it('escapes an icon path and draws no pins on the unranked badge', () => {
    const svg = renderBadge(RANKED, { pins: ['evil'], icons: { evil: '"/><script>' } });
    expect(() => parseXml(svg)).not.toThrow();
    expect(svg).not.toContain('<script');
    expect(renderBadge(null, { pins: ['first_blood'], icons })).toBe(renderBadge(null));
  });
});

describe('textWidth', () => {
  it('estimates Verdana at 11 px: wider letters take more room, every digit the same', () => {
    expect(textWidth('')).toBe(0);
    expect(textWidth('W')).toBeGreaterThan(textWidth('i'));
    expect(textWidth('0')).toBe(textWidth('9'));
    expect(textWidth('Renown 100')).toBeGreaterThan(textWidth('Renown 10'));
    // A character outside the table still takes room.
    expect(textWidth('中')).toBeGreaterThan(0);
  });
});
