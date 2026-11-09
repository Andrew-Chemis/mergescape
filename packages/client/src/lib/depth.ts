/**
 * The depth layer's pure helpers (tasks 22 and 23): labels, durations, the views a screen draws from a
 * profile, and what a loot item is called. Nothing here touches the network or the DOM.
 *
 * The api answers `GET /expedition` and `GET /forge` with views that are plain functions of the profile
 * and the clock, so the client can rebuild them from the `me` a write answers with instead of asking
 * again. The fixture api uses the same functions as its stand-in for the server.
 */
import {
  AFFIX_ORDER,
  AFFIX_RULES,
  expeditionDurationMs,
  expeditionPlan,
  expeditionStatus,
  featDefinition,
  GEAR_TIERS,
  MATERIAL_KINDS,
  missingSupplies,
  petDefinition,
  RECIPES,
  recipeHours,
  REGIONS,
  STATION_IDS,
  STATION_UPGRADES,
  tierUnlocked,
  uniqueDefinition,
  UPGRADE_IDS,
} from '@mergescape/shared';
import type {
  Affix,
  CapeColor,
  ExpeditionChoice,
  GearPiece,
  GearSlot,
  GearTier,
  LootItem,
  MaterialKind,
  Satchel,
} from '@mergescape/shared';
import { levelFor } from '@mergescape/shared';
import { formatDecimal } from './format';
import { GEAR_TIER_PALETTES, heroPaletteFor } from './sprites';
import type { HeroPalette } from './sprites';
import type {
  ExpeditionStatus,
  ExpeditionView,
  ForgeView,
  MeResponse,
  Station,
  StationStatus,
} from './types';

// ---------------------------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------------------------

export const MATERIAL_LABELS: Readonly<Record<MaterialKind, string>> = {
  ore: 'Ore',
  timber: 'Timber',
  lore: 'Lore',
  ink: 'Ink',
  provisions: 'Provisions',
  flux: 'Flux',
  silver: 'Silver',
  mithril: 'Mithril',
  rune: 'Rune',
  dragon: 'Dragon scale',
};

/** The four crafting-tier materials only expeditions give; the satchel strip shows them once owned. */
export const TIER_MATERIAL_KINDS: readonly MaterialKind[] = ['silver', 'mithril', 'rune', 'dragon'];

export const SLOT_LABELS: Readonly<Record<GearSlot, string>> = {
  weapon: 'Weapon',
  body: 'Body',
  cape: 'Cape',
  trinket: 'Trinket',
  pet: 'Pet',
};

export const TIER_LABELS: Readonly<Record<GearTier, string>> = {
  leather: 'Leather',
  iron: 'Iron',
  silver: 'Silver',
  mithril: 'Mithril',
  rune: 'Rune',
  dragon: 'Dragon',
};

export const STATION_LABELS: Readonly<Record<Station, { name: string; makes: string }>> = {
  forge: { name: 'Forge', makes: 'Weapons and Body armour' },
  loom: { name: 'Loom', makes: 'Capes' },
  scriptorium: { name: 'Scriptorium', makes: 'Trinkets, and affixes for any piece' },
};

export const UPGRADE_LABELS: Readonly<Record<string, { name: string; text: string }>> = {
  bellows: { name: 'Bellows', text: 'Every Forge order takes 25% less time.' },
  dyes: { name: 'Dyes', text: 'Lets you colour your cape. Cosmetic only.' },
  index: { name: 'Index', text: 'Shows what each region leans toward on the Expedition map.' },
};

export const AFFIX_LABELS: Readonly<Record<Affix, { name: string; text: string }>> = {
  keen: { name: 'Keen', text: `+${formatDecimal(AFFIX_RULES.keenPower)} Power on reviews` },
  stout: { name: 'Stout', text: `+${formatDecimal(AFFIX_RULES.stoutPower)} Power on merges` },
  quick: { name: 'Quick', text: 'Expeditions 10% shorter' },
  lucky: { name: 'Lucky', text: '+5% Charm-pack odds' },
  hoarder: { name: 'Hoarder', text: '+1 supply per event' },
};

export const CAPE_COLOR_LABELS: Readonly<Record<CapeColor, string>> = {
  crimson: 'Crimson',
  azure: 'Azure',
  verdant: 'Verdant',
  amber: 'Amber',
  violet: 'Violet',
  ash: 'Ash',
};

