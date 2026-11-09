import { CHARM_PRICE_BY_RARITY, DECK_CAP, RARITIES, RARITY_WEIGHTS, SHOP } from './constants';
import { addCharm, charmsOfRarity, makeCharm, sellCharm } from './charms';
import type { CharmDefinition, CharmOutcome, CharmSale } from './charms';
import { creditSale, spendGold } from './economy';
import type { GoldEntry, GoldError } from './economy';
import { MOGUL_COSMETICS } from './moguls';
import { addToDeck, pledgeCard, PLEDGES, removeFromDeck } from './pledges';
import { deriveSeed, mulberry32, shuffle, weightedPick } from './rng';
import {
  applyVoucher,
  rerollBase,
  shrineCost,
  unownedVouchers,
  voucherOf,
  voucherPrice,
} from './vouchers';
import type {
  Charm,
  Cosmetic,
  PackKind,
  PackSlot,
  PlayerState,
  Pledge,
  Result,
  RunState,
  ShopStock,
} from './types';

/**
 * The shop (Requirement 8, design.md 6.5). Stock is generated once per visit from the week's seed, stored
 * on the run, and never changes on a reload. Every function here is pure and returns a typed error
 * instead of throwing, so the backend can map errors to 409s; all gold moves through economy.ts.
 *
 * A visit opens when an act clears (`clearAct` in run.ts) and lasts until the next act clears or the run
 * ends: `run.shop` is the open visit, and null means the shop is closed.
 */

export const PACK_KINDS: readonly PackKind[] = ['pledge', 'charm', 'mogul'];

export type ShopError =
  | 'shop_closed'
  | 'no_such_slot'
  | 'sold_out'
  | 'no_free_slot'
  | 'deck_full'
  | 'pack_not_bought'
  | 'already_picked'
  | 'bad_option'
  | 'not_held'
  | 'not_in_deck'
  | GoldError;

/** One of the 3 cards in an opened pack; the player keeps exactly one. */
export type PackOption =
  | { kind: 'pledge'; pledge: Pledge }
  | { kind: 'charm'; charm: Charm }
  | { kind: 'mogul'; cosmetic: Cosmetic };

// ---------------------------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------------------------

/**
 * A Charm definition drawn by rarity weight (70/22/7/1), then uniformly among that rarity's Charms not
 * already `taken`. The rarity is drawn first, so the weights hold; if every Charm of the drawn rarity is
 * taken (only possible in a 3-option pack) the rarity is drawn again.
 */
function drawCharm(random: () => number, taken: readonly CharmDefinition[]): CharmDefinition {
  for (;;) {
    const rarity = weightedPick(
      RARITIES.map((value) => ({ value, weight: RARITY_WEIGHTS[value] })),
      random,
    );
    const pool = charmsOfRarity(rarity).filter((entry) => !taken.some((t) => t.id === entry.id));
    if (pool.length > 0) {
      return pool[Math.floor(random() * pool.length)] as CharmDefinition;
    }
  }
}

/** `count` different Charm definitions, each drawn by rarity weight. */
export function drawDistinctCharms(count: number, random: () => number): CharmDefinition[] {
  const drawn: CharmDefinition[] = [];
  while (drawn.length < count) {
    drawn.push(drawCharm(random, drawn));
  }
  return drawn;
}

function charmSlots(random: () => number): ShopStock['charms'] {
  return drawDistinctCharms(SHOP.charmSlots, random).map((definition) => ({
    item: makeCharm(definition),
    price: CHARM_PRICE_BY_RARITY[definition.rarity],
    sold: false,
  }));
}

function packSlots(random: () => number, nonce: number): PackSlot[] {
  return shuffle(PACK_KINDS, random)
    .slice(0, SHOP.packSlots)
    .map((kind) => ({
      item: kind,
      price: SHOP.packPrices[kind],
      sold: false,
      picked: false,
      nonce,
    }));
}

