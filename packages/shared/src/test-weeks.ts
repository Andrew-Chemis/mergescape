/**
 * Fixture weeks and a week simulator for the onboarding tuning (game-design.md section 10, task 24).
 * Not part of the package API and not exported from index.ts. The simulator uses only the real rules:
 * `startRun`, `score`, `applyScoreResult`, `addWeeklyXp` and `clearAct`, in the order the backend runs them
 * for every scored event, so what it reports is what a player would see.
 */
import { DAY_MS } from './calendar';
import type { ActId } from './constants';
import { levelFor } from './d2table';
import { addWeeklyXp, clearAct, playerWithRun, runWithPlayer, startRun } from './run';
import { score } from './score';
import { applyScoreResult, createPlayerState } from './state';
import {
  facts,
  human,
  inlineEvent,
  mergedEvent,
  mergedFacts,
  prStateFor,
  reviewEvent,
} from './test-builders';
import type { GameEvent, MogulId, PlayerState, PRState, PullRequestFacts, RunState } from './types';

/** Monday 2026-11-09 00:00 UTC, the start of the first fixture week. */
export const WEEK_ONE = Date.UTC(2026, 10, 9, 0, 0, 0);

export const NEW_PLAYER_ID = 100;
/** The human who approves the player's merges. */
export const APPROVER_ID = 2;
/** The people whose PRs the player reviews. */
const AUTHOR_BASE = 500;

/** One scored occurrence: what happened, the PR's state before it, and when (epoch ms). */
export interface FixtureEvent {
  at: number;
  event: GameEvent;
  pr: PRState;
}

