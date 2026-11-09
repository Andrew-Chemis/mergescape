import {
  biomeFor,
  charmSellPrice,
  charmSlotCount,
  EXPEDITION_HOURS,
  expeditionDurationMs,
  expeditionPlan,
  expeditionStatus,
  featStatuses,
  forgeOf,
  hasUpgrade,
  interestCap,
  interestOn,
  isCapeColor,
  missingSupplies,
  ownedPets,
  packOptions,
  pledgeDefinition,
  pledgeWindowOpen,
  RECIPES,
  recipeHours,
  regionLean,
  REGIONS,
  regionUnlocked,
  revealedNextMogul,
  rerollCost,
  satchelOf,
  shrineCost,
  STATION_IDS,
  STATION_UPGRADES,
  tierUnlocked,
  UPGRADE_IDS,
  visitOf,
} from '@mergescape/shared';
import type {
  ExpeditionChoice,
  GearPiece,
  GearSlot,
  PackOption,
  PlayerState,
} from '@mergescape/shared';
import type { InstallationItem, StoredEventRow } from './db';
import type {
  ExpeditionStatus,
  ExpeditionView,
  FeatsResponse,
  ForgeView,
  InstallationSummary,
  LogEntry,
  LogEventKind,
  MeResponse,
  PackShelfKind,
  PetKey,
  PledgeProgress,
  ShopOption,
  ShopView,
  Station,
  StationStatus,
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

/** The worn gear by slot, the set bonus, and the cape colour (null for the natural cape). */
function toGearView(player: PlayerState): MeResponse['gear'] {
  const equipped: Partial<Record<GearSlot, GearPiece>> = {};
  for (const piece of player.gear.pieces) {
    equipped[piece.slot] = piece;
  }
  const color = player.gear.capeColor;
  return {
    equipped,
    setBonus: player.gear.setBonus,
    capeColor: isCapeColor(color) ? color : null,
  };
}

/** `GET /me`. */
export function toMeResponse(current: Current, now: number): MeResponse {
  const { profile, player } = current;
  const forge = forgeOf(player);
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
    satchel: satchelOf(player),
    inventory: [...(player.inventory ?? [])],
    gear: toGearView(player),
    pets: [...ownedPets(player)] as PetKey[],
    charmPacks: [...(player.charmPacks ?? [])],
    forge: { upgrades: [...forge.upgrades], stations: forge.stations },
    titles: [...(player.titles ?? [])],
    pinnedFeats: [...(player.pinnedFeats ?? [])],
    expedition: player.expedition ?? null,
    tzOffsetMinutes: player.tzOffsetMinutes ?? null,
  };
}

// ---------------------------------------------------------------------------------------------
// Expeditions, the Forge and Feats
// ---------------------------------------------------------------------------------------------

const iso = (ms: number): string => new Date(ms).toISOString();

/** `GET /expedition`: the latest trip, the eight regions and the five ways to go. */
export function toExpeditionView({ player }: Current, now: number): ExpeditionView {
  const latest = player.expedition ?? null;
  const status: ExpeditionStatus = latest ? expeditionStatus(latest, now) : 'none';
  const provisions = satchelOf(player).provisions;
  const choices: ExpeditionChoice[] = ['forage', ...EXPEDITION_HOURS];
  return {
    expedition: latest,
    status,
    returnsAt: latest ? iso(latest.returnsAt) : null,
    regions: REGIONS.map((region) => ({
      id: region.id,
      name: region.name,
      unlocked: regionUnlocked(player, region.id),
      renownRequired: region.renown,
      lean: regionLean(player, region.id),
    })),
    choices: choices.map((choice) => {
      const plan = expeditionPlan(choice);
      return {
        choice,
        hours: plan.hours,
        provisions: plan.provisions,
        affordable: provisions >= plan.provisions,
        durationMs: expeditionDurationMs(player, plan.hours),
      };
    }),
  };
}

/** `GET /forge`: the three stations, every recipe and the three upgrades. */
export function toForgeView({ player }: Current, now: number): ForgeView {
  const forge = forgeOf(player);
  const stations = {} as ForgeView['stations'];
  for (const id of STATION_IDS) {
    const job = forge.stations[id] ?? null;
    let status: StationStatus = 'idle';
    if (job !== null) {
      status = job.collected ? 'collected' : now < job.doneAt ? 'working' : 'ready';
    }
    stations[id as Station] = {
      job,
      status,
      readyAt: job !== null && !job.collected ? iso(job.doneAt) : null,
    };
  }
  return {
    stations,
    recipes: RECIPES.map((recipe) => ({
      id: recipe.id,
      station: recipe.station,
      name: recipe.name,
      inputs: { ...recipe.inputs },
      hours: recipeHours(player, recipe),
      unlocked: recipe.kind === 'craft' ? tierUnlocked(player, recipe.tier) : true,
      affordable: Object.keys(missingSupplies(player, recipe.inputs)).length === 0,
    })),
    upgrades: UPGRADE_IDS.map((id) => ({
      id,
      owned: hasUpgrade(player, id),
      cost: { ...STATION_UPGRADES[id].cost },
    })),
  };
}

/**
 * `GET /feats`: progress for the visible Feats, "???" and a hint for the hidden ones, and for an unlocked
 * Feat the instant it unlocked (`unlocks`: Feat id to ISO instant, from the `FEAT#` records).
 */
export function toFeatsView(
  { player }: Current,
  now: number,
  unlocks: Readonly<Record<string, string>> = {},
): FeatsResponse {
  return {
    feats: featStatuses(player, now).map((feat) => {
      const unlockedAt = feat.unlocked ? unlocks[feat.id] : undefined;
      return unlockedAt === undefined ? feat : { ...feat, unlockedAt };
    }),
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