/**
 * Stock a visit: 2 Charms (rarity weights 70/22/7/1, priced 40/70/120/250), 2 different packs (Pledge 60,
 * Charm 100, Mogul cosmetics 50) and 1 Voucher the player does not own (150 + 50 per owned), or none
 * when they own all six. Deterministic in `(seed, visit)` and the Vouchers owned.
 *
 * @param seed  the week's seed (`RunState.shopSeed`)
 * @param visit 1-based visit within the week: the number of acts cleared (`run.clearedActs.length`)
 */
export function generateStock(player: PlayerState, seed: number, visit: number): ShopStock {
  const random = mulberry32(deriveSeed(seed, 'shop', visit));
  const charms = charmSlots(random);
  const packs = packSlots(random, 0);
  const pool = unownedVouchers(player);
  const voucher =
    pool.length === 0
      ? null
      : {
          item: voucherOf(pool[Math.floor(random() * pool.length)] as (typeof pool)[number]),
          price: voucherPrice(player),
          sold: false,
        };
  return { charms, packs, voucher, rerolls: 0 };
}

// ---------------------------------------------------------------------------------------------
// Pack contents
// ---------------------------------------------------------------------------------------------

/** The 1-based shop visit of a run: the number of acts cleared so far. */
export function visitOf(run: RunState): number {
  return run.clearedActs.length;
}

/**
 * The 3 options of a pack slot. A pure function of the week seed, the visit, the slot and the slot's
 * nonce, so the options are the same every time they are asked for, before and after buying. Null when the
 * shop is closed or the slot does not exist.
 */
export function packOptions(run: RunState, index: number): PackOption[] | null {
  const slot = run.shop?.packs[index];
  if (run.shop === null || slot === undefined) {
    return null;
  }
  const random = mulberry32(deriveSeed(run.shopSeed, 'pack', visitOf(run), slot.nonce ?? 0, index));
  switch (slot.item) {
    case 'pledge':
      return shuffle(PLEDGES, random)
        .slice(0, SHOP.packOptions)
        .map((definition) => ({ kind: 'pledge' as const, pledge: pledgeCard(definition) }));
    case 'charm':
      return drawDistinctCharms(SHOP.packOptions, random).map((definition) => ({
        kind: 'charm' as const,
        charm: makeCharm(definition),
      }));
    case 'mogul':
      return shuffle(MOGUL_COSMETICS, random)
        .slice(0, SHOP.packOptions)
        .map((cosmetic) => ({ kind: 'mogul' as const, cosmetic }));
  }
}

/** The Legendary Charm offered on every 4th Renown (Requirement 6.7). Deterministic in `seed`. */
export function legendaryOffer(seed: number): Charm {
  const pool = charmsOfRarity('legendary');
  const random = mulberry32(deriveSeed(seed, 'legendary-offer'));
  return makeCharm(pool[Math.floor(random() * pool.length)] as CharmDefinition);
}

// ---------------------------------------------------------------------------------------------
// Transitions
// ---------------------------------------------------------------------------------------------

/** What a Charm arriving did, with the sale already credited when a third copy was auto-sold. */
export interface Grant {
  player: PlayerState;
  outcome: CharmOutcome;
  sale: CharmSale | null;
  /** The gold the auto-sale paid, if any. */
  saleEntry: GoldEntry | null;
}

/** Give a Charm to the player: add, stack, or auto-sell a third copy (crediting its half price). */
export function grantCharm(player: PlayerState, charm: Charm): Result<Grant, 'no_free_slot'> {
  const added = addCharm(player, charm);
  if (!added.ok) {
    return added;
  }
  if (added.sale === null) {
    return { ok: true, player: added.player, outcome: added.outcome, sale: null, saleEntry: null };
  }
  const credited = creditSale(added.player, added.sale);
  return {
    ok: true,
    player: credited.player,
    outcome: added.outcome,
    sale: added.sale,
    saleEntry: credited.entry,
  };
}

function openShop(run: RunState): Result<{ shop: ShopStock }, 'shop_closed'> {
  return run.shop === null ? { ok: false, error: 'shop_closed' } : { ok: true, shop: run.shop };
}

