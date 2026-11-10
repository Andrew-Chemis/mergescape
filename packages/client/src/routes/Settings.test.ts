/**
 * Settings from fixtures: the installations list with its GitHub links, the timezone line, Export JSON
 * offered as a downloadable Blob, and Delete everything behind a two-step in-page confirmation that
 * needs the login typed. Export and delete may answer 404 until task 18 ships; both say so inline.
 */
import { fireEvent, screen, waitFor, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../lib/api';
import type { Api } from '../lib/api';
import { CONSENT_KEY, consent, soundAllowed } from '../lib/consent';
import { createFixtureApi } from '../lib/fixtures/api';
import { exportFileName, formatOffset, timezoneInfo } from '../lib/settings';
import { armSound } from '../lib/sound';
import { cuesHeard, gesture, stubAudio } from '../test/audio';
import { forbidNetwork, mockReducedMotion, NOW, renderApp, textOf } from '../test/helpers';

forbidNetwork();

const settings = (options: Parameters<typeof renderApp>[0] = {}) =>
  renderApp({ hash: '#/settings', ...options });

/** jsdom has no object URLs; a stand-in that keeps the Blobs it was given. */
let blobs: Blob[] = [];
let clicked: { href: string; download: string }[] = [];
let revoked: string[] = [];
const realCreate = URL.createObjectURL;
const realRevoke = URL.revokeObjectURL;

beforeEach(() => {
  blobs = [];
  clicked = [];
  revoked = [];
  let next = 0;
  URL.createObjectURL = vi.fn((blob: Blob) => {
    blobs.push(blob);
    next += 1;
    return `blob:fixture-${next}`;
  }) as typeof URL.createObjectURL;
  URL.revokeObjectURL = vi.fn((url: string) => {
    revoked.push(url);
  });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    clicked.push({ href: this.href, download: this.download });
  });
});

afterEach(() => {
  URL.createObjectURL = realCreate;
  URL.revokeObjectURL = realRevoke;
});

const soundSwitch = () =>
  screen.getByRole('switch', { name: 'Play sound effects' }) as HTMLInputElement;

const badgeSwitch = () =>
  screen.getByRole('switch', { name: 'Show my badge publicly' }) as HTMLInputElement;

describe('Settings: the README badge (Requirement 11.4)', () => {
  it('shows the switch on, says what the badge shows and what turning it off does', async () => {
    await settings();
    const panel = screen.getByRole('region', { name: 'README badge' });
    expect(badgeSwitch().checked).toBe(true);
    const text = textOf(panel);
    expect(text).toContain('level, Vocation, Renown and the Feats you pinned');
    expect(text).toContain('neutral "unranked" badge');
    expect(text).toContain('Your badge is public.');
    expect(text).toContain('up to 6 hours');
  });

  it('turns the badge off through POST /settings and shows the profile it answers with', async () => {
    const base = createFixtureApi({ now: NOW });
    const settingsCall = vi.fn(base.settings);
    const { session } = await settings({ api: { ...base, settings: settingsCall } });
    await fireEvent.click(badgeSwitch());
    await waitFor(() => expect(session.me?.badgePublic).toBe(false));
    expect(settingsCall).toHaveBeenCalledTimes(1);
    expect((settingsCall.mock.calls[0] as unknown as [boolean])[0]).toBe(false);
    expect(badgeSwitch().checked).toBe(false);
    expect(textOf(screen.getByRole('region', { name: 'README badge' }))).toContain(
      'Your badge is hidden.',
    );
    await fireEvent.click(badgeSwitch());
    await waitFor(() => expect(session.me?.badgePublic).toBe(true));
    expect(badgeSwitch().checked).toBe(true);
  });

  it('starts off for a player who turned it off earlier', async () => {
    await settings({ me: { badgePublic: false } });
    expect(badgeSwitch().checked).toBe(false);
  });

  it('says so, and puts the switch back, when the server refuses or cannot be reached', async () => {
    const base = createFixtureApi({ now: NOW });
    const api: Api = {
      ...base,
      async settings() {
        throw new ApiError(0, 'Could not reach the server.');
      },
    };
    const { session } = await settings({ api });
    await fireEvent.click(badgeSwitch());
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(textOf(screen.getByRole('region', { name: 'README badge' }))).toContain(
      'Could not reach the server',
    );
    expect(badgeSwitch().checked).toBe(true);
    expect(session.me?.badgePublic).toBe(true);
  });
});

