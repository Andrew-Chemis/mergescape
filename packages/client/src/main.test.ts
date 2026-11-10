/**
 * The entry point, end to end against a stubbed api: what the page does with the fragment the sign-in
 * redirect leaves in the address bar. The api sends `#token=<jwt>` on success and `#error=<code>` when
 * sign-in fails; the router must never read either as a path.
 */
import { screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readToken, TOKEN_KEY } from './lib/api';
import { fixtureInstallations, fixtureLogEntries, fixtureMe } from './lib/fixtures/state';
import { NOW } from './test/helpers';

const TOKEN = 'aaa.bbb.ccc';
const API = 'https://api.example';

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** The three reads the app makes on load, answered from the fixtures. */
const stubbedApi = () =>
  vi.fn(async (input: string | URL | Request) => {
    const path = new URL(String(input)).pathname;
    if (path === '/me') return json(fixtureMe(NOW));
    if (path === '/log') return json({ entries: fixtureLogEntries(NOW), nextCursor: null });
    if (path === '/installations') return json(fixtureInstallations());
    throw new Error(`unexpected request to ${path}`);
  });

async function boot(hash: string): Promise<void> {
  window.history.replaceState(null, '', `/${hash}`);
  vi.resetModules();
  await import('./main');
}

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>';
  vi.stubEnv('VITE_API_ORIGIN', API);
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.unstubAllEnvs();
});

describe('when sign-in did not work', () => {
  it.each([
    ['access_denied', /sign-in was cancelled/],
    ['invalid_state', /expired or was already used/],
    ['invalid_request', /could not read/],
    ['github_unavailable', /GitHub did not answer/],
    ['auth_failed', /could not confirm who you are/],
    ['server_error', /went wrong on our side/],
  ])(
    '#error=%s shows a notice on Landing and leaves the address bar clean',
    async (code, words) => {
      vi.stubGlobal('fetch', stubbedApi());
      await boot(`#error=${code}`);
      expect((await screen.findByRole('status')).textContent).toMatch(words);
      expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Mergescape');
      expect(screen.getByRole('link', { name: 'Sign in with GitHub' }).getAttribute('href')).toBe(
        `${API}/auth/login`,
      );
      expect(window.location.hash).toBe('');
      expect(readToken()).toBeNull();
    },
  );

  it('an #error= code nobody knows still gets a notice, not the text it carried', async () => {
    vi.stubGlobal('fetch', stubbedApi());
    await boot('#error=<img src=x>');
    expect((await screen.findByRole('status')).textContent).toBe(
      'Sign-in did not finish. Try signing in again.',
    );
    expect(document.querySelector('img')).toBeNull();
  });

  it('says so when the browser will not keep the token, instead of looping through sign-in', async () => {
    vi.stubGlobal('fetch', stubbedApi());
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    await boot(`#token=${TOKEN}`);
    expect((await screen.findByRole('status')).textContent).toContain('blocks site storage');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Mergescape');
    expect(window.location.hash).toBe('');
  });
});

describe('when the player is already signed in', () => {
  it('a failed sign-in attempt does not turn into a "not found" page', async () => {
    window.localStorage.setItem(TOKEN_KEY, TOKEN);
    const fetchFn = stubbedApi();
    vi.stubGlobal('fetch', fetchFn);
    await boot('#error=access_denied');
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Town'));
    expect(screen.queryByText(/Nothing lives at/)).toBeNull();
    expect(window.location.hash).toBe('');
    expect(readToken()).toBe(TOKEN);
  });

  it('a good sign-in stores the token and opens the game on the first load', async () => {
    const fetchFn = stubbedApi();
    vi.stubGlobal('fetch', fetchFn);
    await boot(`#token=${TOKEN}`);
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Town'));
    expect(readToken()).toBe(TOKEN);
    expect(window.location.hash).toBe('');
    const init = (fetchFn.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect((init.headers as Record<string, string>)['Authorization']).toBe(`Bearer ${TOKEN}`);
  });
});
