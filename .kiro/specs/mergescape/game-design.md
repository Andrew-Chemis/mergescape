# Mergescape — Game Design

Status: DRAFT for owner review · 2026-11-08 · Extends `design.md` (systems) with the *why*: pillars, the kinds of fun, the loops, two new layers (Expeditions, the Forge), and Feats (achievements). Where this document and `design.md` disagree, this one wins and `design.md` is to be updated.

Seed: `5aA9xwWX50Npk7orRlfZbP7960FJJGWoKoAzR5JpXNSoAg5zjMZUyhaSMEyQu2GC`. Fragments of it name things below: the **Crossroads of Wix** (xwWX), the **Orrl Falls** (orRlf), **Koko Woods** (WoKo), **Silverhall** (Ag, silver), the **Mazu Deep** (MZU), the **Quu Spire** (Qu), and **The Garbage Collector** (GC), a thing that lives at the bottom of the Spire and eats what nobody references any more. "7960" is the year on the oldest coin in the game.

---

## 1. Thesis

Mergescape turns the invisible, under-appreciated half of software work, reviewing and shipping, into a visible, growing thing. The player should feel two things: **"my work left a mark"** (the character, the log, the Feats) and **"I have a plan for this week"** (the run, the shop, the expedition). The game never asks for time; it asks for attention, in sips.

A useful test for every feature: *would a senior engineer be slightly embarrassed to have it open on a second monitor, and slightly pleased when a colleague noticed?* Both halves must be true.

---

## 2. What we learned from the landscape

| Lesson | Source | What we do with it |
|---|---|---|
| The prestige loop is the retention loop; make the first one come sooner than feels right | idle-game practitioner consensus (dev.to "7 idle games in 30 days"; Game Developer "Math of Idle Games"; Gold & Goblins deconstruction) | Renown is a visible prestige counter from week one. The first Boss should fall in the player's **second** week, not the fourth. Act targets for new players are tuned to that. |
| Retention degrades when long timers dominate; offline progress is a tool but should be bounded | Gold & Goblins deconstruction, GameAnalytics idle benchmarks | Expeditions are 4 to 48 hours, never longer, and always return something. There is no timer the player must babysit. |
| The early minutes decide everything | multiple idle postmortems | First scored event triggers a scripted first kill, a free Charm, a first expedition that returns in 4 hours, and the first Feat. Day one must contain all four loops in miniature. |
| Measurement achievements beat completion achievements; cosmetic rewards don't harm intrinsic motivation; currency rewards can | Lucas Blair, "The Cake Is Not a Lie" (Game Developer, 3 parts) | Feats measure scale and skill ("merged a 1,000-file PR with two approvals") rather than "clicked the shop". Rewards are gear and titles with cosmetic weight and a small, capped Power contribution; never gold. |
| Let players display the few achievements they are proud of | Blair; WoW achievement analyses | Three Feat slots on the character sheet and the badge. |
| Balatro's power is a familiar medium (cards) with one twist, tuned by feel for 18 months, with deliberate suspense (no score preview) | Game Informer, GamesRadar, GMTK's "Balatro's Cursed Design Problem" | Our familiar medium is the PR. The twist is that the game cannot be played directly. We keep one piece of suspense: the Mogul is revealed Monday, but expedition loot is never previewed. |
| Walkscape: real input is banked, never punished; missed steps are kept; one skill takes ~700k–1M steps | WalkScape wiki, Core Mechanics | Supplies bank indefinitely. Nothing decays. Level 99 is a multi-year horizon by design. |
| Eight kinds of fun is a vocabulary, not a scorecard; players want different mixes | Hunicke, LeBlanc, Zubek, MDA | We target three primaries and serve the rest lightly. Section 3. |

---

## 3. Kinds of fun, ranked

Using LeBlanc's eight aesthetics. Primary means the game fails if this is weak. Secondary means it must be present. Light means it exists but we don't invest.

