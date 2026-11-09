# Requirements Document

## Introduction

Mergescape is a browser idle RPG in which a character gains experience only from the player's real pull-request activity on GitHub: opening, reviewing and merging. A read-only GitHub App delivers webhooks to a small AWS backend; a static client renders the character, a Combat Log that explains every XP grant, a weekly three-act run, a shop, and parody "Mogul" bosses. Levelling uses the Diablo II experience table. Scoring is `Points × Power × Zone`. The game is single-player, private by default, stores metadata only, and runs on free-tier AWS plus GitHub Pages.

Companion documents in this folder: `game-design.md` (pillars, kinds of fun, loops, Expeditions, Forge, Feats; wins on any conflict), `design.md` (architecture, data model, game rules in full), `research.md` (sources, benchmarks, pacing simulation, decisions), `tasks.md` (implementation plan).

Out of scope for this spec: leaderboards, guilds, notifications or email, mobile apps, backfill of history, issue-comment scoring, any write access to GitHub, any real-money purchase.

Glossary: **Points** base score of an event · **Power** multiplier from Charms and Pledges · **Zone** level-based multiplier `(L+1)^1.6` · **Charm** persistent passive (Balatro Joker analogue) · **Pledge** weekly contract card · **Mogul** parody boss · **Renown** lifetime Mogul kills · **Run** one calendar week, Monday 00:00 UTC.

---

## Requirements

### Requirement 1: GitHub App ingestion

**User Story:** As a player, I want the game to learn about my pull requests automatically through a read-only GitHub App, so that I never paste tokens and the App can never change anything on GitHub.

#### Acceptance Criteria

1. THE GitHub App SHALL request exactly the permissions `Pull requests: Read` and `Metadata: Read` and subscribe to exactly the events `pull_request`, `pull_request_review`, `pull_request_review_comment`, `installation`, `installation_repositories`.
2. WHEN a webhook delivery arrives THEN the ingest service SHALL verify `X-Hub-Signature-256` with a timing-safe comparison before parsing the body.
3. IF the signature header is missing or does not match THEN the ingest service SHALL respond 401 and SHALL write nothing.
4. IF the request body exceeds 256 KB THEN the ingest service SHALL respond 413 and SHALL write nothing.
5. WHEN a delivery with an already-seen `X-GitHub-Delivery` id arrives THEN the ingest service SHALL respond 200 and SHALL produce no new state change.
6. THE ingest service SHALL expire dedupe records after 7 days.
7. WHEN an `installation` or `installation_repositories` event arrives THEN the ingest service SHALL upsert the installation's account id and repository ids, and on `installation.deleted` SHALL remove that mapping.

### Requirement 2: Player identity and attribution

**User Story:** As a player, I want to sign in with GitHub once, so that activity performed by my account is credited to my character and nobody else's activity is.

#### Acceptance Criteria

1. THE api service SHALL implement the GitHub App user-authorization flow with a server-generated single-use `state` nonce that expires after 10 minutes.
2. WHEN the OAuth code is exchanged THEN the api service SHALL fetch the user's numeric id and login and SHALL discard the access token without persisting it.
3. THE api service SHALL issue an HS256 JWT with 7-day expiry carrying `sub` (numeric GitHub id), `iss` and `aud`, and SHALL verify all three on every authenticated request.
4. WHEN a player signs in THEN the api service SHALL refresh the player's accessible installation ids via `GET /user/installations`.
5. WHEN a scoring event's actor id does not match any signed-in player THEN the ingest service SHALL drop the event before any database write and SHALL increment a `dropped_unlinked` metric.
6. WHEN a scoring event's installation is not in the actor's accessible installation list THEN the ingest service SHALL drop the event.
7. IF the actor's `type` is `Bot` or the login ends with `[bot]` THEN the ingest service SHALL award no points to that actor, while still allowing a human merger or reviewer of the same PR to be credited.

### Requirement 3: Metadata-only storage

**User Story:** As a player at a company with private code, I want the game to store only counts and timestamps, so that installing it exposes nothing sensitive.

#### Acceptance Criteria

