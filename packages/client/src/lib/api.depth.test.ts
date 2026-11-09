import { describe, expect, it, vi } from 'vitest';
import { ApiError, createHttpApi } from './api';
import type { Api } from './api';
import { fixtureFeats } from './fixtures/depth';
import { fixtureMe } from './fixtures/state';
import { expeditionViewFrom, forgeViewFrom } from './depth';

const TOKEN = 'aaa.bbb.ccc';
const NOW = Date.UTC(2026, 10, 11, 14, 5, 0);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function make(fetchFn: unknown, extra: Partial<Parameters<typeof createHttpApi>[0]> = {}): Api {
  return createHttpApi({
    origin: 'https://api.example',
    getToken: () => TOKEN,
    fetchFn: fetchFn as typeof fetch,
    sleep: async () => {},
    newId: () => 'req-1',
    ...extra,
  });
}

const bodyOf = (call: unknown): Record<string, unknown> =>
  JSON.parse(((call as [string, RequestInit])[1].body as string | undefined) ?? '{}') as Record<
    string,
    unknown
  >;

const me = fixtureMe(NOW);
const trip = me.expedition!;

describe('the depth reads (docs/api-contract.md)', () => {
  it('GET /expedition returns the view', async () => {
    const view = expeditionViewFrom(me, NOW);
    const fetchFn = vi.fn(async () => jsonResponse(view));
    const result = await make(fetchFn).expedition();
    expect(result.status).toBe('returned');
    expect(result.regions).toHaveLength(8);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.example/expedition');
    expect(init.method).toBe('GET');
    expect((init.headers as Record<string, string>)['Authorization']).toBe(`Bearer ${TOKEN}`);
  });

  it('fills the two fields a first-time player has none of (no trip yet, no return time)', async () => {
    const view: Record<string, unknown> = { ...expeditionViewFrom(me, NOW) };
    Reflect.deleteProperty(view, 'expedition');
    Reflect.deleteProperty(view, 'returnsAt');
    const result = await make(async () => jsonResponse(view)).expedition();
    expect(result.expedition).toBeNull();
    expect(result.returnsAt).toBeNull();
  });

  it('GET /forge returns the view', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(forgeViewFrom(me, NOW)));
    const result = await make(fetchFn).forge();
    expect(result.stations.loom.status).toBe('ready');
    expect(result.recipes.length).toBeGreaterThan(20);
    expect((fetchFn.mock.calls[0] as unknown as [string])[0]).toBe('https://api.example/forge');
  });

  it('GET /feats returns the list, and GET /packs/:seed the three Charms', async () => {
    const feats = fixtureFeats(NOW, 'active');
    const fetchFn = vi.fn(async (url: string) =>
      jsonResponse(url.endsWith('/feats') ? { feats } : { options: [{ id: 'lantern' }] }),
    );
    const api = make(fetchFn);
    expect((await api.feats()).feats).toHaveLength(6);
    expect((await api.packOptions(4101)).options).toEqual([{ id: 'lantern' }]);
    expect((fetchFn.mock.calls[1] as unknown as [string])[0]).toBe(
      'https://api.example/packs/4101',
    );
  });

  it('rejects a read whose body is not the shape it promised', async () => {
    const wrong = make(async () => jsonResponse({ hello: 'world' }));
    await expect(wrong.expedition()).rejects.toMatchObject({ status: 0 });
    await expect(wrong.forge()).rejects.toMatchObject({ status: 0 });
    await expect(wrong.feats()).rejects.toMatchObject({ status: 0 });
    await expect(wrong.packOptions(1)).rejects.toMatchObject({ status: 0 });
  });
});

