/** Builders shared by the unit tests. Not part of the package API and not exported from index.ts. */
import { charmDefinition, makeCharm } from './charms';
import type { CharmId } from './charms';
import { D2_XP } from './d2table';
import { createPlayerState, createPRState } from './state';
import { utcDay } from './calendar';
import type {
  Charm,
  EventActor,
  PlayerState,
  PRClosedEvent,
  PRMergedEvent,
  PROpenedEvent,
  PRState,
  PRSynchronizedEvent,
  PullRequestFacts,
  ReviewCommentCreatedEvent,
  ReviewState,
  RunState,
  ReviewSubmittedEvent,
  VerifiedKillEvent,
} from './types';

/** Monday 2026-11-09 12:00 UTC: inside the Scout window. */
export const NOW = Date.UTC(2026, 10, 9, 12, 0, 0);
/** Wednesday 2026-11-11 12:00 UTC: Raid window. */
export const RAID_NOW = Date.UTC(2026, 10, 11, 12, 0, 0);
/** Friday 2026-11-13 12:00 UTC: Boss window. */
export const BOSS_NOW = Date.UTC(2026, 10, 13, 12, 0, 0);

export const AUTHOR_ID = 1;
export const REVIEWER_ID = 2;
export const OTHER_REVIEWER_ID = 3;

export function human(id: number): EventActor {
  return { id, isBot: false };
}

export function bot(id: number): EventActor {
  return { id, isBot: true };
}

export function facts(overrides: Partial<PullRequestFacts> = {}): PullRequestFacts {
  return {
    installationId: 5001,
    repoId: 1001,
    repoPrivate: false,
    number: 7,
    author: human(AUTHOR_ID),
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

/** A merged PR, merged by its author unless `mergedBy` says otherwise. */
export function mergedFacts(overrides: Partial<PullRequestFacts> = {}): PullRequestFacts {
  return facts({
    merged: true,
    mergedBy: human(AUTHOR_ID),
    mergedAt: '2026-11-09T11:00:00Z',
    closedAt: '2026-11-09T11:00:00Z',
    ...overrides,
  });
}

export function openedEvent(
  pr: PullRequestFacts = facts(),
  trigger: PROpenedEvent['trigger'] = 'opened',
): PROpenedEvent {
  return { kind: 'pr_opened', actor: pr.author, trigger, pr };
}

export function mergedEvent(
  pr: PullRequestFacts = mergedFacts(),
  actor: EventActor = pr.author,
): PRMergedEvent {
  return { kind: 'pr_merged', actor, pr };
}

export function closedEvent(
  pr: PullRequestFacts = facts({ closedAt: '2026-11-09T11:00:00Z' }),
): PRClosedEvent {
  return { kind: 'pr_closed', actor: pr.author, pr };
}

export function syncEvent(pr: PullRequestFacts = facts()): PRSynchronizedEvent {
  return { kind: 'pr_synchronized', actor: pr.author, pr };
}

export function reviewEvent(
  state: ReviewState,
  actor: EventActor = human(REVIEWER_ID),
  pr: PullRequestFacts = facts(),
): ReviewSubmittedEvent {
  return { kind: 'review_submitted', actor, state, submittedAt: '2026-11-09T10:00:00Z', pr };
}

export function inlineEvent(
  actor: EventActor = human(REVIEWER_ID),
  pr: PullRequestFacts = facts(),
): ReviewCommentCreatedEvent {
  return { kind: 'review_comment_created', actor, pr };
}

export function verifiedKill(
  actor: EventActor = human(REVIEWER_ID),
  pr: PullRequestFacts = mergedFacts(),
): VerifiedKillEvent {
  return { kind: 'verified_kill', actor, pr };
}

/** A level-1 player whose daily first-event bonus is already claimed today, so only the event scores. */
export function settledPlayer(
  id: number = AUTHOR_ID,
  overrides: Partial<PlayerState> = {},
): PlayerState {
  const base = createPlayerState(id);
  return {
    ...base,
    counters: { ...base.counters, dailyFirstDay: utcDay(NOW) },
    ...overrides,
  };
}

/** A settled player standing exactly at `level`. */
export function playerAtLevel(
  level: number,
  id: number = AUTHOR_ID,
  overrides: Partial<PlayerState> = {},
): PlayerState {
  return settledPlayer(id, { xp: D2_XP[level]!, ...overrides });
}

/** A held stat-only Charm (its id is not a real Charm, so no conditions apply to it). */
export function charm(power: number, name: string = `Charm ${power}`): Charm {
  return { id: `test-${name.toLowerCase().replace(/\s+/g, '-')}`, name, rarity: 'rare', power };
}

export function prStateFor(pr: PullRequestFacts, overrides: Partial<PRState> = {}): PRState {
  return { ...createPRState(pr), ...overrides };
}

/** A held copy of a real Charm (`copies` 2 for a stack). */
export function held(id: CharmId, copies?: number): Charm {
  const base = makeCharm(charmDefinition(id)!);
  return copies === undefined ? base : { ...base, copies };
}

/** A fresh weekly run for tests: Scout act, nothing cleared, shop closed. */
export function makeRun(overrides: Partial<RunState> = {}): RunState {
  return {
    weekKey: '2026-46',
    act: 'scout',
    clearedActs: [],
    weeklyXp: 0,
    targets: { scout: 1200, raid: 2000, boss: 3000 },
    mogul: 'turtleneck',
    hand: [],
    played: [],
    shopSeed: 12345,
    shop: null,
    ...overrides,
  };
}
