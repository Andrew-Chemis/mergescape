# Security policy

Mergescape reads pull-request metadata from GitHub on behalf of its players, so a security problem here matters even though the game is small. Thank you for looking, and for reporting responsibly.

## Reporting a vulnerability

**Please report privately. Do not open a public issue or pull request for a vulnerability.**

Use GitHub's private vulnerability reporting: on the repository page open the **Security** tab, choose **Report a vulnerability** and fill in the advisory form. Only the maintainer and you can see it. If that button is missing, open a public issue that says only "I have a security report, please enable private reporting" and nothing else, and the maintainer will arrange a private channel.

A useful report has:

- what you found and which part it affects (the `ingest` webhook endpoint, the `api`, the client, the infrastructure template or a workflow);
- steps to reproduce it, ideally against your own self-hosted copy or your own account;
- the impact you think it has, and any fix you would suggest.

Please do not include real secrets, tokens or other people's data in a report. If you came across any while testing, say that you did, stop, and do not keep a copy.

### What you can expect

This is a hobby project run by one person, so these are goals rather than guarantees:

- an acknowledgement within 7 days;
- a first assessment, and a plan or a question, within 14 days;
- a fix for confirmed issues as quickly as their severity warrants, with a published GitHub Security Advisory and credit to you if you want it.

### 90-day disclosure

We follow coordinated disclosure with a **90-day** window. Counted from the day you report:

- we aim to ship a fix and publish an advisory within 90 days;
- if a fix ships sooner, the advisory is published then, and you are free to write about it after it is out;
- if 90 days pass without a fix, you may disclose the details publicly. Tell us beforehand, so we can add a warning for anyone running a copy;
- we may ask for a short extension when a fix is close or depends on GitHub or AWS. Agree it with us in the advisory thread; the default is still 90 days.

## What is in scope

Issues in the code and configuration in this repository, and in the hosted copy the maintainer runs:

- **The webhook endpoint (`ingest`).** Signature verification (`X-Hub-Signature-256`), replay and duplicate handling, the 256 KB body limit, anything that lets a forged or crafted delivery change state.
- **The API (`api`).** The sign-in flow and its `state` nonce, the session token (JWT) and its verification, the `Origin` check and CORS, and above all authorisation: reading, changing, exporting or deleting another player's data, or the public badge revealing more than level, Vocation and Renown.
- **The client.** Cross-site scripting, a way around the Content-Security-Policy, the session token leaking (for example through a URL or a log), and anything that makes the page load code from somewhere unexpected.
- **The infrastructure template and workflows.** Over-broad IAM permissions, public exposure of anything that should be private, a way to read secrets from a workflow, or a weakness in the GitHub-to-AWS OIDC trust.
- **Privacy bugs.** Any path that stores or logs a field outside [Requirement 3.1 and 3.2](.kiro/specs/mergescape/requirements.md) (titles, bodies, comment text, file paths, diffs, private repository names, webhook payloads, access tokens). These are treated as security issues.

## What is out of scope

- Instances run by other people. If you self-host, you are responsible for your own AWS account and GitHub App. We will still help with a report about a flaw in this code that your instance inherited.
- Volume attacks. Flooding the endpoints is capped by design (reserved Lambda concurrency of 10 for `ingest` and 5 for `api`, so a flood costs only dropped requests). Please do not run load tests against the hosted copy.
- Gaming your own numbers. The game is single-player and has no leaderboard, so farming your own XP harms nobody and is not a vulnerability. Manipulating **someone else's** character or data is in scope.
- Social engineering, physical attacks, and attacks that need an already-compromised device or GitHub account.
- Vulnerabilities in GitHub, AWS, GitHub Pages or a browser. Report those to the vendor.
- Missing HTTP security headers that GitHub Pages does not let a project set (the CSP is delivered as a meta tag for that reason), and reports from automated scanners that come without a demonstration of impact.

Testing in good faith within these limits is welcome, and we will not take action against you for it. Use your own account and your own repositories, and stop as soon as you have shown the problem.

## What the GitHub App can and cannot do

The Mergescape GitHub App is read-only, and its registration values are public in [`docs/github-app-manifest.json`](docs/github-app-manifest.json).

**It asks for exactly two permissions:**

| Permission    | Level | Why                                                                |
| ------------- | ----- | ------------------------------------------------------------------ |
| Pull requests | Read  | The pull request webhooks (counts and timestamps are what we keep) |
| Metadata      | Read  | Mandatory for every GitHub App                                     |

**It subscribes to exactly these events:** `pull_request`, `pull_request_review`, `pull_request_review_comment`, and the two events GitHub always delivers to an App, `installation` and `installation_repositories`.

**It cannot** comment, review, merge, push, open or close anything, or change a repository or a setting: it has no write permission of any kind. It has no Contents permission, so it cannot read repository files, branches or commits. It has no Issues, Discussions, Members, Actions or Secrets permission either. Even a complete compromise of the AWS account would not give anyone write access to GitHub through this App.

**What it can see, honestly:** GitHub's webhook deliveries for pull requests carry more than we keep. They include things such as titles, descriptions and comment text, and GitHub's "Pull requests: Read" permission is wide enough in principle to read a pull request's content through its API. The protection is in what Mergescape does with it:

- the ingest code copies a short allow-list of numbers, ids and timestamps out of each delivery and drops everything else before anything is written;
- a runtime schema guard and a test fail if any other attribute is ever written to the table;
- payloads are never logged, and logs refer to people by numeric id only;
- the only calls Mergescape makes to GitHub on a player's behalf are the sign-in exchange, `GET /user` and `GET /user/installations`.

That is a promise about this code, which is why the code is public. Reviewing it is a contribution we value.

**Tokens and keys.** Signing in exchanges the OAuth code once to learn the player's numeric GitHub id and login, then discards the access token without storing it. Sessions use an HS256 token that expires after 7 days, verified for issuer and audience on every request. The App's private key, the webhook secret, the OAuth client secret and the signing key live in AWS Systems Manager Parameter Store as SecureStrings, are read at start-up and are never logged. Deployment uses GitHub's OIDC identity with no long-lived AWS keys in the repository.

**Worst plausible breach.** A dump of the database would expose GitHub user ids and logins, numeric repository ids, pull request numbers, line counts, timestamps and game state. That is unwelcome but not dangerous: no code, titles, comments, tokens or private repository names are stored.

## Supported versions

There are no numbered releases yet. Security fixes go to the `main` branch and to the hosted copy. If you run your own copy, redeploy from `main`.

## Keeping dependencies safe

Dependabot opens weekly pull requests for npm packages and GitHub Actions, CI runs `pnpm audit --prod`, and the Lambdas are bundled with esbuild from a lockfile, so nothing is installed at run time.