1. THE system SHALL persist for a PR only: installation_id, repo_id, repo_private, pr_number, author_id, opened_at, merged_at or closed_at, merged, merged_by_id, additions, deletions, changed_files, commits, review_round_count, reviewer_ids, draft, base_ref_is_default.
2. THE system SHALL persist for a review only: pr_key, reviewer_id, state, submitted_at, inline_comment_count.
3. THE system SHALL NOT persist PR titles, bodies, comment text, file paths, diffs, or names of private repositories.
4. WHEN the owner views a private repository's events THEN the client SHALL fetch the display name live from GitHub and SHALL NOT cache it server-side.
5. THE test suite SHALL include a schema test that fails when any attribute outside the allowed set is written to a `PR#` or `EVT#` item.
6. THE system SHALL log errors only, SHALL never log webhook payloads, and SHALL refer to users in logs by numeric id only.

### Requirement 4: Scoring

**User Story:** As a player, I want every XP grant to follow a published formula I can audit, so that I trust the number and understand how to improve it.

#### Acceptance Criteria

1. THE scorer SHALL be a pure function `(event, playerState, prState, now) → ScoreResult` in a shared package with no I/O, usable from both Lambda and the browser.
2. THE scorer SHALL award Points per event exactly as design.md §4.2: opened 10 (max 5 per UTC day), merged 90, size `round(40·log2(1+(additions+deletions)/50))` capped at 120, party bonus 30, approve or changes-requested review 40 (max 2 per PR per reviewer), comment-only review 15 (max 1 per PR per reviewer), inline comment 5 (max 10 per PR per reviewer), verified kill 25, riposte 15, daily first event 20, weekly streak 50 × consecutive weeks capped at 10.
3. IF a merged PR has `merged_by_id == author_id` and no reviews by other humans THEN the scorer SHALL halve the merge, size and party points.
4. IF a PR's base ref is not the repository default branch THEN the scorer SHALL halve all its points.
5. THE scorer SHALL compute `Power = 1 + Σ(active Charm powers) + Σ(equipped gear power, incl. set bonus) + active Pledge bonus + Feat bonus`, capped at 9, starting at 1 for a new character.
6. THE scorer SHALL compute `Zone = (L+1)^e` where L is the character level at scoring time and e is 1.6, or 1.65 when the Overclock voucher is owned.
7. THE scorer SHALL compute `XP = floor(Points × Power × Zone)` and SHALL credit it to both character XP and the skill named in design.md §4.2.
8. THE ScoreResult SHALL include an ordered breakdown of every contributing term (label, value) sufficient to render the Combat Log expansion.
9. WHEN the worked examples in design.md §4.5 are run THEN the scorer SHALL reproduce them exactly.
10. THE shared package SHALL have ≥95% line coverage and 100% branch coverage on the scorer.
11. WHEN an event is scored THEN the scorer SHALL also emit the supplies drop for that event per game-design.md §6.1, independent of Power.

### Requirement 5: Levelling

**User Story:** As a player, I want levels to follow Diablo II's table and skills to work like Old School RuneScape, so that progress feels familiar and level 99 means something.

#### Acceptance Criteria

1. THE system SHALL derive character level from cumulative XP using the exact 99-row Diablo II table in research.md §2, and SHALL cap level at 99 while continuing to accumulate XP.
2. THE system SHALL maintain four skills, Smithing, Vigilance, Oratory and Endurance, each with its own XP on the same table, and SHALL report total level as their sum.
3. WHEN a run rolls over THEN the system SHALL recompute Vocation from skill XP share in this precedence: Smith if Smithing ≥55%, Warden if Vigilance ≥55%, Herald if Oratory ≥35%, Pilgrim if Endurance ≥25%, otherwise Journeyman.
4. THE client SHALL render gear tier from character level: 1 Rags, 10 Leather, 30 Iron, 50 Mithril, 70 Rune, 90 Dragon, 99 Trimmed.

### Requirement 6: Weekly run

**User Story:** As a player, I want each week to be a short run with three rising targets, so that I have a reason to come back without any timers or penalties.

#### Acceptance Criteria

1. WHEN Monday 00:00 UTC passes THEN the rollover job SHALL create the week's run with act targets, the week's Mogul, a drawn Pledge hand of 5, and a seeded RNG for shop stock.
2. THE run SHALL have three acts in order, Scout, Raid, Boss, with targets of 60%, 100% and 150% of the player's 8-week median weekly XP.
3. IF the player has fewer than 3 weeks of history THEN the targets SHALL be based on a flat 2,000 XP.
4. THE targets SHALL never exceed 2× the previous week's actual XP.
5. WHEN weekly XP crosses the current act's target THEN the system SHALL clear that act immediately, pay its gold, open the shop, and make the next act current; acts SHALL NOT be skipped.
6. IF the week ends with an act uncleared THEN the system SHALL apply no penalty.
7. WHEN the Boss act clears THEN the system SHALL increment Renown by 1, and SHALL offer a Legendary Charm on every 4th Renown.
8. THE client SHALL change biome every 8 Renown in the order Town, Sewers of Legacy, Flaky Marsh, Dependency Mines, Release Peaks, The Rebase Abyss.

