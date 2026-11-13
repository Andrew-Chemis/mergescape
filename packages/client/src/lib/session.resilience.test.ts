/**
 * What the session does when the network, the token or the character misbehaves: a lost reply is replayed
 * for the same request and for nothing else, a token whose character is gone ends the session instead of
 * stranding the player on an error panel, and a burst of Combat Log rows longer than a page leaves no hole.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './api';
import type { Api } from './api';
import { createFixtureApi } from './fixtures/api';
import { fixtureInstallations, fixtureLogEntries, fixtureMe } from './fixtures/state';
import { POLL_MAX_PAGES, REPLAY_WINDOW_MS, Session } from './session.svelte';
import type { SessionOptions } from './session.svelte';
import type { LogEntry, LogResponse, MeResponse } from './types';

const NOW = Date.UTC(2026, 10, 11, 14, 5, 0);

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
});

afterEach(() => {
  vi.useRealTimers();
});

const noProfile = () => new ApiError(404, 'The server answered 404.', 'no_profile');
const lost = (requestId: string) => new ApiError(0, 'Could not reach the server.', null, requestId);

async function ready(api: Api, options: SessionOptions = {}): Promise<Session> {
  const session = new Session(api, { pollMs: 0, ...options });
  await session.load();
  return session;
}

/** The fixture api with one write replaced: it records the request id of every attempt and fails on demand. */
function lossy<K extends keyof Api>(method: K, failures: ApiError[]) {
  const base = createFixtureApi({ now: NOW });
  const seen: (string | undefined)[] = [];
  const original = base[method] as (...args: unknown[]) => Promise<unknown>;
  const wrapped = async (...args: unknown[]) => {
    const options = args[args.length - 1] as { requestId?: string } | undefined;
    seen.push(options?.requestId);
    const failure = failures.shift();
    if (failure) {
      throw failure;
    }
    return original.apply(base, args);
  };
  return { api: { ...base, [method]: wrapped } as Api, seen };
}

