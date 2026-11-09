import {
  CHARM_POWER_BY_RARITY,
  CHARM_PRICE_BY_RARITY,
  CHARM_RULES,
  MAX_CHARM_COPIES,
  POINTS,
  SHOP,
} from './constants';
import type { Rarity } from './constants';
import { utcDay } from './calendar';
import { eventLines, hoursBetween } from './facts';
import { tidy } from './math';
import { charmSlotCount } from './vouchers';
import type {
  BreakdownLine,
  Charm,
  GameEvent,
  PlayerState,
  PowerContext,
  PRState,
  Result,
} from './types';

/**
 * The nine Charms (design.md 6.3 as audited in game-design.md 8.3). A definition carries:
 * - `basePower`: Power the Charm always gives, per copy. 0 where the text only gives a conditional effect.
 * - `condition` and `conditionalPower`: extra Power per copy on events where the condition holds.
 * - the rule changes (Second Pair of Eyes, Jester's Rebase, Loaded Dice, Oracle), which are read where the
 *   rule lives: `partyBonusPoints`, `riposteMultiplier`, power.ts, and `canSeeNextMogul`.
 * Rarity (common +0.25, uncommon +0.5, rare +1, legendary +2) is the nominal tier; each Charm's actual
 * numbers are the ones in its description, as in the design table.
 */

export type CharmId =
  | 'rubber-duck'
  | 'lantern'
  | 'small-hands'
  | 'second-pair-of-eyes'
  | 'hot-potato'
  | 'grey-beard'
  | 'jesters-rebase'
  | 'loaded-dice'
  | 'oracle';

/** A Charm's condition over the event being scored, the player before it, the PR before it, and the clock. */
export type CharmCondition = (
  event: GameEvent,
  player: PlayerState,
  pr: PRState,
  now: number,
) => boolean;

export interface CharmDefinition {
  id: CharmId;
  name: string;
  rarity: Rarity;
  description: string;
  /** Unconditional Power per copy. */
  basePower: number;
  /** Extra Power per copy when `condition` holds. 0 when the Charm has no conditional Power. */
  conditionalPower: number;
  /** Short phrase shown in the Combat Log when the condition fired, e.g. "first event of the day". */
  conditionLabel: string;
  condition?: CharmCondition;
}

const rubberDuckCondition: CharmCondition = (event, _player, pr) =>
  event.kind === 'review_submitted' &&
  (pr.reviewerCounters[String(event.actor.id)]?.inline ?? 0) >=
    CHARM_RULES.rubberDuckInlineComments;

const lanternCondition: CharmCondition = (event, player, _pr, now) =>
  event.kind !== 'weekly_streak' && player.counters.dailyFirstDay !== utcDay(now);

const smallHandsCondition: CharmCondition = (event, _player, pr) =>
  event.kind === 'pr_merged' && eventLines(event.pr, pr) < CHARM_RULES.smallHandsMaxLoc;

const hotPotatoCondition: CharmCondition = (event, _player, pr) =>
  event.kind === 'review_submitted' &&
  event.state === 'APPROVED' &&
  eventLines(event.pr, pr) < CHARM_RULES.hotPotatoMaxLoc &&
  (hoursBetween(event.pr.openedAt, event.submittedAt) ?? Infinity) <=
    CHARM_RULES.hotPotatoWindowHours;

const greyBeardCondition: CharmCondition = (event, player) =>
  'pr' in event && (player.repoMerges[String(event.pr.repoId)] ?? 0) >= CHARM_RULES.greyBeardMerges;

