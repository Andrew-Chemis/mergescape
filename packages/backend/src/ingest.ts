/**
 * Webhook processing (tasks.md 7): from normalised `GameEvent`s to DynamoDB writes.
 *
 * A delivery is handled in three phases so that unlinked activity costs reads, never writes
 * (Requirement 2.5, research.md section 6):
 *
 *   1. PLAN     reads only. Resolve each actor to a linked, installation-accessible player and decide
 *               whether the event matters to anyone. Count drops.
 *   2. CLAIM    one conditional put on `DELIVERY#<id>`; a duplicate stops here (Requirement 1.5).
 *   3. EXECUTE  write the shared `PR#` records, then score and credit each player.
 *
 * Failure handling: PR records and Combat Log rows are keyed by delivery id and so are idempotent, but a
 * profile credit is not. If anything throws before the first credit, the claim is released so GitHub's
 * "Redeliver" works; after a credit the claim is kept, so a redelivery cannot credit XP twice.
 */
import {
  applyScoreResult,
  clearAct,
  createPlayerState,
  levelFor,
  lifetimeMerges,
  riposteCreditEvents,
  score,
  verifiedKillEvents,
} from '@mergescape/shared';
import type {
  EventActor,
  GameEvent,
  InstallationEvent,
  InstallationRepositoriesEvent,
  PlayerState,
  PRState,
  PullRequestEvent,
  RiposteCreditEvent,
  ScoreResult,
  VerifiedKillEvent,
} from '@mergescape/shared';
import { VersionConflictError } from './db';
import type { Db, EventRow, InstallationItem, PRBundle, ProfileItem, ScoreWrite } from './db';
import type { Logger } from './log';
import type { MetricName, Metrics } from './metrics';
import { buildPRState } from './pr-state';
import { scorerStateOf, toPlayerState } from './player';
import { loadCurrent } from './runs';
import type { RunContext } from './runs';
import { randomSeed } from './seed';

export interface IngestContext {
  db: Db;
  metrics: Metrics;
  log: Logger;
  /** Epoch milliseconds. */
  now: () => number;
  /** A fresh random uint32 for a run started lazily by a player's first event of a week. */
  newSeed?: () => number;
}

export type ProcessOutcome = 'processed' | 'duplicate' | 'dropped';

/** Optimistic-lock retries per credited event before giving up (and failing the delivery). */
const MAX_CREDIT_ATTEMPTS = 5;

/** Event kinds that can earn points; the others only maintain PR counters. */
const SCORING_KINDS: ReadonlySet<string> = new Set([
  'pr_opened',
  'pr_merged',
  'review_submitted',
  'review_comment_created',
]);

const EMPTY_BUNDLE: PRBundle = { meta: null, reviews: [], inline: [] };

/** Used when a review payload carries no usable `submitted_at`; keeps the record key deterministic. */
const UNKNOWN_REVIEW_TIME = '1970-01-01T00:00:00Z';
const REVIEW_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

// ---------------------------------------------------------------------------------------------
// Phase 1: planning (reads only)
// ---------------------------------------------------------------------------------------------

type Resolved = { profile: ProfileItem } | { drop: MetricName };

/** Memoised lookups for one delivery. */
class Resolver {
  private readonly profiles = new Map<number, Promise<ProfileItem | null>>();
  private readonly installations = new Map<number, Promise<InstallationItem | null>>();

  constructor(
    private readonly db: Db,
    private readonly now: number,
  ) {}

  private profile(id: number): Promise<ProfileItem | null> {
    let found = this.profiles.get(id);
    if (!found) {
      found = this.db.getProfile(id);
      this.profiles.set(id, found);
    }
    return found;
  }

  /** A profile by id, or null; memoised for the delivery. */
  lookup(id: number): Promise<ProfileItem | null> {
    return this.profile(id);
  }

  private installation(id: number): Promise<InstallationItem | null> {
    let found = this.installations.get(id);
    if (!found) {
      found = this.db.getInstallation(id, this.now);
      this.installations.set(id, found);
    }
    return found;
  }

