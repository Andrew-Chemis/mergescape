# Mergescape — an idle RPG powered by your real code review work

*Spec v0.1 · 2026-11-06 · decisions made deliberately; change any of them, but each has a reason.*

**One line:** A browser idle RPG (OSRS / Idlescape / Walkscape feel) where the only way to gain XP is to open, review and merge real pull requests. A read-only GitHub App feeds events into a transparent scorer (points × power × zone) on top of Diablo II's exact 1–99 experience table. Each week is a Slay-the-Spire-style run of three acts with a Balatro Shop between them and a parody tech-mogul Boss at the end.

---

## 1. Decisions at a glance

| Area | Decision | Why |
|---|---|---|
| Platform | Static web app (GitHub Pages) + 2 AWS Lambdas + 1 DynamoDB table | $0/month at personal scale; no servers to patch |
| Integration | **GitHub App**, read-only: `Pull requests: Read`, `Metadata: Read` | Narrowest possible scope; webhooks push events so no polling, no PATs |
| Identity | GitHub App user authorization (OAuth) → signed session token | One identity for "who is this character" and "whose PRs count" |
| Data stored | PR/review **metadata only** (ids, logins, counts, timestamps). Never code, diffs, titles, bodies or comment text | Privacy, tiny storage, nothing worth stealing |
| Level curve | Diablo II's actual Experience table, levels 1–99 | Authentic; 99 is a years-long prestige like D2 |
| XP scaling | Score per event × `(L+1)^1.6` (your level L), like D2 monster-level scaling | D2's table only works if rewards scale with the zone you farm |
| Scoring | `Points × Power × Zone`. Points from the event, Power from collected Charms (Balatro's Jokers), Zone from your level | Makes "why did I get 4,310 XP" readable and fun |
| Economy | Balatro's Shop between acts: Charms, Pledge packs, Vouchers, re-roll, all bought with gold that only shipping earns | The shop is where Balatro's decisions live; gold is the player's agency |
| Weekly loop | Slay the Spire run: 3 Acts (Scout / Raid / Boss) with XP targets, a Shop after each act, Boss modifiers | Gives idle play a weekly arc and a reason to come back |
| Bosses | Parody tech-CEO archetypes (The Rocket Man, The Leather Jacket…), never real names or likenesses | Funny, recognisable, and no takedown or defamation exposure |
| Player agency | Light: pick rewards, play up to 3 Pledge cards per week. Never required; auto-resolves | Idle game first, deckbuilder second |
| Classes | None at creation. A Vocation title emerges from your skill ratio | Nobody wants to pick "Reviewer" on day 1 and regret it |
| Anti-exploit | Merge-weighted, LoC log-capped, per-PR caps, bot exclusion, party bonus | Agentic power users open a lot; the merge is the proof |
| v1 scope | Solo character, private profile, public badge | Leaderboards invite gaming; ship the fun first |

---

## 2. Core fantasy and loop

You are an adventurer in **Mergescape**, a pixel-art world drawn in the Gielinor idiom. Pull requests are monsters that wander out of the Dungeon of Main. Reviews are your sword, approvals are the killing blow, inline comments are arrows.

The game cannot be played without real work. Open the tab, and your character is simply standing in Town. Merge a PR at work and, within seconds, the character walks to the dungeon, fights a **Merge Goblin**, and a score ticker rolls:

```
Merged PR #412 (+318 / -97, 2 reviewers)
  Points   100  base merge
        +  52  size (log-scaled)
        +  30  reviewed by another human
  ────────────
         182  × Power 3.5  (Rubber Duck +1.5, Lantern +1.0)
         637  × Zone 41.6  (Level 23)
  ────────────
  26,499 XP   → Smithing 24!
```

**Idle rhythm.** One tab-open per day is plenty. The weekly run resolves whether or not you watch. Nothing decays. There is no energy, no timers, no streak punishment (streaks only add).

---

## 3. GitHub integration

### 3.1 Why a GitHub App and not OAuth tokens or PATs

* A GitHub App has **its own identity**, fine-grained permissions, and **pushes webhooks**, so we never poll and never hold a user's broad token.
* Installation is per org/repo, so the user (or their admin) decides exactly which repos feed the game.
* Tokens are short-lived (1 hour installation tokens, minted only if we ever need to read, e.g. backfill).

### 3.2 Permissions and events

| Permission | Level | Needed for |
|---|---|---|
| Pull requests | Read | `pull_request`, `pull_request_review`, `pull_request_review_comment` webhooks; optional backfill via REST |
| Metadata | Read | Mandatory for every App |

Subscribed webhook events: `pull_request` (actions `opened`, `closed`, `ready_for_review`, `synchronize`), `pull_request_review` (`submitted`), `pull_request_review_comment` (`created`). `installation` / `installation_repositories` to track where the App lives.

Deliberately **not** requested: Contents, Issues, Discussions, Members, write anything. Issue-comment XP (`issue_comment` needs `Issues: Read`) is deferred to v1.1 and will be opt-in per installation.

### 3.3 Linking a player to events

1. Player clicks **Sign in with GitHub** → App user-authorization flow (`/login/oauth/authorize` with the App's client id, `state` nonce stored server-side, code exchanged in Lambda). We store the numeric GitHub `user.id` and `login`, nothing else from the profile.
2. Player installs the App on the repos they want counted (GitHub's install page; we deep-link to it after sign in).
3. Every webhook carries `sender.id`, `pull_request.user.id`, `review.user.id`. An event credits a player only if that numeric id matches a signed-in player **and** the installation is one they can see (installation-to-user mapping stored on `installation` events, refreshed on login via `GET /user/installations`).

Nothing is credited for repos without the App. If a teammate installs it on a shared repo, your reviews there count once you sign in; theirs never show on your profile.

**PR metadata vs. player credit.** `PR#` items are shared facts, not credit. They are written when the PR's author, merger or the acting reviewer is a linked player, and they record every *human* review on that PR as `(reviewer_id, state)` even when the reviewer has never signed in, because the party bonus, solo-kill and Riposte rules depend on knowing a review happened. What is dropped for unlinked actors is the scoring: no `EVT#` row, no XP. Bot reviews are never recorded.

### 3.4 Stored fields (complete list)

```
PR:      installation_id, repo_id, repo_private(bool), pr_number, author_id,
         opened_at, merged_at|closed_at, merged(bool), merged_by_id,
         additions, deletions, changed_files, commits, review_round_count, sync_count,
         draft(bool), base_ref_is_default(bool)
Review:  pr_key, reviewer_id, reviewer_is_bot(bool), state(APPROVED|CHANGES_REQUESTED|COMMENTED),
         submitted_at, inline_comment_count
(Per-reviewer caps are derived from the review records, not stored separately.)
```

No titles, bodies, file paths, or comment text. Repo *names* are shown to the owner only, fetched live from GitHub when the owner is logged in (never persisted for private repos). The numeric `repo_id` is enough for the game.

### 3.5 Backfill (v1.1)

On first install, an optional **Ancient Tomes** import reads the last 90 days of merged PRs/reviews with an installation token and scores them at **50% points, Power 1, no Charms**. Gives a returning dev a level ~15–25 start without making fresh progress feel pointless.

---

## 4. Scoring

### 4.1 Research basis for weights

* LinearB's 2026 benchmark (≈2.7M PRs, 83k developers): top-decile orgs merge **≈2.6 PRs per developer per week**; autonomous-agent PRs merge within 30 days only **79%** of the time vs **92%** for human-only PRs.
* Microsoft's 2026 field study: engineers using CLI coding agents 5+ days/week merged **>50% more PRs**; another report puts heavy users at roughly **44 merged PRs/month (≈10/week)**.
* A 2026 study of agent introduction: **+30% LoC, +20% commits, +23% PRs**. LoC inflates faster than merges.

Therefore an **agentic power user** is modelled as ≈10–15 merged PRs/week, 15–30 reviews/week, with large diffs. Implications:

1. **Merge is the scoring event.** Opening is a small down payment. Unmerged PRs never pay out the rest.
2. **LoC is log-scaled and capped**, so a 4,000-line agent dump is worth ~2× a 300-line PR, not 13×.
3. **Reviewing is weighted close to authoring.** The game is about review; a reviewer approving another person's PR should feel as good as merging their own.
4. **Human-in-the-loop is rewarded** ("party bonus"), matching the merge-rate data: PRs with another human approval merge far more reliably.

### 4.2 Points (base score per event)

| Event | Points | Skill credited | Notes / caps |
|---|---|---|---|
| PR opened (non-draft, to default branch) | 10 | Smithing | Max 5 opens/day earn points; drafts earn on `ready_for_review` |
| PR merged (yours) | 90 | Smithing | Plus size points below; `merged_by == author` and zero other reviews → ×0.5 ("solo kill") |
| Size points on merge | `round(40 · log2(1 + (adds+dels)/50))`, cap 120 | Smithing | 50 LoC → 40, 300 → 112, 1000+ → 120 (cap) |
| Party bonus | +30 per merge | Smithing | ≥1 APPROVED review from a different human account |
| Review: APPROVED or CHANGES_REQUESTED | 40 | Vigilance | Max 2 scoring reviews per PR per reviewer (re-review counts once) |
| Review: COMMENTED | 15 | Vigilance | Max 1 per PR per reviewer |
| Inline review comment | 5 | Oratory | Cap 10 per PR per reviewer (50 points) |
| Verified kill | +25 | Vigilance | A PR you approved later merges |
| Riposte | +15 | Smithing | Your PR received CHANGES_REQUESTED and then merged (you addressed feedback) |
| PR closed unmerged | 0 | — | Never penalised anywhere: closing a PR is healthy |
| Daily first-event | +20 | Endurance | Once per UTC day |
| Weekly streak | +50 × consecutive weeks (cap 10) | Endurance | Awarded at run end if ≥1 merged or ≥3 reviews that week |

Excluded entirely: any account whose login ends in `[bot]` or whose `type` is `Bot`; PRs to non-default branches are 50% (stacked-PR friendly, not zero); forks count normally.

### 4.3 Power

`Power = 1 + Σ(active Charm powers) + Σ(equipped gear power incl. set bonus) + Pledge bonus + Feat bonus`. New characters have Power 1. A typical 6-month character holds 4–6 Charms and a Silver or Mithril set for Power ≈ 3–4.5. Budget: Charms up to +4, gear up to +2.25, Pledges +1, Feats +0.5. Power is capped at 9. See game-design.md §7.1.

### 4.4 Zone multiplier (Diablo scaling)

`Zone(L) = (L + 1)^1.6`, where L is your **character level** at the moment of the event.

`XP = floor(Points × Power × Zone(L))`. Character XP and the credited Skill both receive it.

### 4.5 Worked examples

| Situation | Points | Power | Level | XP |
|---|---|---|---|---|
| First merged PR, 120 LoC, solo | (90+71)×0.5 = 80 | 1 | 1 | 80 × 1 × 3.03 = **242** (48% to level 2) |
| Merged 300 LoC PR, approved by teammate, lvl 23 | 90+112+30 = 232 | 3.5 | 23 | 232×3.5×161.56 = **131,187** |
| Approve a PR, lvl 23 | 40 | 3.5 | 23 | 40×3.5×161.56 = **22,618** |
| Approve + 6 inline comments, lvl 60 | 40 + 30 | 5 | 60 | 70×5×718.67 = **251,529** (next level needs 11M) |

---

## 5. Levelling

### 5.1 Character level: Diablo II table (exact)

Cumulative XP to reach each level, from the Diablo II Lord of Destruction Experience table. Stored as a constant; never recomputed.

```
L2 500          L10 57,715        L20 537,513        L30 4,663,553
L40 17,270,791  L50 47,116,709    L60 117,772,849    L70 285,041,630
L80 681,027,665 L90 1,618,470,619 L99 3,520,485,254
```
(Full 99-row table goes in `shared/d2table.ts`; the last step 98→99 is 291,058,498.)

### 5.2 Skills (OSRS flavour, same D2 table each)

| Skill | Fed by | Icon |
|---|---|---|
| **Smithing** | Authoring: opens, merges, size, riposte | Anvil |
| **Vigilance** | Reviews, verified kills | Eye on a shield |
| **Oratory** | Inline comments | Speech scroll |
| **Endurance** | Daily/weekly streaks | Boot |

**Total level** (OSRS style) = sum of the four. Character level is separate, from total XP. Skill capes at 99.

**Vocation** (title, recomputed weekly from skill XP share): Smith (≥55% Smithing), Warden (≥55% Vigilance), Herald (≥35% Oratory), Pilgrim (≥25% Endurance), otherwise **Journeyman**. Titles are cosmetic plus a themed Charm offer.

### 5.3 Pacing (simulated with the exact table, exponent 1.6)

Weekly points: power user ≈ 2,000 (12 merges + 20 reviews + misc), casual ≈ 500 (3 merges + 5 reviews).

| Milestone | Power user, avg Power 2.5 | Casual, avg Power 1.5 |
|---|---|---|
| Level 10 | 2 weeks | 6 weeks |
| Level 30 | 8 weeks | ~1 year |
| Level 50 | 7 months | ~5 years |
| Level 70 | 1.8 years | — |
| Level 80 | 3.3 years | — |
| Level 90 | 6 years | — |
| Level 99 | ~11 years | — |

Power grows as Charms accumulate, so real pace is somewhat faster than the table. 99 is intentionally mythic, exactly as in D2. If this feels too slow after a month of real data, the single knob is the exponent (1.8 roughly halves every milestone).

---

## 6. The roguelike layer (Slay the Spire × Balatro)

### 6.1 The weekly Run

Monday 00:00 UTC a new **Run** begins on a 3-act map. Your real events move you along it automatically. Each act has an XP **target**; clearing it opens the **Shop** (6.5) and advances you to the next act.

| Act | Window | Target | Clear it → |
|---|---|---|---|
| Act I — **Scout** | Mon–Tue | 60% of your 8-week median weekly XP | Gold + Shop visit |
| Act II — **Raid** | Wed–Thu | 100% | Gold + Shop visit + 1 free Pledge pack |
| Act III — **Boss** | Fri–Sun | 150%, with a Boss modifier | Gold ×3 + Shop visit + **Renown +1** + Legendary offer every 4th Renown point |

New players use a flat 2,000 XP target until they have 3 weeks of history. Targets never exceed 2× the previous week's actual, so a vacation week doesn't wreck you. Missing a target costs nothing; you just don't get that act's gold and shop visit, and the run ends there.

**Renown** is your lifetime count of Moguls beaten, one point per Boss clear. It is the number people compare on the badge. Every 8 Renown unlocks a new biome (Town → Sewers of Legacy → Flaky Marsh → Dependency Mines → Release Peaks → The Rebase Abyss).

### 6.2 Bosses: the Moguls

Act III's boss is one of six **Moguls**, parody archetypes of tech executives. They are drawn as exaggerated pixel caricatures with invented names and no real names, photos, logos or company references anywhere in the game. Each brings a modifier that is a joke about the archetype and also nudges a healthy habit. One Mogul per week, drawn without repeats until all six have appeared.

| Mogul | Look | Modifier | The joke |
|---|---|---|---|
| **The Rocket Man** | Silver flight suit, tiny rocket on his back, 3 am energy | *Hardcore week.* Deletions count double toward size points; merges with net negative lines get +1 Power | "The best part is no part." Deletes code, ships rockets |
| **The Leather Jacket** | Black leather jacket, grey hair, holding a glowing green brick | *The more you merge, the more you save.* Each successive reviewed merge this week adds +0.1 Power (cap +1.5); a solo merge resets the chain | Keynote catchphrase; compounding hardware demand |
| **The Turtleneck** | Black turtleneck, round glasses, jeans, one hand raised | *One more thing.* PRs under 100 LoC score ×3; over 400 LoC score ×0.5; an approval you give with exactly one inline comment is a "design review" and scores ×2 | Obsession with small, perfect things |
| **The Hoodie** | Grey tee, hoodie, VR goggles pushed up on forehead | *Move fast.* PRs merged within 48 hours of their first review score ×2; everything else ×0.75 and goes to the Metaverse | Move fast; nobody is in the metaverse |
| **The Founder** | Grey crewneck, serene smile, cradling a glowing orb | *Non-profit to for-profit.* Points ×0.5 but gold ×4 all week. On Wednesday the Board "removes" one random Charm; it returns on Friday with +0.25 Power | The orb is "AGI". The Charm comes back stronger |
| **The Two-Pizza Boss** | Bald, open-collar shirt, stack of pizza boxes, laughing | *Two-pizza teams.* Merges with ≥2 distinct human reviewers score ×2.5; solo merges ×0.25; party bonus points ×3 | Teams small enough to feed with two pizzas; also, day one |

Modifiers are revealed Monday so you can plan Pledges around them. No modifier ever penalises closing a PR unmerged or rewards the hour of day (see game-design.md §8.3). The former dungeon bosses (Release Dragon, Silent Monolith) are now **elites** that can appear in Act II.

A one-line disclaimer sits in the Bestiary: *"The Moguls are fictional caricatures. Any resemblance to persons living, dead or on a podcast is satire."*

### 6.3 Charms (Balatro Jokers)

Persistent passives; you hold up to 5 (a 6th slot comes from the Charm Belt voucher). Rarity: Common (+0.25 Power), Uncommon (+0.5), Rare (+1.0), Legendary (+2.0 or a rule change). Charms are **bought in the Shop** (6.5) or granted by a Boss clear; duplicates stack once, then sell for half price. Selling is always possible, as in Balatro, so a build can be re-rolled over a few weeks.

| Charm | Rarity | Effect |
|---|---|---|
| Rubber Duck | Common | +0.25 Power; +0.25 more on reviews with ≥3 inline comments |
| Lantern | Common | +0.5 Power on the first scored event of each day |
| Small Hands | Uncommon | Merges under 150 LoC gain +0.75 Power |
| Second Pair of Eyes | Uncommon | Party bonus points 30 → 60 |
| Hot Potato | Rare | Approving a PR under 200 lines within 2 hours of its open: +1.5 Power |
| Grey Beard | Rare | +1.0 Power on any PR to a repo you've merged ≥50 times in |
| Jester's Rebase | Legendary | Riposte points ×4; CHANGES_REQUESTED reviews you give also grant Riposte |
| Loaded Dice | Legendary | Once per week, one event's Power is replaced by 10 |
| Oracle | Legendary | The Boss modifier is revealed a week early and you may ban one |

### 6.4 Pledges (Slay the Spire cards)

Your deck starts with 5 basic Pledges. Each Monday you draw 5 and may **play up to 3** (auto-plays the top 3 if you never open the tab). A Pledge is a contract for the week: hit it, get the bonus; miss it, nothing happens. New Pledges come from **Pledge packs** in the Shop: open a pack, see 3 cards, keep 1 (Balatro's booster pack rule).

| Pledge | Contract | Bonus |
|---|---|---|
| Strike | Merge 3 PRs this week | +300 points on the 3rd |
| Defend | Submit 5 scoring reviews | +1 Power on all reviews for the rest of the week |
| Big Game Hunter | Review a PR ≥ 800 LoC | That review ×3 |
| Mentor | Approve 2 PRs from authors with fewer merges than you | +0.5 Power until Sunday |
| Tidy | Merge 3 PRs each under 150 lines | +200 points on the 3rd |
| Pair Up (Strike+) | Merge 3 PRs each with party bonus | +600 points |

Cards upgrade (Strike → Strike+) when chosen as a Boss reward. Deck cap 20; remove cards at the Town shrine for gold.

### 6.5 Gold and the Shop (Balatro's shop, Mergescape's Grizzled Reviewer)

**Gold** is earned only by shipping: 1 gold per 10 points scored, plus act-clear payouts (Scout 20, Raid 40, Boss 100) and interest of 1 gold per 25 held at each act clear (cap 10, Balatro's rule, rewarding savers). There is no way to buy gold. Ever.

The **Shop** opens after each act clear and stays open until the next act clears (or the run ends). Its layout copies Balatro's:

| Shelf | Stock | Price |
|---|---|---|
| **Charms** (2 slots) | 2 random Charms weighted by rarity (70/22/7/1%) | Common 40 · Uncommon 70 · Rare 120 · Legendary 250 |
| **Packs** (2 slots) | Pledge pack (see 3, keep 1) · Charm pack (see 3, keep 1) · Mogul pack (3 cosmetics) | 60 · 100 · 50 |
| **Voucher** (1 slot, one per act) | Permanent upgrades, each buyable once: Charm Belt (6th slot) · Cheaper Re-rolls · Scout's Eye (see next week's Mogul) · Deep Pockets (interest cap 20) · Shrine Pass (free Pledge removal) · Overclock (Zone exponent 1.6 → 1.65) | 150, rising 50 per voucher owned |
| **Re-roll** | New Charms and Packs | 20, +10 per re-roll this visit (resets each visit) |
| **Shrine** | Remove a Pledge from the deck | 50 |
| **Sell** | Any held Charm | Half its price |

Design notes:
* Overclock is the only voucher that touches XP math directly and is deliberately tiny; it exists so late-game players have something to save for.
* Prices are tuned so a power user (≈1,200 gold/week) can afford one Rare or two Uncommons per week; a casual player (≈300/week) buys a Common or saves for a voucher. Balatro's tension (buy now vs. earn interest) is intact.
* Everything in the shop is bought with earned gold. There is no real-money store in any version of this design.

### 6.6 Supplies and Expeditions (summary; full rules in game-design.md §6)

Every scored event also drops **supplies** (Ore, Timber, Lore, Ink, Provisions, Flux), independent of Power, banked without cap. The player spends Provisions to send the character on an **expedition** to a region for 4/12/24/48 real hours; on return a seeded loot roll yields materials, gear, Charm packs, rarely pets and uniques. Regions unlock by Renown: Koko Woods (0), Crossroads of Wix (2), Orrl Falls (8), Silverhall (16), Koko Deep Woods (24), Mazu Deep (32), Quu Spire (48), The Garbage Collector (64). Expeditions are the game's only timer and never block scoring.

### 6.7 The Forge and gear (summary; full rules in game-design.md §7)

Five gear slots (Weapon, Body, Cape, Trinket, Pet) in tiers Leather → Iron → Silver → Mithril → Rune → Dragon, each adding +0.05 to +0.40 Power, +0.25 for a full set, one affix per piece (Keen, Stout, Quick, Lucky, Hoarder). Three Town stations (Forge, Loom, Scriptorium) turn supplies into gear over 2 to 24 hours, one job each, collected whenever. Pets are cosmetic with one small passive.

### 6.8 Feats (summary; full list in game-design.md §8)

Measurement achievements over real work: Scale (a PR touching ≥1,000 files, 1M lines added in 30 days, −100k net lines lifetime), Craft (50 sub-50-line approved merges, 100 Ripostes), Endurance, World, and hidden humour entries. Scale Feats count only PRs approved by another human. Rewards are titles, unique gear or pets, and for a few a +0.1 Power bonus capped at +0.5 total. Never gold or XP. Three Feats can be pinned to the character and badge.

---

## 7. Enemies, characters, world

### 7.1 Bestiary (PRs as monsters)

The monster you fight is chosen from the PR's shape. Purely cosmetic, but it makes the Combat Log legible at a glance.

| Monster | Spawns when | Look |
|---|---|---|
| **Merge Goblin** | Any ordinary merged PR (<300 LoC) | Green imp clutching a tiny purple merge icon |
| **Nitpick Imp** | Review with ≥5 inline comments | Small red imp hurling quotation marks |
| **Flaky Test Wraith** | PR with ≥4 `synchronize` pushes before merge | Translucent ghost flickering red/green |
| **Legacy Golem** | Merged PR ≥ 1,000 LoC | Stone giant with COBOL runes |
| **Rebase Hydra** (elite) | PR with ≥3 review rounds | Three-headed serpent, each head a git branch |
| **Scope Creep** (elite) | PR open >14 days before merge | Vine monster growing out of a ticket |
| **Release Dragon** (elite) | Act II, a merge that closes ≥5 linked PRs/issues | Purple dragon curled around a v1.0.0 tag |
| **The Silent Monolith** (elite) | Act II, a PR merged with zero review of any kind | Black obelisk with a single unread notification dot |
| **The Moguls** (bosses) | Act III, one per week | See 6.2: Rocket Man, Leather Jacket, Turtleneck, Hoodie, Founder, Two-Pizza Boss |

Elites drop gold (25) and a free Charm pack on defeat.

### 7.2 Your character

A 32×32 pixel sprite in OSRS proportions. Starts in a brown tunic. Visual tiers by character level: 1 Rags → 10 Leather → 30 Iron → 50 Mithril (teal) → 70 Rune (cyan) → 90 Dragon (red) → 99 Trimmed cape. Vocation changes the held item: Smith hammer, Warden shield, Herald scroll, Pilgrim staff.

### 7.3 Town (home screen) NPCs

* **The Maintainer** (quest board / Pledges)
* **Shrine of the Rebase** (deck editing)
* **Grizzled Reviewer** (shop)
* **The Oracle** (next week's boss once you own the Charm)

---

## 8. UI / UX

### 8.1 Principles

1. **Glanceable in 5 seconds**: level, this week's act progress, last kill, whether the Shop is open.
2. **Pixel UI, modern layout**: 2× pixel sprites, 8px grid, Runescape-brown/parchment panels, but responsive flex layout and real text (not bitmap fonts) for accessibility.
3. **Nothing modal is mandatory.** Reward picks live in a tray; auto-resolve after 7 days.
4. **The Combat Log is the product.** Every XP grant is one expandable line with the Points × Power × Zone breakdown.

### 8.2 Screens (v1)

| # | Screen | Purpose | Key elements |
|---|---|---|---|
| 1 | **Landing** | Explain + sign in | Hero sprite, 3-step "Sign in → Install → Merge", privacy promise, sample log |
| 2 | **Town** (home) | Daily glance | Character + biome, act progress bar (Scout / Raid / Boss), "Last kill" card, Shop-open banner, Pledge hand |
| 2b | **Shop** | Spend gold | Balatro layout: 2 Charms, 2 Packs, 1 Voucher, Re-roll, Sell; gold and interest shown top-right |
| 2c | **Expedition** | Send and collect | Region map gated by Renown, duration picker with Provisions cost, return timer, loot reveal |
| 2d | **Forge** | Craft | Three stations with job slots, recipes from satchel, gear inventory and equip, affix application |
| 2e | **Feats** | Collection | Visible Feats with progress, hidden as ???, pin up to three |
| 3 | **Combat Log** | Verify the math | Reverse-chron list; each row = monster icon, repo (owner only), points × power × zone, XP; filter by skill/repo/week |
| 4 | **Character** | Progress | D2-style XP bar with exact numbers, 4 skill panels OSRS-style, Vocation, equipped Charms (5 slots), gear tier preview |
| 5 | **Run Map** | The week | 3-act node map (StS), current node pulsing, boss modifier card, Pledges in play |
| 6 | **Bestiary** | Collection | Grid of monsters, kill counts, "first seen" |
| 7 | **Settings** | Trust | Installations list (link to GitHub to add/remove), export JSON, delete character, timezone for Lantern and the Hoodie |
| 8 | **Share card / Badge** | Growth | `/badge/<login>.svg` (level, renown, vocation) for READMEs; PNG share card |

Navigation: left rail on desktop (Town, Log, Character, Map, Bestiary, Settings), bottom tabs on mobile. Dark mode default (dungeon), light "parchment" mode.

### 8.3 Onboarding (first 10 minutes)

1. Sign in with GitHub (one click, read-only scopes shown plainly).
2. "Install Mergescape on repos you want counted" → GitHub install page → return.
3. Town shows the character asleep under a tree with the line *"Merge something. I'll wake up."* The tab can be closed.
4. First webhook → first Merge Goblin → level 1→2 ding, a Common Charm is granted free, the Combat Log row is expanded to teach the scoring.
5. No email in v1. The GitHub badge in your README is the re-engagement loop.

### 8.4 Empty, error and edge states

* No installations yet → Town shows the Maintainer pointing at the install button.
* Event for an un-linked user → silently dropped (counted in metrics, not shown).
* Webhook replay / duplicate → idempotent on `X-GitHub-Delivery`.
* Private repo → monster shows "a private repo" unless you're logged in as owner.

---

## 9. Architecture

```
GitHub ──webhook──▶ Lambda `ingest` (Function URL) ──▶ DynamoDB `mergescape` (single table)
                      │ verify HMAC, dedupe, score, write                ▲
                                                                         │
Browser (GitHub Pages SPA) ──HTTPS──▶ Lambda `api` (Function URL) ───────┘
                                        │ OAuth callback, JWT, read-only queries, badge SVG
```

| Component | Choice | Free-tier footing |
|---|---|---|
| Frontend | Static SPA (Svelte or vanilla TS + Vite), deployed by GitHub Actions to GitHub Pages | Free |
| `ingest` Lambda | Node 22, 256 MB, Function URL (auth NONE; security is the HMAC) | 1M req + 400k GB-s/month always free |
| `api` Lambda | Node 22, 256 MB, Function URL, CORS locked to the Pages origin | Same pool |
| Database | DynamoDB, **provisioned 5 RCU / 5 WCU** (not on-demand, which bills from request one) | 25 RCU/WCU + 25 GB always free |
| Secrets | SSM Parameter Store SecureString (App private key, webhook secret, OAuth client secret, JWT key) | Standard params free |
| Logs | CloudWatch, 14-day retention | 5 GB free |
| IaC | One AWS SAM / CDK stack, deployed from GitHub Actions via OIDC (no long-lived AWS keys) | Free |
| Domain | `*.github.io` + `*.lambda-url.*.on.aws` | $0 (a custom domain adds ~$0.50/month for Route 53; optional) |

Expected monthly cost for one user, and even a few hundred: **$0.00**. Set a $1 AWS budget alarm anyway.

Scheduled work (weekly run roll-over, auto-picks) runs as an EventBridge rule → `api` Lambda, Monday 00:05 UTC. Free.

### 9.1 Single-table design (DynamoDB)

| PK | SK | Item |
|---|---|---|
| `USER#<gh_id>` | `PROFILE` | login, created, level cache, skill xp, charms[], deck[], gold, renown, settings |
| `USER#<gh_id>` | `EVT#<iso_ts>#<delivery_id>` | one scored event (the Combat Log row) |
| `USER#<gh_id>` | `WEEK#<yyyy-ww>` | run state: act, xp this week, act targets, mogul, pledges, shop stock + re-roll count |
| `USER#<gh_id>` | `EXPEDITION#<iso_ts>` | region, duration, sent_at, returns_at, seed, collected(bool), loot[] once rolled |
| `USER#<gh_id>` | `JOB#<station>` | current station job: recipe, started_at, done_at, collected(bool) |
| `USER#<gh_id>` | `FEAT#<feat_id>` | unlocked_at, unlocking event key, pinned(bool) |
| `PR#<repo_id>#<number>` | `META` | PR metadata from 3.4 (shared across users) |
| `INSTALL#<installation_id>` | `META` | account id, repo ids, suspended flag |
| `DELIVERY#<X-GitHub-Delivery>` | — | TTL 7 days, idempotency guard |
| `STATE#<nonce>` | — | OAuth state, TTL 10 min |

GSI1: `GSI1PK=LOGIN#<login>` for badge lookups.

---

## 10. Security and privacy model

| Threat | Mitigation |
|---|---|
| Forged webhooks | Verify `X-Hub-Signature-256` HMAC with timing-safe compare before parsing; reject if absent. Secret ≥ 32 random bytes in SSM |
| Replay | `X-GitHub-Delivery` idempotency item with TTL |
| XP farming via fake repos | Opens capped/day; merges require a real merge event; solo merges ×0.5; the Two-Pizza Boss zeroes them; **leaderboards are out of v1** so there's no incentive to cheat yourself |
| Bot inflation | `type: Bot` and `[bot]` logins excluded as actors; agent PRs merged by *you* still count as your merge (that's the point) |
| Token theft | No GitHub tokens are stored for users at all. The App private key lives in SSM, read at cold start, never logged. Installation tokens (backfill only) are minted on demand and discarded |
| Session theft | JWT HS256, 7-day expiry, bearer header, `aud`/`iss` checked; key in SSM, rotatable. Blast radius of a stolen token: read your own game state, pick a reward |
| XSS | SPA renders only our own data; the only user-supplied strings are GitHub logins (escaped); CSP `default-src 'self'` on Pages, no inline scripts |
| CORS | `api` allows only the Pages origin via Function URL CORS config, plus an explicit check in code |
| Data exposure | Private repo names never persisted; profiles private by default; badge exposes level, renown, vocation only; full JSON export and one-click delete |
| AWS account compromise | OIDC from GitHub Actions, least-privilege IAM per Lambda (ingest: PutItem/GetItem on one table; api: + Query), no root keys, MFA, $1 budget alarm |
| Dependency supply chain | `npm ci` with lockfile, Dependabot, Lambda bundled with esbuild to a single file, no runtime `npm install` |
| Abuse of Function URL | ingest rejects payloads > 256 KB; reserved concurrency 10 on `ingest`, 5 on `api`, so a flood costs nothing but dropped requests |

**Plain-words promise on the landing page:** *We never read your code. We store counts and timestamps. You can export or delete everything in one click. The App can't write to GitHub.*

---

## 11. Growth

| Lever | What | Why it fits |
|---|---|---|
| README badge | `![Mergescape](…/badge/login.svg)` → "Lv 41 Warden · Renown 17" | Every profile README is a billboard; zero effort for the player |
| Share card | PNG of the week's run: boss beaten, best kill, level-ups | Friday ritual, posts well |
| Guilds (v2) | Install on an org → opt-in guild with a weekly **raid** (summed XP vs. a shared boss) | Team-sized social pressure, still no individual leaderboard |
| Seasonal biomes | New biome every 8 Renown + a seasonal Legendary Charm | Long-tail retention |
| Open-source the scorer | `shared/score.ts` public so weights are auditable | Trust is the moat for a tool that watches your work |

Metrics worth tracking (aggregate, CloudWatch custom metrics): activations (first scored event), D7/D30 return, act clear rate, shop spend per visit, unspent gold.

---

## 12. Roadmap

**v0 — "Goblin" (2 weekends).** App registration, ingest Lambda, scorer with D2 table, Town + Combat Log + Character screens, one biome, 6 monsters, no run layer. You can watch yourself level.

**v1 — "Spire" (+3 weekends).** Weekly Run with act targets, the Shop (Charms, packs, 6 vouchers, re-roll, sell), 6 Moguls, 12 Charms, 8 Pledges, Bestiary, badge, export/delete.

**v1.1.** Backfill (Ancient Tomes), `issue_comment` opt-in, light theme, timezone setting.

**v2.** Guild raids, more biomes, Legendary Charm season, PNG share card, custom domain.

---

## 13. Monthly cost at scale

Assumptions: an active user generates ≈50 webhook deliveries/day (opens, pushes, reviews, comments, closes, across every repo the App is installed on, including teammates' activity in those repos), ≈1,500/month. Each delivery = 1 Lambda invocation (~200 ms, 256 MB) + 4 DynamoDB writes (dedupe, event, PR meta, profile). Each user opens the app ~once a day (5 API calls). Badge SVGs sit behind CloudFront (always-free 1 TB + 10M requests) with a 6-hour cache, so README traffic never reaches Lambda. Raw events carry a 90-day TTL; weekly aggregates are kept forever. Logs are error-only.

| Users | Ingest invocations/mo | Lambda | DynamoDB | Logs / other | **Total** |
|---|---|---|---|---|---|
| 0 | 0 | $0 | $0 (provisioned 5/5 inside free 25/25) | $0 | **$0** |
| 10 | 15k | $0 | $0 | $0 | **$0** |
| 100 | 150k | $0 | $0 | $0 | **$0** |
| 1,000 | 1.5M | ~$0.10 (0.5M over the 1M free; compute inside 400k GB-s) | ~$0 (≈2–3 writes/s avg; bump provisioned to 10/10, still free; storage ≈1.3 GB steady) | $0 | **≈ $0–1** |
| 10,000 | 15M | ~$9 (requests $2.80 + compute ~$6) | ~$5–10 (autoscale to ~60 WCU at workday peaks; ≈13 GB steady storage) | ~$2–5 CloudWatch if verbose; $0 if error-only | **≈ $15–25** |

Notes:
* Costs scale with **installed repos' activity**, not with signed-in users. A single busy monorepo with 200 engineers and 3 players costs like 200 users. The ingest Lambda must drop events for un-linked users before any DynamoDB write, and should ignore `synchronize` entirely unless the PR is already tracked.
* AWS accounts created after July 15 2025 are on the credit-based Free Plan (credits expire after 6 months or when spent); the *always-free* allowances above still apply afterwards on pay-as-you-go. Budget alarm at $1 and $10.
* GitHub charges nothing for Apps, webhooks or OAuth. REST rate limit is 5,000 req/hr per installation, relevant only to backfill.
* At 10k users the first real cost is your time, not AWS. Nothing in this design needs re-architecting before ~100k users.

---

## 14. Is it safe to release, and will people trust it?

**Safe to release: yes**, given these properties, all of which should be stated on the landing page and verifiable in the open-source repo.

1. **Read-only by construction.** The App has two read permissions and cannot comment, merge, push or change anything. Even a full AWS compromise yields no write capability on GitHub.
2. **No user tokens stored.** Sign-in exchanges the OAuth code once to learn the numeric user id, then discards the token. There is nothing to leak that grants GitHub access.
3. **Metadata only.** No code, diffs, titles, bodies or comment text ever leave GitHub. The stored-field list in 3.4 is the complete inventory.
4. **Blast radius of the worst plausible breach** (DynamoDB dump): GitHub user ids, numeric repo ids, PR numbers, line counts, timestamps, game state. Embarrassing, not dangerous. Private repo names are never persisted.
5. **Webhook authenticity** is HMAC-verified; the Function URL has no other auth because the HMAC is the auth.
6. **No money, no messaging, no third parties.** No ads, analytics or trackers in v1.

**Trust signals to ship with v1** (cheap, high leverage):
* The whole repo public, including `score.ts`, the IaC stack, and the GitHub App manifest, so the permission list is auditable.
* A one-screen Privacy page in plain language plus a short Terms page (templates are fine; no lawyer needed at this scale, but revisit before any monetization).
* **Export** and **Delete everything** buttons that work instantly and also uninstall-cleanup on the `installation.deleted` webhook.
* The App's public listing shows the permissions GitHub-side; a "Verified creator" badge needs a verified org, optional.

**Residual risks to know about:**
* Your GitHub account owns the App. If it is compromised, an attacker can change permissions or rotate the private key. Use hardware 2FA; consider owning the App under a dedicated org.
* **Team visibility:** installing on a shared repo means webhooks for *everyone's* PRs arrive. The design drops un-linked users' events pre-write, but say so explicitly ("we discard activity from people who haven't signed in") and give org admins a way to see this. Some orgs will refuse any third-party App on principle; a "personal-fork only" mode avoids the conversation.
* **Gaming your own numbers** is possible (farm a private repo). Without leaderboards nobody is harmed; the Boss modifiers and solo-kill penalty keep it from being fun. Revisit before guild raids.
* **Perverse incentives.** Any metric on PR counts can nudge people toward tiny PRs or rubber-stamp approvals. The weights (merge-weighted, log LoC, party bonus, Mogul modifiers that reward real review) are tuned against this, but watch for it and keep the scorer open so colleagues can argue with it.
* **Not a performance tool.** Say so. Managers must not get a view of it; there is no org dashboard in v1 by design.

**Anything else:**
* Weeks are UTC. Players in UTC−8 see their Monday start Sunday 4 pm. Acceptable for v1, cosmetic fix later.
* One GitHub account per character. Multiple accounts can't merge.
* Build order matters for motivation: get the ingest → score → Combat Log loop running on your own repos first (v0). If watching the log isn't fun with real data, the run layer won't save it; if it is, everything else is polish.
* Diablo's table means the 90s are a decade. That is a feature for the badge ("Lv 93" means something) and a non-issue for retention, which comes from the weekly run, not the level.

---

## 15. Open questions (none block v0)

1. Non-default-branch PRs at 50% or 100%? Stacked-diff workflows argue for 100%; farming argues for 50%. Start 50%, revisit with data.
2. Per-skill Zone exponent (so Oratory can't carry a level)? Not for v1.
3. Local-time features (Lantern, hidden time Feats) need a timezone setting; default to the browser's on first login.

---

## Sources consulted

* Diablo II experience table: https://classic.battle.net/Diablo2exp/basics/levels.shtml · https://diablo2.diablowiki.net/Experience · https://maxroll.gg/d2/resources/experience
* GitHub App permission examples (read-only PR apps): https://docs.stably.ai/about/github-app-permissions · https://extra-codeowners.readthedocs.io/en/latest/reference/github-permissions/ · https://prdeploy.readthedocs.io/en/latest/getting-started/1-github-app/
* PR volume benchmarks: https://linearb.io/resources/ai-engineering-productivity-gap · https://www.techrepublic.com/article/news-ai-coding-agents-microsoft-pull-requests/ · https://lumienai.com/news/microsoft-ai-coding-agents-pull-requests-24-percent-study · https://www.secondtalent.com/resources/ai-coding-assistant-statistics/
* AWS free tier: https://spot.rackspace.com/blog/aws-free-tier · https://dynobase.dev/dynamodb-free-tier · https://infratally.com/articles/aws-free-tier-2026/
