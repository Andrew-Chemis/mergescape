/**
 * Task 16: the shop, shrine and Pledge endpoints (docs/api-contract.md), their errors, their idempotency
 * and what happens when two requests race. The ingest side is driven by fixture deliveries; the shop
 * opens for real when the author's second PR merges (seed 1: Charms Lantern and Rubber Duck at 40 gold,
 * a Charm pack at 100, a cosmetic pack at 50, the Overclock Voucher at 150).
 */
import { charmDefinition, makeCharm, zoneFor } from '@mergescape/shared';
import type { Charm } from '@mergescape/shared';
import { describe, expect, it } from 'vitest';
import type { MeResponse, MutationResponse, WeekSummary } from '../src/api-types';
import { MAX_REQUEST_BYTES } from '../src/handlers/api';
import { MAX_REQUEST_IDS } from '../src/idempotent';
import { apiRequest, PAGES_ORIGIN } from './api-harness';
import { DAY, makeGame, playLife } from './game-harness';
import type { Game, Reply } from './game-harness';
import { START } from './harness';
import { auditSchema } from './support';
import { AUTHOR_ID, fixtureDelivery, REVIEWER_ID } from './webhooks';

let counter = 0;
/** A fresh client request id (a uuid in production). */
const rid = (): string => `req-${String((counter += 1)).padStart(10, '0')}`;

const charm = (id: Parameters<typeof charmDefinition>[0]): Charm =>
  makeCharm(charmDefinition(id) as NonNullable<ReturnType<typeof charmDefinition>>);

/** The author has cleared the Scout act (the shop is open) and holds `gold`. */
async function openShop(gold = 500): Promise<Game> {
  const g = makeGame();
  await g.signIn(AUTHOR_ID);
  await g.signIn(REVIEWER_ID);
  await playLife(g, 17);
  await playLife(g, 31);
  await setProfile(g, { gold });
  return g;
}

async function setProfile(
  g: Game,
  patch: Parameters<Game['db']['saveProfile']>[2],
  id = AUTHOR_ID,
): Promise<void> {
  const profile = await g.db.getProfile(id, true);
  await g.db.saveProfile(id, profile?.version ?? 0, patch);
}

const week = async (g: Game, id = AUTHOR_ID) =>
  (await g.get('/week', id)).body as unknown as WeekSummary;
const me = async (g: Game, id = AUTHOR_ID) =>
  (await g.get('/me', id)).body as unknown as MeResponse;
const result = (reply: Reply) => reply.body as unknown as MutationResponse;

describe('the shop is open after the Scout clear', () => {
  it('shows the contract shape: charms, packs, the voucher, prices and previews', async () => {
    const g = await openShop(500);
    const { shop } = await week(g);
    expect(shop).toEqual({
      visit: 1,
      charms: [
        { index: 0, charm: expect.objectContaining({ id: 'lantern' }), price: 40, sold: false },
        { index: 1, charm: expect.objectContaining({ id: 'whetstone' }), price: 40, sold: false },
      ],
      packs: [
        { index: 0, kind: 'charm', price: 100, bought: false, picked: false, options: null },
        { index: 1, kind: 'cosmetic', price: 50, bought: false, picked: false, options: null },
      ],
      voucher: { id: 'overclock', price: 150, sold: false },
      rerollCost: 20,
      shrineCost: 50,
      sellPrices: {},
      interestPreview: 10,
    });
  });
});

