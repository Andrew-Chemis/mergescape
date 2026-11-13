/**
 * The Run Map from fixtures: three acts with targets and progress, nodes for this week's kills (elites
 * stand alone), the Mogul card with the satire disclaimer, the next-Mogul card only when the api sets
 * it, the Pledge hand with its play window, and the Mogul reveal (including its reduced-motion branch).
 */
import { fireEvent, screen, waitFor, within } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import { MOGUL_DISCLAIMER } from '@mergescape/shared';
import { ApiError } from '../lib/api';
import type { Api } from '../lib/api';
import { createFixtureApi } from '../lib/fixtures/api';
import { REVEAL_KEY } from '../lib/reveal';
import { forbidNetwork, mockReducedMotion, named, NOW, renderApp, textOf } from '../test/helpers';

forbidNetwork();

const map = (options: Parameters<typeof renderApp>[0] = {}) =>
  renderApp({ hash: '#/map', ...options });

/** An act on the map, found by its heading (the Targets panel has rows of its own with other text). */
const act = (name: RegExp) =>
  screen
    .getAllByRole('listitem')
    .find((li) => li.classList.contains('act') && name.test(textOf(li))) as HTMLElement;

const hand = () => screen.getByRole('region', { name: /Pledges in play/ });

describe('Run Map', () => {
  it('shows the week, the three acts with targets, and where you are', async () => {
    await map();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Run Map');
    expect(document.title).toBe('Run Map · Mergescape');
    expect(textOf(screen.getByRole('heading', { name: /^Week 46/ }))).toBe('Week 46 · 5 days left');

    const scout = act(/Act I · Scout/);
    expect(textOf(scout)).toContain('Mon–Tue');
    expect(textOf(scout)).toContain('1,422,000 XP');
    expect(textOf(scout)).toContain('cleared');
    const raid = act(/Act II · Raid/);
    expect(raid.getAttribute('aria-current')).toBe('step');
    expect(textOf(raid)).toContain('2,370,000 XP');
    expect(textOf(raid)).toContain('You · 67%');
    const boss = act(/Act III · Boss/);
    expect(textOf(boss)).toContain('3,555,000 XP');
    expect(textOf(boss)).toContain('The Rocket Man');

    const progress = screen.getByRole('progressbar', { name: 'Run progress' });
    expect(progress.getAttribute('aria-valuetext')).toBe('1,606,611 / 2,370,000 · Raid');
  });

  it('draws a node for each kind of kill this week, oldest act first, with elites standing alone', async () => {
    await map();
    // The first page of the log is enough for Wednesday; Monday and Tuesday need the older page.
    await waitFor(() => expect(screen.getByText('Scope Creep')).toBeTruthy());

    const labels = (name: RegExp) =>
      within(within(act(name)).getByRole('list'))
        .queryAllByRole('listitem')
        .map((li) => textOf(li));

    expect(labels(/Act I · Scout/)).toEqual([
      'Scope Creep Elite',
      'Merge Goblin ×2',
      'Rebase Hydra Elite',
      'Legacy Golem',
    ]);
    expect(labels(/Act II · Raid/)).toEqual([
      'Merge Goblin ×2',
      'Flaky Test Wraith',
      'Nitpick Imp ×2',
      '◆ You · 67%',
    ]);
    // The Boss act has no kills yet, only the Mogul.
    expect(labels(/Act III · Boss/)).toEqual([]);
    const elite = within(act(/Act I · Scout/))
      .getByText('Scope Creep')
      .closest('li');
    expect(elite?.classList.contains('elite')).toBe(true);
  });

  it('shows the Mogul card with the modifier, the Renown on offer and the satire disclaimer', async () => {
    await map();
    const card = screen.getByRole('region', { name: 'Act III Mogul · The Rocket Man' });
    expect(card.classList.contains('parch')).toBe(true);
    expect(within(card).getByText('Hardcore week.').tagName).toBe('B');
    expect(textOf(card)).toContain('Deletions count double toward size points');
    expect(textOf(card)).toContain('It applies to events scored Fri–Sun, the Boss act.');
    expect(textOf(card)).toContain('Clear the Boss act for Renown 18, 100 gold and a shop visit.');
    expect(within(card).getByText(MOGUL_DISCLAIMER)).toBeTruthy();
  });

  it('says a week-long modifier applies from Monday, and when the Boss is already beaten', async () => {
    await map({ week: { mogul: 'founder', act: null, clearedActs: ['scout', 'raid', 'boss'] } });
    const card = screen.getByRole('region', { name: 'Act III Mogul · The Founder' });
    expect(textOf(card)).toContain('It applies all week, from Monday.');
    expect(textOf(card)).toContain('Beaten this week.');
    expect(textOf(card)).not.toContain('Clear the Boss act');
    expect(textOf(act(/Act III · Boss/))).toContain('Boss ✓');
  });

  it('shows the targets panel with the share of the median and what each act pays', async () => {
    await map();
    const targets = screen.getByRole('region', { name: 'Targets' });
    const rows = within(targets).getAllByRole('listitem');
    expect(rows.map((row) => textOf(row))).toEqual([
      'Scout · 60% 1,422,000 XP Pays 20 gold and opens the shop · cleared ✓',
      'Raid · 100% 2,370,000 XP Pays 40 gold and opens the shop',
      'Boss · 150% 3,555,000 XP Pays 100 gold and opens the shop',
    ]);
  });

  it('shows the next-Mogul card only when the api says the next Mogul is known', async () => {
    await map();
    expect(screen.queryByRole('region', { name: /Next week/ })).toBeNull();

    document.body.innerHTML = '';
    await map({ variant: 'monday' });
    const next = screen.getByRole('region', { name: named('Next week · The Founder') });
    expect(textOf(next)).toContain('Non-profit to for-profit.');
    expect(textOf(next)).toContain("Scout's Eye");
  });

  it('has a flat-target message instead of a map before the first run', async () => {
    await map({ variant: 'noevents' });
    const empty = screen.getByRole('region', { name: 'No run yet' });
    expect(empty.textContent).toContain('2,000 XP');
    expect(screen.queryByRole('region', { name: /Act III Mogul/ })).toBeNull();
  });

  it('opens with the Pledge hand under the map', async () => {
    await map();
    expect(screen.getByRole('region', { name: named('Pledges in play · 3 of 3') })).toBeTruthy();
  });
});

