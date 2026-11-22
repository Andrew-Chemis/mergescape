import { describe, expect, it } from 'vitest';
import {
  JWT_AUDIENCE,
  JWT_ISSUER,
  JWT_TTL_SECONDS,
  signSessionToken,
  verifySessionToken,
  WeakKeyError,
} from '../src/jwt';
import { forgeToken, JWT_KEY } from './api-harness';
import { START } from './harness';

const OTHER_KEY = 'another-key-0123456789abcdef0123456789abcdef';

describe('session tokens', () => {
  it('round-trips the numeric GitHub id as a string subject, HS256, seven days', async () => {
    const token = await signSessionToken(JWT_KEY, 1001001, START);
    const [header, payload] = token
      .split('.')
      .slice(0, 2)
      .map(
        (part) =>
          JSON.parse(Buffer.from(part ?? '', 'base64url').toString('utf8')) as Record<
            string,
            unknown
          >,
      );
    expect(header).toMatchObject({ alg: 'HS256' });
    expect(payload).toEqual({
      sub: '1001001',
      iss: JWT_ISSUER,
      aud: JWT_AUDIENCE,
      iat: START / 1000,
      exp: START / 1000 + JWT_TTL_SECONDS,
    });
    expect(await verifySessionToken(JWT_KEY, token, START)).toEqual({ ok: true, userId: 1001001 });
  });

  it('fails a bad signature', async () => {
    const token = await signSessionToken(OTHER_KEY, 1001001, START);
    expect(await verifySessionToken(JWT_KEY, token, START)).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
  });

  it('fails the wrong audience and the wrong issuer', async () => {
    expect(
      await verifySessionToken(JWT_KEY, await forgeToken({ aud: 'mergescape' }), START),
    ).toEqual({
      ok: false,
      reason: 'wrong_audience',
    });
    expect(await verifySessionToken(JWT_KEY, await forgeToken({ iss: 'github' }), START)).toEqual({
      ok: false,
      reason: 'wrong_issuer',
    });
  });

  it('fails an expired token exactly at expiry', async () => {
    const token = await signSessionToken(JWT_KEY, 1001001, START);
    const expiry = START + JWT_TTL_SECONDS * 1000;
    expect(await verifySessionToken(JWT_KEY, token, expiry - 1000)).toMatchObject({ ok: true });
    expect(await verifySessionToken(JWT_KEY, token, expiry)).toEqual({
      ok: false,
      reason: 'expired',
    });
    expect(await verifySessionToken(JWT_KEY, token, expiry + 86_400_000)).toEqual({
      ok: false,
      reason: 'expired',
    });
  });

  it('fails other algorithms, a bad subject and garbage', async () => {
    expect(await verifySessionToken(JWT_KEY, await forgeToken({ alg: 'HS384' }), START)).toEqual({
      ok: false,
      reason: 'wrong_algorithm',
    });
    for (const sub of ['octocat', '0', '-5', '1.5', '12345678901234567890']) {
      expect(await verifySessionToken(JWT_KEY, await forgeToken({ sub }), START)).toEqual({
        ok: false,
        reason: 'invalid_claims',
      });
    }
    for (const token of ['', 'abc', 'a.b.c', '....', `${'x'.repeat(50)}.${'y'.repeat(50)}.`]) {
      expect(await verifySessionToken(JWT_KEY, token, START)).toEqual({
        ok: false,
        reason: 'malformed',
      });
    }
  });

  it('refuses a key shorter than 256 bits when signing and when verifying', async () => {
    await expect(signSessionToken('short', 1, START)).rejects.toThrow(WeakKeyError);
    await expect(verifySessionToken('short', 'a.b.c', START)).rejects.toThrow(WeakKeyError);
  });
});
