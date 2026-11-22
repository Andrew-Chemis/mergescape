import { describe, expect, it } from 'vitest';
import { addCharm, CHARMS, charmDefinition, copiesOf, makeCharm } from './charms';
import type { CharmId } from './charms';
import { CHARM_PRICE_BY_RARITY, DECK_CAP, RARITIES, RARITY_WEIGHTS } from './constants';
import { MOGUL_COSMETICS } from './moguls';
import { PLEDGES, pledgeCard, starterDeck } from './pledges';
import {
  buyCharm,
  buyPack,
  buyVoucher,
  generateStock,
  grantCharm,
  legendaryOffer,
  PACK_KINDS,
  packOptions,
  pickPackOption,
  removePledgeAtShrine,
  rerollCost,
  rerollShop,
  sellHeldCharm,
  visitOf,
} from './shop';
import type { PackOption } from './shop';
import { held, makeRun, settledPlayer } from './test-builders';
import type { Charm, PlayerState, RunState, ShopStock } from './types';
import { VOUCHERS } from './vouchers';

const SEED = 20260509;

function rich(gold = 1000, overrides: Partial<PlayerState> = {}): PlayerState {
  return { ...settledPlayer(), gold, ...overrides };
}

/** A run whose first shop visit is open (the Scout act cleared). */
function open(player: PlayerState, seed = SEED, shop?: ShopStock): RunState {
  return makeRun({
    shopSeed: seed,
    act: 'raid',
    clearedActs: ['scout'],
    shop: shop ?? generateStock(player, seed, 1),
  });
}

function must<T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> {
  if (!result.ok) {
    throw new Error(`expected success, got ${JSON.stringify(result)}`);
  }
  return result as Extract<T, { ok: true }>;
}

describe('stock (Requirement 8.3 and 8.5)', () => {
  const player = rich();

  it('is 2 Charms, 2 different packs and 1 Voucher not yet owned', () => {
    const stock = generateStock(player, SEED, 1);
    expect(stock.charms).toHaveLength(2);
    expect(new Set(stock.charms.map((slot) => slot.item.id)).size).toBe(2);
    expect(stock.packs).toHaveLength(2);
    expect(new Set(stock.packs.map((slot) => slot.item)).size).toBe(2);
    expect(stock.packs.every((slot) => PACK_KINDS.includes(slot.item))).toBe(true);
    expect(stock.voucher?.sold).toBe(false);
    expect(stock.rerolls).toBe(0);
    expect(
      stock.packs.every((slot) => !slot.sold && slot.picked === false && slot.nonce === 0),
    ).toBe(true);
  });

  it('prices Charms 40 / 70 / 120 / 250 by rarity, packs 60 / 100 / 50, a Voucher 150', () => {
    for (let seed = 1; seed <= 200; seed += 1) {
      const stock = generateStock(player, seed, 1);
      for (const slot of stock.charms) {
        expect(slot.price).toBe(CHARM_PRICE_BY_RARITY[slot.item.rarity]);
      }
      for (const slot of stock.packs) {
        expect(slot.price).toBe({ pledge: 60, charm: 100, mogul: 50 }[slot.item]);
      }
      expect(stock.voucher?.price).toBe(150);
    }
  });

  it('a Voucher costs 50 more for each already owned and is never one already owned', () => {
    const owner = rich(1000, { vouchers: ['charm-belt', 'overclock'] });
    for (let seed = 1; seed <= 100; seed += 1) {
      const voucher = generateStock(owner, seed, 1).voucher;
      expect(voucher?.price).toBe(250);
      expect(['charm-belt', 'overclock']).not.toContain(voucher?.item.id);
    }
  });

  it('has no Voucher once all six are owned', () => {
    const all = rich(1000, { vouchers: VOUCHERS.map((voucher) => voucher.id) });
    expect(generateStock(all, SEED, 1).voucher).toBeNull();
  });

  it('the same seed gives the same stock, a reload changes nothing', () => {
    expect(generateStock(player, SEED, 1)).toEqual(generateStock(player, SEED, 1));
    expect(generateStock(rich(5), SEED, 2)).toEqual(generateStock(rich(900), SEED, 2));
  });

  it('different seeds and different visits give different stock', () => {
    const shelves = (seed: number, visit: number) =>
      JSON.stringify(generateStock(player, seed, visit));
    expect(new Set(Array.from({ length: 40 }, (_, seed) => shelves(seed, 1))).size).toBeGreaterThan(
      20,
    );
    expect(shelves(SEED, 1)).not.toBe(shelves(SEED, 2));
  });

  it('draws Charm rarity by weight 70 / 22 / 7 / 1', () => {
    const counts = { common: 0, uncommon: 0, rare: 0, legendary: 0 };
    let total = 0;
    for (let seed = 1; seed <= 6000; seed += 1) {
      for (const slot of generateStock(player, seed, 1).charms) {
        counts[slot.item.rarity] += 1;
        total += 1;
      }
    }
    for (const rarity of RARITIES) {
      const share = (counts[rarity] / total) * 100;
      expect(Math.abs(share - RARITY_WEIGHTS[rarity])).toBeLessThan(rarity === 'common' ? 3 : 2);
    }
    expect(counts.legendary).toBeGreaterThan(0);
  });

  it('offers every Charm over enough draws, and visits are numbered by acts cleared', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 3000; seed += 1) {
      generateStock(player, seed, 1).charms.forEach((slot) => seen.add(slot.item.id));
    }
    expect(seen.size).toBe(CHARMS.length);
    expect(visitOf(makeRun({ clearedActs: ['scout', 'raid'] }))).toBe(2);
  });
});

