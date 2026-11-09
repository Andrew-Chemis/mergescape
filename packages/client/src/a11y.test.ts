/**
 * Accessibility: axe-core runs over every screen rendered from fixtures (Requirement 10.5, tasks.md
 * task 9). jsdom has no layout engine, so axe reports colour contrast as "needs review" instead of
 * failing it; the real contrast checks are src/lib/contrast.test.ts (the theme tokens) and a browser
 * run of the same axe build, recorded in the task report.
 */
import axe from 'axe-core';
import type { Result } from 'axe-core';
import { fireEvent, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import type { FixtureVariant } from './lib/fixtures/state';
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

const screens: { name: string; hash: string; variant?: FixtureVariant; api?: null }[] = [
  { name: 'Landing', hash: '#/', api: null },
  { name: 'Landing (welcome route)', hash: '#/welcome' },
  { name: 'Town', hash: '#/' },
  { name: 'Town, no installations', hash: '#/', variant: 'noinstall' },
  { name: 'Town, sleeping character', hash: '#/', variant: 'noevents' },
  { name: 'Combat Log', hash: '#/log' },
  { name: 'Combat Log, empty', hash: '#/log', variant: 'noevents' },
  { name: 'Character', hash: '#/character' },
  { name: 'Character, new character', hash: '#/character', variant: 'noevents' },
  { name: 'Not found', hash: '#/nope' },
];

describe('axe-core finds no violations', () => {
  for (const { name, hash, variant, api } of screens) {
    it(name, async () => {
      await renderApp({
        hash,
        ...(variant ? { variant } : {}),
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
