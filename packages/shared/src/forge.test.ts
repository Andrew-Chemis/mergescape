import { describe, expect, it } from 'vitest';
import {
  AFFIX_ORDER,
  AFFIXES,
  BELLOWS_TIME_FACTOR,
  CAPE_COLORS,
  GEAR_TIERS,
  STATION_HOURS,
  STATION_IDS,
  STATION_UPGRADES,
} from './constants';
import { HOUR_MS } from './calendar';
import { D2_XP } from './d2table';
import {
  AFFIX_RECIPE,
  buyUpgrade,
  collectJob,
  forgeOf,
  hasUpgrade,
  isCapeColor,
  jobDurationMs,
  RECIPES,
  recipeDefinition,
  recipeHours,
  recipesFor,
  regionLean,
  rollAffix,
  setCapeColor,
  startJob,
  stationStatus,
} from './forge';
import { makePiece } from './gear';
import { createPlayerState } from './state';
import { addSupplies, satchelOf } from './supplies';
import type { PlayerState } from './types';

const T0 = Date.UTC(2026, 10, 9, 12, 0, 0);

/** A level-90 character with plenty of everything, so only the rule under test can say no. */
function rich(overrides: Partial<PlayerState> = {}): PlayerState {
  return addSupplies(
    { ...createPlayerState(5), xp: D2_XP[90]!, ...overrides },
    {
      ore: 100,
      timber: 100,
      lore: 100,
      ink: 100,
      provisions: 100,
      flux: 100,
      silver: 100,
      mithril: 100,
      rune: 100,
      dragon: 100,
    },
  );
}

describe('recipes (game-design.md 7.2)', () => {
  it('has the Forge making Weapon and Body, the Loom Cape, the Scriptorium Trinket and affixes', () => {
    expect(recipesFor('forge').map((recipe) => recipe.id)).toEqual([
      ...GEAR_TIERS.map((tier) => `forge:weapon:${tier}`),
      ...GEAR_TIERS.map((tier) => `forge:body:${tier}`),
    ]);
    expect(recipesFor('loom').map((recipe) => recipe.id)).toEqual(
      GEAR_TIERS.map((tier) => `loom:cape:${tier}`),
    );
    expect(recipesFor('scriptorium').map((recipe) => recipe.id)).toEqual([
      ...GEAR_TIERS.map((tier) => `scriptorium:trinket:${tier}`),
      'scriptorium:affix',
    ]);
    expect(RECIPES).toHaveLength(12 + 6 + 7);
    expect(new Set(RECIPES.map((recipe) => recipe.id)).size).toBe(RECIPES.length);
  });

  it('takes 2 h for Leather to 24 h for Dragon at the Forge and Loom, 4 to 12 h at the Scriptorium', () => {
    expect(STATION_HOURS.forge.leather).toBe(2);
    expect(STATION_HOURS.forge.dragon).toBe(24);
    expect(STATION_HOURS.loom.leather).toBe(2);
    expect(STATION_HOURS.loom.dragon).toBe(24);
    expect(STATION_HOURS.scriptorium.leather).toBe(4);
    expect(STATION_HOURS.scriptorium.dragon).toBe(12);
    for (const station of STATION_IDS) {
      const hours = GEAR_TIERS.map((tier) => STATION_HOURS[station][tier]);
      expect([...hours].sort((a, b) => a - b)).toEqual(hours);
    }
    expect(AFFIX_RECIPE.hours).toBe(4);
  });

  it('inputs follow the tier table: Timber and Provisions, Ore, Ore and Silver, then one tier material', () => {
    const inputs = (tier: string) => recipeDefinition(`forge:weapon:${tier}`)!.inputs;
    expect(Object.keys(inputs('leather')).sort()).toEqual(['provisions', 'timber']);
    expect(Object.keys(inputs('iron'))).toEqual(['ore']);
    expect(Object.keys(inputs('silver')).sort()).toEqual(['ore', 'silver']);
    expect(Object.keys(inputs('mithril'))).toEqual(['mithril']);
    expect(Object.keys(inputs('rune'))).toEqual(['rune']);
    expect(Object.keys(inputs('dragon'))).toEqual(['dragon']);
    expect(recipeDefinition('scriptorium:affix')!.inputs).toEqual({ flux: 2 });
    expect(recipeDefinition('nope')).toBeUndefined();
  });

  it('names pieces by tier and slot', () => {
    expect(recipeDefinition('forge:weapon:iron')!.name).toBe('Iron Blade');
    expect(recipeDefinition('loom:cape:silver')!.name).toBe('Silver Cape');
  });
});

