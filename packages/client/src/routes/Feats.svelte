<script lang="ts">
  import { onMount } from 'svelte';
  import { FEAT_RULES } from '@mergescape/shared';
  import Frame from '../lib/components/Frame.svelte';
  import Meter from '../lib/components/Meter.svelte';
  import { FEAT_CATEGORY_LABELS, featRewardText, formatDay } from '../lib/depth';
  import type { Session } from '../lib/session.svelte';
  import type { FeatView } from '../lib/types';

  interface Props {
    session: Session;
  }

  let { session }: Props = $props();

  const list = $derived(session.feats);
  const unlocked = $derived((list ?? []).filter((feat) => feat.unlocked));
  const inProgress = $derived(
    (list ?? [])
      .filter((feat) => !feat.unlocked && !feat.hidden)
      .sort((a, b) => b.progress - a.progress),
  );
  const hidden = $derived((list ?? []).filter((feat) => !feat.unlocked && feat.hidden));
  const pinned = $derived((list ?? []).filter((feat) => feat.pinned));
  const working = $derived(session.busy !== null);

  /** The message beside the Feat whose pin failed. */
  let errors = $state<Record<string, string>>({});
  let notice = $state<string | null>(null);

  onMount(() => {
    void session.loadFeats();
  });

  async function togglePin(feat: FeatView) {
    errors = {};
    notice = null;
    const scope = `pin:${feat.id}`;
    const result = await session.featPin(scope, feat.id, !feat.pinned);
    if (result.ok) {
      notice = feat.pinned
        ? `${feat.name} is off your Character sheet.`
        : `${feat.name} is on your Character sheet.`;
    } else {
      errors = { [scope]: result.message };
    }
  }

  function percent(progress: number): string {
    // A bar that is 99.6% full is not "100%": round down so only a finished Feat reads as complete.
    return `${Math.floor(Math.min(1, Math.max(0, progress)) * 100)}%`;
  }
</script>

<Frame title="Feats">
  {#if list === null}
    <p class="panel" role="status">Reading the ledger&hellip;</p>
  {:else}
    <section class="panel" aria-labelledby="summary-heading">
      <h2 id="summary-heading">
        {unlocked.length} of {list.length} unlocked &middot; {pinned.length} of {FEAT_RULES.maxPinned}
        pinned
      </h2>
      <p class="dim lead">
        Feats measure real work: scale, craft, endurance and the road. They give titles, gear and
        pets, never gold or XP. Pin up to {FEAT_RULES.maxPinned} to show on your Character sheet and your
        badge.
      </p>
    </section>

    <div class="notices" aria-live="polite">
      {#if notice}
        <p class="ok">{notice}</p>
      {/if}
    </div>

    {#if unlocked.length > 0}
      <section class="panel" aria-labelledby="unlocked-heading">
        <h2 id="unlocked-heading">Unlocked &middot; {unlocked.length}</h2>
        <ul class="feats">
          {#each unlocked as feat (feat.id)}
            {@render row(feat)}
          {/each}
        </ul>
      </section>
    {/if}

    {#if inProgress.length > 0}
      <section class="panel" aria-labelledby="progress-heading">
        <h2 id="progress-heading">In progress &middot; {inProgress.length}</h2>
        <ul class="feats">
          {#each inProgress as feat (feat.id)}
            {@render row(feat)}
          {/each}
        </ul>
      </section>
    {/if}

    {#if hidden.length > 0}
      <section class="panel" aria-labelledby="hidden-heading">
        <h2 id="hidden-heading">Hidden &middot; {hidden.length}</h2>
        <ul class="feats">
          {#each hidden as feat (feat.id)}
            {@render row(feat)}
          {/each}
        </ul>
      </section>
    {/if}
  {/if}
</Frame>

{#snippet row(feat: FeatView)}
  <li class="feat" class:done={feat.unlocked} class:pinned={feat.pinned}>
    <div class="head">
      <h3 class="name">{feat.name}</h3>
      <span class="pill">{FEAT_CATEGORY_LABELS[feat.category]}</span>
      {#if feat.pinned}<span class="pill pin">Pinned</span>{/if}
    </div>
    {#if feat.description}
      <p class="desc">{feat.description}</p>
    {/if}
    {#if feat.unlocked}
      {@const day = feat.unlockedAt ? formatDay(feat.unlockedAt) : ''}
      <p class="when">
        {#if day}Unlocked {day}{:else}Unlocked{/if}
        {#if featRewardText(feat.id)}&middot; {featRewardText(feat.id)}{/if}
      </p>
      <div class="buttons">
        <button
          type="button"
          class="btn small"
          aria-pressed={feat.pinned}
          aria-label="{feat.pinned ? 'Unpin' : 'Pin'} {feat.name}"
          disabled={working}
          onclick={() => void togglePin(feat)}
        >
          {feat.pinned ? 'Unpin' : 'Pin'}
        </button>
      </div>
    {:else if feat.hidden}
      <p class="hint"><b>Hint:</b> {feat.hint}</p>
    {:else}
      <p class="hint">{feat.hint}</p>
      <Meter fraction={feat.progress} label={percent(feat.progress)} name="{feat.name} progress" />
      {#if featRewardText(feat.id)}
        <p class="when">Reward: {featRewardText(feat.id)}</p>
      {/if}
    {/if}
    {#if errors[`pin:${feat.id}`]}
      <p class="error" role="alert">{errors[`pin:${feat.id}`]}</p>
    {/if}
  </li>
{/snippet}

<style>
  .lead {
    margin: 0;
    font-size: 13px;
  }

  .feats {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 280px), 1fr));
    gap: 10px;
  }

  .feat {
    display: grid;
    gap: 6px;
    align-content: start;
    min-width: 0;
    padding: 10px;
    background: var(--row);
    border: 2px solid #000;
  }

  .feat.done {
    border-left: 6px solid var(--xp);
  }

  .feat.pinned {
    border-color: var(--gold);
    background: var(--row-open);
  }

  .head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 8px;
  }

  .name {
    font: 700 15px var(--display);
    color: var(--parch);
  }

  .pin {
    background: var(--gold);
    color: var(--ink);
  }

  .desc,
  .hint,
  .when {
    margin: 0;
    font-size: 12.5px;
    line-height: 1.4;
    color: var(--fg-dim);
  }

  .buttons {
    display: flex;
    gap: 8px;
  }
</style>