describe('Pledge hand: the play window', () => {
  it('offers a Play button for every Pledge in hand while the window is open', async () => {
    await map({ variant: 'monday' });
    expect(textOf(within(hand()).getByRole('heading', { level: 2 }))).toBe(
      'Pledges in play · 0 of 3',
    );
    expect(within(hand()).getByText('Nothing in play yet.')).toBeTruthy();
    const buttons = within(hand()).getAllByRole('button', { name: /^Play / });
    expect(buttons.map((b) => textOf(b))).toEqual([
      'Play Strike',
      'Play Defend',
      'Play Big Game Hunter',
      'Play Mentor',
      'Play Tidy',
    ]);
    expect(textOf(hand())).toContain('Play up to 3 until Tuesday 23:59 UTC');
  });

  it('plays a Pledge: it moves into play with a progress bar and the count goes up', async () => {
    await map({ variant: 'monday' });
    await fireEvent.click(within(hand()).getByRole('button', { name: 'Play Strike' }));
    await waitFor(() =>
      expect(textOf(within(hand()).getByRole('heading', { level: 2 }))).toBe(
        'Pledges in play · 1 of 3',
      ),
    );
    const strike = within(hand()).getAllByRole('article')[0] as HTMLElement;
    expect(within(strike).getByRole('heading', { level: 3 }).textContent).toBe('Strike');
    expect(
      within(strike)
        .getByRole('progressbar', { name: 'Strike progress' })
        .getAttribute('aria-valuetext'),
    ).toBe('0 / 3');
    expect(within(hand()).queryByRole('button', { name: 'Play Strike' })).toBeNull();
    expect(within(hand()).getAllByRole('button', { name: /^Play / })).toHaveLength(4);
  });

  it('stops offering plays at three', async () => {
    await map({ variant: 'monday' });
    for (const name of ['Strike', 'Defend', 'Mentor']) {
      await fireEvent.click(within(hand()).getByRole('button', { name: `Play ${name}` }));
      await waitFor(() =>
        expect(within(hand()).queryByRole('button', { name: `Play ${name}` })).toBeNull(),
      );
    }
    expect(within(hand()).queryByRole('button', { name: /^Play / })).toBeNull();
    expect(textOf(hand())).toContain('In hand: Big Game Hunter, Tidy');
    expect(textOf(hand())).toContain('All 3 slots are in play.');
  });

  it('shows no Play buttons once the window has closed, and says what happened to the empty slots', async () => {
    await map({ variant: 'monday', week: { pledgeWindowOpen: false } });
    expect(within(hand()).queryByRole('button', { name: /^Play / })).toBeNull();
    expect(textOf(hand())).toContain('In hand: Strike, Defend, Big Game Hunter, Mentor, Tidy');
    expect(textOf(hand())).toContain('The play window closed on Tuesday at 23:59 UTC');
  });

  it('shows window_closed beside the Pledge when the window closes under the player', async () => {
    const base = createFixtureApi({ now: NOW, variant: 'monday' });
    const api: Api = {
      ...base,
      async pledgePlay() {
        throw new ApiError(409, 'no', 'window_closed');
      },
    };
    await map({ api });
    await fireEvent.click(within(hand()).getByRole('button', { name: 'Play Mentor' }));
    const mentor = within(hand())
      .getAllByRole('article')
      .find((a) => textOf(a).includes('Mentor')) as HTMLElement;
    expect((await within(mentor).findByRole('alert')).textContent).toBe(
      'The Pledge window closed on Tuesday at 23:59 UTC.',
    );
    // The other cards carry no message and nothing moved into play.
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(textOf(within(hand()).getByRole('heading', { level: 2 }))).toBe(
      'Pledges in play · 0 of 3',
    );
  });

  it('shows the progress of the Pledges in play, including a finished one', async () => {
    await map();
    const cards = within(hand()).getAllByRole('article');
    const bars = cards.map((c) =>
      within(c).getByRole('progressbar').getAttribute('aria-valuetext'),
    );
    expect(bars).toEqual(['2 / 3', 'Done ✓', '0 / 1']);
  });

  it('shows the same hand and play buttons in Town', async () => {
    await renderApp({ hash: '#/', variant: 'monday' });
    expect(within(hand()).getAllByRole('button', { name: /^Play / })).toHaveLength(5);
  });
});