/** Gold the next re-roll costs: 20, +10 per re-roll this visit (10 base with Cheaper Re-rolls). */
export function rerollCost(player: PlayerState, shop: ShopStock): number {
  return rerollBase(player) + SHOP.rerollStep * shop.rerolls;
}

/** Buy the Charm on shelf `index`. */
export function buyCharm(
  player: PlayerState,
  run: RunState,
  index: number,
): Result<Grant & { run: RunState }, ShopError> {
  const open = openShop(run);
  if (!open.ok) {
    return open;
  }
  const slot = open.shop.charms[index];
  if (slot === undefined) {
    return { ok: false, error: 'no_such_slot' };
  }
  if (slot.sold) {
    return { ok: false, error: 'sold_out' };
  }
  // Check the slot first, pay from the gold held (a third copy's refund does not count toward the
  // price), then credit the refund.
  const added = addCharm(player, slot.item);
  if (!added.ok) {
    return added;
  }
  const paid = spendGold(added.player, slot.price, 'purchase');
  if (!paid.ok) {
    return paid;
  }
  const refund = added.sale === null ? null : creditSale(paid.player, added.sale);
  const charms = open.shop.charms.map((entry, at) =>
    at === index ? { ...entry, sold: true } : entry,
  );
  return {
    ok: true,
    player: refund?.player ?? paid.player,
    outcome: added.outcome,
    sale: added.sale,
    saleEntry: refund?.entry ?? null,
    run: { ...run, shop: { ...open.shop, charms } },
  };
}

/** Buy the pack on shelf `index` and open it: the result lists its 3 options. */
export function buyPack(
  player: PlayerState,
  run: RunState,
  index: number,
): Result<{ player: PlayerState; run: RunState; options: PackOption[] }, ShopError> {
  const open = openShop(run);
  if (!open.ok) {
    return open;
  }
  const slot = open.shop.packs[index];
  if (slot === undefined) {
    return { ok: false, error: 'no_such_slot' };
  }
  if (slot.sold) {
    return { ok: false, error: 'sold_out' };
  }
  if (slot.item === 'pledge' && player.deck.length >= DECK_CAP) {
    return { ok: false, error: 'deck_full' };
  }
  const paid = spendGold(player, slot.price, 'purchase');
  if (!paid.ok) {
    return paid;
  }
  const packs = open.shop.packs.map((entry, at) =>
    at === index ? { ...entry, sold: true } : entry,
  );
  const next: RunState = { ...run, shop: { ...open.shop, packs } };
  return {
    ok: true,
    player: paid.player,
    run: next,
    options: packOptions(next, index) as PackOption[],
  };
}

/**
 * Keep option `optionIndex` of a bought pack (Requirement 8.7: see 3, keep exactly 1). A Pledge goes to
 * the deck (cap 20), a Charm is granted (stack, slot or auto-sell), a cosmetic is added once. If the keep
 * fails (`deck_full`, `no_free_slot`) nothing changes and the pack can be picked again after making room.
 */
export function pickPackOption(
  player: PlayerState,
  run: RunState,
  index: number,
  optionIndex: number,
): Result<
  { player: PlayerState; run: RunState; kept: PackOption; sale: CharmSale | null },
  ShopError
