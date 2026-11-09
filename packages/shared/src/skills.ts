import { levelFor } from './d2table';
import type { Skill, SkillXp } from './types';

/** The four skills in display order (Requirement 5.2). */
export const SKILLS: readonly Skill[] = ['smithing', 'vigilance', 'oratory', 'endurance'];

export function emptySkillXp(): SkillXp {
  return { smithing: 0, vigilance: 0, oratory: 0, endurance: 0 };
}

/** OSRS-style total level: the sum of the four skill levels (each on the same D2 table). */
export function totalLevel(skillXp: SkillXp): number {
  return SKILLS.reduce((sum, skill) => sum + levelFor(skillXp[skill]), 0);
}

/** Display names for the skills. */
export const SKILL_LABELS: Readonly<Record<Skill, string>> = {
  smithing: 'Smithing',
  vigilance: 'Vigilance',
  oratory: 'Oratory',
  endurance: 'Endurance',
};
