/**
 * DynamoDB repository (tasks.md 6): typed accessors for every item type in design.md section 9.1.
 *
 * All writes go through `Db#put` / `Db#update`, which run the schema guard (`schema.ts`) first, so an
 * attribute outside the per-item-type allow-list throws before anything is sent. Reads never mutate.
 * Updates that add XP, skill XP, gold or counters use `ADD`, which DynamoDB applies atomically.
 *
 * IAM note (Requirement 12.2): the `ingest` role has only PutItem, GetItem, UpdateItem and Query. Every
 * accessor the ingest handler uses therefore avoids DeleteItem and BatchWriteItem. Removing an
 * installation is a TTL tombstone for that reason, and a failed delivery is "released" with an update.
 */
import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { emptySkillXp, SKILLS } from '@mergescape/shared';
import type {
  BreakdownLine,
  MonsterId,
  PlayerCounters,
  PullRequestFacts,
  ReviewState,
  RunState,
  Skill,
  SkillXp,
  Supplies,
} from '@mergescape/shared';
import {
  EVENT_SK_PREFIX,
  deliveryKey,
  eventKey,
  inlineKey,
  installKey,
  prMetaKey,
  prPk,
  profileKey,
  reviewKey,
  stateKey,
  userPk,
  weekKeyOf,
} from './keys';
import type { Key } from './keys';
import { assertAttributesAllowed, assertItemAllowed } from './schema';
import type { ItemKind } from './schema';

/** The part of `DynamoDBDocumentClient` the repository uses (tests pass the in-memory fake). */
export type DocClient = Pick<DynamoDBDocumentClient, 'send'>;

type Attrs = Record<string, unknown>;

// ---------------------------------------------------------------------------------------------
// Constants (infrastructure, not game rules)
// ---------------------------------------------------------------------------------------------

/** Requirement 1.6: dedupe records expire after 7 days. */
export const DELIVERY_TTL_SECONDS = 7 * 24 * 60 * 60;
/** Requirement 2.1: the OAuth state nonce expires after 10 minutes. */
export const OAUTH_STATE_TTL_SECONDS = 10 * 60;
/** research.md section 6: scored event rows (the Combat Log) expire after 90 days. */
export const EVENT_TTL_SECONDS = 90 * 24 * 60 * 60;

const seconds = (ms: number): number => Math.floor(ms / 1000);

// ---------------------------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------------------------

export function isConditionalCheckFailed(error: unknown): boolean {
  return error instanceof Error && error.name === 'ConditionalCheckFailedException';
}

/** The profile changed between the read that fed the scorer and the write (optimistic lock). */
export class VersionConflictError extends Error {
  constructor() {
    super('Profile version conflict');
    this.name = 'VersionConflictError';
  }
}

// ---------------------------------------------------------------------------------------------
// Domain shapes
// ---------------------------------------------------------------------------------------------

export interface ProfileItem {
  id: number;
  login: string;
  created: string;
  /** Installation ids the player can see (from `GET /user/installations`). */
  installations: number[];
  xp: number;
  /** Cache of `levelFor(xp)`; the XP is authoritative. */
  level: number;
  skillXp: SkillXp;
  gold: number;
  opensDay: string | null;
  opensCount: number;
  dailyFirstDay: string | null;
  streakWeeks: number;
  /** Optimistic-lock counter, bumped by every score write. */
  version: number;
}

/** What one scored event changes on a profile. */
export interface ScoreWrite {
  xp: number;
  skillXp: SkillXp;
  gold: number;
  /** `levelFor(xp after this event)`. */
  level: number;
  counters: Partial<PlayerCounters>;
}

/** One Combat Log row (`EVT#`). */
export interface EventRow {
  userId: number;
  /** ISO instant the event was scored. */
  ts: string;
  deliveryId: string;
  /** The `GameEvent` kind that scored: pr_opened, pr_merged, review_submitted, and so on. */
  kind: string;
  repoId: number;
  repoPrivate: boolean;
  prNumber: number;
  points: number;
  power: number;
  zone: number;
  level: number;
  xp: number;
  skill: Skill;
  /** XP credited to each skill by this event. */
  skillXp: SkillXp;
  /** Supplies dropped by this event (banked by a later task; kept so the log never re-computes). */
  supplies: Supplies;
  monster: MonsterId | null;
  breakdown: BreakdownLine[];
  /** Present on review rows. */
  reviewState?: ReviewState;
  /** Lines added and deleted, when the payload carried them. */
  additions?: number;
  deletions?: number;
  /** Inline comments the acting reviewer has left on the PR, on review and comment rows. */
  inlineComments?: number;
}

/** An `EventRow` as read back: `id` is the sort key without its `EVT#` prefix. */
export interface StoredEventRow extends EventRow {
  id: string;
}