describe('pack contents (Requirement 8.7: 3 options)', () => {
  const player = rich();
  const run = open(player);

  it('every pack has 3 distinct options, the same every time and before or after buying', () => {
    for (let index = 0; index < 2; index += 1) {
      const options = packOptions(run, index)!;
      expect(options).toHaveLength(3);
      expect(packOptions(run, index)).toEqual(options);
      const names = options.map((option) =>
        option.kind === 'pledge'
          ? option.pledge.id
          : option.kind === 'charm'
            ? option.charm.id
            : option.cosmetic.id,
      );
      expect(new Set(names).size).toBe(3);
      const bought = must(buyPack(player, run, index));
      expect(bought.options).toEqual(options);
      expect(packOptions(bought.run, index)).toEqual(options);
    }
  });

  it('draws each kind from its own pool', () => {
    const kinds = new Map<string, PackOption[]>();
    for (let seed = 1; seed <= 60 && kinds.size < 3; seed += 1) {
      const stocked = open(player, seed);
      stocked.shop!.packs.forEach((slot, index) => {
        kinds.set(slot.item, packOptions(stocked, index)!);
      });
    }
    const pledge = kinds.get('pledge')!;
    expect(pledge.every((option) => option.kind === 'pledge')).toBe(true);
    expect(
      pledge.every(
        (option) =>
          option.kind === 'pledge' && PLEDGES.some((entry) => entry.id === option.pledge.id),
      ),
    ).toBe(true);
    expect(kinds.get('charm')!.every((option) => option.kind === 'charm')).toBe(true);
    const mogul = kinds.get('mogul')!;
    expect(
      mogul.every(
        (option) =>
          option.kind === 'mogul' &&
          MOGUL_COSMETICS.some((entry) => entry.id === option.cosmetic.id),
      ),
    ).toBe(true);
  });

  it('never offers an upgraded Pledge: Pair Up comes from a Boss reward, not a pack', () => {
    const upgraded = PLEDGES.filter((entry) => entry.upgraded).map((entry) => entry.id);
    expect(upgraded).toEqual(['pair-up']);
    const offered = new Set<string>();
    for (let seed = 1; seed <= 400; seed += 1) {
      const stocked = open(player, seed);
      for (let nonce = 0; nonce < 3; nonce += 1) {
        const slots = stocked.shop!.packs.map((slot) => ({
          ...slot,
          item: 'pledge' as const,
          nonce,
        }));
        const roll = { ...stocked, shop: { ...stocked.shop!, packs: slots } };
        for (let index = 0; index < slots.length; index += 1) {
          for (const option of packOptions(roll, index)!) {
            if (option.kind === 'pledge') {
              offered.add(option.pledge.id);
            }
          }
        }
      }
    }
    expect([...offered].sort()).toEqual(
      PLEDGES.filter((entry) => !entry.upgraded)
        .map((entry) => entry.id)
        .sort(),
    );
  });

  it('keeps the 3 options of a pack carried into a later visit', () => {
    const slot = { item: 'charm' as const, price: 100, sold: true, picked: false, nonce: 0 };
    const stock = { ...run.shop!, packs: [slot, slot] };
    const stocked = { ...run, shop: stock };
    const original = packOptions(stocked, 0);
    // Stamped with the visit it was stocked in, it reads the same after the visit counter moves on.
    const later = {
      ...stocked,
      clearedActs: ['scout', 'raid'] as RunState['clearedActs'],
      shop: { ...stock, packs: [{ ...slot, visit: 1 }, slot] },
    };
    expect(visitOf(later)).toBe(2);
    expect(packOptions(later, 0)).toEqual(original);
    expect(packOptions(later, 1)).not.toEqual(original);
  });

  it('reads a stored shop written before packs carried a nonce as nonce 0', () => {
    const stock = run.shop!;
    const legacy = {
      ...run,
      shop: {
        ...stock,
        packs: stock.packs.map((slot) => ({ item: slot.item, price: slot.price, sold: slot.sold })),
      },
    };
    expect(packOptions(legacy, 0)).toEqual(packOptions(run, 0));
  });

  it('is null for a closed shop or a missing slot', () => {
    expect(packOptions(makeRun(), 0)).toBeNull();
    expect(packOptions(run, 5)).toBeNull();
  });
});

