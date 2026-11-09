<script lang="ts">
  import {
    GEAR_SLOTS,
    GEAR_TIER_LEVELS,
    featDefinition,
    levelFor,
    progressWithinLevel,
    SKILL_LABELS,
    SKILLS,
    totalLevel,
    xpToNext,
  } from '@mergescape/shared';
  import { featRewardText, heroLook, pieceDetail, pieceName, SLOT_LABELS } from '../lib/depth';
  import Frame from '../lib/components/Frame.svelte';
  import GearSprite from '../lib/components/GearSprite.svelte';
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

  // What is worn drives how the hero looks (Requirement 16.4): the highest tier's palette and the cape colour.
  const look = $derived(me ? heroLook(me) : null);
  const worn = $derived(me?.gear.equipped ?? {});
  const wornTiers = $derived(new Set(Object.values(worn).map((piece) => piece.tier)));
  const gearPower = $derived(
    Object.values(worn).reduce((sum, piece) => sum + piece.power, 0) + (me?.gear.setBonus ?? 0),
  );
  const pinned = $derived(
    (me?.pinnedFeats ?? [])
      .map((id) => featDefinition(id))
      .filter((feat): feat is NonNullable<typeof feat> => feat !== undefined),
  );
</script>

<Frame title="Character">
  {#if me}
    <section class="row header" aria-labelledby="who-heading">
      <Sprite
        name="hero"
        palette={look?.palette ?? tier.palette}
        cape={look?.cape ?? null}
        scale={5}
      />
      <div class="grow">
        <h2 id="who-heading">{me.login} <span class="vocation">&middot; {me.vocation}</span></h2>
        {#if me.titles.length > 0}
          <ul class="titles" aria-label="Titles">
            {#each me.titles as title (title)}
              <li class="pill">{title}</li>
            {/each}
          </ul>
        {/if}
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

    <section class="panel" aria-labelledby="worn-heading">
      <h2 id="worn-heading">Equipped gear &middot; Power +{formatDecimal(gearPower)}</h2>
      <ul class="worn">
        {#each GEAR_SLOTS as slot (slot)}
          {@const piece = worn[slot]}
          <li class="worn-slot" class:empty={!piece}>
            <span class="slot-name">{SLOT_LABELS[slot]}</span>
            {#if piece}
              <GearSprite {piece} scale={3} capeColor={look?.cape ?? null} />
              <b class="pname">{pieceName(piece)}</b>
              <span class="detail">{pieceDetail(piece)}</span>
            {:else}
              <span class="detail">Empty</span>
            {/if}
          </li>
        {/each}
      </ul>
      <p class="dim caption">
        {#if me.gear.setBonus > 0 && wornTiers.size === 1}
          A full set of one tier: +{formatDecimal(me.gear.setBonus)} Power.
        {:else}
          Wear all five slots in one tier for a +0.25 Power set bonus.
        {/if}
        Change gear at the <a href="#/forge">Forge</a>.
      </p>
    </section>

    <section class="panel" aria-labelledby="pinned-heading">
      <h2 id="pinned-heading">Pinned Feats &middot; {pinned.length} of 3</h2>
      {#if pinned.length > 0}
        <ul class="pinned">
          {#each pinned as feat (feat.id)}
            <li>
              <b>{feat.name}</b>
              <span class="detail">{feat.description}</span>
              {#if featRewardText(feat.id)}<span class="detail">{featRewardText(feat.id)}</span
                >{/if}
            </li>
          {/each}
        </ul>
      {:else}
        <p class="dim caption">No Feats pinned yet.</p>
      {/if}
      <p class="dim caption">
        Choose up to three on the <a href="#/feats">Feats</a> screen. They show on your badge too.
      </p>
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

  .titles {
    list-style: none;
    margin: 0 0 6px;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .worn,
  .pinned {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .worn {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 140px), 1fr));
    gap: 8px;
  }

  .worn-slot {
    display: grid;
    gap: 3px;
    justify-items: start;
    align-content: start;
    min-width: 0;
    padding: 8px;
    background: var(--row);
    border: 2px solid #000;
  }

  .worn-slot.empty {
    border-style: dashed;
    border-color: var(--wood);
  }

  .slot-name {
    font: 600 10px/1.4 var(--mono);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--fg-dim);
  }

  .pname {
    font: 700 13.5px var(--display);
    color: var(--parch);
  }

  .detail {
    font-size: 12px;
    color: var(--fg-dim);
  }

  .pinned {
    display: grid;
    gap: 6px;
  }

  .pinned li {
    display: grid;
    gap: 2px;
    padding: 6px 8px;
    background: var(--row);
    border: 2px solid #000;
    border-left: 6px solid var(--gold);
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
