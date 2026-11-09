# Research

Collected 2026-11-06 while writing the Mergescape spec. Everything an implementer needs that is not derivable from the requirements or design, including the exact constants to embed, the data behind the weights, and the reasoning behind decisions that might otherwise look arbitrary.

---

## 1. Questions this research answered

| # | Question | Answer (short) | Section |
|---|---|---|---|
| Q1 | What is "Diablo exp math"? | Diablo II uses a 99-row lookup table, not a formula. Use the table verbatim. | §2 |
| Q2 | How do we make a table spanning 500 → 3.5 billion work with per-event rewards? | Scale rewards by a level-dependent Zone multiplier, mirroring D2's monster-level scaling. Exponent 1.6 chosen by simulation. | §3 |
| Q3 | How much do agentic power users actually ship? | Roughly 10–15 merged PRs/week for heavy CLI-agent users; top-decile orgs average 2.6/dev/week; agent PRs merge less reliably and inflate LoC faster than merges. | §4 |
| Q4 | What is the minimal secure GitHub integration? | A GitHub App with `Pull requests: Read` + `Metadata: Read`, webhook-driven, HMAC-verified, no stored user tokens. | §5 |
| Q5 | What does the AWS bill look like? | $0 to ~1,000 users, ≈$15–25/month at 10,000, if DynamoDB is provisioned (not on-demand) and badges sit behind CloudFront. | §6 |
| Q6 | Is Balatro/StS vocabulary appropriate? | Keep the mechanics (shop, jokers, packs, interest, acts, bosses), drop the poker words (blind, ante, chips, mult). | §7 |
| Q7 | Can bosses be real tech CEOs? | Use parody archetypes with invented names; never real names, likenesses or logos. | §7 |

---

## 2. Diablo II experience table (exact)

Source: https://classic.battle.net/Diablo2exp/basics/levels.shtml (Lord of Destruction, levels 1–99). Cross-checked against https://diablo2.diablowiki.net/Experience and https://maxroll.gg/d2/resources/experience. Column is **cumulative XP required to reach the level**. Level 1 is 0. Embed as `shared/src/d2table.ts` exactly as below (index = level).

```ts
export const D2_XP: readonly number[] = [
  0, // index 0 unused
  0, 500, 1500, 3750, 7875, 14175, 22680, 32886, 44396, 57715,
  72144, 90180, 112725, 140906, 176132, 220165, 275207, 344008, 430010, 537513,
  671891, 839864, 1049830, 1312287, 1640359, 2050449, 2563061, 3203826, 3902260, 4663553,
  5493363, 6397855, 7383752, 8458379, 9629723, 10906488, 12298162, 13815086, 15468534, 17270791,
  19235252, 21376515, 23710491, 26254525, 29027522, 32050088, 35344686, 38935798, 42850109, 47116709,
  51767302, 56836449, 62361819, 68384473, 74949165, 82104680, 89904191, 98405658, 107672256, 117772849,
  128782495, 140783010, 153863570, 168121381, 183662396, 200602101, 219066380, 239192444, 261129853, 285041630,
  311105466, 339515048, 370481492, 404234916, 441026148, 481128591, 524840254, 572485967, 624419793, 681027665,
  742730244, 809986056, 883294891, 963201521, 1050299747, 1145236814, 1248718217, 1361512946, 1484459201, 1618470619,
  1764543065, 1923762030, 2097310703, 2286478756, 2492671933, 2717422497, 2962400612, 3229426756, 3520485254,
];
```

Spot checks for tests: L2 = 500 · L10 = 57,715 · L30 = 4,663,553 · L50 = 47,116,709 · L70 = 285,041,630 · L99 = 3,520,485,254 · step 98→99 = 291,058,498.

`levelFor(xp)`: largest L in 1..99 with `D2_XP[L] <= xp`. Binary search; the table is strictly increasing.

Diablo 3 was considered and rejected: no authoritative public 1–70 table exists (third-party calculators disagree), and its curve is flatter and less iconic.

