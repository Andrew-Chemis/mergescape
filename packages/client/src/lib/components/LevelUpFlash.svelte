<script lang="ts">
  import { SKILL_LABELS } from '@mergescape/shared';
  import { LEVEL_UP_MS, prefersReducedMotion } from '../motion';
  import { SKILL_COLOR_VAR } from '../names';
  import type { LevelUp } from '../session.svelte';

  interface Props {
    levelUp: LevelUp;
    onDone: () => void;
  }

  let { levelUp, onDone }: Props = $props();

  const color = $derived(levelUp.skill ? SKILL_COLOR_VAR[levelUp.skill] : 'var(--gold)');
  // Read once per flash: with reduced motion the full-screen wash is replaced by a quiet fade.
  const reduced = $derived.by(() => {
    void levelUp.id;
    return prefersReducedMotion();
  });

  $effect(() => {
    void levelUp.id;
    const timer = setTimeout(onDone, LEVEL_UP_MS);
    return () => clearTimeout(timer);
  });
</script>

<div class="flash" class:reduced role="status" data-level={levelUp.level}>
  {#if !reduced}
    <div class="wash" style:--flash={color} aria-hidden="true"></div>
  {/if}
  <div class="message" style:--flash={color}>
    <p class="title">Level up!</p>
    <p class="level num">Level {levelUp.level}</p>
    {#if levelUp.skill}
      <p class="detail">{SKILL_LABELS[levelUp.skill]} led the way.</p>
    {/if}
    {#if levelUp.newTier}
      <p class="detail">New gear tier: {levelUp.newTier}.</p>
    {/if}
  </div>
</div>

<style>
  /* Never traps focus or clicks: it is a notice, not a dialog. */
  .flash {
    position: fixed;
    inset: 0;
    z-index: 50;
    display: grid;
    place-items: center;
    pointer-events: none;
  }

  .wash {
    position: absolute;
    inset: 0;
    background: var(--flash);
    opacity: 0;
  }

  .message {
    position: relative;
    padding: 14px 24px;
    text-align: center;
    background: var(--track);
    border: 3px solid var(--flash);
    box-shadow:
      0 0 0 3px #000,
      6px 6px 0 #000;
    animation: message-fade 2.4s ease-out both;
  }

  .title {
    font: 400 28px var(--display);
    color: var(--flash);
    max-width: none;
  }

  .level {
    font-size: 20px;
    color: var(--fg);
  }

  .detail {
    margin-top: 4px;
    font-size: 14px;
    color: var(--fg-dim);
  }

  @keyframes message-fade {
    0% {
      opacity: 0;
    }
    12%,
    80% {
      opacity: 1;
    }
    100% {
      opacity: 0;
    }
  }

  @keyframes wash {
    0% {
      opacity: 0.55;
    }
    100% {
      opacity: 0;
    }
  }

  @keyframes message-pop {
    from {
      transform: scale(0.9);
    }
    to {
      transform: scale(1);
    }
  }

  @media (prefers-reduced-motion: no-preference) {
    /* One short flash in the skill's colour, not a strobe. */
    .wash {
      animation: wash 0.7s ease-out both;
    }

    .message {
      animation:
        message-pop 0.3s ease-out both,
        message-fade 2.4s ease-out both;
    }
  }
</style>
