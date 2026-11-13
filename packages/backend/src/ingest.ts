/**
 * Webhook processing (tasks.md 7): from normalised `GameEvent`s to DynamoDB writes.
 *
 * A delivery is handled in three phases so that unlinked activity costs reads, never writes
 * (Requirement 2.5, research.md section 6):
 *
 *   1. PLAN     reads only. Resolve each actor to a linked, installation-accessible player and decide
 *               whether the event matters to anyone. Count drops.
 *   2. CLAIM    one conditional write on `DELIVERY#<id>` that holds the delivery for a lease; a duplicate
 *               (finished, or held by an attempt that is still alive) stops here (Requirement 1.5). The
 *               signed body is claimed the same way (`DELIVERY#body-<sha256>`), because the delivery id is
 *               not covered by the signature: a captured body replayed under a fresh GUID stops here too.
 *   3. EXECUTE  write the shared `PR#` records, then score and credit each player.
 *   4. FINISH   mark the delivery `done`.
 *
 * Failure handling. Every step of a delivery can be run again, so a failed delivery is simply released (its
 * lease is ended at once, or runs out on its own after `DELIVERY_LEASE_MS` when the Lambda was killed
 * before it could) and GitHub's "Redeliver" completes it:
 *
 *   - the PR records and Combat Log rows are keyed by delivery id and so are idempotent; the push and review
 *     round counters are added once per delivery (the delivery id is recorded on the PR item with the add);
 *   - a profile credit is not idempotent by itself, so each one is committed together with a marker on the
 *     profile (`credited`, the last few credit ids), in the same version-guarded write. A credit whose
 *     marker is on the profile is never scored again;
 *   - what the steps after the commit need (the week's XP, the Combat Log row) is written to the delivery's
 *     ledger BEFORE the commit. A later attempt that finds the marker finishes those steps from the ledger:
 *     the Combat Log row is put again (same key), the week is credited once (the credit id is recorded on
 *     the week with the XP), and an Act clear pays its payout once (recorded on the profile) before the act
 *     is claimed, so a crash anywhere in between leaves nothing lost and nothing paid twice.
 *
 * Limits: the profile keeps the last `MAX_CREDITED` credit ids, so the redelivery of a delivery that died
 * after its commit is scored again if more than that many other credits reached the same player in
 * between (a day's work for a very busy player, against a redelivery that is a person pressing a button).
 * An Act clear whose claim fails after its payout is claimed by the next event that reaches the target.
 *
 * Not resumed: the `FEAT#` and `EXPEDITION#` records of the credit (the profile already holds the Feats
 * and the trip, the items are an audit trail), and the Feats a Boss clear unlocks, which a later event
 * re-checks.
 */
