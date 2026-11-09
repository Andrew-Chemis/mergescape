import { describe, expect, it } from 'vitest';
import { FEAT_PET_IDS, FEAT_RULES, PET_IDS } from './constants';
import { DAY_MS } from './calendar';
import { D2_XP } from './d2table';
import {
  applyFeatEvaluation,
  emptyFeatCounters,
  evaluateFeats,
  FEATS,
  featBonusFor,
  featCountersOf,
  featDefinition,
  featPowerBonus,
  featStatuses,
  pinFeat,
  recordWorldEvent,
  unpinFeat,
} from './feats';
import type { EvaluateOptions, FeatEvaluation } from './feats';
import { UNIQUES, uniqueDefinition } from './gear';
import { PETS } from './pets';
import { computePower, powerBreakdown } from './power';
import { isoWeekKey } from './run';
import { score } from './score';
import { createPlayerState } from './state';
import {
  AUTHOR_ID,
  BOSS_NOW,
  facts,
  human,
  inlineEvent,
  mergedEvent,
  mergedFacts,
  NOW,
  openedEvent,
  OTHER_REVIEWER_ID,
  prStateFor,
  reviewEvent,
  REVIEWER_ID,
  settledPlayer,
  verifiedKill,
} from './test-builders';
import type {
  FeatCounters,
  GameEvent,
  LootItem,
  PlayerState,
  PRState,
  PullRequestFacts,
  ReviewRecord,
} from './types';

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

function withCounters(player: PlayerState, patch: Partial<FeatCounters>): PlayerState {
  return { ...player, featCounters: { ...emptyFeatCounters(), ...patch } };
}

function run(
  player: PlayerState,
  event: GameEvent,
  pr: PRState,
  now: number = NOW,
  options?: EvaluateOptions,
): { evaluation: FeatEvaluation; skip: string | null } {
  const result = score(event, player, pr, now);
  return { evaluation: evaluateFeats(player, event, pr, result, now, options), skip: result.skip };
}

const ids = (evaluation: FeatEvaluation): string[] => evaluation.unlocked.map((feat) => feat.id);

const APPROVED: ReviewRecord[] = [{ reviewerId: REVIEWER_ID, state: 'APPROVED' }];

/** A PR merged by its author with another human's approval: the shape Scale Feats count. */
function approvedMerge(
  overrides: Partial<PullRequestFacts> = {},
  reviews: ReviewRecord[] = APPROVED,
) {
  const pr = mergedFacts(overrides);
  return { event: mergedEvent(pr), state: prStateFor(pr, { reviews }), pr };
}

function stats(additions: number, deletions: number, changedFiles = 4) {
  return { additions, deletions, changedFiles, commits: 2 };
}

const author = (counters: Partial<FeatCounters> = {}, overrides: Partial<PlayerState> = {}) =>
  withCounters(settledPlayer(AUTHOR_ID, overrides), counters);
const reviewer = (counters: Partial<FeatCounters> = {}, overrides: Partial<PlayerState> = {}) =>
  withCounters(settledPlayer(REVIEWER_ID, overrides), counters);

// ---------------------------------------------------------------------------------------------
// The list
// ---------------------------------------------------------------------------------------------

