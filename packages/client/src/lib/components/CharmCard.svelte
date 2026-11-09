<script lang="ts">
  import { charmDefinition } from '@mergescape/shared';
  import type { Charm } from '@mergescape/shared';
  import type { Snippet } from 'svelte';
  import { formatDecimal, formatInt } from '../format';
  import { RARITY_LABELS } from '../names';
  import { charmSprite } from '../sprites';
  import Sprite from './Sprite.svelte';

  interface Props {
    charm: Charm;
    /** The shop price in gold, shown beside the rarity. */
    price?: number;
    sold?: boolean;
    /** Buttons and messages under the text. It is given the id of the Charm's name, for `aria-describedby`. */
    children?: Snippet<[string]>;
  }

  let { charm, price, sold = false, children }: Props = $props();

  const uid = $props.id();
  const definition = $derived(charmDefinition(charm.id));
  const icon = $derived(charmSprite(charm.id));
  // The unconditional Power, or for a conditional Charm (Lantern, Small Hands) what it adds when it fires.
  const power = $derived(charm.power > 0 ? charm.power : (definition?.conditionalPower ?? 0));
  const copies = $derived(charm.copies ?? 1);
</script>

<article class="card {charm.rarity}" class:sold aria-labelledby="{uid}-name">
  {#if power > 0}
    <span class="m"><span class="visually-hidden">Power </span>+{formatDecimal(power)}</span>
  {/if}
  <div class="icon">
    {#if icon}
      <Sprite name={icon} scale={2} />
    {:else}
      <span class="initial" aria-hidden="true">{charm.name.slice(0, 1)}</span>
    {/if}
  </div>
  <span class="rar">
    {RARITY_LABELS[charm.rarity]}{#if price !== undefined}&nbsp;&middot; {formatInt(price)} g{/if}{#if copies > 1}&nbsp;&middot;
      x{copies}{/if}
  </span>
  <h3 class="name" id="{uid}-name">{charm.name}</h3>
  {#if definition}
    <p class="desc">{definition.description}</p>
  {/if}
  {@render children?.(`${uid}-name`)}
</article>
