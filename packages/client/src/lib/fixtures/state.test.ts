import { describe, expect, it, vi } from 'vitest';
import {
  levelFor,
  progressWithinLevel,
  SKILLS,
  VOCATION_THRESHOLDS,
  ZONE_EXPONENT,
} from '@mergescape/shared';
import type { SkillXp } from '@mergescape/shared';
import { breakdownRows } from '../breakdown';
import type { LogEntry } from '../types';
import { createFixtureApi } from './api';
import {
  fixtureInstallations,
  fixtureLogEntries,
  fixtureMe,
  FIXTURE_PAGE_SIZE,
  FIXTURE_WEEKLY_XP,
  isoWeekKey,
  pageOf,
} from './state';
import { FINAL_SKILL_XP, FINAL_XP } from './raw-log';

const NOW = Date.UTC(2026, 10, 11, 14, 5, 0);
const entries = fixtureLogEntries(NOW);

const sum = (values: number[]) => Math.round(values.reduce((a, b) => a + b, 0) * 1e6) / 1e6;
const linesOf = (entry: LogEntry, kind: LogEntry['breakdown'][number]['kind']) =>
  entry.breakdown.filter((line) => line.kind === kind);

describe('fixture Combat Log rows (the scorer ran, nothing was typed by hand)', () => {
  it('has 14 rows, newest first, with unique ids', () => {
    expect(entries).toHaveLength(14);
    const times = entries.map((entry) => Date.parse(entry.at));
    expect([...times].sort((a, b) => b - a)).toEqual(times);
    expect(new Set(entries.map((entry) => entry.id)).size).toBe(entries.length);
    for (const entry of entries) {
      expect(entry.id.startsWith(entry.at)).toBe(true);
    }
  });

  it.each(entries.map((entry) => [entry.id, entry] as const))('%s adds up', (_id, entry) => {
    // Points = sum of the points lines; Power = sum of the power lines; XP = floor(P x Power x Zone).
    expect(sum(linesOf(entry, 'points').map((line) => line.value))).toBe(entry.points);
    expect(sum(linesOf(entry, 'power').map((line) => line.value))).toBeCloseTo(entry.power, 9);
    expect(linesOf(entry, 'zone')).toHaveLength(1);
    expect(linesOf(entry, 'zone')[0]?.value).toBeCloseTo(entry.zone, 9);
    expect(entry.zone).toBeCloseTo((entry.level + 1) ** ZONE_EXPONENT, 9);
    expect(Math.floor(entry.points * entry.power * entry.zone)).toBe(entry.xp);
    expect(linesOf(entry, 'xp')[0]?.value).toBe(entry.xp);
    // The credited skills add up to the row's XP.
    const skills = Object.values(entry.skillXp) as number[];
    expect(sum(skills)).toBe(entry.xp);
  });

  it('keeps the breakdown in the order points, power, zone, xp', () => {
    for (const entry of entries) {
      const order = entry.breakdown.map((line) => line.kind);
      const rank = { points: 0, power: 1, zone: 2, xp: 3 } as const;
      expect(order.map((kind) => rank[kind])).toEqual(
        [...order.map((kind) => rank[kind])].sort((a, b) => a - b),
      );
    }
  });

  it('covers the Bestiary the scorer picks from and a private repo with no name', () => {
    const monsters = new Set(entries.map((entry) => entry.monster));
    for (const expected of [
      'merge-goblin',
      'nitpick-imp',
      'flaky-test-wraith',
      'legacy-golem',
      'rebase-hydra',
      'scope-creep',
    ]) {
      expect(monsters).toContain(expected);
    }
    const priv = entries.find((entry) => entry.repoPrivate);
    expect(priv).toBeDefined();
    expect(priv?.repoName).toBeUndefined();
  });

  it('leaves no PR title, body or comment text anywhere in a row (Requirement 3.3)', () => {
    const allowed = new Set([
      'id',
      'at',
      'kind',
      'reviewState',
      'prNumber',
      'repoId',
      'repoPrivate',
      'repoName',
      'additions',
      'deletions',
      'inlineComments',
      'monster',
      'skill',
      'points',
      'power',
      'zone',
      'level',
      'xp',
      'skillXp',
      'supplies',
      'breakdown',
    ]);
    for (const entry of entries) {
      for (const key of Object.keys(entry)) {
        expect(allowed.has(key), `unexpected field ${key}`).toBe(true);
      }
    }
  });

  it('has a breakdown the Combat Log can draw for every row', () => {
    for (const entry of entries) {
      expect(breakdownRows(entry).length).toBeGreaterThanOrEqual(6);
    }
  });
});