/** The persisted PR facts of Requirement 3.1. */
export interface PRMetaItem {
  installationId: number | null;
  repoId: number;
  repoPrivate: boolean;
  number: number;
  authorId: number;
  openedAt: string | null;
  mergedAt: string | null;
  closedAt: string | null;
  merged: boolean;
  mergedById: number | null;
  additions: number | null;
  deletions: number | null;
  changedFiles: number | null;
  commits: number | null;
  reviewRoundCount: number;
  syncCount: number;
  draft: boolean;
  baseRefIsDefault: boolean;
}

/** A human review kept on the PR (Requirement 3.2). */
export interface ReviewItem {
  reviewerId: number;
  reviewerIsBot: boolean;
  state: ReviewState;
  submittedAt: string;
}

/** One scored inline comment kept on the PR; the sum per reviewer feeds the cap. */
export interface InlineItem {
  reviewerId: number;
  count: number;
}

/** Everything stored under one `PR#<repo>#<number>` partition. */
export interface PRBundle {
  meta: PRMetaItem | null;
  /** Reviews in arrival (sort-key) order. */
  reviews: ReviewItem[];
  inline: InlineItem[];
}

export interface InstallationItem {
  id: number;
  accountId: number;
  repoIds: number[];
  suspended: boolean;
  /** Tombstoned by `installation.deleted` and waiting for the TTL sweep to remove it. */
  deleted: boolean;
}

// ---------------------------------------------------------------------------------------------
// Attribute helpers
// ---------------------------------------------------------------------------------------------

function num(item: Attrs, name: string, fallback: number): number {
  const value = item[name];
  return typeof value === 'number' ? value : fallback;
}

function numOrNull(item: Attrs, name: string): number | null {
  const value = item[name];
  return typeof value === 'number' ? value : null;
}

function str(item: Attrs, name: string): string | null {
  const value = item[name];
  return typeof value === 'string' ? value : null;
}

function bool(item: Attrs, name: string, fallback: boolean): boolean {
  const value = item[name];
  return typeof value === 'boolean' ? value : fallback;
}

function numberList(value: unknown): number[] {
  const entries = value instanceof Set ? [...(value as Set<unknown>)] : [];
  return entries
    .filter((entry): entry is number => typeof entry === 'number')
    .sort((a, b) => a - b);
}

const ISO_LIKE = /^\d{4}-\d{2}-\d{2}T[\d:.]{8,12}(?:Z|[+-]\d{2}:\d{2})$/;

/** A timestamp string from a payload, kept only if it looks like an ISO instant. */
function isoOrUndefined(value: string | null): string | undefined {
  return value !== null && ISO_LIKE.test(value) ? value : undefined;
}

const GITHUB_LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;

const SKILL_ATTRIBUTE: Readonly<Record<Skill, string>> = {
  smithing: 'xp_smithing',
  vigilance: 'xp_vigilance',
  oratory: 'xp_oratory',
  endurance: 'xp_endurance',
};

function toProfile(item: Attrs): ProfileItem {
  const pk = String(item.PK);
  const skillXp = emptySkillXp();
  for (const skill of SKILLS) {
    skillXp[skill] = num(item, SKILL_ATTRIBUTE[skill], 0);
  }
  return {
    id: Number(pk.slice('USER#'.length)),
    login: str(item, 'login') ?? '',
    created: str(item, 'created') ?? '',
    installations: numberList(item.installations),
    xp: num(item, 'xp', 0),
    level: num(item, 'level', 1),
    skillXp,
    gold: num(item, 'gold', 0),
    opensDay: str(item, 'opens_day'),
    opensCount: num(item, 'opens_count', 0),
    dailyFirstDay: str(item, 'daily_first_day'),
    streakWeeks: num(item, 'streak_weeks', 0),
    version: num(item, 'version', 0),
  };
}

