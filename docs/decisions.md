# Decisions

Short records of implementation choices that `.kiro/specs/mergescape/` left open or that task 1 had to make.

## Client framework: Svelte 5 + Vite

Chosen from the open choices in `research.md` section 8, item 1. The client has ten screens that share state and components, which suits Svelte's component model and runes better than hand-rolled DOM code. Vite is the standard build tool for it and produces the static bundle GitHub Pages serves. The client is TypeScript, targets ES2022, uses a minimal hash router (hash routes need no server rewrites on GitHub Pages) and is type-checked with `svelte-check`. Not to be revisited.

## Infrastructure: AWS CDK, replacing SAM (task 25)

Tasks 5 and 19 built the stack as one SAM template and recorded "SAM stays; CDK was considered and not adopted". Task 25 reverses that: **the stack is a CDK v2 app in TypeScript (`packages/infra`: `bin/mergescape.ts`, `lib/mergescape-stack.ts`), with the same resources and the same IAM as the template had.** It deploys with `cdk deploy` from `deploy.yml`. Why:

- **The landing zone grants deploys only through CDK bootstrap roles.** The owner's AWS organization is managed by a landing zone. Every app gets its own account, CDK-bootstrapped in us-east-1 with the default qualifier `hnb659fds`, and GitHub Actions can assume only `lz-<app>-deploy` in the Infrastructure account, whose single permission is `sts:AssumeRole` on the `cdk-hnb659fds-*` roles of that app's account. `sam deploy` needs CloudFormation, S3, IAM, Lambda, DynamoDB, CloudFront and Budgets rights in the target account, which no role in that setup has; `cdk deploy` works entirely through the bootstrap roles.
- **The owner's other projects are CDK.** One toolchain and one set of conventions. `aws-cdk-lib`, `aws-cdk` and `constructs` are pinned to the versions the landing zone pins (2.270.0, 2.1142.0, 10.8.1), so the CLI matches the version of the bootstrap template.

The reasons for SAM, revisited:

- **Two functions and one table.** Still a small stack, and the stack file is about as long as the template was (a few hundred lines). The typed constructs catch a misspelled property at `tsc` time instead of at deploy time.
- **Validation with no AWS access.** Kept. `cdk synth --no-lookups` needs no credentials, `cfn-lint` and `checkov` read the synthesized template, and `aws-cdk-lib/assertions` tests replace `validate.mjs`. They are stronger: they see exactly what CloudFormation receives, including the roles and permissions CDK generates, and a committed snapshot shows every change to the template in review.
- **No bootstrap stack.** No longer a cost: the landing zone bootstraps the accounts, and the bootstrap roles are what shrink the deploy role from "manage the stack's resources" to `sts:AssumeRole`. A self-hoster outside the landing zone runs `cdk bootstrap` once (documented).
- **esbuild bundling is built in.** `NodejsFunction` runs the same esbuild with the same settings (minified, no source map, `node22`, everything bundled, the AWS SDK too); a test checks the command and the bundles.

Choices inside the CDK app:

