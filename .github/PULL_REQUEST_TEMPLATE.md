## What and why

<!-- What does this change, and why? Link the issue it closes. -->

Closes #

## Checklist

- [ ] **Tests** are added or updated for what changed, and `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` pass.
- [ ] **No new stored fields** outside [Requirement 3.1 and 3.2](../blob/main/.kiro/specs/mergescape/requirements.md). Nothing from a webhook payload (titles, bodies, comment text, file paths, diffs, private repository names) is stored or logged, and the schema guard test still passes.
- [ ] **No real names.** Fixtures, tests, Charms, Moguls and copy use invented names, with no real people, companies, logos or GitHub logins.
- [ ] **No new tracker, analytics, third-party request or runtime dependency**, or the pull request explains each one in a line.
- [ ] **If scoring changed:** it follows an agreed "Scoring rule proposal" issue (linked above), the numbers live only in `constants.ts`, and the worked examples in design.md section 4.5 still reproduce.
- [ ] **If privacy or cookies changed:** `PRIVACY.md`, `COOKIES.md` and the Privacy and Cookies pages in the client were updated together.
- [ ] Commit messages follow the convention in [CONTRIBUTING.md](../blob/main/CONTRIBUTING.md).
