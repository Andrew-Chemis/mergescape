/**
 * The copy pass of task 24 (game-design.md sections 3 and 4): player-facing screens use the game's own
 * words, not GitHub's plumbing, and no screen names a real person, company or brand (Requirement 7.5).
 *
 * "Player-facing" means every game screen rendered from fixtures, in every fixture variant. Settings and
 * the Landing page are the two places that legitimately talk about installations and the GitHub App, and
 * the Privacy, Terms and Cookies pages must name the real parties that handle data, so they are not held
 * to these rules. The one place a game screen may say "install" is the call to action on Town that
 * Requirement 10.6 asks for, because the step it describes really is made on GitHub.
 */
import { screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import { NAME_DENYLIST, namesPattern } from '../../shared/src/test-sources';
import { FIXTURE_VARIANTS } from './lib/fixtures/state';
import { forbidNetwork, renderApp, textOf } from './test/helpers';

forbidNetwork();

/** Every game screen. Settings, Landing and the legal pages are left out on purpose (see above). */
const GAME_SCREENS = [
  '#/',
  '#/log',
  '#/character',
  '#/shop',
  '#/map',
  '#/bestiary',
  '#/expedition',
  '#/forge',
  '#/feats',
  '#/not-a-screen',
] as const;

/** Words of GitHub's own machinery that no game screen has a reason to show. */
const SYSTEM_TERMS =
  /\b(webhooks?|installations?|payloads?|endpoints?|oauth|access tokens?|delivery ids?)\b/i;

/** Words for the step of setting Mergescape up, allowed only in Town's call to action. */
const SETUP_TERMS = /\b(install(?:ed|s|ing)?|GitHub App|the App)\b/;

/** What every game screen says in a fixture variant, with the Town install call to action set aside. */
let cached: Promise<{ where: string; text: string; setup: string }[]> | undefined;
function screens(): Promise<{ where: string; text: string; setup: string }[]> {
  cached ??= readScreens();
  return cached;
}

async function readScreens(): Promise<{ where: string; text: string; setup: string }[]> {
  const found: { where: string; text: string; setup: string }[] = [];
  for (const variant of FIXTURE_VARIANTS) {
    for (const hash of GAME_SCREENS) {
      const { container, unmount } = await renderApp({ hash, variant });
      const cta = container.querySelector('[aria-labelledby="install-heading"]');
      const setup = textOf(cta);
      cta?.remove();
      found.push({ where: `${variant} ${hash}`, text: textOf(container), setup });
      unmount();
    }
  }
  return found;
}

describe('no GitHub plumbing on the game screens', () => {
  it('renders every screen in every variant, so the checks below have something to read', async () => {
    const all = await screens();
    expect(all).toHaveLength(FIXTURE_VARIANTS.length * GAME_SCREENS.length);
    expect(all.every((entry) => entry.text.length > 20)).toBe(true);
  });

  it('shows no webhook, installation, payload, endpoint, OAuth, access token or delivery id', async () => {
    for (const { where, text } of await screens()) {
      expect(text.match(SYSTEM_TERMS)?.[0], where).toBeUndefined();
    }
  });

  it('says "install" and "the GitHub App" only in the call to action on Town', async () => {
    const all = await screens();
    for (const { where, text } of all) {
      expect(text.match(SETUP_TERMS)?.[0], where).toBeUndefined();
    }
    // The call to action does name the step, once, in plain words.
    const withCta = all.filter((entry) => entry.setup !== '');
    expect(withCta.length).toBeGreaterThan(0);
    for (const { where, setup } of withCta) {
      expect(where).toContain('noinstall #/');
      expect(setup).toContain('Install the GitHub App');
      expect(setup.match(SYSTEM_TERMS)?.[0], where).toBeUndefined();
    }
  });

  it('keeps the empty Combat Log in the game voice', async () => {
    await renderApp({ hash: '#/log', variant: 'noevents' });
    const text = textOf(screen.getByRole('region', { name: 'Nothing logged yet' }));
    expect(text).toContain('Points × Power × Zone');
    expect(text).toContain('set Mergescape up');
    expect(text).not.toMatch(/\bApp\b|installed/);
  });

  it('the scan catches what it is meant to (positive control)', () => {
    expect('Your webhook delivery failed').toMatch(SYSTEM_TERMS);
    expect('Check your installations').toMatch(SYSTEM_TERMS);
    expect('where the App is installed').toMatch(SETUP_TERMS);
    expect('Merge a pull request, review a pull request').not.toMatch(SYSTEM_TERMS);
    expect('Merge a pull request, review a pull request').not.toMatch(SETUP_TERMS);
  });
});

describe('no real names on any screen (Requirement 7.5)', () => {
  // "Oracle" is also a Charm; it is denied only in the Mogul copy review, as in the shared package.
  const pattern = namesPattern(['oracle']);

  it('uses the same denylist as the shared package', () => {
    expect(NAME_DENYLIST.length).toBeGreaterThan(20);
    expect(NAME_DENYLIST).toContain('anthropic');
    expect(pattern.test('Bessik the Unfiled')).toBe(false);
    expect(pattern.test('The Founder, once Sam Altman')).toBe(true);
  });

  it('finds none on the game screens or the Landing page, in any variant', async () => {
    const pages = [...(await screens()).map(({ where, text }) => ({ where, text }))];
    const landing = await renderApp({
      hash: '#/',
      api: null,
      signInHref: 'https://api.example/login',
    });
    pages.push({ where: 'landing', text: textOf(landing.container) });
    landing.unmount();
    for (const { where, text } of pages) {
      expect(text.match(pattern)?.[0], where).toBeUndefined();
    }
  });
});
