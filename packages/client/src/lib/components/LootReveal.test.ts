import { afterEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { makePiece, reclaimedPiece } from '@mergescape/shared';
import type { LootItem } from '@mergescape/shared';
import { mockReducedMotion, restoreMatchMedia, textOf } from '../../test/helpers';
import { fixtureSatchel } from '../fixtures/depth';
import FeatBanner from './FeatBanner.svelte';
import GearSprite from './GearSprite.svelte';
import LootReveal from './LootReveal.svelte';
import Satchel from './Satchel.svelte';

const LOOT: LootItem[] = [
  { kind: 'material', material: 'ore', quantity: 4 },
  { kind: 'gear', piece: makePiece({ id: 'a', slot: 'body', tier: 'silver' }) },
  { kind: 'charm_pack', seed: 9 },
  { kind: 'unique', piece: reclaimedPiece('r', 'trinket', 'Ambrel of the Low Road') },
];

afterEach(() => {
  restoreMatchMedia();
});

describe('LootReveal (game-design.md section 9, moment 3)', () => {
  it('flips the cards left to right while it plays, each behind a face-down card', () => {
    mockReducedMotion(false);
    const { container } = render(LootReveal, { loot: LOOT });
    const reveal = container.querySelector('.reveal') as HTMLElement;
    expect(reveal.getAttribute('data-motion')).toBe('flip');
    const slots = [...container.querySelectorAll('.slot')] as HTMLElement[];
    expect(slots).toHaveLength(4);
    // Each card is delayed by its position, so they turn in order.
    expect(slots.map((slot) => slot.style.getPropertyValue('--i'))).toEqual(['0', '1', '2', '3']);
    expect(container.querySelectorAll('.back')).toHaveLength(4);
    // Cards are real text in the page from the start.
    expect(screen.getAllByRole('article')).toHaveLength(4);
  });

  it('gives rare and legendary cards a glint, and the others none', () => {
    mockReducedMotion(false);
    const { container } = render(LootReveal, { loot: LOOT });
    const cards = [...container.querySelectorAll('article')];
    expect(cards.map((card) => card.classList.contains('glint'))).toEqual([
      false,
      false,
      true,
      true,
    ]);
    expect(cards.map((card) => card.classList[1])).toEqual([
      'common',
      'uncommon',
      'rare',
      'legendary',
    ]);
  });

  it('captions a unique with its one line, and a Reclaimed one with its former owner', () => {
    const { container } = render(LootReveal, { loot: LOOT });
    expect(textOf(container)).toContain('Former owner: Ambrel of the Low Road');
    expect(textOf(container)).toContain('Three Charms inside. Keep one.');
  });

  it('collapses to a fade under prefers-reduced-motion: no skip button and no flip', () => {
    mockReducedMotion(true);
    const { container } = render(LootReveal, { loot: LOOT });
    expect(container.querySelector('.reveal')?.getAttribute('data-motion')).toBe('fade');
    expect(screen.queryByRole('button', { name: 'Skip' })).toBeNull();
    expect(screen.getAllByRole('article')).toHaveLength(4);
  });

  it('skips on request', async () => {
    mockReducedMotion(false);
    const { container } = render(LootReveal, { loot: LOOT });
    await fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    expect(container.querySelector('.reveal')?.getAttribute('data-motion')).toBe('still');
    expect(screen.queryByRole('button', { name: 'Skip' })).toBeNull();
  });

  it('settles by itself once the cards have turned', async () => {
    mockReducedMotion(true);
    const { container } = render(LootReveal, { loot: [LOOT[0] as LootItem] });
    await waitFor(
      () => expect(container.querySelector('.reveal')?.getAttribute('data-motion')).toBe('still'),
      { timeout: 2000 },
    );
  });

  it('shows the cards face up, announcing nothing, when it is not playing', () => {
    mockReducedMotion(false);
    const { container } = render(LootReveal, { loot: LOOT, play: false });
    expect(container.querySelector('.reveal')?.getAttribute('data-motion')).toBe('still');
    expect(screen.queryByRole('button', { name: 'Skip' })).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('announces the haul once to a screen reader while it plays', () => {
    render(LootReveal, { loot: LOOT });
    expect(screen.getByRole('status').textContent).toBe(
      "4 items: 4 Ore, Silver Armour, Charm pack, Reclaimed Trinket, once Ambrel of the Low Road's.",
    );
    document.body.innerHTML = '';
    render(LootReveal, { loot: [LOOT[0] as LootItem] });
    expect(screen.getByRole('status').textContent).toBe('1 item: 4 Ore.');
  });

  it('draws a pet, a coin and gear sprites', () => {
    const { container } = render(LootReveal, {
      loot: [
        { kind: 'pet', petId: 'owl' },
        { kind: 'coin', year: 7960 },
        { kind: 'gear', piece: makePiece({ id: 'g', slot: 'weapon', tier: 'rune' }) },
      ],
    });
    expect(container.querySelector('[data-sprite="pet-owl"]')).not.toBeNull();
    expect(container.querySelector('[data-sprite="weapon-rune"]')).not.toBeNull();
    expect(textOf(container)).toContain('Coin dated 7960');
  });
});

describe('GearSprite', () => {
  it('draws a piece as a crisp 16x16 SVG at an integer scale, decorative unless labelled', () => {
    const { container } = render(GearSprite, {
      piece: makePiece({ id: 'a', slot: 'weapon', tier: 'iron' }),
      scale: 4,
    });
    const svg = container.querySelector('svg') as SVGElement;
    expect(svg.getAttribute('width')).toBe('64');
    expect(svg.getAttribute('viewBox')).toBe('0 0 16 16');
    expect(svg.getAttribute('shape-rendering')).toBe('crispEdges');
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.getAttribute('data-sprite')).toBe('weapon-iron');
    expect(svg.querySelectorAll('path').length).toBeGreaterThan(2);
  });

  it('names itself when given a label', () => {
    render(GearSprite, {
      piece: makePiece({ id: 'a', slot: 'body', tier: 'rune' }),
      label: 'Rune Armour',
    });
    expect(screen.getByRole('img', { name: 'Rune Armour' })).toBeTruthy();
  });

  it('paints a cape in the dye colour', () => {
    const { container } = render(GearSprite, {
      piece: makePiece({ id: 'a', slot: 'cape', tier: 'iron' }),
      capeColor: '#3a78d8',
    });
    expect(container.innerHTML).toContain('#3a78d8');
  });

  it('draws a pet by its id, borrows a sprite for a Feat pet and falls back on an initial', () => {
    const cat = render(GearSprite, { piece: { slot: 'pet', ref: 'linter-cat' } });
    expect(cat.container.querySelector('[data-sprite="pet-linter-cat"]')).not.toBeNull();
    document.body.innerHTML = '';
    const goblin = render(GearSprite, { piece: { slot: 'pet', ref: 'many-armed-goblin' } });
    expect(goblin.container.querySelector('svg')).not.toBeNull();
    expect(goblin.container.querySelector('[data-sprite]')).toBeNull();
    document.body.innerHTML = '';
    const parrot = render(GearSprite, {
      piece: { slot: 'pet', ref: 'polyglot-parrot', name: 'Polyglot Parrot' },
      label: 'Polyglot Parrot',
    });
    expect(parrot.container.querySelector('svg')).toBeNull();
    expect(screen.getByRole('img', { name: 'Polyglot Parrot' }).textContent).toBe('P');
    document.body.innerHTML = '';
    const bare = render(GearSprite, { piece: { slot: 'pet' } });
    expect(bare.container.querySelector('.initial')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('labels a borrowed sprite too', () => {
    render(GearSprite, { piece: { slot: 'pet', ref: 'hot-potato' }, label: 'Hot Potato' });
    expect(screen.getByRole('img', { name: 'Hot Potato' })).toBeTruthy();
  });
});

describe('Satchel', () => {
  it('lists the six supplies, and a material only once the character has some', () => {
    const { container } = render(Satchel, { satchel: fixtureSatchel({ ore: 3, silver: 2 }) });
    const items = [...container.querySelectorAll('li')].map((li) => textOf(li));
    expect(items).toEqual([
      'Ore 3',
      'Timber 0',
      'Lore 0',
      'Ink 0',
      'Provisions 0',
      'Flux 0',
      'Silver 2',
    ]);
    expect(screen.getByRole('list', { name: 'Satchel' })).toBeTruthy();
  });

  it('formats big numbers and takes a heading', () => {
    render(Satchel, { satchel: fixtureSatchel({ ore: 12345, dragon: 1 }), label: 'Your satchel' });
    const list = screen.getByRole('list', { name: 'Your satchel' });
    expect(textOf(list)).toContain('Ore 12,345');
    expect(textOf(list)).toContain('Dragon scale 1');
  });
});

describe('FeatBanner', () => {
  it('names the Feat and what it gives, links to the list and dismisses on click', async () => {
    const calls: number[] = [];
    render(FeatBanner, { ids: ['spelunker'], onDismiss: () => calls.push(1) });
    const banner = screen.getByRole('status', { name: 'Feat unlocked' });
    expect(within(banner).getByRole('heading', { name: 'Feat unlocked' })).toBeTruthy();
    expect(textOf(banner)).toContain('Spelunker');
    expect(textOf(banner)).toContain('Title: Wayfarer');
    await fireEvent.click(within(banner).getByRole('button', { name: 'Dismiss' }));
    expect(calls).toEqual([1]);
  });

  it('counts several, and names one the catalogue does not know by its id', () => {
    render(FeatBanner, { ids: ['spelunker', 'mystery'], onDismiss: () => {} });
    expect(screen.getByRole('heading', { name: '2 Feats unlocked' })).toBeTruthy();
    expect(screen.getByText('mystery')).toBeTruthy();
  });
});
