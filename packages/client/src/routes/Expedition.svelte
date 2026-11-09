<script lang="ts">
  import { onMount } from 'svelte';
  import { regionDefinition } from '@mergescape/shared';
  import type { Charm, ExpeditionChoice, RegionId } from '@mergescape/shared';
  import {
    expeditionStatusOf,
    expeditionViewFrom,
    formatCoarse,
    formatCountdown,
    formatLong,
    heroLook,
  } from '../lib/depth';
  import Frame from '../lib/components/Frame.svelte';
  import LootReveal from '../lib/components/LootReveal.svelte';
  import PackOpen from '../lib/components/PackOpen.svelte';
  import Satchel from '../lib/components/Satchel.svelte';
  import Sprite from '../lib/components/Sprite.svelte';
  import { formatInt } from '../lib/format';
  import type { CollectOutcome, Session } from '../lib/session.svelte';
  import type { ShopOption } from '../lib/types';

  interface Props {
    session: Session;
  }

  let { session }: Props = $props();

  const me = $derived(session.me);
  /** Ticks every second so the timer counts down and a returning trip flips to "back" on its own. */
  let now = $state(Date.now());
  const view = $derived(session.expedition ?? (me ? expeditionViewFrom(me, now) : null));
  const trip = $derived(me?.expedition ?? null);
  const status = $derived(expeditionStatusOf(trip, now));
  const working = $derived(session.busy !== null);
  const provisions = $derived(me?.satchel.provisions ?? 0);
  const look = $derived(me ? heroLook(me) : null);

  let regionId = $state<RegionId>('koko-woods');
  let choice = $state<ExpeditionChoice>('forage');
  /** The message beside the control that failed, keyed by the control's scope. */
  let errors = $state<Record<string, string>>({});
  let notice = $state<string | null>(null);
  /** The haul just collected, for the reveal. */
  let haul = $state<CollectOutcome | null>(null);
  /** A Charm pack that is open: three Charms, keep one. */
  let opening = $state<{ seed: number; options: Charm[] } | null>(null);

  const region = $derived(view?.regions.find((candidate) => candidate.id === regionId) ?? null);
  const selected = $derived(view?.choices.find((candidate) => candidate.choice === choice) ?? null);
  const mayLeave = $derived(status === 'none' || status === 'collected');
  const canSend = $derived(mayLeave && !!region?.unlocked && !!selected?.affordable && !working);
  const tripRegion = $derived(trip ? regionDefinition(trip.region).name : '');
  const remaining = $derived(trip ? Math.max(0, trip.returnsAt - now) : 0);
  const packs = $derived(me?.charmPacks ?? []);

  onMount(() => {
    void session.loadExpedition();
    const timer = setInterval(() => {
      now = Date.now();
    }, 1000);
    return () => clearInterval(timer);
  });

  function choiceLabel(value: ExpeditionChoice): string {
    return value === 'forage' ? 'Forage · 4 h' : `${value} h`;
  }

  function costLabel(provisionCost: number): string {
    return provisionCost === 0
      ? 'free'
      : `${provisionCost} ${provisionCost === 1 ? 'Provision' : 'Provisions'}`;
  }

  async function send() {
    if (!region || !selected) {
      return;
    }
    errors = {};
    notice = null;
    haul = null;
    const result = await session.expeditionSend('send', { region: region.id, choice });
    if (result.ok) {
      const away = session.me?.expedition;
      notice = `Sent to ${region.name}.${
        away ? ` Back in ${formatCoarse(away.returnsAt - Date.now())}.` : ''
      }`;
    } else {
      errors = { send: result.message };
    }
  }

  async function collect() {
    errors = {};
    notice = null;
    const result = await session.expeditionCollect('collect');
    if (result.ok && result.collect) {
      haul = result.collect;
    } else if (!result.ok) {
      errors = { collect: result.message };
    }
  }

  async function openPack(seed: number) {
    errors = {};
    notice = null;
    const result = await session.packOptions(seed);
    if (result.ok && result.options) {
      opening = { seed, options: result.options };
    } else if (!result.ok) {
      errors = { [`pack:${seed}`]: result.message };
    }
  }

  async function keepCharm(index: number) {
    const open = opening;
    const charm = open?.options[index];
    if (!open || !charm) {
      return;
    }
    errors = {};
    const result = await session.packOpen('pack-keep', { seed: open.seed, charmId: charm.id });
    if (result.ok) {
      opening = null;
      notice = `${charm.name} is yours.`;
    } else {
      errors = { keep: result.message };
    }
  }

  const openOptions = $derived<ShopOption[] | null>(
    opening ? opening.options.map((charm) => ({ kind: 'charm' as const, charm })) : null,
  );
</script>

