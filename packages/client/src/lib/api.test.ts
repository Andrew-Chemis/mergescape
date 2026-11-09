import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  clearToken,
  consumeTokenFromHash,
  createHttpApi,
  installUrl,
  normalizeOrigin,
  readToken,
  signInUrl,
  storeToken,
  TOKEN_KEY,
} from './api';

// A JWT-shaped string (three base64url segments); the client never decodes it.
const TOKEN = 'aaa.bbb.ccc';

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

  it('exposes only reads', () => {
    const api = createHttpApi({ origin: 'https://api.example' });
    expect(Object.keys(api).sort()).toEqual(['installations', 'log', 'me']);
  });
});
