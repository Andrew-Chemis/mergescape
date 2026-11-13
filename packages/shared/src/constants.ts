/**
 * Every tunable game number lives here and nowhere else (tasks.md conventions).
 * Sources: design.md section 4.2 (points and caps), 4.3 and 4.4 (Power and Zone), 6.1 (run), 6.3 to 6.5
 * (Charms, Pledges, shop), game-design.md section 6.1 (supplies) and requirements.md 4, 5, 6, 8, 9.
 */

import type { GearSlot } from './types';

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

/**
 * The most Power each source may add (design.md 4.3): Charms +4, worn gear +2.25 (five Dragon pieces and the
 * set bonus), completed Pledges +1, Feats +0.5. `powerBreakdown` enforces each one with a visible cap line,
 * on top of the global `POWER_CAP`. The Mogul lines (Rocket Man, Leather Jacket) have their own caps.
 */
export const POWER_BUDGET = {
  charms: 4,
  gear: 2.25,
  pledges: 1,
  feats: 0.5,
} as const;

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

/** The eight mobs and elites of the Bestiary (the six Moguls are counted separately; see moguls.ts). */
export const MONSTER_IDS = [
  'merge-goblin',
  'nitpick-imp',
  'flaky-test-wraith',
  'legacy-golem',
  'rebase-hydra',
  'scope-creep',
  'release-dragon',
  'silent-monolith',
] as const;

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
  /**
   * Whetstone: Power on an approval of a PR whose author has fewer merges than you, when you left at least
   * this many inline comments on it (so a mentoring approval is a read, never a stamp).
   */
  whetstonePower: 0.5,
  whetstoneInlineComments: 1,
  /** Familiar Path: Power on any event in a repository where the player has this many merges. */
  familiarPathPower: 0.5,
  familiarPathMerges: 10,
  /**
   * Long Lens: Power on a scoring review of a PR of at least this many lines when the reviewer left at
   * least this many inline comments on it: the thorough review of a big PR that nobody thanks you for.
   */
  longLensPower: 1.0,
  longLensMinLoc: 500,
  longLensInlineComments: 3,
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
  /**
   * Fine Comb: submit this many scoring reviews, each after leaving at least `minInline` inline comments
   * on that PR, then +0.5 Power on all reviews for the rest of the week.
   */
  fineComb: { reviews: 3, minInline: 3, powerBonus: 0.5 },
  /**
   * Well Reviewed: merge this many PRs that each drew at least `minInline` inline comments from a
   * reviewer, +250 points on the last: it rewards PRs that were read, not PRs that were large.
   */
  wellReviewed: { merges: 2, minInline: 3, bonusPoints: 250 },
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
    /** A Charm never gains more than this much Power over its base from the Board, however many weeks it is taken. */
    maxReturnBonus: 1,
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

/** Clearing this act also grants one free Pledge pack (design.md 6.1). */
export const FREE_PLEDGE_PACK_ACT: ActId = 'raid';

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

// ---------------------------------------------------------------------------------------------
// Materials and the satchel (game-design.md 6.1 and 7.1; Requirement 15.1)
// ---------------------------------------------------------------------------------------------

/** The six supplies scored events drop, in satchel display order. */
export const SUPPLY_KINDS = ['ore', 'timber', 'lore', 'ink', 'provisions', 'flux'] as const;
export type SupplyKind = (typeof SUPPLY_KINDS)[number];

/** Crafting-tier materials. Events never drop them; only expeditions do. */
export const TIER_MATERIALS = ['silver', 'mithril', 'rune', 'dragon'] as const;
export type TierMaterial = (typeof TIER_MATERIALS)[number];

export const MATERIAL_KINDS = [...SUPPLY_KINDS, ...TIER_MATERIALS] as const;
export type MaterialKind = (typeof MATERIAL_KINDS)[number];

// ---------------------------------------------------------------------------------------------
// Gear tiers and affixes (game-design.md 7.1; Requirement 16.1)
// ---------------------------------------------------------------------------------------------

export const GEAR_TIERS = ['leather', 'iron', 'silver', 'mithril', 'rune', 'dragon'] as const;
export type GearTier = (typeof GEAR_TIERS)[number];

