import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GEAR_SLOTS,
  levelFor,
  lootPackOptions,
  makePiece,
  petPiece,
  petDefinition,
  rollLoot,
  setBonusFor,
} from '@mergescape/shared';
import { ApiError } from '../api';
import type { Api } from '../api';
import { createFixtureApi } from './api';
import { fixtureFeats, FIXTURE_FORAGE_SEED, FIXTURE_RETURNED_SEED } from './depth';
import { fixtureCharm, fixtureInstallations, fixtureLogEntries, fixtureMe } from './state';
import { RAW_LOG } from './raw-log';

const NOW = Date.UTC(2026, 10, 11, 14, 5, 0);
const HOUR = 3_600_000;

// The fixture's clock is its build time plus the real time since; stop the real part so times are exact.
beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
});

/** What a refused fixture write rejects with. */
async function refusal(promise: Promise<unknown>): Promise<ApiError> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ApiError);
  return error as ApiError;
}

function make(options: Parameters<typeof createFixtureApi>[0] = {}): Api {
  return createFixtureApi({ now: NOW, ...options });
}

describe('the depth fixture (docs/api-contract.md, last paragraph)', () => {
  const me = fixtureMe(NOW);

  it('has a returned expedition that has not been collected', () => {
    const trip = me.expedition!;
    expect(trip).toMatchObject({
      region: 'silverhall',
      hours: 24,
      forage: false,
      collected: false,
    });
    expect(trip.returnsAt).toBeLessThan(NOW);
    expect(trip.sentAt).toBe(trip.returnsAt - 24 * HOUR);
    expect(trip.seed).toBe(FIXTURE_RETURNED_SEED);
  });

  it('has one working and one ready Forge job', () => {
    const { forge, loom, scriptorium } = me.forge.stations;
    expect(forge!.doneAt).toBeGreaterThan(NOW);
    expect(loom!.doneAt).toBeLessThan(NOW);
    expect(forge!.collected).toBe(false);
    expect(loom!.collected).toBe(false);
    expect(scriptorium).toBeUndefined();
  });

  it('has an inventory with a few pieces and one equipped set that earns the set bonus', () => {
    expect(me.inventory.length).toBeGreaterThanOrEqual(3);
    expect(Object.keys(me.gear.equipped).sort()).toEqual([...GEAR_SLOTS].sort());
    expect(me.gear.setBonus).toBe(0.25);
    expect(setBonusFor(Object.values(me.gear.equipped))).toBe(0.25);
    // Every piece id is unique, worn or not.
    const ids = [...me.inventory, ...Object.values(me.gear.equipped)].map((piece) => piece.id);
    expect(new Set(ids).size).toBe(ids.length);
    // The worn pet is one the player owns.
    expect(me.pets).toContain(me.gear.equipped.pet?.ref);
  });

  it('has 2 unopened Charm packs whose seeds fix three Charms each', () => {
    expect(me.charmPacks).toHaveLength(2);
    for (const seed of me.charmPacks) {
      expect(lootPackOptions(seed)).toHaveLength(3);
    }
  });

  it('has 6 Feats: 2 unlocked, 1 pinned, 1 hidden', () => {
    const feats = fixtureFeats(NOW, 'active');
    expect(feats).toHaveLength(6);
    expect(feats.filter((feat) => feat.unlocked)).toHaveLength(2);
    expect(feats.filter((feat) => feat.pinned)).toHaveLength(1);
    expect(feats.filter((feat) => feat.hidden && !feat.unlocked)).toHaveLength(1);
    expect(me.pinnedFeats).toEqual(feats.filter((feat) => feat.pinned).map((feat) => feat.id));
    // A hidden Feat shows as ??? with its hint only, as the api sends it.
    const hidden = feats.find((feat) => feat.hidden)!;
    expect(hidden).toMatchObject({ name: '???', description: null, reward: null });
    expect(hidden.hint.length).toBeGreaterThan(10);
    // An unlocked Feat has a date, and an earned title is on the profile.
    expect(feats.filter((feat) => feat.unlocked).every((feat) => feat.unlockedAt)).toBe(true);
    expect(me.titles).toEqual(['Imp Whisperer']);
  });

  it('can pay for a 24 h trip but not a 48 h one, and cannot yet afford the Dyes or the Index', () => {
    expect(me.satchel.provisions).toBe(4);
    expect(me.satchel.ink).toBeLessThan(10);
    expect(me.satchel.lore).toBeLessThan(50);
    expect(me.satchel.flux).toBeGreaterThanOrEqual(3);
  });

  it('is a Renown 17 level-41 character, so Silver is open and Mithril is not', () => {
    expect(me.renown).toBe(17);
    expect(levelFor(me.xp)).toBeGreaterThanOrEqual(30);
    expect(levelFor(me.xp)).toBeLessThan(50);
  });

  it('has no trip, nothing worn and the starter pet for a character with no kills', () => {
    for (const variant of ['noevents', 'noinstall'] as const) {
      const fresh = fixtureMe(NOW, variant);
      expect(fresh.expedition).toBeNull();
      expect(fresh.inventory).toEqual([]);
      expect(fresh.gear).toEqual({ equipped: {}, setBonus: 0, capeColor: null });
      expect(fresh.pets).toEqual(['linter-cat']);
      expect(fresh.satchel.provisions).toBe(0);
      expect(
        fixtureFeats(NOW, variant).every((feat) => !feat.unlocked && feat.progress === 0),
      ).toBe(true);
    }
  });

  it('lets a test replace any part of the profile or the Feats', async () => {
    const api = make({ me: { gold: 7 }, feats: [] });
    expect((await api.me()).gold).toBe(7);
    expect((await api.feats()).feats).toEqual([]);
  });
});

