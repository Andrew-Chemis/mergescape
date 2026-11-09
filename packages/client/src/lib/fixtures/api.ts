/**
 * An `Api` that answers from fixture state, so the whole client runs offline (`?fixture=1`, or no
 * `VITE_API_ORIGIN`). With `live`, one extra Merge Goblin row "arrives" after a delay and pushes the
 * character over a level, which exercises the score ticker and the level-up flash end to end.
 */
import type { Api } from '../api';
import type { InstallationsResponse, LogEntry, LogResponse, MeResponse } from '../types';
import {
  fixtureInstallations,
  fixtureLogEntries,
  fixtureMe,
  FIXTURE_PAGE_SIZE,
  pageOf,
  type FixtureVariant,
} from './state';
import { RAW_LOG } from './raw-log';

export interface FixtureApiOptions {
  /** The instant the fixture treats as "now" (timestamps are relative to it). Default: the clock. */
  now?: number;
  variant?: FixtureVariant;
  /** Rows per page. */
  pageSize?: number;
  /** Simulated network delay in ms. Default 0. */
  latencyMs?: number;
  /** After this many ms one new row arrives (variant `active` only). Omit for a static fixture. */
  liveAfterMs?: number;
}

const FIXTURE_CLOCK = () => Date.now();

export function createFixtureApi(options: FixtureApiOptions = {}): Api {
  const start = options.now ?? FIXTURE_CLOCK();
  const variant = options.variant ?? 'active';
  const pageSize = options.pageSize ?? FIXTURE_PAGE_SIZE;
  const created = FIXTURE_CLOCK();

  const base = fixtureLogEntries(start, variant);

  /** The arrived row: a copy of the newest scored merge with a new PR number, stamped at arrival. */
  function liveEntry(): LogEntry | null {
    const template = RAW_LOG[0]?.row;
    if (!template || variant !== 'active' || options.liveAfterMs === undefined) {
      return null;
    }
    if (FIXTURE_CLOCK() - created < options.liveAfterMs) {
      return null;
    }
    const at = new Date(created + options.liveAfterMs).toISOString();
    return { ...template, id: `${at}#fixture-live`, at, prNumber: (template.prNumber ?? 0) + 19 };
  }

  function entries(): LogEntry[] {
    const live = liveEntry();
    return live ? [live, ...base] : base;
  }

  async function delay<T>(value: T): Promise<T> {
    if (options.latencyMs) {
      await new Promise((resolve) => setTimeout(resolve, options.latencyMs));
    }
    return value;
  }

  return {
    async me(): Promise<MeResponse> {
      const me = fixtureMe(start, variant);
      const live = liveEntry();
      if (live && me.week) {
        me.xp += live.xp;
        me.gold += Math.floor(live.points / 10);
        me.skillXp = {
          ...me.skillXp,
          smithing: me.skillXp.smithing + live.skillXp.smithing,
        };
        me.week = { ...me.week, weeklyXp: me.week.weeklyXp + live.xp };
      }
      return delay(me);
    },
    async log(cursor?: string | null): Promise<LogResponse> {
      return delay(pageOf(entries(), cursor, pageSize));
    },
    async installations(): Promise<InstallationsResponse> {
      return delay(fixtureInstallations(variant));
    },
  };
}
