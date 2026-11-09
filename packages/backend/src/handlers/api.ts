/**
 * The `api` Lambda behind a Function URL (auth NONE; sessions are bearer JWTs).
 *
 * | Route                   | Origin check | Auth   | Purpose                                         |
 * |-------------------------|--------------|--------|-------------------------------------------------|
 * | GET /auth/login         | no           | none   | 302 to GitHub with a single-use `state`         |
 * | GET /auth/callback      | no           | none   | exchange code, upsert profile, 302 with a JWT   |
 * | GET /me                 | yes          | bearer | the player's profile and current run            |
 * | GET /week               | yes          | bearer | the current run: acts, Pledges, the shop        |
 * | GET /log?cursor=        | yes          | bearer | Combat Log page, newest first                   |
 * | GET /installations      | yes          | bearer | the App installations the player can see        |
 * | POST /shop/buy          | yes          | bearer | buy a Charm, pack or Voucher, or take the offer |
 * | POST /shop/pick         | yes          | bearer | keep one of the 3 options of a bought pack     |
 * | POST /shop/reroll       | yes          | bearer | re-roll the Charms and packs                    |
 * | POST /shop/sell         | yes          | bearer | sell a held Charm for half its price            |
 * | POST /shrine/remove     | yes          | bearer | remove a Pledge from the deck                   |
 * | POST /pledges/play      | yes          | bearer | play a Pledge from the hand                     |
 * | GET /export             | yes          | bearer | every item under the player's USER# partition   |
 * | POST /delete            | yes          | bearer | delete the player's data (Requirement 13.2)     |
 * | GET /badge/{login}.svg  | no           | none   | the README badge, public, cached six hours      |
 *
 * Mutations take `{ "requestId": "<client uuid>", ... }`, answer `{ me, week }` and are idempotent per
 * request id (mutations.ts). A typed shop or Pledge error is a 409 with its code; bad input is a 400.
 * The two auth routes are browser navigations, which carry no `Origin` header the page controls, so they
 * are exempt from the Origin check (Requirement 12.3). Everything else must come from the Pages origin.
 * The same Lambda also receives the weekly EventBridge input `{"action":"rollover"}` (see `rollover.ts`).
 */
import { randomBytes } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { BADGE_CACHE_CONTROL, BADGE_CONTENT_TYPE, renderBadge } from '../badge';
import type { Config } from '../config';
import type { Db } from '../db';
import { authorizeUrl, SignInError, signInWithCode } from '../github';
import type { FetchLike } from '../github';
import { header, json, rawBody, redirect } from '../http';
import type { FunctionUrlEvent, FunctionUrlResult } from '../http';
import { signSessionToken, verifySessionToken } from '../jwt';
import { GITHUB_LOGIN } from '../keys';
import type { Logger } from '../log';
import { getRuntime } from '../runtime';
import { isRolloverEvent, runRollover } from '../rollover';
import type { RolloverEvent, RolloverResult } from '../rollover';
import { mutate } from '../mutations';
import type { MutationRequest } from '../mutations';
import { loadCurrent } from '../runs';
import type { RunContext } from '../runs';
import { randomSeed } from '../seed';
import type { Secrets } from '../secrets';
import type { InstallationsResponse, LogResponse, MutationResponse } from '../api-types';
import {
  decodeCursor,
  encodeCursor,
  toInstallationSummary,
  toLogEntry,
  toMeResponse,
  toWeekSummary,
} from '../views';

/** Combat Log rows per page. */
export const LOG_PAGE_SIZE = 20;

const STATE_FORMAT = /^[A-Za-z0-9_-]{20,128}$/;
const CODE_FORMAT = /^[A-Za-z0-9_-]{1,200}$/;
const BEARER = /^Bearer ([A-Za-z0-9._-]+)$/i;

/** A mutation body is a handful of short fields; anything larger is refused unread (413). */
export const MAX_REQUEST_BYTES = 4 * 1024;
const REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/;
const CONTENT_ID = /^[A-Za-z0-9_-]{1,64}$/;
const BUY_KINDS = ['charm', 'pack', 'voucher', 'legendary'] as const;

/**
 * The largest export body sent, gzipped when the client accepts it. A Function URL response is capped at
 * 6 MB, base64 included, so 4 MiB of payload leaves room for the encoding.
 */
export const MAX_EXPORT_BYTES = 4 * 1024 * 1024;

/** `GET /badge/{login}.svg`: the login is one path segment; anything else under /badge/ is a 404. */
const BADGE_PATH = /^\/badge\/([^/]+)\.svg$/;

