# Mergescape

Mergescape is a browser idle RPG where your character gains experience only from your real pull-request activity on GitHub: opening, reviewing and merging. A read-only GitHub App sends webhooks to a small AWS backend, and a static client shows your character, a Combat Log that explains every XP grant, a weekly three-act run and a shop. It stores counts and timestamps only, never code or comment text.

The project is under construction. The requirements, design, research and task list live in [`.kiro/specs/mergescape/`](.kiro/specs/mergescape/), and implementation choices are recorded in [`docs/decisions.md`](docs/decisions.md).

## Development

Requires Node 22 and pnpm 12 (`corepack enable` picks up the pinned version from `package.json`).

```sh
pnpm install --frozen-lockfile   # install
pnpm lint                        # eslint + prettier --check
pnpm typecheck                   # tsc and svelte-check in every package
pnpm test                        # vitest, all packages
pnpm build                       # build every package
pnpm format                      # prettier --write

pnpm --filter @mergescape/client dev   # client dev server
pnpm --filter @mergescape/infra validate   # sam validate --lint, if SAM is installed
```

## Layout

| Package            | Purpose                                           |
| ------------------ | ------------------------------------------------- |
| `packages/shared`  | Game tables, constants, types and the pure scorer |
| `packages/backend` | Lambda handlers: webhook ingest and the API       |
| `packages/client`  | Svelte 5 + Vite static client                     |
| `packages/infra`   | AWS SAM template                                  |

## License

[MIT](LICENSE)
