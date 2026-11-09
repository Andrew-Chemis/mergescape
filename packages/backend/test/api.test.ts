import { emptySkillXp } from '@mergescape/shared';
import { jwtVerify } from 'jose';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApiHandler, LOG_PAGE_SIZE } from '../src/handlers/api';
import { isRolloverEvent } from '../src/rollover';
import type { FunctionUrlResult } from '../src/http';
import { JWT_AUDIENCE, JWT_ISSUER, JWT_TTL_SECONDS } from '../src/jwt';
import { OAUTH_STATE_TTL_SECONDS } from '../src/db';
import type { EventRow } from '../src/db';
import {
  apiRequest,
  CONFIG,
  forgeToken,
  fragmentOf,
  GITHUB_USER_TOKEN,
  jsonResponse,
  JWT_KEY,
  makeApiHarness,
  OAUTH_CLIENT_ID,
  OAUTH_CLIENT_SECRET,
  PAGES_ORIGIN,
  stateOf,
} from './api-harness';
import type { ApiHarness } from './api-harness';
import { START } from './harness';
import { auditSchema } from './support';

function body(result: FunctionUrlResult): Record<string, unknown> {
  return JSON.parse(result.body ?? '{}') as Record<string, unknown>;
}

function location(result: FunctionUrlResult): string {
  return String(result.headers?.location ?? '');
}

/** Run the login redirect and return the state it issued. */
async function startLogin(h: ApiHarness): Promise<string> {
  const result = await h.handler(apiRequest({ path: '/auth/login', origin: null }));
  expect(result.statusCode).toBe(302);
  return stateOf(location(result));
}