describe('POST /shop/buy', () => {
  it('buys a Charm, taking its price and giving the Charm; sold stays sold', async () => {
    const g = await openShop(500);
    const bought = await g.post('/shop/buy', { requestId: rid(), kind: 'charm', index: 0 });
    expect(bought.status).toBe(200);
    expect(result(bought).me.gold).toBe(460);
    expect(result(bought).me.charms.map((held) => held.id)).toEqual(['lantern']);
    expect(result(bought).week.shop?.charms[0]?.sold).toBe(true);
    // Held Charms can be sold, at half price.
    expect(result(bought).week.shop?.sellPrices).toEqual({ lantern: 20 });

    const again = await g.post('/shop/buy', { requestId: rid(), kind: 'charm', index: 0 });
    expect(again).toEqual({ status: 409, body: { error: 'sold_out' } });
    expect((await me(g)).gold).toBe(460);
  });

  it('answers a replayed request id with the same response and spends nothing twice', async () => {
    const g = await openShop(500);
    const body = { requestId: rid(), kind: 'charm', index: 1 };
    const first = await g.post('/shop/buy', body);
    const second = await g.post('/shop/buy', body);
    const third = await g.post('/shop/buy', body);
    expect(second).toEqual(first);
    expect(third).toEqual(first);
    expect((await me(g)).gold).toBe(460);
    expect((await me(g)).charms).toHaveLength(1);
  });

  it('remembers only the last 20 request ids', async () => {
    const g = await openShop(5000);
    const first = { requestId: rid(), kind: 'voucher' };
    await g.post('/shop/buy', first);
    for (let i = 0; i < MAX_REQUEST_IDS; i += 1) {
      await g.post('/shop/sell', { requestId: rid(), charmId: 'nothing' }); // 409, not recorded
    }
    const items = (await g.db.getWeekItem(AUTHOR_ID, '2026-46'))?.requestIds ?? [];
    expect(items).toEqual([first.requestId]);
    for (let i = 0; i < MAX_REQUEST_IDS; i += 1) {
      await g.post('/shop/reroll', { requestId: rid() });
    }
    const after = (await g.db.getWeekItem(AUTHOR_ID, '2026-46'))?.requestIds ?? [];
    expect(after).toHaveLength(MAX_REQUEST_IDS);
    expect(after).not.toContain(first.requestId);
  });

  it('answers 409 insufficient_gold when the price is more than the gold held', async () => {
    const g = await openShop(39);
    const before = await week(g);
    const poor = await g.post('/shop/buy', { requestId: rid(), kind: 'charm', index: 0 });
    expect(poor).toEqual({ status: 409, body: { error: 'insufficient_gold' } });
    expect(await week(g)).toEqual(before);
    expect((await me(g)).gold).toBe(39);
  });

  it('opens a pack on purchase and lets the player keep exactly one of its 3 options', async () => {
    const g = await openShop(500);
    const opened = await g.post('/shop/buy', { requestId: rid(), kind: 'pack', index: 0 });
    expect(opened.status).toBe(200);
    expect(result(opened).me.gold).toBe(400);
    const pack = result(opened).week.shop?.packs[0];
    expect(pack).toMatchObject({ kind: 'charm', bought: true, picked: false });
    expect(pack?.options).toHaveLength(3);
    // The options are the same on every read and the shop cannot be re-rolled out from under them.
    expect((await week(g)).shop?.packs[0]?.options).toEqual(pack?.options);

    const keep = pack?.options?.[1];
    expect(keep?.kind).toBe('charm');
    const picked = await g.post('/shop/pick', { requestId: rid(), index: 0, option: 1 });
    expect(picked.status).toBe(200);
    expect(result(picked).week.shop?.packs[0]).toMatchObject({ picked: true, options: null });
    expect(result(picked).me.charms).toHaveLength(1);
    expect(result(picked).me.charms[0]?.id).toBe(keep?.kind === 'charm' ? keep.charm.id : '');

    // Exactly one: a second pick, or buying the same pack again, is refused.
    expect(await g.post('/shop/pick', { requestId: rid(), index: 0, option: 2 })).toEqual({
      status: 409,
      body: { error: 'already_picked' },
    });
    expect(await g.post('/shop/buy', { requestId: rid(), kind: 'pack', index: 0 })).toEqual({
      status: 409,
      body: { error: 'sold_out' },
    });
  });

  it('refuses to pick from a pack that was not bought, or an option that does not exist', async () => {
    const g = await openShop(500);
    expect(await g.post('/shop/pick', { requestId: rid(), index: 1, option: 0 })).toEqual({
      status: 409,
      body: { error: 'pack_not_bought' },
    });
    await g.post('/shop/buy', { requestId: rid(), kind: 'pack', index: 1 });
    expect(await g.post('/shop/pick', { requestId: rid(), index: 1, option: 7 })).toEqual({
      status: 409,
      body: { error: 'bad_option' },
    });
    // A Mogul cosmetic pack holds cosmetics, shown as such and kept on the profile.
    const cosmetic = (await week(g)).shop?.packs[1];
    expect(cosmetic?.kind).toBe('cosmetic');
    expect(cosmetic?.options?.every((option) => option.kind === 'cosmetic')).toBe(true);
    const kept = await g.post('/shop/pick', { requestId: rid(), index: 1, option: 0 });
    expect(kept.status).toBe(200);
    expect((await g.db.getProfile(AUTHOR_ID, true))?.cosmetics).toHaveLength(1);
  });

  it('buys the Voucher once; Overclock raises the Zone exponent for later events only', async () => {
    const g = await openShop(500);
    const before = await g.get('/log');
    const bought = await g.post('/shop/buy', { requestId: rid(), kind: 'voucher' });
    expect(bought.status).toBe(200);
    expect(result(bought).me.vouchers).toEqual(['overclock']);
    expect(result(bought).me.gold).toBe(350);
    expect(result(bought).week.shop?.voucher).toEqual({ id: 'overclock', price: 150, sold: true });
    expect(await g.post('/shop/buy', { requestId: rid(), kind: 'voucher' })).toEqual({
      status: 409,
      body: { error: 'sold_out' },
    });

    // The next scored event uses 1.65; the rows already in the log keep the 1.6 they were scored at.
    const level = (await me(g)).xp;
    await g.deliver(
      fixtureDelivery('pull_request.opened', (payload) => {
        payload.number = 40;
        (payload.pull_request as Record<string, unknown>).number = 40;
      }),
    );
    const rows = (
      (await g.get('/log')).body as { entries: { kind: string; zone: number; level: number }[] }
    ).entries;
    expect(rows[0]?.zone).toBeCloseTo(zoneFor(rows[0]?.level ?? 1, 1.65), 10);
    const older = (before.body as { entries: { zone: number; level: number }[] }).entries;
    expect(older[0]?.zone).toBeCloseTo(zoneFor(older[0]?.level ?? 1, 1.6), 10);
    expect(level).toBeGreaterThan(0);
  });

  it('answers 409 shop_closed before any act has cleared', async () => {
    const g = makeGame();
    await g.signIn(AUTHOR_ID);
    expect(await g.post('/shop/buy', { requestId: rid(), kind: 'charm', index: 0 })).toEqual({
      status: 409,
      body: { error: 'shop_closed' },
    });
    expect(await g.post('/shop/reroll', { requestId: rid() })).toEqual({
      status: 409,
      body: { error: 'shop_closed' },
    });
  });

  it('answers 409 no_free_slot when the Charm belt is full', async () => {
    const g = await openShop(500);
    await setProfile(g, {
      charms: (['rubber-duck', 'small-hands', 'hot-potato', 'grey-beard', 'oracle'] as const).map(
        charm,
      ),
    });
    const full = await g.post('/shop/buy', { requestId: rid(), kind: 'charm', index: 0 });
    expect(full).toEqual({ status: 409, body: { error: 'no_free_slot' } });
    expect((await me(g)).gold).toBe(500);
    // Selling one makes room.
    expect((await g.post('/shop/sell', { requestId: rid(), charmId: 'oracle' })).status).toBe(200);
    expect((await g.post('/shop/buy', { requestId: rid(), kind: 'charm', index: 0 })).status).toBe(
      200,
    );
  });
});

