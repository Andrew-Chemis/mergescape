/**
 * The Cookies page (`#/cookies`): what Mergescape keeps in the browser, the analytics switch (a real
 * control with nothing reading it yet), and Clear local data. Also guards the claim itself: the source
 * sets no cookies and every local-storage key it uses is listed on the page.
 */
import { fireEvent, screen, within } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import { TOKEN_KEY } from '../lib/api';
import { analyticsAllowed, CONSENT_KEY, pageControls } from '../lib/consent';
import { LEGAL_UPDATED } from '../lib/promises';
import { REVEAL_KEY } from '../lib/reveal';
import { forbidNetwork, renderApp, textOf } from '../test/helpers';
import cookiesSource from './Cookies.svelte?raw';

forbidNetwork();

const cookies = (options: Parameters<typeof renderApp>[0] = {}) =>
  renderApp({ hash: '#/cookies', ...options });

const analyticsSwitch = () =>
  screen.getByRole('switch', { name: 'Allow first-party analytics' }) as HTMLInputElement;

const storedKeys = () =>
  Array.from({ length: window.localStorage.length }, (_, i) => window.localStorage.key(i)).sort();

describe('the Cookies page', () => {
  it('has its own title and says plainly that no cookies are set', async () => {
    await cookies();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Cookies');
    expect(document.title).toBe('Cookies · Mergescape');
    const plain = textOf(screen.getByRole('region', { name: 'In plain words' }));
    expect(plain).toContain('Mergescape sets no tracking cookies.');
    expect(plain).toContain('three small items in your browser');
    expect(plain).toContain('one strictly necessary cookie');
    expect(plain).toContain('ten minutes');
    expect(plain).toContain('There are no analytics today');
  });

  it('lists the three local-storage keys, taken from the code that uses them', async () => {
    await cookies();
    const region = screen.getByRole('region', { name: 'What is stored on this device' });
    const keys = Array.from(region.querySelectorAll('code')).map((code) => code.textContent);
    expect(keys).toEqual([TOKEN_KEY, REVEAL_KEY, CONSENT_KEY]);
    expect(keys).toEqual(['mergescape.token', 'mergescape.mogulSeen', 'mergescape.consent']);
    expect(within(region).getAllByRole('listitem')).toHaveLength(3);
    const text = textOf(region);
    expect(text).toContain('expires after 7 days');
    expect(text).toContain('Mogul reveal');
    expect(text).toContain('no cookie banner');
  });

  it('explains GitHub setting its own cookies during sign-in', async () => {
    await cookies();
    const text = textOf(screen.getByRole('region', { name: "GitHub's own cookies" }));
    expect(text).toContain('GitHub sets its own cookies');
    expect(text).toContain('Mergescape cannot see, read or control them');
  });

  it('explains how to clear everything, and that the server data stays', async () => {
    await cookies();
    const region = screen.getByRole('region', { name: 'Clear local data' });
    const text = textOf(region);
    expect(text).toContain('Settings, then Sign out');
    expect(text).toContain('starts with mergescape.');
    expect(text).toContain('Your character and your records on the server stay as they were');
    expect(within(region).getByRole('link', { name: 'Settings' }).getAttribute('href')).toBe(
      '#/settings',
    );
  });

  it('opens without signing in, with no navigation rail and a way back to the start', async () => {
    await cookies({ api: null, signInHref: 'https://api.example/auth/login' });
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Cookies');
    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Back to the start' }).getAttribute('href')).toBe(
      '#/welcome',
    );
    expect(screen.getAllByRole('main')).toHaveLength(1);
  });

  it('shows the navigation with Settings marked when signed in, and goes back to Settings', async () => {
    await cookies();
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(
      within(nav)
        .getByRole('link', { name: /Settings/ })
        .getAttribute('aria-current'),
    ).toBe('page');
    expect(screen.getByRole('link', { name: 'Back to Settings' }).getAttribute('href')).toBe(
      '#/settings',
    );
  });

  it('shows when it was last updated and links to Privacy', async () => {
    await cookies();
    const foot = textOf(screen.getByText(/^Last updated/));
    expect(foot).toContain(`Last updated ${LEGAL_UPDATED}`);
    expect(screen.getAllByRole('link', { name: 'Privacy' })[0]?.getAttribute('href')).toBe(
      '#/privacy',
    );
  });
});

