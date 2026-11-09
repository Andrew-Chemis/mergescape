<script lang="ts">
  import { integerScale, SPRITE_GRID, spritePaths } from '../sprites';
  import type { HeroPalette, SpriteName } from '../sprites';

  interface Props {
    name: SpriteName;
    /** Gear-tier palette; only the hero uses it. */
    palette?: HeroPalette;
    /** Whole-number pixel scale: each sprite pixel becomes `scale` screen pixels. */
    scale?: number;
    /** Accessible name. Leave out when the surrounding text already says what the sprite is. */
    label?: string;
  }

  let { name, palette = 'rags', scale = 4, label }: Props = $props();

  const size = $derived(SPRITE_GRID * integerScale(scale));
  const paths = $derived(spritePaths(name, palette));
</script>

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
  >
    {#each paths as path (path.fill + path.d)}
      <path fill={path.fill} fill-opacity={path.opacity} d={path.d} />
    {/each}
  </svg>
</span>