describe('Settings: sound', () => {
  it('has the Sound panel, with the switch off, and builds no audio object just by being opened', async () => {
    const audio = stubAudio();
    await settings();
    const panel = screen.getByRole('region', { name: 'Sound' });
    expect(textOf(panel)).toContain('there are no audio files');
    expect(textOf(panel)).toContain('Sound is off, which is how it starts');
    expect(soundSwitch().checked).toBe(false);
    expect(soundAllowed()).toBe(false);
    expect(within(panel).getByRole('button', { name: 'Hear a sample' })).toHaveProperty(
      'disabled',
      true,
    );
    expect(audio.contexts).toHaveLength(0);
    expect(window.localStorage.getItem(CONSENT_KEY)).toBeNull();
  });

  it('turns on only when the player flips the switch, and remembers it on this device', async () => {
    await settings();
    await fireEvent.click(soundSwitch());
    expect(soundSwitch().checked).toBe(true);
    expect(soundAllowed()).toBe(true);
    expect(JSON.parse(window.localStorage.getItem(CONSENT_KEY) ?? 'null')).toMatchObject({
      sound: true,
      analytics: false,
    });
    const panel = screen.getByRole('region', { name: 'Sound' });
    expect(textOf(panel)).toContain('Sound is on.');
    expect(textOf(panel)).toContain('after your first click, tap or key press');
    await fireEvent.click(soundSwitch());
    expect(soundAllowed()).toBe(false);
    expect(JSON.parse(window.localStorage.getItem(CONSENT_KEY) ?? 'null').sound).toBe(false);
  });

  it('starts on when it was turned on before (a reload), and reads the same from the Cookies key', async () => {
    window.localStorage.setItem(CONSENT_KEY, '{"analytics":false,"sound":true,"updatedAt":null}');
    await settings();
    expect(soundSwitch().checked).toBe(true);
    expect(
      within(screen.getByRole('region', { name: 'Sound' })).getByRole('button', {
        name: 'Hear a sample',
      }),
    ).toHaveProperty('disabled', false);
  });

  it('plays a sample, through the real engine, once it is on and the page has been touched', async () => {
    const audio = stubAudio();
    armSound();
    await settings();
    await fireEvent.click(soundSwitch());
    gesture();
    await fireEvent.click(screen.getByRole('button', { name: 'Hear a sample' }));
    expect(cuesHeard(audio)).toEqual(['levelUp']);
  });

  it('is not turned on by prefers-reduced-motion, and says so', async () => {
    mockReducedMotion(true);
    const audio = stubAudio();
    armSound();
    await settings();
    gesture();
    expect(soundSwitch().checked).toBe(false);
    expect(soundAllowed()).toBe(false);
    expect(textOf(screen.getByRole('region', { name: 'Sound' }))).toContain(
      'reduced motion. That never turns sound on',
    );
    expect(audio.contexts).toHaveLength(0);
  });

  it('says so when the browser will not save the choice', async () => {
    await settings();
    vi.spyOn(consent, 'setSound').mockReturnValue(false);
    await fireEvent.click(soundSwitch());
    expect(textOf(screen.getByRole('region', { name: 'Sound' }))).toContain(
      'would not let Mergescape save your choice',
    );
  });
});

describe('Settings', () => {
  it('shows the account, the timezone line and links to the small print', async () => {
    await settings();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Settings');
    const account = screen.getByRole('region', { name: 'Account' });
    expect(textOf(account)).toContain('Signed in as octo-dev');
    expect(textOf(account)).toContain('The game runs on UTC');
    expect(textOf(account)).toContain('weeks start on Monday at 00:00 UTC');
    expect(textOf(account)).toContain(timezoneInfo().name);
    const legal = screen.getByRole('region', { name: 'The small print' });
    expect(within(legal).getByRole('link', { name: 'Privacy' }).getAttribute('href')).toBe(
      '#/privacy',
    );
    expect(within(legal).getByRole('link', { name: 'Terms' }).getAttribute('href')).toBe('#/terms');
  });

  it('lists the installations with the GitHub install and manage links', async () => {
    await settings();
    const installs = screen.getByRole('region', { name: 'Installations' });
    const rows = within(installs).getAllByRole('listitem');
    expect(rows).toHaveLength(1);
    expect(textOf(rows[0])).toBe('Installation 5001 on account 4242 4 repositories');
    const add = within(installs).getByRole('link', { name: 'Install on more repositories' });
    expect(add.getAttribute('href')).toBe('https://github.com/apps/mergescape/installations/new');
    expect(add.getAttribute('rel')).toContain('noopener');
    expect(
      within(installs).getByRole('link', { name: 'Manage on GitHub' }).getAttribute('href'),
    ).toBe('https://github.com/settings/installations');
  });

  it('says so when the App is installed nowhere, and flags a suspended installation', async () => {
    await settings({ variant: 'noinstall' });
    expect(textOf(screen.getByRole('region', { name: 'Installations' }))).toContain(
      'The App is not installed anywhere yet',
    );

    document.body.innerHTML = '';
    const base = createFixtureApi({ now: NOW });
    const api: Api = {
      ...base,
      async installations() {
        return {
          installations: [{ installationId: 7, accountId: 1, repoCount: 1, suspended: true }],
        };
      },
    };
    await settings({ api });
    const row = within(screen.getByRole('region', { name: 'Installations' })).getAllByRole(
      'listitem',
    )[0];
    expect(textOf(row)).toBe('Installation 7 on account 1 1 repository Suspended');
  });

  it('offers Sign out only when there is a real session', async () => {
    await settings();
    expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull();
    document.body.innerHTML = '';
    const onSignOut = vi.fn();
    await settings({ onSignOut });
    await fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });
});