describe('POST /shop/reroll, /shop/sell and /shrine/remove', () => {
  it('re-rolls for 20 then 30 gold, keeping the Voucher and a bought pack', async () => {
    const g = await openShop(500);
    await g.post('/shop/buy', { requestId: rid(), kind: 'pack', index: 1 });
    const before = (await week(g)).shop;
    const first = await g.post('/shop/reroll', { requestId: rid() });
    expect(first.status).toBe(200);
    expect(result(first).me.gold).toBe(500 - 50 - 20);
    expect(result(first).week.shop?.rerollCost).toBe(30);
    expect(result(first).week.shop?.voucher).toEqual(before?.voucher);
    // The pack that was bought and not yet picked keeps its shelf slot, with the same options.
    expect(result(first).week.shop?.packs[1]).toEqual(before?.packs[1]);
    const second = await g.post('/shop/reroll', { requestId: rid() });
    expect(result(second).me.gold).toBe(500 - 50 - 20 - 30);
    expect(result(second).week.shop?.rerollCost).toBe(40);
    expect(await g.post('/shop/reroll', { requestId: rid() })).toMatchObject({ status: 200 });
  });

  it('sells a held Charm for half its price, with the shop open or not, and only once', async () => {
    const g = await openShop(500);
    await g.post('/shop/buy', { requestId: rid(), kind: 'charm', index: 0 });
    const sold = await g.post('/shop/sell', { requestId: rid(), charmId: 'lantern' });
    expect(sold.status).toBe(200);
    expect(result(sold).me.gold).toBe(500 - 40 + 20);
    expect(result(sold).me.charms).toEqual([]);
    expect(await g.post('/shop/sell', { requestId: rid(), charmId: 'lantern' })).toEqual({
      status: 409,
      body: { error: 'not_held' },
    });
  });

  it('removes a Pledge from the deck at the shrine for 50 gold', async () => {
    const g = await openShop(500);
    const removed = await g.post('/shrine/remove', { requestId: rid(), pledgeId: 'tidy' });
    expect(removed.status).toBe(200);
    expect(result(removed).me.gold).toBe(450);
    expect(result(removed).me.deck.map((pledge) => pledge.id)).toEqual([
      'strike',
      'defend',
      'big-game-hunter',
      'mentor',
    ]);
    expect(await g.post('/shrine/remove', { requestId: rid(), pledgeId: 'tidy' })).toEqual({
      status: 409,
      body: { error: 'not_in_deck' },
    });
    await setProfile(g, { gold: 10 });
    expect(await g.post('/shrine/remove', { requestId: rid(), pledgeId: 'mentor' })).toEqual({
      status: 409,
      body: { error: 'insufficient_gold' },
    });
  });
});

