import { MOGUL_RULES } from './constants';
import { actWindow, DAY_MS, HOUR_MS, weekStartUtc } from './calendar';
import { eventLines, firstReviewTime, mergeFacts } from './facts';
import { tidy } from './math';
import { deriveSeed, mulberry32, shuffle } from './rng';
import { canSeeNextMogul } from './vouchers';
import type {
  BreakdownLine,
  Charm,
  Cosmetic,
  GameEvent,
  Mogul,
  MogulId,
  PlayerState,
  PointsFactor,
  PowerContext,
  PRMergedEvent,
  PRState,
} from './types';

/**
 * The six Moguls (Requirement 7, design.md 6.2 as audited in game-design.md 8.3): parody archetypes with
 * invented names. Nothing here names a real person, company, product or logo; a test scans this file's
 * copy for a denylist of obvious real names. The satire disclaimer below is shown in the Bestiary.
 *
 * A modifier applies only to events scored in the Boss act window (Fri-Sun), except the two whose text
 * says "this week" or "all week" (the Leather Jacket and the Founder), which apply from Monday.
 */

export const MOGUL_DISCLAIMER =
  'The Moguls are fictional caricatures. Any resemblance to persons living, dead or on a podcast is satire.';

export type MogulScope = 'boss' | 'week';

export interface MogulDefinition extends Mogul {
  /** How the pixel caricature looks. */
  look: string;
  /** The rule twist, in the words shown on the Run Map. */
  modifier: string;
  /** The joke, for the Bestiary. */
  joke: string;
  /** `boss`: Fri-Sun only; `week`: from Monday. */
  scope: MogulScope;
}

export const MOGULS: readonly MogulDefinition[] = [
  {
    id: 'rocket-man',
    name: 'The Rocket Man',
    look: 'Silver flight suit, tiny rocket on his back, 3 am energy.',
    modifier:
      'Hardcore week. Deletions count double toward size points; merges with net negative lines get +1 Power.',
    joke: '"The best part is no part." Deletes code, ships rockets.',
    scope: 'boss',
  },
  {
    id: 'leather-jacket',
    name: 'The Leather Jacket',
    look: 'Black leather jacket, grey hair, holding a glowing green brick.',
    modifier:
      'The more you merge, the more you save. Each successive reviewed merge this week adds +0.1 Power (cap +1.5); a solo merge resets the chain.',
    joke: 'Keynote catchphrase; compounding hardware demand.',
    scope: 'week',
  },
  {
    id: 'turtleneck',
    name: 'The Turtleneck',
    look: 'Black turtleneck, round glasses, jeans, one hand raised.',
    modifier:
      'One more thing. PRs under 100 lines score x3; over 400 lines score x0.5; an approval you give with exactly one inline comment is a design review and scores x2.',
    joke: 'Obsession with small, perfect things.',
    scope: 'boss',
  },
  {
    id: 'hoodie',
    name: 'The Hoodie',
    look: 'Grey tee, hoodie, VR goggles pushed up on forehead.',
    modifier:
      'Move fast. PRs merged within 48 hours of their first review score x2; every other merge scores x0.75 and goes to the Metaverse.',
    joke: 'Move fast; nobody is in the metaverse.',
    scope: 'boss',
  },
  {
    id: 'founder',
    name: 'The Founder',
    look: 'Grey crewneck, serene smile, cradling a glowing orb.',
    modifier:
      'Non-profit to for-profit. Points x0.5 but gold x4 all week. On Wednesday the Board removes one random Charm; it returns on Friday with +0.25 Power.',
    joke: 'The orb is "AGI". The Charm comes back stronger.',
    scope: 'week',
  },
  {
    id: 'two-pizza-boss',
    name: 'The Two-Pizza Boss',
    look: 'Bald, open-collar shirt, stack of pizza boxes, laughing.',
    modifier:
      'Two-pizza teams. Merges with 2 or more distinct human reviewers score x2.5; solo merges x0.25; party bonus points x3.',
    joke: 'Teams small enough to feed with two pizzas; also, day one.',
    scope: 'boss',
  },
];

