import { describe, expect, it } from 'vitest';
import {
  GEAR_TIERS,
  PET_IDS,
  UNIQUES,
  makePiece,
  reclaimedPiece,
  uniquePiece,
} from '@mergescape/shared';
import {
  GEAR_SHAPES,
  GEAR_SPRITE_IDS,
  GEAR_TIER_PALETTES,
  gearSheetEntry,
  gearSpriteFor,
  gearSpriteId,
  HERO_PALETTES,
  isPetSpriteId,
  lighten,
  PET_SPRITE_IDS,
  petSheetEntry,
  renderSprite,
  shade,
  shapeSlot,
  SPRITE_GRID,
  spritePaths,
  WORN_SLOT_SPRITES,
} from './sprites';
import type { GearShape, SpritePath } from './sprites';

/** Pixels covered by some paths: every `M x y h w v1 h-w z` run, expanded. */
function covered(paths: readonly SpritePath[]): string[] {
  const pixels: string[] = [];
  for (const path of paths) {
    for (const run of path.d.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)) {
      for (let i = 0; i < Number(run[3]); i += 1) {
        pixels.push(`${Number(run[1]) + i},${run[2]}`);
      }
    }
  }
  return pixels;
}

function paintedPaths(render: ReturnType<typeof gearSpriteFor>): SpritePath[] {
  if (render.kind !== 'paths') {
    throw new Error('expected drawn paths');
  }
  return render.paths;
}

describe('the gear sprite sheet (task 23, Requirement 10.4)', () => {
  it('has at least 30 pieces: 6 tiers in each of the 4 worn slots, and the uniques as variants', () => {
    expect(GEAR_SPRITE_IDS.length).toBeGreaterThanOrEqual(30);
    const crafted = GEAR_SPRITE_IDS.filter((id) => /^(weapon|body|cape|trinket)-/.test(id));
    expect(crafted).toHaveLength(WORN_SLOT_SPRITES.length * GEAR_TIERS.length);
    expect(new Set(GEAR_SPRITE_IDS).size).toBe(GEAR_SPRITE_IDS.length);
  });

  it('draws every shape as 16 rows of 16 characters', () => {
    for (const [name, rows] of Object.entries(GEAR_SHAPES)) {
      expect(rows, name).toHaveLength(SPRITE_GRID);
      for (const row of rows) {
        expect(row, name).toHaveLength(SPRITE_GRID);
        expect(row, name).toMatch(/^[.A-Z]+$/);
      }
    }
  });

  it.each(GEAR_SPRITE_IDS)(
    '%s draws inside the grid, with no overlapping runs and no holes',
    (id) => {
      const entry = gearSheetEntry(id);
      expect(entry).not.toBeNull();
      const render = gearSpriteFor(
        // Recover a piece that draws as this id.
        pieceFor(id),
      );
      expect(render).toMatchObject({ kind: 'paths', id });
      const pixels = covered(paintedPaths(render));
      expect(pixels.length).toBeGreaterThan(12);
      expect(new Set(pixels).size).toBe(pixels.length);
      // Every letter the shape uses has a colour in its palette (nothing renders as a hole).
      const letters = new Set(
        (entry as NonNullable<typeof entry>).rows.join('').replaceAll('.', ''),
      );
      for (const letter of letters) {
        expect(
          (entry as NonNullable<typeof entry>).palette[letter],
          `${id} letter ${letter}`,
        ).toBeDefined();
      }
    },
  );

  it('gives each of the 24 crafted pieces its own look', () => {
    const renders = new Set(
      GEAR_SPRITE_IDS.filter((id) => /^(weapon|body|cape|trinket)-/.test(id)).map((id) =>
        JSON.stringify(paintedPaths(gearSpriteFor(pieceFor(id)))),
      ),
    );
    expect(renders.size).toBe(24);
  });

  it('pairs the tiers on three shapes per slot, so a better tier looks like better kit', () => {
    const shapeOf = (slot: string, tier: string) => gearSheetEntry(`${slot}-${tier}`)?.shape;
    for (const slot of WORN_SLOT_SPRITES) {
      expect(shapeOf(slot, 'leather')).toBe(shapeOf(slot, 'iron'));
      expect(shapeOf(slot, 'silver')).toBe(shapeOf(slot, 'mithril'));
      expect(shapeOf(slot, 'rune')).toBe(shapeOf(slot, 'dragon'));
      expect(
        new Set([shapeOf(slot, 'iron'), shapeOf(slot, 'silver'), shapeOf(slot, 'rune')]).size,
      ).toBe(3);
    }
  });

  it('draws every named unique in the shape of its own slot', () => {
    for (const unique of UNIQUES) {
      const id = `unique-${unique.id}`;
      expect(GEAR_SPRITE_IDS, unique.id).toContain(id);
      const shape = gearSheetEntry(id)?.shape as GearShape;
      expect(shapeSlot(shape), unique.id).toBe(unique.slot);
    }
    // Nothing on the sheet is a unique the catalogue does not have.
    const uniqueIds = GEAR_SPRITE_IDS.filter((id) => id.startsWith('unique-'));
    expect(uniqueIds).toHaveLength(UNIQUES.length);
  });

  it('draws a Reclaimed piece per slot in the Spire palette', () => {
    for (const slot of WORN_SLOT_SPRITES) {
      const piece = reclaimedPiece('r', slot, 'Ambrel of the Low Road');
      expect(gearSpriteId(piece)).toBe(`reclaimed-${slot}`);
      expect(gearSheetEntry(`reclaimed-${slot}`)?.palette['T']).toBe('#a371f7');
    }
  });

  it('knows nothing about ids that are not on the sheet', () => {
    expect(gearSheetEntry('weapon-wood')).toBeNull();
    expect(gearSheetEntry('unique-nope')).toBeNull();
    expect(gearSheetEntry('reclaimed-pet')).toBeNull();
    expect(gearSheetEntry('nonsense')).toBeNull();
  });
});

