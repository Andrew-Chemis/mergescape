# API contract (tasks 15–18)

Authoritative shapes for the `api` Lambda and the client. Backend mirrors these in `packages/backend/src/api-types.ts`; client in `packages/client/src/lib/types.ts`. Types referenced from `@mergescape/shared`: `Charm`, `Pledge`, `ActId`, `MogulId`, `MonsterId`, `VoucherId`, `SkillXp`, `ScoreResult`.

All authenticated routes: `Authorization: Bearer <jwt>`, `Origin` must equal `PAGES_ORIGIN`. Errors: `{ "error": "<code>", "message"?: string }` with 400 (bad input), 401 (no/invalid token), 403 (origin), 404, 409 (typed shop/pledge error codes from shared, e.g. `insufficient_gold`, `sold_out`, `shop_closed`, `window_closed`), 413, 500.

Every mutating POST takes `{ "requestId": "<client uuid>", ...fields }`. The same `requestId` replayed returns the same response (idempotent; the backend stores the last 20 request ids on the WEEK# item).

## Existing (tasks 7–8), unchanged

- `GET /me` → `MeResponse`
- `GET /log?cursor=` → `{ entries: LogEntry[], nextCursor: string | null }`
- `GET /installations` → `{ installations: { installationId, accountId, repoCount, suspended }[] }`

`MeResponse` gains: `renown: number`, `vocation`, `charms: Charm[]`, `charmSlots: number`, `vouchers: VoucherId[]`, `deck: Pledge[]`, `biome: string`, `kills: Partial<Record<MonsterId, number>>`, `firstSeen: Partial<Record<MonsterId, string>>`, `week: WeekSummary | null`.
`LogEntry.kind` gains `'riposte_credit'`.

## Week and shop

`GET /week` → `WeekSummary`:

```ts
interface WeekSummary {
  weekKey: string; // ISO week, e.g. "2026-W46"
  act: ActId | null; // current act, null when the run is finished
  clearedActs: ActId[];
  weeklyXp: number;
  targets: Record<ActId, number>;
  mogul: MogulId; // this week's Boss, always revealed
  nextMogul: MogulId | null; // only when Oracle / Scout's Eye allows, else null
  hand: Pledge[]; // drawn Monday
  played: Pledge[];
  pledgeWindowOpen: boolean; // until Tue 23:59 UTC
  pledgeProgress: Record<string, { progress: number; target: number; completed: boolean }>; // keyed by pledge id
  shop: ShopView | null; // null when no shop is open
  freePack: 'pledge' | null; // granted after Raid, consumed by /shop/pick with index -1
  freePackOptions: ShopOption[] | null; // the 3 options of the free Raid pack, when freePack is set
  legendaryOffer: Charm | null; // every 4th Renown, taken with /shop/buy kind 'legendary'
}
interface ShopView {
  visit: number;
  charms: { index: number; charm: Charm; price: number; sold: boolean }[]; // length 2
  packs: {
    index: number;
    kind: 'pledge' | 'charm' | 'cosmetic';
    price: number;
    bought: boolean;
    picked: boolean;
    options: ShopOption[] | null;
  }[]; // options present once bought, until picked
  voucher: { id: VoucherId; price: number; sold: boolean } | null;
  rerollCost: number;
  shrineCost: number;
  sellPrices: Record<string, number>; // charm id → gold
  interestPreview: number; // gold the next act clear would pay as interest
}
type ShopOption =
  | { kind: 'charm'; charm: Charm }
  | { kind: 'pledge'; pledge: Pledge }
  | { kind: 'cosmetic'; id: string; name: string };
```

Mutations (all return `{ me: MeResponse, week: WeekSummary }` on success):

- `POST /shop/buy` `{ requestId, kind: 'charm' | 'pack' | 'voucher' | 'legendary', index?: number }`
- `POST /shop/pick` `{ requestId, index: number, option: number }` (index −1 = the free Raid pack)
- `POST /shop/reroll` `{ requestId }`
- `POST /shop/sell` `{ requestId, charmId: string }`
- `POST /shrine/remove` `{ requestId, pledgeId: string }`
- `POST /pledges/play` `{ requestId, pledgeId: string }`

## Bestiary

Served from `MeResponse.kills` and `firstSeen`; no extra route.

## Badge, export, delete (task 18)

- `GET /badge/{login}.svg` → `image/svg+xml; charset=utf-8`, 20 px tall, "mergescape" on the left and `Lv 41 Warden · Renown 17` on the right. No auth and no Origin check. `Cache-Control: public, max-age=21600`, also for the neutral `unranked` badge served for an unknown or malformed login (the login is never echoed). Only `GET` and `HEAD`; any other path under `/badge/` is a 404. Served through CloudFront; level, Vocation and Renown are read from GSI1 and nothing else is.
- `GET /export` → `application/json` `{ exportedAt, profile, events, weeks, feats, expeditions, jobs }` (every item under the user's `USER#` partition, raw attribute names, DynamoDB sets as arrays). `Content-Disposition: attachment; filename="mergescape-<login>.json"`. Sent gzipped (`Content-Encoding: gzip`) when the request accepts it; an export still over 4 MiB is a 413 `export_too_large`. An item of a kind the export does not know yet appears under an extra `other` key, so nothing is ever left out. 404 `no_profile` without a profile.
- `POST /delete` `{ requestId, confirmLogin: string }` → 204 when `confirmLogin` equals the user's login (case-insensitive), else 400 `confirm_mismatch`. Deletes every `USER#` item and every `PR#` record whose only actor (author, merger, reviewers, inline commenters) is the user, found through the user's Combat Log rows. The next sign-in creates a fresh level-1 profile. Repeating a delete that succeeded (no profile left) also answers 204. If it fails part-way the profile is still there, so the same request can be sent again.

## Client behaviour notes

- After any mutation, replace local `me` and `week` with the response; do not refetch.
- Shop and pledge errors (409) are shown inline next to the control, never as a modal.
- Fixture mode (`?fixture=1`) must include a `week` with an open shop so the Shop screen renders offline.

## Depth layer (tasks 22–23)

Types from `@mergescape/shared`: `Satchel`, `LootItem`, `ExpeditionState`, `ForgeJob`, `GearPiece`, `FeatStatus`, `RegionId`, `ExpeditionChoice` (`4 | 12 | 24 | 48 | 'forage'`), `Station` (`'forge' | 'loom' | 'scriptorium'`), `RecipeId`, `PetId`, `CapeColor`.

`MeResponse` gains: `satchel: Satchel`, `inventory: GearPiece[]`, `gear: { equipped: Partial<Record<Slot, GearPiece>>; setBonus: number; capeColor: CapeColor | null }`, `pets: PetId[]`, `charmPacks: number[]` (unopened pack seeds), `forge: { upgrades: string[]; stations: Partial<Record<Station, ForgeJob>> }`, `titles: string[]`, `pinnedFeats: string[]`, `expedition: ExpeditionState | null` (latest), `tzOffsetMinutes: number | null`.

- `GET /expedition` → `{ expedition: ExpeditionState | null, status: 'none' | 'away' | 'returned' | 'collected', returnsAt: string | null, regions: { id: RegionId; name: string; unlocked: boolean; renownRequired: number; lean: string | null }[], choices: { choice: ExpeditionChoice; hours: number; provisions: number; affordable: boolean }[] }`
- `POST /expedition/send` `{ requestId, region: RegionId, choice: ExpeditionChoice }` → `{ me, expedition }`; 409 codes `in_progress`, `uncollected`, `region_locked`, `insufficient_provisions`.
- `POST /expedition/collect` `{ requestId }` → `{ me, expedition, loot: LootItem[], applied: boolean, featsUnlocked: string[] }`; 409 `not_returned`, 404 `no_expedition`.
- `POST /packs/open` `{ requestId, seed: number, charmId: string }` → `{ me }`; `GET /packs/:seed` → `{ options: Charm[] }`; 409 `no_such_pack`, `bad_option`, `no_free_slot`.
- `GET /forge` → `{ stations: Record<Station, { job: ForgeJob | null; status: 'idle' | 'working' | 'ready' | 'collected'; readyAt: string | null }>, recipes: { id: RecipeId; station: Station; name: string; inputs: Partial<Satchel>; hours: number; unlocked: boolean; affordable: boolean }[], upgrades: { id: string; owned: boolean; cost: Partial<Satchel> }[] }`
- `POST /forge/start` `{ requestId, recipeId: RecipeId, pieceId?: string }` → `{ me }`; 409 codes from shared `ForgeError`.
- `POST /forge/collect` `{ requestId, station: Station }` → `{ me, piece: GearPiece | null, applied: boolean }`; 409 `no_job`, `not_ready`.
- `POST /forge/upgrade` `{ requestId, upgrade: 'bellows' | 'dyes' | 'index' }` or `{ requestId, capeColor: CapeColor | null }` → `{ me }`; 409 `already_owned`, `insufficient_supplies`, `dyes_required`.
- `POST /gear/equip` `{ requestId, pieceId: string }` or `{ requestId, unequip: Slot }` or `{ requestId, petId: PetId }` → `{ me }`; 409 `not_owned`, `already_equipped`, `tier_locked`, `nothing_equipped`, `pet_slot`.
- `GET /feats` → `{ feats: FeatStatus[] }` (hidden ones come back as `???` with hint only, per shared `featStatuses`).
- `POST /feats/pin` `{ requestId, featId: string, pinned: boolean }` → `{ me }`; 409 `not_unlocked`, `already_pinned`, `too_many_pinned`.
- `GET /badge/:login.svg` additionally renders up to three pinned Feat glyphs and the Old Coin when unlocked.

Client fixture mode must include: a returned, uncollected expedition; one working and one ready Forge job; an inventory with a few pieces and one equipped set; 2 unopened charm packs; 6 feats (2 unlocked, 1 pinned, 1 hidden).