| Rank | Aesthetic | What delivers it in Mergescape | Design obligation |
|---|---|---|---|
| **Primary** | **Submission** (the comfortable ritual) | Open the tab, see what the character did overnight, send the next expedition, close. Two minutes. | Every session must end with the player having *set something in motion*. Never a dead end. |
| **Primary** | **Expression** (the build) | Charms, gear from the Forge, Pledges, where you send expeditions, what you save gold for. Vocation and displayed Feats. | Two players with the same GitHub activity should end up with visibly different characters after a month. |
| **Primary** | **Discovery** | Bestiary, regions and their loot tables, Charm synergies, Feat list with hidden entries, the Mogul bag. | Something new to find every week for the first six months. Content budget in §11. |
| Secondary | **Fantasy** | Your Tuesday review was a Hydra kill. The character wears what you forged. | Copy and art consistency. No menu may describe itself in GitHub terms when an in-world term exists. |
| Secondary | **Sensation** | The score ticker rolling up, loot drop reveal, level-up, Feat unlock. | Each is a 1–2 second orchestrated moment, skippable, with optional sound. |
| Light | **Challenge** | Act targets, Mogul twists, Pledge contracts. | Soft by design; the input is real work. Never a fail state with a cost. |
| Light | **Narrative** | Region flavour text, the Garbage Collector at the bottom of the Spire, Mogul one-liners. | Written once, read on discovery. No quests with story. |
| Deferred | **Fellowship** | Guild raids (v2). | None in v1; the badge is the only social surface. |

---

## 4. Pillars

1. **Real work is the only input.** No clicker, no energy, no purchase changes XP. Everything the player *does* in-game is a decision about what to do with what their work produced.
2. **Always explain the number.** Every XP grant, every drop, every Feat shows its math or its condition. The Combat Log is the product.
3. **Sips, not sessions.** A full daily visit is under two minutes. A weekly visit is under ten. Nothing requires presence at a specific time.
4. **Gentle hands.** No loss, no decay, no FOMO, no streak punishment, no timers that expire. Missing a week costs nothing but the week.
5. **Nudge toward good engineering, never against it.** Every multiplier that touches behaviour (party bonus, small-PR Charms, Mogul twists) rewards something a staff engineer would endorse. Anything that could reward bad practice is cosmetic only.

---

## 5. The loops

Four nested loops. Each has an input, a decision, a payoff and an anticipation hook that pulls toward the next loop.

### 5.1 Moment loop (seconds, triggered by real work)

- **Input:** a merge, review or comment lands.
- **Automatic:** character walks to the dungeon, fights the matching monster, score ticker rolls (Points × Power × Zone), XP and skill XP bars move, **supplies** drop (see §6), the Combat Log gains a row.
- **Decision:** none. This loop is pure feedback.
- **Hook:** the row shows "+3 Ore, +1 Lore" under the XP, so the player knows there is something to spend.

### 5.2 Daily loop (two minutes, once a day)

- **Input:** the overnight expedition has returned; supplies have accumulated.
- **Decisions:** open the expedition's loot (one reveal), choose the next region and duration, queue one Forge job if materials allow, play a Pledge if it's Monday or Tuesday.
- **Payoff:** loot reveal (gear, materials, a Charm pack), a Forge item finishing, maybe a Feat.
- **Hook:** the expedition timer. "Returns in 9 h" is the reason to come back tomorrow. It is also the only timer in the game.

### 5.3 Weekly loop (ten minutes across the week)

- **Input:** the Run. Scout → Raid → Boss as weekly XP crosses targets.
- **Decisions:** Pledges (Monday), shop purchases at each act clear, what to save gold for (vouchers), whether to swap Charms before the Boss.
- **Payoff:** act gold, shop visits, Mogul kill, Renown +1, Legendary offers.
- **Hook:** the Mogul for *next* week is hidden until Monday (unless you own the Oracle Charm), and the shop re-rolls are gone when the week ends.

### 5.4 Seasonal loop (months)

- **Input:** Renown, character level, Feat completion.
- **Decisions:** which biome to push into (regions unlock by Renown), which Feat to chase, which gear set to complete.
- **Payoff:** new biome every 8 Renown, gear tiers at level thresholds, the three displayed Feats on the badge.
- **Hook:** Level 99 and the final Feats are years away, and the badge says exactly how far you got.

