/**
 * Fixture state: a realistic `MeResponse`, `WeekSummary`, `LogResponse` and `InstallationsResponse`, so
 * every screen renders without a network (Requirement 10.7). Shapes are the ones in ../types.ts; the
 * Combat Log rows come from the real scorer (see raw-log.ts).
 *
 * Variants:
 * - `active`     a level-41 Smith with three Charms, an open shop, a run in progress and 14 Combat Log rows
 * - `monday`     the same player on a fresh Monday: Pledge window open, nothing played, no shop, next Mogul known
 * - `noevents`   a brand-new character with the App installed: Town shows the sleeping hero
 * - `noinstall`  a brand-new character with no installations: Town shows the install call to action
 * - `day0`        a brand-new character right after the first kill (game-design.md section 10): one Combat
 *                 Log row, a free Common Charm, the Koko Woods Forage already away, Feats at zero
 *
 * Every variant also carries the depth layer (satchel, gear, Forge, expedition); see ./depth.ts.
 */
import {
  biomeFor,
  charmDefinition,
  charmSellPrice,
  DAY_MS,
  isoWeekKey,
  makeCharm,
  MINUTE_MS,
  MOGUL_COSMETICS,
  pledgeCard,
  pledgeDefinition,
  PLEDGES,
  pledgeWindowOpen,
  starterDeck,
} from '@mergescape/shared';
import type { Charm, MonsterId, Pledge, VoucherId } from '@mergescape/shared';
import type {
  InstallationsResponse,
  LogEntry,
  LogResponse,
  MeResponse,
  PackKind,
  ShopOption,
  ShopView,
  WeekSummary,
} from '../types';
import { DAY0_SENT_MINUTES_AGO, fixtureDepth } from './depth';
import { DAY0_ROW, FINAL_SKILL_XP, FINAL_XP, RAW_LOG } from './raw-log';

export type FixtureVariant = 'active' | 'monday' | 'noevents' | 'noinstall' | 'day0';

export const FIXTURE_VARIANTS: readonly FixtureVariant[] = [
  'active',
  'monday',
  'noevents',
  'noinstall',
  'day0',
];

/** Rows per page in the fixture log, small enough that the fixture spans two pages. */
export const FIXTURE_PAGE_SIZE = 8;

export const FIXTURE_LOGIN = 'octo-dev';
export const FIXTURE_GITHUB_ID = 4242;

export const FIXTURE_CHARMS: readonly Charm[] = [
  { id: 'rubber-duck', name: 'Rubber Duck', rarity: 'common', power: 0.25 },
  { id: 'small-hands', name: 'Small Hands', rarity: 'uncommon', power: 0.5 },
  { id: 'hot-potato', name: 'Hot Potato', rarity: 'rare', power: 1 },
];

/** The deck every character starts with, which is also this week's hand in the fixture. */
const HAND: readonly Pledge[] = starterDeck();

/** Vouchers the fixture player owns: one, so the next Voucher costs 200 (150 + 50). */
const OWNED_VOUCHERS: readonly VoucherId[] = ['overclock'];

/** Lifetime kills per Bestiary id (the mock's numbers); the Silent Monolith has never appeared. */
const KILLS: Partial<Record<MonsterId, number>> = {
  'merge-goblin': 1204,
  'nitpick-imp': 377,
  'flaky-test-wraith': 58,
  'legacy-golem': 21,
  'rebase-hydra': 44,
  'scope-creep': 9,
  'release-dragon': 6,
  'rocket-man': 3,
  'leather-jacket': 3,
  turtleneck: 3,
  hoodie: 3,
  founder: 3,
  'two-pizza-boss': 2,
};

