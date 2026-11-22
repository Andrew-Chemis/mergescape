import { isRecord } from './math';
import type {
  EventActor,
  GameEvent,
  PullRequestFacts,
  PullRequestStats,
  ReviewState,
} from './types';

/**
 * Webhook normaliser: `(eventName, payload) -> GameEvent[]`.
 *
 * This is the privacy boundary (Requirements 3.1 to 3.3). Only the fields listed in research.md section 5
 * are read, and they are copied into freshly built objects: titles, bodies, comment text, file paths,
 * branch and repository names, logins and URLs are never copied, so nothing downstream can leak them.
 * Payloads are untrusted JSON; anything missing or malformed yields no events rather than an exception.
 */

/** Every property name a normalised `GameEvent` may contain, at any depth. Tests assert nothing else survives. */
export const GAME_EVENT_KEYS: ReadonlySet<string> = new Set([
  'kind',
  'actor',
  'sender',
  'id',
  'isBot',
  'trigger',
  'pr',
  'installationId',
  'repoId',
  'repoPrivate',
  'number',
  'author',
  'draft',
  'baseRefIsDefault',
  'stats',
  'additions',
  'deletions',
  'changedFiles',
  'commits',
  'openedAt',
  'mergedAt',
  'closedAt',
  'merged',
  'mergedBy',
  'state',
  'submittedAt',
  'qualified',
  'action',
  'accountId',
  'repositoryIds',
  'added',
  'removed',
]);

type Json = Record<string, unknown>;

function asObject(value: unknown): Json | null {
  return isRecord(value) ? value : null;
}

/** A non-negative safe integer (GitHub ids, counts), else null. */
function asCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/** An ISO-8601 instant as GitHub sends it: `2026-11-09T09:00:00Z`, optionally with a fraction or an offset. */
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

/**
 * A timestamp field: a string of the ISO-8601 shape that also parses to a real instant, else null. Payloads
 * are untrusted, and these strings are stored and compared, so an arbitrary string never passes through.
 */
function asTimestamp(value: unknown): string | null {
  return typeof value === 'string' && TIMESTAMP.test(value) && !Number.isNaN(Date.parse(value))
    ? value
    : null;
}

/** Requirement 2.7: an account is a bot when its type is `Bot` or its login ends with `[bot]`. */
export function isBotAccount(account: { type?: unknown; login?: unknown }): boolean {
  return (
    account.type === 'Bot' || (typeof account.login === 'string' && account.login.endsWith('[bot]'))
  );
}

/** Reduce a GitHub user object to its numeric id and bot flag. The login is dropped. */
function toActor(value: unknown): EventActor | null {
  const user = asObject(value);
  const id = user ? asCount(user.id) : null;
  return user && id !== null ? { id, isBot: isBotAccount(user) } : null;
}

function toStats(pr: Json): PullRequestStats | null {
  const additions = asCount(pr.additions);
  const deletions = asCount(pr.deletions);
  const changedFiles = asCount(pr.changed_files);
  const commits = asCount(pr.commits);
  return additions !== null && deletions !== null && changedFiles !== null && commits !== null
    ? { additions, deletions, changedFiles, commits }
    : null;
}

/**
 * Whether the base ref is the repository default branch. False when the payload does not say (a missing
 * `base.ref` or `default_branch`): an unverifiable claim must not earn the full-value default-branch
 * score, so it fails closed.
 */
function isDefaultBase(pr: Json, repository: Json | null): boolean {
  const base = asObject(pr.base);
  const ref = base ? asString(base.ref) : null;
  const baseRepo = base ? asObject(base.repo) : null;
  const defaultBranch =
    (baseRepo ? asString(baseRepo.default_branch) : null) ??
    (repository ? asString(repository.default_branch) : null);
  return ref !== null && defaultBranch !== null && ref === defaultBranch;
}

function toPullRequest(payload: Json): PullRequestFacts | null {
  const pr = asObject(payload.pull_request);
  if (!pr) {
    return null;
  }
  const repository = asObject(payload.repository);
  const baseRepo = asObject(asObject(pr.base)?.repo);
  const repoId = asCount(repository?.id) ?? asCount(baseRepo?.id);
  const number = asCount(pr.number);
  const author = toActor(pr.user);
  if (repoId === null || number === null || author === null) {
    return null;
  }
  const merged = pr.merged === true;
  return {
    installationId: asCount(asObject(payload.installation)?.id),
    repoId,
    // Unknown counts as private: the safer reading for anything that decides what is displayed.
    repoPrivate: typeof repository?.private === 'boolean' ? repository.private : true,
    number,
    author,
    draft: pr.draft === true,
    baseRefIsDefault: isDefaultBase(pr, repository),
    stats: toStats(pr),
    openedAt: asTimestamp(pr.created_at),
    mergedAt: asTimestamp(pr.merged_at),
    closedAt: asTimestamp(pr.closed_at),
    merged,
    mergedBy: merged ? toActor(pr.merged_by) : null,
  };
}