function toEventRow(item: Attrs): StoredEventRow {
  const skillXp = emptySkillXp();
  const stored = item.skill_xp as Attrs | undefined;
  for (const skill of SKILLS) {
    skillXp[skill] = stored ? num(stored, skill, 0) : 0;
  }
  const storedSupplies = (item.supplies ?? {}) as Attrs;
  const reviewState = str(item, 'review_state');
  const additions = numOrNull(item, 'additions');
  const deletions = numOrNull(item, 'deletions');
  const inlineComments = numOrNull(item, 'inline_comments');
  return {
    id: String(item.SK).slice(EVENT_SK_PREFIX.length),
    userId: Number(String(item.PK).slice('USER#'.length)),
    ts: str(item, 'ts') ?? '',
    deliveryId: str(item, 'delivery_id') ?? '',
    kind: str(item, 'kind') ?? '',
    repoId: num(item, 'repo_id', 0),
    repoPrivate: bool(item, 'repo_private', true),
    prNumber: num(item, 'pr_number', 0),
    points: num(item, 'points', 0),
    power: num(item, 'power', 1),
    zone: num(item, 'zone', 1),
    level: num(item, 'level', 1),
    xp: num(item, 'xp', 0),
    skill: (str(item, 'skill') ?? 'smithing') as Skill,
    skillXp,
    supplies: {
      ore: num(storedSupplies, 'ore', 0),
      timber: num(storedSupplies, 'timber', 0),
      lore: num(storedSupplies, 'lore', 0),
      ink: num(storedSupplies, 'ink', 0),
      provisions: num(storedSupplies, 'provisions', 0),
      flux: num(storedSupplies, 'flux', 0),
    },
    monster: (str(item, 'monster') as MonsterId | null) ?? null,
    breakdown: Array.isArray(item.breakdown) ? (item.breakdown as BreakdownLine[]) : [],
    ...(reviewState === 'APPROVED' ||
    reviewState === 'CHANGES_REQUESTED' ||
    reviewState === 'COMMENTED'
      ? { reviewState }
      : {}),
    ...(additions !== null ? { additions } : {}),
    ...(deletions !== null ? { deletions } : {}),
    ...(inlineComments !== null ? { inlineComments } : {}),
  };
}

function toPRMeta(item: Attrs): PRMetaItem {
  return {
    installationId: numOrNull(item, 'installation_id'),
    repoId: num(item, 'repo_id', 0),
    repoPrivate: bool(item, 'repo_private', true),
    number: num(item, 'pr_number', 0),
    authorId: num(item, 'author_id', 0),
    openedAt: str(item, 'opened_at'),
    mergedAt: str(item, 'merged_at'),
    closedAt: str(item, 'closed_at'),
    merged: bool(item, 'merged', false),
    mergedById: numOrNull(item, 'merged_by_id'),
    additions: numOrNull(item, 'additions'),
    deletions: numOrNull(item, 'deletions'),
    changedFiles: numOrNull(item, 'changed_files'),
    commits: numOrNull(item, 'commits'),
    reviewRoundCount: num(item, 'review_round_count', 0),
    syncCount: num(item, 'sync_count', 0),
    draft: bool(item, 'draft', false),
    baseRefIsDefault: bool(item, 'base_ref_is_default', true),
  };
}

// ---------------------------------------------------------------------------------------------
// Update expression builder
// ---------------------------------------------------------------------------------------------

export interface UpdateOps {
  /** `SET attr = :v` */
  set?: Attrs;
  /** `SET attr = if_not_exists(attr, :v)` */
  setIfAbsent?: Attrs;
  /** `ADD attr :v` (atomic increment for numbers, union for sets) */
  add?: Attrs;
  /** `REMOVE attr` */
  remove?: readonly string[];
  /** `DELETE attr :v` (remove elements from a set) */
  deleteFrom?: Attrs;
}

/** A condition with its own placeholders, which must not start with `#a` or `:a` (those are the update's). */
export interface ConditionSpec {
  expression: string;
  names?: Record<string, string>;
  values?: Record<string, unknown>;
}

function buildUpdate(ops: UpdateOps): {
  expression: string;
  names: Record<string, string>;
  values: Record<string, unknown>;
} {
  const names: Record<string, string> = {};
  const values: Record<string, unknown> = {};
  let nameCount = 0;
  let valueCount = 0;
  const nameRef = (attribute: string): string => {
    const ref = `#a${nameCount}`;
    nameCount += 1;
    names[ref] = attribute;
    return ref;
  };
  const valueRef = (value: unknown): string => {
    const ref = `:a${valueCount}`;
    valueCount += 1;
    values[ref] = value;
    return ref;
  };
  const sets: string[] = [];
  for (const [attribute, value] of Object.entries(ops.set ?? {})) {
    sets.push(`${nameRef(attribute)} = ${valueRef(value)}`);
  }
  for (const [attribute, value] of Object.entries(ops.setIfAbsent ?? {})) {
    const ref = nameRef(attribute);
    sets.push(`${ref} = if_not_exists(${ref}, ${valueRef(value)})`);
  }
  const adds = Object.entries(ops.add ?? {}).map(
    ([attribute, value]) => `${nameRef(attribute)} ${valueRef(value)}`,
  );
  const removes = (ops.remove ?? []).map((attribute) => nameRef(attribute));
  const deletes = Object.entries(ops.deleteFrom ?? {}).map(
    ([attribute, value]) => `${nameRef(attribute)} ${valueRef(value)}`,
  );
  const sections = [
    sets.length > 0 ? `SET ${sets.join(', ')}` : '',
    adds.length > 0 ? `ADD ${adds.join(', ')}` : '',
    removes.length > 0 ? `REMOVE ${removes.join(', ')}` : '',
    deletes.length > 0 ? `DELETE ${deletes.join(', ')}` : '',
  ].filter((section) => section !== '');
  if (sections.length === 0) {
    throw new RangeError('An update needs at least one operation');
  }
  return { expression: sections.join(' '), names, values };
}

