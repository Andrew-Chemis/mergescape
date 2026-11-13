import { describe, expect, it } from 'vitest';
import { POWER_BUDGET } from './constants';
import { computePower, powerBreakdown, powerContext, powerOf } from './power';
import { createPlayerState, createPRState } from './state';
import {
  AUTHOR_ID,
  charm,
  facts,
  held,
  NOW,
  openedEvent,
  prStateFor,
  reviewEvent,
  REVIEWER_ID,
  settledPlayer,
} from './test-builders';
import type { GameEvent, PlayerState, PowerContext, PRState } from './types';

function ctxFor(event: GameEvent, pr?: PRState, now: number = NOW): PowerContext {
  return { event, pr: pr ?? ('pr' in event ? createPRState(event.pr) : prStateFor(facts())), now };
}

/** A gear loadout worth `power` unconditionally (one piece, no set bonus). */
const gearWorth = (power: number): PlayerState['gear'] => ({
  pieces: [{ id: 'test-piece', slot: 'weapon', power }],
  setBonus: 0,
});

/**
 * Every source at its budget (Charms 4, gear 2.25, Pledges 1, Feats 0.5) under a Leather Jacket chain of
 * `chain` reviewed merges: 8.75 before the Mogul line, so the global cap of 9 only bites with a Mogul.
 */
function atBudget(chain: number): PlayerState {
  const base = createPlayerState(1);
  return {
    ...base,
    charms: [charm(POWER_BUDGET.charms)],
    gear: gearWorth(POWER_BUDGET.gear),
    pledges: { played: [], progress: {}, completed: ['defend'] },
    feats: { unlocked: [], powerBonus: POWER_BUDGET.feats },
    moguls: { ...base.moguls, current: 'leather-jacket', chain },
  };
}

describe('computePower', () => {
  it('is 1 for a new character', () => {
    const player = createPlayerState(1);
    expect(computePower(player)).toBe(1);
    expect(powerBreakdown(player)).toEqual([{ label: 'Base Power', value: 1, kind: 'power' }]);
  });

  it('adds Charm powers', () => {
    const player = {
      ...createPlayerState(1),
      charms: [charm(1.5, 'Rubber Duck'), charm(1, 'Lantern')],
    };
    expect(computePower(player)).toBe(3.5);
    expect(powerBreakdown(player).map((line) => [line.label, line.value])).toEqual([
      ['Base Power', 1],
      ['Rubber Duck', 1.5],
      ['Lantern', 1],
    ]);
  });

  it('lists the gear total, the Pledge bonus and the Feat bonus as separate lines', () => {
    const player: PlayerState = {
      ...createPlayerState(1),
      gear: {
        pieces: [
          { id: 'mithril-sword', slot: 'weapon' as const, power: 0.4 },
          { id: 'mithril-plate', slot: 'body' as const, power: 0.3 },
        ],
        setBonus: 0.25,
      },
      feats: { unlocked: ['archivist'], powerBonus: 0.3 },
    };
    expect(computePower(player)).toBeCloseTo(1 + 0.4 + 0.3 + 0.25 + 0.3, 6);
    expect(powerBreakdown(player).map((line) => [line.label, line.value])).toEqual([
      ['Base Power', 1],
      ['Gear', 0.95],
      ['Feat bonus', 0.3],
    ]);
  });

  it('removes float noise from sums of small increments', () => {
    const player = {
      ...createPlayerState(1),
      charms: [charm(0.1), charm(0.1), charm(0.1)],
    };
    expect(computePower(player)).toBe(1.3);
  });

  it('is capped at 9 and the breakdown shows the cap so its lines still sum to Power', () => {
    // 1 + 4 + 2.25 + 1 + 0.5 + the Leather Jacket's 1.5 = 10.25.
    const context = ctxFor(reviewEvent('APPROVED'));
    const lines = powerBreakdown(atBudget(15), context);
    expect(lines.at(-1)).toEqual({ label: 'Power cap', value: -1.25, kind: 'power' });
    expect(powerOf(lines)).toBe(9);
    expect(computePower(atBudget(15), context)).toBe(9);
  });

  it('reaches exactly 9 without a cap line', () => {
    // A chain of 3 adds 0.3 to the 8.75 of the budgets; trimming the Charms by 0.05 lands on exactly 9.
    const player = { ...atBudget(3), charms: [charm(POWER_BUDGET.charms - 0.05)] };
    const context = ctxFor(reviewEvent('APPROVED'));
    expect(computePower(player, context)).toBe(9);
    expect(powerBreakdown(player, context).map((line) => line.label)).not.toContain('Power cap');
  });

  it('the per-source budgets alone cannot reach the cap: 1 + 4 + 2.25 + 1 + 0.5 = 8.75', () => {
    expect(computePower(atBudget(0), ctxFor(reviewEvent('APPROVED')))).toBe(8.75);
  });

  it('powerOf sums lines without float noise', () => {
    expect(
      powerOf([
        { label: 'a', value: 0.1, kind: 'power' },
        { label: 'b', value: 0.2, kind: 'power' },
      ]),
    ).toBe(0.3);
  });
});

