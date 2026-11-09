/**
 * Response shapes the client expects from the api service (design.md section 9.1: the `PROFILE` and
 * `EVT#` rows, the `WEEK#` row, `INSTALL#` rows). They are deliberately minimal and named for what
 * they are, so the backend's real handlers can be reconciled against this one file. The binding
 * description is docs/api-contract.md; where this file and that one differ, that one wins.
 *
 * Reuse of `@mergescape/shared`: skill XP, Charms, Pledges, supplies, breakdown lines and the
 * Bestiary ids come from the shared package, so a rename there is a compile error here.
 */
import type {
  ActId,
  Charm,
  MogulId,
  MonsterId,
  Pledge,
  ReviewState,
  ScoreResult,
  SkillXp,
  VoucherId,
} from '@mergescape/shared';

export type Vocation = 'Journeyman' | 'Smith' | 'Warden' | 'Herald' | 'Pilgrim';

/** What a pack holds once it is bought: three of these, and the player keeps one. */
export type ShopOption =
  | { kind: 'charm'; charm: Charm }
  | { kind: 'pledge'; pledge: Pledge }
  | { kind: 'cosmetic'; id: string; name: string };

/** The kinds of pack on the shelf. (`shared` calls the cosmetic pack `mogul`; the api says `cosmetic`.) */
export type PackKind = 'pledge' | 'charm' | 'cosmetic';

/** The open shop: one visit, from an act clear until the next act clears (Requirement 8.8). */
export interface ShopView {
  /** 1-based shop visit within the week. */
  visit: number;
  /** Two Charms; `index` is what `POST /shop/buy` takes. */
  charms: { index: number; charm: Charm; price: number; sold: boolean }[];
  /** Two packs. `options` is present once a pack is bought, until one option is picked. */
  packs: {
    index: number;
    kind: PackKind;
    price: number;
    bought: boolean;
    picked: boolean;
    options: ShopOption[] | null;
  }[];
  voucher: { id: VoucherId; price: number; sold: boolean } | null;
  rerollCost: number;
  shrineCost: number;
  /** Charm id to the gold paid when it is sold. */
  sellPrices: Record<string, number>;
  /** Gold the next act clear would pay as interest. */
  interestPreview: number;
}

/** How far one played Pledge has got; `WeekSummary.pledgeProgress` is keyed by Pledge id. */
export interface PledgeProgress {
  progress: number;
  target: number;
  completed: boolean;
}

/** `GET /week`: the `WEEK#` row as the client draws it. */
export interface WeekSummary {
  /** ISO week key (`2026-46`; the contract's example spells it `2026-W46`, and both are read). */
  weekKey: string;
  /** The act being played, or null once the Boss act has cleared. */
  act: ActId | null;
  clearedActs: ActId[];
  /** XP earned so far this run. */
  weeklyXp: number;
  /** XP targets per act. */
  targets: Record<ActId, number>;
  /** This week's Boss, always revealed. */
  mogul: MogulId;
  /** Next week's Boss; set only when the Oracle Charm or Scout's Eye allows it. */
  nextMogul: MogulId | null;
  /** Pledges drawn on Monday, and the ones played (up to 3). */
  hand: Pledge[];
  played: Pledge[];
  /** True until Tuesday 23:59 UTC. */
  pledgeWindowOpen: boolean;
  /** Keyed by Pledge id; an entry exists for each played Pledge. */
  pledgeProgress: Record<string, PledgeProgress>;
  /** The open shop, or null when none is open. */
  shop: ShopView | null;
  /** A free Pledge pack granted after Raid; taken with `POST /shop/pick` and index -1. */
  freePack: 'pledge' | null;
  /** The 3 options of the free Raid pack, present whenever `freePack` is set. */
  freePackOptions: ShopOption[] | null;
  /** A Legendary Charm offered on every 4th Renown; taken with `POST /shop/buy` kind `legendary`. */
  legendaryOffer: Charm | null;
}

/** `GET /me`: the `USER#<id>` / `PROFILE` row. */
export interface MeResponse {
  /** Numeric GitHub user id. */
  githubId: number;
  login: string;
  /** ISO timestamp the character was created. */
  createdAt: string;
  /** Cumulative character XP. The client derives the level with `levelFor`. */
  xp: number;
  skillXp: SkillXp;
  gold: number;
  /** Lifetime Moguls beaten. */
  renown: number;
  vocation: Vocation;
  /** Charms held; at most `charmSlots`. */
  charms: Charm[];
  /** 5, or 6 with the Charm Belt voucher. */
  charmSlots: number;
  /** Vouchers bought; each once. */
  vouchers: VoucherId[];
  /** The Pledge deck (cap 20). */
  deck: Pledge[];
  /** The biome Town shows, from Renown. */
  biome: string;
  /** Lifetime kills per Bestiary id. A monster never killed is absent. */
  kills: Partial<Record<MonsterId, number>>;
  /** ISO timestamp of the first kill per Bestiary id. */
  firstSeen: Partial<Record<MonsterId, string>>;
  /** The current run; null before the first rollover. */
  week: WeekSummary | null;
}

/** Every mutation answers with the whole new profile and run, so the client never re-fetches. */
export interface MutationResponse {
  me: MeResponse;
  week: WeekSummary;
}

/** The kinds of event that produce a Combat Log row (the scoring subset of `GameEvent['kind']`). */
export type LogEventKind =
  | 'pr_opened'
  | 'pr_merged'
  | 'review_submitted'
  | 'review_comment_created'
  | 'verified_kill'
  | 'riposte_credit'
  | 'weekly_streak';

/** What the scorer returned for the event, stored with the row so the log never re-computes. */
export type LogScore = Pick<
  ScoreResult,
  'points' | 'power' | 'zone' | 'level' | 'xp' | 'skill' | 'skillXp' | 'supplies' | 'breakdown'
>;

/**
 * One Combat Log row: the `USER#<id>` / `EVT#<iso_ts>#<delivery_id>` item. No titles, bodies or
 * comment text exist anywhere (Requirement 3.3); a repository name appears only when the api can
 * supply one for this viewer.
 */
export interface LogEntry extends LogScore {
  /** The sort key without its `EVT#` prefix: `<iso_ts>#<delivery_id>`. Unique and time-ordered. */
  id: string;
  /** ISO timestamp of the event. */
  at: string;
  kind: LogEventKind;
  /** Present for `review_submitted`. */
  reviewState?: ReviewState;
  /** Absent for `weekly_streak`. */
  prNumber?: number;
  repoId?: number;
  repoPrivate?: boolean;
  /** `owner/name`. Present only when the viewer may see it; never persisted for private repos. */
  repoName?: string;
  /** Lines added and deleted, for merge rows. */
  additions?: number;
  deletions?: number;
  /** Inline comments the reviewer left on the PR, for review rows. */
  inlineComments?: number;
  /** Bestiary id; null for rows with no monster (the weekly streak). */
  monster: MonsterId | null;
}

/** `GET /log?cursor=`: newest first. `nextCursor` is opaque; null on the last page. */
export interface LogResponse {
  entries: LogEntry[];
  nextCursor: string | null;
}

/** One row of `GET /installations`: an `INSTALL#<id>` item. */
export interface InstallationSummary {
  installationId: number;
  /** GitHub account (user or org) the App is installed on. */
  accountId: number;
  repoCount: number;
  suspended: boolean;
}

export interface InstallationsResponse {
  installations: InstallationSummary[];
}