/** The cloth colour each dye paints the cape (also the swatch on the picker). */
export const CAPE_COLOR_HEX: Readonly<Record<CapeColor, string>> = {
  crimson: '#c4343a',
  azure: '#3a78d8',
  verdant: '#36a05a',
  amber: '#e0992f',
  violet: '#8a58e0',
  ash: '#9a9fa8',
};

/** `6 Timber, 2 Provisions`: a cost or a drop, in satchel order. Empty for no cost. */
export function formatCost(cost: Partial<Satchel>): string {
  return MATERIAL_KINDS.filter((kind) => (cost[kind] ?? 0) > 0)
    .map((kind) => `${cost[kind]} ${MATERIAL_LABELS[kind]}`)
    .join(', ');
}

/** What the satchel lacks for `cost`, in the same words as `formatCost`. Empty when it can pay. */
export function shortOf(satchel: Satchel, cost: Partial<Satchel>): string {
  return formatCost(missingSupplies({ satchel }, cost));
}

export function canPay(satchel: Satchel, cost: Partial<Satchel>): boolean {
  return Object.keys(missingSupplies({ satchel }, cost)).length === 0;
}

// ---------------------------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------------------------

/** Epoch milliseconds from either an epoch number or an ISO string, or null when it is neither. */
export function toMs(value: number | string | null | undefined): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

/** `9 h`, `40 min`, `under a minute`: coarse on purpose, rounded up so "Returns in" never promises early. */
export function formatCoarse(ms: number): string {
  const minutes = Math.ceil(Math.max(0, ms) / 60_000);
  if (minutes < 1) {
    return 'under a minute';
  }
  if (minutes < 60) {
    return `${minutes} min`;
  }
  return `${Math.ceil(minutes / 60)} h`;
}

/** `3 h 36 min`: a trip's length to the minute, for the picker when Quick gear shortens it. */
export function formatLong(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) {
    return `${rest} min`;
  }
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

