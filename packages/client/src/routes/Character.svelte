<script lang="ts">
  import {
    GEAR_TIER_LEVELS,
    levelFor,
    progressWithinLevel,
    SKILL_LABELS,
    SKILLS,
    totalLevel,
    xpToNext,
  } from '@mergescape/shared';
  import Frame from '../lib/components/Frame.svelte';
  import Meter from '../lib/components/Meter.svelte';
  import Sprite from '../lib/components/Sprite.svelte';
  import { formatDecimal, formatInt } from '../lib/format';
  import { SKILL_COLOR_VAR } from '../lib/names';
  import type { Session } from '../lib/session.svelte';
  import { charmSprite, gearTierFor, nextGearTier, paletteForTier } from '../lib/sprites';

  interface Props {
    session: Session;
    /** Present when there is a real session to end. */
    onSignOut?: () => void;
  }

  let { session, onSignOut }: Props = $props();

  const me = $derived(session.me);
  const level = $derived(me ? levelFor(me.xp) : 1);
  const progress = $derived(me ? progressWithinLevel(me.xp) : null);
  const tier = $derived(gearTierFor(level));
  const upcoming = $derived(nextGearTier(level));
  const slots = $derived.by(() => {
    const held = me?.charms ?? [];
    const count = Math.max(me?.charmSlots ?? 5, held.length);
    return Array.from({ length: count }, (_, index) => held[index] ?? null);
  });
  const charmPower = $derived((me?.charms ?? []).reduce((sum, charm) => sum + charm.power, 0));
</script>

