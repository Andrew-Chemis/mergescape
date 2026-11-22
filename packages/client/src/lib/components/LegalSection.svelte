<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    /** Names the heading: the section is labelled by `<id>-heading`, the `h2` that carries the title. */
    id: string;
    title: string;
    children: Snippet;
  }

  let { id, title, children }: Props = $props();
</script>

<section class="panel" aria-labelledby="{id}-heading">
  <h2 id="{id}-heading">{title}</h2>
  {@render children()}
</section>

<style>
  /* The lists and paragraphs of Privacy, Terms and Cookies come from those pages, so reach into the slot. */
  .panel :global(ul) {
    margin: 0;
    padding-left: 20px;
    display: grid;
    gap: 6px;
  }

  .panel :global(p + p),
  .panel :global(p + ul) {
    margin-top: 8px;
  }
</style>