/** Days before "now" each monster was first killed (the character is 190 days old). */
const FIRST_SEEN_DAYS_AGO: Partial<Record<MonsterId, number>> = {
  'merge-goblin': 189,
  'nitpick-imp': 188,
  'flaky-test-wraith': 160,
  'legacy-golem': 141,
  'rebase-hydra': 120,
  'scope-creep': 85,
  'release-dragon': 52,
  'rocket-man': 133,
  'leather-jacket': 126,
  turtleneck: 105,
  hoodie: 98,
  founder: 77,
  'two-pizza-boss': 70,
};

/** True for the two variants of a brand-new character with no kills at all. */
function isFresh(variant: FixtureVariant): boolean {
  return variant === 'noevents' || variant === 'noinstall';
}

/** The Combat Log rows, newest first, stamped relative to `now`. */
export function fixtureLogEntries(now: number, variant: FixtureVariant = 'active'): LogEntry[] {
  if (variant === 'day0') {
    const at = new Date(now - DAY0_KILL_MINUTES_AGO * MINUTE_MS).toISOString();
    return [{ ...DAY0_ROW, id: `${at}#fixture-0001`, at }];
  }
  if (isFresh(variant)) {
    return [];
  }
  return RAW_LOG.map(({ minutesAgo, row }, index) => {
    const at = new Date(now - minutesAgo * MINUTE_MS).toISOString();
    return { ...row, id: `${at}#fixture-${String(index + 1).padStart(4, '0')}`, at };
  });
}

/** When the day-0 first kill happened, in minutes before the fixture's "now" (the Forage went out with it). */
export const DAY0_KILL_MINUTES_AGO = DAY0_SENT_MINUTES_AGO;

/** The Scout target a brand-new player gets: a flat 2,000 XP (game-design.md section 10). */
const DAY0_TARGETS = { scout: 2_000, raid: 3_300, boss: 5_000 } as const;

/** XP earned so far in the fixture run: the sum of the log rows from the weekly streak up. */
export const FIXTURE_WEEKLY_XP = 1_606_611;

/** Run targets for a player whose 8-week median is 2,370,000 XP (60% / 100% / 150%). */
const TARGETS = { scout: 1_422_000, raid: 2_370_000, boss: 3_555_000 } as const;

/** A Pledge card by id, from the shared catalogue. */
export function fixturePledge(id: string): Pledge {
  const definition = pledgeDefinition(id);
  if (!definition) {
    throw new Error(`unknown Pledge ${id}`);
  }
  return pledgeCard(definition);
}

/** A Charm as the shop sells it, from the shared catalogue. */
export function fixtureCharm(id: string): Charm {
  const definition = charmDefinition(id);
  if (!definition) {
    throw new Error(`unknown Charm ${id}`);
  }
  return makeCharm(definition);
}

const PACK_CHARM_IDS = ['lantern', 'second-pair-of-eyes', 'grey-beard', 'jesters-rebase', 'oracle'];

/** The three cards a pack of this kind shows, for the fixture's shelf and its re-rolls. */
export function fixturePackOptions(kind: PackKind, seed = 0): ShopOption[] {
  if (kind === 'pledge') {
    const ids = PLEDGES.map((pledge) => pledge.id);
    return [0, 1, 2].map((i) => ({
      kind: 'pledge' as const,
      pledge: fixturePledge(ids[(seed + i * 2 + 4) % ids.length] as string),
    }));
  }
  if (kind === 'charm') {
    return [0, 1, 2].map((i) => ({
      kind: 'charm' as const,
      charm: fixtureCharm(PACK_CHARM_IDS[(seed + i) % PACK_CHARM_IDS.length] as string),
    }));
  }
  return [0, 1, 2].map((i) => {
    const cosmetic = MOGUL_COSMETICS[(seed + i) % MOGUL_COSMETICS.length];
    return { kind: 'cosmetic' as const, id: cosmetic?.id ?? '', name: cosmetic?.name ?? '' };
  });
}

/**
 * The fixture's open shop, visit 1: two Charms (Grey Beard 120, Lantern 40), a Pledge pack that is bought
 * and waiting to be opened, a Charm pack, the Charm Belt Voucher at 200, a 20 gold re-roll, sell prices
 * for the held Charms, and the interest the next act clear would pay.
 */
