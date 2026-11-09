import { describe, expect, it } from 'vitest';
import { SUPPLY_DROPS } from './constants';
import { score } from './score';
import { createPlayerState } from './state';
import {
  addSupplies,
  dailyFirstDrop,
  emptySatchel,
  emptySupplies,
  inlineDrop,
  mergeDrop,
  missingSupplies,
  reviewDrop,
  satchelOf,
  sizeTier,
  spendSupplies,
  sumSupplies,
} from './supplies';
import {
  facts,
  human,
  inlineEvent,
  mergedEvent,
  mergedFacts,
  NOW,
  openedEvent,
  prStateFor,
  reviewEvent,
  REVIEWER_ID,
  settledPlayer,
  verifiedKill,
} from './test-builders';
import type { PlayerState } from './types';

describe('the satchel', () => {
  it('starts empty and reads absent entries as zero', () => {
    expect(emptySatchel()).toEqual({
      ore: 0,
      timber: 0,
      lore: 0,
      ink: 0,
      provisions: 0,
      flux: 0,
      silver: 0,
      mithril: 0,
      rune: 0,
      dragon: 0,
    });
    expect(satchelOf(createPlayerState(1))).toEqual(emptySatchel());
    expect(satchelOf({ satchel: { ...emptySatchel(), ore: 3 } }).ore).toBe(3);
    expect(emptySupplies()).toEqual({ ore: 0, timber: 0, lore: 0, ink: 0, provisions: 0, flux: 0 });
  });

  it('leaves a new character without the optional field, so stored profiles are unchanged', () => {
    expect('satchel' in createPlayerState(1)).toBe(false);
  });

  it('banks without a cap and does not mutate the player', () => {
    const player = createPlayerState(1);
    const once = addSupplies(player, { ore: 3, timber: 1, silver: 2 });
    const twice = addSupplies(once, { ore: 1_000_000, dragon: 1 });
    expect(player.satchel).toBeUndefined();
    expect(once.satchel).toMatchObject({ ore: 3, timber: 1, silver: 2 });
    expect(twice.satchel).toMatchObject({ ore: 1_000_003, timber: 1, silver: 2, dragon: 1 });
  });

  it('clamps what it banks to whole numbers of at least zero', () => {
    const banked = addSupplies(createPlayerState(1), {
      ore: 2.9,
      lore: -4,
      ink: Number.NaN,
      flux: Number.POSITIVE_INFINITY,
    });
    expect(banked.satchel).toEqual({ ...emptySatchel(), ore: 2 });
  });
});

describe('spendSupplies', () => {
  const stocked: PlayerState = addSupplies(createPlayerState(1), {
    ore: 5,
    provisions: 3,
    mithril: 1,
  });

  it('subtracts the cost and reports what was spent', () => {
    const spent = spendSupplies(stocked, { ore: 2, provisions: 3, silver: 0 });
    expect(spent.ok).toBe(true);
    if (spent.ok) {
      expect(spent.spent).toEqual({ ore: 2, provisions: 3 });
      expect(spent.player.satchel).toMatchObject({ ore: 3, provisions: 0, mithril: 1 });
    }
    expect(stocked.satchel?.ore).toBe(5);
  });

  it('fails with insufficient_supplies and changes nothing', () => {
    expect(spendSupplies(stocked, { ore: 6 })).toEqual({
      ok: false,
      error: 'insufficient_supplies',
    });
    expect(spendSupplies(createPlayerState(1), { flux: 1 })).toEqual({
      ok: false,
      error: 'insufficient_supplies',
    });
  });

  it('rejects negative and fractional amounts', () => {
    expect(spendSupplies(stocked, { ore: -1 })).toEqual({ ok: false, error: 'invalid_amount' });
    expect(spendSupplies(stocked, { ore: 0.5 })).toEqual({ ok: false, error: 'invalid_amount' });
    expect(spendSupplies(stocked, { ore: Number.NaN })).toEqual({
      ok: false,
      error: 'invalid_amount',
    });
  });

  it('spending nothing succeeds', () => {
    const spent = spendSupplies(createPlayerState(1), {});
    expect(spent.ok).toBe(true);
  });

  it('missingSupplies names the shortfall', () => {
    expect(missingSupplies(stocked, { ore: 7, provisions: 3, lore: 2 })).toEqual({
      ore: 2,
      lore: 2,
    });
    expect(missingSupplies(stocked, { ore: 5 })).toEqual({});
  });
});

