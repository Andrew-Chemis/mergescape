# Privacy

_Last updated: 9 November 2026_

Mergescape is a free, open-source, single-player browser game run by an individual, the maintainer. This page says what the service stores about you, why, where, for how long, and what you can do about it. It is written to be read, not skimmed past. The client shows a shorter version of the same page at `#/privacy`, and the two are kept in step.

## In plain words

- We never read your code. No file contents, diffs, titles or comment text, ever.
- We store counts and timestamps only.
- You can export or delete everything in one click.
- The App can't write to GitHub.
- Activity from people who haven't signed in is discarded.
- Mergescape is a game, not a performance-review tool. There is no manager view.

## What is collected

Only numbers, ids and times. This is the complete list.

### About you

- Your **numeric GitHub id** and your **GitHub login**, learned once when you sign in. Nothing else from your GitHub profile: no name, no email address, no avatar.
- The **installation ids** of the Mergescape GitHub App installations you can see on GitHub, refreshed each time you sign in.
- The **game state** you earn: experience and level, the four skills, gold, Renown, Vocation, Charms, Pledges and Vouchers, the Bestiary (kill counts and first-seen times per monster), your weekly runs, supplies, expeditions, gear and Feats, and the counters that the scoring rules need (such as your weekly streak).
- Your **badge setting**: whether the public README badge may show you (on by default; see "The README badge").

### Pull requests

For a pull request that involves a signed-in player, exactly these fields (Requirement 3.1):

`installation_id`, `repo_id`, `repo_private`, `pr_number`, `author_id`, `opened_at`, `merged_at` or `closed_at`, `merged`, `merged_by_id`, `additions`, `deletions`, `changed_files`, `commits`, `review_round_count`, `sync_count`, `draft`, `base_ref_is_default`.

### Reviews

For a review on such a pull request, exactly these fields (Requirement 3.2):

`pr_key`, `reviewer_id`, `reviewer_is_bot`, `state` (approved, changes requested or commented), `submitted_at`, `inline_comment_count`.

How many reviews or inline comments one person has made on one pull request is worked out from these records, not stored separately.

### Combat Log

For each event that earned you something, one row: when it happened, what kind of event it was, the repository id and pull request number, the points, Power, Zone and level used, the XP and supplies you got, which monster it was in the game, the review state, the lines added and deleted, and the lines of the score breakdown. These lines are produced by the scorer from the numbers above. They contain no text from GitHub.

### Plumbing

- **Installations:** the installation id, the account id it belongs to, the repository ids it covers, and whether it is suspended.
- **Webhook delivery ids**, so that a repeated delivery is not counted twice.
- **A one-time sign-in nonce**, so that the sign-in flow cannot be replayed.
- **Anonymous counters** such as how many deliveries were scored, dropped or repeated. They have no person attached.
- **Server logs** that record error names only, never a webhook payload, and refer to people by numeric id.

## What is never collected

- Code, diffs, file paths, pull request titles or descriptions, and the text of any comment. GitHub's notifications can carry some of these, so our code keeps a short list of allowed numbers and drops the rest before anything is saved. A runtime check and a test fail if anything else is ever written.
- Your GitHub access token. Signing in uses it once to learn who you are, then discards it, so there is nothing stored that could be used to reach your account.
- Your email address, your real name or your avatar.
- The names of private repositories. When you look at your own private repositories in the game, the name is fetched from GitHub live and is not stored.
- Payment details. There is nothing to buy, and no payment of any kind.
- Your location, your IP address (beyond the ordinary short-lived records that GitHub and AWS keep for any web request, see "Third parties"), or any fingerprint of your device.

## Why we collect it

To credit the right person, work out the score and show you the Combat Log, run your weekly run, and draw the README badge. That is all. We do not sell data, share it for advertising or use it to profile anyone.

## Where it lives

- **AWS**, in the US East (N. Virginia, `us-east-1`) region by default. The game state, events and pull request records are in a DynamoDB table, the code runs on AWS Lambda, secrets are in AWS Systems Manager Parameter Store, and the badge is served through Amazon CloudFront. If you are outside the United States, your data is therefore processed in the United States.
- **GitHub Pages** serves the web page itself. It holds no personal data.
- **Your browser** holds a few small items in local storage (see "Cookies and local storage").

## How long we keep it

| What                                             | How long                                                                            |
| ------------------------------------------------ | ----------------------------------------------------------------------------------- |
| Raw events (Combat Log rows)                     | 90 days, then deleted automatically                                                 |
| Your profile and weekly run state ("aggregates") | Until you delete them                                                               |
| Pull request and review records                  | Until you delete everything, when the records only you appear in go too (see below) |
| Installation records                             | Until the App is uninstalled, then removed shortly afterwards                       |
| Webhook delivery ids                             | 7 days                                                                              |
| Sign-in nonces                                   | 10 minutes                                                                          |
| Sign-in sessions                                 | 7 days, then you sign in again                                                      |
| Server logs                                      | 14 days, errors only                                                                |
| The public badge                                 | Up to 6 hours in caches after a change                                              |

