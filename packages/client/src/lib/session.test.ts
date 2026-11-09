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
    ...createFixtureApi({ now: NOW }),
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

  it('explains a token with no character (404 no_profile) in words', async () => {
    const { api, state } = scriptedApi({ me: fixtureMe(NOW), entries: [] });
    state.fail = new ApiError(404, 'The server answered 404.', 'no_profile');
    const session = new Session(api);
    await session.load();
    expect(session.status).toBe('error');
    expect(session.error).toBe('This account has no character yet. Sign in again.');
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

describe('Session.loadSince', () => {
  it('reads older pages until the oldest row is before the cut-off', async () => {
    const session = new Session(createFixtureApi({ now: NOW }));
    await session.load();
    expect(session.entries).toHaveLength(8);
    // Every fixture row is newer than a month ago, so asking for a year back reads the second page too.
    await session.loadSince(NOW - 365 * 24 * 3_600_000);
    expect(session.entries).toHaveLength(14);
    expect(session.nextCursor).toBeNull();
  });

  it('stops at once when the loaded rows already reach back far enough', async () => {
    const api = createFixtureApi({ now: NOW });
    const log = vi.fn(api.log);
    const session = new Session({ ...api, log });
    await session.load();
    log.mockClear();
    await session.loadSince(NOW - 60_000);
    expect(log).not.toHaveBeenCalled();
  });

  it('gives up after maxPages', async () => {
    const api = createFixtureApi({ now: NOW, pageSize: 2 });
    const session = new Session(api);
    await session.load();
    await session.loadSince(0, 2);
    expect(session.entries).toHaveLength(6);
    expect(session.nextCursor).not.toBeNull();
  });
});

describe('Session writes (shop, shrine, Pledges)', () => {
  it('starts with the run from /me', async () => {
    const session = new Session(createFixtureApi({ now: NOW }));
    await session.load();
    expect(session.week).toBe(session.me?.week);
    expect(session.week?.shop?.charms).toHaveLength(2);
  });

  it('replaces me and week with the answer and does not re-fetch', async () => {
    const api = createFixtureApi({ now: NOW });
    const me = vi.fn(api.me);
    const getWeek = vi.fn(api.getWeek);
    const session = new Session({ ...api, me, getWeek });
    await session.load();
    me.mockClear();

    const result = await session.shopBuy('charm:1', { kind: 'charm', index: 1 });
    expect(result).toEqual({ ok: true });
    expect(session.me?.gold).toBe(2340 - 40);
    expect(session.me?.charms.map((c) => c.id)).toContain('lantern');
    expect(session.week?.shop?.charms[1]?.sold).toBe(true);
    expect(session.me?.week).toBe(session.week);
    expect(session.busy).toBeNull();
    expect(me).not.toHaveBeenCalled();
    expect(getWeek).not.toHaveBeenCalled();
  });

  it('returns a 409 as an inline result, leaves the state alone and re-reads the profile', async () => {
    const api = createFixtureApi({ now: NOW });
    const me = vi.fn(api.me);
    const session = new Session({ ...api, me });
    await session.load();
    await session.shopBuy('charm:1', { kind: 'charm', index: 1 });
    me.mockClear();
    const goldAfter = session.me?.gold;

    const again = await session.shopBuy('charm:1', { kind: 'charm', index: 1 });
    expect(again).toEqual({
      ok: false,
      status: 409,
      code: 'sold_out',
      message: 'That one is already sold.',
    });
    expect(session.me?.gold).toBe(goldAfter);
    expect(session.busy).toBeNull();
    await vi.waitFor(() => expect(me).toHaveBeenCalledTimes(1));
    expect(session.status).toBe('ready');
  });

  it('says not enough gold, from the 409 code', async () => {
    const api = createFixtureApi({ now: NOW });
    const stub: Api = {
      ...api,
      shopBuy: async () => {
        throw new ApiError(409, 'no', 'insufficient_gold');
      },
    };
    const broke = new Session(stub);
    await broke.load();
    expect(await broke.shopBuy('charm:0', { kind: 'charm', index: 0 })).toMatchObject({
      ok: false,
      code: 'insufficient_gold',
      message: 'Not enough gold.',
    });
  });

  it('allows one write at a time', async () => {
    const api = createFixtureApi({ now: NOW });
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const session = new Session({
      ...api,
      shopReroll: async (options) => {
        await gate;
        return api.shopReroll(options);
      },
    });
    await session.load();
    const first = session.shopReroll();
    expect(session.busy).toBe('reroll');
    expect(await session.shopSell('sell:hot-potato', 'hot-potato')).toMatchObject({
      ok: false,
      code: 'busy',
    });
    release();
    expect(await first).toEqual({ ok: true });
    expect(session.busy).toBeNull();
  });

  it('replays the same request id when the same action is tried again after a network failure', async () => {
    const api = createFixtureApi({ now: NOW });
    const seen: (string | undefined)[] = [];
    let failures = 1;
    const session = new Session({
      ...api,
      shopBuy: async (input, options) => {
        seen.push(options?.requestId);
        if (failures-- > 0) {
          throw new ApiError(0, 'Could not reach the server.', null, 'req-lost');
        }
        return api.shopBuy(input, options);
      },
    });
    await session.load();

    const first = await session.shopBuy('charm:0', { kind: 'charm', index: 0 });
    expect(first).toMatchObject({
      ok: false,
      status: 0,
      message: 'Could not reach the server. Try again.',
    });
    expect((await session.shopBuy('charm:0', { kind: 'charm', index: 0 })).ok).toBe(true);
    expect(seen).toEqual([undefined, 'req-lost']);

    // A different control starts a fresh attempt, and success clears what was remembered.
    failures = 1;
    await session.shopBuy('charm:1', { kind: 'charm', index: 1 });
    await session.shopBuy('pack:1', { kind: 'pack', index: 1 });
    expect(seen.slice(2)).toEqual([undefined, undefined]);
  });

  it('forgets a failed attempt once the server gives a real answer', async () => {
    const api = createFixtureApi({ now: NOW });
    const seen: (string | undefined)[] = [];
    const answers = [
      new ApiError(0, 'offline', null, 'req-a'),
      new ApiError(409, 'no', 'sold_out'),
      null,
    ];
    const session = new Session({
      ...api,
      shopReroll: async (options) => {
        seen.push(options?.requestId);
        const next = answers.shift();
        if (next) {
          throw next;
        }
        return api.shopReroll(options);
      },
    });
    await session.load();
    await session.shopReroll();
    await session.shopReroll();
    await session.shopReroll();
    expect(seen).toEqual([undefined, 'req-a', undefined]);
  });

  it('discards a refresh that was in flight when a write started', async () => {
    const api = createFixtureApi({ now: NOW });
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let slow = false;
    const session = new Session({
      ...api,
      me: async () => {
        const old = await api.me();
        if (slow) {
          await gate;
        }
        return old;
      },
    });
    await session.load();
    slow = true;
    const refreshing = session.refresh();
    await session.shopBuy('charm:1', { kind: 'charm', index: 1 });
    expect(session.me?.gold).toBe(2300);
    release();
    await refreshing;
    // The older answer (gold 2340, shop unsold) did not win.
    expect(session.me?.gold).toBe(2300);
    expect(session.week?.shop?.charms[1]?.sold).toBe(true);
  });

  it('ends the session when a write is rejected with a 401', async () => {
    const api = createFixtureApi({ now: NOW });
    const onUnauthorized = vi.fn();
    const session = new Session(
      {
        ...api,
        pledgePlay: async () => {
          throw new ApiError(401, 'expired');
        },
      },
      { onUnauthorized },
    );
    await session.load();
    await session.pledgePlay('pledge:strike', 'strike');
    expect(session.status).toBe('signed-out');
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('refreshWeek adopts a newer run into me.week, and keeps the old one when it fails', async () => {
    const api = createFixtureApi({ now: NOW });
    let week = await api.getWeek();
    let fail = false;
    const session = new Session({
      ...api,
      getWeek: async () => {
        if (fail) {
          throw new ApiError(0, 'offline');
        }
        return week;
      },
    });
    await session.load();
    week = { ...week, weeklyXp: week.weeklyXp + 5, shop: null };
    await session.refreshWeek();
    expect(session.week?.shop).toBeNull();
    expect(session.me?.week?.weeklyXp).toBe(week.weeklyXp);

    fail = true;
    await session.refreshWeek();
    expect(session.week?.shop).toBeNull();
    expect(session.status).toBe('ready');
  });

  it('export and delete are reported, not thrown', async () => {
    const api = createFixtureApi({ now: NOW });
    const session = new Session(api);
    await session.load();
    const exported = await session.exportData();
    expect(exported.ok).toBe(true);
    expect(Object.keys(exported.data ?? {}).sort()).toEqual([
      'events',
      'expeditions',
      'exportedAt',
      'feats',
      'jobs',
      'profile',
      'weeks',
    ]);
    expect(await session.deleteEverything('somebody-else')).toMatchObject({
      ok: false,
      status: 400,
      code: 'confirm_mismatch',
      message: 'That is not your GitHub login. Nothing was deleted.',
    });
    expect(await session.deleteEverything('OCTO-DEV')).toEqual({ ok: true });

    const missing = new Session({
      ...api,
      exportData: async () => {
        throw new ApiError(404, 'The server answered 404.');
      },
      deleteAccount: async () => {
        throw new ApiError(404, 'The server answered 404.');
      },
    });
    await missing.load();
    expect(await missing.exportData()).toMatchObject({
      ok: false,
      message: 'This server does not offer that yet.',
    });
    expect(await missing.deleteEverything('octo-dev')).toMatchObject({
      ok: false,
      message: 'This server does not offer that yet.',
    });
  });

  it('does nothing without an api', async () => {
    const session = new Session(null);
    expect(await session.shopReroll()).toMatchObject({ ok: false });
    expect(await session.exportData()).toMatchObject({ ok: false });
    expect(await session.deleteEverything('x')).toMatchObject({ ok: false });
    await session.refreshWeek();
    expect(session.week).toBeNull();
  });
});
