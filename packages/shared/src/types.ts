import type { ActId, Rarity } from './constants';

// ---------------------------------------------------------------------------------------------
// Skills and supplies
// ---------------------------------------------------------------------------------------------

export type Skill = 'smithing' | 'vigilance' | 'oratory' | 'endurance';

/** XP per skill, all four keys always present. */
export type SkillXp = Record<Skill, number>;

export type ReviewState = 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED';

export interface Supplies {
  ore: number;
  timber: number;
  lore: number;
  ink: number;
  provisions: number;
  flux: number;
}

// ---------------------------------------------------------------------------------------------
// Content records (filled in by later tasks; shapes fixed here)
// ---------------------------------------------------------------------------------------------

export type MogulId =
  'rocket-man' | 'leather-jacket' | 'turtleneck' | 'hoodie' | 'founder' | 'two-pizza-boss';

/** Bestiary ids; the Moguls are the Act III bosses. */
export type MonsterId =
  | 'merge-goblin'
  | 'nitpick-imp'
  | 'flaky-test-wraith'
  | 'legacy-golem'
  | 'rebase-hydra'
  | 'scope-creep'
  | 'release-dragon'
  | 'silent-monolith'
  | MogulId;

export interface Mogul {
  id: MogulId;
  name: string;
}

/**
 * A held Charm. `power` is its unconditional Power contribution per copy (`basePower` in charms.ts, plus
 * any bonus it has earned, such as the Founder's +0.25); event-conditional Power comes from the Charm's
 * definition, looked up by `id`. A Charm whose id is not a known definition simply contributes `power`.
 */
export interface Charm {
  id: string;
  name: string;
  rarity: Rarity;
  power: number;
  /** Copies stacked in this slot: 1 (the default when absent) or 2 (`MAX_CHARM_COPIES`). */
  copies?: number;
}

export interface Pledge {
  id: string;
  name: string;
  /** True for the upgraded form (Strike+). */
  upgraded: boolean;
}

export type VoucherId =
  'charm-belt' | 'cheaper-rerolls' | 'scouts-eye' | 'deep-pockets' | 'shrine-pass' | 'overclock';

export interface Voucher {
  id: VoucherId;
  name: string;
}

export type PackKind = 'pledge' | 'charm' | 'mogul';

export interface ShopSlot<T> {
  item: T;
  /** Gold price. */
  price: number;
  sold: boolean;
}

/** The shop as stored on the week item: stock is generated once from the week's seed. */
export interface ShopStock {
  charms: ShopSlot<Charm>[];
  packs: ShopSlot<PackKind>[];
  voucher: ShopSlot<Voucher> | null;
  /** Re-rolls bought during this visit. */
  rerolls: number;
}

/** One weekly run (the `WEEK#` item). */
export interface RunState {
  /** ISO week key, `yyyy-ww`, weeks start Monday 00:00 UTC. */
  weekKey: string;
  /** The act currently being played, or null once the Boss act has cleared. */
  act: ActId | null;
  clearedActs: ActId[];
  weeklyXp: number;
  targets: Record<ActId, number>;
  mogul: MogulId;
  hand: Pledge[];
  played: Pledge[];
  shopSeed: number;
  shop: ShopStock | null;
}

// ---------------------------------------------------------------------------------------------
// Power hooks on PlayerState (all empty for now; Charms, gear, Pledges, Feats, Moguls fill them)
// ---------------------------------------------------------------------------------------------

export type GearSlot = 'weapon' | 'body' | 'cape' | 'trinket' | 'pet';

export interface GearPiece {
  id: string;
  slot: GearSlot;
  /** Power of this equipped piece. */
  power: number;
}

export interface GearLoadout {
  pieces: readonly GearPiece[];
  /** Full-set bonus currently earned (0 or 0.25). */
  setBonus: number;
}

export interface PledgeLoadout {
  /** Pledges played this week: the contracts in force. */
  played: readonly Pledge[];
  /** Progress toward each played Pledge's goal, keyed by Pledge id. */
  progress: Readonly<Record<string, number>>;
  /** Ids of played Pledges whose one-time completion bonus has already fired this week. */
  completed: readonly string[];
}