describe('Export JSON', () => {
  it('offers the export as a downloadable Blob and a visible link', async () => {
    await settings();
    await fireEvent.click(screen.getByRole('button', { name: 'Export JSON' }));
    const link = await screen.findByRole('link', {
      name: 'Download mergescape-octo-dev-2026-11-11.json',
    });
    expect(link.getAttribute('href')).toBe('blob:fixture-1');
    expect(link.getAttribute('download')).toBe('mergescape-octo-dev-2026-11-11.json');
    expect(textOf(link.closest('p'))).toContain('Your export is ready.');

    // The file was also offered straight away.
    expect(clicked).toEqual([
      { href: 'blob:fixture-1', download: 'mergescape-octo-dev-2026-11-11.json' },
    ]);

    // The Blob is JSON with the contract's keys.
    expect(blobs).toHaveLength(1);
    expect(blobs[0]?.type).toBe('application/json');
    const body = JSON.parse(await (blobs[0] as Blob).text()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual([
      'events',
      'expeditions',
      'exportedAt',
      'feats',
      'jobs',
      'profile',
      'weeks',
    ]);
    expect((body['profile'] as { login: string }).login).toBe('octo-dev');
  });

  it('releases the previous file when exporting again, and when leaving the screen', async () => {
    const { unmount } = await settings();
    await fireEvent.click(screen.getByRole('button', { name: 'Export JSON' }));
    await screen.findByRole('link', { name: /^Download / });
    await fireEvent.click(screen.getByRole('button', { name: 'Export JSON' }));
    await waitFor(() => expect(blobs).toHaveLength(2));
    expect(revoked).toEqual(['blob:fixture-1']);
    unmount();
    expect(revoked).toEqual(['blob:fixture-1', 'blob:fixture-2']);
  });

  it('says so inline when the server has no /export yet (404)', async () => {
    const base = createFixtureApi({ now: NOW });
    const api: Api = {
      ...base,
      async exportData() {
        throw new ApiError(404, 'The server answered 404.');
      },
    };
    await settings({ api });
    await fireEvent.click(screen.getByRole('button', { name: 'Export JSON' }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'This server does not offer that yet.',
    );
    expect(screen.queryByRole('link', { name: /^Download / })).toBeNull();
    expect(blobs).toHaveLength(0);
  });

  it('says so when the browser cannot make a file', async () => {
    Object.defineProperty(URL, 'createObjectURL', {
      value: undefined,
      configurable: true,
      writable: true,
    });
    await settings();
    await fireEvent.click(screen.getByRole('button', { name: 'Export JSON' }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'This browser cannot save files from the page.',
    );
  });
});

describe('Delete everything', () => {
  const open = async () => {
    await fireEvent.click(screen.getByRole('button', { name: 'Delete everything…' }));
    return screen.getByRole('textbox', { name: /Type your GitHub login/ }) as HTMLInputElement;
  };
  const confirm = () =>
    screen.getByRole('button', { name: 'Delete everything' }) as HTMLButtonElement;

  it('is two steps: a button first, then typing the login', async () => {
    await settings();
    // Step one: only the opening button is there. Nothing can be deleted yet.
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete everything' })).toBeNull();
    const opener = screen.getByRole('button', { name: 'Delete everything…' });
    expect(opener.getAttribute('aria-expanded')).toBe('false');

    // Step two: the warning, the field, and a confirm button that is off until the login matches.
    const field = await open();
    await waitFor(() => expect(document.activeElement).toBe(field));
    expect(textOf(document.getElementById('confirm-delete'))).toContain('cannot be undone');
    expect(confirm().disabled).toBe(true);
    await fireEvent.input(field, { target: { value: 'octo' } });
    expect(confirm().disabled).toBe(true);
    await fireEvent.input(field, { target: { value: 'OCTO-DEV ' } });
    expect(confirm().disabled).toBe(false);
  });

  it('can be cancelled, and starts empty the next time', async () => {
    await settings();
    const field = await open();
    await fireEvent.input(field, { target: { value: 'octo-dev' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('textbox')).toBeNull();
    const again = await open();
    expect(again.value).toBe('');
    expect(confirm().disabled).toBe(true);
  });

  it('calls POST /delete with the typed login and reports success', async () => {
    const base = createFixtureApi({ now: NOW });
    const deleteAccount = vi.fn(base.deleteAccount);
    await settings({ api: { ...base, deleteAccount } });
    const field = await open();
    await fireEvent.input(field, { target: { value: 'Octo-Dev' } });
    await fireEvent.click(confirm());
    await waitFor(() => expect(screen.getByRole('status')).toBeTruthy());
    expect(deleteAccount).toHaveBeenCalledTimes(1);
    expect((deleteAccount.mock.calls[0] as unknown as [string])[0]).toBe('Octo-Dev');
    expect(textOf(screen.getByRole('status'))).toContain('Everything was deleted.');
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  // The old token would only get 404 no_profile from now on, with no way out of the error panel: so a
  // successful delete ends the session. The player is back on Landing, with the token forgotten.
  it('ends the session after a delete: Landing, the token forgotten, nothing left to sign out of', async () => {
    const onUnauthorized = vi.fn();
    const { session } = await settings({ session: { onUnauthorized }, onSignOut: vi.fn() });
    const field = await open();
    await fireEvent.input(field, { target: { value: 'octo-dev' } });
    await fireEvent.click(confirm());
    await screen.findByRole('status');
    expect(session.status).toBe('signed-out');
    expect(session.busy).toBeNull();
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Mergescape');
    expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull();
    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull();
  });

  it('says so inline when the server has no /delete yet (404), and keeps the form', async () => {
    const base = createFixtureApi({ now: NOW });
    const api: Api = {
      ...base,
      async deleteAccount() {
        throw new ApiError(404, 'The server answered 404.');
      },
    };
    await settings({ api });
    const field = await open();
    await fireEvent.input(field, { target: { value: 'octo-dev' } });
    await fireEvent.click(confirm());
    expect((await screen.findByRole('alert')).textContent).toBe(
      'This server does not offer that yet.',
    );
    expect(screen.getByRole('textbox')).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('shows confirm_mismatch from the server in words', async () => {
    const base = createFixtureApi({ now: NOW });
    const api: Api = {
      ...base,
      async deleteAccount() {
        throw new ApiError(400, 'bad', 'confirm_mismatch');
      },
    };
    await settings({ api });
    const field = await open();
    await fireEvent.input(field, { target: { value: 'octo-dev' } });
    await fireEvent.click(confirm());
    expect((await screen.findByRole('alert')).textContent).toBe(
      'That is not your GitHub login. Nothing was deleted.',
    );
  });
});

describe('Settings helpers', () => {
  it('names the export file after the login and the day', () => {
    expect(exportFileName('octo-dev', new Date(Date.UTC(2026, 10, 11, 23, 0)))).toBe(
      'mergescape-octo-dev-2026-11-11.json',
    );
    expect(exportFileName('we/ird name', new Date(Date.UTC(2026, 0, 2)))).toBe(
      'mergescape-we_ird_name-2026-01-02.json',
    );
  });

  it('formats UTC offsets from getTimezoneOffset', () => {
    expect(formatOffset(0)).toBe('UTC+00:00');
    expect(formatOffset(-60)).toBe('UTC+01:00');
    expect(formatOffset(480)).toBe('UTC-08:00');
    expect(formatOffset(-330)).toBe('UTC+05:30');
  });

  it('describes the timezone with a name, an offset and where Monday lands', () => {
    const info = timezoneInfo(new Date(Date.UTC(2026, 10, 11)));
    expect(info.name.length).toBeGreaterThan(0);
    expect(info.offset).toMatch(/^UTC[+-]\d\d:\d\d$/);
    expect(info.mondayLocal).toMatch(/^(Sun|Mon)/);
  });
});
