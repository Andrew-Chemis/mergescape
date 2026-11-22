/**
 * The OAuth `state` of the sign-in (Requirement 2.1), without a table behind it.
 *
 * `GET /auth/login` is open to anyone, so it must not write to the table: a loop over it would eat the write
 * capacity of every player. The state is therefore signed instead of stored: `<nonce>.<expiry>.<mac>`, where
 * the MAC is an HMAC-SHA-256 over the nonce and the expiry under a key derived from the JWT key (derived, so a
 * state can never be mistaken for a session token or the other way round). Anyone can obtain a valid state
 * from `/auth/login`, so on its own it proves nothing about the browser that comes back with it:
 *
 *   - the nonce is also set as an HttpOnly, Secure, SameSite=Lax `__Host-` cookie by `/auth/login`, and the
 *     callback requires the cookie to hold the same nonce. A state that an attacker got for their own browser
 *     and planted in a victim's callback URL arrives without the cookie and is refused (login CSRF). Both
 *     routes are on the Function URL's origin and the callback is a top-level navigation, so the cookie
 *     comes back with it;
 *   - the state is single use. A used one is recorded by the callback (`Db#consumeOAuthState`), after GitHub
 *     has accepted the code, so only a completed sign-in writes anything.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { MINUTE_MS } from '@mergescape/shared';
import type { FunctionUrlEvent } from './http';
import { header } from './http';

/** A state is good for ten minutes. */
export const OAUTH_STATE_LIFETIME_MS = 10 * MINUTE_MS;

/** The `__Host-` prefix makes the browser insist on Secure, Path=/ and no Domain. */
export const STATE_COOKIE = '__Host-mergescape-oauth';

/** `<nonce>.<expiry in seconds, base 36>.<mac>`: URL-safe, so GitHub hands it back unchanged. */
export const STATE_FORMAT = /^[A-Za-z0-9_-]{20,128}\.[0-9a-z]{1,12}\.[A-Za-z0-9_-]{43}$/;

const KEY_LABEL = 'mergescape/oauth-state/v1';

function mac(jwtKey: string, nonce: string, expiry: string): string {
  const key = createHmac('sha256', jwtKey).update(KEY_LABEL).digest();
  return createHmac('sha256', key).update(`${nonce}.${expiry}`).digest('base64url');
}

/** A signed state for `nonce`, valid from `nowMs` for `OAUTH_STATE_LIFETIME_MS`. */
export function signState(jwtKey: string, nonce: string, nowMs: number): string {
  const expiry = Math.floor((nowMs + OAUTH_STATE_LIFETIME_MS) / 1000).toString(36);
  return `${nonce}.${expiry}.${mac(jwtKey, nonce, expiry)}`;
}

const sameText = (a: string, b: string): boolean =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** The nonce and expiry of a state that was signed by `signState` and has not expired; null for any other. */
export function verifyState(
  jwtKey: string,
  state: string,
  nowMs: number,
): { nonce: string; expiresAtMs: number } | null {
  if (!STATE_FORMAT.test(state)) {
    return null;
  }
  const [nonce = '', expiry = '', given = ''] = state.split('.');
  if (!sameText(given, mac(jwtKey, nonce, expiry))) {
    return null;
  }
  const expiresAtMs = Number.parseInt(expiry, 36) * 1000;
  return expiresAtMs > nowMs ? { nonce, expiresAtMs } : null;
}

/** The `Set-Cookie` value that binds the sign-in to this browser. */
export function stateCookie(nonce: string): string {
  const maxAge = OAUTH_STATE_LIFETIME_MS / 1000;
  return `${STATE_COOKIE}=${nonce}; Max-Age=${maxAge}; Path=/; Secure; HttpOnly; SameSite=Lax`;
}

/** The `Set-Cookie` value that removes it once the sign-in is over. */
export function clearedStateCookie(): string {
  return `${STATE_COOKIE}=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=Lax`;
}

/** True when the request carries the state cookie with exactly this nonce. */
export function hasStateCookie(event: FunctionUrlEvent, nonce: string): boolean {
  // A Function URL (payload 2.0) lists cookies apart from the headers; the header is read as a fallback.
  const pairs = [...(event.cookies ?? []), ...(header(event, 'cookie') ?? '').split(';')];
  const prefix = `${STATE_COOKIE}=`;
  return pairs.some((pair) => {
    const trimmed = pair.trim();
    return trimmed.startsWith(prefix) && sameText(trimmed.slice(prefix.length), nonce);
  });
}
