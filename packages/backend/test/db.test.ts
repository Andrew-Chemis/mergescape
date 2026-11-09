import { emptySkillXp } from '@mergescape/shared';
import type { PullRequestFacts, RunState } from '@mergescape/shared';
import { describe, expect, it } from 'vitest';
import {
  DELIVERY_TTL_SECONDS,
  EVENT_TTL_SECONDS,
  OAUTH_STATE_TTL_SECONDS,
  VersionConflictError,
} from '../src/db';
import type { EventRow } from '../src/db';
import { deliveryKey, prMetaKey, profileKey } from '../src/keys';
import { ALLOWED_ATTRIBUTES, assertItemAllowed, SchemaViolationError } from '../src/schema';
import { auditSchema, makeDb } from './support';

const NOW = Date.UTC(2026, 10, 9, 12, 0, 0);
const NOW_S = NOW / 1000;
const USER = 1001001;

function pr(overrides: Partial<PullRequestFacts> = {}): PullRequestFacts {
  return {
    installationId: 777001,
    repoId: 424242,
    repoPrivate: false,
    number: 17,
    author: { id: USER, isBot: false },
    draft: false,
    baseRefIsDefault: true,
    stats: { additions: 250, deletions: 50, changedFiles: 4, commits: 2 },
    openedAt: '2026-11-09T09:00:00Z',
    mergedAt: null,
    closedAt: null,
    merged: false,
    mergedBy: null,
    ...overrides,
  };
}

function eventRow(overrides: Partial<EventRow> = {}): EventRow {
  return {
    userId: USER,
    ts: '2026-11-09T12:00:00.000Z',
    deliveryId: 'delivery-1',
    kind: 'pr_merged',
    repoId: 424242,
    repoPrivate: false,
    prNumber: 17,
    points: 100,
    power: 1,
    zone: 3.03,
    level: 1,
    xp: 303,
    skill: 'smithing',
    skillXp: { ...emptySkillXp(), smithing: 303 },
    supplies: { ore: 2, timber: 1, lore: 0, ink: 0, provisions: 1, flux: 0 },
    monster: 'merge-goblin',
    breakdown: [{ label: 'PR merged', value: 90, kind: 'points' }],
    ...overrides,
  };
}

