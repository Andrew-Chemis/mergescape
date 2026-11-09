/**
 * Town's scene: the hero's sprite swaps its gear tier when a level-up crosses into a new one
 * (game-design.md section 9, moment 2), with a blink, or only a fade under reduced motion.
 */
import { render } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import { TIER_SWAP_MS } from '../motion';
import Scene from './Scene.svelte';
import sceneSource from './Scene.svelte?raw';

const hero = (container: HTMLElement) => container.querySelector('.hero') as HTMLElement;
const props = { biome: 'Town', renown: 0, monster: null } as const;

describe('Scene: the backdrop of the biome', () => {
  it.each([
    ['Town', 'town'],
    ['Sewers of Legacy', 'sewers'],
    ['Flaky Marsh', 'marsh'],
  ])('draws %s with the %s backdrop', (biome, backdrop) => {
    const { container } = render(Scene, { ...props, biome, level: 5 });
    const scene = container.querySelector('.scene') as HTMLElement;
    expect(scene.dataset['backdrop']).toBe(backdrop);
    expect(scene.classList.contains(backdrop)).toBe(true);
  });

  it('keeps the last backdrop drawn for the biomes that have none yet', () => {
    for (const biome of ['Dependency Mines', 'Release Peaks', 'The Rebase Abyss']) {
      const { container, unmount } = render(Scene, { ...props, biome, level: 50 });
      expect((container.querySelector('.scene') as HTMLElement).dataset['backdrop']).toBe('marsh');
      unmount();
    }
  });
});

describe('Scene: the gear tier swap', () => {
  it('draws the tier of the level, and does not blink when Town is simply opened', () => {
    const { container } = render(Scene, { ...props, level: 30 });
    expect(hero(container).getAttribute('data-tier')).toBe('Iron');
    expect(hero(container).classList.contains('swap')).toBe(false);
  });

  it('blinks the new look when a level-up crosses into a new tier, then settles', async () => {
    vi.useFakeTimers();
    const { container, rerender } = render(Scene, { ...props, level: 29 });
    expect(hero(container).getAttribute('data-tier')).toBe('Leather');
    await rerender({ ...props, level: 30 });
    expect(hero(container).getAttribute('data-tier')).toBe('Iron');
    expect(hero(container).classList.contains('swap')).toBe(true);
    await vi.advanceTimersByTimeAsync(TIER_SWAP_MS + 1);
    expect(hero(container).classList.contains('swap')).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does nothing for a level-up inside the same tier', async () => {
    const { container, rerender } = render(Scene, { ...props, level: 31 });
    await rerender({ ...props, level: 32 });
    expect(hero(container).classList.contains('swap')).toBe(false);
  });

  it('fades under reduced motion: the swap animation is a fade unless the page allows motion', () => {
    // The CSS decides, from prefers-reduced-motion: the blink lives only in the no-preference block.
    const css = /<style>([\s\S]*?)<\/style>/.exec(sceneSource)?.[1] ?? '';
    const reduced = css.slice(0, css.indexOf('@media (prefers-reduced-motion: no-preference)'));
    const motion = css.slice(css.indexOf('@media (prefers-reduced-motion: no-preference)'));
    expect(reduced).toMatch(/\.hero\.swap\s*\{\s*animation: swap-fade/);
    expect(motion).toMatch(/\.hero\.swap\s*\{\s*animation: swap-blink/);
  });
});