describe('buying a Charm (Requirement 8.6)', () => {
  const player = rich();
  const run = open(player);
  const slot = run.shop!.charms[0]!;

  it('takes the price, adds the Charm and marks the shelf slot sold', () => {
    const bought = must(buyCharm(player, run, 0));
    expect(bought.player.gold).toBe(1000 - slot.price);
    expect(bought.player.charms.map((entry) => entry.id)).toEqual([slot.item.id]);
    expect(bought.outcome).toBe('added');
    expect(bought.run.shop!.charms[0]!.sold).toBe(true);
    expect(bought.run.shop!.charms[1]!.sold).toBe(false);
    expect(player.gold).toBe(1000);
  });

  it('cannot be bought twice', () => {
    const bought = must(buyCharm(player, run, 0));
    expect(buyCharm(bought.player, bought.run, 0)).toEqual({ ok: false, error: 'sold_out' });
  });

  it('fails with insufficient gold and changes nothing', () => {
    expect(buyCharm(rich(slot.price - 1), run, 0)).toEqual({
      ok: false,
      error: 'insufficient_gold',
    });
    expect(must(buyCharm(rich(slot.price), run, 0)).player.gold).toBe(0);
  });

  it('refuses a full set of slots before taking any gold, unless it stacks', () => {
    const full: PlayerState = {
      ...rich(),
      charms: (['rubber-duck', 'lantern', 'small-hands', 'hot-potato', 'grey-beard'] as const).map(
        (id) => held(id),
      ),
    };
    const stockOf = (charm: Charm): ShopStock => ({
      charms: [{ item: charm, price: 40, sold: false }],
      packs: [],
      voucher: null,
      rerolls: 0,
    });
    const newcomer = open(full, SEED, stockOf(makeCharm(charmDefinition('oracle')!)));
    expect(buyCharm(full, newcomer, 0)).toEqual({ ok: false, error: 'no_free_slot' });
    const duplicate = open(full, SEED, stockOf(makeCharm(charmDefinition('lantern')!)));
    const stacked = must(buyCharm(full, duplicate, 0));
    expect(stacked.outcome).toBe('stacked');
    expect(copiesOf(stacked.player.charms.find((entry) => entry.id === 'lantern')!)).toBe(2);
    expect(stacked.player.gold).toBe(960);
  });

  it('a third copy is auto-sold at half price and the gold is credited', () => {
    const owner: PlayerState = { ...rich(), charms: [held('hot-potato', 2)] };
    const stock: ShopStock = {
      charms: [{ item: makeCharm(charmDefinition('hot-potato')!), price: 120, sold: false }],
      packs: [],
      voucher: null,
      rerolls: 0,
    };
    const result = must(buyCharm(owner, open(owner, SEED, stock), 0));
    expect(result.outcome).toBe('auto_sold');
    expect(result.sale?.proceeds).toBe(60);
    expect(result.saleEntry).toEqual({ reason: 'sell', delta: 60, balance: 940 });
    expect(result.player.gold).toBe(940);
    expect(result.player.charms).toHaveLength(1);
  });

  it('fails on a closed shop and a missing shelf slot', () => {
    expect(buyCharm(player, makeRun(), 0)).toEqual({ ok: false, error: 'shop_closed' });
    expect(buyCharm(player, run, 9)).toEqual({ ok: false, error: 'no_such_slot' });
  });
});

