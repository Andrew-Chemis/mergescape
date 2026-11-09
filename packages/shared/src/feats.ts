import { FEAT_RULES, PET_IDS } from './constants';
import type { RegionId } from './constants';
import { DAY_MS, utcDay } from './calendar';
import { levelFor } from './d2table';
import { eventLines, hoursBetween, mergeFacts } from './facts';
import { uniqueDefinition, uniquePiece } from './gear';
import { tidy } from './math';
import { grantPet, ownedPets } from './pets';
import { lifetimeMerges } from './pledges';
import { isoWeekKey } from './run';
import type {
  FeatCounters,
  GameEvent,
  LootItem,
  MogulId,
  PlayerState,
  PRMergedEvent,
  PRState,
  RepoRecord,
  Result,
  ReviewSubmittedEvent,
  ScoreResult,
  VerifiedKillEvent,
} from './types';

/**
 * Feats (game-design.md 8, Requirement 17): 40 measurement achievements over real work.
 *
 * A Feat is `{id, name, hidden, hint, condition(ctx) -> progress 0..1, reward}`. `condition` reads only the
 * rolling counters kept on the player (`PlayerState.featCounters`), so it is also what draws the progress
 * bar. `evaluateFeats` updates the counters for one scored event and returns the Feats that just reached
 * progress 1; `recordWorldEvent` does the same for what happens off the scoreboard (an expedition
 * collected, a Boss cleared). The caller persists the counters, writes a `FEAT#` item with the unlocking
 * event's id for each unlock, and applies the rewards with `applyFeatEvaluation`.
 *
 * Rules the code keeps (game-design.md 8.1):
 * - Scale Feats count only merged PRs that another human approved: the counters they read are updated only
 *   for a merge with the party bonus, or for a verified kill (a PR the player approved that merged).
 * - Rewards are titles, unique gear and pets, and for seven Feats +0.1 Power, capped at +0.5 in total. A
 *   Feat never grants gold or XP. The jokes, and the Feats that could look like they reward excess, have
 *   no Power at all.
 * - An event flagged `backfill` never counts and never unlocks: a Feat is something done while playing.
 */

// ---------------------------------------------------------------------------------------------
// Definitions
// ---------------------------------------------------------------------------------------------

export type FeatCategory = 'scale' | 'craft' | 'endurance' | 'world' | 'humour';

export interface FeatReward {
  /** A cosmetic title the player can display. */
  title: string | null;
  /** Catalogue id of a unique piece of gear (gear.ts `UNIQUES`). */
  unique: string | null;
  /** Pet id (pets.ts `PETS`). */
  pet: string | null;
  /** +0.1 Power, capped at +0.5 across all Feats. */
  bonus: boolean;
}

/** What a Feat condition may read. */
export interface FeatContext {
  counters: FeatCounters;
  now: number;
  /** Character level (after the event being evaluated). */
  level: number;
  renown: number;
  /** Consecutive qualifying weeks (after the event being evaluated). */
  streakWeeks: number;
  /** How many of the six v1 pets the player owns. */
  corePets: number;
}

export interface FeatDefinition {
  id: string;
  name: string;
  category: FeatCategory;
  /** Hidden Feats show as "???" with their hint until earned. */
  hidden: boolean;
  hint: string;
  /** The line shown once the Feat is visible; the jokes are in on it. */
  description: string;
  /** Progress from 0 to 1; 1 unlocks. */
  condition: (ctx: FeatContext) => number;
  reward: FeatReward;
}

const R = FEAT_RULES;

function ratio(value: number, target: number): number {
  return Math.min(1, Math.max(0, value / target));
}

function reward(parts: Partial<FeatReward>): FeatReward {
  return { title: null, unique: null, pet: null, bonus: false, ...parts };
}

/** First UTC day still inside the 30-day window ending at `now`. */
function windowStart(now: number): string {
  return utcDay(now - (R.windowDays - 1) * DAY_MS);
}

function windowTotal(buckets: Readonly<Record<string, number>>, now: number): number {
  const from = windowStart(now);
  return Object.entries(buckets).reduce(
    (sum, [day, count]) => (day >= from ? sum + count : sum),
    0,
  );
}

/** Events in the local hours from `start` up to (not including) `end`, wrapping past midnight. */
function eventsBetween(hours: readonly number[], start: number, end: number): number {
  return hours.reduce(
    (sum, count, hour) =>
      (start < end ? hour >= start && hour < end : hour >= start || hour < end) ? sum + count : sum,
    0,
  );
}