async function signIn(h: ApiHarness, code = 'abc123') {
  const state = await startLogin(h);
  return h.handler(apiRequest({ path: '/auth/callback', origin: null, query: { code, state } }));
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------------------------
// OAuth: login and callback (Requirements 2.1, 2.2, 2.4)
// ---------------------------------------------------------------------------------------------

describe('GET /auth/login', () => {
  it('redirects to GitHub with the client id and a fresh state, and stores the state for ten minutes', async () => {
    const h = makeApiHarness();
    const result = await h.handler(apiRequest({ path: '/auth/login', origin: null }));
    expect(result.statusCode).toBe(302);
    const target = new URL(location(result));
    expect(`${target.origin}${target.pathname}`).toBe('https://github.com/login/oauth/authorize');
    expect(target.searchParams.get('client_id')).toBe(OAUTH_CLIENT_ID);
    const state = target.searchParams.get('state') ?? '';
    expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(h.fake.peek(`STATE#${state}`, 'META')).toEqual({
      PK: `STATE#${state}`,
      SK: 'META',
      ttl: START / 1000 + OAUTH_STATE_TTL_SECONDS,
    });
    expect(result.headers?.['cache-control']).toBe('no-store');
    // No secret leaves in the redirect.
    expect(location(result)).not.toContain(OAUTH_CLIENT_SECRET);
  });

  it('issues a different state each time', async () => {
    const h = makeApiHarness();
    const states = new Set([await startLogin(h), await startLogin(h), await startLogin(h)]);
    expect(states.size).toBe(3);
  });

  it('sends the browser back to the client with an error when the table is unavailable', async () => {
    const h = makeApiHarness();
    vi.spyOn(h.fake, 'send').mockRejectedValue(Object.assign(new Error('x'), { name: 'Boom' }));
    const result = await h.handler(apiRequest({ path: '/auth/login', origin: null }));
    expect(location(result)).toBe(`${PAGES_ORIGIN}/#error=server_error`);
    expect(h.logs).toEqual([JSON.stringify({ event: 'api.login_failed', error: 'Boom' })]);
  });
});

describe('GET /auth/callback', () => {
  it('exchanges the code, upserts the profile and redirects to the client with a JWT in the fragment', async () => {
    const h = makeApiHarness();
    const result = await signIn(h);
    expect(result.statusCode).toBe(302);
    const target = new URL(location(result));
    expect(target.origin).toBe(PAGES_ORIGIN);
    expect(target.pathname).toBe('/');
    expect(target.search).toBe('');
    const token = new URLSearchParams(target.hash.slice(1)).get('token') ?? '';
    expect(token).toMatch(/^[\w-]+\.[\w-]+\.[\w-]+$/);

    const { payload, protectedHeader } = await jwtVerify(token, new TextEncoder().encode(JWT_KEY), {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
      currentDate: new Date(START),
    });
    expect(protectedHeader.alg).toBe('HS256');
    expect(payload.sub).toBe('1001001');
    expect(typeof payload.sub).toBe('string');
    expect((payload.exp ?? 0) - (payload.iat ?? 0)).toBe(JWT_TTL_SECONDS);
    expect(JWT_TTL_SECONDS).toBe(7 * 24 * 60 * 60);

    // Requirement 2.4: the accessible installation ids were refreshed.
    const profile = await h.db.getProfile(1001001, true);
    expect(profile).toMatchObject({ login: 'Octo-Cat', installations: [777001, 777002], xp: 0 });
    expect(result.headers?.['referrer-policy']).toBe('no-referrer');
  });

  it('writes no GitHub token anywhere: not in the table, not in the logs', async () => {
    const h = makeApiHarness();
    const consoleSpies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => {}),
    );
    const result = await signIn(h);
    expect(result.statusCode).toBe(302);

    // The mocked exchange really did hand out the token, and it was used only as a bearer.
    const exchange = h.github.calls.find((call) => call.url.endsWith('/access_token'));
    expect(exchange).toBeDefined();
    const userCalls = h.github.calls.filter((call) =>
      call.url.startsWith('https://api.github.com/'),
    );
    expect(userCalls.map((call) => call.url)).toEqual([
      'https://api.github.com/user',
      'https://api.github.com/user/installations?per_page=100&page=1',
    ]);
    for (const call of userCalls) {
      expect(call.headers.authorization).toBe(`Bearer ${GITHUB_USER_TOKEN}`);
      expect(call.body).toBeUndefined();
    }
    // The client secret goes only to the token endpoint.
    expect(exchange?.body).toContain(OAUTH_CLIENT_SECRET);
    for (const call of userCalls) {
      expect(JSON.stringify(call)).not.toContain(OAUTH_CLIENT_SECRET);
    }

    const everythingWritten = JSON.stringify([
      h.fake.snapshot(),
      h.fake.calls,
      h.logs,
      location(result),
    ]);
    expect(everythingWritten).not.toContain(GITHUB_USER_TOKEN);
    expect(everythingWritten).not.toContain('THIS_TOKEN_MUST_NEVER');
    expect(everythingWritten).not.toContain(OAUTH_CLIENT_SECRET);
    for (const spy of consoleSpies) {
      expect(JSON.stringify(spy.mock.calls)).not.toContain(GITHUB_USER_TOKEN);
    }
    // What remains in the table is the profile alone: the state was consumed.
    expect(h.fake.snapshot().map((item) => item.PK)).toEqual(['USER#1001001']);
    auditSchema(h.fake);
  });

  it('keeps the game state of a returning player and replaces the installation list', async () => {
    const h = makeApiHarness({
      installations: () => jsonResponse({ total_count: 1, installations: [{ id: 5 }] }),
    });
    await h.db.upsertProfileOnLogin({
      id: 1001001,
      login: 'old-name',
      installations: [777001],
      nowMs: START - 1000,
    });
    await h.db.applyScore(1001001, 0, {
      xp: 900,
      skillXp: { ...emptySkillXp(), smithing: 900 },
      gold: 9,
      level: 2,
      counters: {},
    });
    await signIn(h);
    expect(await h.db.getProfile(1001001, true)).toMatchObject({
      login: 'Octo-Cat',
      installations: [5],
      xp: 900,
      gold: 9,
      level: 2,
    });
  });

  it('accepts a state once: the second use is rejected without calling GitHub', async () => {
    const h = makeApiHarness();
    const state = await startLogin(h);
    const request = apiRequest({
      path: '/auth/callback',
      origin: null,
      query: { code: 'abc', state },
    });
    expect(fragmentOf(location(await h.handler(request)))).toMatch(/^#token=/);
    const callsAfterFirst = h.github.calls.length;
    const replay = await h.handler(request);
    expect(fragmentOf(location(replay))).toBe('#error=invalid_state');
    expect(h.github.calls).toHaveLength(callsAfterFirst);
  });

  it('rejects a state after ten minutes, and does not let a late callback sign in', async () => {
    const h = makeApiHarness();
    const state = await startLogin(h);
    h.clock.now += OAUTH_STATE_TTL_SECONDS * 1000;
    const result = await h.handler(
      apiRequest({ path: '/auth/callback', origin: null, query: { code: 'abc', state } }),
    );
    expect(fragmentOf(location(result))).toBe('#error=invalid_state');
    expect(h.github.calls).toHaveLength(0);
    expect(await h.db.getProfile(1001001)).toBeNull();
  });

  it('accepts a state just inside the ten minutes', async () => {
    const h = makeApiHarness();
    const state = await startLogin(h);
    h.clock.now += OAUTH_STATE_TTL_SECONDS * 1000 - 1000;
    const result = await h.handler(
      apiRequest({ path: '/auth/callback', origin: null, query: { code: 'abc', state } }),
    );
    expect(fragmentOf(location(result))).toMatch(/^#token=/);
  });

  it('rejects an unknown, missing or malformed state', async () => {
    const h = makeApiHarness();
    for (const query of [
      { code: 'abc', state: 'A'.repeat(43) },
      { code: 'abc' },
      { code: 'abc', state: 'short' },
      { code: 'abc', state: '../../etc/passwd' + 'x'.repeat(20) },
    ] as Record<string, string>[]) {
      const result = await h.handler(apiRequest({ path: '/auth/callback', origin: null, query }));
      expect(fragmentOf(location(result))).toBe('#error=invalid_state');
    }
    expect(h.github.calls).toHaveLength(0);
  });

  it('reports a declined authorization and a missing code without echoing GitHub text', async () => {
    const h = makeApiHarness();
    const declined = await h.handler(
      apiRequest({
        path: '/auth/callback',
        origin: null,
        query: {
          error: 'access_denied',
          error_description: '<script>alert(1)</script>',
          state: await startLogin(h),
        },
      }),
    );
    expect(location(declined)).toBe(`${PAGES_ORIGIN}/#error=access_denied`);
    const noCode = await h.handler(
      apiRequest({ path: '/auth/callback', origin: null, query: { state: await startLogin(h) } }),
    );
    expect(fragmentOf(location(noCode))).toBe('#error=invalid_request');
    const badCode = await h.handler(
      apiRequest({
        path: '/auth/callback',
        origin: null,
        query: { code: 'a b&c', state: await startLogin(h) },
      }),
    );
    expect(fragmentOf(location(badCode))).toBe('#error=invalid_request');
    expect(h.github.calls).toHaveLength(0);
  });

  it('creates no profile when GitHub rejects the code', async () => {
    const h = makeApiHarness({
      exchange: () => jsonResponse({ error: 'bad_verification_code' }),
    });
    const result = await signIn(h);
    expect(fragmentOf(location(result))).toBe('#error=auth_failed');
    expect(h.fake.snapshot()).toEqual([]);
  });

  it('distinguishes GitHub being unreachable from a refusal', async () => {
    const down = makeApiHarness({ user: () => new Response('bad gateway', { status: 502 }) });
    expect(fragmentOf(location(await signIn(down)))).toBe('#error=github_unavailable');
    expect(down.fake.snapshot()).toEqual([]);

    const throwing = makeApiHarness({
      installations: () => {
        throw new Error('network down');
      },
    });
    expect(fragmentOf(location(await signIn(throwing)))).toBe('#error=github_unavailable');
    expect(await throwing.db.getProfile(1001001)).toBeNull();
  });

  it('refuses a bot or organization account', async () => {
    for (const type of ['Bot', 'Organization']) {
      const h = makeApiHarness({
        user: () => jsonResponse({ id: 1001001, login: 'someone', type }),
      });
      expect(fragmentOf(location(await signIn(h)))).toBe('#error=auth_failed');
      expect(h.fake.snapshot()).toEqual([]);
    }
  });

  it('refuses a malformed user object', async () => {
    for (const user of [
      { id: 'x', login: 'a', type: 'User' },
      { id: 5, login: 'a b', type: 'User' },
      [],
    ]) {
      const h = makeApiHarness({ user: () => jsonResponse(user) });
      expect(fragmentOf(location(await signIn(h)))).toBe('#error=auth_failed');
    }
  });

  it('redirects under the client base path when one is configured', async () => {
    const h = makeApiHarness();
    const handlerWithBase = createApiHandler({
      db: h.db,
      secrets: { get: () => Promise.resolve(JWT_KEY) },
      config: { ...CONFIG, clientBasePath: '/mergescape/' },
      log: { error() {} },
      now: () => h.clock.now,
    });
    const result = await handlerWithBase(
      apiRequest({ path: '/auth/callback', origin: null, query: { state: 'x'.repeat(30) } }),
    );
    expect(location(result)).toBe(`${PAGES_ORIGIN}/mergescape/#error=invalid_state`);
  });

  it('collects a missing page of installations across pages', async () => {
    let page = 0;
    const full = Array.from({ length: 100 }, (_, index) => ({ id: index + 1 }));
    const h = makeApiHarness({
      installations: () => {
        page += 1;
        return jsonResponse({
          installations: page === 1 ? full : [{ id: 101 }, { id: 5 }],
        });
      },
    });
    await signIn(h);
    const profile = await h.db.getProfile(1001001, true);
    expect(profile?.installations).toHaveLength(101);
    expect(h.github.calls.filter((call) => call.url.includes('/user/installations'))).toHaveLength(
      2,
    );
  });
});

// ---------------------------------------------------------------------------------------------
// Session verification (Requirement 2.3)
// ---------------------------------------------------------------------------------------------

describe('bearer authentication', () => {
  async function me(h: ApiHarness, token: string | null, headers: Record<string, string> = {}) {
    return h.handler(apiRequest({ path: '/me', token, headers }));
  }

  it('accepts a good token', async () => {
    const h = makeApiHarness();
    await signIn(h);
    expect((await me(h, await h.token())).statusCode).toBe(200);
  });

  it('rejects a missing, malformed or non-Bearer Authorization header', async () => {
    const h = makeApiHarness();
    await signIn(h);
    expect((await me(h, null)).statusCode).toBe(401);
    expect((await me(h, null, { authorization: 'Basic abc' })).statusCode).toBe(401);
    expect((await me(h, null, { authorization: 'Bearer' })).statusCode).toBe(401);
    expect((await me(h, 'not.a.jwt')).statusCode).toBe(401);
    expect((await me(h, 'x')).statusCode).toBe(401);
    const unauthorized = await me(h, null);
    expect(body(unauthorized)).toEqual({ error: 'unauthorized' });
    expect(unauthorized.headers?.['www-authenticate']).toBe('Bearer');
  });

  it('rejects a bad signature', async () => {
    const h = makeApiHarness();
    await signIn(h);
    const forged = await forgeToken({}, 'a-completely-different-key-0123456789abcdef');
    expect((await me(h, forged)).statusCode).toBe(401);
    // Flipping one character of a valid signature also fails.
    const good = await h.token();
    const tampered = `${good.slice(0, -2)}${good.endsWith('AA') ? 'BB' : 'AA'}`;
    expect((await me(h, tampered)).statusCode).toBe(401);
  });

  it('rejects the wrong audience and the wrong issuer', async () => {
    const h = makeApiHarness();
    await signIn(h);
    expect((await me(h, await forgeToken({ aud: 'someone-else' }))).statusCode).toBe(401);
    expect((await me(h, await forgeToken({ iss: 'someone-else' }))).statusCode).toBe(401);
    expect((await me(h, await forgeToken({}))).statusCode).toBe(200);
  });

  it('rejects an expired token, and accepts one a second before expiry', async () => {
    const h = makeApiHarness();
    await signIn(h);
    const token = await h.token();
    h.clock.now = START + JWT_TTL_SECONDS * 1000 - 1000;
    expect((await me(h, token)).statusCode).toBe(200);
    h.clock.now = START + JWT_TTL_SECONDS * 1000 + 1000;
    expect((await me(h, token)).statusCode).toBe(401);
  });

  it('rejects other algorithms and a non-numeric subject', async () => {
    const h = makeApiHarness();
    await signIn(h);
    expect((await me(h, await forgeToken({ alg: 'HS512' }))).statusCode).toBe(401);
    expect((await me(h, await forgeToken({ sub: 'octocat' }))).statusCode).toBe(401);
    expect((await me(h, await forgeToken({ sub: '0' }))).statusCode).toBe(401);
    // An unsigned "alg: none" token.
    const header = Buffer.from('{"alg":"none"}').toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({
        sub: '1001001',
        iss: JWT_ISSUER,
        aud: JWT_AUDIENCE,
        exp: 9_999_999_999,
        iat: 1,
      }),
    ).toString('base64url');
    expect((await me(h, `${header}.${payload}.`)).statusCode).toBe(401);
  });

  it('follows a rotated key: old tokens stop working, new ones start', async () => {
    const h = makeApiHarness();
    await signIn(h);
    let key = JWT_KEY;
    const rotating = createApiHandler({
      db: h.db,
      secrets: { get: () => Promise.resolve(key) },
      config: CONFIG,
      log: { error() {} },
      now: () => h.clock.now,
    });
    const call = async (token: string) =>
      (await rotating(apiRequest({ path: '/me', token }))).statusCode;
    const oldToken = await forgeToken({}, JWT_KEY);
    expect(await call(oldToken)).toBe(200);
    key = 'rotated-jwt-key-0123456789abcdef0123456789abcdef';
    expect(await call(oldToken)).toBe(401);
    expect(await call(await forgeToken({}, key))).toBe(200);
  });

  it('refuses to run with a key shorter than 32 bytes instead of accepting weak tokens', async () => {
    const h = makeApiHarness();
    await signIn(h);
    const weak = createApiHandler({
      db: h.db,
      secrets: { get: () => Promise.resolve('short') },
      config: CONFIG,
      log: { error() {} },
      now: () => h.clock.now,
    });
    const result = await weak(apiRequest({ path: '/me', token: await h.token() }));
    expect(result.statusCode).toBe(500);
  });
});

