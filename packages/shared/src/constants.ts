/**
 * Every tunable game number lives here and nowhere else (tasks.md conventions).
 * Sources: design.md section 4.2 (points and caps), 4.3 and 4.4 (Power and Zone), 6.1 (run), 6.3 to 6.5
 * (Charms, Pledges, shop), game-design.md section 6.1 (supplies) and requirements.md 4, 5, 6, 8, 9.
 */

// ---------------------------------------------------------------------------------------------
// Points (design.md 4.2)
// ---------------------------------------------------------------------------------------------

export const POINTS = {
  /** PR opened (non-draft) or marked ready for review. */
  opened: 10,
  /** PR merged, credited to the author (or to a human merger when the author is a bot). */
  merged: 90,
  /** Party bonus: at least one APPROVED review from a different human account. */
  party: 30,
  /** Review state APPROVED or CHANGES_REQUESTED. */
  reviewDecision: 40,
  /** Review state COMMENTED. */
  reviewComment: 15,
  /** One inline review comment. */
  inlineComment: 5,
  /** A PR you approved later merges. */
  verifiedKill: 25,
  /** Your PR received CHANGES_REQUESTED and then merged. */
  riposte: 15,
  /** First scored event of a UTC day. */
  dailyFirst: 20,
  /** Weekly streak: this many points times consecutive weeks. */
  streakPerWeek: 50,
} as const;

/** Size points on merge: `round(SCALE * log2(1 + (adds + dels) / DIVISOR))`, capped at `MAX`. */
export const SIZE_POINTS = {
  scale: 40,
  divisor: 50,
  max: 120,
} as const;

// ---------------------------------------------------------------------------------------------
// Caps (design.md 4.2)
// ---------------------------------------------------------------------------------------------

export const CAPS = {
  /** Opens that earn points per UTC day. */
  opensPerDay: 5,
  /** Scoring (APPROVED or CHANGES_REQUESTED) reviews per PR per reviewer. */
  decisionReviewsPerPrPerReviewer: 2,
  /** COMMENTED reviews per PR per reviewer. */
  commentReviewsPerPrPerReviewer: 1,
  /** Inline comments per PR per reviewer. */
  inlineCommentsPerPrPerReviewer: 10,
  /** Weekly streak multiplier stops growing after this many consecutive weeks. */
  streakWeeks: 10,
} as const;

/** Multiplier on merge, size and party points of a solo kill (merged by the author, no other human review). */
export const SOLO_KILL_MULTIPLIER = 0.5;

/** Multiplier on all of a PR's points when its base ref is not the repository default branch. */
export const NON_DEFAULT_BRANCH_MULTIPLIER = 0.5;

// ---------------------------------------------------------------------------------------------
// Power and Zone (design.md 4.3, 4.4; requirements.md 4.5, 4.6)
// ---------------------------------------------------------------------------------------------

/** Power of a brand-new character. */
export const BASE_POWER = 1;

/** Power is capped here (Requirement 4.5 as amended; gear and Feats raise the budget to 9). */
export const POWER_CAP = 9;

/** Zone = (level + 1) ^ exponent. */
export const ZONE_EXPONENT = 1.6;

/** Zone exponent once the Overclock voucher is owned. */
export const OVERCLOCK_ZONE_EXPONENT = 1.65;

// ---------------------------------------------------------------------------------------------
// Supplies (game-design.md 6.1)
// ---------------------------------------------------------------------------------------------

export const SUPPLY_DROPS = {
  /** Merged PR: Ore = 1 + size tier (0 to 3). */
  mergeOreBase: 1,
  mergeTimber: 1,
  reviewDecisionLore: 2,
  reviewCommentLore: 1,
  inlineInk: 1,
  /** Ink from inline comments stops after this many per PR per reviewer. */
  inkCapPerPr: 5,
  partyProvisions: 2,
  dailyFirstProvisions: 1,
  riposteFlux: 1,
} as const;

/**
 * Size tiers for the Ore drop, by lines changed (additions + deletions): tier 0 below the first
 * threshold, tier 3 at or above the last. Aligned with the Merge Goblin and Legacy Golem thresholds.
 */
export const SIZE_TIER_LOC = [50, 300, 1000] as const;

// ---------------------------------------------------------------------------------------------
// Monsters (design.md 7.1)
// ---------------------------------------------------------------------------------------------

export const MONSTER_RULES = {
  /** Nitpick Imp: a reviewer has left at least this many inline comments on the PR. */
  nitpickInlineComments: 5,
  /** Flaky Test Wraith: at least this many `synchronize` pushes. */
  flakyPushes: 4,
  /** Legacy Golem: a merged PR of at least this many lines. */
  golemLoc: 1000,
  /** Rebase Hydra: at least this many review rounds. */
  hydraReviewRounds: 3,
  /** Scope Creep: a PR open for more than this many days before merge. */
  scopeCreepDays: 14,
} as const;

