import { CHARM_SLOTS } from '@mergescape/shared';
import type { InstallationItem, ProfileItem, StoredEventRow } from './db';
import type { InstallationSummary, LogEntry, LogEventKind, MeResponse } from './api-types';

/** `GET /me` from the stored profile. Fields the profile does not persist yet carry their start values. */
export function toMeResponse(profile: ProfileItem): MeResponse {
  return {
    githubId: profile.id,
    login: profile.login,
    createdAt: profile.created,
    xp: profile.xp,
    skillXp: profile.skillXp,
    gold: profile.gold,
    // Renown, Vocation and the Charm belt arrive with the run layer (tasks 11 to 15).
    renown: 0,
    vocation: 'Journeyman',
    charms: [],
    charmSlots: CHARM_SLOTS,
    week: null,
  };
}

/** One Combat Log row as the client reads it. Optional fields are omitted, not null. */
export function toLogEntry(row: StoredEventRow): LogEntry {
  return {
    id: row.id,
    at: row.ts,
    kind: row.kind as LogEventKind,
    ...(row.reviewState !== undefined ? { reviewState: row.reviewState } : {}),
    prNumber: row.prNumber,
    repoId: row.repoId,
    repoPrivate: row.repoPrivate,
    ...(row.additions !== undefined ? { additions: row.additions } : {}),
    ...(row.deletions !== undefined ? { deletions: row.deletions } : {}),
    ...(row.inlineComments !== undefined ? { inlineComments: row.inlineComments } : {}),
    monster: row.monster,
    points: row.points,
    power: row.power,
    zone: row.zone,
    level: row.level,
    xp: row.xp,
    skill: row.skill,
    skillXp: row.skillXp,
    supplies: row.supplies,
    breakdown: row.breakdown,
  };
}

export function toInstallationSummary(installation: InstallationItem): InstallationSummary {
  return {
    installationId: installation.id,
    accountId: installation.accountId,
    repoCount: installation.repoIds.length,
    suspended: installation.suspended,
  };
}

// ---------------------------------------------------------------------------------------------
// Log cursor: the opaque form of a row id (`<iso_ts>#<delivery_id>`), base64url. The partition always
// comes from the verified token, never from the cursor, so a cursor cannot address another player's rows.
// ---------------------------------------------------------------------------------------------

const ROW_ID = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z#[A-Za-z0-9_-]{1,128}$/;
const MAX_CURSOR_LENGTH = 300;

export function encodeCursor(rowId: string): string {
  return Buffer.from(rowId, 'utf8').toString('base64url');
}

/** The row id inside a cursor, or null when the cursor is not one this service issued. */
export function decodeCursor(cursor: string): string | null {
  if (cursor.length > MAX_CURSOR_LENGTH || !/^[A-Za-z0-9_-]+$/.test(cursor)) {
    return null;
  }
  const rowId = Buffer.from(cursor, 'base64url').toString('utf8');
  return ROW_ID.test(rowId) ? rowId : null;
}