<Frame title="Character">
  {#if me}
    <section class="row header" aria-labelledby="who-heading">
      <Sprite name="hero" palette={tier.palette} scale={5} />
      <div class="grow">
        <h2 id="who-heading">{me.login} <span class="vocation">&middot; {me.vocation}</span></h2>
        {#if progress && progress.xpSpan > 0}
          <p class="num xp-line dim">
            Level {level} &middot; {formatInt(me.xp)} / {formatInt(me.xp + xpToNext(me.xp))} XP
          </p>
          <Meter
            fraction={progress.fraction}
            label="{formatInt(progress.xpIntoLevel)} / {formatInt(
              progress.xpSpan,
            )} into level {level}"
            name="Experience into level {level}"
          />
        {:else}
          <p class="num xp-line dim">Level {level} &middot; {formatInt(me.xp)} XP</p>
          <Meter fraction={1} label="Max level" name="Experience" />
        {/if}
        <p class="num xp-line dim">Total level {totalLevel(me.skillXp)}</p>
      </div>
    </section>

    <section aria-labelledby="skills-heading">
      <h2 id="skills-heading" class="section">Skills</h2>
      <ul class="skills">
        {#each SKILLS as skill (skill)}
          {@const xp = me.skillXp[skill]}
          {@const skillLevel = levelFor(xp)}
          {@const within = progressWithinLevel(xp)}
          <li class="skill" style:--skill={SKILL_COLOR_VAR[skill]}>
            <span class="n">{SKILL_LABELS[skill]}</span>
            <span class="lv num"><span class="visually-hidden">Level&nbsp;</span>{skillLevel}</span>
            <Meter
              fraction={within.fraction}
              label={within.xpSpan > 0 ? `${formatInt(xp)} XP` : 'Max level'}
              name="{SKILL_LABELS[skill]} experience into level {skillLevel}"
            />
          </li>
        {/each}
      </ul>
    </section>

    <section class="panel" aria-labelledby="charms-heading">
      <h2 id="charms-heading">
        Charms &middot; {slots.length} slots &middot; Power 1 + {formatDecimal(charmPower)}
      </h2>
      <ul class="slots">
        {#each slots as charm, index (index)}
          {#if charm}
            {@const icon = charmSprite(charm.id)}
            <li class="slot">
              {#if icon}
                <Sprite name={icon} scale={2} />
              {:else}
                <span class="initial" aria-hidden="true">{charm.name.slice(0, 1)}</span>
              {/if}
              <em>+{formatDecimal(charm.power)}</em>
              <span class="visually-hidden"
                >{charm.name}, plus {formatDecimal(charm.power)} Power</span
              >
            </li>
          {:else}
            <li class="slot empty">
              <span class="visually-hidden">Empty Charm slot</span>
            </li>
          {/if}
        {/each}
      </ul>
      {#if me.charms.length > 0}
        <p class="dim caption">
          {me.charms.map((charm) => `${charm.name} +${formatDecimal(charm.power)}`).join(' · ')}
        </p>
      {:else}
        <p class="dim caption">
          No Charms yet. They arrive with the Shop, bought with gold your shipping earns.
        </p>
      {/if}
    </section>

    <section class="panel" aria-labelledby="gear-heading">
      <h2 id="gear-heading">
        Gear tier &middot; {tier.tier}{#if upcoming}&nbsp;&middot; {upcoming.tier} at level {upcoming.level}{/if}
      </h2>
      <ol class="tiers">
        {#each GEAR_TIER_LEVELS as entry (entry.tier)}
          <li
            class="tier"
            class:current={entry.tier === tier.tier}
            aria-current={entry.tier === tier.tier ? 'true' : undefined}
          >
            <Sprite name="hero" palette={paletteForTier(entry.tier)} scale={3} />
            <b class="num">{entry.level}</b>
            <span>{entry.tier}</span>
            {#if entry.tier === tier.tier}
              <span class="wearing">Wearing</span>
            {/if}
          </li>
        {/each}
      </ol>
    </section>

    {#if onSignOut}
      <div class="row">
        <button type="button" class="btn small" onclick={onSignOut}>Sign out</button>
      </div>
    {/if}
  {/if}
</Frame>

<style>
  .header {
    align-items: flex-start;
    gap: 16px;
  }

  .header h2 {
    font: 700 20px var(--display);
    color: var(--gold);
    margin: 0 0 4px;
  }

  .vocation {
    color: var(--fg-dim);
    font-size: 14px;
  }

  .xp-line {
    font-size: 12px;
    margin: 0 0 4px;
  }

  .section {
    margin: 0 0 6px;
    font: 600 14px var(--display);
    color: var(--gold);
  }

  .skills {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 6px;
  }

  .skill {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 4px 8px;
    align-items: center;
    background: var(--row);
    border: 2px solid #000;
    border-left: 6px solid var(--skill);
    padding: 6px 8px;
    min-width: 0;
  }

  .skill .n {
    font: 600 13px var(--display);
    color: var(--parch);
  }

  .skill .lv {
    font: 700 18px var(--display);
    color: var(--gold);
    grid-row: span 2;
  }

  .slots {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }

  .slot {
    width: 54px;
    height: 54px;
    border: 2px solid #000;
    background: var(--slot);
    display: grid;
    place-items: center;
    position: relative;
  }

  .slot.empty {
    border-style: dashed;
    border-color: var(--wood);
  }

  .slot em {
    position: absolute;
    bottom: -2px;
    right: 0;
    font: 600 10px var(--mono);
    font-style: normal;
    background: #000;
    color: var(--gold);
    padding: 1px 3px;
  }

  .initial {
    font: 700 20px var(--display);
    color: var(--parch);
  }

  .caption {
    margin: 8px 0 0;
    font-size: 13px;
  }

  .tiers {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
    align-items: flex-end;
  }

  .tier {
    display: grid;
    justify-items: center;
    gap: 2px;
    padding: 6px 4px;
    border: 2px solid transparent;
    font: 600 12px var(--display);
    color: var(--fg-dim);
    text-align: center;
    min-width: 62px;
  }

  .tier.current {
    border-color: var(--gold);
    background: var(--row-open);
    color: var(--parch);
  }

  .tier b {
    color: var(--gold);
    font-size: 13px;
  }

  .wearing {
    font: 600 10px var(--mono);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--gold);
  }

  @media (max-width: 480px) {
    .skills {
      grid-template-columns: 1fr;
    }
  }
</style>
