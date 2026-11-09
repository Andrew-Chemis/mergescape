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
  already_owned: 'You already own that.',
  no_free_pack: 'There is no free pack waiting for you.',
  no_legendary_offer: 'There is no Legendary Charm on offer.',
  conflict: 'Something changed while you were choosing. Look again and try once more.',
  no_profile: 'This account has no character yet. Sign in again.',
  window_closed: 'The Pledge window closed on Tuesday at 23:59 UTC.',
  not_in_hand: 'That Pledge is not in your hand this week.',
  already_played: 'That Pledge is already in play.',
  play_limit: 'You can play up to 3 Pledges a week.',
  confirm_mismatch: 'That is not your GitHub login. Nothing was deleted.',
  // Expeditions and loot packs
  in_progress: 'Your character is still away. Collect when the timer runs out.',
  uncollected: 'The last expedition is waiting for you. Collect it first.',
  region_locked: 'That region is not open yet. It needs more Renown.',
  insufficient_provisions: 'Not enough Provisions. The 4 h Forage is always free.',
  not_returned: 'Your character is not back yet.',
  no_expedition: 'There is no expedition to collect.',
  no_such_pack: 'That Charm pack is no longer in your satchel.',
  // The Forge
  unknown_recipe: 'The station does not know that recipe.',
  station_busy: 'That station is busy. Collect its order or wait for it to finish.',
  tier_locked: 'You have not unlocked that tier yet.',
  insufficient_supplies: 'Not enough supplies for that.',
  piece_required: 'Choose a piece from your inventory first.',
  piece_not_found: 'That piece is no longer in your inventory.',
  no_job: 'That station has nothing to collect.',
  not_ready: 'That order is not finished yet.',
  dyes_required: 'Colouring a cape needs the Dyes upgrade from the Loom.',
  // Gear
  not_owned: 'You do not own that.',
  already_equipped: 'That is already equipped.',
  nothing_equipped: 'Nothing is equipped in that slot.',
  pet_slot: 'Pets go in the pet slot: choose the pet itself.',
  // Feats
  not_unlocked: 'That Feat is not unlocked yet.',
  already_pinned: 'That Feat is already pinned.',
  too_many_pinned: 'You can pin up to three Feats. Unpin one first.',
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
