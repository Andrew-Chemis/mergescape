import { describe, expect, it } from 'vitest';
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
      feats: { unlocked: ['megalith'], powerBonus: 0.3 },
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
    const player = { ...createPlayerState(1), charms: [charm(6), charm(6)] };
    expect(computePower(player)).toBe(9);
    const lines = powerBreakdown(player);
    expect(lines.at(-1)).toEqual({ label: 'Power cap', value: -4, kind: 'power' });
    expect(lines.reduce((sum, line) => sum + line.value, 0)).toBe(9);
  });

  it('reaches exactly 9 without a cap line', () => {
    const player = { ...createPlayerState(1), charms: [charm(8)] };
    expect(computePower(player)).toBe(9);
    expect(powerBreakdown(player).map((line) => line.label)).not.toContain('Power cap');
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
    const capped = { ...dice, charms: [held('loaded-dice'), charm(12)] };
    const lines = powerBreakdown(capped, ctxFor(openedEvent()));
    expect(lines.map((line) => [line.label, line.value])).toEqual([
      ['Base Power', 1],
      ['Charm 12', 12],
      ['Power cap', -4],
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
