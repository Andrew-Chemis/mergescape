<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import {
    ACT_CLEAR_GOLD,
    ACT_IDS,
    ACT_TARGET_FRACTION,
    FLAT_TARGET_XP,
    mogulDefinition,
    MOGUL_DISCLAIMER,
  } from '@mergescape/shared';
  import type { ActId } from '@mergescape/shared';
  import Frame from '../lib/components/Frame.svelte';
  import Meter from '../lib/components/Meter.svelte';
  import MogulReveal from '../lib/components/MogulReveal.svelte';
  import PledgeHand from '../lib/components/PledgeHand.svelte';
  import Sprite from '../lib/components/Sprite.svelte';
  import { formatInt } from '../lib/format';
  import { ACT_LABELS, MONSTER_NAMES } from '../lib/names';
  import { isNewWeek, markWeekSeen } from '../lib/reveal';
  import { ACT_DAYS, daysLeft, weekKills, weekNumber, weekStartMs } from '../lib/runmap';
  import type { Session } from '../lib/session.svelte';
  import { MONSTER_SPRITE } from '../lib/sprites';

  interface Props {
    session: Session;
  }

  let { session }: Props = $props();

  const me = $derived(session.me);
  const week = $derived(session.week);
  const mogul = $derived(week ? mogulDefinition(week.mogul) : null);
  const nextMogul = $derived(week?.nextMogul ? mogulDefinition(week.nextMogul) : null);
  const kills = $derived(week ? weekKills(session.entries, week.weekKey, week.mogul) : null);
  const left = $derived(week ? daysLeft(week.weekKey, session.now) : null);
  const bossCleared = $derived(week?.clearedActs.includes('boss') ?? false);

  onMount(() => {
    // The shop may have opened since the last poll; the log needs every row back to Monday.
    void session.refreshWeek();
  });

  $effect(() => {
    const start = week ? weekStartMs(week.weekKey) : null;
    if (start !== null) {
      untrack(() => void session.loadSince(start));
    }
  });

  // The Mogul reveal plays the first time this week is viewed on this device.
  let revealing = $state<string | null>(null);
  $effect(() => {
    const key = week?.weekKey;
    if (key && isNewWeek(key)) {
      revealing = key;
      markWeekSeen(key);
    }
  });

  function stateOf(act: ActId): 'done' | 'now' | 'later' {
    if (week?.clearedActs.includes(act)) {
      return 'done';
    }
    return week?.act === act ? 'now' : 'later';
  }

  function nowLabel(): string {
    if (!week || week.act === null) {
      return 'Boss cleared';
    }
    const target = week.targets[week.act];
    const percent = target > 0 ? Math.min(100, Math.floor((week.weeklyXp / target) * 100)) : 0;
    return `You · ${percent}%`;
  }

  /** `Hardcore week.` and the rest, so the first sentence can be set in bold as on the mock. */
  function splitModifier(text: string): [string, string] {
    const at = text.indexOf('. ');
    return at === -1 ? [text, ''] : [text.slice(0, at + 1), text.slice(at + 2)];
  }

  const modifierParts = $derived<[string, string]>(
    mogul ? splitModifier(mogul.modifier) : ['', ''],
  );

  const meter = $derived.by(() => {
    if (!week) {
      return null;
    }
    if (week.act === null) {
      return { fraction: 1, label: `${formatInt(week.weeklyXp)} XP · Boss cleared` };
    }
    const target = week.targets[week.act];
    return {
      fraction: target > 0 ? week.weeklyXp / target : 0,
      label: `${formatInt(week.weeklyXp)} / ${formatInt(target)} · ${ACT_LABELS[week.act].name}`,
    };
  });
</script>

