import { createHmac, timingSafeEqual } from 'node:crypto';

const SIGNATURE_PATTERN = /^sha256=([0-9a-fA-F]{64})$/;

/**
 * Verify `X-Hub-Signature-256` (Requirement 1.2): HMAC-SHA256 of the raw body under the webhook secret,
 * compared with `timingSafeEqual` after a length check. Run this before the body is parsed.
 *
 * @param secret the webhook secret
 * @param rawBody the body bytes exactly as received
 * @param header the header value, `sha256=<64 hex digits>`; missing or malformed fails
 */
export function verifyWebhookSignature(
  secret: string,
  rawBody: Uint8Array,
  header: string | undefined,
): boolean {
  const match = header === undefined ? null : SIGNATURE_PATTERN.exec(header);
  if (!match?.[1]) {
    return false;
  }
  const provided = Buffer.from(match[1], 'hex');
  const expected = createHmac('sha256', secret).update(rawBody).digest();
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}