### Requirement 7: Moguls

**User Story:** As a player, I want the weekly boss to be a funny caricature with a rule twist, so that each week plays differently and nudges me toward good habits.

#### Acceptance Criteria

1. THE system SHALL implement the six Moguls and their modifiers exactly as design.md §6.2: The Rocket Man, The Leather Jacket, The Turtleneck, The Hoodie, The Founder, The Two-Pizza Boss.
2. THE rollover job SHALL pick one Mogul per week without repeats until all six have appeared, then reshuffle.
3. THE client SHALL show the week's Mogul and modifier from Monday.
4. THE Mogul modifier SHALL apply only to events scored during the Boss act window, except modifiers whose text says "this week" which apply from Monday.
5. THE codebase, assets and copy SHALL contain no real person's name, likeness, company name or logo; the Bestiary SHALL display the satire disclaimer from design.md §6.2.

### Requirement 8: Gold and Shop

**User Story:** As a player, I want to spend gold I earned by shipping in a Balatro-style shop, so that I can shape my build.

#### Acceptance Criteria

1. THE system SHALL grant gold only from: 1 per 10 points scored, act-clear payouts of 20 (Scout), 40 (Raid), 100 (Boss), and interest of 1 per 25 gold held at each act clear capped at 10 (20 with Deep Pockets).
2. THE system SHALL provide no other gold source and no real-money purchase.
3. WHEN an act clears THEN the shop SHALL stock 2 Charms (rarity weights Common 70, Uncommon 22, Rare 7, Legendary 1), 2 Packs drawn from Pledge pack 60g, Charm pack 100g, Mogul cosmetic pack 50g, and 1 Voucher not yet owned.
4. THE shop SHALL price Charms at 40, 70, 120, 250 by rarity, re-rolls at 20 rising by 10 per re-roll within a visit (base 10 with Cheaper Re-rolls), Pledge removal at 50, and SHALL buy back any Charm at half its price.
5. THE shop stock SHALL be generated server-side from the week's seeded RNG so that reloads do not change it.
6. WHEN a purchase is attempted THEN the api service SHALL perform a conditional write that fails if gold is insufficient or the item is already sold.
7. WHEN a pack is opened THEN the client SHALL show 3 options and the player SHALL keep exactly 1.
8. THE shop SHALL remain open from an act clear until the next act clears or the run ends.

### Requirement 9: Charms, Pledges, Vouchers

**User Story:** As a player, I want persistent Charms, weekly Pledge cards and one-time Vouchers, so that there are meaningful choices between weeks.

#### Acceptance Criteria

1. THE system SHALL implement the nine Charms in design.md §6.3 (as audited in game-design.md §8.3) with their conditions and power values, 5 slots by default, a 6th with the Charm Belt voucher; a duplicate SHALL stack once and a third copy SHALL be auto-sold.
2. THE system SHALL start each character with the deck Strike, Defend, Big Game Hunter, Mentor, Tidy, and SHALL cap the deck at 20.
3. WHEN a run begins THEN the system SHALL draw 5 Pledges; the player MAY play up to 3 until Tuesday 23:59 UTC, after which the top 3 undrawn SHALL auto-play.
4. WHEN any event is scored THEN the system SHALL evaluate Pledge progress and SHALL apply each completion bonus at most once per week.
5. THE system SHALL implement the six Vouchers in design.md §6.5, each buyable once, priced 150 + 50 per voucher already owned.
6. WHEN Overclock is bought THEN the Zone exponent SHALL change to 1.65 for events scored afterwards only.

### Requirement 10: Client

**User Story:** As a player, I want a pixel-art, glanceable UI that explains every number, so that I can check progress in five seconds and understand it in thirty.

#### Acceptance Criteria