function mergeCondition(
  update: { names: Record<string, string>; values: Record<string, unknown> },
  condition: ConditionSpec | undefined,
): { names: Record<string, string>; values: Record<string, unknown> } {
  const names = { ...update.names, ...(condition?.names ?? {}) };
  const values = { ...update.values, ...(condition?.values ?? {}) };
  return { names, values };
}

// ---------------------------------------------------------------------------------------------
// The repository
// ---------------------------------------------------------------------------------------------

export class Db {
  constructor(
    private readonly client: DocClient,
    private readonly tableName: string,
  ) {}

  // ----- the two write choke points (schema guard) -----

  /** Guarded PutItem. Throws `SchemaViolationError` before sending when an attribute is not allowed. */
  async put(kind: ItemKind, key: Key, attributes: Attrs, condition?: ConditionSpec): Promise<void> {
    const item = { ...attributes, ...key };
    assertItemAllowed(kind, item);
    await this.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: item,
        ...(condition
          ? {
              ConditionExpression: condition.expression,
              ...(condition.names ? { ExpressionAttributeNames: condition.names } : {}),
              ...(condition.values ? { ExpressionAttributeValues: condition.values } : {}),
            }
          : {}),
      }),
    );
  }

  /** Guarded UpdateItem (upsert unless the condition says otherwise). Returns the new item. */
  async update(
    kind: ItemKind,
    key: Key,
    ops: UpdateOps,
    condition?: ConditionSpec,
  ): Promise<Attrs | undefined> {
    assertItemAllowed(kind, { ...ops.set, ...ops.setIfAbsent, ...ops.add, ...ops.deleteFrom });
    assertAttributesAllowed(kind, ops.remove ?? []);
    const built = buildUpdate(ops);
    const { names, values } = mergeCondition(built, condition);
    const output = await this.client.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: key,
        UpdateExpression: built.expression,
        ...(condition ? { ConditionExpression: condition.expression } : {}),
        ExpressionAttributeNames: names,
        ...(Object.keys(values).length > 0 ? { ExpressionAttributeValues: values } : {}),
        ReturnValues: 'ALL_NEW',
      }),
    );
    return output.Attributes as Attrs | undefined;
  }

  private async getItem(key: Key, consistent: boolean): Promise<Attrs | undefined> {
    const output = await this.client.send(
      new GetCommand({ TableName: this.tableName, Key: key, ConsistentRead: consistent }),
    );
    return output.Item as Attrs | undefined;
  }

  private async queryAll(partition: string, consistent: boolean): Promise<Attrs[]> {
    const items: Attrs[] = [];
    let startKey: Record<string, unknown> | undefined;
    do {
      const output = await this.client.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: '#pk = :pk',
          ExpressionAttributeNames: { '#pk': 'PK' },
          ExpressionAttributeValues: { ':pk': partition },
          ConsistentRead: consistent,
          ...(startKey ? { ExclusiveStartKey: startKey } : {}),
        }),
      );
      items.push(...((output.Items ?? []) as Attrs[]));
      startKey = output.LastEvaluatedKey;
    } while (startKey);
    return items;
  }

  // ----- profile: USER#<id> / PROFILE -----

  /** Strongly consistent when `consistent` (use it inside a read-modify-write); otherwise half the read cost. */
  async getProfile(userId: number, consistent = false): Promise<ProfileItem | null> {
    const item = await this.getItem(profileKey(userId), consistent);
    return item ? toProfile(item) : null;
  }

  /**
   * Create the profile on first sign-in or refresh it on later ones: login, the GSI1 login key and the
   * accessible installation ids are overwritten, every game field keeps its value (`if_not_exists`).
   */
  async upsertProfileOnLogin(input: {
    id: number;
    login: string;
    installations: readonly number[];
    nowMs: number;
  }): Promise<ProfileItem> {
    if (!GITHUB_LOGIN.test(input.login)) {
      throw new RangeError('login is not a valid GitHub login');
    }
    const installationIds = [...new Set(input.installations)];
    const set: Attrs = {
      login: input.login,
      GSI1PK: `LOGIN#${input.login.toLowerCase()}`,
      GSI1SK: userPk(input.id),
    };
    if (installationIds.length > 0) {
      set.installations = new Set(installationIds);
    }
    const attributes = await this.update('PROFILE', profileKey(input.id), {
      set,
      setIfAbsent: {
        created: new Date(input.nowMs).toISOString(),
        xp: 0,
        xp_smithing: 0,
        xp_vigilance: 0,
        xp_oratory: 0,
        xp_endurance: 0,
        level: 1,
        gold: 0,
        streak_weeks: 0,
        version: 0,
      },
      remove: installationIds.length > 0 ? [] : ['installations'],
    });
    if (!attributes) {
      throw new Error('Profile upsert returned no item');
    }
    return toProfile(attributes);
  }

  /** Add an installation id to an existing profile (no-op, returns false, when there is no profile). */
  async addProfileInstallation(userId: number, installationId: number): Promise<boolean> {
    try {
      await this.update(
        'PROFILE',
        profileKey(userId),
        { add: { installations: new Set([installationId]) } },
        { expression: 'attribute_exists(#c0)', names: { '#c0': 'PK' } },
      );
      return true;
    } catch (error) {
      if (isConditionalCheckFailed(error)) {
        return false;
      }
      throw error;
    }
  }

  /**
   * Apply one scored event: atomic `ADD` of XP, skill XP and gold, `SET` of the level cache and the
   * counters the scorer changed, guarded by the profile `version` the scorer's inputs were read at.
   * @throws VersionConflictError when another writer got there first (re-read and re-score).
   */
  async applyScore(userId: number, expectedVersion: number, write: ScoreWrite): Promise<void> {
    const add: Attrs = { version: 1 };
    if (write.xp > 0) {
      add.xp = write.xp;
    }
    if (write.gold > 0) {
      add.gold = write.gold;
    }
    for (const skill of SKILLS) {
      if (write.skillXp[skill] > 0) {
        add[SKILL_ATTRIBUTE[skill]] = write.skillXp[skill];
      }
    }
    const set: Attrs = { level: write.level };
    const remove: string[] = [];
    const { opens, dailyFirstDay, streakWeeks } = write.counters;
    if (opens) {
      set.opens_day = opens.day;
      set.opens_count = opens.count;
    }
    if (dailyFirstDay !== undefined) {
      if (dailyFirstDay === null) {
        remove.push('daily_first_day');
      } else {
        set.daily_first_day = dailyFirstDay;
      }
    }
    if (streakWeeks !== undefined) {
      set.streak_weeks = streakWeeks;
    }
    try {
      await this.update(
        'PROFILE',
        profileKey(userId),
        { set, add, remove },
        {
          expression: 'attribute_exists(#c0) AND #c1 = :c0',
          names: { '#c0': 'PK', '#c1': 'version' },
          values: { ':c0': expectedVersion },
        },
      );
    } catch (error) {
      if (isConditionalCheckFailed(error)) {
        throw new VersionConflictError();
      }
      throw error;
    }
  }

  // ----- Combat Log: USER#<id> / EVT#<ts>#<delivery> -----

  /** Idempotent: the key holds the delivery id, so a retry rewrites the same row. */
  async putEvent(row: EventRow): Promise<void> {
    const attributes: Attrs = {
      ts: row.ts,
      delivery_id: row.deliveryId,
      kind: row.kind,
      repo_id: row.repoId,
      repo_private: row.repoPrivate,
      pr_number: row.prNumber,
      points: row.points,
      power: row.power,
      zone: row.zone,
      level: row.level,
      xp: row.xp,
      skill: row.skill,
      skill_xp: { ...row.skillXp },
      supplies: { ...row.supplies },
      breakdown: row.breakdown.map((line) => ({
        label: line.label,
        value: line.value,
        kind: line.kind,
      })),
      ttl: seconds(Date.parse(row.ts)) + EVENT_TTL_SECONDS,
    };
    if (row.monster !== null) {
      attributes.monster = row.monster;
    }
    if (row.reviewState !== undefined) {
      attributes.review_state = row.reviewState;
    }
    if (row.additions !== undefined) {
      attributes.additions = row.additions;
    }
    if (row.deletions !== undefined) {
      attributes.deletions = row.deletions;
    }
    if (row.inlineComments !== undefined) {
      attributes.inline_comments = row.inlineComments;
    }
    await this.put('EVENT', eventKey(row.userId, row.ts, row.deliveryId), attributes);
  }

  /**
   * Newest-first page of a player's Combat Log. `beforeSk` is the sort key of the last row of the
   * previous page (exclusive); `nextSk` is the value to pass for the next page, or null at the end.
   */
  async listEvents(
    userId: number,
    options: { limit: number; beforeSk?: string },
  ): Promise<{ rows: StoredEventRow[]; nextSk: string | null }> {
    const output = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :prefix)',
        ExpressionAttributeNames: { '#pk': 'PK', '#sk': 'SK' },
        ExpressionAttributeValues: { ':pk': userPk(userId), ':prefix': EVENT_SK_PREFIX },
        ScanIndexForward: false,
        Limit: options.limit + 1,
        ...(options.beforeSk
          ? { ExclusiveStartKey: { PK: userPk(userId), SK: options.beforeSk } }
          : {}),
      }),
    );
    const items = (output.Items ?? []) as Attrs[];
    const page = items.slice(0, options.limit);
    const last = page[page.length - 1];
    return {
      rows: page.map(toEventRow),
      nextSk: items.length > options.limit && last ? String(last.SK) : null,
    };
  }

  // ----- PR facts and reviews: PR#<repo>#<n> -----

  /** Strongly consistent read of the whole partition: META, REVIEW# and INLINE# items. */
  async getPR(repoId: number, number: number): Promise<PRBundle> {
    const items = await this.queryAll(prPk(repoId, number), true);
    const bundle: PRBundle = { meta: null, reviews: [], inline: [] };
    for (const item of items) {
      const sk = String(item.SK);
      if (sk === 'META') {
        bundle.meta = toPRMeta(item);
      } else if (sk.startsWith('REVIEW#')) {
        const state = str(item, 'state');
        if (state === 'APPROVED' || state === 'CHANGES_REQUESTED' || state === 'COMMENTED') {
          bundle.reviews.push({
            reviewerId: num(item, 'reviewer_id', 0),
            reviewerIsBot: bool(item, 'reviewer_is_bot', false),
            state,
            submittedAt: str(item, 'submitted_at') ?? '',
          });
        }
      } else if (sk.startsWith('INLINE#')) {
        bundle.inline.push({
          reviewerId: num(item, 'reviewer_id', 0),
          count: num(item, 'inline_comment_count', 1),
        });
      }
    }
    return bundle;
  }

  /**
   * Upsert the PR facts of Requirement 3.1 and add to the review-round and push counters.
   * The facts never regress `merged`: an out-of-order event that says "not merged" cannot overwrite a
   * stored merge. In that case only the counters are added and `'kept'` is returned.
   */
  async upsertPR(
    facts: PullRequestFacts,
    deltas: { syncCount?: number; reviewRoundCount?: number } = {},
  ): Promise<'written' | 'kept'> {
    const key = prMetaKey(facts.repoId, facts.number);
    const set: Attrs = {
      repo_id: facts.repoId,
      repo_private: facts.repoPrivate,
      pr_number: facts.number,
      author_id: facts.author.id,
      merged: facts.merged,
      draft: facts.draft,
      base_ref_is_default: facts.baseRefIsDefault,
    };
    if (facts.installationId !== null) {
      set.installation_id = facts.installationId;
    }
    const timestamps: [string, string | null][] = [
      ['opened_at', facts.openedAt],
      ['merged_at', facts.mergedAt],
      ['closed_at', facts.closedAt],
    ];
    for (const [attribute, value] of timestamps) {
      const iso = isoOrUndefined(value);
      if (iso !== undefined) {
        set[attribute] = iso;
      }
    }
    if (facts.merged && facts.mergedBy !== null) {
      set.merged_by_id = facts.mergedBy.id;
    }
    if (facts.stats !== null) {
      set.additions = facts.stats.additions;
      set.deletions = facts.stats.deletions;
      set.changed_files = facts.stats.changedFiles;
      set.commits = facts.stats.commits;
    }
    const add: Attrs = {};
    if (deltas.syncCount) {
      add.sync_count = deltas.syncCount;
    }
    if (deltas.reviewRoundCount) {
      add.review_round_count = deltas.reviewRoundCount;
    }
    try {
      await this.update(
        'PR',
        key,
        { set, add },
        facts.merged
          ? undefined
          : {
              expression: 'attribute_not_exists(#c0) OR attribute_not_exists(#c1) OR #c1 = :c0',
              names: { '#c0': 'PK', '#c1': 'merged' },
              values: { ':c0': false },
            },
      );
      return 'written';
    } catch (error) {
      if (!isConditionalCheckFailed(error)) {
        throw error;
      }
    }
    if (Object.keys(add).length > 0) {
      await this.update('PR', key, { add });
    }
    return 'kept';
  }

  /** Record a human review. Idempotent: the key holds the delivery id. */
  async putReview(
    repoId: number,
    number: number,
    review: ReviewItem & { deliveryId: string },
  ): Promise<void> {
    const key = reviewKey(repoId, number, review.submittedAt, review.reviewerId, review.deliveryId);
    await this.put('REVIEW', key, {
      pr_key: prPk(repoId, number),
      reviewer_id: review.reviewerId,
      reviewer_is_bot: review.reviewerIsBot,
      state: review.state,
      submitted_at: review.submittedAt,
    });
  }

  /** Record one scored inline comment (count 1). Idempotent: the key holds the delivery id. */
  async putInline(
    repoId: number,
    number: number,
    inline: { reviewerId: number; reviewerIsBot: boolean; deliveryId: string },
  ): Promise<void> {
    await this.put('REVIEW', inlineKey(repoId, number, inline.reviewerId, inline.deliveryId), {
      pr_key: prPk(repoId, number),
      reviewer_id: inline.reviewerId,
      reviewer_is_bot: inline.reviewerIsBot,
      inline_comment_count: 1,
    });
  }

  // ----- installations: INSTALL#<id> / META -----

  /** The installation, or null when it was never seen (or its tombstone has been swept). */
  async getInstallation(installationId: number, nowMs: number): Promise<InstallationItem | null> {
    const item = await this.getItem(installKey(installationId), false);
    if (!item) {
      return null;
    }
    const ttl = numOrNull(item, 'ttl');
    return {
      id: installationId,
      accountId: num(item, 'account_id', 0),
      repoIds: numberList(item.repo_ids),
      suspended: bool(item, 'suspended', false),
      deleted: ttl !== null && ttl <= seconds(nowMs),
    };
  }

  /** `installation.created`: replace the mapping (a reinstall also clears a tombstone). */
  async upsertInstallation(input: {
    id: number;
    accountId: number;
    repoIds: readonly number[];
    suspended: boolean;
  }): Promise<void> {
    const repoIds = [...new Set(input.repoIds)];
    await this.update('INSTALL', installKey(input.id), {
      set: {
        account_id: input.accountId,
        suspended: input.suspended,
        ...(repoIds.length > 0 ? { repo_ids: new Set(repoIds) } : {}),
      },
      remove: repoIds.length > 0 ? ['ttl'] : ['ttl', 'repo_ids'],
    });
  }

  /** `installation_repositories`: add and remove repository ids (set operations are idempotent). */
  async changeInstallationRepos(input: {
    id: number;
    accountId: number;
    added: readonly number[];
    removed: readonly number[];
  }): Promise<void> {
    const key = installKey(input.id);
    const added = [...new Set(input.added)];
    const removed = [...new Set(input.removed)];
    // ADD and DELETE on one attribute cannot share an update expression.
    if (added.length > 0 || removed.length === 0) {
      await this.update('INSTALL', key, {
        set: { account_id: input.accountId },
        ...(added.length > 0 ? { add: { repo_ids: new Set(added) } } : {}),
      });
    }
    if (removed.length > 0) {
      await this.update('INSTALL', key, {
        set: { account_id: input.accountId },
        deleteFrom: { repo_ids: new Set(removed) },
      });
    }
  }

  async setInstallationSuspended(input: {
    id: number;
    accountId: number;
    suspended: boolean;
  }): Promise<void> {
    await this.update('INSTALL', installKey(input.id), {
      set: { account_id: input.accountId, suspended: input.suspended },
    });
  }

  /**
   * `installation.deleted`: remove the mapping. The ingest role has no DeleteItem, so the item is
   * tombstoned instead (repo ids dropped, suspended, `ttl = now`): `getInstallation` reports it as
   * `deleted` at once and DynamoDB's TTL sweep removes it within about two days.
   */
  async removeInstallation(installationId: number, nowMs: number): Promise<void> {
    await this.update('INSTALL', installKey(installationId), {
      set: { suspended: true, ttl: seconds(nowMs) },
      remove: ['repo_ids'],
    });
  }

  // ----- webhook idempotency: DELIVERY#<guid> -----

  /**
   * Claim a delivery id. Returns false when it was already claimed (a duplicate), via
   * `attribute_not_exists(PK)`. A delivery whose processing failed before any credit was `released`
   * and may be claimed again, so GitHub's "Redeliver" button works after a transient error.
   */
  async claimDelivery(deliveryId: string, nowMs: number): Promise<boolean> {
    try {
      await this.put(
        'DELIVERY',
        deliveryKey(deliveryId),
        { ttl: seconds(nowMs) + DELIVERY_TTL_SECONDS },
        {
          expression: 'attribute_not_exists(#c0) OR #c1 = :c0',
          names: { '#c0': 'PK', '#c1': 'released' },
          values: { ':c0': true },
        },
      );
      return true;
    } catch (error) {
      if (isConditionalCheckFailed(error)) {
        return false;
      }
      throw error;
    }
  }

  /** Mark a claimed delivery as failed-before-credit so a redelivery can claim it again. */
  async releaseDelivery(deliveryId: string): Promise<void> {
    await this.update('DELIVERY', deliveryKey(deliveryId), { set: { released: true } });
  }

  // ----- OAuth state: STATE#<nonce> -----

  async putOAuthState(nonce: string, nowMs: number): Promise<void> {
    await this.put(
      'STATE',
      stateKey(nonce),
      { ttl: seconds(nowMs) + OAUTH_STATE_TTL_SECONDS },
      { expression: 'attribute_not_exists(#c0)', names: { '#c0': 'PK' } },
    );
  }

  /**
   * Single use: deletes the state and returns true only if it existed and had not expired. DynamoDB's
   * TTL sweep is lazy, so expiry is checked in the condition rather than trusted to the sweep.
   */
  async consumeOAuthState(nonce: string, nowMs: number): Promise<boolean> {
    try {
      await this.client.send(
        new DeleteCommand({
          TableName: this.tableName,
          Key: stateKey(nonce),
          ConditionExpression: 'attribute_exists(#pk) AND #ttl > :now',
          ExpressionAttributeNames: { '#pk': 'PK', '#ttl': 'ttl' },
          ExpressionAttributeValues: { ':now': seconds(nowMs) },
        }),
      );
      return true;
    } catch (error) {
      if (isConditionalCheckFailed(error)) {
        return false;
      }
      throw error;
    }
  }

  // ----- weekly run: USER#<id> / WEEK#<yyyy-ww> -----

  async getWeek(userId: number, weekKey: string): Promise<RunState | null> {
    const item = await this.getItem(weekKeyOf(userId, weekKey), true);
    return item ? toRunState(item) : null;
  }

  /** Create the week (rollover). Returns false when it already exists. */
  async createWeek(userId: number, run: RunState): Promise<boolean> {
    try {
      await this.put('WEEK', weekKeyOf(userId, run.weekKey), runToAttributes(run), {
        expression: 'attribute_not_exists(#c0)',
        names: { '#c0': 'PK' },
      });
      return true;
    } catch (error) {
      if (isConditionalCheckFailed(error)) {
        return false;
      }
      throw error;
    }
  }

  /**
   * Update an existing week: atomically add to the weekly XP and/or set fields. Returns false when
   * the week does not exist. A `null` for `act` or `shop` removes the attribute.
   */
  async updateWeek(
    userId: number,
    weekKey: string,
    patch: { addWeeklyXp?: number; set?: Partial<Omit<RunState, 'weekKey' | 'weeklyXp'>> },
  ): Promise<boolean> {
    const set: Attrs = {};
    const remove: string[] = [];
    for (const [field, value] of Object.entries(patch.set ?? {})) {
      const attribute = WEEK_ATTRIBUTE[field] ?? field;
      if (value === null) {
        remove.push(attribute);
      } else {
        set[attribute] = value;
      }
    }
    const add: Attrs = patch.addWeeklyXp ? { weekly_xp: patch.addWeeklyXp } : {};
    try {
      await this.update(
        'WEEK',
        weekKeyOf(userId, weekKey),
        { set, add, remove },
        { expression: 'attribute_exists(#c0)', names: { '#c0': 'PK' } },
      );
      return true;
    } catch (error) {
      if (isConditionalCheckFailed(error)) {
        return false;
      }
      throw error;
    }
  }
}

