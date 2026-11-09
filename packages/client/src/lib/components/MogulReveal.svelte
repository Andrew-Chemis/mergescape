<script lang="ts">
  import { mogulDefinition } from '@mergescape/shared';
  import type { MogulId } from '@mergescape/shared';
  import { prefersReducedMotion } from '../motion';
  import { MONSTER_SPRITE } from '../sprites';
  import Sprite from './Sprite.svelte';

  interface Props {
    mogul: MogulId;
    /** True on the first view of a new week: the Mogul rises behind the Boss node. */
    play: boolean;
    /** The Boss act has cleared this week. */
    cleared?: boolean;
  }

  let { mogul, play, cleared = false }: Props = $props();

  const definition = $derived(mogulDefinition(mogul));
  /**
   * - `still`: just the Mogul standing there (every view after the first)
   * - `rise`: the Mogul climbs up from behind the node in a few pixel steps
   * - `fade`: prefers-reduced-motion, the same moment as a single fade-in
   */
  const motion = $derived<'still' | 'rise' | 'fade'>(
    play ? (prefersReducedMotion() ? 'fade' : 'rise') : 'still',
  );
</script>

<div class="reveal" data-motion={motion}>
  <div class="stage">
    <span class="rise"><Sprite name={MONSTER_SPRITE[mogul]} scale={6} /></span>
    <div class="node">
      <span class="act-name"
        >Boss{#if cleared}&nbsp;&check;{/if}</span
      >
    </div>
  </div>
  <p class="line" role={play ? 'status' : undefined}>
    <b class="who">{definition.name}</b>
    <span class="joke">{definition.joke}</span>
  </p>
</div>

<style>
  .reveal {
    display: grid;
    gap: 6px;
  }

  .stage {
    position: relative;
    height: 150px;
    display: flex;
    justify-content: center;
    align-items: flex-end;
    overflow: hidden;
    border: 2px solid #000;
    background: #1b1230;
  }

  .rise {
    margin-bottom: 36px;
    filter: drop-shadow(4px 4px 0 #000);
  }

  /* The Boss node stands in front, so the Mogul comes up from behind it. */
  .node {
    position: absolute;
    inset: auto 0 0 0;
    height: 40px;
    z-index: 1;
    display: grid;
    place-items: center;
    background: var(--stone2);
    border-top: 2px solid #000;
    box-shadow: inset 0 2px 0 var(--purple);
  }

  .act-name {
    font: 700 13px var(--display);
    color: var(--parch);
  }

  .line {
    margin: 0;
    font-size: 13px;
    color: var(--fg-dim);
  }

  .who {
    display: block;
    font: 700 15px var(--display);
    color: var(--parch);
  }

  @keyframes rise {
    from {
      transform: translateY(130%);
      opacity: 0;
    }
    to {
      transform: translateY(0);
      opacity: 1;
    }
  }

  @keyframes fade {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  /* Reduced motion (Requirement 10.5) collapses the rise to a fade, whatever the script decided. */
  .reveal[data-motion='fade'] .rise,
  .reveal[data-motion='rise'] .rise {
    animation: fade 500ms linear both;
  }

  .reveal[data-motion='fade'] .line,
  .reveal[data-motion='rise'] .line {
    animation: fade 500ms linear 700ms both;
  }

  @media (prefers-reduced-motion: no-preference) {
    .reveal[data-motion='rise'] .rise {
      /* steps() keeps the climb in whole pixels, like the sprites */
      animation: rise 1100ms steps(14, end) both;
    }
  }
</style>