import {
  addSupplies,
  applyScoreResult,
  clearAct,
  createPlayerState,
  evaluateFeats,
  levelFor,
  lifetimeMerges,
  riposteCreditEvents,
  score,
  sendExpedition,
  verifiedKillEvents,
} from '@mergescape/shared';
import type {
  EventActor,
  ExpeditionState,
  FeatUnlock,
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
import type {
  Db,
  DeliveryClaim,
  DeliveryCredit,
  EventRow,
  InstallationItem,
  PRBundle,
  ProfileItem,
  ProfilePatch,
  ScoreWrite,
} from './db';
import { applyFeats, settleWorld, writeFeats } from './feat-flow';
import type { Logger } from './log';
import type { MetricName, Metrics } from './metrics';
import { RETRY, versionedWrite, withVersionRetry } from './optimistic';
import { buildPRState } from './pr-state';
import { depthPatch, scorerStateOf, toPlayerState } from './player';
import { loadCurrent } from './runs';
import type { RunContext } from './runs';
import { randomSeed } from './seed';

/** Credit ids kept on a profile as proof that a credit was committed (the last few). */
const MAX_CREDITED = 12;

/** The one expedition the game sends on its own: the free 4 h Forage to Koko Woods after the first scored event. */
const ONBOARDING = { region: 'koko-woods', choice: 'forage' } as const;

export interface IngestContext {
  db: Db;
  metrics: Metrics;
  log: Logger;
  /** Epoch milliseconds. */
  now: () => number;
  /** A fresh random uint32 for a run started lazily by a player's first event of a week. */
  newSeed?: () => number;
  /** The seed of the onboarding expedition (a random uint32 in production; tests pin it). */
  rollSeed?: () => number;
}

export type ProcessOutcome = 'processed' | 'duplicate' | 'dropped';

/** Event kinds that can earn points; the others only maintain PR counters. */
const SCORING_KINDS: ReadonlySet<GameEvent['kind']> = new Set<GameEvent['kind']>([
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
  authorMerges: number | null;
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
  const authorMerges = authorProfile ? lifetimeMerges(toPlayerState(authorProfile)) : null;
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

/** What the attempts at a delivery have decided to credit, by credit id, and a way to write it down. */
interface Ledger {
  credits: Record<string, DeliveryCredit>;
  save(): Promise<void>;
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
  depth: ProfilePatch,
): ScoreWrite {
  const updates = result.counterUpdates;
  // Supplies, Feat counters, Feats and the onboarding expedition ride in the same guarded write.
  const patch: NonNullable<ScoreWrite['patch']> = { ...depth };
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
 * Add a scored event's XP to the week, and clear the act if the target is now met (Requirement 6.5). The
 * add is made once per credit (its id is recorded with it) and returns the week's new total, so concurrent
 * events agree on whose XP crossed the line.
 *
 * An Act clear pays first and claims after. The payout is credited once per Act (the clear's name,
 * `<week>:<act>`, is recorded on the profile in the same write), so of the events that cross the line
 * exactly one pays; the claim, a write conditional on the act still being current, moves the week on and
 * is made by whoever gets there. If the claim does not happen (the Lambda dies after the payout) the next
 * event that reaches the target finds the payout paid, and claims.
 */
async function creditWeek(
  ctx: IngestContext,
  userId: number,
  creditId: string,
  credit: DeliveryCredit,
  after: PlayerState,
  now: number,
): Promise<void> {
  const weekKey = credit.week;
  const week = await ctx.db.addWeekCredit(userId, weekKey, {
    xp: credit.xp,
    merge: credit.merge,
    review: credit.review,
    id: creditId,
  });
  const act = week?.run.act ?? null;
  if (!week || act === null) {
    return;
  }
  const cleared = clearAct(week.run, after);
  if (!cleared) {
    return;
  }
  const paid = await ctx.db.addPayout(
    userId,
    {
      gold: cleared.player.gold - after.gold,
      renown: cleared.clear.renown - after.renown,
    },
    `${weekKey}:${act}`,
  );
  if (paid === 'gone') {
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
  if (claimed && cleared.clear.act === 'boss') {
    // The Boss is down: the Mogul and the unbroken run of Boss weeks feed the World and Endurance Feats,
    // and the Renown it just paid can reach one (read after the payout, which is why it is a second write).
    try {
      await settleWorld(
        ctx.db,
        userId,
        { kind: 'boss_cleared', mogul: week.run.mogul },
        now,
        `boss-${weekKey}`,
      );
    } catch (error) {
      ctx.log.error('ingest.feat_failed', { userId }, error);
    }
  }
}

/**
 * The steps after a credit's profile write, from what the credit decided (so they can be run again by a
 * later attempt): its Combat Log row, then its XP for the week with the act clear it may bring. Both are
 * idempotent. A failure is not caught: the delivery fails and is released, and its redelivery finishes them.
 */
async function finishCredit(
  ctx: IngestContext,
  userId: number,
  creditId: string,
  credit: DeliveryCredit,
  after: PlayerState,
  now: number,
): Promise<void> {
  if (credit.row) {
    await ctx.db.putEvent(credit.row);
  }
  if (credit.xp > 0) {
    await creditWeek(ctx, userId, creditId, credit, after, now);
  }
  // Counted once the credit is whole, so an attempt that is finished by another is counted by that one.
  if (credit.row) {
    ctx.metrics.count('events_scored');
  }
}

/**
 * Score one event for one player and persist it. The player is loaded with this week's run (started on
 * the spot if the rollover has not reached them), scored, and written with a version condition on the
 * profile; a concurrent write (two webhooks for one player at once) re-reads and re-scores, so caps and
 * Zone always see the latest state. The week gets the XP afterwards, and an act clear pays out.
 *
 * What the credit decided is written to the delivery's ledger first and the profile write carries the
 * credit's marker, so an attempt that finds the marker (or a credit that never touched the profile) only
 * finishes the steps after it, from the ledger, and never scores twice.
 */
async function credit(
  ctx: IngestContext,
  ledger: Ledger,
  userId: number,
  event: PullRequestEvent,
  prState: PRState,
  bundle: PRBundle,
  deliveryId: string,
  now: number,
): Promise<void> {
  const runContext: RunContext = { db: ctx.db, now, newSeed: ctx.newSeed ?? randomSeed };
  const creditId = creditSuffix(event, deliveryId);
  // Optimistic-lock retries per credited event; when they run out the delivery fails.
  const credited = await withVersionRetry<void>(async () => {
    const current = await loadCurrent(runContext, userId);
    if (!current) {
      return;
    }
    const { profile, player, run } = current;
    const committed = profile.creditedDeliveries.includes(creditId);
    const earlier = ledger.credits[creditId];
    if (earlier && (committed || !earlier.commits)) {
      // An earlier attempt got this far: finish what it decided on, from the ledger.
      await finishCredit(ctx, userId, creditId, earlier, player, now);
      return;
    }
    if (committed) {
      return; // committed, and there was nothing after the commit to finish
    }
    const result = score(event, player, prState, now);
    // What the event does to the character beyond its XP (tasks.md 22): bank its supplies, count it toward
    // the Feats and unlock the ones it reaches, and send the onboarding expedition after the first one.
    const scored = applyScoreResult(player, prState, result).player;
    const banked = addSupplies(scored, result.supplies);
    const evaluation = evaluateFeats(player, event, prState, result, now);
    const featured = applyFeats(banked, evaluation, now);
    let after = featured.player;
    let onboarding: ExpeditionState | null = null;
    if (result.skip === null && !isBackfill(event) && (player.expedition ?? null) === null) {
      const sent = sendExpedition(
        after,
        ONBOARDING.region,
        ONBOARDING.choice,
        now,
        (ctx.rollSeed ?? randomSeed)(),
      );
      if (sent.ok) {
        after = sent.player;
        onboarding = sent.expedition;
      }
    }
    const depth = depthPatch(player, after);
    const commits = result.xp > 0 || changesProfile(result) || Object.keys(depth).length > 0;
    const row = eventRow(userId, event, prState, bundle, result, deliveryId, now);
    const decided: DeliveryCredit = {
      week: run.weekKey,
      xp: result.xp,
      merge: event.kind === 'pr_merged',
      review: event.kind === 'review_submitted',
      row,
      commits,
    };
    const finishes = decided.xp > 0 || row !== null;
    if (finishes) {
      ledger.credits[creditId] = decided;
      await ledger.save();
    }
    if (commits) {
      const write = scoreWrite(profile, run.weekKey, player, after, result, now, depth);
      write.patch = {
        ...write.patch,
        creditedDeliveries: [...profile.creditedDeliveries, creditId].slice(-MAX_CREDITED),
      };
      if (!(await versionedWrite(() => ctx.db.applyScore(userId, profile.version, write)))) {
        return RETRY;
      }
      await recordDepth(ctx, userId, featured.unlocked, onboarding, creditId, now);
    }
    if (finishes) {
      await finishCredit(ctx, userId, creditId, decided, after, now);
    }
  });
  if (credited === RETRY) {
    throw new VersionConflictError();
  }
}

/** An event replayed from history never counts toward a Feat or starts an expedition (Requirement 17.6). */
function isBackfill(event: PullRequestEvent): boolean {
  return event.backfill === true;
}

/**
 * The records that follow a committed profile write: a `FEAT#` item for each Feat the event unlocked, and
 * the `EXPEDITION#` item of the onboarding expedition. The profile already holds both, so a failure here
 * is logged and leaves nothing to redo: the item types are an audit trail, never read for the game.
 */
async function recordDepth(
  ctx: IngestContext,
  userId: number,
  unlocked: readonly FeatUnlock[],
  onboarding: ExpeditionState | null,
  source: string,
  now: number,
): Promise<void> {
  try {
    await Promise.all([
      writeFeats(ctx.db, userId, unlocked, now, source),
      onboarding !== null ? ctx.db.putExpedition(userId, onboarding) : null,
    ]);
  } catch (error) {
    ctx.log.error('ingest.depth_records_failed', { userId }, error);
  }
}

function reviewTime(submittedAt: string | null): string {
  return submittedAt !== null && REVIEW_TIME.test(submittedAt) ? submittedAt : UNKNOWN_REVIEW_TIME;
}

async function executePullRequest(
  ctx: IngestContext,
  ledger: Ledger,
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
    await ctx.db.upsertPR(
      pr,
      {
        syncCount: (forPr.syncCount ?? prState.syncCount) - prState.syncCount,
        reviewRoundCount:
          (forPr.reviewRoundCount ?? prState.reviewRoundCount) - prState.reviewRoundCount,
      },
      deliveryId,
    );
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
    await credit(ctx, ledger, plan.actor.id, event, prState, bundle, deliveryId, now);
  }
  for (const other of plan.credits) {
    await credit(ctx, ledger, other.profile.id, other.event, prState, bundle, deliveryId, now);
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

/** The ledger key of a signed body: the dedupe record that does not depend on the delivery id. */
const bodyKey = (digest: string): string => `body-${digest}`;

/**
 * Claim the delivery and, when its body digest is known, the signed body. The body goes first: a replay of a
 * captured body under a fresh GUID is refused before it writes anything under that GUID. Returns what earlier
 * attempts left, or null when either is finished or held by an attempt that is still alive.
 */
async function claimDelivery(
  ctx: IngestContext,
  deliveryId: string,
  digest: string | undefined,
  now: number,
): Promise<DeliveryClaim | null> {
  if (digest !== undefined && (await ctx.db.claimDelivery(bodyKey(digest), now)) === null) {
    return null;
  }
  let claim: DeliveryClaim | null = null;
  try {
    claim = await ctx.db.claimDelivery(deliveryId, now);
  } finally {
    if (claim === null && digest !== undefined) {
      await releaseDelivery(ctx, bodyKey(digest));
    }
  }
  return claim;
}

/** End a claim at once so the next attempt does not wait for the lease; a failure is only logged. */
async function releaseDelivery(ctx: IngestContext, key: string): Promise<void> {
  try {
    await ctx.db.releaseDelivery(key);
  } catch (releaseError) {
    ctx.log.error('ingest.release_failed', {}, releaseError);
  }
}

/**
 * Process the events of one verified, parsed delivery.
 * @param digest SHA-256 (hex) of the signed body, to refuse the same body under another delivery id
 * @returns `dropped` when nothing in it matters to a linked player (no write was made, not even the
 *          dedupe claim), `duplicate` when the delivery was already processed (or is being processed),
 *          else `processed`.
 */
export async function processDelivery(
  ctx: IngestContext,
  deliveryId: string,
  events: readonly GameEvent[],
  digest?: string,
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

  const claim = await claimDelivery(ctx, deliveryId, digest, now);
  if (claim === null) {
    ctx.metrics.count('duplicates');
    return 'duplicate';
  }
  report();

  const ledger: Ledger = {
    credits: claim.credits,
    save: () => ctx.db.saveDeliveryCredits(deliveryId, ledger.credits),
  };
  try {
    for (const plan of work) {
      if (plan.type === 'installation') {
        await executeInstallation(ctx, plan.event, now);
      } else {
        await executePullRequest(ctx, ledger, plan, deliveryId, now);
      }
    }
    // The delivery first, then its body: a body that is done while its delivery is not would refuse the
    // redelivery that has to finish it.
    await ctx.db.completeDelivery(deliveryId);
    if (digest !== undefined) {
      await ctx.db.completeDelivery(bodyKey(digest));
    }
  } catch (error) {
    await releaseDelivery(ctx, deliveryId);
    if (digest !== undefined) {
      await releaseDelivery(ctx, bodyKey(digest));
    }
    throw error;
  }
  return 'processed';
}
