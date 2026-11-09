/**
 * Fixture state for the depth layer (docs/api-contract.md, last paragraph of "Depth layer"): what
 * `?fixture=1` shows on Expedition, Forge, Feats, Town and Character without a network.
 *
 * `active` (and `monday`) is a Renown 17 Smith back from a 24 h trip to Silverhall that has not been
 * collected, with one Forge order working and one ready, a few pieces in the inventory and an Iron set
 * worn, two unopened Charm packs, and six Feats (two unlocked, one pinned, one hidden). `day0` is the
 * moment after a brand-new character's first kill (game-design.md section 10): the Koko Woods Forage has
 * been sent by itself and nothing else has happened. The fresh variants have an empty satchel and no
 * expedition.
 */
import {
  emptySatchel,
  featDefinition,
  makePiece,
  petDefinition,
  petPiece,
  uniqueDefinition,
  uniquePiece,
} from '@mergescape/shared';
import type { ExpeditionState, ForgeJob, GearPiece, Satchel } from '@mergescape/shared';
import type { FeatView, MeResponse } from '../types';
import type { FixtureVariant } from './state';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** The depth fields of a `MeResponse`. */
export type FixtureDepth = Pick<
  MeResponse,
  | 'satchel'
  | 'inventory'
  | 'gear'
  | 'pets'
  | 'charmPacks'
  | 'forge'
  | 'titles'
  | 'pinnedFeats'
  | 'expedition'
  | 'tzOffsetMinutes'
  | 'badgePublic'
>;

function unique(ref: string, id: string): GearPiece {
  const definition = uniqueDefinition(ref);
  if (!definition) {
    throw new Error(`unknown unique ${ref}`);
  }
  return uniquePiece(definition, id);
}

function pet(id: string): GearPiece {
  const definition = petDefinition(id);
  if (!definition) {
    throw new Error(`unknown pet ${id}`);
  }
  return petPiece(definition);
}

/** The seed of the returned expedition: a 24 h Silverhall trip whose five items include a unique and a Charm pack. */
export const FIXTURE_RETURNED_SEED = 472;

/** The seed of the day-0 Forage: Leather Armour, 4 Timber and 1 Provisions. */
export const FIXTURE_FORAGE_SEED = 1;

export function fixtureSatchel(overrides: Partial<Satchel> = {}): Satchel {
  return { ...emptySatchel(), ...overrides };
}

/** The 24 h Silverhall trip that came back two hours ago. */
function returnedExpedition(now: number): ExpeditionState {
  return {
    region: 'silverhall',
    hours: 24,
    forage: false,
    sentAt: now - 26 * HOUR,
    returnsAt: now - 2 * HOUR,
    seed: FIXTURE_RETURNED_SEED,
    provisionsPaid: 4,
    packBonus: 0,
    collected: false,
  };
}

/** The Forage the first scored event sends by itself (Requirement 15.6): four hours at Koko Woods, free. */
function onboardingExpedition(now: number, sentMinutesAgo: number): ExpeditionState {
  const sentAt = now - sentMinutesAgo * MINUTE;
  return {
    region: 'koko-woods',
    hours: 4,
    forage: true,
    sentAt,
    returnsAt: sentAt + 4 * HOUR,
    seed: FIXTURE_FORAGE_SEED,
    provisionsPaid: 0,
    packBonus: 0,
    collected: false,
  };
}

function workingForgeJob(now: number): ForgeJob {
  return {
    recipe: 'forge:weapon:silver',
    station: 'forge',
    startedAt: now - 3 * HOUR,
    doneAt: now + 5 * HOUR,
    seed: 7101,
    collected: false,
  };
}

function readyLoomJob(now: number): ForgeJob {
  return {
    recipe: 'loom:cape:iron',
    station: 'loom',
    startedAt: now - 6 * HOUR,
    doneAt: now - 2 * HOUR,
    seed: 7102,
    collected: false,
  };
}

/** Where the day-0 expedition was sent, in minutes before the fixture's "now". */
export const DAY0_SENT_MINUTES_AGO = 6;

