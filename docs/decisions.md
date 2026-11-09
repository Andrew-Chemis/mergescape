# Decisions

Short records of implementation choices that `.kiro/specs/mergescape/` left open or that task 1 had to make.

## Client framework: Svelte 5 + Vite

Chosen from the open choices in `research.md` section 8, item 1. The client has ten screens that share state and components, which suits Svelte's component model and runes better than hand-rolled DOM code. Vite is the standard build tool for it and produces the static bundle GitHub Pages serves. The client is TypeScript, targets ES2022, uses a minimal hash router (hash routes need no server rewrites on GitHub Pages) and is type-checked with `svelte-check`. Not to be revisited.

## Infrastructure: AWS SAM, kept over CDK

Chosen from the open choices in `research.md` section 8, item 2 (design.md section 9 says "SAM / CDK"), and confirmed at release readiness (task 19): **SAM stays; CDK was considered and not adopted.** Requirement 12.1 asks for one SAM template, and the stack is small and fixed: two Lambda functions, one provisioned DynamoDB table, one CloudFront distribution, a schedule and two budgets. Reasons:

- **Two functions and one table.** A CDK app earns its keep when there are constructs to reuse, loops over environments or many similar resources. There is nothing to abstract here, so a CDK program would be a longer way to write the same few hundred lines of CloudFormation.
- **Validation runs locally and in CI with no AWS access.** `packages/infra/scripts/validate.mjs` asserts the resource set, the IAM statements and the function settings from the YAML alone, and `cfn-lint` and `checkov` read the same file. Nothing has to be synthesised first, and what the reviewer reads is what CloudFormation receives.
- **No bootstrap stack.** `cdk deploy` needs `cdk bootstrap` (an extra stack with its own roles and bucket) in each account and region, which a self-hoster following the README would have to understand, and which widens the permissions of the OIDC deploy role. `sam deploy --resolve-s3` needs only the stack's own resources.
- **esbuild bundling is built in.** The `Metadata.BuildMethod: esbuild` entries produce the two single-file bundles without a separate build step.

Revisit if the stack grows (guild raids in v2 add queues and more functions) to the point where the template stops being readable at a glance.

## Other choices made in task 1

- **TypeScript 5.9, not 7.** `tasks.md` specifies TypeScript 5.x. `typescript-eslint` also only supports TypeScript below 6.1. Revisit when that range widens.
- **`tsconfig.base.json` with `strict`.** Every package extends it. Backend targets ES2023 (the language level of Node 22); client targets ES2022 with DOM libraries. Module resolution is `Bundler` everywhere because esbuild (Lambda) and Vite (client) bundle all code.
- **`shared` is consumed as TypeScript source.** Its `exports` point at `src/index.ts`, so `typecheck` and `test` need no prior build and Vite, esbuild and Vitest compile it where it is imported.
- **`build` is a compile check for `shared`, `backend` and `infra`.** It runs `tsc --noEmit` over production sources only (tests excluded). Lambda bundles are produced by `sam build` in task 5; the client build is `vite build`.
- **Pinned versions live in one place.** `pnpm-workspace.yaml` has a `catalog:` of exact versions that every `package.json` references.
- **Svelte files are type-checked, linted and format-checked.** `svelte-check` types them, `eslint-plugin-svelte` lints them and `prettier-plugin-svelte` formats them (added in task 9, pinned in the catalog). Task 1 had left both plugins out to keep dependencies minimal until real components existed.
- **`@eslint/js`** is the only dependency beyond the agreed list. It supplies ESLint's recommended rule set for the flat config.

## Release readiness (task 19)

- **Coverage is enforced from the root.** Under Vitest projects the coverage options are root-level only, so `vitest.config.ts` has glob-scoped thresholds per package and `pnpm test` runs with `--coverage`. Floors: `shared` 95 % lines and 100 % branches on `score.ts` (Requirement 4.10), `backend` 90 % lines, `client` 90 % lines. They sit a few points under the numbers at the time of writing so a real drop fails CI without blocking small changes; raise them as the packages grow.
- **Release checks that span packages live in `packages/infra/test/`.** They build the client and compare its CSP meta tag with Requirement 12.6, check the App manifest against Requirement 1.1 and check that the README links what Requirement 18.4 asks for.
- **`installation` and `installation_repositories` are not in the manifest's `default_events`.** GitHub delivers both to every App and does not let an App subscribe to them, so the manifest lists the three pull request events and the README says the App receives five.
- **`ClientBasePath` is a template parameter.** The api redirects the browser to the client after sign-in, and a Pages project site lives under `/<repository>/`, so the path must reach the Lambda. `deploy.yml` derives it from the repository name unless the variable `CLIENT_BASE_PATH` is set.
- **Checkov runs with a skip list** in `packages/infra/.checkov.yaml`, each entry a known gap that costs money or does not apply (see the file); cfn-lint runs with no exceptions.