/** Epoch milliseconds of `day` (0 = Monday) at `hour:00` UTC in the week that starts at `weekStart`. */
function at(weekStart: number, day: number, hour: number): number {
  return weekStart + day * DAY_MS + hour * 3_600_000;
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

/** A merge of the player's own PR, approved by another human who left a couple of inline comments. */
function approvedMerge(
  weekStart: number,
  number: number,
  day: number,
  hour: number,
  lines: number,
): FixtureEvent {
  const when = at(weekStart, day, hour);
  const pr: PullRequestFacts = mergedFacts({
    number,
    author: human(NEW_PLAYER_ID),
    mergedBy: human(NEW_PLAYER_ID),
    stats: {
      additions: Math.round(lines * 0.8),
      deletions: Math.round(lines * 0.2),
      changedFiles: 4,
      commits: 3,
    },
    openedAt: iso(when - 20 * 3_600_000),
    mergedAt: iso(when),
    closedAt: iso(when),
  });
  return {
    at: when,
    event: mergedEvent(pr),
    pr: prStateFor(pr, {
      reviews: [{ reviewerId: APPROVER_ID, state: 'APPROVED', submittedAt: iso(when - 3_600_000) }],
      reviewerCounters: { [String(APPROVER_ID)]: { decisions: 1, comments: 0, inline: 2 } },
    }),
  };
}

/** The player approving somebody else's PR. */
function approval(
  weekStart: number,
  number: number,
  day: number,
  hour: number,
  lines: number,
): FixtureEvent {
  const when = at(weekStart, day, hour);
  const pr = facts({
    number,
    author: human(AUTHOR_BASE + number),
    stats: { additions: lines, deletions: 0, changedFiles: 3, commits: 2 },
    openedAt: iso(when - 5 * 3_600_000),
  });
  return {
    at: when,
    event: { ...reviewEvent('APPROVED', human(NEW_PLAYER_ID), pr), submittedAt: iso(when) },
    pr: prStateFor(pr),
  };
}

/** An approval that follows `inline` inline comments, the way a careful reviewer works. */
function thoroughApproval(
  weekStart: number,
  number: number,
  day: number,
  hour: number,
  lines: number,
  inline: number,
): FixtureEvent[] {
  const when = at(weekStart, day, hour);
  const pr = facts({
    number,
    author: human(AUTHOR_BASE + number),
    stats: { additions: lines, deletions: 0, changedFiles: 6, commits: 4 },
    openedAt: iso(when - 5 * 3_600_000),
  });
  const comments: FixtureEvent[] = [];
  let state = prStateFor(pr);
  for (let index = 0; index < inline; index += 1) {
    comments.push({
      at: when - (inline - index) * 60_000,
      event: inlineEvent(human(NEW_PLAYER_ID), pr),
      pr: state,
    });
    state = {
      ...state,
      reviewerCounters: {
        [String(NEW_PLAYER_ID)]: { decisions: 0, comments: 0, inline: index + 1 },
      },
    };
  }
  return [
    ...comments,
    {
      at: when,
      event: { ...reviewEvent('APPROVED', human(NEW_PLAYER_ID), pr), submittedAt: iso(when) },
      pr: state,
    },
  ];
}

/**
 * A modest first week: 3 merges, each approved by another human, and 5 reviews of other people's work,
 * spread over Monday to Friday (game-design.md section 10).
 */
export function modestWeek(weekStart: number = WEEK_ONE): FixtureEvent[] {
  return [
    approval(weekStart, 1, 0, 14, 90),
    approvedMerge(weekStart, 11, 1, 10, 120),
    approval(weekStart, 2, 1, 15, 60),
    approval(weekStart, 3, 2, 11, 140),
    approvedMerge(weekStart, 12, 2, 16, 60),
    approval(weekStart, 4, 3, 9, 200),
    approvedMerge(weekStart, 13, 4, 13, 200),
    approval(weekStart, 5, 4, 15, 80),
  ];
}

/**
 * A power user's week: 9 approved merges and 18 reviews (a few of them thorough, with inline comments),
 * five working days.
 */
export function powerWeek(weekStart: number = WEEK_ONE): FixtureEvent[] {
  const events: FixtureEvent[] = [];
  let merge = 100;
  let review = 100;
  const days: [number, number, number][] = [
    // day, merges, reviews
    [0, 2, 4],
    [1, 2, 4],
    [2, 2, 4],
    [3, 2, 3],
    [4, 1, 3],
  ];
  for (const [day, merges, reviews] of days) {
    for (let index = 0; index < merges; index += 1) {
      merge += 1;
      events.push(approvedMerge(weekStart, merge, day, 10 + index * 4, 80 + ((merge * 37) % 220)));
    }
    for (let index = 0; index < reviews; index += 1) {
      review += 1;
      if (index === 0) {
        events.push(...thoroughApproval(weekStart, review, day, 9, 400, 3));
      } else {
        events.push(approval(weekStart, review, day, 11 + index * 2, 60 + ((review * 53) % 240)));
      }
    }
  }
  return events.sort((a, b) => a.at - b.at);
}

/** What happened to a run as a week was played. */
export interface WeekOutcome {
  /** The acts cleared, in order, each with the weekly XP at the clear. */
  clears: { act: ActId; xp: number; day: number }[];
  /** Weekly XP at the end of the week. */
  weeklyXp: number;
  /** The act still to be played when the week ended; null after the Boss cleared. */
  actAtEnd: ActId | null;
  /** The player after the week: XP, level, Renown and gold carry into the next one. */
  player: PlayerState;
  run: RunState;
  level: number;
}

export interface SimulateInput {
  player?: PlayerState;
  /** Monday 00:00 UTC of the week to play. */
  weekStart: number;
  /** Weekly XP of every closed week, oldest first. */
  history: readonly number[];
  events: readonly FixtureEvent[];
  /** Force the week's Mogul (the draw is random in production). */
  mogul?: MogulId;
  seed?: number;
}

/** Play one week of fixture events through the real run rules. */
export function simulateWeek(input: SimulateInput): WeekOutcome {
  const started = startRun({
    player: input.player ?? createPlayerState(NEW_PLAYER_ID),
    now: input.weekStart + 5 * 60_000,
    seed: input.seed ?? 4242,
    history: input.history,
  });
  let run = input.mogul ? { ...started.run, mogul: input.mogul } : started.run;
  let player = playerWithRun(started.player, run);
  const clears: WeekOutcome['clears'] = [];
  for (const entry of [...input.events].sort((a, b) => a.at - b.at)) {
    const result = score(entry.event, player, entry.pr, entry.at);
    const applied = applyScoreResult(player, entry.pr, result);
    run = runWithPlayer(addWeeklyXp(run, result.xp), applied.player);
    player = applied.player;
    // The backend calls clearAct once after each scored event adds its XP.
    const cleared = clearAct(run, player);
    if (cleared) {
      run = cleared.run;
      player = cleared.player;
      clears.push({
        act: cleared.clear.act,
        xp: run.weeklyXp,
        day: Math.floor((entry.at - input.weekStart) / DAY_MS),
      });
    }
  }
  return {
    clears,
    weeklyXp: run.weeklyXp,
    actAtEnd: run.act,
    player,
    run,
    level: levelFor(player.xp),
  };
}