export function fixtureDepth(now: number, variant: FixtureVariant): FixtureDepth {
  if (variant === 'day0') {
    return {
      // What the first scored event dropped: 2 Ore, 1 Timber, 3 Provisions (party bonus and first of the day).
      satchel: fixtureSatchel({ ore: 2, timber: 1, provisions: 3 }),
      inventory: [],
      gear: { equipped: {}, setBonus: 0, capeColor: null },
      pets: ['linter-cat'],
      charmPacks: [],
      forge: { upgrades: [], stations: {} },
      titles: [],
      pinnedFeats: [],
      expedition: onboardingExpedition(now, DAY0_SENT_MINUTES_AGO),
      tzOffsetMinutes: null,
      badgePublic: true,
    };
  }
  if (variant === 'noevents' || variant === 'noinstall') {
    return {
      satchel: fixtureSatchel(),
      inventory: [],
      gear: { equipped: {}, setBonus: 0, capeColor: null },
      pets: ['linter-cat'],
      charmPacks: [],
      forge: { upgrades: [], stations: {} },
      titles: [],
      pinnedFeats: [],
      expedition: null,
      tzOffsetMinutes: null,
      badgePublic: true,
    };
  }
  return {
    satchel: fixtureSatchel({
      ore: 18,
      timber: 24,
      lore: 12,
      ink: 9,
      provisions: 4,
      flux: 3,
      silver: 5,
    }),
    // Spare pieces: a unique, an affixed Leather piece, a Silver cape to move up to, a lucky trinket.
    inventory: [
      unique('fernblade', 'fx-fernblade'),
      makePiece({ id: 'fx-leather-armour', slot: 'body', tier: 'leather', affix: 'quick' }),
      makePiece({ id: 'fx-silver-cape', slot: 'cape', tier: 'silver' }),
      unique('pedlars-button', 'fx-pedlars-button'),
    ],
    // A full Iron set: every slot the same tier, so the +0.25 set bonus is earned.
    gear: {
      equipped: {
        weapon: makePiece({ id: 'fx-iron-blade', slot: 'weapon', tier: 'iron' }),
        body: makePiece({ id: 'fx-iron-armour', slot: 'body', tier: 'iron', affix: 'stout' }),
        cape: makePiece({ id: 'fx-iron-cape', slot: 'cape', tier: 'iron' }),
        trinket: makePiece({ id: 'fx-iron-trinket', slot: 'trinket', tier: 'iron', affix: 'keen' }),
        pet: pet('goblin-runt'),
      },
      setBonus: 0.25,
      capeColor: null,
    },
    pets: ['linter-cat', 'rubber-duck', 'goblin-runt'],
    // Two unopened Charm packs: the seeds fix their three Charms (`lootPackOptions`).
    charmPacks: [4101, 4102],
    forge: {
      upgrades: [],
      stations: { forge: workingForgeJob(now), loom: readyLoomJob(now) },
    },
    titles: ['Imp Whisperer'],
    pinnedFeats: ['goblin-slayer'],
    expedition: returnedExpedition(now),
    tzOffsetMinutes: null,
    badgePublic: true,
  };
}

interface FeatSeed {
  id: string;
  progress: number;
  unlockedDaysAgo?: number;
  pinned?: boolean;
}

/** One `GET /feats` row, the way the shared `featStatuses` shapes it. */
function featRow(now: number, seed: FeatSeed): FeatView {
  const definition = featDefinition(seed.id);
  if (!definition) {
    throw new Error(`unknown Feat ${seed.id}`);
  }
  const unlocked = seed.unlockedDaysAgo !== undefined;
  const shown = unlocked || !definition.hidden;
  return {
    id: definition.id,
    name: shown ? definition.name : '???',
    category: definition.category,
    hidden: definition.hidden,
    hint: definition.hint,
    description: shown ? definition.description : null,
    progress: unlocked ? 1 : seed.progress,
    unlocked,
    pinned: seed.pinned ?? false,
    reward: shown ? definition.reward : null,
    ...(unlocked
      ? { unlockedAt: new Date(now - (seed.unlockedDaysAgo ?? 0) * DAY).toISOString() }
      : {}),
  };
}

/**
 * Six Feats, in catalogue order: Mass Reviewer and Surgeon part-way, Goblin Slayer (pinned) and Imp
 * Whisperer unlocked, Spelunker one expedition short of unlocking (the returned trip is its hundredth),
 * and The Old Coin hidden. Fresh characters have the same six with nothing earned.
 */
export function fixtureFeats(now: number, variant: FixtureVariant): FeatView[] {
  const veteran = variant === 'active' || variant === 'monday';
  const seeds: FeatSeed[] = veteran
    ? [
        { id: 'mass-reviewer', progress: 0.34 },
        { id: 'surgeon', progress: 0.62 },
        { id: 'goblin-slayer', progress: 1, unlockedDaysAgo: 12, pinned: true },
        { id: 'imp-whisperer', progress: 1, unlockedDaysAgo: 44 },
        { id: 'spelunker', progress: 0.99 },
        { id: 'the-old-coin', progress: 0 },
      ]
    : [
        { id: 'mass-reviewer', progress: 0 },
        { id: 'surgeon', progress: variant === 'day0' ? 0.02 : 0 },
        { id: 'goblin-slayer', progress: variant === 'day0' ? 0.001 : 0 },
        { id: 'imp-whisperer', progress: 0 },
        { id: 'spelunker', progress: 0 },
        { id: 'the-old-coin', progress: 0 },
      ];
  return seeds.map((seed) => featRow(now, seed));
}

/** The Feat the returned expedition completes when it is collected (its hundredth trip). */
export const FIXTURE_COLLECT_UNLOCKS = 'spelunker';
