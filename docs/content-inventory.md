# Content inventory

What the game contains, against the v1 column of the content budget in [`game-design.md`](../.kiro/specs/mergescape/game-design.md) section 11. Counted on 9 November 2026, during task 24, from the shared package. [`packages/shared/src/content.test.ts`](../packages/shared/src/content.test.ts) fails if any count falls below its v1 target, so this table cannot quietly go stale in the wrong direction.

## Counts against the v1 budget

| Content                 | v1 target | In the shared package | Result      | Where it lives                                                                                                                        |
| ----------------------- | --------: | --------------------: | ----------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Monsters (mobs, elites) |         8 |                     8 | met         | `MONSTER_IDS` in `constants.ts`: 4 mobs, 4 elites                                                                                     |
| Moguls                  |         6 |                     6 | met         | `moguls.ts`                                                                                                                           |
| Charms                  |        12 |                    12 | met (was 9) | `charms.ts`: three of each rarity. **Whetstone, Familiar Path and Long Lens added in task 24.**                                       |
| Pledges                 |         8 |                     8 | met (was 6) | `pledges.ts`: five starters, Pair Up (the Strike upgrade) and two more. **Fine Comb and Well Reviewed added in task 24.**             |
| Regions                 |         4 |                     8 | exceeded    | `expeditions.ts`: Koko Woods, Crossroads of Wix, Orrl Falls, Silverhall, Koko Deep Woods, Mazu Deep, Quu Spire, The Garbage Collector |
| Gear pieces             |        30 |                    42 | exceeded    | 24 crafted (6 tiers in each of the 4 worn slots) plus 18 named uniques (7 from regions, 11 Feat rewards)                              |
| Pets                    |         6 |                    11 | exceeded    | `pets.ts`: the 6 core pets, which have a passive, plus 5 that only Feats award                                                        |
| Feats                   |        40 |                    40 | met         | `feats.ts`: Scale 7, Craft 10, Endurance 6, World 10, Humour 7; 8 are hidden until earned                                             |
| Biomes (Town backdrops) |         3 |                     6 | exceeded    | `BIOMES` in `constants.ts` names six; the client draws three backdrops (see below)                                                    |

The month-6 and month-12 columns of the budget are the schedule for what comes next: 12 monsters, 8 Moguls, 24 Charms, 14 Pledges, 6 regions, 60 gear pieces, 12 pets, 55 Feats and 5 backdrops by month 6.

## What task 24 added

Every addition follows the incentive audit of game-design.md section 8.3: nothing rewards excess, the hour of day, a rubber stamp or closing a PR, and each is a function of facts the scorer already has. Tests in `charms.test.ts` and `pledges.test.ts` check each condition, one test checks that none of the new Charms reads the clock, and a wording check covers both kinds.

| Item              | Kind   | Rarity or goal | What it does                                                                                                                           | Why it is safe under the audit                                                                                                                                                                                                      |
| ----------------- | ------ | -------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Whetstone**     | Charm  | Common         | +0.5 Power on an approval, backed by at least one inline comment, of a PR whose author has fewer merges than you                       | Rewards mentoring, and the inline comment makes it a read rather than a stamp. It echoes the Mentor Pledge and the Mentor Feat.                                                                                                     |
| **Familiar Path** | Charm  | Uncommon       | +0.5 Power on any PR in a repository where you have merged 10 times or more                                                            | Rewards staying with a codebase, a milder Grey Beard (50 merges, +1.0). Volume is not rewarded: it is the count in one repository.                                                                                                  |
| **Long Lens**     | Charm  | Rare           | +1.0 Power on an approval or a request for changes on a PR of 500 lines or more, after at least 3 inline comments from you             | The thorough review of a big PR is the work nobody thanks you for (the Archivist Feat). It needs the size, the comments and a decision, so it cannot be farmed with stamps, and it pays the reviewer, not the author of the big PR. |
| **Fine Comb**     | Pledge | 3 reviews      | Submit 3 scoring reviews, each after 3 or more inline comments from you on that PR: +0.5 Power on all reviews for the rest of the week | Asks for depth, not count or speed. A bare comment review does not count.                                                                                                                                                           |
| **Well Reviewed** | Pledge | 2 merges       | Merge 2 PRs that each drew 3 or more inline comments from a reviewer: +250 points on the second                                        | Rewards PRs that were read, not PRs that were large: a 5,000-line PR that nobody read counts for nothing.                                                                                                                           |

