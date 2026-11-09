import {
  ACT_WINDOW_UTC_DAYS,
  CAPS,
  MONSTER_RULES,
  NON_DEFAULT_BRANCH_MULTIPLIER,
  POINTS,
  SIZE_POINTS,
  SIZE_TIER_LOC,
  SOLO_KILL_MULTIPLIER,
  SUPPLY_DROPS,
} from './constants';
import type { ActId } from './constants';
import { levelFor } from './d2table';
import { computePower, powerBreakdown } from './power';
import { emptySkillXp, SKILL_LABELS, SKILLS } from './skills';
import type {
  BreakdownLine,
  CounterUpdates,
  GameEvent,
  MonsterId,
  PlayerState,
  PRMergedEvent,
  PROpenedEvent,
  PRState,
  ReviewCommentCreatedEvent,
  ReviewerCounters,
  ReviewSubmittedEvent,
  ScoreResult,
  Skill,
  SkipReason,
  Supplies,
  VerifiedKillEvent,
  WeeklyStreakEvent,
} from './types';

const DAY_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------------------------
// Small pure helpers (exported: the client previews and the tests use them)
// ---------------------------------------------------------------------------------------------

/** UTC calendar day of an epoch-millisecond instant, `YYYY-MM-DD`. */
export function utcDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

/** Calendar window of the weekly run an instant falls in: Mon-Tue scout, Wed-Thu raid, Fri-Sun boss. */
export function actWindow(now: number): ActId {
  const weekday = new Date(now).getUTCDay();
  if (ACT_WINDOW_UTC_DAYS.scout.includes(weekday)) {
    return 'scout';
  }
  return ACT_WINDOW_UTC_DAYS.raid.includes(weekday) ? 'raid' : 'boss';
}

/** Size points on merge: `min(120, round(40 * log2(1 + lines / 50)))`. */
export function sizePoints(linesChanged: number): number {
  return Math.min(
    SIZE_POINTS.max,
    Math.round(SIZE_POINTS.scale * Math.log2(1 + linesChanged / SIZE_POINTS.divisor)),
  );
}

/** Size tier 0 to 3 for the Ore drop. */
export function sizeTier(linesChanged: number): number {
  return SIZE_TIER_LOC.filter((threshold) => linesChanged >= threshold).length;
}

/** Zone multiplier `(level + 1) ^ exponent`. */
export function zoneFor(level: number, exponent: number): number {
  return Math.pow(level + 1, exponent);
}

/** Weekly streak points for `weeks` consecutive weeks: 50 per week, the week count capped at 10. */
export function streakPoints(weeks: number): number {
  return POINTS.streakPerWeek * Math.min(CAPS.streakWeeks, weeks);
}

// ---------------------------------------------------------------------------------------------
// Internal model
// ---------------------------------------------------------------------------------------------

/** One additive points term before multipliers. */
interface Term {
  label: string;
  points: number;
  /** Halved when the merge is a solo kill. */
  solo?: boolean;
}

interface Scored {
  skill: Skill;
  terms: Term[];
  soloKill: boolean;
  supplies: Partial<Supplies>;
  counters: CounterUpdates;
  monster: MonsterId | null;
}

interface Skipped {
  skip: SkipReason;
  counters: CounterUpdates;
}

type Outcome = Scored | Skipped;

function noUpdates(): CounterUpdates {
  return { player: {}, pr: {} };
}

function skipped(skip: SkipReason, counters: CounterUpdates = noUpdates()): Skipped {
  return { skip, counters };
}

function zeroSupplies(): Supplies {
  return { ore: 0, timber: 0, lore: 0, ink: 0, provisions: 0, flux: 0 };
}

function reviewerCountersFor(pr: PRState, reviewerId: number): ReviewerCounters {
  return pr.reviewerCounters[String(reviewerId)] ?? { decisions: 0, comments: 0, inline: 0 };
}

/** Facts the monster choice needs. */
interface MonsterContext {
  merged: boolean;
  /** Inline comments by the reviewing actor on the PR after this event; null when not a review event. */
  inlineAfter: number | null;
  reviewRounds: number;
  syncCount: number;
  linesChanged: number;
  openedAt: string | null;
  mergedAt: string | null;
  /** Reviews recorded on the PR. */
  reviewCount: number;
}

function monsterContext(pr: PRState, overrides: Partial<MonsterContext>): MonsterContext {
  return {
    merged: false,
    inlineAfter: null,
    reviewRounds: pr.reviewRoundCount,
    syncCount: pr.syncCount,
    linesChanged: pr.additions + pr.deletions,
    openedAt: null,
    mergedAt: null,
    reviewCount: pr.reviews.length,
    ...overrides,
  };
}