/**
 * Power per piece and the unlock of each tier. A tier is unlocked at `unlockLevel`, or earlier for the
 * player who has reached the region that gives it (`unlockRenown`: Silverhall for Silver, The Garbage
 * Collector for Dragon).
 */
export const GEAR_TIER_RULES: Readonly<
  Record<GearTier, { power: number; unlockLevel: number; unlockRenown: number | null }>
> = {
  leather: { power: 0.05, unlockLevel: 1, unlockRenown: null },
  iron: { power: 0.1, unlockLevel: 10, unlockRenown: null },
  silver: { power: 0.15, unlockLevel: 30, unlockRenown: 16 },
  mithril: { power: 0.2, unlockLevel: 50, unlockRenown: null },
  rune: { power: 0.3, unlockLevel: 70, unlockRenown: null },
  dragon: { power: 0.4, unlockLevel: 90, unlockRenown: 64 },
};

/** A full set (all five slots the same tier) adds this much Power on top of the pieces. */
export const GEAR_SET_BONUS = 0.25;

/** The five affixes (game-design.md 7.1). */
export const AFFIXES = ['keen', 'stout', 'quick', 'lucky', 'hoarder'] as const;
export type Affix = (typeof AFFIXES)[number];

// ---------------------------------------------------------------------------------------------
// Pets (game-design.md 7.3; Requirement 16.5)
// ---------------------------------------------------------------------------------------------

/** The six pets of v1, each with one small passive. The Linter Cat is the starter. */
export const PET_IDS = [
  'linter-cat',
  'rubber-duck',
  'flaky-wisp',
  'goblin-runt',
  'garbage-collectors-mote',
  'owl',
] as const;
export type PetId = (typeof PET_IDS)[number];

/** Cosmetic pets that only Feats award; they carry no passive. */
export const FEAT_PET_IDS = [
  'many-armed-goblin',
  'polyglot-parrot',
  'hot-potato',
  'pager-gremlin',
  'coin-mote',
] as const;
export type FeatPetId = (typeof FEAT_PET_IDS)[number];

// ---------------------------------------------------------------------------------------------
// Expeditions (game-design.md 6.2; Requirement 15)
// ---------------------------------------------------------------------------------------------

export const EXPEDITION_HOURS = [4, 12, 24, 48] as const;
export type ExpeditionHours = (typeof EXPEDITION_HOURS)[number];

/**
 * Provisions paid and items rolled by duration. Items rise 3 to 6 while the price rises 1 to 6, so the
 * yield per Provision (3, 2, 1.25, 1) strictly falls: a longer trip is worth more in total and less per
 * Provision, which makes checking daily optimal and weekly fine.
 */
export const EXPEDITION_PLANS: Readonly<
  Record<ExpeditionHours, { provisions: number; items: number }>
> = {
  4: { provisions: 1, items: 3 },
  12: { provisions: 2, items: 4 },
  24: { provisions: 4, items: 5 },
  48: { provisions: 6, items: 6 },
};

/** The free 4 h Forage: always available, materials and plain gear only. */
export const FORAGE_PLAN = { hours: 4, provisions: 0, items: 3 } as const;

/** What a loot roll can produce, in rarity order. */
export const LOOT_KINDS = ['material', 'gear', 'charm_pack', 'pet', 'unique'] as const;
export type LootKind = (typeof LOOT_KINDS)[number];

/** Every region's loot weights sum to this (per mille: 1000 is 100%). */
export const LOOT_WEIGHT_TOTAL = 1000;

export const REGION_IDS = [
  'koko-woods',
  'crossroads-of-wix',
  'orrl-falls',
  'silverhall',
  'koko-deep-woods',
  'mazu-deep',
  'quu-spire',
  'garbage-collector',
] as const;
export type RegionId = (typeof REGION_IDS)[number];

export interface RegionMaterialWeight {
  material: MaterialKind;
  weight: number;
  /** Quantity rolled uniformly from `min` to `max` inclusive. */
  min: number;
  max: number;
}

