/**
 * The depth-layer mutations (tasks.md 22, Requirements 15 to 17): sending and collecting expeditions,
 * opening Charm packs, starting and collecting Forge orders, buying station upgrades and cape colours,
 * equipping gear and pets, and pinning Feats, plus the one setting a player has (whether the public badge
 * may show them, Requirement 11.4). Each takes a client request id and either applies once or
 * answers the same way again, exactly as the shop does (`mutations.ts`), through the one write protocol of
 * `idempotent.ts`. What is specific to these requests:
 *
 *   - the profile write is the guard. Of two collects of one trip exactly one passes it (the other finds the
 *     trip collected on the fresh profile and applies nothing), so the loot, which is a pure function of the
 *     seed stored at the send, is granted once;
 *   - the durable records follow the profile write, so a refused request leaves none behind: the
 *     `EXPEDITION#` / `JOB#` item of a trip or order that was started, the same items flipped to `collected`
 *     (with what the roll made) for one that was collected, and a `FEAT#` item per Feat the request unlocked.
 *     The profile already holds all of it, so a record that fails to write is logged and the profile stays
 *     right (the next collect of the same trip finds it collected and writes nothing).
 *
 * Every rule is a shared pure function (`plan` below only chooses which one).
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
import type { ProfilePatch } from './db';
import { applyFeats, writeFeats } from './feat-flow';
import { runIdempotentMutation } from './idempotent';
import type { MutationContext, Plan, Refusal } from './idempotent';
import { depthPatch, shopPatch } from './player';
import type { Current } from './runs';
import { randomSeed } from './seed';

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

export interface DepthContext extends MutationContext {
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

export type DepthOutcome = { status: 200; current: Current; result: DepthResult } | Refusal;

/** The writes that go with a planned change, besides the profile. */
interface Effects {
  /** A trip just sent: recorded after the profile write. */
  sent: ExpeditionState | null;
  /** A trip being collected: its record is flipped to collected after the profile write. */
  collectedTrip: ExpeditionState | null;
  /** An order just started: recorded after the profile write. */
  started: ForgeJob | null;
  /** An order being collected: its record is flipped to collected after the profile write. */
  collectedJob: ForgeJob | null;
  /** Feats the change unlocked: recorded after the profile write. */
  unlocked: FeatUnlock[];
}

/** What a depth plan carries beside the player it changes. */
interface Change {
  effects: Effects;
  result: DepthResult;
}

type Planned = Plan<Change>;

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

/** A shared rule that only changes the player: the new player, or the rule's error as a 409. */
const done = (result: { ok: true; player: PlayerState } | { ok: false; error: string }): Planned =>
  result.ok ? change(result.player) : fail(409, result.error);

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
    case 'pack_open':
      return done(openLootPack(player, request.seed, request.charmId));
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
    case 'forge_upgrade':
      return done(buyUpgrade(player, request.upgrade));
    case 'forge_dye': {
      const dyed = setCapeColor(player, request.capeColor);
      // The contract names the missing upgrade `dyes_required`.
      return dyed.ok ? change(dyed.player) : fail(409, 'dyes_required');
    }
    case 'equip':
      return done(equipGear(player, request.pieceId));
    case 'unequip':
      return done(unequipGear(player, request.slot));
    case 'equip_pet':
      return done(equipPet(player, request.petId));
    case 'pin':
      return request.pinned
        ? done(pinFeat(player, request.featId))
        : change(unpinFeat(player, request.featId));
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
  const outcome = await runIdempotentMutation<Change>(ctx, userId, requestId, {
    name: 'depth',
    plan: (player) => plan(request, player, ctx.now, seed),
    profilePatch: patchOf,
    // The records, independent of one another, once the profile holds the request.
    async afterProfile({ effects }) {
      await Promise.all([
        effects.sent ? ctx.db.putExpedition(userId, effects.sent) : null,
        effects.started ? ctx.db.putJob(userId, effects.started) : null,
        effects.collectedTrip
          ? ctx.db.claimExpedition(userId, effects.collectedTrip, ctx.now)
          : null,
        effects.collectedJob ? ctx.db.claimJob(userId, effects.collectedJob, ctx.now) : null,
        writeFeats(ctx.db, userId, effects.unlocked, ctx.now, sourceOf(effects)),
      ]);
    },
  });
  if (outcome.status !== 200) {
    return outcome;
  }
  const { current, planned, wrote } = outcome;
  if (planned === null) {
    return { status: 200, current, result: replayResult(request, current.player) };
  }
  return {
    status: 200,
    current,
    result: {
      ...planned.result,
      applied: wrote && planned.result.applied,
      featsUnlocked: wrote ? planned.effects.unlocked.map((feat) => feat.id) : [],
    },
  };
}
