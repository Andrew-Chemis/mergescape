/**
 * Decides how the app runs from the URL, the build and the stored token:
 *
 * - `?fixture=1` (or `active`, `noevents`, `noinstall`) runs on fixture data, whatever the build says
 * - no `VITE_API_ORIGIN` also runs on fixtures, so a fresh clone works fully offline
 * - an api origin and a stored token: the real api
 * - an api origin and no token: signed out (Landing)
 *
 * `?live=1` adds a fixture row that "arrives" a few seconds after load, to watch the score ticker and the
 * level-up flash without a backend.
 */
import { createHttpApi, readToken } from './api';
import type { Api } from './api';
import { createFixtureApi } from './fixtures/api';
import { FIXTURE_VARIANTS } from './fixtures/state';
import type { FixtureVariant } from './fixtures/state';
import { DEFAULT_POLL_MS } from './session.svelte';

export type BootMode = 'fixture' | 'live' | 'signed-out';

export interface Boot {
  mode: BootMode;
  api: Api | null;
  pollMs: number;
}

/** How long the `?live=1` fixture waits before its extra row arrives, and how often it polls. */
export const FIXTURE_LIVE_AFTER_MS = 6_000;
export const FIXTURE_LIVE_POLL_MS = 2_000;

function fixtureVariant(value: string | null): FixtureVariant {
  return FIXTURE_VARIANTS.find((variant) => variant === value) ?? 'active';
}

export function resolveBoot(
  search: string,
  origin: string | null,
  token: string | null = readToken(),
): Boot {
  const params = new URLSearchParams(search);
  const fixtureParam = params.get('fixture');
  const wantsFixture = fixtureParam !== null && fixtureParam !== '0' && fixtureParam !== '';
  if (wantsFixture || origin === null) {
    const live = params.get('live') === '1';
    return {
      mode: 'fixture',
      api: createFixtureApi({
        variant: fixtureVariant(fixtureParam),
        ...(live ? { liveAfterMs: FIXTURE_LIVE_AFTER_MS } : {}),
      }),
      pollMs: live ? FIXTURE_LIVE_POLL_MS : 0,
    };
  }
  if (!token) {
    return { mode: 'signed-out', api: null, pollMs: 0 };
  }
  return { mode: 'live', api: createHttpApi({ origin }), pollMs: DEFAULT_POLL_MS };
}