export interface RegionRules {
  /** Renown needed to be sent here (Requirement 15.3). */
  renown: number;
  /** Per mille, summing to `LOOT_WEIGHT_TOTAL`. Materials dominate; pets are rare; uniques very rare. */
  weights: Readonly<Record<LootKind, number>>;
  /** The slot the region's gear leans toward, or `any` for a mixed stock. */
  gearSlot: GearSlot | 'any';
  gearTier: GearTier;
  materials: readonly RegionMaterialWeight[];
  /** Pets the region can give. */
  pets: readonly PetId[];
  /** Catalogue id of the region unique, or `reclaimed` for the named gear of the Garbage Collector. */
  unique: string;
  /** Only the Crossroads can give the coin dated 7960. */
  coin: boolean;
}

export const REGION_RULES: Readonly<Record<RegionId, RegionRules>> = {
  'koko-woods': {
    renown: 0,
    weights: { material: 640, gear: 300, charm_pack: 40, pet: 15, unique: 5 },
    gearSlot: 'body',
    gearTier: 'leather',
    materials: [
      { material: 'timber', weight: 50, min: 3, max: 5 },
      { material: 'provisions', weight: 30, min: 1, max: 2 },
      { material: 'ore', weight: 10, min: 2, max: 3 },
      { material: 'lore', weight: 5, min: 1, max: 2 },
      { material: 'ink', weight: 5, min: 1, max: 2 },
    ],
    pets: ['rubber-duck'],
    unique: 'fernblade',
    coin: false,
  },
  'crossroads-of-wix': {
    renown: 2,
    weights: { material: 560, gear: 300, charm_pack: 100, pet: 30, unique: 10 },
    gearSlot: 'any',
    gearTier: 'leather',
    materials: [
      { material: 'timber', weight: 20, min: 2, max: 4 },
      { material: 'ore', weight: 20, min: 2, max: 4 },
      { material: 'lore', weight: 15, min: 1, max: 2 },
      { material: 'ink', weight: 15, min: 1, max: 2 },
      { material: 'provisions', weight: 20, min: 1, max: 2 },
      { material: 'flux', weight: 10, min: 1, max: 1 },
    ],
    pets: ['rubber-duck', 'flaky-wisp'],
    unique: 'pedlars-button',
    coin: true,
  },
  'orrl-falls': {
    renown: 8,
    weights: { material: 620, gear: 320, charm_pack: 40, pet: 15, unique: 5 },
    gearSlot: 'weapon',
    gearTier: 'iron',
    materials: [
      { material: 'ore', weight: 60, min: 4, max: 6 },
      { material: 'timber', weight: 15, min: 2, max: 3 },
      { material: 'provisions', weight: 15, min: 1, max: 2 },
      { material: 'flux', weight: 10, min: 1, max: 1 },
    ],
    pets: ['flaky-wisp'],
    unique: 'cascade-pick',
    coin: false,
  },
  silverhall: {
    renown: 16,
    weights: { material: 600, gear: 320, charm_pack: 55, pet: 20, unique: 5 },
    gearSlot: 'body',
    gearTier: 'silver',
    materials: [
      { material: 'silver', weight: 45, min: 1, max: 3 },
      { material: 'flux', weight: 25, min: 1, max: 2 },
      { material: 'ore', weight: 20, min: 3, max: 4 },
      { material: 'provisions', weight: 10, min: 1, max: 2 },
    ],
    pets: ['flaky-wisp'],
    unique: 'hallkeepers-mail',
    coin: false,
  },
  'koko-deep-woods': {
    renown: 24,
    weights: { material: 600, gear: 300, charm_pack: 70, pet: 25, unique: 5 },
    gearSlot: 'cape',
    gearTier: 'silver',
    materials: [
      { material: 'lore', weight: 40, min: 2, max: 3 },
      { material: 'ink', weight: 35, min: 2, max: 3 },
      { material: 'provisions', weight: 15, min: 1, max: 2 },
      { material: 'timber', weight: 10, min: 2, max: 4 },
    ],
    pets: ['owl'],
    unique: 'moth-lantern-cloak',
    coin: false,
  },
  'mazu-deep': {
    renown: 32,
    weights: { material: 580, gear: 330, charm_pack: 60, pet: 25, unique: 5 },
    gearSlot: 'trinket',
    gearTier: 'mithril',
    materials: [
      { material: 'mithril', weight: 45, min: 1, max: 2 },
      { material: 'flux', weight: 15, min: 1, max: 2 },
      { material: 'silver', weight: 15, min: 1, max: 2 },
      { material: 'lore', weight: 15, min: 2, max: 3 },
      { material: 'ink', weight: 10, min: 2, max: 3 },
    ],
    pets: ['owl', 'flaky-wisp'],
    unique: 'pressure-pearl',
    coin: false,
  },
  'quu-spire': {
    renown: 48,
    weights: { material: 510, gear: 340, charm_pack: 70, pet: 50, unique: 30 },
    gearSlot: 'weapon',
    gearTier: 'rune',
    materials: [
      { material: 'rune', weight: 45, min: 1, max: 2 },
      { material: 'mithril', weight: 15, min: 1, max: 2 },
      { material: 'flux', weight: 20, min: 1, max: 2 },
      { material: 'lore', weight: 10, min: 2, max: 3 },
      { material: 'ink', weight: 10, min: 2, max: 3 },
    ],
    pets: ['owl'],
    unique: 'plumb-of-quu',
    coin: false,
  },
  'garbage-collector': {
    renown: 64,
    weights: { material: 510, gear: 340, charm_pack: 60, pet: 50, unique: 40 },
    gearSlot: 'any',
    gearTier: 'dragon',
    materials: [
      { material: 'dragon', weight: 40, min: 1, max: 2 },
      { material: 'rune', weight: 20, min: 1, max: 2 },
      { material: 'flux', weight: 20, min: 1, max: 2 },
      { material: 'mithril', weight: 10, min: 1, max: 2 },
      { material: 'ore', weight: 10, min: 3, max: 5 },
    ],
    pets: ['garbage-collectors-mote'],
    unique: 'reclaimed',
    coin: false,
  },
};