/** Bestiary rules from design.md section 7.1, most specific first. Merge Goblin is the default. */
function chooseMonster(ctx: MonsterContext, player: PlayerState, now: number): MonsterId {
  const window = actWindow(now);
  if (ctx.merged && window === 'boss' && player.moguls.current !== null) {
    return player.moguls.current;
  }
  if (ctx.inlineAfter !== null && ctx.inlineAfter >= MONSTER_RULES.nitpickInlineComments) {
    return 'nitpick-imp';
  }
  if (ctx.reviewRounds >= MONSTER_RULES.hydraReviewRounds) {
    return 'rebase-hydra';
  }
  if (ctx.merged && ctx.openedAt !== null && ctx.mergedAt !== null) {
    const openDays = (Date.parse(ctx.mergedAt) - Date.parse(ctx.openedAt)) / DAY_MS;
    if (openDays > MONSTER_RULES.scopeCreepDays) {
      return 'scope-creep';
    }
  }
  if (ctx.merged && window === 'raid' && ctx.reviewCount === 0) {
    return 'silent-monolith';
  }
  if (ctx.syncCount >= MONSTER_RULES.flakyPushes) {
    return 'flaky-test-wraith';
  }
  if (ctx.merged && ctx.linesChanged >= MONSTER_RULES.golemLoc) {
    return 'legacy-golem';
  }
  return 'merge-goblin';
}

// ---------------------------------------------------------------------------------------------
// Per-event scoring: each returns the base terms, supplies and counter changes
// ---------------------------------------------------------------------------------------------

function scoreOpened(event: PROpenedEvent, player: PlayerState, pr: PRState, now: number): Outcome {
  if (event.pr.draft) {
    return skipped('draft');
  }
  const today = utcDay(now);
  const opensToday = player.counters.opens.day === today ? player.counters.opens.count : 0;
  if (opensToday >= CAPS.opensPerDay) {
    return skipped('cap');
  }
  const stats = event.pr.stats;
  return {
    skill: 'smithing',
    terms: [{ label: 'PR opened', points: POINTS.opened }],
    soloKill: false,
    supplies: {},
    counters: { player: { opens: { day: today, count: opensToday + 1 } }, pr: {} },
    monster: chooseMonster(
      monsterContext(pr, { linesChanged: stats ? stats.additions + stats.deletions : 0 }),
      player,
      now,
    ),
  };
}

function scoreMerged(event: PRMergedEvent, player: PlayerState, pr: PRState, now: number): Outcome {
  if (!event.pr.merged) {
    return skipped('not_scoring');
  }
  const otherReviews = pr.reviews.filter((review) => review.reviewerId !== event.actor.id);
  const soloKill =
    event.pr.mergedBy !== null &&
    event.pr.mergedBy.id === event.pr.author.id &&
    otherReviews.length === 0;
  const party = otherReviews.some((review) => review.state === 'APPROVED');
  const riposte = otherReviews.some((review) => review.state === 'CHANGES_REQUESTED');
  const stats = event.pr.stats ?? pr;
  const lines = stats.additions + stats.deletions;
  const size = sizePoints(lines);

  const terms: Term[] = [{ label: 'PR merged', points: POINTS.merged, solo: true }];
  if (size > 0) {
    terms.push({ label: `Size (log-scaled, ${lines} lines)`, points: size, solo: true });
  }
  const supplies: Partial<Supplies> = {
    ore: SUPPLY_DROPS.mergeOreBase + sizeTier(lines),
    timber: SUPPLY_DROPS.mergeTimber,
  };
  if (party) {
    terms.push({ label: 'Reviewed by another human', points: POINTS.party, solo: true });
    supplies.provisions = SUPPLY_DROPS.partyProvisions;
  }
  if (riposte) {
    terms.push({ label: 'Riposte (feedback addressed)', points: POINTS.riposte });
    supplies.flux = SUPPLY_DROPS.riposteFlux;
  }
  return {
    skill: 'smithing',
    terms,
    soloKill,
    supplies,
    counters: noUpdates(),
    monster: chooseMonster(
      monsterContext(pr, {
        merged: true,
        linesChanged: lines,
        openedAt: event.pr.openedAt,
        mergedAt: event.pr.mergedAt,
      }),
      player,
      now,
    ),
  };
}

