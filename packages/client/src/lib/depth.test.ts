import { describe, expect, it } from 'vitest';
import {
  RECIPES,
  REGIONS,
  makePiece,
  reclaimedPiece,
  uniqueDefinition,
  uniquePiece,
} from '@mergescape/shared';
import type { LootItem } from '@mergescape/shared';
import {
  affixCost,
  canPay,
  expeditionLine,
  expeditionStatusOf,
  expeditionViewFrom,
  featName,
  featRewardText,
  forgeViewFrom,
  formatCoarse,
  formatCost,
  formatCountdown,
  formatLong,
  formatDay,
  heroLook,
  lootCaption,
  lootKindLabel,
  lootRarity,
  lootSpoken,
  lootTitle,
  pieceDetail,
  pieceLook,
  pieceName,
  shortOf,
  stationStatusOf,
  toMs,
} from './depth';
import { fixtureMe } from './fixtures/state';
import type { MeResponse } from './types';

const NOW = Date.UTC(2026, 10, 11, 14, 5, 0);
const HOUR = 3_600_000;

describe('time', () => {
  it('reads an epoch number or an ISO string, and nothing else', () => {
    expect(toMs(5)).toBe(5);
    expect(toMs('2026-11-11T14:05:00.000Z')).toBe(NOW);
    expect(toMs('nope')).toBeNull();
    expect(toMs(Number.NaN)).toBeNull();
    expect(toMs(null)).toBeNull();
    expect(toMs(undefined)).toBeNull();
  });

  it.each([
    [0, 'under a minute'],
    [-5, 'under a minute'],
    [30_000, '1 min'],
    [59 * 60_000, '59 min'],
    [60 * 60_000, '1 h'],
    [60 * 60_000 + 1, '2 h'],
    [8.2 * HOUR, '9 h'],
    [9 * HOUR, '9 h'],
  ])('says %i ms as "%s", rounding up so a return is never promised early', (ms, text) => {
    expect(formatCoarse(ms)).toBe(text);
  });

  it('counts down to the second', () => {
    expect(formatCountdown(3 * HOUR + 12 * 60_000 + 5_000)).toBe('3:12:05');
    expect(formatCountdown(59_001)).toBe('0:01:00');
    expect(formatCountdown(-1)).toBe('0:00:00');
  });

  it('says a trip to the minute', () => {
    expect(formatLong(3.6 * HOUR)).toBe('3 h 36 min');
    expect(formatLong(4 * HOUR)).toBe('4 h');
    expect(formatLong(40 * 60_000)).toBe('40 min');
    expect(formatLong(-5)).toBe('0 min');
  });

  it('names a day in UTC and tolerates a bad date', () => {
    expect(formatDay('2026-10-30T10:00:00.000Z')).toBe('Fri, Oct 30');
    expect(formatDay('nope')).toBe('');
  });
});

describe('costs', () => {
  const satchel = fixtureMe(NOW).satchel;

  it('lists a cost in satchel order and nothing for none', () => {
    expect(formatCost({ timber: 6, provisions: 2 })).toBe('6 Timber, 2 Provisions');
    expect(formatCost({ dragon: 6 })).toBe('6 Dragon scale');
    expect(formatCost({})).toBe('');
  });

  it('says what the satchel lacks', () => {
    expect(canPay(satchel, { ore: 8 })).toBe(true);
    expect(canPay(satchel, { ore: 80 })).toBe(false);
    expect(shortOf(satchel, { ore: 20, silver: 9 })).toBe('2 Ore, 4 Silver');
    expect(shortOf(satchel, { ore: 1 })).toBe('');
  });

  it('prices an affix order at 2 Flux, or 4 to re-roll an affix', () => {
    expect(affixCost(makePiece({ id: 'a', slot: 'weapon', tier: 'iron' }))).toEqual({ flux: 2 });
    expect(affixCost(makePiece({ id: 'b', slot: 'weapon', tier: 'iron', affix: 'keen' }))).toEqual({
      flux: 4,
    });
  });
});