export const EXPEDITION_RULES = {
  /** Gear found on an expedition carries an affix this often (percent). */
  foundAffixPercent: 20,
  /** The coin dated 7960: this many in a thousand per item rolled at the Crossroads (0.1%). */
  oldCoinPerMille: 1,
  oldCoinYear: 7960,
  /** Quick pieces and pet passives together never shorten a trip by more than this fraction. */
  reductionCap: 0.5,
  /** Lucky pieces and pet passives together never add more than this many points of Charm-pack odds. */
  packOddsCapPoints: 15,
  /** Flux given in place of a pet the player already owns. */
  duplicatePetFlux: 2,
} as const;

/** Affix numbers (game-design.md 7.1). Keen and Stout are Power; the rest touch supplies or expeditions. */
export const AFFIX_RULES = {
  /** Keen: Power per piece on a review event. */
  keenPower: 0.1,
  /** Stout: Power per piece on a merge event. */
  stoutPower: 0.1,
  /** Quick: each piece shortens an expedition by this fraction. */
  quickReduction: 0.1,
  /** Lucky: each piece adds this many points to the Charm-pack odds of every loot roll. */
  luckyPackPoints: 5,
  /** Hoarder: each piece adds this many of the event's main supply. */
  hoarderSupplies: 1,
} as const;

// ---------------------------------------------------------------------------------------------
// The Forge (game-design.md 7.2; Requirement 16.2 and 16.6)
// ---------------------------------------------------------------------------------------------

export const STATION_IDS = ['forge', 'loom', 'scriptorium'] as const;
export type StationId = (typeof STATION_IDS)[number];

/** The Forge makes Weapons and Bodies, the Loom Capes, the Scriptorium Trinkets and affixes. */
export const STATION_SLOTS: Readonly<Record<StationId, readonly GearSlot[]>> = {
  forge: ['weapon', 'body'],
  loom: ['cape'],
  scriptorium: ['trinket'],
};

/**
 * Hours a recipe takes by station and tier: 2 h Leather to 24 h Dragon at the Forge and the Loom, 4 h to
 * 12 h at the Scriptorium.
 */
export const STATION_HOURS: Readonly<Record<StationId, Readonly<Record<GearTier, number>>>> = {
  forge: { leather: 2, iron: 4, silver: 8, mithril: 12, rune: 18, dragon: 24 },
  loom: { leather: 2, iron: 4, silver: 8, mithril: 12, rune: 18, dragon: 24 },
  scriptorium: { leather: 4, iron: 5, silver: 6, mithril: 8, rune: 10, dragon: 12 },
};