describe('the 40 v1 Feats (game-design.md 8.2 as amended by 8.3)', () => {
  it('there are 40, with unique ids and names', () => {
    expect(FEATS).toHaveLength(40);
    expect(new Set(FEATS.map((feat) => feat.id)).size).toBe(40);
    expect(new Set(FEATS.map((feat) => feat.name)).size).toBe(40);
    expect(featDefinition('surgeon')?.name).toBe('Surgeon');
    expect(featDefinition('nope')).toBeUndefined();
  });

  it('has every Feat the design lists, by category', () => {
    const names = (category: string) =>
      FEATS.filter((feat) => feat.category === category).map((feat) => feat.name);
    expect(names('scale')).toEqual([
      'Thousand-Hand Smith',
      'Archivist',
      'Deleter of Worlds',
      'Hundred Merges Week',
      'Mass Reviewer',
      'Omnilinguist',
      'First Light',
    ]);
    expect(names('craft')).toEqual(
      expect.arrayContaining([
        'Surgeon',
        'Close Reader',
        'Fast Hands',
        'Mentor',
        'Keeper',
        'Verified',
        'Riposte Master',
      ]),
    );
    expect(names('endurance')).toEqual(expect.arrayContaining(['Year of the Goblin', 'Iron Week']));
    expect(names('world')).toEqual(
      expect.arrayContaining([
        'Goblin Slayer',
        'Hydra Bane',
        'Mogul Hunter',
        'Spelunker',
        'Collector',
        'Unreferenced',
        'The Old Coin',
      ]),
    );
    expect(names('humour')).toEqual([
      'Merge Conflict',
      'The Long Haul',
      'Night Owl',
      'Dawn Patrol',
      'Friday Deploy',
      'Rubber Stamp',
      'Self Merge',
    ]);
  });

  it('the Feats cut by the incentive audit are gone', () => {
    const all = FEATS.map((feat) => feat.id).join(' ');
    for (const removed of ['megalith', 'clean-record', 'clean-sweep']) {
      expect(all).not.toContain(removed);
    }
    expect(featDefinition('archivist')).toBeDefined();
    expect(featDefinition('keeper')).toBeDefined();
  });

  it('about a fifth are hidden: the jokes and the two discoveries', () => {
    expect(FEATS.filter((feat) => feat.hidden).map((feat) => feat.id)).toEqual([
      'unreferenced',
      'the-old-coin',
      'the-long-haul',
      'night-owl',
      'dawn-patrol',
      'friday-deploy',
      'rubber-stamp',
      'self-merge',
    ]);
  });

  it('every Feat has a hint and a description, and a condition that returns 0 to 1', () => {
    const fresh = {
      counters: emptyFeatCounters(),
      now: NOW,
      level: 1,
      renown: 0,
      streakWeeks: 0,
      corePets: 1,
    };
    for (const feat of FEATS) {
      expect(feat.hint.length, feat.id).toBeGreaterThan(10);
      expect(feat.description.length, feat.id).toBeGreaterThan(10);
      const progress = feat.condition(fresh);
      expect(progress, feat.id).toBeGreaterThanOrEqual(0);
      expect(progress, feat.id).toBeLessThanOrEqual(1);
    }
    expect(featDefinition('collector')!.condition(fresh)).toBeCloseTo(1 / 6, 10);
  });

  it('rewards are titles, unique gear and pets from the catalogues, and never gold or XP', () => {
    const petIds = new Set<string>([...PET_IDS, ...FEAT_PET_IDS]);
    for (const feat of FEATS) {
      expect(Object.keys(feat.reward).sort(), feat.id).toEqual(['bonus', 'pet', 'title', 'unique']);
      expect(
        feat.reward.title !== null || feat.reward.unique !== null || feat.reward.pet !== null,
        feat.id,
      ).toBe(true);
      if (feat.reward.unique !== null) {
        expect(uniqueDefinition(feat.reward.unique)?.source, feat.id).toBe('feat');
      }
      if (feat.reward.pet !== null) {
        expect(petIds.has(feat.reward.pet), feat.id).toBe(true);
      }
    }
    // Every Feat unique and Feat pet is the reward of some Feat.
    const awardedUniques = FEATS.map((feat) => feat.reward.unique);
    for (const unique of UNIQUES.filter((entry) => entry.source === 'feat')) {
      expect(awardedUniques, unique.id).toContain(unique.id);
    }
    const awardedPets = FEATS.map((feat) => feat.reward.pet);
    for (const pet of PETS.filter((entry) => !entry.core)) {
      expect(awardedPets, pet.id).toContain(pet.id);
    }
  });

  it('only the seven designated Feats carry the +0.1 Power; the jokes and the excess Feats never do', () => {
    expect(FEATS.filter((feat) => feat.reward.bonus).map((feat) => feat.id)).toEqual([
      'archivist',
      'deleter-of-worlds',
      'mass-reviewer',
      'surgeon',
      'close-reader',
      'mentor',
      'verified',
    ]);
    for (const id of [
      'thousand-hand-smith',
      'hundred-merges-week',
      'merge-conflict',
      'the-long-haul',
      'night-owl',
      'dawn-patrol',
      'friday-deploy',
      'rubber-stamp',
      'self-merge',
    ]) {
      expect(featDefinition(id)!.reward.bonus, id).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// Power
// ---------------------------------------------------------------------------------------------

describe('the Feat bonus (Requirement 17.3)', () => {
  const designated = FEATS.filter((feat) => feat.reward.bonus).map((feat) => feat.id);

  it('is +0.1 per designated Feat, capped at +0.5', () => {
    expect(featBonusFor([])).toBe(0);
    expect(featBonusFor(['surgeon'])).toBe(0.1);
    expect(featBonusFor(designated.slice(0, 3))).toBe(0.3);
    expect(featBonusFor(designated.slice(0, 5))).toBe(0.5);
    expect(featBonusFor(designated)).toBe(0.5);
    // Feats without the bonus add nothing, however many.
    expect(featBonusFor(['night-owl', 'self-merge', 'unknown'])).toBe(0);
  });

  it('computePower adds it as a "Feat bonus" line and holds a stored bonus to +0.5', () => {
    const player = { ...createPlayerState(1), feats: { unlocked: designated, powerBonus: 0.5 } };
    expect(computePower(player)).toBe(1.5);
    expect(powerBreakdown(player).at(-1)).toEqual({
      label: 'Feat bonus',
      value: 0.5,
      kind: 'power',
    });
    const tampered = { ...player, feats: { unlocked: designated, powerBonus: 3 } };
    expect(featPowerBonus(tampered)).toBe(0.5);
    expect(computePower(tampered)).toBe(1.5);
    expect(featPowerBonus({ feats: { unlocked: [], powerBonus: -1 } })).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------
// One test per Feat condition
// ---------------------------------------------------------------------------------------------

describe('Scale Feats gate on another human approving (Requirement 17.2)', () => {
  it('Thousand-Hand Smith: 1,000 files, approved', () => {
    const big = approvedMerge({ stats: stats(5000, 100, 1000) });
    const { evaluation } = run(author(), big.event, big.state);
    expect(ids(evaluation)).toEqual(['thousand-hand-smith']);
    expect(evaluation.counters.maxFilesMerged).toBe(1000);
    const small = approvedMerge({ stats: stats(5000, 100, 999) });
    const below = run(author(), small.event, small.state).evaluation;
    expect(ids(below)).toEqual([]);
    expect(below.counters.maxFilesMerged).toBe(999);
  });

  it('a 1,000-file dump merged by its author with no approval earns nothing', () => {
    const pr = mergedFacts({ stats: stats(50000, 0, 1500) });
    for (const reviews of [[], [{ reviewerId: REVIEWER_ID, state: 'COMMENTED' as const }]]) {
      const dump = run(author(), mergedEvent(pr), prStateFor(pr, { reviews }));
      expect(ids(dump.evaluation)).toEqual([]);
      expect(dump.evaluation.counters.maxFilesMerged).toBe(0);
      expect(dump.evaluation.counters.approvedMerges).toBe(0);
    }
    // An approval by the author does not count either: it has to be a different human.
    const self = run(
      author(),
      mergedEvent(pr),
      prStateFor(pr, { reviews: [{ reviewerId: AUTHOR_ID, state: 'APPROVED' }] }),
    );
    expect(self.evaluation.counters.approvedMerges).toBe(0);
  });

  it('Archivist: a thorough review of a 500-line PR that merges with your approval', () => {
    const pr = mergedFacts({ stats: stats(400, 100) });
    const counters = { archivistReviews: 99 };
    const state = prStateFor(pr, {
      reviewerCounters: { [String(REVIEWER_ID)]: { decisions: 1, comments: 0, inline: 3 } },
    });
    const kill = verifiedKill(human(REVIEWER_ID), pr);
    expect(ids(run(reviewer(counters), kill, state).evaluation)).toEqual(['archivist']);
    // 499 lines, or only two inline comments, does not count.
    const short = mergedFacts({ stats: stats(400, 99) });
    const lines499 = run(reviewer(counters), verifiedKill(human(REVIEWER_ID), short), state);
    expect(lines499.evaluation.counters.archivistReviews).toBe(99);
    const sparse = prStateFor(pr, {
      reviewerCounters: { [String(REVIEWER_ID)]: { decisions: 1, comments: 0, inline: 2 } },
    });
    expect(run(reviewer(counters), kill, sparse).evaluation.counters.archivistReviews).toBe(99);
    // A verified kill is by definition a merged PR the reviewer approved: the approval gate.
    expect(run(reviewer(), kill, state).evaluation.counters.verifiedKills).toBe(1);
  });

  it('Deleter of Worlds: net -100,000 lines across approved merges, never from an unapproved one', () => {
    const removal = approvedMerge({ stats: stats(0, 1000) });
    const { evaluation } = run(author({ netLinesRemoved: 99_000 }), removal.event, removal.state);
    expect(ids(evaluation)).toEqual(['deleter-of-worlds']);
    // Adding more than you delete moves the net back, and progress never goes below zero.
    const addition = approvedMerge({ stats: stats(500, 100) });
    const grown = run(author(), addition.event, addition.state).evaluation;
    expect(grown.counters.netLinesRemoved).toBe(-400);
    const status = featStatuses(applyFeatEvaluation(author(), grown), NOW);
    expect(status.find((entry) => entry.id === 'deleter-of-worlds')!.progress).toBe(0);
    // Unapproved deletions do not count.
    const solo = mergedFacts({ stats: stats(0, 200_000) });
    const unapproved = run(author(), mergedEvent(solo), prStateFor(solo));
    expect(unapproved.evaluation.counters.netLinesRemoved).toBe(0);
  });

  it('Hundred Merges Week: 100 approved merges in one Run; a new Run starts the count again', () => {
    const merge = approvedMerge();
    const week = isoWeekKey(NOW);
    const hundredth = run(
      author({ weekMerges: { week, count: 99 } }),
      merge.event,
      merge.state,
    ).evaluation;
    expect(ids(hundredth)).toEqual(['hundred-merges-week']);
    const stale = run(
      author({ weekMerges: { week: '2026-01', count: 99 } }),
      merge.event,
      merge.state,
    ).evaluation;
    expect(ids(stale)).toEqual([]);
    expect(stale.counters.weekMerges).toEqual({ week, count: 1 });
    // The progress bar reads 0 when the stored week is not this Run.
    const old = author({ weekMerges: { week: '2026-01', count: 99 } });
    expect(featStatuses(old, NOW).find((s) => s.id === 'hundred-merges-week')!.progress).toBe(0);
    expect(
      featStatuses(author({ weekMerges: { week, count: 50 } }), NOW).find(
        (s) => s.id === 'hundred-merges-week',
      )!.progress,
    ).toBe(0.5);
  });

  it('Mass Reviewer: 100 different approved PRs merged within 30 days', () => {
    const pr = mergedFacts();
    const kill = verifiedKill(human(REVIEWER_ID), pr);
    const recent = { '2026-11-09': 50, '2026-10-20': 49 };
    expect(ids(run(reviewer({ reviewedPrs: recent }), kill, prStateFor(pr)).evaluation)).toEqual([
      'mass-reviewer',
    ]);
    // Buckets older than the 30-day window are not counted, and are dropped from the counters.
    const old = { '2026-11-09': 50, '2026-09-01': 49 };
    const out = run(reviewer({ reviewedPrs: old }), kill, prStateFor(pr)).evaluation;
    expect(ids(out)).toEqual([]);
    expect(out.counters.reviewedPrs).toEqual({ '2026-11-09': 51 });
  });

  it('Omnilinguist: approved merges in twelve different repositories', () => {
    const repos = Object.fromEntries(
      Array.from({ length: 11 }, (_, index) => [
        String(2000 + index),
        { first: '2026-01-01', last: '2026-01-01', merges: 1 },
      ]),
    );
    const merge = approvedMerge();
    expect(ids(run(author({ repos }), merge.event, merge.state).evaluation)).toEqual([
      'omnilinguist',
    ]);
    // A repository already counted does not add a new one.
    const tenOthers = Object.fromEntries(Object.entries(repos).slice(0, 10));
    const again = run(
      author({ repos: { ...tenOthers, '1001': { first: 'a', last: 'a', merges: 1 } } }),
      merge.event,
      merge.state,
    );
    expect(ids(again.evaluation)).toEqual([]);
  });

  it('keeps the repository map bounded: past 200 tracked repositories new ones are not recorded', () => {
    const repos = Object.fromEntries(
      Array.from({ length: FEAT_RULES.maxTrackedRepos }, (_, index) => [
        String(5000 + index),
        { first: '2026-01-01', last: '2026-01-01', merges: 1 },
      ]),
    );
    const merge = approvedMerge();
    const { evaluation } = run(author({ repos }), merge.event, merge.state);
    expect(Object.keys(evaluation.counters.repos)).toHaveLength(FEAT_RULES.maxTrackedRepos);
    expect(evaluation.counters.approvedMerges).toBe(1);
  });

  it('First Light: the first approved merge in a repository dark for a year', () => {
    const merge = approvedMerge();
    const quiet = (days: number | null | undefined) =>
      ids(run(author(), merge.event, merge.state, NOW, { repoQuietDays: days }).evaluation);
    expect(quiet(365)).toEqual(['first-light']);
    expect(quiet(900)).toEqual(['first-light']);
    expect(quiet(364)).toEqual([]);
    // Without a hint from the caller, nothing is known about a repository never seen before.
    expect(quiet(undefined)).toEqual([]);
    expect(quiet(null)).toEqual([]);
    // With no hint the player's own last merge there stands in: a year and more ago counts.
    const dormant = author({
      repos: { '1001': { first: '2024-01-01', last: '2025-01-01', merges: 3 } },
    });
    expect(ids(run(dormant, merge.event, merge.state).evaluation)).toEqual(['first-light']);
    const recent = author({
      repos: { '1001': { first: '2024-01-01', last: '2026-06-01', merges: 3 } },
    });
    expect(ids(run(recent, merge.event, merge.state).evaluation)).toEqual([]);
    // An unapproved merge never lights a repository.
    const solo = mergedFacts();
    expect(
      ids(
        run(author(), mergedEvent(solo), prStateFor(solo), NOW, { repoQuietDays: 999 }).evaluation,
      ),
    ).toEqual([]);
  });
});

describe('Craft Feats', () => {
  it('Surgeon: 50 approved merges under 50 lines', () => {
    const small = approvedMerge({ stats: stats(30, 19) });
    expect(ids(run(author({ smallMerges: 49 }), small.event, small.state).evaluation)).toEqual([
      'surgeon',
    ]);
    const fifty = approvedMerge({ stats: stats(30, 20) });
    expect(
      run(author({ smallMerges: 49 }), fifty.event, fifty.state).evaluation.counters.smallMerges,
    ).toBe(49);
    const solo = mergedFacts({ stats: stats(10, 10) });
    expect(
      run(author({ smallMerges: 49 }), mergedEvent(solo), prStateFor(solo)).evaluation.counters
        .smallMerges,
    ).toBe(49);
  });

  it('Riposte Master: 100 merges that addressed requested changes', () => {
    const reviews: ReviewRecord[] = [
      { reviewerId: REVIEWER_ID, state: 'CHANGES_REQUESTED' },
      { reviewerId: REVIEWER_ID, state: 'APPROVED' },
    ];
    const merge = approvedMerge({}, reviews);
    expect(ids(run(author({ ripostes: 99 }), merge.event, merge.state).evaluation)).toEqual([
      'riposte-master',
    ]);
    const plain = approvedMerge();
    expect(
      run(author({ ripostes: 99 }), plain.event, plain.state).evaluation.counters.ripostes,
    ).toBe(99);
  });

  it('Close Reader: 25 PRs with ten inline comments each, counted once per PR', () => {
    const ten = prStateFor(facts(), {
      reviewerCounters: { [String(REVIEWER_ID)]: { decisions: 0, comments: 0, inline: 10 } },
    });
    expect(ids(run(reviewer({ closeReads: 24 }), reviewEvent('APPROVED'), ten).evaluation)).toEqual(
      ['close-reader'],
    );
    const second = prStateFor(facts(), {
      reviewerCounters: { [String(REVIEWER_ID)]: { decisions: 1, comments: 0, inline: 10 } },
    });
    expect(
      run(reviewer({ closeReads: 24 }), reviewEvent('APPROVED'), second).evaluation.counters
        .closeReads,
    ).toBe(24);
    const nine = prStateFor(facts(), {
      reviewerCounters: { [String(REVIEWER_ID)]: { decisions: 0, comments: 0, inline: 9 } },
    });
    expect(
      run(reviewer({ closeReads: 24 }), reviewEvent('APPROVED'), nine).evaluation.counters
        .closeReads,
    ).toBe(24);
    const noCounters = run(
      reviewer({ closeReads: 24 }),
      reviewEvent('APPROVED'),
      prStateFor(facts()),
    );
    expect(noCounters.evaluation.counters.closeReads).toBe(24);
  });

  describe('Fast Hands: approve 50 PRs under 200 lines within an hour of opening', () => {
    const approve = (
      overrides: Partial<PullRequestFacts>,
      submittedAt: string,
      state = 'APPROVED',
    ) => {
      const pr = facts(overrides);
      const event = { ...reviewEvent(state as 'APPROVED', human(REVIEWER_ID), pr), submittedAt };
      return run(reviewer({ fastApprovals: 49 }), event, prStateFor(pr)).evaluation;
    };

    it('counts a small PR approved inside the hour', () => {
      expect(ids(approve({}, '2026-11-09T10:00:00Z'))).toEqual(['fast-hands']);
      expect(ids(approve({}, '2026-11-09T09:20:00Z'))).toEqual(['fast-hands']);
    });

    it('does not count a PR of 200 lines or more: a fast approval of a big diff is a rubber stamp', () => {
      expect(
        approve({ stats: stats(150, 50) }, '2026-11-09T09:20:00Z').counters.fastApprovals,
      ).toBe(49);
      expect(ids(approve({ stats: stats(150, 49) }, '2026-11-09T09:20:00Z'))).toEqual([
        'fast-hands',
      ]);
    });

    it('does not count an approval after the hour, before the PR opened, of a comment, or without times', () => {
      expect(approve({}, '2026-11-09T10:00:01Z').counters.fastApprovals).toBe(49);
      expect(approve({}, '2026-11-09T08:00:00Z').counters.fastApprovals).toBe(49);
      expect(approve({}, '2026-11-09T09:20:00Z', 'COMMENTED').counters.fastApprovals).toBe(49);
      expect(approve({ openedAt: null }, '2026-11-09T09:20:00Z').counters.fastApprovals).toBe(49);
    });

    it('counts only the first approval a reviewer gives a PR', () => {
      const pr = facts();
      const event = {
        ...reviewEvent('APPROVED', human(REVIEWER_ID), pr),
        submittedAt: '2026-11-09T09:30:00Z',
      };
      const state = prStateFor(pr, { reviews: APPROVED });
      expect(
        run(reviewer({ fastApprovals: 49 }), event, state).evaluation.counters.fastApprovals,
      ).toBe(49);
    });
  });

  it('Mentor: 100 approvals of PRs by authors with fewer merges than you', () => {
    const experienced = reviewer({ mentorApprovals: 99 }, { repoMerges: { '1001': 5 } });
    const newcomer = prStateFor(facts(), { authorMerges: 2 });
    expect(ids(run(experienced, reviewEvent('APPROVED'), newcomer).evaluation)).toEqual(['mentor']);
    // Unknown author merges read as 0, the same as the Mentor Pledge.
    expect(ids(run(experienced, reviewEvent('APPROVED'), prStateFor(facts())).evaluation)).toEqual([
      'mentor',
    ]);
    const veteran = prStateFor(facts(), { authorMerges: 5 });
    expect(
      run(experienced, reviewEvent('APPROVED'), veteran).evaluation.counters.mentorApprovals,
    ).toBe(99);
    // A first-time player has no merges to be more experienced than.
    const novice = reviewer({ mentorApprovals: 99 });
    expect(run(novice, reviewEvent('APPROVED'), newcomer).evaluation.counters.mentorApprovals).toBe(
      99,
    );
  });

  it('Keeper: 500 approved merges in one repository', () => {
    const merge = approvedMerge();
    const nearly = author({
      repos: { '1001': { first: '2025-01-01', last: '2026-11-01', merges: 499 } },
    });
    expect(ids(run(nearly, merge.event, merge.state).evaluation)).toEqual(['keeper']);
    // 499 spread across repositories is not Keeper.
    const spread = author({
      repos: {
        '1': { first: 'a', last: 'a', merges: 250 },
        '2': { first: 'a', last: 'a', merges: 250 },
      },
    });
    expect(ids(run(spread, merge.event, merge.state).evaluation)).toEqual([]);
  });

  it('Verified: 500 Verified Kills', () => {
    const pr = mergedFacts();
    const kill = verifiedKill(human(REVIEWER_ID), pr);
    expect(ids(run(reviewer({ verifiedKills: 499 }), kill, prStateFor(pr)).evaluation)).toEqual([
      'verified',
    ]);
  });

  it('Marginalia: 500 inline comments, and a comment over the cap does not count', () => {
    const pr = facts();
    const event = inlineEvent(human(REVIEWER_ID), pr);
    expect(ids(run(reviewer({ inlineComments: 499 }), event, prStateFor(pr)).evaluation)).toEqual([
      'marginalia',
    ]);
    const capped = prStateFor(pr, {
      reviewerCounters: { [String(REVIEWER_ID)]: { decisions: 0, comments: 0, inline: 10 } },
    });
    const over = run(reviewer({ inlineComments: 499 }), event, capped);
    expect(over.skip).toBe('cap');
    expect(over.evaluation.counters.inlineComments).toBe(499);
  });

  it('Unblocker: 25 approvals of PRs that had waited a week', () => {
    const approve = (submittedAt: string) => {
      const event = { ...reviewEvent('APPROVED'), submittedAt };
      return run(reviewer({ unblocked: 24 }), event, prStateFor(facts())).evaluation;
    };
    expect(ids(approve('2026-11-16T09:00:00Z'))).toEqual(['unblocker']);
    expect(approve('2026-11-16T08:59:59Z').counters.unblocked).toBe(24);
  });

  it('Tidy Hands: 12 approved merges under 150 lines within 30 days', () => {
    const small = approvedMerge({ stats: stats(100, 49) });
    const eleven = { '2026-11-09': 6, '2026-10-30': 5 };
    expect(ids(run(author({ tidyMerges: eleven }), small.event, small.state).evaluation)).toEqual([
      'tidy-hands',
    ]);
    const big = approvedMerge({ stats: stats(100, 50) });
    expect(
      run(author({ tidyMerges: eleven }), big.event, big.state).evaluation.counters.tidyMerges,
    ).toEqual(eleven);
    const stale = { '2026-11-09': 6, '2026-08-01': 5 };
    expect(ids(run(author({ tidyMerges: stale }), small.event, small.state).evaluation)).toEqual(
      [],
    );
  });
});

describe('Endurance Feats', () => {
  it('Year of the Goblin: scored events in 52 different Runs, once per Run', () => {
    const pr = facts();
    const week = isoWeekKey(NOW);
    const first = run(
      author({ activeWeeks: 51, lastActiveWeek: '2026-45' }),
      openedEvent(pr),
      prStateFor(pr),
    );
    expect(ids(first.evaluation)).toEqual(['year-of-the-goblin']);
    expect(first.evaluation.counters.lastActiveWeek).toBe(week);
    const same = run(
      author({ activeWeeks: 51, lastActiveWeek: week }),
      openedEvent(pr),
      prStateFor(pr),
    );
    expect(same.evaluation.counters.activeWeeks).toBe(51);
  });

  it('Iron Week: clear the Boss ten Runs in a row; a missed Run starts the streak again', () => {
    const lastWeek = isoWeekKey(NOW - 7 * DAY_MS);
    const ten = recordWorldEvent(
      author({ bossStreak: 9, lastBossWeek: lastWeek }),
      { kind: 'boss_cleared', mogul: 'hoodie' },
      NOW,
    );
    expect(ids(ten)).toEqual(['iron-week']);
    expect(ten.counters.bossStreak).toBe(10);
    const gap = recordWorldEvent(
      author({ bossStreak: 9, lastBossWeek: isoWeekKey(NOW - 14 * DAY_MS) }),
      { kind: 'boss_cleared', mogul: 'hoodie' },
      NOW,
    );
    expect(ids(gap)).toEqual([]);
    expect(gap.counters.bossStreak).toBe(1);
    const first = recordWorldEvent(author(), { kind: 'boss_cleared', mogul: 'hoodie' }, NOW);
    expect(first.counters.bossStreak).toBe(1);
    // A second clear in the same Run (a replayed event) does not count twice.
    const replay = recordWorldEvent(
      author({ bossStreak: 4, lastBossWeek: isoWeekKey(NOW) }),
      { kind: 'boss_cleared', mogul: 'hoodie' },
      NOW,
    );
    expect(replay.counters.bossStreak).toBe(4);
  });

  it('Perennial and Evergreen: a weekly streak of 10 and of 26 weeks', () => {
    const streak = { kind: 'weekly_streak' as const, actor: human(AUTHOR_ID), qualified: true };
    const pr = prStateFor(facts());
    const nine = author(
      {},
      { counters: { ...createPlayerState(1).counters, streakWeeks: 9, dailyFirstDay: null } },
    );
    const perennial = run(nine, streak, pr);
    expect(ids(perennial.evaluation)).toEqual(['perennial']);
    expect(perennial.evaluation.changed).toBe(false);
    const twentyFive = author(
      {},
      { counters: { ...createPlayerState(1).counters, streakWeeks: 25 } },
    );
    expect(ids(run(twentyFive, streak, pr).evaluation)).toEqual(['perennial', 'evergreen']);
    // A week that did not qualify breaks the streak and unlocks nothing.
    const broken = run(nine, { ...streak, qualified: false }, pr);
    expect(broken.skip).toBe('not_scoring');
    expect(ids(broken.evaluation)).toEqual([]);
  });

  it('Halfway There and Ninety-Nine: level 50 and level 99, from the XP the event adds', () => {
    const merge = approvedMerge();
    const at49 = author({}, { xp: D2_XP[50]! - 1 });
    const halfway = run(at49, merge.event, merge.state).evaluation;
    expect(ids(halfway)).toContain('halfway-there');
    expect(ids(halfway)).not.toContain('ninety-nine');
    const at98 = author({}, { xp: D2_XP[99]! - 1 });
    expect(ids(run(at98, merge.event, merge.state).evaluation)).toContain('ninety-nine');
    expect(ids(run(author(), merge.event, merge.state).evaluation)).toEqual([]);
  });
});

describe('World Feats', () => {
  it('Goblin Slayer: 1,000 Merge Goblin kills, merges only', () => {
    const merge = approvedMerge();
    expect(
      ids(run(author({ kills: { 'merge-goblin': 999 } }), merge.event, merge.state).evaluation),
    ).toEqual(['goblin-slayer']);
    // Opening a PR also shows a Merge Goblin in the Combat Log, but it is not a kill.
    const pr = facts();
    const open = run(author({ kills: { 'merge-goblin': 999 } }), openedEvent(pr), prStateFor(pr));
    expect(open.evaluation.counters.kills['merge-goblin']).toBe(999);
  });

  it('Hydra Bane: 100 Rebase Hydra kills', () => {
    const state = prStateFor(facts(), { reviewRoundCount: 3 });
    const run1 = run(reviewer({ kills: { 'rebase-hydra': 99 } }), reviewEvent('APPROVED'), state);
    expect(ids(run1.evaluation)).toEqual(['hydra-bane']);
  });

  it('Imp Whisperer: 100 Nitpick Imp kills', () => {
    const state = prStateFor(facts(), {
      reviewerCounters: { [String(REVIEWER_ID)]: { decisions: 0, comments: 0, inline: 5 } },
    });
    const imp = run(reviewer({ kills: { 'nitpick-imp': 99 } }), reviewEvent('APPROVED'), state);
    expect(ids(imp.evaluation)).toEqual(['imp-whisperer']);
  });

  it('Mogul Hunter: each of the six Moguls beaten once', () => {
    const five = ['rocket-man', 'leather-jacket', 'turtleneck', 'hoodie', 'founder'];
    const sixth = recordWorldEvent(
      author({ moguls: five }),
      { kind: 'boss_cleared', mogul: 'two-pizza-boss' },
      NOW,
    );
    expect(ids(sixth)).toEqual(['mogul-hunter']);
    const repeat = recordWorldEvent(
      author({ moguls: five }),
      { kind: 'boss_cleared', mogul: 'hoodie' },
      NOW,
    );
    expect(ids(repeat)).toEqual([]);
    expect(repeat.counters.moguls).toEqual(five);
  });

  it('Renowned: Renown 8, read from the player after the Boss clear', () => {
    const cleared = { ...author(), renown: 8 };
    expect(ids(recordWorldEvent(cleared, { kind: 'refresh' }, NOW))).toEqual(['renowned']);
    expect(ids(recordWorldEvent({ ...author(), renown: 7 }, { kind: 'refresh' }, NOW))).toEqual([]);
  });

  it('Spelunker: 100 expeditions collected', () => {
    const evaluation = recordWorldEvent(
      author({ expeditions: 99 }),
      { kind: 'expedition_collected', region: 'koko-woods', loot: [] },
      NOW,
    );
    expect(ids(evaluation)).toEqual(['spelunker']);
  });

  it('Cartographer: every region visited at least once', () => {
    const seven = [
      'koko-woods',
      'crossroads-of-wix',
      'orrl-falls',
      'silverhall',
      'koko-deep-woods',
      'mazu-deep',
      'quu-spire',
    ];
    const last = recordWorldEvent(
      author({ regions: seven }),
      { kind: 'expedition_collected', region: 'garbage-collector', loot: [] },
      NOW,
    );
    expect(ids(last)).toEqual(['cartographer']);
    const repeat = recordWorldEvent(
      author({ regions: seven }),
      { kind: 'expedition_collected', region: 'quu-spire', loot: [] },
      NOW,
    );
    expect(repeat.counters.regions).toEqual(seven);
  });

  it('Collector: own all six pets, evaluated whenever anything refreshes', () => {
    const five = { ...author(), pets: PET_IDS.slice(0, 5) };
    expect(ids(recordWorldEvent(five, { kind: 'refresh' }, NOW))).toEqual([]);
    const six = { ...author(), pets: [...PET_IDS] };
    expect(ids(recordWorldEvent(six, { kind: 'refresh' }, NOW))).toEqual(['collector']);
  });

  it('Unreferenced: a Reclaimed unique from The Garbage Collector, not a region unique', () => {
    const reclaimed: LootItem = {
      kind: 'unique',
      piece: {
        id: 'x',
        slot: 'cape',
        power: 0.4,
        unique: 'reclaimed',
        owner: 'Bessik the Unfiled',
      },
    };
    const region: LootItem = {
      kind: 'unique',
      piece: { id: 'y', slot: 'weapon', power: 0.05, unique: 'region' },
    };
    const found = recordWorldEvent(
      author(),
      { kind: 'expedition_collected', region: 'garbage-collector', loot: [region, reclaimed] },
      NOW,
    );
    expect(ids(found)).toEqual(['unreferenced']);
    expect(found.counters.reclaimed).toBe(1);
    const none = recordWorldEvent(
      author(),
      { kind: 'expedition_collected', region: 'quu-spire', loot: [region] },
      NOW,
    );
    expect(ids(none)).toEqual([]);
  });

  it('The Old Coin: the coin dated 7960', () => {
    const coin: LootItem = { kind: 'coin', year: 7960 };
    const found = recordWorldEvent(
      author(),
      { kind: 'expedition_collected', region: 'crossroads-of-wix', loot: [coin] },
      NOW,
    );
    expect(ids(found)).toEqual(['the-old-coin']);
    expect(found.counters.oldCoins).toBe(1);
  });
});

describe('humour Feats (cosmetic)', () => {
  it('Merge Conflict: two merges in the same minute', () => {
    const first = approvedMerge({ number: 7, mergedAt: '2026-11-09T11:00:05Z' });
    const one = run(author(), first.event, first.state).evaluation;
    expect(ids(one)).toEqual([]);
    expect(one.counters.lastMergeMinute).toBe(Date.parse('2026-11-09T11:00:00Z') / 60_000);
    const second = approvedMerge({ number: 8, mergedAt: '2026-11-09T11:00:50Z' });
    const player = applyFeatEvaluation(author(), one);
    expect(ids(run(player, second.event, second.state).evaluation)).toEqual(['merge-conflict']);
    const later = approvedMerge({ number: 9, mergedAt: '2026-11-09T11:01:00Z' });
    expect(ids(run(player, later.event, later.state).evaluation)).toEqual([]);
    // With no merge time the event time stands in.
    const untimed = approvedMerge({ mergedAt: null });
    const marked = run(author(), untimed.event, untimed.state).evaluation;
    expect(marked.counters.lastMergeMinute).toBe(Math.floor(NOW / 60_000));
  });

  it('The Long Haul: a PR open 180 days, then merged', () => {
    const long = approvedMerge({
      openedAt: '2026-05-13T11:00:00Z',
      mergedAt: '2026-11-09T11:00:00Z',
    });
    expect(ids(run(author(), long.event, long.state).evaluation)).toEqual(['the-long-haul']);
    const shorter = approvedMerge({
      openedAt: '2026-05-14T11:00:01Z',
      mergedAt: '2026-11-09T11:00:00Z',
    });
    expect(ids(run(author(), shorter.event, shorter.state).evaluation)).toEqual([]);
    const unknown = approvedMerge({ openedAt: null });
    expect(ids(run(author(), unknown.event, unknown.state).evaluation)).toEqual([]);
  });

  describe('local-time Feats use the tz offset on the player', () => {
    const pr = facts();
    const hoursAfter = (counters: Partial<FeatCounters>, offsetMinutes: number | undefined) =>
      run(author(counters, { tzOffsetMinutes: offsetMinutes }), openedEvent(pr), prStateFor(pr))
        .evaluation;

    it('buckets scored events by local hour; UTC when no offset is stored', () => {
      expect(hoursAfter({}, undefined).counters.hours[12]).toBe(1);
      expect(hoursAfter({}, 660).counters.hours[23]).toBe(1);
      expect(hoursAfter({}, -480).counters.hours[4]).toBe(1);
      expect(hoursAfter({}, 0).counters.hours).toHaveLength(24);
    });

    it('Night Owl: 100 events between 22:00 and 06:00 local', () => {
      const almost = (hour: number) => {
        const hours = new Array<number>(24).fill(0);
        hours[hour] = 99;
        return { hours };
      };
      expect(ids(hoursAfter(almost(23), 660))).toEqual(['night-owl']); // 23:00
      expect(ids(hoursAfter(almost(22), 600))).toEqual(['night-owl']); // 22:00
      expect(ids(hoursAfter(almost(5), -361))).toContain('night-owl'); // 05:59
      expect(ids(hoursAfter(almost(21), 599))).toEqual([]); // 21:59
      expect(ids(hoursAfter(almost(6), -360))).not.toContain('night-owl'); // 06:00
      expect(ids(hoursAfter(almost(12), 0))).toEqual([]); // noon
    });

    it('Dawn Patrol: 100 events between 05:00 and 07:00 local', () => {
      const almost = (hour: number) => {
        const hours = new Array<number>(24).fill(0);
        hours[hour] = 99;
        return { hours };
      };
      expect(ids(hoursAfter(almost(5), -420))).toContain('dawn-patrol'); // 05:00
      expect(ids(hoursAfter(almost(6), -301))).toContain('dawn-patrol'); // 06:59
      expect(ids(hoursAfter(almost(4), -421))).not.toContain('dawn-patrol'); // 04:59
      expect(ids(hoursAfter(almost(7), -300))).not.toContain('dawn-patrol'); // 07:00
    });
  });

  it('Friday Deploy: ten merges after 16:00 local on a Friday', () => {
    const merge = approvedMerge();
    const at = (offset: number, now: number = BOSS_NOW) =>
      run(author({ fridayDeploys: 9 }, { tzOffsetMinutes: offset }), merge.event, merge.state, now)
        .evaluation;
    expect(ids(at(240))).toEqual(['friday-deploy']); // Friday 16:00
    expect(ids(at(239))).toEqual([]); // Friday 15:59
    expect(ids(at(750))).toEqual([]); // Saturday 00:30
    expect(ids(at(0, NOW))).toEqual([]); // a Monday
  });

  it('Rubber Stamp: 20 approvals within a minute of the PR opening', () => {
    const approve = (submittedAt: string) => {
      const event = { ...reviewEvent('APPROVED'), submittedAt };
      return run(reviewer({ rubberStamps: 19 }), event, prStateFor(facts())).evaluation;
    };
    expect(ids(approve('2026-11-09T09:01:00Z'))).toEqual(['rubber-stamp']);
    expect(approve('2026-11-09T09:01:01Z').counters.rubberStamps).toBe(19);
  });

  it('Self Merge: 50 solo merges', () => {
    const pr = mergedFacts();
    const solo = run(author({ soloMerges: 49 }), mergedEvent(pr), prStateFor(pr)).evaluation;
    expect(ids(solo)).toEqual(['self-merge']);
    const reviewed = approvedMerge();
    expect(
      run(author({ soloMerges: 49 }), reviewed.event, reviewed.state).evaluation.counters
        .soloMerges,
    ).toBe(49);
  });
});

// ---------------------------------------------------------------------------------------------
// Evaluation rules
// ---------------------------------------------------------------------------------------------

describe('backfilled history never unlocks a Feat (Requirement 17.6)', () => {
  it('a backfill-flagged event unlocks nothing and counts nothing, even at the threshold', () => {
    const big = approvedMerge({ stats: stats(5000, 100, 1000) });
    const flagged = { ...big.event, backfill: true };
    const player = author({ soloMerges: 49, verifiedKills: 499 });
    const result = score(flagged, player, big.state, NOW);
    expect(result.skip).toBeNull();
    expect(result.xp).toBeGreaterThan(0);
    const evaluation = evaluateFeats(player, flagged, big.state, result, NOW);
    expect(evaluation.unlocked).toEqual([]);
    expect(evaluation.changed).toBe(false);
    expect(evaluation.counters).toEqual(player.featCounters);
    // The same event without the flag does unlock.
    expect(ids(run(player, big.event, big.state).evaluation)).toEqual(['thousand-hand-smith']);
    // An explicit false is a normal event.
    expect(ids(run(player, { ...big.event, backfill: false }, big.state).evaluation)).toEqual([
      'thousand-hand-smith',
    ]);
  });

  it('holds for reviews, comments, verified kills and the weekly streak too', () => {
    const pr = facts();
    const merged = mergedFacts();
    const cases: GameEvent[] = [
      { ...reviewEvent('APPROVED'), backfill: true },
      { ...inlineEvent(human(REVIEWER_ID), pr), backfill: true },
      { ...verifiedKill(human(REVIEWER_ID), merged), backfill: true },
    ];
    const player = reviewer({ inlineComments: 499, verifiedKills: 499 });
    for (const event of cases) {
      const state = prStateFor(event.kind === 'verified_kill' ? merged : pr);
      const result = score(event, player, state, NOW);
      const evaluation = evaluateFeats(player, event, state, result, NOW);
      expect(evaluation.unlocked, event.kind).toEqual([]);
      expect(evaluation.changed, event.kind).toBe(false);
    }
  });
});

describe('evaluateFeats on events that do not score', () => {
  it('a skipped event (cap, own PR, bot) changes nothing', () => {
    const pr = facts();
    const own = run(
      author({ inlineComments: 499 }),
      inlineEvent(human(AUTHOR_ID), pr),
      prStateFor(pr),
    );
    expect(own.skip).toBe('own_pr');
    expect(own.evaluation.changed).toBe(false);
    expect(own.evaluation.unlocked).toEqual([]);
    const bot = run(
      author(),
      { ...openedEvent(pr), actor: { id: AUTHOR_ID, isBot: true } },
      prStateFor(pr),
    );
    expect(bot.skip).toBe('bot');
    expect(bot.evaluation.changed).toBe(false);
  });

  it('never changes the stored counters of the player it was given', () => {
    const merge = approvedMerge();
    const player = author({ soloMerges: 3, kills: { 'merge-goblin': 7 }, regions: ['koko-woods'] });
    const before = JSON.stringify(player.featCounters);
    run(player, merge.event, merge.state);
    recordWorldEvent(player, { kind: 'expedition_collected', region: 'orrl-falls', loot: [] }, NOW);
    expect(JSON.stringify(player.featCounters)).toBe(before);
  });

  it('reads a player with no stored counters as all zero, and a short hours array as padded', () => {
    expect(featCountersOf(createPlayerState(1))).toEqual(emptyFeatCounters());
    const short = {
      ...createPlayerState(1),
      featCounters: { ...emptyFeatCounters(), hours: [1, 2] },
    };
    const merge = approvedMerge();
    const { evaluation } = run(
      { ...short, ...settledPlayer(AUTHOR_ID), featCounters: short.featCounters },
      merge.event,
      merge.state,
    );
    expect(evaluation.counters.hours).toHaveLength(24);
    expect(evaluation.counters.hours[1]).toBe(2);
  });

  it('does not unlock a Feat the player already has', () => {
    const player = {
      ...author({ soloMerges: 49 }),
      feats: { unlocked: ['self-merge'], powerBonus: 0 },
    };
    const pr = mergedFacts();
    expect(ids(run(player, mergedEvent(pr), prStateFor(pr)).evaluation)).toEqual([]);
  });

  it('can unlock more than one Feat on one event', () => {
    const merge = approvedMerge({ stats: stats(10, 20, 1000) });
    const player = author({ smallMerges: 49, maxFilesMerged: 0 });
    expect(ids(run(player, merge.event, merge.state).evaluation).sort()).toEqual([
      'surgeon',
      'thousand-hand-smith',
    ]);
  });

  it('carries monster kills for any scored event, merge goblins aside', () => {
    const merge = approvedMerge();
    const { evaluation } = run(author(), merge.event, merge.state);
    expect(evaluation.counters.kills).toEqual({ 'merge-goblin': 1 });
    expect(evaluation.changed).toBe(true);
  });
});

describe('applying an evaluation', () => {
  it('stores the counters, marks the Feat, and hands out title, unique gear and Feat bonus', () => {
    const dump = approvedMerge({ stats: stats(10, 100_000 + 10, 3) });
    const player = author({ netLinesRemoved: 0 });
    const { evaluation } = run(author({ netLinesRemoved: 100 }), dump.event, dump.state);
    expect(ids(evaluation)).toEqual(['deleter-of-worlds']);
    const applied = applyFeatEvaluation(player, evaluation);
    expect(applied.featCounters).toEqual(evaluation.counters);
    expect(applied.feats).toEqual({ unlocked: ['deleter-of-worlds'], powerBonus: 0.1 });
    expect(applied.titles).toEqual([]);
    expect(applied.inventory).toHaveLength(1);
    expect(applied.inventory![0]).toMatchObject({
      id: 'feat-deleter-of-worlds',
      name: 'The Red Pen',
      slot: 'weapon',
      affix: 'stout',
      unique: 'feat',
    });
    expect(computePower(applied)).toBe(1.1);
    // Never gold or XP.
    expect(applied.gold).toBe(player.gold);
    expect(applied.xp).toBe(player.xp);
  });

  it('grants titles once and pets through the pet collection', () => {
    const base = createPlayerState(1);
    const evaluation: FeatEvaluation = {
      changed: false,
      counters: emptyFeatCounters(),
      unlocked: [
        {
          id: 'goblin-slayer',
          name: 'Goblin Slayer',
          reward: featDefinition('goblin-slayer')!.reward,
        },
        { id: 'keeper', name: 'Keeper', reward: featDefinition('keeper')!.reward },
        { id: 'first-light', name: 'First Light', reward: featDefinition('first-light')!.reward },
      ],
    };
    const applied = applyFeatEvaluation({ ...base, titles: ['Keeper'] }, evaluation);
    expect(applied.pets).toEqual(['linter-cat', 'goblin-runt']);
    expect(applied.titles).toEqual(['Keeper', 'Lamplighter']);
    expect(applied.feats.unlocked).toEqual(['goblin-slayer', 'keeper', 'first-light']);
    expect(applied.featCounters).toBeUndefined();
  });

  it('with nothing unlocked it only stores the counters', () => {
    const player = createPlayerState(1);
    const counters = { ...emptyFeatCounters(), soloMerges: 4 };
    expect(
      applyFeatEvaluation(player, { unlocked: [], counters, changed: true }).featCounters,
    ).toBe(counters);
    expect(applyFeatEvaluation(player, { unlocked: [], counters, changed: false })).toBe(player);
  });

  it('unlocking all seven designated Feats caps the Feat bonus at +0.5', () => {
    const designated = FEATS.filter((feat) => feat.reward.bonus);
    const evaluation: FeatEvaluation = {
      changed: false,
      counters: emptyFeatCounters(),
      unlocked: designated.map((feat) => ({ id: feat.id, name: feat.name, reward: feat.reward })),
    };
    const applied = applyFeatEvaluation(createPlayerState(1), evaluation);
    expect(applied.feats.powerBonus).toBe(0.5);
    expect(computePower(applied)).toBe(1.5);
  });
});

describe('showing Feats (Requirement 17.5)', () => {
  it('visible Feats show progress; hidden ones show "???" and their hint until earned', () => {
    const player = author({ soloMerges: 25, smallMerges: 10 });
    const statuses = featStatuses(player, NOW);
    expect(statuses).toHaveLength(40);
    const surgeon = statuses.find((entry) => entry.id === 'surgeon')!;
    expect(surgeon).toMatchObject({
      name: 'Surgeon',
      progress: 0.2,
      unlocked: false,
      pinned: false,
    });
    expect(surgeon.description).not.toBeNull();
    expect(surgeon.reward).toEqual(featDefinition('surgeon')!.reward);
    const hidden = statuses.find((entry) => entry.id === 'self-merge')!;
    expect(hidden).toMatchObject({ name: '???', description: null, reward: null, progress: 0.5 });
    expect(hidden.hint.length).toBeGreaterThan(10);
    const unlocked = featStatuses(
      {
        ...player,
        feats: { unlocked: ['self-merge'], powerBonus: 0 },
        pinnedFeats: ['self-merge'],
      },
      NOW,
    ).find((entry) => entry.id === 'self-merge')!;
    expect(unlocked).toMatchObject({
      name: 'Self Merge',
      progress: 1,
      unlocked: true,
      pinned: true,
    });
    expect(unlocked.reward).not.toBeNull();
  });

  it('pins up to three unlocked Feats and unpins', () => {
    const base: PlayerState = {
      ...createPlayerState(1),
      feats: { unlocked: ['a', 'b', 'c', 'd'], powerBonus: 0 },
    };
    expect(pinFeat(base, 'zzz')).toEqual({ ok: false, error: 'not_unlocked' });
    let player = base;
    for (const id of ['a', 'b', 'c']) {
      const pinned = pinFeat(player, id);
      expect(pinned.ok).toBe(true);
      player = pinned.ok ? pinned.player : player;
    }
    expect(player.pinnedFeats).toEqual(['a', 'b', 'c']);
    expect(pinFeat(player, 'a')).toEqual({ ok: false, error: 'already_pinned' });
    expect(pinFeat(player, 'd')).toEqual({ ok: false, error: 'too_many_pinned' });
    const freed = unpinFeat(player, 'b');
    expect(freed.pinnedFeats).toEqual(['a', 'c']);
    expect(pinFeat(freed, 'd').ok).toBe(true);
    expect(unpinFeat(base, 'a').pinnedFeats).toEqual([]);
  });
});

describe('rolling windows when shown', () => {
  it('the progress bar ignores buckets that have left the 30-day window', () => {
    const player = author({
      reviewedPrs: { '2026-11-09': 20, '2026-09-01': 40 },
      tidyMerges: { '2026-11-01': 6, '2026-07-01': 6 },
    });
    const statuses = featStatuses(player, NOW);
    expect(statuses.find((entry) => entry.id === 'mass-reviewer')!.progress).toBe(0.2);
    expect(statuses.find((entry) => entry.id === 'tidy-hands')!.progress).toBe(0.5);
  });

  it('a merge payload without stats still counts, with no files touched', () => {
    const pr = mergedFacts({ stats: null });
    const state = prStateFor(pr, { reviews: APPROVED, additions: 10, deletions: 30 });
    const { evaluation } = run(author(), mergedEvent(pr), state);
    expect(evaluation.counters.approvedMerges).toBe(1);
    expect(evaluation.counters.maxFilesMerged).toBe(0);
    expect(evaluation.counters.netLinesRemoved).toBe(20);
  });
});

describe('the other human is a different account', () => {
  it('an approval from a third party counts, whoever merged', () => {
    const reviews: ReviewRecord[] = [{ reviewerId: OTHER_REVIEWER_ID, state: 'APPROVED' }];
    const merge = approvedMerge({ stats: stats(10, 10, 1000) }, reviews);
    expect(ids(run(author(), merge.event, merge.state).evaluation)).toEqual([
      'thousand-hand-smith',
    ]);
  });
});