  /**
   * Requirement 2.5 to 2.7: a bot earns nothing; an actor with no profile is unlinked; a player may only
   * be credited for an installation they can see. The profile's list (from `GET /user/installations`) is
   * authoritative, with one extra rule: an installation on the player's own account is theirs before they
   * next sign in. A deleted or suspended installation is never accessible.
   */
  async resolve(actor: EventActor, installationId: number | null): Promise<Resolved> {
    if (actor.isBot) {
      return { drop: 'dropped_bot' };
    }
    const profile = await this.profile(actor.id);
    if (!profile) {
      return { drop: 'dropped_unlinked' };
    }
    if (installationId === null) {
      return { drop: 'dropped_installation' };
    }
    const installation = await this.installation(installationId);
    if (installation?.deleted || installation?.suspended) {
      return { drop: 'dropped_installation' };
    }
    const listed = profile.installations.includes(installationId);
    const ownAccount = installation?.accountId === profile.id;
    return listed || ownAccount ? { profile } : { drop: 'dropped_installation' };
  }
}

interface PullRequestPlan {
  type: 'pull_request';
  event: PullRequestEvent;
  bundle: PRBundle;
  /** The acting player, when linked and accessible. */
  actor: ProfileItem | null;
  /**
   * Players a merge credits besides its author: approvers earn a verified kill, and reviewers who
   * requested changes a Riposte credit (which scores only for Jester's Rebase).
   */
  credits: { profile: ProfileItem; event: VerifiedKillEvent | RiposteCreditEvent }[];
  /** Lifetime merges of the PR's author when a player, for the Mentor Pledge. */
  authorMerges: number;
  /** Write the shared `PR#` META item (and counters) for this event. */
  upsertFacts: boolean;
}

interface InstallationPlan {
  type: 'installation';
  event: InstallationEvent | InstallationRepositoriesEvent;
}

type Plan = (PullRequestPlan | InstallationPlan) & { drops: MetricName[] };

function profileOf(resolved: Resolved): ProfileItem | null {
  return 'profile' in resolved ? resolved.profile : null;
}

async function planPullRequest(
  resolver: Resolver,
  db: Db,
  event: PullRequestEvent,
): Promise<(PullRequestPlan & { drops: MetricName[] }) | null> {
  const { pr } = event;
  const installationId = pr.installationId;
  const actorResolved = await resolver.resolve(event.actor, installationId);
  // An inline comment only ever matters for its own author; a merge is the only event with a merger.
  const authorResolved =
    pr.author.id === event.actor.id
      ? actorResolved
      : event.kind === 'review_comment_created'
        ? null
        : await resolver.resolve(pr.author, installationId);
  const mergerResolved =
    event.kind !== 'pr_merged' || pr.mergedBy === null
      ? null
      : pr.mergedBy.id === event.actor.id
        ? actorResolved
        : await resolver.resolve(pr.mergedBy, installationId);

  const actor = profileOf(actorResolved);
  const authorLinked = authorResolved !== null && profileOf(authorResolved) !== null;
  const mergerLinked = mergerResolved !== null && profileOf(mergerResolved) !== null;

  // An opened PR has no history to read; an inline comment from someone who is not a player needs none.
  const needsBundle =
    event.kind === 'pr_opened'
      ? false
      : event.kind === 'review_comment_created'
        ? actor !== null
        : true;
  const bundle = needsBundle ? await db.getPR(pr.repoId, pr.number) : EMPTY_BUNDLE;
  const known = bundle.meta !== null;

  // Requirement 2.5: the shared PR record is written when the author, the merger or the acting
  // reviewer is a linked player (or when the record already exists, because a linked reviewer made it).
  let upsertFacts: boolean;
  switch (event.kind) {
    case 'pr_opened':
      upsertFacts = authorLinked;
      break;
    case 'review_comment_created':
      upsertFacts = actor !== null && !known;
      break;
    case 'review_submitted':
      // A bot review is never recorded, so it never needs the PR written.
      upsertFacts = !event.actor.isBot && (authorLinked || actor !== null || known);
      break;
    default:
      upsertFacts = authorLinked || mergerLinked || known;
  }

  const authorProfile =
    event.kind === 'review_submitted' && actor !== null
      ? await resolver.lookup(pr.author.id)
      : null;
  const authorMerges = authorProfile ? lifetimeMerges(toPlayerState(authorProfile)) : 0;
  const prState = buildPRState(bundle, pr, authorMerges);
  const credits: PullRequestPlan['credits'] = [];
  if (event.kind === 'pr_merged' && pr.merged) {
    for (const credited of [
      ...verifiedKillEvents(event, prState),
      ...riposteCreditEvents(event, prState),
    ]) {
      const target = profileOf(await resolver.resolve(credited.actor, installationId));
      if (target) {
        credits.push({ profile: target, event: credited });
      }
    }
  }

  const drops: MetricName[] = [];
  if (SCORING_KINDS.has(event.kind) && 'drop' in actorResolved) {
    drops.push(actorResolved.drop);
  }
  return { type: 'pull_request', event, bundle, actor, credits, authorMerges, upsertFacts, drops };
}

