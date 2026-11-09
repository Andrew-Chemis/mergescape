import { afterEach, describe, expect, it, vi } from 'vitest';
import { levelFor } from '@mergescape/shared';
import { ApiError } from './api';
import type { Api } from './api';
import { createFixtureApi } from './fixtures/api';
import { fixtureInstallations, fixtureLogEntries, fixtureMe } from './fixtures/state';
import { Session } from './session.svelte';
import type { InstallationsResponse, LogEntry, LogResponse, MeResponse } from './types';

const NOW = Date.UTC(2026, 10, 11, 14, 5, 0);

/** An api whose answers the test can change between calls. */
function scriptedApi(initial: { me: MeResponse; entries: LogEntry[]; pageSize?: number }) {
  const state = {
    me: initial.me,
    entries: initial.entries,
    installations: fixtureInstallations(),
    pageSize: initial.pageSize ?? 8,
    fail: null as ApiError | null,
    failLogCursor: null as ApiError | null,
  };
  const api: Api = {
    async me() {
      if (state.fail) throw state.fail;
      return state.me;
    },
    async log(cursor) {
      if (state.fail) throw state.fail;
      if (cursor && state.failLogCursor) throw state.failLogCursor;
      const offset = cursor ? Number(cursor) : 0;
      const end = offset + state.pageSize;
      const page: LogResponse = {
        entries: state.entries.slice(offset, end),
        nextCursor: end < state.entries.length ? String(end) : null,
      };
      return page;
    },
    async installations(): Promise<InstallationsResponse> {
      if (state.fail) throw state.fail;
      return state.installations;
    },
  };
  return { api, state };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('Session.load', () => {
  it('starts signed out with no api', async () => {
    const session = new Session(null);
    await session.load();
    expect(session.status).toBe('signed-out');
    expect(session.expired).toBe(false);
  });

  it('loads the profile, the first log page and the installations', async () => {
    const session = new Session(createFixtureApi({ now: NOW }));
    expect(session.status).toBe('loading');
    await session.load();
    expect(session.status).toBe('ready');
    expect(session.me?.login).toBe('octo-dev');
    expect(session.entries).toHaveLength(8);
    expect(session.nextCursor).not.toBeNull();
    expect(session.installations).toHaveLength(1);
    expect(session.lastEntry?.prNumber).toBe(412);
    expect(session.fresh).toBeNull();
  });

  it('reports a network failure on the error state', async () => {
    const { api, state } = scriptedApi({ me: fixtureMe(NOW), entries: [] });
    state.fail = new ApiError(0, 'Could not reach the server.');
    const session = new Session(api);
    await session.load();
    expect(session.status).toBe('error');
    expect(session.error).toBe('Could not reach the server.');
    // And recovers when asked again.
    state.fail = null;
    await session.load();
    expect(session.status).toBe('ready');
    expect(session.error).toBeNull();
  });

  it('treats a 401 as the end of the session and tells the caller once', async () => {
    const { api, state } = scriptedApi({ me: fixtureMe(NOW), entries: [] });
    state.fail = new ApiError(401, 'The server answered 401.');
    const onUnauthorized = vi.fn();
    const session = new Session(api, { onUnauthorized });
    await session.load();
    expect(session.status).toBe('signed-out');
    expect(session.expired).toBe(true);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });
});

describe('Session.loadMore', () => {
  it('appends the next page without duplicates and stops at the end', async () => {
    const session = new Session(createFixtureApi({ now: NOW }));
    await session.load();
    await session.loadMore();
    expect(session.entries).toHaveLength(14);
    expect(new Set(session.entries.map((entry) => entry.id)).size).toBe(14);
    expect(session.nextCursor).toBeNull();
    await session.loadMore(); // nothing left: a no-op
    expect(session.entries).toHaveLength(14);
  });

  it('keeps the rows on screen when an older page fails', async () => {
    const { api, state } = scriptedApi({
      me: fixtureMe(NOW),
      entries: fixtureLogEntries(NOW),
    });
    const session = new Session(api);
    await session.load();
    state.failLogCursor = new ApiError(0, 'offline');
    await session.loadMore();
    expect(session.status).toBe('ready');
    expect(session.entries).toHaveLength(8);
    expect(session.loadMoreError).toBe('Could not load older entries.');
    expect(session.loadingMore).toBe(false);
    state.failLogCursor = null;
    await session.loadMore();
    expect(session.loadMoreError).toBeNull();
    expect(session.entries).toHaveLength(14);
  });

  it('ends the session if loading older rows is rejected with a 401', async () => {
    const { api, state } = scriptedApi({ me: fixtureMe(NOW), entries: fixtureLogEntries(NOW) });
    const session = new Session(api);
    await session.load();
    state.failLogCursor = new ApiError(401, 'expired');
    await session.loadMore();
    expect(session.status).toBe('signed-out');
  });
});

describe('Session.refresh (the moment loop)', () => {
  it('marks rows that arrive after the first load as fresh and puts them on top', async () => {
    const all = fixtureLogEntries(NOW);
    const [newest, ...older] = all as [LogEntry, ...LogEntry[]];
    const { api, state } = scriptedApi({ me: fixtureMe(NOW), entries: older });
    const session = new Session(api);
    await session.load();
    expect(session.lastEntry?.id).toBe(older[0]?.id);

    state.entries = all;
    await session.refresh();
    expect(session.fresh?.id).toBe(newest.id);
    expect(session.lastEntry?.id).toBe(newest.id);
    expect(session.entries.filter((entry) => entry.id === newest.id)).toHaveLength(1);
  });

  it('does nothing new when nothing arrived', async () => {
    const session = new Session(createFixtureApi({ now: NOW }));
    await session.load();
    const before = session.entries;
    await session.refresh();
    expect(session.entries).toBe(before);
    expect(session.fresh).toBeNull();
    expect(session.levelUp).toBeNull();
  });

  it('raises a level-up, with the new gear tier when one is crossed', async () => {
    const me = fixtureMe(NOW);
    const { api, state } = scriptedApi({ me, entries: fixtureLogEntries(NOW) });
    const session = new Session(api);
    await session.load();

    // 41 -> 42: no new tier (Iron until 50).
    const gain = 300_000;
    state.me = { ...me, xp: me.xp + gain };
    await session.refresh();
    expect(session.levelUp).toMatchObject({ level: 42, from: 41, newTier: null });
    const firstId = session.levelUp?.id;

    session.dismissLevelUp();
    expect(session.levelUp).toBeNull();

    // Crossing level 50 changes the tier, and each level-up gets its own id.
    state.me = { ...me, xp: 47_116_709 };
    await session.refresh();
    expect(levelFor(47_116_709)).toBe(50);
    expect(session.levelUp?.level).toBe(50);
    expect(session.levelUp?.newTier).toBe('Mithril');
    expect(session.levelUp?.id).not.toBe(firstId);
  });

  it('credits the level-up to the skill of the row that caused it', async () => {
    const all = fixtureLogEntries(NOW);
    const [newest, ...older] = all as [LogEntry, ...LogEntry[]];
    const me = fixtureMe(NOW);
    const { api, state } = scriptedApi({ me, entries: older });
    const session = new Session(api);
    await session.load();
    state.entries = all;
    state.me = { ...me, xp: me.xp + newest.xp };
    await session.refresh();
    expect(session.levelUp?.skill).toBe('smithing');
  });

  it('keeps what is on screen when a background refresh fails', async () => {
    const { api, state } = scriptedApi({ me: fixtureMe(NOW), entries: fixtureLogEntries(NOW) });
    const session = new Session(api);
    await session.load();
    state.fail = new ApiError(0, 'offline');
    await session.refresh();
    expect(session.status).toBe('ready');
    expect(session.entries).toHaveLength(8);
  });

  it('ends the session on a 401 during a refresh', async () => {
    const { api, state } = scriptedApi({ me: fixtureMe(NOW), entries: fixtureLogEntries(NOW) });
    const session = new Session(api);
    await session.load();
    state.fail = new ApiError(401, 'expired');
    await session.refresh();
    expect(session.status).toBe('signed-out');
    expect(session.expired).toBe(true);
  });

  it('re-reads installations while there are none (the player came back from GitHub)', async () => {
    const { api, state } = scriptedApi({ me: fixtureMe(NOW, 'noinstall'), entries: [] });
    state.installations = fixtureInstallations('noinstall');
    const session = new Session(api);
    await session.load();
    expect(session.installations).toEqual([]);
    state.installations = fixtureInstallations('noevents');
    await session.refresh();
    expect(session.installations).toHaveLength(1);
  });

  it('ignores refresh before the first load and overlapping refreshes', async () => {
    const me = vi.fn(async () => fixtureMe(NOW));
    const base = createFixtureApi({ now: NOW });
    const session = new Session({ ...base, me });
    await session.refresh();
    expect(me).not.toHaveBeenCalled();
    await session.load();
    me.mockClear();
    await Promise.all([session.refresh(), session.refresh()]);
    expect(me).toHaveBeenCalledTimes(1);
  });
});

describe('Session.startPolling', () => {
  it('refreshes on the interval while the tab is visible and stops when told', async () => {
    vi.useFakeTimers({ now: NOW });
    const me = vi.fn(async () => fixtureMe(NOW));
    const session = new Session({ ...createFixtureApi({ now: NOW }), me }, { pollMs: 1000 });
    await session.load();
    me.mockClear();

    const stop = session.startPolling();
    await vi.advanceTimersByTimeAsync(3000);
    expect(me).toHaveBeenCalledTimes(3);

    stop();
    await vi.advanceTimersByTimeAsync(3000);
    expect(me).toHaveBeenCalledTimes(3);
  });

  it('skips ticks while the tab is hidden and refreshes when it comes back', async () => {
    vi.useFakeTimers({ now: NOW });
    const me = vi.fn(async () => fixtureMe(NOW));
    const session = new Session({ ...createFixtureApi({ now: NOW }), me }, { pollMs: 1000 });
    await session.load();
    me.mockClear();
    const stop = session.startPolling();

    const visibility = vi.spyOn(document, 'visibilityState', 'get');
    visibility.mockReturnValue('hidden');
    await vi.advanceTimersByTimeAsync(2500);
    expect(me).not.toHaveBeenCalled();

    visibility.mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
    expect(me).toHaveBeenCalledTimes(1);

    stop();
    visibility.mockRestore();
  });

  it('does not poll when switched off', () => {
    vi.useFakeTimers();
    const session = new Session(createFixtureApi({ now: NOW }), { pollMs: 0 });
    const stop = session.startPolling();
    expect(vi.getTimerCount()).toBe(0);
    stop();
  });
});