// ---------------------------------------------------------------------------------------------
// Origin check (Requirement 12.3)
// ---------------------------------------------------------------------------------------------

describe('Origin check', () => {
  const routes = ['/me', '/log', '/installations'];

  it('answers 403 to a wrong or missing Origin on every client route, before looking at the token', async () => {
    const h = makeApiHarness();
    await signIn(h);
    const token = await h.token();
    for (const path of routes) {
      for (const origin of [
        'https://evil.example',
        'http://octo.github.io',
        'https://octo.github.io.evil.example',
        `${PAGES_ORIGIN}/`,
        'https://OCTO.github.io',
        null,
      ]) {
        const withToken = await h.handler(apiRequest({ path, origin, token }));
        expect(withToken.statusCode, `${path} ${String(origin)}`).toBe(403);
        const withoutToken = await h.handler(apiRequest({ path, origin }));
        expect(withoutToken.statusCode).toBe(403);
        expect(body(withoutToken)).toEqual({ error: 'forbidden_origin' });
      }
    }
  });

  it('lets the Pages origin through', async () => {
    const h = makeApiHarness();
    await signIn(h);
    const token = await h.token();
    for (const path of routes) {
      expect((await h.handler(apiRequest({ path, token }))).statusCode).toBe(200);
    }
  });

  it('exempts only the two auth redirects', async () => {
    const h = makeApiHarness();
    expect((await h.handler(apiRequest({ path: '/auth/login', origin: null }))).statusCode).toBe(
      302,
    );
    expect(
      (await h.handler(apiRequest({ path: '/auth/login', origin: 'https://evil.example' })))
        .statusCode,
    ).toBe(302);
    const callback = await h.handler(apiRequest({ path: '/auth/callback', origin: null }));
    expect(callback.statusCode).toBe(302);
    // Other methods on those paths are client API calls and need the Origin.
    expect(
      (await h.handler(apiRequest({ method: 'POST', path: '/auth/login', origin: null })))
        .statusCode,
    ).toBe(403);
  });

  it('answers a preflight that reaches the code only for the Pages origin', async () => {
    const h = makeApiHarness();
    expect((await h.handler(apiRequest({ method: 'OPTIONS', path: '/me' }))).statusCode).toBe(204);
    expect(
      (
        await h.handler(
          apiRequest({ method: 'OPTIONS', path: '/me', origin: 'https://evil.example' }),
        )
      ).statusCode,
    ).toBe(403);
  });

  it('answers 404 for unknown paths and 405 for the wrong method, for the right origin only', async () => {
    const h = makeApiHarness();
    expect((await h.handler(apiRequest({ path: '/nope' }))).statusCode).toBe(404);
    expect(
      (await h.handler(apiRequest({ path: '/nope', origin: 'https://evil.example' }))).statusCode,
    ).toBe(403);
    const post = await h.handler(
      apiRequest({ method: 'POST', path: '/me', token: await h.token() }),
    );
    expect(post.statusCode).toBe(405);
    expect(post.headers?.allow).toBe('GET');
  });
});