describe('expedition views', () => {
  const me = fixtureMe(NOW);

  it('reads the status from the stored trip and the clock', () => {
    expect(expeditionStatusOf(null, NOW)).toBe('none');
    const trip = me.expedition!;
    expect(expeditionStatusOf(trip, NOW)).toBe('returned');
    expect(expeditionStatusOf(trip, trip.returnsAt - 1)).toBe('away');
    expect(expeditionStatusOf({ ...trip, collected: true }, NOW)).toBe('collected');
  });

  it('builds the regions with their gates, locked by Renown, and the Index shows their lean', () => {
    const view = expeditionViewFrom(me, NOW);
    expect(view.regions).toHaveLength(REGIONS.length);
    expect(view.regions.map((region) => [region.id, region.unlocked])).toEqual([
      ['koko-woods', true],
      ['crossroads-of-wix', true],
      ['orrl-falls', true],
      ['silverhall', true],
      ['koko-deep-woods', false],
      ['mazu-deep', false],
      ['quu-spire', false],
      ['garbage-collector', false],
    ]);
    expect(view.regions.every((region) => region.lean === null)).toBe(true);
    const indexed = expeditionViewFrom({ ...me, forge: { ...me.forge, upgrades: ['index'] } }, NOW);
    expect(indexed.regions[0]?.lean).toBe('Timber, Provisions, Leather gear');
  });

  it('builds the five ways to go out with what they cost and whether the satchel can pay', () => {
    const view = expeditionViewFrom(me, NOW);
    expect(view.choices.map((choice) => [choice.choice, choice.hours, choice.provisions])).toEqual([
      ['forage', 4, 0],
      [4, 4, 1],
      [12, 12, 2],
      [24, 24, 4],
      [48, 48, 6],
    ]);
    // 4 Provisions in the fixture satchel.
    expect(view.choices.map((choice) => choice.affordable)).toEqual([
      true,
      true,
      true,
      true,
      false,
    ]);
    expect(view.status).toBe('returned');
    // No Quick gear in the fixture set: every trip takes its nominal time.
    expect(view.choices.map((choice) => choice.durationMs)).toEqual(
      [4, 4, 12, 24, 48].map((hours) => hours * HOUR),
    );
    // A Quick piece shortens every trip by 10%, as the api reports in `durationMs`.
    const quick = makePiece({ id: 'q', slot: 'weapon', tier: 'iron', affix: 'quick' });
    const hasted = expeditionViewFrom(
      { ...me, gear: { ...me.gear, equipped: { ...me.gear.equipped, weapon: quick } } },
      NOW,
    );
    expect(hasted.choices.map((choice) => choice.durationMs)).toEqual(
      [4, 4, 12, 24, 48].map((hours) => hours * HOUR * 0.9),
    );
    expect(view.returnsAt).toBe(new Date(me.expedition!.returnsAt).toISOString());
    expect(expeditionViewFrom({ ...me, expedition: null }, NOW)).toMatchObject({
      status: 'none',
      returnsAt: null,
      expedition: null,
    });
    expect(
      expeditionViewFrom({ ...me, expedition: { ...me.expedition!, collected: true } }, NOW)
        .returnsAt,
    ).toBeNull();
  });

  it('says it for Town: a countdown while away, collect when back, otherwise in Town', () => {
    const trip = me.expedition!;
    expect(expeditionLine({ ...trip, returnsAt: NOW + 8.5 * HOUR }, NOW)).toEqual({
      status: 'away',
      text: 'Returns in 9 h',
    });
    expect(expeditionLine({ ...trip, returnsAt: NOW + 40 * 60_000 }, NOW).text).toBe(
      'Returns in 40 min',
    );
    expect(expeditionLine(trip, NOW)).toEqual({ status: 'returned', text: 'Returned: collect' });
    expect(expeditionLine(null, NOW)).toEqual({ status: 'none', text: 'In Town' });
    expect(expeditionLine({ ...trip, collected: true }, NOW).status).toBe('collected');
  });
});