describe('packs: buy, then keep exactly one (Requirement 8.7)', () => {
  const player = rich();
  const run = open(player);

  /** The shelf index of a pack kind, found by trying seeds until one stocks it. */
  function stocked(kind: 'pledge' | 'charm' | 'mogul', base: PlayerState = player) {
    for (let seed = 1; seed < 200; seed += 1) {
      const candidate = open(base, seed);
      const index = candidate.shop!.packs.findIndex((slot) => slot.item === kind);
      if (index >= 0) {
        return { run: candidate, index };
      }
    }
    throw new Error('no seed stocked ' + kind);
  }

  it('takes the pack price and opens it', () => {
    const { run: shelf, index } = stocked('charm');
    const bought = must(buyPack(player, shelf, index));
    expect(bought.player.gold).toBe(900);
    expect(bought.options).toHaveLength(3);
    expect(bought.run.shop!.packs[index]).toMatchObject({ sold: true, picked: false });
    expect(buyPack(bought.player, bought.run, index)).toEqual({ ok: false, error: 'sold_out' });
  });

  it('fails when the shop is closed, the slot is missing, gold is short, or the deck is full', () => {
    expect(buyPack(player, makeRun(), 0)).toEqual({ ok: false, error: 'shop_closed' });
    expect(buyPack(player, run, 7)).toEqual({ ok: false, error: 'no_such_slot' });
    expect(buyPack(rich(0), run, 0)).toEqual({ ok: false, error: 'insufficient_gold' });
    const { run: shelf, index } = stocked('pledge');
    const full = rich(1000, {
      deck: Array.from({ length: DECK_CAP }, () => pledgeCard(PLEDGES[0]!)),
    });
    expect(buyPack(full, shelf, index)).toEqual({ ok: false, error: 'deck_full' });
  });

  it('a Pledge pick goes to the deck and can be made once', () => {
    const { run: shelf, index } = stocked('pledge');
    const bought = must(buyPack(player, shelf, index));
    const kept = must(pickPackOption(bought.player, bought.run, index, 1));
    expect(kept.kept.kind).toBe('pledge');
    expect(kept.player.deck).toHaveLength(starterDeck().length + 1);
    expect(kept.run.shop!.packs[index]!.picked).toBe(true);
    expect(pickPackOption(kept.player, kept.run, index, 0)).toEqual({
      ok: false,
      error: 'already_picked',
    });
  });

  it('a Pledge pick that finds the deck full changes nothing and can be retried after room is made', () => {
    const { run: shelf, index } = stocked('pledge');
    const bought = must(buyPack(player, shelf, index));
    const full = {
      ...bought.player,
      deck: Array.from({ length: DECK_CAP }, () => pledgeCard(PLEDGES[0]!)),
    };
    expect(pickPackOption(full, bought.run, index, 0)).toEqual({ ok: false, error: 'deck_full' });
    const roomy = { ...full, deck: full.deck.slice(1) };
    expect(must(pickPackOption(roomy, bought.run, index, 0)).player.deck).toHaveLength(DECK_CAP);
  });

  it('a Charm pick is granted, and fails with no free slot until one is sold', () => {
    const { run: shelf, index } = stocked('charm');
    const bought = must(buyPack(player, shelf, index));
    const kept = must(pickPackOption(bought.player, bought.run, index, 2));
    expect(kept.kept.kind).toBe('charm');
    expect(kept.player.charms).toHaveLength(1);
    const full: PlayerState = {
      ...bought.player,
      charms: (
        ['oracle', 'loaded-dice', 'jesters-rebase', 'grey-beard', 'hot-potato'] as const
      ).map((id) => held(id)),
    };
    const options = packOptions(bought.run, index)!;
    const clash = options.every(
      (option) =>
        option.kind === 'charm' && full.charms.some((entry) => entry.id === option.charm.id),
    );
    if (!clash) {
      const refused = pickPackOption(
        full,
        bought.run,
        index,
        options.findIndex(
          (option) =>
            option.kind === 'charm' && !full.charms.some((entry) => entry.id === option.charm.id),
        ),
      );
      expect(refused).toEqual({ ok: false, error: 'no_free_slot' });
    }
  });

  it('a Charm pick that is a third copy is auto-sold and credited', () => {
    const { run: shelf, index } = stocked('charm');
    const bought = must(buyPack(player, shelf, index));
    const options = packOptions(bought.run, index)!;
    const first = options[0] as Extract<PackOption, { kind: 'charm' }>;
    const owner = { ...bought.player, charms: [held(first.charm.id as CharmId, 2)] };
    const kept = must(pickPackOption(owner, bought.run, index, 0));
    expect(kept.sale?.reason).toBe('duplicate');
    expect(kept.player.gold).toBe(owner.gold + kept.sale!.proceeds);
  });

  it('a cosmetic pick is added once', () => {
    const { run: shelf, index } = stocked('mogul');
    const bought = must(buyPack(player, shelf, index));
    const kept = must(pickPackOption(bought.player, bought.run, index, 0));
    expect(kept.kept.kind).toBe('mogul');
    expect(kept.player.cosmetics).toHaveLength(1);
    const again = must(
      pickPackOption({ ...bought.player, cosmetics: kept.player.cosmetics }, bought.run, index, 0),
    );
    expect(again.player.cosmetics).toHaveLength(1);
  });

  it('cannot pick from an unbought pack, a bad option, a missing slot or a closed shop', () => {
    const { run: shelf, index } = stocked('charm');
    expect(pickPackOption(player, shelf, index, 0)).toEqual({
      ok: false,
      error: 'pack_not_bought',
    });
    const bought = must(buyPack(player, shelf, index));
    expect(pickPackOption(bought.player, bought.run, index, 3)).toEqual({
      ok: false,
      error: 'bad_option',
    });
    expect(pickPackOption(bought.player, bought.run, index, -1)).toEqual({
      ok: false,
      error: 'bad_option',
    });
    expect(pickPackOption(bought.player, bought.run, 9, 0)).toEqual({
      ok: false,
      error: 'no_such_slot',
    });
    expect(pickPackOption(bought.player, makeRun(), 0, 0)).toEqual({
      ok: false,
      error: 'shop_closed',
    });
  });
});

