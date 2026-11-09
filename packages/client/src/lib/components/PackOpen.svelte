<script lang="ts">
  import type { ShopOption } from '../types';
  import CharmCard from './CharmCard.svelte';
  import PledgeCard from './PledgeCard.svelte';

  interface Props {
    /** Heading of the panel, e.g. `Pledge pack opened`. */
    title: string;
    /** The three cards. Null for a pack whose cards the api does not show (the free Raid pack). */
    options: ShopOption[] | null;
    /** Called with the index of the card the player keeps. */
    onKeep: (option: number) => void;
    /** Disables the buttons while a write is in flight. */
    busy?: boolean;
    /** The message for the last failed keep, shown under the cards. */
    error?: string | undefined;
  }

  let { title, options, onKeep, busy = false, error }: Props = $props();

  const uid = $props.id();
  const blind = [0, 1, 2];
</script>

<section class="panel open" aria-labelledby="{uid}-title">
  <h2 id="{uid}-title">{title}</h2>
  <p class="dim lead">
    {#if options}
      Keep exactly one. The other two are gone once you choose.
    {:else}
      Three cards, face down. Take one; it goes straight into your deck.
    {/if}
  </p>
  <ul class="cards">
    {#if options}
      {#each options as option, index (index)}
        <li>
          {#if option.kind === 'charm'}
            <CharmCard charm={option.charm}>
              {@render keep(index, option.charm.name)}
            </CharmCard>
          {:else if option.kind === 'pledge'}
            <PledgeCard pledge={option.pledge}>
              {@render keep(index, option.pledge.name)}
            </PledgeCard>
          {:else}
            <article class="card pack" aria-labelledby="{uid}-card-{index}">
              <span class="rar">Cosmetic</span>
              <h3 class="name" id="{uid}-card-{index}">{option.name}</h3>
              <p class="desc">A keepsake from a Mogul. It changes nothing but how you look.</p>
              {@render keep(index, option.name)}
            </article>
          {/if}
        </li>
      {/each}
    {:else}
      {#each blind as index (index)}
        <li>
          <article class="card pack" aria-labelledby="{uid}-card-{index}">
            <span class="rar">Face down</span>
            <h3 class="name" id="{uid}-card-{index}">Card {index + 1}</h3>
            <p class="desc">
              A Pledge from the deck of all Pledges. You will see it once it is yours.
            </p>
            {@render keep(index, `card ${index + 1}`)}
          </article>
        </li>
      {/each}
    {/if}
  </ul>
  {#if error}
    <p class="error" role="alert">{error}</p>
  {/if}
</section>

{#snippet keep(index: number, label: string)}
  <button type="button" class="btn small primary" disabled={busy} onclick={() => onKeep(index)}>
    {options ? 'Keep' : 'Take'}
    {label}
  </button>
{/snippet}

<style>
  .open {
    border-color: var(--gold);
  }

  .lead {
    margin: 0 0 12px;
    font-size: 13px;
  }
</style>
