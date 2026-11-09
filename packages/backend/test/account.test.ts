/**
 * Task 18 end to end: the public badge, the JSON export and the delete-everything endpoint, over the same
 * in-memory table the other game tests use. The api Lambda runs under its IAM role, so the fake refuses any
 * DynamoDB call the role lacks.
 */
import { BatchWriteCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import type { MeResponse } from '../src/api-types';
import { BADGE_CACHE_CONTROL, BADGE_CONTENT_TYPE } from '../src/badge';
import { Db } from '../src/db';
import type { DocClient } from '../src/db';
import { MAX_EXPORT_BYTES } from '../src/handlers/api';
import type { FunctionUrlEvent, FunctionUrlResult } from '../src/http';
import { apiRequest, fragmentOf, stateOf } from './api-harness';
import { FakeDynamo } from './fake-dynamo';
import type { FakeOperation } from './fake-dynamo';
import { API_ROLE, DAY, makeGame, playLife } from './game-harness';
import type { Game } from './game-harness';
import { START } from './harness';
import { auditSchema, itemsWithPrefix, makeDb, TABLE_NAME } from './support';
import { AUTHOR_ID, fixtureDelivery, MERGER_ID, REPO_ID, REVIEWER_ID } from './webhooks';

/** Realistic logins: none of them contains a GitHub id, so a test can look for ids in a badge. */
const AUTHOR_LOGIN = 'octo-cat';
const LOGINS: Record<number, string> = {
  [AUTHOR_ID]: AUTHOR_LOGIN,
  [REVIEWER_ID]: 'rev-iewer',
  [MERGER_ID]: 'mer-ger',
};

type Input = Record<string, unknown>;

/** Retarget a recorded fixture at PR `number`. */
function renumber(number: number) {
  return (payload: Record<string, unknown>): void => {
    if (typeof payload.number === 'number') {
      payload.number = number;
    }
    (payload.pull_request as Record<string, unknown>).number = number;
  };
}

/** The author opens PR `number` and merges it themselves: nobody else appears on it. */
async function playSolo(game: Game, number: number): Promise<void> {
  for (const fixture of ['pull_request.opened', 'pull_request.closed.merged-by-author']) {
    const result = await game.deliver(fixtureDelivery(fixture, renumber(number)));
    expect(result.statusCode).toBe(200);
  }
}

/** Two signed-in players with one shared PR (17) and one PR (18) only the author is on. */
async function populated(): Promise<Game> {
  const game = makeGame();
  for (const id of [AUTHOR_ID, REVIEWER_ID, MERGER_ID]) {
    await game.signIn(id, undefined, LOGINS[id]);
  }
  await playLife(game, 17);
  await playSolo(game, 18);
  // A run and a week exist for everyone who has played.
  for (const id of [AUTHOR_ID, REVIEWER_ID, MERGER_ID]) {
    expect((await game.get('/me', id)).status).toBe(200);
  }
  return game;
}

function request(game: Game, options: Parameters<typeof apiRequest>[0]) {
  return game.api(apiRequest(options));
}

async function authed(
  game: Game,
  path: string,
  options: Partial<Parameters<typeof apiRequest>[0]> = {},
  userId = AUTHOR_ID,
): Promise<FunctionUrlResult> {
  return request(game, { path, token: await game.token(userId), ...options });
}

async function remove(
  game: Game,
  body: unknown,
  options: { userId?: number; raw?: boolean } = {},
): Promise<FunctionUrlResult> {
  const event: FunctionUrlEvent = {
    ...apiRequest({
      method: 'POST',
      path: '/delete',
      token: await game.token(options.userId ?? AUTHOR_ID),
    }),
    body: options.raw ? String(body) : JSON.stringify(body),
  };
  return game.api(event);
}

const DELETE_ID = 'delete-00000001';

function json(result: FunctionUrlResult): Record<string, unknown> {
  return JSON.parse(result.body ?? '{}') as Record<string, unknown>;
}

function keysOf(items: readonly Record<string, unknown>[]): string[] {
  return items.map((item) => `${String(item.PK)} | ${String(item.SK)}`).sort();
}

function text(svg: string): string[] {
  return [...svg.matchAll(/<(?:title|text)[^>]*>([^<]*)<\/(?:title|text)>/g)].map(
    (match) => match[1] ?? '',
  );
}

// ---------------------------------------------------------------------------------------------
// GET /badge/{login}.svg (Requirement 11)
// ---------------------------------------------------------------------------------------------

describe('GET /badge/{login}.svg', () => {
  it('is public: no token and no Origin, SVG with the six-hour cache header', async () => {
    const game = await populated();
    const result = await request(game, { path: `/badge/${AUTHOR_LOGIN}.svg`, origin: null });
    expect(result.statusCode).toBe(200);
    expect(result.headers).toMatchObject({
      'content-type': 'image/svg+xml; charset=utf-8',
      'cache-control': 'public, max-age=21600',
      'x-content-type-options': 'nosniff',
    });
    expect(result.headers?.['content-type']).toBe(BADGE_CONTENT_TYPE);
    expect(result.headers?.['cache-control']).toBe(BADGE_CACHE_CONTROL);
    expect(result.isBase64Encoded).toBeUndefined();
    expect(result.body?.startsWith('<svg ')).toBe(true);
  });

  it("shows the player's level, Vocation and Renown, read through GSI1 only", async () => {
    const game = await populated();
    const profile = await game.db.getProfile(AUTHOR_ID, true);
    expect(profile?.level).toBeGreaterThan(1);
    const before = game.fake.calls.length;
    const result = await request(game, { path: `/badge/${AUTHOR_LOGIN}.svg`, origin: null });
    const value = `Lv ${profile?.level ?? 0} ${profile?.vocation ?? ''} &#183; Renown ${profile?.renown ?? 0}`;
    expect(text(result.body ?? '')).toEqual([
      `mergescape: ${value} (${AUTHOR_LOGIN})`,
      'mergescape',
      'mergescape',
      value,
      value,
    ]);
    const calls = game.fake.calls.slice(before);
    expect(calls.map((call) => call.operation)).toEqual(['Query']);
    expect(calls[0]?.input).toMatchObject({
      IndexName: 'GSI1',
      ExpressionAttributeValues: { ':pk': `LOGIN#${AUTHOR_LOGIN}` },
    });
  });

  it('finds the player whatever the case of the login in the URL', async () => {
    const game = await populated();
    const lower = await request(game, { path: `/badge/${AUTHOR_LOGIN}.svg`, origin: null });
    const upper = await request(game, {
      path: `/badge/${AUTHOR_LOGIN.toUpperCase()}.svg`,
      origin: null,
    });
    expect(upper.body).toBe(lower.body);
    expect(lower.body).not.toContain('unranked');
  });

  it('serves the neutral unranked badge, with the same caching, for a login nobody has used', async () => {
    const game = await populated();
    const result = await request(game, { path: '/badge/nobody-here.svg', origin: null });
    expect(result.statusCode).toBe(200);
    expect(result.headers?.['cache-control']).toBe('public, max-age=21600');
    expect(result.headers?.['content-type']).toBe('image/svg+xml; charset=utf-8');
    expect(text(result.body ?? '')).toEqual([
      'mergescape: unranked',
      'mergescape',
      'mergescape',
      'unranked',
      'unranked',
    ]);
    // Nothing about the request is echoed.
    expect(result.body).not.toContain('nobody');
  });

  it('answers a malformed login with the unranked badge, never echoes it, and does not touch the table', async () => {
    const game = await populated();
    const before = game.fake.calls.length;
    const logins = [
      '%3Cscript%3Ealert(1)%3C%2Fscript%3E',
      'a_b',
      '-leading',
      'x'.repeat(40),
      '..%2F..%2Fetc',
      '%22%3E%3Csvg%2Fonload%3Dalert(1)%3E',
      '%F0%9F%98%80',
    ];
    for (const login of logins) {
      const result = await request(game, { path: `/badge/${login}.svg`, origin: null });
      expect(result.statusCode).toBe(200);
      expect(text(result.body ?? '')[0]).toBe('mergescape: unranked');
      expect(result.body).not.toMatch(/script|onload|etc|xxxx/);
    }
    expect(game.fake.calls.length).toBe(before);
  });

  it('never includes a repository, a PR, an event, a GitHub id or an installation', async () => {
    const game = await populated();
    // The profile and its Combat Log hold all of these.
    const stored = JSON.stringify(
      itemsWithPrefix(game.fake, `USER#${AUTHOR_ID}`),
      (_, value: unknown) => (value instanceof Set ? [...value] : value),
    );
    for (const secret of [String(REPO_ID), String(AUTHOR_ID), '777001', 'pr_merged', 'kills']) {
      expect(stored).toContain(secret);
    }
    for (const id of [AUTHOR_ID, REVIEWER_ID, MERGER_ID]) {
      const login = LOGINS[id] ?? '';
      const svg = (await request(game, { path: `/badge/${login}.svg`, origin: null })).body ?? '';
      for (const secret of [
        String(REPO_ID),
        String(AUTHOR_ID),
        String(REVIEWER_ID),
        '777001',
        'pr_',
        'review',
        'merge',
        'kill',
        'xp',
        'gold',
        'charm',
        'deck',
        'week',
        'github',
      ]) {
        expect(svg.toLowerCase().replaceAll('mergescape', '')).not.toContain(secret);
      }
      // The only words are the label, the stats and the login in the accessible name.
      const words = text(svg);
      expect(words).toHaveLength(5);
      expect(words[0]).toMatch(/^mergescape: Lv \d+ \w+ &#183; Renown \d+ \([a-z-]+\)$/);
    }
  });

  it('only accepts GET and HEAD, and every other /badge path is a 404', async () => {
    const game = await populated();
    for (const method of ['GET', 'HEAD']) {
      const result = await request(game, {
        method,
        path: `/badge/${AUTHOR_LOGIN}.svg`,
        origin: null,
      });
      expect(result.statusCode).toBe(200);
    }
    const post = await request(game, {
      method: 'POST',
      path: `/badge/${AUTHOR_LOGIN}.svg`,
      origin: null,
    });
    expect(post.statusCode).toBe(405);
    expect(post.headers?.allow).toBe('GET, HEAD');
    for (const path of ['/badge/', '/badge/x', '/badge/x.png', '/badge/a/b.svg', '/badge/.svg']) {
      const result = await request(game, { path, origin: null });
      expect(result.statusCode).toBe(404);
      expect(result.headers?.['cache-control']).toBe('no-store');
    }
  });

  it('is not cached when the table fails, and logs only the error name', async () => {
    const game = await populated();
    game.intercept.api = () => {
      throw Object.assign(new Error('secret table detail'), { name: 'Boom' });
    };
    const result = await request(game, { path: `/badge/${AUTHOR_LOGIN}.svg`, origin: null });
    expect(result.statusCode).toBe(500);
    expect(result.headers?.['cache-control']).toBe('no-store');
    expect(game.logs).toEqual([JSON.stringify({ event: 'api.failed', error: 'Boom' })]);
  });

  it('prefers the newest account when a renamed login is on two profiles', async () => {
    const game = makeGame();
    await game.signIn(1001, [], 'old-name');
    await game.signIn(2002, [], 'Old-Name');
    // Same lower-cased login, different players: the higher GitHub id wins (a string sort would pick 1001's).
    await game.db.saveProfile(2002, 0, { renown: 9 });
    const result = await request(game, { path: '/badge/old-name.svg', origin: null });
    expect(text(result.body ?? '')[0]).toContain('Renown 9 (Old-Name)');
  });

  it('after a delete, the login is unranked again', async () => {
    const game = await populated();
    const url = `/badge/${AUTHOR_LOGIN}.svg`;
    expect((await request(game, { path: url, origin: null })).body).not.toContain('unranked');
    expect(
      (await remove(game, { requestId: DELETE_ID, confirmLogin: AUTHOR_LOGIN })).statusCode,
    ).toBe(204);
    expect((await request(game, { path: url, origin: null })).body).toContain('unranked');
  });
});

// ---------------------------------------------------------------------------------------------
// GET /export (Requirement 13.1)
// ---------------------------------------------------------------------------------------------

describe('GET /export', () => {
  it('needs a token and the Pages origin, and a profile to export', async () => {
    const game = await populated();
    expect((await request(game, { path: '/export', token: null })).statusCode).toBe(401);
    expect((await authed(game, '/export', { origin: 'https://evil.example' })).statusCode).toBe(
      403,
    );
    expect((await authed(game, '/export', { origin: null })).statusCode).toBe(403);
    const stranger = await authed(game, '/export', {}, 4004004);
    expect(stranger.statusCode).toBe(404);
    expect(json(stranger)).toEqual({ error: 'no_profile' });
    expect(
      (await request(game, { method: 'POST', path: '/export', token: await game.token() }))
        .statusCode,
    ).toBe(405);
  });

  it('returns every item under the USER# partition, grouped, with raw attribute names', async () => {
    const game = await populated();
    const result = await authed(game, '/export');
    expect(result.statusCode).toBe(200);
    expect(result.headers).toMatchObject({
      'content-type': 'application/json',
      'cache-control': 'no-store',
      'content-disposition': `attachment; filename="mergescape-${AUTHOR_LOGIN}.json"`,
    });
    const body = json(result) as Record<
      string,
      Record<string, unknown>[] | Record<string, unknown>
    >;
    expect(Object.keys(body)).toEqual([
      'exportedAt',
      'profile',
      'events',
      'weeks',
      'feats',
      'expeditions',
      'jobs',
    ]);
    expect(body.exportedAt).toBe(new Date(game.clock.now).toISOString());

    const profile = body.profile as Record<string, unknown>;
    expect(profile).toMatchObject({
      PK: `USER#${AUTHOR_ID}`,
      SK: 'PROFILE',
      login: AUTHOR_LOGIN,
      GSI1PK: `LOGIN#${AUTHOR_LOGIN}`,
      installations: [777001],
    });
    expect(typeof profile.xp_smithing).toBe('number');

    const stored = itemsWithPrefix(game.fake, `USER#${AUTHOR_ID}`);
    // The profile, four Combat Log rows, the week, the onboarding expedition and the Feat the author's
    // second merge in the same minute unlocked.
    expect(stored.length).toBe(8);
    const exported = [
      body.profile as Record<string, unknown>,
      ...(body.events as Record<string, unknown>[]),
      ...(body.weeks as Record<string, unknown>[]),
      ...(body.feats as Record<string, unknown>[]),
      ...(body.expeditions as Record<string, unknown>[]),
      ...(body.jobs as Record<string, unknown>[]),
    ];
    expect(keysOf(exported)).toEqual(keysOf(stored));
    expect((body.events as unknown[]).length).toBeGreaterThanOrEqual(4);
    expect((body.weeks as unknown[]).length).toBe(1);
    expect((body.expeditions as unknown[]).length).toBe(1);
    expect((body.feats as { SK: string }[]).map((feat) => feat.SK)).toEqual([
      'FEAT#merge-conflict',
    ]);
    // Nobody else's data and no shared PR records.
    for (const item of exported) {
      expect(String(item.PK)).toBe(`USER#${AUTHOR_ID}`);
    }
    // Each item is exactly what is stored, with sets turned into arrays.
    for (const item of stored) {
      const match = exported.find((candidate) => candidate.SK === item.SK);
      expect(match).toEqual(
        JSON.parse(JSON.stringify(item, (_, v: unknown) => (v instanceof Set ? [...v] : v))),
      );
    }
  });

  it('events come in Combat Log order and pages of the query are all read', async () => {
    const game = await populated();
    const whole = json(await authed(game, '/export')) as { events: { SK: string }[] };
    const before = game.fake.calls.length;
    // Two rows per Query page, so the export has to follow LastEvaluatedKey.
    game.intercept.api = (input) => {
      (input as Input).Limit = 2;
    };
    const paged = json(await authed(game, '/export')) as { events: { SK: string }[] };
    game.intercept.api = undefined;
    expect(paged.events.map((event) => event.SK)).toEqual(whole.events.map((event) => event.SK));
    expect(paged.events.map((event) => event.SK)).toEqual(
      [...paged.events.map((event) => event.SK)].sort(),
    );
    const queries = game.fake.calls.slice(before).filter((call) => call.operation === 'Query');
    expect(queries.length).toBe(4); // eight items, two to a page
  });

  it('gzips the body for a client that accepts it, and the bytes decode to the same document', async () => {
    const game = await populated();
    const plain = await authed(game, '/export');
    const zipped = await authed(game, '/export', { headers: { 'accept-encoding': 'br, gzip' } });
    expect(plain.headers?.['content-encoding']).toBeUndefined();
    expect(zipped.headers?.['content-encoding']).toBe('gzip');
    expect(zipped.isBase64Encoded).toBe(true);
    expect(zipped.headers?.['content-disposition']).toBe(plain.headers?.['content-disposition']);
    const decoded = gunzipSync(Buffer.from(zipped.body ?? '', 'base64')).toString('utf8');
    expect(decoded).toBe(plain.body);
  });

  it('refuses, rather than failing inside Lambda, an export too large for a Function URL response', async () => {
    const game = await populated();
    // 5 rows of about 1 MB each: over the cap uncompressed, a few KB gzipped.
    for (let index = 0; index < 5; index += 1) {
      await game.db.putEvent({
        userId: AUTHOR_ID,
        ts: new Date(START + index * 1000).toISOString(),
        deliveryId: `big-${index}`,
        kind: 'pr_opened',
        points: 1,
        power: 1,
        zone: 1,
        level: 1,
        xp: 1,
        skill: 'smithing',
        skillXp: { smithing: 1, vigilance: 0, oratory: 0, endurance: 0 },
        supplies: { ore: 0, timber: 0, lore: 0, ink: 0, provisions: 0, flux: 0 },
        monster: null,
        breakdown: [{ label: 'x'.repeat(1_000_000), value: 1, kind: 'points' }],
      });
    }
    const refused = await authed(game, '/export');
    expect(refused.statusCode).toBe(413);
    expect(json(refused)).toEqual({ error: 'export_too_large' });
    const zipped = await authed(game, '/export', { headers: { 'accept-encoding': 'gzip' } });
    expect(zipped.statusCode).toBe(200);
    expect(zipped.body?.length).toBeLessThan(MAX_EXPORT_BYTES);
  });

  it('puts an item of a kind it does not know in `other`, so nothing is ever left out', async () => {
    const game = await populated();
    await game.fake.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: { PK: `USER#${AUTHOR_ID}`, SK: 'SOMETHING#new', note: 1 },
      }),
    );
    const body = json(await authed(game, '/export')) as { other: { SK: string }[] };
    expect(body.other.map((item) => item.SK)).toEqual(['SOMETHING#new']);
  });
});

