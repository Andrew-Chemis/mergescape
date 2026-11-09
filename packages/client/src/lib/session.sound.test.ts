/**
 * The cues that belong to no screen of their own: a purchase, an act clearing and the character coming
 * home. The session plays them, and they are silent unless the player turned sound on.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cuesHeard, soundOnAfterGesture, stubAudio } from '../test/audio';
import { ApiError } from './api';
import type { Api } from './api';
import { createFixtureApi } from './fixtures/api';
import { fixtureLogEntries, fixtureMe } from './fixtures/state';
import { Session } from './session.svelte';
import type { MeResponse } from './types';

const NOW = Date.UTC(2026, 10, 11, 14, 5, 0);
const MINUTE = 60_000;

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
});

/** An api whose profile the test can replace between refreshes. */
function scripted(initial: MeResponse) {
  const state = { me: initial };
  const base = createFixtureApi({ now: NOW });
  const api: Api = {
    ...base,
    async me() {
      return state.me;
    },
    async log() {
      return { entries: fixtureLogEntries(NOW), nextCursor: null };
    },
  };
  return { api, state };
}

describe('the purchase cue', () => {
  it('plays once when a purchase goes through, and not when it is refused', async () => {
    const audio = soundOnAfterGesture();
    const api = createFixtureApi({ now: NOW });
    const session = new Session(api, { pollMs: 0 });
    await session.load();
    expect(cuesHeard(audio)).toEqual([]);

    expect((await session.shopBuy('charm:1', { kind: 'charm', index: 1 })).ok).toBe(true);
    expect(cuesHeard(audio)).toEqual(['purchase']);

    // The same slot again is sold out: no cue for a refusal.
    expect((await session.shopBuy('charm:1', { kind: 'charm', index: 1 })).ok).toBe(false);
    expect(cuesHeard(audio)).toEqual(['purchase']);
  });

  it('is silent, and makes no audio object, with sound off', async () => {
    const audio = stubAudio();
    const session = new Session(createFixtureApi({ now: NOW }), { pollMs: 0 });
    await session.load();
    await session.shopBuy('charm:1', { kind: 'charm', index: 1 });
    expect(audio.contexts).toHaveLength(0);
  });

  it('does not play for a purchase the network lost', async () => {
    const audio = soundOnAfterGesture();
    const api = createFixtureApi({ now: NOW });
    const session = new Session(
      {
        ...api,
        shopBuy: () => Promise.reject(new ApiError(0, 'Could not reach the server.')),
      },
      { pollMs: 0 },
    );
    await session.load();
    expect((await session.shopBuy('charm:0', { kind: 'charm', index: 0 })).ok).toBe(false);
    expect(audio.oscillators()).toHaveLength(0);
  });
});

describe('the act clear cue', () => {
  it('plays when a refresh finds a further act cleared in the same week', async () => {
    const audio = soundOnAfterGesture();
    const me = fixtureMe(NOW, 'active', { act: 'raid', clearedActs: ['scout'] });
    const { api, state } = scripted(me);
    const session = new Session(api, { pollMs: 0 });
    await session.load();
    expect(cuesHeard(audio)).toEqual([]);

    // Nothing changed: no cue.
    await session.refresh();
    expect(cuesHeard(audio)).toEqual([]);

    state.me = fixtureMe(NOW, 'active', { act: 'boss', clearedActs: ['scout', 'raid'] });
    await session.refresh();
    expect(cuesHeard(audio)).toEqual(['actClear']);
  });

  it('does not play when a new week starts with nothing cleared, or on the first load', async () => {
    const audio = soundOnAfterGesture();
    const cleared = fixtureMe(NOW, 'active', { clearedActs: ['scout', 'raid'] });
    const { api, state } = scripted(cleared);
    const session = new Session(api, { pollMs: 0 });
    await session.load();
    state.me = fixtureMe(NOW, 'active', { weekKey: '2026-W47', act: 'scout', clearedActs: [] });
    await session.refresh();
    // A later week that has more cleared than the earlier one is not the same week: still silent.
    state.me = fixtureMe(NOW, 'active', {
      weekKey: '2026-W48',
      act: 'boss',
      clearedActs: ['scout', 'raid'],
    });
    await session.refresh();
    expect(cuesHeard(audio)).toEqual([]);
  });

  it('is silent with sound off', async () => {
    const audio = stubAudio();
    const first = fixtureMe(NOW, 'active', { act: 'raid', clearedActs: ['scout'] });
    const { api, state } = scripted(first);
    const session = new Session(api, { pollMs: 0 });
    await session.load();
    state.me = fixtureMe(NOW, 'active', { act: 'boss', clearedActs: ['scout', 'raid'] });
    await session.refresh();
    expect(audio.contexts).toHaveLength(0);
  });
});

describe('the expedition return cue', () => {
  const expedition = (returnsAt: number, collected = false): MeResponse['expedition'] => {
    const base = fixtureMe(NOW).expedition;
    if (!base) {
      throw new Error('the fixture profile has an expedition');
    }
    return { ...base, sentAt: returnsAt - 4 * 60 * MINUTE, returnsAt, collected };
  };

  it('plays when a refresh finds the trip that was away has come home', async () => {
    const audio = soundOnAfterGesture();
    const { api, state } = scripted({
      ...fixtureMe(NOW),
      expedition: expedition(NOW + 10 * MINUTE),
    });
    const session = new Session(api, { pollMs: 0 });
    await session.load();

    await session.refresh();
    expect(cuesHeard(audio)).toEqual([]);

    vi.setSystemTime(NOW + 11 * MINUTE);
    await session.refresh();
    expect(cuesHeard(audio)).toEqual(['expeditionReturn']);

    // It plays once: the next refresh finds it still waiting.
    vi.setSystemTime(NOW + 12 * MINUTE);
    await session.refresh();
    expect(cuesHeard(audio)).toEqual(['expeditionReturn']);
    expect(state.me.expedition?.collected).toBe(false);
  });

  it('does not play for a trip that was already back when the page loaded', async () => {
    const audio = soundOnAfterGesture();
    const { api } = scripted({ ...fixtureMe(NOW), expedition: expedition(NOW - 60 * MINUTE) });
    const session = new Session(api, { pollMs: 0 });
    await session.load();
    await session.refresh();
    expect(cuesHeard(audio)).toEqual([]);
  });

  it('is silent with sound off', async () => {
    const audio = stubAudio();
    const { api } = scripted({ ...fixtureMe(NOW), expedition: expedition(NOW + 10 * MINUTE) });
    const session = new Session(api, { pollMs: 0 });
    await session.load();
    vi.setSystemTime(NOW + 11 * MINUTE);
    await session.refresh();
    expect(audio.contexts).toHaveLength(0);
  });
});
