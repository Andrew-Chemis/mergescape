# API contract (tasks 15–18)

Authoritative shapes for the `api` Lambda and the client. Backend mirrors these in `packages/backend/src/api-types.ts`; client in `packages/client/src/lib/types.ts`. Types referenced from `@mergescape/shared`: `Charm`, `Pledge`, `ActId`, `MogulId`, `MonsterId`, `VoucherId`, `SkillXp`, `ScoreResult`.

All authenticated routes: `Authorization: Bearer <jwt>`, `Origin` must equal `PAGES_ORIGIN`. Errors: `{ "error": "<code>", "message"?: string }` with 400 (bad input), 401 (no/invalid token), 403 (origin), 404, 409 (typed shop/pledge error codes from shared, e.g. `insufficient_gold`, `sold_out`, `shop_closed`, `window_closed`), 413, 500.

Every mutating POST takes `{ "requestId": "<client uuid>", ...fields }`. The same `requestId` replayed returns the same response and applies nothing twice. A `requestId` counts as applied only once its effect has been committed: the profile write that carries the change also records the id on the profile (the last 10, `applied_requests`), and the `WEEK#` item keeps the last 20 as the long memory. So:

- a request that answered 409 (a rule, or `conflict`) or 5xx, or that never answered, was **not** applied and can be sent again with the same id; it is never answered with a false 200 for something that did not happen;
- a request that died half way (after it changed the week, before it changed the profile) is completed, once, by the same `requestId` sent again; if nobody sends it again, whatever it changed on the week is taken back after about 30 s;
- a request that died after its profile write is answered as applied when sent again.

Sign-in (`GET /auth/login`, `GET /auth/callback`) is browser navigation, not API: `/auth/login` writes nothing and answers a 302 to GitHub whose `state` is a signed, 10-minute token (`<nonce>.<expiry>.<mac>`), and sets an `HttpOnly; Secure; SameSite=Lax` cookie `__Host-mergescape-oauth` holding the nonce. `/auth/callback` accepts only a state that verifies, has not expired and has not been used, **and** that arrives with that cookie (so a sign-in started in another browser cannot be completed in this one); anything else redirects with `#error=invalid_state`. The cookie is removed on every callback answer. The login must therefore be a top-level navigation to the Function URL (a link or `location.assign`), not a `fetch`.

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

