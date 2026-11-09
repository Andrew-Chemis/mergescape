import {
  DECK_CAP,
  PLEDGE_HAND_SIZE,
  PLEDGE_PLAY_LIMIT,
  PLEDGE_PLAY_WINDOW_DAYS,
  PLEDGE_RULES,
  STARTER_DECK_IDS,
} from './constants';
import { DAY_MS, weekStartUtc } from './calendar';
import { eventLines, mergeFacts } from './facts';
import type { MergeFacts } from './facts';
import { tidy } from './math';
import { mulberry32, shuffle } from './rng';
import type {
  GameEvent,
  PlayerState,
  Pledge,
  PledgeLoadout,
  PointsBonus,
  PointsFactor,
  PowerContext,
  PRState,
  Result,
  RunState,
} from './types';

/**
 * Pledges (Requirement 9.2 to 9.4, design.md 6.4): weekly contract cards. The deck starts with five, the
 * run draws a hand of 5 without replacement, the player plays up to 3 until Tuesday 23:59 UTC, and any
 * unplayed slots are filled from the hand in draw order afterwards. Progress is evaluated on every scored
 * merge or review; a completion bonus fires at most once per Pledge per week.
 */

export type PledgeId = 'strike' | 'defend' | 'big-game-hunter' | 'mentor' | 'tidy' | 'pair-up';

/** What a Pledge evaluator knows about a scored event. */
export interface PledgeContext {
  event: GameEvent;
  /** The PR's state before the event. */
  pr: PRState;
  /** Merge facts when the event is a merge, otherwise null. */
  merge: MergeFacts | null;
  /** The player's lifetime scored merges, across repositories. */
  playerMerges: number;
}

export interface PledgeDefinition {
  id: PledgeId;
  name: string;
  /** True for the upgraded form (Strike+). */
  upgraded: boolean;
  /** The Pledge this one upgrades, if any. */
  upgradeOf?: PledgeId;
  description: string;
  /** Qualifying events needed to complete the contract. */
  goal: number;
  /** True when this scored event counts toward the contract. */
  counts: (ctx: PledgeContext) => boolean;
  /** Points added to the completing event. */
  bonusPoints: number;
  /** Multiplier on the completing review's points (Big Game Hunter); 1 when none. */
  completionMultiplier: number;
  /** Power once complete (Defend, Mentor). */
  powerBonus: number;
  /** True when `powerBonus` applies to reviews only, false when it applies to every event. */
  powerOnReviewsOnly: boolean;
}

const isScoringReview = (ctx: PledgeContext): boolean =>
  ctx.event.kind === 'review_submitted' && ctx.event.state !== 'COMMENTED';

export const PLEDGES: readonly PledgeDefinition[] = [
  {
    id: 'strike',
    name: 'Strike',
    upgraded: false,
    description: `Merge ${PLEDGE_RULES.strike.merges} PRs this week: +${PLEDGE_RULES.strike.bonusPoints} points on the last.`,
    goal: PLEDGE_RULES.strike.merges,
    counts: (ctx) => ctx.merge !== null,
    bonusPoints: PLEDGE_RULES.strike.bonusPoints,
    completionMultiplier: 1,
    powerBonus: 0,
    powerOnReviewsOnly: false,
  },
  {
    id: 'defend',
    name: 'Defend',
    upgraded: false,
    description: `Submit ${PLEDGE_RULES.defend.reviews} scoring reviews: +${PLEDGE_RULES.defend.powerBonus} Power on all reviews for the rest of the week.`,
    goal: PLEDGE_RULES.defend.reviews,
    counts: isScoringReview,
    bonusPoints: 0,
    completionMultiplier: 1,
    powerBonus: PLEDGE_RULES.defend.powerBonus,
    powerOnReviewsOnly: true,
  },
  {
    id: 'big-game-hunter',
    name: 'Big Game Hunter',
    upgraded: false,
    description: `Review a PR of ${PLEDGE_RULES.bigGameHunter.minLoc} lines or more: that review scores x${PLEDGE_RULES.bigGameHunter.reviewMultiplier}.`,
    goal: 1,
    counts: (ctx) =>
      ctx.event.kind === 'review_submitted' &&
      eventLines(ctx.event.pr, ctx.pr) >= PLEDGE_RULES.bigGameHunter.minLoc,
    bonusPoints: 0,
    completionMultiplier: PLEDGE_RULES.bigGameHunter.reviewMultiplier,
    powerBonus: 0,
    powerOnReviewsOnly: false,
  },
  {
    id: 'mentor',
    name: 'Mentor',
    upgraded: false,
    description: `Approve ${PLEDGE_RULES.mentor.approvals} PRs from authors with fewer merges than you: +${PLEDGE_RULES.mentor.powerBonus} Power until Sunday.`,
    goal: PLEDGE_RULES.mentor.approvals,
    counts: (ctx) =>
      ctx.event.kind === 'review_submitted' &&
      ctx.event.state === 'APPROVED' &&
      (ctx.pr.authorMerges ?? 0) < ctx.playerMerges,
    bonusPoints: 0,
    completionMultiplier: 1,
    powerBonus: PLEDGE_RULES.mentor.powerBonus,
    powerOnReviewsOnly: false,
  },
  {
    id: 'tidy',
    name: 'Tidy',
    upgraded: false,
    description: `Merge ${PLEDGE_RULES.tidy.merges} PRs each under ${PLEDGE_RULES.tidy.maxLoc} lines: +${PLEDGE_RULES.tidy.bonusPoints} points on the last.`,
    goal: PLEDGE_RULES.tidy.merges,
    counts: (ctx) => ctx.merge !== null && ctx.merge.lines < PLEDGE_RULES.tidy.maxLoc,
    bonusPoints: PLEDGE_RULES.tidy.bonusPoints,
    completionMultiplier: 1,
    powerBonus: 0,
    powerOnReviewsOnly: false,
  },
  {
    id: 'pair-up',
    name: 'Pair Up',
    upgraded: true,
    upgradeOf: 'strike',
    description: `Merge ${PLEDGE_RULES.pairUp.merges} PRs each with the party bonus: +${PLEDGE_RULES.pairUp.bonusPoints} points on the last.`,
    goal: PLEDGE_RULES.pairUp.merges,
    counts: (ctx) => ctx.merge?.party === true,
    bonusPoints: PLEDGE_RULES.pairUp.bonusPoints,
    completionMultiplier: 1,
    powerBonus: 0,
    powerOnReviewsOnly: false,
  },
];

