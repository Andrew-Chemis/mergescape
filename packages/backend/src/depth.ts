/**
 * The depth-layer mutations (tasks.md 22, Requirements 15 to 17): sending and collecting expeditions,
 * opening Charm packs, starting and collecting Forge orders, buying station upgrades and cape colours,
 * equipping gear and pets, and pinning Feats, plus the one setting a player has (whether the public badge
 * may show them, Requirement 11.4). Each takes a client request id and either applies once or
 * answers the same way again, exactly as the shop does (`mutations.ts`):
 *
 *   1. the `WEEK#` write comes first and is conditional on the week's `version`. It is the lock between two
 *      requests of one player and records the request id, which is what makes a replay a no-op;
 *   2. an expedition or Forge order that is being collected is claimed next, with one conditional write
 *      that flips `collected` from false to true on its `EXPEDITION#` / `JOB#` item and stores what the
 *      roll made. Of two collects of one trip exactly one passes the flip, so the loot is rolled and stored
 *      once;
 *   3. the profile write follows, conditional on the profile `version` (a scored event may have landed in
 *      between). If it conflicts, the request is planned again on the fresh profile. If it fails now (another
 *      request collected the same trip, or sent one first) step 1 is undone and the request answers 409, or,
 *      when the profile already holds the result, answers it without writing again;
 *   4. the durable records follow the profile write: the `EXPEDITION#` / `JOB#` item of a trip or order that
 *      was started, and a `FEAT#` item per Feat the request unlocked.
 *
 * The profile is the authority for what the player has, so a crash between steps leaves a state that a
 * retry completes: a claimed expedition whose profile write never happened is applied by the next collect
 * (the claim fails, the loot rolled again from the same seed is identical, and the guarded profile write
 * applies it once).
 *
 * Every rule is a shared pure function (`plan` below only chooses which one); this module orders the writes.
 */
import {
  buyUpgrade,
  collectExpedition,
  collectJob,
  equipGear,
  equipPet,
  forgeOf,
  openLootPack,
  pinFeat,
  playerWithRun,
  recordWorldEvent,
  sendExpedition,
  setCapeColor,
  startJob,
  unequipGear,
  unpinFeat,
} from '@mergescape/shared';
import type {
  CapeColor,
  ExpeditionChoice,
  ExpeditionState,
  FeatUnlock,
  ForgeJob,
  GearPiece,
  GearSlot,
  LootItem,
  PlayerState,
  RegionId,
  StationId,
  UpgradeId,
} from '@mergescape/shared';
import { VersionConflictError } from './db';
import type { ProfilePatch } from './db';
import { applyFeats, writeFeats } from './feat-flow';
import type { Logger } from './log';
import { MAX_REQUEST_IDS } from './mutations';
import { depthPatch, runWithScorerState, shopPatch, toPlayerState } from './player';
import { loadCurrent } from './runs';
import type { Current, RunContext } from './runs';
import { randomSeed } from './seed';

/** Retries of the week lock, and of the profile write, before giving up. */
const MAX_ATTEMPTS = 6;

export type DepthRequest =
  | { type: 'expedition_send'; region: RegionId; choice: ExpeditionChoice }
  | { type: 'expedition_collect' }
  | { type: 'pack_open'; seed: number; charmId: string }
  | { type: 'forge_start'; recipeId: string; pieceId?: string }
  | { type: 'forge_collect'; station: StationId }
  | { type: 'forge_upgrade'; upgrade: UpgradeId }
  | { type: 'forge_dye'; capeColor: CapeColor | null }
  | { type: 'equip'; pieceId: string }
  | { type: 'unequip'; slot: GearSlot }
  | { type: 'equip_pet'; petId: string }
  | { type: 'pin'; featId: string; pinned: boolean }
  | { type: 'settings'; badgePublic: boolean };

export interface DepthContext extends RunContext {
  log: Logger;
  /** The seed of an expedition or Forge order started by this request (a random uint32 in production). */
  seed?: () => number;
}

/** What a request answers beyond the player: the parts of the contract's responses that are not `me`. */
export interface DepthResult {
  /** The trip sent or collected (or the latest, on a replay). */
  expedition: ExpeditionState | null;
  loot: LootItem[];
  /** True when this request granted the loot or the piece; false when it was already granted. */
  applied: boolean;
  /** The piece a collected order made. */
  piece: GearPiece | null;
  /** Feats this request unlocked. */
  featsUnlocked: string[];
}

export type DepthOutcome =
  | { status: 200; current: Current; result: DepthResult }
  | { status: 404; error: string }
  | { status: 409; error: string };

/** The writes that go with a planned change, besides the profile. */
interface Effects {
  /** A trip just sent: recorded after the profile write. */
  sent: ExpeditionState | null;
  /** A trip being collected: claimed before the profile write. */
  collectedTrip: ExpeditionState | null;
  /** An order just started: recorded after the profile write. */
  started: ForgeJob | null;
  /** An order being collected: claimed before the profile write. */
  collectedJob: ForgeJob | null;
  /** Feats the change unlocked: recorded after the profile write. */
  unlocked: FeatUnlock[];
}