- `GET /badge/{login}.svg` → `image/svg+xml; charset=utf-8`, 20 px tall, "mergescape" on the left and `Lv 41 Warden · Renown 17` on the right. No auth and no Origin check. `Cache-Control: public, max-age=21600`, also for the neutral `unranked` badge served for an unknown or malformed login (the login is never echoed). Only `GET` and `HEAD`; any other path under `/badge/` is a 404. Served through CloudFront; level, Vocation, Renown, the pinned Feats, the Old Coin and the opt-out flag are read from GSI1 and nothing else is. A player whose `badge_public` is `false` (see `POST /settings`) gets exactly the `unranked` badge, byte for byte what an unknown login gets, so the badge cannot be used to tell that an account exists. The attribute is absent on a profile that never set it, which means public.
- `POST /settings` `{ requestId, badgePublic: boolean }` → `{ me }`. Stores `badge_public` on the profile (default `true`); `GSI1` projects it, so a change reaches the badge on its next uncached read (at most 6 hours behind, because of the cache). Setting the value it already has is a successful no-op. 400 `invalid_request` when `badgePublic` is not a boolean. `MeResponse.badgePublic: boolean` (see the depth layer) is `true` until the player turns the badge off.
- `GET /export` → `application/json` `{ exportedAt, profile, events, weeks, feats, expeditions, jobs }` (every item under the user's `USER#` partition, raw attribute names, DynamoDB sets as arrays). `Content-Disposition: attachment; filename="mergescape-<login>.json"`. Sent gzipped (`Content-Encoding: gzip`) when the request accepts it; an export still over 4 MiB is a 413 `export_too_large`. An item of a kind the export does not know yet appears under an extra `other` key, so nothing is ever left out. 404 `no_profile` without a profile.
- `POST /delete` `{ requestId, confirmLogin: string }` → 204 when `confirmLogin` equals the user's login (case-insensitive), else 400 `confirm_mismatch`. Deletes every `USER#` item and every `PR#` record whose only actor (author, merger, reviewers, inline commenters) is the user, found through the user's Combat Log rows. The next sign-in creates a fresh level-1 profile. Repeating a delete that succeeded (no profile left) also answers 204. If it fails part-way the profile is still there, so the same request can be sent again.

## Client behaviour notes

- After any mutation, replace local `me` and `week` with the response; do not refetch.
- Shop and pledge errors (409) are shown inline next to the control, never as a modal.
- Fixture mode (`?fixture=1`) must include a `week` with an open shop so the Shop screen renders offline.
- Sign-in hand-off: `GET /auth/callback` (and `/auth/login` when it cannot start) redirects to the client with the outcome in the URL fragment, never the query. `#token=<jwt>` on success; otherwise `#error=<code>` with one of `access_denied`, `invalid_state`, `invalid_request`, `github_unavailable`, `auth_failed`, `server_error`. The client stores the token or reads the code, removes the whole fragment before the router sees it, and shows a short notice on the landing page for a code (and for a token the browser would not store). An unknown code gets a generic notice.
- A token whose character is gone (after `POST /delete`, or a delete from another device) answers every read with 404 `no_profile`. The client treats that as signed out: it forgets the token and shows the landing page. A successful `POST /delete` does the same without waiting for the next read.
- Request ids: the client keeps the `requestId` of a mutation that ran out of retries (network failure, timeout, or 502/503/504) and reuses it only for the same control sending the same input, for at most two minutes, and only until a fresh `GET /me` differs from the profile the failed attempt was sent from. Any other mutation gets a new id. Every request is abandoned after 15 s and handled like a network failure.
- The 30 s poll reads the newest `GET /log` page; when every row on it is new it follows `nextCursor` (up to 5 pages) until a row already on screen shows up.
- `413 export_too_large` from `GET /export` is shown as its own message, not as a generic "too large to send".

## Depth layer (tasks 22–23)

Types from `@mergescape/shared`: `Satchel`, `LootItem`, `ExpeditionState`, `ForgeJob`, `GearPiece`, `FeatStatus`, `RegionId`, `ExpeditionChoice` (`4 | 12 | 24 | 48 | 'forage'`), `Station` (`'forge' | 'loom' | 'scriptorium'`), `RecipeId`, `PetId`, `CapeColor`.

`MeResponse` gains: `badgePublic: boolean` (the player's badge setting, `true` unless turned off), `satchel: Satchel`, `inventory: GearPiece[]`, `gear: { equipped: Partial<Record<Slot, GearPiece>>; setBonus: number; capeColor: CapeColor | null }`, `pets: PetId[]`, `charmPacks: number[]` (unopened pack seeds), `forge: { upgrades: string[]; stations: Partial<Record<Station, ForgeJob>> }`, `titles: string[]`, `pinnedFeats: string[]`, `expedition: ExpeditionState | null` (latest), `tzOffsetMinutes: number | null`.

- `GET /expedition` → `{ expedition: ExpeditionState | null, status: 'none' | 'away' | 'returned' | 'collected', returnsAt: string | null, regions: { id: RegionId; name: string; unlocked: boolean; renownRequired: number; lean: string | null }[], choices: { choice: ExpeditionChoice; hours: number; provisions: number; affordable: boolean }[] }`
- `POST /expedition/send` `{ requestId, region: RegionId, choice: ExpeditionChoice }` → `{ me, expedition }`; 409 codes `in_progress`, `uncollected`, `region_locked`, `insufficient_provisions`.
- `POST /expedition/collect` `{ requestId }` → `{ me, expedition, loot: LootItem[], applied: boolean, featsUnlocked: string[] }`; 409 `not_returned`, 404 `no_expedition`.
- `POST /packs/open` `{ requestId, seed: number, charmId: string }` → `{ me }`; `GET /packs/:seed` → `{ options: Charm[] }`; 409 `no_such_pack`, `bad_option`, `no_free_slot`.
- `GET /forge` → `{ stations: Record<Station, { job: ForgeJob | null; status: 'idle' | 'working' | 'ready' | 'collected'; readyAt: string | null }>, recipes: { id: RecipeId; station: Station; name: string; inputs: Partial<Satchel>; hours: number; unlocked: boolean; affordable: boolean }[], upgrades: { id: string; owned: boolean; cost: Partial<Satchel> }[] }`
- `POST /forge/start` `{ requestId, recipeId: RecipeId, pieceId?: string }` → `{ me }`; 409 codes from shared `ForgeError`.
- `POST /forge/collect` `{ requestId, station: Station }` → `{ me, piece: GearPiece | null, applied: boolean }`; 409 `no_job`, `not_ready`.
- `POST /forge/upgrade` `{ requestId, upgrade: 'bellows' | 'dyes' | 'index' }` or `{ requestId, capeColor: CapeColor | null }` → `{ me }`; 409 `already_owned`, `insufficient_supplies`, `dyes_required`.
- `POST /gear/equip` `{ requestId, pieceId: string }` or `{ requestId, unequip: Slot }` or `{ requestId, petId: PetId }` → `{ me }`; 409 `not_owned`, `already_equipped`, `tier_locked`, `nothing_equipped`, `pet_slot`.
- `GET /feats` → `{ feats: FeatRow[] }` where `FeatRow` is the shared `FeatStatus` plus an optional `unlockedAt` (hidden ones come back as `???` with hint only, per shared `featStatuses`). `unlockedAt` is the ISO 8601 instant the Feat unlocked, read from the Feat's `FEAT#` record, which is written once at the unlock. It is present on an unlocked Feat that has its record and absent otherwise: a locked Feat never has it, and neither does an unlocked one whose record is missing (the record follows the profile write, so a crash between the two leaves none) or has no usable time. The client then says only "Unlocked".
- `POST /feats/pin` `{ requestId, featId: string, pinned: boolean }` → `{ me }`; 409 `not_unlocked`, `already_pinned`, `too_many_pinned`.
- `GET /badge/:login.svg` additionally renders up to three pinned Feat glyphs and the Old Coin when unlocked.

Client fixture mode must include: a returned, uncollected expedition; one working and one ready Forge job; an inventory with a few pieces and one equipped set; 2 unopened charm packs; 6 feats (2 unlocked, 1 pinned, 1 hidden).