export interface FeatLoadout {
  unlocked: readonly string[];
  /** Feat Power bonus, already capped at +0.5. */
  powerBonus: number;
}

/** A Charm the Founder's Board has removed; it returns on Friday with +0.25 Power. */
export interface BenchedCharm {
  charm: Charm;
  /** The week the Board took it. */
  weekKey: string;
}

export interface MogulHook {
  /** This week's Mogul, or null when no run is active. */
  current: MogulId | null;
  /**
   * Shuffled bag of the Moguls still to come in this cycle, in draw order, so `bag[0]` is next week's
   * Mogul. After a draw the bag is never empty: it is refilled when the last Mogul of a cycle is drawn.
   */
  bag: readonly MogulId[];
  /** The Leather Jacket chain: successive reviewed merges since the last solo merge this week. */
  chain: number;
  /** The Charm the Founder's Board holds, if any. It keeps its slot while away. */
  benched: BenchedCharm | null;
  /** The week the Board last acted, so it acts once a week. */
  boardWeek: string | null;
}

/** Week-scoped state of the Charms. Reset each Monday by `startRun`. */
export interface WeekHook {
  /** Loaded Dice has been spent this week. */
  loadedDiceUsed: boolean;
}

// ---------------------------------------------------------------------------------------------
// Counters (plain data so the backend can persist them)
// ---------------------------------------------------------------------------------------------

export interface PlayerCounters {
  /** Opens that earned points on UTC day `day` (`YYYY-MM-DD`); stale when `day` is not today. */
  opens: { day: string; count: number };
  /** UTC day of the last daily first-event bonus; null if never granted. */
  dailyFirstDay: string | null;
  /** Consecutive qualifying weeks so far. */
  streakWeeks: number;
}

/** What one reviewer has done on one PR so far. */
export interface ReviewerCounters {
  /** Scoring reviews (APPROVED or CHANGES_REQUESTED), cap 2. */
  decisions: number;
  /** COMMENTED reviews, cap 1. */
  comments: number;
  /** Inline comments, cap 10. */
  inline: number;
}

/** A review kept on the PR (Requirement 3.2: reviewer and state). Human reviewers only. */
export interface ReviewRecord {
  reviewerId: number;
  state: ReviewState;
  /** ISO instant the review was submitted; the Hoodie reads the first one. Absent when unknown. */
  submittedAt?: string | null;
}

export interface PlayerState {
  /** Numeric GitHub user id. */
  id: number;
  /** Cumulative character XP. Level is `levelFor(xp)`. */
  xp: number;
  skillXp: SkillXp;
  /** Zone exponent: 1.6, or 1.65 once Overclock is owned. */
  zoneExponent: number;
  counters: PlayerCounters;
  charms: readonly Charm[];
  gear: GearLoadout;
  pledges: PledgeLoadout;
  feats: FeatLoadout;
  moguls: MogulHook;
  week: WeekHook;
  /** Vouchers bought; each once. */
  vouchers: readonly VoucherId[];
  /** The Pledge deck (cap 20). */
  deck: readonly Pledge[];
  /** Lifetime scored merges per repository, keyed by the repo id as a string (Grey Beard, Mentor). */
  repoMerges: Readonly<Record<string, number>>;
}

/** The scorer's view of a PR. Metadata persisted per Requirement 3.1 is handled by the backend. */
export interface PRState {
  repoId: number;
  number: number;
  authorId: number;
  /** Lines added and deleted as last seen; 0 when unknown. */
  additions: number;
  deletions: number;
  /** Review rounds so far: CHANGES_REQUESTED reviews received. */
  reviewRoundCount: number;
  /** `synchronize` pushes seen (counted, never scored). */
  syncCount: number;
  /** Reviews received, in arrival order, human reviewers only. */
  reviews: readonly ReviewRecord[];
  /** Per-reviewer caps, keyed by the reviewer's numeric id as a string. */
  reviewerCounters: Readonly<Record<string, ReviewerCounters>>;
  /**
   * Merges the PR's author has made, as best the caller knows (their profile counter, or the merged PRs
   * seen for them). The Mentor Pledge compares it to the reviewer's own merges; absent counts as 0.
   */
  authorMerges?: number;
}