// ---------------------------------------------------------------------------------------------
// Charms, Pledges, Vouchers (design.md 6.3 to 6.5; requirements.md 9)
// ---------------------------------------------------------------------------------------------

export const RARITIES = ['common', 'uncommon', 'rare', 'legendary'] as const;
export type Rarity = (typeof RARITIES)[number];

/** Power of a Charm by rarity. */
export const CHARM_POWER_BY_RARITY: Readonly<Record<Rarity, number>> = {
  common: 0.25,
  uncommon: 0.5,
  rare: 1.0,
  legendary: 2.0,
};

/** Shop price of a Charm by rarity (gold). */
export const CHARM_PRICE_BY_RARITY: Readonly<Record<Rarity, number>> = {
  common: 40,
  uncommon: 70,
  rare: 120,
  legendary: 250,
};

/** Shop stock rarity weights (percent, sum 100). */
export const RARITY_WEIGHTS: Readonly<Record<Rarity, number>> = {
  common: 70,
  uncommon: 22,
  rare: 7,
  legendary: 1,
};

export const CHARM_SLOTS = 5;
export const CHARM_SLOTS_WITH_BELT = 6;

/** A duplicate Charm stacks once (two copies); a third copy is auto-sold. */
export const MAX_CHARM_COPIES = 2;

/**
 * Charm numbers (design.md 6.3 as audited in game-design.md 8.3). A Charm's unconditional Power is its
 * `basePower` in charms.ts; the conditional amounts and thresholds live here. "Under" is strict.
 */
export const CHARM_RULES = {
  /** Rubber Duck: extra Power on a review once the reviewer has left this many inline comments. */
  rubberDuckExtraPower: 0.25,
  rubberDuckInlineComments: 3,
  /** Lantern: Power on the first scored event of each (UTC) day. */
  lanternPower: 0.5,
  /** Small Hands: Power on merges under this many lines. */
  smallHandsPower: 0.75,
  smallHandsMaxLoc: 150,
  /** Second Pair of Eyes: extra party-bonus points per copy (30 becomes 60). */
  secondPairExtraPartyPoints: 30,
  /** Hot Potato: Power on an approval of a PR under this many lines within this many hours of its open. */
  hotPotatoPower: 1.5,
  hotPotatoMaxLoc: 200,
  hotPotatoWindowHours: 2,
  /** Grey Beard: Power on any event in a repository where the player has this many merges. */
  greyBeardPower: 1.0,
  greyBeardMerges: 50,
  /** Jester's Rebase: Riposte points are multiplied by this. */
  jestersRiposteMultiplier: 4,
  /** Loaded Dice: once a week one event's Power is replaced by this (it may exceed the Power cap). */
  loadedDicePower: 10,
} as const;

export const DECK_CAP = 20;
export const PLEDGE_HAND_SIZE = 5;
export const PLEDGE_PLAY_LIMIT = 3;

/** Plays close this many days after Monday 00:00 UTC, i.e. at the end of Tuesday (Requirement 9.3). */
export const PLEDGE_PLAY_WINDOW_DAYS = 2;

/** The deck every character starts with (Requirement 9.2), by Pledge id. */
export const STARTER_DECK_IDS = ['strike', 'defend', 'big-game-hunter', 'mentor', 'tidy'] as const;

/** Pledge contracts and rewards (design.md 6.4). "Under" is strict, "at least" is inclusive. */
export const PLEDGE_RULES = {
  /** Strike: merge this many PRs this week, +300 points on the last. */
  strike: { merges: 3, bonusPoints: 300 },
  /** Defend: this many scoring reviews, then +1 Power on all reviews for the rest of the week. */
  defend: { reviews: 5, powerBonus: 1 },
  /** Big Game Hunter: review a PR of at least this many lines; that review scores x3. */
  bigGameHunter: { minLoc: 800, reviewMultiplier: 3 },
  /** Mentor: approve this many PRs from authors with fewer merges than you, then +0.5 Power until Sunday. */
  mentor: { approvals: 2, powerBonus: 0.5 },
  /** Tidy: merge this many PRs each under `maxLoc` lines, +200 points on the last. */
  tidy: { merges: 3, maxLoc: 150, bonusPoints: 200 },
  /** Pair Up (Strike+): merge this many PRs each with the party bonus, +600 points on the last. */
  pairUp: { merges: 3, bonusPoints: 600 },
} as const;

