# Mergescape

Mergescape is a browser idle RPG where your character gains experience only from your real pull-request activity on GitHub: opening, reviewing and merging. A read-only GitHub App sends webhooks to a small AWS backend, and a static client shows your character, a Combat Log that explains every XP grant, a weekly three-act run and a shop. It stores counts and timestamps only, never code or comment text, and it costs nothing at personal scale.

The requirements, design, research and task list live in [`.kiro/specs/mergescape/`](.kiro/specs/mergescape/), and implementation choices are recorded in [`docs/decisions.md`](docs/decisions.md).

## What the App can see

The GitHub App asks for exactly **two permissions** and receives exactly **five events**. The registration values are in [`docs/github-app-manifest.json`](docs/github-app-manifest.json).

| Permission    | Level | Why                                                           |
| ------------- | ----- | ------------------------------------------------------------- |
| Pull requests | Read  | The three pull request webhooks below (counts and timestamps) |
| Metadata      | Read  | Mandatory for every GitHub App                                |

| Event                         | Why                                                             |
| ----------------------------- | --------------------------------------------------------------- |
| `pull_request`                | opened, ready for review, pushed to, closed or merged           |
| `pull_request_review`         | a review was submitted (approved, changes requested, comment)   |
| `pull_request_review_comment` | an inline review comment was created                            |
| `installation`                | the App was installed, removed, suspended or its access changed |
| `installation_repositories`   | repositories were added to or removed from an installation      |

You subscribe to the first three; GitHub delivers the two `installation` events to every App automatically. The App has no write permission of any kind: it cannot comment, merge, push or change a setting. It does not ask for Contents, Issues, Discussions or Members, so it cannot read code, titles, descriptions or comment text.

## How scoring works

Every XP grant follows a published formula. The scorer is a pure function in [`packages/shared/src/score.ts`](packages/shared/src/score.ts) with its constants in [`packages/shared/src/constants.ts`](packages/shared/src/constants.ts) and tests that pin every number; the design rationale is in [`design.md`](.kiro/specs/mergescape/design.md) section 4. The Combat Log in the client shows the breakdown line by line for each event.

## Privacy, Terms and your data

- [Privacy](packages/client/src/routes/Privacy.svelte) is the client's `#/privacy` page: no code is read, counts and timestamps only, export and delete are available, activity from people who have not signed in is discarded, and the game is not a performance-review tool.
- [Terms](packages/client/src/routes/Terms.svelte) is the client's `#/terms` page.
- **Settings** in the client has **Export JSON** (`GET /export`, everything stored under your player) and **Delete everything** (`POST /delete`, which also removes pull request records that only you appear in). The next sign-in starts a fresh level-1 character.
- Logs record error names only, never a webhook payload, and refer to people by numeric id.

## The README badge

`![Mergescape](https://<badge-domain>/badge/<your-login>.svg)` renders `Lv 41 Warden · Renown 17`: level, Vocation and Renown, nothing else. `<badge-domain>` is the `BadgeDomain` stack output (a CloudFront domain); an unknown login gets a neutral "unranked" badge. Badges are cached for six hours.

## Self-hosting

You need an AWS account, a GitHub account, the AWS CLI and `openssl`. Everything below runs inside the AWS and GitHub free allowances; [`packages/infra/README.md`](packages/infra/README.md) has the longer notes behind each step.

1. **Fork this repository.** The workflows run in your fork.
2. **Register the GitHub App** (Settings, Developer settings, GitHub Apps, New GitHub App) with the values from [`docs/github-app-manifest.json`](docs/github-app-manifest.json):
   - Homepage URL: your fork's URL. Webhook: Active, secret from `openssl rand -hex 32` (keep it for step 3). Until step 7 gives you the real URLs, put any `https://` placeholder in the webhook URL and callback URL.
   - Repository permissions: **Pull requests: Read-only** and **Metadata: Read-only**; no other permission.
   - Subscribe to events: **Pull request**, **Pull request review**, **Pull request review comment**.
   - Identifying users: leave "Request user authorization (OAuth) during installation" off, callback URL set in step 7.
   - After creating it, note the **Client ID**, generate a **client secret** and generate a **private key** (a `.pem` file).