/** What one piece of a tier costs (game-design.md 7.1: Leather is Timber and Provisions, and so on). */
export const RECIPE_INPUTS: Readonly<
  Record<GearTier, Readonly<Partial<Record<MaterialKind, number>>>>
> = {
  leather: { timber: 6, provisions: 2 },
  iron: { ore: 8 },
  silver: { ore: 6, silver: 3 },
  mithril: { mithril: 5 },
  rune: { rune: 5 },
  dragon: { dragon: 6 },
};

/** The Scriptorium rolls an affix onto a piece for Flux; rolling over an existing affix costs more. */
export const AFFIX_ORDER = { hours: 4, flux: 2, rerollFlux: 4 } as const;

export const UPGRADE_IDS = ['bellows', 'dyes', 'index'] as const;
export type UpgradeId = (typeof UPGRADE_IDS)[number];

/** Station upgrades, each bought once: Bellows (Flux x3), Dyes (Ink x10), Index (Lore x50). */
export const STATION_UPGRADES: Readonly<
  Record<UpgradeId, { station: StationId; cost: Readonly<Partial<Record<MaterialKind, number>>> }>
> = {
  bellows: { station: 'forge', cost: { flux: 3 } },
  dyes: { station: 'loom', cost: { ink: 10 } },
  index: { station: 'scriptorium', cost: { lore: 50 } },
};

/** Bellows: every Forge order takes this fraction of its time (25% less). */
export const BELLOWS_TIME_FACTOR = 0.75;

/** Cape colours the Dyes unlock (cosmetic). */
export const CAPE_COLORS = ['crimson', 'azure', 'verdant', 'amber', 'violet', 'ash'] as const;
export type CapeColor = (typeof CAPE_COLORS)[number];

// ---------------------------------------------------------------------------------------------
// Feats (game-design.md 8; Requirement 17)
// ---------------------------------------------------------------------------------------------

export const FEAT_RULES = {
  /** A designated Feat adds this much Power ... */
  bonusPerFeat: 0.1,
  /** ... and the total never exceeds this (never a bonus for excess). */
  bonusCap: 0.5,
  /** Most Feats a player can pin to the character sheet and the badge. */
  maxPinned: 3,
  /** Per-day buckets older than this many days are dropped from the rolling window. */
  windowDays: 30,
  /** Repositories tracked per player; the counters stay a bounded size. */
  maxTrackedRepos: 200,

  // Scale: only merged PRs another human approved count.
  thousandHandFiles: 1000,
  archivistReviews: 100,
  archivistMinLoc: 500,
  archivistMinInline: 3,
  deleterNetLines: 100_000,
  hundredMergesWeek: 100,
  massReviewerPrs: 100,
  omnilinguistRepos: 12,
  firstLightQuietDays: 365,

  // Craft
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
  marginaliaComments: 500,
  unblockerApprovals: 25,
  unblockerDays: 7,
  tidyHandsMerges: 12,
  tidyHandsMaxLoc: 150,

  // Endurance and rhythm
  yearOfTheGoblinWeeks: 52,
  ironWeekStreak: 10,
  perennialWeeks: 10,
  evergreenWeeks: 26,
  halfwayLevel: 50,
  ninetyNineLevel: 99,

  // World and discovery
  goblinSlayerKills: 1000,
  hydraBaneKills: 100,
  impWhispererKills: 100,
  mogulHunterMoguls: 6,
  spelunkerExpeditions: 100,
  collectorPets: 6,
  cartographerRegions: 8,
  renownedRenown: 8,

  // Hidden humour (cosmetic only, never a Feat bonus)
  longHaulDays: 180,
  fridayDeploys: 10,
  fridayAfterHour: 16,
  rubberStamps: 20,
  rubberStampSeconds: 60,
  soloMerges: 50,
  nightEvents: 100,
  /** Night Owl counts local hours from this one through midnight and up to (not including) `nightEnd`. */
  nightStart: 22,
  nightEnd: 6,
  dawnEvents: 100,
  dawnStart: 5,
  dawnEnd: 7,
} as const;
