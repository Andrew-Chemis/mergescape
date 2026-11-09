/**
 * Task 22: the expedition, Forge, gear and Feat endpoints (docs/api-contract.md, "Depth layer"), and what
 * the ingest and the rollover do for them: banking supplies, evaluating Feats, the onboarding expedition,
 * the Boss-clear and weekly hooks. Both Lambdas run over one in-memory table with one injected clock.
 */
import {
  applyLoot,
  createPlayerState,
  featCountersOf,
  emptySatchel,
  FEATS,
  charmDefinition,
  lootPackOptions,
  makeCharm,
  makePiece,
  normalize,
  rollLoot,
  satchelOf,
} from '@mergescape/shared';
import type { Charm, ExpeditionState, FeatEvaluation } from '@mergescape/shared';
import { describe, expect, it } from 'vitest';
import type {
  ExpeditionCollectResponse,
  ExpeditionSendResponse,
  ExpeditionView,
  FeatsResponse,
  ForgeCollectResponse,
  ForgeView,
  LogResponse,
  MeResponse,
  MeResult,
  PackOptionsResponse,
} from '../src/api-types';
import { COIN_GLYPH, FEAT_GLYPHS } from '../src/badge';
import { featKey } from '../src/keys';
import { applyFeats, settleWorld } from '../src/feat-flow';
import { processDelivery } from '../src/ingest';
import { createRecordingMetrics } from '../src/metrics';
import { toPlayerState } from '../src/player';
import { apiRequest } from './api-harness';
import { DAY, HOUR, makeGame, playLife } from './game-harness';
import type { Game, Reply } from './game-harness';
import { START } from './harness';
import { auditSchema, itemsWithPrefix } from './support';
import { AUTHOR_ID, fixtureDelivery, fixtureJson, REVIEWER_ID } from './webhooks';

let counter = 0;
/** A fresh client request id (a uuid in production). */
const rid = (): string => `req-${String((counter += 1)).padStart(10, '0')}`;

type Patch = Parameters<Game['db']['saveProfile']>[2];

async function patch(g: Game, changes: Patch, id = AUTHOR_ID): Promise<void> {
  const profile = await g.db.getProfile(id, true);
  await g.db.saveProfile(id, profile?.version ?? 0, changes);
}

/** A signed-in author with a satchel to spend and nothing else (no event has been scored). */
async function newcomer(satchel: Partial<ReturnType<typeof emptySatchel>> = {}): Promise<Game> {
  const g = makeGame();
  await g.signIn(AUTHOR_ID);
  await patch(g, { satchel: { ...emptySatchel(), ...satchel } });
  return g;
}

const me = async (g: Game, id = AUTHOR_ID) =>
  (await g.get('/me', id)).body as unknown as MeResponse;
const sentOf = (reply: Reply) => reply.body as unknown as ExpeditionSendResponse;
const collectedOf = (reply: Reply) => reply.body as unknown as ExpeditionCollectResponse;
const meOf = (reply: Reply) => (reply.body as unknown as MeResult).me;

const SK_PREFIX = (g: Game, prefix: string, id = AUTHOR_ID) =>
  itemsWithPrefix(g.fake, `USER#${id}`).filter((item) => String(item.SK).startsWith(prefix));

function renumber(number: number) {
  return (payload: Record<string, unknown>): void => {
    if (typeof payload.number === 'number') {
      payload.number = number;
    }
    (payload.pull_request as Record<string, unknown>).number = number;
  };
}

/** The author opens PR `number` and the reviewer approves it, so its merge has another human's approval. */
async function openAndApprove(g: Game, number: number): Promise<void> {
  await g.deliver(fixtureDelivery('pull_request.opened', renumber(number)));
  await g.deliver(fixtureDelivery('pull_request_review.approved', renumber(number)));
}

const merge = (number: number, deliveryId?: string) =>
  fixtureDelivery('pull_request.closed.merged', renumber(number), deliveryId ? { deliveryId } : {});

/** Sum of the supplies the Combat Log says one player's events dropped. */
async function loggedSupplies(g: Game, id = AUTHOR_ID): Promise<Record<string, number>> {
  const total: Record<string, number> = {};
  const { rows } = await g.db.listEvents(id, { limit: 200 });
  for (const row of rows) {
    for (const [kind, amount] of Object.entries(row.supplies)) {
      total[kind] = (total[kind] ?? 0) + amount;
    }
  }
  return total;
}

const suppliesOf = (satchel: MeResponse['satchel']) => ({
  ore: satchel.ore,
  timber: satchel.timber,
  lore: satchel.lore,
  ink: satchel.ink,
  provisions: satchel.provisions,
  flux: satchel.flux,
});

// ---------------------------------------------------------------------------------------------
// Ingest: supplies, Feats, the onboarding expedition, Boss clear and rollover
// ---------------------------------------------------------------------------------------------

describe('ingest banks supplies and evaluates Feats', () => {
  it('banks what each scored event dropped, for every player it credited', async () => {
    const g = makeGame();
    await g.signIn(AUTHOR_ID);
    await g.signIn(REVIEWER_ID);
    await playLife(g, 17);
    for (const id of [AUTHOR_ID, REVIEWER_ID]) {
      const logged = await loggedSupplies(g, id);
      const held = (await me(g, id)).satchel;
      expect(suppliesOf(held)).toEqual({
        ore: 0,
        timber: 0,
        lore: 0,
        ink: 0,
        provisions: 0,
        flux: 0,
        ...logged,
      });
      expect(held.silver + held.mithril + held.rune + held.dragon).toBe(0);
    }
    // The merge (250 + 50 lines, party bonus) dropped Ore x3, Timber, 2 Provisions, plus the day's first 1.
    const author = (await me(g)).satchel;
    expect(author.ore).toBeGreaterThan(0);
    expect(author.timber).toBe(1);
    expect(author.provisions).toBe(3);
    // The reviewer's approval and inline comment dropped Lore and Ink.
    const reviewer = (await me(g, REVIEWER_ID)).satchel;
    expect(reviewer.lore).toBeGreaterThanOrEqual(2);
    expect(reviewer.ink).toBe(1);
    auditSchema(g.fake);
  });

  it('unlocks a Feat exactly once when the same delivery arrives four times at once', async () => {
    const g = makeGame();
    await g.signIn(AUTHOR_ID);
    await g.signIn(REVIEWER_ID);
    await openAndApprove(g, 17);
    await openAndApprove(g, 31);
    await g.deliver(merge(17));
    expect((await me(g)).titles).toEqual([]);

    // Both merges say 11:00:00Z, so the second one is a Merge Conflict ("two merges in the same minute").
    const duplicate = '11111111-2222-4333-8444-555555555555';
    const replies = await Promise.all([0, 1, 2, 3].map(() => g.deliver(merge(31, duplicate))));
    expect(replies.map((reply) => reply.statusCode)).toEqual([200, 200, 200, 200]);

    const feats = SK_PREFIX(g, 'FEAT#');
    expect(feats.map((item) => item.SK)).toEqual(['FEAT#merge-conflict']);
    expect(feats[0]).toMatchObject({ delivery_id: duplicate });
    const after = await me(g);
    expect(after.titles).toEqual(['Simultaneous']);
    const profile = await g.db.getProfile(AUTHOR_ID, true);
    expect(profile?.featsUnlocked).toEqual(['merge-conflict']);
    expect(profile?.featCounters?.simultaneousMerges).toBe(1);
    // The duplicates banked nothing: the satchel is what the Combat Log says, once.
    expect(suppliesOf(after.satchel)).toEqual({
      ore: 0,
      timber: 0,
      lore: 0,
      ink: 0,
      provisions: 0,
      flux: 0,
      ...(await loggedSupplies(g)),
    });
    expect(g.logs).toEqual([]);
    auditSchema(g.fake);
  });

  it('unlocks a Feat exactly once when different events race for it', async () => {
    const g = makeGame();
    await g.signIn(AUTHOR_ID);
    await g.signIn(REVIEWER_ID);
    for (const number of [17, 31, 32]) {
      await openAndApprove(g, number);
    }
    // Three merges of one player at once: each re-reads and re-scores when another one lands first.
    const replies = await Promise.all([17, 31, 32].map((number) => g.deliver(merge(number))));
    expect(replies.map((reply) => reply.statusCode)).toEqual([200, 200, 200]);

    expect(SK_PREFIX(g, 'FEAT#').map((item) => item.SK)).toEqual(['FEAT#merge-conflict']);
    const profile = await g.db.getProfile(AUTHOR_ID, true);
    expect(profile?.featsUnlocked).toEqual(['merge-conflict']);
    expect(profile?.titles).toEqual(['Simultaneous']);
    // Every merge counted once, however often it was re-scored.
    expect(profile?.featCounters?.approvedMerges).toBe(3);
    expect(profile?.featCounters?.simultaneousMerges).toBe(2);
    expect(suppliesOf((await me(g)).satchel)).toEqual({
      ore: 0,
      timber: 0,
      lore: 0,
      ink: 0,
      provisions: 0,
      flux: 0,
      ...(await loggedSupplies(g)),
    });
    expect(g.logs).toEqual([]);
    auditSchema(g.fake);
  });

  it('banks supplies but never counts a backfilled event toward a Feat or sends the expedition', async () => {
    const g = makeGame();
    await g.signIn(AUTHOR_ID);
    const events = normalize('pull_request', fixtureJson('pull_request.closed.merged')).map(
      (event) => ({ ...event, backfill: true }),
    );
    const context = {
      db: g.db,
      metrics: createRecordingMetrics(),
      log: { error: () => undefined },
      now: () => g.clock.now,
    };
    expect(await processDelivery(context, 'backfill-delivery-0001', events)).toBe('processed');
    const profile = await g.db.getProfile(AUTHOR_ID, true);
    expect(profile?.satchel.ore).toBeGreaterThan(0);
    expect(profile?.featCounters).toBeNull();
    expect(profile?.expedition).toBeNull();
    expect(SK_PREFIX(g, 'EXPEDITION#')).toHaveLength(0);

    // The next real event counts, and sends the one onboarding expedition.
    await g.deliver(fixtureDelivery('pull_request.opened', renumber(31)));
    const after = await g.db.getProfile(AUTHOR_ID, true);
    expect(after?.featCounters?.hours.reduce((sum, count) => sum + count, 0)).toBe(1);
    expect(after?.expedition).toMatchObject({ region: 'koko-woods', forage: true });
  });
});

