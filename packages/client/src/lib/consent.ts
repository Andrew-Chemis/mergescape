/**
 * The visitor's opt-in choices, and the "clear local data" action behind the Cookies page.
 *
 * Mergescape is opt-in: `analytics` and `sound` are `false` until the visitor switches them on
 * (game-design.md sections 9 and 12, design.md section 14). Today nothing reads the analytics choice,
 * because there are no analytics. It exists so that a first-party analytics package can ask
 * `analyticsAllowed()` and so that the control is already in place before any measurement is. PRIVACY.md
 * documents any such feature first. The sound choice is read by `sound.ts` every time a cue is about to
 * play; it is never inferred from the browser or the operating system (not even from a reduced-motion
 * setting), so there is no sound until the player asks for it on Settings.
 *
 * The choices live in localStorage under `mergescape.consent` as `{ analytics, sound, updatedAt }` and are
 * written only when the visitor changes one. `updatedAt` dates the analytics choice, which is the one the
 * Cookies page reports. Every storage access is guarded: private windows and blocked site data throw, and
 * then the choice simply is not remembered (and stays off after a reload).
 *
 * The store re-reads storage whenever it gains its first subscriber, so what is stored is what counts: a choice
 * that could not be saved lasts only while a screen is watching it, and `analyticsAllowed()` never says yes
 * for something that is not on the device.
 *
 * `consent` follows the Svelte store contract, so a component can write `$consent.analytics`, and plain
 * TypeScript can call `consent.subscribe` or `analyticsAllowed()`.
 */
import { get, writable } from 'svelte/store';
import type { Readable } from 'svelte/store';
import { TOKEN_KEY } from './api';

export const CONSENT_KEY = 'mergescape.consent';

/** Every key the app owns shares this prefix; "Clear local data" removes all of them. */
export const STORAGE_PREFIX = 'mergescape.';

export interface Consent {
  /** May first-party analytics run? Off until the visitor says yes. */
  analytics: boolean;
  /** May the game play its short synthesised cues? Off until the player turns sound on in Settings. */
  sound: boolean;
  /** When the visitor last changed the analytics choice (ISO 8601), or null if they never did. */
  updatedAt: string | null;
}

export const DEFAULT_CONSENT: Readonly<Consent> = Object.freeze({
  analytics: false,
  sound: false,
  updatedAt: null,
});

function defaultStorage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

/**
 * Reads a stored value back into a `Consent`. Anything that is not exactly the expected shape (bad JSON,
 * a number, extra junk) is treated as "never chose", so a damaged or hand-edited value can only ever
 * leave analytics and sound off. Only a literal `true` switches either on.
 */
export function parseConsent(raw: string | null | undefined): Consent {
  if (!raw) {
    return { ...DEFAULT_CONSENT };
  }
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) {
      return { ...DEFAULT_CONSENT };
    }
    const { analytics, sound, updatedAt } = value as Record<string, unknown>;
    return {
      analytics: analytics === true,
      sound: sound === true,
      updatedAt: typeof updatedAt === 'string' ? updatedAt : null,
    };
  } catch {
    return { ...DEFAULT_CONSENT };
  }
}

export interface ConsentStore extends Readable<Consent> {
  /**
   * Record the visitor's choice. The in-memory value always changes; the return value says whether it
   * could also be saved on this device.
   */
  setAnalytics(allowed: boolean): boolean;
  /** Record whether the game may play sound; same return value as `setAnalytics`. Leaves the analytics choice alone. */
  setSound(allowed: boolean): boolean;
  /** Forget every choice: remove the stored value and go back to the default (analytics and sound off). */
  reset(): void;
}

export function createConsentStore(
  getStorage: () => Storage | undefined = defaultStorage,
  now: () => Date = () => new Date(),
): ConsentStore {
  function load(): Consent {
    try {
      return parseConsent(getStorage()?.getItem(CONSENT_KEY));
    } catch {
      return { ...DEFAULT_CONSENT };
    }
  }

  // Re-read the stored value whenever the first subscriber arrives, so a screen opened after another tab
  // (or "Clear local data") changed it always starts from what is really stored.
  const store = writable<Consent>(load(), (set) => {
    set(load());
  });

  /** Make `next` the choice for the screens watching, and try to keep it on this device. */
  function save(next: Consent): boolean {
    store.set(next);
    try {
      const storage = getStorage();
      storage?.setItem(CONSENT_KEY, JSON.stringify(next));
      return storage !== undefined;
    } catch {
      return false;
    }
  }

  return {
    subscribe: store.subscribe,
    setAnalytics(allowed) {
      return save({ ...get(store), analytics: allowed, updatedAt: now().toISOString() });
    },
    setSound(allowed) {
      return save({ ...get(store), sound: allowed });
    },
    reset() {
      store.set({ ...DEFAULT_CONSENT });
      try {
        getStorage()?.removeItem(CONSENT_KEY);
      } catch {
        // Nothing stored, or storage is blocked: the default applies either way.
      }
    },
  };
}

/** The app's one consent store. */
export const consent: ConsentStore = createConsentStore();

/** May first-party analytics run right now? `false` unless the visitor opted in. */
export function analyticsAllowed(): boolean {
  return get(consent).analytics;
}

/** Has the player turned sound on? `false` unless they did, in Settings, on this device. */
export function soundAllowed(): boolean {
  return get(consent).sound;
}

/**
 * Removes every local-storage item this app owns: all keys starting with `mergescape.` plus the session
 * token (which has that prefix too; it is listed so renaming either cannot leave it behind). Returns the
 * keys that were removed. Never throws: blocked storage just removes nothing.
 */
export function clearLocalData(getStorage: () => Storage | undefined = defaultStorage): string[] {
  const removed: string[] = [];
  const storage = getStorage();
  if (!storage) {
    return removed;
  }
  // One guarded step per key, so a failure on one cannot leave the others behind.
  const drop = (key: string): void => {
    try {
      if (storage.getItem(key) !== null) {
        storage.removeItem(key);
        removed.push(key);
      }
    } catch {
      // Blocked storage: there is nothing this page can remove.
    }
  };
  // The two keys the app knows by name go first, then anything else under the prefix.
  drop(TOKEN_KEY);
  drop(CONSENT_KEY);
  const others: string[] = [];
  try {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key?.startsWith(STORAGE_PREFIX) && key !== TOKEN_KEY && key !== CONSENT_KEY) {
        others.push(key);
      }
    }
  } catch {
    // The keys cannot be listed; the named ones above were still removed.
  }
  others.forEach(drop);
  return removed;
}

/**
 * The one place the app reloads the page, so a test can replace it (jsdom cannot navigate). Sign out in
 * `main.ts` does the same by hand.
 */
export const pageControls = {
  reload(): void {
    window.location.reload();
  },
};