describe('the analytics switch', () => {
  it('is a real switch, off by default, and not disabled', async () => {
    await cookies();
    const toggle = analyticsSwitch();
    expect(toggle.checked).toBe(false);
    expect(toggle.disabled).toBe(false);
    expect(toggle.getAttribute('aria-disabled')).toBeNull();
    expect(textOf(screen.getByRole('region', { name: 'Analytics choice' }))).toContain(
      'You have not made a choice, so analytics are off.',
    );
    // Looking at the page is not a choice: nothing is written.
    expect(window.localStorage.getItem(CONSENT_KEY)).toBeNull();
  });

  it('says that analytics are not yet enabled, whatever the switch says', async () => {
    await cookies();
    const text = textOf(screen.getByRole('region', { name: 'Analytics choice' }));
    expect(text).toContain('Analytics are not yet enabled.');
    expect(text).toContain('does not measure anything about your visit today');
    expect(text).toContain('opt-in');
    expect(text).toContain('nothing reads it');
  });

  it('turns on and off with the keyboard-friendly checkbox, and saves each choice', async () => {
    await cookies();
    const toggle = analyticsSwitch();

    await fireEvent.click(toggle);
    expect(toggle.checked).toBe(true);
    const on = JSON.parse(window.localStorage.getItem(CONSENT_KEY) ?? 'null') as {
      analytics: boolean;
      updatedAt: string;
    };
    expect(on.analytics).toBe(true);
    expect(Number.isNaN(Date.parse(on.updatedAt))).toBe(false);
    expect(analyticsAllowed()).toBe(true);
    const status = textOf(screen.getByRole('region', { name: 'Analytics choice' }));
    expect(status).toContain('Your choice is analytics on, set on 2026-11-11.');

    await fireEvent.click(toggle);
    expect(toggle.checked).toBe(false);
    expect(JSON.parse(window.localStorage.getItem(CONSENT_KEY) ?? 'null').analytics).toBe(false);
    expect(analyticsAllowed()).toBe(false);
    expect(textOf(screen.getByRole('region', { name: 'Analytics choice' }))).toContain(
      'Your choice is analytics off, set on 2026-11-11.',
    );
  });

  it('shows a saved choice when the page is opened again', async () => {
    window.localStorage.setItem(
      CONSENT_KEY,
      JSON.stringify({ analytics: true, updatedAt: '2026-10-01T08:00:00.000Z' }),
    );
    await cookies();
    expect(analyticsSwitch().checked).toBe(true);
    expect(textOf(screen.getByRole('region', { name: 'Analytics choice' }))).toContain(
      'Your choice is analytics on, set on 2026-10-01.',
    );
  });

  it('treats a damaged stored choice as off', async () => {
    window.localStorage.setItem(CONSENT_KEY, '{"analytics":"yes"');
    await cookies();
    expect(analyticsSwitch().checked).toBe(false);
  });

  it('still flips, and says so, when the browser will not save the choice', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    await cookies();
    await fireEvent.click(analyticsSwitch());
    expect(analyticsSwitch().checked).toBe(true);
    expect(screen.getByText(/would not let Mergescape save your choice/)).toBeTruthy();
    expect(window.localStorage.getItem(CONSENT_KEY)).toBeNull();
  });
});

