import { describe, expect, it } from 'vitest';
import {
  actClearPayout,
  applyGoldDelta,
  creditSale,
  creditScoreResult,
  goldForPoints,
  interestOn,
  payActClear,
  spendGold,
  startingWallet,
} from './economy';
import { score } from './score';
import { applyScoreResult, createPlayerState, createPRState } from './state';
import {
  AUTHOR_ID,
  facts,
  mergedEvent,
  mergedFacts,
  NOW,
  prStateFor,
  settledPlayer,
} from './test-builders';
import { productionSources, SOURCES } from './test-sources';

function withGold(gold: number, vouchers: ReturnType<typeof settledPlayer>['vouchers'] = []) {
  return { ...settledPlayer(), gold, vouchers };
}

describe('applyGoldDelta', () => {
  it('adds and subtracts whole gold and reports the ledger entry', () => {
    const earned = applyGoldDelta(withGold(10), 25, 'points');
    expect(earned).toMatchObject({ ok: true, entry: { reason: 'points', delta: 25, balance: 35 } });
    expect(earned.ok && earned.player.gold).toBe(35);
    const spent = applyGoldDelta(withGold(10), -10, 'purchase');
    expect(spent.ok && spent.player.gold).toBe(0);
  });

  it('refuses to go below zero and changes nothing', () => {
    const player = withGold(10);
    expect(applyGoldDelta(player, -11, 'purchase')).toEqual({
      ok: false,
      error: 'insufficient_gold',
    });
    expect(player.gold).toBe(10);
  });

  it('refuses fractions, NaN and infinity', () => {
    for (const delta of [0.5, Number.NaN, Infinity, -1.25]) {
      expect(applyGoldDelta(withGold(10), delta, 'points')).toEqual({
        ok: false,
        error: 'invalid_amount',
      });
    }
  });

  it('works on anything with a gold field, and returns a new object', () => {
    const wallet = { gold: 5, label: 'x' };
    const result = applyGoldDelta(wallet, 5, 'sell');
    expect(result.ok && result.player).toEqual({ gold: 10, label: 'x' });
    expect(wallet.gold).toBe(5);
  });

  it('spendGold is a debit, and a free price is a delta of +0, not -0', () => {
    const paid = spendGold(withGold(50), 20, 'reroll');
    expect(paid.ok && paid.entry).toEqual({ reason: 'reroll', delta: -20, balance: 30 });
    const free = spendGold(withGold(50), 0, 'shrine');
    expect(free.ok && Object.is(free.entry.delta, 0)).toBe(true);
    expect(spendGold(withGold(5), 6, 'purchase')).toEqual({
      ok: false,
      error: 'insufficient_gold',
    });
  });

  it('a new character starts with no gold', () => {
    expect(startingWallet()).toEqual({ gold: 0 });
    expect(createPlayerState(1).gold).toBe(0);
  });
});

describe('gold from points (Requirement 8.1): 1 per 10, floored per event', () => {
  it('floors', () => {
    expect([0, 9, 10, 19, 20, 239].map((points) => goldForPoints(points))).toEqual([
      0, 0, 1, 1, 2, 23,
    ]);
  });

  it('multiplies after flooring (the Founder pays x4)', () => {
    expect(goldForPoints(105, 4)).toBe(40);
    expect(goldForPoints(9, 4)).toBe(0);
  });

  it('credits a score result with its recorded multiplier', () => {
    const plain = creditScoreResult(withGold(0), { points: 239, goldMultiplier: 1 });
    expect(plain.player.gold).toBe(23);
    expect(plain.entry).toEqual({ reason: 'points', delta: 23, balance: 23 });
    expect(creditScoreResult(withGold(1), { points: 239, goldMultiplier: 4 }).player.gold).toBe(93);
  });

  it('applyScoreResult banks the gold of the event', () => {
    const player = settledPlayer(AUTHOR_ID);
    const pr = prStateFor(mergedFacts(), { reviews: [{ reviewerId: 2, state: 'APPROVED' }] });
    const result = score(mergedEvent(), player, pr, NOW);
    const applied = applyScoreResult(player, pr, result);
    expect(result.points).toBeGreaterThan(100);
    expect(applied.player.gold).toBe(Math.floor(result.points / 10));
  });

  it('an unscored event earns no gold', () => {
    const player = settledPlayer(AUTHOR_ID);
    const result = score(
      mergedEvent(mergedFacts({ merged: false })),
      player,
      createPRState(facts()),
      NOW,
    );
    expect(applyScoreResult(player, createPRState(facts()), result).player.gold).toBe(0);
  });
});

