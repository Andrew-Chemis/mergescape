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
 * The depth layer (expeditions, the Forge, gear, Feats) follows the same rule. Its writes answer with the
 * new profile, which replaces `me`; the `expedition` and `forge` slices (the views of `GET /expedition`
 * and `GET /forge`) are rebuilt from that profile, so a screen never shows a stale cost or a timer that
 * has not started. The `feats` slice is re-read after a collect that unlocked something.
 *
 * Polling: while the tab is visible the first log page and the profile are re-read every `pollMs`, and
 * once more whenever the tab becomes visible again. That is how a real merge shows up within seconds
 * without a websocket; the interval is the one knob to turn if request volume ever matters. A burst of
 * more rows than one page holds is followed page by page, so the list never has a hole in it.
 *
 * A write that died on the network is replayed with the same request id when the player tries the very
 * same thing again soon after (see `REPLAY_WINDOW_MS`); a different request never inherits that id.
 */
import { isRecord, levelFor } from '@mergescape/shared';
import { SvelteSet } from 'svelte/reactivity';
import type { Charm, ExpeditionState, GearPiece, LootItem, Skill } from '@mergescape/shared';
import { ApiError } from './api';
import { expeditionStatusOf, expeditionViewFrom, forgeViewFrom } from './depth';
import { describeError } from './errors';
import type { ActionResult } from './errors';
import { unseenEntries } from './log';
import type {
  Api,
  ExpeditionSendInput,
  ForgeStartInput,
  MutationOptions,
  PackOpenInput,
  ShopBuyInput,
  ShopPickInput,
} from './api';
import { playCue } from './sound';
import { gearTierFor } from './sprites';
import type { GearTierName } from './sprites';
import type {
  EquipInput,
  ExpeditionView,
  FeatView,
  ForgeView,
  InstallationSummary,
  LogEntry,
  LogResponse,
  MeResponse,
  Station,
  UpgradeInput,
  WeekSummary,
} from './types';

/** What a write answered with: the new profile, and the run when the endpoint sends it (the shop does). */
interface Answer {
  me: MeResponse;
  week?: WeekSummary;
}

/** What `POST /expedition/collect` answered, for the loot reveal. */
export interface CollectOutcome {
  expedition: ExpeditionState;
  loot: LootItem[];
  /** False on a replay: the loot was granted the first time and nothing was granted again. */
  applied: boolean;
  featsUnlocked: string[];
}

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
  /**
   * Called when the stored token can no longer be used and should be forgotten: the api rejected it (HTTP
   * 401), or its character is gone (404 `no_profile`, which is what a deleted account answers).
   */
  onUnauthorized?: () => void;
}

export const DEFAULT_POLL_MS = 30_000;

/**
 * How long after a write died on the network the player's repeat of it still reuses its request id. The
 * api answers a repeated id with the first response, which is exactly right for a retry of a lost reply and
 * exactly wrong for a new decision made minutes later, so the id is not kept for long.
 */
export const REPLAY_WINDOW_MS = 120_000;

/** Pages the poll follows when every row of the newest page is new (a burst longer than one page). */
export const POLL_MAX_PAGES = 5;