describe('profile', () => {
  it('creates a level 1 profile on first sign-in and keeps game state on later ones', async () => {
    const { fake, db } = makeDb();
    expect(await db.getProfile(USER)).toBeNull();

    const created = await db.upsertProfileOnLogin({
      id: USER,
      login: 'Octo-Cat',
      installations: [777001, 5],
      nowMs: NOW,
    });
    expect(created).toMatchObject({
      id: USER,
      login: 'Octo-Cat',
      created: new Date(NOW).toISOString(),
      installations: [5, 777001],
      xp: 0,
      level: 1,
      gold: 0,
      streakWeeks: 0,
      version: 0,
      opensDay: null,
      dailyFirstDay: null,
    });
    expect(created.skillXp).toEqual(emptySkillXp());
    expect(fake.peek('USER#1001001', 'PROFILE')).toMatchObject({
      GSI1PK: 'LOGIN#octo-cat',
      GSI1SK: 'USER#1001001',
    });

    await db.applyScore(USER, 0, {
      xp: 500,
      skillXp: { ...emptySkillXp(), smithing: 500 },
      gold: 7,
      level: 2,
      counters: {},
    });
    const again = await db.upsertProfileOnLogin({
      id: USER,
      login: 'octo-cat2',
      installations: [],
      nowMs: NOW + 1000,
    });
    expect(again).toMatchObject({
      login: 'octo-cat2',
      created: new Date(NOW).toISOString(),
      xp: 500,
      level: 2,
      gold: 7,
      version: 1,
      installations: [],
    });
    expect(fake.peek('USER#1001001', 'PROFILE')).not.toHaveProperty('installations');
    auditSchema(fake);
  });

  it('rejects a login that is not a GitHub login', async () => {
    const { fake, db } = makeDb();
    await expect(
      db.upsertProfileOnLogin({ id: USER, login: 'a b', installations: [], nowMs: NOW }),
    ).rejects.toThrow(RangeError);
    expect(fake.size).toBe(0);
  });

  it('adds an installation to an existing profile only', async () => {
    const { fake, db } = makeDb();
    expect(await db.addProfileInstallation(USER, 9)).toBe(false);
    expect(fake.size).toBe(0);
    await db.upsertProfileOnLogin({ id: USER, login: 'octo', installations: [1], nowMs: NOW });
    expect(await db.addProfileInstallation(USER, 9)).toBe(true);
    expect(await db.addProfileInstallation(USER, 9)).toBe(true);
    expect((await db.getProfile(USER))?.installations).toEqual([1, 9]);
  });

  it('applies a score atomically: ADDs XP, skill XP and gold, SETs level and counters, bumps version', async () => {
    const { fake, db } = makeDb();
    await db.upsertProfileOnLogin({ id: USER, login: 'octo', installations: [], nowMs: NOW });
    await db.applyScore(USER, 0, {
      xp: 242,
      skillXp: { smithing: 200, vigilance: 0, oratory: 0, endurance: 42 },
      gold: 8,
      level: 1,
      counters: {
        opens: { day: '2026-11-09', count: 1 },
        dailyFirstDay: '2026-11-09',
        streakWeeks: 2,
      },
    });
    await db.applyScore(USER, 1, {
      xp: 300,
      skillXp: { smithing: 0, vigilance: 300, oratory: 0, endurance: 0 },
      gold: 3,
      level: 2,
      counters: {},
    });
    expect(await db.getProfile(USER, true)).toMatchObject({
      xp: 542,
      level: 2,
      gold: 11,
      skillXp: { smithing: 200, vigilance: 300, oratory: 0, endurance: 42 },
      opensDay: '2026-11-09',
      opensCount: 1,
      dailyFirstDay: '2026-11-09',
      streakWeeks: 2,
      version: 2,
    });
    auditSchema(fake);
  });

  it('refuses a stale write and leaves the profile untouched', async () => {
    const { db } = makeDb();
    await db.upsertProfileOnLogin({ id: USER, login: 'octo', installations: [], nowMs: NOW });
    const write = { xp: 10, skillXp: emptySkillXp(), gold: 1, level: 1, counters: {} };
    await db.applyScore(USER, 0, write);
    await expect(db.applyScore(USER, 0, write)).rejects.toThrow(VersionConflictError);
    expect((await db.getProfile(USER, true))?.xp).toBe(10);
  });

  it('does not create a profile for a score write to an unknown player', async () => {
    const { fake, db } = makeDb();
    await expect(
      db.applyScore(USER, 0, { xp: 1, skillXp: emptySkillXp(), gold: 0, level: 1, counters: {} }),
    ).rejects.toThrow(VersionConflictError);
    expect(fake.size).toBe(0);
  });
});

describe('Combat Log events', () => {
  it('writes only allow-listed attributes, with a 90 day ttl, and rewrites idempotently', async () => {
    const { fake, db } = makeDb();
    await db.putEvent(eventRow());
    await db.putEvent(eventRow());
    expect(fake.size).toBe(1);
    const stored = fake.snapshot()[0];
    expect(stored).toMatchObject({
      PK: 'USER#1001001',
      SK: 'EVT#2026-11-09T12:00:00.000Z#delivery-1',
      kind: 'pr_merged',
      repo_id: 424242,
      pr_number: 17,
      monster: 'merge-goblin',
      ttl: NOW_S + EVENT_TTL_SECONDS,
    });
    auditSchema(fake);
  });

  it('lists newest first and pages with a cursor', async () => {
    const { db } = makeDb();
    for (let minute = 0; minute < 5; minute += 1) {
      await db.putEvent(
        eventRow({ ts: `2026-11-09T12:0${minute}:00.000Z`, deliveryId: `d-${minute}`, xp: minute }),
      );
    }
    await db.putEvent(eventRow({ userId: 42, deliveryId: 'someone-else' }));

    const first = await db.listEvents(USER, { limit: 2 });
    expect(first.rows.map((row) => row.deliveryId)).toEqual(['d-4', 'd-3']);
    expect(first.nextSk).toBe('EVT#2026-11-09T12:03:00.000Z#d-3');
    const second = await db.listEvents(USER, { limit: 2, beforeSk: first.nextSk ?? '' });
    expect(second.rows.map((row) => row.deliveryId)).toEqual(['d-2', 'd-1']);
    const third = await db.listEvents(USER, { limit: 2, beforeSk: second.nextSk ?? '' });
    expect(third.rows.map((row) => row.deliveryId)).toEqual(['d-0']);
    expect(third.nextSk).toBeNull();
    expect(first.rows[0]).toMatchObject({
      userId: USER,
      kind: 'pr_merged',
      monster: 'merge-goblin',
    });
  });

  it('round-trips the optional log-row fields and the supplies drop', async () => {
    const { fake, db } = makeDb();
    await db.putEvent(
      eventRow({
        kind: 'review_submitted',
        reviewState: 'APPROVED',
        additions: 3,
        deletions: 4,
        inlineComments: 6,
      }),
    );
    const { rows } = await db.listEvents(USER, { limit: 5 });
    expect(rows[0]).toMatchObject({
      id: '2026-11-09T12:00:00.000Z#delivery-1',
      reviewState: 'APPROVED',
      additions: 3,
      deletions: 4,
      inlineComments: 6,
      supplies: { ore: 2, timber: 1, lore: 0, ink: 0, provisions: 1, flux: 0 },
    });
    auditSchema(fake);
  });

  it('omits a null monster', async () => {
    const { fake, db } = makeDb();
    await db.putEvent(eventRow({ monster: null }));
    expect(fake.snapshot()[0]).not.toHaveProperty('monster');
    expect((await db.listEvents(USER, { limit: 5 })).rows[0]?.monster).toBeNull();
  });
});

