import { Db } from '../src/db';
import type { DocClient } from '../src/db';
import { createIngestHandler } from '../src/handlers/ingest';
import type { Logger } from '../src/log';
import { createRecordingMetrics } from '../src/metrics';
import type { Secrets } from '../src/secrets';
import { FakeDynamo } from './fake-dynamo';
import { TABLE_NAME } from './support';
import { AUTHOR_ID, INSTALLATION_ID, MERGER_ID, REVIEWER_ID, WEBHOOK_SECRET } from './webhooks';

/** Monday 2026-11-09 12:00 UTC: the Scout window, same day as the fixtures' timestamps. */
export const START = Date.UTC(2026, 10, 9, 12, 0, 0);

/** The operations the ingest role may call (Requirement 12.2): no DeleteItem, no BatchWriteItem. */
export const INGEST_ROLE = ['PutItem', 'GetItem', 'UpdateItem', 'Query'] as const;

export interface Harness {
  fake: FakeDynamo;
  db: Db;
  metrics: ReturnType<typeof createRecordingMetrics>;
  /** Every line the handler logged. */
  logs: string[];
  clock: { now: number };
  handler: ReturnType<typeof createIngestHandler>;
  /** Create a signed-in player (a profile with the given installations). */
  signIn(id: number, installations?: number[], login?: string): Promise<void>;
}

/** The ingest handler over an in-memory table restricted to the ingest role's DynamoDB operations. */
export function makeIngestHarness(): Harness {
  const fake = new FakeDynamo({ tableName: TABLE_NAME, allowedOperations: INGEST_ROLE });
  const db = new Db(fake as unknown as DocClient, TABLE_NAME);
  const metrics = createRecordingMetrics();
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
  const secrets: Secrets = { get: () => Promise.resolve(WEBHOOK_SECRET) };
  const clock = { now: START };
  const handler = createIngestHandler({ db, secrets, metrics, log, now: () => clock.now });
  return {
    fake,
    db,
    metrics,
    logs,
    clock,
    handler,
    async signIn(id, installations = [INSTALLATION_ID], login = `player-${id}`) {
      // In production the api service does this at sign-in (an UpdateItem, which the ingest role also has).
      await db.upsertProfileOnLogin({ id, login, installations, nowMs: START - 86_400_000 });
    },
  };
}

export const PLAYERS = { author: AUTHOR_ID, reviewer: REVIEWER_ID, merger: MERGER_ID };
