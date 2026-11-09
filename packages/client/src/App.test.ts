/**
 * Component tests: every screen renders from the fixture state with no network (Requirement 10.7),
 * the empty states say what Requirement 10.6 says, and the Combat Log expands to the full breakdown.
 */
import { fireEvent, screen, waitFor, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BIOMES, levelFor, SKILL_LABELS, SKILLS } from '@mergescape/shared';
import { ApiError } from './lib/api';
import type { Api } from './lib/api';
import { createFixtureApi } from './lib/fixtures/api';
import { FINAL_SKILL_XP, FINAL_XP } from './lib/fixtures/raw-log';
import { fixtureLogEntries, fixtureMe } from './lib/fixtures/state';
import { LEVEL_UP_MS } from './lib/motion';
import { cuesHeard, soundOnAfterGesture, stubAudio } from './test/audio';
import { mockReducedMotion, NOW, renderApp } from './test/helpers';

/** Any network call during these tests is a bug: the fixture mode must not touch the network. */
const fetchSpy = vi.fn(async () => {
  throw new Error('network access is not allowed in fixture tests');
});

beforeEach(() => {
  vi.stubGlobal('fetch', fetchSpy);
});

afterEach(() => {
  expect(fetchSpy).not.toHaveBeenCalled();
  fetchSpy.mockClear();
});

const h1 = () => screen.getByRole('heading', { level: 1 });

