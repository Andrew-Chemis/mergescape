/**
 * An `Api` that answers from fixture state, so the whole client runs offline (`?fixture=1`, or no
 * `VITE_API_ORIGIN`). With `live`, one extra Merge Goblin row "arrives" after a delay and pushes the
 * character over a level, which exercises the score ticker and the level-up flash end to end.
 *
 * The shop, shrine, Pledge and Settings calls change a local copy of the fixture state, so the Shop is
 * clickable offline: gold goes down, Charms and Pledges move, and the same typed 409 errors the real api
 * answers with (`insufficient_gold`, `sold_out`, `shop_closed`, `window_closed`, ...) come back when a rule
 * is broken. The rules here are a small stand-in for the backend's, not a second copy of them.
 */
import {
  CHARM_PRICE_BY_RARITY,
  charmSellPrice,
  DECK_CAP,
  PLEDGE_PLAY_LIMIT,
  pledgeDefinition,
} from '@mergescape/shared';
import type { Charm, Pledge } from '@mergescape/shared';
import { ApiError } from '../api';
import type { Api, ShopBuyInput, ShopPickInput } from '../api';
import type {
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
  let me: MeResponse = fixtureMe(start, variant, options.week);
  let week: WeekSummary | null = me.week;
  let rerolls = 0;

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
  async function write(change: () => void): Promise<MutationResponse> {
    const saved = { me: clone(me), week: week ? clone(week) : null, rerolls };
    try {
      change();
      return await delay(answer());
    } catch (error) {
      me = saved.me;
      week = saved.week;
      rerolls = saved.rerolls;
      me.week = week;
      throw error;
    }
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
        feats: [],
        expeditions: [],
        jobs: [],
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
      await delay(undefined);
    },
  };
}
