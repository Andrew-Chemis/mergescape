/**
 * The JSON the api service returns. These mirror `packages/client/src/lib/types.ts` and are specified by
 * docs/api-contract.md (the binding description): a rename on either side should be made on both. They use
 * `@mergescape/shared` types for everything the two packages already share.
 */
import type {
  ActId,
  BreakdownLine,
  CapeColor,
  Charm,
  ExpeditionChoice,
  ExpeditionState,
  FeatPetId,
  FeatStatus,
  ForgeJob,
  GearPiece,
  GearSlot,
  LootItem,
  MogulId,
  MonsterId,
  PetId,
  Pledge,
  RegionId,
  ReviewState,
  Satchel,
  Skill,
  SkillXp,
  StationId,
  Supplies,
  VoucherId,
} from '@mergescape/shared';

export type Vocation = 'Journeyman' | 'Smith' | 'Warden' | 'Herald' | 'Pilgrim';

/** What a pack holds once it is bought: three of these, and the player keeps one. */
export type ShopOption =
  | { kind: 'charm'; charm: Charm }
  | { kind: 'pledge'; pledge: Pledge }
  | { kind: 'cosmetic'; id: string; name: string };

/** The kinds of pack on the shelf. (`shared` calls the cosmetic pack `mogul`; the api says `cosmetic`.) */
export type PackShelfKind = 'pledge' | 'charm' | 'cosmetic';

/** The open shop: one visit, from an act clear until the next act clears (Requirement 8.8). */
export interface ShopView {
  /** 1-based shop visit within the week. */
  visit: number;
  charms: { index: number; charm: Charm; price: number; sold: boolean }[];
  packs: {
    index: number;
    kind: PackShelfKind;
    price: number;
    bought: boolean;
    picked: boolean;
    /** Present once the pack is bought, until one option is picked. */
    options: ShopOption[] | null;
  }[];
  voucher: { id: VoucherId; price: number; sold: boolean } | null;
  rerollCost: number;
  shrineCost: number;
  /** Charm id to the gold paid when it is sold. */
  sellPrices: Record<string, number>;
  /** Gold the next act clear would pay as interest. */
  interestPreview: number;
}

/** How far one played Pledge has got. */
export interface PledgeProgress {
  progress: number;
  target: number;
  completed: boolean;
}

/** `GET /week` */
export interface WeekSummary {
  /** ISO week, `2026-W46` (the stored key is `2026-46`). */
  weekKey: string;
  act: ActId | null;
  clearedActs: ActId[];
  weeklyXp: number;
  targets: Record<ActId, number>;
  /** This week's Boss, always revealed. */
  mogul: MogulId;
  /** Next week's Boss; only when Scout's Eye or the Oracle allows it, else null. */
  nextMogul: MogulId | null;
  hand: Pledge[];
  played: Pledge[];
  /** True until Tuesday 23:59 UTC. */
  pledgeWindowOpen: boolean;
  /** Keyed by Pledge id; an entry exists for each played Pledge. */
  pledgeProgress: Record<string, PledgeProgress>;
  shop: ShopView | null;
  /** A free Pledge pack granted by the Raid clear, taken with `POST /shop/pick` and index -1. */
  freePack: 'pledge' | null;
  /**
   * The three options of the free pack, present while `freePack` is set. An addition to
   * docs/api-contract.md: without it the client cannot show what index -1 would pick from.
   */
  freePackOptions: ShopOption[] | null;
  /** A Legendary Charm offered on every 4th Renown, taken with `POST /shop/buy` kind `legendary`. */
  legendaryOffer: Charm | null;
}

/** `GET /me` */
export interface MeResponse {
  githubId: number;
  login: string;
  createdAt: string;
  xp: number;
  skillXp: SkillXp;
  gold: number;
  renown: number;
  vocation: Vocation;
  charms: Charm[];
  charmSlots: number;
  vouchers: VoucherId[];
  deck: Pledge[];
  biome: string;
  kills: Partial<Record<MonsterId, number>>;
  firstSeen: Partial<Record<MonsterId, string>>;
  week: WeekSummary | null;
  // The depth layer (tasks 22 and 23; docs/api-contract.md).
  satchel: Satchel;
  /** Gear owned and not worn. */
  inventory: GearPiece[];
  gear: {
    equipped: Partial<Record<Slot, GearPiece>>;
    setBonus: number;
    capeColor: CapeColor | null;
  };
  /** Pets owned: the six core pets and the ones only Feats award. */
  pets: PetKey[];
  /** Seeds of unopened Charm packs, opened with `POST /packs/open`. */
  charmPacks: number[];
  forge: { upgrades: string[]; stations: Partial<Record<Station, ForgeJob>> };
  titles: string[];
  pinnedFeats: string[];
  /** The latest expedition, collected or not; null before the first. */
  expedition: ExpeditionState | null;
  /** Minutes east of UTC for the local-time Feats; null means UTC. */
  tzOffsetMinutes: number | null;
}