export const FEATS: readonly FeatDefinition[] = [
  // ---- Scale: ambitious, and only merged PRs another human approved count ----------------------
  {
    id: 'thousand-hand-smith',
    name: 'Thousand-Hand Smith',
    category: 'scale',
    hidden: false,
    hint: 'Merge a pull request that touches a thousand files, with another human approving it.',
    description: 'A thousand files and a second pair of eyes. The Smith does not apologise.',
    condition: (ctx) => ratio(ctx.counters.maxFilesMerged, R.thousandHandFiles),
    reward: reward({ title: 'Thousand-Hand', pet: 'many-armed-goblin' }),
  },
  {
    id: 'archivist',
    name: 'Archivist',
    category: 'scale',
    hidden: false,
    hint: 'Review 100 large PRs (500 lines or more), thoroughly, and see them merge with your approval.',
    description: 'The work nobody thanks you for: three inline comments on a hundred big diffs.',
    condition: (ctx) => ratio(ctx.counters.archivistReviews, R.archivistReviews),
    reward: reward({ title: 'Archivist', unique: 'monolith-plate', bonus: true }),
  },
  {
    id: 'deleter-of-worlds',
    name: 'Deleter of Worlds',
    category: 'scale',
    hidden: false,
    hint: 'Remove a hundred thousand more lines than you add across approved merges.',
    description: 'The best part is no part.',
    condition: (ctx) => ratio(ctx.counters.netLinesRemoved, R.deleterNetLines),
    reward: reward({ unique: 'the-red-pen', bonus: true }),
  },
  {
    id: 'hundred-merges-week',
    name: 'Hundred Merges Week',
    category: 'scale',
    hidden: false,
    hint: 'Merge 100 approved PRs in a single Run.',
    description: 'A hundred in a week. Cosmetic, and a little worrying.',
    condition: (ctx) =>
      ctx.counters.weekMerges.week === isoWeekKey(ctx.now)
        ? ratio(ctx.counters.weekMerges.count, R.hundredMergesWeek)
        : 0,
    reward: reward({ unique: 'streamers-cape' }),
  },
  {
    id: 'mass-reviewer',
    name: 'Mass Reviewer',
    category: 'scale',
    hidden: false,
    hint: 'Approve 100 different PRs that merge, within 30 days.',
    description: 'You stood at the gate for a month and let the good ones through.',
    condition: (ctx) => ratio(windowTotal(ctx.counters.reviewedPrs, ctx.now), R.massReviewerPrs),
    reward: reward({ title: 'Warden of the Gate', bonus: true }),
  },
  {
    id: 'omnilinguist',
    name: 'Omnilinguist',
    category: 'scale',
    hidden: false,
    hint: 'Merge approved PRs in twelve different repositories.',
    description: 'Twelve repositories, twelve dialects of "LGTM".',
    condition: (ctx) => ratio(Object.keys(ctx.counters.repos).length, R.omnilinguistRepos),
    reward: reward({ pet: 'polyglot-parrot' }),
  },
  {
    id: 'first-light',
    name: 'First Light',
    category: 'scale',
    hidden: false,
    hint: 'Merge an approved PR into a repository that had been dark for a year.',
    description: 'Somebody had to turn the lamp back on.',
    condition: (ctx) => ratio(ctx.counters.firstLights, 1),
    reward: reward({ title: 'Lamplighter' }),
  },

  // ---- Craft: quality of work; the ones we most want to reward -------------------------------
  {
    id: 'surgeon',
    name: 'Surgeon',
    category: 'craft',
    hidden: false,
    hint: 'Merge 50 PRs under 50 lines, each with an approval.',
    description: 'Small, precise and reviewed. Fifty times.',
    condition: (ctx) => ratio(ctx.counters.smallMerges, R.surgeonMerges),
    reward: reward({ unique: 'scalpel', bonus: true }),
  },
  {
    id: 'riposte-master',
    name: 'Riposte Master',
    category: 'craft',
    hidden: false,
    hint: 'Address requested changes and merge, a hundred times.',
    description: 'A hundred rounds of feedback, taken well.',
    condition: (ctx) => ratio(ctx.counters.ripostes, R.riposteMasterRipostes),
    reward: reward({ title: 'Unbowed' }),
  },
  {
    id: 'close-reader',
    name: 'Close Reader',
    category: 'craft',
    hidden: false,
    hint: 'Review 25 PRs, leaving ten inline comments on each.',
    description: 'Ten notes in the margin, twenty-five times.',
    condition: (ctx) => ratio(ctx.counters.closeReads, R.closeReaderReviews),
    reward: reward({ unique: 'loupe', bonus: true }),
  },
  {
    id: 'fast-hands',
    name: 'Fast Hands',
    category: 'craft',
    hidden: false,
    hint: 'Approve 50 PRs under 200 lines within an hour of their opening.',
    description: 'Small PRs deserve quick answers. Fifty of them got one.',
    condition: (ctx) => ratio(ctx.counters.fastApprovals, R.fastHandsApprovals),
    reward: reward({ pet: 'hot-potato' }),
  },
  {
    id: 'mentor',
    name: 'Mentor',
    category: 'craft',
    hidden: false,
    hint: 'Approve 100 PRs from authors with fewer merges than you.',
    description: 'A hundred approvals for people earlier on the road.',
    condition: (ctx) => ratio(ctx.counters.mentorApprovals, R.mentorApprovals),
    reward: reward({ unique: 'mentors-mantle', bonus: true }),
  },
  {
    id: 'keeper',
    name: 'Keeper',
    category: 'craft',
    hidden: false,
    hint: 'Merge 500 PRs with another human approving, all in one repository.',
    description: 'You stayed. Five hundred times, in one place.',
    condition: (ctx) =>
      ratio(
        Object.values(ctx.counters.repos).reduce((best, repo) => Math.max(best, repo.merges), 0),
        R.keeperMerges,
      ),
    reward: reward({ title: 'Keeper' }),
  },
  {
    id: 'verified',
    name: 'Verified',
    category: 'craft',
    hidden: false,
    hint: 'See 500 PRs you approved merge.',
    description: 'Five hundred approvals that held up.',
    condition: (ctx) => ratio(ctx.counters.verifiedKills, R.verifiedKills),
    reward: reward({ title: 'The Seal', bonus: true }),
  },
  {
    id: 'marginalia',
    name: 'Marginalia',
    category: 'craft',
    hidden: false,
    hint: 'Leave 500 inline review comments.',
    description: "Half a thousand notes in other people's margins.",
    condition: (ctx) => ratio(ctx.counters.inlineComments, R.marginaliaComments),
    reward: reward({ title: 'Marginalist' }),
  },
  {
    id: 'unblocker',
    name: 'Unblocker',
    category: 'craft',
    hidden: false,
    hint: 'Approve 25 PRs that had been waiting a week or more.',
    description: 'Somebody was waiting. You noticed.',
    condition: (ctx) => ratio(ctx.counters.unblocked, R.unblockerApprovals),
    reward: reward({ title: 'Unblocker' }),
  },
  {
    id: 'tidy-hands',
    name: 'Tidy Hands',
    category: 'craft',
    hidden: false,
    hint: 'Merge 12 approved PRs under 150 lines within 30 days.',
    description: 'A month of small, reviewed changes.',
    condition: (ctx) => ratio(windowTotal(ctx.counters.tidyMerges, ctx.now), R.tidyHandsMerges),
    reward: reward({ title: 'Tidy Hands' }),
  },

  // ---- Endurance and rhythm ------------------------------------------------------------------
  {
    id: 'year-of-the-goblin',
    name: 'Year of the Goblin',
    category: 'endurance',
    hidden: false,
    hint: 'Score an event in 52 different Runs.',
    description: 'A year of Mondays. The cape trim changes with the year.',
    condition: (ctx) => ratio(ctx.counters.activeWeeks, R.yearOfTheGoblinWeeks),
    reward: reward({ unique: 'anniversary-cape' }),
  },
  {
    id: 'iron-week',
    name: 'Iron Week',
    category: 'endurance',
    hidden: false,
    hint: 'Clear all three acts ten Runs in a row.',
    description: 'Ten weeks without missing a Boss.',
    condition: (ctx) => ratio(ctx.counters.bossStreak, R.ironWeekStreak),
    reward: reward({ title: 'Ironclad' }),
  },
  {
    id: 'perennial',
    name: 'Perennial',
    category: 'endurance',
    hidden: false,
    hint: 'Keep the weekly streak going for ten weeks.',
    description: 'Ten weeks in a row, and nobody asked you to.',
    condition: (ctx) => ratio(ctx.streakWeeks, R.perennialWeeks),
    reward: reward({ title: 'Perennial' }),
  },
  {
    id: 'evergreen',
    name: 'Evergreen',
    category: 'endurance',
    hidden: false,
    hint: 'Keep the weekly streak going for half a year.',
    description: 'Twenty-six weeks. Take a holiday; nothing is lost.',
    condition: (ctx) => ratio(ctx.streakWeeks, R.evergreenWeeks),
    reward: reward({ title: 'Evergreen' }),
  },
  {
    id: 'halfway-there',
    name: 'Halfway There',
    category: 'endurance',
    hidden: false,
    hint: 'Reach character level 50.',
    description: 'Level 50 is about a third of the way, by the clock.',
    condition: (ctx) => ratio(ctx.level, R.halfwayLevel),
    reward: reward({ title: 'Halfway' }),
  },
  {
    id: 'ninety-nine',
    name: 'Ninety-Nine',
    category: 'endurance',
    hidden: false,
    hint: 'Reach character level 99.',
    description: 'A multi-year horizon, reached.',
    condition: (ctx) => ratio(ctx.level, R.ninetyNineLevel),
    reward: reward({ title: 'Ninety-Nine' }),
  },

  // ---- World and discovery -------------------------------------------------------------------
  {
    id: 'goblin-slayer',
    name: 'Goblin Slayer',
    category: 'world',
    hidden: false,
    hint: 'Defeat 1,000 Merge Goblins.',
    description: 'A thousand ordinary merges. One of them kept a pickaxe.',
    condition: (ctx) => ratio(ctx.counters.kills['merge-goblin'] ?? 0, R.goblinSlayerKills),
    reward: reward({ pet: 'goblin-runt' }),
  },
  {
    id: 'hydra-bane',
    name: 'Hydra Bane',
    category: 'world',
    hidden: false,
    hint: 'Defeat 100 Rebase Hydras.',
    description: 'Three heads, a hundred times, and every one had a comment.',
    condition: (ctx) => ratio(ctx.counters.kills['rebase-hydra'] ?? 0, R.hydraBaneKills),
    reward: reward({ unique: 'three-headed-axe' }),
  },
  {
    id: 'imp-whisperer',
    name: 'Imp Whisperer',
    category: 'world',
    hidden: false,
    hint: 'Defeat 100 Nitpick Imps.',
    description: 'You read the whole diff and had something to say about it.',
    condition: (ctx) => ratio(ctx.counters.kills['nitpick-imp'] ?? 0, R.impWhispererKills),
    reward: reward({ title: 'Imp Whisperer' }),
  },
  {
    id: 'mogul-hunter',
    name: 'Mogul Hunter',
    category: 'world',
    hidden: false,
    hint: 'Beat each of the six Moguls at least once.',
    description: 'All six, in the boardroom, in one career.',
    condition: (ctx) => ratio(ctx.counters.moguls.length, R.mogulHunterMoguls),
    reward: reward({ title: 'Boardroom Terror', unique: 'golden-parachute' }),
  },
  {
    id: 'renowned',
    name: 'Renowned',
    category: 'world',
    hidden: false,
    hint: 'Reach Renown 8.',
    description: 'Eight Bosses down. The Crossroads is a distant memory.',
    condition: (ctx) => ratio(ctx.renown, R.renownedRenown),
    reward: reward({ title: 'Renowned' }),
  },
  {
    id: 'spelunker',
    name: 'Spelunker',
    category: 'world',
    hidden: false,
    hint: 'Complete 100 expeditions.',
    description: 'A hundred trips out and a hundred back.',
    condition: (ctx) => ratio(ctx.counters.expeditions, R.spelunkerExpeditions),
    reward: reward({ title: 'Wayfarer' }),
  },
  {
    id: 'cartographer',
    name: 'Cartographer',
    category: 'world',
    hidden: false,
    hint: 'Return from every region at least once.',
    description: 'All eight regions on the map, the last one at the bottom of the Spire.',
    condition: (ctx) => ratio(ctx.counters.regions.length, R.cartographerRegions),
    reward: reward({ title: 'Cartographer' }),
  },
  {
    id: 'collector',
    name: 'Collector',
    category: 'world',
    hidden: false,
    hint: 'Own all six pets.',
    description: 'A cat, a duck, a wisp, a runt, a mote and an owl. A menagerie.',
    condition: (ctx) => ratio(ctx.corePets, R.collectorPets),
    reward: reward({ title: 'Menagerie' }),
  },
  {
    id: 'unreferenced',
    name: 'Unreferenced',
    category: 'world',
    hidden: true,
    hint: 'Something at the bottom of the Spire was left behind, and it is yours now.',
    description: 'Return from The Garbage Collector with a Reclaimed unique.',
    condition: (ctx) => ratio(ctx.counters.reclaimed, 1),
    reward: reward({ title: 'Reclaimed' }),
  },
  {
    id: 'the-old-coin',
    name: 'The Old Coin',
    category: 'world',
    hidden: true,
    hint: 'One coin at the Crossroads of Wix has a very odd year on it.',
    description: 'You found the coin dated 7960. It will show on your badge.',
    condition: (ctx) => ratio(ctx.counters.oldCoins, 1),
    reward: reward({ pet: 'coin-mote' }),
  },

  // ---- Humour and in-jokes: cosmetic only, never a Feat bonus --------------------------------------
  {
    id: 'merge-conflict',
    name: 'Merge Conflict',
    category: 'humour',
    hidden: false,
    hint: 'Merge two of your PRs within the same minute.',
    description: 'Two merges, one minute. The branch history will never be the same.',
    condition: (ctx) => ratio(ctx.counters.simultaneousMerges, 1),
    reward: reward({ title: 'Simultaneous' }),
  },
  {
    id: 'the-long-haul',
    name: 'The Long Haul',
    category: 'humour',
    hidden: true,
    hint: 'Some pull requests are open for a very long time and merge anyway.',
    description:
      'A PR open for half a year, then merged. We are sorry. It was a small change, once.',
    condition: (ctx) => ratio(ctx.counters.longHauls, 1),
    reward: reward({ unique: 'hourglass-of-scope' }),
  },
  {
    id: 'night-owl',
    name: 'Night Owl',
    category: 'humour',
    hidden: true,
    hint: 'You are awake at hours when the code is not.',
    description: 'A hundred scored events between 22:00 and 06:00. Go to bed.',
    condition: (ctx) =>
      ratio(eventsBetween(ctx.counters.hours, R.nightStart, R.nightEnd), R.nightEvents),
    reward: reward({ pet: 'owl' }),
  },
  {
    id: 'dawn-patrol',
    name: 'Dawn Patrol',
    category: 'humour',
    hidden: true,
    hint: 'You are up before the birds.',
    description: 'A hundred scored events between 05:00 and 07:00. Sleep is also a skill.',
    condition: (ctx) =>
      ratio(eventsBetween(ctx.counters.hours, R.dawnStart, R.dawnEnd), R.dawnEvents),
    reward: reward({ title: 'Dawn Patrol' }),
  },
  {
    id: 'friday-deploy',
    name: 'Friday Deploy',
    category: 'humour',
    hidden: true,
    hint: 'Some people merge when the weekend is already in sight.',
    description: 'Ten merges after 16:00 on a Friday. The Pager Gremlin has noted this.',
    condition: (ctx) => ratio(ctx.counters.fridayDeploys, R.fridayDeploys),
    reward: reward({ pet: 'pager-gremlin' }),
  },
  {
    id: 'rubber-stamp',
    name: 'Rubber Stamp',
    category: 'humour',
    hidden: true,
    hint: 'Some approvals arrive before the page has finished loading.',
    description: 'Twenty approvals within a minute of the PR opening. Mildly shaming, by design.',
    condition: (ctx) => ratio(ctx.counters.rubberStamps, R.rubberStamps),
    reward: reward({ title: 'Rubber Stamp' }),
  },
  {
    id: 'self-merge',
    name: 'Self Merge',
    category: 'humour',
    hidden: true,
    hint: 'Some merges have no other human in them at all.',
    description: 'Fifty solo merges. Cosmetic only: the hood is warm, but it is a lonely hood.',
    condition: (ctx) => ratio(ctx.counters.soloMerges, R.soloMerges),
    reward: reward({ title: 'Lone Wolf', unique: 'hermits-hood' }),
  },
];

