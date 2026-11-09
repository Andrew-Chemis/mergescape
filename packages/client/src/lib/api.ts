/**
 * Typed client for the api service (design.md section 9, docs/api-contract.md). Reads are GETs; the
 * mutations (shop, shrine, Pledge plays, delete) are POSTs that each carry a `requestId`: a UUID made once
 * per attempt and sent again unchanged if the network fails, so a replay can never buy something twice
 * (the api answers a repeated id with the first response). The bearer token lives in localStorage, and
 * the sign-in hand-off is the api redirecting back with `#token=<jwt>`, which is stored and removed from
 * the address bar on load.
 */
import type { ExpeditionChoice, RegionId } from '@mergescape/shared';
import type {
  DepthMutationResponse,
  EquipInput,
  ExpeditionCollectResponse,
  ExpeditionSendResponse,
  ExpeditionView,
  FeatsResponse,
  ForgeCollectResponse,
  ForgeView,
  InstallationsResponse,
  LogResponse,
  MeResponse,
  MutationResponse,
  PackOptionsResponse,
  Station,
  UpgradeInput,
  WeekSummary,
} from './types';

/** What `POST /shop/buy` takes besides the request id. `index` is the shelf slot (not for voucher or legendary). */
export interface ShopBuyInput {
  kind: 'charm' | 'pack' | 'voucher' | 'legendary';
  index?: number;
}

/** What `POST /shop/pick` takes. `index` -1 is the free Raid pack. */
export interface ShopPickInput {
  index: number;
  option: number;
}

/** What `POST /expedition/send` takes besides the request id. */
export interface ExpeditionSendInput {
  region: RegionId;
  choice: ExpeditionChoice;
}

/** What `POST /packs/open` takes besides the request id: the pack's seed and the Charm kept from it. */
export interface PackOpenInput {
  seed: number;
  charmId: string;
}

/** What `POST /forge/start` takes besides the request id. `pieceId` is for an affix order. */
export interface ForgeStartInput {
  recipeId: string;
  pieceId?: string;
}

/**
 * Optional second argument of every mutation. A caller that saw a network failure passes the failed
 * attempt's `requestId` (from `ApiError.requestId`) to replay that same attempt instead of starting a new one.
 */
export interface MutationOptions {
  requestId?: string;
}

export interface Api {
  /** `GET /me` */
  me(): Promise<MeResponse>;
  /** `GET /log?cursor=` (newest first; omit the cursor for the first page) */
  log(cursor?: string | null): Promise<LogResponse>;
  /** `GET /installations` */
  installations(): Promise<InstallationsResponse>;
  /** `GET /week` */
  getWeek(): Promise<WeekSummary>;
  /** `POST /shop/buy` */
  shopBuy(input: ShopBuyInput, options?: MutationOptions): Promise<MutationResponse>;
  /** `POST /shop/pick` */
  shopPick(input: ShopPickInput, options?: MutationOptions): Promise<MutationResponse>;
  /** `POST /shop/reroll` */
  shopReroll(options?: MutationOptions): Promise<MutationResponse>;
  /** `POST /shop/sell` */
  shopSell(charmId: string, options?: MutationOptions): Promise<MutationResponse>;
  /** `POST /shrine/remove` */
  shrineRemove(pledgeId: string, options?: MutationOptions): Promise<MutationResponse>;
  /** `POST /pledges/play` */
  pledgePlay(pledgeId: string, options?: MutationOptions): Promise<MutationResponse>;
  /** `GET /expedition` */
  expedition(): Promise<ExpeditionView>;
  /** `POST /expedition/send` */
  expeditionSend(
    input: ExpeditionSendInput,
    options?: MutationOptions,
  ): Promise<ExpeditionSendResponse>;
  /** `POST /expedition/collect` (idempotent: a repeat answers the same loot with `applied` false) */
  expeditionCollect(options?: MutationOptions): Promise<ExpeditionCollectResponse>;
  /** `GET /packs/:seed` */
  packOptions(seed: number): Promise<PackOptionsResponse>;
  /** `POST /packs/open` */
  packOpen(input: PackOpenInput, options?: MutationOptions): Promise<DepthMutationResponse>;
  /** `GET /forge` */
  forge(): Promise<ForgeView>;
  /** `POST /forge/start` */
  forgeStart(input: ForgeStartInput, options?: MutationOptions): Promise<DepthMutationResponse>;
  /** `POST /forge/collect` */
  forgeCollect(station: Station, options?: MutationOptions): Promise<ForgeCollectResponse>;
  /** `POST /forge/upgrade` */
  forgeUpgrade(input: UpgradeInput, options?: MutationOptions): Promise<DepthMutationResponse>;
  /** `POST /gear/equip` */
  gearEquip(input: EquipInput, options?: MutationOptions): Promise<DepthMutationResponse>;
  /** `GET /feats` */
  feats(): Promise<FeatsResponse>;
  /** `POST /feats/pin` */
  featPin(
    featId: string,
    pinned: boolean,
    options?: MutationOptions,
  ): Promise<DepthMutationResponse>;
  /** `GET /export`: everything stored under the player's partition, as parsed JSON. */
  exportData(): Promise<Record<string, unknown>>;
  /** `POST /delete`: resolves on 204; 400 `confirm_mismatch` when the login does not match. */
  deleteAccount(confirmLogin: string, options?: MutationOptions): Promise<void>;
}