// ---------------------------------------------------------------------------------------------
// GET /me, /log, /installations
// ---------------------------------------------------------------------------------------------

describe('GET /me', () => {
  it('returns the profile in the shape the client expects', async () => {
    const h = makeApiHarness();
    await signIn(h);
    await h.db.applyScore(1001001, 0, {
      xp: 793,
      skillXp: { smithing: 733, vigilance: 0, oratory: 0, endurance: 60 },
      gold: 26,
      level: 2,
      counters: {},
    });
    const result = await h.handler(apiRequest({ path: '/me', token: await h.token() }));
    expect(result.statusCode).toBe(200);
    expect(result.headers?.['content-type']).toBe('application/json');
    const me = body(result);
    expect(me).toEqual({
      githubId: 1001001,
      login: 'Octo-Cat',
      createdAt: new Date(START).toISOString(),
      xp: 793,
      skillXp: { smithing: 733, vigilance: 0, oratory: 0, endurance: 60 },
      gold: 26,
      renown: 0,
      // Starting the run recomputes the Vocation: 733 of 793 XP is Smithing.
      vocation: 'Smith',
      charms: [],
      charmSlots: 5,
      vouchers: [],
      deck: [
        { id: 'strike', name: 'Strike', upgraded: false },
        { id: 'defend', name: 'Defend', upgraded: false },
        { id: 'big-game-hunter', name: 'Big Game Hunter', upgraded: false },
        { id: 'mentor', name: 'Mentor', upgraded: false },
        { id: 'tidy', name: 'Tidy', upgraded: false },
      ],
      biome: 'Town',
      kills: {},
      firstSeen: {},
      // The first request of the week starts the run on the spot (a new player has no rollover yet).
      week: expect.objectContaining({
        weekKey: '2026-W46',
        act: 'scout',
        clearedActs: [],
        weeklyXp: 0,
        targets: { scout: 1200, raid: 2000, boss: 3000 },
        mogul: 'two-pizza-boss',
        nextMogul: null,
        played: [],
        pledgeWindowOpen: true,
        pledgeProgress: {},
        shop: null,
        freePack: null,
        freePackOptions: null,
        legendaryOffer: null,
      }),
      // The depth layer (docs/api-contract.md): a new character carries nothing and has not gone anywhere.
      satchel: {
        ore: 0,
        timber: 0,
        lore: 0,
        ink: 0,
        provisions: 0,
        flux: 0,
        silver: 0,
        mithril: 0,
        rune: 0,
        dragon: 0,
      },
      inventory: [],
      gear: { equipped: {}, setBonus: 0, capeColor: null },
      pets: ['linter-cat'],
      charmPacks: [],
      forge: { upgrades: [], stations: {} },
      titles: [],
      pinnedFeats: [],
      expedition: null,
      tzOffsetMinutes: null,
    });
    expect((me.week as { hand: unknown[] }).hand).toHaveLength(5);
  });

  it('answers 404 for a valid token whose profile is gone', async () => {
    const h = makeApiHarness();
    const result = await h.handler(apiRequest({ path: '/me', token: await h.token(42) }));
    expect(result.statusCode).toBe(404);
  });
});