const FEAT_BY_ID: ReadonlyMap<string, FeatDefinition> = new Map(
  FEATS.map((feat) => [feat.id, feat]),
);

export function featDefinition(id: string): FeatDefinition | undefined {
  return FEAT_BY_ID.get(id);
}

// ---------------------------------------------------------------------------------------------
// Power
// ---------------------------------------------------------------------------------------------

/** The Power bonus of a set of unlocked Feats: +0.1 per designated Feat, never above +0.5. */
export function featBonusFor(unlocked: readonly string[]): number {
  const designated = unlocked.filter((id) => featDefinition(id)?.reward.bonus === true).length;
  return tidy(Math.min(FEAT_RULES.bonusCap, designated * FEAT_RULES.bonusPerFeat));
}

/**
 * The Feat bonus Power uses: the stored total, held to the +0.5 cap. Wired into `computePower` as the
 * "Feat bonus" line.
 */
export function featPowerBonus(player: Pick<PlayerState, 'feats'>): number {
  return tidy(Math.min(FEAT_RULES.bonusCap, Math.max(0, player.feats.powerBonus)));
}

// ---------------------------------------------------------------------------------------------
// Counters
// ---------------------------------------------------------------------------------------------

export function emptyFeatCounters(): FeatCounters {
  return {
    approvedMerges: 0,
    netLinesRemoved: 0,
    maxFilesMerged: 0,
    smallMerges: 0,
    ripostes: 0,
    soloMerges: 0,
    weekMerges: { week: '', count: 0 },
    repos: {},
    firstLights: 0,
    fridayDeploys: 0,
    simultaneousMerges: 0,
    lastMergeMinute: -1,
    longHauls: 0,
    verifiedKills: 0,
    archivistReviews: 0,
    closeReads: 0,
    fastApprovals: 0,
    rubberStamps: 0,
    mentorApprovals: 0,
    unblocked: 0,
    inlineComments: 0,
    reviewedPrs: {},
    tidyMerges: {},
    hours: new Array<number>(24).fill(0),
    activeWeeks: 0,
    lastActiveWeek: '',
    bossStreak: 0,
    lastBossWeek: '',
    moguls: [],
    kills: {},
    expeditions: 0,
    regions: [],
    reclaimed: 0,
    oldCoins: 0,
  };
}

