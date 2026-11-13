/**
 * What the Run Map draws that is not just the `WeekSummary`: where a week starts, how many days are
 * left, and the kills of this week grouped into map nodes. Pure functions over the Combat Log rows the
 * session already holds.
 *
 * A kill belongs to the act whose calendar window it fell in (Scout Mon-Tue, Wed-Thu Raid, Boss Fri-Sun),
 * which is also the window the scorer uses to send the week's Mogul against a Boss-window merge.
 */
import { actWindow, DAY_MS, isMogulId, WEEK_MS, weekKeyStartMs } from '@mergescape/shared';
import type { ActId, MogulId, MonsterId } from '@mergescape/shared';
import type { LogEntry } from './types';

/** The four elites of the Bestiary (design.md 7.1); the Moguls are bosses. */
export const ELITES: ReadonlySet<MonsterId> = new Set<MonsterId>([
  'rebase-hydra',
  'scope-creep',
  'release-dragon',
  'silent-monolith',
]);

export function isElite(id: MonsterId): boolean {
  return ELITES.has(id);
}

/** `Mon-Tue`, `Wed-Thu`, `Fri-Sun`, as on the mock's map. */
export const ACT_DAYS: Readonly<Record<ActId, string>> = {
  scout: 'Mon–Tue',
  raid: 'Wed–Thu',
  boss: 'Fri–Sun',
};

/** The ISO week number, for "Week 46". */
export function weekNumber(weekKey: string): number | null {
  // A key `weekKeyStartMs` accepts always ends in its two-digit week.
  return weekKeyStartMs(weekKey) === null ? null : Number(weekKey.slice(-2));
}

/** Whole days left in the week, counting today: 7 on Monday morning, 1 on Sunday, 0 once it has ended. */
export function daysLeft(weekKey: string, now: number): number | null {
  const start = weekKeyStartMs(weekKey);
  if (start === null) {
    return null;
  }
  const remaining = start + WEEK_MS - now;
  return remaining <= 0 ? 0 : Math.min(7, Math.ceil(remaining / DAY_MS));
}

/** One stop on the map: a monster met in an act, with how many times (elites stand alone). */
export interface MapNode {
  key: string;
  act: ActId;
  monster: MonsterId;
  count: number;
  elite: boolean;
}

export interface WeekKills {
  nodes: Record<ActId, MapNode[]>;
  /** Kills this week of the week's Mogul (Boss-window merges send the Mogul as the monster). */
  mogulKills: number;
  /** Scored kills this week that the map counted. */
  total: number;
}

/**
 * Group this week's Combat Log rows into map nodes: oldest first, one node per monster per act, and one
 * per elite. Rows with no monster (the weekly streak) and rows outside the week are left out; the Mogul's
 * own kills are counted, not drawn, because the Boss node stands for them.
 */
export function weekKills(
  entries: readonly LogEntry[],
  weekKey: string,
  mogul: MogulId | null,
): WeekKills {
  const nodes: Record<ActId, MapNode[]> = { scout: [], raid: [], boss: [] };
  const start = weekKeyStartMs(weekKey);
  let mogulKills = 0;
  let total = 0;
  if (start === null) {
    return { nodes, mogulKills, total };
  }
  const end = start + WEEK_MS;
  const inWeek = entries
    .filter((entry) => {
      const at = Date.parse(entry.at);
      return entry.monster !== null && at >= start && at < end;
    })
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

  for (const entry of inWeek) {
    const monster = entry.monster as MonsterId;
    total += 1;
    if (isMogulId(monster)) {
      if (monster === mogul) {
        mogulKills += 1;
      }
      continue;
    }
    const act = actWindow(Date.parse(entry.at));
    const elite = isElite(monster);
    const key = elite ? `${act}:${monster}:${entry.id}` : `${act}:${monster}`;
    const existing = elite ? undefined : nodes[act].find((node) => node.key === key);
    if (existing) {
      existing.count += 1;
    } else {
      nodes[act].push({ key, act, monster, count: 1, elite });
    }
  }
  return { nodes, mogulKills, total };
}
