/**
 * The `ingest` Lambda behind a Function URL (auth NONE): the HMAC signature is the only credential.
 *
 * Order of checks, each writing nothing on failure: method, size (413), signature (401), headers (400),
 * JSON (400); then the delivery is normalised and processed (`processDelivery`).
 */
import { normalize } from '@mergescape/shared';
import type { Db } from '../db';
import { header, json, rawBody } from '../http';
import type { FunctionUrlEvent, FunctionUrlResult } from '../http';
import { processDelivery } from '../ingest';
import { createEmfMetrics } from '../metrics';
import type { Metrics } from '../metrics';
import type { Logger } from '../log';
import { getRuntime } from '../runtime';
import type { Secrets } from '../secrets';
import { verifyWebhookSignature } from '../signature';

/** Requirement 1.4. */
export const MAX_BODY_BYTES = 256 * 1024;

/** The events the App subscribes to (Requirement 1.1); `ping` and anything else is acknowledged and ignored. */
const SUPPORTED_EVENTS: ReadonlySet<string> = new Set([
  'pull_request',
  'pull_request_review',
  'pull_request_review_comment',
  'installation',
  'installation_repositories',
]);

/** `X-GitHub-Delivery` is a GUID. */
const DELIVERY_ID = /^[A-Za-z0-9-]{8,64}$/;

export interface IngestDeps {
  db: Db;
  secrets: Secrets;
  metrics: Metrics;
  log: Logger;
  /** Epoch milliseconds; injectable for tests. */
  now?: () => number;
}

export function createIngestHandler(
  deps: IngestDeps,
): (event: FunctionUrlEvent) => Promise<FunctionUrlResult> {
  const now = deps.now ?? Date.now;

  return async (event) => {
    try {
      if (event.requestContext.http.method !== 'POST') {
        return json(405, { error: 'method_not_allowed' }, { allow: 'POST' });
      }

      const body = rawBody(event, MAX_BODY_BYTES);
      if (body === 'too_large') {
        return json(413, { error: 'payload_too_large' });
      }

      const secret = await deps.secrets.get('github-webhook-secret');
      if (!verifyWebhookSignature(secret, body, header(event, 'x-hub-signature-256'))) {
        return json(401, { error: 'invalid_signature' });
      }

      // From here the sender is GitHub: the body is authentic, though still untrusted JSON.
      const deliveryId = header(event, 'x-github-delivery');
      const eventName = header(event, 'x-github-event');
      if (!deliveryId || !DELIVERY_ID.test(deliveryId) || !eventName) {
        return json(400, { error: 'missing_headers' });
      }
      if (!SUPPORTED_EVENTS.has(eventName)) {
        return json(200, { ok: true });
      }

      let payload: unknown;
      try {
        payload = JSON.parse(body.toString('utf8'));
      } catch {
        // Not logged: the parser's message quotes the input.
        return json(400, { error: 'invalid_json' });
      }

      const events = normalize(eventName, payload);
      if (events.length === 0) {
        return json(200, { ok: true });
      }
      await processDelivery(
        { db: deps.db, metrics: deps.metrics, log: deps.log, now },
        deliveryId,
        events,
      );
      return json(200, { ok: true });
    } catch (error) {
      deps.log.error('ingest.failed', {}, error);
      return json(500, { error: 'internal_error' });
    } finally {
      deps.metrics.flush();
    }
  };
}

let defaultHandler: ((event: FunctionUrlEvent) => Promise<FunctionUrlResult>) | undefined;

/** Lambda entry point (`ingest.handler` in the SAM template). */
export const handler = (event: FunctionUrlEvent): Promise<FunctionUrlResult> => {
  if (!defaultHandler) {
    const runtime = getRuntime();
    defaultHandler = createIngestHandler({
      db: runtime.db,
      secrets: runtime.secrets,
      log: runtime.log,
      metrics: createEmfMetrics('ingest'),
    });
  }
  return defaultHandler(event);
};
