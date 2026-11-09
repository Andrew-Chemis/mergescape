/**
 * The JSON the api service returns. These mirror `packages/client/src/lib/types.ts` (the client wrote the
 * contract in task 9): a rename on either side should be made on both. They use `@mergescape/shared` types
 * for everything the two packages already share.
 */
import type {
  ActId,
  BreakdownLine,
  Charm,
  MogulId,
  MonsterId,
  Pledge,
  ReviewState,
  Skill,
  SkillXp,
  Supplies,
} from '@mergescape/shared';

export type Vocation = 'Journeyman' | 'Smith' | 'Warden' | 'Herald' | 'Pilgrim';

export interface WeekSummary {
  weekKey: string;
  act: ActId | null;
  clearedActs: ActId[];
  weeklyXp: number;
  targets: Record<ActId, number>;
  mogul: MogulId | null;
  hand: Pledge[];
  played: Pledge[];
  shopOpen: boolean;
}

/** `GET /me` */
export interface MeResponse {
  githubId: number;
  login: string;
  createdAt: string;
  xp: number;
  skillXp: SkillXp;
  gold: number;
  renown: number;
  vocation: Vocation;
  charms: Charm[];
  charmSlots: number;
  week?: WeekSummary | null;
}

export type LogEventKind =
  | 'pr_opened'
  | 'pr_merged'
  | 'review_submitted'
  | 'review_comment_created'
  | 'verified_kill'
  | 'weekly_streak';

/** One Combat Log row. */
export interface LogEntry {
  /** The sort key without its `EVT#` prefix: `<iso_ts>#<delivery_id>`. */
  id: string;
  at: string;
  kind: LogEventKind;
  reviewState?: ReviewState;
  prNumber?: number;
  repoId?: number;
  repoPrivate?: boolean;
  additions?: number;
  deletions?: number;
  inlineComments?: number;
  monster: MonsterId | null;
  points: number;
  power: number;
  zone: number;
  level: number;
  xp: number;
  skill: Skill | null;
  skillXp: SkillXp;
  supplies: Supplies;
  breakdown: BreakdownLine[];
}

/** `GET /log?cursor=` */
export interface LogResponse {
  entries: LogEntry[];
  nextCursor: string | null;
}

export interface InstallationSummary {
  installationId: number;
  accountId: number;
  repoCount: number;
  suspended: boolean;
}

/** `GET /installations` */
export interface InstallationsResponse {
  installations: InstallationSummary[];
}