// ---------------------------------------------------------------------------------------------
// GameEvent: the normalised, allow-listed form of a webhook (nothing else survives normalisation)
// ---------------------------------------------------------------------------------------------

export interface EventActor {
  /** Numeric GitHub user id. */
  id: number;
  /** Requirement 2.7: type is Bot or the login ends with `[bot]`. The login itself is dropped. */
  isBot: boolean;
}

export interface PullRequestStats {
  additions: number;
  deletions: number;
  changedFiles: number;
  commits: number;
}

/** The allow-listed pull request fields (research.md section 5). */
export interface PullRequestFacts {
  installationId: number | null;
  repoId: number;
  repoPrivate: boolean;
  number: number;
  author: EventActor;
  draft: boolean;
  baseRefIsDefault: boolean;
  /** Absent on review and review-comment payloads. */
  stats: PullRequestStats | null;
  openedAt: string | null;
  mergedAt: string | null;
  closedAt: string | null;
  merged: boolean;
  mergedBy: EventActor | null;
}

export interface PROpenedEvent {
  kind: 'pr_opened';
  /** The PR author. */
  actor: EventActor;
  /** `opened`, or `ready_for_review` for a draft that left draft. */
  trigger: 'opened' | 'ready_for_review';
  pr: PullRequestFacts;
}

export interface PRMergedEvent {
  kind: 'pr_merged';
  /** The author, or the human merger when the author is a bot. */
  actor: EventActor;
  pr: PullRequestFacts;
}

export interface PRClosedEvent {
  kind: 'pr_closed';
  actor: EventActor;
  pr: PullRequestFacts;
}

export interface PRSynchronizedEvent {
  kind: 'pr_synchronized';
  actor: EventActor;
  pr: PullRequestFacts;
}

export interface ReviewSubmittedEvent {
  kind: 'review_submitted';
  /** The reviewer. */
  actor: EventActor;
  state: ReviewState;
  submittedAt: string | null;
  pr: PullRequestFacts;
}

export interface ReviewCommentCreatedEvent {
  kind: 'review_comment_created';
  /** The comment author. */
  actor: EventActor;
  pr: PullRequestFacts;
}

/** Built from a merge and the stored reviews (see `verifiedKillEvents`), one per approver. */
export interface VerifiedKillEvent {
  kind: 'verified_kill';
  /** The approver. */
  actor: EventActor;
  pr: PullRequestFacts;
}

/**
 * Built from a merge and the stored reviews (see `riposteCreditEvents`), one per human who requested
 * changes on the PR. It scores only for a player holding Jester's Rebase: the Riposte is granted when the
 * PR they challenged merges, never at review time (game-design.md 8.3).
 */
export interface RiposteCreditEvent {
  kind: 'riposte_credit';
  /** The reviewer who requested changes. */
  actor: EventActor;
  pr: PullRequestFacts;
}

/** Built by the weekly rollover for each player when a run closes. */
export interface WeeklyStreakEvent {
  kind: 'weekly_streak';
  actor: EventActor;
  /** At least one merged PR or three reviews that week. */
  qualified: boolean;
}

export interface InstallationEvent {
  kind: 'installation';
  action: 'created' | 'deleted' | 'suspend' | 'unsuspend';
  installationId: number;
  accountId: number;
  /** Repository ids listed in the payload (created and deleted). */
  repositoryIds: number[];
  /** Who triggered it. */
  sender: EventActor;
}

export interface InstallationRepositoriesEvent {
  kind: 'installation_repositories';
  installationId: number;
  accountId: number;
  added: number[];
  removed: number[];
  sender: EventActor;
}

export type PullRequestEvent =
  | PROpenedEvent
  | PRMergedEvent
  | PRClosedEvent
  | PRSynchronizedEvent
  | ReviewSubmittedEvent
  | ReviewCommentCreatedEvent
  | VerifiedKillEvent
  | RiposteCreditEvent;

export type GameEvent =
  PullRequestEvent | WeeklyStreakEvent | InstallationEvent | InstallationRepositoriesEvent;

