import { GetParameterCommand } from '@aws-sdk/client-ssm';
import type { GetParameterCommandOutput } from '@aws-sdk/client-ssm';
import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/config';
import { VersionConflictError } from '../src/db';
import type { PRBundle } from '../src/db';
import { header, json, rawBody, redirect } from '../src/http';
import { loginPk, userIdFromPk, userPk } from '../src/keys';
import { createLogger } from '../src/log';
import { createEmfMetrics, createRecordingMetrics } from '../src/metrics';
import { MAX_ATTEMPTS, RETRY, versionedWrite, withVersionRetry } from '../src/optimistic';
import { buildPRState } from '../src/pr-state';
import { createSecrets, SECRET_CACHE_MS, SecretUnavailableError } from '../src/secrets';
import type { SsmLike } from '../src/secrets';
import { verifyWebhookSignature } from '../src/signature';
import { displayWeekKey, weeksBetween } from '../src/weeks';
import { delivery, sign } from './webhooks';

describe('verifyWebhookSignature', () => {
  const body = Buffer.from('{"hello":"world"}');

  it('accepts the right HMAC and rejects everything else', () => {
    const good = sign('secret', body);
    expect(verifyWebhookSignature('secret', body, good)).toBe(true);
    expect(
      verifyWebhookSignature('secret', body, good.toUpperCase().replace('SHA256=', 'sha256=')),
    ).toBe(true);
    expect(verifyWebhookSignature('other', body, good)).toBe(false);
    expect(verifyWebhookSignature('secret', Buffer.from('{"hello":"worle"}'), good)).toBe(false);
    expect(verifyWebhookSignature('secret', body, undefined)).toBe(false);
    expect(verifyWebhookSignature('secret', body, '')).toBe(false);
    expect(verifyWebhookSignature('secret', body, good.slice(0, -1))).toBe(false);
    expect(verifyWebhookSignature('secret', body, `${good}00`)).toBe(false);
    expect(verifyWebhookSignature('secret', body, good.replace('sha256=', 'sha1='))).toBe(false);
    expect(verifyWebhookSignature('secret', body, `sha256=${'g'.repeat(64)}`)).toBe(false);
  });

  it('signs the exact bytes, not the parsed JSON', () => {
    const spaced = Buffer.from('{ "hello" : "world" }');
    expect(verifyWebhookSignature('secret', spaced, sign('secret', body))).toBe(false);
    expect(verifyWebhookSignature('secret', spaced, sign('secret', spaced))).toBe(true);
  });
});

describe('createSecrets', () => {
  function ssmReturning(values: Record<string, string | undefined>) {
    const send = vi.fn((command: GetParameterCommand) => {
      const name = command.input.Name ?? '';
      expect(command.input.WithDecryption).toBe(true);
      return Promise.resolve({
        Parameter: { Name: name, Value: values[name] },
      } as GetParameterCommandOutput);
    });
    return { ssm: { send } as SsmLike, send };
  }

  it('reads the prefixed parameter once and caches it for fifteen minutes', async () => {
    const { ssm, send } = ssmReturning({ '/ms/jwt-key': 'k1', '/ms/github-webhook-secret': 'w1' });
    let now = 1_000;
    const secrets = createSecrets({ ssm, prefix: '/ms', now: () => now });
    expect(await secrets.get('jwt-key')).toBe('k1');
    expect(await secrets.get('jwt-key')).toBe('k1');
    expect(await secrets.get('github-webhook-secret')).toBe('w1');
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0]?.[0]).toBeInstanceOf(GetParameterCommand);
    expect(SECRET_CACHE_MS).toBe(15 * 60 * 1000);

    now += SECRET_CACHE_MS - 1;
    await secrets.get('jwt-key');
    expect(send).toHaveBeenCalledTimes(2);
    now += 1;
    await secrets.get('jwt-key');
    expect(send).toHaveBeenCalledTimes(3);
  });

  it('picks up a rotated value after the cache expires, without a redeploy', async () => {
    const values: Record<string, string> = { '/ms/jwt-key': 'old' };
    const { ssm } = ssmReturning(values);
    let now = 0;
    const secrets = createSecrets({ ssm, prefix: '/ms', now: () => now });
    expect(await secrets.get('jwt-key')).toBe('old');
    values['/ms/jwt-key'] = 'new';
    expect(await secrets.get('jwt-key')).toBe('old');
    now += SECRET_CACHE_MS;
    expect(await secrets.get('jwt-key')).toBe('new');
  });

  it('shares one request between concurrent callers', async () => {
    const { ssm, send } = ssmReturning({ '/ms/jwt-key': 'k' });
    const secrets = createSecrets({ ssm, prefix: '/ms' });
    await Promise.all([secrets.get('jwt-key'), secrets.get('jwt-key'), secrets.get('jwt-key')]);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('serves the stale value through an SSM outage and fails when there is none', async () => {
    const errors: string[] = [];
    const log = { error: (event: string) => errors.push(event) };
    let healthy = true;
    const ssm: SsmLike = {
      send: () =>
        healthy
          ? Promise.resolve({ Parameter: { Value: 'k' } } as GetParameterCommandOutput)
          : Promise.reject(new Error('down')),
    };
    let now = 0;
    const secrets = createSecrets({ ssm, prefix: '/ms', now: () => now, log });
    expect(await secrets.get('jwt-key')).toBe('k');
    healthy = false;
    now += SECRET_CACHE_MS;
    expect(await secrets.get('jwt-key')).toBe('k');
    expect(errors).toEqual(['secrets.refresh_failed']);
    await expect(secrets.get('github-webhook-secret')).rejects.toThrow('down');
  });

  it('rejects a missing or empty parameter', async () => {
    const { ssm } = ssmReturning({ '/ms/jwt-key': '' });
    const secrets = createSecrets({ ssm, prefix: '/ms' });
    await expect(secrets.get('jwt-key')).rejects.toThrow(SecretUnavailableError);
    await expect(secrets.get('github-app-private-key')).rejects.toThrow(SecretUnavailableError);
  });
});