describe('the power context', () => {
  it('has none for the weekly streak, which belongs to the week that just closed', () => {
    const streak: GameEvent = {
      kind: 'weekly_streak',
      actor: { id: 1, isBot: false },
      qualified: true,
    };
    expect(powerContext(streak, createPRState(facts()), NOW)).toBeUndefined();
    expect(powerContext(openedEvent(), createPRState(facts()), NOW)).toEqual({
      event: openedEvent(),
      pr: createPRState(facts()),
      now: NOW,
    });
  });
});

describe('Loaded Dice', () => {
  const dice = { ...settledPlayer(AUTHOR_ID), charms: [held('loaded-dice')] };

  it('is not spent by the baseline Power', () => {
    expect(computePower(dice)).toBe(1);
  });

  it('replaces the event Power with 10, past the cap, with a line that makes the lines sum to 10', () => {
    const context = ctxFor(openedEvent());
    const lines = powerBreakdown(dice, context);
    expect(lines.at(-1)).toEqual({ label: 'Loaded Dice', value: 9, kind: 'power' });
    expect(computePower(dice, context)).toBe(10);
  });

  it('overrides a capped Power too (Power cap line, then the dice line)', () => {
    const capped = { ...atBudget(15), charms: [held('loaded-dice'), charm(4)] };
    const lines = powerBreakdown(capped, ctxFor(reviewEvent('APPROVED')));
    expect(lines.map((line) => [line.label, line.value])).toEqual([
      ['Base Power', 1],
      ['Charm 4', 4],
      ['Gear', 2.25],
      ['Pledge bonus', 1],
      ['Feat bonus', 0.5],
      ['The Leather Jacket (15 reviewed merges in a row)', 1.5],
      ['Power cap', -1.25],
      ['Loaded Dice', 1],
    ]);
    expect(powerOf(lines)).toBe(10);
  });

  it('does nothing once this week charge is spent', () => {
    const spent = { ...dice, week: { loadedDiceUsed: true } };
    expect(computePower(spent, ctxFor(openedEvent()))).toBe(1);
  });
});

describe('Charm lines in a context', () => {
  it('names the condition that fired and omits Charms that contribute nothing', () => {
    const player = {
      ...settledPlayer(REVIEWER_ID),
      charms: [held('rubber-duck'), held('small-hands')],
    };
    const pr = prStateFor(facts(), {
      reviewerCounters: { [String(REVIEWER_ID)]: { decisions: 0, comments: 0, inline: 3 } },
    });
    const lines = powerBreakdown(player, ctxFor(reviewEvent('APPROVED'), pr));
    expect(lines.map((line) => [line.label, line.value])).toEqual([
      ['Base Power', 1],
      ['Rubber Duck (3+ inline comments)', 0.5],
    ]);
  });

  it('labels stacked copies and doubles both parts', () => {
    const player = { ...settledPlayer(REVIEWER_ID), charms: [held('rubber-duck', 2)] };
    const pr = prStateFor(facts(), {
      reviewerCounters: { [String(REVIEWER_ID)]: { decisions: 0, comments: 0, inline: 4 } },
    });
    expect(powerBreakdown(player).map((line) => [line.label, line.value])).toEqual([
      ['Base Power', 1],
      ['Rubber Duck x2', 0.5],
    ]);
    expect(
      powerBreakdown(player, ctxFor(reviewEvent('COMMENTED'), pr)).map((line) => [
        line.label,
        line.value,
      ]),
    ).toEqual([
      ['Base Power', 1],
      ['Rubber Duck x2 (3+ inline comments)', 1],
    ]);
  });
});