const BY_ID: ReadonlyMap<string, PledgeDefinition> = new Map(
  PLEDGES.map((pledge) => [pledge.id, pledge]),
);

export function pledgeDefinition(id: string): PledgeDefinition | undefined {
  return BY_ID.get(id);
}

/** The card form of a definition, as stored in decks, hands and runs. */
export function pledgeCard(definition: PledgeDefinition): Pledge {
  return { id: definition.id, name: definition.name, upgraded: definition.upgraded };
}

// ---------------------------------------------------------------------------------------------
// Deck
// ---------------------------------------------------------------------------------------------

/** The five Pledges every character starts with (Requirement 9.2). */
export function starterDeck(): Pledge[] {
  return STARTER_DECK_IDS.map((id) => pledgeCard(BY_ID.get(id) as PledgeDefinition));
}

/** Draw up to 5 Pledges from the deck without replacement, in draw order. Deterministic in `seed`. */
export function drawHand(deck: readonly Pledge[], seed: number): Pledge[] {
  return shuffle(deck, mulberry32(seed)).slice(0, PLEDGE_HAND_SIZE);
}

/** Add a card to the deck (cap 20). */
export function addToDeck(
  deck: readonly Pledge[],
  pledge: Pledge,
): Result<{ deck: Pledge[] }, 'deck_full'> {
  return deck.length >= DECK_CAP
    ? { ok: false, error: 'deck_full' }
    : { ok: true, deck: [...deck, pledge] };
}

/** Remove one copy of a card from the deck (the shrine). */
export function removeFromDeck(
  deck: readonly Pledge[],
  pledgeId: string,
): Result<{ deck: Pledge[]; removed: Pledge }, 'not_in_deck'> {
  const index = deck.findIndex((card) => card.id === pledgeId);
  if (index < 0) {
    return { ok: false, error: 'not_in_deck' };
  }
  return {
    ok: true,
    deck: deck.filter((_, at) => at !== index),
    removed: deck[index] as Pledge,
  };
}

/** Upgrade one copy of a card in place (Strike becomes Pair Up), e.g. as a Boss reward. */
export function upgradeInDeck(
  deck: readonly Pledge[],
  pledgeId: string,
): Result<{ deck: Pledge[] }, 'not_in_deck' | 'no_upgrade'> {
  const index = deck.findIndex((card) => card.id === pledgeId);
  if (index < 0) {
    return { ok: false, error: 'not_in_deck' };
  }
  const upgrade = PLEDGES.find((pledge) => pledge.upgradeOf === pledgeId);
  if (upgrade === undefined) {
    return { ok: false, error: 'no_upgrade' };
  }
  return { ok: true, deck: deck.map((card, at) => (at === index ? pledgeCard(upgrade) : card)) };
}

// ---------------------------------------------------------------------------------------------
// Playing the hand
// ---------------------------------------------------------------------------------------------

/** True while plays are open: until Tuesday 23:59:59 UTC of the week `now` falls in. */
export function pledgeWindowOpen(now: number): boolean {
  return now - weekStartUtc(now) < PLEDGE_PLAY_WINDOW_DAYS * DAY_MS;
}

export type PlayError = 'window_closed' | 'not_in_hand' | 'already_played' | 'play_limit';