export const MOGUL_IDS: readonly MogulId[] = MOGULS.map((mogul) => mogul.id);

const BY_ID = Object.fromEntries(MOGULS.map((mogul) => [mogul.id, mogul])) as Record<
  MogulId,
  MogulDefinition
>;

export function mogulDefinition(id: MogulId): MogulDefinition {
  return BY_ID[id];
}

export function isMogulId(value: string): value is MogulId {
  return Object.hasOwn(BY_ID, value);
}

/** The Mogul cosmetic pack contents: one invented keepsake per Mogul. Purely visual. */
export const MOGUL_COSMETICS: readonly Cosmetic[] = [
  { id: 'cosmetic-tiny-rocket', name: 'Tiny Rocket', mogul: 'rocket-man' },
  { id: 'cosmetic-green-brick', name: 'Glowing Green Brick', mogul: 'leather-jacket' },
  { id: 'cosmetic-round-glasses', name: 'Round Glasses', mogul: 'turtleneck' },
  { id: 'cosmetic-forehead-goggles', name: 'Forehead Goggles', mogul: 'hoodie' },
  { id: 'cosmetic-glowing-orb', name: 'Glowing Orb', mogul: 'founder' },
  { id: 'cosmetic-pizza-stack', name: 'Stack of Pizza Boxes', mogul: 'two-pizza-boss' },
];

// ---------------------------------------------------------------------------------------------
// Selection: a shuffled bag, no repeats until all six have appeared (Requirement 7.2)
// ---------------------------------------------------------------------------------------------

/**
 * Draw this week's Mogul from the profile's bag. The bag holds the Moguls still to come in the cycle, in
 * order; an empty or unusable bag (a new profile) is filled with a fresh shuffle first. The returned bag
 * is never empty: when the sixth Mogul of a cycle is drawn the next cycle is shuffled at once (and never
 * opens with the Mogul just drawn), so `bag[0]` always names next week's Mogul for the Charm and the
 * Voucher that reveal it. Deterministic in `seed`.
 */
export function selectMogul(
  bag: readonly MogulId[],
  seed: number,
): { mogul: MogulId; bag: MogulId[] } {
  const usable = [...new Set(bag.filter((id) => isMogulId(id)))];
  const cycle =
    usable.length > 0 ? usable : shuffle(MOGUL_IDS, mulberry32(deriveSeed(seed, 'mogul-bag')));
  const [mogul, ...rest] = cycle as [MogulId, ...MogulId[]];
  if (rest.length > 0) {
    return { mogul, bag: rest };
  }
  const refill = shuffle(MOGUL_IDS, mulberry32(deriveSeed(seed, 'mogul-refill')));
  if (refill[0] === mogul) {
    [refill[0], refill[1]] = [refill[1] as MogulId, refill[0] as MogulId];
  }
  return { mogul, bag: refill };
}

/**
 * Next week's Mogul, if the player may see it (Scout's Eye voucher or the revealing Legendary Charm);
 * otherwise null. The Charm's "ban one" is not modelled here.
 */
export function revealedNextMogul(player: PlayerState): MogulId | null {
  return canSeeNextMogul(player) ? (player.moguls.bag[0] ?? null) : null;
}

// ---------------------------------------------------------------------------------------------
// Modifiers
// ---------------------------------------------------------------------------------------------

/**
 * The Mogul whose modifier applies to this event, or null. The weekly streak never takes a modifier: it
 * belongs to the week that just closed.
 */
export function activeMogul(player: PlayerState, event: GameEvent, now: number): MogulId | null {
  const id = player.moguls.current;
  if (id === null || event.kind === 'weekly_streak') {
    return null;
  }
  return mogulDefinition(id).scope === 'week' || actWindow(now) === 'boss' ? id : null;
}