describe('?fixture=day0: right after the first kill (game-design.md section 10)', () => {
  const me = fixtureMe(NOW, 'day0');

  it('has one Combat Log row, the first kill, scored by the real scorer', () => {
    const entries = fixtureLogEntries(NOW, 'day0');
    expect(entries).toHaveLength(1);
    const [first] = entries;
    expect(first).toMatchObject({ kind: 'pr_merged', monster: 'merge-goblin', level: 1, xp: 639 });
    expect(Math.floor(first!.points * first!.power * first!.zone)).toBe(first!.xp);
    expect(first!.zone).toBeCloseTo(2 ** 1.6, 9);
    expect(me.xp).toBe(first!.xp);
    expect(Date.parse(first!.at)).toBe(NOW - 6 * 60_000);
  });

  it('has the Koko Woods Forage already away, and nothing else to do yet', () => {
    expect(me.expedition).toMatchObject({
      region: 'koko-woods',
      hours: 4,
      forage: true,
      provisionsPaid: 0,
      collected: false,
      seed: FIXTURE_FORAGE_SEED,
    });
    expect(me.expedition!.returnsAt).toBe(me.expedition!.sentAt + 4 * HOUR);
    expect(me.expedition!.returnsAt).toBeGreaterThan(NOW);
    expect(me.inventory).toEqual([]);
    expect(me.forge.stations).toEqual({});
    expect(me.charmPacks).toEqual([]);
  });

  it('banked what the first event dropped, and gave the free Common Charm', () => {
    expect(me.satchel).toMatchObject({ ore: 2, timber: 1, provisions: 3, lore: 0, flux: 0 });
    expect(me.charms.map((charm) => [charm.id, charm.rarity])).toEqual([['rubber-duck', 'common']]);
    expect(me.renown).toBe(0);
  });

  it('has a Scout act with the flat 2,000 XP target and Feat bars at the start', () => {
    expect(me.week).toMatchObject({ act: 'scout', weeklyXp: 639, shop: null });
    expect(me.week!.targets.scout).toBe(2_000);
    const feats = fixtureFeats(NOW, 'day0');
    expect(feats.every((feat) => !feat.unlocked)).toBe(true);
    expect(feats.some((feat) => feat.progress > 0)).toBe(true);
  });

  it('is installed, so Town is not asking for the App', () => {
    expect(fixtureInstallations('day0').installations).toHaveLength(1);
  });

  it('brings the Forage home in four hours, to Leather Armour, Timber and Provisions', async () => {
    const loot = rollLoot(me.expedition!);
    expect(loot.map((item) => item.kind)).toEqual(['gear', 'material', 'material']);
    expect(loot[0]).toMatchObject({ piece: { name: 'Leather Armour' } });
  });

  it('is not yet collectable, and says so with the typed code', async () => {
    const api = make({ variant: 'day0' });
    const error = await refusal(api.expeditionCollect());
    expect(error).toMatchObject({ status: 409, code: 'not_returned' });
    const send = await refusal(api.expeditionSend({ region: 'koko-woods', choice: 4 }));
    expect(send.code).toBe('in_progress');
  });
});