/**
 * Play a Pledge from the hand (up to 3, one per Pledge id) while the window is open. The contract starts
 * now: only events scored after this count toward it.
 */
export function playPledge(
  run: RunState,
  player: PlayerState,
  pledgeId: string,
  now: number,
): Result<{ run: RunState; player: PlayerState }, PlayError> {
  if (!pledgeWindowOpen(now)) {
    return { ok: false, error: 'window_closed' };
  }
  const card = run.hand.find((candidate) => candidate.id === pledgeId);
  if (card === undefined) {
    return { ok: false, error: 'not_in_hand' };
  }
  if (run.played.some((played) => played.id === pledgeId)) {
    return { ok: false, error: 'already_played' };
  }
  if (run.played.length >= PLEDGE_PLAY_LIMIT) {
    return { ok: false, error: 'play_limit' };
  }
  const played = [...run.played, card];
  return {
    ok: true,
    run: { ...run, played },
    player: { ...player, pledges: { ...player.pledges, played } },
  };
}

/**
 * Once the window has closed, fill the unplayed slots (up to 3 in all) from the hand in draw order. A
 * no-op while the window is open or when nothing is left to play, so it is safe to call on every load.
 */
export function autoPlayPledges(
  run: RunState,
  player: PlayerState,
  now: number,
): { run: RunState; player: PlayerState } {
  if (pledgeWindowOpen(now)) {
    return { run, player };
  }
  const played = [...run.played];
  for (const card of run.hand) {
    if (played.length < PLEDGE_PLAY_LIMIT && !played.some((entry) => entry.id === card.id)) {
      played.push(card);
    }
  }
  if (played.length === run.played.length) {
    return { run, player };
  }
  return {
    run: { ...run, played },
    player: { ...player, pledges: { ...player.pledges, played } },
  };
}

// ---------------------------------------------------------------------------------------------
// Evaluation (called from score() for every scored event)
// ---------------------------------------------------------------------------------------------

export interface PledgeEvaluation {
  /** Multipliers on the event's own points (Big Game Hunter's x3 on the completing review). */
  factors: PointsFactor[];
  /** Completion bonuses fired by this event, as flat points. */
  bonuses: PointsBonus[];
  /** The new loadout, or null when this event moved no Pledge. */
  next: PledgeLoadout | null;
}

const NO_EVALUATION: PledgeEvaluation = { factors: [], bonuses: [], next: null };

/** The player's lifetime scored merges across repositories. */
export function lifetimeMerges(player: PlayerState): number {
  return Object.values(player.repoMerges).reduce((sum, count) => sum + count, 0);
}

/**
 * Advance every played, uncompleted Pledge this scored event counts toward. A Pledge that reaches its goal
 * is marked completed and fires its bonus on this event; it never fires again that week. Power from
 * Defend and Mentor starts with the next event (`pledgePower`).
 */
export function evaluatePledges(
  player: PlayerState,
  event: GameEvent,
  pr: PRState,
): PledgeEvaluation {
  if (event.kind !== 'pr_merged' && event.kind !== 'review_submitted') {
    return NO_EVALUATION;
  }
  const ctx: PledgeContext = {
    event,
    pr,
    merge: event.kind === 'pr_merged' ? mergeFacts(event, pr) : null,
    playerMerges: lifetimeMerges(player),
  };
  const progress: Record<string, number> = { ...player.pledges.progress };
  const completed = [...player.pledges.completed];
  const factors: PointsFactor[] = [];
  const bonuses: PointsBonus[] = [];
  let changed = false;
  for (const pledge of player.pledges.played) {
    const definition = pledgeDefinition(pledge.id);
    if (definition === undefined || completed.includes(pledge.id) || !definition.counts(ctx)) {
      continue;
    }
    changed = true;
    const count = (progress[pledge.id] ?? 0) + 1;
    progress[pledge.id] = count;
    if (count >= definition.goal) {
      completed.push(pledge.id);
      if (definition.bonusPoints > 0) {
        bonuses.push({ label: `Pledge: ${definition.name}`, points: definition.bonusPoints });
      }
      if (definition.completionMultiplier !== 1) {
        factors.push({
          label: `Pledge: ${definition.name} x${definition.completionMultiplier}`,
          factor: definition.completionMultiplier,
        });
      }
    }
  }
  return {
    factors,
    bonuses,
    next: changed ? { played: player.pledges.played, progress, completed } : null,
  };
}

/**
 * Power from completed Pledges for this event: Mentor's applies to every event, Defend's to reviews only,
 * so it needs the context. Without a context only the always-on part counts.
 */
export function pledgePower(player: PlayerState, ctx?: PowerContext): number {
  let total = 0;
  for (const id of player.pledges.completed) {
    const definition = pledgeDefinition(id);
    if (
      definition !== undefined &&
      (!definition.powerOnReviewsOnly || ctx?.event.kind === 'review_submitted')
    ) {
      total += definition.powerBonus;
    }
  }
  return tidy(total);
}