---

## 3. Pacing simulation and the Zone exponent

**Problem.** The D2 table's last step is 582,000× its first. Fixed per-event rewards would make the 90s impossible or the early game instant. D2 itself solves this by scaling monster XP with monster level and area. Mergescape mirrors that: the "zone" you farm is your own level.

**Model.** Weekly points P (sum of event points), average Power M, Zone(L) = (L+1)^e. Weekly XP = P × M × Zone(L). Simulated week by week against the exact table.

Profiles (from §4): **power user** P ≈ 2,000 (12 merges ≈ 2,400 points incl. size, 20 reviews ≈ 800, misc; rounded down for solo merges and caps), M = 2.5 once Charms accumulate. **casual** P ≈ 500, M = 1.5.

Results (years to reach level):

| e | Profile | L10 | L30 | L50 | L70 | L80 | L90 | L99 |
|---|---|---|---|---|---|---|---|---|
| 1.4 | power | 0.04 | 0.25 | 1.1 | 3.9 | 7.5 | 14.5 | — |
| 1.5 | power | 0.04 | 0.19 | 0.8 | 2.7 | 4.9 | 9.5 | — |
| **1.6** | **power** | **0.04** | **0.15** | **0.58** | **1.8** | **3.3** | **6.2** | **11.2** |
| 1.8 | power | 0.04 | 0.12 | 0.31 | 0.85 | 1.5 | 2.7 | 4.7 |
| 2.0 | power | 0.04 | 0.08 | 0.19 | 0.42 | 0.69 | 1.2 | 2.0 |
| 1.5 | casual | 0.12 | 1.1 | 5.0 | — | — | — | — |
| 1.6 | casual | 0.11 | 0.9 | 3.6 | 9+ | — | — | — |

**Decision: e = 1.6.** Power user: level 50 in ~7 months, 70 in under 2 years, 80 in ~3, 99 is a decade-class achievement exactly as in D2. Casual: 30 in a year, 50 in several. Growing Power shortens all of this somewhat. If live data says it's too slow, the Overclock voucher (1.65) exists as an in-game lever and the constant is the single tuning knob in `shared/src/constants.ts`.

Simulation script (reproduce in `shared/scripts/pace.ts` as a task):

```python
def run(weekly_points, e, mult, years=15):
    xp, out = 0, {}
    for w in range(1, 52*years+1):
        L = level_for(xp)
        xp += weekly_points * ((L+1)**e) * mult
        for m in (10,30,50,70,80,90,99):
            if m not in out and level_for(xp) >= m: out[m] = w/52
    return out
```

---

## 4. Benchmarks behind the point weights

| Source | Finding | How it shaped the design |
|---|---|---|
| LinearB, "The AI engineering productivity gap: 2026 benchmarks" (≈2.7M PRs, 83k devs, Feb–May 2026). https://linearb.io/resources/ai-engineering-productivity-gap | Top-decile orgs merge ≈2.6 PRs/dev/week; next tier 1.9; bottom 1.3. Autonomous-agent PRs merge within 30 days 79% of the time vs 92% for human-only. Elite orgs: 54% of PRs AI-assisted, <5% fully autonomous. | Merge, not open, is the payout (90 vs 10 points). Party bonus rewards the human-in-the-loop pattern that correlates with merge success. |
| Microsoft field study on CLI coding agents (reported July 2026). https://www.techrepublic.com/article/news-ai-coding-agents-microsoft-pull-requests/ · https://lumienai.com/news/microsoft-ai-coding-agents-pull-requests-24-percent-study | +24% merged PRs on average; >50% for engineers using agents 5+ days/week; one report cites heavy users going from ≈21 to ≈44 merged PRs/month. | "Power user" profile = 10–15 merged PRs/week. Opens capped at 5/day to blunt agent spam without hurting real output. |
| Study on agent introduction (reported Oct 2026, via secondtalent.com roundup). https://www.secondtalent.com/resources/ai-coding-assistant-statistics/ | +30% LoC, +20% commits, +23% PRs after agents. | LoC inflates faster than merges, so size points are log-scaled and capped at 120 (a 1,000-line PR is worth ~1.7× a 100-line one, not 10×). |
| GitHub-wide statement (July 2026) | ~1 in 3 PRs involves an agent. | Bot accounts are excluded as actors, but human merges/reviews of bot PRs count: reviewing agent output is the work. |

