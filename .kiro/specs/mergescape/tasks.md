# Implementation Plan

Read `requirements.md`, `game-design.md`, `design.md` and `research.md` in this folder before starting. Tasks are ordered by dependency; each cites the requirements it satisfies. Check a box only when its verification line passes. Tasks marked **[v0]** form the first milestone: a working ingest → score → Combat Log loop on the owner's own repos. Everything else is **[v1]**. Tasks 20 to 24 are **[v1.5]**, the depth layers from game-design.md, required before any public release.

Conventions for the implementer:
- TypeScript strict, pnpm workspace, vitest. No `any`. No new runtime dependency without a one-line justification in the PR.
- Every task ends with its tests green and `pnpm lint && pnpm build` green.
- Never persist a field outside Requirement 3.1–3.2. Never log a webhook payload.
- Game constants live in `packages/shared/src/constants.ts` only.
- Commit per task with the task number in the subject, e.g. `feat(shared): 3. scorer core (R4)`.

---

- [x] 1. **[v0]** Bootstrap the monorepo
  - Create `pnpm-workspace.yaml` with `packages/shared`, `packages/backend`, `packages/client`, `packages/infra`.
  - Root scripts: `lint` (eslint + prettier check), `test` (vitest workspace), `build` (all packages), `typecheck`.
  - TypeScript 5.x strict base config; Node 22 target for backend; ES2022 for client.
  - Choose the client framework (Svelte 5 + Vite recommended, see research.md §8) and scaffold an empty app with a router.
  - Add MIT `LICENSE`, `README.md` skeleton, `.github/workflows/ci.yml` running lint, test, build on PRs.
  - _Requirements: 18.1, 18.2, 18.4_
  - Verify: `pnpm install && pnpm lint && pnpm test && pnpm build` succeed on a clean clone; CI is green.

- [x] 2. **[v0]** Shared package: tables, types, constants
  - `d2table.ts`: the exact table from research.md §2 and `levelFor(xp)` (binary search), `xpToNext(xp)`, `progressWithinLevel(xp)`.
  - `constants.ts`: every number in design.md §4.2, §6.1, §6.5 (points, caps, zone exponent 1.6, shop prices, rarity weights, act percentages, gold payouts, interest rule).
  - `types.ts`: `GameEvent` (normalised from webhooks), `PlayerState`, `PRState`, `ScoreResult` with `breakdown: {label: string; value: number; kind: 'points'|'power'|'zone'|'xp'}[]`, `Skill`, `Charm`, `Pledge`, `Voucher`, `Mogul`, `RunState`, `ShopStock`.
  - _Requirements: 5.1, 5.2, 4.8_
  - Verify: tests for the spot checks in research.md §2; `levelFor(3520485254) === 99`; `levelFor(3520485253) === 98`; `levelFor(0) === 1`.

- [x] 3. **[v0]** Shared package: scorer core
  - `score.ts`: pure `score(event, player, pr, now): ScoreResult` implementing Requirement 4.2–4.9 with Power fixed at 1 and no Charms/Pledges/Moguls yet (hooks in place).
  - Implement caps with per-PR and per-day counters carried on `PlayerState`/`PRState` (opens today, reviews per PR per reviewer, inline comments per PR per reviewer, daily first-event flag, streak weeks).
  - Size points: `Math.min(120, Math.round(40 * Math.log2(1 + (adds + dels) / 50)))`.
  - Solo-kill halving, non-default-branch halving, verified kill, riposte, bot exclusion flag on the event.
  - Skill routing per design.md §4.2.
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.6, 4.7, 4.8, 4.9, 2.7_
  - Verify: one test per table row and per cap boundary; design.md §4.5 worked examples reproduce exactly; 100% branch coverage on `score.ts`.

- [x] 4. **[v0]** Shared package: webhook normaliser
  - `normalize.ts`: `(eventName, payload) → GameEvent[]` for `pull_request` (opened, ready_for_review, closed with merged true/false, synchronize counted only), `pull_request_review` (submitted, by state), `pull_request_review_comment` (created), `installation`, `installation_repositories`.
  - Extract only the fields listed in research.md §5. Strip everything else at this boundary so nothing downstream can leak.
  - Mark actors as bot per Requirement 2.7.
  - _Requirements: 1.1, 2.7, 3.1, 3.2, 3.3_
  - Verify: recorded fixture payloads for each event type under `packages/shared/fixtures/webhooks/` (sanitised: fake ids, no real repo names) produce the expected `GameEvent[]`; a test asserts the normalised object has no property outside the allowed set.