export const CHARMS: readonly CharmDefinition[] = [
  {
    id: 'rubber-duck',
    name: 'Rubber Duck',
    rarity: 'common',
    description: '+0.25 Power; +0.25 more on reviews with 3 or more inline comments.',
    basePower: CHARM_POWER_BY_RARITY.common,
    conditionalPower: CHARM_RULES.rubberDuckExtraPower,
    conditionLabel: `${CHARM_RULES.rubberDuckInlineComments}+ inline comments`,
    condition: rubberDuckCondition,
  },
  {
    id: 'lantern',
    name: 'Lantern',
    rarity: 'common',
    description: '+0.5 Power on the first scored event of each day.',
    basePower: 0,
    conditionalPower: CHARM_RULES.lanternPower,
    conditionLabel: 'first event of the day',
    condition: lanternCondition,
  },
  {
    id: 'small-hands',
    name: 'Small Hands',
    rarity: 'uncommon',
    description: 'Merges under 150 lines gain +0.75 Power.',
    basePower: 0,
    conditionalPower: CHARM_RULES.smallHandsPower,
    conditionLabel: `merge under ${CHARM_RULES.smallHandsMaxLoc} lines`,
    condition: smallHandsCondition,
  },
  {
    id: 'second-pair-of-eyes',
    name: 'Second Pair of Eyes',
    rarity: 'uncommon',
    description: 'The party bonus is worth 60 points instead of 30.',
    basePower: 0,
    conditionalPower: 0,
    conditionLabel: '',
  },
  {
    id: 'hot-potato',
    name: 'Hot Potato',
    rarity: 'rare',
    description: 'Approving a PR under 200 lines within 2 hours of its opening gives +1.5 Power.',
    basePower: 0,
    conditionalPower: CHARM_RULES.hotPotatoPower,
    conditionLabel: `approved within ${CHARM_RULES.hotPotatoWindowHours} h`,
    condition: hotPotatoCondition,
  },
  {
    id: 'grey-beard',
    name: 'Grey Beard',
    rarity: 'rare',
    description: '+1.0 Power on any PR in a repository where you have merged 50 times or more.',
    basePower: 0,
    conditionalPower: CHARM_RULES.greyBeardPower,
    conditionLabel: `${CHARM_RULES.greyBeardMerges}+ merges in this repo`,
    condition: greyBeardCondition,
  },
  {
    id: 'jesters-rebase',
    name: "Jester's Rebase",
    rarity: 'legendary',
    description:
      'Riposte points are multiplied by 4, and changes you request earn a Riposte when the PR merges.',
    basePower: 0,
    conditionalPower: 0,
    conditionLabel: '',
  },
  {
    id: 'loaded-dice',
    name: 'Loaded Dice',
    rarity: 'legendary',
    description: 'Once a week, one event has its Power replaced by 10.',
    basePower: 0,
    conditionalPower: 0,
    conditionLabel: '',
  },
  {
    id: 'oracle',
    name: 'Oracle',
    rarity: 'legendary',
    description: 'The Boss modifier is revealed a week early and you may ban one.',
    basePower: 0,
    conditionalPower: 0,
    conditionLabel: '',
  },
];

const BY_ID: ReadonlyMap<string, CharmDefinition> = new Map(
  CHARMS.map((charm) => [charm.id, charm]),
);

export function charmDefinition(id: string): CharmDefinition | undefined {
  return BY_ID.get(id);
}

/** Definitions of one rarity, in catalogue order. */
export function charmsOfRarity(rarity: Rarity): CharmDefinition[] {
  return CHARMS.filter((charm) => charm.rarity === rarity);
}

/** A fresh held Charm for a definition: one copy, its base Power. */
export function makeCharm(definition: CharmDefinition): Charm {
  return {
    id: definition.id,
    name: definition.name,
    rarity: definition.rarity,
    power: definition.basePower,
  };
}

/** Copies stacked in a held Charm (1 when absent). */
export function copiesOf(charm: Charm): number {
  return charm.copies ?? 1;
}

export function hasCharm(player: PlayerState, id: CharmId): boolean {
  return player.charms.some((charm) => charm.id === id);
}

// ---------------------------------------------------------------------------------------------
// Power
// ---------------------------------------------------------------------------------------------

function copyLabel(name: string, copies: number): string {
  return copies > 1 ? `${name} x${copies}` : name;
}

/**
 * One Combat Log line per Charm that contributes Power to this event. Without a context (the baseline
 * Power shown on the Character sheet) only the unconditional Power counts. Charms contributing nothing are
 * omitted.
 */
export function charmPowerLines(player: PlayerState, ctx?: PowerContext): BreakdownLine[] {
  const lines: BreakdownLine[] = [];
  for (const charm of player.charms) {
    const copies = copiesOf(charm);
    const definition = charmDefinition(charm.id);
    const fired =
      ctx !== undefined && definition?.condition?.(ctx.event, player, ctx.pr, ctx.now) === true;
    const extra = fired ? definition.conditionalPower * copies : 0;
    const value = tidy(charm.power * copies + extra);
    if (value !== 0) {
      const name = copyLabel(charm.name, copies);
      lines.push({
        label: fired ? `${name} (${definition.conditionLabel})` : name,
        value,
        kind: 'power',
      });
    }
  }
  return lines;
}

/** True when Loaded Dice is held and this week's charge is unspent. */
export function loadedDiceReady(player: PlayerState): boolean {
  return hasCharm(player, 'loaded-dice') && !player.week.loadedDiceUsed;
}

// ---------------------------------------------------------------------------------------------
// Points rules held by Charms
// ---------------------------------------------------------------------------------------------

