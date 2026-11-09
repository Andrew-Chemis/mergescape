# Cookies and local storage

_Last updated: 9 November 2026_

**Mergescape sets no cookies.** It keeps three small items in your browser's local storage on this device, and nothing else. This page lists them, says how to clear them, explains what GitHub's own cookies do while you sign in, and describes the sound and analytics choices. The client shows the same page at `#/cookies`, and the two are kept in step. For everything else about your data, see [PRIVACY.md](PRIVACY.md).

## What is stored on this device

Local storage is a small store that only this site can read. Unlike cookies, its contents are not sent along with every request. The keys Mergescape uses are exactly these:

| Key                    | What it holds                                                                                                        | Why                                                                                                                                              | Removed                                                                                                 |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `mergescape.token`     | Your sign-in token: a signed session token that names your numeric GitHub id and expires after 7 days.               | To keep you signed in. It is sent only to Mergescape's own server, in a request header.                                                          | By Sign out, by Clear local data, or automatically when the server turns it down (for example expired). |
| `mergescape.mogulSeen` | The number of the week for which the Mogul reveal last played, for example `2026-46`.                                | So that reloading the page does not replay the reveal.                                                                                           | By Clear local data.                                                                                    |
| `mergescape.consent`   | Your choices, as `{ "analytics": false, "sound": false, "updatedAt": "..." }`: analytics on or off, sound on or off. | To remember what you chose. It is written only when you use a switch: the analytics switch on the Cookies page, or the sound switch in Settings. | By Clear local data.                                                                                    |

All three are either needed for the game to work or record a choice you made, so there is no cookie banner. Nothing else is written to local storage, session storage, IndexedDB or cookies.

## How to clear them

- **Settings, then Sign out** removes the sign-in token (`mergescape.token`) and reloads the page. It leaves the other two items alone.
- **The Cookies page, then Clear local data** removes every item whose key starts with `mergescape.`, including the token, and reloads the page. You are signed out afterwards. This changes only this browser: your character and your records on the server stay as they were. To delete those, use **Delete everything** in Settings (see [PRIVACY.md](PRIVACY.md)).
- Your browser's own settings for site data will also clear them.

## GitHub's own cookies

When you sign in, your browser goes to github.com, and GitHub sets its own cookies there under [GitHub's privacy statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement). Mergescape cannot see, read or control them. You manage them in your browser's settings, and your GitHub account settings show which Apps you have authorised, including this one.

## The analytics choice

There are **no analytics today**: nothing about your visit is measured, whatever you choose. The maintainer intends to add first-party, privacy-respecting analytics later (a package called noren). When that happens it will be **opt-in**, so it will be off unless you switch it on, and [PRIVACY.md](PRIVACY.md) will describe it first.

The Cookies page already has the switch, so that your choice is in place before any analytics exists. It is **off by default**. Turning it on or off saves your choice in `mergescape.consent` on this device and does nothing else yet, because nothing reads it. You can change your mind there at any time, and Clear local data resets it to off.

## The sound choice

Mergescape can play a few short chimes for the big moments (a level-up, a Feat unlocking, a Mogul arriving, loot, a purchase, an act clear, the character coming home). **Sound is off by default.** It is switched on only by you, with the sound switch in Settings, and it stays off even if your device asks for reduced motion until you do. The chimes are made in your browser as it plays them: there are no audio files and nothing is downloaded or sent anywhere. Your choice is the `sound` field of `mergescape.consent`. Browsers only start sound after you have clicked, tapped or pressed a key on the page, so nothing plays before that, and with sound off the page does not even create an audio object. Clear local data resets it to off.
