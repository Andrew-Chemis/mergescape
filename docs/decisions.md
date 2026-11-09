# Decisions

Short records of implementation choices that `.kiro/specs/mergescape/` left open or that task 1 had to make.

## Client framework: Svelte 5 + Vite

Chosen from the open choices in `research.md` section 8, item 1. The client has ten screens that share state and components, which suits Svelte's component model and runes better than hand-rolled DOM code. Vite is the standard build tool for it and produces the static bundle GitHub Pages serves. The client is TypeScript, targets ES2022, uses a minimal hash router (hash routes need no server rewrites on GitHub Pages) and is type-checked with `svelte-check`. Not to be revisited.

## Infrastructure: AWS SAM

Chosen from the open choices in `research.md` section 8, item 2. The stack is two Lambda functions, one DynamoDB table, one CloudFront distribution and a few supporting resources, and Requirement 12.1 asks for one SAM template. SAM expresses that directly in `packages/infra/template.yaml` and bundles TypeScript with esbuild, with no extra synthesis step. `packages/infra/template.yaml` is a placeholder until task 5.

## Other choices made in task 1

- **TypeScript 5.9, not 7.** `tasks.md` specifies TypeScript 5.x. `typescript-eslint` also only supports TypeScript below 6.1. Revisit when that range widens.
- **`tsconfig.base.json` with `strict`.** Every package extends it. Backend targets ES2023 (the language level of Node 22); client targets ES2022 with DOM libraries. Module resolution is `Bundler` everywhere because esbuild (Lambda) and Vite (client) bundle all code.
- **`shared` is consumed as TypeScript source.** Its `exports` point at `src/index.ts`, so `typecheck` and `test` need no prior build and Vite, esbuild and Vitest compile it where it is imported.
- **`build` is a compile check for `shared`, `backend` and `infra`.** It runs `tsc --noEmit` over production sources only (tests excluded). Lambda bundles are produced by `sam build` in task 5; the client build is `vite build`.
- **Pinned versions live in one place.** `pnpm-workspace.yaml` has a `catalog:` of exact versions that every `package.json` references.
- **Svelte files are type-checked, linted and format-checked.** `svelte-check` types them, `eslint-plugin-svelte` lints them and `prettier-plugin-svelte` formats them (added in task 9, pinned in the catalog). Task 1 had left both plugins out to keep dependencies minimal until real components existed.
- **`@eslint/js`** is the only dependency beyond the agreed list. It supplies ESLint's recommended rule set for the flat config.