type Planned =
  | { ok: true; player: PlayerState; effects: Effects; result: DepthResult }
  | { ok: false; status: 404 | 409; error: string };

const NO_EFFECTS: Effects = {
  sent: null,
  collectedTrip: null,
  started: null,
  collectedJob: null,
  unlocked: [],
};

const NO_RESULT: DepthResult = {
  expedition: null,
  loot: [],
  applied: false,
  piece: null,
  featsUnlocked: [],
};

const fail = (status: 404 | 409, error: string): Planned => ({ ok: false, status, error });

function change(
  player: PlayerState,
  parts: { effects?: Partial<Effects>; result?: Partial<DepthResult> } = {},
): Planned {
  return {
    ok: true,
    player,
    effects: { ...NO_EFFECTS, ...parts.effects },
    result: { ...NO_RESULT, ...parts.result },
  };
}

/** Apply a request to a player with the shared rules. Pure; `seed` fixes any roll the request starts. */
export function plan(
  request: DepthRequest,
  player: PlayerState,
  now: number,
  seed: number,
): Planned {
  switch (request.type) {
    case 'expedition_send': {
      const sent = sendExpedition(player, request.region, request.choice, now, seed);
      return sent.ok
        ? change(sent.player, {
            effects: { sent: sent.expedition },
            result: { expedition: sent.expedition },
          })
        : fail(409, sent.error);
    }
    case 'expedition_collect': {
      const latest = player.expedition ?? null;
      if (latest === null) {
        return fail(404, 'no_expedition');
      }
      const collected = collectExpedition(player, latest, now);
      if (!collected.ok) {
        return fail(409, collected.error);
      }
      if (!collected.applied) {
        return change(player, {
          result: { expedition: collected.expedition, loot: collected.loot },
        });
      }
      // The trip is counted toward the World Feats (Spelunker, Cartographer, Unreferenced, The Old Coin), and
      // a pet in the loot can complete the Collector.
      const settled = applyFeats(
        collected.player,
        recordWorldEvent(
          collected.player,
          { kind: 'expedition_collected', region: latest.region, loot: collected.loot },
          now,
        ),
        now,
      );
      return change(settled.player, {
        effects: { collectedTrip: collected.expedition, unlocked: settled.unlocked },
        result: { expedition: collected.expedition, loot: collected.loot, applied: true },
      });
    }
    case 'pack_open': {
      const opened = openLootPack(player, request.seed, request.charmId);
      return opened.ok ? change(opened.player) : fail(409, opened.error);
    }
    case 'forge_start': {
      const started = startJob(player, request.recipeId, now, {
        seed,
        ...(request.pieceId !== undefined ? { pieceId: request.pieceId } : {}),
      });
      return started.ok
        ? change(started.player, { effects: { started: started.job } })
        : fail(409, started.error);
    }
    case 'forge_collect': {
      const collected = collectJob(player, request.station, now);
      if (!collected.ok) {
        return fail(409, collected.error);
      }
      return collected.applied
        ? change(collected.player, {
            effects: { collectedJob: collected.job },
            result: { piece: collected.piece, applied: true },
          })
        : change(player, { result: { piece: collected.piece } });
    }
    case 'forge_upgrade': {
      const bought = buyUpgrade(player, request.upgrade);
      return bought.ok ? change(bought.player) : fail(409, bought.error);
    }
    case 'forge_dye': {
      const dyed = setCapeColor(player, request.capeColor);
      // The contract names the missing upgrade `dyes_required`.
      return dyed.ok ? change(dyed.player) : fail(409, 'dyes_required');
    }
    case 'equip': {
      const worn = equipGear(player, request.pieceId);
      return worn.ok ? change(worn.player) : fail(409, worn.error);
    }
    case 'unequip': {
      const bare = unequipGear(player, request.slot);
      return bare.ok ? change(bare.player) : fail(409, bare.error);
    }
    case 'equip_pet': {
      const worn = equipPet(player, request.petId);
      return worn.ok ? change(worn.player) : fail(409, worn.error);
    }
    case 'pin': {
      if (!request.pinned) {
        return change(unpinFeat(player, request.featId));
      }
      const pinned = pinFeat(player, request.featId);
      return pinned.ok ? change(pinned.player) : fail(409, pinned.error);
    }
    case 'settings':
      // A value, not a step: setting it twice is the same as setting it once.
      return change({ ...player, badgePublic: request.badgePublic });
  }
}

/** What a replayed request id answers: the state its first run left, with nothing granted again. */
export function replayResult(request: DepthRequest, player: PlayerState): DepthResult {
  switch (request.type) {
    case 'expedition_send':
      return { ...NO_RESULT, expedition: player.expedition ?? null };
    case 'expedition_collect':
      return {
        ...NO_RESULT,
        expedition: player.expedition ?? null,
        loot: player.expedition?.loot ?? [],
      };
    case 'forge_collect':
      return { ...NO_RESULT, piece: forgeOf(player).stations[request.station]?.output ?? null };
    default:
      return NO_RESULT;
  }
}