A Charm that rewarded reviewing PRs only once they had sat for a week was considered and dropped: it would reward sitting on a review.

## Presentation coverage (client)

Content counts are not art counts. For the budget's "unique art" columns:

- **Gear sprites:** 46 sprite ids (24 crafted plus the uniques and their variants), above the 30 of v1.
- **Pets:** 6 drawn, one for each core pet. The 5 Feat-only pets borrow a sprite or show an initial until they get their own.
- **Monsters and Moguls:** 8 and 6 sprites.
- **Charms:** 3 sprites (Rubber Duck, Small Hands, Hot Potato); the other 9 Charms are shown as cards without an icon. Not part of the v1 budget, and the natural next art task.
- **Town backdrops:** 3 drawn in task 24 (Town, the Sewers of Legacy and the Flaky Marsh). Before it the scene had one backdrop for every biome. The three later biomes keep the marsh until they get their own.

## Onboarding tuning

Game-design.md section 10 promises a normal first week reaches the Boss act, and section 2 wants the first Boss to fall in the second week at the latest, not the fourth. [`packages/shared/src/onboarding.test.ts`](../packages/shared/src/onboarding.test.ts) runs fixture weeks through the real rules (`startRun`, `score`, `applyScoreResult`, `addWeeklyXp`, `clearAct`, in the order the backend runs them) with no Charms, no Pledges played, no gear and no expedition: a new player has at least the free Common Charm, so these numbers are a floor.

**A modest first week** is 3 merges with an approval and 5 reviews, Monday to Friday, for a brand-new character with the flat targets (1,200, 2,000 and 3,000 XP).

| Boss Mogul of the week | Weekly XP | Level at the end | Acts cleared                                  |
| ---------------------- | --------: | ---------------: | --------------------------------------------- |
| The Founder (hardest)  |     2,385 |                3 | Scout (Wed), Raid (Fri); **Boss act reached** |
| The Turtleneck         |     5,577 |                4 | Scout, Raid (Wed), Boss (Fri)                 |
| The Rocket Man         |     5,650 |                4 | Scout, Raid (Wed), Boss (Fri)                 |
| The Two-Pizza Boss     |     6,128 |                4 | Scout, Raid (Wed), Boss (Fri)                 |
| The Leather Jacket     |     6,427 |                4 | Scout, Raid (Wed), Boss (Thu)                 |
| The Hoodie             |     7,534 |                4 | Scout, Raid (Wed), Boss (Fri)                 |

- **The Scout and the Raid clear and the Boss act is reached, for every Mogul.** That is the result the test pins.
- **The same player's second week** (same activity) clears all three acts with every one of those first weeks behind it, by Wednesday, with 13,700 to 19,000 XP. The first Renown therefore arrives **no later than week 2** for every Mogul draw, and exactly in week 2 under the Founder.
- **A power user** (9 approved merges and 18 reviews a week) clears all three acts on Monday or Tuesday of week 1 (17,800 to 113,000 XP) and again in week 2 (218,000 to 371,000 XP), which is a Boss clear and +1 Renown in each.

**Finding for the owner.** No constant was changed, because the two things the test was asked to prove hold. But section 2 says the first Boss "should fall in the player's **second** week", and section 10 says a normal first week "clears it" with Renown 1: the two disagree, and the numbers side with section 10. A modest first week clears the Boss in 5 of the 6 draws, because Zone grows with level, so XP per event roughly triples within the week while the flat targets stay put. Making the Boss reliably fall in week 2 would take a first-week Boss target above the 7,534 XP a modest week reaches under the kindest Mogul, while the Raid target must stay under the 2,385 it reaches under the hardest; the Boss target is 1.5 times the Raid target, so no single flat base does both. The options are a first-week rule (for example, Act III opens in the second run for a new character) or accepting section 10's version. The test states the guarantee that holds today: Scout and Raid in week 1, Boss by week 2.

## What is not done

- Charm art: 9 of the 12 Charms have no icon.
- Backdrops for the Dependency Mines, Release Peaks and The Rebase Abyss (the month-6 and month-12 columns).
- The first-week Boss question above.