async function planEvent(resolver: Resolver, db: Db, event: GameEvent): Promise<Plan | null> {
  switch (event.kind) {
    case 'installation':
    case 'installation_repositories':
      return { type: 'installation', event, drops: [] };
    case 'verified_kill':
    case 'weekly_streak':
      // Synthetic kinds built by the ingest itself and the rollover; the normaliser never emits them.
      return null;
    default:
      return planPullRequest(resolver, db, event);
  }
}

function isRelevant(plan: Plan): boolean {
  if (plan.type === 'installation') {
    return true;
  }
  return (
    plan.upsertFacts ||
    (SCORING_KINDS.has(plan.event.kind) && plan.actor !== null) ||
    plan.credits.length > 0
  );
}

// ---------------------------------------------------------------------------------------------
// Phase 3: execution
// ---------------------------------------------------------------------------------------------

interface Progress {
  /** A profile credit has been committed in this delivery. */
  committed: boolean;
}

function creditSuffix(event: PullRequestEvent, deliveryId: string): string {
  if (event.kind === 'verified_kill') {
    return `${deliveryId}-vk`;
  }
  return event.kind === 'riposte_credit' ? `${deliveryId}-rc` : deliveryId;
}

function eventRow(
  userId: number,
  event: PullRequestEvent,
  prState: PRState,
  bundle: PRBundle,
  result: ScoreResult,
  deliveryId: string,
  now: number,
): EventRow | null {
  if (result.skill === null || result.skip !== null) {
    return null;
  }
  const { pr } = event;
  const row: EventRow = {
    userId,
    ts: new Date(now).toISOString(),
    // A person can both merge a bot's PR and have approved it; the suffix keeps the rows apart.
    deliveryId: creditSuffix(event, deliveryId),
    kind: event.kind,
    repoId: pr.repoId,
    repoPrivate: pr.repoPrivate,
    prNumber: pr.number,
    points: result.points,
    power: result.power,
    zone: result.zone,
    level: result.level,
    xp: result.xp,
    skill: result.skill,
    skillXp: result.skillXp,
    supplies: result.supplies,
    monster: result.monster,
    breakdown: result.breakdown,
  };
  if (event.kind === 'review_submitted') {
    row.reviewState = event.state;
  }
  if (
    event.kind === 'pr_opened' ||
    event.kind === 'pr_merged' ||
    event.kind === 'verified_kill' ||
    event.kind === 'riposte_credit'
  ) {
    const additions = pr.stats?.additions ?? bundle.meta?.additions ?? null;
    const deletions = pr.stats?.deletions ?? bundle.meta?.deletions ?? null;
    if (additions !== null && deletions !== null) {
      row.additions = additions;
      row.deletions = deletions;
    }
  }
  if (event.kind === 'review_submitted' || event.kind === 'review_comment_created') {
    row.inlineComments =
      result.counterUpdates.pr.reviewerCounters?.counters.inline ??
      prState.reviewerCounters[String(userId)]?.inline ??
      0;
  }
  return row;
}

/** True when the result changes anything stored on the profile besides XP. */
function changesProfile(result: ScoreResult): boolean {
  const updates = result.counterUpdates;
  return (
    Object.keys(updates.player).length > 0 ||
    updates.pledges !== undefined ||
    updates.mogulChain !== undefined ||
    updates.loadedDiceUsed !== undefined ||
    updates.repoMerges !== undefined
  );
}

/** Everything one scored event writes to the profile, as one guarded update. */
function scoreWrite(
  profile: ProfileItem,
  weekKey: string,
  before: PlayerState,
  after: PlayerState,
  result: ScoreResult,
  now: number,
): ScoreWrite {
  const updates = result.counterUpdates;
  const patch: NonNullable<ScoreWrite['patch']> = {};
  if (updates.repoMerges !== undefined) {
    patch.repoMerges = after.repoMerges;
  }
  if (
    updates.pledges !== undefined ||
    updates.mogulChain !== undefined ||
    updates.loadedDiceUsed !== undefined
  ) {
    patch.weekState = scorerStateOf(weekKey, after);
  }
  if (result.skip === null && result.monster !== null) {
    // Bestiary (Requirement 10.1): every scored event is a kill, remembered with when it first happened.
    patch.kills = { ...profile.kills, [result.monster]: (profile.kills[result.monster] ?? 0) + 1 };
    if (profile.firstSeen[result.monster] === undefined) {
      patch.firstSeen = { ...profile.firstSeen, [result.monster]: new Date(now).toISOString() };
    }
  }
  return {
    xp: result.xp,
    skillXp: result.skillXp,
    gold: after.gold - before.gold,
    level: levelFor(profile.xp + result.xp),
    counters: updates.player,
    patch,
  };
}

