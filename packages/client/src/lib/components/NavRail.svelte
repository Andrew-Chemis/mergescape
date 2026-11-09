<script lang="ts">
  import type { RouteName } from '../../router';

  interface Props {
    current: RouteName;
  }

  let { current }: Props = $props();

  const items = [
    { name: 'home', href: '#/', label: 'Town', glyph: 'T' },
    { name: 'log', href: '#/log', label: 'Log', glyph: 'L' },
    { name: 'character', href: '#/character', label: 'Character', glyph: 'C' },
    { name: 'shop', href: '#/shop', label: 'Shop', glyph: '$' },
    { name: 'map', href: '#/map', label: 'Map', glyph: 'M' },
    { name: 'bestiary', href: '#/bestiary', label: 'Bestiary', glyph: 'B' },
    { name: 'settings', href: '#/settings', label: 'Settings', glyph: 'S' },
  ] as const;

  // Privacy and Terms are reached from Settings, so Settings stays marked while they are open.
  const active = $derived(current === 'privacy' || current === 'terms' ? 'settings' : current);
</script>

<!-- A left rail from 768px up, bottom tabs below (Requirement 10.1). -->
<nav class="nav" aria-label="Main">
  <ul>
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

  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(7, minmax(0, 1fr));
  }

  li {
    min-width: 0;
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

    ul {
      grid-template-columns: 1fr;
      gap: 8px;
    }

    a {
      padding: 8px 4px;
      font-size: 12px;
      border-top: 0;
      border-left: 3px solid transparent;
    }

    .glyph {
      width: 30px;
      height: 30px;
    }

    a[aria-current='page'] {
      border-left-color: var(--gold);
    }
  }
</style>
