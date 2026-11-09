import { expect, vi } from 'vitest';
import { render, waitFor } from '@testing-library/svelte';
import App from '../App.svelte';
import type { Api } from '../lib/api';
import { createFixtureApi } from '../lib/fixtures/api';
import type { FixtureVariant } from '../lib/fixtures/state';
import { Session } from '../lib/session.svelte';
import type { SessionOptions } from '../lib/session.svelte';

/** The instant every fixture in the tests treats as "now": a Wednesday, so rows read "2 min ago". */
export const NOW = Date.UTC(2026, 10, 11, 14, 5, 0);

export interface RenderAppOptions {
  /** `#/`, `#/log`, ... Default `#/`. */
  hash?: string;
  variant?: FixtureVariant;
  /** Overrides the fixture api; `null` renders signed out. */
  api?: Api | null;
  signInHref?: string | null;
  onSignOut?: () => void;
  session?: SessionOptions;
  /** Resolve before the session finishes loading (for loading-state tests). */
  skipWait?: boolean;
}

/** Render the whole app on fixture data, without a network, and wait until it has loaded. */
export async function renderApp(options: RenderAppOptions = {}) {
  window.location.hash = options.hash ?? '#/';
  // Relative times ("2 min ago") are measured against the fixture's clock.
  if (!vi.isFakeTimers()) {
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
  }
  const api =
    options.api === undefined
      ? createFixtureApi({ now: NOW, variant: options.variant ?? 'active' })
      : options.api;
  const session = new Session(api, { pollMs: 0, ...options.session });
  const view = render(App, {
    props: {
      session,
      signInHref: options.signInHref ?? null,
      ...(options.onSignOut ? { onSignOut: options.onSignOut } : {}),
    },
  });
  if (!options.skipWait) {
    await waitFor(() => expect(session.status).not.toBe('loading'));
  }
  return { ...view, session };
}

/** Make `prefers-reduced-motion: reduce` match (or not) for the code under test. */
export function mockReducedMotion(reduce: boolean): void {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: reduce && query.includes('prefers-reduced-motion: reduce'),
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

export function restoreMatchMedia(): void {
  Reflect.deleteProperty(window, 'matchMedia');
}
