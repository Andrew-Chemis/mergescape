/**
 * The consent store: opt-in by default (analytics off), persisted in localStorage under
 * `mergescape.consent`, guarded against blocked storage, and the "clear local data" action.
 */
import { get } from 'svelte/store';
import { describe, expect, it, vi } from 'vitest';
import { TOKEN_KEY } from './api';
import {
  analyticsAllowed,
  clearLocalData,
  consent,
  CONSENT_KEY,
  createConsentStore,
  DEFAULT_CONSENT,
  pageControls,
  parseConsent,
  soundAllowed,
  STORAGE_PREFIX,
} from './consent';
import { REVEAL_KEY } from './reveal';

/** A Storage that lives in a Map, so a test can have several that do not share anything. */
function memoryStorage(initial: Record<string, string> = {}): Storage {
  const data = new Map(Object.entries(initial));
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => void data.delete(key),
    setItem: (key, value) => void data.set(key, String(value)),
  };
}

const FIXED = new Date('2026-11-09T12:30:00.000Z');

describe('keys', () => {
  it('uses mergescape.consent, inside the prefix that Clear local data removes', () => {
    expect(CONSENT_KEY).toBe('mergescape.consent');
    expect(CONSENT_KEY.startsWith(STORAGE_PREFIX)).toBe(true);
    expect(TOKEN_KEY.startsWith(STORAGE_PREFIX)).toBe(true);
    expect(REVEAL_KEY.startsWith(STORAGE_PREFIX)).toBe(true);
  });
});

describe('parseConsent', () => {
  it('reads what the store writes', () => {
    expect(parseConsent('{"analytics":true,"updatedAt":"2026-11-09T12:30:00.000Z"}')).toEqual({
      analytics: true,
      sound: false,
      updatedAt: '2026-11-09T12:30:00.000Z',
    });
    expect(parseConsent('{"analytics":false,"sound":true,"updatedAt":"x"}')).toEqual({
      analytics: false,
      sound: true,
      updatedAt: 'x',
    });
  });

  it('means "never chose" for anything that is missing or damaged', () => {
    for (const raw of [null, undefined, '', 'not json', 'null', '7', '"yes"', '[]', '{}']) {
      expect(parseConsent(raw)).toEqual({ analytics: false, sound: false, updatedAt: null });
    }
  });

  it('switches analytics on only for a literal true', () => {
    for (const value of ['1', '"true"', '"yes"', '"on"', '{}', 'null', '[true]']) {
      expect(parseConsent(`{"analytics":${value},"updatedAt":null}`).analytics).toBe(false);
    }
    expect(parseConsent('{"analytics":true}').analytics).toBe(true);
  });

  it('ignores an updatedAt that is not a string', () => {
    expect(parseConsent('{"analytics":false,"updatedAt":5}').updatedAt).toBeNull();
  });

  it('never hands out the shared default object', () => {
    const first = parseConsent(null);
    first.analytics = true;
    expect(DEFAULT_CONSENT.analytics).toBe(false);
    expect(parseConsent(null).analytics).toBe(false);
  });
});

describe('the default', () => {
  it('is analytics off, with no date, and writes nothing', () => {
    const storage = memoryStorage();
    const store = createConsentStore(() => storage);
    expect(get(store)).toEqual({ analytics: false, sound: false, updatedAt: null });
    expect(storage.length).toBe(0);
  });

  it('is off for the shared store on a fresh device, and analyticsAllowed says no', () => {
    expect(get(consent)).toEqual({ analytics: false, sound: false, updatedAt: null });
    expect(analyticsAllowed()).toBe(false);
    expect(window.localStorage.getItem(CONSENT_KEY)).toBeNull();
  });
});

