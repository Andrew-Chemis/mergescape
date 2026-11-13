import { describe, expect, it } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/svelte';
import { ApiError } from '../lib/api';
import type { Api } from '../lib/api';
import { createFixtureApi } from '../lib/fixtures/api';
import { fixtureFeats } from '../lib/fixtures/depth';
import { forbidNetwork, NOW, renderApp, textOf } from '../test/helpers';

forbidNetwork();

const section = (name: string): HTMLElement =>
  screen.getByRole('heading', { name, level: 2 }).closest('section') as HTMLElement;

const feat = (name: string): HTMLElement =>
  screen.getByRole('heading', { name, level: 3 }).closest('li') as HTMLElement;

describe('Feats (fixture)', () => {
  it('summarises how many are unlocked and pinned', async () => {
    await renderApp({ hash: '#/feats' });
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Feats');
    expect(textOf(screen.getByRole('heading', { name: /unlocked/, level: 2 }))).toBe(
      '2 of 6 unlocked · 1 of 3 pinned',
    );
    expect(screen.getByText(/never gold or XP/)).toBeTruthy();
  });

  it('shows the unlocked Feats with their date and reward, and the pinned one marked', async () => {
    await renderApp({ hash: '#/feats' });
    const unlocked = section('Unlocked · 2');
    const goblin = within(feat('Goblin Slayer'));
    expect(goblin.getByText('Pinned')).toBeTruthy();
    // Unlocked 12 days before the fixture's "now" (Wednesday 11 Nov 2026).
    expect(textOf(feat('Goblin Slayer'))).toContain('Unlocked Fri, Oct 30 · Pet: Goblin Runt');
    expect(textOf(feat('Imp Whisperer'))).toContain('Unlocked Mon, Sep 28 · Title: Imp Whisperer');
    expect(within(unlocked).getAllByRole('listitem')).toHaveLength(2);
    expect(goblin.getByRole('button', { name: 'Unpin Goblin Slayer' })).toBeTruthy();
    expect(
      within(feat('Imp Whisperer')).getByRole('button', { name: 'Pin Imp Whisperer' }),
    ).toBeTruthy();
    // No progress bar on a finished Feat.
    expect(goblin.queryByRole('progressbar')).toBeNull();
  });

  it('shows the visible Feats in progress with bars, most advanced first', async () => {
    await renderApp({ hash: '#/feats' });
    const progress = section('In progress · 3');
    const names = within(progress)
      .getAllByRole('heading', { level: 3 })
      .map((heading) => heading.textContent);
    expect(names).toEqual(['Spelunker', 'Surgeon', 'Mass Reviewer']);
    const bar = (name: string) => screen.getByRole('progressbar', { name: `${name} progress` });
    expect(bar('Surgeon').getAttribute('aria-valuenow')).toBe('62');
    expect(bar('Mass Reviewer').getAttribute('aria-valuenow')).toBe('34');
    expect(bar('Surgeon').getAttribute('aria-valuetext')).toBe('62%');
    // 99% reads as 99%, not as a finished Feat.
    expect(bar('Spelunker').getAttribute('aria-valuetext')).toBe('99%');
    expect(textOf(feat('Surgeon'))).toContain('Reward: Gear: Scalpel · +0.1 Power');
    // A visible Feat says how to earn it.
    expect(textOf(feat('Spelunker'))).toContain('Complete 100 expeditions.');
  });

  it('shows a hidden Feat as ??? with its hint and no bar', async () => {
    await renderApp({ hash: '#/feats' });
    const hidden = section('Hidden · 1');
    const row = within(hidden)
      .getByRole('heading', { name: '???', level: 3 })
      .closest('li') as HTMLElement;
    expect(textOf(row)).toContain(
      'Hint: One coin at the Crossroads of Wix has a very odd year on it.',
    );
    expect(within(row).queryByRole('progressbar')).toBeNull();
    expect(within(row).queryByRole('button')).toBeNull();
    // Nothing about it leaks: not its name, not its reward.
    expect(screen.queryByText('The Old Coin')).toBeNull();
    expect(screen.queryByText(/Coin Mote/)).toBeNull();
  });

  it('says every Feat is in a category', async () => {
    await renderApp({ hash: '#/feats' });
    expect(within(feat('Surgeon')).getByText('Craft')).toBeTruthy();
    expect(within(feat('Mass Reviewer')).getByText('Scale')).toBeTruthy();
    expect(within(feat('Goblin Slayer')).getByText('World')).toBeTruthy();
  });
});

