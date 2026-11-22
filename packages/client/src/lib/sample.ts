/**
 * One real kill, as the scorer produced it for a level-41 Smith with three Charms: the example the
 * signed-out page explains, and the newest row of the demo Combat Log (fixtures/raw-log.ts). It lives
 * here, apart from the fixtures, so the live page does not import fixture code to show it.
 */
import type { LogEntry } from './types';

/** A Combat Log row without the two fields that depend on when it is shown: `id` and `at`. */
export type SampleRow = Omit<LogEntry, 'id' | 'at'>;

export const SAMPLE_KILL: SampleRow = {
  kind: 'pr_merged',
  prNumber: 412,
  repoId: 11,
  repoName: 'octo/api',
  additions: 318,
  deletions: 97,
  monster: 'merge-goblin',
  skill: 'smithing',
  points: 240,
  power: 2.75,
  zone: 395.54770098542724,
  level: 41,
  xp: 261061,
  skillXp: { smithing: 261061, vigilance: 0, oratory: 0, endurance: 0 },
  supplies: { ore: 3, timber: 1, lore: 0, ink: 0, provisions: 2, flux: 0 },
  breakdown: [
    { label: 'PR merged', value: 90, kind: 'points' },
    { label: 'Size (log-scaled, 415 lines)', value: 120, kind: 'points' },
    { label: 'Reviewed by another human', value: 30, kind: 'points' },
    { label: 'Base Power', value: 1, kind: 'power' },
    { label: 'Rubber Duck', value: 0.25, kind: 'power' },
    { label: 'Small Hands', value: 0.5, kind: 'power' },
    { label: 'Hot Potato', value: 1, kind: 'power' },
    { label: 'Zone (level 41)', value: 395.54770098542724, kind: 'zone' },
    { label: 'XP', value: 261061, kind: 'xp' },
    { label: 'Smithing XP', value: 261061, kind: 'xp' },
  ],
};

/** The sample kill as a Combat Log row stamped `now`. */
export function sampleKill(now: number): LogEntry {
  const at = new Date(now).toISOString();
  return { ...SAMPLE_KILL, id: `${at}#sample`, at };
}