describe('startJob and collectJob: the order state machine', () => {
  it('spends the inputs, stores the order, and finishes after the recipe time', () => {
    const player = rich();
    const started = startJob(player, 'forge:weapon:iron', T0, { seed: 99 });
    expect(started.ok).toBe(true);
    if (!started.ok) {
      return;
    }
    expect(started.job).toEqual({
      recipe: 'forge:weapon:iron',
      station: 'forge',
      startedAt: T0,
      doneAt: T0 + 4 * HOUR_MS,
      seed: 99,
      collected: false,
    });
    expect(satchelOf(started.player).ore).toBe(92);
    expect(forgeOf(started.player).stations.forge).toEqual(started.job);
    expect(stationStatus(started.player, 'forge', T0 + HOUR_MS)).toBe('working');
    expect(stationStatus(started.player, 'forge', T0 + 4 * HOUR_MS)).toBe('ready');
    expect(stationStatus(started.player, 'loom', T0)).toBe('free');
    expect(player.forge).toBeUndefined();
  });

  it('derives a seed when none is given', () => {
    const started = startJob(rich(), 'forge:weapon:iron', T0);
    expect(started.ok && Number.isInteger(started.job.seed)).toBe(true);
  });

  it('collects a finished order into the inventory, and a finished order waits as long as needed', () => {
    const started = startJob(rich(), 'forge:weapon:iron', T0, { seed: 1 });
    if (!started.ok) {
      throw new Error(started.error);
    }
    expect(collectJob(started.player, 'forge', T0 + 4 * HOUR_MS - 1)).toEqual({
      ok: false,
      error: 'not_ready',
    });
    const collected = collectJob(started.player, 'forge', T0 + 90 * 24 * HOUR_MS);
    expect(collected.ok).toBe(true);
    if (!collected.ok) {
      return;
    }
    expect(collected.applied).toBe(true);
    expect(collected.piece).toMatchObject({ slot: 'weapon', tier: 'iron', power: 0.1 });
    expect(collected.player.inventory).toEqual([collected.piece]);
    expect(collected.job).toMatchObject({ collected: true, output: collected.piece });
    expect(stationStatus(collected.player, 'forge', T0 + 99 * HOUR_MS)).toBe('free');
  });

  it('collect is idempotent: the second collect returns the same piece and adds nothing', () => {
    const started = startJob(rich(), 'loom:cape:leather', T0, { seed: 1 });
    if (!started.ok) {
      throw new Error(started.error);
    }
    const first = collectJob(started.player, 'loom', T0 + 3 * HOUR_MS);
    if (!first.ok) {
      throw new Error(first.error);
    }
    const second = collectJob(first.player, 'loom', T0 + 4 * HOUR_MS);
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.applied).toBe(false);
      expect(second.piece).toEqual(first.piece);
      expect(second.player).toBe(first.player);
      expect(second.player.inventory).toHaveLength(1);
    }
  });

  it('allows one order per station: a station is busy until its order is collected', () => {
    const started = startJob(rich(), 'forge:weapon:leather', T0, { seed: 1 });
    if (!started.ok) {
      throw new Error(started.error);
    }
    expect(startJob(started.player, 'forge:body:leather', T0 + HOUR_MS).ok).toBe(false);
    // Finished but not collected: still busy.
    expect(startJob(started.player, 'forge:body:leather', T0 + 9 * HOUR_MS)).toEqual({
      ok: false,
      error: 'station_busy',
    });
    // A different station is free.
    expect(startJob(started.player, 'loom:cape:leather', T0).ok).toBe(true);
    // Once collected the Forge is free again.
    const collected = collectJob(started.player, 'forge', T0 + 3 * HOUR_MS);
    if (!collected.ok) {
      throw new Error(collected.error);
    }
    expect(startJob(collected.player, 'forge:body:leather', T0 + 4 * HOUR_MS).ok).toBe(true);
  });

  it('fails with typed errors and changes nothing', () => {
    const player = rich();
    expect(startJob(player, 'forge:sword:iron', T0)).toEqual({
      ok: false,
      error: 'unknown_recipe',
    });
    expect(startJob(createPlayerState(1), 'forge:weapon:leather', T0)).toEqual({
      ok: false,
      error: 'insufficient_supplies',
    });
    expect(startJob({ ...player, xp: 0 }, 'forge:weapon:dragon', T0)).toEqual({
      ok: false,
      error: 'tier_locked',
    });
    expect(startJob({ ...player, xp: 0, renown: 64 }, 'forge:weapon:dragon', T0).ok).toBe(true);
    expect(collectJob(player, 'forge', T0)).toEqual({ ok: false, error: 'no_job' });
    expect(player.forge).toBeUndefined();
  });

  it('every recipe can be made once its tier is unlocked', () => {
    for (const recipe of RECIPES.filter((entry) => entry.kind === 'craft')) {
      const started = startJob(rich(), recipe.id, T0, { seed: 3 });
      expect(started.ok, recipe.id).toBe(true);
      if (started.ok) {
        const done = collectJob(started.player, recipe.station, started.job.doneAt);
        expect(done.ok && done.piece.slot, recipe.id).toBe(
          recipe.kind === 'craft' ? recipe.slot : '',
        );
      }
    }
  });
});

