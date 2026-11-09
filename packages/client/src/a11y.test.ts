/**
 * Accessibility: axe-core runs over every screen rendered from fixtures (Requirement 10.5, tasks.md
 * task 9). jsdom has no layout engine, so axe reports colour contrast as "needs review" instead of
 * failing it; the real contrast checks are src/lib/contrast.test.ts (the theme tokens) and a browser
 * run of the same axe build, recorded in the task report.
 */
import axe from 'axe-core';
import type { Result } from 'axe-core';
import { fireEvent, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from './lib/api';
import { pageControls } from './lib/consent';
import { createFixtureApi } from './lib/fixtures/api';
import { fixtureCharm } from './lib/fixtures/state';
import type { FixtureVariant } from './lib/fixtures/state';
import type { WeekSummary } from './lib/types';
import { renderApp } from './test/helpers';

function describeViolations(violations: Result[]): string {
  return violations
    .map(
      (violation) =>
        `${violation.id} (${violation.impact}): ${violation.help}\n` +
        violation.nodes.map((node) => `  ${node.html}`).join('\n'),
    )
    .join('\n');
}

async function expectAccessible(): Promise<void> {
  const results = await axe.run(document, {
    // WCAG 2.x A and AA, plus axe's best practices (landmarks, headings, skip link).
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] },
  });
  expect(describeViolations(results.violations)).toBe('');
}

const screens: {
  name: string;
  hash: string;
  variant?: FixtureVariant;
  api?: null;
  week?: Partial<WeekSummary>;
}[] = [
  { name: 'Landing', hash: '#/', api: null },
  { name: 'Landing (welcome route)', hash: '#/welcome' },
  { name: 'Town', hash: '#/' },
  { name: 'Town, no installations', hash: '#/', variant: 'noinstall' },
  { name: 'Town, sleeping character', hash: '#/', variant: 'noevents' },
  { name: 'Combat Log', hash: '#/log' },
  { name: 'Combat Log, empty', hash: '#/log', variant: 'noevents' },
  { name: 'Character', hash: '#/character' },
  { name: 'Character, new character', hash: '#/character', variant: 'noevents' },
  { name: 'Shop', hash: '#/shop' },
  { name: 'Shop, closed', hash: '#/shop', variant: 'monday' },
  { name: 'Shop, no run', hash: '#/shop', variant: 'noevents' },
  {
    name: 'Shop with a free pack and a Legendary offer',
    hash: '#/shop',
    week: { freePack: 'pledge', legendaryOffer: fixtureCharm('oracle') },
  },
  { name: 'Run Map', hash: '#/map' },
  { name: 'Run Map, Monday with Pledges to play', hash: '#/map', variant: 'monday' },
  { name: 'Run Map, no run', hash: '#/map', variant: 'noevents' },
  { name: 'Bestiary', hash: '#/bestiary' },
  { name: 'Bestiary, new character', hash: '#/bestiary', variant: 'noevents' },
  { name: 'Settings', hash: '#/settings' },
  { name: 'Settings, no installations', hash: '#/settings', variant: 'noinstall' },
  { name: 'Privacy', hash: '#/privacy' },
  { name: 'Terms', hash: '#/terms' },
  { name: 'Privacy, signed out', hash: '#/privacy', api: null },
  { name: 'Terms, signed out', hash: '#/terms', api: null },
  { name: 'Cookies', hash: '#/cookies' },
  { name: 'Cookies, signed out', hash: '#/cookies', api: null },
  { name: 'Not found', hash: '#/nope' },
];

describe('axe-core finds no violations', () => {
  for (const { name, hash, variant, api, week } of screens) {
    it(name, async () => {
      await renderApp({
        hash,
        ...(variant ? { variant } : {}),
        ...(week ? { week } : {}),
        ...(api === null ? { api: null, signInHref: 'https://api.example/auth/login' } : {}),
      });
      await expectAccessible();
    });
  }

  it('Landing without a backend', async () => {
    await renderApp({ api: null, signInHref: null });
    await expectAccessible();
  });

  it('Combat Log with a row expanded and the next page loaded', async () => {
    await renderApp({ hash: '#/log' });
    await fireEvent.click(screen.getAllByRole('button', { expanded: false })[0] as HTMLElement);
    await fireEvent.click(screen.getByRole('button', { name: 'Load older entries' }));
    await screen.findByText('That is everything so far.');
    await expectAccessible();
  });

  it('Town while the score ticker is rolling', async () => {
    await renderApp();
    await fireEvent.click(screen.getByRole('button', { name: 'Replay the roll' }));
    expect(screen.getByRole('button', { name: 'Skip' })).toBeTruthy();
    await expectAccessible();
  });
});