describe('act clears: payouts 20 / 40 / 100 and interest 1 per 25 held, capped (Requirement 8.1)', () => {
  it('pays 20, 40 and 100, times the multiplier', () => {
    expect(actClearPayout('scout')).toBe(20);
    expect(actClearPayout('raid')).toBe(40);
    expect(actClearPayout('boss')).toBe(100);
    expect(actClearPayout('boss', 4)).toBe(400);
  });

  it('interest is 1 per 25 held up to the cap', () => {
    expect([0, 24, 25, 49, 50, 249, 250, 251, 1000].map((held) => interestOn(held))).toEqual([
      0, 0, 1, 1, 2, 9, 10, 10, 10,
    ]);
    expect(interestOn(500, 20)).toBe(20);
    expect(interestOn(1000, 20)).toBe(20);
    expect(interestOn(475, 20)).toBe(19);
  });

  it('pays interest on the gold held before the payout, then the payout', () => {
    const paid = payActClear(withGold(100), 'scout');
    expect(paid.entries).toEqual([
      { reason: 'interest', delta: 4, balance: 104 },
      { reason: 'act_clear', delta: 20, balance: 124 },
    ]);
    expect(paid.player.gold).toBe(124);
  });

  it('Deep Pockets lifts the interest cap from 10 to 20', () => {
    expect(payActClear(withGold(1000), 'raid').entries[0]?.delta).toBe(10);
    expect(payActClear(withGold(1000, ['deep-pockets']), 'raid').entries[0]?.delta).toBe(20);
  });

  it('the multiplier applies to the payout but never to interest', () => {
    const paid = payActClear(withGold(500, ['deep-pockets']), 'scout', 4);
    expect(paid.entries.map((entry) => entry.delta)).toEqual([20, 80]);
  });

  it('with nothing held it pays only the act', () => {
    const paid = payActClear(withGold(0), 'boss');
    expect(paid.entries.map((entry) => entry.delta)).toEqual([0, 100]);
    expect(paid.player.gold).toBe(100);
  });
});

describe('selling a Charm', () => {
  it('credits the proceeds', () => {
    const sold = creditSale(withGold(3), { proceeds: 60 });
    expect(sold.player.gold).toBe(63);
    expect(sold.entry).toEqual({ reason: 'sell', delta: 60, balance: 63 });
  });
});

describe('only economy.ts writes gold (Requirement 8.2)', () => {
  /** Drop comments and string literals so prose and labels cannot trigger or hide a match. */
  function code(source: string): string {
    return source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
      .replace(/'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`/g, '""');
  }

  // A write is an assignment, an increment, or setting the field in an object literal or spread
  // (`{ ...player, gold: 5 }`), which is how this immutable code would change it. Reading `.gold` and the
  // `gold: number` type annotations are fine.
  const WRITE =
    /\bgold\s*(?:\+\+|--|\*\*=|\|\|=|&&=|\?\?=|[-+*/%&|^]=|=(?![=>]))|\bgold\s*:(?!\s*number\b)/;

  function violations(files: [string, string][]): string[] {
    return files
      .filter(([file]) => file !== './economy.ts')
      .filter(([, source]) => WRITE.test(code(source)))
      .map(([file]) => file);
  }

  it('finds no gold assignment or object write in any other source file', () => {
    expect(violations(productionSources())).toEqual([]);
  });

  it('scans the files it should: economy.ts is there, and the other modules are too', () => {
    const files = productionSources().map(([file]) => file);
    // Every module index.ts exports must be in the scan; if not, the file list is stale (the module cache
    // froze it) and the guard below would be checking too little.
    const exported = [...SOURCES['./index.ts']!.matchAll(/export \* from '(\.\/[\w-]+)'/g)].map(
      (match) => `${match[1]}.ts`,
    );
    expect(exported.filter((file) => !files.includes(file))).toEqual([]);
    expect(files).toContain('./economy.ts');
    expect(files).toContain('./shop.ts');
    expect(files).toContain('./run.ts');
    expect(files).not.toContain('./economy.test.ts');
  });

  it('would catch a violation (positive control)', () => {
    const bad = [
      'player.gold = 5;',
      'player.gold += price;',
      'player.gold -= 1;',
      'gold++;',
      'let gold = 0;',
      'return { ...player, gold: player.gold - 5 };',
      'const next = { gold: 12 };',
    ];
    for (const line of bad) {
      expect(violations([['./x.ts', line]]), line).toEqual(['./x.ts']);
    }
  });

  it('does not flag reads, types, comparisons, comments or strings', () => {
    const fine = [
      'if (player.gold >= price) { return player.gold; }',
      'if (player.gold === 0) {}',
      'readonly gold: number;',
      'interface Wallet { gold: number }',
      'const total = player.gold + 5;',
      'const f = (gold) => gold > 1;',
      '// gold = 5 is explained here',
      '/* gold: 5 */',
      "const label = 'gold = 5';",
      'goldMultiplier: 4,',
      'const heldPerGold = 25;',
    ];
    for (const line of fine) {
      expect(violations([['./x.ts', line]]), line).toEqual([]);
    }
  });
});