type Route =
  | { kind: 'get'; handler: 'me' | 'week' | 'log' | 'installations' | 'export' }
  | { kind: 'post'; handler: 'buy' | 'pick' | 'reroll' | 'sell' | 'shrine' | 'play' | 'delete' };

type MutationHandler = Exclude<Extract<Route, { kind: 'post' }>['handler'], 'delete'>;

/** The sort-key prefix of each group of `USER#` items in the export; anything else goes to `other`. */
const EXPORT_GROUPS = [
  ['EVT#', 'events'],
  ['WEEK#', 'weeks'],
  ['FEAT#', 'feats'],
  ['EXPEDITION#', 'expeditions'],
  ['JOB#', 'jobs'],
] as const;

const ROUTES: Readonly<Record<string, Route>> = {
  '/me': { kind: 'get', handler: 'me' },
  '/week': { kind: 'get', handler: 'week' },
  '/log': { kind: 'get', handler: 'log' },
  '/installations': { kind: 'get', handler: 'installations' },
  '/shop/buy': { kind: 'post', handler: 'buy' },
  '/shop/pick': { kind: 'post', handler: 'pick' },
  '/shop/reroll': { kind: 'post', handler: 'reroll' },
  '/shop/sell': { kind: 'post', handler: 'sell' },
  '/shrine/remove': { kind: 'post', handler: 'shrine' },
  '/pledges/play': { kind: 'post', handler: 'play' },
  '/export': { kind: 'get', handler: 'export' },
  '/delete': { kind: 'post', handler: 'delete' },
};

/** The request id and the typed request in a mutation body, or null when the body is not valid. */
function parseMutation(
  handler: MutationHandler,
  body: Record<string, unknown>,
): { requestId: string; request: MutationRequest } | null {
  const requestId = body.requestId;
  if (typeof requestId !== 'string' || !REQUEST_ID.test(requestId)) {
    return null;
  }
  const index = body.index;
  const option = body.option;
  const text = (value: unknown): string | null =>
    typeof value === 'string' && CONTENT_ID.test(value) ? value : null;
  const whole = (value: unknown, min: number): number | null =>
    typeof value === 'number' && Number.isInteger(value) && value >= min && value <= 99
      ? value
      : null;
  switch (handler) {
    case 'buy': {
      const kind = BUY_KINDS.find((candidate) => candidate === body.kind);
      if (kind === undefined) {
        return null;
      }
      if (kind === 'voucher' || kind === 'legendary') {
        return { requestId, request: { type: 'buy', kind } };
      }
      const slot = whole(index, 0);
      return slot === null ? null : { requestId, request: { type: 'buy', kind, index: slot } };
    }
    case 'pick': {
      const slot = whole(index, -1);
      const chosen = whole(option, 0);
      return slot === null || chosen === null
        ? null
        : { requestId, request: { type: 'pick', index: slot, option: chosen } };
    }
    case 'reroll':
      return { requestId, request: { type: 'reroll' } };
    case 'sell': {
      const charmId = text(body.charmId);
      return charmId === null ? null : { requestId, request: { type: 'sell', charmId } };
    }
    case 'shrine':
    case 'play': {
      const pledgeId = text(body.pledgeId);
      return pledgeId === null
        ? null
        : { requestId, request: { type: handler === 'shrine' ? 'shrine' : 'play', pledgeId } };
    }
  }
}

export interface ApiDeps {
  db: Db;
  secrets: Secrets;
  config: Config;
  log: Logger;
  /** Epoch milliseconds. */
  now?: () => number;
  /** The HTTP client for GitHub calls (global `fetch` in production). */
  fetch?: FetchLike;
  /** Seeds for a run started by a player's first request of a week (a random uint32 in production). */
  newSeed?: () => number;
  /** A fresh unguessable token for the OAuth `state`. */
  nonce?: () => string;
}