describe('the affix order at the Scriptorium (Requirement 16.3)', () => {
  const sword = makePiece({ id: 'blade', slot: 'weapon', tier: 'iron' });
  const keen = makePiece({ id: 'keen-blade', slot: 'weapon', tier: 'iron', affix: 'keen' });

  it('takes the piece and 2 Flux, and returns it affixed on collection', () => {
    const player = rich({ inventory: [sword] });
    const started = startJob(player, 'scriptorium:affix', T0, { seed: 7, pieceId: 'blade' });
    expect(started.ok).toBe(true);
    if (!started.ok) {
      return;
    }
    expect(satchelOf(started.player).flux).toBe(100 - AFFIX_ORDER.flux);
    expect(started.player.inventory).toEqual([]);
    expect(started.job.piece).toEqual(sword);
    expect(started.job.doneAt).toBe(T0 + AFFIX_ORDER.hours * HOUR_MS);
    const done = collectJob(started.player, 'scriptorium', started.job.doneAt);
    expect(done.ok).toBe(true);
    if (done.ok) {
      expect(done.piece.id).toBe('blade');
      expect(AFFIXES).toContain(done.piece.affix);
      expect(done.piece.affix).toBe(rollAffix(7));
      expect(done.player.inventory).toEqual([done.piece]);
    }
  });

  it('re-rolling an existing affix costs more and never gives the same one back', () => {
    const player = rich({ inventory: [keen] });
    const started = startJob(player, 'scriptorium:affix', T0, { seed: 11, pieceId: keen.id });
    expect(started.ok && satchelOf(started.player).flux).toBe(100 - AFFIX_ORDER.rerollFlux);
    for (let seed = 0; seed < 200; seed += 1) {
      expect(rollAffix(seed, 'keen')).not.toBe('keen');
    }
    expect(new Set(Array.from({ length: 300 }, (_, seed) => rollAffix(seed))).size).toBe(5);
  });

  it('needs a piece, and the piece must be in the inventory', () => {
    expect(startJob(rich(), 'scriptorium:affix', T0)).toEqual({
      ok: false,
      error: 'piece_required',
    });
    expect(startJob(rich(), 'scriptorium:affix', T0, { pieceId: 'ghost' })).toEqual({
      ok: false,
      error: 'piece_not_found',
    });
    expect(
      startJob(rich({ inventory: undefined }), 'scriptorium:affix', T0, { pieceId: 'blade' }),
    ).toEqual({ ok: false, error: 'piece_not_found' });
  });

  it('needs the Flux; the piece stays in the inventory when it fails', () => {
    const poor = addSupplies({ ...createPlayerState(1), inventory: [sword] }, { flux: 1 });
    expect(startJob(poor, 'scriptorium:affix', T0, { pieceId: 'blade' })).toEqual({
      ok: false,
      error: 'insufficient_supplies',
    });
    expect(poor.inventory).toEqual([sword]);
  });
});