- [x] 5. **[v0]** Infra: the AWS stack (written for SAM in v0, a CDK stack since task 25)
  - `packages/infra/lib/mergescape-stack.ts` (the CDK stack, started by `bin/mergescape.ts`): table `mergescape` (PK/SK strings, provisioned 5/5, TTL attribute `ttl`, GSI1 on `GSI1PK`), `ingest` and `api` functions (Node 22, 256 MB, esbuild bundling, reserved concurrency 10 and 5), Function URLs (ingest auth NONE; api auth NONE with CORS restricted to the Pages origin parameter), SSM parameter names as env vars, log groups with 14-day retention, EventBridge rule `cron(5 0 ? * MON *)` → api with `{"action":"rollover"}`, CloudFront distribution for `/badge/*` to the api URL with 6 h default TTL, two AWS Budgets (1 and 10 USD).
  - IAM per Requirement 12.2, no wildcards on resources. (Done; task 15 adds Scan on the GSI1 index ARN for the api role and narrows the GSI projection to INCLUDE badge fields.)
  - `README` section: the four `aws ssm put-parameter --type SecureString` commands the operator runs once.
  - GitHub Actions `deploy.yml` using OIDC role assumption; no AWS keys in repo.
  - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.7_
  - Verify: `cdk synth` succeeds and the assertion tests pass (`pnpm --filter @mergescape/infra validate`); `cfn-lint` and `checkov` show no high findings on the synthesized template; a deploy to a sandbox account creates all resources.

- [x] 6. **[v0]** Backend: DynamoDB repository layer
  - `db.ts` with typed accessors for every item type in design.md §9.1: profile get/update (atomic add on XP, skill XP, gold), event put, PR meta upsert (conditional on not regressing `merged`), installation upsert/delete, delivery dedupe put (`attribute_not_exists(PK)` + TTL 7 d), OAuth state put/consume, week get/update.
  - Schema guard: a runtime allow-list of attribute names per item type, enforced before every write; throws on violation.
  - Integration tests against DynamoDB Local (docker) using the same table definition as the CDK stack.
  - _Requirements: 1.5, 1.6, 1.7, 3.5_
  - Verify: dedupe second put fails with ConditionalCheckFailed; schema guard test fails on an extra attribute; all accessors covered.

- [x] 7. **[v0]** Backend: ingest handler
  - `handlers/ingest.ts`: read raw body; reject >256 KB with 413; verify signature (timing-safe) else 401; dedupe by delivery id (200 on duplicate); normalise; for each `GameEvent`: resolve actor → player (drop and count if unlinked or installation not accessible); load player + PR state; `score()`; write EVT item, update PR item, atomically add XP/skill XP/gold, update counters; respond 200. Error-only logging. Metrics: `events_scored`, `dropped_unlinked`, `dropped_bot`, `duplicates`.
  - Installation events update the `INSTALL#` items.
  - _Requirements: 1.2, 1.3, 1.4, 1.5, 2.5, 2.6, 2.7, 3.6_
  - Verify: integration test drives the handler with signed fixture deliveries end-to-end into DynamoDB Local and asserts resulting profile XP equals the scorer's output; wrong signature writes nothing; replay writes nothing; body >256 KB → 413.

- [x] 8. **[v0]** Backend: auth and session
  - `handlers/api.ts` router with routes `GET /auth/login` (redirect with state), `GET /auth/callback` (exchange code, fetch `/user` and `/user/installations`, discard token, upsert profile, issue JWT, redirect to client with token in fragment), `GET /me`, `GET /log?cursor=`, `GET /installations`.
  - JWT helper: HS256, 7 d, `iss`/`aud`, key from SSM cached 15 min.
  - CORS: Function URL config plus explicit `Origin` check returning 403 otherwise.
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 12.3, 12.5_
  - Verify: tests for state expiry/single use, token verification failures (bad sig, wrong aud, expired), Origin check; a mocked GitHub exchange proves no token is written to the table.