describe('PR facts and reviews', () => {
  it('stores exactly the Requirement 3.1 facts', async () => {
    const { fake, db } = makeDb();
    expect(await db.upsertPR(pr())).toBe('written');
    const { meta } = await db.getPR(424242, 17);
    expect(meta).toEqual({
      installationId: 777001,
      repoId: 424242,
      repoPrivate: false,
      number: 17,
      authorId: USER,
      openedAt: '2026-11-09T09:00:00Z',
      mergedAt: null,
      closedAt: null,
      merged: false,
      mergedById: null,
      additions: 250,
      deletions: 50,
      changedFiles: 4,
      commits: 2,
      reviewRoundCount: 0,
      syncCount: 0,
      draft: false,
      baseRefIsDefault: true,
    });
    auditSchema(fake);
  });

  it('keeps stored sizes when a review payload carries none, and ignores malformed timestamps', async () => {
    const { db } = makeDb();
    await db.upsertPR(pr());
    await db.upsertPR(pr({ stats: null, openedAt: 'not a date; DROP' }));
    const { meta } = await db.getPR(424242, 17);
    expect(meta).toMatchObject({ additions: 250, deletions: 50, openedAt: '2026-11-09T09:00:00Z' });
  });

  it('adds sync and review-round deltas atomically', async () => {
    const { db } = makeDb();
    await db.upsertPR(pr(), { syncCount: 1 });
    await db.upsertPR(pr(), { syncCount: 1, reviewRoundCount: 1 });
    expect((await db.getPR(424242, 17)).meta).toMatchObject({ syncCount: 2, reviewRoundCount: 1 });
  });

  it('does not regress merged, but still counts', async () => {
    const { db } = makeDb();
    const merged = pr({
      merged: true,
      mergedBy: { id: 3003003, isBot: false },
      mergedAt: '2026-11-09T11:00:00Z',
      closedAt: '2026-11-09T11:00:00Z',
    });
    expect(await db.upsertPR(merged)).toBe('written');
    // An older "open" event arrives late.
    expect(await db.upsertPR(pr({ draft: true }), { syncCount: 1 })).toBe('kept');
    const { meta } = await db.getPR(424242, 17);
    expect(meta).toMatchObject({ merged: true, mergedById: 3003003, draft: false, syncCount: 1 });
    // A replay of the merge itself is a plain overwrite.
    expect(await db.upsertPR(merged)).toBe('written');
  });

  it('upgrades a not-yet-merged record to merged', async () => {
    const { db } = makeDb();
    await db.upsertPR(pr());
    await db.upsertPR(pr({ merged: true, mergedBy: { id: USER, isBot: false } }));
    expect((await db.getPR(424242, 17)).meta).toMatchObject({ merged: true, mergedById: USER });
  });

  it('records reviews and inline comments under the PR partition, idempotently', async () => {
    const { fake, db } = makeDb();
    await db.upsertPR(pr());
    const review = {
      reviewerId: 2002002,
      reviewerIsBot: false,
      state: 'APPROVED' as const,
      submittedAt: '2026-11-09T10:00:00Z',
      deliveryId: 'd-review',
    };
    await db.putReview(424242, 17, review);
    await db.putReview(424242, 17, review);
    await db.putReview(424242, 17, {
      ...review,
      reviewerId: 7,
      state: 'COMMENTED',
      submittedAt: '2026-11-09T09:30:00Z',
      deliveryId: 'd-review-2',
    });
    await db.putInline(424242, 17, {
      reviewerId: 2002002,
      reviewerIsBot: false,
      deliveryId: 'd-c1',
    });
    await db.putInline(424242, 17, {
      reviewerId: 2002002,
      reviewerIsBot: false,
      deliveryId: 'd-c2',
    });

    const bundle = await db.getPR(424242, 17);
    expect(bundle.reviews.map((r) => [r.reviewerId, r.state])).toEqual([
      [7, 'COMMENTED'],
      [2002002, 'APPROVED'],
    ]);
    expect(bundle.inline).toEqual([
      { reviewerId: 2002002, count: 1 },
      { reviewerId: 2002002, count: 1 },
    ]);
    expect(fake.snapshot().find((item) => String(item.SK).startsWith('REVIEW#'))).toMatchObject({
      pr_key: 'PR#424242#17',
      reviewer_is_bot: false,
    });
    auditSchema(fake);
  });

  it('returns an empty bundle for an unknown PR', async () => {
    const { db } = makeDb();
    expect(await db.getPR(1, 1)).toEqual({ meta: null, reviews: [], inline: [] });
  });
});