/** Lines counted toward size points: the Rocket Man counts each deletion twice. */
export function mogulSizeLines(
  mogul: MogulId | null,
  additions: number,
  deletions: number,
): { lines: number; weighted: boolean } {
  if (mogul === 'rocket-man') {
    return { lines: additions + deletions * MOGUL_RULES.rocketMan.deletionWeight, weighted: true };
  }
  return { lines: additions + deletions, weighted: false };
}

function factor(text: string, value: number, target: PointsFactor['target'] = 'all'): PointsFactor {
  return { label: `${text} x${value}`, factor: value, target };
}

function turtleneckFactors(event: GameEvent, pr: PRState): PointsFactor[] {
  const rules = MOGUL_RULES.turtleneck;
  if (event.kind === 'pr_merged') {
    const lines = eventLines(event.pr, pr);
    if (lines < rules.smallMaxLoc) {
      return [factor(`The Turtleneck: under ${rules.smallMaxLoc} lines`, rules.smallMultiplier)];
    }
    return lines > rules.largeMinLoc
      ? [factor(`The Turtleneck: over ${rules.largeMinLoc} lines`, rules.largeMultiplier)]
      : [];
  }
  if (event.kind === 'review_submitted' && event.state === 'APPROVED') {
    const inline = pr.reviewerCounters[String(event.actor.id)]?.inline ?? 0;
    if (inline === rules.designReviewInlineComments) {
      return [factor('The Turtleneck: design review', rules.designReviewMultiplier)];
    }
  }
  return [];
}

function hoodieFactor(event: PRMergedEvent, pr: PRState): PointsFactor {
  const rules = MOGUL_RULES.hoodie;
  const first = firstReviewTime(pr);
  const mergedAt = event.pr.mergedAt === null ? null : Date.parse(event.pr.mergedAt);
  const fast =
    first !== null && mergedAt !== null && (mergedAt - first) / HOUR_MS <= rules.windowHours;
  return fast
    ? factor(
        `The Hoodie: merged within ${rules.windowHours} h of first review`,
        rules.fastMultiplier,
      )
    : factor('The Hoodie: not merged fast', rules.slowMultiplier);
}

function twoPizzaFactors(event: PRMergedEvent, pr: PRState): PointsFactor[] {
  const rules = MOGUL_RULES.twoPizza;
  const facts = mergeFacts(event, pr);
  const factors: PointsFactor[] = [];
  if (facts.soloKill) {
    factors.push(factor('The Two-Pizza Boss: solo merge', rules.soloMultiplier));
  }
  if (facts.distinctReviewers >= rules.minReviewers) {
    factors.push(
      factor(`The Two-Pizza Boss: ${rules.minReviewers}+ reviewers`, rules.teamMultiplier),
    );
  }
  if (facts.party) {
    factors.push(factor('The Two-Pizza Boss: party bonus', rules.partyMultiplier, 'party'));
  }
  return factors;
}

/**
 * Multipliers a Mogul puts on one event's points terms. Pass the result of `activeMogul`. Each factor
 * becomes a suffix on the terms it touches, so the Combat Log shows it.
 */
export function mogulFactors(mogul: MogulId | null, event: GameEvent, pr: PRState): PointsFactor[] {
  switch (mogul) {
    case 'founder':
      return [factor('The Founder', MOGUL_RULES.founder.pointsMultiplier)];
    case 'turtleneck':
      return turtleneckFactors(event, pr);
    case 'hoodie':
      return event.kind === 'pr_merged' ? [hoodieFactor(event, pr)] : [];
    case 'two-pizza-boss':
      return event.kind === 'pr_merged' ? twoPizzaFactors(event, pr) : [];
    default:
      return [];
  }
}

