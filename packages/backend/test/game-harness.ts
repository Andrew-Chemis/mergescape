/**
 * Both Lambdas over one in-memory table, each restricted to its own IAM role, with one injected clock.
 * Used by the run, shop and rollover tests, which need ingest to score and the api to read and spend.
 */
import { Db } from '../src/db';
import type { DocClient } from '../src/db';
import { createApiHandler } from '../src/handlers/api';
import { createIngestHandler } from '../src/handlers/ingest';
import type { FunctionUrlEvent, FunctionUrlResult } from '../src/http';
import { signSessionToken } from '../src/jwt';
import type { Logger } from '../src/log';
import { createRecordingMetrics } from '../src/metrics';
import { runRollover } from '../src/rollover';
import type { RolloverResult } from '../src/rollover';
import type { SecretName, Secrets } from '../src/secrets';
import { apiRequest, CONFIG, fakeGitHub, JWT_KEY } from './api-harness';
import { FakeDynamo } from './fake-dynamo';
import type { FakeOperation } from './fake-dynamo';
import { INGEST_ROLE, SEED, START } from './harness';
import { TABLE_NAME } from './support';
import {
  AUTHOR_ID,
  fixtureDelivery,
  INSTALLATION_ID,
  MERGER_ID,
  PR_NUMBER,
  REVIEWER_ID,
  WEBHOOK_SECRET,
} from './webhooks';

/** What the api Lambda's role allows (Requirement 12.2): Scan only on the GSI, which the fake enforces. */
export const API_ROLE: readonly FakeOperation[] = [
  'PutItem',
  'GetItem',
  'UpdateItem',
  'Query',
  'DeleteItem',
  'BatchWriteItem',
  'Scan',
];

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

export interface Reply {
  status: number;
  body: Record<string, unknown>;
}

/** A command as the fake receives it, for tests that need to break or race one call. */
export interface CommandInput {
  TableName?: string;
  Key?: { PK?: string; SK?: string };
  Item?: { PK?: string; SK?: string };
  UpdateExpression?: string;
  ExpressionAttributeNames?: Record<string, string>;
}

export interface Game {
  fake: FakeDynamo;
  /**
   * Run before each call the api Lambda's client sends (the rollover included): a test sets it to inject a
   * competing write or a failure at one exact point, then usually clears it.
   */
  intercept: { api?: (input: CommandInput) => Promise<void> | void };
  /** The api's view of the table (the Lambda that also runs the rollover). */
  db: Db;
  clock: { now: number };
  logs: string[];
  /** Seeds handed to new runs, in order; the last one repeats. Default: always `SEED`. */
  seeds: number[];
  /** The seed every expedition and Forge order started from now on is rolled from. */
  roll: { seed: number };
  signIn(id: number, installations?: number[], login?: string): Promise<void>;
  /** Deliver a signed webhook, then move the clock on one minute. */
  deliver(event: FunctionUrlEvent): Promise<FunctionUrlResult>;
  /** The api handler itself, for requests the `get` and `post` helpers cannot make. */
  api: (event: FunctionUrlEvent) => Promise<FunctionUrlResult>;
  /** A session token for `userId`, issued now. */
  token(userId?: number): Promise<string>;
  get(path: string, userId?: number): Promise<Reply>;
  post(path: string, body: Record<string, unknown>, userId?: number): Promise<Reply>;
  rollover(): Promise<RolloverResult>;
}

