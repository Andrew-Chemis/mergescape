<script lang="ts">
  import { tick } from 'svelte';
  import type { RouteName } from '../../router';

  interface Props {
    current: RouteName;
  }

  let { current }: Props = $props();

  // The daily loop first (Town, the trip out, the Forge), then who you are, then the weekly run and the log.
  const items = [
    { name: 'home', href: '#/', label: 'Town', glyph: 'T' },
    { name: 'expedition', href: '#/expedition', label: 'Expedition', glyph: 'E' },
    { name: 'forge', href: '#/forge', label: 'Forge', glyph: 'F' },
    { name: 'character', href: '#/character', label: 'Character', glyph: 'C' },
    { name: 'feats', href: '#/feats', label: 'Feats', glyph: '★' },
    { name: 'shop', href: '#/shop', label: 'Shop', glyph: '$' },
    { name: 'map', href: '#/map', label: 'Map', glyph: 'M' },
    { name: 'log', href: '#/log', label: 'Log', glyph: 'L' },
    { name: 'bestiary', href: '#/bestiary', label: 'Bestiary', glyph: 'B' },
    { name: 'settings', href: '#/settings', label: 'Settings', glyph: 'S' },
  ] as const;

  // Privacy, Terms and Cookies are reached from Settings, so Settings stays marked while they are open.
  const active = $derived(
    current === 'privacy' || current === 'terms' || current === 'cookies' ? 'settings' : current,
  );

  // Ten tabs do not fit across a phone, so the bottom bar scrolls sideways. Keep the current tab in view.
  let list: HTMLUListElement | undefined = $state();

  $effect(() => {
    void active;
    void tick().then(() => {
      const here = list?.querySelector<HTMLElement>('[aria-current="page"]')?.parentElement;
      if (list && here && list.scrollWidth > list.clientWidth) {
        list.scrollLeft = here.offsetLeft - (list.clientWidth - here.offsetWidth) / 2;
      }
    });
  });
</script>

<!-- A left rail from 768px up, bottom tabs below that scroll sideways (Requirement 10.1). -->
<nav class="nav" aria-label="Main">
  <ul bind:this={list}>
    {#each items as item (item.name)}
      <li>
        <a href={item.href} aria-current={active === item.name ? 'page' : undefined}>
          <span class="glyph" aria-hidden="true">{item.glyph}</span>
          <span class="text">{item.label}</span>
        </a>
      </li>
    {/each}
  </ul>
</nav>

<style>
  .nav {
    background: var(--rail);
    border-top: 2px solid #000;
    position: fixed;
    inset: auto 0 0 0;
    z-index: 20;
    padding-bottom: env(safe-area-inset-bottom, 0px);
  }

  /* The bottom tabs scroll sideways; a fade at the right edge says there are more. */
  ul {
    list-style: none;
    margin: 0;
    padding: 0 28px 0 0;
    display: flex;
    overflow-x: auto;
    overscroll-behavior-x: contain;
    scroll-snap-type: x proximity;
    scrollbar-width: none;
  }

  ul::-webkit-scrollbar {
    display: none;
  }

  li {
    /* Five and a half tabs show at once, so the sixth peeks in. */
    flex: 0 0 max(64px, calc((100vw - 28px) / 5.5));
    min-width: 0;
    scroll-snap-align: start;
  }

  .nav::after {
    content: '';
    position: absolute;
    inset: 0 0 0 auto;
    width: 28px;
    background: linear-gradient(to right, transparent, var(--rail));
    pointer-events: none;
  }

  a {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    padding: 8px 1px;
    min-height: 56px;
    color: var(--fg-dim);
    text-decoration: none;
    font: 500 11px var(--body);
    border-top: 3px solid transparent;
  }

  .text {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  a:hover {
    color: var(--fg);
  }

  a[aria-current='page'] {
    color: var(--gold);
    border-top-color: var(--gold);
  }

  .glyph {
    width: 28px;
    height: 28px;
    display: grid;
    place-items: center;
    background: var(--stone2);
    border: 2px solid #000;
    font: 700 13px var(--display);
    color: var(--fg);
  }

  a[aria-current='page'] .glyph {
    background: var(--wood);
    color: var(--parch);
  }

  @media (min-width: 768px) {
    .nav {
      position: sticky;
      inset: 0 auto auto 0;
      top: 0;
      align-self: start;
      height: 100vh;
      width: 88px;
      border-top: 0;
      border-right: 2px solid #000;
      padding: 16px 0;
      overflow-y: auto;
    }

    .nav::after {
      display: none;
    }

    ul {
      display: grid;
      grid-template-columns: 1fr;
      gap: 4px;
      padding: 0;
      overflow: visible;
      scroll-snap-type: none;
    }

    li {
      flex: none;
    }

    a {
      padding: 6px 4px;
      min-height: 0;
      font-size: 12px;
      border-top: 0;
      border-left: 3px solid transparent;
    }

    .glyph {
      width: 28px;
      height: 28px;
    }

    a[aria-current='page'] {
      border-left-color: var(--gold);
    }
  }
</style>
