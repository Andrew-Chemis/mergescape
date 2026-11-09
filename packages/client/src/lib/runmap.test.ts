import { describe, expect, it } from 'vitest';
import { fixtureLogEntries } from './fixtures/state';
import { ACT_DAYS, daysLeft, isElite, weekKills, weekNumber, weekStartMs } from './runmap';
import type { LogEntry } from './types';

const DAY = 24 * 3_600_000;
const NOW = Date.UTC(2026, 10, 11, 14, 5, 0);

describe('weekStartMs and weekNumber', () => {
  it('finds Monday 00:00 UTC of an ISO week, for both spellings of the key', () => {
    expect(weekStartMs('2026-46')).toBe(Date.UTC(2026, 10, 9));
    expect(weekStartMs('2026-W46')).toBe(Date.UTC(2026, 10, 9));
    // Year edges: week 1 of 2026 starts on Monday 29 December 2025; 2026 has 53 weeks.
    expect(weekStartMs('2026-01')).toBe(Date.UTC(2025, 11, 29));
    expect(weekStartMs('2026-53')).toBe(Date.UTC(2026, 11, 28));
    expect(weekStartMs('2027-01')).toBe(Date.UTC(2027, 0, 4));
  });

  it('agrees with the week key the fixture derives from a date', () => {
    expect(new Date(weekStartMs('2026-46') as number).getUTCDay()).toBe(1);
  });

  it('rejects keys that are not weeks', () => {
    for (const bad of ['', 'nope', '2026-00', '2026-54', '2026', '26-46']) {
      expect(weekStartMs(bad)).toBeNull();
      expect(weekNumber(bad)).toBeNull();
    }
    expect(weekNumber('2026-W07')).toBe(7);
    expect(weekNumber('2026-46')).toBe(46);
  });
});

describe('daysLeft', () => {
  const start = Date.UTC(2026, 10, 9);
  it('counts whole days left, today included', () => {
    expect(daysLeft('2026-46', start)).toBe(7);
    expect(daysLeft('2026-46', start + 3_600_000)).toBe(7);
    expect(daysLeft('2026-46', NOW)).toBe(5);
    expect(daysLeft('2026-46', start + 6 * DAY + 23 * 3_600_000)).toBe(1);
    expect(daysLeft('2026-46', start + 7 * DAY)).toBe(0);
    expect(daysLeft('2026-46', start + 9 * DAY)).toBe(0);
  });

  it('is null for a key that is not a week', () => {
    expect(daysLeft('nope', NOW)).toBeNull();
  });
});

describe('weekKills', () => {
  const entries = fixtureLogEntries(NOW);

  it('groups this week by act and monster, oldest first, with elites alone', () => {
    const { nodes, mogulKills, total } = weekKills(entries, '2026-46', 'rocket-man');
    expect(nodes.scout.map((n) => [n.monster, n.count, n.elite])).toEqual([
      ['scope-creep', 1, true],
      ['merge-goblin', 2, false],
      ['rebase-hydra', 1, true],
      ['legacy-golem', 1, false],
    ]);
    expect(nodes.raid.map((n) => [n.monster, n.count])).toEqual([
      ['merge-goblin', 2],
      ['flaky-test-wraith', 1],
      ['nitpick-imp', 2],
    ]);
    expect(nodes.boss).toEqual([]);
    expect(mogulKills).toBe(0);
    // Ten scored kills this week; the weekly streak row and last week's rows are not counted.
    expect(total).toBe(10);
  });

  it('puts two elites of one kind on two nodes, and gives every node a unique key', () => {
    const hydra = entries.find((e) => e.monster === 'rebase-hydra') as LogEntry;
    const twin: LogEntry = { ...hydra, id: `${hydra.at}#twin` };
    const { nodes } = weekKills([...entries, twin], '2026-46', null);
    expect(nodes.scout.filter((n) => n.monster === 'rebase-hydra')).toHaveLength(2);
    const keys = Object.values(nodes)
      .flat()
      .map((n) => n.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("counts kills on this week's Mogul instead of drawing them", () => {
    const goblin = entries[0] as LogEntry;
    // Saturday 14 November 2026: the Boss window.
    const at = new Date(Date.UTC(2026, 10, 14, 10, 0)).toISOString();
    const onMogul: LogEntry = { ...goblin, id: `${at}#m`, at, monster: 'rocket-man' };
    const onOther: LogEntry = { ...goblin, id: `${at}#o`, at, monster: 'hoodie' };
    const result = weekKills([onMogul, onMogul, onOther], '2026-46', 'rocket-man');
    expect(result.mogulKills).toBe(2);
    expect(result.nodes.boss).toEqual([]);
    expect(result.total).toBe(3);
  });

  it('ignores rows outside the week, rows with no monster, and a bad week key', () => {
    expect(weekKills(entries, '2026-47', null).total).toBe(0);
    expect(weekKills(entries, 'nope', null)).toEqual({
      nodes: { scout: [], raid: [], boss: [] },
      mogulKills: 0,
      total: 0,
    });
  });
});

describe('elites and act days', () => {
  it('names the four elites', () => {
    expect(
      (['rebase-hydra', 'scope-creep', 'release-dragon', 'silent-monolith'] as const).every(
        isElite,
      ),
    ).toBe(true);
    expect(isElite('merge-goblin')).toBe(false);
    expect(isElite('rocket-man')).toBe(false);
  });

  it('labels the act windows as the mock does', () => {
    expect(ACT_DAYS).toEqual({ scout: 'Mon–Tue', raid: 'Wed–Thu', boss: 'Fri–Sun' });
  });
});