describe('the depth writes POST { requestId, ...fields } with the bearer token', () => {
  const answer = { me };
  const collected = {
    me,
    expedition: { ...trip, collected: true },
    loot: [],
    applied: true,
    featsUnlocked: [],
  };

  const calls: [
    string,
    (api: Api) => Promise<unknown>,
    string,
    Record<string, unknown>,
    unknown,
  ][] = [
    [
      'expeditionSend',
      (api) => api.expeditionSend({ region: 'koko-woods', choice: 'forage' }),
      '/expedition/send',
      { region: 'koko-woods', choice: 'forage' },
      { me, expedition: trip },
    ],
    [
      'expeditionSend (hours)',
      (api) => api.expeditionSend({ region: 'orrl-falls', choice: 12 }),
      '/expedition/send',
      { region: 'orrl-falls', choice: 12 },
      { me, expedition: trip },
    ],
    ['expeditionCollect', (api) => api.expeditionCollect(), '/expedition/collect', {}, collected],
    [
      'packOpen',
      (api) => api.packOpen({ seed: 4101, charmId: 'lantern' }),
      '/packs/open',
      { seed: 4101, charmId: 'lantern' },
      answer,
    ],
    [
      'forgeStart',
      (api) => api.forgeStart({ recipeId: 'forge:weapon:iron' }),
      '/forge/start',
      { recipeId: 'forge:weapon:iron' },
      answer,
    ],
    [
      'forgeStart (affix)',
      (api) => api.forgeStart({ recipeId: 'scriptorium:affix', pieceId: 'fx-fernblade' }),
      '/forge/start',
      { recipeId: 'scriptorium:affix', pieceId: 'fx-fernblade' },
      answer,
    ],
    [
      'forgeCollect',
      (api) => api.forgeCollect('loom'),
      '/forge/collect',
      { station: 'loom' },
      { me, piece: null, applied: true },
    ],
    [
      'forgeUpgrade (buy)',
      (api) => api.forgeUpgrade({ upgrade: 'bellows' }),
      '/forge/upgrade',
      { upgrade: 'bellows' },
      answer,
    ],
    [
      'forgeUpgrade (cape colour)',
      (api) => api.forgeUpgrade({ capeColor: 'azure' }),
      '/forge/upgrade',
      { capeColor: 'azure' },
      answer,
    ],
    [
      'forgeUpgrade (natural cape)',
      (api) => api.forgeUpgrade({ capeColor: null }),
      '/forge/upgrade',
      { capeColor: null },
      answer,
    ],
    [
      'gearEquip (piece)',
      (api) => api.gearEquip({ pieceId: 'fx-silver-cape' }),
      '/gear/equip',
      { pieceId: 'fx-silver-cape' },
      answer,
    ],
    [
      'gearEquip (unequip)',
      (api) => api.gearEquip({ unequip: 'weapon' }),
      '/gear/equip',
      { unequip: 'weapon' },
      answer,
    ],
    [
      'gearEquip (pet)',
      (api) => api.gearEquip({ petId: 'linter-cat' }),
      '/gear/equip',
      { petId: 'linter-cat' },
      answer,
    ],
    [
      'featPin',
      (api) => api.featPin('imp-whisperer', true),
      '/feats/pin',
      { featId: 'imp-whisperer', pinned: true },
      answer,
    ],
    [
      'featPin (unpin)',
      (api) => api.featPin('goblin-slayer', false),
      '/feats/pin',
      { featId: 'goblin-slayer', pinned: false },
      answer,
    ],
  ];

  it.each(calls)('%s', async (_name, call, path, fields, body) => {
    const fetchFn = vi.fn(async () => jsonResponse(body));
    const result = (await call(make(fetchFn))) as { me: { login: string } };
    expect(result.me.login).toBe('octo-dev');
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.example' + path);
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('omit');
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe(`Bearer ${TOKEN}`);
    expect(bodyOf(fetchFn.mock.calls[0])).toEqual({ requestId: 'req-1', ...fields });
  });

  it('hands a collect back with its loot, whether it was applied, and the Feats it unlocked', async () => {
    const loot = [{ kind: 'material', material: 'ore', quantity: 4 }];
    const result = await make(async () =>
      jsonResponse({ ...collected, loot, applied: false, featsUnlocked: ['spelunker'] }),
    ).expeditionCollect();
    expect(result.loot).toEqual(loot);
    expect(result.applied).toBe(false);
    expect(result.featsUnlocked).toEqual(['spelunker']);
    // A body with no `applied` or `featsUnlocked` reads as applied with nothing unlocked.
    const bare = await make(async () =>
      jsonResponse({ me, expedition: trip, loot: [] }),
    ).expeditionCollect();
    expect(bare.applied).toBe(true);
    expect(bare.featsUnlocked).toEqual([]);
  });

  it('hands a Forge collect back with the piece, or none for an order that made no piece', async () => {
    const piece = { id: 'p', slot: 'cape', power: 0.1, tier: 'iron', name: 'Iron Cape' };
    expect(
      (await make(async () => jsonResponse({ me, piece, applied: false })).forgeCollect('loom'))
        .piece,
    ).toEqual(piece);
    const none = await make(async () => jsonResponse({ me })).forgeCollect('loom');
    expect(none.piece).toBeNull();
    expect(none.applied).toBe(true);
  });

  it('retries a network failure with the SAME request id, and never retries a 409', async () => {
    let attempts = 0;
    const flaky = vi.fn(async () => {
      attempts += 1;
      if (attempts < 3) {
        throw new TypeError('Failed to fetch');
      }
      return jsonResponse(collected);
    });
    await make(flaky).expeditionCollect();
    expect(flaky.mock.calls.map((call) => bodyOf(call)['requestId'])).toEqual([
      'req-1',
      'req-1',
      'req-1',
    ]);

    for (const [code, run] of [
      ['in_progress', (api: Api) => api.expeditionSend({ region: 'koko-woods', choice: 4 })],
      ['not_returned', (api: Api) => api.expeditionCollect()],
      ['no_such_pack', (api: Api) => api.packOpen({ seed: 1, charmId: 'x' })],
      ['station_busy', (api: Api) => api.forgeStart({ recipeId: 'forge:weapon:iron' })],
      ['no_job', (api: Api) => api.forgeCollect('forge')],
      ['dyes_required', (api: Api) => api.forgeUpgrade({ capeColor: 'azure' })],
      ['tier_locked', (api: Api) => api.gearEquip({ pieceId: 'x' })],
      ['too_many_pinned', (api: Api) => api.featPin('surgeon', true)],
    ] as const) {
      const fetchFn = vi.fn(async () => jsonResponse({ error: code }, 409));
      await expect(run(make(fetchFn))).rejects.toMatchObject({ status: 409, code });
      expect(fetchFn).toHaveBeenCalledTimes(1);
    }
  });

  it('gives up after the last retry and hands the request id back for a later replay', async () => {
    const fetchFn = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    const error = (await make(fetchFn)
      .expeditionCollect()
      .catch((e: unknown) => e)) as ApiError;
    expect(error.status).toBe(0);
    expect(error.requestId).toBe('req-1');
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it('rejects a success body without a profile, or without what the route promised', async () => {
    await expect(
      make(async () => jsonResponse({ nope: 1 })).packOpen({ seed: 1, charmId: 'x' }),
    ).rejects.toMatchObject({
      status: 0,
    });
    await expect(
      make(async () => jsonResponse({ me: [] })).featPin('a', true),
    ).rejects.toMatchObject({
      status: 0,
    });
    await expect(
      make(async () => jsonResponse({ me })).expeditionSend({ region: 'koko-woods', choice: 4 }),
    ).rejects.toMatchObject({ status: 0 });
    await expect(make(async () => jsonResponse({ me })).expeditionCollect()).rejects.toMatchObject({
      status: 0,
    });
  });
});