describe('Landing', () => {
  it('offers sign-in, three steps and the privacy promise', async () => {
    await renderApp({ api: null, signInHref: 'https://api.example/auth/login' });
    expect(h1().textContent).toBe('Mergescape');

    const signIn = screen.getByRole('link', { name: 'Sign in with GitHub' });
    expect(signIn.getAttribute('href')).toBe('https://api.example/auth/login');

    const steps = screen.getAllByRole('heading', { level: 3 }).map((step) => step.textContent);
    expect(steps).toEqual([
      'Sign in with GitHub',
      'Install the App on your repositories',
      'Merge something',
    ]);

    const promise = screen.getByRole('region', { name: 'Our promise' });
    const items = within(promise)
      .getAllByRole('listitem')
      .map((item) => item.textContent);
    expect(items).toEqual([
      'We never read your code. No file contents, diffs, titles or comment text, ever.',
      'We store counts and timestamps only.',
      'You can export or delete everything in one click.',
      "The App can't write to GitHub.",
      "Activity from people who haven't signed in is discarded.",
      'Mergescape is a game, not a performance-review tool. There is no manager view.',
    ]);
  });

  it('shows a real kill from the scorer as the example', async () => {
    await renderApp({ api: null, signInHref: 'https://api.example/auth/login' });
    const sample = screen.getByRole('region', { name: 'What a kill looks like' });
    expect(within(sample).getByRole('list', { name: 'Example score breakdown' })).toBeTruthy();
    expect(within(sample).getByText('Zone (level 41)')).toBeTruthy();
  });

  it('has no navigation rail and no stored-session data', async () => {
    await renderApp({ api: null, signInHref: 'https://api.example/auth/login' });
    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull();
    expect(document.title).toBe('Welcome · Mergescape');
  });

  it('explains a build with no backend and points at the fixture demo', async () => {
    await renderApp({ api: null, signInHref: null });
    const button = screen.getByRole('button', { name: 'Sign in with GitHub' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(
      screen.getByRole('link', { name: 'Look around with demo data' }).getAttribute('href'),
    ).toBe('?fixture=1#/');
  });

  it('is always reachable at #/welcome, even signed in', async () => {
    await renderApp({ hash: '#/welcome' });
    expect(h1().textContent).toBe('Mergescape');
    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull();
  });

  it('says so when a stored session was rejected', async () => {
    const rejecting: Api = {
      ...createFixtureApi({ now: NOW }),
      async me() {
        throw new ApiError(401, 'no');
      },
      async log() {
        throw new ApiError(401, 'no');
      },
      async installations() {
        throw new ApiError(401, 'no');
      },
    };
    await renderApp({ api: rejecting, signInHref: 'https://api.example/auth/login' });
    expect(await screen.findByText('Your session ended. Sign in again to carry on.')).toBeTruthy();
    expect(h1().textContent).toBe('Mergescape');
  });
});

describe('Town', () => {
  it('renders the scene, the run, the level, the last kill, Pledges and the shop banner', async () => {
    await renderApp();
    expect(h1().textContent).toBe('Town');
    expect(document.title).toBe('Town · Mergescape');

    // Scene: biome and Renown (Renown 17 is the third biome), the last monster.
    expect(screen.getByText('Flaky Marsh · Renown 17')).toBeTruthy();
    expect(BIOMES[2]).toBe('Flaky Marsh');
    expect(
      screen.getByRole('img', { name: 'Your character in Flaky Marsh, facing a Merge Goblin.' }),
    ).toBeTruthy();
  });

  it('shows the three acts with their targets and the Mogul under Boss', async () => {
    await renderApp();
    const run = screen.getByRole('region', { name: /This week's Run/ });
    expect(within(run).getByRole('heading', { level: 2 }).textContent).toBe(
      "This week's Run · Act II",
    );
    const items = within(run).getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items[0]?.textContent).toContain('I · Scout');
    expect(items[0]?.textContent).toContain('1,422,000 XP');
    expect(items[0]?.textContent).toContain('Cleared');
    expect(items[1]?.textContent).toContain('II · Raid');
    expect(items[1]?.textContent).toContain('2,370,000 XP');
    expect(items[1]?.getAttribute('aria-current')).toBe('step');
    expect(items[2]?.textContent).toContain('III · Boss');
    expect(items[2]?.textContent).toContain('3,555,000 XP');
    expect(items[2]?.textContent).toContain('The Rocket Man');

    const progress = within(run).getByRole('progressbar', { name: 'Run progress' });
    expect(progress.getAttribute('aria-valuetext')).toBe('1,606,611 / 2,370,000 · Raid');
  });

  it('shows the level, exact XP numbers and the distance to the next level', async () => {
    await renderApp();
    const level = screen.getByRole('region', { name: /Level 41/ });
    expect(within(level).getByText('21,151,701 / 21,376,515')).toBeTruthy();
    const bar = within(level).getByRole('progressbar', { name: 'Experience to level 42' });
    expect(bar.getAttribute('aria-valuetext')).toBe('Lv 42 in 224,814');
    expect(Number(bar.getAttribute('aria-valuenow'))).toBeGreaterThan(89);
    expect(level.textContent).toContain('Gold 2,340');
    expect(level.textContent).toContain('Total level');
  });

  it('shows the last kill with the full breakdown, supplies and age', async () => {
    await renderApp();
    const kill = screen.getByRole('region', { name: /Last kill/ });
    expect(within(kill).getByRole('heading', { level: 2 }).textContent).toBe(
      'Last kill · Merge Goblin',
    );
    expect(within(kill).getByText('Merged octo/api #412 (+318 / −97)')).toBeTruthy();
    const lines = within(within(kill).getByRole('list', { name: 'Score breakdown' }))
      .getAllByRole('listitem')
      .map((li) => li.textContent?.replace(/\s+/g, ' ').trim());
    expect(lines).toEqual([
      'PR merged +90',
      'Size (log-scaled, 415 lines) +120',
      'Reviewed by another human +30',
      'Points = 240',
      'Base Power 1',
      'Rubber Duck +0.25',
      'Small Hands +0.5',
      'Hot Potato +1',
      'Power × 2.75',
      'Zone (level 41) × 395.55',
      'XP = 261,061',
      'Smithing XP +261,061',
    ]);
    expect(within(kill).getByText('+3 Ore, +1 Timber, +2 Provisions')).toBeTruthy();
    expect(within(kill).getByText('2 min ago')).toBeTruthy();
  });

  it('shows the Pledges in play and the shop banner placeholders', async () => {
    await renderApp();
    const pledges = screen.getByRole('region', { name: /Pledges in play/ });
    expect(within(pledges).getByRole('heading', { level: 2 }).textContent).toBe(
      'Pledges in play · 3 of 3',
    );
    for (const name of ['Strike', 'Defend', 'Big Game Hunter']) {
      expect(within(pledges).getByText(name)).toBeTruthy();
    }
    expect(within(pledges).getByText('In hand: Mentor, Tidy')).toBeTruthy();
    expect(
      screen.getByText(/The Grizzled Reviewer's shop is open\s+until Raid clears\s+· 2,340 gold/),
    ).toBeTruthy();
  });

  it('shows no sleeping line and no install call to action once there are events', async () => {
    await renderApp();
    expect(screen.queryByText("Merge something. I'll wake up.")).toBeNull();
    expect(screen.queryByRole('link', { name: 'Install the GitHub App' })).toBeNull();
  });

  it('replays the roll on request', async () => {
    await renderApp();
    const kill = screen.getByRole('region', { name: /Last kill/ });
    const ticker = () => kill.querySelector('.ticker') as HTMLElement;
    expect(ticker().dataset['motion']).toBe('static');
    await fireEvent.click(within(kill).getByRole('button', { name: 'Replay the roll' }));
    expect(ticker().dataset['motion']).toBe('full');
    expect(ticker().dataset['revealed']).toBe('1');
  });
});

describe('Town empty states (Requirement 10.6)', () => {
  it('shows the install call to action when there are no installations', async () => {
    await renderApp({ variant: 'noinstall' });
    const cta = screen.getByRole('region', { name: 'Install Mergescape on your repositories' });
    const link = within(cta).getByRole('link', { name: 'Install the GitHub App' });
    expect(link.getAttribute('href')).toBe('https://github.com/apps/mergescape/installations/new');
    expect(link.getAttribute('rel')).toContain('noopener');
    expect(screen.queryByText("Merge something. I'll wake up.")).toBeNull();
  });

  it('checks for new installations on request', async () => {
    const base = createFixtureApi({ now: NOW, variant: 'noinstall' });
    const installations = vi.fn(base.installations);
    await renderApp({ api: { ...base, installations } });
    expect(installations).toHaveBeenCalledTimes(1);
    await fireEvent.click(screen.getByRole('button', { name: 'I installed it, check again' }));
    await waitFor(() => expect(installations).toHaveBeenCalledTimes(2));
  });

  it('wakes up into the sleeping character when the App is installed but nothing has happened', async () => {
    await renderApp({ variant: 'noevents' });
    expect(screen.getByText("Merge something. I'll wake up.")).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Your character is asleep in Town.' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Install the GitHub App' })).toBeNull();
    const kill = screen.getByRole('region', { name: 'Last kill' });
    expect(kill.textContent).toContain('Nothing yet.');
  });

  it('still draws the act targets, from the flat 2,000 XP, with no run yet', async () => {
    await renderApp({ variant: 'noevents' });
    const run = screen.getByRole('region', { name: /This week's Run/ });
    const items = within(run).getAllByRole('listitem');
    expect(items.map((li) => li.textContent?.match(/[\d,]+ XP/)?.[0])).toEqual([
      '1,200 XP',
      '2,000 XP',
      '3,000 XP',
    ]);
    expect(run.textContent).toContain('No run yet');
  });
});

describe('Combat Log', () => {
  it('lists the first page of rows with monster, summary, formula, time and XP', async () => {
    await renderApp({ hash: '#/log' });
    expect(h1().textContent).toBe('Combat Log');
    const rows = screen.getAllByRole('listitem').filter((li) => li.classList.contains('logrow'));
    expect(rows).toHaveLength(8);
    const first = rows[0] as HTMLElement;
    expect(first.textContent).toContain('Merged octo/api #412 (+318 / −97)');
    expect(first.textContent).toContain('Merge Goblin · 2 min ago');
    expect(first.textContent).toContain('240 × 2.75 × 395.55');
    expect(first.textContent).toContain('+261,061');
    expect(first.textContent).toContain('Smithing');
    expect(first.querySelector('svg')).not.toBeNull();
  });

  it('shows a repository only when the row carries its name', async () => {
    await renderApp({ hash: '#/log' });
    const privateRow = screen.getByText('Approved PR #77 in a private repo');
    expect(privateRow).toBeTruthy();
    expect(screen.getByText('Merged octo/api #412 (+318 / −97)')).toBeTruthy();
  });

  it('expands a row to the Points × Power × Zone breakdown, in order, and collapses it again', async () => {
    await renderApp({ hash: '#/log' });
    const header = screen
      .getAllByRole('button', { expanded: false })
      .find((button) => button.textContent?.includes('Merged octo/api #412')) as HTMLElement;
    expect(document.querySelector('.detail')).toBeNull();

    await fireEvent.click(header);
    expect(header.getAttribute('aria-expanded')).toBe('true');
    const list = await screen.findByRole('list', {
      name: 'Score breakdown for Merged octo/api #412 (+318 / −97)',
    });
    const lines = within(list)
      .getAllByRole('listitem')
      .map((li) => li.textContent?.replace(/\s+/g, ' ').trim());
    expect(lines).toEqual([
      'PR merged +90',
      'Size (log-scaled, 415 lines) +120',
      'Reviewed by another human +30',
      'Points = 240',
      'Base Power 1',
      'Rubber Duck +0.25',
      'Small Hands +0.5',
      'Hot Potato +1',
      'Power × 2.75',
      'Zone (level 41) × 395.55',
      'XP = 261,061',
      'Smithing XP +261,061',
    ]);
    // The lines are grouped Points, Power, Zone, XP, and the groups appear in that order.
    const groups = [...list.querySelectorAll('li')].map((li) => Number(li.dataset['group']));
    expect(groups).toEqual([...groups].sort((a, b) => a - b));
    expect(screen.getByText('+3 Ore, +1 Timber, +2 Provisions')).toBeTruthy();

    await fireEvent.click(header);
    expect(header.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('list', { name: /Score breakdown for/ })).toBeNull();
  });

  it('expands a row whose Oratory or Endurance share is part of the XP', async () => {
    await renderApp({ hash: '#/log' });
    const header = screen
      .getAllByRole('button', { expanded: false })
      .find((button) => button.textContent?.includes('Approved octo/api #409')) as HTMLElement;
    await fireEvent.click(header);
    const list = await screen.findByRole('list', {
      name: /Score breakdown for Approved octo\/api/,
    });
    const text = list.textContent ?? '';
    expect(text).toContain('First event of the day');
    expect(text).toContain('Vigilance XP');
    expect(text).toContain('Endurance XP');
  });

  it('pages: loads older entries until there are none left', async () => {
    await renderApp({ hash: '#/log' });
    const countRows = () =>
      screen.getAllByRole('listitem').filter((li) => li.classList.contains('logrow')).length;
    expect(countRows()).toBe(8);
    await fireEvent.click(screen.getByRole('button', { name: 'Load older entries' }));
    await waitFor(() => expect(countRows()).toBe(14));
    expect(screen.queryByRole('button', { name: 'Load older entries' })).toBeNull();
    expect(screen.getByText('That is everything so far.')).toBeTruthy();
    // The oldest row is the weekly review from a week back.
    expect(screen.getByText('Reviewed octo/web #380')).toBeTruthy();
  });

  it('says what the log is for when it is empty', async () => {
    await renderApp({ hash: '#/log', variant: 'noevents' });
    const empty = screen.getByRole('region', { name: 'Nothing logged yet' });
    expect(empty.textContent).toContain('Points × Power × Zone');
    expect(screen.queryByRole('button', { name: 'Load older entries' })).toBeNull();
  });
});

describe('Character', () => {
  it('shows the XP bar with exact numbers and the skills with levels and bars', async () => {
    await renderApp({ hash: '#/character' });
    expect(h1().textContent).toBe('Character');
    expect(screen.getByText('octo-dev')).toBeTruthy();
    expect(screen.getByText('Level 41 · 21,151,701 / 21,376,515 XP')).toBeTruthy();
    const bar = screen.getByRole('progressbar', { name: 'Experience into level 41' });
    expect(bar.getAttribute('aria-valuetext')).toBe('1,916,449 / 2,141,263 into level 41');

    const skills = screen.getByRole('region', { name: 'Skills' });
    const rows = within(skills).getAllByRole('listitem');
    expect(rows).toHaveLength(4);
    SKILLS.forEach((skill, index) => {
      const text = (rows[index]?.textContent ?? '').replace(/\s+/g, ' ');
      expect(text).toContain(SKILL_LABELS[skill]);
      expect(text).toContain(`Level ${levelFor(FINAL_SKILL_XP[skill])}`);
      expect(text).toContain(`${FINAL_SKILL_XP[skill].toLocaleString('en-US')} XP`);
    });
    expect(FINAL_XP).toBe(21151701);
  });

  it('shows five Charm slots: three held, two empty', async () => {
    await renderApp({ hash: '#/character' });
    const charms = screen.getByRole('region', { name: /Charms/ });
    expect(within(charms).getByRole('heading', { level: 2 }).textContent).toBe(
      'Charms · 5 slots · Power 1 + 1.75',
    );
    expect(within(charms).getAllByRole('listitem')).toHaveLength(5);
    expect(within(charms).getByText('Rubber Duck, plus 0.25 Power')).toBeTruthy();
    expect(within(charms).getAllByText('Empty Charm slot')).toHaveLength(2);
    expect(charms.querySelectorAll('svg')).toHaveLength(3);
  });

  it('shows five empty Charm slots for a new character', async () => {
    await renderApp({ hash: '#/character', variant: 'noevents' });
    const charms = screen.getByRole('region', { name: /Charms/ });
    expect(within(charms).getAllByText('Empty Charm slot')).toHaveLength(5);
    expect(charms.textContent).toContain('No Charms yet');
    expect(screen.getByText('Level 1 · 0 / 500 XP')).toBeTruthy();
  });

  it('shows the gear tier from the level, and the whole ladder', async () => {
    await renderApp({ hash: '#/character' });
    const gear = screen.getByRole('region', { name: /Gear tier/ });
    expect(within(gear).getByRole('heading', { level: 2 }).textContent).toBe(
      'Gear tier · Iron · Mithril at level 50',
    );
    const tiers = within(gear).getAllByRole('listitem');
    expect(tiers.map((tier) => tier.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
      '1 Rags',
      '10 Leather',
      '30 Iron Wearing',
      '50 Mithril',
      '70 Rune',
      '90 Dragon',
      '99 Trimmed',
    ]);
    expect(tiers[2]?.getAttribute('aria-current')).toBe('true');
  });

  it('offers Sign out only when there is a real session to end', async () => {
    await renderApp({ hash: '#/character' });
    expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull();
    document.body.innerHTML = '';
    const onSignOut = vi.fn();
    await renderApp({ hash: '#/character', onSignOut });
    await fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });
});

describe('navigation and layout', () => {
  it('has the main navigation with the current screen marked', async () => {
    await renderApp({ hash: '#/log' });
    const nav = screen.getByRole('navigation', { name: 'Main' });
    const links = within(nav).getAllByRole('link');
    expect(links.map((link) => link.textContent?.trim())).toEqual([
      'T Town',
      'E Expedition',
      'F Forge',
      'C Character',
      '★ Feats',
      '$ Shop',
      'M Map',
      'L Log',
      'B Bestiary',
      'S Settings',
    ]);
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '#/',
      '#/expedition',
      '#/forge',
      '#/character',
      '#/feats',
      '#/shop',
      '#/map',
      '#/log',
      '#/bestiary',
      '#/settings',
    ]);
    expect(within(nav).getByRole('link', { name: /Log/ }).getAttribute('aria-current')).toBe(
      'page',
    );
    expect(within(nav).getByRole('link', { name: /Town/ }).getAttribute('aria-current')).toBeNull();
  });

  it('moves between screens on hash changes, updates the title and moves focus to the screen', async () => {
    await renderApp();
    expect(h1().textContent).toBe('Town');
    window.location.hash = '#/character';
    await waitFor(() => expect(h1().textContent).toBe('Character'));
    expect(document.title).toBe('Character · Mergescape');
    await waitFor(() => expect(document.activeElement?.id).toBe('main'));
    window.location.hash = '#/log';
    await waitFor(() => expect(h1().textContent).toBe('Combat Log'));
  });

  it('has a skip link that focuses the content without touching the route', async () => {
    await renderApp({ hash: '#/log' });
    await fireEvent.click(screen.getByRole('link', { name: 'Skip to content' }));
    expect(document.activeElement?.id).toBe('main');
    expect(window.location.hash).toBe('#/log');
  });

  it('shows not-found for unknown routes', async () => {
    await renderApp({ hash: '#/nope' });
    expect(h1().textContent).toBe('Not found');
    expect(screen.getByText('/nope')).toBeTruthy();
    expect(document.title).toBe('Not found · Mergescape');
  });

  it('has exactly one main landmark and one h1 on every screen', async () => {
    for (const hash of [
      '#/',
      '#/log',
      '#/character',
      '#/shop',
      '#/map',
      '#/bestiary',
      '#/expedition',
      '#/forge',
      '#/feats',
      '#/settings',
      '#/privacy',
      '#/terms',
      '#/cookies',
      '#/welcome',
    ]) {
      document.body.innerHTML = '';
      await renderApp({ hash });
      expect(screen.getAllByRole('main')).toHaveLength(1);
      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    }
  });
});

describe('loading and error states', () => {
  it('says the dungeon is waking while the first reads are in flight', async () => {
    const pending = new Promise<never>(() => {});
    const api: Api = {
      ...createFixtureApi({ now: NOW }),
      me: () => pending,
      log: () => pending,
      installations: () => pending,
    };
    await renderApp({ api, skipWait: true });
    expect(screen.getByRole('status').textContent).toContain('Waking the dungeon');
  });

  it('shows an error with a retry that works', async () => {
    const base = createFixtureApi({ now: NOW });
    let failures = 1;
    const api: Api = {
      ...base,
      async me() {
        if (failures-- > 0) {
          throw new ApiError(0, 'Could not reach the server.');
        }
        return base.me();
      },
    };
    await renderApp({ api });
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Could not reach the server.');
    await fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(h1().textContent).toBe('Town'));
    expect(screen.getByRole('region', { name: /Level 41/ })).toBeTruthy();
  });
});

