import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './api';
import type { Api } from './api';
import { createFixtureApi } from './fixtures/api';
import { fixtureFeats } from './fixtures/depth';
import { fixtureLogEntries } from './fixtures/state';
import { Session } from './session.svelte';
import type { FeatView } from './types';

const NOW = Date.UTC(2026, 10, 11, 14, 5, 0);

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
});

async function ready(api: Api = createFixtureApi({ now: NOW })): Promise<Session> {
  const session = new Session(api, { pollMs: 0 });
  await session.load();
  return session;
}

describe('the depth slices', () => {
  it('start empty and are read on request', async () => {
    const session = await ready();
    expect(session.expedition).toBeNull();
    expect(session.forge).toBeNull();
    expect(session.feats).toBeNull();
    expect(session.pendingFeats).toEqual([]);

    await session.loadExpedition();
    await session.loadForge();
    await session.loadFeats();
    expect(session.expedition?.status).toBe('returned');
    expect(session.forge?.stations.loom.status).toBe('ready');
    expect(session.feats).toHaveLength(6);
  });

  it('read nothing when signed out or before the profile has loaded', async () => {
    const signedOut = new Session(null);
    await signedOut.loadExpedition();
    await signedOut.loadForge();
    await signedOut.loadFeats();
    expect(signedOut.expedition).toBeNull();
    expect(signedOut.forge).toBeNull();
    expect(signedOut.feats).toBeNull();
    const early = new Session(createFixtureApi({ now: NOW }));
    await early.loadForge();
    expect(early.forge).toBeNull();
  });

  it('are rebuilt from the profile a write answers with, so no screen shows a stale price or timer', async () => {
    const session = await ready();
    await session.loadExpedition();
    await session.loadForge();
    expect((await session.expeditionCollect()).ok).toBe(true);
    expect(session.expedition?.status).toBe('collected');

    // The trinket costs 6 Timber and 2 Provisions: it is on the Scriptorium and 2 Provisions are left.
    const started = await session.forgeStart('start', { recipeId: 'scriptorium:trinket:leather' });
    expect(started.ok).toBe(true);
    expect(session.forge?.stations.scriptorium.status).toBe('working');
    expect(
      session.forge?.recipes.find((recipe) => recipe.id === 'loom:cape:leather')?.affordable,
    ).toBe(true);

    // A 12 h trip pays the other 2: the trip is away, and both views now see an empty Provisions pouch.
    const sent = await session.expeditionSend('send', { region: 'orrl-falls', choice: 12 });
    expect(sent.ok).toBe(true);
    expect(session.expedition?.status).toBe('away');
    expect(session.expedition?.returnsAt).toBe(new Date(NOW + 12 * 3_600_000).toISOString());
    expect(session.expedition?.choices.map((choice) => choice.affordable)).toEqual([
      true,
      false,
      false,
      false,
      false,
    ]);
    expect(
      session.forge?.recipes.find((recipe) => recipe.id === 'loom:cape:leather')?.affordable,
    ).toBe(false);
  });

  it('keep the run when a depth write answers with a profile and nothing else', async () => {
    const session = await ready();
    const week = session.week;
    expect(week).not.toBeNull();
    const base = createFixtureApi({ now: NOW });
    const noWeek: Api = {
      ...base,
      async featPin(featId, pinned) {
        const answer = await base.featPin(featId, pinned);
        const me: Record<string, unknown> = { ...answer.me };
        Reflect.deleteProperty(me, 'week');
        return { me: me as unknown as typeof answer.me };
      },
    };
    const kept = await ready(noWeek);
    expect((await kept.featPin('pin', 'imp-whisperer', true)).ok).toBe(true);
    expect(kept.week).not.toBeNull();
    expect(kept.week?.weekKey).toBe(week?.weekKey);
    expect(kept.me?.week).toBe(kept.week);
  });

  it('follow a profile that a background read replaces', async () => {
    const session = await ready();
    await session.loadExpedition();
    expect(session.expedition?.status).toBe('returned');
    await session.expeditionCollect();
    // The next poll brings the same profile; the views still agree with it.
    await session.refresh();
    expect(session.expedition?.status).toBe('collected');
  });

  it('keep what a failed read leaves on screen, and end the session on a 401', async () => {
    const base = createFixtureApi({ now: NOW });
    let fail: ApiError | null = null;
    const api: Api = {
      ...base,
      async expedition() {
        if (fail) throw fail;
        return base.expedition();
      },
      async forge() {
        if (fail) throw fail;
        return base.forge();
      },
      async feats() {
        if (fail) throw fail;
        return base.feats();
      },
    };
    const session = await ready(api);
    await session.loadExpedition();
    await session.loadForge();
    await session.loadFeats();
    fail = new ApiError(0, 'offline');
    await session.loadExpedition();
    await session.loadForge();
    await session.loadFeats();
    expect(session.status).toBe('ready');
    expect(session.expedition).not.toBeNull();
    expect(session.feats).not.toBeNull();

    fail = new ApiError(401, 'no');
    await session.loadForge();
    expect(session.status).toBe('signed-out');
    expect(session.expired).toBe(true);
  });

  it('are not overwritten by a read that began before a write finished', async () => {
    const base = createFixtureApi({ now: NOW });
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const api: Api = {
      ...base,
      async expedition() {
        const view = await base.expedition();
        await gate;
        return view;
      },
    };
    const session = await ready(api);
    const slow = session.loadExpedition();
    await session.expeditionCollect();
    release();
    await slow;
    // The stale answer (still "returned") was dropped.
    expect(session.expedition).toBeNull();
  });
});