/** The profile fields a planned change writes. */
const patchOf = (before: PlayerState, after: PlayerState): ProfilePatch => ({
  ...shopPatch(before, after),
  ...depthPatch(before, after),
});

/** The id the `FEAT#` records of this request name as the event that unlocked them. */
function sourceOf(effects: Effects): string {
  return effects.collectedTrip ? `expedition-${effects.collectedTrip.sentAt}` : 'request';
}

/**
 * Run one depth mutation for a player. On 200 the caller builds the response from `current`, read back after
 * the writes (and the replayed state when `requestId` was already applied), and `result`.
 */
export async function mutateDepth(
  ctx: DepthContext,
  userId: number,
  requestId: string,
  request: DepthRequest,
): Promise<DepthOutcome> {
  const seed = (ctx.seed ?? randomSeed)();
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const current = await loadCurrent(ctx, userId);
    if (!current) {
      return { status: 404, error: 'no_profile' };
    }
    if (current.week.requestIds.includes(requestId)) {
      return { status: 200, current, result: replayResult(request, current.player) };
    }

    const planned = plan(request, current.player, ctx.now, seed);
    if (!planned.ok) {
      return planned;
    }
    if (Object.keys(patchOf(current.player, planned.player)).length === 0) {
      // Nothing to change (a repeat collect, unpinning what is not pinned): answer without a write.
      return { status: 200, current, result: planned.result };
    }

    // Step 1: the week write, which is the lock and the replay record.
    const requestIds = [...current.week.requestIds, requestId].slice(-MAX_REQUEST_IDS);
    const { weekKey } = current.run;
    if (
      !(await ctx.db.saveWeek(userId, weekKey, { version: current.week.version }, { requestIds }))
    ) {
      continue;
    }
    const undo = async (): Promise<void> => {
      // Put the week back as it was (it is still the version our write made it).
      const restored = await ctx.db.saveWeek(
        userId,
        weekKey,
        { version: current.week.version + 1 },
        { requestIds: current.week.requestIds },
      );
      if (!restored) {
        ctx.log.error('depth.undo_failed', { userId });
      }
    };

    let final = planned;
    let wrote = false;
    try {
      // Step 2: claim the loot or the piece, once.
      if (planned.effects.collectedTrip) {
        await ctx.db.claimExpedition(userId, planned.effects.collectedTrip, ctx.now);
      }
      if (planned.effects.collectedJob) {
        await ctx.db.claimJob(userId, planned.effects.collectedJob, ctx.now);
      }

      // Step 3: the profile write, planned again on the fresh profile if a scored event landed in between.
      const playerOf = (fresh: Parameters<typeof toPlayerState>[0]): PlayerState =>
        playerWithRun(toPlayerState(fresh), runWithScorerState(current.run, fresh));
      let expected = current.profile.version;
      let from = current.player;
      for (let tries = 0; ; tries += 1) {
        const patch = patchOf(from, final.player);
        if (Object.keys(patch).length === 0) {
          break;
        }
        try {
          await ctx.db.saveProfile(userId, expected, patch);
          wrote = true;
          break;
        } catch (error) {
          if (!(error instanceof VersionConflictError)) {
            throw error;
          }
        }
        const fresh = await ctx.db.getProfile(userId, true);
        if (!fresh) {
          await undo();
          return { status: 404, error: 'no_profile' };
        }
        const again = plan(request, playerOf(fresh), ctx.now, seed);
        if (!again.ok || tries + 1 >= MAX_ATTEMPTS) {
          await undo();
          return again.ok
            ? { status: 409, error: 'conflict' }
            : { status: again.status, error: again.error };
        }
        expected = fresh.version;
        from = playerOf(fresh);
        final = again;
      }
    } catch (error) {
      await undo();
      throw error;
    }

    // Step 4: the records. The profile already holds all of it, so a failure here is logged, not repeated.
    if (wrote) {
      try {
        if (final.effects.sent) {
          await ctx.db.putExpedition(userId, final.effects.sent);
        }
        if (final.effects.started) {
          await ctx.db.putJob(userId, final.effects.started);
        }
        await writeFeats(ctx.db, userId, final.effects.unlocked, ctx.now, sourceOf(final.effects));
      } catch (error) {
        ctx.log.error('depth.records_failed', { userId }, error);
      }
    }

    const settled = await loadCurrent(ctx, userId);
    if (!settled) {
      return { status: 404, error: 'no_profile' };
    }
    return {
      status: 200,
      current: settled,
      result: {
        ...final.result,
        applied: wrote && final.result.applied,
        featsUnlocked: wrote ? final.effects.unlocked.map((feat) => feat.id) : [],
      },
    };
  }
  return { status: 409, error: 'conflict' };
}