describe('the onboarding expedition', () => {
  it('sends the free 4 h Koko Woods Forage once, after the first scored event', async () => {
    const g = makeGame();
    await g.signIn(AUTHOR_ID);
    expect((await me(g)).expedition).toBeNull();
    await g.deliver(fixtureDelivery('pull_request.opened', renumber(17)));
    const first = (await me(g)).expedition as ExpeditionState;
    expect(first).toMatchObject({
      region: 'koko-woods',
      hours: 4,
      forage: true,
      sentAt: START,
      returnsAt: START + 4 * HOUR,
      seed: g.roll.seed,
      provisionsPaid: 0,
      collected: false,
    });
    const items = SK_PREFIX(g, 'EXPEDITION#');
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      SK: `EXPEDITION#${new Date(START).toISOString()}`,
      region: 'koko-woods',
      forage: true,
      collected: false,
      seed: g.roll.seed,
    });

    // More events change nothing about it, and neither does collecting it: it is only ever sent once.
    g.roll.seed = 99;
    await playLife(g, 31);
    expect((await me(g)).expedition).toEqual(first);
    g.clock.now += 5 * HOUR;
    const collected = await g.post('/expedition/collect', { requestId: rid() });
    expect(collected.status).toBe(200);
    expect(collectedOf(collected).loot).toEqual(rollLoot(first));
    await playLife(g, 32);
    expect((await me(g)).expedition).toMatchObject({ sentAt: first.sentAt, collected: true });
    expect(SK_PREFIX(g, 'EXPEDITION#')).toHaveLength(1);
    auditSchema(g.fake);
  });
});

describe('settling Feats', () => {
  it('checks the Feats again when a Feat awards a pet, because the pet can complete another', () => {
    const player = createPlayerState(1);
    const counters = featCountersOf(player);
    const evaluation = {
      unlocked: [
        {
          id: 'omnilinguist',
          name: 'Omnilinguist',
          reward: { title: null, unique: null, pet: 'polyglot-parrot', bonus: false },
        },
      ],
      counters,
      changed: false,
    };
    const settled = applyFeats(player, evaluation, START);
    expect(settled.player.pets).toEqual(['linter-cat', 'polyglot-parrot']);
    expect(settled.player.feats.unlocked).toEqual(['omnilinguist']);
    expect(settled.unlocked.map((feat) => feat.id)).toEqual(['omnilinguist']);
    // No pet, no second look.
    const noPet: FeatEvaluation = {
      ...evaluation,
      unlocked: [
        {
          id: 'first-light',
          name: 'First Light',
          reward: { title: 'Lamplighter', unique: null, pet: null, bonus: false },
        },
      ],
    };
    const plain = applyFeats(player, noPet, START);
    expect(plain.player.pets).toBeUndefined();
    expect(plain.player.titles).toEqual(['Lamplighter']);
  });

  it('gives up when the profile never stops moving under a world event', async () => {
    const g = makeGame();
    await g.signIn(AUTHOR_ID);
    await patch(g, { renown: 8 });
    g.intercept.api = async (input) => {
      const names = Object.values(input.ExpressionAttributeNames ?? {});
      if (input.Key?.SK === 'PROFILE' && names.includes('feats_unlocked')) {
        await g.db.addPayout(AUTHOR_ID, { gold: 1, renown: 0 });
      }
    };
    await expect(
      settleWorld(g.db, AUTHOR_ID, { kind: 'refresh' }, g.clock.now, 'refresh-test'),
    ).rejects.toThrow('Profile version conflict');
    g.intercept.api = undefined;
    expect(SK_PREFIX(g, 'FEAT#')).toHaveLength(0);
  });
});

describe('the Boss clear and the weekly rollover reach the Feats', () => {
  it('counts the Mogul and the Boss week, and the Renown the clear paid can unlock a Feat', async () => {
    const g = makeGame();
    await g.signIn(AUTHOR_ID);
    await g.signIn(REVIEWER_ID);
    await patch(g, { renown: 7 });
    for (const number of [17, 31, 32]) {
      await playLife(g, number);
    }
    const profile = await g.db.getProfile(AUTHOR_ID, true);
    expect(profile?.renown).toBe(8);
    expect(profile?.featCounters?.moguls).toEqual(['two-pizza-boss']);
    expect(profile?.featCounters?.bossStreak).toBe(1);
    expect(profile?.featsUnlocked).toEqual(expect.arrayContaining(['renowned', 'merge-conflict']));
    expect(profile?.titles).toEqual(expect.arrayContaining(['Renowned', 'Simultaneous']));
    const renowned = SK_PREFIX(g, 'FEAT#renowned');
    expect(renowned).toHaveLength(1);
    expect(renowned[0]).toMatchObject({ delivery_id: 'boss-2026-46' });
    expect(g.logs).toEqual([]);
    auditSchema(g.fake);
  });

  it('re-reads and applies a world event once when the profile moves under it', async () => {
    const g = makeGame();
    await g.signIn(AUTHOR_ID);
    await patch(g, { renown: 8 });
    let raced = false;
    g.intercept.api = async (input) => {
      const names = Object.values(input.ExpressionAttributeNames ?? {});
      if (!raced && input.Key?.SK === 'PROFILE' && names.includes('feat_counters')) {
        raced = true;
        await g.db.addPayout(AUTHOR_ID, { gold: 5, renown: 0 });
      }
    };
    const world = { kind: 'boss_cleared', mogul: 'two-pizza-boss' } as const;
    const unlocked = await settleWorld(g.db, AUTHOR_ID, world, g.clock.now, 'boss-test');
    g.intercept.api = undefined;
    expect(raced).toBe(true);
    expect(unlocked.map((feat) => feat.id)).toEqual(['renowned']);
    const profile = await g.db.getProfile(AUTHOR_ID, true);
    expect(profile?.gold).toBe(5);
    expect(profile?.featsUnlocked).toEqual(['renowned']);
    expect(profile?.featCounters).toMatchObject({ moguls: ['two-pizza-boss'], bossStreak: 1 });
    expect(SK_PREFIX(g, 'FEAT#renowned')[0]).toMatchObject({ delivery_id: 'boss-test' });

    // The same Boss week again changes nothing, and nobody's profile means nothing to do.
    expect(await settleWorld(g.db, AUTHOR_ID, world, g.clock.now, 'boss-again')).toEqual([]);
    expect(await settleWorld(g.db, 4242, world, g.clock.now, 'boss-nobody')).toEqual([]);
    expect(SK_PREFIX(g, 'FEAT#')).toHaveLength(1);
  });

  it('banks the equipped pet once per run start and checks the Feats the new week reached', async () => {
    const g = makeGame();
    await g.signIn(AUTHOR_ID);
    await me(g);
    const worn = await g.post('/gear/equip', { requestId: rid(), petId: 'linter-cat' });
    expect(meOf(worn).gear.equipped.pet).toMatchObject({ ref: 'linter-cat' });
    await patch(g, { renown: 8 });
    expect((await me(g)).satchel.ink).toBe(0);

    g.clock.now += 7 * DAY;
    const first = await g.rollover();
    expect(first.processed).toBe(1);
    const rolled = await g.db.getProfile(AUTHOR_ID, true);
    expect(rolled?.satchel.ink).toBe(1);
    // Renown 8 reaches the Renowned Feat; the rollover names itself as the event that unlocked it.
    expect(rolled?.featsUnlocked).toEqual(['renowned']);
    expect(SK_PREFIX(g, 'FEAT#renowned')[0]).toMatchObject({ delivery_id: 'rollover-2026-47' });

    // A second rollover (a retried schedule) and a lazy start change nothing.
    await g.rollover();
    await me(g);
    expect((await g.db.getProfile(AUTHOR_ID, true))?.satchel.ink).toBe(1);
    auditSchema(g.fake);
  });
});