describe('a token whose character is gone (a deleted account answers 404 no_profile)', () => {
  const gone = (): Api => ({
    ...createFixtureApi({ now: NOW }),
    async me() {
      throw noProfile();
    },
  });

  it('signs the player out on load, forgets the token, and does not call it an expired session', async () => {
    const onUnauthorized = vi.fn();
    const session = new Session(gone(), { onUnauthorized });
    await session.load();
    expect(session.status).toBe('signed-out');
    expect(session.deleted).toBe(true);
    expect(session.expired).toBe(false);
    expect(session.error).toBeNull();
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('does the same when it turns up later: a poll, a write, an older page, an export', async () => {
    const reasons: Record<string, (api: Api, state: { gone: boolean }) => Api> = {
      refresh: (api, state) => ({
        ...api,
        async me() {
          if (state.gone) throw noProfile();
          return api.me();
        },
      }),
      write: (api) => ({
        ...api,
        async shopReroll() {
          throw noProfile();
        },
      }),
      older: (api) => ({
        ...api,
        async log(cursor) {
          if (cursor) throw noProfile();
          return api.log(cursor);
        },
      }),
      export: (api) => ({
        ...api,
        async exportData() {
          throw noProfile();
        },
      }),
    };
    for (const [name, make] of Object.entries(reasons)) {
      const onUnauthorized = vi.fn();
      const state = { gone: false };
      const session = await ready(make(createFixtureApi({ now: NOW }), state), { onUnauthorized });
      expect(session.status, name).toBe('ready');
      state.gone = true;
      if (name === 'refresh') await session.refresh();
      if (name === 'write') {
        // The sentence beside the control is still there, for a screen that is on its way out.
        expect(await session.shopReroll()).toMatchObject({
          ok: false,
          message: 'This account has no character yet. Sign in again.',
        });
      }
      if (name === 'older') await session.loadMore();
      if (name === 'export') await session.exportData();
      expect(session.status, name).toBe('signed-out');
      expect(session.deleted, name).toBe(true);
      expect(onUnauthorized, name).toHaveBeenCalledTimes(1);
    }
  });

  it('is what a successful Delete everything leaves behind: signed out, the token forgotten', async () => {
    const onUnauthorized = vi.fn();
    const session = await ready(createFixtureApi({ now: NOW }), { onUnauthorized });
    expect(await session.deleteEverything('OCTO-DEV')).toEqual({ ok: true });
    expect(session.status).toBe('signed-out');
    expect(session.deleted).toBe(true);
    expect(session.expired).toBe(false);
    expect(session.busy).toBeNull();
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('is not what a refused delete leaves behind', async () => {
    const onUnauthorized = vi.fn();
    const session = await ready(createFixtureApi({ now: NOW }), { onUnauthorized });
    expect(await session.deleteEverything('somebody-else')).toMatchObject({
      code: 'confirm_mismatch',
    });
    expect(session.status).toBe('ready');
    expect(session.deleted).toBe(false);
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('keeps the delete replayable when its reply is lost: the same login replays, another starts afresh', async () => {
    const { api, seen } = lossy('deleteAccount', [lost('req-del'), lost('req-del-2')]);
    const session = await ready(api);
    expect(await session.deleteEverything('octo-dev')).toMatchObject({ ok: false, status: 0 });
    expect(session.status).toBe('ready');
    // A different login is a different request.
    await session.deleteEverything('somebody-else');
    // The first one tried again is the same request, and replays.
    await session.deleteEverything('octo-dev');
    expect(seen).toEqual([undefined, undefined, 'req-del']);
  });
});

describe('request ids belong to one exact request', () => {
  it('a different input from the same control never inherits the lost one: badge off, then on', async () => {
    const { api, seen } = lossy('settings', [lost('req-off')]);
    const session = await ready(api);
    expect(await session.setBadgePublic('badge', false)).toMatchObject({ ok: false, status: 0 });
    // Turned on instead: a new decision, not a retry of the lost "off".
    expect((await session.setBadgePublic('badge', true)).ok).toBe(true);
    expect(seen).toEqual([undefined, undefined]);
    expect(session.me?.badgePublic).toBe(true);
  });

  it('replays the lost one when the player tries the very same thing again', async () => {
    const { api, seen } = lossy('settings', [lost('req-off')]);
    const session = await ready(api);
    await session.setBadgePublic('badge', false);
    expect((await session.setBadgePublic('badge', false)).ok).toBe(true);
    expect(seen).toEqual([undefined, 'req-off']);
    expect(session.me?.badgePublic).toBe(false);
  });

  it.each([
    [
      'a dye colour',
      'forgeUpgrade' as const,
      (s: Session, color: string) => s.forgeUpgrade('dye', { capeColor: color as 'azure' | 'ash' }),
    ],
    [
      'an affix piece',
      'forgeStart' as const,
      (s: Session, piece: string) =>
        s.forgeStart('affix', { recipeId: 'scriptorium:affix', pieceId: piece }),
    ],
  ])('%s: the next choice in the same control gets its own id', async (_name, method, run) => {
    const { api, seen } = lossy(method, [lost('req-first'), lost('req-first-again')]);
    const session = await ready(api);
    await run(session, 'azure'); // lost
    await run(session, 'ash'); // another colour, another piece: not a retry (and lost as well)
    await run(session, 'azure'); // the first again, but the last thing remembered was "ash"
    expect(seen).toEqual([undefined, undefined, 'req-first']);
  });

  it('an expedition to another region is a new request', async () => {
    const { api, seen } = lossy('expeditionSend', [lost('req-orrl')]);
    const session = await ready(api);
    await session.expeditionSend('send', { region: 'orrl-falls', choice: 12 });
    await session.expeditionSend('send', { region: 'koko-woods', choice: 12 });
    expect(seen).toEqual([undefined, undefined]);
  });

  it('a Forge collect from another station is a new request', async () => {
    const { api, seen } = lossy('forgeCollect', [lost('req-loom')]);
    const session = await ready(api);
    await session.forgeCollect('collect', 'loom');
    await session.forgeCollect('collect', 'forge');
    expect(seen).toEqual([undefined, undefined]);
  });

  it('the key does not depend on the order of the fields', async () => {
    const { api, seen } = lossy('shopBuy', [lost('req-slot')]);
    const session = await ready(api);
    await session.shopBuy('charm:0', { kind: 'charm', index: 0 });
    await session.shopBuy('charm:0', { index: 0, kind: 'charm' });
    expect(seen).toEqual([undefined, 'req-slot']);
  });

  it('a slot-0 buy in a later visit to the shop is a new request once the window has passed', async () => {
    const { api, seen } = lossy('shopBuy', [lost('req-slot-0'), lost('req-slot-0b')]);
    const session = await ready(api);
    await session.shopBuy('charm:0', { kind: 'charm', index: 0 });

    // Inside the window it is the same attempt, tried again.
    vi.setSystemTime(NOW + REPLAY_WINDOW_MS);
    await session.shopBuy('charm:0', { kind: 'charm', index: 0 });
    // The retry died as well; it is remembered from now, and forgotten once the window has passed.
    vi.setSystemTime(NOW + REPLAY_WINDOW_MS * 2 + 1);
    expect((await session.shopBuy('charm:0', { kind: 'charm', index: 0 })).ok).toBe(true);
    expect(seen).toEqual([undefined, 'req-slot-0', undefined]);
  });

  it('a slot-0 buy is a new request once a fresh read shows the state has moved on', async () => {
    let me: MeResponse = fixtureMe(NOW);
    const { api, seen } = lossy('shopBuy', [lost('req-slot-0')]);
    const session = await ready({ ...api, me: async () => me });

    // A poll that sees nothing new keeps the id: the lost buy may still be on its way.
    await session.shopBuy('charm:0', { kind: 'charm', index: 0 });
    await session.refresh();
    await session.shopBuy('charm:0', { kind: 'charm', index: 0 });
    expect(seen).toEqual([undefined, 'req-slot-0']);

    // After that, an outcome the player has already seen is no reason to replay anything.
    const second = lossy('shopBuy', [lost('req-slot-0')]);
    const later = await ready({ ...second.api, me: async () => me });
    await later.shopBuy('charm:0', { kind: 'charm', index: 0 });
    me = { ...me, gold: me.gold - 40 };
    await later.refresh();
    expect(later.me?.gold).toBe(me.gold);
    await later.shopBuy('charm:0', { kind: 'charm', index: 0 });
    expect(second.seen).toEqual([undefined, undefined]);
  });

  it('remembers the id after retries ran out on a gateway error, not only on a dead network', async () => {
    for (const status of [502, 503, 504]) {
      const { api, seen } = lossy('shopReroll', [
        new ApiError(status, `The server answered ${status}.`, null, `req-gw-${status}`),
      ]);
      const session = await ready(api);
      expect(await session.shopReroll()).toMatchObject({ ok: false, status });
      expect((await session.shopReroll()).ok).toBe(true);
      expect(seen, String(status)).toEqual([undefined, `req-gw-${status}`]);
    }
  });

  it('forgets the id when the api gives a real answer', async () => {
    const { api, seen } = lossy('shopReroll', [lost('req-a'), new ApiError(409, 'no', 'sold_out')]);
    const session = await ready(api);
    await session.shopReroll();
    await session.shopReroll();
    await session.shopReroll();
    expect(seen).toEqual([undefined, 'req-a', undefined]);
  });
});

describe('the poll and a burst of Combat Log rows', () => {
  const [template] = fixtureLogEntries(NOW) as [LogEntry, ...LogEntry[]];

  /** `count` distinct rows, newest first. */
  const burst = (count: number, tag = 'burst'): LogEntry[] =>
    Array.from({ length: count }, (_, index) => ({
      ...template,
      id: `2026-11-11T14:05:00.000Z#${tag}-${String(count - index).padStart(3, '0')}`,
    }));

  function logApi(initial: LogEntry[], pageSize: number) {
    const state = {
      entries: initial,
      failCursor: null as ApiError | null,
      calls: [] as (string | null)[],
    };
    const api: Api = {
      ...createFixtureApi({ now: NOW }),
      async me() {
        return fixtureMe(NOW);
      },
      async installations() {
        return fixtureInstallations();
      },
      async log(cursor) {
        state.calls.push(cursor ?? null);
        if (cursor && state.failCursor) throw state.failCursor;
        const offset = cursor ? Number(cursor) : 0;
        const end = offset + pageSize;
        const page: LogResponse = {
          entries: state.entries.slice(offset, end),
          nextCursor: end < state.entries.length ? String(end) : null,
        };
        return page;
      },
    };
    return { api, state };
  }

  it('follows the cursor while every row is new, and stops at the first row it knows', async () => {
    const old = fixtureLogEntries(NOW);
    const { api, state } = logApi(old, 4);
    const session = await ready(api);
    expect(session.entries).toHaveLength(4);
    const before = session.nextCursor;

    const news = burst(6);
    state.entries = [...news, ...old];
    state.calls = [];
    await session.refresh();

    // Page one (4 new), page two (2 new and 2 known): two reads, no third.
    expect(state.calls).toEqual([null, '4']);
    expect(session.entries.map((entry) => entry.id)).toEqual([
      ...news.map((entry) => entry.id),
      ...old.slice(0, 4).map((entry) => entry.id),
    ]);
    expect(session.fresh?.id).toBe(news[0]?.id);
    expect(session.nextCursor).toBe(before);
  });

  it('reads only the newest page when it already meets a known row', async () => {
    const old = fixtureLogEntries(NOW);
    const { api, state } = logApi(old, 4);
    const session = await ready(api);
    state.entries = [...burst(2), ...old];
    state.calls = [];
    await session.refresh();
    expect(state.calls).toEqual([null]);
    expect(session.entries).toHaveLength(6);
  });

  it('starts the list over when the burst outruns the pages it is willing to read, leaving no hole', async () => {
    const old = fixtureLogEntries(NOW);
    const { api, state } = logApi(old, 2);
    const session = await ready(api);
    const news = burst(POLL_MAX_PAGES * 2 + 3);
    state.entries = [...news, ...old];
    state.calls = [];
    await session.refresh();

    expect(state.calls).toHaveLength(POLL_MAX_PAGES);
    expect(session.entries.map((entry) => entry.id)).toEqual(
      news.slice(0, POLL_MAX_PAGES * 2).map((entry) => entry.id),
    );
    expect(session.nextCursor).toBe(String(POLL_MAX_PAGES * 2));

    // "Older entries" carries on from there until the whole log is on screen, in order and once each.
    for (let guard = 0; session.nextCursor !== null && guard < 30; guard += 1) {
      await session.loadMore();
    }
    expect(session.entries.map((entry) => entry.id)).toEqual(
      state.entries.map((entry) => entry.id),
    );
  });

  it('keeps the list and tries again at the next poll when an extra page cannot be read', async () => {
    const old = fixtureLogEntries(NOW);
    const { api, state } = logApi(old, 4);
    const session = await ready(api);
    const news = burst(6);
    state.entries = [...news, ...old];

    state.failCursor = new ApiError(0, 'offline');
    await session.refresh();
    expect(session.status).toBe('ready');
    expect(session.entries).toHaveLength(4);
    expect(session.fresh).toBeNull();

    state.failCursor = null;
    await session.refresh();
    expect(session.entries.slice(0, 6).map((entry) => entry.id)).toEqual(
      news.map((entry) => entry.id),
    );
    expect(session.entries).toHaveLength(10);
  });

  it('ends the session if an extra page is refused with a 401', async () => {
    const old = fixtureLogEntries(NOW);
    const { api, state } = logApi(old, 4);
    const session = await ready(api);
    state.entries = [...burst(6), ...old];
    state.failCursor = new ApiError(401, 'expired');
    await session.refresh();
    expect(session.status).toBe('signed-out');
    expect(session.expired).toBe(true);
  });

  it('shows the first rows of a log that was empty when the page loaded, however many arrive', async () => {
    const { api, state } = logApi([], 4);
    const session = await ready(api);
    expect(session.entries).toEqual([]);
    state.entries = burst(7);
    await session.refresh();
    expect(session.entries).toHaveLength(7);
    expect(session.nextCursor).toBeNull();
  });
});