- [x] 9. **[v0]** Client: app shell, sprites, Town, Combat Log, Character
  - Design tokens and layout from the mock page (`mocks.html` in this folder; tokens: dark stone background, wood-framed panels, Pixelify Sans for headings, IBM Plex Sans body, IBM Plex Mono numbers).
  - `sprites.ts`: 16×16 palette-indexed definitions for hero (7 palettes), Merge Goblin, Nitpick Imp, Flaky Test Wraith, Legacy Golem, Rebase Hydra, Scope Creep, Release Dragon, Silent Monolith, six Moguls, three Charm icons; renderer to inline SVG with `shape-rendering: crispEdges`.
  - Screens: Landing (sign-in + 3 steps + privacy promise), Town (scene, act bar, last kill, Pledge hand placeholder, shop banner placeholder), Combat Log (paginated rows with breakdown expansion), Character (XP bar with exact numbers, 4 skills, Charm slots, gear tier).
  - Empty states per Requirement 10.6.
  - API client with bearer token in localStorage; CSP meta per Requirement 12.6.
  - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 5.4_
  - Verify: each screen renders from `fixtures/state.ts` in component tests; axe run shows no contrast or focus violations; a manual run against the deployed ingest shows a real merge appearing in the Combat Log within seconds.

- [ ] 10. **[v0]** Milestone check: play it yourself for a week
  - Deploy; register the App on the owner's account; install on 2–3 personal repos; sign in; merge and review normally.
  - Record findings in `design.md` §13 (pace feel, confusing breakdown labels, noisy events).
  - _Requirements: 4.9, 10.2_
  - Verify: owner confirms the loop is fun enough to continue to v1; the Zone exponent is either confirmed or adjusted once.

---

- [x] 11. **[v1]** Shared: Charms
  - `charms.ts`: definitions for the nine Charms (id, name, rarity, power, condition function over `(event, player, pr, now)`), slot logic, duplicate stacking and auto-sell.
  - Wire into `score()` Power calculation; cap Power at 8.
  - _Requirements: 9.1, 4.5_
  - Verify: one test per Charm proving its condition and contribution; Power cap test.