Weights are therefore: author-side ≈ 100–240 points per merged PR depending on size and review; reviewer-side 40–115 per PR depending on depth. A thorough review of someone else's PR is worth about half a merged PR of your own, which is the intended message.

Not found: any public per-tool (Claude Code vs Copilot agent) PRs-per-developer figure. The "Stripe 1,300 PRs/week" claim circulating on blogs has no primary source and was ignored.

---

## 5. GitHub App integration facts

* Apps declare permissions in a manifest; webhooks are pushed per installation. Reference read-only PR apps use exactly `Pull requests: Read` + `Metadata: Read` and subscribe to `pull_request` and review events: https://docs.stably.ai/about/github-app-permissions · https://extra-codeowners.readthedocs.io/en/latest/reference/github-permissions/ · https://prdeploy.readthedocs.io/en/latest/getting-started/1-github-app/
* `pull_request_review` and `pull_request_review_comment` events are delivered under the Pull requests permission. `issue_comment` (PR conversation comments) requires `Issues: Read`, which is why it is deferred.
* Signature header: `X-Hub-Signature-256: sha256=<hmac>`; compute HMAC-SHA256 of the raw body with the webhook secret; compare with `crypto.timingSafeEqual` after length check. Delivery id header: `X-GitHub-Delivery`. Event name header: `X-GitHub-Event`.
* User authorization for a GitHub App uses the App's OAuth client id/secret at `https://github.com/login/oauth/authorize` and `/access_token`; the resulting user token can call `GET /user` and `GET /user/installations`. We discard it after those two calls.
* Installation access tokens (for any future backfill) are minted with a JWT signed by the App private key (RS256, 10-min expiry) at `POST /app/installations/{id}/access_tokens`; REST rate limit 5,000/hour per installation.
* Webhook payload fields used: `pull_request.{number,user.id,user.type,user.login,draft,base.ref,base.repo.default_branch,additions,deletions,changed_files,commits,merged,merged_by.id,created_at,merged_at,closed_at}`, `review.{user.id,state,submitted_at}`, `comment.{user.id}`, `repository.{id,private}`, `installation.id`, `sender.{id,type,login}`. Note: `additions/deletions/changed_files` are present on `pull_request` events but **not** on review events; the PR item must be upserted from the PR event first, or fetched lazily (deferred: v1 relies on the `pull_request` event having arrived; if a review arrives for an unknown PR, store the review and score size as 0).
* `synchronize` events are high-volume. Count them only to compute `review_round_count` and the Flaky Test Wraith condition; never score them.

---

## 6. AWS cost model