describe('the drop table (game-design.md 6.1)', () => {
  it('Ore is 1 plus the size tier, steps at 50, 300 and 1,000 lines', () => {
    expect([0, 49, 50, 299, 300, 999, 1000].map(sizeTier)).toEqual([0, 0, 1, 1, 2, 2, 3]);
    expect(
      [10, 50, 300, 1000].map((lines) => mergeDrop({ lines, party: false, riposte: false }).ore),
    ).toEqual([1, 2, 3, 4]);
  });

  it('a merge drops Timber, and Provisions and Flux only for the party bonus and the Riposte', () => {
    expect(mergeDrop({ lines: 10, party: false, riposte: false })).toEqual({ ore: 1, timber: 1 });
    expect(mergeDrop({ lines: 10, party: true, riposte: false })).toEqual({
      ore: 1,
      timber: 1,
      provisions: 2,
    });
    expect(mergeDrop({ lines: 10, party: true, riposte: true })).toEqual({
      ore: 1,
      timber: 1,
      provisions: 2,
      flux: 1,
    });
  });

  it('a review drops Lore: 2 for a decision, 1 for a comment', () => {
    expect(reviewDrop(true)).toEqual({ lore: 2 });
    expect(reviewDrop(false)).toEqual({ lore: 1 });
  });

  it('an inline comment drops Ink for the first 5 per PR and nothing after', () => {
    expect([0, 1, 4].map((before) => inlineDrop(before))).toEqual([
      { ink: 1 },
      { ink: 1 },
      { ink: 1 },
    ]);
    expect(inlineDrop(SUPPLY_DROPS.inkCapPerPr)).toEqual({});
    expect(inlineDrop(9)).toEqual({});
  });

  it('the first event of the day drops one Provision', () => {
    expect(dailyFirstDrop()).toEqual({ provisions: 1 });
  });

  it('sumSupplies adds drops into all six supplies', () => {
    expect(sumSupplies({ ore: 2 }, { ore: 1, flux: 1 }, {})).toEqual({
      ore: 3,
      timber: 0,
      lore: 0,
      ink: 0,
      provisions: 0,
      flux: 1,
    });
    expect(sumSupplies()).toEqual(emptySupplies());
  });
});

describe('score() emits exactly the module drops (Requirement 4.11)', () => {
  const author = settledPlayer();
  const reviewer = settledPlayer(REVIEWER_ID);

  it('a solo merge: Ore and Timber', () => {
    const pr = mergedFacts();
    const result = score(mergedEvent(pr), author, prStateFor(pr), NOW);
    expect(result.supplies).toEqual({ ...emptySupplies(), ore: 2, timber: 1 });
  });

  it('a party merge with a Riposte: Provisions and Flux too', () => {
    const pr = mergedFacts({
      stats: { additions: 900, deletions: 200, changedFiles: 9, commits: 3 },
    });
    const state = prStateFor(pr, {
      reviews: [
        { reviewerId: REVIEWER_ID, state: 'CHANGES_REQUESTED' },
        { reviewerId: REVIEWER_ID, state: 'APPROVED' },
      ],
    });
    expect(score(mergedEvent(pr), author, state, NOW).supplies).toEqual({
      ore: 4,
      timber: 1,
      lore: 0,
      ink: 0,
      provisions: 2,
      flux: 1,
    });
  });

  it('reviews drop Lore and inline comments drop Ink up to the cap', () => {
    const pr = facts();
    expect(score(reviewEvent('APPROVED'), reviewer, prStateFor(pr), NOW).supplies.lore).toBe(2);
    expect(score(reviewEvent('COMMENTED'), reviewer, prStateFor(pr), NOW).supplies.lore).toBe(1);
    const inline = (count: number) =>
      score(
        inlineEvent(human(REVIEWER_ID), pr),
        reviewer,
        prStateFor(pr, {
          reviewerCounters: { [String(REVIEWER_ID)]: { decisions: 0, comments: 0, inline: count } },
        }),
        NOW,
      ).supplies.ink;
    expect([0, 4, 5, 9].map(inline)).toEqual([1, 1, 0, 0]);
  });

  it('opening a PR and a verified kill drop nothing; a skipped event drops nothing', () => {
    const pr = facts();
    expect(score(openedEvent(pr), author, prStateFor(pr), NOW).supplies).toEqual(emptySupplies());
    const merged = mergedFacts();
    expect(
      score(verifiedKill(human(REVIEWER_ID), merged), reviewer, prStateFor(merged), NOW).supplies,
    ).toEqual(emptySupplies());
    expect(score(reviewEvent('APPROVED', human(1)), author, prStateFor(pr), NOW).supplies).toEqual(
      emptySupplies(),
    );
  });

  it('the first event of the day adds a Provision to whatever the event drops', () => {
    const fresh = createPlayerState(REVIEWER_ID);
    const result = score(reviewEvent('APPROVED'), fresh, prStateFor(facts()), NOW);
    expect(result.supplies).toEqual({ ...emptySupplies(), lore: 2, provisions: 1 });
  });
});