describe('Vouchers in the shop', () => {
  const player = rich();
  const run = open(player);
  const voucher = run.shop!.voucher!;

  it('buys the shelf Voucher once, for 150 on the first', () => {
    const bought = must(buyVoucher(player, run));
    expect(bought.player.gold).toBe(850);
    expect(bought.player.vouchers).toEqual([voucher.item.id]);
    expect(bought.run.shop!.voucher!.sold).toBe(true);
    expect(buyVoucher(bought.player, bought.run)).toEqual({ ok: false, error: 'sold_out' });
  });

  it('Overclock takes effect for later events by setting the exponent on the player', () => {
    const stock: ShopStock = {
      charms: [],
      packs: [],
      voucher: { item: { id: 'overclock', name: 'Overclock' }, price: 150, sold: false },
      rerolls: 0,
    };
    const bought = must(buyVoucher(player, open(player, SEED, stock)));
    expect(bought.player.zoneExponent).toBe(1.65);
    expect(player.zoneExponent).toBe(1.6);
  });

  it('fails on a closed shop, an empty shelf, short gold, or a Voucher already owned', () => {
    expect(buyVoucher(player, makeRun())).toEqual({ ok: false, error: 'shop_closed' });
    const none = open(player, SEED, { charms: [], packs: [], voucher: null, rerolls: 0 });
    expect(buyVoucher(player, none)).toEqual({ ok: false, error: 'no_such_slot' });
    expect(buyVoucher(rich(149), run)).toEqual({ ok: false, error: 'insufficient_gold' });
    const owner = rich(1000, { vouchers: [voucher.item.id] });
    expect(buyVoucher(owner, run)).toEqual({ ok: false, error: 'already_owned' });
  });
});

