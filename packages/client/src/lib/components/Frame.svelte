<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    /** The screen title: the page's one `h1`, drawn on the wood title bar. */
    title: string;
    children: Snippet;
  }

  let { title, children }: Props = $props();
</script>

<div class="frame">
  <h1 class="bar">{title}</h1>
  <div class="body">
    {@render children()}
  </div>
</div>