describe('Forge views', () => {
  const me = fixtureMe(NOW);

  it('reads each station: working, ready or idle', () => {
    const job = me.forge.stations.forge!;
    expect(stationStatusOf(job, NOW)).toBe('working');
    expect(stationStatusOf(job, job.doneAt)).toBe('ready');
    expect(stationStatusOf({ ...job, collected: true }, NOW)).toBe('collected');
    expect(stationStatusOf(undefined, NOW)).toBe('idle');
    const view = forgeViewFrom(me, NOW);
    expect(view.stations.forge.status).toBe('working');
    expect(view.stations.loom.status).toBe('ready');
    expect(view.stations.scriptorium).toEqual({ job: null, status: 'idle', readyAt: null });
    expect(view.stations.forge.readyAt).toBe(new Date(job.doneAt).toISOString());
  });

  it('lists every recipe with its unlock and affordability', () => {
    const view = forgeViewFrom(me, NOW);
    expect(view.recipes).toHaveLength(RECIPES.length);
    const byId = Object.fromEntries(view.recipes.map((recipe) => [recipe.id, recipe]));
    // Level 41 with Renown 17: Silver is open (Silverhall), Mithril is not (level 50).
    expect(byId['forge:weapon:silver']).toMatchObject({ unlocked: true, affordable: true });
    expect(byId['forge:weapon:mithril']).toMatchObject({ unlocked: false, affordable: false });
    expect(byId['forge:weapon:iron']).toMatchObject({ hours: 4, affordable: true });
    expect(byId['scriptorium:affix']).toMatchObject({ unlocked: true, affordable: true });
  });

  it('cuts a quarter off Forge orders only once the Bellows is owned', () => {
    const view = forgeViewFrom({ ...me, forge: { ...me.forge, upgrades: ['bellows'] } }, NOW);
    expect(view.recipes.find((recipe) => recipe.id === 'forge:weapon:iron')?.hours).toBe(3);
    expect(view.recipes.find((recipe) => recipe.id === 'loom:cape:iron')?.hours).toBe(4);
    expect(view.upgrades).toEqual([
      { id: 'bellows', owned: true, cost: { flux: 3 } },
      { id: 'dyes', owned: false, cost: { ink: 10 } },
      { id: 'index', owned: false, cost: { lore: 50 } },
    ]);
  });
});

describe('gear words and the hero look', () => {
  const me = fixtureMe(NOW);

  it('names and describes a piece', () => {
    const piece = makePiece({ id: 'x', slot: 'body', tier: 'iron', affix: 'stout' });
    expect(pieceName(piece)).toBe('Iron Armour');
    expect(pieceDetail(piece)).toBe('Iron · +0.1 Power · Stout');
    expect(pieceName({ ...piece, name: undefined })).toBe('Body');
    expect(pieceLook({ tier: 'iron', look: 'dragon' })).toBe('dragon');
    expect(pieceLook({})).toBeNull();
    expect(pieceDetail({ id: 'y', slot: 'trinket', power: 0.3 })).toBe('+0.3 Power');
  });

  it('draws the hero in the palette of the highest tier worn, with its cape', () => {
    // A full Iron set and a natural cape: Iron palette, Iron cloth.
    expect(heroLook(me)).toEqual({ palette: 'iron', cape: '#8e8e8e' });
    // Dyes repaint the cape.
    expect(heroLook({ ...me, gear: { ...me.gear, capeColor: 'azure' } }).cape).toBe('#3a78d8');
    // The Monolith Plate looks like Dragon whatever its Power tier.
    const plate = uniquePiece(uniqueDefinition('monolith-plate')!, 'p');
    expect(
      heroLook({ ...me, gear: { ...me.gear, equipped: { ...me.gear.equipped, body: plate } } })
        .palette,
    ).toBe('dragon');
    // A Silver piece has a palette of its own.
    const silver = makePiece({ id: 's', slot: 'weapon', tier: 'silver' });
    expect(heroLook({ ...me, gear: { ...me.gear, equipped: { weapon: silver } } })).toEqual({
      palette: 'silver',
      cape: null,
    });
  });

  it('falls back to the level palette with nothing worn, and shows no cape', () => {
    const bare: MeResponse = { ...me, gear: { equipped: {}, setBonus: 0, capeColor: null } };
    expect(heroLook(bare)).toEqual({ palette: 'iron', cape: null });
    expect(heroLook({ ...bare, xp: 0 })).toEqual({ palette: 'rags', cape: null });
  });
});

