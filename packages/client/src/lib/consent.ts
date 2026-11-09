/**
 * The visitor's analytics choice, and the "clear local data" action behind the Cookies page.
 *
 * Mergescape is opt-in: `analytics` is `false` until the visitor switches it on (game-design.md section 12,
 * design.md section 14). Today nothing reads the choice, because there are no analytics. It exists so that
 * a first-party analytics package can ask `analyticsAllowed()` and so that the control is already in
 * place before any measurement is. PRIVACY.md documents any such feature first.
 *
 * The choice lives in localStorage under `mergescape.consent` as `{ analytics, updatedAt }` and is written
 * only when the visitor changes it. Every storage access is guarded: private windows and blocked site data
 * throw, and then the choice simply is not remembered (and stays off after a reload).
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
  /** When the visitor last changed the choice (ISO 8601), or null if they never did. */
  updatedAt: string | null;
}

export const DEFAULT_CONSENT: Readonly<Consent> = Object.freeze({
  analytics: false,
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
 * leave analytics off. Only a literal `true` switches it on.
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
    const { analytics, updatedAt } = value as Record<string, unknown>;
    return {
      analytics: analytics === true,
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
  /** Forget the choice: remove the stored value and go back to the default (analytics off). */
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

  return {
    subscribe: store.subscribe,
    setAnalytics(allowed) {
      const next: Consent = { analytics: allowed, updatedAt: now().toISOString() };
      store.set(next);
      try {
        const storage = getStorage();
        storage?.setItem(CONSENT_KEY, JSON.stringify(next));
        return storage !== undefined;
      } catch {
        return false;
      }
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