describe('what a piece draws as', () => {
  it('uses the tier it looks like, so a Monolith Plate wears Dragon art over Iron Power', () => {
    expect(gearSpriteId(makePiece({ id: 'a', slot: 'weapon', tier: 'iron' }))).toBe('weapon-iron');
    expect(gearSpriteId(makePiece({ id: 'b', slot: 'body', tier: 'iron', look: 'dragon' }))).toBe(
      'body-dragon',
    );
    // Old pieces stored without a tier still draw.
    expect(gearSpriteId({ slot: 'cape' })).toBe('cape-leather');
  });

  it('draws a named unique as its own variant, and any other piece by slot and tier', () => {
    const unique = uniquePiece(UNIQUES[0]!, 'u');
    expect(gearSpriteId(unique)).toBe(`unique-${UNIQUES[0]!.id}`);
    // A ref the sheet does not know falls back on slot and tier.
    expect(gearSpriteId({ slot: 'weapon', tier: 'rune', ref: 'unknown' })).toBe('weapon-rune');
  });

  it('paints the cape in a Dyes colour, and only the cape', () => {
    const plain = paintedPaths(gearSpriteFor({ slot: 'cape', tier: 'iron' }));
    const dyed = paintedPaths(
      gearSpriteFor({ slot: 'cape', tier: 'iron' }, { capeColor: '#3a78d8' }),
    );
    expect(dyed.map((path) => path.fill)).toContain('#3a78d8');
    expect(plain.map((path) => path.fill)).not.toContain('#3a78d8');
    const blade = JSON.stringify(gearSpriteFor({ slot: 'weapon', tier: 'iron' }));
    expect(
      JSON.stringify(gearSpriteFor({ slot: 'weapon', tier: 'iron' }, { capeColor: '#3a78d8' })),
    ).toBe(blade);
  });

  it('has nothing drawn for a pet-less pet slot or a shapeless piece', () => {
    expect(gearSpriteFor({ slot: 'pet' })).toEqual({ kind: 'none' });
    expect(gearSpriteFor({ slot: 'pet', ref: 'polyglot-parrot' })).toEqual({ kind: 'none' });
  });
});