describe('level-up flash', () => {
  it('announces the new level, then goes away on its own', async () => {
    vi.useFakeTimers({ now: NOW, toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const base = createFixtureApi({ now: NOW });
    const entries = fixtureLogEntries(NOW);
    let leveled = false;
    const api: Api = {
      ...base,
      async me() {
        const me = fixtureMe(NOW);
        return leveled ? { ...me, xp: me.xp + (entries[0]?.xp ?? 0) } : me;
      },
      async log(cursor) {
        const page = await base.log(cursor);
        if (!leveled || cursor || !entries[0]) {
          return page;
        }
        // The merge that caused the level-up arrives with it.
        const arrived = { ...entries[0], id: 'arrived#1', at: new Date(NOW).toISOString() };
        return { ...page, entries: [arrived, ...page.entries] };
      },
    };
    const { session } = await renderApp({ api });
    expect(screen.queryByText('Level up!')).toBeNull();

    leveled = true;
    await session.refresh();
    const flash = await screen.findByText('Level up!');
    expect(flash.closest('[role="status"]')?.textContent).toContain('Level 42');
    expect(flash.closest('[role="status"]')?.textContent).toContain('Smithing led the way.');
    expect(document.querySelector('.wash')).not.toBeNull();

    await vi.advanceTimersByTimeAsync(LEVEL_UP_MS + 10);
    await waitFor(() => expect(screen.queryByText('Level up!')).toBeNull());
    expect(session.levelUp).toBeNull();
  });

  it('drops the full-screen flash under reduced motion and keeps the message', async () => {
    mockReducedMotion(true);
    const base = createFixtureApi({ now: NOW });
    let leveled = false;
    const api: Api = {
      ...base,
      async me() {
        const me = fixtureMe(NOW);
        return leveled ? { ...me, xp: me.xp + 300_000 } : me;
      },
    };
    const { session } = await renderApp({ api });
    leveled = true;
    await session.refresh();
    expect(await screen.findByText('Level up!')).toBeTruthy();
    expect(document.querySelector('.wash')).toBeNull();
    expect(document.querySelector('.flash.reduced')).not.toBeNull();
  });
});

describe('sound is opt-in (Requirement 10.5)', () => {
  const TOUR = [
    '#/',
    '#/log',
    '#/map',
    '#/shop',
    '#/expedition',
    '#/forge',
    '#/feats',
    '#/settings',
  ];

  it('makes no audio object anywhere in the app while sound is off, reduced motion or not', async () => {
    for (const reduced of [false, true]) {
      mockReducedMotion(reduced);
      const audio = stubAudio();
      for (const hash of TOUR) {
        const { unmount } = await renderApp({ hash });
        window.dispatchEvent(new Event('pointerdown'));
        unmount();
      }
      expect(audio.contexts, `reduced motion ${reduced}`).toHaveLength(0);
    }
  });

  it('plays the level-up cue with the flash when sound is on', async () => {
    const audio = soundOnAfterGesture();
    const base = createFixtureApi({ now: NOW });
    let leveled = false;
    const api: Api = {
      ...base,
      async me() {
        const me = fixtureMe(NOW);
        return leveled ? { ...me, xp: me.xp + 300_000 } : me;
      },
    };
    const { session } = await renderApp({ api });
    expect(cuesHeard(audio)).toEqual([]);
    leveled = true;
    await session.refresh();
    await screen.findByText('Level up!');
    expect(cuesHeard(audio)).toEqual(['levelUp']);
  });
});

describe('fixture mode touches no network', () => {
  it('renders every screen without calling fetch', async () => {
    for (const hash of [
      '#/',
      '#/log',
      '#/character',
      '#/shop',
      '#/map',
      '#/bestiary',
      '#/settings',
      '#/privacy',
      '#/terms',
      '#/cookies',
      '#/welcome',
      '#/nope',
    ]) {
      document.body.innerHTML = '';
      await renderApp({ hash });
    }
    for (const variant of ['noevents', 'noinstall', 'monday'] as const) {
      for (const hash of ['#/', '#/shop', '#/map', '#/bestiary', '#/settings']) {
        document.body.innerHTML = '';
        await renderApp({ variant, hash });
      }
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
