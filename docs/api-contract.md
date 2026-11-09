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

- `GET /badge/:login.svg` → `image/svg+xml`, no auth, no Origin check, `Cache-Control: public, max-age=21600`.
- `GET /export` → `application/json` `{ exportedAt, profile, events, weeks, feats, expeditions, jobs }` (all the user's items, raw attribute names).
- `POST /delete` `{ requestId, confirmLogin: string }` → 204 when `confirmLogin` equals the user's login (case-insensitive), else 400 `confirm_mismatch`.

## Client behaviour notes

- After any mutation, replace local `me` and `week` with the response; do not refetch.
- Shop and pledge errors (409) are shown inline next to the control, never as a modal.
- Fixture mode (`?fixture=1`) must include a `week` with an open shop so the Shop screen renders offline.