/** Mogul modifiers (design.md 6.2 as audited in game-design.md 8.3). "Under" and "over" are strict. */
export const MOGUL_RULES = {
  rocketMan: {
    /** Deletions count this many times toward size points. */
    deletionWeight: 2,
    /** Power on a merge with more deletions than additions. */
    netNegativePower: 1,
  },
  leatherJacket: {
    /** Power per successive reviewed merge this week, up to `maxPower`. */
    powerPerMerge: 0.1,
    maxPower: 1.5,
  },
  turtleneck: {
    smallMaxLoc: 100,
    smallMultiplier: 3,
    largeMinLoc: 400,
    largeMultiplier: 0.5,
    /** An approval with exactly this many inline comments is a "design review". */
    designReviewInlineComments: 1,
    designReviewMultiplier: 2,
  },
  hoodie: {
    /** A merge this many hours or fewer after the PR's first review scores `fastMultiplier`. */
    windowHours: 48,
    fastMultiplier: 2,
    slowMultiplier: 0.75,
  },
  founder: {
    pointsMultiplier: 0.5,
    goldMultiplier: 4,
    /** The Board removes a Charm this many days after Monday 00:00 UTC (Wednesday) ... */
    removalDay: 2,
    /** ... and returns it this many days after (Friday), with this much extra Power. */
    returnDay: 4,
    returnPower: 0.25,
  },
  twoPizza: {
    minReviewers: 2,
    teamMultiplier: 2.5,
    soloMultiplier: 0.25,
    partyMultiplier: 3,
  },
} as const;

// ---------------------------------------------------------------------------------------------
// Weekly run (design.md 6.1; requirements.md 6)
// ---------------------------------------------------------------------------------------------

export const ACT_IDS = ['scout', 'raid', 'boss'] as const;
export type ActId = (typeof ACT_IDS)[number];

/** Act XP targets as a fraction of the player's 8-week median weekly XP. */
export const ACT_TARGET_FRACTION: Readonly<Record<ActId, number>> = {
  scout: 0.6,
  raid: 1.0,
  boss: 1.5,
};

/** UTC weekdays (0 = Sunday) of each act's calendar window: Mon-Tue, Wed-Thu, Fri-Sun. */
export const ACT_WINDOW_UTC_DAYS: Readonly<Record<ActId, readonly number[]>> = {
  scout: [1, 2],
  raid: [3, 4],
  boss: [5, 6, 0],
};

/** Weekly XP target used until the player has `MIN_HISTORY_WEEKS` of history. */
export const FLAT_TARGET_XP = 2000;
export const MIN_HISTORY_WEEKS = 3;
export const MEDIAN_WEEKS = 8;
/** A target never exceeds this multiple of the previous week's actual XP. */
export const TARGET_MAX_PREVIOUS_MULTIPLE = 2;

/** Renown needed per biome change, and the biome order. */
export const RENOWN_PER_BIOME = 8;
export const BIOMES = [
  'Town',
  'Sewers of Legacy',
  'Flaky Marsh',
  'Dependency Mines',
  'Release Peaks',
  'The Rebase Abyss',
] as const;

/** A Legendary Charm is offered on every Nth Renown point. */
export const LEGENDARY_OFFER_EVERY_RENOWN = 4;

// ---------------------------------------------------------------------------------------------
// Gold and shop (design.md 6.5; requirements.md 8)
// ---------------------------------------------------------------------------------------------

/** Gold earned per this many points scored (1 gold per 10 points). */
export const POINTS_PER_GOLD = 10;

/** Gold paid when an act clears. */
export const ACT_CLEAR_GOLD: Readonly<Record<ActId, number>> = {
  scout: 20,
  raid: 40,
  boss: 100,
};

/** Interest: 1 gold per `heldPerGold` gold held at each act clear, capped. */
export const INTEREST = {
  heldPerGold: 25,
  cap: 10,
  capWithDeepPockets: 20,
} as const;

export const SHOP = {
  charmSlots: 2,
  packSlots: 2,
  voucherSlots: 1,
  /** Pledge pack, Charm pack, Mogul cosmetic pack (gold). */
  packPrices: { pledge: 60, charm: 100, mogul: 50 },
  /** First re-roll costs this much; each further re-roll in the same visit adds `rerollStep`. */
  rerollBase: 20,
  rerollBaseWithCheaperRerolls: 10,
  rerollStep: 10,
  pledgeRemoval: 50,
  /** Selling a Charm returns this fraction of its shop price. */
  sellFraction: 0.5,
  /** Pack options shown; the player keeps exactly one. */
  packOptions: 3,
  /** Voucher price: base plus a step for every voucher already owned. */
  voucherBase: 150,
  voucherStep: 50,
} as const;

// ---------------------------------------------------------------------------------------------
// Levelling (requirements.md 5)
// ---------------------------------------------------------------------------------------------

/** Vocation thresholds, applied in this precedence at run rollover (share of total skill XP). */
export const VOCATION_THRESHOLDS = {
  smith: 0.55,
  warden: 0.55,
  herald: 0.35,
  pilgrim: 0.25,
} as const;

/** Character level at which each gear tier starts rendering (Requirement 5.4). */
export const GEAR_TIER_LEVELS = [
  { level: 1, tier: 'Rags' },
  { level: 10, tier: 'Leather' },
  { level: 30, tier: 'Iron' },
  { level: 50, tier: 'Mithril' },
  { level: 70, tier: 'Rune' },
  { level: 90, tier: 'Dragon' },
  { level: 99, tier: 'Trimmed' },
] as const;