describe('collecting an expedition', () => {
  it('hands back the loot for the reveal and banks it', async () => {
    const session = await ready();
    const before = session.me!;
    const result = await session.expeditionCollect();
    expect(result.ok).toBe(true);
    const collect = result.ok ? result.collect : undefined;
    expect(collect?.applied).toBe(true);
    expect(collect?.loot).toHaveLength(5);
    expect(collect?.expedition.collected).toBe(true);
    expect(session.me?.charmPacks.length).toBe(before.charmPacks.length + 1);
    expect(session.me?.expedition?.collected).toBe(true);
    expect(session.busy).toBeNull();
  });

  it('answers a second collect with the same loot and applied false, granting nothing twice', async () => {
    const session = await ready();
    const first = await session.expeditionCollect();
    const satchel = session.me!.satchel;
    const again = await session.expeditionCollect();
    const [a, b] = [first, again].map((result) => (result.ok ? result.collect : undefined));
    expect(b?.applied).toBe(false);
    expect(b?.loot).toEqual(a?.loot);
    expect(b?.featsUnlocked).toEqual([]);
    expect(session.me?.satchel).toEqual(satchel);
  });

  it('refuses with the typed 409 in words, and brings the screen up to date', async () => {
    const session = await ready(createFixtureApi({ now: NOW, variant: 'day0' }));
    const result = await session.expeditionCollect();
    expect(result).toMatchObject({
      ok: false,
      status: 409,
      code: 'not_returned',
      message: 'Your character is not back yet.',
    });
    expect(session.status).toBe('ready');
  });

  it('puts a Feat it unlocked in the banner at once, before the list is read again', async () => {
    const session = await ready();
    await session.loadFeats();
    expect(session.pendingFeats).toEqual([]);
    const result = await session.expeditionCollect();
    expect(result.ok && result.collect?.featsUnlocked).toEqual(['spelunker']);
    expect(session.pendingFeats).toEqual(['spelunker']);
    // The list is read again in the background and agrees.
    await vi.waitFor(() =>
      expect(session.feats?.find((feat) => feat.id === 'spelunker')?.unlocked).toBe(true),
    );
    expect(session.pendingFeats).toEqual(['spelunker']);
  });

  it('shows the banner even when the Feat list was never read first', async () => {
    const session = await ready();
    await session.expeditionCollect();
    await vi.waitFor(() => expect(session.feats).not.toBeNull());
    expect(session.pendingFeats).toEqual(['spelunker']);
  });

  it('replays a collect that died on the network with the same request id', async () => {
    const base = createFixtureApi({ now: NOW });
    const seen: (string | undefined)[] = [];
    let fail = true;
    const api: Api = {
      ...base,
      async expeditionCollect(options) {
        seen.push(options?.requestId);
        if (fail) {
          fail = false;
          throw new ApiError(0, 'offline', null, 'req-9');
        }
        return base.expeditionCollect(options);
      },
    };
    const session = await ready(api);
    const first = await session.expeditionCollect();
    expect(first).toMatchObject({ ok: false, status: 0 });
    const second = await session.expeditionCollect();
    expect(second.ok).toBe(true);
    expect(seen).toEqual([undefined, 'req-9']);
  });

  it('does one write at a time', async () => {
    const session = await ready();
    const first = session.expeditionCollect();
    const second = await session.expeditionCollect();
    expect(second).toMatchObject({ ok: false, code: 'busy' });
    expect((await first).ok).toBe(true);
  });

  it('says it is signed out without an api', async () => {
    const session = new Session(null);
    expect(await session.expeditionCollect()).toMatchObject({
      ok: false,
      message: 'You are signed out.',
    });
    expect(await session.packOptions(1)).toMatchObject({ ok: false });
    expect(await session.forgeCollect('c', 'loom')).toMatchObject({ ok: false });
  });
});

