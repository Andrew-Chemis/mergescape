/**
 * Response shapes the client expects from the api service (design.md section 9.1: the `PROFILE` and
 * `EVT#` rows, the `WEEK#` row, `INSTALL#` rows). They are deliberately minimal and named for what
 * they are, so the backend's real handlers can be reconciled against this one file.
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
} from '@mergescape/shared';

export type Vocation = 'Journeyman' | 'Smith' | 'Warden' | 'Herald' | 'Pilgrim';

/** The `WEEK#` row, trimmed to what Town draws. Optional until the run layer ships (task 15). */
export interface WeekSummary {
  /** ISO week key, `yyyy-ww`. */
  weekKey: string;
  /** The act being played, or null once the Boss act has cleared. */
  act: ActId | null;
  clearedActs: ActId[];
  /** XP earned so far this run. */
  weeklyXp: number;
  /** XP targets per act. */
  targets: Record<ActId, number>;
  /** This week's Mogul, from Monday. */
  mogul: MogulId | null;
  /** Pledges drawn on Monday, and the ones played (up to 3). */
  hand: Pledge[];
  played: Pledge[];
  /** True from an act clear until the next act clears or the run ends. */
  shopOpen: boolean;
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
  renown: number;
  vocation: Vocation;
  /** Charms held; at most `charmSlots`. */
  charms: Charm[];
  /** 5, or 6 with the Charm Belt voucher. */
  charmSlots: number;
  /** The current run; null or absent before the first rollover. */
  week?: WeekSummary | null;
}

/** The kinds of event that produce a Combat Log row (the scoring subset of `GameEvent['kind']`). */
export type LogEventKind =
  | 'pr_opened'
  | 'pr_merged'
  | 'review_submitted'
  | 'review_comment_created'
  | 'verified_kill'
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