// ---------------------------------------------------------------------------------------------
// POST /delete (Requirement 13.2)
// ---------------------------------------------------------------------------------------------

describe('POST /delete', () => {
  it('needs a token and the Pages origin', async () => {
    const game = await populated();
    const noToken = await game.api({
      ...apiRequest({ method: 'POST', path: '/delete' }),
      body: JSON.stringify({ requestId: DELETE_ID, confirmLogin: AUTHOR_LOGIN }),
    });
    expect(noToken.statusCode).toBe(401);
    const wrongOrigin = await game.api({
      ...apiRequest({
        method: 'POST',
        path: '/delete',
        token: await game.token(),
        origin: 'https://evil.example',
      }),
      body: JSON.stringify({ requestId: DELETE_ID, confirmLogin: AUTHOR_LOGIN }),
    });
    expect(wrongOrigin.statusCode).toBe(403);
    expect((await authed(game, '/delete')).statusCode).toBe(405);
    expect(itemsWithPrefix(game.fake, `USER#${AUTHOR_ID}`).length).toBeGreaterThan(5);
  });

  it('refuses a malformed request and deletes nothing', async () => {
    const game = await populated();
    const before = JSON.stringify(game.fake.snapshot());
    const bad: [unknown, number, string][] = [
      ['not json', 400, 'invalid_json'],
      ['[1]', 400, 'invalid_request'],
      [{ confirmLogin: AUTHOR_LOGIN }, 400, 'invalid_request'],
      [{ requestId: 'short', confirmLogin: AUTHOR_LOGIN }, 400, 'invalid_request'],
      [{ requestId: DELETE_ID }, 400, 'invalid_request'],
      [{ requestId: DELETE_ID, confirmLogin: 42 }, 400, 'invalid_request'],
      [{ requestId: DELETE_ID, confirmLogin: 'x'.repeat(101) }, 400, 'invalid_request'],
      // A body that looks like a Lambda result is only ever data.
      [{ statusCode: 204, body: '', requestId: DELETE_ID }, 400, 'invalid_request'],
    ];
    for (const [body, status, error] of bad) {
      const result = await remove(game, body, { raw: typeof body === 'string' });
      expect(result.statusCode).toBe(status);
      expect(json(result)).toEqual({ error });
    }
    const huge = await remove(
      game,
      JSON.stringify({ requestId: DELETE_ID, pad: 'x'.repeat(5000) }),
      {
        raw: true,
      },
    );
    expect(huge.statusCode).toBe(413);
    expect(JSON.stringify(game.fake.snapshot())).toBe(before);
  });

  it('answers 400 confirm_mismatch unless the login matches, and deletes nothing', async () => {
    const game = await populated();
    const before = JSON.stringify(game.fake.snapshot());
    for (const confirmLogin of [
      '',
      'someone-else',
      `${AUTHOR_LOGIN} `,
      ` ${AUTHOR_LOGIN}`,
      'player',
      REVIEWER_ID.toString(),
    ]) {
      const result = await remove(game, { requestId: DELETE_ID, confirmLogin });
      expect(result.statusCode).toBe(400);
      expect(json(result)).toEqual({ error: 'confirm_mismatch' });
    }
    expect(JSON.stringify(game.fake.snapshot())).toBe(before);
  });

  it('deletes every USER# item and only the PR# records the player is alone on, with 204', async () => {
    const game = await populated();
    expect(itemsWithPrefix(game.fake, `PR#${REPO_ID}#18`).length).toBeGreaterThanOrEqual(1);
    const shared = keysOf(itemsWithPrefix(game.fake, `PR#${REPO_ID}#17`));
    expect(shared.length).toBe(3); // META, the approval, the inline comment
    const others = keysOf(
      game.fake
        .snapshot()
        .filter(
          (item) =>
            !String(item.PK).startsWith(`USER#${AUTHOR_ID}`) && item.PK !== `PR#${REPO_ID}#18`,
        ),
    );
    const reviewerBefore = JSON.stringify(itemsWithPrefix(game.fake, `USER#${REVIEWER_ID}`));

    // The login is matched without regard to case.
    const result = await remove(game, {
      requestId: DELETE_ID,
      confirmLogin: AUTHOR_LOGIN.toUpperCase(),
    });
    expect(result.statusCode).toBe(204);
    expect(result.body).toBe('');
    expect(result.headers?.['cache-control']).toBe('no-store');

    expect(itemsWithPrefix(game.fake, `USER#${AUTHOR_ID}`)).toEqual([]);
    // PR 18 had one actor, the author; PR 17 also has a reviewer and a merger, so it stays.
    expect(itemsWithPrefix(game.fake, `PR#${REPO_ID}#18`)).toEqual([]);
    expect(keysOf(itemsWithPrefix(game.fake, `PR#${REPO_ID}#17`))).toEqual(shared);
    // Everyone else's items, shared records, installations and delivery guards are untouched.
    const remaining = keysOf(game.fake.snapshot());
    expect(remaining).toEqual(expect.arrayContaining(others));
    expect(remaining).toHaveLength(others.length);
    expect(JSON.stringify(itemsWithPrefix(game.fake, `USER#${REVIEWER_ID}`))).toBe(reviewerBefore);
    // The Requirement 3.5 audit: what is left is recognised, allowed data.
    auditSchema(game.fake);
  });

  it('uses only operations the api role grants, in batches of at most 25', async () => {
    const game = await populated();
    for (let index = 0; index < 70; index += 1) {
      await game.db.putEvent({
        userId: AUTHOR_ID,
        ts: new Date(START + (index + 1) * 60_000).toISOString(),
        deliveryId: `bulk-${index}`,
        kind: 'pr_opened',
        repoId: REPO_ID,
        prNumber: 1000 + index,
        points: 1,
        power: 1,
        zone: 1,
        level: 1,
        xp: 1,
        skill: 'smithing',
        skillXp: { smithing: 1, vigilance: 0, oratory: 0, endurance: 0 },
        supplies: { ore: 0, timber: 0, lore: 0, ink: 0, provisions: 0, flux: 0 },
        monster: null,
        breakdown: [],
      });
    }
    const total = itemsWithPrefix(game.fake, `USER#${AUTHOR_ID}`).length;
    expect(total).toBeGreaterThan(75);
    const before = game.fake.calls.length;
    expect(
      (await remove(game, { requestId: DELETE_ID, confirmLogin: AUTHOR_LOGIN })).statusCode,
    ).toBe(204);

    const calls = game.fake.calls.slice(before);
    const allowed: readonly FakeOperation[] = ['GetItem', 'Query', 'BatchWriteItem'];
    expect(
      calls.every((call) => allowed.includes(call.operation) && API_ROLE.includes(call.operation)),
    ).toBe(true);
    const batches = calls
      .filter((call) => call.operation === 'BatchWriteItem')
      .map((call) => (call.input.RequestItems as Record<string, unknown[]>)[TABLE_NAME] ?? []);
    expect(batches.length).toBeGreaterThanOrEqual(Math.ceil(total / 25));
    for (const batch of batches) {
      expect(batch.length).toBeGreaterThan(0);
      expect(batch.length).toBeLessThanOrEqual(25);
    }
    expect(itemsWithPrefix(game.fake, `USER#${AUTHOR_ID}`)).toEqual([]);
    // The ids are not a prefix of one another: player 1001001's partition is not 10010011's.
    expect(itemsWithPrefix(game.fake, `USER#${REVIEWER_ID}`).length).toBeGreaterThan(0);
  });

  it('is idempotent: the same delete again, or a new request id, answers 204', async () => {
    const game = await populated();
    expect(
      (await remove(game, { requestId: DELETE_ID, confirmLogin: AUTHOR_LOGIN })).statusCode,
    ).toBe(204);
    expect(
      (await remove(game, { requestId: DELETE_ID, confirmLogin: AUTHOR_LOGIN })).statusCode,
    ).toBe(204);
    expect(
      (await remove(game, { requestId: 'delete-00000002', confirmLogin: 'whatever' })).statusCode,
    ).toBe(204);
    // The reviewer is not affected by any of it.
    expect((await game.get('/me', REVIEWER_ID)).status).toBe(200);
  });

  it('is repeatable after a failure part-way: the profile goes last, so the login can still be confirmed', async () => {
    const game = await populated();
    let writes = 0;
    game.intercept.api = (input) => {
      if ((input as Input).RequestItems !== undefined) {
        writes += 1;
        if (writes === 2) {
          throw Object.assign(new Error('throttled'), {
            name: 'ProvisionedThroughputExceededException',
          });
        }
      }
    };
    const failed = await remove(game, { requestId: DELETE_ID, confirmLogin: AUTHOR_LOGIN });
    game.intercept.api = undefined;
    expect(failed.statusCode).toBe(500);
    expect(json(failed)).toEqual({ error: 'internal_error' });
    expect(game.logs).toEqual([
      JSON.stringify({ event: 'api.failed', error: 'ProvisionedThroughputExceededException' }),
    ]);
    // The first batch (the solo PR) went; the profile did not, so the player can still sign in and retry.
    expect(game.fake.peek(`USER#${AUTHOR_ID}`, 'PROFILE')).toBeDefined();
    expect(
      (await remove(game, { requestId: DELETE_ID, confirmLogin: AUTHOR_LOGIN })).statusCode,
    ).toBe(204);
    expect(itemsWithPrefix(game.fake, `USER#${AUTHOR_ID}`)).toEqual([]);
    expect(itemsWithPrefix(game.fake, `PR#${REPO_ID}#18`)).toEqual([]);
    auditSchema(game.fake);
  });

  it('sweeps anything a webhook wrote after the read, so a new character cannot inherit it', async () => {
    const game = await populated();
    const late = {
      PK: `USER#${AUTHOR_ID}`,
      SK: `EVT#${new Date(START + DAY).toISOString()}#late`,
      ts: new Date(START + DAY).toISOString(),
      delivery_id: 'late',
      kind: 'pr_opened',
      points: 1,
      power: 1,
      zone: 1,
      level: 1,
      xp: 1,
      skill: 'smithing',
    };
    let injected = false;
    game.intercept.api = async (input) => {
      const requests = (input as Input).RequestItems as
        Record<string, { DeleteRequest: { Key: { SK: string } } }[]> | undefined;
      if (
        !injected &&
        requests?.[TABLE_NAME]?.some((request) => request.DeleteRequest.Key.SK === 'PROFILE')
      ) {
        injected = true;
        await game.fake.send(new PutCommand({ TableName: TABLE_NAME, Item: late }));
      }
    };
    expect(
      (await remove(game, { requestId: DELETE_ID, confirmLogin: AUTHOR_LOGIN })).statusCode,
    ).toBe(204);
    expect(injected).toBe(true);
    expect(itemsWithPrefix(game.fake, `USER#${AUTHOR_ID}`)).toEqual([]);
  });

  it('after a delete the old token finds no profile, and the next login starts a fresh level-1 character', async () => {
    const game = await populated();
    const old = (await game.get('/me')).body as unknown as MeResponse;
    expect(old.xp).toBeGreaterThan(0);
    expect(old.kills).not.toEqual({});
    const oldLog = (await game.get('/log')).body as { entries: unknown[] };
    expect(oldLog.entries.length).toBeGreaterThan(0);

    expect(
      (await remove(game, { requestId: DELETE_ID, confirmLogin: AUTHOR_LOGIN })).statusCode,
    ).toBe(204);
    expect((await game.get('/me')).status).toBe(404);
    expect((await game.get('/me')).body).toEqual({ error: 'no_profile' });
    expect((await game.get('/export')).status).toBe(404);

    // Webhooks from the deleted player are dropped as unlinked until they sign in again.
    const dropped = await game.deliver(fixtureDelivery('pull_request.opened', renumber(30)));
    expect(dropped.statusCode).toBe(200);
    expect(itemsWithPrefix(game.fake, `USER#${AUTHOR_ID}`)).toEqual([]);

    // Sign in again through the OAuth flow (the scripted GitHub answers as Octo-Cat, id 1001001).
    game.clock.now += 3 * DAY;
    const login = await game.api(apiRequest({ path: '/auth/login', origin: null }));
    const state = stateOf(String(login.headers?.location));
    const callback = await game.api(
      apiRequest({ path: '/auth/callback', origin: null, query: { code: 'abc123', state } }),
    );
    expect(callback.statusCode).toBe(302);
    const token = new URLSearchParams(fragmentOf(String(callback.headers?.location)).slice(1)).get(
      'token',
    );
    expect(token).toMatch(/^[\w-]+\.[\w-]+\.[\w-]+$/);

    const profile = await game.db.getProfile(AUTHOR_ID, true);
    expect(profile).toMatchObject({
      login: 'Octo-Cat',
      created: new Date(game.clock.now).toISOString(),
      xp: 0,
      level: 1,
      gold: 0,
      renown: 0,
      charms: [],
      kills: {},
      firstSeen: {},
      history: [],
      version: 0,
    });
    const fresh = (await game.get('/me')).body as unknown as MeResponse;
    expect(fresh).toMatchObject({ login: 'Octo-Cat', xp: 0, renown: 0, kills: {} });
    expect(fresh.createdAt).not.toBe(old.createdAt);
    expect(((await game.get('/log')).body as { entries: unknown[] }).entries).toEqual([]);
    // The badge is for the new account now.
    const badge = await request(game, { path: '/badge/octo-cat.svg', origin: null });
    expect(badge.body).toContain('Lv 1 Journeyman &#183; Renown 0');
    auditSchema(game.fake);
  });
});

