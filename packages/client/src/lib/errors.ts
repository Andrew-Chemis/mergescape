/**
 * Words for the api's typed errors, shown inline next to the control that failed (docs/api-contract.md:
 * 409 shop and Pledge errors are never a modal). The codes are the ones in `@mergescape/shared`
 * (`ShopError`, `PlayError`, `GoldError`) plus `confirm_mismatch` from `POST /delete`.
 */
import { ApiError } from './api';

const MESSAGES: Readonly<Record<string, string>> = {
  insufficient_gold: 'Not enough gold.',
  invalid_amount: 'That price is not valid. Reload and try again.',
  sold_out: 'That one is already sold.',
  shop_closed: 'The shop is closed. It opens when you clear an act.',
  no_such_slot: 'That shelf is empty.',
  no_free_slot: 'Your Charm slots are full. Sell a Charm first.',
  deck_full: 'Your Pledge deck is full at 20. Remove a Pledge at the shrine first.',
  pack_not_bought: 'Buy that pack before opening it.',
  already_picked: 'You already kept a card from that pack.',
  bad_option: 'That card is not in the pack.',
  not_held: 'You no longer hold that Charm.',
  not_in_deck: 'That Pledge is not in your deck.',
  already_owned: 'You already own that Voucher.',
  no_free_pack: 'There is no free pack waiting for you.',
  no_legendary_offer: 'There is no Legendary Charm on offer.',
  conflict: 'Something changed while you were choosing. Look again and try once more.',
  no_profile: 'This account has no character yet. Sign in again.',
  window_closed: 'The Pledge window closed on Tuesday at 23:59 UTC.',
  not_in_hand: 'That Pledge is not in your hand this week.',
  already_played: 'That Pledge is already in play.',
  play_limit: 'You can play up to 3 Pledges a week.',
  confirm_mismatch: 'That is not your GitHub login. Nothing was deleted.',
};

/** The sentence to show beside a control whose request failed. */
export function describeError(error: unknown): string {
  if (!(error instanceof ApiError)) {
    return 'Something went wrong. Try again.';
  }
  if (error.code && MESSAGES[error.code]) {
    return MESSAGES[error.code] as string;
  }
  if (error.status === 0) {
    return 'Could not reach the server. Try again.';
  }
  if (error.status === 404) {
    return 'This server does not offer that yet.';
  }
  if (error.status === 413) {
    return 'That request was too large to send.';
  }
  if (error.status === 429) {
    return 'Too many requests. Wait a moment and try again.';
  }
  return error.message;
}

/** The outcome of an action the player took, for the control that took it. */
export type ActionResult =
  { ok: true } | { ok: false; status: number; code: string | null; message: string };