Assumptions: ≈50 webhook deliveries/day per active user across installed repos (includes teammates' activity in those repos), each ≈200 ms at 256 MB and 4 DynamoDB writes; ≈5 API calls/day per user; raw events TTL 90 days; error-only logs; badges cached 6 h at CloudFront.

| Users | Ingest invocations/mo | Lambda | DynamoDB | Other | Total |
|---|---|---|---|---|---|
| 0–100 | ≤150k | $0 | $0 | $0 | $0 |
| 1,000 | 1.5M | ≈$0.10 | ≈$0 (raise to 10/10 provisioned, still free) | $0 | ≈$0–1 |
| 10,000 | 15M | ≈$9 | ≈$5–10 (autoscale ~60 WCU at peaks; ~13 GB) | $0–5 logs | ≈$15–25 |

Always-free allowances relied on (verify against the official pages before launch): Lambda 1M requests + 400k GB-s/month; DynamoDB 25 GB + 25 provisioned RCU/WCU (on-demand tables are **not** covered); CloudFront 1 TB + 10M requests; SSM standard parameters; CloudWatch 5 GB logs. Accounts created after 15 July 2025 are on the credit-based Free Plan; always-free still applies afterwards. Sources: https://spot.rackspace.com/blog/aws-free-tier · https://dynobase.dev/dynamodb-free-tier · https://infratally.com/articles/aws-free-tier-2026/

Cost scales with installed-repo activity, not signed-in users. Dropping unlinked actors before any write (Requirement 2.5) is the most important cost control.

---

## 7. Design decisions and their reasons (ADR-style)

**ADR-1 Zone scaling instead of rescaling the table.** Keeps D2's numbers authentic (a player can look up "level 61 = 128,782,495" and it matches) while making rewards meaningful at every level. Alternative rejected: dividing the table by 1,000 (still has the 582,000× spread; nothing gained).

**ADR-2 Points/Power/Zone vocabulary.** Original draft used Balatro's Chips × Mult and poker terms (Blinds, Ante). Owner rejected poker vocabulary as meaningless in a dungeon. Mechanics kept; words replaced: Chips→Points, Mult→Power, Small/Big/Boss Blind→Scout/Raid/Boss acts, Ante→Renown.

**ADR-3 The Shop is the Balatro element.** Owner's intent for "Balatro" was the shop with jokers/cards, not the scoring display. Shop layout copies Balatro's: 2 jokers (Charms), 2 packs, 1 voucher, re-roll, sell, interest with a cap.

**ADR-4 Parody Moguls, not real CEOs.** Owner suggested real executives (first names or caricatures). Real names and likenesses in a shipped product carry publicity-rights and defamation exposure with no gameplay benefit. Decision: six invented archetypes whose traits are recognisable (Rocket Man, Leather Jacket, Turtleneck, Hoodie, Founder, Two-Pizza Boss), a satire disclaimer in the Bestiary, no real names, logos or company references anywhere in code, assets or copy.

**ADR-5 No leaderboards in v1.** Every anti-cheat concern (farming a private repo, bot inflation) is harmless when the only person you can deceive is yourself. Also removes the "manager dashboard" perception risk. Guild raids (summed XP, no individual ranking) are the v2 social feature.

**ADR-6 GitHub Pages + Lambda Function URLs, no API Gateway.** API Gateway's free tier expires after 12 months and adds nothing here. Function URLs are billed as Lambda invocations. CloudFront is used only where caching matters (badges).

**ADR-7 Provisioned DynamoDB.** On-demand is billed from the first request; provisioned 5/5 is inside the permanent 25/25 allowance and handles ~5 writes/sec, far above a few hundred users' needs.

**ADR-8 Bearer JWT in localStorage rather than cookies.** The client (github.io) and API (lambda-url.on.aws) are cross-site; third-party-cookie restrictions make cookie sessions unreliable. The token grants only read of your own game state and shop actions; XSS surface is minimised by a strict CSP and no user-generated strings except GitHub logins.

**ADR-9 Pure, shared scorer.** The same TypeScript runs in Lambda (authoritative) and the browser (for previews and tests), so the Combat Log breakdown is guaranteed to match what was stored.

**ADR-10 UTC weeks.** Simplest correct behaviour; players in UTC−8 see Monday start Sunday afternoon. Documented, revisit in v1.1 with a timezone setting (needed for Night Owl anyway).

---

## 8. Open items for the implementer to decide (low stakes)

1. Svelte 5 vs vanilla TS for the client. Research leaned Svelte for the number of screens; either satisfies the requirements. Pick one in task 1 and don't revisit.
2. SAM vs CDK. SAM is lighter for two Lambdas and one table; CDK if you prefer TypeScript throughout. Requirements say "one SAM template"; CDK synthesising to one template is acceptable.
3. Whether the Flaky Test Wraith threshold (≥4 `synchronize` pushes) counts force-pushes separately. Not worth distinguishing in v1.