describe('installations', () => {
  it('upserts, edits repositories, suspends and tombstones', async () => {
    const { fake, db } = makeDb();
    expect(await db.getInstallation(777001, NOW)).toBeNull();

    await db.upsertInstallation({
      id: 777001,
      accountId: 5005005,
      repoIds: [3, 1, 2],
      suspended: false,
    });
    expect(await db.getInstallation(777001, NOW)).toEqual({
      id: 777001,
      accountId: 5005005,
      repoIds: [1, 2, 3],
      suspended: false,
      deleted: false,
    });

    await db.changeInstallationRepos({
      id: 777001,
      accountId: 5005005,
      added: [4, 5],
      removed: [1],
    });
    expect((await db.getInstallation(777001, NOW))?.repoIds).toEqual([2, 3, 4, 5]);
    await db.changeInstallationRepos({ id: 777001, accountId: 5005005, added: [], removed: [] });
    await db.changeInstallationRepos({
      id: 777001,
      accountId: 5005005,
      added: [],
      removed: [2, 3, 4, 5],
    });
    expect((await db.getInstallation(777001, NOW))?.repoIds).toEqual([]);

    await db.setInstallationSuspended({ id: 777001, accountId: 5005005, suspended: true });
    expect((await db.getInstallation(777001, NOW))?.suspended).toBe(true);

    await db.removeInstallation(777001, NOW);
    expect(await db.getInstallation(777001, NOW)).toMatchObject({
      deleted: true,
      suspended: true,
      repoIds: [],
    });
    expect(fake.size).toBe(1);
    auditSchema(fake);

    // Reinstalling clears the tombstone.
    await db.upsertInstallation({ id: 777001, accountId: 5005005, repoIds: [], suspended: false });
    expect(await db.getInstallation(777001, NOW)).toMatchObject({
      suspended: false,
      deleted: false,
      repoIds: [],
    });
  });

  it('is physically removed by the TTL sweep after deletion, using only Put/Get/Update/Query', async () => {
    const { fake, db } = makeDb({
      allowedOperations: ['PutItem', 'GetItem', 'UpdateItem', 'Query'],
    });
    await db.upsertInstallation({ id: 9, accountId: 1, repoIds: [1], suspended: false });
    await db.removeInstallation(9, NOW);
    expect(fake.expireTtl(NOW_S + 1)).toBe(1);
    expect(fake.size).toBe(0);
  });
});

