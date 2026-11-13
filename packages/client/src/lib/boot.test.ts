import { describe, expect, it } from 'vitest';
import { FIXTURE_LIVE_AFTER_MS, FIXTURE_LIVE_POLL_MS, resolveBoot } from './boot';
import { DEFAULT_POLL_MS } from './session.svelte';

const ORIGIN = 'https://api.example';

describe('resolveBoot', () => {
  it('runs on fixtures with ?fixture=1, whatever the build says', () => {
    const boot = resolveBoot('?fixture=1', ORIGIN, 'a.b.c');
    expect(boot.mode).toBe('fixture');
    expect(boot.api).not.toBeNull();
    expect(boot.pollMs).toBe(0);
  });

  it('runs on fixtures when the build has no api origin', () => {
    expect(resolveBoot('', null, null).mode).toBe('fixture');
    expect(resolveBoot('', null, 'a.b.c').mode).toBe('fixture');
  });

  it('treats ?fixture=0 and an empty value as "not requested"', () => {
    expect(resolveBoot('?fixture=0', ORIGIN, 'a.b.c').mode).toBe('live');
    expect(resolveBoot('?fixture=', ORIGIN, null).mode).toBe('signed-out');
  });

  it('is signed out with an origin but no token', () => {
    const boot = resolveBoot('', ORIGIN, null);
    expect(boot).toEqual({ mode: 'signed-out', api: null, pollMs: 0 });
  });

  it('uses the real api, polling at the default pace, with an origin and a token', () => {
    const boot = resolveBoot('', ORIGIN, 'a.b.c');
    expect(boot.mode).toBe('live');
    expect(boot.api).not.toBeNull();
    expect(boot.pollMs).toBe(DEFAULT_POLL_MS);
  });

  it('picks the fixture variant and the live demo from the query', async () => {
    const empty = resolveBoot('?fixture=noevents', null, null);
    expect((await empty.api?.log())?.entries).toEqual([]);
    expect((await empty.api?.installations())?.installations).toHaveLength(1);

    const bare = resolveBoot('?fixture=noinstall', null, null);
    expect((await bare.api?.installations())?.installations).toEqual([]);

    // ?fixture=day0: the moment after a brand-new character's first kill, with the Forage already sent.
    const day0 = resolveBoot('?fixture=day0', null, null);
    expect(day0.mode).toBe('fixture');
    expect((await day0.api?.log())?.entries).toHaveLength(1);
    const first = await day0.api?.me();
    expect(first?.expedition).toMatchObject({ region: 'koko-woods', forage: true, hours: 4 });
    expect(first?.expedition?.collected).toBe(false);

    const fallback = resolveBoot('?fixture=whatever', null, null);
    expect((await fallback.api?.log())?.entries.length).toBeGreaterThan(0);

    const live = resolveBoot('?fixture=1&live=1', null, null);
    expect(live.pollMs).toBe(FIXTURE_LIVE_POLL_MS);
    expect(FIXTURE_LIVE_AFTER_MS).toBeGreaterThan(FIXTURE_LIVE_POLL_MS);
  });
});