<Frame title="Expedition">
  {#if me && view}
    <section class="panel" aria-labelledby="provisions-heading">
      <h2 id="provisions-heading">Satchel</h2>
      <Satchel satchel={me.satchel} />
    </section>

    <div class="notices" aria-live="polite">
      {#if notice}
        <p class="ok">{notice}</p>
      {/if}
    </div>

    {#if status === 'away' && trip}
      <section class="panel trip away" aria-labelledby="away-heading">
        <h2 id="away-heading">Away at {tripRegion}</h2>
        <div class="row">
          {#if look}<Sprite name="hero" palette={look.palette} cape={look.cape} scale={4} />{/if}
          <div class="grow">
            <p class="timer num" role="timer" aria-label="Time until your character is back">
              {formatCountdown(remaining)}
            </p>
            <p class="dim">
              {trip.forage ? 'A Forage' : `A ${trip.hours} h trip`}, sent {formatCoarse(
                now - trip.sentAt,
              )} ago. It never blocks your score: real merges and reviews still count while the character
              is away.
            </p>
          </div>
        </div>
      </section>
    {:else if status === 'returned' && trip}
      <section class="panel trip returned" aria-labelledby="back-heading">
        <h2 id="back-heading">Back from {tripRegion}</h2>
        <div class="row">
          {#if look}<Sprite name="hero" palette={look.palette} cape={look.cape} scale={4} />{/if}
          <div class="grow">
            <p>
              Your character is home with something to show for it. Collecting is up to you, and the
              loot waits as long as it takes.
            </p>
            <p class="actions">
              <button
                type="button"
                class="btn primary"
                disabled={working}
                onclick={() => void collect()}
              >
                Collect
              </button>
            </p>
            {#if errors['collect']}
              <p class="error" role="alert">{errors['collect']}</p>
            {/if}
          </div>
        </div>
      </section>
    {:else}
      <section class="panel trip" aria-labelledby="town-heading">
        <h2 id="town-heading">In Town</h2>
        <p class="dim">
          {#if status === 'collected' && trip}
            Last trip: {tripRegion}, {trip.forage ? 'a Forage' : `${trip.hours} h`}. Pick a region
            and a length below to send the character out again.
          {:else}
            Your character is in Town. Pick a region and a length below, and it sets out.
          {/if}
        </p>
      </section>
    {/if}

    {#if haul}
      <section class="panel haul" aria-labelledby="haul-heading">
        <h2 id="haul-heading">
          {haul.applied ? 'The haul' : 'Already collected'}
        </h2>
        {#if !haul.applied}
          <p class="dim lead">
            This trip was collected before, so nothing was granted twice. Here is what it brought.
          </p>
        {/if}
        <LootReveal loot={haul.loot} play={haul.applied} />
        {#if haul.featsUnlocked.length > 0}
          <p class="ok">
            Feat unlocked. <a href="#/feats">See your Feats</a>
          </p>
        {/if}
      </section>
    {:else if status === 'collected' && trip?.loot && trip.loot.length > 0}
      <section class="panel haul" aria-labelledby="last-heading">
        <h2 id="last-heading">Last haul &middot; {tripRegion}</h2>
        <LootReveal loot={trip.loot} play={false} />
      </section>
    {/if}

    {#if packs.length > 0}
      <section class="panel" aria-labelledby="packs-heading">
        <h2 id="packs-heading">
          Charm packs &middot; {packs.length} unopened
        </h2>
        <p class="dim lead">Each holds three Charms. Keep one; the other two are gone.</p>
        <ul class="cards packs">
          {#each packs as seed, index (`${seed}-${index}`)}
            <li>
              <article class="card pack" aria-labelledby="pack-{index}-name">
                <span class="rar">Charm pack</span>
                <h3 class="name" id="pack-{index}-name">Pack {index + 1}</h3>
                <p class="desc">See 3, keep 1.</p>
                <button
                  type="button"
                  class="btn small primary"
                  disabled={working}
                  aria-describedby="pack-{index}-name"
                  onclick={() => void openPack(seed)}
                >
                  Open
                </button>
                {#if errors[`pack:${seed}`]}
                  <p class="error" role="alert">{errors[`pack:${seed}`]}</p>
                {/if}
              </article>
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    {#if opening}
      <PackOpen
        title="Charm pack opened"
        options={openOptions}
        busy={working}
        error={errors['keep']}
        onKeep={(index) => void keepCharm(index)}
      />
    {/if}

    <section class="panel" aria-labelledby="map-heading">
      <h2 id="map-heading">Where to</h2>
      <fieldset class="choices">
        <legend class="visually-hidden">Region</legend>
        <ul class="regions">
          {#each view.regions as candidate (candidate.id)}
            {@const info = regionDefinition(candidate.id)}
            <li>
              <label class="region" class:locked={!candidate.unlocked}>
                <input
                  type="radio"
                  name="region"
                  value={candidate.id}
                  bind:group={regionId}
                  disabled={!candidate.unlocked}
                />
                <span class="name">{candidate.name}</span>
                <span class="gate num">
                  {#if candidate.unlocked}
                    Open &middot; Renown {candidate.renownRequired}
                  {:else}
                    Locked &middot; needs Renown {candidate.renownRequired}, you have {me.renown}
                  {/if}
                </span>
                <span class="theme">{info.theme}</span>
                <span class="lean">
                  {#if candidate.lean}
                    Leans: {candidate.lean}
                  {:else}
                    Leans: unknown
                  {/if}
                </span>
              </label>
            </li>
          {/each}
        </ul>
      </fieldset>
      {#if !me.forge.upgrades.includes('index')}
        <p class="dim hint">
          The Index, a Scriptorium upgrade bought with Lore, shows what each region leans toward.
        </p>
      {/if}
    </section>

    <section class="panel" aria-labelledby="length-heading">
      <h2 id="length-heading">How long</h2>
      <fieldset class="choices">
        <legend class="visually-hidden">Length</legend>
        <ul class="lengths">
          {#each view.choices as candidate (candidate.choice)}
            <li>
              <label class="length" class:short={!candidate.affordable}>
                <input
                  type="radio"
                  name="length"
                  value={candidate.choice}
                  bind:group={choice}
                  disabled={!candidate.affordable}
                />
                <span class="name">{choiceLabel(candidate.choice)}</span>
                <span class="cost num">{costLabel(candidate.provisions)}</span>
                {#if candidate.durationMs !== undefined && candidate.durationMs < candidate.hours * 3_600_000}
                  <span class="cost">Takes {formatLong(candidate.durationMs)} with your gear</span>
                {/if}
                {#if !candidate.affordable}
                  <span class="need">
                    Need {formatInt(candidate.provisions)} Provisions, you have {formatInt(
                      provisions,
                    )}
                  </span>
                {/if}
              </label>
            </li>
          {/each}
        </ul>
      </fieldset>
      <p class="dim hint">
        The Forage is always free and finds materials and plain gear only. Longer trips bring more
        in total and less per Provision, so checking in daily is the best deal and weekly is fine.
      </p>
      <div class="row send">
        <button type="button" class="btn primary" disabled={!canSend} onclick={() => void send()}>
          {#if region && selected}
            Send to {region.name} &middot; {choiceLabel(choice)}
          {:else}
            Send the character
          {/if}
        </button>
        {#if status === 'away'}
          <span class="dim">Your character is away. It can go out again once it is back.</span>
        {:else if status === 'returned'}
          <span class="dim">Collect the haul first, then send the character out again.</span>
        {/if}
      </div>
      {#if errors['send']}
        <p class="error" role="alert">{errors['send']}</p>
      {/if}
    </section>
  {/if}
</Frame>

<style>
  .timer {
    margin: 0 0 4px;
    font-size: 30px;
    font-weight: 600;
    color: var(--gold);
    letter-spacing: 0.04em;
  }

  .lead,
  .hint {
    margin: 0 0 10px;
    font-size: 13px;
  }

  .hint {
    margin: 10px 0 0;
  }

  .actions {
    margin: 8px 0 0;
  }

  .packs {
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 170px), 1fr));
  }

  .choices {
    border: 0;
    margin: 0;
    padding: 0;
    min-width: 0;
  }

  .regions,
  .lengths {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 8px;
  }

  .regions {
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 230px), 1fr));
  }

  .lengths {
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 150px), 1fr));
  }

  .region,
  .length {
    display: grid;
    grid-template-columns: auto 1fr;
    column-gap: 8px;
    row-gap: 2px;
    align-items: start;
    height: 100%;
    padding: 8px 10px;
    background: var(--row);
    border: 2px solid #000;
    cursor: pointer;
  }

  .region > input,
  .length > input {
    grid-row: span 4;
    margin: 3px 0 0;
    accent-color: var(--gold);
  }

  .region:has(input:checked),
  .length:has(input:checked) {
    background: var(--row-open);
    border-color: var(--gold);
  }

  .region:has(input:focus-visible),
  .length:has(input:focus-visible) {
    outline: 3px solid var(--focus);
    outline-offset: 2px;
  }

  .region.locked,
  .length.short {
    cursor: not-allowed;
    border-style: dashed;
    border-color: var(--wood);
  }

  .region .name,
  .length .name {
    font: 700 14px var(--display);
    color: var(--parch);
  }

  .gate,
  .cost,
  .need {
    font-size: 12px;
    color: var(--fg-dim);
  }

  .theme,
  .lean {
    font-size: 12.5px;
    color: var(--fg-dim);
  }

  .send {
    margin-top: 12px;
  }
</style>
