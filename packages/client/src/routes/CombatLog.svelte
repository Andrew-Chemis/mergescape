<script lang="ts">
  import Breakdown from '../lib/components/Breakdown.svelte';
  import Frame from '../lib/components/Frame.svelte';
  import Sprite from '../lib/components/Sprite.svelte';
  import {
    creditedSkills,
    formatDecimal,
    formatGain,
    formatInt,
    monsterLabel,
    relativeTime,
    summarize,
    suppliesText,
  } from '../lib/format';
  import type { Session } from '../lib/session.svelte';
  import { heroPaletteFor, MONSTER_SPRITE } from '../lib/sprites';
  import type { LogEntry } from '../lib/types';

  interface Props {
    session: Session;
  }

  let { session }: Props = $props();

  // Which rows are expanded. Several can be open at once.
  let open = $state<Record<string, boolean>>({});

  function toggle(id: string) {
    open[id] = !open[id];
  }

  function formula(entry: LogEntry): string {
    return `${formatInt(entry.points)} × ${formatDecimal(entry.power)} × ${formatDecimal(entry.zone)}`;
  }
</script>

<Frame title="Combat Log">
  {#if session.entries.length === 0}
    <section class="panel" aria-labelledby="empty-heading">
      <h2 id="empty-heading">Nothing logged yet</h2>
      <p>
        Every XP grant becomes one row here, with the Points × Power × Zone math behind it. Merge or
        review a pull request in a repository where the App is installed and the first row appears
        within seconds.
      </p>
    </section>
  {:else}
    <ul class="log">
      {#each session.entries as entry (entry.id)}
        {@const isOpen = open[entry.id] === true}
        {@const supplies = suppliesText(entry.supplies)}
        <li class="logrow" class:open={isOpen}>
          <button
            type="button"
            class="head"
            aria-expanded={isOpen}
            aria-controls="detail-{entry.id}"
            onclick={() => toggle(entry.id)}
          >
            {#if entry.monster}
              <Sprite name={MONSTER_SPRITE[entry.monster]} scale={2} />
            {:else}
              <Sprite name="hero" palette={heroPaletteFor(entry.level)} scale={2} />
            {/if}
            <span class="t">
              {summarize(entry)}
              <small>{monsterLabel(entry)} &middot; {relativeTime(entry.at, session.now)}</small>
              <small class="num">{formula(entry)}</small>
            </span>
            <span class="x num">
              {formatGain(entry.xp)}
              <small
                >{creditedSkills(entry)
                  .map((skill) => skill.label)
                  .join(' · ')}</small
              >
            </span>
          </button>
          {#if isOpen}
            <div class="detail" id="detail-{entry.id}">
              <Breakdown {entry} label="Score breakdown for {summarize(entry)}" />
              {#if supplies}
                <p class="supplies num">{supplies}</p>
              {/if}
            </div>
          {/if}
        </li>
      {/each}
    </ul>

    <div class="more">
      {#if session.nextCursor !== null}
        <button
          type="button"
          class="btn"
          disabled={session.loadingMore}
          onclick={() => void session.loadMore()}
        >
          {session.loadingMore ? 'Loading…' : 'Load older entries'}
        </button>
      {:else}
        <p class="dim">That is everything so far.</p>
      {/if}
      {#if session.loadMoreError}
        <p class="error" role="alert">{session.loadMoreError}</p>
      {/if}
    </div>
  {/if}
</Frame>

<style>
  .log {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 4px;
  }

  .logrow {
    background: var(--row);
    border: 2px solid #000;
    min-width: 0;
  }

  .logrow.open {
    background: var(--row-open);
    border-color: var(--gold);
  }

  .head {
    display: grid;
    grid-template-columns: 36px 1fr auto;
    gap: 10px;
    align-items: center;
    width: 100%;
    padding: 6px 8px;
    border: 0;
    background: transparent;
    color: inherit;
    text-align: left;
    cursor: pointer;
  }

  .head:hover {
    background: rgba(255, 255, 255, 0.04);
  }

  .t {
    font-size: 13px;
    min-width: 0;
  }

  small {
    display: block;
    color: var(--fg-dim);
    font-size: 11px;
  }

  small.num {
    font-family: var(--mono);
  }

  .x {
    color: var(--xp);
    font-weight: 600;
    text-align: right;
    white-space: nowrap;
  }

  .x small {
    font-weight: 400;
  }

  .detail {
    padding: 4px 10px 10px;
  }

  .supplies {
    margin: 8px 0 0;
    font-size: 12px;
    color: var(--fg-dim);
  }

  .more {
    display: grid;
    justify-items: center;
    gap: 8px;
    padding-top: 4px;
  }

  .error {
    color: var(--mult);
  }
</style>