/** A player's counters with every field present (absent ones read as zero). */
export function featCountersOf(player: Pick<PlayerState, 'featCounters'>): FeatCounters {
  return { ...emptyFeatCounters(), ...player.featCounters };
}

/** A copy that is safe to change: every nested object and array is new. */
function cloneCounters(counters: FeatCounters): FeatCounters {
  return {
    ...counters,
    weekMerges: { ...counters.weekMerges },
    repos: { ...counters.repos },
    reviewedPrs: { ...counters.reviewedPrs },
    tidyMerges: { ...counters.tidyMerges },
    hours: Array.from({ length: 24 }, (_, hour) => counters.hours[hour] ?? 0),
    moguls: [...counters.moguls],
    kills: { ...counters.kills },
    regions: [...counters.regions],
  };
}

function bump(map: Record<string, number>, key: string, by = 1): void {
  map[key] = (map[key] ?? 0) + by;
}

/** Drop per-day buckets that have left the 30-day window. */
function prune(buckets: Record<string, number>, now: number): void {
  const from = windowStart(now);
  for (const day of Object.keys(buckets)) {
    if (day < from) {
      delete buckets[day];
    }
  }
}

/** Local hour (0 to 23) and weekday (0 is Sunday) at `now` for a player `offsetMinutes` east of UTC. */
function localTime(
  now: number,
  offsetMinutes: number | undefined,
): { hour: number; weekday: number } {
  const local = new Date(now + (offsetMinutes ?? 0) * 60_000);
  return { hour: local.getUTCHours(), weekday: local.getUTCDay() };
}

