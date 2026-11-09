import { describe, expect, it } from 'vitest';
import { ApiError } from './api';
import { describeError } from './errors';

/** Every 409 code the backend emits (docs/api-contract.md and the backend's list). */
const CONFLICT_CODES = [
  'shop_closed',
  'no_such_slot',
  'sold_out',
  'insufficient_gold',
  'no_free_slot',
  'deck_full',
  'already_owned',
  'pack_not_bought',
  'already_picked',
  'bad_option',
  'no_free_pack',
  'no_legendary_offer',
  'not_held',
  'not_in_deck',
  'window_closed',
  'not_in_hand',
  'already_played',
  'play_limit',
  'conflict',
];

describe('describeError', () => {
  it.each(CONFLICT_CODES)('has words for the 409 code %s', (code) => {
    const message = describeError(new ApiError(409, 'The server answered 409.', code));
    expect(message).not.toBe('The server answered 409.');
    expect(message).not.toContain(code);
    expect(message.length).toBeGreaterThan(10);
    expect(message.endsWith('.')).toBe(true);
  });

  it('gives each code its own sentence', () => {
    const messages = CONFLICT_CODES.map((code) => describeError(new ApiError(409, 'x', code)));
    expect(new Set(messages).size).toBe(CONFLICT_CODES.length);
  });

  it('says the few that players meet most in plain words', () => {
    expect(describeError(new ApiError(409, 'x', 'insufficient_gold'))).toBe('Not enough gold.');
    expect(describeError(new ApiError(409, 'x', 'no_free_slot'))).toBe(
      'Your Charm slots are full. Sell a Charm first.',
    );
    expect(describeError(new ApiError(409, 'x', 'window_closed'))).toBe(
      'The Pledge window closed on Tuesday at 23:59 UTC.',
    );
    expect(describeError(new ApiError(400, 'x', 'confirm_mismatch'))).toBe(
      'That is not your GitHub login. Nothing was deleted.',
    );
  });

  it('falls back on the status when there is no known code', () => {
    expect(describeError(new ApiError(0, 'offline'))).toBe(
      'Could not reach the server. Try again.',
    );
    expect(describeError(new ApiError(404, 'The server answered 404.'))).toBe(
      'This server does not offer that yet.',
    );
    expect(describeError(new ApiError(404, 'x', 'no_profile'))).toBe(
      'This account has no character yet. Sign in again.',
    );
    expect(describeError(new ApiError(413, 'x'))).toBe('That request was too large to send.');
    expect(describeError(new ApiError(429, 'x'))).toBe(
      'Too many requests. Wait a moment and try again.',
    );
    expect(describeError(new ApiError(500, 'The server answered 500.'))).toBe(
      'The server answered 500.',
    );
    expect(describeError(new ApiError(409, 'Some new thing.', 'brand_new_code'))).toBe(
      'Some new thing.',
    );
  });

  it('copes with something that is not an ApiError', () => {
    expect(describeError(new Error('boom'))).toBe('Something went wrong. Try again.');
    expect(describeError('boom')).toBe('Something went wrong. Try again.');
  });
});
