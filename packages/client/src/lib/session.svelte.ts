/**
 * The signed-in session: the three reads (`/me`, `/log`, `/installations`), pagination, and the small
 * amount of "something just happened" state the moment loop needs (a fresh Combat Log row for the score
 * ticker, a level-up for the flash). Reads only; the client has no write calls in task 9.
 *
 * Polling: while the tab is visible the first log page and the profile are re-read every `pollMs`, and
 * once more whenever the tab becomes visible again. That is how a real merge shows up within seconds
 * without a websocket; the interval is the one knob to turn if request volume ever matters.
 */
import { levelFor } from '@mergescape/shared';
import type { Skill } from '@mergescape/shared';
import { ApiError } from './api';
import { unseenEntries } from './log';
import type { Api } from './api';
import { gearTierFor } from './sprites';
import type { GearTierName } from './sprites';
import type { InstallationSummary, LogEntry, MeResponse } from './types';

export type SessionStatus = 'loading' | 'ready' | 'signed-out' | 'error';

export interface LevelUp {
  /** Distinct per level-up so the flash restarts even for back-to-back level-ups. */
  id: number;
  level: number;
  from: number;
  /** The skill of the row that caused it, when known. */
  skill: Skill | null;
  /** Set when the new level crosses into a new gear tier. */
  newTier: GearTierName | null;
}

export interface SessionOptions {
  /** Poll interval in ms while the tab is visible. 0 turns polling off. Default 30,000. */
  pollMs?: number;
  /** Called once when the api rejects the token (HTTP 401). */
  onUnauthorized?: () => void;
}

export const DEFAULT_POLL_MS = 30_000;

export class Session {
  status = $state<SessionStatus>('loading');
  /** Shown on the error panel; set with status `error`. */
  error = $state<string | null>(null);
  /** True when the api rejected a stored token: Landing says the session ended. */
  expired = $state(false);
  me = $state.raw<MeResponse | null>(null);
  installations = $state.raw<InstallationSummary[]>([]);
  /** Combat Log rows loaded so far, newest first. */
  entries = $state.raw<LogEntry[]>([]);
  /** Cursor for the next older page, or null when everything is loaded. */
  nextCursor = $state<string | null>(null);
  loadingMore = $state(false);
  /** Set when loading an older page failed; the rows already loaded stay on screen. */
  loadMoreError = $state<string | null>(null);
  /** The newest row that arrived after the first load; the score ticker plays for it. */
  fresh = $state.raw<LogEntry | null>(null);
  levelUp = $state.raw<LevelUp | null>(null);
  /** Clock for relative times; moves forward on every refresh. */
  now = $state(Date.now());

  readonly #api: Api | null;
  readonly #options: SessionOptions;
  #refreshing = false;
  #levelUpCount = 0;

  /** `api` null means there is no token: the session starts (and stays) signed out. */
  constructor(api: Api | null, options: SessionOptions = {}) {
    this.#api = api;
    this.#options = options;
  }

  /** The most recent scored row, for Town's last-kill panel. */
  get lastEntry(): LogEntry | null {
    return this.entries[0] ?? null;
  }

  async load(): Promise<void> {
    const api = this.#api;
    if (!api) {
      this.status = 'signed-out';
      return;
    }
    this.status = 'loading';
    this.error = null;
    try {
      const [me, log, installations] = await Promise.all([
        api.me(),
        api.log(null),
        api.installations(),
      ]);
      this.me = me;
      this.entries = log.entries;
      this.nextCursor = log.nextCursor;
      this.installations = installations.installations;
      this.fresh = null;
      this.now = Date.now();
      this.status = 'ready';
    } catch (error) {
      this.#fail(error);
    }
  }

  /** Re-read the profile and the first log page; rows not seen before become `fresh`. */
  async refresh(): Promise<void> {
    const api = this.#api;
    if (!api || this.status !== 'ready' || this.#refreshing) {
      return;
    }
    this.#refreshing = true;
    try {
      const needInstallations = this.installations.length === 0;
      const [me, log, installations] = await Promise.all([
        api.me(),
        api.log(null),
        needInstallations ? api.installations() : Promise.resolve(null),
      ]);
      const arrived = unseenEntries(this.entries, log.entries);
      const before = this.me ? levelFor(this.me.xp) : levelFor(me.xp);
      this.me = me;
      if (installations) {
        this.installations = installations.installations;
      }
      if (arrived.length > 0) {
        this.entries = [...arrived, ...this.entries];
        this.fresh = arrived[0] ?? null;
      }
      const after = levelFor(me.xp);
      if (after > before) {
        this.levelUp = {
          id: ++this.#levelUpCount,
          level: after,
          from: before,
          skill: arrived[0]?.skill ?? null,
          newTier:
            gearTierFor(after).tier !== gearTierFor(before).tier ? gearTierFor(after).tier : null,
        };
      }
      this.now = Date.now();
    } catch (error) {
      // A failed background refresh keeps what is on screen; only a rejected token ends the session.
      if (error instanceof ApiError && error.status === 401) {
        this.#fail(error);
      }
    } finally {
      this.#refreshing = false;
    }
  }

  /** Load the next older page of the Combat Log. */
  async loadMore(): Promise<void> {
    const api = this.#api;
    if (!api || this.loadingMore || this.nextCursor === null) {
      return;
    }
    this.loadingMore = true;
    this.loadMoreError = null;
    try {
      const page = await api.log(this.nextCursor);
      this.entries = [...this.entries, ...unseenEntries(this.entries, page.entries)];
      this.nextCursor = page.nextCursor;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        this.#fail(error);
      } else {
        this.loadMoreError = 'Could not load older entries.';
      }
    } finally {
      this.loadingMore = false;
    }
  }

  dismissLevelUp(): void {
    this.levelUp = null;
  }

  /**
   * Start background polling. Returns the function that stops it. A no-op (returning a no-op) when
   * polling is off or there is no document.
   */
  startPolling(): () => void {
    const pollMs = this.#options.pollMs ?? DEFAULT_POLL_MS;
    if (pollMs <= 0 || typeof document === 'undefined') {
      return () => {};
    }
    const tick = () => {
      if (document.visibilityState === 'visible') {
        void this.refresh();
      }
    };
    const timer = setInterval(tick, pollMs);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
    };
  }

  #fail(error: unknown): void {
    if (error instanceof ApiError && error.status === 401) {
      this.expired = true;
      this.status = 'signed-out';
      this.#options.onUnauthorized?.();
      return;
    }
    this.error = error instanceof Error ? error.message : 'Something went wrong.';
    this.status = 'error';
  }
}
