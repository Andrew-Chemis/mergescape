<script lang="ts">
  import { BREAKDOWN_GROUPS } from '../breakdown';
  import { prefersReducedMotion, TICKER_TOTAL_MS } from '../motion';
  import type { LogEntry } from '../types';
  import Breakdown from './Breakdown.svelte';

  interface Props {
    entry: LogEntry;
    /** Roll the terms in. With false the full breakdown is simply shown. */
    animate?: boolean;
    totalMs?: number;
  }

  let { entry, animate = true, totalMs = TICKER_TOTAL_MS }: Props = $props();

  /**
   * - `static`: no animation, everything shown
   * - `full`: terms slide in one by one (Points, Power, Zone, XP)
   * - `reduced`: prefers-reduced-motion: everything at once under a single fade
   */
  let mode = $state<'static' | 'full' | 'reduced'>('static');
  let revealed = $state(BREAKDOWN_GROUPS);
  let timers: ReturnType<typeof setTimeout>[] = [];

  function stop() {
    for (const timer of timers) {
      clearTimeout(timer);
    }
    timers = [];
  }

  $effect(() => {
    // Restart whenever the row (or the animate flag) changes.
    void entry.id;
    if (!animate) {
      mode = 'static';
      revealed = BREAKDOWN_GROUPS;
      return;
    }
    if (prefersReducedMotion()) {
      mode = 'reduced';
      revealed = BREAKDOWN_GROUPS;
      return;
    }
    mode = 'full';
    revealed = 1;
    const step = totalMs / BREAKDOWN_GROUPS;
    for (let group = 1; group < BREAKDOWN_GROUPS; group += 1) {
      timers.push(
        setTimeout(() => {
          revealed = group + 1;
        }, step * group),
      );
    }
    return stop;
  });

  const playing = $derived(mode === 'full' && revealed < BREAKDOWN_GROUPS);

  /** Click, tap or the Skip button: show everything now. */
  function skip() {
    stop();
    revealed = BREAKDOWN_GROUPS;
  }
</script>

<!-- Pointer users can click anywhere to skip; keyboard users have the Skip button below. -->
<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div
  class="ticker"
  class:fade={mode === 'reduced'}
  data-motion={mode}
  data-revealed={revealed}
  aria-busy={playing}
  onclick={skip}
>
  <Breakdown {entry} {revealed} staged={mode !== 'static'} />
  {#if playing}
    <button
      type="button"
      class="btn small skip"
      onclick={(event) => {
        event.stopPropagation();
        skip();
      }}
    >
      Skip
    </button>
  {/if}
</div>

<style>
  .ticker {
    position: relative;
  }

  .skip {
    margin-top: 8px;
  }

  .fade {
    animation: ticker-fade 0.25s ease-out;
  }

  @keyframes ticker-fade {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }
</style>