describe('persisting the choice', () => {
  it('saves { analytics, updatedAt } under mergescape.consent and says it worked', () => {
    const storage = memoryStorage();
    const store = createConsentStore(
      () => storage,
      () => FIXED,
    );
    expect(store.setAnalytics(true)).toBe(true);
    expect(get(store)).toEqual({
      analytics: true,
      sound: false,
      updatedAt: '2026-11-09T12:30:00.000Z',
    });
    expect(JSON.parse(storage.getItem(CONSENT_KEY) ?? '')).toEqual({
      analytics: true,
      sound: false,
      updatedAt: '2026-11-09T12:30:00.000Z',
    });
  });

  it('is remembered by a store created later (a reload)', () => {
    const storage = memoryStorage();
    createConsentStore(
      () => storage,
      () => FIXED,
    ).setAnalytics(true);
    expect(get(createConsentStore(() => storage)).analytics).toBe(true);
  });

  it('can be switched off again, which is stored as off with the new time', () => {
    const storage = memoryStorage();
    const store = createConsentStore(
      () => storage,
      () => FIXED,
    );
    store.setAnalytics(true);
    expect(store.setAnalytics(false)).toBe(true);
    expect(get(store)).toEqual({
      analytics: false,
      sound: false,
      updatedAt: '2026-11-09T12:30:00.000Z',
    });
    expect(get(createConsentStore(() => storage)).analytics).toBe(false);
  });

  it('tells subscribers about every change', () => {
    const store = createConsentStore(
      () => memoryStorage(),
      () => FIXED,
    );
    const seen: boolean[] = [];
    const stop = store.subscribe((value) => seen.push(value.analytics));
    store.setAnalytics(true);
    store.setAnalytics(false);
    stop();
    expect(seen).toEqual([false, true, false]);
  });

  it('re-reads storage when a screen starts watching, so what is stored is what counts', () => {
    const storage = memoryStorage();
    const store = createConsentStore(() => storage);
    expect(get(store).analytics).toBe(false);
    storage.setItem(CONSENT_KEY, '{"analytics":true,"updatedAt":"2026-01-01T00:00:00.000Z"}');
    expect(get(store).analytics).toBe(true);
    storage.removeItem(CONSENT_KEY);
    expect(get(store).analytics).toBe(false);
  });

  it('works with the real localStorage, and analyticsAllowed follows it', () => {
    expect(consent.setAnalytics(true)).toBe(true);
    expect(JSON.parse(window.localStorage.getItem(CONSENT_KEY) ?? '').analytics).toBe(true);
    expect(analyticsAllowed()).toBe(true);
    consent.setAnalytics(false);
    expect(analyticsAllowed()).toBe(false);
  });

  it('goes back to the default on reset, and removes the stored value', () => {
    const storage = memoryStorage();
    const store = createConsentStore(
      () => storage,
      () => FIXED,
    );
    store.setAnalytics(true);
    store.reset();
    expect(get(store)).toEqual({ analytics: false, sound: false, updatedAt: null });
    expect(storage.getItem(CONSENT_KEY)).toBeNull();
  });

  it('treats a damaged stored value as off and replaces it on the next choice', () => {
    const storage = memoryStorage({ [CONSENT_KEY]: '{"analytics":tru' });
    const store = createConsentStore(
      () => storage,
      () => FIXED,
    );
    expect(get(store).analytics).toBe(false);
    expect(store.setAnalytics(true)).toBe(true);
    expect(get(createConsentStore(() => storage)).analytics).toBe(true);
  });
});

describe('the sound preference (opt-in, off by default)', () => {
  it('is off on a fresh device and for a stored value without it, and only a literal true turns it on', () => {
    expect(get(createConsentStore(() => memoryStorage())).sound).toBe(false);
    expect(soundAllowed()).toBe(false);
    expect(parseConsent('{"analytics":true}').sound).toBe(false);
    for (const value of ['1', '"true"', '"yes"', '"on"', '{}', 'null', '[true]', '0']) {
      expect(parseConsent(`{"sound":${value}}`).sound, value).toBe(false);
    }
    expect(parseConsent('{"sound":true}').sound).toBe(true);
  });

  it('is saved under mergescape.consent and remembered by a store created later (a reload)', () => {
    const storage = memoryStorage();
    const store = createConsentStore(
      () => storage,
      () => FIXED,
    );
    expect(store.setSound(true)).toBe(true);
    expect(get(store).sound).toBe(true);
    expect(JSON.parse(storage.getItem(CONSENT_KEY) ?? '').sound).toBe(true);
    expect(get(createConsentStore(() => storage)).sound).toBe(true);
    expect(store.setSound(false)).toBe(true);
    expect(get(createConsentStore(() => storage)).sound).toBe(false);
  });

  it('does not touch the analytics choice or its date, and the analytics choice does not touch it', () => {
    const storage = memoryStorage();
    const store = createConsentStore(
      () => storage,
      () => FIXED,
    );
    store.setAnalytics(true);
    store.setSound(true);
    expect(get(store)).toEqual({
      analytics: true,
      sound: true,
      updatedAt: '2026-11-09T12:30:00.000Z',
    });
    store.setAnalytics(false);
    expect(get(store)).toEqual({
      analytics: false,
      sound: true,
      updatedAt: '2026-11-09T12:30:00.000Z',
    });
    const later = createConsentStore(
      () => storage,
      () => new Date('2026-12-01T00:00:00.000Z'),
    );
    later.setSound(false);
    expect(get(later)).toEqual({
      analytics: false,
      sound: false,
      updatedAt: '2026-11-09T12:30:00.000Z',
    });
  });

  it('is reset to off with everything else, and soundAllowed follows the shared store', () => {
    expect(consent.setSound(true)).toBe(true);
    expect(soundAllowed()).toBe(true);
    consent.reset();
    expect(soundAllowed()).toBe(false);
    expect(window.localStorage.getItem(CONSENT_KEY)).toBeNull();
  });

  it('changes for the screen but is not saved when storage is blocked', () => {
    const store = createConsentStore(
      () => undefined,
      () => FIXED,
    );
    const seen: boolean[] = [];
    const stop = store.subscribe((value) => seen.push(value.sound));
    expect(store.setSound(true)).toBe(false);
    expect(seen).toEqual([false, true]);
    stop();
    expect(get(store).sound).toBe(false);
  });

  it('survives a setItem that throws and reports it', () => {
    const storage = memoryStorage();
    storage.setItem = () => {
      throw new Error('QuotaExceededError');
    };
    expect(createConsentStore(() => storage).setSound(true)).toBe(false);
  });
});