describe('upgrades (Requirement 16.6)', () => {
  it('Bellows (Flux x3), Dyes (Ink x10) and Index (Lore x50), each bought once', () => {
    expect(STATION_UPGRADES.bellows).toEqual({ station: 'forge', cost: { flux: 3 } });
    expect(STATION_UPGRADES.dyes).toEqual({ station: 'loom', cost: { ink: 10 } });
    expect(STATION_UPGRADES.index).toEqual({ station: 'scriptorium', cost: { lore: 50 } });
    let player = rich();
    for (const [id, spent] of [
      ['bellows', { flux: 3 }],
      ['dyes', { ink: 10 }],
      ['index', { lore: 50 }],
    ] as const) {
      const before = satchelOf(player);
      const bought = buyUpgrade(player, id);
      expect(bought.ok).toBe(true);
      if (bought.ok) {
        const after = satchelOf(bought.player);
        for (const [kind, amount] of Object.entries(spent)) {
          expect(before[kind as keyof typeof before] - after[kind as keyof typeof after]).toBe(
            amount,
          );
        }
        expect(hasUpgrade(bought.player, id)).toBe(true);
        expect(buyUpgrade(bought.player, id)).toEqual({ ok: false, error: 'already_owned' });
        player = bought.player;
      }
    }
    expect(forgeOf(player).upgrades).toEqual(['bellows', 'dyes', 'index']);
  });

  it('cannot be bought without the supplies', () => {
    expect(buyUpgrade(createPlayerState(1), 'bellows')).toEqual({
      ok: false,
      error: 'insufficient_supplies',
    });
    expect(buyUpgrade(addSupplies(createPlayerState(1), { lore: 49 }), 'index').ok).toBe(false);
  });

  it('Bellows takes 25% off Forge orders only', () => {
    const plain = rich();
    const bellows = buyUpgrade(plain, 'bellows');
    if (!bellows.ok) {
      throw new Error(bellows.error);
    }
    const forgeRecipe = recipeDefinition('forge:weapon:dragon')!;
    const loomRecipe = recipeDefinition('loom:cape:dragon')!;
    expect(recipeHours(plain, forgeRecipe)).toBe(24);
    expect(recipeHours(bellows.player, forgeRecipe)).toBe(24 * BELLOWS_TIME_FACTOR);
    expect(recipeHours(bellows.player, loomRecipe)).toBe(24);
    expect(jobDurationMs(bellows.player, forgeRecipe)).toBe(18 * HOUR_MS);
    const started = startJob(bellows.player, 'forge:weapon:dragon', T0);
    expect(started.ok && started.job.doneAt - T0).toBe(18 * HOUR_MS);
  });

  it('Dyes unlock the cape colours; without them the colour cannot be set', () => {
    expect(CAPE_COLORS).toHaveLength(6);
    expect(isCapeColor('azure')).toBe(true);
    expect(isCapeColor('plaid')).toBe(false);
    expect(isCapeColor(4)).toBe(false);
    expect(setCapeColor(rich(), 'azure')).toEqual({ ok: false, error: 'dyes_missing' });
    const dyed = buyUpgrade(rich(), 'dyes');
    if (!dyed.ok) {
      throw new Error(dyed.error);
    }
    const blue = setCapeColor(dyed.player, 'azure');
    expect(blue.ok && blue.player.gear.capeColor).toBe('azure');
    const natural = blue.ok ? setCapeColor(blue.player, null) : blue;
    expect(natural.ok && 'capeColor' in natural.player.gear).toBe(false);
  });

  it('Index reveals what each region leans toward', () => {
    const player = rich();
    expect(regionLean(player, 'orrl-falls')).toBeNull();
    const indexed = buyUpgrade(player, 'index');
    expect(indexed.ok && regionLean(indexed.player, 'orrl-falls')).toBe('Ore, Iron gear');
  });
});