describe('loot words', () => {
  const unique: LootItem = {
    kind: 'unique',
    piece: uniquePiece(uniqueDefinition('hallkeepers-mail')!, 'u'),
  };
  const reclaimed: LootItem = {
    kind: 'unique',
    piece: reclaimedPiece('r', 'weapon', 'Ambrel of the Low Road'),
  };
  const gear: LootItem = {
    kind: 'gear',
    piece: makePiece({ id: 'g', slot: 'body', tier: 'silver' }),
  };
  const affixed: LootItem = {
    kind: 'gear',
    piece: makePiece({ id: 'h', slot: 'weapon', tier: 'iron', affix: 'lucky' }),
  };
  const material: LootItem = { kind: 'material', material: 'dragon', quantity: 3 };
  const pack: LootItem = { kind: 'charm_pack', seed: 5 };
  const pet: LootItem = { kind: 'pet', petId: 'owl' };
  const coin: LootItem = { kind: 'coin', year: 7960 };

  it('rates items for the card border', () => {
    expect(lootRarity(material)).toBe('common');
    expect(lootRarity(gear)).toBe('uncommon');
    expect(lootRarity(affixed)).toBe('rare');
    expect(lootRarity(pack)).toBe('rare');
    expect(lootRarity(pet)).toBe('rare');
    expect(lootRarity(unique)).toBe('legendary');
    expect(lootRarity(coin)).toBe('legendary');
  });

  it('names the kind and the item', () => {
    expect([material, gear, pack, pet, unique, reclaimed, coin].map(lootKindLabel)).toEqual([
      'Material',
      'Gear',
      'Charm pack',
      'Pet',
      'Unique',
      'Reclaimed',
      'Curio',
    ]);
    expect([material, gear, pack, pet, unique, reclaimed, coin].map(lootTitle)).toEqual([
      '3 Dragon scale',
      'Silver Armour',
      'Charm pack',
      'Owl',
      "Hallkeeper's Mail",
      "Reclaimed Blade, once Ambrel of the Low Road's",
      'Coin dated 7960',
    ]);
    expect(lootTitle({ kind: 'pet', petId: 'unknown-pet' })).toBe('unknown-pet');
  });

  it('gives a unique one line of story, and a Reclaimed piece its invented former owner', () => {
    expect(lootCaption(unique)).toBe('Worn by whoever was left in charge of Silverhall.');
    expect(lootCaption(reclaimed)).toBe('Former owner: Ambrel of the Low Road');
    expect(lootCaption(affixed)).toBe('Lucky: +5% Charm-pack odds');
    expect(lootCaption(gear)).toBeNull();
    expect(lootCaption(material)).toBeNull();
    expect(lootCaption(pet)).toBe('+3 points of Charm-pack odds on expeditions.');
    expect(lootCaption(pack)).toBe('Three Charms inside. Keep one.');
    expect(lootCaption(coin)).toBe('It will show on your badge.');
    // A pet with no passive says what it is instead.
    expect(lootCaption({ kind: 'pet', petId: 'coin-mote' })).toBe(
      'A spark of the coin dated 7960. Cosmetic.',
    );
    // A unique outside the catalogue has no caption rather than a wrong one.
    expect(
      lootCaption({
        kind: 'unique',
        piece: makePiece({ id: 'q', slot: 'cape', tier: 'iron', ref: 'nope' }),
      }),
    ).toBeNull();
  });

  it('speaks a card whole', () => {
    expect(lootSpoken(unique)).toBe(
      "Unique: Hallkeeper's Mail. Worn by whoever was left in charge of Silverhall.",
    );
    expect(lootSpoken(material)).toBe('Material: 3 Dragon scale');
  });
});

describe('Feat words', () => {
  it('lists a reward in words', () => {
    expect(featRewardText('goblin-slayer')).toBe('Pet: Goblin Runt');
    expect(featRewardText('archivist')).toBe(
      'Title: Archivist · Gear: Monolith Plate · +0.1 Power',
    );
    expect(featRewardText('spelunker')).toBe('Title: Wayfarer');
    expect(featRewardText('not-a-feat')).toBe('');
  });

  it('names a Feat from the catalogue, or falls back on its id', () => {
    expect(featName('spelunker')).toBe('Spelunker');
    expect(featName('not-a-feat')).toBe('not-a-feat');
  });
});
