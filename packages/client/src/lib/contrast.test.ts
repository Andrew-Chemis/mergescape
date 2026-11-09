import { describe, expect, it } from 'vitest';
import themeCss from './theme.css?raw';

/** The `--name: #hex` declarations of the first `:root` block in theme.css. */
function readTokens(css: string): Record<string, string> {
  const root = /:root\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? '';
  const tokens: Record<string, string> = {};
  for (const match of root.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{3,6})\s*;/g)) {
    tokens[match[1] as string] = match[2] as string;
  }
  return tokens;
}

function channel(value: number): number {
  const s = value / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const full = hex.length === 4 ? `#${[...hex.slice(1)].map((c) => c + c).join('')}` : hex;
  const [r, g, b] = [1, 3, 5].map((i) => channel(Number.parseInt(full.slice(i, i + 2), 16)));
  return 0.2126 * (r as number) + 0.7152 * (g as number) + 0.0722 * (b as number);
}

/** WCAG 2.x contrast ratio. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const tokens = readTokens(themeCss);
const t = (name: string): string => {
  const value = tokens[name];
  if (!value) {
    throw new Error(`token --${name} is not a plain hex colour in theme.css`);
  }
  return value;
};

describe('contrast helper', () => {
  it('matches known WCAG values', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 1);
    expect(contrast('#777777', '#ffffff')).toBeCloseTo(4.48, 1);
  });
});

// Every foreground/background pairing the UI actually draws as body or small text (Requirement 10.5:
// body text at least 4.5:1). jsdom cannot compute colours, so this reads the tokens themselves.
// (--red is only a fill colour, never text, so it is not listed.)
const TEXT_ON_SURFACE: [string, string[]][] = [
  [
    'fg',
    [
      'bg',
      'stone',
      'stone2',
      'panel',
      'row',
      'row-open',
      'rail',
      'track',
      'act-done',
      'act-now',
      'pledge',
    ],
  ],
  [
    'fg-dim',
    ['bg', 'stone', 'stone2', 'panel', 'row', 'row-open', 'rail', 'track', 'act-done', 'act-now'],
  ],
  ['gold', ['bg', 'stone', 'panel', 'row', 'row-open', 'rail', 'track', 'act-now', 'wood']],
  ['parch', ['wood', 'wood2', 'panel', 'pledge', 'stone']],
  ['xp', ['panel', 'row', 'row-open', 'track']],
  ['chips', ['panel', 'row', 'row-open', 'pledge']],
  ['mult', ['panel', 'row', 'row-open']],
  ['purple', ['panel', 'row', 'row-open']],
  // Parchment panels (Last kill, the sample on Landing) use the darker "-ink" accents.
  ['ink', ['parch', 'parch2', 'gold']],
  ['ink-dim', ['parch', 'parch2']],
  ['gold-ink', ['parch']],
  ['xp-ink', ['parch']],
  ['chips-ink', ['parch']],
  ['mult-ink', ['parch']],
  ['purple-ink', ['parch']],
];

describe('theme tokens: text contrast >= 4.5:1', () => {
  for (const [foreground, backgrounds] of TEXT_ON_SURFACE) {
    for (const background of backgrounds) {
      it(`--${foreground} on --${background}`, () => {
        expect(contrast(t(foreground), t(background))).toBeGreaterThanOrEqual(4.5);
      });
    }
  }
});

describe('theme tokens: focus ring', () => {
  it('is visible (3:1) against both the darkest and the lightest surface it can sit on', () => {
    expect(contrast(t('focus'), t('bg'))).toBeGreaterThanOrEqual(3);
    // On parchment the ring's black halo (box-shadow) carries it.
    expect(contrast('#000000', t('parch'))).toBeGreaterThanOrEqual(3);
  });

  it('is declared for :focus-visible', () => {
    expect(themeCss).toMatch(/:focus-visible\s*\{[^}]*outline:\s*3px solid var\(--focus\)/);
  });
});

describe('theme', () => {
  it('commits to one dark scheme', () => {
    expect(themeCss).toContain('color-scheme: dark');
  });

  it('puts no inline style attributes behind a CSP-hostile path (no url() or data URIs)', () => {
    expect(themeCss).not.toMatch(/url\(/);
  });
});