describe('metrics', () => {
  it('emits one EMF line with only the counted metrics, then resets', () => {
    const lines: string[] = [];
    const metrics = createEmfMetrics(
      'ingest',
      (line) => lines.push(line),
      () => 1234,
    );
    metrics.flush();
    expect(lines).toEqual([]);
    metrics.count('events_scored');
    metrics.count('events_scored', 2);
    metrics.count('duplicates');
    metrics.flush();
    metrics.flush();
    expect(lines).toHaveLength(1);
    const emitted = JSON.parse(lines[0] ?? '{}') as Record<string, unknown>;
    expect(emitted).toMatchObject({ Service: 'ingest', events_scored: 3, duplicates: 1 });
    expect(emitted._aws).toEqual({
      Timestamp: 1234,
      CloudWatchMetrics: [
        {
          Namespace: 'Mergescape',
          Dimensions: [['Service']],
          Metrics: [
            { Name: 'events_scored', Unit: 'Count' },
            { Name: 'duplicates', Unit: 'Count' },
          ],
        },
      ],
    });
  });

  it('records totals for tests', () => {
    const metrics = createRecordingMetrics();
    metrics.count('dropped_bot');
    metrics.count('dropped_bot');
    expect(metrics.totals.get('dropped_bot')).toBe(2);
  });
});

describe('logger', () => {
  it('writes the error name and numeric context but never the message', () => {
    const lines: string[] = [];
    const log = createLogger((line) => lines.push(line));
    const error = Object.assign(new Error('Unexpected token S in JSON: SENTINEL-BODY'), {
      name: 'SyntaxError',
      $metadata: { httpStatusCode: 400 },
    });
    log.error('ingest.failed', { userId: 42, retried: true }, error);
    log.error('other', undefined, 'a string');
    expect(JSON.parse(lines[0] ?? '{}')).toEqual({
      level: 'error',
      event: 'ingest.failed',
      userId: 42,
      retried: true,
      errorName: 'SyntaxError',
      httpStatus: 400,
    });
    expect(lines.join('')).not.toContain('SENTINEL');
    expect(JSON.parse(lines[1] ?? '{}')).toMatchObject({ errorName: 'UnknownError' });
  });
});

