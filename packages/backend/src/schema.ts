/**
 * The schema guard (tasks.md 6, Requirements 3.1 to 3.3 and 3.5): a runtime allow-list of attribute names
 * per item type. Every write in `db.ts` passes through `assertItemAllowed` / `assertAttributesAllowed`
 * before it is sent, so an attribute outside the list can never reach the table, whatever the caller does.
 */

export type ItemKind =
  'PROFILE' | 'EVENT' | 'PR' | 'REVIEW' | 'INSTALL' | 'DELIVERY' | 'STATE' | 'WEEK';

/** Attributes every item has. */
export const KEY_ATTRIBUTES = ['PK', 'SK'] as const;

export const ALLOWED_ATTRIBUTES: Readonly<Record<ItemKind, readonly string[]>> = {
  // USER#<id> / PROFILE. Numeric id in the key; login is public GitHub data (design.md 3.3).
  PROFILE: [
    'login',
    'created',
    'installations',
    'xp',
    'xp_smithing',
    'xp_vigilance',
    'xp_oratory',
    'xp_endurance',
    'level',
    'gold',
    'opens_day',
    'opens_count',
    'daily_first_day',
    'streak_weeks',
    'version',
    'GSI1PK',
    'GSI1SK',
  ],
  // USER#<id> / EVT#<ts>#<delivery>: one Combat Log row. Numbers and scorer-generated labels only.
  EVENT: [
    'ts',
    'delivery_id',
    'kind',
    'repo_id',
    'repo_private',
    'pr_number',
    'points',
    'power',
    'zone',
    'level',
    'xp',
    'skill',
    'skill_xp',
    'supplies',
    'monster',
    'breakdown',
    'review_state',
    'additions',
    'deletions',
    'inline_comments',
    'ttl',
  ],
  // PR#<repo>#<n> / META: exactly Requirement 3.1.
  PR: [
    'installation_id',
    'repo_id',
    'repo_private',
    'pr_number',
    'author_id',
    'opened_at',
    'merged_at',
    'closed_at',
    'merged',
    'merged_by_id',
    'additions',
    'deletions',
    'changed_files',
    'commits',
    'review_round_count',
    'sync_count',
    'draft',
    'base_ref_is_default',
  ],
  // PR#<repo>#<n> / REVIEW#... and INLINE#...: exactly Requirement 3.2.
  REVIEW: [
    'pr_key',
    'reviewer_id',
    'reviewer_is_bot',
    'state',
    'submitted_at',
    'inline_comment_count',
  ],
  // INSTALL#<id> / META. `ttl` tombstones a deleted installation (the ingest role cannot DeleteItem).
  INSTALL: ['account_id', 'repo_ids', 'suspended', 'ttl'],
  // DELIVERY#<guid> / META. `released` re-opens a delivery whose processing failed before any credit.
  DELIVERY: ['ttl', 'released'],
  // STATE#<nonce> / META.
  STATE: ['ttl'],
  // USER#<id> / WEEK#<yyyy-ww>: the RunState fields (tasks 14 to 16 extend this list).
  WEEK: [
    'week_key',
    'act',
    'cleared_acts',
    'weekly_xp',
    'targets',
    'mogul',
    'hand',
    'played',
    'shop_seed',
    'shop',
  ],
};

export class SchemaViolationError extends Error {
  constructor(
    readonly kind: ItemKind,
    readonly attributes: readonly string[],
  ) {
    super(`Attributes not allowed on ${kind} items: ${attributes.join(', ')}`);
    this.name = 'SchemaViolationError';
  }
}

/** Throws unless every name is a key attribute or on the allow-list for `kind`. */
export function assertAttributesAllowed(kind: ItemKind, names: Iterable<string>): void {
  const allowed = new Set<string>([...KEY_ATTRIBUTES, ...ALLOWED_ATTRIBUTES[kind]]);
  const rejected = [...names].filter((name) => !allowed.has(name));
  if (rejected.length > 0) {
    throw new SchemaViolationError(kind, rejected);
  }
}

/** Throws on an attribute outside the allow-list or a value DynamoDB cannot store (`undefined`, NaN). */
export function assertItemAllowed(kind: ItemKind, item: Readonly<Record<string, unknown>>): void {
  assertAttributesAllowed(kind, Object.keys(item));
  for (const [name, value] of Object.entries(item)) {
    if (value === undefined) {
      throw new TypeError(`Attribute ${name} on ${kind} item is undefined`);
    }
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new TypeError(`Attribute ${name} on ${kind} item is not a finite number`);
    }
  }
}

/** Which item type a stored item is, from its keys; null for an unrecognised shape. */
export function classifyItem(pk: string, sk: string): ItemKind | null {
  if (pk.startsWith('USER#')) {
    if (sk === 'PROFILE') {
      return 'PROFILE';
    }
    if (sk.startsWith('EVT#')) {
      return 'EVENT';
    }
    return sk.startsWith('WEEK#') ? 'WEEK' : null;
  }
  if (pk.startsWith('PR#')) {
    if (sk === 'META') {
      return 'PR';
    }
    return sk.startsWith('REVIEW#') || sk.startsWith('INLINE#') ? 'REVIEW' : null;
  }
  if (sk !== 'META') {
    return null;
  }
  if (pk.startsWith('INSTALL#')) {
    return 'INSTALL';
  }
  if (pk.startsWith('DELIVERY#')) {
    return 'DELIVERY';
  }
  return pk.startsWith('STATE#') ? 'STATE' : null;
}
