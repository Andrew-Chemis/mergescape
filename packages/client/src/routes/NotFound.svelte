<script lang="ts">
  import Frame from '../lib/components/Frame.svelte';

  let { path }: { path: string } = $props();
</script>

<Frame title="Not found">
  <section class="panel">
    <p>Nothing lives at <code>{path}</code>.</p>
    <p><a href="#/">Back to Town</a></p>
  </section>
</Frame>
