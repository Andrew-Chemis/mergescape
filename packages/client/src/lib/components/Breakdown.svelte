<script lang="ts">
  import { breakdownRows, BREAKDOWN_GROUPS } from '../breakdown';
  import type { BreakdownScore } from '../breakdown';

  interface Props {
    entry: BreakdownScore;
    /** How many of the four groups (Points, Power, Zone, XP) are shown. Default: all. */
    revealed?: number;
    /** Reserve space for groups that are not shown yet (the ticker), instead of showing everything. */
    staged?: boolean;
    /** Accessible name of the list. */
    label?: string;
  }

  let {
    entry,
    revealed = BREAKDOWN_GROUPS,
    staged = false,
    label = 'Score breakdown',
  }: Props = $props();

  const rows = $derived(breakdownRows(entry));
</script>

<ol class="score" class:staged aria-label={label}>
  {#each rows as row, index (index)}
    <li
      class="l {row.kind}"
      class:in={row.group < revealed}
      class:sub={row.emphasis === 'subtotal'}
      class:total={row.emphasis === 'total'}
      data-group={row.group}
      data-kind={row.kind}
    >
      <span>{row.label}</span>
      <span class="v">{row.value}</span>
    </li>
  {/each}
</ol>

<style>
  /* Unrevealed rows keep their space but are hidden from sight and from assistive technology. */
  .staged .l:not(.in) {
    visibility: hidden;
    opacity: 0;
  }

  .staged .l {
    transition:
      opacity 0.24s ease-out,
      visibility 0s;
  }

  @media (prefers-reduced-motion: no-preference) {
    .staged .l {
      transition:
        opacity 0.24s ease-out,
        transform 0.24s ease-out,
        visibility 0s;
    }

    .staged .l:not(.in) {
      transform: translateX(-14px);
    }
  }
</style>