/** Whole days from one UTC day string to another. */
function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS);
}

/** Options the backend may pass to `evaluateFeats`. */
export interface EvaluateOptions {
  /**
   * Days the PR's repository had gone without a merge before this one, if the caller knows (First Light).
   * When absent or null, the player's own last merge there stands in for it.
   */
  repoQuietDays?: number | null;
}

function recordApprovedMerge(
  counters: FeatCounters,
  event: PRMergedEvent,
  lines: number,
  additions: number,
  deletions: number,
  now: number,
  options: EvaluateOptions,
): void {
  const day = utcDay(now);
  const week = isoWeekKey(now);
  counters.approvedMerges += 1;
  counters.netLinesRemoved += deletions - additions;
  counters.maxFilesMerged = Math.max(counters.maxFilesMerged, event.pr.stats?.changedFiles ?? 0);
  if (lines < R.surgeonMaxLoc) {
    counters.smallMerges += 1;
  }
  if (lines < R.tidyHandsMaxLoc) {
    bump(counters.tidyMerges, day);
  }
  counters.weekMerges =
    counters.weekMerges.week === week
      ? { week, count: counters.weekMerges.count + 1 }
      : { week, count: 1 };

  const key = String(event.pr.repoId);
  const known: RepoRecord | undefined = counters.repos[key];
  const quiet =
    options.repoQuietDays ?? (known === undefined ? null : daysBetween(known.last, day));
  if (quiet !== null && quiet >= R.firstLightQuietDays) {
    counters.firstLights += 1;
  }
  if (known !== undefined) {
    counters.repos[key] = { first: known.first, last: day, merges: known.merges + 1 };
  } else if (Object.keys(counters.repos).length < R.maxTrackedRepos) {
    counters.repos[key] = { first: day, last: day, merges: 1 };
  }
}

