import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import { fixtureLogEntries } from '../fixtures/state';
import { cuesHeard, soundOnAfterGesture, stubAudio, tickSteps } from '../../test/audio';
import { mockReducedMotion } from '../../test/helpers';
import { TICKER_TOTAL_MS } from '../motion';
import type { LogEntry } from '../types';
import ScoreTicker from './ScoreTicker.svelte';

const NOW = Date.UTC(2026, 10, 11, 14, 5, 0);
const entries = fixtureLogEntries(NOW);
const entry = entries[0] as LogEntry;

const ticker = () => document.querySelector('.ticker') as HTMLElement;
const revealed = () => Number(ticker().dataset['revealed']);
/** Groups (0 Points, 1 Power, 2 Zone, 3 XP) that are currently shown. */
const shownGroups = () =>
  [
    ...new Set(
      [...ticker().querySelectorAll('li.in')].map((li) => (li as HTMLElement).dataset['group']),
    ),
  ]
    .map(Number)
    .sort();

describe('ScoreTicker', () => {
  it('rolls Points, Power, Zone and XP in one at a time over about 1.2 seconds', async () => {
    vi.useFakeTimers();
    render(ScoreTicker, { entry });
    expect(TICKER_TOTAL_MS).toBe(1200);
    expect(ticker().dataset['motion']).toBe('full');

    // Points are there at once; the rest follow.
    expect(revealed()).toBe(1);
    expect(shownGroups()).toEqual([0]);
    expect(ticker().getAttribute('aria-busy')).toBe('true');

    await vi.advanceTimersByTimeAsync(300);
    expect(shownGroups()).toEqual([0, 1]);
    await vi.advanceTimersByTimeAsync(300);
    expect(shownGroups()).toEqual([0, 1, 2]);
    await vi.advanceTimersByTimeAsync(300);
    expect(shownGroups()).toEqual([0, 1, 2, 3]);
    expect(ticker().getAttribute('aria-busy')).toBe('false');
    expect(screen.queryByRole('button', { name: 'Skip' })).toBeNull();

    // Nothing is left scheduled: the roll is over by 900 ms plus the 240 ms slide.
    expect(vi.getTimerCount()).toBe(0);
  });

  it('never shows the XP before the Points, Power and Zone that explain it', async () => {
    vi.useFakeTimers();
    render(ScoreTicker, { entry });
    const order: number[][] = [shownGroups()];
    for (let step = 0; step < 3; step += 1) {
      await vi.advanceTimersByTimeAsync(300);
      order.push(shownGroups());
    }
    expect(order).toEqual([[0], [0, 1], [0, 1, 2], [0, 1, 2, 3]]);
  });

  it('skips to the end on a click anywhere on it', async () => {
    vi.useFakeTimers();
    render(ScoreTicker, { entry });
    expect(shownGroups()).toEqual([0]);
    await fireEvent.click(ticker());
    expect(shownGroups()).toEqual([0, 1, 2, 3]);
    // The roll's own timers are gone (a zero-delay timer from the test library may still be queued).
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('skips with the Skip button, which keyboard users can reach', async () => {
    vi.useFakeTimers();
    render(ScoreTicker, { entry });
    const skip = screen.getByRole('button', { name: 'Skip' });
    skip.focus();
    expect(document.activeElement).toBe(skip);
    await fireEvent.click(skip);
    expect(shownGroups()).toEqual([0, 1, 2, 3]);
    expect(screen.queryByRole('button', { name: 'Skip' })).toBeNull();
  });

  it('collapses to a single fade under prefers-reduced-motion: everything at once, no timers', async () => {
    vi.useFakeTimers();
    mockReducedMotion(true);
    render(ScoreTicker, { entry });
    expect(ticker().dataset['motion']).toBe('reduced');
    expect(ticker().classList.contains('fade')).toBe(true);
    expect(shownGroups()).toEqual([0, 1, 2, 3]);
    expect(revealed()).toBe(4);
    expect(vi.getTimerCount()).toBe(0);
    expect(screen.queryByRole('button', { name: 'Skip' })).toBeNull();
  });

  it('keeps the slide when reduced motion is not requested', () => {
    vi.useFakeTimers();
    mockReducedMotion(false);
    render(ScoreTicker, { entry });
    expect(ticker().dataset['motion']).toBe('full');
    expect(ticker().classList.contains('fade')).toBe(false);
  });

  it('shows everything without animating when asked not to animate', () => {
    vi.useFakeTimers();
    render(ScoreTicker, { entry, animate: false });
    expect(ticker().dataset['motion']).toBe('static');
    expect(shownGroups()).toEqual([0, 1, 2, 3]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('restarts the roll for a different row and cleans up on unmount', async () => {
    vi.useFakeTimers();
    const { rerender, unmount } = render(ScoreTicker, { entry });
    await vi.advanceTimersByTimeAsync(1000);
    expect(shownGroups()).toEqual([0, 1, 2, 3]);

    await rerender({ entry: entries[1] as LogEntry });
    expect(shownGroups()).toEqual([0]);
    await vi.advanceTimersByTimeAsync(300);
    expect(shownGroups()).toEqual([0, 1]);

    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('is silent, and makes no audio object, while sound is off', async () => {
    vi.useFakeTimers();
    const audio = stubAudio();
    render(ScoreTicker, { entry });
    await vi.advanceTimersByTimeAsync(1200);
    expect(audio.contexts).toHaveLength(0);
  });

  it('ticks as each term lands, each a little higher than the last, when sound is on', async () => {
    vi.useFakeTimers();
    const audio = soundOnAfterGesture();
    render(ScoreTicker, { entry });
    expect(tickSteps(audio)).toEqual([0]);
    await vi.advanceTimersByTimeAsync(300);
    expect(tickSteps(audio)).toEqual([0, 2]);
    await vi.advanceTimersByTimeAsync(300);
    await vi.advanceTimersByTimeAsync(300);
    expect(tickSteps(audio)).toEqual([0, 2, 4, 7]);
    await vi.advanceTimersByTimeAsync(2000);
    expect(cuesHeard(audio)).toEqual(['tick', 'tick', 'tick', 'tick']);
    // Sound adds no timers: the roll's own four are all there is.
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stops ticking when it is skipped', async () => {
    vi.useFakeTimers();
    const audio = soundOnAfterGesture();
    render(ScoreTicker, { entry });
    await fireEvent.click(ticker());
    await vi.advanceTimersByTimeAsync(2000);
    expect(cuesHeard(audio)).toEqual(['tick']);
  });

  it('is one soft tick, not a climb, under prefers-reduced-motion', async () => {
    vi.useFakeTimers();
    mockReducedMotion(true);
    const audio = soundOnAfterGesture();
    render(ScoreTicker, { entry });
    await vi.advanceTimersByTimeAsync(2000);
    expect(tickSteps(audio)).toEqual([7]);
  });

  it('does not tick for a row that is only shown, not rolled', () => {
    vi.useFakeTimers();
    const audio = soundOnAfterGesture();
    render(ScoreTicker, { entry, animate: false });
    expect(audio.oscillators()).toHaveLength(0);
  });

  it('draws the same lines as the Combat Log expansion', () => {
    vi.useFakeTimers();
    render(ScoreTicker, { entry, animate: false });
    const labels = [...ticker().querySelectorAll('li')].map(
      (li) => li.firstElementChild?.textContent,
    );
    expect(labels).toEqual([
      'PR merged',
      'Size (log-scaled, 415 lines)',
      'Reviewed by another human',
      'Points',
      'Base Power',
      'Rubber Duck',
      'Small Hands',
      'Hot Potato',
      'Power',
      'Zone (level 41)',
      'XP',
      'Smithing XP',
    ]);
  });
});
