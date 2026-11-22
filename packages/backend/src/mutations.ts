/**
 * The shop, shrine and Pledge mutations (tasks.md 16, Requirements 8.6, 8.7, 9.3): each takes a client
 * request id and either applies once or answers the same way again. The write order (the week lock, the
 * profile write that commits it, the undo) is `idempotent.ts`; this module says what a request changes. A shop
 * request changes the week (shelves, the Pledges played, a free pack or Legendary offer) and the profile (gold,
 * Charms, Vouchers, the deck), and if the purchase fails on the fresh profile the change to the week is
 * taken back.
 *
 * Every rule is a shared pure function; this module only chooses which one.
 */
import {
  addToDeck,
  buyCharm,
  buyPack,
  buyVoucher,
  grantCharm,
  pickPackOption,
  playPledge,
  removePledgeAtShrine,
  rerollShop,
  sellHeldCharm,
} from '@mergescape/shared';
import type { Charm, PackKind, PlayerState, RunState } from '@mergescape/shared';
import type { WeekFields } from './db';
import { freePackOptions } from './free-pack';
import { runIdempotentMutation } from './idempotent';
import type { MutationContext, Plan, Refusal, WeekChange } from './idempotent';
import { shopPatch } from './player';
import type { Current } from './runs';

export type MutationRequest =
  | { type: 'buy'; kind: 'charm' | 'pack'; index: number }
  | { type: 'buy'; kind: 'voucher' | 'legendary' }
  | { type: 'pick'; index: number; option: number }
  | { type: 'reroll' }
  | { type: 'sell'; charmId: string }
  | { type: 'shrine'; pledgeId: string }
  | { type: 'play'; pledgeId: string };

export type MutationOutcome = { status: 200; current: Current } | Refusal;

/** What a mutation reads and changes. */
interface State {
  player: PlayerState;
  run: RunState;
  freePack: PackKind | null;
  legendary: Charm | null;
}

const failed = (error: string): Plan<State> => ({ ok: false, status: 409, error });

/** Apply a request to a state with the shared rules. Pure; the error is the 409 code. */
function apply(request: MutationRequest, state: State, now: number): Plan<State> {
  const { player, run } = state;
  const next = (changes: Partial<State>): Plan<State> => ({ ok: true, ...state, ...changes });
  switch (request.type) {
    case 'buy': {
      if (request.kind === 'charm') {
        const bought = buyCharm(player, run, request.index);
        return bought.ok ? next({ player: bought.player, run: bought.run }) : failed(bought.error);
      }
      if (request.kind === 'pack') {
        const bought = buyPack(player, run, request.index);
        return bought.ok ? next({ player: bought.player, run: bought.run }) : failed(bought.error);
      }
      if (request.kind === 'voucher') {
        const bought = buyVoucher(player, run);
        return bought.ok ? next({ player: bought.player, run: bought.run }) : failed(bought.error);
      }
      // The Legendary offer of a 4th Renown is a gift of the Boss clear: it costs no gold, only a slot.
      if (state.legendary === null) {
        return failed('no_legendary_offer');
      }
      const granted = grantCharm(player, state.legendary);
      return granted.ok ? next({ player: granted.player, legendary: null }) : failed(granted.error);
    }
    case 'pick': {
      if (request.index !== -1) {
        const picked = pickPackOption(player, run, request.index, request.option);
        return picked.ok ? next({ player: picked.player, run: picked.run }) : failed(picked.error);
      }
      // Index -1 is the free Pledge pack of the Raid clear.
      if (state.freePack === null) {
        return failed('no_free_pack');
      }
      const kept = freePackOptions(run)[request.option];
      if (kept === undefined) {
        return failed('bad_option');
      }
      const added = addToDeck(player.deck, kept);
      return added.ok
        ? next({ player: { ...player, deck: added.deck }, freePack: null })
        : failed(added.error);
    }
    case 'reroll': {
      const rolled = rerollShop(player, run);
      return rolled.ok ? next({ player: rolled.player, run: rolled.run }) : failed(rolled.error);
    }
    case 'sell': {
      const sold = sellHeldCharm(player, request.charmId);
      return sold.ok ? next({ player: sold.player }) : failed(sold.error);
    }
    case 'shrine': {
      const removed = removePledgeAtShrine(player, request.pledgeId);
      return removed.ok ? next({ player: removed.player }) : failed(removed.error);
    }
    case 'play': {
      const played = playPledge(run, player, request.pledgeId, now);
      return played.ok ? next({ player: played.player, run: played.run }) : failed(played.error);
    }
  }
}

const same = (a: unknown, b: unknown): boolean =>
  JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** The parts of a state that live on the `WEEK#` item, under the names its patch uses. */
const weekParts = ({ run, freePack, legendary }: State) => ({
  shop: run.shop,
  played: run.played,
  freePack,
  legendary,
});

/** The week fields a mutation changed, and the patch that puts them back. */
function weekChange(before: State, after: State): WeekChange {
  const was = weekParts(before);
  const now = weekParts(after);
  const patch: WeekFields = {};
  const undo: WeekFields = {};
  for (const field of Object.keys(was) as (keyof typeof was)[]) {
    if (!same(was[field], now[field])) {
      Object.assign(patch, { [field]: now[field] });
      Object.assign(undo, { [field]: was[field] });
    }
  }
  return { patch, undo };
}

/**
 * Run one mutation for a player. On 200 the caller builds the response from `current`, which is read
 * back after the writes (and is the replayed state when `requestId` was already applied).
 */
export async function mutate(
  ctx: MutationContext,
  userId: number,
  requestId: string,
  request: MutationRequest,
): Promise<MutationOutcome> {
  const stateOf = (player: PlayerState, current: Current): State => ({
    player,
    run: current.run,
    freePack: current.week.freePack,
    legendary: current.week.legendary,
  });
  const outcome = await runIdempotentMutation<State>(ctx, userId, requestId, {
    name: 'mutation',
    plan: (player, current) => apply(request, stateOf(player, current), ctx.now),
    profilePatch: shopPatch,
    weekChange: (current, planned) => weekChange(stateOf(current.player, current), planned),
  });
  return outcome.status === 200 ? { status: 200, current: outcome.current } : outcome;
}