describe('per-source Power budgets (design.md 4.3): Charms +4, gear +2.25, Pledges +1, Feats +0.5', () => {
  const review = ctxFor(reviewEvent('APPROVED'));
  const rows = (player: PlayerState, context?: PowerContext) =>
    powerBreakdown(player, context).map((line) => [line.label, line.value]);

  it('holds the Charms to +4 with a visible "Charm cap" line, conditional Power included', () => {
    const player = { ...createPlayerState(1), charms: [charm(3, 'Big'), charm(3, 'Bigger')] };
    expect(rows(player)).toEqual([
      ['Base Power', 1],
      ['Big', 3],
      ['Bigger', 3],
      ['Charm cap', -2],
    ]);
    expect(computePower(player)).toBe(5);
    const stacked = { ...settledPlayer(REVIEWER_ID), charms: [held('hot-potato', 2), charm(2)] };
    const quick = prStateFor(facts(), { additions: 10, deletions: 0 });
    // Hot Potato x2 fires for 3 and the stat-only Charm adds 2: 5 before the cap.
    const approval = { ...ctxFor(reviewEvent('APPROVED'), quick) };
    expect(computePower(stacked, approval)).toBe(5);
    expect(rows(stacked, approval).at(-1)).toEqual(['Charm cap', -1]);
  });

  it('holds worn gear to +2.25, Keen and Stout included', () => {
    const player = { ...createPlayerState(1), gear: gearWorth(2.5) };
    expect(rows(player)).toEqual([
      ['Base Power', 1],
      ['Gear', 2.5],
      ['Gear cap', -0.25],
    ]);
    const keen: PlayerState = {
      ...createPlayerState(1),
      gear: {
        pieces: [{ id: 'k', slot: 'weapon', power: 2.2, affix: 'keen' }],
        setBonus: 0,
      },
    };
    expect(computePower(keen, review)).toBe(1 + 2.25);
    expect(rows(keen, review).at(-1)).toEqual(['Gear cap', -0.05]);
  });

  it('holds completed Pledges to +1 (Defend, Mentor and Fine Comb would be +2)', () => {
    const player: PlayerState = {
      ...createPlayerState(1),
      pledges: { played: [], progress: {}, completed: ['defend', 'mentor', 'fine-comb'] },
    };
    expect(rows(player, review)).toEqual([
      ['Base Power', 1],
      ['Pledge bonus', 2],
      ['Pledge cap', -1],
    ]);
    expect(computePower(player, review)).toBe(2);
  });

  it('holds the Feats to +0.5 even when more is stored', () => {
    const player: PlayerState = {
      ...createPlayerState(1),
      feats: { unlocked: [], powerBonus: 2 },
    };
    expect(rows(player)).toEqual([
      ['Base Power', 1],
      ['Feat bonus', 0.5],
    ]);
  });

  it('adds no cap line to a source within its budget, and the lines always sum to the Power', () => {
    const player = atBudget(0);
    expect(rows(player, review).map(([label]) => label)).toEqual([
      'Base Power',
      'Charm 4',
      'Gear',
      'Pledge bonus',
      'Feat bonus',
    ]);
    const over: PlayerState = {
      ...player,
      charms: [charm(9)],
      gear: gearWorth(5),
      pledges: { played: [], progress: {}, completed: ['defend', 'mentor', 'fine-comb'] },
    };
    const lines = powerBreakdown(over, review);
    expect(lines.map((line) => line.label)).toEqual([
      'Base Power',
      'Charm 9',
      'Charm cap',
      'Gear',
      'Gear cap',
      'Pledge bonus',
      'Pledge cap',
      'Feat bonus',
    ]);
    expect(powerOf(lines)).toBe(8.75);
    expect(computePower(over, review)).toBe(8.75);
  });
});