export function createApiHandler(
  deps: ApiDeps,
): (event: FunctionUrlEvent) => Promise<FunctionUrlResult> {
  const { db, secrets, config, log } = deps;
  const now = deps.now ?? Date.now;
  const fetchFn: FetchLike = deps.fetch ?? ((input, init) => fetch(input, init));
  const nonce = deps.nonce ?? (() => randomBytes(32).toString('base64url'));
  const clientUrl = `${config.pagesOrigin}${config.clientBasePath}`;

  /** The browser is sent back to the client; the outcome is in the fragment so it never reaches a server. */
  const toClient = (fragment: string): FunctionUrlResult =>
    redirect(`${clientUrl}${fragment}`, { 'referrer-policy': 'no-referrer' });

  // ----- /auth/login -----

  async function login(): Promise<FunctionUrlResult> {
    try {
      const clientId = await secrets.get('github-oauth-client-id');
      const state = nonce();
      await db.putOAuthState(state, now());
      return redirect(authorizeUrl(clientId, state), { 'referrer-policy': 'no-referrer' });
    } catch (error) {
      log.error('api.login_failed', {}, error);
      return toClient('#error=server_error');
    }
  }

  // ----- /auth/callback -----

  async function callback(event: FunctionUrlEvent): Promise<FunctionUrlResult> {
    const params = event.queryStringParameters ?? {};
    try {
      // Requirement 2.1: the state is single use and expires after ten minutes.
      const state = params.state;
      if (!state || !STATE_FORMAT.test(state) || !(await db.consumeOAuthState(state, now()))) {
        return toClient('#error=invalid_state');
      }
      if (params.error) {
        // The user declined, or GitHub refused. The error text is never echoed.
        return toClient('#error=access_denied');
      }
      const code = params.code;
      if (!code || !CODE_FORMAT.test(code)) {
        return toClient('#error=invalid_request');
      }

      const [clientId, clientSecret] = await Promise.all([
        secrets.get('github-oauth-client-id'),
        secrets.get('github-oauth-client-secret'),
      ]);
      // The user token exists only inside this call (Requirement 2.2).
      const identity = await signInWithCode(fetchFn, { clientId, clientSecret, code });
      const profile = await db.upsertProfileOnLogin({
        id: identity.id,
        login: identity.login,
        installations: identity.installations,
        nowMs: now(),
      });
      const token = await signSessionToken(await secrets.get('jwt-key'), profile.id, now());
      return toClient(`#token=${token}`);
    } catch (error) {
      if (error instanceof SignInError) {
        return toClient(
          error.reason === 'unavailable' ? '#error=github_unavailable' : '#error=auth_failed',
        );
      }
      log.error('api.callback_failed', {}, error);
      return toClient('#error=server_error');
    }
  }

  // ----- authenticated routes -----

  async function authenticate(event: FunctionUrlEvent): Promise<number | null> {
    const match = BEARER.exec(header(event, 'authorization') ?? '');
    if (!match?.[1]) {
      return null;
    }
    const result = await verifySessionToken(await secrets.get('jwt-key'), match[1], now());
    return result.ok ? result.userId : null;
  }

  /** The player with this week's run, started on the spot if the rollover has not reached them. */
  function runContext(): RunContext {
    return { db, now: now(), newSeed: deps.newSeed ?? randomSeed };
  }

  async function me(userId: number): Promise<FunctionUrlResult> {
    const context = runContext();
    const current = await loadCurrent(context, userId);
    return current
      ? json(200, toMeResponse(current, context.now))
      : json(404, { error: 'no_profile' });
  }

  async function week(userId: number): Promise<FunctionUrlResult> {
    const context = runContext();
    const current = await loadCurrent(context, userId);
    return current
      ? json(200, toWeekSummary(current, context.now))
      : json(404, { error: 'no_profile' });
  }

  /** The JSON object in a request body, or the 413 / 400 answer to send instead. */
  function jsonBody(
    event: FunctionUrlEvent,
  ): { body: Record<string, unknown> } | { refusal: FunctionUrlResult } {
    const raw = rawBody(event, MAX_REQUEST_BYTES);
    if (raw === 'too_large') {
      return { refusal: json(413, { error: 'payload_too_large' }) };
    }
    let body: unknown;
    try {
      body = JSON.parse(raw.toString('utf8'));
    } catch {
      return { refusal: json(400, { error: 'invalid_json' }) };
    }
    return typeof body === 'object' && body !== null && !Array.isArray(body)
      ? { body: body as Record<string, unknown> }
      : { refusal: json(400, { error: 'invalid_request' }) };
  }

  async function mutation(
    userId: number,
    event: FunctionUrlEvent,
    handler: MutationHandler,
  ): Promise<FunctionUrlResult> {
    const read = jsonBody(event);
    if ('refusal' in read) {
      return read.refusal;
    }
    const parsed = parseMutation(handler, read.body);
    if (parsed === null) {
      return json(400, { error: 'invalid_request' });
    }
    const context = { ...runContext(), log };
    const outcome = await mutate(context, userId, parsed.requestId, parsed.request);
    if (outcome.status === 404) {
      return json(404, { error: 'no_profile' });
    }
    if (outcome.status === 409) {
      return json(409, { error: outcome.error });
    }
    const response: MutationResponse = {
      me: toMeResponse(outcome.current, context.now),
      week: toWeekSummary(outcome.current, context.now),
    };
    return json(200, response);
  }

  async function combatLog(userId: number, event: FunctionUrlEvent): Promise<FunctionUrlResult> {
    const cursor = event.queryStringParameters?.cursor;
    let beforeSk: string | undefined;
    if (cursor) {
      const rowId = decodeCursor(cursor);
      if (rowId === null) {
        return json(400, { error: 'invalid_cursor' });
      }
      beforeSk = `EVT#${rowId}`;
    }
    const { rows, nextSk } = await db.listEvents(userId, {
      limit: LOG_PAGE_SIZE,
      ...(beforeSk ? { beforeSk } : {}),
    });
    const body: LogResponse = {
      entries: rows.map(toLogEntry),
      nextCursor: nextSk ? encodeCursor(nextSk.slice('EVT#'.length)) : null,
    };
    return json(200, body);
  }

  async function installations(userId: number): Promise<FunctionUrlResult> {
    const profile = await db.getProfile(userId, true);
    if (!profile) {
      return json(404, { error: 'no_profile' });
    }
    const found = await Promise.all(
      profile.installations.map((id) => db.getInstallation(id, now())),
    );
    // An installation the webhook has not reported (or that was deleted) has nothing to show.
    const body: InstallationsResponse = {
      installations: found.flatMap((item) =>
        item && !item.deleted ? [toInstallationSummary(item)] : [],
      ),
    };
    return json(200, body);
  }

  // ----- badge (public) -----

  /**
   * The README badge: no auth and no Origin check, because an `<img>` in someone's README sends neither.
   * It reads GSI1 for level, Vocation and Renown and nothing else. An unknown or malformed login gets the
   * neutral "unranked" badge with the same caching (Requirement 11.3) and is never echoed.
   */
  async function badge(login: string): Promise<FunctionUrlResult> {
    const player = GITHUB_LOGIN.test(login) ? await db.findBadgeByLogin(login) : null;
    return {
      statusCode: 200,
      headers: {
        'content-type': BADGE_CONTENT_TYPE,
        'cache-control': BADGE_CACHE_CONTROL,
        'x-content-type-options': 'nosniff',
        'content-security-policy': "default-src 'none'; sandbox",
      },
      body: renderBadge(player, player ? { login: player.login } : {}),
    };
  }

  // ----- export and deletion (Requirement 13) -----

  /**
   * Every item under the player's `USER#` partition, raw attribute names, grouped by kind. Gzipped when the
   * client accepts it (browsers do), so a long history stays under the Function URL's 6 MB response cap.
   */
  async function exportData(userId: number, event: FunctionUrlEvent): Promise<FunctionUrlResult> {
    const items = await db.listUserItems(userId);
    const profile = items.find((item) => item.SK === 'PROFILE');
    if (!profile) {
      return json(404, { error: 'no_profile' });
    }
    const groups: Record<string, Record<string, unknown>[]> = {
      events: [],
      weeks: [],
      feats: [],
      expeditions: [],
      jobs: [],
    };
    const other: Record<string, unknown>[] = [];
    for (const item of items) {
      const sk = String(item.SK);
      const group = EXPORT_GROUPS.find(([prefix]) => sk.startsWith(prefix));
      if (group) {
        groups[group[1]]?.push(item);
      } else if (sk !== 'PROFILE') {
        other.push(item);
      }
    }
    const text = JSON.stringify({
      exportedAt: new Date(now()).toISOString(),
      profile,
      ...groups,
      // Only present if a kind of item was added without teaching the export about it.
      ...(other.length > 0 ? { other } : {}),
    });
    const login =
      typeof profile.login === 'string' && GITHUB_LOGIN.test(profile.login)
        ? profile.login
        : 'player';
    const headers = {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      'content-disposition': `attachment; filename="mergescape-${login}.json"`,
    };
    const compress = /\bgzip\b/i.test(header(event, 'accept-encoding') ?? '');
    const payload = compress ? gzipSync(text) : Buffer.from(text, 'utf8');
    if (payload.length > MAX_EXPORT_BYTES) {
      return json(413, { error: 'export_too_large' });
    }
    return compress
      ? {
          statusCode: 200,
          headers: { ...headers, 'content-encoding': 'gzip' },
          body: payload.toString('base64'),
          isBase64Encoded: true,
        }
      : { statusCode: 200, headers, body: text };
  }

  /**
   * `POST /delete { requestId, confirmLogin }`: 204 once everything is gone, 400 `confirm_mismatch` unless
   * `confirmLogin` equals the player's login (case-insensitive). A player with no profile has nothing left to
   * confirm against, so a repeat of a delete that succeeded answers 204 again (it also sweeps any item a
   * concurrent webhook wrote after the profile went, which a new character would otherwise inherit).
   */
  async function deleteAccount(
    userId: number,
    event: FunctionUrlEvent,
  ): Promise<FunctionUrlResult> {
    const read = jsonBody(event);
    if ('refusal' in read) {
      return read.refusal;
    }
    const { requestId, confirmLogin } = read.body;
    if (
      typeof requestId !== 'string' ||
      !REQUEST_ID.test(requestId) ||
      typeof confirmLogin !== 'string' ||
      confirmLogin.length > 100
    ) {
      return json(400, { error: 'invalid_request' });
    }
    const profile = await db.getProfile(userId, true);
    if (profile && confirmLogin.toLowerCase() !== profile.login.toLowerCase()) {
      return json(400, { error: 'confirm_mismatch' });
    }
    await db.deleteUser(userId);
    return { statusCode: 204, headers: { 'cache-control': 'no-store' }, body: '' };
  }

  // ----- router -----

  return async (event) => {
    const method = event.requestContext.http.method;
    const path = event.rawPath;
    try {
      if (method === 'GET' && path === '/auth/login') {
        return await login();
      }
      if (method === 'GET' && path === '/auth/callback') {
        return await callback(event);
      }

      // The badge is public: a README's <img> sends no Origin and no token (Requirement 11).
      if (path.startsWith('/badge/')) {
        if (method !== 'GET' && method !== 'HEAD') {
          return json(405, { error: 'method_not_allowed' }, { allow: 'GET, HEAD' });
        }
        const login = BADGE_PATH.exec(path)?.[1];
        return login ? await badge(login) : json(404, { error: 'not_found' });
      }

      // Everything below is the client's API: it must come from the Pages origin (Requirement 12.3).
      if (header(event, 'origin') !== config.pagesOrigin) {
        return json(403, { error: 'forbidden_origin' });
      }
      if (method === 'OPTIONS') {
        // Function URL CORS answers preflights itself; this is the fallback if one reaches the code.
        return { statusCode: 204, headers: { 'cache-control': 'no-store' }, body: '' };
      }
      const route = Object.hasOwn(ROUTES, path) ? ROUTES[path] : undefined;
      if (route === undefined) {
        return json(404, { error: 'not_found' });
      }
      const allowed = route.kind === 'get' ? 'GET' : 'POST';
      if (method !== allowed) {
        return json(405, { error: 'method_not_allowed' }, { allow: allowed });
      }
      const userId = await authenticate(event);
      if (userId === null) {
        return json(401, { error: 'unauthorized' }, { 'www-authenticate': 'Bearer' });
      }
      if (route.kind === 'post') {
        return route.handler === 'delete'
          ? await deleteAccount(userId, event)
          : await mutation(userId, event, route.handler);
      }
      switch (route.handler) {
        case 'me':
          return await me(userId);
        case 'week':
          return await week(userId);
        case 'log':
          return await combatLog(userId, event);
        case 'installations':
          return await installations(userId);
        case 'export':
          return await exportData(userId, event);
      }
    } catch (error) {
      log.error('api.failed', {}, error);
      return json(500, { error: 'internal_error' });
    }
  };
}

let defaultHandler: ((event: FunctionUrlEvent) => Promise<FunctionUrlResult>) | undefined;

/** Lambda entry point (`api.handler` in the SAM template): HTTP requests and the weekly schedule. */
export const handler = (
  event: FunctionUrlEvent | RolloverEvent,
): Promise<FunctionUrlResult | RolloverResult> => {
  if (isRolloverEvent(event)) {
    const runtime = getRuntime();
    return runRollover({
      db: runtime.db,
      log: runtime.log,
      now: Date.now,
      newSeed: randomSeed,
    });
  }
  if (!defaultHandler) {
    const runtime = getRuntime();
    defaultHandler = createApiHandler({
      db: runtime.db,
      secrets: runtime.secrets,
      config: runtime.config,
      log: runtime.log,
    });
  }
  return defaultHandler(event);
};
