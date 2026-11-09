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
  ] as const;
</script>

<!-- A left rail from 768px up, bottom tabs below (Requirement 10.1). -->
<nav class="nav" aria-label="Main">
  <ul>
    {#each items as item (item.name)}
      <li>
        <a href={item.href} aria-current={current === item.name ? 'page' : undefined}>
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
    grid-template-columns: repeat(3, 1fr);
  }

  a {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    padding: 8px 4px;
    min-height: 56px;
    color: var(--fg-dim);
    text-decoration: none;
    font: 500 12px var(--body);
    border-top: 3px solid transparent;
  }

  a:hover {
    color: var(--fg);
  }

  a[aria-current='page'] {
    color: var(--gold);
    border-top-color: var(--gold);
  }

  .glyph {
    width: 30px;
    height: 30px;
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
    }

    ul {
      grid-template-columns: 1fr;
      gap: 8px;
    }

    a {
      border-top: 0;
      border-left: 3px solid transparent;
    }

    a[aria-current='page'] {
      border-left-color: var(--gold);
    }
  }
</style>