describe('re-rolls (Requirement 8.4)', () => {
  const player = rich();

  it('cost 20, then 30, 40 ... within a visit', () => {
    let current = player;
    let run = open(player);
    const costs: number[] = [];
    for (let index = 0; index < 4; index += 1) {
      expect(rerollCost(current, run.shop!)).toBe(20 + 10 * index);
      const next = must(rerollShop(current, run));
      costs.push(next.cost);
      expect(next.player.gold).toBe(current.gold - next.cost);
      current = next.player;
      run = next.run;
    }
    expect(costs).toEqual([20, 30, 40, 50]);
    expect(run.shop!.rerolls).toBe(4);
  });

  it('start at 10 with Cheaper Re-rolls', () => {
    const cheap = rich(1000, { vouchers: ['cheaper-rerolls'] });
    const first = must(rerollShop(cheap, open(cheap)));
    expect(first.cost).toBe(10);
    expect(rerollCost(first.player, first.run.shop!)).toBe(20);
  });

  it('give new Charms and packs, keep the Voucher, and are deterministic', () => {
    const run = open(player);
    const a = must(rerollShop(player, run));
    const b = must(rerollShop(player, run));
    expect(a.run).toEqual(b.run);
    expect(a.run.shop!.voucher).toEqual(run.shop!.voucher);
    expect(a.run.shop!.charms).toHaveLength(2);
    expect(a.run.shop!.packs).toHaveLength(2);
    expect(a.run.shop!.packs.every((slot) => slot.nonce === 1 && !slot.sold)).toBe(true);
    const changed = new Set<string>();
    for (let seed = 1; seed <= 30; seed += 1) {
      const base = open(player, seed);
      changed.add(
        JSON.stringify(must(rerollShop(player, base)).run.shop!.charms) ===
          JSON.stringify(base.shop!.charms)
          ? 'same'
          : 'new',
      );
    }
    expect(changed.has('new')).toBe(true);
  });

  it('a pack bought but not yet picked survives a re-roll; a picked one is replaced', () => {
    const run = open(player);
    const bought = must(buyPack(player, run, 0));
    const original = bought.options;
    const rolled = must(rerollShop(bought.player, bought.run));
    expect(rolled.run.shop!.packs[0]).toEqual(bought.run.shop!.packs[0]);
    expect(packOptions(rolled.run, 0)).toEqual(original);
    const kept = must(pickPackOption(rolled.player, rolled.run, 0, 0));
    const again = must(rerollShop(kept.player, kept.run));
    expect(again.run.shop!.packs[0]!.sold).toBe(false);
  });

  it('fail when short of gold or when the shop is closed', () => {
    expect(rerollShop(rich(19), open(rich(19)))).toEqual({ ok: false, error: 'insufficient_gold' });
    expect(rerollShop(player, makeRun())).toEqual({ ok: false, error: 'shop_closed' });
  });
});