describe('GET /log', () => {
  function row(index: number, overrides: Partial<EventRow> = {}): EventRow {
    return {
      userId: 1001001,
      ts: new Date(START + index * 60_000).toISOString(),
      deliveryId: `d-${index}`,
      kind: 'pr_merged',
      repoId: 424242,
      repoPrivate: true,
      prNumber: index,
      points: 100,
      power: 1,
      zone: 3.03,
      level: 1,
      xp: 303,
      skill: 'smithing',
      skillXp: { ...emptySkillXp(), smithing: 303 },
      supplies: { ore: 1, timber: 1, lore: 0, ink: 0, provisions: 0, flux: 0 },
      monster: 'merge-goblin',
      breakdown: [{ label: 'PR merged', value: 90, kind: 'points' }],
      additions: 10,
      deletions: 2,
      ...overrides,
    };
  }

  it('pages newest first with an opaque cursor', async () => {
    const h = makeApiHarness();
    await signIn(h);
    for (let index = 0; index < LOG_PAGE_SIZE + 5; index += 1) {
      await h.db.putEvent(row(index));
    }
    await h.db.putEvent(row(99, { userId: 42 }));
    const token = await h.token();

    const first = body(await h.handler(apiRequest({ path: '/log', token })));
    const entries = first.entries as { id: string; prNumber: number }[];
    expect(entries).toHaveLength(LOG_PAGE_SIZE);
    expect(entries[0]?.prNumber).toBe(LOG_PAGE_SIZE + 4);
    expect(typeof first.nextCursor).toBe('string');
    expect(first.nextCursor).not.toContain('EVT');

    const second = body(
      await h.handler(
        apiRequest({ path: '/log', token, query: { cursor: String(first.nextCursor) } }),
      ),
    );
    const rest = second.entries as { prNumber: number }[];
    expect(rest.map((entry) => entry.prNumber)).toEqual([4, 3, 2, 1, 0]);
    expect(second.nextCursor).toBeNull();
    // Nobody else's rows, and no repeats across pages.
    const ids = [...entries, ...(second.entries as typeof entries)].map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.some((id) => id.includes('d-99'))).toBe(false);
  });

  it('shapes a row as the client reads it', async () => {
    const h = makeApiHarness();
    await signIn(h);
    await h.db.putEvent(
      row(1, { kind: 'review_submitted', reviewState: 'APPROVED', inlineComments: 3 }),
    );
    const result = body(await h.handler(apiRequest({ path: '/log', token: await h.token() })));
    expect((result.entries as unknown[])[0]).toEqual({
      id: `${new Date(START + 60_000).toISOString()}#d-1`,
      at: new Date(START + 60_000).toISOString(),
      kind: 'review_submitted',
      reviewState: 'APPROVED',
      prNumber: 1,
      repoId: 424242,
      repoPrivate: true,
      additions: 10,
      deletions: 2,
      inlineComments: 3,
      monster: 'merge-goblin',
      points: 100,
      power: 1,
      zone: 3.03,
      level: 1,
      xp: 303,
      skill: 'smithing',
      skillXp: { smithing: 303, vigilance: 0, oratory: 0, endurance: 0 },
      supplies: { ore: 1, timber: 1, lore: 0, ink: 0, provisions: 0, flux: 0 },
      breakdown: [{ label: 'PR merged', value: 90, kind: 'points' }],
    });
    expect(JSON.stringify(result)).not.toContain('"ttl"');
  });

  it('returns an empty first page for a new player', async () => {
    const h = makeApiHarness();
    await signIn(h);
    const result = body(await h.handler(apiRequest({ path: '/log', token: await h.token() })));
    expect(result).toEqual({ entries: [], nextCursor: null });
  });

  it('rejects a cursor this service did not issue', async () => {
    const h = makeApiHarness();
    await signIn(h);
    const token = await h.token();
    for (const cursor of [
      '!!!',
      'a'.repeat(400),
      Buffer.from('USER#42').toString('base64url'),
      Buffer.from('EVT#x').toString('base64url'),
    ]) {
      const result = await h.handler(apiRequest({ path: '/log', token, query: { cursor } }));
      expect(result.statusCode, cursor.slice(0, 20)).toBe(400);
    }
  });
});

