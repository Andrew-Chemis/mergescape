<script lang="ts">
  import { onMount } from 'svelte';
  import { recipeDefinition, regionDefinition, STATION_IDS } from '@mergescape/shared';
  import {
    BIOMES,
    levelFor,
    progressWithinLevel,
    RENOWN_PER_BIOME,
    totalLevel,
    xpToNext,
  } from '@mergescape/shared';
  import { installUrl } from '../lib/api';
  import { expeditionLine, heroLook, stationStatusOf, STATION_LABELS } from '../lib/depth';
  import ActBar from '../lib/components/ActBar.svelte';
  import FeatBanner from '../lib/components/FeatBanner.svelte';
  import Frame from '../lib/components/Frame.svelte';
  import Meter from '../lib/components/Meter.svelte';
  import PledgeHand from '../lib/components/PledgeHand.svelte';
  import Satchel from '../lib/components/Satchel.svelte';
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
  const week = $derived(session.week);

  // The ticker rolls for a row that arrived while the tab was open, and again on request.
  let replays = $state(0);
  const animateLast = $derived(last !== null && (replays > 0 || session.fresh?.id === last.id));

  const nextLevelXp = $derived(me ? me.xp + xpToNext(me.xp) : 0);
  const skillTotal = $derived(me ? totalLevel(me.skillXp) : 4);
  const currentAct = $derived(week?.act ?? null);

  // The depth layer's glanceable parts: the look of the hero, the one timer, orders ready to collect.
  const look = $derived(me ? heroLook(me) : null);
  /** Coarse on purpose ("Returns in 9 h"), so a slow tick is enough. */
  let now = $state(Date.now());
  const trip = $derived(me ? expeditionLine(me.expedition, now) : null);
  const tripRegion = $derived(me?.expedition ? regionDefinition(me.expedition.region).name : '');
  const ready = $derived(
    me
      ? STATION_IDS.filter(
          (station) => stationStatusOf(me.forge.stations[station], now) === 'ready',
        )
      : [],
  );

  onMount(() => {
    // Feats can unlock on any scored event: read the list so the banner knows what is new.
    void session.loadFeats();
    const timer = setInterval(() => {
      now = Date.now();
    }, 30_000);
    return () => clearInterval(timer);
  });
</script>

<Frame title="Town">
  {#if me}
    {#if session.pendingFeats.length > 0}
      <FeatBanner ids={session.pendingFeats} onDismiss={() => session.dismissFeatBanner()} />
    {/if}

    <Scene
      {level}
      {biome}
      renown={me.renown}
      monster={hasEvents ? (last?.monster ?? null) : null}
      asleep={installed && !hasEvents}
      line={installed && !hasEvents ? "Merge something. I'll wake up." : undefined}
      palette={look?.palette}
      cape={look?.cape ?? null}
    />

    <div class="row panels">
      <section class="panel grow trip" aria-labelledby="trip-heading">
        <h2 id="trip-heading">Expedition</h2>
        {#if trip}
          <p class="trip-line {trip.status}">{trip.text}</p>
        {/if}
        {#if me.expedition && trip && trip.status !== 'none'}
          <p class="dim trip-where">
            {tripRegion} &middot; {me.expedition.forage ? 'Forage' : `${me.expedition.hours} h`}
          </p>
        {/if}
        <p class="map-link">
          {#if trip?.status === 'returned'}
            <a class="btn small primary" href="#/expedition">Collect the loot</a>
          {:else if trip?.status === 'away'}
            <a href="#/expedition">Open the Expedition map</a>
          {:else}
            <a href="#/expedition">Send the character out</a>
          {/if}
        </p>
      </section>

      <section class="panel grow" aria-labelledby="satchel-heading">
        <h2 id="satchel-heading">Satchel</h2>
        <Satchel satchel={me.satchel} />
      </section>
    </div>

    {#each ready as station (station)}
      {@const job = me.forge.stations[station]}
      <p class="note forge-ready" role="status">
        Your {STATION_LABELS[station].name} order is ready{#if job}:
          {recipeDefinition(job.recipe)?.name ?? job.recipe}{/if}.
        <a href="#/forge">Open the Forge</a>
      </p>
    {/each}

    {#if !installed}
      <section class="panel cta" aria-labelledby="install-heading">
        <h2 id="install-heading">Install Mergescape on your repositories</h2>
        <p>
          Your character only hears about the repositories you send it to. Pick the ones you want
          counted; you can change your mind on GitHub at any time.
        </p>
        <p class="dim">
          It only listens: it reads the facts of your work, such as counts and times, and nothing
          else. It cannot comment, merge or push.
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
        <p class="map-link"><a href="#/map">Open the Run Map</a></p>
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
        <PledgeHand {session} />

        <p class="note shop">
          {#if week?.shop}
            The Grizzled Reviewer's shop is open{#if currentAct}&nbsp;until {ACT_LABELS[currentAct]
                .name}
              clears{/if}
            &middot; {formatInt(me.gold)} gold &middot; <a href="#/shop">Open the shop</a>
          {:else}
            The Grizzled Reviewer's shop opens when you clear your first act &middot; {formatInt(
              me.gold,
            )} gold
          {/if}
          {#if week?.freePack}
            <br />A free Pledge pack is waiting. <a href="#/shop">Open it in the shop</a>
          {/if}
          {#if week?.legendaryOffer}
            <br />A Legendary Charm is on offer. <a href="#/shop">Take it in the shop</a>
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

  .map-link {
    margin: 8px 0 0;
    font-size: 13px;
  }

  .trip-line {
    margin: 0;
    font: 700 18px var(--display);
    color: var(--parch);
  }

  .trip-line.returned {
    color: var(--gold);
  }

  .trip-where {
    margin: 2px 0 0;
    font-size: 12.5px;
  }
</style>