1. THE client SHALL provide the screens Landing, Town, Shop, Combat Log, Character, Run Map, Bestiary, Expedition, Forge, Feats, Settings, Privacy and Terms, with a left rail at ≥768px and bottom tabs below.
2. THE Combat Log SHALL render each XP grant as one row (monster sprite, repository shown to the owner only, one-line summary, XP) that expands to the full Points × Power × Zone breakdown from the ScoreResult.
3. THE client SHALL require no player action for XP progression; the only write operations SHALL be shop purchases, pack picks, Pledge plays, Charm sells, expedition send/collect, Forge job start/collect, gear equip, Feat display selection, export and delete.
4. THE client SHALL render sprites from 16×16 palette-indexed definitions at integer scales with crisp edges, palette-swapping the hero per gear tier.
5. THE client SHALL use real text for all copy, show visible focus states, honour `prefers-reduced-motion`, and keep body text contrast ≥4.5:1.
6. WHEN the player has no installations THEN Town SHALL show the install call to action; WHEN the player has installations but no events THEN Town SHALL show the sleeping character with the line "Merge something. I'll wake up."
7. THE client SHALL render every screen from a fixture state without network access in tests.

### Requirement 11: Badge

**User Story:** As a player, I want a README badge, so that my level is visible on my profile without exposing anything else.

#### Acceptance Criteria

1. WHEN `GET /badge/{login}.svg` is requested THEN the api service SHALL return an SVG showing only level, vocation and Renown with `Cache-Control: public, max-age=21600`.
2. THE badge path SHALL be served through CloudFront in front of the api Function URL.
3. IF the login is unknown THEN the service SHALL return a neutral "unranked" badge with the same caching.

### Requirement 12: Platform and security

**User Story:** As the operator, I want one deployable stack that costs nothing at personal scale and has a small blast radius, so that I can run it indefinitely.

#### Acceptance Criteria

1. THE infrastructure SHALL be one SAM template containing: `ingest` Lambda with Function URL, `api` Lambda with Function URL, CloudFront distribution for the badge path, one DynamoDB table in provisioned mode at 5 RCU / 5 WCU with TTL and one GSI on login, SSM SecureString parameters for the App private key, webhook secret, OAuth client secret and JWT key, an EventBridge rule at Monday 00:05 UTC invoking rollover, log groups with 14-day retention, and AWS Budget alarms at $1 and $10.
2. THE `ingest` role SHALL be limited to PutItem, GetItem, UpdateItem and Query on the table plus SSM GetParameter and CloudWatch Logs; THE `api` role SHALL additionally have DeleteItem.
3. THE Function URL for `api` SHALL allow CORS only from the GitHub Pages origin and the handler SHALL re-check `Origin`.
4. THE Lambdas SHALL have reserved concurrency of 10 (`ingest`) and 5 (`api`).
5. THE JWT key SHALL be read from SSM at cold start and re-read every 15 minutes so rotation needs no redeploy.
6. THE client SHALL be deployed to GitHub Pages by GitHub Actions with a CSP of `default-src 'self'; connect-src {api-origin}; img-src 'self' data:; font-src https://fonts.gstatic.com; style-src 'self' https://fonts.googleapis.com`.
7. THE deployment SHALL use GitHub Actions OIDC to AWS with no long-lived AWS keys in the repository.

### Requirement 13: Export and deletion

**User Story:** As a player, I want to export or delete everything in one click, so that I stay in control of my data.

#### Acceptance Criteria

1. WHEN the player requests export THEN the api service SHALL return a JSON document containing every item under their `USER#` partition.
2. WHEN the player confirms deletion THEN the api service SHALL delete every `USER#` item and any `PR#` item whose only referenced actor is that user, and the next login SHALL create a fresh level-1 character.
3. THE Privacy page SHALL state in plain language: no code is read; counts and timestamps only; export and delete are available; activity from people who have not signed in is discarded; the game is not a performance-review tool.

### Requirement 15: Supplies and Expeditions

**User Story:** As a player, I want my work to produce supplies that I spend sending my character on timed expeditions, so that there is something happening while I'm away and a reason to come back tomorrow.

#### Acceptance Criteria

