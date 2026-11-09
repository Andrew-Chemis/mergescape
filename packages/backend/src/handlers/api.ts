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
 *
 * The two auth routes are browser navigations, which carry no `Origin` header the page controls, so they
 * are exempt from the Origin check (Requirement 12.3). Everything else must come from the Pages origin.
 * The same Lambda also receives the weekly EventBridge input `{"action":"rollover"}` (see `rollover.ts`).
 */
import { randomBytes } from 'node:crypto';
import type { Config } from '../config';
import type { Db } from '../db';
import { authorizeUrl, SignInError, signInWithCode } from '../github';
import type { FetchLike } from '../github';
import { header, json, redirect } from '../http';
import type { FunctionUrlEvent, FunctionUrlResult } from '../http';
import { signSessionToken, verifySessionToken } from '../jwt';
import type { Logger } from '../log';
import { getRuntime } from '../runtime';
import { isRolloverEvent, runRollover } from '../rollover';
import type { RolloverEvent, RolloverResult } from '../rollover';
import { loadCurrent } from '../runs';
import type { RunContext } from '../runs';
import { randomSeed } from '../seed';
import type { Secrets } from '../secrets';
import type { InstallationsResponse, LogResponse } from '../api-types';
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

type Route = { kind: 'get'; handler: 'me' | 'week' | 'log' | 'installations' };

const ROUTES: Readonly<Record<string, Route>> = {
  '/me': { kind: 'get', handler: 'me' },
  '/week': { kind: 'get', handler: 'week' },
  '/log': { kind: 'get', handler: 'log' },
  '/installations': { kind: 'get', handler: 'installations' },
};

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
      if (method !== 'GET') {
        return json(405, { error: 'method_not_allowed' }, { allow: 'GET' });
      }
      const userId = await authenticate(event);
      if (userId === null) {
        return json(401, { error: 'unauthorized' }, { 'www-authenticate': 'Bearer' });
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