describe('when storage is blocked (private windows, blocked site data)', () => {
  it('has no storage at all: the choice changes for the screen but is not saved', () => {
    const store = createConsentStore(
      () => undefined,
      () => FIXED,
    );
    const seen: boolean[] = [];
    const stop = store.subscribe((value) => seen.push(value.analytics));
    expect(store.setAnalytics(true)).toBe(false);
    expect(seen).toEqual([false, true]);
    stop();
    // Nobody watching any more, and nothing is stored: it is off again.
    expect(get(store).analytics).toBe(false);
  });

  it('survives a getItem that throws and starts off', () => {
    const storage = memoryStorage();
    storage.getItem = () => {
      throw new Error('SecurityError');
    };
    const store = createConsentStore(() => storage);
    expect(get(store)).toEqual({ analytics: false, sound: false, updatedAt: null });
  });

  it('survives a setItem that throws (quota, blocked) and reports it', () => {
    const storage = memoryStorage();
    storage.setItem = () => {
      throw new Error('QuotaExceededError');
    };
    const store = createConsentStore(
      () => storage,
      () => FIXED,
    );
    expect(store.setAnalytics(true)).toBe(false);
  });

  it('survives a removeItem that throws on reset', () => {
    const storage = memoryStorage({ [CONSENT_KEY]: '{"analytics":true}' });
    storage.removeItem = () => {
      throw new Error('SecurityError');
    };
    const store = createConsentStore(() => storage);
    const seen: boolean[] = [];
    const stop = store.subscribe((value) => seen.push(value.analytics));
    expect(() => store.reset()).not.toThrow();
    stop();
    // The open screen goes back to off. What is on the device is still what a later screen reads.
    expect(seen).toEqual([true, false]);
    expect(get(store).analytics).toBe(true);
  });

  it('survives a localStorage getter that throws, for the shared store too', () => {
    vi.spyOn(globalThis, 'localStorage', 'get').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(get(consent)).toEqual({ analytics: false, sound: false, updatedAt: null });
    expect(consent.setAnalytics(true)).toBe(false);
    expect(() => consent.reset()).not.toThrow();
    expect(analyticsAllowed()).toBe(false);
    expect(clearLocalData()).toEqual([]);
  });

  it('survives a localStorage that is simply missing', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(get(consent).analytics).toBe(false);
    expect(consent.setAnalytics(true)).toBe(false);
    expect(clearLocalData()).toEqual([]);
  });
});

describe('clearLocalData', () => {
  it('removes every mergescape.* key, the token among them, and nothing else', () => {
    const storage = memoryStorage({
      [TOKEN_KEY]: 'a.b.c',
      [REVEAL_KEY]: '2026-46',
      [CONSENT_KEY]: '{"analytics":true,"updatedAt":null}',
      'mergescape.somethingNew': '1',
      theme: 'dark',
      mergescape: 'no dot, not ours',
      'Mergescape.x': 'different case',
      'other.mergescape.x': 'prefix only counts at the start',
    });
    const removed = clearLocalData(() => storage);
    expect(removed.sort()).toEqual(
      [CONSENT_KEY, REVEAL_KEY, TOKEN_KEY, 'mergescape.somethingNew'].sort(),
    );
    expect(storage.length).toBe(4);
    expect(storage.getItem('theme')).toBe('dark');
    expect(storage.getItem('mergescape')).not.toBeNull();
    expect(storage.getItem('Mergescape.x')).not.toBeNull();
    expect(storage.getItem('other.mergescape.x')).not.toBeNull();
  });

  it('does nothing, without throwing, when there is nothing to remove', () => {
    const storage = memoryStorage({ theme: 'dark' });
    expect(clearLocalData(() => storage)).toEqual([]);
    expect(storage.length).toBe(1);
  });

  it('still removes the token when enumerating keys fails part way', () => {
    const storage = memoryStorage({ [TOKEN_KEY]: 'a.b.c' });
    storage.key = () => {
      throw new Error('SecurityError');
    };
    expect(clearLocalData(() => storage)).toEqual([TOKEN_KEY]);
    expect(storage.getItem(TOKEN_KEY)).toBeNull();
  });

  it('works on the real localStorage, and puts consent back to off', () => {
    window.localStorage.setItem(TOKEN_KEY, 'a.b.c');
    window.localStorage.setItem(REVEAL_KEY, '2026-46');
    consent.setAnalytics(true);
    expect(clearLocalData().sort()).toEqual([CONSENT_KEY, REVEAL_KEY, TOKEN_KEY].sort());
    expect(window.localStorage.length).toBe(0);
    expect(analyticsAllowed()).toBe(false);
  });
});

describe('pageControls', () => {
  it('is the seam the Cookies page reloads through', () => {
    const reload = vi.spyOn(pageControls, 'reload').mockImplementation(() => {});
    pageControls.reload();
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
