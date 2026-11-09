import { describe, expect, it } from 'vitest';
import { GEAR_TIER_LEVELS } from '@mergescape/shared';
import { MONSTER_NAMES } from './names';
import {
  charmSprite,
  CHARM_SPRITES,
  gearTierFor,
  heroPaletteFor,
  HERO_PALETTES,
  integerScale,
  MOGUL_SPRITES,
  MONSTER_SPRITE,
  MONSTER_SPRITES,
  nextGearTier,
  paletteForTier,
  renderSprite,
  SPRITE_NAMES,
  spritePaths,
} from './sprites';
import type { SpriteName } from './sprites';

/** Pixels covered by a sprite's paths: every `M x y h w v1 h-w z` run, expanded. */
function coveredPixels(
  name: SpriteName,
  palette: (typeof HERO_PALETTES)[number] = 'rags',
): string[] {
  const pixels: string[] = [];
  for (const path of spritePaths(name, palette)) {
    for (const run of path.d.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)) {
      const [x, y, width] = [Number(run[1]), Number(run[2]), Number(run[3])];
      for (let i = 0; i < width; i += 1) {
        pixels.push(`${x + i},${y}`);
      }
    }
  }
  return pixels;
}

describe('sprite set', () => {
  it('has the hero, 8 monsters, 6 Moguls and 3 Charm icons', () => {
    expect(MONSTER_SPRITES).toHaveLength(8);
    expect(MOGUL_SPRITES).toHaveLength(6);
    expect(CHARM_SPRITES).toHaveLength(3);
    // hero, sleeping hero, monsters, Moguls, Charms
    expect(SPRITE_NAMES).toHaveLength(1 + 1 + 8 + 6 + 3);
  });

  it('has the hero in 7 palettes, one per gear tier', () => {
    expect(HERO_PALETTES).toHaveLength(7);
    expect(HERO_PALETTES).toHaveLength(GEAR_TIER_LEVELS.length);
    const renders = new Set(HERO_PALETTES.map((palette) => renderSprite('hero', { palette })));
    expect(renders.size).toBe(7);
  });

  it('maps every Bestiary id to a sprite', () => {
    expect(Object.keys(MONSTER_SPRITE).sort()).toEqual(Object.keys(MONSTER_NAMES).sort());
    for (const sprite of Object.values(MONSTER_SPRITE)) {
      expect(SPRITE_NAMES).toContain(sprite);
    }
  });

  it.each(SPRITE_NAMES)('%s draws inside the 16x16 grid without overlapping runs', (name) => {
    const pixels = coveredPixels(name);
    expect(pixels.length).toBeGreaterThan(8);
    expect(new Set(pixels).size).toBe(pixels.length);
    for (const pixel of pixels) {
      const [x, y] = pixel.split(',').map(Number) as [number, number];
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(16);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThan(16);
    }
  });

  it('paints the same pixels in every hero palette', () => {
    const silhouettes = HERO_PALETTES.map((palette) =>
      coveredPixels('hero', palette).sort().join(';'),
    );
    expect(new Set(silhouettes).size).toBe(1);
  });

  it('draws the Flaky Test Wraith translucent', () => {
    const translucent = spritePaths('wraith').filter((path) => path.opacity !== undefined);
    expect(translucent).toHaveLength(1);
    expect(translucent[0]?.opacity).toBe(0.78);
  });

  it('draws the sleeping hero with closed eyes (same size, different pixels)', () => {
    expect(renderSprite('hero-asleep')).not.toBe(renderSprite('hero'));
    expect(coveredPixels('hero-asleep')).toHaveLength(coveredPixels('hero').length);
  });
});

describe('renderSprite', () => {
  it('emits inline SVG with crisp edges at an integer scale', () => {
    const svg = renderSprite('goblin', { scale: 3 });
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('shape-rendering="crispEdges"');
    expect(svg).toContain('width="48"');
    expect(svg).toContain('height="48"');
    expect(svg).toContain('viewBox="0 0 16 16"');
    expect(svg).toContain('<path');
  });

  it('rounds fractional or bad scales to whole pixels', () => {
    expect(integerScale(2.6)).toBe(3);
    expect(integerScale(0)).toBe(1);
    expect(integerScale(-4)).toBe(1);
    expect(integerScale(Number.NaN)).toBe(1);
    expect(renderSprite('imp', { scale: 2.4 })).toContain('width="32"');
  });

  it('hides decorative sprites from assistive technology and names labelled ones', () => {
    expect(renderSprite('duck')).toContain('aria-hidden="true"');
    const labelled = renderSprite('duck', { label: 'Rubber Duck "deluxe"' });
    expect(labelled).toContain('role="img"');
    expect(labelled).toContain('aria-label="Rubber Duck &quot;deluxe&quot;"');
    expect(labelled).not.toContain('aria-hidden');
  });
});

describe('gear tiers (Requirement 5.4)', () => {
  it.each([
    [1, 'Rags'],
    [9, 'Rags'],
    [10, 'Leather'],
    [29, 'Leather'],
    [30, 'Iron'],
    [49, 'Iron'],
    [50, 'Mithril'],
    [69, 'Mithril'],
    [70, 'Rune'],
    [89, 'Rune'],
    [90, 'Dragon'],
    [98, 'Dragon'],
    [99, 'Trimmed'],
  ])('level %i wears %s', (level, tier) => {
    expect(gearTierFor(level).tier).toBe(tier);
  });

  it('uses the cape palette for the Trimmed tier and finds the next tier', () => {
    expect(heroPaletteFor(99)).toBe('cape');
    expect(paletteForTier('Iron')).toBe('iron');
    expect(nextGearTier(41)).toMatchObject({ tier: 'Mithril', level: 50 });
    expect(nextGearTier(99)).toBeNull();
  });
});

describe('charmSprite', () => {
  it('knows the three drawn Charm icons and nothing else', () => {
    expect(charmSprite('rubber-duck')).toBe('duck');
    expect(charmSprite('small-hands')).toBe('hands');
    expect(charmSprite('hot-potato')).toBe('potato');
    expect(charmSprite('lantern')).toBeNull();
  });
});