/** Points of the party bonus: 30, plus 30 per copy of Second Pair of Eyes held. */
export function partyBonusPoints(player: PlayerState): number {
  const copies = player.charms
    .filter((charm) => charm.id === 'second-pair-of-eyes')
    .reduce((sum, charm) => sum + copiesOf(charm), 0);
  return POINTS.party + CHARM_RULES.secondPairExtraPartyPoints * copies;
}

/** Multiplier on Riposte points: 4 with Jester's Rebase, otherwise 1. */
export function riposteMultiplier(player: PlayerState): number {
  return hasCharm(player, 'jesters-rebase') ? CHARM_RULES.jestersRiposteMultiplier : 1;
}

// ---------------------------------------------------------------------------------------------
// Slots, stacking and selling (Requirements 9.1 and 8.4)
// ---------------------------------------------------------------------------------------------

/** Charm slots in use, counting the one the Founder's Board is holding. */
export function charmSlotsUsed(player: PlayerState): number {
  return player.charms.length + (player.moguls.benched === null ? 0 : 1);
}

export function freeCharmSlots(player: PlayerState): number {
  return Math.max(0, charmSlotCount(player) - charmSlotsUsed(player));
}

/** Gold a Charm of this rarity sells for: half its shop price, rounded down. */
export function charmSellPrice(rarity: Rarity): number {
  return Math.floor(CHARM_PRICE_BY_RARITY[rarity] * SHOP.sellFraction);
}

/** A Charm leaving the player for gold. The caller credits `proceeds` through economy.ts. */
export interface CharmSale {
  charmId: string;
  name: string;
  rarity: Rarity;
  /** Gold the sale returns. */
  proceeds: number;
  /** `duplicate`: a third copy sold on arrival; `player`: the player chose to sell. */
  reason: 'duplicate' | 'player';
}

function saleOf(charm: Charm, reason: CharmSale['reason']): CharmSale {
  return {
    charmId: charm.id,
    name: charm.name,
    rarity: charm.rarity,
    proceeds: charmSellPrice(charm.rarity),
    reason,
  };
}

export type CharmOutcome = 'added' | 'stacked' | 'auto_sold';

export type AddCharmResult = Result<
  { player: PlayerState; outcome: CharmOutcome; sale: CharmSale | null },
  'no_free_slot'
>;

/**
 * Give the player a Charm. A Charm they already hold stacks into the same slot once (two copies); a third
 * copy is auto-sold, returned as `sale` rather than credited here. A new Charm needs a free slot. A stacked
 * copy adds the held Charm's own per-copy Power.
 */
export function addCharm(player: PlayerState, charm: Charm): AddCharmResult {
  const index = player.charms.findIndex((held) => held.id === charm.id);
  if (index >= 0) {
    const held = player.charms[index] as Charm;
    if (copiesOf(held) >= MAX_CHARM_COPIES) {
      return { ok: true, player, outcome: 'auto_sold', sale: saleOf(charm, 'duplicate') };
    }
    const charms = player.charms.map((entry, at) =>
      at === index ? { ...held, copies: copiesOf(held) + 1 } : entry,
    );
    return { ok: true, player: { ...player, charms }, outcome: 'stacked', sale: null };
  }
  if (freeCharmSlots(player) === 0) {
    return { ok: false, error: 'no_free_slot' };
  }
  return {
    ok: true,
    player: { ...player, charms: [...player.charms, { ...charm, copies: 1 }] },
    outcome: 'added',
    sale: null,
  };
}

/** Sell one copy of a held Charm (the whole slot when it is the last copy). */
export function sellCharm(
  player: PlayerState,
  charmId: string,
): Result<{ player: PlayerState; sale: CharmSale }, 'not_held'> {
  const index = player.charms.findIndex((held) => held.id === charmId);
  if (index < 0) {
    return { ok: false, error: 'not_held' };
  }
  const held = player.charms[index] as Charm;
  const charms =
    copiesOf(held) > 1
      ? player.charms.map((entry, at) =>
          at === index ? { ...held, copies: copiesOf(held) - 1 } : entry,
        )
      : player.charms.filter((_, at) => at !== index);
  return { ok: true, player: { ...player, charms }, sale: saleOf(held, 'player') };
}

/**
 * True when Loaded Dice fires on this event: it is held, this week's charge is unspent, and there is an
 * event (a context). The baseline Power calculation never spends it.
 */
export function loadedDiceFires(player: PlayerState, ctx?: PowerContext): boolean {
  return ctx !== undefined && loadedDiceReady(player);
}