describe('GET /installations', () => {
  it('lists the installations the player can see, from the webhook-maintained items', async () => {
    const h = makeApiHarness();
    await signIn(h); // profile lists 777001 and 777002
    await h.db.upsertInstallation({
      id: 777001,
      accountId: 5005005,
      repoIds: [1, 2, 3],
      suspended: false,
    });
    await h.db.upsertInstallation({ id: 777002, accountId: 6006006, repoIds: [], suspended: true });
    await h.db.upsertInstallation({ id: 999, accountId: 1, repoIds: [1], suspended: false });
    const result = body(
      await h.handler(apiRequest({ path: '/installations', token: await h.token() })),
    );
    expect(result).toEqual({
      installations: [
        { installationId: 777001, accountId: 5005005, repoCount: 3, suspended: false },
        { installationId: 777002, accountId: 6006006, repoCount: 0, suspended: true },
      ],
    });
  });

  it('leaves out installations no webhook has reported and deleted ones', async () => {
    const h = makeApiHarness();
    await signIn(h);
    await h.db.upsertInstallation({
      id: 777001,
      accountId: 5005005,
      repoIds: [1],
      suspended: false,
    });
    await h.db.upsertInstallation({
      id: 777002,
      accountId: 6006006,
      repoIds: [1],
      suspended: false,
    });
    await h.db.removeInstallation(777002, START);
    h.clock.now += 1000;
    const result = body(
      await h.handler(apiRequest({ path: '/installations', token: await h.token() })),
    );
    expect((result.installations as unknown[]).length).toBe(1);
  });

  it('answers 404 without a profile', async () => {
    const h = makeApiHarness();
    const result = await h.handler(
      apiRequest({ path: '/installations', token: await h.token(42) }),
    );
    expect(result.statusCode).toBe(404);
  });
});

