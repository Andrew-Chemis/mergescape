import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import { cuesHeard, soundOnAfterGesture, stubAudio } from '../../test/audio';
import { mockReducedMotion } from '../../test/helpers';
import { LEVEL_UP_MS } from '../motion';
import type { LevelUp } from '../session.svelte';
import LevelUpFlash from './LevelUpFlash.svelte';

const base: LevelUp = { id: 1, level: 50, from: 49, skill: 'vigilance', newTier: 'Mithril' };

describe('LevelUpFlash', () => {
  it('announces the level, the skill and a new gear tier as plain text', () => {
    render(LevelUpFlash, { levelUp: base, onDone: () => {} });
    const status = screen.getByRole('status');
    expect(status.textContent).toContain('Level up!');
    expect(status.textContent).toContain('Level 50');
    expect(status.textContent).toContain('Vigilance led the way.');
    expect(status.textContent).toContain('New gear tier: Mithril.');
  });

  it('leaves out the skill and tier lines when there are none', () => {
    render(LevelUpFlash, { levelUp: { ...base, skill: null, newTier: null }, onDone: () => {} });
    const text = screen.getByRole('status').textContent ?? '';
    expect(text).not.toContain('led the way');
    expect(text).not.toContain('gear tier');
  });

  it('washes the screen once in the skill colour, without trapping clicks', () => {
    render(LevelUpFlash, { levelUp: base, onDone: () => {} });
    const wash = document.querySelector('.wash') as HTMLElement;
    expect(wash).not.toBeNull();
    expect(wash.getAttribute('aria-hidden')).toBe('true');
    expect(wash.style.getPropertyValue('--flash')).toBe('var(--skill-vigilance)');
  });

  it('has no flash under prefers-reduced-motion, only the message', () => {
    mockReducedMotion(true);
    render(LevelUpFlash, { levelUp: base, onDone: () => {} });
    expect(document.querySelector('.wash')).toBeNull();
    expect(document.querySelector('.flash.reduced')).not.toBeNull();
    expect(screen.getByText('Level up!')).toBeTruthy();
  });

  it('finishes by itself after a couple of seconds and only once', async () => {
    vi.useFakeTimers();
    const onDone = vi.fn();
    render(LevelUpFlash, { levelUp: base, onDone });
    await vi.advanceTimersByTimeAsync(LEVEL_UP_MS - 1);
    expect(onDone).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2);
    expect(onDone).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('is a one-to-two second moment', () => {
    expect(LEVEL_UP_MS).toBeGreaterThanOrEqual(1000);
    expect(LEVEL_UP_MS).toBeLessThanOrEqual(2000);
  });

  it('is skippable: a click on the message dismisses it at once, and so does Escape', async () => {
    const onDone = vi.fn();
    render(LevelUpFlash, { levelUp: base, onDone });
    await fireEvent.click(screen.getByText('Level up!'));
    expect(onDone).toHaveBeenCalledTimes(1);
    await fireEvent.keyDown(window, { key: 'Enter' });
    expect(onDone).toHaveBeenCalledTimes(1);
    await fireEvent.keyDown(window, { key: 'Escape' });
    expect(onDone).toHaveBeenCalledTimes(2);
  });

  it('plays its cue once, only when sound is on, and again for a back-to-back level-up', async () => {
    const silent = stubAudio();
    const first = render(LevelUpFlash, { levelUp: base, onDone: () => {} });
    expect(silent.contexts).toHaveLength(0);
    first.unmount();

    const audio = soundOnAfterGesture();
    const { rerender } = render(LevelUpFlash, { levelUp: base, onDone: () => {} });
    expect(cuesHeard(audio)).toEqual(['levelUp']);
    await rerender({ levelUp: { ...base, id: 2, level: 51 }, onDone: () => {} });
    expect(cuesHeard(audio)).toEqual(['levelUp', 'levelUp']);
  });

  it('restarts its timer for a back-to-back level-up and clears it on unmount', async () => {
    vi.useFakeTimers();
    const onDone = vi.fn();
    const { rerender, unmount } = render(LevelUpFlash, { levelUp: base, onDone });
    await vi.advanceTimersByTimeAsync(LEVEL_UP_MS - 500);
    await rerender({ levelUp: { ...base, id: 2, level: 51 }, onDone });
    await vi.advanceTimersByTimeAsync(600);
    expect(onDone).not.toHaveBeenCalled();
    expect(screen.getByText('Level 51')).toBeTruthy();
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
