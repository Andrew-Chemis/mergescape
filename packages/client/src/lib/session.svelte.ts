/**
 * The signed-in session: the reads (`/me`, `/log`, `/installations`, `/week`), pagination, the small
 * amount of "something just happened" state the moment loop needs (a fresh Combat Log row for the score
 * ticker, a level-up for the flash), and the player's few writes (shop, shrine, Pledge plays, export,
 * delete).
 *
 * A write answers with the new profile and run (docs/api-contract.md), which replace `me` and `week`
 * here; nothing is re-fetched. A read that was already in flight when a write started is discarded when
 * it lands, so an older answer can never overwrite a newer one.
 *
 * Polling: while the tab is visible the first log page and the profile are re-read every `pollMs`, and
 * once more whenever the tab becomes visible again. That is how a real merge shows up within seconds
 * without a websocket; the interval is the one knob to turn if request volume ever matters.
 */
import { levelFor } from '@mergescape/shared';
import type { Skill } from '@mergescape/shared';
import { ApiError } from './api';
import { describeError } from './errors';
import type { ActionResult } from './errors';
import { unseenEntries } from './log';
import type { Api, MutationOptions, ShopBuyInput, ShopPickInput } from './api';
import { gearTierFor } from './sprites';
import type { GearTierName } from './sprites';
import type {
  InstallationSummary,
  LogEntry,
  MeResponse,
  MutationResponse,
  WeekSummary,
} from './types';

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
  /** The current run. Always the same object as `me.week` unless a newer `GET /week` has landed. */
  week = $state.raw<WeekSummary | null>(null);
  /** The scope of the write in flight (`charm:0`, `reroll`, `pledge:strike`, ...), or null. */
  busy = $state<string | null>(null);
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
  /** Bumped whenever a write starts or ends: a read that began under another epoch is stale. */
  #epoch = 0;
  #writes = 0;
  /** Request ids of writes that ended in a network failure, by scope, to replay on the next try. */
  #pending: Record<string, string> = {};

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
      this.week = me.week ?? null;
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
    const epoch = this.#epoch;
    try {
      const needInstallations = this.installations.length === 0;
      const [me, log, installations] = await Promise.all([
        api.me(),
        api.log(null),
        needInstallations ? api.installations() : Promise.resolve(null),
      ]);
      const arrived = unseenEntries(this.entries, log.entries);
      // A write that started or finished while this read was in the air has newer state than it.
      const stale = epoch !== this.#epoch || this.#writes > 0;
      const before = this.me ? levelFor(this.me.xp) : levelFor(me.xp);
      if (!stale) {
        this.me = me;
        this.week = me.week ?? null;
      }
      if (installations) {
        this.installations = installations.installations;
      }
      if (arrived.length > 0) {
        this.entries = [...arrived, ...this.entries];
        this.fresh = arrived[0] ?? null;
      }
      const after = stale ? before : levelFor(me.xp);
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

  /**
   * Load older Combat Log pages until the oldest row loaded is before `sinceMs` (or the log runs out, or
   * `maxPages` pages were read). The Run Map uses it to find every kill since Monday.
   */
  async loadSince(sinceMs: number, maxPages = 10): Promise<void> {
    for (let pages = 0; pages < maxPages; pages += 1) {
      const oldest = this.entries[this.entries.length - 1];
      if (this.nextCursor === null || (oldest && Date.parse(oldest.at) < sinceMs)) {
        return;
      }
      await this.loadMore();
      if (this.loadMoreError) {
        return;
      }
    }
  }

  dismissLevelUp(): void {
    this.levelUp = null;
  }

  // -------------------------------------------------------------------------------------------
  // The run: re-reads and writes
  // -------------------------------------------------------------------------------------------

  /** `GET /week`: the Shop and the Run Map call it when they open, so a shop that just opened shows. */
  async refreshWeek(): Promise<void> {
    const api = this.#api;
    if (!api || this.status !== 'ready') {
      return;
    }
    const epoch = this.#epoch;
    try {
      const week = await api.getWeek();
      if (epoch !== this.#epoch || this.#writes > 0) {
        return;
      }
      this.#adopt(week);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        this.#fail(error);
      }
      // Any other failure keeps the run already on screen.
    }
  }

  /** `POST /shop/buy`. `scope` names the control, e.g. `charm:0`, for its inline error. */
  shopBuy(scope: string, input: ShopBuyInput): Promise<ActionResult> {
    return this.#write(scope, (api, options) => api.shopBuy(input, options));
  }

  /** `POST /shop/pick`; index -1 is the free Raid pack. */
  shopPick(scope: string, input: ShopPickInput): Promise<ActionResult> {
    return this.#write(scope, (api, options) => api.shopPick(input, options));
  }

  shopReroll(scope = 'reroll'): Promise<ActionResult> {
    return this.#write(scope, (api, options) => api.shopReroll(options));
  }

  shopSell(scope: string, charmId: string): Promise<ActionResult> {
    return this.#write(scope, (api, options) => api.shopSell(charmId, options));
  }

  shrineRemove(scope: string, pledgeId: string): Promise<ActionResult> {
    return this.#write(scope, (api, options) => api.shrineRemove(pledgeId, options));
  }

  pledgePlay(scope: string, pledgeId: string): Promise<ActionResult> {
    return this.#write(scope, (api, options) => api.pledgePlay(pledgeId, options));
  }

  /** `GET /export`: the player's data as parsed JSON. */
  async exportData(): Promise<ActionResult & { data?: Record<string, unknown> }> {
    const api = this.#api;
    if (!api) {
      return { ok: false, status: 0, code: null, message: 'You are signed out.' };
    }
    try {
      return { ok: true, data: await api.exportData() };
    } catch (error) {
      return this.#failure(error);
    }
  }

  /** `POST /delete`. Resolves ok on 204; a wrong login comes back as `confirm_mismatch` (400). */
  async deleteEverything(confirmLogin: string): Promise<ActionResult> {
    const scope = 'delete';
    const api = this.#api;
    if (!api) {
      return { ok: false, status: 0, code: null, message: 'You are signed out.' };
    }
    this.busy = scope;
    try {
      await api.deleteAccount(confirmLogin, this.#replay(scope));
      this.#pending = {};
      return { ok: true };
    } catch (error) {
      this.#remember(scope, error);
      return this.#failure(error);
    } finally {
      this.busy = null;
    }
  }

  /** Run one write: one at a time, replay a failed attempt's request id, adopt the answer. */
  async #write(
    scope: string,
    call: (api: Api, options: MutationOptions) => Promise<MutationResponse>,
  ): Promise<ActionResult> {
    const api = this.#api;
    if (!api) {
      return { ok: false, status: 0, code: null, message: 'You are signed out.' };
    }
    if (this.busy !== null) {
      return { ok: false, status: 0, code: 'busy', message: 'One moment, still working.' };
    }
    this.busy = scope;
    this.#writes += 1;
    this.#epoch += 1;
    let result: ActionResult;
    try {
      const answer = await call(api, this.#replay(scope));
      this.#pending = {};
      this.me = { ...answer.me, week: answer.week };
      this.week = answer.week;
      this.now = Date.now();
      result = { ok: true };
    } catch (error) {
      this.#remember(scope, error);
      result = this.#failure(error);
    } finally {
      this.#writes -= 1;
      this.#epoch += 1;
      this.busy = null;
    }
    if (!result.ok && result.status === 409) {
      // The shop or the hand changed under the player: bring the screen up to date, keep the message.
      void this.#resync();
    }
    return result;
  }

  /** The request id of an earlier attempt at this same action that died on the network, if any. */
  #replay(scope: string): MutationOptions {
    const requestId = this.#pending[scope];
    return requestId === undefined ? {} : { requestId };
  }

  #remember(scope: string, error: unknown): void {
    if (error instanceof ApiError && error.status === 0 && error.requestId) {
      this.#pending[scope] = error.requestId;
    } else {
      delete this.#pending[scope];
    }
  }

  #failure(error: unknown): ActionResult & { ok: false } {
    if (error instanceof ApiError && error.status === 401) {
      this.#fail(error);
    }
    return {
      ok: false,
      status: error instanceof ApiError ? error.status : 0,
      code: error instanceof ApiError ? error.code : null,
      message: describeError(error),
    };
  }

  /** Re-read the profile (it carries the run) after a 409. */
  async #resync(): Promise<void> {
    const api = this.#api;
    if (!api) {
      return;
    }
    const epoch = this.#epoch;
    try {
      const me = await api.me();
      if (epoch !== this.#epoch || this.#writes > 0) {
        return;
      }
      this.me = me;
      this.week = me.week ?? null;
      this.now = Date.now();
    } catch {
      // The message already on screen stands; the next poll catches up.
    }
  }

  /** Take a fresher run: it replaces `week`, and `me.week` follows so Town and the Shop agree. */
  #adopt(week: WeekSummary): void {
    this.week = week;
    if (this.me) {
      this.me = { ...this.me, week };
    }
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
    if (error instanceof ApiError && error.code === 'no_profile') {
      // A valid token whose character is gone (deleted): say so, in words.
      this.error = describeError(error);
    } else {
      this.error = error instanceof Error ? error.message : 'Something went wrong.';
    }
    this.status = 'error';
  }
}
