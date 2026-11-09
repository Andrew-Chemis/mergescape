/**
 * Privacy and Terms: static pages with the text Requirement 13.3 asks for and the plain-words promise of
 * design.md section 10, reachable from Landing and Settings, and readable without signing in.
 */
import { screen, within } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import { MOGUL_DISCLAIMER } from '@mergescape/shared';
import { PROMISES } from '../lib/promises';
import { forbidNetwork, renderApp, textOf } from '../test/helpers';

forbidNetwork();

describe('Privacy', () => {
  it('states the five things Requirement 13.3 requires, in plain language', async () => {
    await renderApp({ hash: '#/privacy' });
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Privacy');
    expect(document.title).toBe('Privacy · Mergescape');
    const plain = screen.getByRole('region', { name: 'In plain words' });
    const items = within(plain)
      .getAllByRole('listitem')
      .map((li) => li.textContent);
    expect(items).toEqual([...PROMISES]);

    const text = textOf(plain);
    // no code is read
    expect(text).toContain('We never read your code');
    // counts and timestamps only
    expect(text).toContain('We store counts and timestamps only');
    // export and delete are available
    expect(text).toContain('export or delete everything in one click');
    // activity from people who have not signed in is discarded
    expect(text).toContain("Activity from people who haven't signed in is discarded");
    // not a performance-review tool
    expect(text).toContain('not a performance-review tool');
  });

  it('uses the plain-words promise from the design, word for word', () => {
    expect(PROMISES.slice(0, 4).join(' ')).toBe(
      "We never read your code. No file contents, diffs, titles or comment text, ever. We store counts and timestamps only. You can export or delete everything in one click. The App can't write to GitHub.",
    );
  });

  it('lists what is stored and what never is, and the other parties', async () => {
    await renderApp({ hash: '#/privacy' });
    expect(textOf(screen.getByRole('region', { name: 'What we store' }))).toContain(
      'numeric GitHub id',
    );
    const never = textOf(screen.getByRole('region', { name: 'What we never store' }));
    for (const word of [
      'Code, diffs',
      'comment',
      'access token',
      'email',
      'private repositories',
    ]) {
      expect(never).toContain(word);
    }
    expect(textOf(screen.getByRole('region', { name: 'Cookies and other parties' }))).toContain(
      'Google Fonts',
    );
    expect(textOf(screen.getByRole('region', { name: "People who haven't signed in" }))).toContain(
      'dropped before it is saved',
    );
  });

  it('points at Settings for export and delete', async () => {
    await renderApp({ hash: '#/privacy' });
    const controls = screen.getByRole('region', { name: 'Your controls' });
    const links = within(controls).getAllByRole('link', { name: 'Settings' });
    expect(links.length).toBeGreaterThan(0);
    expect(links[0]?.getAttribute('href')).toBe('#/settings');
  });

  it('opens without signing in, with no navigation rail and a way back to the start', async () => {
    await renderApp({ hash: '#/privacy', api: null, signInHref: 'https://api.example/auth/login' });
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Privacy');
    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Back to the start' }).getAttribute('href')).toBe(
      '#/welcome',
    );
    expect(screen.getAllByRole('main')).toHaveLength(1);
  });

  it('shows the navigation with Settings marked when signed in, and goes back to Settings', async () => {
    await renderApp({ hash: '#/privacy' });
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
});

describe('Terms', () => {
  it('says what the game is, that nothing is for sale, and carries the satire line', async () => {
    await renderApp({ hash: '#/terms' });
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Terms');
    expect(document.title).toBe('Terms · Mergescape');
    expect(textOf(screen.getByRole('region', { name: 'What Mergescape is' }))).toContain(
      'Gold is earned by shipping and can never be bought',
    );
    expect(textOf(screen.getByRole('region', { name: 'Not a performance tool' }))).toContain(
      'There is no manager view',
    );
    expect(textOf(screen.getByRole('region', { name: 'Not affiliated, and satire' }))).toContain(
      MOGUL_DISCLAIMER,
    );
  });

  it('opens without signing in', async () => {
    await renderApp({ hash: '#/terms', api: null, signInHref: null });
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Terms');
    expect(screen.getByRole('link', { name: 'Back to the start' })).toBeTruthy();
    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull();
  });
});

describe('links to the legal pages', () => {
  it('Landing links to both', async () => {
    await renderApp({ api: null, signInHref: 'https://api.example/auth/login' });
    const promise = screen.getByRole('region', { name: 'Our promise' });
    expect(within(promise).getByRole('link', { name: 'Privacy' }).getAttribute('href')).toBe(
      '#/privacy',
    );
    expect(within(promise).getByRole('link', { name: 'Terms' }).getAttribute('href')).toBe(
      '#/terms',
    );
  });

  it('Landing and Privacy show the same promise sentences', async () => {
    await renderApp({ api: null, signInHref: 'https://api.example/auth/login' });
    const landing = within(screen.getByRole('region', { name: 'Our promise' }))
      .getAllByRole('listitem')
      .map((li) => li.textContent);
    expect(landing).toEqual([...PROMISES]);
  });

  it('Settings links to both', async () => {
    await renderApp({ hash: '#/settings' });
    const legal = screen.getByRole('region', { name: 'The small print' });
    expect(
      within(legal)
        .getAllByRole('link')
        .map((a) => a.getAttribute('href')),
    ).toEqual(['#/privacy', '#/terms']);
  });
});
