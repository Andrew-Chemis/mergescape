<script lang="ts">
  import { MOGULS, MOGUL_DISCLAIMER } from '@mergescape/shared';
  import Frame from '../lib/components/Frame.svelte';
  import Sprite from '../lib/components/Sprite.svelte';
  import { CREATURES, isMet } from '../lib/bestiary';
  import { formatDay, formatInt } from '../lib/format';
  import { MONSTER_NAMES } from '../lib/names';
  import type { Session } from '../lib/session.svelte';
  import { MONSTER_SPRITE } from '../lib/sprites';

  interface Props {
    session: Session;
  }

  let { session }: Props = $props();

  const kills = $derived(session.me?.kills ?? {});
  const firstSeen = $derived(session.me?.firstSeen ?? {});
  const thisWeek = $derived(session.week?.mogul ?? null);
  const met = $derived(CREATURES.filter((creature) => isMet(creature.id, kills, firstSeen)).length);
  const beaten = $derived(MOGULS.filter((mogul) => (kills[mogul.id] ?? 0) > 0).length);
</script>

<Frame title="Bestiary">
  {#if session.me}
    <p class="summary">
      Met <b class="num">{met}</b> of <b class="num">{CREATURES.length}</b> creatures &middot;
      beaten
      <b class="num">{beaten}</b> of <b class="num">{MOGULS.length}</b> Moguls
    </p>

    <section aria-labelledby="creatures-heading">
      <h2 id="creatures-heading" class="section">Creatures</h2>
      <ul class="beasts">
        {#each CREATURES as creature (creature.id)}
          {@const count = kills[creature.id] ?? 0}
          {@const seen = firstSeen[creature.id]}
          {@const known = isMet(creature.id, kills, firstSeen)}
          <li class="beast" class:locked={!known} data-creature={creature.id}>
            <span class="art"><Sprite name={MONSTER_SPRITE[creature.id]} scale={4} /></span>
            <div class="info">
              <span class="k {creature.kind}"
                >{creature.kind === 'elite' ? 'Elite' : 'Creature'}</span
              >
              <h3>{known ? MONSTER_NAMES[creature.id] : 'Unknown creature'}</h3>
              <p class="count num">
                {#if known}
                  Defeated {formatInt(count)}
                  {#if seen}
                    <span class="seen">First seen {formatDay(seen)}</span>
                  {/if}
                {:else}
                  Not met yet
                {/if}
              </p>
              <p class="spawns">{creature.spawns}</p>
            </div>
          </li>
        {/each}
      </ul>
    </section>

    <section aria-labelledby="moguls-heading">
      <h2 id="moguls-heading" class="section">Mogul gallery</h2>
      <ul class="beasts moguls">
        {#each MOGULS as mogul (mogul.id)}
          {@const count = kills[mogul.id] ?? 0}
          {@const seen = firstSeen[mogul.id]}
          <li class="beast" data-mogul={mogul.id}>
            <span class="art"><Sprite name={MONSTER_SPRITE[mogul.id]} scale={4} /></span>
            <div class="info">
              <span class="k boss"
                >Mogul{#if thisWeek === mogul.id}&nbsp;&middot; this week{/if}</span
              >
              <h3>{mogul.name}</h3>
              <p class="count num">
                {#if count > 0}
                  Beaten {formatInt(count)}
                  {#if seen}
                    <span class="seen">First beaten {formatDay(seen)}</span>
                  {/if}
                {:else}
                  Not beaten yet
                {/if}
              </p>
              <p class="look">{mogul.look}</p>
              <p class="modifier">{mogul.modifier}</p>
              <p class="joke">{mogul.joke}</p>
            </div>
          </li>
        {/each}
      </ul>
    </section>

    <p class="panel parch disclaimer" role="note">{MOGUL_DISCLAIMER}</p>
  {/if}
</Frame>

<style>
  .summary {
    margin: 0;
    font-size: 13px;
    color: var(--fg-dim);
  }

  .summary b {
    color: var(--gold);
  }

  .section {
    margin: 0 0 8px;
    font: 600 16px var(--display);
    color: var(--parch);
  }

  .beasts {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 250px), 1fr));
    gap: 12px;
  }

  .beast {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 12px;
    align-items: start;
    min-width: 0;
    padding: 12px;
    border: 2px solid #000;
    background: var(--stone);
    box-shadow: inset 0 0 0 2px var(--wood);
  }

  .art {
    filter: drop-shadow(2px 2px 0 #000);
  }

  /* A creature never met shows only its outline. */
  .locked .art {
    filter: brightness(0) drop-shadow(0 0 0 #000);
    opacity: 0.55;
  }

  .info {
    min-width: 0;
    display: grid;
    gap: 3px;
  }

  .info h3 {
    font: 700 15px var(--display);
    color: var(--parch);
  }

  .k {
    font: 600 10px/1.4 var(--mono);
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }

  .k.elite {
    color: var(--mult);
  }

  .k.boss {
    color: var(--purple);
  }

  .k.mob {
    color: var(--xp);
  }

  .info p {
    margin: 0;
    font-size: 12.5px;
    color: var(--fg-dim);
  }

  .info .count {
    color: var(--fg);
  }

  .seen {
    display: block;
    font-size: 11px;
    color: var(--fg-dim);
  }

  .info .modifier {
    color: var(--fg);
  }

  .info .joke {
    font-style: italic;
  }

  .disclaimer {
    margin: 0;
    font-size: 13px;
    font-style: italic;
  }
</style>
