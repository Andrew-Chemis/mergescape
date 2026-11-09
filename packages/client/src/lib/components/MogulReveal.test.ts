/**
 * The Mogul reveal (game-design.md section 9, moment 5): the Mogul rises behind the Boss node with its
 * one-liner on the first view of a week, fades in under reduced motion, can be skipped, and has its own cue.
 */
import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import { mogulDefinition } from '@mergescape/shared';
import { cuesHeard, soundOnAfterGesture, stubAudio } from '../../test/audio';
import { mockReducedMotion } from '../../test/helpers';
import MogulReveal from './MogulReveal.svelte';

const motion = (container: HTMLElement) =>
  container.querySelector('.reveal')?.getAttribute('data-motion');

describe('MogulReveal', () => {
  it('shows the Mogul and its one-liner, rising on the first view of a week', () => {
    mockReducedMotion(false);
    const { container } = render(MogulReveal, { mogul: 'founder', play: true });
    expect(motion(container)).toBe('rise');
    expect(container.textContent).toContain('The Founder');
    expect(container.textContent).toContain(mogulDefinition('founder').joke);
    expect(screen.getByRole('status').textContent).toContain('The Founder');
  });

  it('only stands there on every later view, announcing nothing', () => {
    const { container } = render(MogulReveal, { mogul: 'hoodie', play: false });
    expect(motion(container)).toBe('still');
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('collapses to a fade under prefers-reduced-motion', () => {
    mockReducedMotion(true);
    const { container } = render(MogulReveal, { mogul: 'turtleneck', play: true });
    expect(motion(container)).toBe('fade');
  });

  it('is skippable: a click on the stage ends the rise', async () => {
    mockReducedMotion(false);
    const { container } = render(MogulReveal, { mogul: 'rocket-man', play: true });
    await fireEvent.click(container.querySelector('.stage') as HTMLElement);
    expect(motion(container)).toBe('still');
  });

  it('marks the Boss node cleared', () => {
    const { container } = render(MogulReveal, { mogul: 'founder', play: false, cleared: true });
    expect(container.querySelector('.act-name')?.textContent).toContain('✓');
  });

  it('plays its cue once on a reveal, never on a still view, and not once it is skipped', async () => {
    const silent = stubAudio();
    render(MogulReveal, { mogul: 'founder', play: true }).unmount();
    expect(silent.contexts).toHaveLength(0);

    const audio = soundOnAfterGesture();
    mockReducedMotion(false);
    const still = render(MogulReveal, { mogul: 'founder', play: false });
    expect(cuesHeard(audio)).toEqual([]);
    still.unmount();

    const playing = render(MogulReveal, { mogul: 'founder', play: true });
    expect(cuesHeard(audio)).toEqual(['mogul']);
    await fireEvent.click(playing.container.querySelector('.stage') as HTMLElement);
    expect(cuesHeard(audio)).toEqual(['mogul']);
  });

  it('plays the one cue under reduced motion too, since it marks an event rather than a movement', () => {
    mockReducedMotion(true);
    const audio = soundOnAfterGesture();
    render(MogulReveal, { mogul: 'two-pizza-boss', play: true });
    expect(cuesHeard(audio)).toEqual(['mogul']);
  });
});
