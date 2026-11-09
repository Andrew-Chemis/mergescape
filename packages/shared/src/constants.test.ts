import { describe, expect, it } from 'vitest';
import {
  ACT_CLEAR_GOLD,
  AFFIX_RULES,
  AFFIXES,
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