function scoreReview(
  event: ReviewSubmittedEvent,
  player: PlayerState,
  pr: PRState,
  now: number,
): Outcome {
  const reviewerId = event.actor.id;
  const current = reviewerCountersFor(pr, reviewerId);
  const decision = event.state !== 'COMMENTED';
  const reviewRounds =
    event.state === 'CHANGES_REQUESTED' ? pr.reviewRoundCount + 1 : pr.reviewRoundCount;
  // The review is recorded whether or not it scores; only the caps decide the points.
  const counters: CounterUpdates = {
    player: {},
    pr: { review: { reviewerId, state: event.state }, reviewRoundCount: reviewRounds },
  };
  const capped = decision
    ? current.decisions >= CAPS.decisionReviewsPerPrPerReviewer
    : current.comments >= CAPS.commentReviewsPerPrPerReviewer;
  if (capped) {
    return skipped('cap', counters);
  }
  counters.pr.reviewerCounters = {
    reviewerId,
    counters: decision
      ? { ...current, decisions: current.decisions + 1 }
      : { ...current, comments: current.comments + 1 },
  };
  const stateLabel = {
    APPROVED: 'approved',
    CHANGES_REQUESTED: 'changes requested',
    COMMENTED: 'comment',
  }[event.state];
  return {
    skill: 'vigilance',
    terms: [
      {
        label: `Review: ${stateLabel}`,
        points: decision ? POINTS.reviewDecision : POINTS.reviewComment,
      },
    ],
    soloKill: false,
    supplies: {
      lore: decision ? SUPPLY_DROPS.reviewDecisionLore : SUPPLY_DROPS.reviewCommentLore,
    },
    counters,
    monster: chooseMonster(
      monsterContext(pr, { inlineAfter: current.inline, reviewRounds }),
      player,
      now,
    ),
  };
}

function scoreInlineComment(
  event: ReviewCommentCreatedEvent,
  player: PlayerState,
  pr: PRState,
  now: number,
): Outcome {
  const reviewerId = event.actor.id;
  const current = reviewerCountersFor(pr, reviewerId);
  if (current.inline >= CAPS.inlineCommentsPerPrPerReviewer) {
    return skipped('cap');
  }
  const inlineAfter = current.inline + 1;
  return {
    skill: 'oratory',
    terms: [{ label: 'Inline comment', points: POINTS.inlineComment }],
    soloKill: false,
    supplies: current.inline < SUPPLY_DROPS.inkCapPerPr ? { ink: SUPPLY_DROPS.inlineInk } : {},
    counters: {
      player: {},
      pr: { reviewerCounters: { reviewerId, counters: { ...current, inline: inlineAfter } } },
    },
    monster: chooseMonster(monsterContext(pr, { inlineAfter }), player, now),
  };
}

function scoreVerifiedKill(
  event: VerifiedKillEvent,
  player: PlayerState,
  pr: PRState,
  now: number,
): Outcome {
  if (!event.pr.merged) {
    return skipped('not_scoring');
  }
  const stats = event.pr.stats ?? pr;
  return {
    skill: 'vigilance',
    terms: [{ label: 'Verified kill (a PR you approved merged)', points: POINTS.verifiedKill }],
    soloKill: false,
    supplies: {},
    counters: noUpdates(),
    monster: chooseMonster(
      monsterContext(pr, {
        merged: true,
        linesChanged: stats.additions + stats.deletions,
        openedAt: event.pr.openedAt,
        mergedAt: event.pr.mergedAt,
      }),
      player,
      now,
    ),
  };
}

function scoreStreak(event: WeeklyStreakEvent, player: PlayerState): Outcome {
  if (!event.qualified) {
    return skipped('not_scoring', { player: { streakWeeks: 0 }, pr: {} });
  }
  const weeks = player.counters.streakWeeks + 1;
  return {
    skill: 'endurance',
    terms: [
      {
        label: `Weekly streak (${Math.min(CAPS.streakWeeks, weeks)} x ${POINTS.streakPerWeek})`,
        points: streakPoints(weeks),
      },
    ],
    soloKill: false,
    supplies: {},
    counters: { player: { streakWeeks: weeks }, pr: {} },
    monster: null,
  };
}

/** Route an event to its handler after the exclusions that apply to every event. */
function classify(event: GameEvent, player: PlayerState, pr: PRState, now: number): Outcome {
  if (event.kind === 'pr_synchronized') {
    // Counted for the Flaky Test Wraith and never scored, whoever pushed.
    return skipped('not_scoring', { player: {}, pr: { syncCount: pr.syncCount + 1 } });
  }
  if (
    event.kind === 'pr_closed' ||
    event.kind === 'installation' ||
    event.kind === 'installation_repositories'
  ) {
    return skipped('not_scoring');
  }
  if (event.actor.isBot) {
    return skipped('bot');
  }
  switch (event.kind) {
    case 'weekly_streak':
      return scoreStreak(event, player);
    case 'pr_opened':
      return scoreOpened(event, player, pr, now);
    case 'pr_merged':
      return scoreMerged(event, player, pr, now);
    case 'review_submitted':
      return event.actor.id === event.pr.author.id
        ? skipped('own_pr')
        : scoreReview(event, player, pr, now);
    case 'review_comment_created':
      // Replying to feedback on your own PR is not reviewing.
      return event.actor.id === event.pr.author.id
        ? skipped('own_pr')
        : scoreInlineComment(event, player, pr, now);
    case 'verified_kill':
      return event.actor.id === event.pr.author.id
        ? skipped('own_pr')
        : scoreVerifiedKill(event, player, pr, now);
  }
}