describe('POST /pledges/play', () => {
  it('plays up to 3 Pledges from the hand until Tuesday ends, each once', async () => {
    const g = makeGame();
    await g.signIn(AUTHOR_ID);
    const hand = (await week(g)).hand.map((pledge) => pledge.id);
    expect(hand).toEqual(['tidy', 'big-game-hunter', 'strike', 'mentor', 'defend']);

    const played = await g.post('/pledges/play', { requestId: rid(), pledgeId: 'strike' });
    expect(played.status).toBe(200);
    expect(result(played).week.played.map((pledge) => pledge.id)).toEqual(['strike']);
    expect(result(played).week.pledgeProgress).toEqual({
      strike: { progress: 0, target: 3, completed: false },
    });
    expect(await g.post('/pledges/play', { requestId: rid(), pledgeId: 'strike' })).toEqual({
      status: 409,
      body: { error: 'already_played' },
    });
    expect(await g.post('/pledges/play', { requestId: rid(), pledgeId: 'pair-up' })).toEqual({
      status: 409,
      body: { error: 'not_in_hand' },
    });
    await g.post('/pledges/play', { requestId: rid(), pledgeId: 'tidy' });
    await g.post('/pledges/play', { requestId: rid(), pledgeId: 'mentor' });
    expect(await g.post('/pledges/play', { requestId: rid(), pledgeId: 'defend' })).toEqual({
      status: 409,
      body: { error: 'play_limit' },
    });
    // Tuesday 23:59:59 is still open; Wednesday 00:00 is not.
    g.clock.now = Date.UTC(2026, 10, 10, 23, 59, 59);
    expect((await week(g)).pledgeWindowOpen).toBe(true);
    g.clock.now = Date.UTC(2026, 10, 11, 0, 0, 0);
    expect((await week(g)).pledgeWindowOpen).toBe(false);
  });

  it('auto-plays the top of the hand after Tuesday and stores it', async () => {
    const g = makeGame();
    await g.signIn(AUTHOR_ID);
    await g.post('/pledges/play', { requestId: rid(), pledgeId: 'defend' });
    g.clock.now = START + 2 * DAY;
    const wednesday = await week(g);
    expect(wednesday.played.map((pledge) => pledge.id)).toEqual([
      'defend',
      'tidy',
      'big-game-hunter',
    ]);
    expect((await g.db.getWeekItem(AUTHOR_ID, '2026-46'))?.run.played).toHaveLength(3);
    const writes = g.fake.calls.length;
    expect(await week(g)).toEqual(wednesday);
    // Nothing left to settle: the second read is reads only.
    expect(g.fake.calls.slice(writes).every((call) => call.operation === 'GetItem')).toBe(true);
  });
});