Automatic deletion is done by the database's expiry feature, which can run some hours or a couple of days after the time shown.

## People who haven't signed in

If the App is installed on a shared repository, GitHub tells the service about everyone's pull requests. **Activity from people who haven't signed in is discarded**: it earns nobody anything, it creates no profile and no Combat Log row, and nothing is kept about it except an anonymous count that something was dropped.

There is one narrow exception, because some rules (the party bonus, solo-kill halving and the Riposte) need to know that a review happened. When a signed-in player is the author, the merger or a reviewer of a pull request, the shared record of that pull request also notes each **human** review on it: the reviewer's numeric id, the verdict, the time and the number of inline comments, even if that reviewer has never signed in. It is a number, not a name, and it is deleted together with the pull request record. Reviews by bots are never recorded.

## Your rights and controls

- **Export.** **Settings** has an **Export JSON** button that downloads everything we hold under your player as one JSON file.
- **Delete.** **Settings** has **Delete everything**: it removes your character and every record that is only yours, including pull request records in which you are the only person involved. It cannot be undone, and your next sign-in starts again at level 1. Pull request records you share with another player stay for them.
- **Uninstall.** Removing the App on GitHub stops its events counting at once. Delete your data as well if you want the records gone.
- **Sign out and clear this device.** Settings has **Sign out**, and the Cookies page has **Clear local data**.
- **Other rights.** Depending on where you live you may have further rights, such as to access, correct or object. Export and Delete cover most of them directly. For anything else, open an issue (see "Contact").

## Third parties

- **GitHub** is where you sign in, where the webhooks come from, and where the page is hosted (GitHub Pages). GitHub's own privacy statement applies to what it does.
- **Amazon Web Services** hosts the service, as described above. AWS and CloudFront keep ordinary request records (such as IP addresses) for operating the network. We do not use them to identify anyone.
- **Google Fonts** supplies the three typefaces the page uses. Your browser fetches them directly from Google, so Google sees your IP address and browser details when it does. Nothing else is loaded from anywhere else.
- **No analytics today.** There are no ads, no analytics and no trackers in Mergescape, and nothing is sent to an analytics provider.

## Cookies and local storage

Mergescape sets **no tracking cookies**; the only cookie is a strictly necessary one the server sets for ten minutes while you sign in. It keeps three small items in your browser's local storage on this device: your sign-in token, the week for which the Mogul reveal last played, and your analytics choice. The exact list, how to clear them, and what GitHub's own cookies do while you sign in are on the Cookies page (`#/cookies` in the client, and [COOKIES.md](COOKIES.md)).

## Future analytics

_Stated on 9 November 2026._ Nothing described in this section exists yet.

The maintainer intends to add first-party, privacy-respecting analytics later, using a package called **noren**. If that happens:

- it will be **opt-in**: off by default, and nothing is measured until you switch it on;
- it will be **documented here first**: this page, with a new "Last updated" date, will say what is measured, why, where it goes and for how long, before any analytics code is released;
- it will be **controllable from the Cookies page** (`#/cookies`), where you can switch it off again at any time, and your choice is kept on your device under `mergescape.consent`;
- it will be **first-party only**: no ad networks, no third-party analytics providers and no cross-site tracking.

Until this section is replaced by a description of a real feature, there is no analytics.

## Not a performance tool

Mergescape is a game you play for yourself. Nobody else can see your character, there is no team dashboard and no manager view, and none is planned. Please do not use it to judge anyone's work. See the [Terms](TERMS.md).

## The README badge

If you put the Mergescape badge in a README, it is a **public image**: anyone who knows your GitHub login can request it and see your level, Vocation and Renown, the small icons of the (up to three) Feats you chose to pin, and the Old Coin if you found it, and nothing else.

**You can turn it off.** The switch "Show my badge publicly" in Settings is on by default. Turned off, the same address shows the neutral "unranked" badge that a login nobody has used gets, so it does not even show that you play. Places that have already loaded the picture can keep it for up to 6 hours. The choice is stored with your profile as `badge_public`, and the public badge reads it together with the fields above. After you delete your data the badge also shows the neutral "unranked" badge.

## Contact

Open an issue in the repository, or reach the maintainer through the contact options on their GitHub profile (`Andrew-Chemis`). Please do not put personal data in a public issue. For a security problem, follow [SECURITY.md](SECURITY.md).

## Changes

When this page changes, the "Last updated" date at the top changes with it, the change is in the history of this file, and for a material change the maintainer will also post a notice in the repository. The client's Privacy page is kept in step with this file.