**Prestige.** Renown is the prestige counter but it never resets anything; Walkscape's "never punish" wins over the idle genre's reset. If a reset is ever wanted, it is a separate opt-in **Hardcore** character (v2), not a wipe.

---

## 6. Layer A: Supplies and Expeditions (the Walkscape layer)

### 6.1 Supplies

Every scored event also drops supplies, determined by the event type, independent of Power (so Charms can't farm them).

| Event | Supplies |
|---|---|
| Merged PR | **Ore** ×(1 + size tier 0–3), **Timber** ×1 |
| Review (approve / changes requested) | **Lore** ×2 |
| Review (comment) | **Lore** ×1 |
| Inline comment | **Ink** ×1 (cap 5 per PR) |
| Party bonus | **Provisions** ×2 |
| Daily first event | **Provisions** ×1 |
| Riposte | **Flux** ×1 (rare, used for upgrades) |

Supplies bank without limit and never decay. They are shown on Town as a small satchel.

### 6.2 Expeditions

The character is either in Town or on an expedition. An expedition is **sending the character to a region for a real-time duration, paying Provisions, and receiving a loot roll on return**. This is the idle timer, and the only one.

| Parameter | Rule |
|---|---|
| Duration | 4 h, 12 h, 24 h or 48 h. Longer is better per Provision but not linearly (diminishing, so checking daily is optimal but weekly is fine). |
| Cost | Provisions: 1 / 2 / 4 / 6. Insufficient Provisions → the 4 h "Forage" expedition is always free. |
| Regions | Unlocked by Renown. Each has a loot table weighted toward one material and one gear slot, plus a small chance of a Charm pack and a very small chance of a unique. |
| Return | Loot is rolled on return, server-side, from a seed stored on the expedition item, so a refresh never re-rolls. The reveal is a two-second flip of 3 to 6 cards. |
| Automatic | If the player never opens the tab, nothing happens: the character waits in Town. No auto-expedition, because the decision *is* the daily loop. Exception: the first expedition after onboarding is auto-sent. |
| Boost | While on expedition, scored events still happen normally (the character "returns to fight" in the fiction). Expeditions never block scoring. |

Regions (Renown gate → theme → specialises in):

| Region | Renown | Theme | Loot lean |
|---|---|---|---|
| Koko Woods | 0 | Starter forest, friendly | Timber, Provisions, Leather gear |
| Crossroads of Wix | 2 | Trading post; every road from here | Mixed, best Charm-pack odds |
| Orrl Falls | 8 | Waterfall mines | Ore, Iron gear |
| Silverhall | 16 | Abandoned dwarven hall | Silver (crafting tier), Flux |
| Koko Deep Woods | 24 | Night version of the starter forest | Lore, Ink, Herald gear |
| Mazu Deep | 32 | Sea trench, pressure | Mithril, trinkets |
| Quu Spire | 48 | Tower that goes down, not up | Rune, uniques |
| The Garbage Collector | 64 | The Spire's floor; it eats unreferenced things | Dragon materials; the only source of **Reclaimed** uniques (gear with a random, named "former owner") |

### 6.3 Why this is the right idle layer

- It gives the pixel character a job (the reason it exists on screen).
- It converts "events happened" into "I have something to do with them", which is Expression.
- The one timer sits in the sweet spot the research points at: bounded, never punishing, daily-optimal.
- It is cheap: one item type, one seeded roll, one screen.

---

## 7. Layer B: The Forge and gear (the Idlescape layer)

### 7.1 Gear

Five slots: **Weapon, Body, Cape, Trinket, Pet**. Each piece has a tier, a slot, an optional **affix**, and a Power contribution. Gear is the second Power source after Charms.

| Tier | Material | Power per piece | Unlock |
|---|---|---|---|
| Leather | Timber + Provisions | +0.05 | Level 1 |
| Iron | Ore | +0.10 | Level 10 |
| Silver | Ore + Silver | +0.15 | Level 30 or Silverhall |
| Mithril | Mithril | +0.20 | Level 50 |
| Rune | Rune | +0.30 | Level 70 |
| Dragon | Dragon material | +0.40 | Level 90 or Garbage Collector |

Full set bonus: all five pieces same tier → +0.25. Affixes (one per piece, rolled at the Forge with Flux or found on expedition gear): **Keen** (+0.1 Power on reviews), **Stout** (+0.1 on merges), **Quick** (expeditions 10% shorter), **Lucky** (+5% Charm-pack odds), **Hoarder** (+1 supply per event).

Power budget: Charms up to +4.0 (five slots, realistic), gear up to +2.25 (five Dragon pieces + set), Pledges up to +1.0, Feat gear bonus up to +0.5 (§8). New Power cap: **9** (was 8). Gear's share is meaningful but Charms stay the headline.

### 7.2 The Forge

Town has three stations. Each turns supplies into gear or upgrades over real time (the second, optional idle timer; jobs never need attention and finish on their own).

| Station | Makes | Time | Upgrade path |
|---|---|---|---|
| **Forge** | Weapon, Body | 2 h Leather → 24 h Dragon | Bellows (Flux ×3): −25% time |
| **Loom** | Cape | 2 h → 24 h | Dyes (Ink ×10): cosmetic cape colours |
| **Scriptorium** | Trinket; applies affixes; names Reclaimed gear | 4 h → 12 h | Index (Lore ×50): reveals expedition loot leans |

One job per station at a time. A finished job sits in the station until collected; nothing is lost.

### 7.3 Pets

Pets are the fifth slot and purely cosmetic except for one small passive each. Sources: expeditions (rare), Feats, Mogul cosmetic packs. Starter: the **Linter Cat** (follows you; passive: +1 Ink per week). Others: **Rubber Duck** (literal), **Flaky Wisp**, **Merge Goblin runt** (from 1,000 Goblin kills), **Garbage Collector's Mote** (from the GC region).

---

## 8. Feats (achievements)

### 8.1 Design rules

1. **Measure, don't check boxes.** Feats are about magnitude, skill or rarity in the real work, never about using the game's own UI.
2. **Three kinds of reward, in this priority:** a **title** (cosmetic, displayable), a **unique piece of gear or pet** (cosmetic identity + the slot's normal Power, never more), and for the hardest a **Feat bonus** (+0.1 Power each, capped at +0.5 total across all Feats). Never gold, never XP.
3. **Never reward something a staff engineer would wince at.** Scale Feats count only merged PRs with at least one other human approval, so a 1,000-file dump merged by its author at 2 am earns nothing. Where a Feat *looks* like it rewards excess (see "Thousand-Hand Smith"), its reward is cosmetic only and its copy is tongue-in-cheek.
4. **Hidden entries exist.** About a quarter of Feats show as "???" until earned, with a vague hint. Discovery.
5. **Display three.** Character sheet and badge show up to three chosen Feats.
6. **Retroactive from day one of the character, never from before.** Backfill (v1.1) scores XP but does not grant Feats, so a Feat is always something you did *while playing*.

### 8.2 The list (v1 ships 40; this is the full target of ~70 for the first year)

**Scale** (ambitious, all require ≥1 other human approval on the counted PRs)

| Feat | Condition | Reward |
|---|---|---|
| Thousand-Hand Smith | Merge a PR touching ≥1,000 files | Title "Thousand-Hand"; Pet: *Many-Armed Goblin*. Cosmetic. |
| Megalith | ≥1,000,000 lines added across merged PRs in a trailing 30-day window | Title "Megalith"; Body: *Monolith Plate* (Dragon-tier look, Iron-tier Power). |
| Deleter of Worlds | Net −100,000 lines across merged PRs, lifetime | Weapon: *The Red Pen* (affix Stout). +0.1 Feat bonus. |
| Hundred Merges Week | 100 merged PRs in one Run | Cape: *Streamer's Cape* (animated). |
| The Long Haul | A PR open ≥180 days, then merged | Trinket: *Hourglass of Scope*. |
| Mass Reviewer | Review ≥100 distinct PRs in 30 days | Title "Warden of the Gate". +0.1 Feat bonus. |
| Omnilinguist | Merged PRs in ≥12 distinct repositories, lifetime | Pet: *Polyglot Parrot*. |
| First Light | First merged PR in a repo that had none for ≥365 days | Title "Lamplighter". |

**Craft** (quality of work; the ones we most want to reward)

| Feat | Condition | Reward |
|---|---|---|
| Surgeon | 50 merged PRs under 50 lines, each with ≥1 approval | Weapon: *Scalpel* (affix Keen). +0.1 Feat bonus. |
| Riposte Master | 100 Ripostes (addressed changes-requested and merged) | Title "Unbowed". |
| Close Reader | 25 reviews with ≥10 inline comments each | Trinket: *Loupe*. +0.1 Feat bonus. |
| Fast Hands | Approve 50 PRs within 1 hour of their opening | Pet: *Hot Potato*. |
| Mentor | 100 approvals on PRs from authors with fewer lifetime merges than you | Cape: *Mentor's Mantle*. +0.1 Feat bonus. |
| Clean Record | 52 consecutive weeks with zero PRs closed unmerged | Title "Immaculate". |
| Verified | 500 Verified Kills (PRs you approved later merged) | Title "The Seal". +0.1 Feat bonus. |

**Endurance and rhythm**

| Feat | Condition | Reward |
|---|---|---|
| Night Owl | 100 scored events between 22:00 and 06:00 local | Pet: *Owl*. |
| Dawn Patrol | First event of the day before 07:00, 50 times | Title "Early". |
| Year of the Goblin | 52 Runs with at least one scored event | Cape: *Anniversary Cape* (trim changes each year). |
| Iron Week | Clear all three acts 10 weeks in a row | Title "Ironclad". |

**World and discovery**

| Feat | Condition | Reward |
|---|---|---|
| Goblin Slayer | 1,000 Merge Goblin kills | Pet: *Goblin Runt*. |
| Hydra Bane | 100 Rebase Hydra kills | Weapon: *Three-Headed Axe*. |
| Mogul Hunter | Beat each of the six Moguls at least once | Title "Boardroom Terror"; Trinket: *Golden Parachute*. |
| Spelunker | Complete 100 expeditions | Title "Wayfarer". |
| Collector | Own every pet | Title "Menagerie". |
| ??? (Unreferenced) | Return from The Garbage Collector with a Reclaimed unique | Reveals: Title "Reclaimed". |
| ??? (The Old Coin) | Find the coin dated 7960 (0.1% drop at the Crossroads) | Reveals: Pet *Coin Mote*; the coin shows on the badge. |

**Meta and humour**

| Feat | Condition | Reward |
|---|---|---|
| Merge Conflict | Two of your PRs merge within the same minute | Title "Simultaneous". |
| Friday Deploy | Merge a PR after 16:00 local on a Friday, 10 times | Pet: *Pager Gremlin* (hidden until earned). |
| Rubber Stamp | ??? Hidden. Approve 20 PRs within 60 seconds of opening each | Title "Rubber Stamp". Cosmetic and mildly shaming by design; the copy says so. |
| Self Merge | ??? Hidden. 50 solo merges | Title "Lone Wolf", Cape: *Hermit's Hood*. Cosmetic only, no Feat bonus, by rule 3. |

### 8.3 Implementation shape

A Feat is `{id, name, hidden, hint, condition: (ctx) => progress 0..1, reward}` evaluated on every scored event against rolling counters kept on the profile (30-day and lifetime windows; per-repo first-merge dates; local-time buckets). Progress is displayed as a bar for visible Feats. Unlock fires once and writes a `FEAT#` item with the unlocking event id so it can be audited.

---

## 9. Feel (Sensation budget)

Five moments get real polish; everything else is instant.

1. **Score ticker.** Terms slide in one by one, Points → × Power → × Zone → XP, 1.2 s total, click to skip. Numbers use tabular figures.
2. **Level up.** Screen flash in the skill's colour, the sprite's gear tier swaps if crossed.
3. **Loot reveal.** Cards flip left to right, rarities get a border glint; uniques get a one-line "former owner" caption.
4. **Feat unlock.** Banner across the top of Town, persists until clicked, adds to the Feat list.
5. **Mogul reveal.** Monday: the Mogul's sprite rises behind the Boss node with its one-liner.

Sound is opt-in, off by default, nine short samples. Reduced-motion collapses every animation to a fade.

---

## 10. Onboarding: the first seven days

| Day | What happens | Loop taught |
|---|---|---|
| 0 | Sign in, install, Town shows the sleeping character. | — |
| First event | Scripted first kill with expanded ticker, free Common Charm, **first expedition auto-sent to Koko Woods (4 h)**, Feat progress bars appear. | Moment |
| +4 h | Expedition returns with Leather gloves and Provisions; tooltip: "Send another?" | Daily |
| Day 1–2 | Scout target (flat 2,000) clears on the first real PR; shop opens with a Common Charm the player can afford. | Weekly (shop) |
| Day 3–5 | Raid clears; first Forge job (Leather Body, 2 h). | Forge |
| Day 5–7 | Boss act with the first Mogul; the week is tuned so a normal week clears it. Renown 1. | Weekly (Mogul) |
| Week 2 | Crossroads unlocks at Renown 2; first Charm pack from an expedition. | Seasonal |

If the player merges nothing for a week, nothing happens and nothing is said. The character sleeps.

---

## 11. Content budget for year one

| Content | v1 | By month 6 | By month 12 |
|---|---|---|---|
| Monsters (mobs + elites) | 8 | 12 | 16 |
| Moguls | 6 | 8 | 10 |
| Charms | 12 | 24 | 40 |
| Pledges | 8 | 14 | 20 |
| Regions | 4 | 6 | 8 |
| Gear pieces (unique art) | 30 | 60 | 90 |
| Pets | 6 | 12 | 20 |
| Feats | 40 | 55 | 70 |
| Biomes (Town backdrops) | 3 | 5 | 6 |

Discovery dries up when the player has seen everything; this table is the schedule that prevents it.

---

## 12. Anti-patterns we refuse

No energy, no stamina, no daily login reward (streaks only add Endurance points), no limited-time FOMO, no loot boxes bought with money, no notifications of any kind in v1, no leaderboard, no manager view, no variable-ratio gambling on anything purchasable. Expedition loot is random but free; shop stock is random but fully visible before buying.

---

## 13. Success measures

| Measure | Target | Why |
|---|---|---|
| Activation: first scored event within 7 days of install | ≥70% | The install flow works |
| First expedition sent manually | ≥80% of activated | The daily loop landed |
| D7 return (opened the tab) | ≥50% | Daily loop retains |
| Week-2 Boss clear | ≥40% of activated | Prestige came soon enough |
| D30 return | ≥35% | Weekly loop retains |
| Median daily session | ≤3 min | Sips, not sessions |
| Players who changed a Charm or gear piece in week 3+ | ≥60% | Expression is real |
| Feat displayed on badge | ≥50% of badge users | Feats matter to people |

All measured as aggregates in CloudWatch; no per-user analytics.

---

## 14. Changes this document requires elsewhere

- `requirements.md`: add Requirements 15 (Supplies and Expeditions), 16 (Forge, gear, pets), 17 (Feats); amend 4.5 (Power cap 9, gear and Feat sources); amend 10.1 (new screens: Expedition, Forge, Feats).
- `design.md`: add §6.6 Supplies and Expeditions, §6.7 Forge and gear, §6.8 Feats (summaries pointing here); amend §4.3 Power; add `EXPEDITION#`, `JOB#`, `FEAT#` items to §9.1; amend screens table.
- `tasks.md`: add tasks 20–24 after task 19 (shared expedition/forge/feat models; backend endpoints and timers; client screens; content pass; feel pass). Resume implementation at task 2 once the owner approves this document.