describe('delivery dedupe', () => {
  it('claims once; the second put fails with ConditionalCheckFailed; ttl is 7 days', async () => {
    const { fake, db } = makeDb();
    expect(await db.claimDelivery('delivery-1', NOW)).toBe(true);
    expect(await db.claimDelivery('delivery-1', NOW + 5000)).toBe(false);
    expect(fake.peek('DELIVERY#delivery-1', 'META')).toEqual({
      PK: 'DELIVERY#delivery-1',
      SK: 'META',
      ttl: NOW_S + DELIVERY_TTL_SECONDS,
    });
    // The raw conditional put, as the spec words it, really is rejected by the table.
    await expect(
      db.put(
        'DELIVERY',
        deliveryKey('delivery-1'),
        { ttl: 1 },
        {
          expression: 'attribute_not_exists(#c0)',
          names: { '#c0': 'PK' },
        },
      ),
    ).rejects.toMatchObject({ name: 'ConditionalCheckFailedException' });
    auditSchema(fake);
  });

  it('lets a released delivery be claimed again, once', async () => {
    const { db } = makeDb();
    await db.claimDelivery('delivery-1', NOW);
    await db.releaseDelivery('delivery-1');
    expect(await db.claimDelivery('delivery-1', NOW + 1000)).toBe(true);
    expect(await db.claimDelivery('delivery-1', NOW + 2000)).toBe(false);
  });

  it('refuses a delivery id that is not a plain token', async () => {
    const { fake, db } = makeDb();
    await expect(db.claimDelivery('x#y', NOW)).rejects.toThrow(RangeError);
    expect(fake.writeCalls).toBe(0);
  });

  it('claims again after the TTL sweep removed the old record', async () => {
    const { fake, db } = makeDb();
    await db.claimDelivery('delivery-1', NOW);
    fake.expireTtl(NOW_S + DELIVERY_TTL_SECONDS);
    expect(await db.claimDelivery('delivery-1', NOW + DELIVERY_TTL_SECONDS * 1000)).toBe(true);
  });
});

describe('OAuth state', () => {
  it('is single use', async () => {
    const { fake, db } = makeDb();
    await db.putOAuthState('nonce-1', NOW);
    expect(fake.peek('STATE#nonce-1', 'META')?.ttl).toBe(NOW_S + OAUTH_STATE_TTL_SECONDS);
    expect(await db.consumeOAuthState('nonce-1', NOW + 1000)).toBe(true);
    expect(await db.consumeOAuthState('nonce-1', NOW + 2000)).toBe(false);
    expect(fake.size).toBe(0);
  });

  it('expires after ten minutes even before the TTL sweep, and an unknown nonce fails', async () => {
    const { fake, db } = makeDb();
    await db.putOAuthState('nonce-1', NOW);
    expect(await db.consumeOAuthState('nonce-1', NOW + OAUTH_STATE_TTL_SECONDS * 1000)).toBe(false);
    expect(fake.size).toBe(1);
    expect(await db.consumeOAuthState('nope', NOW)).toBe(false);
  });

  it('does not let a nonce be overwritten', async () => {
    const { db } = makeDb();
    await db.putOAuthState('nonce-1', NOW);
    await expect(db.putOAuthState('nonce-1', NOW)).rejects.toMatchObject({
      name: 'ConditionalCheckFailedException',
    });
  });
});

describe('weekly run', () => {
  function run(overrides: Partial<RunState> = {}): RunState {
    return {
      weekKey: '2026-46',
      act: 'scout',
      clearedActs: [],
      weeklyXp: 0,
      targets: { scout: 1200, raid: 2000, boss: 3000 },
      mogul: 'rocket-man',
      hand: [{ id: 'strike', name: 'Strike', upgraded: false }],
      played: [],
      shopSeed: 123456,
      shop: null,
      ...overrides,
    };
  }

  it('creates once, reads back, adds weekly XP atomically and sets or removes fields', async () => {
    const { fake, db } = makeDb();
    expect(await db.getWeek(USER, '2026-46')).toBeNull();
    expect(await db.createWeek(USER, run())).toBe(true);
    expect(await db.createWeek(USER, run({ weeklyXp: 99 }))).toBe(false);
    expect(await db.getWeek(USER, '2026-46')).toEqual(run());

    expect(await db.updateWeek(USER, '2026-46', { addWeeklyXp: 500 })).toBe(true);
    expect(await db.updateWeek(USER, '2026-46', { addWeeklyXp: 250 })).toBe(true);
    expect(
      await db.updateWeek(USER, '2026-46', {
        set: { act: 'raid', clearedActs: ['scout'], shopSeed: 7 },
      }),
    ).toBe(true);
    expect(await db.getWeek(USER, '2026-46')).toMatchObject({
      weeklyXp: 750,
      act: 'raid',
      clearedActs: ['scout'],
      shopSeed: 7,
    });

    expect(await db.updateWeek(USER, '2026-46', { set: { act: null } })).toBe(true);
    expect((await db.getWeek(USER, '2026-46'))?.act).toBeNull();
    expect(fake.snapshot()[0]).not.toHaveProperty('act');
    auditSchema(fake);
  });

  it('does not create a week by updating it', async () => {
    const { fake, db } = makeDb();
    expect(await db.updateWeek(USER, '2026-46', { addWeeklyXp: 5 })).toBe(false);
    expect(fake.size).toBe(0);
  });

  it('stores the shop stock verbatim', async () => {
    const { db } = makeDb();
    const shop: RunState['shop'] = {
      charms: [
        {
          item: { id: 'duck', name: 'Rubber Duck', rarity: 'common', power: 0.25 },
          price: 40,
          sold: false,
        },
      ],
      packs: [{ item: 'charm', price: 100, sold: true }],
      voucher: null,
      rerolls: 1,
    };
    await db.createWeek(USER, run({ shop }));
    expect((await db.getWeek(USER, '2026-46'))?.shop).toEqual(shop);
  });
});

