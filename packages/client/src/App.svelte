<script lang="ts">
  import { onMount, tick } from 'svelte';
  import Frame from './lib/components/Frame.svelte';
  import LevelUpFlash from './lib/components/LevelUpFlash.svelte';
  import NavRail from './lib/components/NavRail.svelte';
  import type { Session } from './lib/session.svelte';
  import Bestiary from './routes/Bestiary.svelte';
  import Character from './routes/Character.svelte';
  import CombatLog from './routes/CombatLog.svelte';
  import Landing from './routes/Landing.svelte';
  import NotFound from './routes/NotFound.svelte';
  import Privacy from './routes/Privacy.svelte';
  import RunMap from './routes/RunMap.svelte';
  import Settings from './routes/Settings.svelte';
  import Shop from './routes/Shop.svelte';
  import Terms from './routes/Terms.svelte';
  import Town from './routes/Town.svelte';
  import { parseHash, PUBLIC_ROUTES, ROUTE_TITLES } from './router';
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

  // Privacy and Terms are plain text that Landing links to, so they open without a session.
  const isPublic = $derived(PUBLIC_ROUTES.includes(route.name));
  const signedOut = $derived(session.status === 'signed-out');
  const showLanding = $derived(route.name === 'welcome' || (signedOut && !isPublic));
  const standalone = $derived(signedOut && isPublic);
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
    void tick().then(() => {
      // The new screen starts at its top, as a page load would (Shop and the Map are long).
      main?.focus({ preventScroll: true });
      main?.scrollIntoView?.({ block: 'start' });
    });
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
{:else if standalone}
  <main id="main" tabindex="-1" bind:this={main}>
    <div class="stage">
      {#if route.name === 'privacy'}
        <Privacy from="landing" />
      {:else}
        <Terms from="landing" />
      {/if}
    </div>
  </main>
{:else}
  <div class="shell">
    <NavRail current={route.name} />
    <main id="main" tabindex="-1" bind:this={main}>
      <div class="stage">
        {#if route.name === 'privacy'}
          <Privacy from="settings" />
        {:else if route.name === 'terms'}
          <Terms from="settings" />
        {:else if session.status === 'loading'}
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
        {:else if route.name === 'shop'}
          <Shop {session} />
        {:else if route.name === 'map'}
          <RunMap {session} />
        {:else if route.name === 'bestiary'}
          <Bestiary {session} />
        {:else if route.name === 'settings'}
          <Settings {session} {onSignOut} />
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