export function makeGame(): Game {
  const fake = new FakeDynamo({ tableName: TABLE_NAME });
  const ingestDb = new Db(fake.forRole('ingest', INGEST_ROLE) as unknown as DocClient, TABLE_NAME);
  const intercept: Game['intercept'] = {};
  const apiClient = fake.forRole('api', API_ROLE);
  const db = new Db(
    {
      send: async (command: unknown) => {
        await intercept.api?.((command as { input: CommandInput }).input);
        return apiClient.send(command);
      },
    } as unknown as DocClient,
    TABLE_NAME,
  );
  const logs: string[] = [];
  const log: Logger = {
    error(event, context, error) {
      logs.push(
        JSON.stringify({
          event,
          ...context,
          error: error instanceof Error ? error.name : undefined,
        }),
      );
    },
  };
  const clock = { now: START };
  const seeds: number[] = [];
  const roll = { seed: 0xc0ffee };
  const rollSeed = (): number => roll.seed;
  const newSeed = (): number => (seeds.length > 1 ? (seeds.shift() as number) : (seeds[0] ?? SEED));
  const values: Record<SecretName, string> = {
    'github-webhook-secret': WEBHOOK_SECRET,
    'github-oauth-client-secret': 'unused',
    'github-oauth-client-id': 'unused',
    'jwt-key': JWT_KEY,
    'github-app-private-key': 'unused',
  };
  const secrets: Secrets = { get: (name) => Promise.resolve(values[name]) };

  const ingest = createIngestHandler({
    db: ingestDb,
    secrets,
    metrics: createRecordingMetrics(),
    log,
    now: () => clock.now,
    newSeed,
    rollSeed,
  });
  const api = createApiHandler({
    db,
    secrets,
    config: CONFIG,
    log,
    now: () => clock.now,
    fetch: fakeGitHub().fetch,
    newSeed,
    rollSeed,
  });

  const call = async (
    method: 'GET' | 'POST',
    path: string,
    userId: number,
    body?: Record<string, unknown>,
  ): Promise<Reply> => {
    const event: FunctionUrlEvent = {
      ...apiRequest({ method, path, token: await signSessionToken(JWT_KEY, userId, clock.now) }),
      ...(body ? { body: JSON.stringify(body) } : {}),
    };
    const result = await api(event);
    return {
      status: result.statusCode ?? 0,
      body: JSON.parse(result.body ?? '{}') as Reply['body'],
    };
  };

  return {
    fake,
    intercept,
    db,
    clock,
    logs,
    seeds,
    roll,
    api,
    token: (userId = AUTHOR_ID) => signSessionToken(JWT_KEY, userId, clock.now),
    async signIn(id, installations = [INSTALLATION_ID], login = `player-${id}`) {
      await db.upsertProfileOnLogin({ id, login, installations, nowMs: START - DAY });
    },
    async deliver(event) {
      const result = await ingest(event);
      clock.now += MINUTE;
      return result;
    },
    get: (path, userId = AUTHOR_ID) => call('GET', path, userId),
    post: (path, body, userId = AUTHOR_ID) => call('POST', path, userId, body),
    rollover: () => runRollover({ db, log, now: () => clock.now, newSeed }),
  };
}

// ---------------------------------------------------------------------------------------------
// A pull request's whole life, as fixture deliveries
// ---------------------------------------------------------------------------------------------

/** Edit a fixture payload to belong to PR `number` (the recorded ones are all PR 17). */
function renumber(number: number) {
  return (payload: Record<string, unknown>): void => {
    if (typeof payload.number === 'number') {
      payload.number = number;
    }
    (payload.pull_request as Record<string, unknown>).number = number;
  };
}

/**
 * The author opens PR `number`, the reviewer approves it and comments, and the merger merges it: 5 scored
 * events for the two players (the author's open and merge, the reviewer's approval, inline comment and
 * verified kill). Both players must be signed in.
 */
export async function playLife(game: Game, number: number = PR_NUMBER): Promise<void> {
  for (const fixture of [
    'pull_request.opened',
    'pull_request_review.approved',
    'pull_request_review_comment.created',
    'pull_request.closed.merged',
  ]) {
    const result = await game.deliver(fixtureDelivery(fixture, renumber(number)));
    if (result.statusCode !== 200) {
      throw new Error(`delivery of ${fixture} answered ${String(result.statusCode)}`);
    }
  }
}

export { AUTHOR_ID, MERGER_ID, REVIEWER_ID };
