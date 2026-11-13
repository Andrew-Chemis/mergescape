import { describe, expect, it } from 'vitest';
import {
  ACT_CLEAR_GOLD,
  AFFIX_ORDER,
  AFFIX_RULES,
  AFFIXES,
  BELLOWS_TIME_FACTOR,
  CAPE_COLORS,
  FEAT_RULES,
  RECIPE_INPUTS,
  STATION_HOURS,
  STATION_IDS,
  STATION_SLOTS,
  STATION_UPGRADES,
  UPGRADE_IDS,
  EXPEDITION_HOURS,
  EXPEDITION_PLANS,
  EXPEDITION_RULES,
  FEAT_PET_IDS,
  FORAGE_PLAN,
  GEAR_SET_BONUS,
  GEAR_TIER_RULES,
  GEAR_TIERS,
  MATERIAL_KINDS,
  PET_IDS,
  REGION_IDS,
  SIZE_TIER_LOC,
  SUPPLY_DROPS,
  SUPPLY_KINDS,
  ACT_IDS,
  ACT_TARGET_FRACTION,
  ACT_WINDOW_UTC_DAYS,
  BIOMES,
  CAPS,
  CHARM_POWER_BY_RARITY,
  CHARM_RULES,
  CHARM_PRICE_BY_RARITY,
  GEAR_TIER_LEVELS,
  FREE_PLEDGE_PACK_ACT,
  INTEREST,
  MAX_CHARM_COPIES,
  MOGUL_RULES,
  OVERCLOCK_ZONE_EXPONENT,
  PLEDGE_PLAY_WINDOW_DAYS,
  PLEDGE_RULES,
  POINTS,
  POWER_BUDGET,
  POWER_CAP,
  RARITIES,
  RARITY_WEIGHTS,
  SHOP,
  SIZE_POINTS,
  STARTER_DECK_IDS,
  ZONE_EXPONENT,
} from './constants';

