/**
 * An `Api` that answers from fixture state, so the whole client runs offline (`?fixture=1`, or no
 * `VITE_API_ORIGIN`). With `live`, one extra Merge Goblin row "arrives" after a delay and pushes the
 * character over a level, which exercises the score ticker and the level-up flash end to end.
 *
 * The shop, shrine, Pledge and Settings calls change a local copy of the fixture state, so the Shop is
 * clickable offline: gold goes down, Charms and Pledges move, and the same typed 409 errors the real api
 * answers with (`insufficient_gold`, `sold_out`, `shop_closed`, `window_closed`, ...) come back when a rule
 * is broken. The rules here are a small stand-in for the backend's, not a second copy of them.
 *
 * The depth layer (expeditions, the Forge, gear, Feats) runs the real rules: a write builds the shared
 * package's `PlayerState` from the fixture profile, calls the same pure function the backend calls
 * (`sendExpedition`, `collectJob`, `equipGear`, `pinFeat`, ...) and copies the answer back, so the typed
 * 409 codes and the loot a seed rolls are the production ones. The clock is the fixture's own: "now" is
 * the instant it was built plus the real time since, so a returned expedition stays returned and a
 * working order finishes on schedule.
 */
import {
  buyUpgrade,
  CHARM_PRICE_BY_RARITY,
  charmSellPrice,
  collectExpedition,
  collectJob,
  createPlayerState,
  DECK_CAP,
  emptySatchel,
  equipGear,
  equipPet,
  featBonusFor,
  forgeOf,
  grantPet,
  loadoutOf,
  lootPackOptions,
  openLootPack,
  pinFeat,
  PLEDGE_PLAY_LIMIT,
  pledgeDefinition,
  sendExpedition,
  setCapeColor,
  startJob,
  unequipGear,
  uniqueDefinition,
  uniquePiece,
  unpinFeat,
  featDefinition,
} from '@mergescape/shared';
import type {
  CapeColor,
  Charm,
  GearPiece,
  GearSlot,
  Pledge,
  PlayerState,
} from '@mergescape/shared';
import { ApiError } from '../api';
import type { Api, ShopBuyInput, ShopPickInput } from '../api';
import { expeditionViewFrom, forgeViewFrom } from '../depth';
import type {
  FeatView,
  InstallationsResponse,
  LogEntry,
  LogResponse,
  MeResponse,
  MutationResponse,
  PackKind,
  ShopOption,
  ShopView,
  WeekSummary,
} from '../types';
import { FIXTURE_COLLECT_UNLOCKS, fixtureFeats } from './depth';
import {
  fixtureCharm,
  fixtureInstallations,
  fixtureLogEntries,
  fixtureMe,
  fixturePackOptions,
  FIXTURE_PAGE_SIZE,
  pageOf,
  type FixtureVariant,
} from './state';
import { RAW_LOG } from './raw-log';

export interface FixtureApiOptions {
  /** The instant the fixture treats as "now" (timestamps are relative to it). Default: the clock. */
  now?: number;
  variant?: FixtureVariant;
  /** Rows per page. */
  pageSize?: number;
  /** Simulated network delay in ms. Default 0. */
  latencyMs?: number;
  /** After this many ms one new row arrives (variant `active` only). Omit for a static fixture. */
  liveAfterMs?: number;
  /** Fields of the run to replace (a free pack, a Legendary offer, an open Pledge window, ...). */
  week?: Partial<WeekSummary>;
  /** Fields of the profile to replace (own the Dyes, empty the satchel, ...), for tests and demos. */
  me?: Partial<MeResponse>;
  /** Feats to show instead of the six the variant has. */
  feats?: FeatView[];
}

const FIXTURE_CLOCK = () => Date.now();

