# Credits

What in Mergescape was made by someone other than the maintainers, and what was not.

## Sound

**Every sound is synthesised in the browser, as it plays.** There are no audio files, samples, recordings or sound libraries in the repository, the build or the page, so there is nothing to license, attribute, download or cache. The nine cues (score ticker, level-up, loot flip, loot glint, Feat unlock, Mogul reveal, shop purchase, act clear and expedition return) are a few lines of plain data each in [`packages/client/src/lib/sound.ts`](../packages/client/src/lib/sound.ts): oscillators (sine, triangle, square or sawtooth) with a pitch, a length and a level, played through the Web Audio API. They are released under the project's MIT licence like the rest of the code.

Sound is opt-in and off by default; see [COOKIES.md](../COOKIES.md) for what the switch stores.

## Art

All sprites (the hero, the monsters, the Moguls, the gear and the pets) are drawn in this repository as 16 by 16 palette-indexed pixel data in [`packages/client/src/lib/sprites.ts`](../packages/client/src/lib/sprites.ts) and rendered as SVG. No external art, icon set or image file is used. The Moguls are invented caricatures with invented names; see the disclaimer in [TERMS.md](../TERMS.md).

## Fonts

The client loads three typefaces from Google Fonts, all under the SIL Open Font License 1.1:

- **Pixelify Sans**, for headings and numbers in the pixel style.
- **IBM Plex Sans**, for body text.
- **IBM Plex Mono**, for figures and code.

Loading them is the one place the page contacts a third party; [PRIVACY.md](../PRIVACY.md) says so. Every font has a system fallback, so the game reads the same, if less prettily, without them.

## Ideas

The game takes inspiration from Diablo II's experience table, Slay the Spire's runs and cards, Balatro's shop and jokers, Old School RuneScape, Idlescape and WalkScape. It uses no assets, names or text from any of them. The sources behind the design are listed in [`.kiro/specs/mergescape/research.md`](../.kiro/specs/mergescape/research.md).

## Code

Mergescape is built with Svelte, Vite, Vitest, TypeScript, the AWS SDK and the AWS CDK, each under its own open source licence (MIT or Apache-2.0). The lock file, [`pnpm-lock.yaml`](../pnpm-lock.yaml), names every package and version.