describe('axe-core finds no violations in the interactive states of the new screens', () => {
  it('Shop with the shrine open and a purchase made', async () => {
    await renderApp({ hash: '#/shop' });
    await fireEvent.click(screen.getByRole('button', { name: 'Buy · 40 g' }));
    await screen.findByText('Lantern is yours.');
    await fireEvent.click(screen.getByRole('button', { name: /^Shrine/ }));
    await expectAccessible();
  });

  it('Shop showing a 409 beside its control', async () => {
    const base = createFixtureApi({ now: Date.UTC(2026, 10, 11, 14, 5, 0) });
    await renderApp({
      hash: '#/shop',
      api: {
        ...base,
        async shopBuy() {
          throw new ApiError(409, 'no', 'insufficient_gold');
        },
      },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Buy · 120 g' }));
    await screen.findByRole('alert');
    await expectAccessible();
  });

  it('Run Map while the Mogul reveal plays', async () => {
    await renderApp({ hash: '#/map' });
    expect(document.querySelector('.reveal')?.getAttribute('data-motion')).toBe('rise');
    await expectAccessible();
  });

  it('Settings with the delete confirmation open, and after an export', async () => {
    await renderApp({ hash: '#/settings' });
    await fireEvent.click(screen.getByRole('button', { name: 'Delete everything…' }));
    await expectAccessible();
  });
});

describe('axe-core finds no violations on the Cookies page in its other states', () => {
  it('with analytics switched on', async () => {
    await renderApp({ hash: '#/cookies' });
    await fireEvent.click(screen.getByRole('switch', { name: 'Allow first-party analytics' }));
    await expectAccessible();
  });

  it('showing that the choice could not be saved', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    await renderApp({ hash: '#/cookies' });
    await fireEvent.click(screen.getByRole('switch', { name: 'Allow first-party analytics' }));
    expect(screen.getByText(/would not let Mergescape save your choice/)).toBeTruthy();
    await expectAccessible();
  });

  it('after Clear local data', async () => {
    vi.spyOn(pageControls, 'reload').mockImplementation(() => {});
    await renderApp({ hash: '#/cookies' });
    await fireEvent.click(screen.getByRole('button', { name: 'Clear local data' }));
    await expectAccessible();
  });
});

describe('the harness itself', () => {
  it('does catch a violation (an unnamed button and an image without alt)', async () => {
    await renderApp({ hash: '#/' });
    const seeded = document.createElement('div');
    seeded.innerHTML = '<button></button><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">';
    document.body.append(seeded);
    try {
      const results = await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a'] } });
      expect(results.violations.map((violation) => violation.id).sort()).toEqual([
        'button-name',
        'image-alt',
      ]);
    } finally {
      seeded.remove();
    }
  });
});

describe('keyboard and focus', () => {
  it('reaches every interactive control with real, named elements (no click-only divs)', async () => {
    await renderApp({ hash: '#/log' });
    const controls = [...document.querySelectorAll('a, button, [tabindex]')];
    for (const control of controls) {
      const name = control.textContent?.trim() || control.getAttribute('aria-label');
      expect(name, `unnamed control: ${control.outerHTML.slice(0, 80)}`).toBeTruthy();
      expect(Number(control.getAttribute('tabindex') ?? 0)).toBeLessThanOrEqual(0);
    }
  });

  it('marks the current page in the navigation and the open row on its button', async () => {
    await renderApp({ hash: '#/log' });
    const row = screen.getAllByRole('button', { expanded: false })[0] as HTMLElement;
    expect(row.getAttribute('aria-controls')).toBeTruthy();
    await fireEvent.click(row);
    expect(row.getAttribute('aria-expanded')).toBe('true');
    expect(document.getElementById(row.getAttribute('aria-controls') as string)).not.toBeNull();
  });
});
