/** In-world display names (game-design.md pillar: no menu describes itself in GitHub terms). */
import type { ActId, MogulId, MonsterId, Skill } from '@mergescape/shared';

export const MONSTER_NAMES: Readonly<Record<MonsterId, string>> = {
  'merge-goblin': 'Merge Goblin',
  'nitpick-imp': 'Nitpick Imp',
  'flaky-test-wraith': 'Flaky Test Wraith',
  'legacy-golem': 'Legacy Golem',
  'rebase-hydra': 'Rebase Hydra',
  'scope-creep': 'Scope Creep',
  'release-dragon': 'Release Dragon',
  'silent-monolith': 'The Silent Monolith',
  'rocket-man': 'The Rocket Man',
  'leather-jacket': 'The Leather Jacket',
  turtleneck: 'The Turtleneck',
  hoodie: 'The Hoodie',
  founder: 'The Founder',
  'two-pizza-boss': 'The Two-Pizza Boss',
};

export function mogulName(id: MogulId): string {
  return MONSTER_NAMES[id];
}

/** The three acts of the weekly run, in order. */
export const ACT_LABELS: Readonly<Record<ActId, { numeral: string; name: string }>> = {
  scout: { numeral: 'I', name: 'Scout' },
  raid: { numeral: 'II', name: 'Raid' },
  boss: { numeral: 'III', name: 'Boss' },
};

/** Colour token per skill, for the level-up flash and the skill panels. */
export const SKILL_COLOR_VAR: Readonly<Record<Skill, string>> = {
  smithing: 'var(--skill-smithing)',
  vigilance: 'var(--skill-vigilance)',
  oratory: 'var(--skill-oratory)',
  endurance: 'var(--skill-endurance)',
};