describe('two requests at once', () => {
  it('lets only one of two different requests buy the same shelf item', async () => {
    const g = await openShop(500);
    const [a, b] = await Promise.all([
      g.post('/shop/buy', { requestId: rid(), kind: 'charm', index: 0 }),
      g.post('/shop/buy', { requestId: rid(), kind: 'charm', index: 0 }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect([a, b].find((reply) => reply.status === 409)?.body).toEqual({ error: 'sold_out' });
    const after = await me(g);
    expect(after.gold).toBe(460);
    expect(after.charms.map((held) => held.id)).toEqual(['lantern']);
  });

  it('applies one request sent twice at once exactly once', async () => {
    const g = await openShop(500);
    const body = { requestId: rid(), kind: 'charm', index: 1 };
    const [a, b] = await Promise.all([g.post('/shop/buy', body), g.post('/shop/buy', body)]);
    expect(a.status).toBe(200);
    expect(b).toEqual(a);
    expect((await me(g)).gold).toBe(460);
  });

  it('lets two different items race for the gold for only one of them', async () => {
    const g = await openShop(50);
    const [a, b] = await Promise.all([
      g.post('/shop/buy', { requestId: rid(), kind: 'charm', index: 0 }),
      g.post('/shop/buy', { requestId: rid(), kind: 'charm', index: 1 }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect([a, b].find((reply) => reply.status === 409)?.body).toEqual({
      error: 'insufficient_gold',
    });
    const after = await me(g);
    expect(after.gold).toBe(10);
    expect(after.charms).toHaveLength(1);
    // The refused purchase did not leave its shelf slot sold.
    const sold = (await week(g)).shop?.charms.filter((slot) => slot.sold);
    expect(sold).toHaveLength(1);
  });

  it('redoes the purchase on the fresh profile when a scored event lands in between', async () => {
    const g = await openShop(100);
    let raced = false;
    g.intercept.api = async (input) => {
      const names = Object.values(input.ExpressionAttributeNames ?? {});
      if (!raced && input.Key?.SK === 'PROFILE' && names.includes('charms')) {
        raced = true;
        // A payout lands just before the purchase's profile write.
        await g.db.addPayout(AUTHOR_ID, { gold: 30, renown: 0 });
      }
    };
    const bought = await g.post('/shop/buy', { requestId: rid(), kind: 'charm', index: 0 });
    g.intercept.api = undefined;
    expect(raced).toBe(true);
    expect(bought.status).toBe(200);
    expect(result(bought).me.gold).toBe(100 + 30 - 40);
    expect(result(bought).me.charms).toHaveLength(1);
  });

  it('puts the shelf back and answers 409 when the redo finds the gold gone', async () => {
    const g = await openShop(50);
    const request = { requestId: rid(), kind: 'charm', index: 0 };
    let raced = false;
    g.intercept.api = async (input) => {
      const names = Object.values(input.ExpressionAttributeNames ?? {});
      if (!raced && input.Key?.SK === 'PROFILE' && names.includes('charms')) {
        raced = true;
        await setProfile(g, { gold: 5 });
      }
    };
    const before = await week(g);
    const refused = await g.post('/shop/buy', request);
    g.intercept.api = undefined;
    expect(refused).toEqual({ status: 409, body: { error: 'insufficient_gold' } });
    // Nothing was bought, the slot is unsold and the request id was not kept: it can be sent again.
    const after = await week(g);
    expect(after.shop?.charms).toEqual(before.shop?.charms);
    expect(after.shop?.packs).toEqual(before.shop?.packs);
    expect(after.shop?.charms.some((slot) => slot.sold)).toBe(false);
    expect((await g.db.getWeekItem(AUTHOR_ID, '2026-46'))?.requestIds).toEqual([]);
    await setProfile(g, { gold: 60 });
    const retry = await g.post('/shop/buy', request);
    expect(retry.status).toBe(200);
    expect(result(retry).me.gold).toBe(20);
  });

  it('puts the shelf back when the profile write fails, so the same request can be sent again', async () => {
    const g = await openShop(100);
    const request = { requestId: rid(), kind: 'charm', index: 0 };
    g.intercept.api = (input) => {
      const names = Object.values(input.ExpressionAttributeNames ?? {});
      if (input.Key?.SK === 'PROFILE' && names.includes('charms')) {
        throw new Error('the table is having a moment');
      }
    };
    const failed = await g.post('/shop/buy', request);
    g.intercept.api = undefined;
    expect(failed.status).toBe(500);
    expect((await g.db.getWeekItem(AUTHOR_ID, '2026-46'))?.requestIds).toEqual([]);
    expect((await week(g)).shop?.charms.some((slot) => slot.sold)).toBe(false);
    const retry = await g.post('/shop/buy', request);
    expect(retry.status).toBe(200);
    expect(result(retry).me.gold).toBe(60);
  });

  it('answers 404 and logs when the player is deleted between the week lock and the profile write', async () => {
    const g = await openShop(100);
    let raced = false;
    g.intercept.api = async (input) => {
      const names = Object.values(input.ExpressionAttributeNames ?? {});
      if (!raced && input.Key?.SK === 'PROFILE' && names.includes('charms')) {
        raced = true;
        await g.db.deleteUser(AUTHOR_ID);
      }
    };
    const reply = await g.post('/shop/buy', { requestId: rid(), kind: 'charm', index: 0 });
    g.intercept.api = undefined;
    expect(raced).toBe(true);
    expect(reply).toEqual({ status: 404, body: { error: 'no_profile' } });
    // The week went with the player, so there was nothing left to put back.
    expect(g.logs.join('\n')).toContain('mutation.undo_failed');
  });
});

describe('the Legendary offer and the free pack', () => {
  async function bossCleared(): Promise<Game> {
    const g = makeGame();
    await g.signIn(AUTHOR_ID);
    await g.signIn(REVIEWER_ID);
    // Three Renown already: the Boss clear makes it four, and every 4th Renown offers a Legendary Charm.
    await setProfile(g, { renown: 3 });
    await playLife(g, 17);
    await playLife(g, 31);
    await playLife(g, 32);
    return g;
  }

  it('offers a Legendary Charm on the 4th Renown, free, taken once, if there is a slot', async () => {
    const g = await bossCleared();
    const w = await week(g);
    expect(w.act).toBeNull();
    expect((await me(g)).renown).toBe(4);
    expect(w.legendaryOffer?.rarity).toBe('legendary');

    await setProfile(g, {
      charms: (['rubber-duck', 'lantern', 'small-hands', 'hot-potato', 'grey-beard'] as const).map(
        charm,
      ),
    });
    expect(await g.post('/shop/buy', { requestId: rid(), kind: 'legendary' })).toEqual({
      status: 409,
      body: { error: 'no_free_slot' },
    });
    await g.post('/shop/sell', { requestId: rid(), charmId: 'grey-beard' });
    const gold = (await me(g)).gold;
    const taken = await g.post('/shop/buy', { requestId: rid(), kind: 'legendary' });
    expect(taken.status).toBe(200);
    expect(result(taken).week.legendaryOffer).toBeNull();
    expect(result(taken).me.gold).toBe(gold);
    expect(result(taken).me.charms.some((held) => held.id === w.legendaryOffer?.id)).toBe(true);
    expect(await g.post('/shop/buy', { requestId: rid(), kind: 'legendary' })).toEqual({
      status: 409,
      body: { error: 'no_legendary_offer' },
    });
  });

  it('keeps the free Pledge pack until it is picked, with the same options every time', async () => {
    const g = await bossCleared();
    const w = await week(g);
    expect(w.freePack).toBe('pledge');
    expect(w.freePackOptions).toHaveLength(3);
    expect((await week(g)).freePackOptions).toEqual(w.freePackOptions);
    expect(await g.post('/shop/pick', { requestId: rid(), index: -1, option: 5 })).toEqual({
      status: 409,
      body: { error: 'bad_option' },
    });
    const taken = await g.post('/shop/pick', { requestId: rid(), index: -1, option: 2 });
    expect(taken.status).toBe(200);
    expect(result(taken).week.freePack).toBeNull();
    expect(result(taken).week.freePackOptions).toBeNull();
    const pledge = w.freePackOptions?.[2];
    expect(result(taken).me.deck.at(-1)).toEqual(pledge?.kind === 'pledge' ? pledge.pledge : null);
    expect(await g.post('/shop/pick', { requestId: rid(), index: -1, option: 0 })).toEqual({
      status: 409,
      body: { error: 'no_free_pack' },
    });
  });

  it('refuses the free pack when the deck is full', async () => {
    const g = await bossCleared();
    const filler = (await me(g)).deck;
    await setProfile(g, {
      deck: Array.from({ length: 20 }, (_, index) => filler[index % filler.length] as never),
    });
    expect(await g.post('/shop/pick', { requestId: rid(), index: -1, option: 0 })).toEqual({
      status: 409,
      body: { error: 'deck_full' },
    });
    expect((await week(g)).freePack).toBe('pledge');
  });
});

describe('request handling', () => {
  const request = async (
    g: Game,
    options: Parameters<typeof apiRequest>[0] & { body?: string },
  ) => {
    const { body, ...rest } = options;
    const result = await g.api({ ...apiRequest(rest), ...(body !== undefined ? { body } : {}) });
    return { status: result.statusCode, body: JSON.parse(result.body ?? '{}') as unknown };
  };

  it('answers 401 without a token, 403 from another origin, 404 for an unknown path', async () => {
    const g = await openShop();
    const token = await g.token();
    const body = JSON.stringify({ requestId: rid() });
    expect(await request(g, { method: 'POST', path: '/shop/reroll', body })).toMatchObject({
      status: 401,
    });
    expect(
      await request(g, {
        method: 'POST',
        path: '/shop/reroll',
        body,
        token,
        origin: 'https://evil.example',
      }),
    ).toMatchObject({ status: 403 });
    expect(
      await request(g, { method: 'POST', path: '/shop/reroll', body, token, origin: null }),
    ).toMatchObject({ status: 403 });
    expect(await request(g, { method: 'POST', path: '/shop/steal', body, token })).toMatchObject({
      status: 404,
    });
    expect(await request(g, { method: 'POST', path: '/week', body, token })).toMatchObject({
      status: 405,
    });
    expect(await request(g, { method: 'GET', path: '/shop/buy', token })).toMatchObject({
      status: 405,
    });
  });

  it('answers 400 for a body that is not valid and 413 for one that is too large', async () => {
    const g = await openShop();
    const token = await g.token();
    const post = (path: string, body: string) => request(g, { method: 'POST', path, body, token });
    const id = rid();
    for (const [path, body] of [
      ['/shop/buy', '{"requestId":'],
      ['/shop/buy', '[]'],
      ['/shop/buy', 'null'],
      ['/shop/buy', JSON.stringify({ kind: 'charm', index: 0 })],
      ['/shop/buy', JSON.stringify({ requestId: 'short', kind: 'charm', index: 0 })],
      ['/shop/buy', JSON.stringify({ requestId: id, kind: 'planet', index: 0 })],
      ['/shop/buy', JSON.stringify({ requestId: id, kind: 'charm' })],
      ['/shop/buy', JSON.stringify({ requestId: id, kind: 'charm', index: -1 })],
      ['/shop/buy', JSON.stringify({ requestId: id, kind: 'charm', index: 1.5 })],
      ['/shop/buy', JSON.stringify({ requestId: id, kind: 'charm', index: '0' })],
      ['/shop/pick', JSON.stringify({ requestId: id, index: -2, option: 0 })],
      ['/shop/pick', JSON.stringify({ requestId: id, index: 0, option: -1 })],
      ['/shop/pick', JSON.stringify({ requestId: id, index: 0 })],
      ['/shop/sell', JSON.stringify({ requestId: id })],
      ['/shop/sell', JSON.stringify({ requestId: id, charmId: '../../etc' })],
      ['/shrine/remove', JSON.stringify({ requestId: id, pledgeId: 7 })],
      ['/pledges/play', JSON.stringify({ requestId: id })],
    ] as const) {
      expect(await post(path, body), `${path} ${body}`).toMatchObject({ status: 400 });
    }
    const huge = JSON.stringify({ requestId: id, pad: 'x'.repeat(MAX_REQUEST_BYTES) });
    expect(await post('/shop/reroll', huge)).toMatchObject({ status: 413 });
    // None of it changed anything.
    expect((await g.db.getWeekItem(AUTHOR_ID, '2026-46'))?.requestIds).toEqual([]);
    expect(PAGES_ORIGIN).toBeDefined();
  });

  it('answers 404 for a signed-in token whose profile does not exist', async () => {
    const g = makeGame();
    expect(await g.post('/shop/reroll', { requestId: rid() }, 4242)).toEqual({
      status: 404,
      body: { error: 'no_profile' },
    });
    expect((await g.get('/week', 4242)).status).toBe(404);
  });
});

describe('the profile and the schema', () => {
  it('keeps every item inside the allow-lists after a busy shop', async () => {
    const g = await openShop(1000);
    await g.post('/shop/buy', { requestId: rid(), kind: 'charm', index: 0 });
    await g.post('/shop/buy', { requestId: rid(), kind: 'pack', index: 0 });
    await g.post('/shop/pick', { requestId: rid(), index: 0, option: 0 });
    await g.post('/shop/buy', { requestId: rid(), kind: 'voucher' });
    await g.post('/shop/reroll', { requestId: rid() });
    await g.post('/shrine/remove', { requestId: rid(), pledgeId: 'tidy' });
    await g.post('/pledges/play', { requestId: rid(), pledgeId: 'strike' });
    auditSchema(g.fake);
  });
});
