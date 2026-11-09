/**
 * The schema guard (tasks.md 6, Requirements 3.1 to 3.3 and 3.5): a runtime allow-list of attribute names
 * per item type. Every write in `db.ts` passes through `assertItemAllowed` / `assertAttributesAllowed`
 * before it is sent, so an attribute outside the list can never reach the table, whatever the caller does.
 */

import { USER_PK_PREFIX } from './keys';

export type ItemKind =
  | 'PROFILE'
  | 'EVENT'
  | 'PR'
  | 'REVIEW'
  | 'INSTALL'
  | 'DELIVERY'
  | 'STATE'
  | 'WEEK'
  | 'EXPEDITION'
  | 'JOB'
  | 'FEAT';

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
    // Run layer (tasks 14 to 16). All of it is derived game state: ids, counts and timestamps.
    'renown',
    'vocation',
    'vouchers',
    'deck',
    'cosmetics',
    'charms',
    'repo_merges',
    'mogul_bag',
    'mogul_benched',
    'mogul_board_week',
    // The week the profile has been rolled into, and the closed weeks' XP the next targets come from.
    'run_week',
    'history',
    // Bestiary: kill counts and first-seen instants per monster id.
    'kills',
    'first_seen',
    // Week-scoped scorer state (Pledge progress, Leather Jacket chain, Loaded Dice), stamped with its week
    // so it resets itself on Monday. It lives here, not on WEEK#, so one version-guarded write covers a
    // scored event completely (see runs.ts).
    'wk_week',
    'wk_progress',
    'wk_completed',
    'wk_chain',
    'wk_dice',
    // The depth layers (tasks 20 to 22): what the character carries and has earned. All of it is derived
    // game state (ids, counts, timestamps and the seeds that fix a roll), never anything from GitHub.
    // The satchel of six supplies and four crafting materials.
    'satchel',
    // The latest expedition, collected or not; `EXPEDITION#` keeps every one.
    'expedition',
    // Gear owned and not worn, the worn pieces with the cape colour, and the pets owned.
    'inventory',
    'gear',
    'pets',
    // Seeds of unopened Charm packs from loot.
    'charm_packs',
    // The three stations (their current orders) and the upgrades bought; `JOB#` keeps the orders.
    'forge',
    // Feats: the unlocked ids, titles earned, the pinned three, and the rolling counters they read.
    'feats_unlocked',
    'titles',
    'pinned_feats',
    'feat_counters',
    // True once The Old Coin is found: with `pinned_feats` it is all the badge reads about Feats (GSI1).
    'old_coin',
    // Minutes east of UTC for the local-time Feats. Nothing writes it yet (the timezone setting is deferred).
    'tz_offset',
    // The player's choice to keep the public README badge from showing them (Settings; GSI1 projects it).
    'badge_public',
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
  // USER#<id> / WEEK#<yyyy-ww>: the RunState fields plus the bookkeeping the endpoints need.
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
    // Optimistic-lock counter for the shop and Pledge endpoints and the act-clear claim.
    'version',
    // The last 20 client request ids, so a replayed mutation answers instead of applying twice.
    'request_ids',
    // Merged PRs and scored reviews this week: the weekly streak needs "a merge or three reviews".
    'merges',
    'reviews',
    // A free Pledge pack granted by the Raid clear, and a Legendary Charm offered on every 4th Renown.
    'free_pack',
    'legendary',
  ],
  // USER#<id> / EXPEDITION#<iso sent_at>: one expedition. The seed is stored at send time and the loot is
  // rolled from it once, on collection, then stored here (Requirement 15.4).
  EXPEDITION: [
    'region',
    'hours',
    'forage',
    'sent_at',
    'returns_at',
    'seed',
    'provisions_paid',
    'pack_bonus',
    'collected',
    'collected_at',
    'loot',
  ],
  // USER#<id> / JOB#<station>: the current (or last) order at a station.
  JOB: [
    'recipe',
    'station',
    'started_at',
    'done_at',
    'seed',
    'piece',
    'collected',
    'collected_at',
    'output',
  ],
  // USER#<id> / FEAT#<feat_id>: written once when the Feat unlocks, recording the event that unlocked it
  // (a delivery id, or the id of the expedition, Boss clear or rollover that did) so it can be audited.
  FEAT: ['unlocked_at', 'delivery_id'],
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
  if (pk.startsWith(USER_PK_PREFIX)) {
    if (sk === 'PROFILE') {
      return 'PROFILE';
    }
    if (sk.startsWith('EVT#')) {
      return 'EVENT';
    }
    if (sk.startsWith('WEEK#')) {
      return 'WEEK';
    }
    if (sk.startsWith('EXPEDITION#')) {
      return 'EXPEDITION';
    }
    if (sk.startsWith('JOB#')) {
      return 'JOB';
    }
    return sk.startsWith('FEAT#') ? 'FEAT' : null;
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