- [x] 12. **[v1]** Shared: Pledges and Vouchers
  - `pledges.ts`: six Pledge definitions with progress evaluators and one-time completion bonuses; deck model; draw of 5; play up to 3; auto-play rule.
  - `vouchers.ts`: six Vouchers with their effects (Charm Belt slot, Cheaper Re-rolls, Scout's Eye, Deep Pockets, Shrine Pass, Overclock exponent 1.65 applying only to later events).
  - _Requirements: 9.2, 9.3, 9.4, 9.5, 9.6, 4.6_
  - Verify: Pledge completion applies exactly once; Overclock changes Zone only for events after purchase time.

- [x] 13. **[v1]** Shared: Moguls
  - `moguls.ts`: six Moguls with modifier functions applied inside `score()` when the event falls in the Boss act window (or all week where the modifier says so), per design.md §6.2.
  - Selection without repeats across six weeks (stored as a shuffled bag on the profile).
  - Copy review: assert no real names, company names or trademarks in `moguls.ts` and the Bestiary copy (a test with a denylist of obvious real names is acceptable).
  - _Requirements: 7.1, 7.2, 7.4, 7.5_
  - Verify: one test per modifier; bag selection test over 12 weeks shows each Mogul exactly twice.

- [x] 14. **[v1]** Shared: run, economy, shop
  - `run.ts`: week key (ISO week, UTC), act targets from 8-week median with the flat-2,000 and 2× rules, act clearing on XP cross, Renown increment, biome from Renown.
  - `economy.ts`: the only module that mutates gold: points→gold, act payouts, interest with cap, purchases, sells. Export a single `applyGoldDelta` used everywhere.
  - `shop.ts`: seeded RNG (store seed on the week item), stock generation with rarity weights, pack generation (3 options), re-roll pricing, voucher availability, purchase validation.
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 8.1, 8.2, 8.3, 8.4, 8.5, 8.7, 8.8_
  - Verify: table tests for targets (new player, 3 weeks, vacation week cap); same seed → same stock; a grep test asserts no `gold` mutation outside `economy.ts`.

- [x] 15. **[v1]** Backend: run rollover and act clearing
  - `rollover` action (EventBridge): for every profile (paginated scan on GSI), close last week (streak points, Vocation recompute), create this week's `WEEK#` item (targets, Mogul, Pledge hand, shop seed).
  - In ingest: after scoring, update weekly XP, evaluate act clear → payouts, interest, open shop, Renown.
  - _Requirements: 5.3, 6.1, 6.5, 6.7, 7.2, 8.1_
  - Verify: integration test simulates a week of fixture events and asserts act transitions, gold and Renown.

- [x] 16. **[v1]** Backend: shop and Pledge endpoints
  - Routes: `GET /week`, `POST /shop/buy` (charm | pack | voucher), `POST /shop/pick` (pack option), `POST /shop/reroll`, `POST /shop/sell`, `POST /shrine/remove`, `POST /pledges/play`.
  - All writes conditional on gold and slot state; idempotent via client-supplied request id stored on the week item.
  - _Requirements: 8.6, 8.7, 9.3_
  - Verify: concurrent double-buy test leaves one purchase; insufficient gold returns 409.

- [x] 17. **[v1]** Client: Shop, Run Map, Bestiary, Settings, Privacy, Terms
  - Shop screen in Balatro layout (2 Charms, 2 Packs, 1 Voucher, re-roll, sell strip, gold + interest preview), pack-open modal (3 cards, keep 1).
  - Run Map (three acts, nodes for scored events, elite and Mogul nodes, modifier card, targets panel), Pledge hand play UI on Town.
  - Bestiary grid with kill counts and the satire disclaimer; Mogul gallery.
  - Settings: installations list with link to GitHub, Export JSON, Delete everything (two-step confirm built into the page), timezone display.
  - Privacy and Terms static pages with the text from Requirement 13.3.
  - _Requirements: 10.1, 10.3, 7.3, 7.5, 13.3_
  - Verify: fixture render tests; manual pass on a phone width shows no horizontal scroll.

- [x] 18. **[v1]** Backend: badge, export, delete
  - `GET /badge/{login}.svg` (level, vocation, Renown; unranked fallback; 6 h cache headers); `GET /export`; `POST /delete` (all `USER#` items and solely-owned `PR#` items).
  - `installation.deleted` cleanup already in task 7; confirm.
  - _Requirements: 11.1, 11.2, 11.3, 13.1, 13.2_
  - Verify: badge SVG validates and renders in a README; after delete, `/me` creates a fresh profile on next login; CloudFront returns `X-Cache: Hit` on the second badge request.

- [x] 19. **[v1]** Hardening and release
  - Schema-guard coverage of every write path; dependency audit; `checkov` on the template; CSP verified in the deployed client; budget alarms confirmed by a test notification.
  - README: permissions list, scorer link, Privacy/Terms links, one-page self-hosting guide.
  - Public App listing with the permission set visible.
  - _Requirements: 12.6, 18.2, 18.4, 3.6_
  - Verify: fresh-account deploy from README only; coverage thresholds enforced in CI; owner sign-off.

---

- [x] 20. **[v1.5]** Shared: supplies, expeditions, loot tables
  - `supplies.ts`: drop table per event (game-design.md §6.1) emitted by `score()` alongside XP; satchel model on the profile.
  - `expeditions.ts`: region definitions with Renown gates and loot leans, duration/cost table, diminishing yield curve, seeded loot roll (mulberry32 over the stored seed), item count 3 to 6, rarity bands for gear, Charm packs, pets, uniques; Reclaimed unique naming from a curated list of invented former owners.
  - _Requirements: 4.11, 15.1, 15.2, 15.3, 15.4, 15.7_
  - Verify: same seed yields identical loot; yield per Provision strictly decreasing across 4/12/24/48 h; every region's table sums to 100%.

- [x] 21. **[v1.5]** Shared: gear, Forge recipes, pets, Feats
  - `gear.ts`: slots, tiers, Power per piece, set bonus, affixes, equip validation; wire into `score()` Power with the cap raised to 9.
  - `forge.ts`: station recipes (inputs, duration, output), upgrades (Bellows, Dyes, Index), job state machine.
  - `pets.ts`: six pets with passives (passives may only touch supplies, expedition duration or pack odds).
  - `feats.ts`: the 40 v1 Feats from game-design.md §8.2 (all Scale, Craft, Endurance, World rows plus Merge Conflict, Friday Deploy, Rubber Stamp, Self Merge), rolling counters (30-day window, lifetime, per-repo first merge, local-time buckets), evaluation on every scored event, Feat bonus cap +0.5.
  - _Requirements: 4.5, 16.1, 16.2, 16.3, 16.5, 16.6, 17.1, 17.2, 17.3, 17.6_
  - Verify: Power cap test at 9; one test per Feat condition including the other-human-approval gate on Scale Feats; a Feat never fires on backfill-flagged events.

- [ ] 22. **[v1.5]** Backend: expedition, Forge and Feat endpoints
  - Routes: `POST /expedition/send`, `POST /expedition/collect`, `GET /expedition`, `POST /forge/start`, `POST /forge/collect`, `POST /forge/upgrade`, `POST /gear/equip`, `GET /feats`, `POST /feats/pin`. All conditional writes; collect is idempotent.
  - Ingest: after scoring, bank supplies, evaluate Feats, write `FEAT#` on unlock, update rolling counters.
  - Onboarding: first scored event auto-sends the Koko Woods 4 h expedition once.
  - Badge: render pinned Feat icons.
  - _Requirements: 15.4, 15.5, 15.6, 15.8, 16.4, 17.4, 17.7_
  - Verify: integration test sends, advances an injected clock, collects twice and asserts one loot roll; Feat unlock written exactly once under concurrent events.

- [ ] 23. **[v1.5]** Client: Expedition, Forge, Feats screens and Town integration
  - Expedition screen (region map with Renown gates, duration picker, timer, loot reveal animation), Forge screen (three stations, recipes, inventory, equip, affix), Feats screen (progress bars, hidden entries, pin), satchel on Town, character sprite reflecting equipped tier and cape colour, Feat unlock banner.
  - Sprites for 30 gear pieces and 6 pets (16×16, palette-indexed).
  - _Requirements: 10.1, 10.3, 16.4, 17.5_
  - Verify: fixture render tests; manual pass of the onboarding sequence in game-design.md §10 on a fresh character.

- [ ] 24. **[v1.5]** Feel and content pass
  - Implement the five polished moments in game-design.md §9 with reduced-motion fallbacks and opt-in sound (nine samples, generated or CC0, attributed in `docs/credits.md`).
  - Content check against the v1 column of game-design.md §11; copy pass for in-world terms; verify no real names anywhere.
  - Tune onboarding so a normal first week reaches the Boss act (game-design.md §10) using fixture weeks.
  - _Requirements: 10.5, 7.5_
  - Verify: owner walkthrough of day 0 to week 2 on fixture data; axe clean; reduced-motion run shows no animation.

- [ ] 25. **[v1.5]** Infra: convert to CDK for the landing zone
  - Rewrite `packages/infra` as a CDK v2 app (TypeScript) producing the same resources as the SAM template (table, two NodejsFunctions with Function URLs, CloudFront badge distribution, SSM-read IAM, EventBridge rollover, log retention, budgets), targeting the landing zone's bootstrap (`cdk-hnb659fds-*` roles) in `us-east-1`, the one region the landing zone declares for the account.
  - Replace `scripts/validate.mjs` with `aws-cdk-lib/assertions` tests asserting the same IAM and resource set; keep cfn-lint/checkov on the synthesized template in CI.
  - `deploy.yml`: assume `lz-mergescape-deploy` in the Infrastructure account via OIDC, then `cdk deploy --require-approval never`; Pages job unchanged.
  - Update infra README, root README self-hosting guide and `docs/decisions.md` (CDK chosen because the landing zone grants deploys only through CDK bootstrap roles).
  - _Requirements: 12.1, 12.2, 12.7_
  - Verify: `cdk synth` succeeds; assertions tests green; cfn-lint and checkov clean on the synthesized template; `pnpm lint/typecheck/test/build` green.

---

Deferred (not in this plan): backfill "Ancient Tomes", `issue_comment` scoring, light theme, timezone setting, guild raids, PNG share card, custom domain.