function recordMerge(
  counters: FeatCounters,
  player: PlayerState,
  event: PRMergedEvent,
  pr: PRState,
  now: number,
  options: EvaluateOptions,
): void {
  const facts = mergeFacts(event, pr);
  const mergedAt = Date.parse(event.pr.mergedAt ?? '');
  const minute = Math.floor((Number.isNaN(mergedAt) ? now : mergedAt) / 60_000);
  if (counters.lastMergeMinute === minute) {
    counters.simultaneousMerges += 1;
  }
  counters.lastMergeMinute = minute;
  if (facts.soloKill) {
    counters.soloMerges += 1;
  }
  if (facts.riposte) {
    counters.ripostes += 1;
  }
  const open = hoursBetween(event.pr.openedAt, event.pr.mergedAt);
  if (open !== null && open >= R.longHaulDays * 24) {
    counters.longHauls += 1;
  }
  const local = localTime(now, player.tzOffsetMinutes);
  if (local.weekday === 5 && local.hour >= R.fridayAfterHour) {
    counters.fridayDeploys += 1;
  }
  if (facts.party) {
    recordApprovedMerge(
      counters,
      event,
      facts.lines,
      facts.additions,
      facts.deletions,
      now,
      options,
    );
  }
}

function recordReview(
  counters: FeatCounters,
  player: PlayerState,
  event: ReviewSubmittedEvent,
  pr: PRState,
): void {
  const actor = event.actor.id;
  const prior = pr.reviewerCounters[String(actor)] ?? { decisions: 0, comments: 0, inline: 0 };
  if (prior.decisions + prior.comments === 0 && prior.inline >= R.closeReaderInline) {
    counters.closeReads += 1;
  }
  const firstApproval =
    event.state === 'APPROVED' &&
    !pr.reviews.some((review) => review.reviewerId === actor && review.state === 'APPROVED');
  if (!firstApproval) {
    return;
  }
  const sinceOpen = hoursBetween(event.pr.openedAt, event.submittedAt);
  if (sinceOpen !== null && sinceOpen >= 0) {
    if (eventLines(event.pr, pr) < R.fastHandsMaxLoc && sinceOpen <= R.fastHandsHours) {
      counters.fastApprovals += 1;
    }
    if (sinceOpen * 3600 <= R.rubberStampSeconds) {
      counters.rubberStamps += 1;
    }
    if (sinceOpen >= R.unblockerDays * 24) {
      counters.unblocked += 1;
    }
  }
  if ((pr.authorMerges ?? 0) < lifetimeMerges(player)) {
    counters.mentorApprovals += 1;
  }
}

function recordVerifiedKill(
  counters: FeatCounters,
  event: VerifiedKillEvent,
  pr: PRState,
  now: number,
): void {
  counters.verifiedKills += 1;
  bump(counters.reviewedPrs, utcDay(now));
  const inline = pr.reviewerCounters[String(event.actor.id)]?.inline ?? 0;
  if (eventLines(event.pr, pr) >= R.archivistMinLoc && inline >= R.archivistMinInline) {
    counters.archivistReviews += 1;
  }
}