describe('constants match the spec tables', () => {
  it('points (design.md 4.2)', () => {
    expect(POINTS).toEqual({
      opened: 10,
      merged: 90,
      party: 30,
      reviewDecision: 40,
      reviewComment: 15,
      inlineComment: 5,
      verifiedKill: 25,
      riposte: 15,
      dailyFirst: 20,
      streakPerWeek: 50,
    });
    expect(SIZE_POINTS).toEqual({ scale: 40, divisor: 50, max: 120 });
  });

  it('caps (design.md 4.2)', () => {
    expect(CAPS).toEqual({
      opensPerDay: 5,
      decisionReviewsPerPrPerReviewer: 2,
      commentReviewsPerPrPerReviewer: 1,
      inlineCommentsPerPrPerReviewer: 10,
      streakWeeks: 10,
    });
  });

  it('Zone exponents and the Power cap', () => {
    expect(ZONE_EXPONENT).toBe(1.6);
    expect(OVERCLOCK_ZONE_EXPONENT).toBe(1.65);
    expect(POWER_CAP).toBe(9);
  });

  it('the per-source Power budgets (design.md 4.3) leave the global cap above their sum', () => {
    expect(POWER_BUDGET).toEqual({ charms: 4, gear: 2.25, pledges: 1, feats: 0.5 });
    // Five Dragon pieces and the set bonus are exactly the gear budget; Feats match their own cap.
    expect(5 * GEAR_TIER_RULES.dragon.power + GEAR_SET_BONUS).toBe(POWER_BUDGET.gear);
    expect(FEAT_RULES.bonusCap).toBe(POWER_BUDGET.feats);
    expect(
      1 + POWER_BUDGET.charms + POWER_BUDGET.gear + POWER_BUDGET.pledges + POWER_BUDGET.feats,
    ).toBe(8.75);
    expect(8.75).toBeLessThan(POWER_CAP);
  });

  it('shop (design.md 6.5, Requirement 8)', () => {
    expect(CHARM_PRICE_BY_RARITY).toEqual({ common: 40, uncommon: 70, rare: 120, legendary: 250 });
    expect(CHARM_POWER_BY_RARITY).toEqual({ common: 0.25, uncommon: 0.5, rare: 1, legendary: 2 });
    expect(SHOP.packPrices).toEqual({ pledge: 60, charm: 100, mogul: 50 });
    expect(SHOP).toMatchObject({
      charmSlots: 2,
      packSlots: 2,
      voucherSlots: 1,
      rerollBase: 20,
      rerollBaseWithCheaperRerolls: 10,
      rerollStep: 10,
      pledgeRemoval: 50,
      sellFraction: 0.5,
      packOptions: 3,
      voucherBase: 150,
      voucherStep: 50,
    });
    const weightSum = RARITIES.reduce((sum, rarity) => sum + RARITY_WEIGHTS[rarity], 0);
    expect(weightSum).toBe(100);
    expect(RARITY_WEIGHTS).toEqual({ common: 70, uncommon: 22, rare: 7, legendary: 1 });
  });

  it('acts, gold and interest (design.md 6.1, 6.5)', () => {
    expect(ACT_IDS).toEqual(['scout', 'raid', 'boss']);
    expect(ACT_TARGET_FRACTION).toEqual({ scout: 0.6, raid: 1, boss: 1.5 });
    expect(ACT_CLEAR_GOLD).toEqual({ scout: 20, raid: 40, boss: 100 });
    expect(INTEREST).toEqual({ heldPerGold: 25, cap: 10, capWithDeepPockets: 20 });
  });

  it('act windows cover all seven UTC weekdays exactly once', () => {
    const days = ACT_IDS.flatMap((act) => [...ACT_WINDOW_UTC_DAYS[act]]).sort();
    expect(days).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('biomes and gear tiers', () => {
    expect(BIOMES).toHaveLength(6);
    expect(GEAR_TIER_LEVELS.map((entry) => entry.level)).toEqual([1, 10, 30, 50, 70, 90, 99]);
  });

  it('Charms (design.md 6.3 as audited)', () => {
    expect(MAX_CHARM_COPIES).toBe(2);
    expect(CHARM_RULES).toEqual({
      rubberDuckExtraPower: 0.25,
      rubberDuckInlineComments: 3,
      lanternPower: 0.5,
      smallHandsPower: 0.75,
      smallHandsMaxLoc: 150,
      secondPairExtraPartyPoints: 30,
      hotPotatoPower: 1.5,
      hotPotatoMaxLoc: 200,
      hotPotatoWindowHours: 2,
      greyBeardPower: 1,
      greyBeardMerges: 50,
      jestersRiposteMultiplier: 4,
      loadedDicePower: 10,
      whetstonePower: 0.5,
      whetstoneInlineComments: 1,
      familiarPathPower: 0.5,
      familiarPathMerges: 10,
      longLensPower: 1,
      longLensMinLoc: 500,
      longLensInlineComments: 3,
    });
  });

  it('Pledges (design.md 6.4)', () => {
    expect(STARTER_DECK_IDS).toEqual(['strike', 'defend', 'big-game-hunter', 'mentor', 'tidy']);
    expect(PLEDGE_PLAY_WINDOW_DAYS).toBe(2);
    expect(PLEDGE_RULES).toEqual({
      strike: { merges: 3, bonusPoints: 300 },
      defend: { reviews: 5, powerBonus: 1 },
      bigGameHunter: { minLoc: 800, reviewMultiplier: 3 },
      mentor: { approvals: 2, powerBonus: 0.5 },
      tidy: { merges: 3, maxLoc: 150, bonusPoints: 200 },
      pairUp: { merges: 3, bonusPoints: 600 },
      fineComb: { reviews: 3, minInline: 3, powerBonus: 0.5 },
      wellReviewed: { merges: 2, minInline: 3, bonusPoints: 250 },
    });
    expect(FREE_PLEDGE_PACK_ACT).toBe('raid');
  });

  it('Moguls (design.md 6.2 as audited)', () => {
    expect(MOGUL_RULES.rocketMan).toEqual({ deletionWeight: 2, netNegativePower: 1 });
    expect(MOGUL_RULES.leatherJacket).toEqual({ powerPerMerge: 0.1, maxPower: 1.5 });
    expect(MOGUL_RULES.turtleneck).toEqual({
      smallMaxLoc: 100,
      smallMultiplier: 3,
      largeMinLoc: 400,
      largeMultiplier: 0.5,
      designReviewInlineComments: 1,
      designReviewMultiplier: 2,
    });
    expect(MOGUL_RULES.hoodie).toEqual({
      windowHours: 48,
      fastMultiplier: 2,
      slowMultiplier: 0.75,
    });
    expect(MOGUL_RULES.founder).toEqual({
      pointsMultiplier: 0.5,
      goldMultiplier: 4,
      removalDay: 2,
      returnDay: 4,
      returnPower: 0.25,
      maxReturnBonus: 1,
    });
    expect(MOGUL_RULES.twoPizza).toEqual({
      minReviewers: 2,
      teamMultiplier: 2.5,
      soloMultiplier: 0.25,
      partyMultiplier: 3,
    });
  });
});

describe('constants of the depth layers (game-design.md 6.1, 6.2, 7.1)', () => {
  it('supplies drops and size tiers', () => {
    expect(SUPPLY_DROPS).toEqual({
      mergeOreBase: 1,
      mergeTimber: 1,
      reviewDecisionLore: 2,
      reviewCommentLore: 1,
      inlineInk: 1,
      inkCapPerPr: 5,
      partyProvisions: 2,
      dailyFirstProvisions: 1,
      riposteFlux: 1,
    });
    expect(SIZE_TIER_LOC).toEqual([50, 300, 1000]);
    expect(SUPPLY_KINDS).toEqual(['ore', 'timber', 'lore', 'ink', 'provisions', 'flux']);
    expect(MATERIAL_KINDS).toHaveLength(10);
  });

  it('gear tiers: Power per piece and unlocks', () => {
    expect(GEAR_TIERS.map((tier) => GEAR_TIER_RULES[tier])).toEqual([
      { power: 0.05, unlockLevel: 1, unlockRenown: null },
      { power: 0.1, unlockLevel: 10, unlockRenown: null },
      { power: 0.15, unlockLevel: 30, unlockRenown: 16 },
      { power: 0.2, unlockLevel: 50, unlockRenown: null },
      { power: 0.3, unlockLevel: 70, unlockRenown: null },
      { power: 0.4, unlockLevel: 90, unlockRenown: 64 },
    ]);
    // Five Dragon pieces plus the set bonus make the +2.25 gear budget.
    expect(5 * GEAR_TIER_RULES.dragon.power + GEAR_SET_BONUS).toBeCloseTo(2.25, 10);
  });

  it('affixes', () => {
    expect(AFFIXES).toEqual(['keen', 'stout', 'quick', 'lucky', 'hoarder']);
    expect(AFFIX_RULES).toEqual({
      keenPower: 0.1,
      stoutPower: 0.1,
      quickReduction: 0.1,
      luckyPackPoints: 5,
      hoarderSupplies: 1,
    });
  });

  it('expeditions: durations, costs, the free Forage and the 8 regions', () => {
    expect(EXPEDITION_HOURS).toEqual([4, 12, 24, 48]);
    expect(EXPEDITION_HOURS.map((hours) => EXPEDITION_PLANS[hours].provisions)).toEqual([
      1, 2, 4, 6,
    ]);
    expect(FORAGE_PLAN).toEqual({ hours: 4, provisions: 0, items: 3 });
    expect(REGION_IDS).toHaveLength(8);
    expect(EXPEDITION_RULES.oldCoinYear).toBe(7960);
    expect(EXPEDITION_RULES.oldCoinPerMille).toBe(1);
  });

  it('pets: six v1 pets and five cosmetic Feat pets', () => {
    expect(PET_IDS).toHaveLength(6);
    expect(FEAT_PET_IDS).toHaveLength(5);
  });
});

describe('constants of the Forge and Feats (game-design.md 7.2, 8)', () => {
  it('three stations, what they make, and how long it takes', () => {
    expect(STATION_IDS).toEqual(['forge', 'loom', 'scriptorium']);
    expect(STATION_SLOTS).toEqual({
      forge: ['weapon', 'body'],
      loom: ['cape'],
      scriptorium: ['trinket'],
    });
    expect(STATION_HOURS.forge).toEqual({
      leather: 2,
      iron: 4,
      silver: 8,
      mithril: 12,
      rune: 18,
      dragon: 24,
    });
    expect(STATION_HOURS.scriptorium.leather).toBe(4);
    expect(STATION_HOURS.scriptorium.dragon).toBe(12);
    expect(AFFIX_ORDER).toEqual({ hours: 4, flux: 2, rerollFlux: 4 });
  });

  it('inputs by tier and the three upgrades', () => {
    expect(RECIPE_INPUTS.leather).toEqual({ timber: 6, provisions: 2 });
    expect(RECIPE_INPUTS.silver).toEqual({ ore: 6, silver: 3 });
    expect(UPGRADE_IDS).toEqual(['bellows', 'dyes', 'index']);
    expect(STATION_UPGRADES.bellows.cost).toEqual({ flux: 3 });
    expect(STATION_UPGRADES.dyes.cost).toEqual({ ink: 10 });
    expect(STATION_UPGRADES.index.cost).toEqual({ lore: 50 });
    expect(BELLOWS_TIME_FACTOR).toBe(0.75);
    expect(CAPE_COLORS).toHaveLength(6);
  });

  it('the Feat bonus is +0.1 each up to +0.5, three can be pinned, the window is 30 days', () => {
    expect(FEAT_RULES.bonusPerFeat).toBe(0.1);
    expect(FEAT_RULES.bonusCap).toBe(0.5);
    expect(FEAT_RULES.maxPinned).toBe(3);
    expect(FEAT_RULES.windowDays).toBe(30);
    // Thresholds the design states.
    expect(FEAT_RULES).toMatchObject({
      thousandHandFiles: 1000,
      archivistReviews: 100,
      archivistMinLoc: 500,
      archivistMinInline: 3,
      deleterNetLines: 100000,
      hundredMergesWeek: 100,
      massReviewerPrs: 100,
      omnilinguistRepos: 12,
      firstLightQuietDays: 365,
      surgeonMerges: 50,
      surgeonMaxLoc: 50,
      riposteMasterRipostes: 100,
      closeReaderReviews: 25,
      closeReaderInline: 10,
      fastHandsApprovals: 50,
      fastHandsMaxLoc: 200,
      fastHandsHours: 1,
      mentorApprovals: 100,
      keeperMerges: 500,
      verifiedKills: 500,
      yearOfTheGoblinWeeks: 52,
      ironWeekStreak: 10,
      goblinSlayerKills: 1000,
      hydraBaneKills: 100,
      mogulHunterMoguls: 6,
      spelunkerExpeditions: 100,
      longHaulDays: 180,
      nightEvents: 100,
      nightStart: 22,
      nightEnd: 6,
      fridayDeploys: 10,
      fridayAfterHour: 16,
      rubberStamps: 20,
      rubberStampSeconds: 60,
      soloMerges: 50,
    });
  });
});