> {
  const open = openShop(run);
  if (!open.ok) {
    return open;
  }
  const slot = open.shop.packs[index];
  if (slot === undefined) {
    return { ok: false, error: 'no_such_slot' };
  }
  if (!slot.sold) {
    return { ok: false, error: 'pack_not_bought' };
  }
  if (slot.picked === true) {
    return { ok: false, error: 'already_picked' };
  }
  const kept = (packOptions(run, index) as PackOption[])[optionIndex];
  if (kept === undefined) {
    return { ok: false, error: 'bad_option' };
  }

  let next = player;
  let sale: CharmSale | null = null;
  if (kept.kind === 'pledge') {
    const added = addToDeck(player.deck, kept.pledge);
    if (!added.ok) {
      return added;
    }
    next = { ...player, deck: added.deck };
  } else if (kept.kind === 'charm') {
    const granted = grantCharm(player, kept.charm);
    if (!granted.ok) {
      return granted;
    }
    next = granted.player;
    sale = granted.sale;
  } else if (!player.cosmetics.includes(kept.cosmetic.id)) {
    next = { ...player, cosmetics: [...player.cosmetics, kept.cosmetic.id] };
  }
  const packs = open.shop.packs.map((entry, at) =>
    at === index ? { ...entry, picked: true } : entry,
  );
  return { ok: true, player: next, run: { ...run, shop: { ...open.shop, packs } }, kept, sale };
}

/** Buy the Voucher on the shelf. Overclock takes effect for events scored from now on. */
export function buyVoucher(
  player: PlayerState,
  run: RunState,
): Result<{ player: PlayerState; run: RunState }, ShopError | 'already_owned'> {
  const open = openShop(run);
  if (!open.ok) {
    return open;
  }
  const slot = open.shop.voucher;
  if (slot === null) {
    return { ok: false, error: 'no_such_slot' };
  }
  if (slot.sold) {
    return { ok: false, error: 'sold_out' };
  }
  const applied = applyVoucher(player, slot.item.id);
  if (!applied.ok) {
    return applied;
  }
  const paid = spendGold(applied.player, slot.price, 'purchase');
  if (!paid.ok) {
    return paid;
  }
  return {
    ok: true,
    player: paid.player,
    run: { ...run, shop: { ...open.shop, voucher: { ...slot, sold: true } } },
  };
}

/**
 * Re-roll the Charms and packs (20 gold, +10 per re-roll this visit; the Voucher stays). A pack that was
 * bought but not yet picked keeps its shelf slot, so a re-roll can never lose it.
 */
export function rerollShop(
  player: PlayerState,
  run: RunState,
): Result<{ player: PlayerState; run: RunState; cost: number }, ShopError> {
  const open = openShop(run);
  if (!open.ok) {
    return open;
  }
  const { shop } = open;
  const cost = rerollCost(player, shop);
  const paid = spendGold(player, cost, 'reroll');
  if (!paid.ok) {
    return paid;
  }
  const rerolls = shop.rerolls + 1;
  const random = mulberry32(deriveSeed(run.shopSeed, 'shop', visitOf(run), 'reroll', rerolls));
  const fresh = packSlots(random, rerolls);
  const packs = shop.packs.map((entry, at) =>
    entry.sold && entry.picked !== true ? entry : (fresh[at] as PackSlot),
  );
  return {
    ok: true,
    player: paid.player,
    run: { ...run, shop: { ...shop, charms: charmSlots(random), packs, rerolls } },
    cost,
  };
}

/** Sell one copy of a held Charm for half its price. Always possible, shop open or not. */
export function sellHeldCharm(
  player: PlayerState,
  charmId: string,
): Result<{ player: PlayerState; sale: CharmSale; entry: GoldEntry }, 'not_held'> {
  const sold = sellCharm(player, charmId);
  if (!sold.ok) {
    return sold;
  }
  const credited = creditSale(sold.player, sold.sale);
  return { ok: true, player: credited.player, sale: sold.sale, entry: credited.entry };
}

/** Remove a Pledge from the deck at the shrine: 50 gold, free with the Shrine Pass. */
export function removePledgeAtShrine(
  player: PlayerState,
  pledgeId: string,
): Result<{ player: PlayerState; removed: Pledge; cost: number }, 'not_in_deck' | GoldError> {
  const removed = removeFromDeck(player.deck, pledgeId);
  if (!removed.ok) {
    return removed;
  }
  const cost = shrineCost(player);
  const paid = spendGold(player, cost, 'shrine');
  if (!paid.ok) {
    return paid;
  }
  return {
    ok: true,
    player: { ...paid.player, deck: removed.deck },
    removed: removed.removed,
    cost,
  };
}