describe('fixture profile', () => {
  const me = fixtureMe(NOW);

  it('is a level-41 Smith whose skill XP adds up to its XP', () => {
    expect(levelFor(me.xp)).toBe(41);
    expect(me.xp).toBe(FINAL_XP);
    expect(sum(SKILLS.map((skill) => me.skillXp[skill]))).toBe(me.xp);
    expect(me.skillXp).toEqual(FINAL_SKILL_XP);
    expect(me.skillXp.smithing / me.xp).toBeGreaterThanOrEqual(VOCATION_THRESHOLDS.smith);
    expect(me.vocation).toBe('Smith');
  });

  it('stands just short of level 42, so one more merge levels up', () => {
    expect(progressWithinLevel(me.xp).fraction).toBeGreaterThan(0.85);
    const next = (entries[0] as LogEntry).xp;
    expect(levelFor(me.xp + next)).toBe(42);
  });

  it('holds three Charms in five slots and a run in progress', () => {
    expect(me.charms).toHaveLength(3);
    expect(me.charmSlots).toBe(5);
    expect(me.week?.act).toBe('raid');
    expect(me.week?.clearedActs).toEqual(['scout']);
    expect(me.week?.weeklyXp).toBe(FIXTURE_WEEKLY_XP);
    expect(me.week?.weeklyXp).toBeGreaterThan(me.week?.targets.scout ?? Infinity);
    expect(me.week?.weeklyXp).toBeLessThan(me.week?.targets.raid ?? 0);
    expect(me.week?.targets.boss).toBe(Math.round((me.week?.targets.raid ?? 0) * 1.5));
    expect(me.week?.targets.scout).toBe(Math.round((me.week?.targets.raid ?? 0) * 0.6));
    expect(me.week?.played).toHaveLength(3);
    expect(me.week?.hand).toHaveLength(5);
  });

  it('has empty variants for a new character', () => {
    for (const variant of ['noevents', 'noinstall'] as const) {
      const fresh = fixtureMe(NOW, variant);
      expect(fresh.xp).toBe(0);
      expect(levelFor(fresh.xp)).toBe(1);
      expect(fresh.charms).toEqual([]);
      expect(fresh.week).toBeNull();
      expect(fixtureLogEntries(NOW, variant)).toEqual([]);
    }
    expect(fixtureInstallations('noinstall').installations).toEqual([]);
    expect(fixtureInstallations('noevents').installations).toHaveLength(1);
    expect(fixtureInstallations().installations).toHaveLength(1);
  });

  it('computes ISO week keys', () => {
    expect(isoWeekKey(Date.UTC(2026, 10, 11))).toBe('2026-46');
    expect(isoWeekKey(Date.UTC(2026, 0, 1))).toBe('2026-01');
    expect(isoWeekKey(Date.UTC(2027, 0, 1))).toBe('2026-53');
  });
});

describe('pagination', () => {
  it('splits the log into two pages with no overlap', () => {
    const first = pageOf(entries, null);
    expect(first.entries).toHaveLength(FIXTURE_PAGE_SIZE);
    expect(first.nextCursor).not.toBeNull();
    const second = pageOf(entries, first.nextCursor);
    expect(second.entries).toHaveLength(entries.length - FIXTURE_PAGE_SIZE);
    expect(second.nextCursor).toBeNull();
    expect([...first.entries, ...second.entries]).toEqual(entries);
  });

  it('treats a junk cursor as the first page', () => {
    expect(pageOf(entries, 'zzz').entries[0]).toEqual(entries[0]);
  });
});

describe('createFixtureApi', () => {
  it('answers the three reads', async () => {
    const api = createFixtureApi({ now: NOW });
    expect((await api.me()).login).toBe('octo-dev');
    expect((await api.log()).entries).toHaveLength(FIXTURE_PAGE_SIZE);
    expect((await api.installations()).installations).toHaveLength(1);
  });

  it('honours the page size and simulated latency', async () => {
    vi.useFakeTimers();
    const api = createFixtureApi({ now: NOW, pageSize: 3, latencyMs: 50 });
    const pending = api.log();
    await vi.advanceTimersByTimeAsync(50);
    expect((await pending).entries).toHaveLength(3);
  });

  it('lets one row arrive after liveAfterMs and levels the character up', async () => {
    vi.useFakeTimers({ now: NOW });
    const api = createFixtureApi({ now: NOW, liveAfterMs: 5000 });
    const before = await api.me();
    expect((await api.log()).entries[0]?.prNumber).toBe(412);

    await vi.advanceTimersByTimeAsync(5000);
    const after = await api.me();
    const log = await api.log();
    expect(log.entries[0]?.id.endsWith('#fixture-live')).toBe(true);
    expect(log.entries[0]?.prNumber).toBe(431);
    expect(after.xp).toBe(before.xp + (log.entries[0]?.xp ?? 0));
    expect(levelFor(before.xp)).toBe(41);
    expect(levelFor(after.xp)).toBe(42);
    expect(after.week?.weeklyXp).toBe((before.week?.weeklyXp ?? 0) + (log.entries[0]?.xp ?? 0));
    expect(after.gold).toBeGreaterThan(before.gold);
  });

  it('never invents a live row for the empty variants', async () => {
    vi.useFakeTimers({ now: NOW });
    const api = createFixtureApi({ now: NOW, variant: 'noevents', liveAfterMs: 1 });
    await vi.advanceTimersByTimeAsync(10);
    expect((await api.log()).entries).toEqual([]);
    const skillXp: SkillXp = (await api.me()).skillXp;
    expect(skillXp.smithing).toBe(0);
  });
});