<Frame title="Run Map">
  {#if !week || !mogul || !kills}
    <section class="panel" aria-labelledby="norun-heading">
      <h2 id="norun-heading">No run yet</h2>
      <p>
        A run begins every Monday at 00:00 UTC: three acts, Scout, Raid and Boss, with an XP target
        each. Until the first one starts, a new adventurer's targets are a flat {formatInt(
          FLAT_TARGET_XP,
        )} XP a week.
      </p>
    </section>
  {:else}
    <section class="panel" aria-labelledby="map-heading">
      <h2 id="map-heading">
        Week {weekNumber(week.weekKey) ?? week.weekKey}{#if left !== null}&nbsp;&middot; {left}
          {left === 1 ? 'day' : 'days'} left{/if}
      </h2>
      <ol class="acts">
        {#each ACT_IDS as act (act)}
          {@const state = stateOf(act)}
          {@const nodes = kills.nodes[act]}
          <li class="act {state}" aria-current={state === 'now' ? 'step' : undefined}>
            <h3>
              Act {ACT_LABELS[act].numeral} &middot; {ACT_LABELS[act].name}
              <span class="days">{ACT_DAYS[act]}</span>
            </h3>
            <p class="target num">
              {formatInt(week.targets[act])} XP{#if state === 'done'}&nbsp;&middot; cleared &check;{/if}
            </p>
            <ol class="nodes" aria-label="Stops in the {ACT_LABELS[act].name} act">
              {#each nodes as node (node.key)}
                <li class="node" class:elite={node.elite}>
                  <span class="tile"><Sprite name={MONSTER_SPRITE[node.monster]} scale={2} /></span>
                  <span class="what">
                    {MONSTER_NAMES[node.monster]}{#if node.count > 1}&nbsp;&times;{node.count}{/if}
                    {#if node.elite}<b class="tag">Elite</b>{/if}
                  </span>
                </li>
              {/each}
              {#if state === 'now'}
                <li class="node here">
                  <span class="tile" aria-hidden="true">&#9670;</span>
                  <span class="what">{nowLabel()}</span>
                </li>
              {:else if state === 'later' && act !== 'boss'}
                <li class="node unknown">
                  <span class="tile" aria-hidden="true">?</span>
                  <span class="what">Unknown</span>
                </li>
              {:else if state === 'done' && nodes.length === 0}
                <li class="node">
                  <span class="tile" aria-hidden="true">&check;</span>
                  <span class="what">Cleared</span>
                </li>
              {/if}
            </ol>
            {#if act === 'boss'}
              <MogulReveal
                mogul={week.mogul}
                play={revealing === week.weekKey}
                cleared={bossCleared}
              />
              {#if kills.mogulKills > 0}
                <p class="dim small">
                  {kills.mogulKills}
                  {kills.mogulKills === 1 ? 'merge' : 'merges'} landed on {mogul.name} so far.
                </p>
              {/if}
            {/if}
          </li>
        {/each}
      </ol>
      {#if meter}
        <div class="meter-row">
          <Meter fraction={meter.fraction} label={meter.label} name="Run progress" tone="gold" />
        </div>
      {/if}
    </section>

    <div class="row panels">
      <section class="panel parch grow" aria-labelledby="mogul-heading">
        <h2 id="mogul-heading">Act III Mogul &middot; {mogul.name}</h2>
        <p class="modifier"><b>{modifierParts[0]}</b> {modifierParts[1]}</p>
        <p class="scope">
          {mogul.scope === 'week'
            ? 'It applies all week, from Monday.'
            : `It applies to events scored ${ACT_DAYS.boss}, the Boss act.`}
          {#if bossCleared}
            <i>Beaten this week.</i>
          {:else}
            <i
              >Clear the Boss act for Renown {(me?.renown ?? 0) + 1}, {ACT_CLEAR_GOLD.boss} gold and a
              shop visit.</i
            >
          {/if}
        </p>
        <p class="disclaimer">{MOGUL_DISCLAIMER}</p>
      </section>

      <section class="panel grow targets" aria-labelledby="targets-heading">
        <h2 id="targets-heading">Targets</h2>
        <ul>
          {#each ACT_IDS as act (act)}
            {@const state = stateOf(act)}
            <li class="act {state}">
              <span class="name">
                {ACT_LABELS[act].name} &middot; {Math.round(ACT_TARGET_FRACTION[act] * 100)}%
              </span>
              <span class="num">{formatInt(week.targets[act])} XP</span>
              <small>
                Pays {ACT_CLEAR_GOLD[act]} gold and opens the shop{#if state === 'done'}&nbsp;&middot;
                  cleared &check;{/if}
              </small>
            </li>
          {/each}
        </ul>
        <p class="dim small">
          Targets are 60%, 100% and 150% of your median weekly XP over the last eight weeks.
        </p>
      </section>
    </div>

    {#if nextMogul}
      <section class="panel next" aria-labelledby="next-heading">
        <h2 id="next-heading">Next week &middot; {nextMogul.name}</h2>
        <div class="row">
          <Sprite name={MONSTER_SPRITE[nextMogul.id]} scale={4} />
          <div class="grow">
            <p class="modifier">{nextMogul.modifier}</p>
            <p class="dim small">
              You can see it early because of your Oracle Charm or the Scout's Eye Voucher.
            </p>
          </div>
        </div>
      </section>
    {/if}

    <PledgeHand {session} />
  {/if}
</Frame>

<style>
  .acts {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 230px), 1fr));
    gap: 10px;
  }

  .act {
    display: grid;
    gap: 6px;
    align-content: start;
    min-width: 0;
    padding: 8px 10px;
    border: 2px solid #000;
    background: var(--row);
  }

  .act.done {
    background: var(--act-done);
  }

  .act.now {
    background: var(--act-now);
    border-color: var(--gold);
  }

  .act h3 {
    font: 600 14px var(--display);
    color: var(--parch);
  }

  .days {
    margin-left: 6px;
    font: 600 11px var(--mono);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--fg-dim);
  }

  .target {
    margin: 0;
    font-size: 12px;
    color: var(--fg-dim);
  }

  /* The lane: one vertical path per act, a node on it for each stop. */
  .nodes {
    list-style: none;
    margin: 0 0 0 18px;
    padding: 0 0 0 14px;
    display: grid;
    gap: 8px;
    border-left: 2px solid var(--wood);
  }

  .node {
    position: relative;
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }

  .tile {
    flex: none;
    width: 38px;
    height: 38px;
    display: grid;
    place-items: center;
    border: 2px solid #000;
    background: var(--act-done);
    font: 700 14px var(--display);
    color: var(--xp);
  }

  .node.elite .tile {
    border-color: var(--red);
    background: #3a1515;
  }

  .node.here .tile {
    background: var(--act-now);
    border-color: var(--gold);
    color: var(--gold);
    box-shadow: 0 0 0 3px rgba(242, 193, 78, 0.3);
  }

  .node.unknown .tile {
    background: var(--stone2);
    color: var(--fg-dim);
  }

  .what {
    font-size: 13px;
    min-width: 0;
  }

  .tag {
    margin-left: 4px;
    font: 600 10px var(--mono);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--mult);
  }

  .meter-row {
    margin-top: 10px;
  }

  .small {
    margin: 4px 0 0;
    font-size: 12px;
  }

  .panels {
    align-items: flex-start;
  }

  .panels > :global(.grow) {
    flex-basis: 300px;
  }

  .modifier {
    margin: 0 0 8px;
    font-size: 14px;
  }

  .scope {
    margin: 0 0 8px;
    font-size: 13px;
  }

  .disclaimer {
    margin: 0;
    font-size: 12px;
    font-style: italic;
    color: var(--ink-dim);
  }

  .targets ul {
    list-style: none;
    margin: 0 0 8px;
    padding: 0;
    display: grid;
    gap: 4px;
  }

  .targets .act {
    grid-template-columns: 1fr auto;
    gap: 0 8px;
    padding: 6px 8px;
  }

  .targets .name {
    font: 600 13px var(--display);
    color: var(--parch);
  }

  .targets small {
    grid-column: 1 / -1;
    font-size: 11px;
    color: var(--fg-dim);
  }

  @keyframes pulse {
    50% {
      box-shadow: 0 0 0 6px rgba(242, 193, 78, 0.15);
    }
  }

  @media (prefers-reduced-motion: no-preference) {
    .node.here .tile {
      animation: pulse 1.6s ease-in-out infinite;
    }
  }
</style>
