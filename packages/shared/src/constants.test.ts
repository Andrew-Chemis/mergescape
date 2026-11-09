import { describe, expect, it } from 'vitest';
import {
  ACT_CLEAR_GOLD,
  ACT_IDS,
  ACT_TARGET_FRACTION,
  ACT_WINDOW_UTC_DAYS,
  BIOMES,
  CAPS,
  CHARM_POWER_BY_RARITY,
  CHARM_RULES,
  CHARM_PRICE_BY_RARITY,
  GEAR_TIER_LEVELS,
  INTEREST,
  MAX_CHARM_COPIES,
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
  });
});