export function fixtureShop(): ShopView {
  return {
    visit: 1,
    charms: [
      { index: 0, charm: fixtureCharm('grey-beard'), price: 120, sold: false },
      { index: 1, charm: fixtureCharm('lantern'), price: 40, sold: false },
    ],
    packs: [
      {
        index: 0,
        kind: 'pledge',
        price: 60,
        bought: true,
        picked: false,
        options: fixturePackOptions('pledge'),
      },
      { index: 1, kind: 'charm', price: 100, bought: false, picked: false, options: null },
    ],
    voucher: { id: 'charm-belt', price: 200, sold: false },
    rerollCost: 20,
    shrineCost: 50,
    sellPrices: Object.fromEntries(FIXTURE_CHARMS.map((c) => [c.id, charmSellPrice(c.rarity)])),
    interestPreview: 10,
  };
}

/** Progress for the Pledges played in the fixture run (the mock's numbers). */
function fixtureProgress(played: readonly Pledge[]): WeekSummary['pledgeProgress'] {
  const known: WeekSummary['pledgeProgress'] = {
    strike: { progress: 2, target: 3, completed: false },
    defend: { progress: 5, target: 5, completed: true },
    'big-game-hunter': { progress: 0, target: 1, completed: false },
  };
  return Object.fromEntries(
    played.map((pledge) => [
      pledge.id,
      known[pledge.id] ?? {
        progress: 0,
        target: pledgeDefinition(pledge.id)?.goal ?? 1,
        completed: false,
      },
    ]),
  );
}

/** The cards of the free Raid pack in the fixture: the same three every time, so the pick is reproducible. */
export function fixtureFreePackOptions(): ShopOption[] {
  return fixturePackOptions('pledge', 3);
}

export function fixtureWeek(
  now: number,
  variant: FixtureVariant = 'active',
  overrides: Partial<WeekSummary> = {},
): WeekSummary {
  const week = buildWeek(now, variant, overrides);
  // A free pack always comes with its three options, as the api sends it.
  if (
    week.freePack !== null &&
    week.freePackOptions === null &&
    !('freePackOptions' in overrides)
  ) {
    week.freePackOptions = fixtureFreePackOptions();
  }
  return week;
}

function buildWeek(
  now: number,
  variant: FixtureVariant,
  overrides: Partial<WeekSummary>,
): WeekSummary {
  if (variant === 'monday' || variant === 'day0') {
    const first = variant === 'day0';
    return {
      weekKey: isoWeekKey(now),
      act: 'scout',
      clearedActs: [],
      weeklyXp: first ? DAY0_ROW.xp : 0,
      targets: first ? { ...DAY0_TARGETS } : { ...TARGETS },
      mogul: 'hoodie',
      nextMogul: first ? null : 'founder',
      hand: HAND.map((p) => ({ ...p })),
      played: [],
      pledgeWindowOpen: true,
      pledgeProgress: {},
      shop: null,
      freePack: null,
      freePackOptions: null,
      legendaryOffer: null,
      ...overrides,
    };
  }
  const played = HAND.slice(0, 3).map((p) => ({ ...p }));
  return {
    weekKey: isoWeekKey(now),
    act: 'raid',
    clearedActs: ['scout'],
    // What the log rows since Monday add up to; the fixture run is not tied to the calendar.
    weeklyXp: FIXTURE_WEEKLY_XP,
    targets: { ...TARGETS },
    mogul: 'rocket-man',
    nextMogul: null,
    hand: HAND.map((p) => ({ ...p })),
    played,
    pledgeWindowOpen: pledgeWindowOpen(now),
    pledgeProgress: fixtureProgress(played),
    shop: fixtureShop(),
    freePack: null,
    freePackOptions: null,
    legendaryOffer: null,
    ...overrides,
  };
}

