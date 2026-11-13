import { describe, expect, it } from 'vitest';
import installationCreated from '../fixtures/webhooks/installation.created.json';
import installationDeleted from '../fixtures/webhooks/installation.deleted.json';
import installationNewPermissionsAccepted from '../fixtures/webhooks/installation.new_permissions_accepted.json';
import installationSuspend from '../fixtures/webhooks/installation.suspend.json';
import installationRepositoriesAdded from '../fixtures/webhooks/installation_repositories.added.json';
import installationRepositoriesRemoved from '../fixtures/webhooks/installation_repositories.removed.json';
import pullRequestClosedMergedByAuthor from '../fixtures/webhooks/pull_request.closed.merged-by-author.json';
import pullRequestClosedMergedBotAuthor from '../fixtures/webhooks/pull_request.closed.merged.bot-author.json';
import pullRequestClosedMergedBotBoth from '../fixtures/webhooks/pull_request.closed.merged.bot-both.json';
import pullRequestClosedMerged from '../fixtures/webhooks/pull_request.closed.merged.json';
import pullRequestClosedUnmerged from '../fixtures/webhooks/pull_request.closed.unmerged.json';
import pullRequestEdited from '../fixtures/webhooks/pull_request.edited.json';
import pullRequestOpenedDraft from '../fixtures/webhooks/pull_request.opened.draft.json';
import pullRequestOpened from '../fixtures/webhooks/pull_request.opened.json';
import pullRequestOpenedNonDefaultBranch from '../fixtures/webhooks/pull_request.opened.non-default-branch.json';
import pullRequestReadyForReview from '../fixtures/webhooks/pull_request.ready_for_review.json';
import pullRequestSynchronize from '../fixtures/webhooks/pull_request.synchronize.json';
import pullRequestReviewApproved from '../fixtures/webhooks/pull_request_review.approved.json';
import pullRequestReviewChangesRequested from '../fixtures/webhooks/pull_request_review.changes_requested.json';
import pullRequestReviewCommentedByBot from '../fixtures/webhooks/pull_request_review.commented-by-bot.json';
import pullRequestReviewCommented from '../fixtures/webhooks/pull_request_review.commented.json';
import pullRequestReviewDismissed from '../fixtures/webhooks/pull_request_review.dismissed.json';
import pullRequestReviewCommentCreatedByBot from '../fixtures/webhooks/pull_request_review_comment.created.by-bot.json';
import pullRequestReviewCommentCreated from '../fixtures/webhooks/pull_request_review_comment.created.json';
import pullRequestReviewCommentEdited from '../fixtures/webhooks/pull_request_review_comment.edited.json';
import { GAME_EVENT_KEYS, isBotAccount, MAX_REPOSITORY_IDS, normalize } from './normalize';
import { score } from './score';
import { createPlayerState, createPRState } from './state';
import { NOW } from './test-builders';
import type { EventActor, GameEvent, PullRequestFacts } from './types';

// Fake ids used throughout the fixtures (see the generator notes in the fixtures themselves).
const AUTHOR: EventActor = { id: 1001001, isBot: false };
const REVIEWER: EventActor = { id: 2002002, isBot: false };
const MERGER: EventActor = { id: 3003003, isBot: false };
const BOT: EventActor = { id: 9009009, isBot: true };
const ADMIN: EventActor = { id: 5005006, isBot: false };

function prFacts(overrides: Partial<PullRequestFacts> = {}): PullRequestFacts {
  return {
    installationId: 777001,
    repoId: 424242,
    repoPrivate: false,
    number: 17,
    author: AUTHOR,
    draft: false,
    baseRefIsDefault: true,
    stats: { additions: 100, deletions: 20, changedFiles: 4, commits: 2 },
    openedAt: '2026-11-09T09:00:00Z',
    mergedAt: null,
    closedAt: null,
    merged: false,
    mergedBy: null,
    ...overrides,
  };
}

/** Review and review-comment payloads carry a partial pull_request: no size, no merge fields. */
const partialPr = (overrides: Partial<PullRequestFacts> = {}) =>
  prFacts({ stats: null, ...overrides });
const MERGED_AT = '2026-11-09T11:00:00Z';

interface Case {
  file: string;
  eventName: string;
  payload: unknown;
  expected: GameEvent[];
}

