# Contributing to Mergescape

Thanks for taking a look. Mergescape is a free, open-source (MIT), single-player browser game that turns your real pull-request activity into an idle RPG. It is run by one person as a hobby, so the process here is light, but a few rules are firm because they are what make the game safe to install on private repositories.

By taking part you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md). To report a security problem, read [SECURITY.md](SECURITY.md) first and do not open a public issue.

## What helps most

- **Bug reports** with the steps, what you expected and what happened. The bug template asks for the rest.
- **Scoring-rule proposals.** The scoring formula is the heart of the game and it is meant to be argued with. See [Scoring rules are debated in issues](#scoring-rules-are-debated-in-issues).
- **Ideas for Charms, Pledges, Feats, gear and Expeditions**, using the feature template. Invented names and jokes are welcome; real people and companies are not (see [Firm rules](#firm-rules)).
- **Accessibility, copy and documentation fixes.** These are always welcome as pull requests without a prior issue.
- **Code.** For anything bigger than a small fix, open an issue first so we agree on the shape before you spend your evening on it.

## Where the plan lives

The specification is in [`.kiro/specs/mergescape/`](.kiro/specs/mergescape/):

| File              | What it holds                                                                                            |
| ----------------- | -------------------------------------------------------------------------------------------------------- |
| `requirements.md` | The numbered requirements (R1 to R18) with acceptance criteria. Commit messages and tests cite these.    |
| `game-design.md`  | Pillars, loops, Expeditions, the Forge and Feats. **It wins on any conflict** with the other documents.  |
| `design.md`       | Architecture, the data model, the security and privacy model, and the scoring rules in full (section 4). |
| `research.md`     | Sources, benchmarks, the pacing simulation and the decisions behind them.                                |
| `tasks.md`        | The implementation plan, in dependency order, with a verification line per task.                         |

Two more documents matter to contributors: [`docs/decisions.md`](docs/decisions.md) records implementation choices the spec left open, and [`docs/api-contract.md`](docs/api-contract.md) holds the exact shapes of the API that the backend and the client share.

## Development setup

You need Node 22 and pnpm 12. `corepack enable` picks up the pinned pnpm version from `package.json`.

```sh
git clone <your fork>
cd mergescape
corepack enable
pnpm install --frozen-lockfile
```

The client runs fully offline on fixture data, so you do not need AWS or a GitHub App to work on the screens:

```sh
pnpm --filter @mergescape/client dev
```

Open the printed address. With no backend configured the client uses fixtures. `?fixture=1`, `?fixture=noevents` and `?fixture=noinstall` pick a variant, and `?live=1` adds a row that arrives a few seconds after load so you can watch the score ticker and the level-up flash.

Running your own backend (a GitHub App, the AWS stack and GitHub Pages) is described under "Self-hosting" in the [README](README.md) and in [`packages/infra/README.md`](packages/infra/README.md). You only need it if you are changing the backend or the infrastructure.

### Layout

| Package            | Purpose                                           |
| ------------------ | ------------------------------------------------- |
| `packages/shared`  | Game tables, constants, types and the pure scorer |
| `packages/backend` | Lambda handlers: webhook ingest and the API       |
| `packages/client`  | Svelte 5 + Vite static client                     |
| `packages/infra`   | AWS CDK app (TypeScript)                          |

## Running the checks

CI runs the first four on every pull request, and they must pass before a merge:

```sh
pnpm lint        # eslint, then prettier --check (Markdown, YAML and JSON are checked too)
pnpm typecheck   # tsc and svelte-check in every package
pnpm test        # vitest with coverage thresholds, all packages
pnpm build       # build every package
pnpm format      # prettier --write, to fix what lint found
```

While you work, run one package at a time:

```sh
pnpm --filter @mergescape/shared test
pnpm --filter @mergescape/backend test
pnpm --filter @mergescape/client test
```

`pnpm test` fails below the coverage floors in [`vitest.config.ts`](vitest.config.ts), and the scorer (`packages/shared/src/score.ts`) must keep 100% branch coverage (Requirement 4.10). The client tests include an axe-core accessibility run over every screen and a scan that fails on inline `style` attributes and `{@html}`, because the page's Content-Security-Policy forbids them.

## Scoring rules are debated in issues

Every XP grant follows a published formula (`Points x Power x Zone`, see [`design.md`](.kiro/specs/mergescape/design.md) section 4). The scorer is a pure function in [`packages/shared/src/score.ts`](packages/shared/src/score.ts) and its numbers live in [`packages/shared/src/constants.ts`](packages/shared/src/constants.ts), so that anyone, including a skeptical colleague, can read and challenge them.

Any metric built on pull-request counts can nudge people toward tiny pull requests or rubber-stamp approvals. The weights are tuned against that, and the maintainer wants to hear when they are not.

- **Change a number or a rule by opening a "Scoring rule proposal" issue first.** Say what behaviour the current rule rewards or punishes wrongly, what you would change, and what you expect to happen to real habits. Worked examples help more than adjectives.
- **Do not send a pull request that changes scoring without an agreed issue.** It will be closed with a pointer to the issue process, nothing personal.
- If a proposal is accepted, the pull request must change `constants.ts` (game constants live there and nowhere else), keep the worked examples in `design.md` section 4.5 reproducing exactly or update them in the same change, and add or adjust a test for every number that moved.
- The game is not a performance-review tool. Proposals that make it easier to rank or evaluate people will be declined.

## Firm rules

These come from the requirements and are checked in review (the pull request template repeats them):

1. **Never persist a field outside [Requirement 3.1 and 3.2](.kiro/specs/mergescape/requirements.md).** Counts, ids and timestamps only: no titles, bodies, comment text, file paths, diffs or private repository names. The backend has a runtime allow-list (`packages/backend/src/schema.ts`) and a test that fails on any new attribute. If you think a new field is needed, open an issue; do not edit the allow-list in a feature pull request.
2. **Never log a webhook payload.** Log errors only, and refer to people by numeric id.
3. **No new trackers, analytics, ads or third-party requests.** The client's CSP allows only its own origin, the API origin and Google Fonts. Anything that changes that is a design discussion and has to be written down in [`PRIVACY.md`](PRIVACY.md) first.
4. **No real names in fixtures, tests, Charms, Moguls or copy.** Use invented names, and numeric ids that are obviously fake. The Moguls are fictional caricatures with no real names, photos, logos or company references. "Former owners" of Reclaimed gear come from a curated list, never from real GitHub logins.
5. **No real-money purchases and no write access to GitHub.** Both are out of scope for the whole project.
6. **TypeScript strict, no `any`.** No new runtime dependency without a one-line justification in the pull request. Dependency versions are pinned in the `catalog:` of `pnpm-workspace.yaml`.

## Commit conventions

The history uses short, conventional subjects, and the repository's own plan ties each commit to a task and a requirement:

```
type(scope): N. what changed (R<n>)
```

- **type**: `feat`, `fix`, `docs` or `chore` (so far the history has `feat`, `docs` and `chore`).
- **scope**: the package, one of `shared`, `backend`, `client` or `infra`. Leave it off for changes that span the repository, such as `docs: tick tasks 15-17`.
- **N.**: the task number from [`tasks.md`](.kiro/specs/mergescape/tasks.md), when the change belongs to one. Skip it otherwise.
- **(R<n>)**: the requirement or requirements the change satisfies, for example `(R4)` or `(R11,R13)`.
- The body explains what and why, wrapped at about 80 columns. The diff already shows how.

Examples from the history:

```
feat(shared): 3. scorer core (R4)
feat(backend): 18. badge, export, delete (R11,R13)
docs: incentive audit of Feats, Charms, Pledges and Moguls
```

Keep commits focused. One logical change per commit, with its tests in the same commit.

## Pull requests

1. Fork, branch from `main`, and keep the change small enough to review in one sitting.
2. Run `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build`. CI runs them again.
3. Fill in the pull request template. Its checklist is not decoration: tests added, no stored field outside Requirement 3, no real names.
4. The maintainer reviews every pull request (see [`.github/CODEOWNERS`](.github/CODEOWNERS)). Reviews may take a few days; this is a hobby project.

Dependabot opens weekly, grouped pull requests for npm packages and GitHub Actions. They follow the same checks.

## Licence

Mergescape is released under the [MIT licence](LICENSE). By submitting a contribution you agree that it is licensed under the same terms.