// ---------------------------------------------------------------------------------------------
// Expeditions
// ---------------------------------------------------------------------------------------------

describe('GET /expedition', () => {
  it('lists the eight regions with their gates, the five choices and what can be afforded', async () => {
    const g = await newcomer({ provisions: 2 });
    const reply = await g.get('/expedition');
    expect(reply.status).toBe(200);
    const view = reply.body as unknown as ExpeditionView;
    expect(view.expedition).toBeNull();
    expect(view.status).toBe('none');
    expect(view.returnsAt).toBeNull();
    expect(
      view.regions.map((region) => [region.id, region.renownRequired, region.unlocked]),
    ).toEqual([
      ['koko-woods', 0, true],
      ['crossroads-of-wix', 2, false],
      ['orrl-falls', 8, false],
      ['silverhall', 16, false],
      ['koko-deep-woods', 24, false],
      ['mazu-deep', 32, false],
      ['quu-spire', 48, false],
      ['garbage-collector', 64, false],
    ]);
    expect(view.regions.every((region) => region.lean === null)).toBe(true);
    expect(
      view.choices.map((choice) => [
        choice.choice,
        choice.hours,
        choice.provisions,
        choice.affordable,
      ]),
    ).toEqual([
      ['forage', 4, 0, true],
      [4, 4, 1, true],
      [12, 12, 2, true],
      [24, 24, 4, false],
      [48, 48, 6, false],
    ]);
    expect(view.choices[1]?.durationMs).toBe(4 * HOUR);
  });

  it('shows Quick gear in the real duration and the Index in the regions leans', async () => {
    const g = await newcomer({ provisions: 2, lore: 50 });
    const quick = makePiece({ id: 'q1', slot: 'weapon', tier: 'leather', affix: 'quick' });
    await patch(g, { gear: { pieces: [quick] } });
    const bought = await g.post('/forge/upgrade', { requestId: rid(), upgrade: 'index' });
    expect(bought.status).toBe(200);
    const view = (await g.get('/expedition')).body as unknown as ExpeditionView;
    // Nominal hours stay 4; the trip takes 10% less.
    expect(view.choices[1]).toMatchObject({ hours: 4, durationMs: 4 * HOUR * 0.9 });
    expect(view.regions[0]?.lean).toBe('Timber, Provisions, Leather gear');
    const sent = await g.post('/expedition/send', {
      requestId: rid(),
      region: 'koko-woods',
      choice: 4,
    });
    expect(sentOf(sent).expedition.returnsAt - sentOf(sent).expedition.sentAt).toBe(4 * HOUR * 0.9);
  });
});

