import { afterEach, describe, expect, it, vi } from 'vitest';
import { isoWeekKey } from '@mergescape/shared';
import {
  ApiError,
  clearToken,
  consumeTokenFromHash,
  createHttpApi,
  installUrl,
  newRequestId,
  normalizeOrigin,
  readToken,
  signInUrl,
  storeToken,
  TOKEN_KEY,
} from './api';
import type { Api } from './api';
import { fixtureMe, fixtureWeek } from './fixtures/state';

// A JWT-shaped string (three base64url segments); the client never decodes it.
const TOKEN = 'aaa.bbb.ccc';
const NOW = Date.UTC(2026, 10, 11, 14, 5, 0);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  window.history.replaceState(null, '', '/');
});

describe('token storage', () => {
  it('stores, reads and clears the token', () => {
    expect(readToken()).toBeNull();
    expect(storeToken(TOKEN)).toBe(true);
    expect(window.localStorage.getItem(TOKEN_KEY)).toBe(TOKEN);
    expect(readToken()).toBe(TOKEN);
    clearToken();
    expect(readToken()).toBeNull();
  });

  it('survives storage that throws (private windows, blocked site data)', () => {
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    expect(readToken(broken)).toBeNull();
    expect(storeToken(TOKEN, broken)).toBe(false);
    expect(() => clearToken(broken)).not.toThrow();
  });

  it('reports no storage at all', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(readToken()).toBeNull();
    expect(storeToken(TOKEN)).toBe(false);
  });

  it('survives a localStorage getter that throws', () => {
    vi.spyOn(globalThis, 'localStorage', 'get').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(readToken()).toBeNull();
    expect(storeToken(TOKEN)).toBe(false);
    vi.restoreAllMocks();
  });
});

describe('consumeTokenFromHash', () => {
  it('stores a #token= fragment and clears the whole fragment', () => {
    window.history.replaceState(null, '', `/play/?fixture=0#token=${TOKEN}`);
    expect(consumeTokenFromHash()).toBe(true);
    expect(readToken()).toBe(TOKEN);
    expect(window.location.hash).toBe('');
    expect(window.location.pathname + window.location.search).toBe('/play/?fixture=0');
  });

  it('leaves ordinary route fragments alone', () => {
    window.history.replaceState(null, '', '/#/log');
    expect(consumeTokenFromHash()).toBe(false);
    expect(window.location.hash).toBe('#/log');
    expect(readToken()).toBeNull();
  });

  it('clears a malformed token from the address bar without storing it', () => {
    window.history.replaceState(null, '', '/#token=<script>alert(1)</script>');
    expect(consumeTokenFromHash()).toBe(false);
    expect(window.location.hash).toBe('');
    expect(readToken()).toBeNull();
  });

  it('clears an empty token', () => {
    window.history.replaceState(null, '', '/#token=');
    expect(consumeTokenFromHash()).toBe(false);
    expect(window.location.hash).toBe('');
  });
});

describe('origin and links', () => {
  it.each([
    [undefined, null],
    ['', null],
    ['not a url', null],
    ['ftp://example.com', null],
    ['https://abc.lambda-url.us-east-1.on.aws/', 'https://abc.lambda-url.us-east-1.on.aws'],
    ['https://abc.lambda-url.us-east-1.on.aws/path?x=1', 'https://abc.lambda-url.us-east-1.on.aws'],
    ['http://localhost:3000', 'http://localhost:3000'],
  ])('normalizeOrigin(%j) -> %j', (raw, expected) => {
    expect(normalizeOrigin(raw)).toBe(expected);
  });

  it('builds the sign-in and install links', () => {
    expect(signInUrl('https://api.example')).toBe('https://api.example/auth/login');
    expect(signInUrl(null)).toBeNull();
    expect(installUrl('my-app')).toBe('https://github.com/apps/my-app/installations/new');
    expect(installUrl(undefined)).toBe('https://github.com/apps/mergescape/installations/new');
    expect(installUrl('bad slug/../x')).toBe(
      'https://github.com/apps/mergescape/installations/new',
    );
  });
});