// ---------------------------------------------------------------------------------------------
// ScoreResult
// ---------------------------------------------------------------------------------------------

/**
 * One line of the Combat Log expansion.
 * - `points`: additive terms; their sum is `ScoreResult.points`.
 * - `power`: additive terms (the base 1 first); their sum is `ScoreResult.power`.
 * - `zone`: exactly one line, the Zone multiplier, with the level in the label.
 * - `xp`: the first line is the total XP, followed by one line per skill credited.
 */
export interface BreakdownLine {
  label: string;
  value: number;
  kind: 'points' | 'power' | 'zone' | 'xp';
}

/** Why an event produced no points. */
export type SkipReason =
  /** Not a scoring event (closed, synchronize, installation) or an unmerged "merge". */
  | 'not_scoring'
  /** Actor is a bot (Requirement 2.7). */
  | 'bot'
  /** A reviewer or commenter on their own PR. */
  | 'own_pr'
  /** Draft PR opened; it earns on `ready_for_review`. */
  | 'draft'
  /** A per-day or per-PR cap was already reached. */
  | 'cap';

/** New absolute values of the counters this event changed; the caller persists them. */
export interface CounterUpdates {
  player: Partial<PlayerCounters>;
  pr: {
    syncCount?: number;
    reviewRoundCount?: number;
    /** Append to `PRState.reviews`. */
    review?: ReviewRecord;
    /** Replace the actor's entry in `PRState.reviewerCounters`. */
    reviewerCounters?: { reviewerId: number; counters: ReviewerCounters };
  };
  /** The new `PlayerState.pledges` (progress and completions), when this event changed it. */
  pledges?: PledgeLoadout;
  /** The new Leather Jacket chain (`PlayerState.moguls.chain`), when this event changed it. */
  mogulChain?: number;
  /** Loaded Dice fired on this event: set `PlayerState.week.loadedDiceUsed`. */
  loadedDiceUsed?: true;
  /** The new lifetime scored merge count of one repository (`PlayerState.repoMerges`). */
  repoMerges?: { repoId: number; count: number };
}

export interface ScoreResult {
  /** Null when the event scored. Counter updates still apply when set. */
  skip: SkipReason | null;
  /** Sum of the `points` breakdown lines. */
  points: number;
  power: number;
  /** Multiplier on the gold earned from this event's points: 4 under the Founder, otherwise 1. */
  goldMultiplier: number;
  zone: number;
  /** Character level used for Zone. */
  level: number;
  /** `floor(points * power * zone)`, credited to character XP and split across skills. */
  xp: number;
  /** The skill that earned the event's own points; null when nothing scored. */
  skill: Skill | null;
  /** XP per skill; values sum to `xp`. The daily first-event bonus goes to Endurance. */
  skillXp: SkillXp;
  supplies: Supplies;
  /** Bestiary id for the Combat Log row; null for events that do not score. */
  monster: MonsterId | null;
  breakdown: BreakdownLine[];
  counterUpdates: CounterUpdates;
}

// ---------------------------------------------------------------------------------------------
// Results of pure state transitions (shop, deck, Pledges, gold): a typed error instead of a throw
// ---------------------------------------------------------------------------------------------

/** Success carries the new state; failure carries a machine-readable reason and changes nothing. */
export type Result<T extends object, E extends string> =
  (T & { ok: true }) | { ok: false; error: E };

// ---------------------------------------------------------------------------------------------
// Event context for Power and point modifiers
// ---------------------------------------------------------------------------------------------

/** What a Power calculation needs to know about the event being scored. */
export interface PowerContext {
  event: GameEvent;
  /** The PR's state before the event. */
  pr: PRState;
  /** Epoch milliseconds. */
  now: number;
}

/**
 * A multiplier on the points terms of one event, from a Mogul or a Pledge. It becomes a suffix on each
 * affected term's breakdown label, so the Combat Log shows where a number came from.
 */
export interface PointsFactor {
  label: string;
  factor: number;
  /** `all` multiplies every event term; `party` only the party-bonus term. */
  target: 'all' | 'party';
}

/** A flat points bonus (a completed Pledge) added after the multipliers. */
export interface PointsBonus {
  label: string;
  points: number;
}