/** `value` as JSON with the keys of every object in order, so equal inputs give equal text. */
function stableJson(value: unknown): string {
  const sorted = (_key: string, inner: unknown): unknown =>
    isRecord(inner)
      ? Object.fromEntries(Object.entries(inner).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : inner;
  return JSON.stringify(value, sorted) ?? 'null';
}

/** What a request that died on the network left behind, to replay it. */
interface Remembered {
  requestId: string;
  at: number;
  /** The profile the player was looking at; once a fresh read differs, the state moved on. */
  me: string;
}

/** New Combat Log rows found by a poll; see `Session.#newRows`. */
interface NewRows {
  rows: LogEntry[];
  /** Set when the rows do not meet the list on screen: the cursor to read older entries from. */
  resumeFrom: string | null;
}

/** Why a read or write ended the session: the token was rejected, or its character is gone. */
function sessionEnd(error: unknown): 'expired' | 'deleted' | null {
  if (!(error instanceof ApiError)) {
    return null;
  }
  if (error.status === 401) {
    return 'expired';
  }
  return error.code === 'no_profile' ? 'deleted' : null;
}

/** A request the api turned down, or never saw: the `ActionResult` a control shows beside itself. */
type Refused = ActionResult & { ok: false };

/** What every read and write answers when there is no session to ask. */
const SIGNED_OUT: Refused = Object.freeze({
  ok: false,
  status: 0,
  code: null,
  message: 'You are signed out.',
});

export class Session {
  status = $state<SessionStatus>('loading');
  /** Shown on the error panel; set with status `error`. */
  error = $state<string | null>(null);
  /** True when the api rejected a stored token: Landing says the session ended. */
  expired = $state(false);
  /** True when the character is gone (deleted here or elsewhere): Landing says so and offers a fresh start. */
  deleted = $state(false);
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
  /** `GET /expedition`: regions with their gates, the five ways to go out, the latest trip. Null until loaded. */
  expedition = $state.raw<ExpeditionView | null>(null);
  /** `GET /forge`: the three stations, their recipes and upgrades. Null until loaded. */
  forge = $state.raw<ForgeView | null>(null);
  /** `GET /feats`: every Feat the player can see. Null until loaded. */
  feats = $state.raw<FeatView[] | null>(null);
  /** Feats unlocked since the player last dismissed the banner on Town; persists until dismissed. */
  pendingFeats = $state.raw<string[]>([]);

  readonly #api: Api | null;
  readonly #options: SessionOptions;
  #refreshing = false;
  #levelUpCount = 0;
  /** Bumped whenever a write starts or ends: a read that began under another epoch is stale. */
  #epoch = 0;
  #writes = 0;
  /**
   * Request ids of writes that ended in a network failure, to replay on the next try. The key is the control
   * (`scope`) and the exact input it sent, so only the same request reuses an id, never the next different one.
   */
  #pending: Record<string, Remembered> = {};
  /**
   * Feat ids the player has seen unlock; the banner shows what is unlocked and not in here. Kept in memory
   * only: the Cookies page promises three storage keys, and the contract has no "seen" flag to read back.
   */
  #seenFeats: string[] | null = null;
  /** Feats a collect just reported unlocked, shown even before the list has been read again. */
  readonly #justUnlocked = new SvelteSet<string>();

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
      this.#adoptMe(me);
      this.entries = log.entries;
      this.nextCursor = log.nextCursor;
      this.installations = installations.installations;
      this.fresh = null;
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
      // Older pages are read too when the whole newest page is new; if that read fails, the log keeps
      // what it has and the next poll tries again.
      let burst: NewRows | null = null;
      try {
        burst = await this.#newRows(api, log);
      } catch (error) {
        this.#quiet(error);
      }
      const arrived = burst ? unseenEntries(this.entries, burst.rows) : [];
      // A write that started or finished while this read was in the air has newer state than it.
      const stale = epoch !== this.#epoch || this.#writes > 0;
      const before = this.me ? levelFor(this.me.xp) : levelFor(me.xp);
      if (!stale) {
        const earlier = this.week;
        const away = this.me ? expeditionStatusOf(this.me.expedition, this.now) === 'away' : false;
        this.#adoptMe(me);
        // Two moments that happen while the tab is open and have no screen of their own: an act clearing
        // (a further act cleared in the same week) and the character coming home. Cues are opt-in.
        const later = me.week;
        if (
          earlier &&
          later &&
          earlier.weekKey === later.weekKey &&
          later.clearedActs.length > earlier.clearedActs.length
        ) {
          playCue('actClear');
        }
        if (away && expeditionStatusOf(me.expedition, Date.now()) === 'returned') {
          playCue('expeditionReturn');
        }
      }
      if (installations) {
        this.installations = installations.installations;
      }
      if (arrived.length > 0) {
        if (burst?.resumeFrom != null) {
          // The burst outran the pages read: keeping the old list would leave a hole between it and the
          // new rows, so start the list over and let "older entries" pick up from where the burst ends.
          this.entries = arrived;
          this.nextCursor = burst.resumeFrom;
        } else {
          this.entries = [...arrived, ...this.entries];
        }
        this.fresh = arrived[0] ?? null;
        // A scored event is when a Feat can unlock: read the list again if anyone is looking at it.
        if (this.feats !== null) {
          void this.loadFeats();
        }
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
      if (stale) {
        // Adopting a profile moves the clock; a stale answer still counts as a refresh.
        this.now = Date.now();
      }
    } catch (error) {
      this.#quiet(error);
    } finally {
      this.#refreshing = false;
    }
  }

  /**
   * The Combat Log rows that arrived since the list on screen was read. The poll asks for the newest page
   * only; when every row of it is new there may be more behind it, so follow the cursor until a row that is
   * already on screen shows up (at most `POLL_MAX_PAGES` pages). `resumeFrom` is set when that limit was
   * reached with no known row in sight: the cursor to continue from, because the rows do not meet the list.
   */
  async #newRows(api: Api, first: LogResponse): Promise<NewRows> {
    const rows: LogEntry[] = [];
    let page = first;
    for (let pages = 1; ; pages += 1) {
      const fresh = unseenEntries([...this.entries, ...rows], page.entries);
      rows.push(...fresh);
      const allNew = page.entries.length > 0 && fresh.length === page.entries.length;
      if (!allNew || page.nextCursor === null) {
        return { rows, resumeFrom: null };
      }
      if (pages >= POLL_MAX_PAGES) {
        return { rows, resumeFrom: page.nextCursor };
      }
      page = await api.log(page.nextCursor);
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
      if (sessionEnd(error)) {
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
  refreshWeek(): Promise<void> {
    return this.#loadSlice(
      (api) => api.getWeek(),
      (week) => this.#adopt(week),
    );
  }

  /** `POST /shop/buy`. `scope` names the control, e.g. `charm:0`, for its inline error. */
  shopBuy(scope: string, input: ShopBuyInput): Promise<ActionResult> {
    return this.#write(scope, input, async (api, options) => {
      const answer = await api.shopBuy(input, options);
      // The server took the purchase: the coin sounds (opt-in) before the screen catches up.
      playCue('purchase');
      return answer;
    });
  }

  /** `POST /shop/pick`; index -1 is the free Raid pack. */
  shopPick(scope: string, input: ShopPickInput): Promise<ActionResult> {
    return this.#write(scope, input, (api, options) => api.shopPick(input, options));
  }

  shopReroll(scope = 'reroll'): Promise<ActionResult> {
    return this.#write(scope, null, (api, options) => api.shopReroll(options));
  }

  shopSell(scope: string, charmId: string): Promise<ActionResult> {
    return this.#write(scope, { charmId }, (api, options) => api.shopSell(charmId, options));
  }

  shrineRemove(scope: string, pledgeId: string): Promise<ActionResult> {
    return this.#write(scope, { pledgeId }, (api, options) => api.shrineRemove(pledgeId, options));
  }

  pledgePlay(scope: string, pledgeId: string): Promise<ActionResult> {
    return this.#write(scope, { pledgeId }, (api, options) => api.pledgePlay(pledgeId, options));
  }

  // -------------------------------------------------------------------------------------------
  // The depth layer: reads
  // -------------------------------------------------------------------------------------------

  /** `GET /expedition`: the Expedition screen calls it when it opens. */
  loadExpedition(): Promise<void> {
    return this.#loadSlice(
      (api) => api.expedition(),
      (view) => {
        this.expedition = view;
      },
    );
  }

  /** `GET /forge`: the Forge screen calls it when it opens. */
  loadForge(): Promise<void> {
    return this.#loadSlice(
      (api) => api.forge(),
      (view) => {
        this.forge = view;
      },
    );
  }

  /** `GET /feats`: the Feats screen and Town call it. What it finds new becomes the Town banner. */
  loadFeats(): Promise<void> {
    return this.#loadSlice(
      (api) => api.feats(),
      ({ feats }) => {
        this.feats = feats;
        this.#sync();
        this.#watchFeats();
      },
    );
  }

  /**
   * One background read of a slice of the session: nothing unless the session is ready, and the answer is
   * dropped when a write started or ended while it was in the air (see `#epoch`).
   */
  async #loadSlice<T>(read: (api: Api) => Promise<T>, apply: (value: T) => void): Promise<void> {
    const api = this.#api;
    if (!api || this.status !== 'ready') {
      return;
    }
    const epoch = this.#epoch;
    try {
      const value = await read(api);
      if (epoch === this.#epoch && this.#writes === 0) {
        apply(value);
      }
    } catch (error) {
      this.#quiet(error);
    }
  }

  /** A failed background read keeps what is on screen; only a rejected token or a lost character ends the session. */
  #quiet(error: unknown): void {
    if (sessionEnd(error)) {
      this.#fail(error);
    }
  }

  /**
   * Decide which unlocked Feats are news. The first list this page load reads sets the baseline: what is
   * already unlocked counts as seen, so a reload brings no banner for old Feats. After that, a Feat that
   * unlocks (a scored event while the tab is open, or a collect) is pending until the player dismisses
   * the banner; it survives navigation and polling, not a reload.
   */
  #watchFeats(): void {
    const listed = this.feats;
    const unlocked = listed?.filter((feat) => feat.unlocked).map((feat) => feat.id) ?? [];
    if (listed) {
      this.#seenFeats ??= unlocked;
    }
    const seen = this.#seenFeats ?? [];
    const news = unlocked.filter((id) => !seen.includes(id) || this.#justUnlocked.has(id));
    // A collect's Feats are news before the list has been read again to say so.
    for (const id of this.#justUnlocked) {
      if (!news.includes(id)) {
        news.push(id);
      }
    }
    this.pendingFeats = news;
  }

  /** Dismiss the Feat unlock banner: what it announced is seen. */
  dismissFeatBanner(): void {
    this.#seenFeats = [...(this.#seenFeats ?? []), ...this.pendingFeats];
    this.#justUnlocked.clear();
    this.pendingFeats = [];
  }

  // -------------------------------------------------------------------------------------------
  // The depth layer: writes
  // -------------------------------------------------------------------------------------------

  /** `POST /expedition/send`. `scope` names the control, e.g. `send`, for its inline error. */
  expeditionSend(scope: string, input: ExpeditionSendInput): Promise<ActionResult> {
    return this.#write(scope, input, (api, options) => api.expeditionSend(input, options));
  }

  /** `POST /expedition/collect`. On success `collect` is the loot, for the reveal. */
  async expeditionCollect(scope = 'collect'): Promise<ActionResult & { collect?: CollectOutcome }> {
    const { result, answer } = await this.#mutate(scope, null, (api, options) =>
      api.expeditionCollect(options),
    );
    if (!result.ok || !answer) {
      return result;
    }
    const collect: CollectOutcome = {
      expedition: answer.expedition,
      loot: answer.loot,
      applied: answer.applied,
      featsUnlocked: answer.featsUnlocked,
    };
    if (answer.featsUnlocked.length > 0) {
      // The banner does not wait for the list to be read again.
      for (const id of answer.featsUnlocked) {
        this.#justUnlocked.add(id);
      }
      this.#watchFeats();
      void this.loadFeats();
    }
    return { ...result, collect };
  }

  /** `GET /packs/:seed`: the three Charms in an unopened loot pack. */
  packOptions(seed: number): Promise<ActionResult & { options?: Charm[] }> {
    return this.#read(async (api) => ({
      ok: true as const,
      options: (await api.packOptions(seed)).options,
    }));
  }

  /** `POST /packs/open`: keep one of the pack's three Charms. */
  packOpen(scope: string, input: PackOpenInput): Promise<ActionResult> {
    return this.#write(scope, input, (api, options) => api.packOpen(input, options));
  }

  /** `POST /forge/start` */
  forgeStart(scope: string, input: ForgeStartInput): Promise<ActionResult> {
    return this.#write(scope, input, (api, options) => api.forgeStart(input, options));
  }

  /** `POST /forge/collect`. On success `piece` is what the order made, and `applied` is false on a replay. */
  async forgeCollect(
    scope: string,
    station: Station,
  ): Promise<ActionResult & { piece?: GearPiece | null; applied?: boolean }> {
    const { result, answer } = await this.#mutate(scope, { station }, (api, options) =>
      api.forgeCollect(station, options),
    );
    return result.ok && answer
      ? { ...result, piece: answer.piece, applied: answer.applied }
      : result;
  }

  /** `POST /forge/upgrade`: buy Bellows, Dyes or Index, or choose a cape colour. */
  forgeUpgrade(scope: string, input: UpgradeInput): Promise<ActionResult> {
    return this.#write(scope, input, (api, options) => api.forgeUpgrade(input, options));
  }

  /** `POST /gear/equip`: wear a piece, take a slot off, or choose the pet that follows you. */
  gearEquip(scope: string, input: EquipInput): Promise<ActionResult> {
    return this.#write(scope, input, (api, options) => api.gearEquip(input, options));
  }

  /** `POST /feats/pin`: pin an unlocked Feat to the Character screen and the badge (up to three), or unpin it. */
  featPin(scope: string, featId: string, pinned: boolean): Promise<ActionResult> {
    return this.#write(scope, { featId, pinned }, (api, options) =>
      api.featPin(featId, pinned, options),
    );
  }

  /** `POST /settings`: show or hide the public README badge. */
  setBadgePublic(scope: string, badgePublic: boolean): Promise<ActionResult> {
    return this.#write(scope, { badgePublic }, (api, options) =>
      api.settings(badgePublic, options),
    );
  }

  /** `GET /export`: the player's data as parsed JSON. */
  exportData(): Promise<ActionResult & { data?: Record<string, unknown> }> {
    return this.#read(async (api) => ({ ok: true as const, data: await api.exportData() }));
  }

  /**
   * `POST /delete`. Resolves ok on 204; a wrong login comes back as `confirm_mismatch` (400). The token
   * still opens the door but nothing is behind it, so on success the session ends: the token is forgotten
   * and Landing says everything was deleted (a returning `/me` would only answer 404 `no_profile`).
   */
  async deleteEverything(confirmLogin: string): Promise<ActionResult> {
    const scope = 'delete';
    const key = this.#key(scope, { confirmLogin });
    const api = this.#api;
    if (!api) {
      return SIGNED_OUT;
    }
    this.busy = scope;
    try {
      await api.deleteAccount(confirmLogin, this.#replay(key));
      this.#pending = {};
      this.#end('deleted');
      return { ok: true };
    } catch (error) {
      this.#remember(key, error);
      return this.#failure(error);
    } finally {
      this.busy = null;
    }
  }

  /** A read that is not a slice of the session: what it answers with, or why it could not. */
  async #read<R extends { ok: true }>(call: (api: Api) => Promise<R>): Promise<R | Refused> {
    const api = this.#api;
    if (!api) {
      return SIGNED_OUT;
    }
    try {
      return await call(api);
    } catch (error) {
      return this.#failure(error);
    }
  }

  /** Run one write: one at a time, replay a failed attempt's request id, adopt the answer. */
  async #write(
    scope: string,
    input: unknown,
    call: (api: Api, options: MutationOptions) => Promise<Answer>,
  ): Promise<ActionResult> {
    return (await this.#mutate(scope, input, call)).result;
  }

  /**
   * The write itself, and what the api answered (null when it refused). The answer's profile replaces
   * `me`; its run replaces `week` when it has one (the shop's does, the depth layer's rides in `me.week`).
   * `input` is what the control sends: with `scope` it names the request, so a lost reply is replayed for
   * the same request only.
   */
  async #mutate<T extends Answer>(
    scope: string,
    input: unknown,
    call: (api: Api, options: MutationOptions) => Promise<T>,
  ): Promise<{ result: ActionResult; answer: T | null }> {
    const key = this.#key(scope, input);
    const api = this.#api;
    if (!api) {
      return { result: SIGNED_OUT, answer: null };
    }
    if (this.busy !== null) {
      return {
        result: { ok: false, status: 0, code: 'busy', message: 'One moment, still working.' },
        answer: null,
      };
    }
    this.busy = scope;
    this.#writes += 1;
    this.#epoch += 1;
    let result: ActionResult;
    let answer: T | null = null;
    try {
      answer = await call(api, this.#replay(key));
      this.#pending = {};
      this.#adoptMe({ ...answer.me, week: answer.week ?? answer.me.week ?? this.week ?? null });
      result = { ok: true };
    } catch (error) {
      this.#remember(key, error);
      result = this.#failure(error);
    } finally {
      this.#writes -= 1;
      this.#epoch += 1;
      this.busy = null;
    }
    if (!result.ok && result.status === 409) {
      // The shop, the hand or the satchel changed under the player: bring the screen up to date, keep the message.
      void this.#resync();
    }
    return { result, answer };
  }

  /** Take a fresh profile: it replaces `me`, its run replaces `week`, the views follow, and the clock moves. */
  #adoptMe(me: MeResponse): void {
    this.me = me;
    this.week = me.week ?? null;
    this.#sync();
    this.now = Date.now();
    this.#dropMoved();
  }

  /** Rebuild the expedition and Forge views from the profile, so a screen shows what the profile says. */
  #sync(): void {
    const me = this.me;
    if (!me) {
      return;
    }
    const now = Date.now();
    if (this.expedition) {
      this.expedition = expeditionViewFrom(me, now);
    }
    if (this.forge) {
      this.forge = forgeViewFrom(me, now);
    }
    if (this.feats) {
      this.feats = this.feats.map((feat) => {
        const pinned = me.pinnedFeats.includes(feat.id);
        return feat.pinned === pinned ? feat : { ...feat, pinned };
      });
    }
  }

  /** What names a request: the control that sent it and exactly what it sent. */
  #key(scope: string, input: unknown): string {
    return `${scope}\n${stableJson(input)}`;
  }

  /**
   * The request id of an earlier attempt at this very request that died on the network, if there is one and
   * it is recent. Anything else gets a fresh id: the api would answer an old id with the old response and
   * the screen would announce a success that never happened.
   */
  #replay(key: string): MutationOptions {
    const kept = this.#pending[key];
    if (kept === undefined) {
      return {};
    }
    if (Date.now() - kept.at > REPLAY_WINDOW_MS) {
      delete this.#pending[key];
      return {};
    }
    return { requestId: kept.requestId };
  }

  /**
   * Keep the id of an attempt that ran out of retries on the network or on a gateway error (the api hands
   * it back on the error); any other outcome is a real answer and the id is forgotten.
   */
  #remember(key: string, error: unknown): void {
    if (error instanceof ApiError && error.requestId) {
      this.#pending[key] = { requestId: error.requestId, at: Date.now(), me: stableJson(this.me) };
    } else {
      delete this.#pending[key];
    }
  }

  /** A fresh read of the profile that differs from the one a lost write was sent from: the state moved on. */
  #dropMoved(): void {
    const remembered = Object.entries(this.#pending);
    if (remembered.length === 0) {
      return;
    }
    const current = stableJson(this.me);
    for (const [key, kept] of remembered) {
      if (kept.me !== current) {
        delete this.#pending[key];
      }
    }
  }

  #failure(error: unknown): Refused {
    if (sessionEnd(error)) {
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
      this.#adoptMe(me);
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
    const ended = sessionEnd(error);
    if (ended) {
      this.#end(ended);
      return;
    }
    this.error = error instanceof Error ? error.message : 'Something went wrong.';
    this.status = 'error';
  }

  /**
   * The token is of no use any more, because the api rejected it or its character is gone (a deleted
   * account answers `/me` with 404 `no_profile` for as long as the old token is kept). Show Landing, and
   * let the caller forget the token: left on the error screen there is no way out but "Try again".
   */
  #end(reason: 'expired' | 'deleted'): void {
    if (reason === 'expired') {
      this.expired = true;
    } else {
      this.deleted = true;
    }
    this.status = 'signed-out';
    this.#options.onUnauthorized?.();
  }
}