describe('createHttpApi', () => {
  it('GETs /me with the bearer token and no cookies', async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ login: 'octo-dev', xp: 5 }));
    const api = createHttpApi({
      origin: 'https://api.example',
      getToken: () => TOKEN,
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    const me = await api.me();
    expect(me.login).toBe('octo-dev');
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.example/me');
    expect(init.method).toBe('GET');
    expect(init.credentials).toBe('omit');
    expect((init.headers as Record<string, string>)['Authorization']).toBe(`Bearer ${TOKEN}`);
    expect(init.body).toBeUndefined();
  });

  it('sends no Authorization header without a token', async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ installations: [] }));
    const api = createHttpApi({
      origin: 'https://api.example',
      getToken: () => null,
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    await api.installations();
    const [, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.headers).not.toHaveProperty('Authorization');
  });

  it('passes the log cursor URL-encoded, and nothing for the first page', async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ entries: [], nextCursor: null }));
    const api = createHttpApi({
      origin: 'https://api.example',
      getToken: () => TOKEN,
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    await api.log();
    await api.log(null);
    await api.log('a b/c?d#e');
    const urls = fetchFn.mock.calls.map((call) => (call as unknown as [string])[0]);
    expect(urls).toEqual([
      'https://api.example/log',
      'https://api.example/log',
      'https://api.example/log?cursor=a%20b%2Fc%3Fd%23e',
    ]);
  });

  it('turns a missing nextCursor into null', async () => {
    const api = createHttpApi({
      origin: 'https://api.example',
      getToken: () => TOKEN,
      fetchFn: (async () => jsonResponse({ entries: [] })) as unknown as typeof fetch,
    });
    expect((await api.log()).nextCursor).toBeNull();
  });

  it('raises ApiError with the HTTP status', async () => {
    const api = createHttpApi({
      origin: 'https://api.example',
      getToken: () => TOKEN,
      fetchFn: (async () => jsonResponse({ error: 'no' }, 401)) as unknown as typeof fetch,
    });
    const error = await api.me().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(401);
  });

  it('raises ApiError(0) for network failures, non-JSON bodies and wrong shapes', async () => {
    const make = (fetchFn: unknown) =>
      createHttpApi({
        origin: 'https://api.example',
        getToken: () => TOKEN,
        fetchFn: fetchFn as typeof fetch,
      });
    const offline = make(async () => {
      throw new TypeError('Failed to fetch');
    });
    await expect(offline.me()).rejects.toMatchObject({ name: 'ApiError', status: 0 });

    const html = make(async () => new Response('<html>', { status: 200 }));
    await expect(html.me()).rejects.toMatchObject({ status: 0 });

    const array = make(async () => jsonResponse([1, 2, 3]));
    await expect(array.me()).rejects.toMatchObject({ status: 0 });

    const wrongMe = make(async () => jsonResponse({ hello: 'world' }));
    await expect(wrongMe.me()).rejects.toMatchObject({ status: 0 });
    const wrongLog = make(async () => jsonResponse({ hello: 'world' }));
    await expect(wrongLog.log()).rejects.toMatchObject({ status: 0 });
    const wrongInstalls = make(async () => jsonResponse({ hello: 'world' }));
    await expect(wrongInstalls.installations()).rejects.toMatchObject({ status: 0 });
  });

  it('exposes the reads and exactly the contract writes', () => {
    const api = createHttpApi({ origin: 'https://api.example' });
    expect(Object.keys(api).sort()).toEqual([
      'deleteAccount',
      'expedition',
      'expeditionCollect',
      'expeditionSend',
      'exportData',
      'featPin',
      'feats',
      'forge',
      'forgeCollect',
      'forgeStart',
      'forgeUpgrade',
      'gearEquip',
      'getWeek',
      'installations',
      'log',
      'me',
      'packOpen',
      'packOptions',
      'pledgePlay',
      'settings',
      'shopBuy',
      'shopPick',
      'shopReroll',
      'shopSell',
      'shrineRemove',
    ]);
  });

  it('reads the typed error code and message from a failed response', async () => {
    const api = createHttpApi({
      origin: 'https://api.example',
      getToken: () => TOKEN,
      fetchFn: (async () =>
        jsonResponse(
          { error: 'insufficient_gold', message: 'Need 120' },
          409,
        )) as unknown as typeof fetch,
    });
    const error = (await api.getWeek().catch((e: unknown) => e)) as ApiError;
    expect(error.status).toBe(409);
    expect(error.code).toBe('insufficient_gold');
    expect(error.message).toBe('Need 120');
    // A body that is not JSON still gives the status.
    const bare = createHttpApi({
      origin: 'https://api.example',
      getToken: () => TOKEN,
      fetchFn: (async () => new Response('', { status: 404 })) as unknown as typeof fetch,
    });
    const missing = (await bare.exportData().catch((e: unknown) => e)) as ApiError;
    expect(missing.status).toBe(404);
    expect(missing.code).toBeNull();
    expect(missing.message).toBe('The server answered 404.');
  });

  it('reads GET /week', async () => {
    const week = fixtureWeek(NOW);
    const fetchFn = vi.fn(async () => jsonResponse(week));
    const api = createHttpApi({
      origin: 'https://api.example',
      getToken: () => TOKEN,
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    expect((await api.getWeek()).weekKey).toBe(week.weekKey);
    expect((fetchFn.mock.calls[0] as unknown as [string])[0]).toBe('https://api.example/week');
    const wrong = createHttpApi({
      origin: 'https://api.example',
      getToken: () => TOKEN,
      fetchFn: (async () => jsonResponse({ hello: 'world' })) as unknown as typeof fetch,
    });
    await expect(wrong.getWeek()).rejects.toMatchObject({ status: 0 });
  });
});