describe('schema guard', () => {
  it('fails on an extra attribute on a PR# item, before anything is sent', async () => {
    const { fake, db } = makeDb();
    await expect(
      db.put('PR', prMetaKey(424242, 17), { repo_id: 424242, title: 'Fix the login bug' }),
    ).rejects.toThrow(SchemaViolationError);
    await expect(
      db.update('PR', prMetaKey(424242, 17), { set: { merged: true, body: 'secret' } }),
    ).rejects.toThrow(/body/);
    await expect(
      db.update('PR', prMetaKey(424242, 17), { add: { sync_count: 1 }, remove: ['file_paths'] }),
    ).rejects.toThrow(SchemaViolationError);
    expect(fake.calls).toHaveLength(0);
    expect(fake.size).toBe(0);
  });

  it('fails on an extra attribute on an EVT# item and on every other item type', async () => {
    const { fake, db } = makeDb();
    const key = profileKey(USER);
    for (const kind of Object.keys(ALLOWED_ATTRIBUTES) as (keyof typeof ALLOWED_ATTRIBUTES)[]) {
      await expect(db.put(kind, key, { comment_text: 'hello' })).rejects.toThrow(
        SchemaViolationError,
      );
      await expect(db.update(kind, key, { set: { pr_title: 'x' } })).rejects.toThrow(
        SchemaViolationError,
      );
      await expect(db.update(kind, key, { deleteFrom: { diff: new Set([1]) } })).rejects.toThrow(
        SchemaViolationError,
      );
    }
    expect(fake.calls).toHaveLength(0);
  });

  it('rejects undefined and non-finite values with a clear error', async () => {
    const { fake, db } = makeDb();
    await expect(db.put('STATE', profileKey(1), { ttl: undefined })).rejects.toThrow(TypeError);
    await expect(db.put('STATE', profileKey(1), { ttl: Number.NaN })).rejects.toThrow(TypeError);
    expect(fake.calls).toHaveLength(0);
  });

  it('allows exactly the attributes of Requirements 3.1 and 3.2 on PR and review items', () => {
    expect([...ALLOWED_ATTRIBUTES.PR].sort()).toEqual(
      [
        'installation_id',
        'repo_id',
        'repo_private',
        'pr_number',
        'author_id',
        'opened_at',
        'merged_at',
        'closed_at',
        'merged',
        'merged_by_id',
        'additions',
        'deletions',
        'changed_files',
        'commits',
        'review_round_count',
        'sync_count',
        'draft',
        'base_ref_is_default',
      ].sort(),
    );
    expect([...ALLOWED_ATTRIBUTES.REVIEW].sort()).toEqual(
      [
        'pr_key',
        'reviewer_id',
        'reviewer_is_bot',
        'state',
        'submitted_at',
        'inline_comment_count',
      ].sort(),
    );
    for (const forbidden of [
      'title',
      'body',
      'comment',
      'path',
      'diff',
      'repo_name',
      'login',
      'name',
    ]) {
      expect(ALLOWED_ATTRIBUTES.PR).not.toContain(forbidden);
      expect(ALLOWED_ATTRIBUTES.EVENT).not.toContain(forbidden);
      expect(ALLOWED_ATTRIBUTES.REVIEW).not.toContain(forbidden);
    }
  });

  it('assertItemAllowed accepts key attributes and rejects unknown ones', () => {
    expect(() => assertItemAllowed('STATE', { PK: 'STATE#x', SK: 'META', ttl: 1 })).not.toThrow();
    expect(() => assertItemAllowed('STATE', { PK: 'STATE#x', SK: 'META', token: 'x' })).toThrow(
      SchemaViolationError,
    );
  });
});