- **Region.** `us-east-1`: the landing zone declares the Mergescape account for that region only and its bootstrap StackSet covers it (the guardrails would also allow `us-west-2`; CloudFront and Budgets are global). The SAM stack defaulted to `us-east-1` too.
- **Context, not CloudFormation parameters.** `accountId`, `region`, `pagesOrigin`, `alertEmail`, `stage`, `ssmPrefix` and `clientBasePath` come from `cdk.json` defaults and `-c` overrides, validated with the patterns the SAM parameters had. Defaults for `pagesOrigin` and `alertEmail` are placeholders so that `cdk synth` works with no `-c`; once an account is set, which is a deploy, the stack refuses them.
- **The account id is a repository variable** (`AWS_ACCOUNT_ID`) because the account does not exist until the landing zone vends it. `deploy.yml` skips the stack job while it is empty. `AWS_DEPLOY_ROLE_ARN` is gone as a required variable (the role is the landing zone's `lz-mergescape-deploy`) and stays as an optional override for a fork that brings its own role.
- **Same resources.** `AWS::CDK::Metadata` is switched off so that the template holds nothing the SAM one did not; the log groups are still deleted with the stack and the table is still `RETAIN` (CDK's own default for log groups is retain). The only parameter is CDK's `BootstrapVersion`.
- **Function URLs** get both permissions AWS now requires for auth NONE (`lambda:InvokeFunctionUrl` and `lambda:InvokeFunction` with `InvokedViaFunctionUrl`); SAM's version of this was implicit.
- **Output** goes to `packages/infra/dist/cdk.out`, a directory that git, ESLint and Prettier already ignore.
- **Lint.** `checkov` now sees the Function URLs as `AWS::Lambda::Url` and flags auth NONE (`CKV_AWS_258`), which the design requires (HMAC on ingest, JWT and an Origin check on api); it joins the skip list of nine, each entry explained in `.checkov.yaml`. `cfn-lint` ignores `W3005`, the redundant `DependsOn` that CDK writes on every function.
- **The spec text** said "SAM template" in Requirement 12.1 and tasks 5 and 6, describing the v0 plan. Task 24 rewrote those to say "one CDK stack"; the history stays here and in tasks 5 and 25.

Revisit if the stack grows (guild raids in v2 add queues and more functions): CDK is already the right tool for that.

## Feel and content (task 24)

- **Sound is synthesised, not sampled.** The tasks asked for nine samples "generated or CC0". Generating them in the browser with the Web Audio API (`client/src/lib/sound.ts`) means no audio files to ship, license or attribute, no extra request, and sounds that are plain data a test can measure (each under a second and a half, quiet, oscillators only). The cost is a plainer timbre than recorded samples. Sound is off by default; the preference is `sound` in the existing consent store (`mergescape.consent`), never inferred from the browser, so reduced motion does not turn it on. No `AudioContext` exists while it is off, and nothing plays before a gesture.
- **One cue per moment, plus four.** The ticker (a tick per term, climbing), level-up, loot flip, loot glint (rare cards), Feat unlock, Mogul reveal, shop purchase, act clear and expedition return are the nine. Under reduced motion the ticker and the loot reveal give one cue instead of a sequence, since their animation is one fade.
- **The three new Charms and two new Pledges** (Whetstone, Familiar Path, Long Lens; Fine Comb, Well Reviewed) were chosen to reach the v1 budget of 12 and 8 while passing the section 8.3 audit; docs/content-inventory.md says what each rewards and why none can be farmed. A Charm for reviews of week-old PRs was dropped because it would reward sitting on a review.
- **A player can hide the public badge.** `badge_public` lives on the profile (absent means public), is projected on GSI1 so the badge reads it in the same single query, and a hidden badge is the very SVG an unknown login gets, so the badge cannot be used to tell whether an account exists. It is set with `POST /settings` through the existing depth-mutation path, so it has the same week lock and replay protection as the other writes. DynamoDB cannot change a deployed index's projection in place, so an account that already has the table needs the index dropped and re-created in two deploys; the new CDK stack is meant for a fresh account.
- **Onboarding was measured, not changed.** Fixture weeks run through the real rules show a modest first week clears the Scout and the Raid and reaches the Boss act (and clears it in 5 of 6 Mogul draws), and the Boss falls by week 2 for every draw. No constant moved. Game-design.md sections 2 and 10 disagree about whether the first Renown is in week 1 or week 2; the numbers and the options are in docs/content-inventory.md for the owner to settle.

## Other choices made in task 1

- **TypeScript 5.9, not 7.** `tasks.md` specifies TypeScript 5.x. `typescript-eslint` also only supports TypeScript below 6.1. Revisit when that range widens.
- **`tsconfig.base.json` with `strict`.** Every package extends it. Backend targets ES2023 (the language level of Node 22); client targets ES2022 with DOM libraries. Module resolution is `Bundler` everywhere because esbuild (Lambda) and Vite (client) bundle all code.
- **`shared` is consumed as TypeScript source.** Its `exports` point at `src/index.ts`, so `typecheck` and `test` need no prior build and Vite, esbuild and Vitest compile it where it is imported.
- **`build` is a compile check for `shared`, `backend` and `infra`.** It runs `tsc --noEmit` over production sources only (tests excluded). Lambda bundles are produced by CDK's `NodejsFunction` (esbuild) when the stack is synthesized (task 25); the client build is `vite build`.
- **Pinned versions live in one place.** `pnpm-workspace.yaml` has a `catalog:` of exact versions that every `package.json` references.
- **Svelte files are type-checked, linted and format-checked.** `svelte-check` types them, `eslint-plugin-svelte` lints them and `prettier-plugin-svelte` formats them (added in task 9, pinned in the catalog). Task 1 had left both plugins out to keep dependencies minimal until real components existed.
- **`@eslint/js`** is the only dependency beyond the agreed list. It supplies ESLint's recommended rule set for the flat config.

## Release readiness (task 19)

- **Coverage is enforced from the root.** Under Vitest projects the coverage options are root-level only, so `vitest.config.ts` has glob-scoped thresholds per package and `pnpm test` runs with `--coverage`. Floors: `shared` 95 % lines and 100 % branches on `score.ts` (Requirement 4.10), `backend` 90 % lines, `client` 90 % lines. They sit a few points under the numbers at the time of writing so a real drop fails CI without blocking small changes; raise them as the packages grow.
- **Release checks that span packages live in `packages/infra/test/`.** They build the client and compare its CSP meta tag with Requirement 12.6, check the App manifest against Requirement 1.1 and check that the README links what Requirement 18.4 asks for.
- **`installation` and `installation_repositories` are not in the manifest's `default_events`.** GitHub delivers both to every App and does not let an App subscribe to them, so the manifest lists the three pull request events and the README says the App receives five.
- **`clientBasePath` is a stack setting** (a template parameter, `ClientBasePath`, until task 25; now a CDK context value). The api redirects the browser to the client after sign-in, and a Pages project site lives under `/<repository>/`, so the path must reach the Lambda. `deploy.yml` derives it from the repository name unless the variable `CLIENT_BASE_PATH` is set.
- **Checkov runs with a skip list** in `packages/infra/.checkov.yaml`, each entry a known gap that costs money or does not apply (see the file). Since task 25 both linters read the template that `cdk synth` writes, and cfn-lint ignores one warning (see the infrastructure decision above).
