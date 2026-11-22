import type { Db } from './db';
import type { Logger } from './log';
import { ensureRun } from './runs';

/** The EventBridge input of the weekly schedule (`{"action":"rollover"}`, set on the rule in the CDK stack). */
export interface RolloverEvent {
  action: 'rollover';
}

/**
 * True for the scheduled invocation and only for it. A Function URL request always carries a
 * `requestContext`, so no HTTP caller can reach the rollover by crafting a body or a path.
 */
export function isRolloverEvent(event: unknown): event is RolloverEvent {
  return (
    typeof event === 'object' &&
    event !== null &&
    !('requestContext' in event) &&
    (event as { action?: unknown }).action === 'rollover'
  );
}

export interface RolloverContext {
  db: Db;
  log: Logger;
  /** Epoch milliseconds; read once, so every profile rolls into the same week. */
  now: () => number;
  /** A fresh random uint32 per new run. */
  newSeed: () => number;
  /** Profiles handled at once (default 4: the table is provisioned at 5 write units). */
  concurrency?: number;
}

export interface RolloverResult {
  statusCode: 200;
  /** Profiles that now have this week's run (started now, or already started). */
  processed: number;
}

/**
 * Monday 00:05 UTC run rollover (Requirement 6.1, tasks.md 15). For every profile, found with a paginated
 * Scan of GSI1: close last week (weekly streak, Vocation, history) and start this one (targets, Mogul,
 * Pledge hand, shop seed). That is `ensureRun`, which is idempotent: a week that already exists is left
 * alone, so a retried or doubled invocation changes nothing.
 *
 * A profile that fails is logged by numeric id and the rest carry on; the invocation then fails so that
 * Lambda's asynchronous retry runs it again for the stragglers.
 */
export async function runRollover(ctx: RolloverContext): Promise<RolloverResult> {
  const run = { db: ctx.db, now: ctx.now(), newSeed: ctx.newSeed };
  const concurrency = ctx.concurrency ?? 4;
  let processed = 0;
  let failed = 0;

  const handle = async (userId: number): Promise<void> => {
    try {
      if (await ensureRun(run, userId)) {
        processed += 1;
      }
    } catch (error) {
      failed += 1;
      ctx.log.error('rollover.failed', { userId }, error);
    }
  };

  let batch: number[] = [];
  for await (const userId of ctx.db.scanProfileIds()) {
    batch.push(userId);
    if (batch.length >= concurrency) {
      await Promise.all(batch.map(handle));
      batch = [];
    }
  }
  await Promise.all(batch.map(handle));

  if (failed > 0) {
    throw new Error(`Rollover failed for ${failed} profile(s)`);
  }
  return { statusCode: 200, processed };
}
