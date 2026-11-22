<script lang="ts">
  import { pledgeDefinition } from '@mergescape/shared';
  import type { Pledge } from '@mergescape/shared';
  import type { Snippet } from 'svelte';
  import type { PledgeProgress } from '../types';
  import Meter from './Meter.svelte';

  interface Props {
    pledge: Pledge;
    /** How far the contract has got; only a played Pledge has any. */
    progress?: PledgeProgress | undefined;
    /** Buttons and messages under the text. */
    children?: Snippet;
  }

  let { pledge, progress, children }: Props = $props();

  const uid = $props.id();
  const definition = $derived(pledgeDefinition(pledge.id));
  const goal = $derived(progress?.target ?? definition?.goal ?? 1);
</script>

<article class="card pledge" aria-labelledby="{uid}-name">
  <span class="cost" aria-hidden="true">{goal}</span>
  <span class="rar">{pledge.upgraded ? 'Upgraded Pledge' : 'Pledge'}</span>
  <h3 class="name" id="{uid}-name">{pledge.name}</h3>
  {#if definition}
    <p class="desc">{definition.description}</p>
  {/if}
  {#if progress}
    <Meter
      fraction={progress.target > 0 ? progress.progress / progress.target : 0}
      label={progress.completed ? 'Done ✓' : `${progress.progress} / ${progress.target}`}
      name="{pledge.name} progress"
    />
  {/if}
  {@render children?.()}
</article>