// ---------------------------------------------------------------------------------------------
// score()
// ---------------------------------------------------------------------------------------------

function modifierSuffix(modifiers: string[]): string {
  return modifiers.length > 0 ? ` (${modifiers.join(', ')})` : '';
}

/**
 * Score one event for one player. Pure: no I/O, no clock (`now` is epoch milliseconds), no mutation.
 *
 * `XP = floor(Points x Power x Zone)` with Zone `(level + 1) ^ exponent` at the level the player has
 * before this event (Requirements 4.2 to 4.8, design.md 4.2 to 4.4). The caller persists `xp`, `skillXp`
 * and `counterUpdates` even when `skip` is set (a skipped review still records the review).
 *
 * @param event  normalised webhook event, or a synthetic one (`verified_kill`, `weekly_streak`)
 * @param player the credited player's state before the event
 * @param pr     the PR's state before the event; pass `createPRState(event.pr)` for an unseen PR
 * @param now    epoch milliseconds; decides the UTC day for caps and the act window for monsters
 */
export function score(
  event: GameEvent,
  player: PlayerState,
  pr: PRState,
  now: number,
): ScoreResult {
  const outcome = classify(event, player, pr, now);
  const level = levelFor(player.xp);
  const zone = zoneFor(level, player.zoneExponent);
  const power = computePower(player);

  if ('skip' in outcome) {
    return {
      skip: outcome.skip,
      points: 0,
      power,
      zone,
      level,
      xp: 0,
      skill: null,
      skillXp: emptySkillXp(),
      supplies: zeroSupplies(),
      monster: null,
      breakdown: [],
      counterUpdates: outcome.counters,
    };
  }

  // Multipliers: every point of a PR is halved off the default branch; merge, size and party points
  // are also halved on a solo kill. Each term is floored so the breakdown lines add up to `points`.
  const offDefaultBranch = 'pr' in event && !event.pr.baseRefIsDefault;
  const breakdown: BreakdownLine[] = [];
  let points = 0;
  for (const term of outcome.terms) {
    const modifiers: string[] = [];
    let multiplier = 1;
    if (outcome.soloKill && term.solo) {
      multiplier *= SOLO_KILL_MULTIPLIER;
      modifiers.push(`solo kill x${SOLO_KILL_MULTIPLIER}`);
    }
    if (offDefaultBranch) {
      multiplier *= NON_DEFAULT_BRANCH_MULTIPLIER;
      modifiers.push(`non-default branch x${NON_DEFAULT_BRANCH_MULTIPLIER}`);
    }
    const value = Math.floor(term.points * multiplier);
    points += value;
    breakdown.push({ label: term.label + modifierSuffix(modifiers), value, kind: 'points' });
  }

  // Daily first event: the first scored event of each UTC day earns +20 for Endurance. The weekly
  // streak is rollover bookkeeping, not play, so it neither claims nor needs the bonus.
  const today = utcDay(now);
  const counterUpdates = outcome.counters;
  const supplies = { ...zeroSupplies(), ...outcome.supplies };
  let dailyPoints = 0;
  if (event.kind !== 'weekly_streak' && player.counters.dailyFirstDay !== today) {
    dailyPoints = POINTS.dailyFirst;
    points += dailyPoints;
    breakdown.push({ label: 'First event of the day', value: dailyPoints, kind: 'points' });
    counterUpdates.player.dailyFirstDay = today;
    supplies.provisions += SUPPLY_DROPS.dailyFirstProvisions;
  }

  const xp = Math.floor(points * power * zone);
  const dailyXp = Math.floor(dailyPoints * power * zone);
  const skillXp = emptySkillXp();
  skillXp[outcome.skill] = xp - dailyXp;
  skillXp.endurance += dailyXp;

  breakdown.push(...powerBreakdown(player));
  breakdown.push({ label: `Zone (level ${level})`, value: zone, kind: 'zone' });
  breakdown.push({ label: 'XP', value: xp, kind: 'xp' });
  for (const skill of SKILLS) {
    if (skillXp[skill] > 0) {
      breakdown.push({ label: `${SKILL_LABELS[skill]} XP`, value: skillXp[skill], kind: 'xp' });
    }
  }

  return {
    skip: null,
    points,
    power,
    zone,
    level,
    xp,
    skill: outcome.skill,
    skillXp,
    supplies,
    monster: outcome.monster,
    breakdown,
    counterUpdates,
  };
}