// ---------------------------------------------------------------------------------------------
// Which PR records are the player's alone (Requirement 13.2), on the repository directly
// ---------------------------------------------------------------------------------------------

describe('Db#deleteUser: PR records', () => {
  const ME = 41;

  async function put(fake: FakeDynamo, item: Record<string, unknown>): Promise<void> {
    await fake.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
  }

  /** The player's Combat Log rows for PRs 1..n of repository 7, so the delete knows where to look. */
  async function logRows(fake: FakeDynamo, numbers: number[]): Promise<void> {
    await put(fake, { PK: `USER#${ME}`, SK: 'PROFILE', login: 'me' });
    for (const number of numbers) {
      await put(fake, {
        PK: `USER#${ME}`,
        SK: `EVT#2026-11-09T12:00:0${number}Z#d${number}`,
        repo_id: 7,
        pr_number: number,
      });
    }
  }

  const meta = (number: number, author: number, mergedBy?: number) => ({
    PK: `PR#7#${number}`,
    SK: 'META',
    author_id: author,
    ...(mergedBy === undefined ? {} : { merged_by_id: mergedBy }),
  });
  const review = (number: number, reviewer: number, id: string) => ({
    PK: `PR#7#${number}`,
    SK: `REVIEW#2026-11-09T12:00:00Z#${reviewer}#${id}`,
    reviewer_id: reviewer,
  });
  const inline = (number: number, reviewer: number, id: string) => ({
    PK: `PR#7#${number}`,
    SK: `INLINE#${reviewer}#${id}`,
    reviewer_id: reviewer,
  });

  it('removes a PR only the player appears on, as author, merger, reviewer and inline commenter', async () => {
    const { fake, db } = makeDb();
    await logRows(fake, [1]);
    await put(fake, meta(1, ME, ME));
    await put(fake, review(1, ME, 'r1'));
    await put(fake, inline(1, ME, 'i1'));
    const report = await db.deleteUser(ME);
    expect(report).toEqual({ userItems: 2, prItems: 3 });
    expect(fake.size).toBe(0);
  });

  it('keeps a PR that has another author, merger, reviewer or inline commenter', async () => {
    const { fake, db } = makeDb();
    await logRows(fake, [1, 2, 3, 4]);
    await put(fake, meta(1, 99)); // somebody else wrote it
    await put(fake, review(1, ME, 'r1'));
    await put(fake, meta(2, ME, 99)); // somebody else merged it
    await put(fake, meta(3, ME));
    await put(fake, review(3, 99, 'r3')); // somebody else reviewed it
    await put(fake, meta(4, ME));
    await put(fake, inline(4, 99, 'i4')); // somebody else commented inline
    const report = await db.deleteUser(ME);
    expect(report.prItems).toBe(0);
    expect(keysOf(fake.snapshot())).toEqual(
      [
        'PR#7#1 | META',
        'PR#7#1 | REVIEW#2026-11-09T12:00:00Z#41#r1',
        'PR#7#2 | META',
        'PR#7#3 | META',
        'PR#7#3 | REVIEW#2026-11-09T12:00:00Z#99#r3',
        'PR#7#4 | META',
        'PR#7#4 | INLINE#99#i4',
      ].sort(),
    );
  });

  it('keeps a record it cannot read the actors of, and one with no actors at all', async () => {
    const { fake, db } = makeDb();
    await logRows(fake, [1, 2, 3]);
    await put(fake, { PK: 'PR#7#1', SK: 'META', merged: true }); // no author_id
    await put(fake, { PK: 'PR#7#2', SK: 'META', author_id: 'not-a-number' });
    await put(fake, { PK: 'PR#7#3', SK: 'SOMETHING#else' });
    expect((await db.deleteUser(ME)).prItems).toBe(0);
    expect(fake.size).toBe(3);
  });

  it('finds PRs only through Combat Log rows, ignores rows with no PR, and tolerates a PR already gone', async () => {
    const { fake, db } = makeDb();
    await logRows(fake, [1, 5]);
    await put(fake, {
      PK: `USER#${ME}`,
      SK: 'EVT#2026-11-09T12:00:09Z#streak',
      kind: 'weekly_streak',
    });
    await put(fake, { PK: `USER#${ME}`, SK: 'WEEK#2026-46', repo_id: 7, pr_number: 2 }); // not a log row
    await put(fake, meta(1, ME)); // referenced by a row
    await put(fake, meta(2, ME)); // referenced by nothing the delete reads
    // PR 5 has a row but no records.
    expect((await db.deleteUser(ME)).prItems).toBe(1);
    expect(keysOf(fake.snapshot())).toEqual(['PR#7#2 | META']);
  });

  it('never touches another player, even one whose id starts with the same digits', async () => {
    const { fake, db } = makeDb();
    await logRows(fake, [1]);
    await put(fake, meta(1, ME));
    await put(fake, { PK: `USER#${ME}0`, SK: 'PROFILE', login: 'neighbour' });
    await put(fake, { PK: `USER#${ME}0`, SK: 'WEEK#2026-46' });
    await put(fake, { PK: 'INSTALL#41', SK: 'META', account_id: ME });
    await db.deleteUser(ME);
    expect(keysOf(fake.snapshot())).toEqual(
      ['INSTALL#41 | META', `USER#${ME}0 | PROFILE`, `USER#${ME}0 | WEEK#2026-46`].sort(),
    );
  });

  it('reads PR partitions a few at a time, with strongly consistent reads', async () => {
    const { fake, db } = makeDb();
    const numbers = Array.from({ length: 30 }, (_, index) => index + 1);
    await logRows(
      fake,
      numbers.filter((number) => number < 10),
    );
    for (const number of numbers.filter((n) => n >= 10)) {
      await put(fake, {
        PK: `USER#${ME}`,
        SK: `EVT#2026-11-09T12:01:${String(number)}Z#d${number}`,
        repo_id: 7,
        pr_number: number,
      });
    }
    for (const number of numbers) {
      await put(fake, meta(number, ME));
    }
    const before = fake.calls.length;
    expect((await db.deleteUser(ME)).prItems).toBe(30);
    const queries = fake.calls.slice(before).filter((call) => call.operation === 'Query');
    expect(queries.every((call) => call.input.ConsistentRead === true)).toBe(true);
    expect(fake.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------
// BatchWriteItem under throttling
// ---------------------------------------------------------------------------------------------

describe('Db#deleteUser: unprocessed deletes', () => {
  /** A client that processes only the first `accepted` requests of each BatchWriteItem, for `rounds` calls. */
  function throttled(fake: FakeDynamo, accepted: number, rounds: number) {
    let round = 0;
    const sizes: number[] = [];
    return {
      sizes,
      client: {
        send: async (command: unknown) => {
          if (!(command instanceof BatchWriteCommand) || round >= rounds) {
            return fake.send(command);
          }
          round += 1;
          const requests = command.input.RequestItems?.[TABLE_NAME] ?? [];
          sizes.push(requests.length);
          const done = requests.slice(0, accepted);
          const left = requests.slice(accepted);
          if (done.length > 0) {
            await fake.send(new BatchWriteCommand({ RequestItems: { [TABLE_NAME]: done } }));
          }
          return { UnprocessedItems: left.length > 0 ? { [TABLE_NAME]: left } : {} };
        },
      } as unknown as DocClient,
    };
  }

  async function seeded(count: number): Promise<FakeDynamo> {
    const fake = new FakeDynamo({ tableName: TABLE_NAME });
    await fake.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: { PK: 'USER#5', SK: 'PROFILE', login: 'five' },
      }),
    );
    for (let index = 0; index < count; index += 1) {
      await fake.send(
        new PutCommand({
          TableName: TABLE_NAME,
          Item: { PK: 'USER#5', SK: `WEEK#2026-${String(index).padStart(2, '0')}` },
        }),
      );
    }
    return fake;
  }

  it('sends back what DynamoDB reports as unprocessed, waiting longer each round', async () => {
    const fake = await seeded(9);
    const waits: number[] = [];
    // Each of the first 4 batches takes 3 requests at a time and hands the rest back.
    const { client, sizes } = throttled(fake, 3, 4);
    const db = new Db(client, TABLE_NAME, (ms) => {
      waits.push(ms);
      return Promise.resolve();
    });
    await db.deleteUser(5);
    expect(fake.size).toBe(0);
    // 9 weeks go three at a time (9, 6, 3 left), then the profile on its own.
    expect(sizes).toEqual([9, 6, 3, 1]);
    expect(waits).toEqual([100, 200]);
  });

  it('gives up with an error after 8 rounds that make no progress, leaving the profile', async () => {
    const fake = await seeded(2);
    const waits: number[] = [];
    const { client } = throttled(fake, 0, 100);
    const db = new Db(client, TABLE_NAME, (ms) => {
      waits.push(ms);
      return Promise.resolve();
    });
    await expect(db.deleteUser(5)).rejects.toThrow('BatchWriteItem left deletes unprocessed');
    expect(waits).toEqual([100, 200, 400, 800, 1600, 2000, 2000]);
    expect(fake.peek('USER#5', 'PROFILE')).toBeDefined();
  });

  it('sleeps for real by default', async () => {
    const fake = await seeded(1);
    const { client } = throttled(fake, 0, 1);
    const db = new Db(client, TABLE_NAME);
    const started = Date.now();
    await db.deleteUser(5);
    expect(Date.now() - started).toBeGreaterThanOrEqual(90);
    expect(fake.size).toBe(0);
  });
});
