import { SKILLS, VOCATION_THRESHOLDS } from '@mergescape/shared';
import type { SkillXp } from '@mergescape/shared';
import type { Vocation } from './api-types';

/**
 * Vocation from the share of total skill XP, in the precedence of Requirement 5.3: Smith if Smithing is at
 * least 55%, Warden if Vigilance is at least 55%, Herald if Oratory is at least 35%, Pilgrim if Endurance is
 * at least 25%, otherwise Journeyman. A character with no XP is a Journeyman.
 */
export function vocationFor(skillXp: SkillXp): Vocation {
  const total = SKILLS.reduce((sum, skill) => sum + skillXp[skill], 0);
  if (total <= 0) {
    return 'Journeyman';
  }
  const share = (skill: keyof SkillXp): number => skillXp[skill] / total;
  if (share('smithing') >= VOCATION_THRESHOLDS.smith) {
    return 'Smith';
  }
  if (share('vigilance') >= VOCATION_THRESHOLDS.warden) {
    return 'Warden';
  }
  if (share('oratory') >= VOCATION_THRESHOLDS.herald) {
    return 'Herald';
  }
  return share('endurance') >= VOCATION_THRESHOLDS.pilgrim ? 'Pilgrim' : 'Journeyman';
}