function normalizePullRequest(payload: Json): GameEvent[] {
  const pr = toPullRequest(payload);
  if (!pr) {
    return [];
  }
  switch (payload.action) {
    case 'opened':
      return [{ kind: 'pr_opened', actor: pr.author, trigger: 'opened', pr }];
    case 'ready_for_review':
      return [{ kind: 'pr_opened', actor: pr.author, trigger: 'ready_for_review', pr }];
    case 'synchronize':
      return [{ kind: 'pr_synchronized', actor: pr.author, pr }];
    case 'closed': {
      if (!pr.merged) {
        return [{ kind: 'pr_closed', actor: pr.author, pr }];
      }
      // Requirement 2.7: a bot-authored PR earns its author nothing, but the human who merged it is credited.
      const credited =
        pr.author.isBot && pr.mergedBy !== null && !pr.mergedBy.isBot ? pr.mergedBy : pr.author;
      return [{ kind: 'pr_merged', actor: credited, pr }];
    }
    default:
      return [];
  }
}

/** GitHub sends lowercase review states; `dismissed` and `pending` are deliberately absent. */
const REVIEW_STATES: ReadonlyMap<string, ReviewState> = new Map([
  ['approved', 'APPROVED'],
  ['changes_requested', 'CHANGES_REQUESTED'],
  ['commented', 'COMMENTED'],
]);

function normalizeReview(payload: Json): GameEvent[] {
  if (payload.action !== 'submitted') {
    return [];
  }
  const pr = toPullRequest(payload);
  const review = asObject(payload.review);
  const actor = review ? toActor(review.user) : null;
  const rawState = review ? asString(review.state) : null;
  const state = rawState === null ? undefined : REVIEW_STATES.get(rawState.toLowerCase());
  if (!pr || !review || !actor || !state) {
    return [];
  }
  return [
    { kind: 'review_submitted', actor, state, submittedAt: asTimestamp(review.submitted_at), pr },
  ];
}

function normalizeReviewComment(payload: Json): GameEvent[] {
  if (payload.action !== 'created') {
    return [];
  }
  const pr = toPullRequest(payload);
  const comment = asObject(payload.comment);
  const actor = comment ? toActor(comment.user) : null;
  return pr && actor ? [{ kind: 'review_comment_created', actor, pr }] : [];
}

/** The most repository ids one installation event may carry; later ones are dropped (the payload is untrusted). */
export const MAX_REPOSITORY_IDS = 1000;

function repositoryIds(value: unknown): number[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const ids: number[] = [];
  for (const entry of value as unknown[]) {
    if (ids.length >= MAX_REPOSITORY_IDS) {
      break;
    }
    const id = asCount(asObject(entry)?.id);
    if (id !== null) {
      ids.push(id);
    }
  }
  return ids;
}

function installationIds(payload: Json) {
  const installation = asObject(payload.installation);
  const installationId = asCount(installation?.id);
  const accountId = asCount(asObject(installation?.account)?.id);
  const sender = toActor(payload.sender);
  return installationId !== null && accountId !== null && sender !== null
    ? { installationId, accountId, sender }
    : null;
}

const INSTALLATION_ACTIONS = ['created', 'deleted', 'suspend', 'unsuspend'] as const;

function normalizeInstallation(payload: Json): GameEvent[] {
  const ids = installationIds(payload);
  const action = INSTALLATION_ACTIONS.find((candidate) => candidate === payload.action);
  if (!ids || !action) {
    return [];
  }
  return [
    { kind: 'installation', action, ...ids, repositoryIds: repositoryIds(payload.repositories) },
  ];
}

function normalizeInstallationRepositories(payload: Json): GameEvent[] {
  const ids = installationIds(payload);
  if (!ids || (payload.action !== 'added' && payload.action !== 'removed')) {
    return [];
  }
  return [
    {
      kind: 'installation_repositories',
      ...ids,
      added: repositoryIds(payload.repositories_added),
      removed: repositoryIds(payload.repositories_removed),
    },
  ];
}

/**
 * Turn one webhook delivery into zero or more `GameEvent`s.
 *
 * @param eventName the `X-GitHub-Event` header
 * @param payload   the parsed JSON body (untrusted)
 * @returns events carrying only allow-listed fields; `[]` for actions we ignore or malformed payloads
 */
export function normalize(eventName: string, payload: unknown): GameEvent[] {
  const body = asObject(payload);
  if (!body) {
    return [];
  }
  switch (eventName) {
    case 'pull_request':
      return normalizePullRequest(body);
    case 'pull_request_review':
      return normalizeReview(body);
    case 'pull_request_review_comment':
      return normalizeReviewComment(body);
    case 'installation':
      return normalizeInstallation(body);
    case 'installation_repositories':
      return normalizeInstallationRepositories(body);
    default:
      return [];
  }
}