/**
 * A failed request. `status` is the HTTP status, or 0 when the network or the body failed. `code` is the
 * api's machine-readable `error` (`insufficient_gold`, `sold_out`, `shop_closed`, `window_closed`, ...) when
 * the body had one. `requestId` is set on a failed mutation so the caller can replay the same attempt.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string | null;
  readonly requestId: string | undefined;

  constructor(status: number, message: string, code: string | null = null, requestId?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.requestId = requestId;
  }
}

/** A fresh idempotency key. `crypto.randomUUID` needs a secure context, so fall back to random bytes. */
export function newRequestId(): string {
  const c = globalThis.crypto;
  if (typeof c?.randomUUID === 'function') {
    return c.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (typeof c?.getRandomValues === 'function') {
    c.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = ((bytes[6] as number) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] as number) & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0'));
  return [
    hex.slice(0, 4).join(''),
    hex.slice(4, 6).join(''),
    hex.slice(6, 8).join(''),
    hex.slice(8, 10).join(''),
    hex.slice(10).join(''),
  ].join('-');
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
  /** Waits between attempts of a mutation that hit a network failure; one entry per retry. */
  retryDelaysMs?: readonly number[];
  /** Replaced in tests so the retry delays take no real time. */
  sleep?: (ms: number) => Promise<void>;
  /** Replaced in tests to make request ids predictable. */
  newId?: () => string;
}

/** Retry a failed mutation twice, after 400 ms and then 1.2 s, always with the same request id. */
export const DEFAULT_RETRY_DELAYS_MS: readonly number[] = [400, 1200];

/** Gateway statuses that mean "the request may not have reached the handler": safe to replay with the same id. */
const TRANSIENT_STATUSES: ReadonlySet<number> = new Set([502, 503, 504]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The api's `{ error, message? }` body, when the failed response has one. */
async function errorDetails(response: Response): Promise<{ code: string | null; message: string }> {
  const fallback = `The server answered ${response.status}.`;
  try {
    const body: unknown = await response.json();
    if (isRecord(body)) {
      const code = typeof body['error'] === 'string' ? body['error'] : null;
      const message =
        typeof body['message'] === 'string' && body['message'] !== '' ? body['message'] : fallback;
      return { code, message };
    }
  } catch {
    // An empty or non-JSON error body: the status alone has to do.
  }
  return { code: null, message: fallback };
}

function asMutationResponse(body: Record<string, unknown>): MutationResponse {
  const me = body['me'];
  const week = body['week'];
  if (!isRecord(me) || typeof me['login'] !== 'string' || typeof me['xp'] !== 'number') {
    throw new ApiError(0, 'The server sent an unexpected profile.');
  }
  if (!isRecord(week)) {
    throw new ApiError(0, 'The server sent an unexpected week.');
  }
  return { me: me as unknown as MeResponse, week: week as unknown as WeekSummary };
}

function asProfile(value: unknown): MeResponse {
  if (!isRecord(value) || typeof value['login'] !== 'string' || typeof value['xp'] !== 'number') {
    throw new ApiError(0, 'The server sent an unexpected profile.');
  }
  return value as unknown as MeResponse;
}

function asDepthMutation(body: Record<string, unknown>): DepthMutationResponse {
  return { me: asProfile(body['me']) };
}

export function createHttpApi(options: HttpApiOptions): Api {
  const { origin, getToken = readToken } = options;
  const retryDelays = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  const sleep =
    options.sleep ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)));
  const newId = options.newId ?? newRequestId;

  /** One HTTP exchange. Resolves with the parsed JSON object, or `{}` for a 204. */
  async function send(
    method: 'GET' | 'POST',
    path: string,
    body?: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const token = getToken();
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    let response: Response;
    try {
      const doFetch = options.fetchFn ?? fetch;
      // No cookies: the bearer token is the only credential.
      response = await doFetch(`${origin}${path}`, {
        method,
        headers,
        credentials: 'omit',
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      throw new ApiError(0, 'Could not reach the server.');
    }
    if (!response.ok) {
      const { code, message } = await errorDetails(response);
      throw new ApiError(response.status, message, code);
    }
    if (response.status === 204) {
      return {};
    }
    let parsed: unknown;
    try {
      parsed = await response.json();
    } catch {
      throw new ApiError(0, 'The server sent something that is not JSON.');
    }
    if (!isRecord(parsed)) {
      throw new ApiError(0, 'The server sent an unexpected response.');
    }
    return parsed;
  }

  function get(path: string): Promise<Record<string, unknown>> {
    return send('GET', path);
  }

  /**
   * A mutation: make the request id once (or take the caller's, when replaying an attempt that failed
   * on the network), then send it, again with the same id after a network failure or a gateway error.
   * Anything else, a 409 above all, is the api's real answer and is not retried.
   */
  async function post(
    path: string,
    fields: Record<string, unknown>,
    mutation?: MutationOptions,
  ): Promise<Record<string, unknown>> {
    const requestId = mutation?.requestId ?? newId();
    const body = { requestId, ...fields };
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await send('POST', path, body);
      } catch (error) {
        if (!(error instanceof ApiError)) {
          throw error;
        }
        const transient = error.status === 0 || TRANSIENT_STATUSES.has(error.status);
        if (!transient) {
          throw error;
        }
        const delay = retryDelays[attempt];
        if (delay === undefined) {
          // Out of retries: hand the id back so a later click can replay this same attempt.
          throw new ApiError(error.status, error.message, error.code, requestId);
        }
        await sleep(delay);
      }
    }
  }

  async function mutate(
    path: string,
    fields: Record<string, unknown>,
    mutation?: MutationOptions,
  ): Promise<MutationResponse> {
    return asMutationResponse(await post(path, fields, mutation));
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
    async getWeek() {
      const body = await get('/week');
      if (typeof body['weekKey'] !== 'string' || !isRecord(body['targets'])) {
        throw new ApiError(0, 'The server sent an unexpected week.');
      }
      return body as unknown as WeekSummary;
    },
    shopBuy(input, mutation) {
      const fields: Record<string, unknown> = { kind: input.kind };
      if (input.index !== undefined) {
        fields['index'] = input.index;
      }
      return mutate('/shop/buy', fields, mutation);
    },
    shopPick(input, mutation) {
      return mutate('/shop/pick', { index: input.index, option: input.option }, mutation);
    },
    shopReroll(mutation) {
      return mutate('/shop/reroll', {}, mutation);
    },
    shopSell(charmId, mutation) {
      return mutate('/shop/sell', { charmId }, mutation);
    },
    shrineRemove(pledgeId, mutation) {
      return mutate('/shrine/remove', { pledgeId }, mutation);
    },
    pledgePlay(pledgeId, mutation) {
      return mutate('/pledges/play', { pledgeId }, mutation);
    },
    async expedition() {
      const body = await get('/expedition');
      if (
        typeof body['status'] !== 'string' ||
        !Array.isArray(body['regions']) ||
        !Array.isArray(body['choices'])
      ) {
        throw new ApiError(0, 'The server sent an unexpected expedition.');
      }
      return { expedition: null, returnsAt: null, ...body } as unknown as ExpeditionView;
    },
    async expeditionSend(input, mutation) {
      const body = await post(
        '/expedition/send',
        { region: input.region, choice: input.choice },
        mutation,
      );
      if (!isRecord(body['expedition'])) {
        throw new ApiError(0, 'The server sent an unexpected expedition.');
      }
      return {
        me: asProfile(body['me']),
        expedition: body['expedition'],
      } as unknown as ExpeditionSendResponse;
    },
    async expeditionCollect(mutation) {
      const body = await post('/expedition/collect', {}, mutation);
      if (!isRecord(body['expedition']) || !Array.isArray(body['loot'])) {
        throw new ApiError(0, 'The server sent an unexpected haul.');
      }
      return {
        me: asProfile(body['me']),
        expedition: body['expedition'],
        loot: body['loot'],
        applied: body['applied'] !== false,
        featsUnlocked: Array.isArray(body['featsUnlocked']) ? body['featsUnlocked'] : [],
      } as unknown as ExpeditionCollectResponse;
    },
    async packOptions(seed) {
      const body = await get(`/packs/${encodeURIComponent(String(seed))}`);
      if (!Array.isArray(body['options'])) {
        throw new ApiError(0, 'The server sent an unexpected pack.');
      }
      return body as unknown as PackOptionsResponse;
    },
    async packOpen(input, mutation) {
      return asDepthMutation(
        await post('/packs/open', { seed: input.seed, charmId: input.charmId }, mutation),
      );
    },
    async forge() {
      const body = await get('/forge');
      if (!isRecord(body['stations']) || !Array.isArray(body['recipes'])) {
        throw new ApiError(0, 'The server sent an unexpected Forge.');
      }
      return { upgrades: [], ...body } as unknown as ForgeView;
    },
    async forgeStart(input, mutation) {
      const fields: Record<string, unknown> = { recipeId: input.recipeId };
      if (input.pieceId !== undefined) {
        fields['pieceId'] = input.pieceId;
      }
      return asDepthMutation(await post('/forge/start', fields, mutation));
    },
    async forgeCollect(station, mutation) {
      const body = await post('/forge/collect', { station }, mutation);
      return {
        me: asProfile(body['me']),
        piece: isRecord(body['piece']) ? body['piece'] : null,
        applied: body['applied'] !== false,
      } as unknown as ForgeCollectResponse;
    },
    async forgeUpgrade(input, mutation) {
      return asDepthMutation(await post('/forge/upgrade', { ...input }, mutation));
    },
    async gearEquip(input, mutation) {
      return asDepthMutation(await post('/gear/equip', { ...input }, mutation));
    },
    async feats() {
      const body = await get('/feats');
      if (!Array.isArray(body['feats'])) {
        throw new ApiError(0, 'The server sent unexpected Feats.');
      }
      return body as unknown as FeatsResponse;
    },
    async featPin(featId, pinned, mutation) {
      return asDepthMutation(await post('/feats/pin', { featId, pinned }, mutation));
    },
    exportData() {
      return get('/export');
    },
    async deleteAccount(confirmLogin, mutation) {
      await post('/delete', { confirmLogin }, mutation);
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