describe('the Feat banner', () => {
  /** An api whose Feat list the test controls. */
  function scripted(list: () => FeatView[]): Api {
    return {
      ...createFixtureApi({ now: NOW }),
      async feats() {
        return { feats: list() };
      },
    };
  }

  const earlier = fixtureFeats(NOW, 'active');
  const withSurgeon = earlier.map((feat) =>
    feat.id === 'surgeon'
      ? { ...feat, unlocked: true, progress: 1, unlockedAt: new Date(NOW).toISOString() }
      : feat,
  );

  it('counts what was already earned as seen, so old Feats bring no banner', async () => {
    const session = await ready(scripted(() => earlier));
    await session.loadFeats();
    expect(session.pendingFeats).toEqual([]);
  });

  it('waits for a Feat to unlock, shows it, and keeps showing it until it is dismissed', async () => {
    let list = earlier;
    const session = await ready(scripted(() => list));
    await session.loadFeats();
    list = withSurgeon;
    await session.loadFeats();
    expect(session.pendingFeats).toEqual(['surgeon']);
    // Reading the list again, or leaving and coming back, does not clear it.
    await session.loadFeats();
    expect(session.pendingFeats).toEqual(['surgeon']);
    session.dismissFeatBanner();
    expect(session.pendingFeats).toEqual([]);
    await session.loadFeats();
    expect(session.pendingFeats).toEqual([]);
  });

  it('reads the list again when a scored row arrives, if anyone is looking at it', async () => {
    let list = earlier;
    const base = createFixtureApi({ now: NOW });
    const entries = fixtureLogEntries(NOW);
    let served = entries.slice(1);
    const api: Api = {
      ...base,
      async feats() {
        return { feats: list };
      },
      async log() {
        return { entries: served, nextCursor: null };
      },
    };
    const session = await ready(api);
    await session.loadFeats();
    list = withSurgeon;
    served = entries;
    await session.refresh();
    await vi.waitFor(() => expect(session.pendingFeats).toEqual(['surgeon']));
  });

  it('does not read the list on a scored row when nobody has opened it', async () => {
    const base = createFixtureApi({ now: NOW });
    const feats = vi.fn(base.feats);
    const entries = fixtureLogEntries(NOW);
    let served = entries.slice(1);
    const api: Api = {
      ...base,
      feats,
      async log() {
        return { entries: served, nextCursor: null };
      },
    };
    const session = await ready(api);
    served = entries;
    await session.refresh();
    expect(feats).not.toHaveBeenCalled();
  });

  it('dismisses a banner nobody loaded the list for', async () => {
    const session = await ready();
    session.dismissFeatBanner();
    expect(session.pendingFeats).toEqual([]);
  });
});