describe('the six core pets', () => {
  it('are the shared PET_IDS, each 16x16 and palette-indexed', () => {
    expect([...PET_SPRITE_IDS]).toEqual([...PET_IDS]);
    expect(PET_SPRITE_IDS).toHaveLength(6);
    for (const id of PET_SPRITE_IDS) {
      const { rows, palette } = petSheetEntry(id);
      expect(rows, id).toHaveLength(SPRITE_GRID);
      for (const row of rows) {
        expect(row, id).toHaveLength(SPRITE_GRID);
      }
      for (const letter of new Set(rows.join('').replaceAll('.', ''))) {
        expect(palette[letter], `${id} letter ${letter}`).toBeDefined();
      }
      const render = gearSpriteFor({ slot: 'pet', ref: id });
      expect(render).toMatchObject({ kind: 'paths', id: `pet-${id}` });
      const pixels = covered(paintedPaths(render));
      expect(new Set(pixels).size).toBe(pixels.length);
      expect(pixels.length).toBeGreaterThan(20);
    }
  });

  it('look different from one another', () => {
    const renders = new Set(
      PET_SPRITE_IDS.map((id) => JSON.stringify(gearSpriteFor({ slot: 'pet', ref: id }))),
    );
    expect(renders.size).toBe(6);
  });

  it('lend a drawn sprite to the Feat pets that suit one, and draw nothing for the rest', () => {
    expect(gearSpriteFor({ slot: 'pet', ref: 'many-armed-goblin' })).toEqual({
      kind: 'sprite',
      name: 'goblin',
    });
    expect(gearSpriteFor({ slot: 'pet', ref: 'hot-potato' })).toEqual({
      kind: 'sprite',
      name: 'potato',
    });
    expect(gearSpriteFor({ slot: 'pet', ref: 'pager-gremlin' })).toEqual({
      kind: 'sprite',
      name: 'imp',
    });
    expect(gearSpriteFor({ slot: 'pet', ref: 'coin-mote' })).toEqual({ kind: 'none' });
    expect(isPetSpriteId('owl')).toBe(true);
    expect(isPetSpriteId('coin-mote')).toBe(false);
  });
});

describe('the hero look (Requirement 16.4)', () => {
  it('has a Silver palette beside the seven level palettes', () => {
    expect(HERO_PALETTES).toHaveLength(7);
    expect(renderSprite('hero', { palette: 'silver' })).not.toBe(
      renderSprite('hero', { palette: 'iron' }),
    );
    expect(renderSprite('hero', { palette: 'silver' })).not.toBe(
      renderSprite('hero', { palette: 'mithril' }),
    );
  });

  it('draws a cape only when one is worn, in the colour it is given', () => {
    const bare = covered(spritePaths('hero', 'iron'));
    const caped = covered(spritePaths('hero', 'iron', '#3a78d8'));
    expect(caped.length).toBeGreaterThan(bare.length);
    // The cape sits behind the body: it adds pixels and takes none away.
    for (const pixel of bare) {
      expect(caped).toContain(pixel);
    }
    const fills = spritePaths('hero', 'iron', '#3a78d8').map((path) => path.fill);
    expect(fills).toContain('#3a78d8');
    expect(fills).toContain(shade('#3a78d8', 0.35));
    expect(spritePaths('hero', 'iron').map((path) => path.fill)).not.toContain('#3a78d8');
    expect(renderSprite('hero', { palette: 'iron', cape: '#3a78d8' })).toContain('#3a78d8');
    // Other sprites ignore a cape colour.
    expect(spritePaths('goblin').length).toBe(spritePaths('goblin', 'rags', '#3a78d8').length);
  });

  it('keeps the silhouette the same in every palette, cape or not', () => {
    const shapes = [...HERO_PALETTES, 'silver' as const].map((palette) =>
      covered(spritePaths('hero', palette, '#b3272b'))
        .sort()
        .join(';'),
    );
    expect(new Set(shapes).size).toBe(1);
  });

  it('shades and lightens a colour toward black and white', () => {
    expect(shade('#808080', 0.5)).toBe('#404040');
    expect(shade('#808080', 2)).toBe('#000000');
    expect(lighten('#000000', 0.5)).toBe('#808080');
    expect(lighten('#ffffff', 0.5)).toBe('#ffffff');
    expect(lighten('#101010', -1)).toBe('#101010');
  });

  it('matches the hero tier palettes in the gear tier colours', () => {
    for (const tier of GEAR_TIERS) {
      expect(GEAR_TIER_PALETTES[tier]['M']).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});

/** A piece that draws as the given sheet id. */
function pieceFor(id: string) {
  const reclaimed = /^reclaimed-(\w+)$/.exec(id);
  if (reclaimed) {
    return reclaimedPiece('r', reclaimed[1] as 'weapon', 'Ambrel of the Low Road');
  }
  const unique = /^unique-(.+)$/.exec(id);
  if (unique) {
    return uniquePiece(
      UNIQUES.find((candidate) => candidate.id === unique[1])!,
      'u',
    );
  }
  const [slot, tier] = id.split('-') as ['weapon', 'iron'];
  return makePiece({ id: 'c', slot, tier });
}