describe('Mogul reveal', () => {
  const reveal = () => document.querySelector('.reveal') as HTMLElement;

  it('plays on the first view of a new week: the Mogul rises behind the Boss node with its one-liner', async () => {
    await map();
    await waitFor(() => expect(reveal().dataset['motion']).toBe('rise'));
    const line = within(reveal()).getByRole('status');
    expect(textOf(line)).toContain('The Rocket Man');
    expect(textOf(line)).toContain('"The best part is no part."');
    expect(reveal().querySelector('svg')).not.toBeNull();
    // The week is remembered, so the next view does not replay it.
    expect(window.localStorage.getItem(REVEAL_KEY)).toBe('2026-46');
  });

  it('collapses to a fade under reduced motion', async () => {
    mockReducedMotion(true);
    await map();
    await waitFor(() => expect(reveal().dataset['motion']).toBe('fade'));
    expect(within(reveal()).getByRole('status')).toBeTruthy();
    expect(window.localStorage.getItem(REVEAL_KEY)).toBe('2026-46');
  });

  it('stands still when this week was already seen', async () => {
    window.localStorage.setItem(REVEAL_KEY, '2026-46');
    await map();
    expect(reveal().dataset['motion']).toBe('still');
    expect(within(reveal()).queryByRole('status')).toBeNull();
    // It is still the Mogul, drawn and named.
    expect(textOf(reveal())).toContain('The Rocket Man');
  });

  it('plays again for a different week', async () => {
    window.localStorage.setItem(REVEAL_KEY, '2026-45');
    await map();
    await waitFor(() => expect(reveal().dataset['motion']).toBe('rise'));
    expect(window.localStorage.getItem(REVEAL_KEY)).toBe('2026-46');
  });

  it('still works when localStorage throws (private windows): it just plays', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    await map();
    await waitFor(() => expect(reveal().dataset['motion']).toBe('rise'));
    expect(screen.getByRole('region', { name: /Act III Mogul/ })).toBeTruthy();
  });
});