describe('the other depth writes', () => {
  it('opens a Charm pack: options first, then keep one', async () => {
    const session = await ready();
    const options = await session.packOptions(4101);
    expect(options.ok && options.options).toHaveLength(3);
    const first = options.ok ? options.options![0]! : null;
    const kept = await session.packOpen('keep', { seed: 4101, charmId: first!.id });
    expect(kept.ok).toBe(true);
    expect(session.me?.charmPacks).toEqual([4102]);
    expect(session.me?.charms.map((charm) => charm.id)).toContain(first!.id);
    const gone = await session.packOptions(4101);
    expect(gone).toMatchObject({ ok: false, code: 'no_such_pack' });
  });

  it('starts and collects Forge orders, and says when a collect was a replay', async () => {
    const session = await ready();
    const made = await session.forgeCollect('c', 'loom');
    expect(made).toMatchObject({ ok: true, applied: true });
    expect(made.ok && made.piece?.name).toBe('Iron Cape');
    const again = await session.forgeCollect('c', 'loom');
    expect(again).toMatchObject({ ok: true, applied: false });
    expect(await session.forgeCollect('c', 'scriptorium')).toMatchObject({
      ok: false,
      code: 'no_job',
    });
  });

  it('wears, takes off and follows, and paints the cape once the Dyes are owned', async () => {
    const session = await ready(
      createFixtureApi({ now: NOW, me: { forge: { upgrades: ['dyes'], stations: {} } } }),
    );
    expect((await session.gearEquip('e', { pieceId: 'fx-silver-cape' })).ok).toBe(true);
    expect(session.me?.gear.equipped.cape?.id).toBe('fx-silver-cape');
    expect((await session.unequip('u', 'weapon')).ok).toBe(true);
    expect(session.me?.gear.equipped.weapon).toBeUndefined();
    expect((await session.gearEquip('p', { petId: 'linter-cat' })).ok).toBe(true);
    expect(session.me?.gear.equipped.pet?.ref).toBe('linter-cat');
    expect((await session.setCapeColor('d', 'azure')).ok).toBe(true);
    expect(session.me?.gear.capeColor).toBe('azure');
    expect((await session.forgeUpgrade('b', { upgrade: 'bellows' })).ok).toBe(true);
    expect(session.me?.forge.upgrades).toContain('bellows');
  });

  it('pins a Feat and updates the list in place', async () => {
    const session = await ready();
    await session.loadFeats();
    expect((await session.featPin('pin', 'imp-whisperer', true)).ok).toBe(true);
    expect(session.me?.pinnedFeats).toContain('imp-whisperer');
    expect(session.feats?.find((feat) => feat.id === 'imp-whisperer')?.pinned).toBe(true);
    expect((await session.featPin('pin', 'imp-whisperer', false)).ok).toBe(true);
    expect(session.feats?.find((feat) => feat.id === 'imp-whisperer')?.pinned).toBe(false);
  });

  it('turns every refusal into words next to the control, never a thrown error', async () => {
    const session = await ready();
    const results = [
      await session.featPin('pin', 'surgeon', true),
      await session.gearEquip('e', { pieceId: 'nope' }),
      await session.forgeUpgrade('u', { capeColor: 'azure' }),
      await session.forgeStart('s', { recipeId: 'forge:weapon:iron' }),
      await session.expeditionSend('x', { region: 'koko-woods', choice: 4 }),
    ];
    expect(results.map((result) => (result.ok ? null : result.code))).toEqual([
      'not_unlocked',
      'not_owned',
      'dyes_required',
      'station_busy',
      'uncollected',
    ]);
    expect(results.every((result) => !result.ok && result.message.endsWith('.'))).toBe(true);
  });
});
