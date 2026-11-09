import { describe, expect, it } from 'vitest';
import { breakdownRows } from './breakdown';
import { fixtureLogEntries } from './fixtures/state';
import {
  creditedSkills,
  formatDecimal,
  formatGain,
  formatInt,
  relativeTime,
  summarize,
  suppliesText,
  targetLabel,
} from './format';
import type { LogEntry } from './types';

const NOW = Date.UTC(2026, 10, 11, 14, 5, 0);
const rows = fixtureLogEntries(NOW);
const byPr = (n: number): LogEntry => {
  const row = rows.find((candidate) => candidate.prNumber === n);
  if (!row) {
    throw new Error(`no fixture row for PR ${n}`);
  }
  return row;
};

describe('numbers', () => {
  it('groups digits and trims decimals', () => {
    expect(formatInt(21151701)).toBe('21,151,701');
    expect(formatDecimal(3.75)).toBe('3.75');
    expect(formatDecimal(395.54770098542724)).toBe('395.55');
    expect(formatDecimal(4)).toBe('4');
    expect(formatGain(261061)).toBe('+261,061');
  });
});

describe('relativeTime', () => {
  const at = (minutesAgo: number) => new Date(NOW - minutesAgo * 60_000).toISOString();
  it.each([
    [0, 'just now'],
    [2, '2 min ago'],
    [59, '59 min ago'],
    [125, '2 h ago'],
    [24 * 60, 'yesterday'],
    [3 * 24 * 60, '3 days ago'],
  ])('%i minutes ago -> %s', (minutes, expected) => {
    expect(relativeTime(at(minutes), NOW)).toBe(expected);
  });

  it('prints a date for old rows and nothing for a bad timestamp', () => {
    expect(relativeTime(at(20 * 24 * 60), NOW)).toMatch(/^[A-Z][a-z]{2} \d{1,2}$/);
    expect(relativeTime('not a date', NOW)).toBe('');
  });
});

describe('summarize', () => {
  it('names the repository only when the row carries one', () => {
    expect(summarize(byPr(412))).toBe('Merged octo/api #412 (+318 / −97)');
    expect(summarize(byPr(77))).toBe('Approved PR #77 in a private repo');
    expect(targetLabel(byPr(77))).toBe('PR #77 in a private repo');
    const anonymous: LogEntry = { ...byPr(412) };
    delete anonymous.repoName;
    expect(summarize(anonymous)).toBe('Merged PR #412 (+318 / −97)');
  });

  it('summarises every kind of row from counts and ids only', () => {
    expect(summarize(byPr(88))).toBe('Requested changes on octo/web #88 · 7 inline');
    expect(summarize({ ...byPr(412), kind: 'pr_opened' })).toBe('Opened octo/api #412');
    expect(summarize({ ...byPr(412), kind: 'review_comment_created' })).toBe(
      'Inline comment on octo/api #412',
    );
    expect(summarize({ ...byPr(412), kind: 'verified_kill' })).toBe(
      'Verified kill: octo/api #412 merged',
    );
    expect(summarize({ ...byPr(412), kind: 'review_submitted', reviewState: 'COMMENTED' })).toBe(
      'Reviewed octo/api #412',
    );
    const streak = rows.find((row) => row.kind === 'weekly_streak');
    expect(streak && summarize(streak)).toBe('Weekly streak');
  });
});

describe('row helpers', () => {
  it('lists the skills credited, in display order', () => {
    const firstOfDay = byPr(409);
    expect(creditedSkills(firstOfDay).map((skill) => skill.label)).toEqual([
      'Vigilance',
      'Endurance',
    ]);
  });

  it('prints supplies, skipping zeros', () => {
    expect(suppliesText(byPr(412).supplies)).toBe('+3 Ore, +1 Timber, +2 Provisions');
    expect(suppliesText({ ore: 0, timber: 0, lore: 0, ink: 0, provisions: 0, flux: 0 })).toBe('');
  });
});

describe('breakdownRows', () => {
  it('orders the terms Points, Power, Zone, XP and closes each group with its subtotal', () => {
    const lines = breakdownRows(byPr(412)).map((row) => `${row.group}:${row.label}|${row.value}`);
    expect(lines).toEqual([
      '0:PR merged|+90',
      '0:Size (log-scaled, 415 lines)|+120',
      '0:Reviewed by another human|+30',
      '0:Points|= 240',
      '1:Base Power|1',
      '1:Rubber Duck|+0.25',
      '1:Small Hands|+0.5',
      '1:Hot Potato|+1',
      '1:Power|× 2.75',
      '2:Zone (level 41)|× 395.55',
      '3:XP|= 261,061',
      '3:Smithing XP|+261,061',
    ]);
  });

  it('shows a negative Power term (the cap line) with a minus sign', () => {
    const capped = breakdownRows({
      points: 10,
      power: 9,
      breakdown: [
        { label: 'x', value: 10, kind: 'points' },
        { label: 'Base Power', value: 1, kind: 'power' },
        { label: 'Power cap', value: -1.5, kind: 'power' },
      ],
    });
    expect(capped.find((row) => row.label === 'Power cap')?.value).toBe('−1.5');
  });
});
