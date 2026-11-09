/**
 * The shop, shrine and Pledge mutations (tasks.md 16, Requirements 8.6, 8.7, 9.3): each takes a client
 * request id and either applies once or answers the same way again.
 *
 * A mutation changes two items, the player's `WEEK#` item (shelves, hand, request ids) and their profile
 * (gold, Charms, Vouchers, deck). Without transactions the order is what keeps it honest:
 *
 *   1. the week write comes first and is conditional on the week's `version`. It is the lock: of two
 *      requests that raced for the same shelf slot exactly one passes, the other re-reads and gets
 *      `sold_out`. It also records the request id, which is what makes a replay a no-op;
 *   2. the profile write follows, conditional on the profile `version` (a scored event may have landed in
 *      between). If it conflicts, the purchase is computed again on the fresh profile against the run as it
 *      was before step 1. If that fails now (the gold went elsewhere), step 1 is undone and the request
 *      answers 409.
 *
 * Every rule is a shared pure function; this module only orders the writes.
 */
import {
  addToDeck,
  buyCharm,
  buyPack,
  buyVoucher,
  grantCharm,
  pickPackOption,
  playerWithRun,
  playPledge,
  removePledgeAtShrine,
  rerollShop,
  sellHeldCharm,
} from '@mergescape/shared';
import type { Charm, PackKind, PlayerState, RunState } from '@mergescape/shared';
import { VersionConflictError } from './db';
import type { WeekPatch } from './db';
import { freePackOptions } from './free-pack';
import type { Logger } from './log';
import { runWithScorerState, shopPatch, toPlayerState } from './player';
import { loadCurrent } from './runs';
import type { Current, RunContext } from './runs';

/** Request ids kept per week for replays (docs/api-contract.md). */
export const MAX_REQUEST_IDS = 20;

/** Retries of the week lock before giving up (each retry means another request changed the week). */
const MAX_ATTEMPTS = 6;

export type MutationRequest =
  | { type: 'buy'; kind: 'charm' | 'pack'; index: number }
  | { type: 'buy'; kind: 'voucher' | 'legendary' }
  | { type: 'pick'; index: number; option: number }
  | { type: 'reroll' }
  | { type: 'sell'; charmId: string }
  | { type: 'shrine'; pledgeId: string }
  | { type: 'play'; pledgeId: string };

export interface MutationContext extends RunContext {
  log: Logger;
}

export type MutationOutcome =
  { status: 200; current: Current } | { status: 404 } | { status: 409; error: string };

/** What a mutation reads and changes. */
interface State {
  player: PlayerState;
  run: RunState;
  freePack: PackKind | null;
  legendary: Charm | null;
}

type Applied = ({ ok: true } & State) | { ok: false; error: string };

const failed = (error: string): Applied => ({ ok: false, error });

/** Apply a request to a state with the shared rules. Pure; the error is the 409 code. */
function apply(request: MutationRequest, state: State, now: number): Applied {
  const { player, run } = state;
  const next = (changes: Partial<State>): Applied => ({ ok: true, ...state, ...changes });
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

/** The week fields a mutation changed, and the patch that puts them back. */
function weekPatches(
  before: State,
  after: State,
  requestIds: readonly string[],
  previousIds: readonly string[],
): { patch: WeekPatch; undo: WeekPatch } {
  const patch: WeekPatch = { requestIds };
  const undo: WeekPatch = { requestIds: previousIds };
  if (!same(before.run.shop, after.run.shop)) {
    patch.shop = after.run.shop;
    undo.shop = before.run.shop;
  }
  if (!same(before.run.played, after.run.played)) {
    patch.played = after.run.played;
    undo.played = before.run.played;
  }
  if (before.freePack !== after.freePack) {
    patch.freePack = after.freePack;
    undo.freePack = before.freePack;
  }
  if (!same(before.legendary, after.legendary)) {
    patch.legendary = after.legendary;
    undo.legendary = before.legendary;
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
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const current = await loadCurrent(ctx, userId);
    if (!current) {
      return { status: 404 };
    }
    if (current.week.requestIds.includes(requestId)) {
      return { status: 200, current };
    }

    const before: State = {
      player: current.player,
      run: current.run,
      freePack: current.week.freePack,
      legendary: current.week.legendary,
    };
    const applied = apply(request, before, ctx.now);
    if (!applied.ok) {
      return { status: 409, error: applied.error };
    }

    // Step 1: the week write, which is the lock and the replay record.
    const requestIds = [...current.week.requestIds, requestId].slice(-MAX_REQUEST_IDS);
    const { patch, undo } = weekPatches(before, applied, requestIds, current.week.requestIds);
    const { weekKey } = current.run;
    if (!(await ctx.db.saveWeek(userId, weekKey, { version: current.week.version }, patch))) {
      continue;
    }

    // Step 2: the profile write, redone on the fresh profile if a scored event landed in between.
    let expected = current.profile.version;
    let from = before.player;
    let to = applied.player;
    for (let tries = 0; ; tries += 1) {
      const profilePatch = shopPatch(from, to);
      if (Object.keys(profilePatch).length === 0) {
        break;
      }
      try {
        await ctx.db.saveProfile(userId, expected, profilePatch);
        break;
      } catch (error) {
        if (!(error instanceof VersionConflictError)) {
          throw error;
        }
      }
      const fresh = await ctx.db.getProfile(userId, true);
      const again = fresh
        ? apply(
            request,
            {
              ...before,
              player: playerWithRun(toPlayerState(fresh), runWithScorerState(before.run, fresh)),
            },
            ctx.now,
          )
        : failed('no_profile');
      if (!fresh || !again.ok || tries + 1 >= MAX_ATTEMPTS) {
        // Put the week back as it was (it is still the version our write made it).
        const restored = await ctx.db.saveWeek(
          userId,
          weekKey,
          { version: current.week.version + 1 },
          undo,
        );
        if (!restored) {
          ctx.log.error('mutation.undo_failed', { userId });
        }
        return { status: 409, error: again.ok ? 'conflict' : again.error };
      }
      expected = fresh.version;
      from = playerWithRun(toPlayerState(fresh), runWithScorerState(before.run, fresh));
      to = again.player;
    }

    const settled = await loadCurrent(ctx, userId);
    return settled ? { status: 200, current: settled } : { status: 404 };
  }
  return { status: 409, error: 'conflict' };
}