describe('loadConfig', () => {
  const env = {
    TABLE_NAME: 'mergescape',
    SSM_PREFIX: '/mergescape',
    PAGES_ORIGIN: 'https://octo.github.io',
    STAGE: 'prod',
  };

  it('reads the stack environment', () => {
    expect(loadConfig(env)).toEqual({
      tableName: 'mergescape',
      ssmPrefix: '/mergescape',
      pagesOrigin: 'https://octo.github.io',
      stage: 'prod',
      clientBasePath: '/',
    });
    expect(loadConfig({ ...env, CLIENT_BASE_PATH: '/mergescape/' }).clientBasePath).toBe(
      '/mergescape/',
    );
  });

  it('rejects a missing or malformed value', () => {
    expect(() => loadConfig({ ...env, TABLE_NAME: undefined })).toThrow(/TABLE_NAME/);
    expect(() => loadConfig({ ...env, PAGES_ORIGIN: 'https://octo.github.io/' })).toThrow(
      /PAGES_ORIGIN/,
    );
    expect(() => loadConfig({ ...env, PAGES_ORIGIN: 'http://octo.github.io' })).toThrow(
      /PAGES_ORIGIN/,
    );
    expect(() => loadConfig({ ...env, SSM_PREFIX: 'mergescape' })).toThrow(/SSM_PREFIX/);
    expect(() => loadConfig({ ...env, SSM_PREFIX: '/mergescape/' })).toThrow(/SSM_PREFIX/);
    expect(() => loadConfig({ ...env, CLIENT_BASE_PATH: 'mergescape' })).toThrow(
      /CLIENT_BASE_PATH/,
    );
  });
});

describe('http helpers', () => {
  it('finds headers case-insensitively', () => {
    const event = delivery({ eventName: 'x', body: '{}' });
    event.headers = { 'X-Mixed-Case': 'yes' };
    expect(header(event, 'x-mixed-case')).toBe('yes');
    expect(header(event, 'missing')).toBeUndefined();
  });

  it('builds JSON and redirect results', () => {
    expect(json(201, { a: 1 })).toMatchObject({
      statusCode: 201,
      body: '{"a":1}',
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    });
    expect(redirect('https://example.test/x', { 'set-cookie': 'a=b' })).toMatchObject({
      statusCode: 302,
      headers: { location: 'https://example.test/x', 'set-cookie': 'a=b' },
    });
  });

  it('returns raw bytes for plain and base64 bodies and refuses oversize ones before decoding', () => {
    const text = '{"é":"ü"}';
    expect(rawBody(delivery({ eventName: 'x', body: text }), 100)?.toString('utf8')).toBe(text);
    expect(
      rawBody(delivery({ eventName: 'x', body: text, base64: true }), 100)?.toString('utf8'),
    ).toBe(text);
    expect(rawBody(delivery({ eventName: 'x', body: 'a'.repeat(11) }), 10)).toBe('too_large');
    expect(rawBody(delivery({ eventName: 'x', body: 'a'.repeat(10) }), 10)).toHaveLength(10);
    for (const length of [9, 10, 11, 12]) {
      const body = 'a'.repeat(length);
      const event = delivery({ eventName: 'x', body, base64: true });
      expect(rawBody(event, 10)).toEqual(length > 10 ? 'too_large' : Buffer.from(body));
    }
    const empty = delivery({ eventName: 'x', body: '' });
    delete (empty as { body?: string }).body;
    expect(rawBody(empty, 10)).toHaveLength(0);
  });
});

