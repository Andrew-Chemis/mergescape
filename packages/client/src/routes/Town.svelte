<script lang="ts">
  import {
    BIOMES,
    levelFor,
    progressWithinLevel,
    RENOWN_PER_BIOME,
    totalLevel,
    xpToNext,
  } from '@mergescape/shared';
  import { installUrl } from '../lib/api';
  import ActBar from '../lib/components/ActBar.svelte';
  import Frame from '../lib/components/Frame.svelte';
  import Meter from '../lib/components/Meter.svelte';
  import ScoreTicker from '../lib/components/ScoreTicker.svelte';
  import { formatInt, monsterLabel, relativeTime, summarize, suppliesText } from '../lib/format';
  import { ACT_LABELS } from '../lib/names';
  import type { Session } from '../lib/session.svelte';
  import Scene from '../lib/components/Scene.svelte';

  interface Props {
    session: Session;
  }

  let { session }: Props = $props();

  const me = $derived(session.me);
  const last = $derived(session.lastEntry);
  const level = $derived(me ? levelFor(me.xp) : 1);
  const progress = $derived(me ? progressWithinLevel(me.xp) : null);
  const biome = $derived(
    BIOMES[Math.min(BIOMES.length - 1, Math.floor((me?.renown ?? 0) / RENOWN_PER_BIOME))] ??
      BIOMES[0],
  );
  const installed = $derived(session.installations.length > 0);
  const hasEvents = $derived(last !== null);
  const week = $derived(me?.week ?? null);

  // The ticker rolls for a row that arrived while the tab was open, and again on request.
  let replays = $state(0);
  const animateLast = $derived(last !== null && (replays > 0 || session.fresh?.id === last.id));

  const nextLevelXp = $derived(me ? me.xp + xpToNext(me.xp) : 0);
  const skillTotal = $derived(me ? totalLevel(me.skillXp) : 4);
  const currentAct = $derived(week?.act ?? null);
</script>