/** The counters after one scored event. Pure: the stored counters are never changed. */
function countEvent(
  player: PlayerState,
  event: GameEvent,
  pr: PRState,
  result: ScoreResult,
  now: number,
  options: EvaluateOptions,
): FeatCounters {
  const counters = cloneCounters(featCountersOf(player));
  if (event.kind === 'weekly_streak') {
    return counters;
  }
  const week = isoWeekKey(now);
  const local = localTime(now, player.tzOffsetMinutes);
  counters.hours = counters.hours.map((count, hour) => (hour === local.hour ? count + 1 : count));
  if (counters.lastActiveWeek !== week) {
    counters.activeWeeks += 1;
    counters.lastActiveWeek = week;
  }
  // A Merge Goblin is an ordinary merged PR; the other monsters count wherever the Combat Log shows them.
  if (
    result.monster !== null &&
    (result.monster !== 'merge-goblin' || event.kind === 'pr_merged')
  ) {
    bump(counters.kills, result.monster);
  }
  switch (event.kind) {
    case 'pr_merged':
      recordMerge(counters, player, event, pr, now, options);
      break;
    case 'review_submitted':
      recordReview(counters, player, event, pr);
      break;
    case 'review_comment_created':
      counters.inlineComments += 1;
      break;
    case 'verified_kill':
      recordVerifiedKill(counters, event, pr, now);
      break;
    default:
      break;
  }
  prune(counters.reviewedPrs, now);
  prune(counters.tidyMerges, now);
  return counters;
}

// ---------------------------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------------------------

export interface FeatUnlock {
  id: string;
  name: string;
  reward: FeatReward;
}

export interface FeatEvaluation {
  /** Feats that reached progress 1 on this event and were not unlocked before. */
  unlocked: FeatUnlock[];
  /** The new absolute counters for the caller to persist (the player's own when nothing changed). */
  counters: FeatCounters;
  /** True when `counters` differ from what the player had. */
  changed: boolean;
}

function ownedCorePets(player: Pick<PlayerState, 'pets'>): number {
  const owned = ownedPets(player);
  return PET_IDS.filter((id) => owned.includes(id)).length;
}

function reached(player: PlayerState, context: FeatContext): FeatUnlock[] {
  return FEATS.filter(
    (feat) => !player.feats.unlocked.includes(feat.id) && feat.condition(context) >= 1,
  ).map((feat) => ({ id: feat.id, name: feat.name, reward: feat.reward }));
}

/**
 * Evaluate the Feats on one scored event. Call it with the same arguments as `score()` (the player and PR
 * before the event) plus the result. Only a scored event counts: a skipped one, and any event flagged
 * `backfill`, change nothing and unlock nothing (Requirement 17.6). Otherwise the rolling counters are
 * updated for the event and every Feat not yet unlocked is checked; the weekly streak updates no counter but
 * can unlock the streak Feats.
 *
 * The caller persists `counters`, writes a `FEAT#` item with this event's id for each unlock, and applies
 * the rewards with `applyFeatEvaluation`.
 */
export function evaluateFeats(
  player: PlayerState,
  event: GameEvent,
  pr: PRState,
  result: ScoreResult,
  now: number,
  options: EvaluateOptions = {},
): FeatEvaluation {
  const own = featCountersOf(player);
  if (('backfill' in event && event.backfill === true) || result.skip !== null) {
    return { unlocked: [], counters: own, changed: false };
  }
  const counters = countEvent(player, event, pr, result, now, options);
  const unlocked = reached(player, {
    counters,
    now,
    level: levelFor(player.xp + result.xp),
    renown: player.renown,
    streakWeeks: result.counterUpdates.player.streakWeeks ?? player.counters.streakWeeks,
    corePets: ownedCorePets(player),
  });
  return { unlocked, counters, changed: event.kind !== 'weekly_streak' };
}

/** What happens off the scoreboard that Feats count. */
export type WorldEvent =
  /** An expedition was collected; pass its loot. */
  | { kind: 'expedition_collected'; region: RegionId; loot: readonly LootItem[] }
  /** The Boss act cleared (Renown went up); pass the Mogul. */
  | { kind: 'boss_cleared'; mogul: MogulId }
  /** Something else changed (a pet arrived, Renown rose): check again. */
  | { kind: 'refresh' };

/**
 * Evaluate the Feats after a world event. Unlike `evaluateFeats` the player is the state AFTER the change
 * (Renown already raised by the Boss clear, the loot already applied), because these Feats read it.
 */
