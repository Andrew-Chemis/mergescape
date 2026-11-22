<script lang="ts">
  import { TIER_SWAP_MS } from '../motion';
  import { MONSTER_NAMES } from '../names';
  import { gearTierFor, heroPaletteFor, MONSTER_SPRITE } from '../sprites';
  import type { HeroPalette } from '../sprites';
  import type { MonsterId } from '@mergescape/shared';
  import Sprite from './Sprite.svelte';

  /** The backdrops drawn so far, by biome name; see `backdrop`. */
  const BACKDROPS: Readonly<Record<string, 'town' | 'sewers' | 'marsh'>> = {
    Town: 'town',
    'Sewers of Legacy': 'sewers',
    'Flaky Marsh': 'marsh',
  };

  interface Props {
    level: number;
    /** Where the character is standing, e.g. `Flaky Marsh`. */
    biome: string;
    renown: number;
    /** The monster of the last kill, if any. */
    monster: MonsterId | null;
    /** Sleeping character (no kills yet). */
    asleep?: boolean;
    /** A line in the character's voice, drawn in the scene. */
    line?: string;
    /** The hero's palette when gear is worn (the highest tier); the level's tier palette when left out. */
    palette?: HeroPalette | undefined;
    /** The hero's cape colour (a hex string); no cape is drawn when left out. */
    cape?: string | null | undefined;
  }

  let {
    level,
    biome,
    renown,
    monster,
    asleep = false,
    line,
    palette,
    cape = null,
  }: Props = $props();

  /**
   * A level-up that crosses into a new gear tier swaps the hero's sprite (game-design.md section 9, moment 2).
   * The swap blinks for a moment, or only fades under reduced motion; opening Town already in a tier does not.
   */
  const tier = $derived(gearTierFor(level).tier);
  let swapping = $state(false);
  let shownTier: string | undefined;

  $effect(() => {
    const now = tier;
    const before = shownTier;
    shownTier = now;
    if (before === undefined || before === now) {
      return;
    }
    swapping = true;
    const timer = setTimeout(() => {
      swapping = false;
    }, TIER_SWAP_MS);
    return () => clearTimeout(timer);
  });

  /**
   * The backdrop of the biome (game-design.md section 11: three Town backdrops in v1, five by month 6, six by
   * month 12). The later biomes keep the last backdrop drawn until they get their own.
   */
  const backdrop = $derived(BACKDROPS[biome] ?? 'marsh');

  const description = $derived(
    asleep
      ? `Your character is asleep in ${biome}.`
      : monster
        ? `Your character in ${biome}, facing a ${MONSTER_NAMES[monster]}.`
        : `Your character in ${biome}.`,
  );
</script>

<div class="scene {backdrop}" data-backdrop={backdrop}>
  <p class="say">{line ?? `${biome} · Renown ${renown}`}</p>
  <span class="torch left" aria-hidden="true"></span>
  <span class="torch right" aria-hidden="true"></span>
  <div class="cast" role="img" aria-label={description}>
    <span class="hero" class:asleep class:swap={swapping} data-tier={tier}>
      <Sprite
        name={asleep ? 'hero-asleep' : 'hero'}
        palette={palette ?? heroPaletteFor(level)}
        {cape}
        scale={5}
      />
    </span>
    {#if asleep}
      <span class="zzz">z z z</span>
    {:else if monster}
      <span class="monster">
        <Sprite name={MONSTER_SPRITE[monster]} scale={5} />
      </span>
    {/if}
  </div>
</div>

<style>
  .scene {
    height: 150px;
    position: relative;
    border: 2px solid #000;
    overflow: hidden;
    background: linear-gradient(#1c2437 0 55%, #2e4a2a 55% 62%, #3b2a1a 62%);
  }

  /* The sewers: wet green-grey stone under a low ceiling. */
  .scene.sewers {
    background: linear-gradient(#18262a 0 55%, #2f4a45 55% 62%, #1f2e2a 62%);
  }

  /* The marsh: a murky sky over reeds and mud. */
  .scene.marsh {
    background: linear-gradient(#26303a 0 45%, #44603c 45% 60%, #2b3a2a 60%);
  }

  .cast {
    position: absolute;
    inset: 0;
  }

  .say {
    position: absolute;
    z-index: 1;
    margin: 0;
    left: 10px;
    top: 10px;
    font: 600 13px var(--display);
    color: #fff;
    text-shadow: 1px 1px 0 #000;
  }

  .torch {
    position: absolute;
    top: 38px;
    width: 6px;
    height: 6px;
    background: var(--gold);
    box-shadow: 0 0 18px 8px rgba(242, 193, 78, 0.25);
  }

  .torch.left {
    left: 40px;
  }

  .torch.right {
    right: 60px;
  }

  .hero,
  .monster {
    position: absolute;
    bottom: 14px;
    filter: drop-shadow(4px 4px 0 #000);
  }

  .hero {
    left: 24px;
  }

  .monster {
    right: 24px;
  }

  /* The sleeper lies down; a 90 degree turn keeps the pixels crisp. */
  .hero.asleep {
    transform: rotate(90deg);
    left: 40px;
    bottom: 6px;
  }

  .zzz {
    position: absolute;
    left: 140px;
    bottom: 70px;
    font: 600 18px var(--mono);
    color: #cfe0ff;
    letter-spacing: 0.2em;
  }

  /* A new gear tier: one fade under reduced motion, a quick blink of the new look otherwise. */
  .hero.swap {
    animation: swap-fade 0.9s linear both;
  }

  @keyframes swap-fade {
    from {
      opacity: 0.2;
    }
    to {
      opacity: 1;
    }
  }

  @keyframes swap-blink {
    0%,
    40%,
    80% {
      filter: drop-shadow(4px 4px 0 #000) brightness(2.6);
    }
    20%,
    60%,
    100% {
      filter: drop-shadow(4px 4px 0 #000);
    }
  }

  @media (prefers-reduced-motion: no-preference) {
    .zzz {
      animation: drift 3s ease-in-out infinite;
    }

    .hero.swap {
      animation: swap-blink 0.9s steps(1, end) both;
    }
  }

  @keyframes drift {
    50% {
      transform: translateY(-6px);
    }
  }
</style>
