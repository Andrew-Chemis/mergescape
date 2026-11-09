/**
 * The Bestiary from fixtures: the creature grid with kill counts and first-seen dates, creatures never
 * met shown as silhouettes, the Mogul gallery and the satire disclaimer (Requirement 7.5).
 */
import { screen, within } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import { MOGUL_DISCLAIMER, MOGULS } from '@mergescape/shared';
import { CREATURES, formatDay, isMet } from '../lib/bestiary';
import { fixtureMe } from '../lib/fixtures/state';
import { forbidNetwork, NOW, renderApp, textOf } from '../test/helpers';

forbidNetwork();

const bestiary = (options: Parameters<typeof renderApp>[0] = {}) =>
  renderApp({ hash: '#/bestiary', ...options });

const creature = (id: string) => document.querySelector(`[data-creature="${id}"]`) as HTMLElement;
const mogul = (id: string) => document.querySelector(`[data-mogul="${id}"]`) as HTMLElement;

describe('Bestiary', () => {
  it('shows the creature grid with kill counts and first-seen dates', async () => {
    await bestiary();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Bestiary');
    expect(textOf(screen.getByText(/^Met /).closest('p'))).toBe(
      'Met 7 of 8 creatures · beaten 6 of 6 Moguls',
    );

    const grid = within(screen.getByRole('region', { name: 'Creatures' }));
    expect(grid.getAllByRole('listitem')).toHaveLength(CREATURES.length);

    const me = fixtureMe(NOW);
    const goblin = creature('merge-goblin');
    expect(within(goblin).getByRole('heading', { level: 3 }).textContent).toBe('Merge Goblin');
    expect(textOf(goblin)).toContain('Defeated 1,204');
    expect(textOf(goblin)).toContain(`First seen ${formatDay(me.firstSeen['merge-goblin'] ?? '')}`);
    expect(textOf(creature('nitpick-imp'))).toContain('Defeated 377');
    expect(textOf(creature('rebase-hydra'))).toContain('Elite');
    expect(textOf(creature('rebase-hydra'))).toContain('Defeated 44');
    expect(textOf(creature('merge-goblin'))).toContain('Creature');
    expect(goblin.classList.contains('locked')).toBe(false);
    expect(goblin.querySelector('svg')).not.toBeNull();
  });

  it('shows a creature never met as a silhouette with a hint, and no name or count', async () => {
    await bestiary();
    const monolith = creature('silent-monolith');
    expect(monolith.classList.contains('locked')).toBe(true);
    expect(within(monolith).getByRole('heading', { level: 3 }).textContent).toBe(
      'Unknown creature',
    );
    expect(textOf(monolith)).toContain('Not met yet');
    expect(textOf(monolith)).toContain('no review of any kind');
    expect(textOf(monolith)).not.toContain('Silent Monolith');
    expect(textOf(monolith)).not.toContain('Defeated');
    // It is still drawn, only as an outline.
    expect(monolith.querySelector('svg')).not.toBeNull();
    // The sprites carry no description of their own: the text says it all.
    expect(monolith.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('shows the Mogul gallery with every Mogul, its modifier, joke and kills', async () => {
    await bestiary();
    const gallery = within(screen.getByRole('region', { name: 'Mogul gallery' }));
    expect(gallery.getAllByRole('listitem')).toHaveLength(6);
    for (const definition of MOGULS) {
      const entry = mogul(definition.id);
      expect(within(entry).getByRole('heading', { level: 3 }).textContent).toBe(definition.name);
      expect(textOf(entry)).toContain(definition.modifier);
      expect(textOf(entry)).toContain(definition.joke);
      expect(textOf(entry)).toContain(definition.look);
    }
    expect(textOf(mogul('rocket-man'))).toContain('Beaten 3');
    expect(textOf(mogul('two-pizza-boss'))).toContain('Beaten 2');
    // This week's Mogul is marked.
    expect(textOf(mogul('rocket-man'))).toContain('Mogul · this week');
    expect(textOf(mogul('hoodie'))).not.toContain('this week');
  });

  it('carries the satire disclaimer from the design', async () => {
    await bestiary();
    const note = screen.getByRole('note');
    expect(note.textContent).toBe(MOGUL_DISCLAIMER);
    expect(MOGUL_DISCLAIMER).toBe(
      'The Moguls are fictional caricatures. Any resemblance to persons living, dead or on a podcast is satire.',
    );
  });

  it('is all silhouettes for a new character, with no Mogul beaten', async () => {
    await bestiary({ variant: 'noevents' });
    expect(textOf(screen.getByText(/^Met /).closest('p'))).toBe(
      'Met 0 of 8 creatures · beaten 0 of 6 Moguls',
    );
    for (const entry of CREATURES) {
      expect(creature(entry.id).classList.contains('locked')).toBe(true);
    }
    expect(textOf(mogul('rocket-man'))).toContain('Not beaten yet');
    // The disclaimer is there all the same.
    expect(screen.getByRole('note').textContent).toBe(MOGUL_DISCLAIMER);
  });
});

describe('Bestiary helpers', () => {
  it('counts a creature as met by a kill or by a first-seen date', () => {
    expect(isMet('merge-goblin', { 'merge-goblin': 1 }, {})).toBe(true);
    expect(isMet('merge-goblin', {}, { 'merge-goblin': '2026-01-01T00:00:00Z' })).toBe(true);
    expect(isMet('merge-goblin', { 'merge-goblin': 0 }, {})).toBe(false);
    expect(isMet('merge-goblin', {}, {})).toBe(false);
  });

  it('formats a day in UTC and tolerates junk', () => {
    expect(formatDay('2026-11-03T23:59:00Z')).toBe('Nov 3, 2026');
    expect(formatDay('not a date')).toBe('');
  });

  it('describes the eight creatures of design.md 7.1, four of them elites', () => {
    expect(CREATURES.map((c) => c.id)).toEqual([
      'merge-goblin',
      'nitpick-imp',
      'flaky-test-wraith',
      'legacy-golem',
      'rebase-hydra',
      'scope-creep',
      'release-dragon',
      'silent-monolith',
    ]);
    expect(CREATURES.filter((c) => c.kind === 'elite')).toHaveLength(4);
  });
});
