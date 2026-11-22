<script lang="ts">
  import { gearSpriteFor, integerScale, SPRITE_GRID } from '../sprites';
  import type { GearSpriteInput } from '../sprites';
  import Sprite from './Sprite.svelte';

  interface Props {
    /** The piece to draw; a pet is `{ slot: 'pet', ref: petId }`. */
    piece: GearSpriteInput & { name?: string | undefined };
    /** Whole-number pixel scale: each sprite pixel becomes `scale` screen pixels. */
    scale?: number;
    /** The Dyes colour (a hex string) the cape is painted in; no effect on other slots. */
    capeColor?: string | null | undefined;
    /** Accessible name. Leave out when the text beside the sprite already names the piece. */
    label?: string;
  }

  let { piece, scale = 3, capeColor = null, label }: Props = $props();

  const size = $derived(SPRITE_GRID * integerScale(scale));
  const art = $derived(gearSpriteFor(piece, { capeColor }));
  const initial = $derived((piece.name ?? piece.ref ?? piece.slot).slice(0, 1).toUpperCase());
</script>

{#if art.kind === 'paths'}
  <span class="spr">
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 {SPRITE_GRID} {SPRITE_GRID}"
      shape-rendering="crispEdges"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : 'true'}
      focusable="false"
      data-sprite={art.id}
    >
      {#each art.paths as path (path.fill + path.d)}
        <path fill={path.fill} fill-opacity={path.opacity} d={path.d} />
      {/each}
    </svg>
  </span>
{:else if art.kind === 'sprite'}
  <Sprite name={art.name} {scale} {...label ? { label } : {}} />
{:else}
  <span
    class="initial"
    role={label ? 'img' : undefined}
    aria-label={label}
    aria-hidden={label ? undefined : 'true'}>{initial}</span
  >
{/if}
