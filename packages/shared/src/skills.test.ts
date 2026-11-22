import { describe, expect, it } from 'vitest';
import { emptySkillXp, SKILL_LABELS, SKILLS, totalLevel } from './skills';

describe('skills', () => {
  it('has the four skills in display order', () => {
    expect(SKILLS).toEqual(['smithing', 'vigilance', 'oratory', 'endurance']);
    expect(SKILLS.map((skill) => SKILL_LABELS[skill])).toEqual([
      'Smithing',
      'Vigilance',
      'Oratory',
      'Endurance',
    ]);
  });

  it('starts every skill at 0 XP', () => {
    expect(emptySkillXp()).toEqual({ smithing: 0, vigilance: 0, oratory: 0, endurance: 0 });
  });

  it('reports total level as the sum of skill levels on the D2 table', () => {
    expect(totalLevel(emptySkillXp())).toBe(4);
    expect(
      totalLevel({ smithing: 500, vigilance: 57_715, oratory: 0, endurance: 3_520_485_254 }),
    ).toBe(2 + 10 + 1 + 99);
  });
});