/** Power the Rocket Man and the Leather Jacket add to this event (as Combat Log lines). */
export function mogulPowerLines(player: PlayerState, ctx: PowerContext): BreakdownLine[] {
  const mogul = activeMogul(player, ctx.event, ctx.now);
  if (mogul === 'leather-jacket' && player.moguls.chain > 0) {
    const rules = MOGUL_RULES.leatherJacket;
    const chain = player.moguls.chain;
    return [
      {
        label: `The Leather Jacket (${chain} reviewed ${chain === 1 ? 'merge' : 'merges'} in a row)`,
        value: tidy(Math.min(rules.maxPower, chain * rules.powerPerMerge)),
        kind: 'power',
      },
    ];
  }
  if (mogul === 'rocket-man' && ctx.event.kind === 'pr_merged') {
    const stats = ctx.event.pr.stats ?? ctx.pr;
    if (stats.deletions > stats.additions) {
      return [
        {
          label: 'The Rocket Man (net negative lines)',
          value: MOGUL_RULES.rocketMan.netNegativePower,
          kind: 'power',
        },
      ];
    }
  }
  return [];
}

/**
 * The Leather Jacket chain after this event, or null when it does not change: a reviewed merge extends it,
 * a solo merge resets it. Pass the result of `activeMogul`.
 */
export function mogulChainAfter(
  mogul: MogulId | null,
  event: GameEvent,
  pr: PRState,
  player: PlayerState,
): number | null {
  if (mogul !== 'leather-jacket' || event.kind !== 'pr_merged') {
    return null;
  }
  const facts = mergeFacts(event, pr);
  if (facts.soloKill) {
    return 0;
  }
  return facts.otherReviews.length > 0 ? player.moguls.chain + 1 : null;
}

/** Multiplier on gold earned this week: 4 under the Founder (points, act payouts), otherwise 1. */
export function mogulGoldMultiplier(mogul: MogulId | null): number {
  return mogul === 'founder' ? MOGUL_RULES.founder.goldMultiplier : 1;
}

// ---------------------------------------------------------------------------------------------
// The Founder's Board
// ---------------------------------------------------------------------------------------------

export interface BoardEvent {
  kind: 'removed' | 'returned';
  charm: Charm;
}

/**
 * Settle the Founder's Board for `now`. It is a pure function of the clock and the stored hook, safe to
 * call on every load of the player, and does nothing twice:
 * - A Charm the Board holds comes back with +0.25 Power once Friday 00:00 UTC has begun, or at once when
 *   the week it was taken in is over (so a missed Friday never strands a Charm).
 * - In a Founder week, from Wednesday 00:00 UTC, the Board removes one random Charm, once. The Charm keeps
 *   its slot while away, so nothing can be bought into it. If the first call comes after Friday has begun
 *   the Charm is removed and returned in the same call, with the same end result.
 * `seed` is the week's seed; the same seed picks the same Charm.
 */
export function applyFounderBoard(
  player: PlayerState,
  weekKey: string,
  now: number,
  seed: number,
): { player: PlayerState; events: BoardEvent[] } {
  const start = weekStartUtc(now);
  const events: BoardEvent[] = [];
  let current = player;

  const returnIfDue = (): void => {
    const benched = current.moguls.benched;
    if (
      benched !== null &&
      (benched.weekKey !== weekKey || now >= start + MOGUL_RULES.founder.returnDay * DAY_MS)
    ) {
      const charm: Charm = {
        ...benched.charm,
        power: tidy(benched.charm.power + MOGUL_RULES.founder.returnPower),
      };
      current = {
        ...current,
        charms: [...current.charms, charm],
        moguls: { ...current.moguls, benched: null },
      };
      events.push({ kind: 'returned', charm });
    }
  };

  returnIfDue();
  const hook = current.moguls;
  if (
    hook.current === 'founder' &&
    hook.boardWeek !== weekKey &&
    now >= start + MOGUL_RULES.founder.removalDay * DAY_MS
  ) {
    if (current.charms.length === 0) {
      current = { ...current, moguls: { ...hook, boardWeek: weekKey } };
    } else {
      const index = Math.floor(mulberry32(deriveSeed(seed, 'board'))() * current.charms.length);
      const charm = current.charms[index] as Charm;
      current = {
        ...current,
        charms: current.charms.filter((_, at) => at !== index),
        moguls: { ...hook, boardWeek: weekKey, benched: { charm, weekKey } },
      };
      events.push({ kind: 'removed', charm });
      returnIfDue();
    }
  }
  return { player: current, events };
}