export function recordWorldEvent(
  player: PlayerState,
  world: WorldEvent,
  now: number,
): FeatEvaluation {
  const counters = cloneCounters(featCountersOf(player));
  switch (world.kind) {
    case 'expedition_collected':
      counters.expeditions += 1;
      if (!counters.regions.includes(world.region)) {
        counters.regions.push(world.region);
      }
      counters.reclaimed += world.loot.filter(
        (item) => item.kind === 'unique' && item.piece.unique === 'reclaimed',
      ).length;
      counters.oldCoins += world.loot.filter((item) => item.kind === 'coin').length;
      break;
    case 'boss_cleared': {
      if (!counters.moguls.includes(world.mogul)) {
        counters.moguls.push(world.mogul);
      }
      const week = isoWeekKey(now);
      if (counters.lastBossWeek !== week) {
        counters.bossStreak =
          counters.lastBossWeek === isoWeekKey(now - 7 * DAY_MS) ? counters.bossStreak + 1 : 1;
        counters.lastBossWeek = week;
      }
      break;
    }
    case 'refresh':
      break;
  }
  const unlocked = reached(player, {
    counters,
    now,
    level: levelFor(player.xp),
    renown: player.renown,
    streakWeeks: player.counters.streakWeeks,
    corePets: ownedCorePets(player),
  });
  return { unlocked, counters, changed: world.kind !== 'refresh' };
}

/**
 * Apply an evaluation to the player: store the counters, mark the Feats unlocked, recompute the Feat Power
 * bonus (capped at +0.5), and hand out the rewards (titles, pets, unique gear into the inventory). A Feat
 * never grants gold or XP, and this function touches neither.
 */
export function applyFeatEvaluation(player: PlayerState, evaluation: FeatEvaluation): PlayerState {
  let next: PlayerState = evaluation.changed
    ? { ...player, featCounters: evaluation.counters }
    : player;
  if (evaluation.unlocked.length === 0) {
    return next;
  }
  const titles = [...(next.titles ?? [])];
  for (const { id, reward: earned } of evaluation.unlocked) {
    if (earned.title !== null && !titles.includes(earned.title)) {
      titles.push(earned.title);
    }
    if (earned.pet !== null) {
      next = grantPet(next, earned.pet).player;
    }
    if (earned.unique !== null) {
      const definition = uniqueDefinition(earned.unique) as NonNullable<
        ReturnType<typeof uniqueDefinition>
      >;
      next = {
        ...next,
        inventory: [...(next.inventory ?? []), uniquePiece(definition, `feat-${id}`)],
      };
    }
  }
  const unlocked = [...next.feats.unlocked, ...evaluation.unlocked.map((feat) => feat.id)];
  return { ...next, titles, feats: { unlocked, powerBonus: featBonusFor(unlocked) } };
}

// ---------------------------------------------------------------------------------------------
// Showing Feats
// ---------------------------------------------------------------------------------------------

export interface FeatStatus {
  id: string;
  /** "???" for a hidden Feat that is not unlocked. */
  name: string;
  category: FeatCategory;
  hidden: boolean;
  hint: string;
  /** Null for a hidden Feat that is not unlocked. */
  description: string | null;
  /** 0 to 1; a hidden Feat's bar is not shown by the client but the value is here. */
  progress: number;
  unlocked: boolean;
  pinned: boolean;
  /** Null for a hidden Feat that is not unlocked. */
  reward: FeatReward | null;
}

/** Every Feat as the Feats screen shows it: progress bars for visible ones, "???" and a hint for hidden. */
export function featStatuses(player: PlayerState, now: number): FeatStatus[] {
  const context: FeatContext = {
    counters: featCountersOf(player),
    now,
    level: levelFor(player.xp),
    renown: player.renown,
    streakWeeks: player.counters.streakWeeks,
    corePets: ownedCorePets(player),
  };
  return FEATS.map((feat) => {
    const unlocked = player.feats.unlocked.includes(feat.id);
    const shown = unlocked || !feat.hidden;
    return {
      id: feat.id,
      name: shown ? feat.name : '???',
      category: feat.category,
      hidden: feat.hidden,
      hint: feat.hint,
      description: shown ? feat.description : null,
      progress: unlocked ? 1 : feat.condition(context),
      unlocked,
      pinned: (player.pinnedFeats ?? []).includes(feat.id),
      reward: shown ? feat.reward : null,
    };
  });
}

export type PinError = 'not_unlocked' | 'already_pinned' | 'too_many_pinned';

/** Pin an unlocked Feat to the character sheet and the badge: at most three. */
export function pinFeat(
  player: PlayerState,
  featId: string,
): Result<{ player: PlayerState }, PinError> {
  const pinned = player.pinnedFeats ?? [];
  if (!player.feats.unlocked.includes(featId)) {
    return { ok: false, error: 'not_unlocked' };
  }
  if (pinned.includes(featId)) {
    return { ok: false, error: 'already_pinned' };
  }
  if (pinned.length >= FEAT_RULES.maxPinned) {
    return { ok: false, error: 'too_many_pinned' };
  }
  return { ok: true, player: { ...player, pinnedFeats: [...pinned, featId] } };
}

/** Remove a Feat from the pinned set (a Feat that is not pinned is left as it is). */
export function unpinFeat(player: PlayerState, featId: string): PlayerState {
  return { ...player, pinnedFeats: (player.pinnedFeats ?? []).filter((id) => id !== featId) };
}