const WEEK_ATTRIBUTE: Readonly<Record<string, string>> = {
  weekKey: 'week_key',
  act: 'act',
  clearedActs: 'cleared_acts',
  weeklyXp: 'weekly_xp',
  targets: 'targets',
  mogul: 'mogul',
  hand: 'hand',
  played: 'played',
  shopSeed: 'shop_seed',
  shop: 'shop',
};

function runToAttributes(run: RunState): Attrs {
  const attributes: Attrs = {
    week_key: run.weekKey,
    cleared_acts: run.clearedActs,
    weekly_xp: run.weeklyXp,
    targets: { ...run.targets },
    mogul: run.mogul,
    hand: run.hand.map((pledge) => ({ ...pledge })),
    played: run.played.map((pledge) => ({ ...pledge })),
    shop_seed: run.shopSeed,
  };
  if (run.act !== null) {
    attributes.act = run.act;
  }
  if (run.shop !== null) {
    attributes.shop = JSON.parse(JSON.stringify(run.shop)) as unknown;
  }
  return attributes;
}

function toRunState(item: Attrs): RunState {
  return {
    weekKey: str(item, 'week_key') ?? '',
    act: (str(item, 'act') as RunState['act']) ?? null,
    clearedActs: (Array.isArray(item.cleared_acts)
      ? item.cleared_acts
      : []) as RunState['clearedActs'],
    weeklyXp: num(item, 'weekly_xp', 0),
    targets: (item.targets ?? { scout: 0, raid: 0, boss: 0 }) as RunState['targets'],
    mogul: str(item, 'mogul') as RunState['mogul'],
    hand: (Array.isArray(item.hand) ? item.hand : []) as RunState['hand'],
    played: (Array.isArray(item.played) ? item.played : []) as RunState['played'],
    shopSeed: num(item, 'shop_seed', 0),
    shop: (item.shop ?? null) as RunState['shop'],
  };
}
