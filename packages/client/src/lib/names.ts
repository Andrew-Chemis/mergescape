/** In-world display names (game-design.md pillar: no menu describes itself in GitHub terms). */
import type { ActId, MogulId, MonsterId, Rarity, Skill } from '@mergescape/shared';
import type { PackKind } from './types';

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

export const RARITY_LABELS: Readonly<Record<Rarity, string>> = {
  common: 'Common',
  uncommon: 'Uncommon',
  rare: 'Rare',
  legendary: 'Legendary',
};

/** The packs on the shop's shelf: what they are called and what keeping a card does. */
export const PACK_LABELS: Readonly<Record<PackKind, { name: string; blurb: string }>> = {
  pledge: { name: 'Pledge pack', blurb: 'See 3, keep 1. The card joins your deck.' },
  charm: { name: 'Charm pack', blurb: 'See 3, keep 1. Rarity-weighted, and it needs a free slot.' },
  cosmetic: {
    name: 'Mogul pack',
    blurb: 'See 3, keep 1. A keepsake from a Mogul, pure decoration.',
  },
};