describe('the fixture api runs the real rules over the profile', () => {
  it('answers GET /expedition and GET /forge from the profile and the fixture clock', async () => {
    const api = make();
    const expedition = await api.expedition();
    expect(expedition.status).toBe('returned');
    expect(expedition.regions.filter((region) => region.unlocked)).toHaveLength(4);
    expect(expedition.choices.map((choice) => choice.affordable)).toEqual([
      true,
      true,
      true,
      true,
      false,
    ]);
    const forge = await api.forge();
    expect(forge.stations.forge.status).toBe('working');
    expect(forge.stations.loom.status).toBe('ready');
    expect(forge.stations.scriptorium.status).toBe('idle');
  });

  it('keeps its own clock: a working order finishes on schedule, and a returned trip stays returned', async () => {
    const api = createFixtureApi({ now: NOW });
    expect((await api.forge()).stations.forge.status).toBe('working');
    // The Forge order was due five hours after "now": six hours later it is ready.
    vi.setSystemTime(NOW + 6 * HOUR);
    expect((await api.forge()).stations.forge.status).toBe('ready');
    // The trip that came back two hours before "now" is still waiting to be collected.
    expect((await api.expedition()).status).toBe('returned');
  });

  describe('expeditions', () => {
    it('collects the returned trip: the stored seed rolls the same loot, and it is granted once', async () => {
      const api = make();
      const before = await api.me();
      const first = await api.expeditionCollect();
      expect(first.applied).toBe(true);
      expect(first.loot).toEqual(rollLoot(before.expedition!));
      expect(first.loot.length).toBe(5);
      expect(first.expedition.collected).toBe(true);
      // Materials are banked, gear lands in the inventory, the Charm pack in the packs.
      const after = first.me;
      expect(after.charmPacks).toHaveLength(3);
      expect(after.inventory.length).toBeGreaterThan(before.inventory.length);
      expect(after.satchel.ore).toBe(before.satchel.ore + 4);
      expect(after.satchel.flux).toBe(before.satchel.flux + 2);

      // A second collect is a replay: the same loot, nothing granted again.
      const again = await api.expeditionCollect();
      expect(again.applied).toBe(false);
      expect(again.loot).toEqual(first.loot);
      expect(again.featsUnlocked).toEqual([]);
      expect(again.me.satchel).toEqual(after.satchel);
      expect(again.me.inventory).toEqual(after.inventory);
    });

    it('unlocks Spelunker with the hundredth trip, with its title, once', async () => {
      const api = make();
      const first = await api.expeditionCollect();
      expect(first.featsUnlocked).toEqual(['spelunker']);
      expect(first.me.titles).toContain('Wayfarer');
      const feats = (await api.feats()).feats;
      const spelunker = feats.find((feat) => feat.id === 'spelunker')!;
      expect(spelunker).toMatchObject({ unlocked: true, progress: 1 });
      expect(spelunker.unlockedAt).toBe(new Date(NOW).toISOString());
      expect((await api.expeditionCollect()).featsUnlocked).toEqual([]);
    });

    it('has nothing to collect for a character that never went out (404 no_expedition)', async () => {
      const error = await refusal(make({ variant: 'noevents' }).expeditionCollect());
      expect(error).toMatchObject({ status: 404, code: 'no_expedition' });
    });

    it('sends the character out once the last trip is collected, paying the Provisions', async () => {
      const api = make();
      await api.expeditionCollect();
      const sent = await api.expeditionSend({ region: 'orrl-falls', choice: 12 });
      expect(sent.expedition).toMatchObject({
        region: 'orrl-falls',
        hours: 12,
        forage: false,
        collected: false,
      });
      expect(sent.expedition.returnsAt).toBe(NOW + 12 * HOUR);
      expect(sent.me.satchel.provisions).toBe(2);
      expect(sent.me.expedition).toEqual(sent.expedition);
      expect((await api.expedition()).status).toBe('away');
    });

    it('refuses with the typed codes, and a refused write changes nothing', async () => {
      const api = make();
      expect((await refusal(api.expeditionSend({ region: 'koko-woods', choice: 4 }))).code).toBe(
        'uncollected',
      );
      await api.expeditionCollect();
      expect((await refusal(api.expeditionSend({ region: 'quu-spire', choice: 4 }))).code).toBe(
        'region_locked',
      );
      expect((await refusal(api.expeditionSend({ region: 'koko-woods', choice: 48 }))).code).toBe(
        'insufficient_provisions',
      );
      expect((await api.me()).satchel.provisions).toBe(4);
      // The free Forage is always available.
      const forage = await api.expeditionSend({ region: 'koko-woods', choice: 'forage' });
      expect(forage.expedition.forage).toBe(true);
      expect(
        (await refusal(api.expeditionSend({ region: 'koko-woods', choice: 'forage' }))).code,
      ).toBe('in_progress');
    });
  });

  describe('Charm packs', () => {
    it('shows the three Charms of a pack the player holds, and refuses one it does not', async () => {
      const api = make();
      const options = (await api.packOptions(4101)).options;
      expect(options.map((charm) => charm.id)).toEqual(
        lootPackOptions(4101).map((charm) => charm.id),
      );
      expect((await refusal(api.packOptions(1))).code).toBe('no_such_pack');
    });

    it('keeps one Charm and spends the pack', async () => {
      const api = make();
      const options = (await api.packOptions(4101)).options;
      const pick = options[0]!;
      const answer = await api.packOpen({ seed: 4101, charmId: pick.id });
      expect(answer.me.charmPacks).toEqual([4102]);
      expect(answer.me.charms.map((charm) => charm.id)).toContain(pick.id);
      expect((await refusal(api.packOpen({ seed: 4101, charmId: pick.id }))).code).toBe(
        'no_such_pack',
      );
    });

    it('refuses a Charm the pack did not hold, and a pack with no free slot', async () => {
      const api = make();
      expect((await refusal(api.packOpen({ seed: 4101, charmId: 'not-a-charm' }))).code).toBe(
        'bad_option',
      );
      // Five different Charms fill the bar.
      const bar = ['rubber-duck', 'small-hands', 'hot-potato', 'lantern', 'grey-beard'].map(
        fixtureCharm,
      );
      const full = make({ me: { charms: bar } });
      const options = (await full.packOptions(4101)).options;
      // A Charm the player already holds would stack; a new one needs a slot, and there is none.
      const fresh = options.find((charm) => !bar.some((held) => held.id === charm.id))!;
      expect(fresh).toBeDefined();
      expect((await refusal(full.packOpen({ seed: 4101, charmId: fresh.id }))).code).toBe(
        'no_free_slot',
      );
      // The pack is still there.
      expect((await full.me()).charmPacks).toContain(4101);
    });
  });

  describe('the Forge', () => {
    it('collects the finished Loom order into the inventory, once', async () => {
      const api = make();
      const before = await api.me();
      const done = await api.forgeCollect('loom');
      expect(done.applied).toBe(true);
      expect(done.piece).toMatchObject({ slot: 'cape', tier: 'iron', name: 'Iron Cape' });
      expect(done.me.inventory).toHaveLength(before.inventory.length + 1);
      const again = await api.forgeCollect('loom');
      expect(again.applied).toBe(false);
      expect(again.piece).toEqual(done.piece);
      expect(again.me.inventory).toHaveLength(before.inventory.length + 1);
    });

    it('refuses to collect an order that is not ready or not there', async () => {
      const api = make();
      expect((await refusal(api.forgeCollect('forge'))).code).toBe('not_ready');
      expect((await refusal(api.forgeCollect('scriptorium'))).code).toBe('no_job');
    });

    it('starts an order, spending the inputs, and refuses a busy station', async () => {
      const api = make();
      const started = await api.forgeStart({
        recipeId: 'scriptorium:affix',
        pieceId: 'fx-fernblade',
      });
      const job = started.me.forge.stations.scriptorium!;
      expect(job).toMatchObject({ recipe: 'scriptorium:affix', collected: false });
      expect(job.doneAt).toBe(NOW + 4 * HOUR);
      expect(started.me.satchel.flux).toBe(1);
      expect(started.me.inventory.some((piece) => piece.id === 'fx-fernblade')).toBe(false);

      const trinket = await api
        .forgeStart({ recipeId: 'scriptorium:affix', pieceId: 'fx-leather-armour' })
        .catch((e: unknown) => e);
      expect((trinket as ApiError).code).toBe('station_busy');
    });

    it('refuses with the shared codes', async () => {
      const api = make();
      expect((await refusal(api.forgeStart({ recipeId: 'forge:nonsense' }))).code).toBe(
        'unknown_recipe',
      );
      expect((await refusal(api.forgeStart({ recipeId: 'forge:weapon:iron' }))).code).toBe(
        'station_busy',
      );
      expect((await refusal(api.forgeStart({ recipeId: 'scriptorium:affix' }))).code).toBe(
        'piece_required',
      );
      expect(
        (await refusal(api.forgeStart({ recipeId: 'scriptorium:affix', pieceId: 'nope' }))).code,
      ).toBe('piece_not_found');
    });

    it('refuses a tier that is not unlocked and supplies it cannot pay for', async () => {
      const api = make();
      expect((await refusal(api.forgeStart({ recipeId: 'scriptorium:trinket:rune' }))).code).toBe(
        'tier_locked',
      );
      const poor = make({ me: { satchel: { ...fixtureMe(NOW).satchel, timber: 0 } } });
      expect(
        (await refusal(poor.forgeStart({ recipeId: 'scriptorium:trinket:leather' }))).code,
      ).toBe('insufficient_supplies');
    });

    it('buys an upgrade once, spending its cost', async () => {
      const api = make();
      const bought = await api.forgeUpgrade({ upgrade: 'bellows' });
      expect(bought.me.forge.upgrades).toEqual(['bellows']);
      expect(bought.me.satchel.flux).toBe(0);
      expect((await refusal(api.forgeUpgrade({ upgrade: 'bellows' }))).code).toBe('already_owned');
      expect((await refusal(api.forgeUpgrade({ upgrade: 'index' }))).code).toBe(
        'insufficient_supplies',
      );
    });

    it('colours the cape only with the Dyes', async () => {
      const api = make();
      expect((await refusal(api.forgeUpgrade({ capeColor: 'azure' }))).code).toBe('dyes_required');
      const dyed = make({ me: { forge: { upgrades: ['dyes'], stations: {} } } });
      const answer = await dyed.forgeUpgrade({ capeColor: 'azure' });
      expect(answer.me.gear.capeColor).toBe('azure');
      expect((await dyed.forgeUpgrade({ capeColor: null })).me.gear.capeColor).toBeNull();
    });
  });

  describe('gear', () => {
    it('wears a piece, putting the one it replaces back in the inventory', async () => {
      const api = make();
      const answer = await api.gearEquip({ pieceId: 'fx-silver-cape' });
      expect(answer.me.gear.equipped.cape?.id).toBe('fx-silver-cape');
      expect(answer.me.inventory.map((piece) => piece.id)).toContain('fx-iron-cape');
      expect(answer.me.inventory.map((piece) => piece.id)).not.toContain('fx-silver-cape');
      // The mixed set has lost its bonus.
      expect(answer.me.gear.setBonus).toBe(0);
    });

    it('takes a slot off, and has nothing to take off an empty one', async () => {
      const api = make();
      const answer = await api.gearEquip({ unequip: 'weapon' });
      expect(answer.me.gear.equipped.weapon).toBeUndefined();
      expect(answer.me.inventory.some((piece) => piece.id === 'fx-iron-blade')).toBe(true);
      expect(answer.me.gear.setBonus).toBe(0);
      expect((await refusal(api.gearEquip({ unequip: 'weapon' }))).code).toBe('nothing_equipped');
    });

    it('swaps the pet that follows, and refuses one the player does not own', async () => {
      const api = make();
      const answer = await api.gearEquip({ petId: 'linter-cat' });
      expect(answer.me.gear.equipped.pet?.ref).toBe('linter-cat');
      expect((await refusal(api.gearEquip({ petId: 'owl' }))).code).toBe('not_owned');
    });

    it('refuses what it should', async () => {
      const api = make();
      expect((await refusal(api.gearEquip({ pieceId: 'nope' }))).code).toBe('not_owned');
      expect((await refusal(api.gearEquip({ pieceId: 'fx-iron-blade' }))).code).toBe(
        'already_equipped',
      );
      const locked = make({
        me: {
          inventory: [
            makePiece({ id: 'm', slot: 'weapon', tier: 'mithril' }),
            petPiece(petDefinition('owl')!),
          ],
        },
      });
      expect((await refusal(locked.gearEquip({ pieceId: 'm' }))).code).toBe('tier_locked');
      expect((await refusal(locked.gearEquip({ pieceId: 'pet-owl' }))).code).toBe('pet_slot');
    });
  });

  describe('Feats', () => {
    it('pins an unlocked Feat and unpins it', async () => {
      const api = make();
      const pinned = await api.featPin('imp-whisperer', true);
      expect(pinned.me.pinnedFeats).toEqual(['goblin-slayer', 'imp-whisperer']);
      expect(
        (await api.feats()).feats.filter((feat) => feat.pinned).map((feat) => feat.id),
      ).toEqual(['goblin-slayer', 'imp-whisperer']);
      const unpinned = await api.featPin('goblin-slayer', false);
      expect(unpinned.me.pinnedFeats).toEqual(['imp-whisperer']);
    });

    it('refuses a Feat that is not unlocked, one already pinned, and a fourth pin', async () => {
      const api = make();
      expect((await refusal(api.featPin('surgeon', true))).code).toBe('not_unlocked');
      expect((await refusal(api.featPin('goblin-slayer', true))).code).toBe('already_pinned');

      const all = fixtureFeats(NOW, 'active').map((feat) => ({
        ...feat,
        unlocked: true,
        progress: 1,
      }));
      const crowded = make({
        feats: all,
        me: { pinnedFeats: ['goblin-slayer', 'imp-whisperer', 'surgeon'] },
      });
      const error = await refusal(crowded.featPin('mass-reviewer', true));
      expect(error).toMatchObject({ status: 409, code: 'too_many_pinned' });
      expect((await crowded.me()).pinnedFeats).toHaveLength(3);
    });
  });

  it('puts the depth layer in the export and clears it with the account', async () => {
    const api = make();
    const exported = await api.exportData();
    expect(exported['feats']).toEqual(['goblin-slayer', 'imp-whisperer']);
    expect(exported['expeditions']).toHaveLength(1);
    expect(exported['jobs']).toHaveLength(2);
    await api.deleteAccount('octo-dev');
    const fresh = await api.me();
    expect(fresh.expedition).toBeNull();
    expect(fresh.inventory).toEqual([]);
    expect((await api.feats()).feats.every((feat) => !feat.unlocked)).toBe(true);
  });

  it('does not touch the Combat Log rows the fixture is built on', () => {
    expect(RAW_LOG).toHaveLength(14);
  });
});