const CASES: Case[] = [
  {
    file: 'pull_request.opened',
    eventName: 'pull_request',
    payload: pullRequestOpened,
    expected: [{ kind: 'pr_opened', actor: AUTHOR, trigger: 'opened', pr: prFacts() }],
  },
  {
    file: 'pull_request.opened.draft',
    eventName: 'pull_request',
    payload: pullRequestOpenedDraft,
    expected: [
      {
        kind: 'pr_opened',
        actor: AUTHOR,
        trigger: 'opened',
        pr: prFacts({ number: 18, draft: true }),
      },
    ],
  },
  {
    file: 'pull_request.opened.non-default-branch',
    eventName: 'pull_request',
    payload: pullRequestOpenedNonDefaultBranch,
    expected: [
      {
        kind: 'pr_opened',
        actor: AUTHOR,
        trigger: 'opened',
        pr: prFacts({ number: 19, baseRefIsDefault: false }),
      },
    ],
  },
  {
    file: 'pull_request.ready_for_review',
    eventName: 'pull_request',
    payload: pullRequestReadyForReview,
    expected: [
      {
        kind: 'pr_opened',
        actor: AUTHOR,
        trigger: 'ready_for_review',
        pr: prFacts({ number: 18 }),
      },
    ],
  },
  {
    file: 'pull_request.closed.merged',
    eventName: 'pull_request',
    payload: pullRequestClosedMerged,
    expected: [
      {
        kind: 'pr_merged',
        actor: AUTHOR,
        pr: prFacts({
          stats: { additions: 250, deletions: 50, changedFiles: 6, commits: 4 },
          merged: true,
          mergedBy: MERGER,
          mergedAt: MERGED_AT,
          closedAt: MERGED_AT,
        }),
      },
    ],
  },
  {
    file: 'pull_request.closed.merged-by-author',
    eventName: 'pull_request',
    payload: pullRequestClosedMergedByAuthor,
    expected: [
      {
        kind: 'pr_merged',
        actor: AUTHOR,
        pr: prFacts({
          number: 20,
          merged: true,
          mergedBy: AUTHOR,
          mergedAt: MERGED_AT,
          closedAt: MERGED_AT,
        }),
      },
    ],
  },
  {
    file: 'pull_request.closed.unmerged',
    eventName: 'pull_request',
    payload: pullRequestClosedUnmerged,
    expected: [
      { kind: 'pr_closed', actor: AUTHOR, pr: prFacts({ number: 21, closedAt: MERGED_AT }) },
    ],
  },
  {
    // Requirement 2.7: the bot-authored PR earns its author nothing, the human merger is credited.
    file: 'pull_request.closed.merged.bot-author',
    eventName: 'pull_request',
    payload: pullRequestClosedMergedBotAuthor,
    expected: [
      {
        kind: 'pr_merged',
        actor: MERGER,
        pr: prFacts({
          number: 22,
          author: BOT,
          merged: true,
          mergedBy: MERGER,
          mergedAt: MERGED_AT,
          closedAt: MERGED_AT,
        }),
      },
    ],
  },
  {
    file: 'pull_request.closed.merged.bot-both',
    eventName: 'pull_request',
    payload: pullRequestClosedMergedBotBoth,
    expected: [
      {
        kind: 'pr_merged',
        actor: BOT,
        pr: prFacts({
          number: 23,
          author: BOT,
          merged: true,
          mergedBy: BOT,
          mergedAt: MERGED_AT,
          closedAt: MERGED_AT,
        }),
      },
    ],
  },
  {
    file: 'pull_request.synchronize',
    eventName: 'pull_request',
    payload: pullRequestSynchronize,
    expected: [{ kind: 'pr_synchronized', actor: AUTHOR, pr: prFacts() }],
  },
  {
    file: 'pull_request.edited (ignored action)',
    eventName: 'pull_request',
    payload: pullRequestEdited,
    expected: [],
  },
  {
    file: 'pull_request_review.approved',
    eventName: 'pull_request_review',
    payload: pullRequestReviewApproved,
    expected: [
      {
        kind: 'review_submitted',
        actor: REVIEWER,
        state: 'APPROVED',
        submittedAt: '2026-11-09T10:00:00Z',
        pr: partialPr(),
      },
    ],
  },
  {
    file: 'pull_request_review.changes_requested',
    eventName: 'pull_request_review',
    payload: pullRequestReviewChangesRequested,
    expected: [
      {
        kind: 'review_submitted',
        actor: REVIEWER,
        state: 'CHANGES_REQUESTED',
        submittedAt: '2026-11-09T10:00:00Z',
        pr: partialPr(),
      },
    ],
  },
  {
    file: 'pull_request_review.commented',
    eventName: 'pull_request_review',
    payload: pullRequestReviewCommented,
    expected: [
      {
        kind: 'review_submitted',
        actor: REVIEWER,
        state: 'COMMENTED',
        submittedAt: '2026-11-09T10:00:00Z',
        pr: partialPr(),
      },
    ],
  },
  {
    file: 'pull_request_review.commented-by-bot',
    eventName: 'pull_request_review',
    payload: pullRequestReviewCommentedByBot,
    expected: [
      {
        kind: 'review_submitted',
        actor: BOT,
        state: 'COMMENTED',
        submittedAt: '2026-11-09T10:00:00Z',
        pr: partialPr(),
      },
    ],
  },
  {
    file: 'pull_request_review.dismissed (ignored action)',
    eventName: 'pull_request_review',
    payload: pullRequestReviewDismissed,
    expected: [],
  },
  {
    file: 'pull_request_review_comment.created',
    eventName: 'pull_request_review_comment',
    payload: pullRequestReviewCommentCreated,
    expected: [{ kind: 'review_comment_created', actor: REVIEWER, pr: partialPr() }],
  },
  {
    file: 'pull_request_review_comment.created.by-bot',
    eventName: 'pull_request_review_comment',
    payload: pullRequestReviewCommentCreatedByBot,
    expected: [{ kind: 'review_comment_created', actor: BOT, pr: partialPr() }],
  },
  {
    file: 'pull_request_review_comment.edited (ignored action)',
    eventName: 'pull_request_review_comment',
    payload: pullRequestReviewCommentEdited,
    expected: [],
  },
  {
    file: 'installation.created',
    eventName: 'installation',
    payload: installationCreated,
    expected: [
      {
        kind: 'installation',
        action: 'created',
        installationId: 777001,
        accountId: 5005005,
        repositoryIds: [424242, 424243],
        sender: AUTHOR,
      },
    ],
  },
  {
    file: 'installation.deleted',
    eventName: 'installation',
    payload: installationDeleted,
    expected: [
      {
        kind: 'installation',
        action: 'deleted',
        installationId: 777001,
        accountId: 5005005,
        repositoryIds: [424242],
        sender: AUTHOR,
      },
    ],
  },
  {
    file: 'installation.suspend',
    eventName: 'installation',
    payload: installationSuspend,
    expected: [
      {
        kind: 'installation',
        action: 'suspend',
        installationId: 777001,
        accountId: 5005005,
        repositoryIds: [424242],
        sender: ADMIN,
      },
    ],
  },
  {
    file: 'installation.new_permissions_accepted (ignored action)',
    eventName: 'installation',
    payload: installationNewPermissionsAccepted,
    expected: [],
  },
  {
    file: 'installation_repositories.added',
    eventName: 'installation_repositories',
    payload: installationRepositoriesAdded,
    expected: [
      {
        kind: 'installation_repositories',
        installationId: 777001,
        accountId: 5005005,
        added: [424244],
        removed: [],
        sender: AUTHOR,
      },
    ],
  },
  {
    file: 'installation_repositories.removed',
    eventName: 'installation_repositories',
    payload: installationRepositoriesRemoved,
    expected: [
      {
        kind: 'installation_repositories',
        installationId: 777001,
        accountId: 5005005,
        added: [],
        removed: [424243, 424242],
        sender: AUTHOR,
      },
    ],
  },
];