3. **Create the five SSM parameters** (once per account and region; the prefix must equal the stack's `SsmPrefix`, default `/mergescape`). Use the default key (omit `--key-id`):
   ```sh
   export AWS_REGION=us-east-1 MSYS_NO_PATHCONV=1
   P=/mergescape
   aws ssm put-parameter --type SecureString --name $P/github-app-private-key --value file://private-key.pem
   aws ssm put-parameter --type SecureString --name $P/github-webhook-secret --value '<secret from step 2>'
   aws ssm put-parameter --type SecureString --name $P/github-oauth-client-id --value '<Client ID>'
   aws ssm put-parameter --type SecureString --name $P/github-oauth-client-secret --value '<client secret>'
   aws ssm put-parameter --type SecureString --name $P/jwt-key --value "$(openssl rand -base64 48)"
   ```
4. **Let GitHub Actions deploy without stored keys:** create the OIDC identity provider and a deploy role pinned to your `main` branch (trust policy in [`packages/infra/README.md`](packages/infra/README.md)).
5. **Set repository variables** (Settings, Secrets and variables, Actions, Variables): `AWS_DEPLOY_ROLE_ARN` (the role), `PAGES_ORIGIN` (`https://<owner>.github.io`) and `ALERT_EMAIL` (receives the budget alarms). Optional: `APP_SLUG` (your App's slug, for the install link; default `mergescape`), `CLIENT_BASE_PATH`, `AWS_REGION`, `STACK_NAME`, `SSM_PREFIX`, `STAGE`.
6. **Enable Pages:** Settings, Pages, Source: **GitHub Actions**. Then push to `main`: `deploy.yml` validates the template, builds and deploys the stack, builds the client against its API URL and publishes it.
7. **Connect the App.** Read the stack outputs (`aws cloudformation describe-stacks --stack-name mergescape --query "Stacks[0].Outputs"`). In the App's settings set the webhook URL to `IngestUrl` and the callback URL to `ApiUrl` plus `auth/callback`. "Recent deliveries" should show a ping answered with 200.
8. **Play.** Open your Pages site, sign in with GitHub, install the App on the repositories you want counted, and open a pull request.

### Budget alarms

The stack creates two AWS Budgets, **1 USD** and **10 USD** per month, which e-mail `ALERT_EMAIL` when actual spend passes 100 % of the limit. Confirm them in the Billing console after the first deploy. Budgets cover the whole AWS account, not just this stack. A flood of requests is also capped by reserved concurrency (10 for `ingest`, 5 for `api`), so the worst case is dropped requests rather than a bill.

## Development

Requires Node 22 and pnpm 12 (`corepack enable` picks up the pinned version from `package.json`).

```sh
pnpm install --frozen-lockfile   # install
pnpm lint                        # eslint + prettier --check
pnpm typecheck                   # tsc and svelte-check in every package
pnpm test                        # vitest with coverage thresholds, all packages
pnpm build                       # build every package
pnpm format                      # prettier --write

pnpm --filter @mergescape/client dev       # client dev server
pnpm --filter @mergescape/infra validate   # template checks, plus sam validate --lint if SAM is installed
```

`pnpm test` fails below these line-coverage floors: `shared` 95 % (and 100 % branches on `score.ts`), `backend` 90 %, `client` 90 %. CI also runs `cfn-lint` and `checkov` on the template and `pnpm audit --prod`.

## Layout

| Package            | Purpose                                           |
| ------------------ | ------------------------------------------------- |
| `packages/shared`  | Game tables, constants, types and the pure scorer |
| `packages/backend` | Lambda handlers: webhook ingest and the API       |
| `packages/client`  | Svelte 5 + Vite static client                     |
| `packages/infra`   | AWS SAM template                                  |

## License

[MIT](LICENSE)