/**
 * Add a scored event's XP to the week and clear the act if the target is now met (Requirement 6.5). The
 * atomic add returns the week's new total, so concurrent events agree on whose XP crossed the line; the
 * clear is claimed with a write conditional on the act still being current, so exactly one event pays it.
 */
async function creditWeek(
  ctx: IngestContext,
  userId: number,
  weekKey: string,
  event: PullRequestEvent,
  result: ScoreResult,
  after: PlayerState,
): Promise<void> {
  if (result.xp <= 0) {
    return;
  }
  const week = await ctx.db.addWeekCredit(userId, weekKey, {
    xp: result.xp,
    merge: event.kind === 'pr_merged',
    review: event.kind === 'review_submitted',
  });
  const act = week?.run.act ?? null;
  if (!week || act === null) {
    return;
  }
  const cleared = clearAct(week.run, after);
  if (!cleared) {
    return;
  }
  const claimed = await ctx.db.saveWeek(
    userId,
    weekKey,
    { act },
    {
      act: cleared.run.act,
      clearedActs: cleared.run.clearedActs,
      shop: cleared.run.shop,
      ...(cleared.clear.freePack !== null ? { freePack: cleared.clear.freePack } : {}),
      ...(cleared.clear.legendary !== null ? { legendary: cleared.clear.legendary } : {}),
    },
  );
  if (claimed) {
    await ctx.db.addPayout(userId, {
      gold: cleared.player.gold - after.gold,
      renown: cleared.clear.renown - after.renown,
    });
  }
}

/**
 * Score one event for one player and persist it. The player is loaded with this week's run (started on
 * the spot if the rollover has not reached them), scored, and written with a version condition on the
 * profile; a concurrent write (two webhooks for one player at once) re-reads and re-scores, so caps and
 * Zone always see the latest state. The week gets the XP afterwards, and an act clear pays out.
 */
async function credit(
  ctx: IngestContext,
  progress: Progress,
  userId: number,
  event: PullRequestEvent,
  prState: PRState,
  bundle: PRBundle,
  deliveryId: string,
  now: number,
): Promise<void> {
  const runContext: RunContext = { db: ctx.db, now, newSeed: ctx.newSeed ?? randomSeed };
  for (let attempt = 0; attempt < MAX_CREDIT_ATTEMPTS; attempt += 1) {
    const current = await loadCurrent(runContext, userId);
    if (!current) {
      return;
    }
    const { profile, player, run } = current;
    const result = score(event, player, prState, now);
    if (result.xp > 0 || changesProfile(result)) {
      const after = applyScoreResult(player, prState, result).player;
      try {
        await ctx.db.applyScore(
          userId,
          profile.version,
          scoreWrite(profile, run.weekKey, player, after, result, now),
        );
      } catch (error) {
        if (error instanceof VersionConflictError) {
          continue;
        }
        throw error;
      }
      progress.committed = true;
      try {
        await creditWeek(ctx, userId, run.weekKey, event, result, after);
      } catch (error) {
        // The profile is already credited: keep the Combat Log row and report the week's failure.
        ctx.log.error('ingest.week_failed', { userId }, error);
      }
    }
    const row = eventRow(userId, event, prState, bundle, result, deliveryId, now);
    if (row) {
      await ctx.db.putEvent(row);
      ctx.metrics.count('events_scored');
    }
    return;
  }
  throw new VersionConflictError();
}

function reviewTime(submittedAt: string | null): string {
  return submittedAt !== null && REVIEW_TIME.test(submittedAt) ? submittedAt : UNKNOWN_REVIEW_TIME;
}

