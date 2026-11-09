<script lang="ts">
  import { onMount, tick } from 'svelte';
  import Frame from './lib/components/Frame.svelte';
  import LevelUpFlash from './lib/components/LevelUpFlash.svelte';
  import NavRail from './lib/components/NavRail.svelte';
  import type { Session } from './lib/session.svelte';
  import Character from './routes/Character.svelte';
  import CombatLog from './routes/CombatLog.svelte';
  import Landing from './routes/Landing.svelte';
  import NotFound from './routes/NotFound.svelte';
  import Town from './routes/Town.svelte';
  import { parseHash, ROUTE_TITLES } from './router';
  import type { Route } from './router';

  interface Props {
    session: Session;
    /** The api's sign-in URL, or null for a build without a backend. */
    signInHref?: string | null;
    /** Ends the stored session; only offered when there is a real one. */
    onSignOut?: () => void;
  }

  let { session, signInHref = null, onSignOut }: Props = $props();

  let route = $state<Route>(parseHash(window.location.hash));
  let main: HTMLElement | undefined = $state();
  let firstRoute = true;

  const showLanding = $derived(session.status === 'signed-out' || route.name === 'welcome');
  const title = $derived(
    showLanding ? 'Welcome' : route.name === 'not-found' ? 'Not found' : ROUTE_TITLES[route.name],
  );

  function onHashChange() {
    route = parseHash(window.location.hash);
  }

  onMount(() => {
    void session.load();
    return session.startPolling();
  });

  $effect(() => {
    document.title = `${title} · Mergescape`;
  });

  // After a navigation, move focus to the new screen so keyboard and screen reader users start at
  // its top (the hash router does not reload the page). Not on first load.
  $effect(() => {
    void route;
    if (firstRoute) {
      firstRoute = false;
      return;
    }
    void tick().then(() => main?.focus());
  });

  function skipToContent(event: MouseEvent) {
    // A plain `#main` link would change the hash and the router would treat it as a route.
    event.preventDefault();
    main?.focus();
  }
</script>

<svelte:window onhashchange={onHashChange} />

<a class="skip-link" href="#main" onclick={skipToContent}>Skip to content</a>

{#if showLanding}
  <main id="main" tabindex="-1" bind:this={main}>
    <Landing
      {signInHref}
      notice={session.expired ? 'Your session ended. Sign in again to carry on.' : undefined}
    />
  </main>
{:else}
  <div class="shell">
    <NavRail current={route.name} />
    <main id="main" tabindex="-1" bind:this={main}>
      <div class="stage">
        {#if session.status === 'loading'}
          <Frame {title}>
            <p class="panel" role="status">Waking the dungeon&hellip;</p>
          </Frame>
        {:else if session.status === 'error'}
          <Frame title="Something went wrong">
            <section class="panel" role="alert">
              <p>{session.error ?? 'The server did not answer.'}</p>
              <p class="retry">
                <button type="button" class="btn" onclick={() => void session.load()}>
                  Try again
                </button>
              </p>
            </section>
          </Frame>
        {:else if route.name === 'home'}
          <Town {session} />
        {:else if route.name === 'log'}
          <CombatLog {session} />
        {:else if route.name === 'character'}
          <Character {session} {onSignOut} />
        {:else if route.name === 'not-found'}
          <NotFound path={route.path} />
        {/if}
      </div>
    </main>
  </div>
{/if}

{#if session.levelUp}
  <LevelUpFlash levelUp={session.levelUp} onDone={() => session.dismissLevelUp()} />
{/if}

<style>
  .shell {
    min-height: 100vh;
  }

  main {
    /* Room for the bottom tabs on narrow screens. */
    padding: 16px max(var(--gutter), env(safe-area-inset-right, 0px))
      calc(88px + env(safe-area-inset-bottom, 0px))
      max(var(--gutter), env(safe-area-inset-left, 0px));
    min-width: 0;
  }

  main:focus {
    outline: none;
  }

  .stage {
    max-width: 1080px;
    margin: 0 auto;
  }

  .retry {
    margin-top: 12px;
  }

  @media (min-width: 768px) {
    .shell {
      display: grid;
      grid-template-columns: 88px minmax(0, 1fr);
    }

    main {
      padding-bottom: 48px;
    }
  }
</style>
