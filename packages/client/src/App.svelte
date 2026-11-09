<script lang="ts">
  import Home from './routes/Home.svelte';
  import NotFound from './routes/NotFound.svelte';
  import { parseHash, type Route } from './router';

  let route = $state<Route>(parseHash(window.location.hash));

  function onHashChange() {
    route = parseHash(window.location.hash);
  }
</script>

<svelte:window onhashchange={onHashChange} />

<main>
  {#if route.name === 'home'}
    <Home />
  {:else if route.name === 'not-found'}
    <NotFound path={route.path} />
  {/if}
</main>
