import { afterEach, beforeEach, expect, vi } from 'vitest';
import { render, waitFor } from '@testing-library/svelte';
import App from '../App.svelte';
import type { Api } from '../lib/api';
import { createFixtureApi } from '../lib/fixtures/api';
import type { FixtureVariant } from '../lib/fixtures/state';
import type { WeekSummary } from '../lib/types';
import { Session } from '../lib/session.svelte';
import type { SessionOptions } from '../lib/session.svelte';

/** The instant every fixture in the tests treats as "now": a Wednesday, so rows read "2 min ago". */
export const NOW = Date.UTC(2026, 10, 11, 14, 5, 0);

export interface RenderAppOptions {
  /** `#/`, `#/log`, ... Default `#/`. */
  hash?: string;
  variant?: FixtureVariant;
  /** Fields of the fixture run to replace (a free pack, a Legendary offer, an open Pledge window). */
  week?: Partial<WeekSummary>;
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
      ? createFixtureApi({
          now: NOW,
          variant: options.variant ?? 'active',
          ...(options.week ? { week: options.week } : {}),
        })
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

/**
 * Fail any test that touches the network: fixture mode must not. Call it once at the top of a test file;
 * it registers its own hooks.
 */
export function forbidNetwork(): void {
  const spy = vi.fn(async () => {
    throw new Error('network access is not allowed in fixture tests');
  });
  beforeEach(() => {
    vi.stubGlobal('fetch', spy);
  });
  afterEach(() => {
    expect(spy).not.toHaveBeenCalled();
    spy.mockClear();
  });
}

/** The text of an element with every run of whitespace (including non-breaking spaces) made one space. */
export function textOf(element: Element | null | undefined): string {
  return (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/** A `name` matcher for `getByRole` that ignores non-breaking spaces in the accessible name. */
export function named(expected: string): (name: string) => boolean {
  return (name) => name.replace(/\s+/g, ' ').trim() === expected;
}