<Frame title="Town">
  {#if me}
    <Scene
      {level}
      {biome}
      renown={me.renown}
      monster={hasEvents ? (last?.monster ?? null) : null}
      asleep={installed && !hasEvents}
      line={installed && !hasEvents ? "Merge something. I'll wake up." : undefined}
    />

    {#if !installed}
      <section class="panel cta" aria-labelledby="install-heading">
        <h2 id="install-heading">Install Mergescape on your repositories</h2>
        <p>
          Your character only hears about pull requests in repositories where the GitHub App is
          installed. Pick the repositories you want counted; you can change that on GitHub at any
          time.
        </p>
        <p class="dim">
          The App is read-only: pull request metadata and nothing else. It cannot comment, merge or
          push.
        </p>
        <div class="row actions">
          <a class="btn primary" href={installUrl()} target="_blank" rel="noopener noreferrer">
            Install the GitHub App
          </a>
          <button type="button" class="btn" onclick={() => void session.refresh()}>
            I installed it, check again
          </button>
        </div>
      </section>
    {/if}

    <div class="row panels">
      <section class="panel grow" aria-labelledby="run-heading">
        <h2 id="run-heading">
          This week's Run{#if currentAct}&nbsp;&middot; Act {ACT_LABELS[currentAct].numeral}{/if}
        </h2>
        <ActBar {week} />
      </section>

      <section class="panel grow level" aria-labelledby="level-heading">
        <h2 id="level-heading">Level {level} &middot; {me.vocation}</h2>
        {#if progress && progress.xpSpan > 0}
          <p class="num xp-line dim">{formatInt(me.xp)} / {formatInt(nextLevelXp)}</p>
          <Meter
            fraction={progress.fraction}
            label="Lv {level + 1} in {formatInt(xpToNext(me.xp))}"
            name="Experience to level {level + 1}"
          />
        {:else}
          <p class="num xp-line dim">{formatInt(me.xp)} XP</p>
          <Meter fraction={1} label="Max level" name="Experience" />
        {/if}
        <p class="num totals">
          Total level <b>{skillTotal}</b> &middot; Gold <b>{formatInt(me.gold)}</b>
        </p>
      </section>
    </div>

    <div class="row panels">
      <section class="panel parch grow last-kill" aria-labelledby="kill-heading">
        {#if last}
          <header>
            <h2 id="kill-heading">Last kill &middot; {monsterLabel(last)}</h2>
          </header>
          <p class="summary">{summarize(last)}</p>
          {#key replays}
            <ScoreTicker entry={last} animate={animateLast} />
          {/key}
          {#if suppliesText(last.supplies)}
            <p class="supplies num">{suppliesText(last.supplies)}</p>
          {/if}
          <div class="row foot">
            <span class="when">{relativeTime(last.at, session.now)}</span>
            <button type="button" class="btn small" onclick={() => (replays += 1)}>
              Replay the roll
            </button>
          </div>
        {:else}
          <header>
            <h2 id="kill-heading">Last kill</h2>
          </header>
          <p>
            Nothing yet. Merge a pull request or review one, and it shows up here with every term of
            its score.
          </p>
        {/if}
      </section>

      <div class="stack grow">
        <section class="panel" aria-labelledby="pledge-heading">
          <h2 id="pledge-heading">
            Pledges in play{#if week}&nbsp;&middot; {week.played.length} of 3{/if}
          </h2>
          {#if week && week.played.length > 0}
            <ul class="pledges">
              {#each week.played as pledge (pledge.id)}
                <li class="card pledge">
                  <span class="rar">Pledge</span>
                  <span class="name">{pledge.name}{pledge.upgraded ? '+' : ''}</span>
                </li>
              {/each}
            </ul>
            {@const inHand = week.hand.filter((card) => !week.played.some((p) => p.id === card.id))}
            {#if inHand.length > 0}
              <p class="dim small">In hand: {inHand.map((card) => card.name).join(', ')}</p>
            {/if}
          {:else}
            <p class="dim">
              A hand of five Pledges is drawn every Monday, and you may play up to three. They
              appear here once the weekly run begins.
            </p>
          {/if}
        </section>

        <p class="note shop">
          {#if week?.shopOpen}
            The Grizzled Reviewer's shop is open{#if currentAct}&nbsp;until {ACT_LABELS[currentAct]
                .name}
              clears{/if}
            &middot; {formatInt(me.gold)} gold
          {:else}
            The Grizzled Reviewer's shop opens when you clear your first act &middot; {formatInt(
              me.gold,
            )} gold
          {/if}
        </p>
      </div>
    </div>
  {/if}
</Frame>

<style>
  .panels {
    align-items: flex-start;
  }

  /* Panels share a row only when each has room to breathe; otherwise they stack. */
  .panels > :global(.grow) {
    flex-basis: 300px;
  }

  .cta p + p {
    margin-top: 8px;
  }

  .actions {
    margin-top: 12px;
  }

  .level .xp-line {
    font-size: 12px;
    margin: 0 0 4px;
  }

  .totals {
    margin: 8px 0 0;
    font-size: 12px;
  }

  .totals b {
    color: var(--gold);
  }

  .last-kill header {
    display: flex;
    justify-content: space-between;
  }

  .summary {
    margin: 0 0 8px;
    font-weight: 500;
  }

  .supplies {
    margin: 8px 0 0;
    font-size: 12px;
    color: var(--ink-dim);
  }

  .foot {
    margin-top: 8px;
    justify-content: space-between;
  }

  .when {
    font: 500 13px var(--mono);
    color: var(--ink-dim);
  }

  .stack {
    display: grid;
    gap: 12px;
    align-content: start;
  }

  .pledges {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
    gap: 8px;
  }

  .card {
    display: grid;
    gap: 2px;
    padding: 8px;
    border: 3px solid #000;
    box-shadow: 2px 2px 0 #000;
  }

  .card.pledge {
    border-color: var(--chips);
    background: var(--pledge);
  }

  .rar {
    font: 600 10px var(--mono);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--chips);
  }

  .name {
    font: 700 14px var(--display);
    color: var(--parch);
  }

  .small {
    margin: 8px 0 0;
    font-size: 12px;
  }
</style>
