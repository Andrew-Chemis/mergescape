import {
  biomeFor,
  charmSellPrice,
  charmSlotCount,
  interestCap,
  interestOn,
  packOptions,
  pledgeDefinition,
  pledgeWindowOpen,
  revealedNextMogul,
  rerollCost,
  shrineCost,
  visitOf,
} from '@mergescape/shared';
import type { PackOption } from '@mergescape/shared';
import type { InstallationItem, StoredEventRow } from './db';
import type {
  InstallationSummary,
  LogEntry,
  LogEventKind,
  MeResponse,
  PackShelfKind,
  PledgeProgress,
  ShopOption,
  ShopView,
  WeekSummary,
} from './api-types';
import { freePackOptions } from './free-pack';
import type { Current } from './runs';
import { displayWeekKey } from './weeks';

// ---------------------------------------------------------------------------------------------
// The run and the shop
// ---------------------------------------------------------------------------------------------

/** A pack option as the client reads it (`shared` calls the cosmetic pack `mogul`; the api says `cosmetic`). */
function toShopOption(option: PackOption): ShopOption {
  switch (option.kind) {
    case 'charm':
      return { kind: 'charm', charm: option.charm };
    case 'pledge':
      return { kind: 'pledge', pledge: option.pledge };
    case 'mogul':
      return { kind: 'cosmetic', id: option.cosmetic.id, name: option.cosmetic.name };
  }
}

/** The open shop with its prices, or null when no act has cleared. Options show once a pack is bought. */
export function toShopView({ run, player }: Current): ShopView | null {
  const shop = run.shop;
  if (shop === null) {
    return null;
  }
  const sellPrices: Record<string, number> = {};
  for (const charm of player.charms) {
    sellPrices[charm.id] = charmSellPrice(charm.rarity);
  }
  return {
    visit: visitOf(run),
    charms: shop.charms.map((slot, index) => ({
      index,
      charm: slot.item,
      price: slot.price,
      sold: slot.sold,
    })),
    packs: shop.packs.map((slot, index) => {
      const picked = slot.picked === true;
      const kind: PackShelfKind = slot.item === 'mogul' ? 'cosmetic' : slot.item;
      return {
        index,
        kind,
        price: slot.price,
        bought: slot.sold,
        picked,
        options: slot.sold && !picked ? (packOptions(run, index) ?? []).map(toShopOption) : null,
      };
    }),
    voucher: shop.voucher
      ? { id: shop.voucher.item.id, price: shop.voucher.price, sold: shop.voucher.sold }
      : null,
    rerollCost: rerollCost(player, shop),
    shrineCost: shrineCost(player),
    sellPrices,
    interestPreview: interestOn(player.gold, interestCap(player)),
  };
}

/** `GET /week`. */
export function toWeekSummary(current: Current, now: number): WeekSummary {
  const { run, player, week } = current;
  const pledgeProgress: Record<string, PledgeProgress> = {};
  for (const pledge of run.played) {
    pledgeProgress[pledge.id] = {
      progress: player.pledges.progress[pledge.id] ?? 0,
      target: pledgeDefinition(pledge.id)?.goal ?? 1,
      completed: player.pledges.completed.includes(pledge.id),
    };
  }
  return {
    weekKey: displayWeekKey(run.weekKey),
    act: run.act,
    clearedActs: run.clearedActs,
    weeklyXp: run.weeklyXp,
    targets: run.targets,
    mogul: run.mogul,
    // Only when Scout's Eye or the Oracle allows it.
    nextMogul: revealedNextMogul(player),
    hand: run.hand,
    played: run.played,
    pledgeWindowOpen: pledgeWindowOpen(now),
    pledgeProgress,
    shop: toShopView(current),
    freePack: week.freePack === 'pledge' ? 'pledge' : null,
    freePackOptions:
      week.freePack === 'pledge'
        ? freePackOptions(run).map((pledge) => ({ kind: 'pledge' as const, pledge }))
        : null,
    legendaryOffer: week.legendary,
  };
}

/** `GET /me`. */
export function toMeResponse(current: Current, now: number): MeResponse {
  const { profile, player } = current;
  return {
    githubId: profile.id,
    login: profile.login,
    createdAt: profile.created,
    xp: profile.xp,
    skillXp: profile.skillXp,
    gold: profile.gold,
    renown: profile.renown,
    vocation: profile.vocation,
    charms: [...player.charms],
    charmSlots: charmSlotCount(player),
    vouchers: [...player.vouchers],
    deck: [...player.deck],
    biome: biomeFor(profile.renown),
    kills: profile.kills,
    firstSeen: profile.firstSeen,
    week: toWeekSummary(current, now),
  };
}

// ---------------------------------------------------------------------------------------------
// Combat Log and installations
// ---------------------------------------------------------------------------------------------

/** One Combat Log row as the client reads it. Optional fields are omitted, not null. */
export function toLogEntry(row: StoredEventRow): LogEntry {
  return {
    id: row.id,
    at: row.ts,
    kind: row.kind as LogEventKind,
    ...(row.reviewState !== undefined ? { reviewState: row.reviewState } : {}),
    ...(row.prNumber !== undefined ? { prNumber: row.prNumber } : {}),
    ...(row.repoId !== undefined ? { repoId: row.repoId } : {}),
    ...(row.repoPrivate !== undefined ? { repoPrivate: row.repoPrivate } : {}),
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