/** `Station`, `Slot`, `RecipeId` and `PetKey` are the names docs/api-contract.md uses for these shared types. */
export type Station = StationId;
export type Slot = GearSlot;
export type RecipeId = string;
export type PetKey = PetId | FeatPetId;

export type ExpeditionStatus = 'none' | 'away' | 'returned' | 'collected';

/** `GET /expedition` */
export interface ExpeditionView {
  expedition: ExpeditionState | null;
  status: ExpeditionStatus;
  /** ISO instant the character is back; null when there is no expedition. */
  returnsAt: string | null;
  regions: {
    id: RegionId;
    name: string;
    unlocked: boolean;
    renownRequired: number;
    /** What the region leans toward; null until the Scriptorium's Index is bought. */
    lean: string | null;
  }[];
  choices: {
    choice: ExpeditionChoice;
    /** The nominal duration: 4, 12, 24 or 48 (the Forage is 4). */
    hours: number;
    provisions: number;
    affordable: boolean;
    /**
     * An addition to docs/api-contract.md: how long the trip takes this player, in milliseconds, with Quick
     * gear and the pet's passive applied (`hours` is always the nominal one).
     */
    durationMs: number;
  }[];
}

/** `POST /expedition/send` */
export interface ExpeditionSendResponse {
  me: MeResponse;
  expedition: ExpeditionState;
}

/** `POST /expedition/collect` */
export interface ExpeditionCollectResponse {
  me: MeResponse;
  expedition: ExpeditionState;
  loot: LootItem[];
  /** False when the trip was collected before: the stored loot is returned and nothing is granted again. */
  applied: boolean;
  featsUnlocked: string[];
}

/** `GET /packs/:seed` */
export interface PackOptionsResponse {
  options: Charm[];
}

export type StationStatus = 'idle' | 'working' | 'ready' | 'collected';

/** `GET /forge` */
export interface ForgeView {
  stations: Record<
    Station,
    { job: ForgeJob | null; status: StationStatus; readyAt: string | null }
  >;
  recipes: {
    id: RecipeId;
    station: Station;
    name: string;
    inputs: Partial<Satchel>;
    /** Hours this player's order takes (the Bellows already counted). */
    hours: number;
    unlocked: boolean;
    affordable: boolean;
  }[];
  upgrades: { id: string; owned: boolean; cost: Partial<Satchel> }[];
}

/** `POST /forge/collect` */
export interface ForgeCollectResponse {
  me: MeResponse;
  piece: GearPiece | null;
  applied: boolean;
}

/** One row of `GET /feats`: the shared status, and when the Feat unlocked once it has. */
export interface FeatRow extends FeatStatus {
  /** ISO instant of the unlock, from the Feat's `FEAT#` record; absent while locked or when no record exists. */
  unlockedAt?: string;
}

/** `GET /feats` */
export interface FeatsResponse {
  feats: FeatRow[];
}

/** The answer of the depth mutations that return only the profile. */
export interface MeResult {
  me: MeResponse;
}

/** Every mutation answers with the whole new profile and run. */
export interface MutationResponse {
  me: MeResponse;
  week: WeekSummary;
}

export type LogEventKind =
  | 'pr_opened'
  | 'pr_merged'
  | 'review_submitted'
  | 'review_comment_created'
  | 'verified_kill'
  | 'riposte_credit'
  | 'weekly_streak';

/** One Combat Log row. */
export interface LogEntry {
  /** The sort key without its `EVT#` prefix: `<iso_ts>#<delivery_id>`. */
  id: string;
  at: string;
  kind: LogEventKind;
  reviewState?: ReviewState;
  prNumber?: number;
  repoId?: number;
  repoPrivate?: boolean;
  additions?: number;
  deletions?: number;
  inlineComments?: number;
  monster: MonsterId | null;
  points: number;
  power: number;
  zone: number;
  level: number;
  xp: number;
  skill: Skill | null;
  skillXp: SkillXp;
  supplies: Supplies;
  breakdown: BreakdownLine[];
}

/** `GET /log?cursor=` */
export interface LogResponse {
  entries: LogEntry[];
  nextCursor: string | null;
}

export interface InstallationSummary {
  installationId: number;
  accountId: number;
  repoCount: number;
  suspended: boolean;
}

/** `GET /installations` */
export interface InstallationsResponse {
  installations: InstallationSummary[];
}