export function fixtureMe(
  now: number,
  variant: FixtureVariant = 'active',
  weekOverrides: Partial<WeekSummary> = {},
  overrides: Partial<MeResponse> = {},
): MeResponse {
  return { ...baseMe(now, variant, weekOverrides), ...overrides };
}

function baseMe(
  now: number,
  variant: FixtureVariant,
  weekOverrides: Partial<WeekSummary>,
): MeResponse {
  const depth = fixtureDepth(now, variant);
  if (variant === 'day0') {
    // The first kill: 639 XP, 21 gold, the free Common Charm and one Merge Goblin on the board.
    return {
      githubId: FIXTURE_GITHUB_ID,
      login: FIXTURE_LOGIN,
      createdAt: new Date(now - 90 * MINUTE_MS).toISOString(),
      xp: DAY0_ROW.xp,
      skillXp: { ...DAY0_ROW.skillXp },
      gold: 21,
      renown: 0,
      vocation: 'Journeyman',
      charms: [fixtureCharm('rubber-duck')],
      charmSlots: 5,
      vouchers: [],
      deck: starterDeck(),
      biome: biomeFor(0),
      kills: { 'merge-goblin': 1 },
      firstSeen: {
        'merge-goblin': new Date(now - DAY0_KILL_MINUTES_AGO * MINUTE_MS).toISOString(),
      },
      week: fixtureWeek(now, variant, weekOverrides),
      ...depth,
    };
  }
  if (isFresh(variant)) {
    return {
      githubId: FIXTURE_GITHUB_ID,
      login: FIXTURE_LOGIN,
      createdAt: new Date(now - 20 * MINUTE_MS).toISOString(),
      xp: 0,
      skillXp: { smithing: 0, vigilance: 0, oratory: 0, endurance: 0 },
      gold: 0,
      renown: 0,
      vocation: 'Journeyman',
      charms: [],
      charmSlots: 5,
      vouchers: [],
      deck: starterDeck(),
      biome: biomeFor(0),
      kills: {},
      firstSeen: {},
      week: null,
      ...depth,
    };
  }
  const firstSeen: MeResponse['firstSeen'] = {};
  for (const [id, daysAgo] of Object.entries(FIRST_SEEN_DAYS_AGO)) {
    firstSeen[id as MonsterId] = new Date(now - (daysAgo ?? 0) * DAY_MS).toISOString();
  }
  return {
    githubId: FIXTURE_GITHUB_ID,
    login: FIXTURE_LOGIN,
    createdAt: new Date(now - 190 * DAY_MS).toISOString(),
    xp: FINAL_XP,
    skillXp: { ...FINAL_SKILL_XP },
    gold: 2340,
    renown: 17,
    vocation: 'Smith',
    charms: FIXTURE_CHARMS.map((c) => ({ ...c })),
    charmSlots: 5,
    vouchers: variant === 'monday' ? [...OWNED_VOUCHERS, 'scouts-eye'] : [...OWNED_VOUCHERS],
    deck: starterDeck(),
    biome: biomeFor(17),
    kills: { ...KILLS },
    firstSeen,
    week: fixtureWeek(now, variant, weekOverrides),
    ...depth,
  };
}

export function fixtureInstallations(variant: FixtureVariant = 'active'): InstallationsResponse {
  if (variant === 'noinstall') {
    return { installations: [] };
  }
  return {
    installations: [
      { installationId: 5001, accountId: FIXTURE_GITHUB_ID, repoCount: 4, suspended: false },
    ],
  };
}

/** One page of a log, using the entry offset as the opaque cursor. */
export function pageOf(
  entries: readonly LogEntry[],
  cursor: string | null | undefined,
  pageSize: number = FIXTURE_PAGE_SIZE,
): LogResponse {
  const offset = cursor ? Math.max(0, Number.parseInt(cursor, 10) || 0) : 0;
  const end = offset + pageSize;
  return {
    entries: entries.slice(offset, end),
    nextCursor: end < entries.length ? String(end) : null,
  };
}