/** `3:12:05`: the live countdown on the Expedition and Forge screens. */
export function formatCountdown(ms: number): string {
  const total = Math.ceil(Math.max(0, ms) / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/** `Mon 9 Nov`, for the day a Feat unlocked. */
export function formatDay(iso: string): string {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) {
    return '';
  }
  return new Date(time).toLocaleDateString('en-US', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

// ---------------------------------------------------------------------------------------------
// Expedition
// ---------------------------------------------------------------------------------------------

/** Where the latest expedition stands right now. */
export function expeditionStatusOf(
  expedition: MeResponse['expedition'],
  now: number,
): ExpeditionStatus {
  if (!expedition) {
    return 'none';
  }
  return expeditionStatus(expedition, now);
}

/** The five ways to go out: the free Forage, then 4, 12, 24 and 48 hours. */
export const EXPEDITION_CHOICES: readonly ExpeditionChoice[] = ['forage', 4, 12, 24, 48];

/** `GET /expedition` rebuilt from a profile: regions with their gates, choices with what they cost. */
export function expeditionViewFrom(me: MeResponse, now: number): ExpeditionView {
  const status = expeditionStatusOf(me.expedition, now);
  const indexed = me.forge.upgrades.includes('index');
  return {
    expedition: me.expedition,
    status,
    returnsAt:
      me.expedition && status !== 'collected'
        ? new Date(me.expedition.returnsAt).toISOString()
        : null,
    regions: REGIONS.map((region) => ({
      id: region.id,
      name: region.name,
      unlocked: me.renown >= region.renown,
      renownRequired: region.renown,
      lean: indexed ? region.lean : null,
    })),
    choices: EXPEDITION_CHOICES.map((choice) => {
      const plan = expeditionPlan(choice);
      return {
        choice,
        hours: plan.hours,
        provisions: plan.provisions,
        affordable: me.satchel.provisions >= plan.provisions,
        durationMs: expeditionDurationMs(
          { gear: { pieces: Object.values(me.gear.equipped), setBonus: me.gear.setBonus } },
          plan.hours,
        ),
      };
    }),
  };
}

/** The line Town shows for the expedition: how long until the return, or that loot is waiting. */
export function expeditionLine(
  expedition: MeResponse['expedition'],
  now: number,
): { status: ExpeditionStatus; text: string } {
  const status = expeditionStatusOf(expedition, now);
  if (status === 'away' && expedition) {
    return { status, text: `Returns in ${formatCoarse(expedition.returnsAt - now)}` };
  }
  if (status === 'returned') {
    return { status, text: 'Returned: collect' };
  }
  return { status, text: 'In Town' };
}

// ---------------------------------------------------------------------------------------------
// Forge
// ---------------------------------------------------------------------------------------------

/** What a station is doing: no order, working, finished and waiting, or last order collected. */
export function stationStatusOf(
  job: MeResponse['forge']['stations'][Station],
  now: number,
): StationStatus {
  if (!job) {
    return 'idle';
  }
  if (job.collected) {
    return 'collected';
  }
  return now < job.doneAt ? 'working' : 'ready';
}

/** What an affix order costs for this piece: 2 Flux, or 4 to re-roll an affix it already has. */
export function affixCost(piece: GearPiece): Partial<Satchel> {
  return { flux: piece.affix === undefined ? AFFIX_ORDER.flux : AFFIX_ORDER.rerollFlux };
}

/** `GET /forge` rebuilt from a profile. */
export function forgeViewFrom(me: MeResponse, now: number): ForgeView {
  const stations = Object.fromEntries(
    STATION_IDS.map((station) => {
      const job = me.forge.stations[station] ?? null;
      return [
        station,
        {
          job,
          status: stationStatusOf(job ?? undefined, now),
          readyAt: job ? new Date(job.doneAt).toISOString() : null,
        },
      ];
    }),
  ) as ForgeView['stations'];
  return {
    stations,
    recipes: RECIPES.map((recipe) => ({
      id: recipe.id,
      station: recipe.station,
      name: recipe.name,
      inputs: recipe.inputs,
      hours: recipeHours({ forge: me.forge }, recipe),
      unlocked: recipe.kind === 'craft' ? tierUnlocked(me, recipe.tier) : true,
      affordable: canPay(me.satchel, recipe.inputs),
    })),
    upgrades: UPGRADE_IDS.map((id) => ({
      id,
      owned: me.forge.upgrades.includes(id),
      cost: STATION_UPGRADES[id].cost,
    })),
  };
}

// ---------------------------------------------------------------------------------------------
// Gear
// ---------------------------------------------------------------------------------------------

/** The tier a piece counts as for Power (`tier`) or looks like (`look`, the Monolith Plate). */
export function pieceLook(piece: Pick<GearPiece, 'tier' | 'look'>): GearTier | null {
  return piece.look ?? piece.tier ?? null;
}

/** `Iron Blade`, `Fernblade`: the piece's own name, or its slot when it has none. */
export function pieceName(piece: GearPiece): string {
  return piece.name ?? SLOT_LABELS[piece.slot];
}

/** `Iron · +0.10 Power · Keen`: the second line of a gear slot or inventory cell. */
export function pieceDetail(piece: GearPiece): string {
  const parts: string[] = [];
  const tier = piece.tier ?? piece.look;
  if (tier) {
    parts.push(TIER_LABELS[tier]);
  }
  parts.push(`+${formatDecimal(piece.power)} Power`);
  if (piece.affix) {
    parts.push(AFFIX_LABELS[piece.affix].name);
  }
  return parts.join(' · ');
}

const TIER_TO_PALETTE: Readonly<Record<GearTier, HeroPalette>> = {
  leather: 'leather',
  iron: 'iron',
  silver: 'silver',
  mithril: 'mithril',
  rune: 'rune',
  dragon: 'dragon',
};

/**
 * How the hero looks (Requirement 16.4): the palette of the highest tier worn (a Monolith Plate looks
 * like Dragon), and the cape colour (the dye when one is chosen, else the cape piece's own tier). With
 * nothing worn the level's tier palette from Requirement 5.4 stands, and with no cape worn there is none.
 */
export function heroLook(me: Pick<MeResponse, 'gear' | 'xp'>): {
  palette: HeroPalette;
  cape: string | null;
} {
  let best = -1;
  for (const piece of Object.values(me.gear.equipped)) {
    const tier = pieceLook(piece);
    if (tier) {
      best = Math.max(best, GEAR_TIERS.indexOf(tier));
    }
  }
  const top = GEAR_TIERS[best];
  const palette = top ? TIER_TO_PALETTE[top] : heroPaletteFor(levelFor(me.xp));
  const worn = me.gear.equipped.cape;
  if (!worn) {
    return { palette, cape: null };
  }
  const dye = me.gear.capeColor ? CAPE_COLOR_HEX[me.gear.capeColor] : null;
  const tier = pieceLook(worn) ?? 'leather';
  return { palette, cape: dye ?? (GEAR_TIER_PALETTES[tier].M as string) };
}

// ---------------------------------------------------------------------------------------------
// Loot
// ---------------------------------------------------------------------------------------------

export type LootRarity = 'common' | 'uncommon' | 'rare' | 'legendary';

/** How special an item is, for the card's border and its glint. */
export function lootRarity(item: LootItem): LootRarity {
  switch (item.kind) {
    case 'material':
      return 'common';
    case 'gear':
      return item.piece.affix ? 'rare' : 'uncommon';
    case 'charm_pack':
    case 'pet':
      return 'rare';
    case 'unique':
    case 'coin':
      return 'legendary';
  }
}

/** The kind of item, in words, for the small label on a card. */
export function lootKindLabel(item: LootItem): string {
  switch (item.kind) {
    case 'material':
      return 'Material';
    case 'gear':
      return 'Gear';
    case 'charm_pack':
      return 'Charm pack';
    case 'pet':
      return 'Pet';
    case 'unique':
      return item.piece.unique === 'reclaimed' ? 'Reclaimed' : 'Unique';
    case 'coin':
      return 'Curio';
  }
}

/** The name on a loot card: `4 Ore`, `Silver Armour`, `Charm pack`, `Owl`. */
export function lootTitle(item: LootItem): string {
  switch (item.kind) {
    case 'material':
      return `${item.quantity} ${MATERIAL_LABELS[item.material]}`;
    case 'gear':
    case 'unique':
      return pieceName(item.piece);
    case 'charm_pack':
      return 'Charm pack';
    case 'pet':
      return petDefinition(item.petId)?.name ?? item.petId;
    case 'coin':
      return `Coin dated ${item.year}`;
  }
}

/**
 * The one line under a card, for the items that have a story: a unique's description, a Reclaimed piece's
 * invented former owner, a pet's passive, an affix.
 */
export function lootCaption(item: LootItem): string | null {
  switch (item.kind) {
    case 'unique': {
      if (item.piece.unique === 'reclaimed' && item.piece.owner) {
        return `Former owner: ${item.piece.owner}`;
      }
      return (item.piece.ref ? uniqueDefinition(item.piece.ref)?.description : null) ?? null;
    }
    case 'gear':
      return item.piece.affix
        ? `${AFFIX_LABELS[item.piece.affix].name}: ${AFFIX_LABELS[item.piece.affix].text}`
        : null;
    case 'pet': {
      const pet = petDefinition(item.petId);
      return pet ? pet.passiveText || pet.description : null;
    }
    case 'charm_pack':
      return 'Three Charms inside. Keep one.';
    case 'coin':
      return 'It will show on your badge.';
    case 'material':
      return null;
  }
}

/** Alt text for a card, spoken whole: kind, name and caption. */
export function lootSpoken(item: LootItem): string {
  const caption = lootCaption(item);
  return `${lootKindLabel(item)}: ${lootTitle(item)}${caption ? `. ${caption}` : ''}`;
}

// ---------------------------------------------------------------------------------------------
// Feats
// ---------------------------------------------------------------------------------------------

export const FEAT_CATEGORY_LABELS = {
  scale: 'Scale',
  craft: 'Craft',
  endurance: 'Endurance',
  world: 'World',
  humour: 'Humour',
} as const;

/** What a Feat gives, in words: `Title Wayfarer · Pet Goblin Runt · +0.1 Power`. Empty when unknown. */
export function featRewardText(id: string): string {
  const reward = featDefinition(id)?.reward;
  if (!reward) {
    return '';
  }
  const parts: string[] = [];
  if (reward.title) {
    parts.push(`Title: ${reward.title}`);
  }
  if (reward.unique) {
    parts.push(`Gear: ${uniqueDefinition(reward.unique)?.name ?? reward.unique}`);
  }
  if (reward.pet) {
    parts.push(`Pet: ${petDefinition(reward.pet)?.name ?? reward.pet}`);
  }
  if (reward.bonus) {
    parts.push('+0.1 Power');
  }
  return parts.join(' · ');
}

/** The Feat's name from the catalogue, so a banner can name a Feat before the list has loaded. */
export function featName(id: string): string {
  return featDefinition(id)?.name ?? id;
}