1. WHEN an event is scored THEN the system SHALL bank supplies per game-design.md §6.1 (Ore, Timber, Lore, Ink, Provisions, Flux) with no cap and no decay.
2. THE system SHALL allow the player to send the character on one expedition at a time to an unlocked region for 4, 12, 24 or 48 hours, paying Provisions 1/2/4/6; the 4-hour Forage SHALL always be available free.
3. THE system SHALL unlock regions by Renown per game-design.md §6.2 (Koko Woods 0, Crossroads of Wix 2, Orrl Falls 8, Silverhall 16, Koko Deep Woods 24, Mazu Deep 32, Quu Spire 48, The Garbage Collector 64).
4. WHEN an expedition is sent THEN the api service SHALL store a seed on the `EXPEDITION#` item and SHALL roll loot from that seed on collection, so repeated requests return identical loot.
5. WHEN an expedition's return time passes THEN the character SHALL be shown as returned with uncollected loot; collection SHALL be an explicit player action and SHALL never expire.
6. THE system SHALL NOT auto-send expeditions, except the single onboarding expedition to Koko Woods after the first scored event.
7. THE loot tables SHALL yield per expedition 3 to 6 items from materials, gear for the region's lean slot, Charm packs, pets (rare) and region uniques (very rare), with longer durations yielding more items at diminishing rates per Provision.
8. AN expedition in progress SHALL NOT block or alter scoring of real events.

### Requirement 16: Forge, gear and pets

**User Story:** As a player, I want to turn supplies into gear that changes how my character looks and slightly how it scores, so that my build is visible.

#### Acceptance Criteria

1. THE system SHALL provide five gear slots (Weapon, Body, Cape, Trinket, Pet) with tiers and Power contributions per game-design.md §7.1, a full-set bonus of +0.25, and one optional affix per piece from Keen, Stout, Quick, Lucky, Hoarder.
2. THE system SHALL provide three Town stations (Forge, Loom, Scriptorium) that each run one job at a time with the durations and inputs in game-design.md §7.2; finished jobs SHALL wait for collection without loss.
3. THE Scriptorium SHALL apply affixes using Flux and SHALL name Reclaimed uniques with a generated "former owner" string drawn from a curated list, never from real GitHub logins.
4. WHEN gear is equipped THEN the character sprite SHALL reflect the highest equipped tier and the equipped cape colour, and the scorer SHALL include its Power contribution for subsequent events only.
5. THE system SHALL implement at least six pets with one small passive each per game-design.md §7.3; pet passives SHALL never grant XP or gold directly.
6. THE station upgrades (Bellows, Dyes, Index) SHALL be purchasable once each with the listed supplies.

### Requirement 17: Feats

**User Story:** As a player, I want achievements that measure the scale and craft of my real work and reward me with gear and titles I can show, so that the game reflects what I am proud of.

#### Acceptance Criteria

1. THE system SHALL implement the Feats in game-design.md §8.2 (at least the 40 marked for v1 in tasks.md) as `{id, name, hidden, hint, condition, reward}` evaluated on every scored event against rolling counters (30-day window, lifetime, per-repo first-merge dates, local-time buckets).
2. THE Scale Feats SHALL count only merged PRs that received at least one approval from a different human account.
3. THE Feat rewards SHALL be titles, unique gear or pets, and for designated Feats a +0.1 Power Feat bonus capped at +0.5 in total; Feats SHALL never grant gold or XP.
4. WHEN a Feat unlocks THEN the system SHALL write a `FEAT#` item recording the unlocking event id, and the client SHALL show a persistent banner until dismissed.
5. THE client SHALL show visible Feats with progress bars, hidden Feats as "???" with their hint, and SHALL allow the player to pin up to three Feats to the character sheet and badge.
6. THE Feats SHALL count only activity after character creation; backfilled history SHALL never unlock a Feat.
7. THE badge (Requirement 11) SHALL additionally render the pinned Feats' icons.

### Requirement 18: Quality and repository

**User Story:** As the operator, I want the project public and verifiable, so that colleagues can audit the scorer and the App's permissions.

#### Acceptance Criteria

1. THE repository SHALL be a single pnpm workspace with packages `shared`, `backend`, `client`, `infra`, all TypeScript strict.
2. THE CI SHALL run `pnpm lint`, `pnpm test` and `pnpm build` on every pull request and SHALL fail on coverage below the thresholds in Requirement 4.10.
3. THE backend handlers SHALL be covered by fixture-driven integration tests against DynamoDB Local using recorded GitHub webhook payloads.
4. THE repository SHALL be MIT licensed and its README SHALL link the App manifest, the scorer, Privacy and Terms.
