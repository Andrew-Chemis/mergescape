import { describe, expect, it } from 'vitest';
import { DAY_MS } from './calendar';
import { FLAT_TARGET_XP, MIN_HISTORY_WEEKS } from './constants';
import { MOGUL_IDS } from './moguls';
import { createPlayerState } from './state';
import { modestWeek, NEW_PLAYER_ID, powerWeek, simulateWeek, WEEK_ONE } from './test-weeks';
import type { WeekOutcome } from './test-weeks';
import type { MogulId } from './types';

/**
 * Onboarding tuning (game-design.md sections 2 and 10, task 24). Fixture weeks run through the real run
 * rules: `startRun`, `score`, `applyScoreResult`, `addWeeklyXp` and `clearAct`. The point is that the
 * numbers in game-design.md are not hopes: a modest first week really does clear the Scout and the Raid
 * and reach the Boss act, and the Boss falls no later than the second week for every Mogul.
 *
 * The weeks are deliberately plain: no Charms, no Pledges played, no gear, no expedition. A new player
 * has at least the free Common Charm, so every figure here is a floor.
 */

const WEEK_TWO = WEEK_ONE + 7 * DAY_MS;
const acts = (outcome: WeekOutcome) => outcome.clears.map((clear) => clear.act);

describe('the fixture weeks', () => {
  it('a modest first week is 3 merges with approvals and 5 reviews, Monday to Friday', () => {
    const events = modestWeek();
    const merges = events.filter((entry) => entry.event.kind === 'pr_merged');
    const reviews = events.filter((entry) => entry.event.kind === 'review_submitted');
    expect(merges).toHaveLength(3);
    expect(reviews).toHaveLength(5);
    expect(events).toHaveLength(8);
    for (const merge of merges) {
      expect(merge.pr.reviews.some((review) => review.state === 'APPROVED')).toBe(true);
    }
    const days = events.map((entry) => Math.floor((entry.at - WEEK_ONE) / DAY_MS));
    expect(Math.min(...days)).toBe(0);
    expect(Math.max(...days)).toBe(4);
  });

  it('a new player has no history, so the targets are the flat 1,200 / 2,000 / 3,000', () => {
    const week = simulateWeek({ weekStart: WEEK_ONE, history: [], events: [] });
    expect(FLAT_TARGET_XP).toBe(2000);
    expect(week.run.targets).toEqual({ scout: 1200, raid: 2000, boss: 3000 });
    expect(week.clears).toEqual([]);
    expect(week.actAtEnd).toBe('scout');
  });
});

describe('a modest first week (3 approved merges, 5 reviews)', () => {
  it.each(MOGUL_IDS)(
    'clears the Scout and the Raid and reaches the Boss act, with %s as the Mogul',
    (mogul) => {
      const week = simulateWeek({ weekStart: WEEK_ONE, history: [], events: modestWeek(), mogul });
      expect(acts(week).slice(0, 2)).toEqual(['scout', 'raid']);
      // Reached: either the Boss act is still open at the end of the week, or it has been cleared.
      expect(week.actAtEnd === 'boss' || acts(week).includes('boss')).toBe(true);
      expect(week.weeklyXp).toBeGreaterThanOrEqual(2000);
    },
  );

  it('clears the Scout and the Raid by Wednesday, the weekday the Raid act belongs to', () => {
    const week = simulateWeek({
      weekStart: WEEK_ONE,
      history: [],
      events: modestWeek(),
      mogul: 'turtleneck',
    });
    const [scout, raid] = week.clears;
    expect(scout?.act).toBe('scout');
    expect(raid?.act).toBe('raid');
    expect(scout!.day).toBeLessThanOrEqual(2);
    expect(raid!.day).toBeLessThanOrEqual(2);
  });

  it('under the hardest Mogul (the Founder halves points all week) it ends the week on the Boss act', () => {
    const week = simulateWeek({
      weekStart: WEEK_ONE,
      history: [],
      events: modestWeek(),
      mogul: 'founder',
    });
    expect(acts(week)).toEqual(['scout', 'raid']);
    expect(week.actAtEnd).toBe('boss');
    expect(week.weeklyXp).toBeLessThan(week.run.targets.boss);
    expect(week.player.renown).toBe(0);
  });

  it('then clears the Boss in the second week: the first Renown comes in week 2, for every Mogul of week 1', () => {
    for (const mogul of MOGUL_IDS) {
      const first = simulateWeek({ weekStart: WEEK_ONE, history: [], events: modestWeek(), mogul });
      const second = simulateWeek({
        player: first.player,
        weekStart: WEEK_TWO,
        history: [first.weeklyXp],
        events: modestWeek(WEEK_TWO),
      });
      // Week 2 has only one week of history, so the targets are still the flat ones (capped by 2x week 1).
      expect(second.run.targets.boss).toBe(Math.min(3000, 2 * first.weeklyXp));
      expect(acts(second), mogul).toEqual(['scout', 'raid', 'boss']);
      expect(second.player.renown, mogul).toBeGreaterThanOrEqual(1);
      expect(second.actAtEnd).toBeNull();
    }
  });

  it('is never held back by the 2x-last-week cap, even after the lightest week', () => {
    const quiet = simulateWeek({
      weekStart: WEEK_ONE,
      history: [],
      events: modestWeek().slice(0, 2),
      mogul: 'founder',
    });
    expect(quiet.actAtEnd).not.toBeNull();
    const second = simulateWeek({
      player: quiet.player,
      weekStart: WEEK_TWO,
      history: [quiet.weeklyXp],
      events: modestWeek(WEEK_TWO),
      mogul: 'turtleneck',
    });
    // The cap makes the targets easier (never harder than twice what the player actually did).
    expect(second.run.targets.boss).toBeLessThanOrEqual(3000);
    expect(acts(second)).toContain('boss');
  });
});

describe("a power user's first two weeks", () => {
  const first = (mogul: MogulId) =>
    simulateWeek({ weekStart: WEEK_ONE, history: [], events: powerWeek(), mogul });

  it('clears the Boss in the second week, whatever the week-1 Mogul, and has Renown to show for it', () => {
    for (const mogul of MOGUL_IDS) {
      const week1 = first(mogul);
      const week2 = simulateWeek({
        player: week1.player,
        weekStart: WEEK_TWO,
        history: [week1.weeklyXp],
        events: powerWeek(WEEK_TWO),
      });
      expect(acts(week2), mogul).toEqual(['scout', 'raid', 'boss']);
      expect(week2.player.renown, mogul).toBeGreaterThanOrEqual(1);
      // The week-2 clear is a Boss clear of its own: Renown goes up by exactly one.
      expect(week2.player.renown, mogul).toBe(week1.player.renown + 1);
    }
  });

  it('is not slowed by the Zone-scaled XP of the first week: the flat targets stay flat for three weeks', () => {
    expect(MIN_HISTORY_WEEKS).toBe(3);
    const week1 = first('hoodie');
    const week2 = simulateWeek({
      player: week1.player,
      weekStart: WEEK_TWO,
      history: [week1.weeklyXp],
      events: powerWeek(WEEK_TWO),
    });
    expect(week2.run.targets).toEqual({ scout: 1200, raid: 2000, boss: 3000 });
    expect(week2.level).toBeGreaterThan(week1.level);
  });

  it('starts from a level-1 character: the fixture really is a new player', () => {
    expect(createPlayerState(NEW_PLAYER_ID).xp).toBe(0);
    expect(first('rocket-man').level).toBeGreaterThan(1);
  });
});