describe('Feats, pinning', () => {
  it('pins and unpins, updating the counts', async () => {
    const { session } = await renderApp({ hash: '#/feats' });
    await fireEvent.click(screen.getByRole('button', { name: 'Pin Imp Whisperer' }));
    await screen.findByText('Imp Whisperer is on your Character sheet.');
    expect(session.me!.pinnedFeats).toEqual(['goblin-slayer', 'imp-whisperer']);
    expect(textOf(screen.getByRole('heading', { name: /unlocked/, level: 2 }))).toBe(
      '2 of 6 unlocked · 2 of 3 pinned',
    );
    const imp = screen.getByRole('button', { name: 'Unpin Imp Whisperer' });
    expect(imp.getAttribute('aria-pressed')).toBe('true');
    await fireEvent.click(imp);
    await screen.findByText('Imp Whisperer is off your Character sheet.');
    expect(session.me!.pinnedFeats).toEqual(['goblin-slayer']);
  });

  it('shows the pinned Feats on the Character screen', async () => {
    const { session } = await renderApp({ hash: '#/feats' });
    await fireEvent.click(screen.getByRole('button', { name: 'Pin Imp Whisperer' }));
    await screen.findByText('Imp Whisperer is on your Character sheet.');
    window.location.hash = '#/character';
    const pinned = (await screen.findByRole('heading', { name: 'Pinned Feats · 2 of 3' })).closest(
      'section',
    ) as HTMLElement;
    expect(textOf(pinned)).toContain('Goblin Slayer');
    expect(textOf(pinned)).toContain('Imp Whisperer');
    expect(session.me!.pinnedFeats).toHaveLength(2);
  });

  it('refuses a fourth pin with the typed 409, in words beside the Feat', async () => {
    const all = fixtureFeats(NOW, 'active').map((row) => ({
      ...row,
      unlocked: true,
      progress: 1,
      pinned: ['goblin-slayer', 'imp-whisperer', 'surgeon'].includes(row.id),
    }));
    const { session } = await renderApp({
      hash: '#/feats',
      feats: all,
      me: { pinnedFeats: ['goblin-slayer', 'imp-whisperer', 'surgeon'] },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Pin Mass Reviewer' }));
    const alert = await within(feat('Mass Reviewer')).findByRole('alert');
    expect(alert.textContent).toBe('You can pin up to three Feats. Unpin one first.');
    expect(session.me!.pinnedFeats).toEqual(['goblin-slayer', 'imp-whisperer', 'surgeon']);
    expect(textOf(screen.getByRole('heading', { name: /unlocked/, level: 2 }))).toContain(
      '3 of 3 pinned',
    );
    // Unpinning one makes room, and the message goes with the next action.
    await fireEvent.click(screen.getByRole('button', { name: 'Unpin Surgeon' }));
    await screen.findByText('Surgeon is off your Character sheet.');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows a refused pin from a stale tab in words', async () => {
    const base = createFixtureApi({ now: NOW });
    const api: Api = {
      ...base,
      async featPin() {
        throw new ApiError(409, 'no', 'already_pinned');
      },
    };
    await renderApp({ hash: '#/feats', api });
    await fireEvent.click(screen.getByRole('button', { name: 'Pin Imp Whisperer' }));
    expect((await within(feat('Imp Whisperer')).findByRole('alert')).textContent).toBe(
      'That Feat is already pinned.',
    );
  });
});

describe('Feats, other states', () => {
  it('shows a brand-new character six Feats with nothing earned and empty bars', async () => {
    await renderApp({ hash: '#/feats', variant: 'noevents' });
    expect(textOf(screen.getByRole('heading', { name: /unlocked/, level: 2 }))).toBe(
      '0 of 6 unlocked · 0 of 3 pinned',
    );
    expect(screen.queryByRole('heading', { name: /^Unlocked/ })).toBeNull();
    expect(screen.getAllByRole('progressbar')).toHaveLength(5);
  });

  it('shows the day-0 Feat bars just starting', async () => {
    await renderApp({ hash: '#/feats', variant: 'day0' });
    expect(
      screen.getByRole('progressbar', { name: 'Surgeon progress' }).getAttribute('aria-valuenow'),
    ).toBe('2');
  });

  it('says it is reading the ledger before the list arrives, and survives a failed read', async () => {
    const base = createFixtureApi({ now: NOW });
    const api: Api = {
      ...base,
      async feats() {
        throw new ApiError(0, 'offline');
      },
    };
    await renderApp({ hash: '#/feats', api });
    expect(screen.getByRole('status').textContent).toContain('Reading the ledger');
  });

  it('says only "Unlocked" when the api sends no date', async () => {
    const dateless = fixtureFeats(NOW, 'active').map((row) => {
      const copy = { ...row };
      Reflect.deleteProperty(copy, 'unlockedAt');
      return copy;
    });
    await renderApp({ hash: '#/feats', feats: dateless });
    expect(textOf(feat('Goblin Slayer'))).toContain('Unlocked · Pet: Goblin Runt');
  });

  it('shows the day each Feat unlocked, in UTC, as the api sends it', async () => {
    const dated = fixtureFeats(NOW, 'active').map((row) =>
      row.id === 'goblin-slayer' ? { ...row, unlockedAt: '2026-10-03T23:59:00.000Z' } : row,
    );
    await renderApp({ hash: '#/feats', feats: dated });
    expect(textOf(feat('Goblin Slayer'))).toContain('Unlocked Sat, Oct 3 · Pet: Goblin Runt');
  });

  it('says only "Unlocked" when the date is not a date', async () => {
    const damaged = fixtureFeats(NOW, 'active').map((row) =>
      row.id === 'goblin-slayer' ? { ...row, unlockedAt: 'sometime' } : row,
    );
    await renderApp({ hash: '#/feats', feats: damaged });
    expect(textOf(feat('Goblin Slayer'))).toContain('Unlocked · Pet: Goblin Runt');
  });

  it('draws an unlocked hidden Feat with its real name', async () => {
    const earned = fixtureFeats(NOW, 'active').map((row) =>
      row.id === 'the-old-coin'
        ? {
            ...row,
            name: 'The Old Coin',
            unlocked: true,
            progress: 1,
            description: 'You found the coin.',
            unlockedAt: new Date(NOW).toISOString(),
          }
        : row,
    );
    await renderApp({ hash: '#/feats', feats: earned });
    expect(
      within(section('Unlocked · 3')).getByRole('heading', { name: 'The Old Coin' }),
    ).toBeTruthy();
    expect(screen.queryByRole('heading', { name: /^Hidden/ })).toBeNull();
  });
});
