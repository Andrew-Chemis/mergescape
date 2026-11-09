<script lang="ts">
  import { ACT_IDS, ACT_TARGET_FRACTION, FLAT_TARGET_XP } from '@mergescape/shared';
  import type { ActId } from '@mergescape/shared';
  import { formatInt } from '../format';
  import { ACT_LABELS, mogulName } from '../names';
  import type { WeekSummary } from '../types';
  import Meter from './Meter.svelte';

  interface Props {
    /** The current run, or null before the run layer exists (task 15). */
    week: WeekSummary | null;
  }

  let { week }: Props = $props();

  // Without a run, show the targets a new adventurer gets: a flat 2,000 XP split 60/100/150%.
  const targets = $derived<Record<ActId, number>>(
    week?.targets ?? {
      scout: Math.round(FLAT_TARGET_XP * ACT_TARGET_FRACTION.scout),
      raid: Math.round(FLAT_TARGET_XP * ACT_TARGET_FRACTION.raid),
      boss: Math.round(FLAT_TARGET_XP * ACT_TARGET_FRACTION.boss),
    },
  );
  const cleared = $derived(new Set<ActId>(week?.clearedActs ?? []));
  const current = $derived<ActId | null>(week ? week.act : 'scout');
  const weeklyXp = $derived(week?.weeklyXp ?? 0);

  function stateOf(act: ActId): 'done' | 'now' | 'later' {
    if (cleared.has(act)) {
      return 'done';
    }
    return act === current ? 'now' : 'later';
  }

  const meter = $derived.by(() => {
    if (!week) {
      return {
        fraction: 0,
        label: `0 / ${formatInt(targets.scout)} · Scout`,
        name: 'Run progress',
      };
    }
    if (week.act === null) {
      return { fraction: 1, label: 'Boss cleared', name: 'Run progress' };
    }
    const target = targets[week.act];
    return {
      fraction: target > 0 ? weeklyXp / target : 0,
      label: `${formatInt(weeklyXp)} / ${formatInt(target)} · ${ACT_LABELS[week.act].name}`,
      name: 'Run progress',
    };
  });
</script>

<div class="acts-wrap">
  <ol class="acts">
    {#each ACT_IDS as act (act)}
      {@const state = stateOf(act)}
      <li class="act {state}" aria-current={state === 'now' ? 'step' : undefined}>
        <span class="name">{ACT_LABELS[act].numeral} &middot; {ACT_LABELS[act].name}</span>
        <span class="target num">{formatInt(targets[act])} XP</span>
        <small>
          {#if state === 'done'}
            Cleared &check;
          {:else if act === 'boss' && week?.mogul}
            {mogulName(week.mogul)}
          {:else if state === 'now'}
            In progress
          {:else}
            Not yet
          {/if}
        </small>
      </li>
    {/each}
  </ol>
</div>
<div class="meter-row">
  <Meter fraction={meter.fraction} label={meter.label} name={meter.name} tone="gold" />
</div>
{#if !week}
  <p class="note hint">
    No run yet. These are the targets for a new adventurer (a flat {formatInt(FLAT_TARGET_XP)} XP a week).
  </p>
{/if}

<style>
  /* Three columns when there is room; one stacked column in a narrow panel. */
  .acts-wrap {
    container-type: inline-size;
  }

  .acts {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 4px;
  }

  .act {
    padding: 6px 8px;
    border: 2px solid #000;
    background: var(--row);
    font-size: 12px;
    display: grid;
    gap: 1px;
    min-width: 0;
  }

  .act.done {
    background: var(--act-done);
  }

  .act.now {
    background: var(--act-now);
    border-color: var(--gold);
  }

  .name {
    font: 600 12px var(--display);
    color: var(--parch);
  }

  .target {
    font-size: 12px;
  }

  small {
    color: var(--fg-dim);
    font-size: 11px;
  }

  .meter-row {
    margin-top: 8px;
  }

  .hint {
    margin-top: 8px;
  }

  @container (max-width: 400px) {
    .acts {
      grid-template-columns: 1fr;
    }
  }

  @keyframes pulse {
    50% {
      box-shadow: 0 0 0 4px rgba(242, 193, 78, 0.18);
    }
  }

  @media (prefers-reduced-motion: no-preference) {
    .act.now {
      animation: pulse 1.6s ease-in-out infinite;
    }
  }
</style>