describe('POST /expedition/send and /expedition/collect', () => {
  it('sends, advances the clock, collects twice and rolls the loot once', async () => {
    const g = await newcomer({ provisions: 10 });
    const request = { requestId: rid(), region: 'koko-woods', choice: 4 };
    const sent = await g.post('/expedition/send', request);
    expect(sent.status).toBe(200);
    const trip = sentOf(sent).expedition;
    expect(trip).toMatchObject({
      region: 'koko-woods',
      hours: 4,
      forage: false,
      sentAt: START,
      returnsAt: START + 4 * HOUR,
      seed: g.roll.seed,
      provisionsPaid: 1,
      collected: false,
    });
    expect(sentOf(sent).me.satchel.provisions).toBe(9);
    expect(sentOf(sent).me.expedition).toEqual(trip);
    expect(SK_PREFIX(g, 'EXPEDITION#')).toHaveLength(1);

    // One at a time, and nothing to collect while the character is away.
    expect(await g.post('/expedition/send', { ...request, requestId: rid() })).toEqual({
      status: 409,
      body: { error: 'in_progress' },
    });
    expect(await g.post('/expedition/collect', { requestId: rid() })).toEqual({
      status: 409,
      body: { error: 'not_returned' },
    });
    g.clock.now += 4 * HOUR - 1;
    expect(((await g.get('/expedition')).body as unknown as ExpeditionView).status).toBe('away');
    g.clock.now += 1;
    const returned = (await g.get('/expedition')).body as unknown as ExpeditionView;
    expect(returned.status).toBe('returned');
    expect(returned.returnsAt).toBe(new Date(START + 4 * HOUR).toISOString());
    // Loot waits for collection and never expires; a new trip needs it collected first.
    expect(await g.post('/expedition/send', { ...request, requestId: rid() })).toEqual({
      status: 409,
      body: { error: 'uncollected' },
    });

    const before = await g.db.getProfile(AUTHOR_ID, true);
    const collectRequest = { requestId: rid() };
    const first = await g.post('/expedition/collect', collectRequest);
    expect(first.status).toBe(200);
    const loot = rollLoot(trip);
    expect(collectedOf(first)).toMatchObject({ applied: true, featsUnlocked: [] });
    expect(collectedOf(first).loot).toEqual(loot);
    expect(loot.length).toBeGreaterThanOrEqual(3);
    expect(collectedOf(first).expedition).toMatchObject({ collected: true, loot });

    // The loot is in the player's hands exactly as the shared rules put it there, once.
    const expected = applyLoot(toPlayerState(before as NonNullable<typeof before>), loot).player;
    const held = collectedOf(first).me;
    expect(held.satchel).toEqual(satchelOf(expected));
    expect(held.inventory).toEqual(expected.inventory ?? []);
    expect(held.charmPacks).toEqual(expected.charmPacks ?? []);
    expect(held.pets).toEqual(expected.pets ?? ['linter-cat']);

    // A second collect, and the same request again, return the stored loot and grant nothing.
    const second = await g.post('/expedition/collect', { requestId: rid() });
    const replay = await g.post('/expedition/collect', collectRequest);
    for (const again of [second, replay]) {
      expect(again.status).toBe(200);
      expect(collectedOf(again)).toMatchObject({ applied: false, featsUnlocked: [] });
      expect(collectedOf(again).loot).toEqual(loot);
      expect(collectedOf(again).me).toEqual(held);
    }

    // One EXPEDITION# item, flipped once, holding the loot.
    const items = SK_PREFIX(g, 'EXPEDITION#');
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ collected: true, loot, collected_at: expect.any(String) });
    const profile = await g.db.getProfile(AUTHOR_ID, true);
    expect(profile?.featCounters?.expeditions).toBe(1);
    expect(profile?.featCounters?.regions).toEqual(['koko-woods']);
    auditSchema(g.fake);
  });

  it('grants the loot once when two collects race, and exactly one of them says so', async () => {
    const g = await newcomer({ provisions: 10 });
    const sent = await g.post('/expedition/send', {
      requestId: rid(),
      region: 'koko-woods',
      choice: 12,
    });
    const trip = sentOf(sent).expedition;
    g.clock.now += 12 * HOUR;
    const before = await g.db.getProfile(AUTHOR_ID, true);
    const [a, b] = await Promise.all([
      g.post('/expedition/collect', { requestId: rid() }),
      g.post('/expedition/collect', { requestId: rid() }),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect([collectedOf(a).applied, collectedOf(b).applied].sort()).toEqual([false, true]);
    expect(collectedOf(a).loot).toEqual(rollLoot(trip));
    expect(collectedOf(b).loot).toEqual(rollLoot(trip));
    const expected = applyLoot(toPlayerState(before as NonNullable<typeof before>), rollLoot(trip));
    expect((await me(g)).satchel).toEqual(satchelOf(expected.player));
    expect((await me(g)).inventory).toEqual(expected.player.inventory ?? []);
    expect(SK_PREFIX(g, 'EXPEDITION#')).toHaveLength(1);
    expect((await g.db.getProfile(AUTHOR_ID, true))?.featCounters?.expeditions).toBe(1);
    auditSchema(g.fake);
  });

  it('finishes a collect whose claim was made but whose profile write never happened', async () => {
    const g = await newcomer({ provisions: 10 });
    const trip = sentOf(
      await g.post('/expedition/send', { requestId: rid(), region: 'koko-woods', choice: 4 }),
    ).expedition;
    g.clock.now += 4 * HOUR;
    // A crashed collect got as far as flipping the item.
    await g.db.claimExpedition(
      AUTHOR_ID,
      { ...trip, collected: true, loot: rollLoot(trip) },
      g.clock.now,
    );
    const before = await g.db.getProfile(AUTHOR_ID, true);
    expect(before?.expedition?.collected).toBe(false);

    const retried = await g.post('/expedition/collect', { requestId: rid() });
    expect(retried.status).toBe(200);
    // The claim was already made, but the profile did get the loot, once: that is what `applied` reports.
    expect(collectedOf(retried).applied).toBe(true);
    const expected = applyLoot(toPlayerState(before as NonNullable<typeof before>), rollLoot(trip));
    expect(collectedOf(retried).me.satchel).toEqual(satchelOf(expected.player));
    expect((await g.db.getProfile(AUTHOR_ID, true))?.expedition?.collected).toBe(true);
    const again = await g.post('/expedition/collect', { requestId: rid() });
    expect(collectedOf(again).applied).toBe(false);
    expect(SK_PREFIX(g, 'EXPEDITION#')).toHaveLength(1);
  });

  it('answers the typed 409s and 404', async () => {
    const g = await newcomer({ provisions: 0 });
    expect(await g.post('/expedition/collect', { requestId: rid() })).toEqual({
      status: 404,
      body: { error: 'no_expedition' },
    });
    expect(
      await g.post('/expedition/send', {
        requestId: rid(),
        region: 'crossroads-of-wix',
        choice: 'forage',
      }),
    ).toEqual({ status: 409, body: { error: 'region_locked' } });
    expect(
      await g.post('/expedition/send', { requestId: rid(), region: 'koko-woods', choice: 24 }),
    ).toEqual({ status: 409, body: { error: 'insufficient_provisions' } });
    // The Forage is always free.
    const forage = await g.post('/expedition/send', {
      requestId: rid(),
      region: 'koko-woods',
      choice: 'forage',
    });
    expect(forage.status).toBe(200);
    expect(sentOf(forage).expedition).toMatchObject({ forage: true, provisionsPaid: 0, hours: 4 });
  });

  it('refuses a bad body with 400 and never records the request id', async () => {
    const g = await newcomer({ provisions: 5 });
    const bad: Record<string, unknown>[] = [
      { region: 'koko-woods', choice: 4 },
      { requestId: 'short', region: 'koko-woods', choice: 4 },
      { requestId: rid(), region: 'atlantis', choice: 4 },
      { requestId: rid(), region: 'koko-woods', choice: 5 },
      { requestId: rid(), region: 'koko-woods' },
      { requestId: rid(), choice: 4 },
    ];
    for (const body of bad) {
      expect(await g.post('/expedition/send', body)).toEqual({
        status: 400,
        body: { error: 'invalid_request' },
      });
    }
    expect((await me(g)).expedition).toBeNull();
    expect((await g.db.getWeekItem(AUTHOR_ID, '2026-46'))?.requestIds).toEqual([]);
  });

  it('redoes a send on the fresh profile when a scored event lands in between', async () => {
    const g = await newcomer({ provisions: 5 });
    let raced = false;
    g.intercept.api = async (input) => {
      const names = Object.values(input.ExpressionAttributeNames ?? {});
      if (!raced && input.Key?.SK === 'PROFILE' && names.includes('expedition')) {
        raced = true;
        await g.db.addPayout(AUTHOR_ID, { gold: 30, renown: 0 });
      }
    };
    const sent = await g.post('/expedition/send', {
      requestId: rid(),
      region: 'koko-woods',
      choice: 4,
    });
    g.intercept.api = undefined;
    expect(raced).toBe(true);
    expect(sent.status).toBe(200);
    expect(sentOf(sent).me.gold).toBe(30);
    expect(sentOf(sent).me.satchel.provisions).toBe(4);
  });

  it('gives up with a 409 and puts the week back when the profile never stops moving', async () => {
    const g = await newcomer({ provisions: 5 });
    const request = { requestId: rid(), region: 'koko-woods', choice: 4 };
    let raced = 0;
    g.intercept.api = async (input) => {
      const names = Object.values(input.ExpressionAttributeNames ?? {});
      if (input.Key?.SK === 'PROFILE' && names.includes('expedition')) {
        raced += 1;
        await g.db.addPayout(AUTHOR_ID, { gold: 1, renown: 0 });
      }
    };
    const refused = await g.post('/expedition/send', request);
    g.intercept.api = undefined;
    expect(raced).toBeGreaterThan(1);
    expect(refused).toEqual({ status: 409, body: { error: 'conflict' } });
    expect((await g.db.getWeekItem(AUTHOR_ID, '2026-46'))?.requestIds).toEqual([]);
    expect(SK_PREFIX(g, 'EXPEDITION#')).toHaveLength(0);
    // Once it settles the same request goes through.
    expect((await g.post('/expedition/send', request)).status).toBe(200);
  });

  it('puts the week back and answers 409 when another trip was sent first', async () => {
    const g = await newcomer({ provisions: 5 });
    const request = { requestId: rid(), region: 'koko-woods', choice: 4 };
    let raced = false;
    g.intercept.api = async (input) => {
      const names = Object.values(input.ExpressionAttributeNames ?? {});
      if (!raced && input.Key?.SK === 'PROFILE' && names.includes('expedition')) {
        raced = true;
        await patch(g, {
          expedition: {
            region: 'koko-woods',
            hours: 4,
            forage: true,
            sentAt: START,
            returnsAt: START + 4 * HOUR,
            seed: 7,
            provisionsPaid: 0,
            packBonus: 0,
            collected: false,
          },
        });
      }
    };
    const refused = await g.post('/expedition/send', request);
    g.intercept.api = undefined;
    expect(refused).toEqual({ status: 409, body: { error: 'in_progress' } });
    expect((await g.db.getWeekItem(AUTHOR_ID, '2026-46'))?.requestIds).toEqual([]);
    expect((await me(g)).satchel.provisions).toBe(5);
    expect(SK_PREFIX(g, 'EXPEDITION#')).toHaveLength(0);
  });

  it('undoes the week lock when the profile write fails, so the same request can be sent again', async () => {
    const g = await newcomer({ provisions: 5 });
    const request = { requestId: rid(), region: 'koko-woods', choice: 4 };
    g.intercept.api = (input) => {
      const names = Object.values(input.ExpressionAttributeNames ?? {});
      if (input.Key?.SK === 'PROFILE' && names.includes('expedition')) {
        throw new Error('the table is having a moment');
      }
    };
    const failed = await g.post('/expedition/send', request);
    g.intercept.api = undefined;
    expect(failed.status).toBe(500);
    expect((await g.db.getWeekItem(AUTHOR_ID, '2026-46'))?.requestIds).toEqual([]);
    const retry = await g.post('/expedition/send', request);
    expect(retry.status).toBe(200);
    expect((await me(g)).satchel.provisions).toBe(4);
  });

  it('answers a replayed send with the same trip and charges nothing twice', async () => {
    const g = await newcomer({ provisions: 5 });
    const request = { requestId: rid(), region: 'koko-woods', choice: 4 };
    const first = await g.post('/expedition/send', request);
    const second = await g.post('/expedition/send', request);
    expect(second).toEqual(first);
    expect((await me(g)).satchel.provisions).toBe(4);
    expect(SK_PREFIX(g, 'EXPEDITION#')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------------------------
// Charm packs from loot
// ---------------------------------------------------------------------------------------------

describe('Charm packs', () => {
  const SEED = 424242;
  const held = (...ids: Parameters<typeof charmDefinition>[0][]): Charm[] =>
    ids.map((id) =>
      makeCharm(charmDefinition(id) as NonNullable<ReturnType<typeof charmDefinition>>),
    );

  it('shows the 3 options of an unopened pack and lets the player keep one', async () => {
    const g = await newcomer();
    await patch(g, { charmPacks: [SEED, 5] });
    expect((await me(g)).charmPacks).toEqual([SEED, 5]);
    const options = await g.get(`/packs/${SEED}`);
    expect(options.status).toBe(200);
    const charms = (options.body as unknown as PackOptionsResponse).options;
    expect(charms).toEqual(lootPackOptions(SEED));
    expect(charms).toHaveLength(3);

    const pick = charms[1] as Charm;
    const opened = await g.post('/packs/open', { requestId: rid(), seed: SEED, charmId: pick.id });
    expect(opened.status).toBe(200);
    expect(meOf(opened).charms.map((charm) => charm.id)).toEqual([pick.id]);
    expect(meOf(opened).charmPacks).toEqual([5]);

    // The pack is gone: it cannot be shown or opened again.
    expect(await g.get(`/packs/${SEED}`)).toEqual({ status: 409, body: { error: 'no_such_pack' } });
    expect(await g.post('/packs/open', { requestId: rid(), seed: SEED, charmId: pick.id })).toEqual(
      { status: 409, body: { error: 'no_such_pack' } },
    );
    expect((await me(g)).charms).toHaveLength(1);
    auditSchema(g.fake);
  });

  it('refuses an option the pack does not hold and a full Charm bar, and keeps the pack', async () => {
    const g = await newcomer();
    const options = lootPackOptions(SEED).map((charm) => charm.id);
    await patch(g, { charmPacks: [SEED] });
    expect(
      await g.post('/packs/open', { requestId: rid(), seed: SEED, charmId: 'not-a-charm' }),
    ).toEqual({ status: 409, body: { error: 'bad_option' } });
    const others = (
      [
        'rubber-duck',
        'lantern',
        'small-hands',
        'second-pair-of-eyes',
        'hot-potato',
        'grey-beard',
        'jesters-rebase',
        'loaded-dice',
        'oracle',
      ] as const
    ).filter((id) => !options.includes(id));
    await patch(g, { charms: held(...others.slice(0, 5)) });
    expect((await me(g)).charms).toHaveLength(5);
    expect(
      await g.post('/packs/open', { requestId: rid(), seed: SEED, charmId: options[0] as string }),
    ).toEqual({ status: 409, body: { error: 'no_free_slot' } });
    expect((await me(g)).charmPacks).toEqual([SEED]);
  });

  it('rejects a malformed seed, and a bad body', async () => {
    const g = await newcomer();
    for (const path of ['/packs/abc', '/packs/-1', '/packs/4294967296', '/packs/1.5']) {
      expect((await g.get(path)).status).toBe(400);
    }
    for (const body of [
      { requestId: rid(), seed: 'x', charmId: 'a' },
      { requestId: rid(), seed: 1.5, charmId: 'a' },
      { requestId: rid(), seed: -1, charmId: 'a' },
      { requestId: rid(), seed: 1 },
      { requestId: rid(), seed: 1, charmId: 'not valid!' },
    ]) {
      expect((await g.post('/packs/open', body)).status).toBe(400);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// The Forge
// ---------------------------------------------------------------------------------------------

describe('GET /forge', () => {
  it('lists three idle stations, every recipe and the three upgrades', async () => {
    const g = await newcomer({ timber: 6, provisions: 2 });
    const view = (await g.get('/forge')).body as unknown as ForgeView;
    expect(Object.keys(view.stations)).toEqual(['forge', 'loom', 'scriptorium']);
    for (const station of Object.values(view.stations)) {
      expect(station).toEqual({ job: null, status: 'idle', readyAt: null });
    }
    expect(view.recipes).toHaveLength(25);
    expect(view.recipes.find((recipe) => recipe.id === 'forge:weapon:leather')).toEqual({
      id: 'forge:weapon:leather',
      station: 'forge',
      name: 'Leather Blade',
      inputs: { timber: 6, provisions: 2 },
      hours: 2,
      unlocked: true,
      affordable: true,
    });
    // Iron needs level 10; this character has no XP.
    expect(view.recipes.find((recipe) => recipe.id === 'forge:weapon:iron')).toMatchObject({
      unlocked: false,
      affordable: false,
    });
    expect(view.upgrades).toEqual([
      { id: 'bellows', owned: false, cost: { flux: 3 } },
      { id: 'dyes', owned: false, cost: { ink: 10 } },
      { id: 'index', owned: false, cost: { lore: 50 } },
    ]);
  });
});

describe('POST /forge/start and /forge/collect', () => {
  it('runs an order to completion and hands the piece over once', async () => {
    const g = await newcomer({ timber: 12, provisions: 4 });
    const request = { requestId: rid(), recipeId: 'forge:weapon:leather' };
    const started = await g.post('/forge/start', request);
    expect(started.status).toBe(200);
    expect(meOf(started).satchel).toMatchObject({ timber: 6, provisions: 2 });
    const job = meOf(started).forge.stations.forge;
    expect(job).toMatchObject({
      recipe: 'forge:weapon:leather',
      station: 'forge',
      startedAt: START,
      doneAt: START + 2 * HOUR,
      seed: g.roll.seed,
      collected: false,
    });
    expect(SK_PREFIX(g, 'JOB#')[0]).toMatchObject({
      SK: 'JOB#forge',
      recipe: 'forge:weapon:leather',
      collected: false,
    });

    let view = (await g.get('/forge')).body as unknown as ForgeView;
    expect(view.stations.forge).toEqual({
      job,
      status: 'working',
      readyAt: new Date(START + 2 * HOUR).toISOString(),
    });
    expect(
      await g.post('/forge/start', { requestId: rid(), recipeId: 'forge:body:leather' }),
    ).toEqual({ status: 409, body: { error: 'station_busy' } });
    expect(await g.post('/forge/collect', { requestId: rid(), station: 'forge' })).toEqual({
      status: 409,
      body: { error: 'not_ready' },
    });
    expect(await g.post('/forge/collect', { requestId: rid(), station: 'loom' })).toEqual({
      status: 409,
      body: { error: 'no_job' },
    });

    g.clock.now += 2 * HOUR;
    view = (await g.get('/forge')).body as unknown as ForgeView;
    expect(view.stations.forge.status).toBe('ready');
    const collectRequest = { requestId: rid(), station: 'forge' };
    const first = await g.post('/forge/collect', collectRequest);
    const result = first.body as unknown as ForgeCollectResponse;
    expect(first.status).toBe(200);
    expect(result.applied).toBe(true);
    expect(result.piece).toMatchObject({ slot: 'weapon', tier: 'leather', name: 'Leather Blade' });
    expect(result.me.inventory).toEqual([result.piece]);

    // Again, and the same request again: the same piece, granted once.
    const second = await g.post('/forge/collect', { requestId: rid(), station: 'forge' });
    const replay = await g.post('/forge/collect', collectRequest);
    for (const again of [second, replay]) {
      const body = again.body as unknown as ForgeCollectResponse;
      expect(again.status).toBe(200);
      expect(body.applied).toBe(false);
      expect(body.piece).toEqual(result.piece);
      expect(body.me.inventory).toEqual([result.piece]);
    }
    view = (await g.get('/forge')).body as unknown as ForgeView;
    expect(view.stations.forge).toMatchObject({ status: 'collected', readyAt: null });
    expect(SK_PREFIX(g, 'JOB#')[0]).toMatchObject({ collected: true, output: result.piece });

    // The station is free again, and its item is replaced by the new order.
    const next = await g.post('/forge/start', { requestId: rid(), recipeId: 'forge:body:leather' });
    expect(next.status).toBe(200);
    expect(SK_PREFIX(g, 'JOB#')).toHaveLength(1);
    expect(SK_PREFIX(g, 'JOB#')[0]).toMatchObject({
      recipe: 'forge:body:leather',
      collected: false,
    });
    auditSchema(g.fake);
  });

  it('answers the typed 409s', async () => {
    const g = await newcomer({ timber: 6, provisions: 2 });
    const start = (recipeId: string, extra: Record<string, unknown> = {}) =>
      g.post('/forge/start', { requestId: rid(), recipeId, ...extra });
    expect(await start('forge:weapon:wooden')).toEqual({
      status: 409,
      body: { error: 'unknown_recipe' },
    });
    expect(await start('forge:weapon:silver')).toEqual({
      status: 409,
      body: { error: 'tier_locked' },
    });
    expect(await start('loom:cape:leather', { pieceId: 'x' })).toMatchObject({ status: 200 });
    expect(await start('forge:weapon:leather')).toEqual({
      status: 409,
      body: { error: 'insufficient_supplies' },
    });
    expect(await start('scriptorium:affix')).toEqual({
      status: 409,
      body: { error: 'piece_required' },
    });
    expect(await start('scriptorium:affix', { pieceId: 'nothing' })).toEqual({
      status: 409,
      body: { error: 'piece_not_found' },
    });
  });

  it('lets exactly one of two racing orders have the station', async () => {
    const g = await newcomer({ timber: 12, provisions: 4 });
    const [a, b] = await Promise.all([
      g.post('/forge/start', { requestId: rid(), recipeId: 'forge:weapon:leather' }),
      g.post('/forge/start', { requestId: rid(), recipeId: 'forge:body:leather' }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect([a, b].find((reply) => reply.status === 409)?.body).toEqual({ error: 'station_busy' });
    // Only the winner paid.
    expect((await me(g)).satchel).toMatchObject({ timber: 6, provisions: 2 });
    expect(SK_PREFIX(g, 'JOB#')).toHaveLength(1);
  });

  it('works an affix onto a piece at the Scriptorium and returns that piece with it', async () => {
    const g = await newcomer({ flux: 2 });
    const blade = makePiece({ id: 'blade-1', slot: 'weapon', tier: 'leather' });
    await patch(g, { inventory: [blade] });
    const started = await g.post('/forge/start', {
      requestId: rid(),
      recipeId: 'scriptorium:affix',
      pieceId: 'blade-1',
    });
    expect(started.status).toBe(200);
    // The station holds the piece while it works, so it is not in the inventory.
    expect(meOf(started).inventory).toEqual([]);
    expect(meOf(started).forge.stations.scriptorium?.piece).toEqual(blade);
    expect(meOf(started).satchel.flux).toBe(0);

    g.clock.now += 4 * HOUR;
    const collected = await g.post('/forge/collect', { requestId: rid(), station: 'scriptorium' });
    const body = collected.body as unknown as ForgeCollectResponse;
    expect(body.applied).toBe(true);
    expect(body.piece).toMatchObject({ id: 'blade-1', slot: 'weapon' });
    expect(body.piece?.affix).toBeDefined();
    expect(body.me.inventory).toEqual([body.piece]);
    auditSchema(g.fake);
  });
});

describe('POST /forge/upgrade', () => {
  it('buys the Bellows once, and the Forge then works a quarter faster', async () => {
    const g = await newcomer({ flux: 2, timber: 6, provisions: 2 });
    expect(await g.post('/forge/upgrade', { requestId: rid(), upgrade: 'bellows' })).toEqual({
      status: 409,
      body: { error: 'insufficient_supplies' },
    });
    await patch(g, { satchel: { ...emptySatchel(), flux: 3, timber: 6, provisions: 2 } });
    const bought = await g.post('/forge/upgrade', { requestId: rid(), upgrade: 'bellows' });
    expect(bought.status).toBe(200);
    expect(meOf(bought).forge.upgrades).toEqual(['bellows']);
    expect(meOf(bought).satchel.flux).toBe(0);
    expect(await g.post('/forge/upgrade', { requestId: rid(), upgrade: 'bellows' })).toEqual({
      status: 409,
      body: { error: 'already_owned' },
    });
    const view = (await g.get('/forge')).body as unknown as ForgeView;
    expect(view.upgrades[0]).toMatchObject({ id: 'bellows', owned: true });
    expect(view.recipes.find((recipe) => recipe.id === 'forge:weapon:leather')?.hours).toBe(1.5);
    const order = await g.post('/forge/start', {
      requestId: rid(),
      recipeId: 'forge:weapon:leather',
    });
    expect(meOf(order).forge.stations.forge?.doneAt).toBe(START + 1.5 * HOUR);
  });

  it('chooses a cape colour only with the Dyes, and null goes back to the natural cape', async () => {
    const g = await newcomer({ ink: 10 });
    expect(await g.post('/forge/upgrade', { requestId: rid(), capeColor: 'azure' })).toEqual({
      status: 409,
      body: { error: 'dyes_required' },
    });
    expect((await g.post('/forge/upgrade', { requestId: rid(), upgrade: 'dyes' })).status).toBe(
      200,
    );
    const dyed = await g.post('/forge/upgrade', { requestId: rid(), capeColor: 'azure' });
    expect(meOf(dyed).gear.capeColor).toBe('azure');
    expect((await me(g)).gear.capeColor).toBe('azure');
    const natural = await g.post('/forge/upgrade', { requestId: rid(), capeColor: null });
    expect(meOf(natural).gear.capeColor).toBeNull();
    auditSchema(g.fake);
  });

  it('refuses a body that is not exactly one of an upgrade or a cape colour', async () => {
    const g = await newcomer({ ink: 10 });
    for (const body of [
      {},
      { upgrade: 'nope' },
      { upgrade: 'bellows', capeColor: null },
      { capeColor: 'pink' },
      { capeColor: 3 },
    ]) {
      expect(await g.post('/forge/upgrade', { requestId: rid(), ...body })).toEqual({
        status: 400,
        body: { error: 'invalid_request' },
      });
    }
    for (const body of [
      { recipeId: 'Forge Weapon' },
      { recipeId: 'forge:weapon:iron', pieceId: 'not valid!' },
      {},
    ]) {
      expect((await g.post('/forge/start', { requestId: rid(), ...body })).status).toBe(400);
    }
    expect((await g.post('/forge/collect', { requestId: rid(), station: 'mill' })).status).toBe(
      400,
    );
  });
});

// ---------------------------------------------------------------------------------------------
// Gear and pets
// ---------------------------------------------------------------------------------------------

describe('POST /gear/equip', () => {
  const blade = makePiece({ id: 'blade-1', slot: 'weapon', tier: 'leather' });
  const spare = makePiece({ id: 'blade-2', slot: 'weapon', tier: 'leather', affix: 'stout' });
  const silver = makePiece({ id: 'plate-1', slot: 'body', tier: 'silver' });

  it('wears a piece, returns the one it replaces, and takes a slot off again', async () => {
    const g = await newcomer();
    await patch(g, { inventory: [blade, spare, silver] });
    const worn = await g.post('/gear/equip', { requestId: rid(), pieceId: 'blade-1' });
    expect(worn.status).toBe(200);
    expect(meOf(worn).gear).toEqual({ equipped: { weapon: blade }, setBonus: 0, capeColor: null });
    expect(meOf(worn).inventory.map((piece) => piece.id)).toEqual(['blade-2', 'plate-1']);

    const swapped = await g.post('/gear/equip', { requestId: rid(), pieceId: 'blade-2' });
    expect(meOf(swapped).gear.equipped.weapon).toEqual(spare);
    expect(meOf(swapped).inventory.map((piece) => piece.id)).toEqual(['plate-1', 'blade-1']);

    const bare = await g.post('/gear/equip', { requestId: rid(), unequip: 'weapon' });
    expect(meOf(bare).gear.equipped).toEqual({});
    expect(meOf(bare).inventory.map((piece) => piece.id)).toEqual([
      'plate-1',
      'blade-1',
      'blade-2',
    ]);
    auditSchema(g.fake);
  });

  it('answers the typed 409s', async () => {
    const g = await newcomer();
    await patch(g, {
      inventory: [silver, { ...blade, id: 'pet-1', slot: 'pet' }],
      gear: { pieces: [blade] },
    });
    const equip = (body: Record<string, unknown>) =>
      g.post('/gear/equip', { requestId: rid(), ...body });
    expect(await equip({ pieceId: 'nothing' })).toEqual({
      status: 409,
      body: { error: 'not_owned' },
    });
    expect(await equip({ pieceId: 'blade-1' })).toEqual({
      status: 409,
      body: { error: 'already_equipped' },
    });
    // Silver needs level 30 (or Silverhall at Renown 16).
    expect(await equip({ pieceId: 'plate-1' })).toEqual({
      status: 409,
      body: { error: 'tier_locked' },
    });
    expect(await equip({ pieceId: 'pet-1' })).toEqual({ status: 409, body: { error: 'pet_slot' } });
    expect(await equip({ unequip: 'cape' })).toEqual({
      status: 409,
      body: { error: 'nothing_equipped' },
    });
    expect(await equip({ petId: 'rubber-duck' })).toEqual({
      status: 409,
      body: { error: 'not_owned' },
    });
  });

  it('wears the starter pet, whose slot then holds it', async () => {
    const g = await newcomer();
    const worn = await g.post('/gear/equip', { requestId: rid(), petId: 'linter-cat' });
    expect(meOf(worn).gear.equipped.pet).toMatchObject({ slot: 'pet', ref: 'linter-cat' });
    expect(meOf(worn).pets).toEqual(['linter-cat']);
    const off = await g.post('/gear/equip', { requestId: rid(), unequip: 'pet' });
    expect(meOf(off).gear.equipped.pet).toBeUndefined();
  });

  it('refuses a body that does not name exactly one thing to do', async () => {
    const g = await newcomer();
    for (const body of [
      {},
      { pieceId: 'a', unequip: 'weapon' },
      { pieceId: 'a', petId: 'b' },
      { unequip: 'hat' },
      { pieceId: 'not valid!' },
      { petId: 3 },
    ]) {
      expect(await g.post('/gear/equip', { requestId: rid(), ...body })).toEqual({
        status: 400,
        body: { error: 'invalid_request' },
      });
    }
  });

  it('counts the worn piece in Power for the next scored event, not the ones before it', async () => {
    const g = await newcomer();
    await g.signIn(REVIEWER_ID);
    await patch(g, { satchel: emptySatchel(), inventory: [blade] });
    await g.deliver(fixtureDelivery('pull_request.opened', renumber(17)));
    await g.post('/gear/equip', { requestId: rid(), pieceId: 'blade-1' });
    await g.deliver(fixtureDelivery('pull_request.opened', renumber(31)));
    const log = (await g.get('/log')).body as unknown as LogResponse;
    expect(log.entries.map((entry) => entry.power)).toEqual([1.05, 1]);
    expect(log.entries[0]?.breakdown).toContainEqual({ label: 'Gear', value: 0.05, kind: 'power' });
  });
});

// ---------------------------------------------------------------------------------------------
// Feats
// ---------------------------------------------------------------------------------------------

describe('GET /feats and POST /feats/pin', () => {
  async function withMergeConflict(): Promise<Game> {
    const g = makeGame();
    await g.signIn(AUTHOR_ID);
    await g.signIn(REVIEWER_ID);
    await playLife(g, 17);
    await playLife(g, 31);
    return g;
  }

  it('lists every Feat, with hidden ones as ??? and an unlocked one at full progress', async () => {
    const g = await withMergeConflict();
    const reply = await g.get('/feats');
    expect(reply.status).toBe(200);
    const { feats } = reply.body as unknown as FeatsResponse;
    expect(feats).toHaveLength(FEATS.length);
    expect(feats.length).toBeGreaterThanOrEqual(40);
    const conflict = feats.find((feat) => feat.id === 'merge-conflict');
    expect(conflict).toMatchObject({
      name: 'Merge Conflict',
      unlocked: true,
      progress: 1,
      pinned: false,
    });
    const hidden = feats.find((feat) => feat.id === 'night-owl');
    expect(hidden).toMatchObject({ name: '???', unlocked: false, description: null, reward: null });
    expect(hidden?.hint).toEqual(expect.any(String));
    const visible = feats.find((feat) => feat.id === 'surgeon');
    expect(visible).toMatchObject({ unlocked: false, hidden: false });
    expect(visible?.progress).toBeGreaterThanOrEqual(0);
  });

  it('gives an unlocked Feat the instant it unlocked, from its FEAT# record, and a locked one none', async () => {
    const g = await withMergeConflict();
    const { feats } = (await g.get('/feats')).body as unknown as FeatsResponse;
    const records = SK_PREFIX(g, 'FEAT#');
    expect(records.length).toBeGreaterThan(0);
    for (const record of records) {
      const id = String(record.SK).slice('FEAT#'.length);
      const row = feats.find((feat) => feat.id === id);
      expect(row?.unlocked, id).toBe(true);
      expect(row?.unlockedAt, id).toBe(record.unlocked_at);
      expect(Date.parse(row?.unlockedAt ?? ''), id).toBeGreaterThanOrEqual(START);
    }
    // Every unlocked row has a date here, and nothing locked has one.
    expect(feats.filter((feat) => feat.unlocked && !feat.unlockedAt)).toEqual([]);
    expect(feats.filter((feat) => !feat.unlocked && 'unlockedAt' in feat)).toEqual([]);
    expect(feats.find((feat) => feat.id === 'merge-conflict')?.unlockedAt).toEqual(
      expect.any(String),
    );
  });

  it('leaves the date out of a Feat that is unlocked but has no record, or whose record has no usable time', async () => {
    const g = await withMergeConflict();
    // The profile lists Feats whose FEAT# record never got written (the record follows the profile write).
    await patch(g, { featsUnlocked: ['merge-conflict', 'surgeon', 'goblin-slayer'] });
    await g.db.put('FEAT', featKey(AUTHOR_ID, 'goblin-slayer'), {
      unlocked_at: 'not a time',
      delivery_id: 'x',
    });
    const { feats } = (await g.get('/feats')).body as unknown as FeatsResponse;
    const surgeon = feats.find((feat) => feat.id === 'surgeon');
    expect(surgeon?.unlocked).toBe(true);
    expect(surgeon && 'unlockedAt' in surgeon).toBe(false);
    const slayer = feats.find((feat) => feat.id === 'goblin-slayer');
    expect(slayer?.unlocked).toBe(true);
    expect(slayer && 'unlockedAt' in slayer).toBe(false);
    expect(feats.find((feat) => feat.id === 'merge-conflict')?.unlockedAt).toEqual(
      expect.any(String),
    );
  });

  it('pins and unpins, at most three, and only what is unlocked', async () => {
    const g = await withMergeConflict();
    await patch(g, { featsUnlocked: ['merge-conflict', 'surgeon', 'goblin-slayer', 'renowned'] });
    const pin = (featId: string, pinned = true) =>
      g.post('/feats/pin', { requestId: rid(), featId, pinned });
    expect(await pin('mentor')).toEqual({ status: 409, body: { error: 'not_unlocked' } });
    expect(meOf(await pin('merge-conflict')).pinnedFeats).toEqual(['merge-conflict']);
    expect(await pin('merge-conflict')).toEqual({ status: 409, body: { error: 'already_pinned' } });
    await pin('surgeon');
    await pin('goblin-slayer');
    expect(await pin('renowned')).toEqual({ status: 409, body: { error: 'too_many_pinned' } });
    const feats = ((await g.get('/feats')).body as unknown as FeatsResponse).feats;
    // (in the catalogue's order, which is how the Feats screen lists them)
    expect(feats.filter((feat) => feat.pinned).map((feat) => feat.id)).toEqual([
      'surgeon',
      'goblin-slayer',
      'merge-conflict',
    ]);
    // Unpinning frees a place; unpinning what is not pinned is not an error.
    expect(meOf(await pin('surgeon', false)).pinnedFeats).toEqual([
      'merge-conflict',
      'goblin-slayer',
    ]);
    expect(meOf(await pin('surgeon', false)).pinnedFeats).toEqual([
      'merge-conflict',
      'goblin-slayer',
    ]);
    expect(meOf(await pin('renowned')).pinnedFeats).toEqual([
      'merge-conflict',
      'goblin-slayer',
      'renowned',
    ]);
    expect((await g.post('/feats/pin', { requestId: rid(), featId: 'x' })).status).toBe(400);
    expect((await g.post('/feats/pin', { requestId: rid(), pinned: true })).status).toBe(400);
    expect(
      (await g.post('/feats/pin', { requestId: rid(), featId: 'x', pinned: 'yes' })).status,
    ).toBe(400);
    auditSchema(g.fake);
  });

  it('shows the pinned Feats and the Old Coin on the public badge, and reads nothing else', async () => {
    const g = await withMergeConflict();
    const badge = async () => {
      const before = g.fake.calls.length;
      const result = await g.api(apiRequest({ path: '/badge/player-1001001.svg', origin: null }));
      const calls = g.fake.calls.slice(before).map((call) => call.operation);
      return { svg: result.body ?? '', calls };
    };
    const plain = await badge();
    expect(plain.svg).not.toContain(FEAT_GLYPHS.humour);

    const pinned = await g.post('/feats/pin', {
      requestId: rid(),
      featId: 'merge-conflict',
      pinned: true,
    });
    expect(pinned.status).toBe(200);
    const withPin = await badge();
    expect(withPin.svg).toContain(FEAT_GLYPHS.humour);
    expect(withPin.svg).not.toContain(COIN_GLYPH);
    // The badge is one read of the sparse GSI1 and nothing else.
    expect(withPin.calls).toEqual(['Query']);

    await patch(g, { featsUnlocked: ['merge-conflict', 'the-old-coin'], oldCoin: true });
    expect((await badge()).svg).toContain(COIN_GLYPH);
  });
});

// ---------------------------------------------------------------------------------------------
// Requests in general, export and delete
// ---------------------------------------------------------------------------------------------

describe('POST /settings (the public badge, Requirement 11.4)', () => {
  const badgeOf = async (g: Game) =>
    (await g.api(apiRequest({ path: '/badge/player-1001001.svg', origin: null }))).body ?? '';

  it('starts public, turns the badge off and on, and answers with the profile each time', async () => {
    const g = await newcomer();
    expect((await me(g)).badgePublic).toBe(true);
    const off = await g.post('/settings', { requestId: rid(), badgePublic: false });
    expect(off.status).toBe(200);
    expect(meOf(off).badgePublic).toBe(false);
    expect((await me(g)).badgePublic).toBe(false);
    expect((await g.db.getProfile(AUTHOR_ID, true))?.badgePublic).toBe(false);
    const on = await g.post('/settings', { requestId: rid(), badgePublic: true });
    expect(meOf(on).badgePublic).toBe(true);
    expect((await g.db.getProfile(AUTHOR_ID, true))?.badgePublic).toBe(true);
    auditSchema(g.fake);
  });

  it('keeps the attribute on the profile where GSI1 projects it, and changes nothing else', async () => {
    const g = await newcomer();
    const before = await me(g);
    await g.post('/settings', { requestId: rid(), badgePublic: false });
    const after = await me(g);
    expect({ ...after, badgePublic: true }).toEqual({ ...before, week: after.week });
    const [profile] = itemsWithPrefix(g.fake, `USER#${AUTHOR_ID}`).filter(
      (item) => item.SK === 'PROFILE',
    );
    expect(profile?.badge_public).toBe(false);
  });

  it('answers the same value again without a write, and a replayed request id with the profile as it is', async () => {
    const g = await newcomer();
    const request = { requestId: rid(), badgePublic: false };
    const first = await g.post('/settings', request);
    const writes = g.fake.calls.filter((call) => call.operation === 'UpdateItem').length;
    expect(await g.post('/settings', request)).toEqual(first);
    // Another request id with the value it already has: nothing to change, nothing written.
    expect(
      meOf(await g.post('/settings', { requestId: rid(), badgePublic: false })).badgePublic,
    ).toBe(false);
    expect(g.fake.calls.filter((call) => call.operation === 'UpdateItem')).toHaveLength(writes);
  });

  it('refuses a body whose badgePublic is not a boolean, and never records the request id', async () => {
    const g = await newcomer();
    for (const body of [{}, { badgePublic: 'no' }, { badgePublic: 0 }, { badgePublic: null }]) {
      expect((await g.post('/settings', { requestId: rid(), ...body })).status).toBe(400);
    }
    expect((await g.post('/settings', { badgePublic: false })).status).toBe(400);
    expect((await g.db.getWeekItem(AUTHOR_ID, '2026-46'))?.requestIds ?? []).toEqual([]);
    expect((await g.post('/settings', { requestId: rid(), badgePublic: false }, 4242)).status).toBe(
      404,
    );
  });

  it('turns the badge unranked, pins and coin included, and back', async () => {
    const g = await newcomer();
    await patch(g, { featsUnlocked: ['merge-conflict', 'the-old-coin'], oldCoin: true });
    await g.post('/feats/pin', { requestId: rid(), featId: 'merge-conflict', pinned: true });
    const ranked = await badgeOf(g);
    expect(ranked).not.toContain('unranked');
    expect(ranked).toContain(FEAT_GLYPHS.humour);

    await g.post('/settings', { requestId: rid(), badgePublic: false });
    const hidden = await badgeOf(g);
    expect(hidden).toContain('unranked');
    expect(hidden).not.toContain(FEAT_GLYPHS.humour);
    expect(hidden).not.toContain(COIN_GLYPH);
    // It is the very badge an unknown login gets: nothing says that this account exists.
    const unknown = await g.api(apiRequest({ path: '/badge/nobody-here.svg', origin: null }));
    expect(hidden).toBe(unknown.body);

    await g.post('/settings', { requestId: rid(), badgePublic: true });
    expect(await badgeOf(g)).toBe(ranked);
  });

  it('is private by the badge route alone: a player with no setting stored is public', async () => {
    const g = await newcomer();
    const [profile] = itemsWithPrefix(g.fake, `USER#${AUTHOR_ID}`).filter(
      (item) => item.SK === 'PROFILE',
    );
    expect(profile && 'badge_public' in profile).toBe(false);
    expect(await badgeOf(g)).not.toContain('unranked');
  });
});

describe('the depth routes as requests', () => {
  it('answer a replayed request id with the profile as it is, and record at most 20 ids', async () => {
    const g = await newcomer();
    await patch(g, { inventory: [makePiece({ id: 'blade-1', slot: 'weapon', tier: 'leather' })] });
    const request = { requestId: rid(), pieceId: 'blade-1' };
    const first = await g.post('/gear/equip', request);
    const second = await g.post('/gear/equip', request);
    expect(second).toEqual(first);
    expect((await g.db.getWeekItem(AUTHOR_ID, '2026-46'))?.requestIds).toEqual([request.requestId]);
  });

  it('need the Pages origin and a token, and the right method', async () => {
    const g = await newcomer();
    const send = (options: Parameters<typeof apiRequest>[0]) => g.api(apiRequest(options));
    const token = await g.token();
    for (const path of ['/expedition', '/forge', '/feats', '/packs/1']) {
      expect((await send({ path, token, origin: 'https://evil.example' })).statusCode).toBe(403);
      expect((await send({ path, token: null })).statusCode).toBe(401);
      expect((await send({ path, token, method: 'POST' })).statusCode).toBe(405);
    }
    for (const path of [
      '/expedition/send',
      '/expedition/collect',
      '/packs/open',
      '/forge/start',
      '/forge/collect',
      '/forge/upgrade',
      '/gear/equip',
      '/feats/pin',
      '/settings',
    ]) {
      expect(
        (await send({ path, token, origin: 'https://evil.example', method: 'POST' })).statusCode,
      ).toBe(403);
      expect((await send({ path, token: null, method: 'POST' })).statusCode).toBe(401);
      expect((await send({ path, token })).statusCode).toBe(405);
    }
    expect((await send({ path: '/packs/1/2', token })).statusCode).toBe(404);
    // An unknown player has nothing.
    for (const path of ['/expedition', '/forge', '/feats', '/packs/1']) {
      expect((await g.get(path, 4242)).status).toBe(404);
    }
    expect((await g.post('/expedition/collect', { requestId: rid() }, 4242)).status).toBe(404);
  });

  it('refuse an oversized or malformed body', async () => {
    const g = await newcomer();
    const token = await g.token();
    const post = (body: string) =>
      g.api({ ...apiRequest({ path: '/forge/collect', method: 'POST', token }), body });
    expect((await post('{not json')).statusCode).toBe(400);
    expect((await post('[]')).statusCode).toBe(400);
    expect((await post(JSON.stringify({ pad: 'x'.repeat(5000) }))).statusCode).toBe(413);
  });
});

describe('export and delete cover the new item types', () => {
  it('exports the expeditions, jobs and feats and deletes every one of them', async () => {
    const g = makeGame();
    await g.signIn(AUTHOR_ID, undefined, 'Octo-Cat');
    await g.signIn(REVIEWER_ID);
    await playLife(g, 17);
    await playLife(g, 31);
    await patch(g, { satchel: { ...emptySatchel(), timber: 6, provisions: 2 } });
    await g.post('/forge/start', { requestId: rid(), recipeId: 'forge:weapon:leather' });

    const token = await g.token();
    const exported = await g.api(apiRequest({ path: '/export', token }));
    const body = JSON.parse(exported.body ?? '{}') as Record<string, { SK: string }[]>;
    expect(body.expeditions?.map((item) => item.SK)).toEqual([
      `EXPEDITION#${new Date(START).toISOString()}`,
    ]);
    expect(body.jobs?.map((item) => item.SK)).toEqual(['JOB#forge']);
    expect(body.feats?.map((item) => item.SK)).toEqual(['FEAT#merge-conflict']);
    expect(body.other).toBeUndefined();

    // (a 204 has no body, which the harness's `post` would try to parse)
    const deleted = await g.api({
      ...apiRequest({ path: '/delete', method: 'POST', token }),
      body: JSON.stringify({ requestId: rid(), confirmLogin: 'octo-cat' }),
    });
    expect(deleted.statusCode).toBe(204);
    expect(itemsWithPrefix(g.fake, `USER#${AUTHOR_ID}`)).toEqual([]);
  });
});