describe('selling and the shrine', () => {
  it('sells a Charm for half its price, shop open or not', () => {
    const owner: PlayerState = { ...rich(10), charms: [held('hot-potato'), held('lantern', 2)] };
    const sold = must(sellHeldCharm(owner, 'hot-potato'));
    expect(sold.player.gold).toBe(70);
    expect(sold.entry).toEqual({ reason: 'sell', delta: 60, balance: 70 });
    expect(sold.player.charms.map((entry) => entry.id)).toEqual(['lantern']);
    expect(must(sellHeldCharm(owner, 'lantern')).player.gold).toBe(30);
    expect(sellHeldCharm(owner, 'oracle')).toEqual({ ok: false, error: 'not_held' });
  });

  it('removes a Pledge from the deck for 50 gold, 0 with the Shrine Pass', () => {
    const paid = must(removePledgeAtShrine(rich(80), 'defend'));
    expect(paid.cost).toBe(50);
    expect(paid.player.gold).toBe(30);
    expect(paid.player.deck.map((entry) => entry.id)).not.toContain('defend');
    expect(paid.removed.id).toBe('defend');
    const free = must(removePledgeAtShrine(rich(0, { vouchers: ['shrine-pass'] }), 'tidy'));
    expect(free.cost).toBe(0);
    expect(free.player.gold).toBe(0);
    expect(free.player.deck).toHaveLength(4);
  });

  it('fails without the gold or a card that is not in the deck', () => {
    expect(removePledgeAtShrine(rich(49), 'defend')).toEqual({
      ok: false,
      error: 'insufficient_gold',
    });
    expect(removePledgeAtShrine(rich(100), 'pair-up')).toEqual({ ok: false, error: 'not_in_deck' });
  });
});

describe('granting Charms and the Legendary offer', () => {
  it('grantCharm adds, stacks and auto-sells with the gold credited', () => {
    const lantern = makeCharm(charmDefinition('lantern')!);
    const first = must(grantCharm(rich(0), lantern));
    expect(first.outcome).toBe('added');
    expect(first.saleEntry).toBeNull();
    const second = must(grantCharm(first.player, lantern));
    expect(second.outcome).toBe('stacked');
    const third = must(grantCharm(second.player, lantern));
    expect(third.outcome).toBe('auto_sold');
    expect(third.player.gold).toBe(20);
    expect(addCharm(rich(0, { charms: [] }), lantern).ok).toBe(true);
  });

  it('refuses a Charm with no free slot', () => {
    const full: PlayerState = {
      ...rich(),
      charms: (['rubber-duck', 'lantern', 'small-hands', 'hot-potato', 'grey-beard'] as const).map(
        (id) => held(id),
      ),
    };
    expect(grantCharm(full, makeCharm(charmDefinition('oracle')!))).toEqual({
      ok: false,
      error: 'no_free_slot',
    });
  });

  it('the Legendary offer is a Legendary Charm, the same for the same seed', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 60; seed += 1) {
      const offer = legendaryOffer(seed);
      expect(offer.rarity).toBe('legendary');
      expect(legendaryOffer(seed)).toEqual(offer);
      seen.add(offer.id);
    }
    expect(seen.size).toBe(3);
  });
});