describe('buildPRState', () => {
  const facts = {
    installationId: 1,
    repoId: 2,
    repoPrivate: false,
    number: 3,
    author: { id: 10, isBot: false },
    draft: false,
    baseRefIsDefault: true,
    stats: null,
    openedAt: null,
    mergedAt: null,
    closedAt: null,
    merged: false,
    mergedBy: null,
  };

  it('derives reviewer caps from the stored records', () => {
    const bundle: PRBundle = {
      meta: {
        installationId: 1,
        repoId: 2,
        repoPrivate: false,
        number: 3,
        authorId: 10,
        openedAt: null,
        mergedAt: null,
        closedAt: null,
        merged: false,
        mergedById: null,
        additions: 7,
        deletions: 8,
        changedFiles: 1,
        commits: 1,
        reviewRoundCount: 2,
        syncCount: 5,
        draft: false,
        baseRefIsDefault: true,
      },
      reviews: [
        { reviewerId: 20, reviewerIsBot: false, state: 'CHANGES_REQUESTED', submittedAt: 'a' },
        { reviewerId: 20, reviewerIsBot: false, state: 'APPROVED', submittedAt: 'b' },
        { reviewerId: 20, reviewerIsBot: false, state: 'COMMENTED', submittedAt: 'c' },
        { reviewerId: 21, reviewerIsBot: false, state: 'COMMENTED', submittedAt: 'd' },
        { reviewerId: 99, reviewerIsBot: true, state: 'APPROVED', submittedAt: 'e' },
      ],
      inline: [
        { reviewerId: 20, count: 1 },
        { reviewerId: 20, count: 1 },
        { reviewerId: 22, count: 1 },
      ],
    };
    const state = buildPRState(bundle, facts, 14);
    expect(state).toMatchObject({
      authorId: 10,
      additions: 7,
      deletions: 8,
      reviewRoundCount: 2,
      syncCount: 5,
      // The author's lifetime merges, for the Mentor Pledge; the Hoodie reads the review times.
      authorMerges: 14,
    });
    expect(state.reviews).toEqual([
      { reviewerId: 20, state: 'CHANGES_REQUESTED', submittedAt: 'a' },
      { reviewerId: 20, state: 'APPROVED', submittedAt: 'b' },
      { reviewerId: 20, state: 'COMMENTED', submittedAt: 'c' },
      { reviewerId: 21, state: 'COMMENTED', submittedAt: 'd' },
    ]);
    expect(state.reviewerCounters).toEqual({
      '20': { decisions: 2, comments: 1, inline: 2 },
      '21': { decisions: 0, comments: 1, inline: 0 },
      '22': { decisions: 0, comments: 0, inline: 1 },
    });
  });

  it('prefers the size on the event and falls back to an unseen PR', () => {
    const empty: PRBundle = { meta: null, reviews: [], inline: [] };
    expect(buildPRState(empty, facts)).toMatchObject({
      additions: 0,
      deletions: 0,
      reviews: [],
      authorMerges: 0,
    });
    const withStats = {
      ...facts,
      stats: { additions: 5, deletions: 6, changedFiles: 1, commits: 1 },
    };
    expect(buildPRState(empty, withStats)).toMatchObject({ additions: 5, deletions: 6 });
  });
});

describe('partition keys', () => {
  it('reads the player id back out of a USER# key, and nothing else', () => {
    expect(userIdFromPk(userPk(42))).toBe(42);
    expect(userIdFromPk('USER#0')).toBe(0);
    for (const other of ['PR#1#2', 'USER#', 'USER#-5', 'USER#12x', 'USER#1e3', 'user#1', '']) {
      expect(userIdFromPk(other), other).toBeNull();
    }
    expect(userIdFromPk(`USER#${'9'.repeat(20)}`)).toBeNull();
  });

  it('puts a login in its GSI1 partition in lower case', () => {
    expect(loginPk('Octo-Cat')).toBe('LOGIN#octo-cat');
  });
});

describe('week keys', () => {
  it('counts whole weeks between stored keys, across a year end', () => {
    expect(weeksBetween('2026-46', '2026-46')).toBe(0);
    expect(weeksBetween('2026-46', '2026-48')).toBe(2);
    expect(weeksBetween('2025-52', '2026-02')).toBe(2);
  });

  it('refuses a key that is not a week key', () => {
    expect(() => weeksBetween('2026-W46', '2026-47')).not.toThrow();
    expect(() => weeksBetween('later', '2026-47')).toThrow(RangeError);
    expect(() => weeksBetween('2026-47', '2026-60')).toThrow(RangeError);
  });

  it('spells the week the way the contract does', () => {
    expect(displayWeekKey('2026-46')).toBe('2026-W46');
  });
});

describe('optimistic retries', () => {
  it('runs an attempt again while it asks to, then returns what it settled on', async () => {
    let tries = 0;
    const settled = await withVersionRetry(() => {
      tries += 1;
      return Promise.resolve(tries < 3 ? RETRY : 'done');
    });
    expect(settled).toBe('done');
    expect(tries).toBe(3);
  });

  it('gives up with RETRY after the given number of attempts (6 by default)', async () => {
    let tries = 0;
    const attempt = (): Promise<typeof RETRY> => {
      tries += 1;
      return Promise.resolve(RETRY);
    };
    expect(await withVersionRetry(attempt, 2)).toBe(RETRY);
    expect(tries).toBe(2);
    tries = 0;
    expect(await withVersionRetry(attempt)).toBe(RETRY);
    expect(tries).toBe(MAX_ATTEMPTS);
    expect(MAX_ATTEMPTS).toBe(6);
  });

  it('treats a lost version check as false and lets every other error through', async () => {
    expect(await versionedWrite(() => Promise.resolve())).toBe(true);
    expect(await versionedWrite(() => Promise.reject(new VersionConflictError()))).toBe(false);
    await expect(versionedWrite(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
  });
});