// ---------------------------------------------------------------------------------------------
// Failures, and the scheduled rollover input
// ---------------------------------------------------------------------------------------------

describe('failures', () => {
  it('answers 500 and logs only the error name when the table fails', async () => {
    const h = makeApiHarness();
    await signIn(h);
    const token = await h.token();
    vi.spyOn(h.fake, 'send').mockRejectedValue(
      Object.assign(new Error('secret table detail'), {
        name: 'ProvisionedThroughputExceededException',
      }),
    );
    const result = await h.handler(apiRequest({ path: '/me', token }));
    expect(result.statusCode).toBe(500);
    expect(body(result)).toEqual({ error: 'internal_error' });
    expect(h.logs).toEqual([
      JSON.stringify({ event: 'api.failed', error: 'ProvisionedThroughputExceededException' }),
    ]);
    expect(JSON.stringify(result)).not.toContain('secret table detail');
  });
});

describe('the Lambda entry point', () => {
  it('recognises the weekly EventBridge input and nothing that came over HTTP', async () => {
    expect(isRolloverEvent({ action: 'rollover' })).toBe(true);
    expect(isRolloverEvent({ action: 'other' })).toBe(false);
    expect(isRolloverEvent(null)).toBe(false);
    const h = makeApiHarness();
    expect(isRolloverEvent(apiRequest({ path: '/rollover', token: await h.token() }))).toBe(false);
    expect(isRolloverEvent({ ...apiRequest({ path: '/x' }), action: 'rollover' })).toBe(false);
  });

  it('does not treat an HTTP request that mentions rollover as the schedule', async () => {
    const h = makeApiHarness();
    const forged = {
      ...apiRequest({ method: 'POST', path: '/rollover', token: await h.token() }),
      action: 'rollover',
    };
    const result = await h.handler(forged);
    expect(result.statusCode).toBe(404);
    expect(h.fake.calls).toHaveLength(0);
  });
});