/** Every property name and every string value reachable from `value`. */
function collect(value: unknown, keys: Set<string>, strings: string[]): void {
  if (Array.isArray(value)) {
    for (const item of value as unknown[]) {
      collect(item, keys, strings);
    }
  } else if (typeof value === 'object' && value !== null) {
    for (const [key, child] of Object.entries(value)) {
      keys.add(key);
      collect(child, keys, strings);
    }
  } else if (typeof value === 'string') {
    strings.push(value);
  }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe('normalize: recorded fixtures produce the expected GameEvent[]', () => {
  it.each(CASES)('$file', ({ eventName, payload, expected }) => {
    // toEqual is recursive and strict about extra properties, so a leaked field fails here too.
    expect(normalize(eventName, payload)).toEqual(expected);
  });
});

describe('normalize: strips everything outside the allow-list (Requirements 3.1 to 3.3)', () => {
  const outputs = CASES.flatMap(({ file, eventName, payload }) =>
    normalize(eventName, payload).map((event) => ({ file, event })),
  );

  it('produces events for most fixtures', () => {
    expect(outputs.length).toBeGreaterThanOrEqual(20);
  });

  it.each(outputs)('$file has no property outside the allowed set', ({ event }) => {
    const keys = new Set<string>();
    collect(event, keys, []);
    const unexpected = [...keys].filter((key) => !GAME_EVENT_KEYS.has(key));
    expect(unexpected).toEqual([]);
  });

  it.each(outputs)('$file carries no free text, name, path, branch or URL', ({ event }) => {
    const strings: string[] = [];
    collect(event, new Set(), strings);
    const blob = JSON.stringify(event);
    for (const marker of ['SENTINEL', 'sentinel', 'example', 'http', 'main', 'release/', '[bot]']) {
      expect(blob).not.toContain(marker);
    }
    for (const value of strings) {
      expect(value).toMatch(/^[a-z_]+$|^[A-Z_]+$|^\d{4}-\d{2}-\d{2}T[\d:]+Z$/);
    }
  });

  it('the allow-list itself names no sensitive field', () => {
    for (const forbidden of [
      'title',
      'body',
      'login',
      'name',
      'path',
      'ref',
      'url',
      'label',
      'email',
    ]) {
      expect(GAME_EVENT_KEYS.has(forbidden)).toBe(false);
    }
  });

  it('extra properties injected into a payload do not change the output', () => {
    const payload = clone(pullRequestClosedMerged) as Record<string, unknown> & {
      pull_request: Record<string, unknown> & { user: Record<string, unknown> };
      repository: Record<string, unknown>;
    };
    payload.pull_request.title = 'INJECTED-TITLE';
    payload.pull_request.body = 'INJECTED-BODY';
    payload.pull_request.secret_field = { nested: 'INJECTED-NESTED' };
    payload.pull_request.user.email = 'injected@example.invalid';
    payload.repository.full_name = 'injected/private-repo';
    payload.extra = ['INJECTED-EXTRA'];
    const result = normalize('pull_request', payload);
    expect(result).toEqual(normalize('pull_request', pullRequestClosedMerged));
    expect(JSON.stringify(result)).not.toContain('INJECTED');
  });
});

describe('normalize: facts and defaults', () => {
  it('does not include the actors logins, only ids and the bot flag', () => {
    const [event] = normalize('pull_request', pullRequestOpened);
    expect(event?.kind === 'pr_opened' && Object.keys(event.actor).sort()).toEqual(['id', 'isBot']);
  });

  it('keeps the draft and ready-for-review triggers apart', () => {
    const [draft] = normalize('pull_request', pullRequestOpenedDraft);
    const [ready] = normalize('pull_request', pullRequestReadyForReview);
    expect(draft?.kind === 'pr_opened' && [draft.trigger, draft.pr.draft]).toEqual([
      'opened',
      true,
    ]);
    expect(ready?.kind === 'pr_opened' && [ready.trigger, ready.pr.draft]).toEqual([
      'ready_for_review',
      false,
    ]);
  });

  it('treats a missing private flag as private, and reads the repo id from the base repo as a fallback', () => {
    const payload = clone(pullRequestOpened) as Record<string, unknown>;
    delete payload.repository;
    const [event] = normalize('pull_request', payload);
    expect(event?.kind === 'pr_opened' && [event.pr.repoId, event.pr.repoPrivate]).toEqual([
      424242,
      true,
    ]);
  });

  it('reads the default branch from the repository when the base repo omits it', () => {
    const payload = clone(pullRequestOpenedNonDefaultBranch) as {
      pull_request: { base: { repo: Record<string, unknown> } };
    };
    delete payload.pull_request.base.repo.default_branch;
    const [event] = normalize('pull_request', payload);
    expect(event?.kind === 'pr_opened' && event.pr.baseRefIsDefault).toBe(false);
  });

  it('does not assume the default branch when the payload does not say (it fails closed)', () => {
    const payload = clone(pullRequestOpened) as { pull_request: Record<string, unknown> };
    delete payload.pull_request.base;
    const [event] = normalize('pull_request', payload);
    expect(event?.kind === 'pr_opened' && event.pr.baseRefIsDefault).toBe(false);
    const noDefault = clone(pullRequestOpened) as {
      repository: Record<string, unknown>;
      pull_request: { base: { repo: Record<string, unknown> } };
    };
    delete noDefault.repository.default_branch;
    delete noDefault.pull_request.base.repo.default_branch;
    const [other] = normalize('pull_request', noDefault);
    expect(other?.kind === 'pr_opened' && other.pr.baseRefIsDefault).toBe(false);
    const noRepositoryAtAll = clone(pullRequestOpenedNonDefaultBranch) as {
      repository?: unknown;
      pull_request: { base: { repo: Record<string, unknown> } };
    };
    delete noRepositoryAtAll.repository;
    delete noRepositoryAtAll.pull_request.base.repo.default_branch;
    const [third] = normalize('pull_request', noRepositoryAtAll);
    expect(third?.kind === 'pr_opened' && third.pr.baseRefIsDefault).toBe(false);
    // Either source of the default branch is enough, and a missing base ref is just as unverifiable.
    const onlyRepository = clone(pullRequestOpened) as {
      pull_request: { base: { repo: Record<string, unknown> } };
    };
    delete onlyRepository.pull_request.base.repo.default_branch;
    const [fourth] = normalize('pull_request', onlyRepository);
    expect(fourth?.kind === 'pr_opened' && fourth.pr.baseRefIsDefault).toBe(true);
    const noRef = clone(pullRequestOpened) as { pull_request: { base: Record<string, unknown> } };
    delete noRef.pull_request.base.ref;
    const [fifth] = normalize('pull_request', noRef);
    expect(fifth?.kind === 'pr_opened' && fifth.pr.baseRefIsDefault).toBe(false);
  });

  it('keeps a timestamp only when it is an ISO-8601 instant, else null', () => {
    const times = (value: unknown) => {
      const payload = clone(pullRequestClosedMerged) as { pull_request: Record<string, unknown> };
      payload.pull_request.created_at = value;
      payload.pull_request.merged_at = value;
      payload.pull_request.closed_at = value;
      const [event] = normalize('pull_request', payload);
      return event?.kind === 'pr_merged'
        ? [event.pr.openedAt, event.pr.mergedAt, event.pr.closedAt]
        : undefined;
    };
    for (const good of [
      '2026-11-09T11:00:00Z',
      '2026-11-09T11:00:00.123Z',
      '2026-11-09T11:00:00+02:00',
      '2026-11-09T11:00:00.123456789-05:30',
    ]) {
      expect(times(good)).toEqual([good, good, good]);
    }
    for (const bad of [
      'yesterday',
      '2026-11-09',
      '2026-11-09 11:00:00Z',
      '2026-11-09T11:00:00',
      '2026-13-09T11:00:00Z',
      '2026-11-09T25:00:00Z',
      '2026-11-09T11:00:00Z; DROP TABLE',
      `2026-11-09T11:00:00Z${'x'.repeat(10_000)}`,
      '',
      42,
      {},
      null,
    ]) {
      expect(times(bad)).toEqual([null, null, null]);
    }
  });

  it('applies the same timestamp rule to a review submission time', () => {
    const payload = clone(pullRequestReviewApproved) as { review: Record<string, unknown> };
    for (const bad of ['soon', 'x'.repeat(5000), 1_700_000_000]) {
      payload.review.submitted_at = bad;
      const [event] = normalize('pull_request_review', payload);
      expect(event?.kind === 'review_submitted' && event.submittedAt).toBeNull();
    }
  });

  it('omits stats unless all four counts are present', () => {
    const payload = clone(pullRequestOpened) as { pull_request: Record<string, unknown> };
    delete payload.pull_request.changed_files;
    const [event] = normalize('pull_request', payload);
    expect(event?.kind === 'pr_opened' && event.pr.stats).toBeNull();
  });

  it('records no installation id when the delivery has none', () => {
    const payload = clone(pullRequestOpened) as Record<string, unknown>;
    delete payload.installation;
    const [event] = normalize('pull_request', payload);
    expect(event?.kind === 'pr_opened' && event.pr.installationId).toBeNull();
  });

  it('a merge without merged_by credits the author and records no merger', () => {
    const payload = clone(pullRequestClosedMerged) as { pull_request: Record<string, unknown> };
    payload.pull_request.merged_by = null;
    const [event] = normalize('pull_request', payload);
    expect(event?.kind === 'pr_merged' && [event.actor, event.pr.mergedBy]).toEqual([AUTHOR, null]);
  });

  it('a bot-authored merge with no known merger stays with the bot author', () => {
    const payload = clone(pullRequestClosedMergedBotAuthor) as {
      pull_request: Record<string, unknown>;
    };
    payload.pull_request.merged_by = null;
    const [event] = normalize('pull_request', payload);
    expect(event?.kind === 'pr_merged' && event.actor).toEqual(BOT);
  });

  it('a payload that says closed but not merged records no merger even if merged_by is present', () => {
    const payload = clone(pullRequestClosedUnmerged) as { pull_request: Record<string, unknown> };
    payload.pull_request.merged_by = { id: 4004004, type: 'User', login: 'example-x' };
    const [event] = normalize('pull_request', payload);
    expect(event?.kind === 'pr_closed' && event.pr.mergedBy).toBeNull();
  });

  it('maps review states case-insensitively and ignores states it does not score', () => {
    for (const [raw, expected] of [
      ['APPROVED', 'APPROVED'],
      ['Changes_Requested', 'CHANGES_REQUESTED'],
    ] as const) {
      const payload = clone(pullRequestReviewApproved) as { review: Record<string, unknown> };
      payload.review.state = raw;
      const [event] = normalize('pull_request_review', payload);
      expect(event?.kind === 'review_submitted' && event.state).toBe(expected);
    }
    for (const raw of ['dismissed', 'pending', 'constructor', '__proto__', 42, null]) {
      const payload = clone(pullRequestReviewApproved) as { review: Record<string, unknown> };
      payload.review.state = raw;
      expect(normalize('pull_request_review', payload)).toEqual([]);
    }
  });

  it('accepts a review without a submitted_at timestamp', () => {
    const payload = clone(pullRequestReviewApproved) as { review: Record<string, unknown> };
    delete payload.review.submitted_at;
    const [event] = normalize('pull_request_review', payload);
    expect(event?.kind === 'review_submitted' && event.submittedAt).toBeNull();
  });

  it('only suspend and unsuspend change an installation beyond create and delete', () => {
    const payload = clone(installationSuspend) as Record<string, unknown>;
    payload.action = 'unsuspend';
    const [event] = normalize('installation', payload);
    expect(event?.kind === 'installation' && event.action).toBe('unsuspend');
  });

  it('skips malformed repository entries', () => {
    const payload = clone(installationCreated) as { repositories: unknown[] };
    payload.repositories = [{ id: 424242 }, { id: 'x' }, null, 7, { id: -1 }, { id: 1.5 }];
    const [event] = normalize('installation', payload);
    expect(event?.kind === 'installation' && event.repositoryIds).toEqual([424242]);
    const missing = clone(installationCreated) as Record<string, unknown>;
    delete missing.repositories;
    const [none] = normalize('installation', missing);
    expect(none?.kind === 'installation' && none.repositoryIds).toEqual([]);
  });

  it('caps the repository ids one event may carry', () => {
    const many = Array.from({ length: MAX_REPOSITORY_IDS + 500 }, (_, index) => ({
      id: index + 1,
    }));
    const created = clone(installationCreated) as { repositories: unknown[] };
    created.repositories = many;
    const [event] = normalize('installation', created);
    const ids = event?.kind === 'installation' ? event.repositoryIds : [];
    expect(ids).toHaveLength(MAX_REPOSITORY_IDS);
    expect(ids[0]).toBe(1);
    expect(ids.at(-1)).toBe(MAX_REPOSITORY_IDS);
    const added = clone(installationRepositoriesAdded) as { repositories_added: unknown[] };
    added.repositories_added = many;
    const [change] = normalize('installation_repositories', added);
    expect(change?.kind === 'installation_repositories' && change.added).toHaveLength(
      MAX_REPOSITORY_IDS,
    );
    // Malformed entries do not count toward the cap.
    created.repositories = [...Array.from({ length: 50 }, () => null), ...many];
    const [mixed] = normalize('installation', created);
    expect(mixed?.kind === 'installation' && mixed.repositoryIds).toHaveLength(MAX_REPOSITORY_IDS);
  });
});

describe('normalize: malformed and unknown input yields no events', () => {
  it.each([
    ['unknown event name', 'issues', pullRequestOpened],
    ['empty event name', '', pullRequestOpened],
    ['payload null', 'pull_request', null],
    ['payload string', 'pull_request', 'not an object'],
    ['payload array', 'pull_request', [pullRequestOpened]],
    ['no action', 'pull_request', {}],
    ['review event with pull_request payload shape', 'pull_request_review', pullRequestOpened],
    ['comment event without a comment', 'pull_request_review_comment', { action: 'created' }],
  ])('%s', (_name, eventName, payload) => {
    expect(normalize(eventName, payload)).toEqual([]);
  });

  const mutations: [string, (p: Record<string, unknown>) => void][] = [
    ['pull_request missing', (p: Record<string, unknown>) => delete p.pull_request],
    [
      'number missing',
      (p: Record<string, unknown>) => delete (p.pull_request as Record<string, unknown>).number,
    ],
    [
      'number negative',
      (p: Record<string, unknown>) => ((p.pull_request as Record<string, unknown>).number = -3),
    ],
    [
      'author missing',
      (p: Record<string, unknown>) => delete (p.pull_request as Record<string, unknown>).user,
    ],
    [
      'author id a string',
      (p: Record<string, unknown>) =>
        ((p.pull_request as { user: Record<string, unknown> }).user.id = '1001001'),
    ],
    [
      'repository id unusable and no base repo',
      (p: Record<string, unknown>) => {
        (p.repository as Record<string, unknown>).id = 'x';
        delete (p.pull_request as { base: Record<string, unknown> }).base.repo;
      },
    ],
  ];
  it.each(mutations)('pull_request payload with %s', (_name, mutate) => {
    const payload = clone(pullRequestOpened) as Record<string, unknown>;
    mutate(payload);
    expect(normalize('pull_request', payload)).toEqual([]);
  });

  it('a review without a user, and an installation without an account or sender, yield nothing', () => {
    const review = clone(pullRequestReviewApproved) as { review: Record<string, unknown> };
    delete review.review.user;
    expect(normalize('pull_request_review', review)).toEqual([]);
    const noReview = clone(pullRequestReviewApproved) as Record<string, unknown>;
    delete noReview.review;
    expect(normalize('pull_request_review', noReview)).toEqual([]);

    const noAccount = clone(installationCreated) as { installation: Record<string, unknown> };
    delete noAccount.installation.account;
    expect(normalize('installation', noAccount)).toEqual([]);
    const noSender = clone(installationCreated) as Record<string, unknown>;
    delete noSender.sender;
    expect(normalize('installation', noSender)).toEqual([]);
    const badRepoAction = clone(installationRepositoriesAdded) as Record<string, unknown>;
    badRepoAction.action = 'sideways';
    expect(normalize('installation_repositories', badRepoAction)).toEqual([]);
  });
});

describe('isBotAccount (Requirement 2.7)', () => {
  it('is a bot when the type is Bot or the login ends with [bot]', () => {
    expect(isBotAccount({ type: 'Bot', login: 'anything' })).toBe(true);
    expect(isBotAccount({ type: 'User', login: 'helper[bot]' })).toBe(true);
    expect(isBotAccount({ login: 'helper[bot]' })).toBe(true);
  });

  it('is not a bot otherwise', () => {
    expect(isBotAccount({ type: 'User', login: 'person' })).toBe(false);
    expect(isBotAccount({ type: 'Organization' })).toBe(false);
    expect(isBotAccount({ login: 42 })).toBe(false);
    expect(isBotAccount({ login: '[bot]x' })).toBe(false);
    expect(isBotAccount({})).toBe(false);
  });
});

describe('normalize feeds the scorer', () => {
  it('a recorded merge scores for its author, and a bot-authored merge for the human merger', () => {
    const [merge] = normalize('pull_request', pullRequestClosedMerged);
    expect(merge?.kind).toBe('pr_merged');
    if (merge?.kind === 'pr_merged') {
      const result = score(merge, createPlayerState(merge.actor.id), createPRState(merge.pr), NOW);
      expect(result.skip).toBeNull();
      expect(result.points).toBe(90 + 112 + 20);
      expect(result.monster).toBe('merge-goblin');
    }
    const [botMerge] = normalize('pull_request', pullRequestClosedMergedBotAuthor);
    expect(botMerge?.kind === 'pr_merged' && botMerge.actor.id).toBe(MERGER.id);
    const [botBoth] = normalize('pull_request', pullRequestClosedMergedBotBoth);
    if (botBoth) {
      const result = score(botBoth, createPlayerState(BOT.id), createPRState(prFacts()), NOW);
      expect(result.skip).toBe('bot');
    }
  });
});
