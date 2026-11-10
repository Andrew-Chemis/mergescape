import { describe, expect, it } from 'vitest';
import { ApiError, SIGN_IN_ERROR_CODES } from './api';
import type { SignInProblem } from './api';
import { describeError, describeSignInProblem } from './errors';

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
  // The depth layer (docs/api-contract.md, tasks 22 and 23)
  'in_progress',
  'uncollected',
  'region_locked',
  'insufficient_provisions',
  'not_returned',
  'no_expedition',
  'no_such_pack',
  'unknown_recipe',
  'station_busy',
  'tier_locked',
  'insufficient_supplies',
  'piece_required',
  'piece_not_found',
  'no_job',
  'not_ready',
  'dyes_required',
  'not_owned',
  'already_equipped',
  'nothing_equipped',
  'pet_slot',
  'not_unlocked',
  'already_pinned',
  'too_many_pinned',
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

  it('gives an export that is too large its own words, not the generic 413 sentence', () => {
    const message = describeError(new ApiError(413, 'x', 'export_too_large'));
    expect(message).toContain('export');
    expect(message).toContain('4 MiB');
    expect(message).not.toBe(describeError(new ApiError(413, 'x')));
  });

  it('copes with something that is not an ApiError', () => {
    expect(describeError(new Error('boom'))).toBe('Something went wrong. Try again.');
    expect(describeError('boom')).toBe('Something went wrong. Try again.');
  });
});

describe('describeSignInProblem', () => {
  const problems: SignInProblem[] = [...SIGN_IN_ERROR_CODES, 'storage_blocked', 'unknown'];

  it('has a sentence for every code the api redirects with, and for the two the client adds', () => {
    const messages = problems.map((problem) => describeSignInProblem(problem));
    expect(new Set(messages).size).toBe(problems.length);
    for (const message of messages) {
      expect(message.length).toBeGreaterThan(20);
      expect(message).toMatch(/[.]$/);
    }
  });

  it('says what blocked storage means for the player', () => {
    expect(describeSignInProblem('storage_blocked')).toContain('blocks site storage');
  });
});