describe('createHttpApi mutations (docs/api-contract.md)', () => {
  const answer = () => {
    const me = fixtureMe(NOW);
    return { me, week: me.week };
  };

  function make(fetchFn: unknown, extra: Partial<Parameters<typeof createHttpApi>[0]> = {}) {
    return createHttpApi({
      origin: 'https://api.example',
      getToken: () => TOKEN,
      fetchFn: fetchFn as typeof fetch,
      sleep: async () => {},
      newId: () => 'req-1',
      ...extra,
    });
  }

  const bodyOf = (call: unknown): Record<string, unknown> =>
    JSON.parse(((call as [string, RequestInit])[1].body as string | undefined) ?? '{}') as Record<
      string,
      unknown
    >;

  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

  const calls: [string, (api: Api) => Promise<unknown>, string, Record<string, unknown>][] = [
    [
      'shopBuy charm',
      (api) => api.shopBuy({ kind: 'charm', index: 1 }),
      '/shop/buy',
      { kind: 'charm', index: 1 },
    ],
    [
      'shopBuy pack',
      (api) => api.shopBuy({ kind: 'pack', index: 0 }),
      '/shop/buy',
      { kind: 'pack', index: 0 },
    ],
    [
      'shopBuy voucher',
      (api) => api.shopBuy({ kind: 'voucher' }),
      '/shop/buy',
      { kind: 'voucher' },
    ],
    [
      'shopBuy legendary',
      (api) => api.shopBuy({ kind: 'legendary' }),
      '/shop/buy',
      { kind: 'legendary' },
    ],
    [
      'shopPick',
      (api) => api.shopPick({ index: -1, option: 2 }),
      '/shop/pick',
      { index: -1, option: 2 },
    ],
    ['shopReroll', (api) => api.shopReroll(), '/shop/reroll', {}],
    ['shopSell', (api) => api.shopSell('hot-potato'), '/shop/sell', { charmId: 'hot-potato' }],
    ['shrineRemove', (api) => api.shrineRemove('mentor'), '/shrine/remove', { pledgeId: 'mentor' }],
    ['pledgePlay', (api) => api.pledgePlay('strike'), '/pledges/play', { pledgeId: 'strike' }],
  ];

  it.each(calls)(
    '%s POSTs { requestId, ...fields } with the bearer token',
    async (_name, call, path, fields) => {
      const fetchFn = vi.fn(async () => jsonResponse(answer()));
      const result = (await call(make(fetchFn))) as ReturnType<typeof answer>;
      expect(result.me.login).toBe('octo-dev');
      expect(result.week?.weekKey).toBe(isoWeekKey(NOW));
      expect(fetchFn).toHaveBeenCalledTimes(1);
      const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe('https://api.example' + path);
      expect(init.method).toBe('POST');
      expect(init.credentials).toBe('omit');
      const headers = init.headers as Record<string, string>;
      expect(headers['Authorization']).toBe('Bearer ' + TOKEN);
      expect(headers['Content-Type']).toBe('application/json');
      expect(bodyOf(fetchFn.mock.calls[0])).toEqual({ requestId: 'req-1', ...fields });
    },
  );

  it('makes a real UUID request id when none is injected, a new one per attempt', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(answer()));
    const api = createHttpApi({
      origin: 'https://api.example',
      getToken: () => TOKEN,
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    await api.shopReroll();
    await api.shopReroll();
    const ids = fetchFn.mock.calls.map((call) => bodyOf(call)['requestId']);
    expect(ids[0]).toMatch(UUID);
    expect(ids[1]).not.toBe(ids[0]);
  });

  it('newRequestId falls back to random bytes without crypto.randomUUID', () => {
    vi.stubGlobal('crypto', { getRandomValues: (bytes: Uint8Array) => bytes.fill(7) });
    expect(newRequestId()).toBe('07070707-0707-4707-8707-070707070707');
    vi.stubGlobal('crypto', undefined);
    expect(newRequestId()).toMatch(UUID);
  });

  it('retries a network failure with the SAME request id, then succeeds', async () => {
    const sleeps: number[] = [];
    let attempts = 0;
    const fetchFn = vi.fn(async () => {
      attempts += 1;
      if (attempts < 3) {
        throw new TypeError('Failed to fetch');
      }
      return jsonResponse(answer());
    });
    let minted = 0;
    const api = make(fetchFn, {
      sleep: async (ms: number) => {
        sleeps.push(ms);
      },
      newId: () => 'req-' + String(++minted),
    });
    await api.shopBuy({ kind: 'charm', index: 0 });
    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(fetchFn.mock.calls.map((call) => bodyOf(call)['requestId'])).toEqual([
      'req-1',
      'req-1',
      'req-1',
    ]);
    expect(minted).toBe(1);
    expect(sleeps).toEqual([400, 1200]);
  });

  it('retries a gateway error the same way, but never a 409, 400, 401, 404 or 500', async () => {
    let attempts = 0;
    const gateway = make(
      vi.fn(async () => {
        attempts += 1;
        return attempts === 1
          ? jsonResponse({ error: 'bad_gateway' }, 502)
          : jsonResponse(answer());
      }),
    );
    await gateway.shopReroll();
    expect(attempts).toBe(2);

    for (const status of [409, 400, 401, 404, 500]) {
      const fetchFn = vi.fn(async () => jsonResponse({ error: 'sold_out' }, status));
      await expect(make(fetchFn).shopReroll()).rejects.toMatchObject({ status, code: 'sold_out' });
      expect(fetchFn).toHaveBeenCalledTimes(1);
    }
  });

  it('gives up after the last retry and hands the request id back for a later replay', async () => {
    const fetchFn = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    const api = make(fetchFn);
    const error = (await api.shopSell('hot-potato').catch((e: unknown) => e)) as ApiError;
    expect(error.status).toBe(0);
    expect(error.requestId).toBe('req-1');
    expect(fetchFn).toHaveBeenCalledTimes(3);

    // Replaying that attempt sends the same id again instead of minting a new one.
    fetchFn.mockClear();
    const replay = make(fetchFn, { newId: () => 'req-2' });
    await replay.shopSell('hot-potato', { requestId: error.requestId }).catch(() => undefined);
    expect(fetchFn.mock.calls.map((call) => bodyOf(call)['requestId'])).toEqual([
      'req-1',
      'req-1',
      'req-1',
    ]);
  });

  it('surfaces a 409 with its typed code and does not retry', async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ error: 'insufficient_gold' }, 409));
    const error = (await make(fetchFn)
      .shopBuy({ kind: 'charm', index: 0 })
      .catch((e: unknown) => e)) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(409);
    expect(error.code).toBe('insufficient_gold');
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('rejects a success body that is not { me, week }', async () => {
    await expect(make(async () => jsonResponse({ nope: 1 })).shopReroll()).rejects.toMatchObject({
      status: 0,
    });
    await expect(
      make(async () => jsonResponse({ me: fixtureMe(NOW), week: null })).shopReroll(),
    ).rejects.toMatchObject({ status: 0 });
  });

  it('GETs /export and POSTs /delete (a 204 has no body)', async () => {
    const fetchFn = vi.fn(async (url: string) =>
      url.endsWith('/export')
        ? jsonResponse({ exportedAt: 'x', profile: {}, events: [] })
        : new Response(null, { status: 204 }),
    );
    const api = make(fetchFn);
    expect((await api.exportData())['exportedAt']).toBe('x');
    await expect(api.deleteAccount('octo-dev')).resolves.toBeUndefined();
    const [exportUrl, exportInit] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(exportUrl).toBe('https://api.example/export');
    expect(exportInit.method).toBe('GET');
    const [deleteUrl, deleteInit] = fetchFn.mock.calls[1] as unknown as [string, RequestInit];
    expect(deleteUrl).toBe('https://api.example/delete');
    expect(deleteInit.method).toBe('POST');
    expect(bodyOf(fetchFn.mock.calls[1])).toEqual({ requestId: 'req-1', confirmLogin: 'octo-dev' });
  });

  it('answers confirm_mismatch (400) and a missing /delete or /export (404) as typed errors', async () => {
    const mismatch = make(async () => jsonResponse({ error: 'confirm_mismatch' }, 400));
    await expect(mismatch.deleteAccount('nope')).rejects.toMatchObject({
      status: 400,
      code: 'confirm_mismatch',
    });
    const missing = make(async () => new Response('Not Found', { status: 404 }));
    await expect(missing.deleteAccount('octo-dev')).rejects.toMatchObject({ status: 404 });
    await expect(missing.exportData()).rejects.toMatchObject({ status: 404 });
  });
});
