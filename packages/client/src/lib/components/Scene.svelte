<script lang="ts">
  import { MONSTER_NAMES } from '../names';
  import { heroPaletteFor, MONSTER_SPRITE } from '../sprites';
  import type { HeroPalette } from '../sprites';
  import type { MonsterId } from '@mergescape/shared';
  import Sprite from './Sprite.svelte';

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

  const description = $derived(
    asleep
      ? `Your character is asleep in ${biome}.`
      : monster
        ? `Your character in ${biome}, facing a ${MONSTER_NAMES[monster]}.`
        : `Your character in ${biome}.`,
  );
</script>

<div class="scene">
  <p class="say">{line ?? `${biome} · Renown ${renown}`}</p>
  <span class="torch left" aria-hidden="true"></span>
  <span class="torch right" aria-hidden="true"></span>
  <div class="cast" role="img" aria-label={description}>
    <span class="hero" class:asleep>
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

  @media (prefers-reduced-motion: no-preference) {
    .zzz {
      animation: drift 3s ease-in-out infinite;
    }
  }

  @keyframes drift {
    50% {
      transform: translateY(-6px);
    }
  }
</style>