describe('Clear local data', () => {
  it('removes every mergescape.* key and the token, leaves other sites keys alone, then reloads', async () => {
    const reload = vi.spyOn(pageControls, 'reload').mockImplementation(() => {});
    window.localStorage.setItem(TOKEN_KEY, 'a.b.c');
    window.localStorage.setItem(REVEAL_KEY, '2026-46');
    window.localStorage.setItem('mergescape.somethingNew', '1');
    window.localStorage.setItem('unrelated', 'keep me');
    await cookies();
    await fireEvent.click(analyticsSwitch());
    expect(storedKeys()).toContain(CONSENT_KEY);

    await fireEvent.click(screen.getByRole('button', { name: 'Clear local data' }));

    expect(storedKeys()).toEqual(['unrelated']);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(textOf(screen.getByRole('region', { name: 'Clear local data' }))).toContain(
      'Removed 4 items from this device. Reloading the page.',
    );
    // The choice goes back to off, in the open page as well as in storage.
    expect(analyticsSwitch().checked).toBe(false);
    expect(analyticsAllowed()).toBe(false);
  });

  it('says so when there was nothing to remove, and uses the singular for one item', async () => {
    const reload = vi.spyOn(pageControls, 'reload').mockImplementation(() => {});
    await cookies();
    await fireEvent.click(screen.getByRole('button', { name: 'Clear local data' }));
    expect(textOf(screen.getByRole('region', { name: 'Clear local data' }))).toContain(
      'Nothing was stored on this device. Reloading the page.',
    );

    window.localStorage.setItem(TOKEN_KEY, 'a.b.c');
    await fireEvent.click(screen.getByRole('button', { name: 'Clear local data' }));
    expect(textOf(screen.getByRole('region', { name: 'Clear local data' }))).toContain(
      'Removed 1 item from this device.',
    );
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it('also clears the stored token while signed out, from the standalone page', async () => {
    const reload = vi.spyOn(pageControls, 'reload').mockImplementation(() => {});
    window.localStorage.setItem(TOKEN_KEY, 'a.b.c');
    await cookies({ api: null, signInHref: 'https://api.example/auth/login' });
    await fireEvent.click(screen.getByRole('button', { name: 'Clear local data' }));
    expect(window.localStorage.getItem(TOKEN_KEY)).toBeNull();
    expect(reload).toHaveBeenCalledTimes(1);
  });
});

describe('the claim "no cookies, three keys" is true of the source', () => {
  // Every non-test source file of the client, as text.
  const sources = Object.entries(
    import.meta.glob('../**/*.{ts,svelte}', {
      query: '?raw',
      import: 'default',
      eager: true,
    }) as Record<string, string>,
  ).filter(([path]) => !/\.test\.ts$/.test(path) && !path.includes('/test/'));

  it('finds the sources to scan', () => {
    expect(sources.length).toBeGreaterThan(20);
  });

  it('never writes a cookie or uses session storage or IndexedDB', () => {
    for (const [path, source] of sources) {
      const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      expect(code, path).not.toMatch(/document\.cookie|sessionStorage|indexedDB/);
    }
  });

  it('uses no mergescape.* key that this page does not list', () => {
    const found = new Set<string>();
    for (const [, source] of sources) {
      for (const match of source.matchAll(/['"`](mergescape\.[A-Za-z0-9_.-]+)['"`]/g)) {
        found.add(match[1] as string);
      }
    }
    expect([...found].sort()).toEqual([TOKEN_KEY, REVEAL_KEY, CONSENT_KEY].sort());
  });

  it('declares nothing that could overflow a 400px screen (the browser run checks the real layout)', () => {
    const css = /<style>([\s\S]*?)<\/style>/.exec(cookiesSource)?.[1] ?? '';
    expect(css.length).toBeGreaterThan(0);
    expect(css).not.toMatch(/white-space:\s*nowrap/);
    for (const match of css.matchAll(/(?:^|[\s;{])(?:min-)?width:\s*(\d+(?:\.\d+)?)px/g)) {
      expect(Number(match[1]), match[0]).toBeLessThanOrEqual(360);
    }
  });
});
