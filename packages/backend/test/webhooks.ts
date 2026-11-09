/** Helpers that build signed Function URL deliveries from the recorded fixtures in packages/shared. */
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { FunctionUrlEvent } from '../src/http';

export const WEBHOOK_SECRET = 'whsec_test_0123456789abcdef0123456789abcdef';

// Ids used throughout the fixtures (all fake).
export const AUTHOR_ID = 1001001;
export const REVIEWER_ID = 2002002;
export const MERGER_ID = 3003003;
export const BOT_ID = 9009009;
export const INSTALLATION_ID = 777001;
export const INSTALLATION_ACCOUNT_ID = 5005005;
export const REPO_ID = 424242;
export const PR_NUMBER = 17;

const FIXTURE_DIR = fileURLToPath(new URL('../../shared/fixtures/webhooks/', import.meta.url));

/** The event name header for a fixture file: `pull_request_review.approved` -> `pull_request_review`. */
export function eventNameOf(fixture: string): string {
  return fixture.split('.')[0] ?? fixture;
}

export function fixtureText(fixture: string): string {
  return readFileSync(`${FIXTURE_DIR}${fixture}.json`, 'utf8');
}

export function fixtureJson(fixture: string): Record<string, unknown> {
  return JSON.parse(fixtureText(fixture)) as Record<string, unknown>;
}

export function sign(secret: string, body: string | Buffer): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

let deliveryCounter = 0;

export function nextDeliveryId(): string {
  deliveryCounter += 1;
  return `00000000-0000-4000-8000-${String(deliveryCounter).padStart(12, '0')}`;
}

export interface DeliveryOptions {
  eventName: string;
  body: string;
  secret?: string;
  deliveryId?: string | null;
  /** Override the computed signature (`null` omits the header). */
  signature?: string | null;
  method?: string;
  base64?: boolean;
}

/** A Function URL (payload v2) event as GitHub's webhook delivery would produce it. */
export function delivery(options: DeliveryOptions): FunctionUrlEvent {
  const bodyBytes = Buffer.from(options.body, 'utf8');
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'user-agent': 'GitHub-Hookshot/test',
    'x-github-event': options.eventName,
  };
  const deliveryId = options.deliveryId === undefined ? nextDeliveryId() : options.deliveryId;
  if (deliveryId !== null) {
    headers['x-github-delivery'] = deliveryId;
  }
  const signature =
    options.signature === undefined
      ? sign(options.secret ?? WEBHOOK_SECRET, bodyBytes)
      : options.signature;
  if (signature !== null) {
    headers['x-hub-signature-256'] = signature;
  }
  return {
    version: '2.0',
    routeKey: '$default',
    rawPath: '/',
    rawQueryString: '',
    headers,
    requestContext: {
      accountId: 'anonymous',
      apiId: 'test',
      domainName: 'test.lambda-url.us-east-1.on.aws',
      domainPrefix: 'test',
      http: {
        method: options.method ?? 'POST',
        path: '/',
        protocol: 'HTTP/1.1',
        sourceIp: '192.0.2.1',
        userAgent: 'GitHub-Hookshot/test',
      },
      requestId: 'request-1',
      routeKey: '$default',
      stage: '$default',
      time: '09/Nov/2026:12:00:00 +0000',
      timeEpoch: 0,
    },
    body: options.base64 ? bodyBytes.toString('base64') : options.body,
    isBase64Encoded: options.base64 ?? false,
  };
}

/** A signed delivery of a recorded fixture, optionally with its JSON edited first. */
export function fixtureDelivery(
  fixture: string,
  edit?: (payload: Record<string, unknown>) => void,
  options: Partial<DeliveryOptions> = {},
): FunctionUrlEvent {
  let body = fixtureText(fixture);
  if (edit) {
    const payload = JSON.parse(body) as Record<string, unknown>;
    edit(payload);
    body = JSON.stringify(payload);
  }
  return delivery({ eventName: eventNameOf(fixture), body, ...options });
}
