/**
 * Typed read-only client for the api service (design.md section 9). Three GETs, a bearer token from
 * localStorage, and the sign-in hand-off: the api redirects back with `#token=<jwt>`, which is stored
 * and removed from the address bar on load. Task 9 has no write calls.
 */
import type { InstallationsResponse, LogResponse, MeResponse } from './types';

export interface Api {
  /** `GET /me` */
  me(): Promise<MeResponse>;
  /** `GET /log?cursor=` (newest first; omit the cursor for the first page) */
  log(cursor?: string | null): Promise<LogResponse>;
  /** `GET /installations` */
  installations(): Promise<InstallationsResponse>;
}

/** A failed request. `status` is the HTTP status, or 0 when the network or the body failed. */
export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

// ---------------------------------------------------------------------------------------------
// Session token (localStorage, every access guarded: private windows and blocked storage throw)
// ---------------------------------------------------------------------------------------------

export const TOKEN_KEY = 'mergescape.token';

/** A compact JWT: three base64url segments. Anything else in `#token=` is ignored. */
const JWT_SHAPE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

export function readToken(
  storage: Pick<Storage, 'getItem'> | undefined = safeStorage(),
): string | null {
  try {
    return storage?.getItem(TOKEN_KEY) ?? null;
  } catch {
    return null;
  }
}

export function storeToken(
  token: string,
  storage: Pick<Storage, 'setItem'> | undefined = safeStorage(),
): boolean {
  try {
    storage?.setItem(TOKEN_KEY, token);
    return storage !== undefined;
  } catch {
    return false;
  }
}

export function clearToken(storage: Pick<Storage, 'removeItem'> | undefined = safeStorage()): void {
  try {
    storage?.removeItem(TOKEN_KEY);
  } catch {
    // Nothing to clear, or storage is blocked: the next load starts signed out either way.
  }
}

function safeStorage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

/**
 * If the address bar holds `#token=<jwt>`, store the token and remove the whole fragment so the token
 * does not stay in history or in a copied link. Returns whether a token was consumed.
 */
export function consumeTokenFromHash(win: Window = window): boolean {
  const hash = win.location.hash;
  if (!hash.startsWith('#token=')) {
    return false;
  }
  const token = new URLSearchParams(hash.slice(1)).get('token') ?? '';
  // Clear first: even a malformed token must not linger in the URL.
  win.history.replaceState(null, '', win.location.pathname + win.location.search);
  if (!JWT_SHAPE.test(token)) {
    return false;
  }
  storeToken(token);
  return true;
}

// ---------------------------------------------------------------------------------------------
// HTTP client
// ---------------------------------------------------------------------------------------------

/**
 * The api origin from `VITE_API_ORIGIN`, without a trailing slash, or null when unset or not an
 * http(s) URL. Unset means the build has no backend: the client runs on fixtures.
 */
export function normalizeOrigin(raw: string | undefined): string | null {
  if (!raw) {
    return null;
  }
  try {
    const url = new URL(raw.trim());
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.origin : null;
  } catch {
    return null;
  }
}

export function apiOrigin(): string | null {
  return normalizeOrigin(import.meta.env.VITE_API_ORIGIN);
}

export interface HttpApiOptions {
  origin: string;
  getToken?: () => string | null;
  fetchFn?: typeof fetch;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function createHttpApi(options: HttpApiOptions): Api {
  const { origin, getToken = readToken } = options;

  async function get(path: string): Promise<Record<string, unknown>> {
    const token = getToken();
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    let response: Response;
    try {
      const doFetch = options.fetchFn ?? fetch;
      // No cookies: the bearer token is the only credential.
      response = await doFetch(`${origin}${path}`, { method: 'GET', headers, credentials: 'omit' });
    } catch {
      throw new ApiError(0, 'Could not reach the server.');
    }
    if (!response.ok) {
      throw new ApiError(response.status, `The server answered ${response.status}.`);
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new ApiError(0, 'The server sent something that is not JSON.');
    }
    if (!isRecord(body)) {
      throw new ApiError(0, 'The server sent an unexpected response.');
    }
    return body;
  }

  return {
    async me() {
      const body = await get('/me');
      if (typeof body['login'] !== 'string' || typeof body['xp'] !== 'number') {
        throw new ApiError(0, 'The server sent an unexpected profile.');
      }
      return body as unknown as MeResponse;
    },
    async log(cursor) {
      const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
      const body = await get(`/log${query}`);
      if (!Array.isArray(body['entries'])) {
        throw new ApiError(0, 'The server sent an unexpected log.');
      }
      return { entries: body['entries'], nextCursor: body['nextCursor'] ?? null } as LogResponse;
    },
    async installations() {
      const body = await get('/installations');
      if (!Array.isArray(body['installations'])) {
        throw new ApiError(0, 'The server sent unexpected installations.');
      }
      return body as unknown as InstallationsResponse;
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------------------------

/** Where "Sign in with GitHub" goes: the api starts the OAuth flow. Null without a backend. */
export function signInUrl(origin: string | null): string | null {
  return origin ? `${origin}/auth/login` : null;
}

/**
 * The GitHub App's installation page. The slug comes from `VITE_GITHUB_APP_SLUG` at build time
 * (default `mergescape`).
 */
export function installUrl(
  slug: string | undefined = import.meta.env.VITE_GITHUB_APP_SLUG,
): string {
  const safe = slug && /^[A-Za-z0-9-]+$/.test(slug) ? slug : 'mergescape';
  return `https://github.com/apps/${safe}/installations/new`;
}
