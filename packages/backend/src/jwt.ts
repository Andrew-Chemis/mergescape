/**
 * Session tokens (Requirement 2.3, design.md section 10): HS256 JWTs, 7 days, `iss` and `aud` checked on
 * every verification, `sub` the numeric GitHub id as a string. The key comes from SSM (see `secrets.ts`)
 * and is passed in, so a rotation takes effect on the next cache refresh without a redeploy.
 */
import { WEEK_MS } from '@mergescape/shared';
import { errors, jwtVerify, SignJWT } from 'jose';

export const JWT_ISSUER = 'mergescape';
export const JWT_AUDIENCE = 'mergescape-client';
export const JWT_TTL_SECONDS = WEEK_MS / 1000;
/** HS256 wants a key at least as long as its 256-bit output. */
export const MIN_KEY_BYTES = 32;

export type VerifyFailure =
  | 'malformed'
  | 'bad_signature'
  | 'wrong_algorithm'
  | 'wrong_issuer'
  | 'wrong_audience'
  | 'expired'
  | 'invalid_claims';

export type VerifyResult = { ok: true; userId: number } | { ok: false; reason: VerifyFailure };

export class WeakKeyError extends Error {
  constructor() {
    super(`The JWT key must be at least ${MIN_KEY_BYTES} bytes`);
    this.name = 'WeakKeyError';
  }
}

function keyBytes(key: string): Uint8Array {
  const bytes = new TextEncoder().encode(key);
  if (bytes.length < MIN_KEY_BYTES) {
    throw new WeakKeyError();
  }
  return bytes;
}

/** Issue a token for a signed-in player. @param nowMs epoch milliseconds */
export async function signSessionToken(
  key: string,
  githubId: number,
  nowMs: number,
): Promise<string> {
  const issuedAt = Math.floor(nowMs / 1000);
  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(String(githubId))
    .setIssuer(JWT_ISSUER)
    .setAudience(JWT_AUDIENCE)
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + JWT_TTL_SECONDS)
    .sign(keyBytes(key));
}

const NUMERIC_SUBJECT = /^[1-9][0-9]{0,15}$/;

/**
 * Verify signature (HS256 only), issuer, audience and expiry, and read the player id from `sub`.
 * Failures return a reason for logs and tests; the api answers 401 for all of them without saying why.
 */
export async function verifySessionToken(
  key: string,
  token: string,
  nowMs: number,
): Promise<VerifyResult> {
  try {
    const { payload } = await jwtVerify(token, keyBytes(key), {
      algorithms: ['HS256'],
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
      requiredClaims: ['sub', 'exp', 'iat'],
      currentDate: new Date(nowMs),
    });
    const userId = Number(payload.sub);
    if (
      typeof payload.sub !== 'string' ||
      !NUMERIC_SUBJECT.test(payload.sub) ||
      !Number.isSafeInteger(userId)
    ) {
      return { ok: false, reason: 'invalid_claims' };
    }
    return { ok: true, userId };
  } catch (error) {
    if (error instanceof WeakKeyError) {
      throw error;
    }
    if (error instanceof errors.JWTExpired) {
      return { ok: false, reason: 'expired' };
    }
    if (error instanceof errors.JWTClaimValidationFailed) {
      if (error.claim === 'iss') {
        return { ok: false, reason: 'wrong_issuer' };
      }
      return { ok: false, reason: error.claim === 'aud' ? 'wrong_audience' : 'invalid_claims' };
    }
    if (error instanceof errors.JWSSignatureVerificationFailed) {
      return { ok: false, reason: 'bad_signature' };
    }
    if (error instanceof errors.JOSEAlgNotAllowed) {
      return { ok: false, reason: 'wrong_algorithm' };
    }
    return { ok: false, reason: 'malformed' };
  }
}