async function executePullRequest(
  ctx: IngestContext,
  progress: Progress,
  plan: PullRequestPlan,
  deliveryId: string,
  now: number,
): Promise<void> {
  const { event, bundle } = plan;
  const { pr } = event;
  const prState = buildPRState(bundle, pr, plan.authorMerges);

  // The scorer is the single authority on what the event does to the PR (review rounds, pushes, the
  // review record, the inline tally). Score once for the PR side, with the real player when there is one.
  const subject = plan.actor ? toPlayerState(plan.actor) : createPlayerState(event.actor.id);
  const forPr = score(event, subject, prState, now).counterUpdates.pr;

  if (plan.upsertFacts) {
    await ctx.db.upsertPR(pr, {
      syncCount: (forPr.syncCount ?? prState.syncCount) - prState.syncCount,
      reviewRoundCount:
        (forPr.reviewRoundCount ?? prState.reviewRoundCount) - prState.reviewRoundCount,
    });
  }
  if (event.kind === 'review_submitted' && forPr.review && !event.actor.isBot) {
    await ctx.db.putReview(pr.repoId, pr.number, {
      reviewerId: forPr.review.reviewerId,
      reviewerIsBot: false,
      state: forPr.review.state,
      submittedAt: reviewTime(event.submittedAt),
      deliveryId,
    });
  }
  if (event.kind === 'review_comment_created' && plan.actor && forPr.reviewerCounters) {
    await ctx.db.putInline(pr.repoId, pr.number, {
      reviewerId: event.actor.id,
      reviewerIsBot: false,
      deliveryId,
    });
  }

  if (plan.actor && SCORING_KINDS.has(event.kind)) {
    await credit(ctx, progress, plan.actor.id, event, prState, bundle, deliveryId, now);
  }
  for (const other of plan.credits) {
    await credit(ctx, progress, other.profile.id, other.event, prState, bundle, deliveryId, now);
  }
}

async function executeInstallation(
  ctx: IngestContext,
  event: InstallationEvent | InstallationRepositoriesEvent,
  now: number,
): Promise<void> {
  if (event.kind === 'installation_repositories') {
    await ctx.db.changeInstallationRepos({
      id: event.installationId,
      accountId: event.accountId,
      added: event.added,
      removed: event.removed,
    });
    return;
  }
  switch (event.action) {
    case 'created':
      await ctx.db.upsertInstallation({
        id: event.installationId,
        accountId: event.accountId,
        repoIds: event.repositoryIds,
        suspended: false,
      });
      // The person who installed the App can see the installation, signed in again or not.
      if (!event.sender.isBot) {
        await ctx.db.addProfileInstallation(event.sender.id, event.installationId);
      }
      return;
    case 'deleted':
      await ctx.db.removeInstallation(event.installationId, now);
      return;
    case 'suspend':
    case 'unsuspend':
      await ctx.db.setInstallationSuspended({
        id: event.installationId,
        accountId: event.accountId,
        suspended: event.action === 'suspend',
      });
      return;
  }
}

// ---------------------------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------------------------

/**
 * Process the events of one verified, parsed delivery.
 * @returns `dropped` when nothing in it matters to a linked player (no write was made, not even the
 *          dedupe claim), `duplicate` when the delivery id was already processed, else `processed`.
 */
export async function processDelivery(
  ctx: IngestContext,
  deliveryId: string,
  events: readonly GameEvent[],
): Promise<ProcessOutcome> {
  const now = ctx.now();
  const resolver = new Resolver(ctx.db, now);

  const plans: Plan[] = [];
  for (const event of events) {
    const plan = await planEvent(resolver, ctx.db, event);
    if (plan) {
      plans.push(plan);
    }
  }
  const work = plans.filter(isRelevant);
  const report = (): void => {
    for (const plan of plans) {
      for (const drop of plan.drops) {
        ctx.metrics.count(drop);
      }
    }
  };
  if (work.length === 0) {
    report();
    return 'dropped';
  }

  if (!(await ctx.db.claimDelivery(deliveryId, now))) {
    ctx.metrics.count('duplicates');
    return 'duplicate';
  }
  report();

  const progress: Progress = { committed: false };
  try {
    for (const plan of work) {
      if (plan.type === 'installation') {
        await executeInstallation(ctx, plan.event, now);
      } else {
        await executePullRequest(ctx, progress, plan, deliveryId, now);
      }
    }
  } catch (error) {
    if (!progress.committed) {
      try {
        await ctx.db.releaseDelivery(deliveryId);
      } catch (releaseError) {
        ctx.log.error('ingest.release_failed', {}, releaseError);
      }
    }
    throw error;
  }
  return 'processed';
}
