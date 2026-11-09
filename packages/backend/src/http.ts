/** Small helpers for Lambda Function URL events (payload format 2.0, `aws-lambda` types). */
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';

export type FunctionUrlEvent = APIGatewayProxyEventV2;
export type FunctionUrlResult = APIGatewayProxyStructuredResultV2;

/** A header value by case-insensitive name. Function URLs lower-case names already; this is defensive. */
export function header(event: FunctionUrlEvent, name: string): string | undefined {
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(event.headers ?? {})) {
    if (key.toLowerCase() === wanted) {
      return value;
    }
  }
  return undefined;
}

export function json(
  statusCode: number,
  body: unknown,
  headers: Record<string, string> = {},
): FunctionUrlResult {
  return {
    statusCode,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers },
    body: JSON.stringify(body),
  };
}

export function redirect(
  location: string,
  headers: Record<string, string> = {},
): FunctionUrlResult {
  return {
    statusCode: 302,
    headers: { location, 'cache-control': 'no-store', ...headers },
    body: '',
  };
}

/** Decoded length of a base64 string, without decoding it. */
function base64DecodedLength(encoded: string): number {
  const padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0;
  return Math.floor((encoded.length * 3) / 4) - padding;
}

/**
 * The request body exactly as the client sent it, as bytes (the HMAC covers the raw bytes). Handles the
 * base64 form Function URLs use for binary content. Returns `'too_large'` over `maxBytes` without
 * decoding it.
 */
export function rawBody(event: FunctionUrlEvent, maxBytes: number): Buffer | 'too_large' {
  const body = event.body ?? '';
  if (event.isBase64Encoded) {
    return base64DecodedLength(body) > maxBytes ? 'too_large' : Buffer.from(body, 'base64');
  }
  return Buffer.byteLength(body, 'utf8') > maxBytes ? 'too_large' : Buffer.from(body, 'utf8');
}