/** Charms the fixture shop re-rolls through, in a fixed order so a re-roll is reproducible. */
const REROLL_CHARMS = [
  'rubber-duck',
  'small-hands',
  'hot-potato',
  'second-pair-of-eyes',
  'lantern',
  'grey-beard',
];
const PACK_KINDS: readonly PackKind[] = ['pledge', 'charm', 'cosmetic'];
const INTEREST_PER = 25;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** A typed refusal, the same shape the real api answers with. */
function refuse(code: string, status = 409): ApiError {
  return new ApiError(status, `The server refused: ${code}.`, code);
}

export function createFixtureApi(options: FixtureApiOptions = {}): Api {
  const start = options.now ?? FIXTURE_CLOCK();
  const variant = options.variant ?? 'active';
  const pageSize = options.pageSize ?? FIXTURE_PAGE_SIZE;
  const created = FIXTURE_CLOCK();

  let base = fixtureLogEntries(start, variant);
  // The mutable world the writes change. `me.week` is kept the same object as `week`.
  let me: MeResponse = fixtureMe(start, variant, options.week, options.me);
  let week: WeekSummary | null = me.week;
  let rerolls = 0;
  let feats: FeatView[] = options.feats ? clone(options.feats) : fixtureFeats(start, variant);
  /** Expeditions and orders sent so far, to give each its own seed. */
  let sends = 0;

  /** The fixture's "now": when it was built, plus the real time since. */
  function fixtureNow(): number {
    return start + (FIXTURE_CLOCK() - created);
  }

  /** The arrived row: a copy of the newest scored merge with a new PR number, stamped at arrival. */
  function liveEntry(): LogEntry | null {
    const template = RAW_LOG[0]?.row;
    if (!template || variant !== 'active' || options.liveAfterMs === undefined) {
      return null;
    }
    if (FIXTURE_CLOCK() - created < options.liveAfterMs) {
      return null;
    }
    const at = new Date(created + options.liveAfterMs).toISOString();
    return { ...template, id: `${at}#fixture-live`, at, prNumber: (template.prNumber ?? 0) + 19 };
  }

  function entries(): LogEntry[] {
    const live = liveEntry();
    return live ? [live, ...base] : base;
  }

  async function delay<T>(value: T): Promise<T> {
    if (options.latencyMs) {
      await new Promise((resolve) => setTimeout(resolve, options.latencyMs));
    }
    return value;
  }

  /** The world as a client would read it: the stored state plus the live row, if it has arrived. */
  function snapshot(): MeResponse {
    const view = clone(me);
    view.week = week ? clone(week) : null;
    const live = liveEntry();
    if (live && view.week) {
      view.xp += live.xp;
      view.gold += Math.floor(live.points / 10);
      view.skillXp = {
        ...view.skillXp,
        smithing: view.skillXp.smithing + live.skillXp.smithing,
      };
      view.week = { ...view.week, weeklyXp: view.week.weeklyXp + live.xp };
    }
    return view;
  }

  // -------------------------------------------------------------------------------------------
  // The writes
  // -------------------------------------------------------------------------------------------

  function openShop(): ShopView {
    if (!week?.shop) {
      throw refuse('shop_closed');
    }
    return week.shop;
  }

  function spend(price: number): void {
    if (me.gold < price) {
      throw refuse('insufficient_gold');
    }
    me.gold -= price;
  }

  function owns(id: string): boolean {
    return me.vouchers.some((voucher) => voucher === id);
  }

  /** Re-derive the numbers that depend on gold, Vouchers and re-rolls. */
  function recompute(): void {
    const shop = week?.shop;
    if (!shop) {
      return;
    }
    shop.rerollCost = (owns('cheaper-rerolls') ? 10 : 20) + 10 * rerolls;
    shop.shrineCost = owns('shrine-pass') ? 0 : 50;
    shop.interestPreview = Math.min(
      Math.floor(me.gold / INTEREST_PER),
      owns('deep-pockets') ? 20 : 10,
    );
  }

  /** Give the player a Charm: stack a duplicate once, auto-sell a third copy, or take a free slot. */
  function addCharm(charm: Charm): void {
    const held = me.charms.find((candidate) => candidate.id === charm.id);
    if (held) {
      if ((held.copies ?? 1) >= 2) {
        me.gold += charmSellPrice(charm.rarity);
      } else {
        held.copies = 2;
      }
    } else if (me.charms.length >= me.charmSlots) {
      throw refuse('no_free_slot');
    } else {
      me.charms.push({ ...charm });
    }
    if (week?.shop) {
      week.shop.sellPrices[charm.id] = charmSellPrice(charm.rarity);
    }
  }

  function addPledge(pledge: Pledge): void {
    if (me.deck.length >= DECK_CAP) {
      throw refuse('deck_full');
    }
    me.deck.push({ ...pledge });
  }

  function answer(): MutationResponse {
    recompute();
    const view = snapshot();
    return { me: view, week: view.week as WeekSummary };
  }

  function buy(input: ShopBuyInput): void {
    if (input.kind === 'legendary') {
      if (!week?.legendaryOffer) {
        throw refuse('no_legendary_offer');
      }
      addCharm(week.legendaryOffer);
      week.legendaryOffer = null;
      return;
    }
    const shop = openShop();
    if (input.kind === 'charm') {
      const slot = shop.charms[input.index ?? -1];
      if (!slot) {
        throw refuse('no_such_slot');
      }
      if (slot.sold) {
        throw refuse('sold_out');
      }
      const held = me.charms.find((candidate) => candidate.id === slot.charm.id);
      if (!held && me.charms.length >= me.charmSlots) {
        throw refuse('no_free_slot');
      }
      spend(slot.price);
      addCharm(slot.charm);
      slot.sold = true;
    } else if (input.kind === 'pack') {
      const slot = shop.packs[input.index ?? -1];
      if (!slot) {
        throw refuse('no_such_slot');
      }
      if (slot.bought) {
        throw refuse('sold_out');
      }
      if (slot.kind === 'pledge' && me.deck.length >= DECK_CAP) {
        throw refuse('deck_full');
      }
      spend(slot.price);
      slot.bought = true;
      slot.options = fixturePackOptions(slot.kind, rerolls + slot.index);
    } else {
      const slot = shop.voucher;
      if (!slot) {
        throw refuse('no_such_slot');
      }
      if (slot.sold) {
        throw refuse('sold_out');
      }
      spend(slot.price);
      slot.sold = true;
      me.vouchers.push(slot.id);
      if (slot.id === 'charm-belt') {
        me.charmSlots = 6;
      }
    }
  }

  function keep(option: ShopOption): void {
    if (option.kind === 'pledge') {
      addPledge(option.pledge);
    } else if (option.kind === 'charm') {
      addCharm(option.charm);
    }
    // A cosmetic is decoration the fixture has nowhere to show.
  }

  function pick(input: ShopPickInput): void {
    if (input.index === -1) {
      if (!week || week.freePack === null) {
        throw refuse('no_free_pack');
      }
      const card = week.freePackOptions?.[input.option];
      if (!card) {
        throw refuse('bad_option');
      }
      keep(card);
      week.freePack = null;
      week.freePackOptions = null;
      return;
    }
    const shop = openShop();
    const slot = shop.packs[input.index];
    if (!slot) {
      throw refuse('no_such_slot');
    }
    if (!slot.bought) {
      throw refuse('pack_not_bought');
    }
    if (slot.picked) {
      throw refuse('already_picked');
    }
    const chosen = slot.options?.[input.option];
    if (!chosen) {
      throw refuse('bad_option');
    }
    keep(chosen);
    slot.picked = true;
    slot.options = null;
  }

  function reroll(): void {
    const shop = openShop();
    spend(shop.rerollCost);
    rerolls += 1;
    shop.charms = [0, 1].map((slot) => {
      const charm = fixtureCharm(
        REROLL_CHARMS[(rerolls * 2 + slot + 3) % REROLL_CHARMS.length] as string,
      );
      return { index: slot, charm, price: CHARM_PRICE_BY_RARITY[charm.rarity], sold: false };
    });
    // A pack that is bought but not yet opened keeps its shelf; the others are drawn again.
    shop.packs = shop.packs.map((slot) => {
      if (slot.bought && !slot.picked) {
        return slot;
      }
      const kind = PACK_KINDS[(rerolls + slot.index) % PACK_KINDS.length] as PackKind;
      return {
        index: slot.index,
        kind,
        price: kind === 'charm' ? 100 : kind === 'pledge' ? 60 : 50,
        bought: false,
        picked: false,
        options: null,
      };
    });
  }

  function sell(charmId: string): void {
    const held = me.charms.find((candidate) => candidate.id === charmId);
    if (!held) {
      throw refuse('not_held');
    }
    me.gold += week?.shop?.sellPrices[charmId] ?? charmSellPrice(held.rarity);
    if ((held.copies ?? 1) > 1) {
      held.copies = 1;
    } else {
      me.charms = me.charms.filter((candidate) => candidate.id !== charmId);
    }
  }

  function shrine(pledgeId: string): void {
    const at = me.deck.findIndex((card) => card.id === pledgeId);
    if (at === -1) {
      throw refuse('not_in_deck');
    }
    spend(owns('shrine-pass') ? 0 : 50);
    me.deck.splice(at, 1);
  }

  function play(pledgeId: string): void {
    if (!week || !week.pledgeWindowOpen) {
      throw refuse('window_closed');
    }
    const card = week.hand.find((candidate) => candidate.id === pledgeId);
    if (!card) {
      throw refuse('not_in_hand');
    }
    if (week.played.some((candidate) => candidate.id === pledgeId)) {
      throw refuse('already_played');
    }
    if (week.played.length >= PLEDGE_PLAY_LIMIT) {
      throw refuse('play_limit');
    }
    week.played.push({ ...card });
    week.pledgeProgress[pledgeId] = {
      progress: 0,
      target: pledgeDefinition(pledgeId)?.goal ?? 1,
      completed: false,
    };
  }

  /** Run one write against a scratch copy, so a refused write leaves the fixture untouched. */
  async function transact<T>(change: () => T): Promise<T> {
    const saved = { me: clone(me), week: week ? clone(week) : null, rerolls, feats: clone(feats) };
    try {
      return await delay(change());
    } catch (error) {
      me = saved.me;
      week = saved.week;
      rerolls = saved.rerolls;
      feats = saved.feats;
      me.week = week;
      throw error;
    }
  }

  function write(change: () => void): Promise<MutationResponse> {
    return transact(() => {
      change();
      return answer();
    });
  }

  // -------------------------------------------------------------------------------------------
  // The depth layer: the shared package's own rules over the fixture profile
  // -------------------------------------------------------------------------------------------

  /** The shared `PlayerState` the rules run on, built from the fixture profile and its Feats. */
  function playerOf(): PlayerState {
    const unlocked = feats.filter((feat) => feat.unlocked).map((feat) => feat.id);
    return {
      ...createPlayerState(me.githubId),
      xp: me.xp,
      skillXp: me.skillXp,
      gold: me.gold,
      renown: me.renown,
      charms: me.charms,
      vouchers: me.vouchers,
      deck: me.deck,
      gear: loadoutOf(Object.values(me.gear.equipped), me.gear.capeColor ?? undefined),
      feats: { unlocked, powerBonus: featBonusFor(unlocked) },
      satchel: me.satchel,
      expedition: me.expedition,
      inventory: me.inventory,
      pets: me.pets,
      charmPacks: me.charmPacks,
      forge: me.forge,
      titles: me.titles,
      pinnedFeats: me.pinnedFeats,
    };
  }

  /** Copy what a rule changed back onto the fixture profile. */
  function adopt(player: PlayerState): void {
    me.charms = [...player.charms].map((charm) => ({ ...charm }));
    me.satchel = { ...emptySatchel(), ...player.satchel };
    me.expedition = player.expedition ?? null;
    me.inventory = [...(player.inventory ?? [])];
    me.pets = [...(player.pets ?? me.pets)];
    me.charmPacks = [...(player.charmPacks ?? [])];
    const forge = forgeOf(player);
    me.forge = { upgrades: [...forge.upgrades], stations: { ...forge.stations } };
    me.titles = [...(player.titles ?? [])];
    me.pinnedFeats = [...(player.pinnedFeats ?? [])];
    me.gear = {
      equipped: Object.fromEntries(player.gear.pieces.map((piece) => [piece.slot, piece])),
      setBonus: player.gear.setBonus,
      capeColor: (player.gear.capeColor as CapeColor | undefined) ?? null,
    };
    for (const feat of feats) {
      feat.pinned = me.pinnedFeats.includes(feat.id);
    }
  }

  /** A shared `Result`'s refusal as the api's typed 409 (or the stated status). */
  function must<T extends object>(
    result: ({ ok: true } & T) | { ok: false; error: string },
    status = 409,
  ): T {
    if (!result.ok) {
      throw refuse(result.error, status);
    }
    return result;
  }

  /** The fixture's stand-in for the Feat evaluator: collecting the returned trip is Spelunker's 100th. */
  function recordCollected(
    player: PlayerState,
    now: number,
  ): { player: PlayerState; unlocked: string[] } {
    const feat = feats.find((candidate) => candidate.id === FIXTURE_COLLECT_UNLOCKS);
    if (!feat || feat.unlocked || feat.progress < 0.99) {
      return { player, unlocked: [] };
    }
    const definition = featDefinition(feat.id);
    feat.unlocked = true;
    feat.progress = 1;
    feat.unlockedAt = new Date(now).toISOString();
    if (definition) {
      feat.name = definition.name;
      feat.description = definition.description;
      feat.reward = definition.reward;
    }
    let next = player;
    const reward = definition?.reward;
    if (reward?.title && !(next.titles ?? []).includes(reward.title)) {
      next = { ...next, titles: [...(next.titles ?? []), reward.title] };
    }
    if (reward?.pet) {
      next = grantPet(next, reward.pet).player;
    }
    const unique = reward?.unique ? uniqueDefinition(reward.unique) : undefined;
    if (unique) {
      next = {
        ...next,
        inventory: [...(next.inventory ?? []), uniquePiece(unique, `feat-${feat.id}`)],
      };
    }
    return { player: next, unlocked: [feat.id] };
  }

  function sendTrip(input: Parameters<Api['expeditionSend']>[0]) {
    return transact(() => {
      sends += 1;
      const now = fixtureNow();
      const sent = must(
        sendExpedition(playerOf(), input.region, input.choice, now, 9000 + sends * 13),
      );
      adopt(sent.player);
      return { me: snapshot(), expedition: sent.expedition };
    });
  }

  function collectTrip() {
    return transact(() => {
      if (!me.expedition) {
        throw refuse('no_expedition', 404);
      }
      const now = fixtureNow();
      const player = playerOf();
      const collected = must(collectExpedition(player, me.expedition, now));
      let unlocked: string[] = [];
      let next = collected.player;
      if (collected.applied) {
        ({ player: next, unlocked } = recordCollected(next, now));
      }
      adopt(next);
      return {
        me: snapshot(),
        expedition: collected.expedition,
        loot: collected.loot,
        applied: collected.applied,
        featsUnlocked: unlocked,
      };
    });
  }

  function equip(input: Parameters<Api['gearEquip']>[0]) {
    return transact(() => {
      const player = playerOf();
      let result: { player: PlayerState };
      if ('pieceId' in input) {
        result = must(equipGear(player, input.pieceId));
      } else if ('unequip' in input) {
        result = must(unequipGear(player, input.unequip as GearSlot));
      } else {
        result = must(equipPet(player, input.petId));
      }
      adopt(result.player);
      return { me: snapshot() };
    });
  }

  function upgrade(input: Parameters<Api['forgeUpgrade']>[0]) {
    return transact(() => {
      const player = playerOf();
      if ('upgrade' in input) {
        adopt(must(buyUpgrade(player, input.upgrade)).player);
      } else {
        const dyed = setCapeColor(player, input.capeColor);
        if (!dyed.ok) {
          throw refuse('dyes_required');
        }
        adopt(dyed.player);
      }
      return { me: snapshot() };
    });
  }

  function pin(featId: string, pinned: boolean) {
    return transact(() => {
      const player = playerOf();
      adopt(pinned ? must(pinFeat(player, featId)).player : unpinFeat(player, featId));
      return { me: snapshot() };
    });
  }

  return {
    async me(): Promise<MeResponse> {
      return delay(snapshot());
    },
    async log(cursor?: string | null): Promise<LogResponse> {
      return delay(pageOf(entries(), cursor, pageSize));
    },
    async installations(): Promise<InstallationsResponse> {
      return delay(fixtureInstallations(variant));
    },
    async getWeek(): Promise<WeekSummary> {
      const view = snapshot().week;
      if (!view) {
        throw new ApiError(404, 'There is no run yet.', 'not_found');
      }
      return delay(view);
    },
    async expedition() {
      return delay(expeditionViewFrom(snapshot(), fixtureNow()));
    },
    expeditionSend: (input) => sendTrip(input),
    expeditionCollect: () => collectTrip(),
    async packOptions(seed) {
      if (!me.charmPacks.includes(seed)) {
        throw refuse('no_such_pack');
      }
      return delay({ options: lootPackOptions(seed) });
    },
    packOpen: (input) =>
      transact(() => {
        adopt(must(openLootPack(playerOf(), input.seed, input.charmId)).player);
        return { me: snapshot() };
      }),
    async forge() {
      return delay(forgeViewFrom(snapshot(), fixtureNow()));
    },
    forgeStart: (input) =>
      transact(() => {
        sends += 1;
        const options = {
          seed: 7200 + sends,
          ...(input.pieceId === undefined ? {} : { pieceId: input.pieceId }),
        };
        adopt(must(startJob(playerOf(), input.recipeId, fixtureNow(), options)).player);
        return { me: snapshot() };
      }),
    forgeCollect: (station) =>
      transact(() => {
        const done = must(collectJob(playerOf(), station, fixtureNow()));
        adopt(done.player);
        return { me: snapshot(), piece: done.piece as GearPiece | null, applied: done.applied };
      }),
    forgeUpgrade: (input) => upgrade(input),
    gearEquip: (input) => equip(input),
    async feats() {
      return delay({ feats: clone(feats) });
    },
    featPin: (featId, pinned) => pin(featId, pinned),
    settings: (badgePublic) =>
      transact(() => {
        me.badgePublic = badgePublic;
        return { me: snapshot() };
      }),
    shopBuy: (input) => write(() => buy(input)),
    shopPick: (input) => write(() => pick(input)),
    shopReroll: () => write(reroll),
    shopSell: (charmId) => write(() => sell(charmId)),
    shrineRemove: (pledgeId) => write(() => shrine(pledgeId)),
    pledgePlay: (pledgeId) => write(() => play(pledgeId)),
    async exportData(): Promise<Record<string, unknown>> {
      const { week: run, ...profile } = snapshot();
      return delay({
        exportedAt: new Date(FIXTURE_CLOCK()).toISOString(),
        profile,
        events: entries(),
        weeks: run ? [run] : [],
        feats: feats.filter((feat) => feat.unlocked).map((feat) => feat.id),
        expeditions: me.expedition ? [me.expedition] : [],
        jobs: Object.values(me.forge.stations),
      });
    },
    async deleteAccount(confirmLogin: string): Promise<void> {
      if (confirmLogin.trim().toLowerCase() !== me.login.toLowerCase()) {
        throw refuse('confirm_mismatch', 400);
      }
      // Everything is gone; the next read is a fresh level-1 character, as after the real delete.
      me = fixtureMe(start, 'noevents');
      week = null;
      base = [];
      rerolls = 0;
      feats = fixtureFeats(start, 'noevents');
      await delay(undefined);
    },
  };
}
