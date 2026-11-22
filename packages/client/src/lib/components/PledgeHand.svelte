<script lang="ts">
  import { PLEDGE_PLAY_LIMIT } from '@mergescape/shared';
  import type { Pledge } from '@mergescape/shared';
  import type { Session } from '../session.svelte';
  import PledgeCard from './PledgeCard.svelte';

  interface Props {
    session: Session;
  }

  let { session }: Props = $props();

  const week = $derived(session.week);
  const played = $derived(week?.played ?? []);
  const inHand = $derived(
    (week?.hand ?? []).filter((card) => !played.some((candidate) => candidate.id === card.id)),
  );
  // A card can be played while the window is open and fewer than three are in play.
  const canPlay = $derived(
    week !== null && week.pledgeWindowOpen && played.length < PLEDGE_PLAY_LIMIT,
  );

  let errors = $state<Record<string, string>>({});

  async function play(card: Pledge) {
    errors = {};
    const result = await session.pledgePlay(`pledge:${card.id}`, card.id);
    if (!result.ok) {
      errors = { [card.id]: result.message };
    }
  }
</script>

<section class="panel" aria-labelledby="pledge-heading">
  <h2 id="pledge-heading">
    Pledges in play{#if week}&nbsp;&middot; {played.length} of {PLEDGE_PLAY_LIMIT}{/if}
  </h2>
  {#if week}
    {#if played.length > 0}
      <ul class="cards">
        {#each played as pledge (pledge.id)}
          <li><PledgeCard {pledge} progress={week.pledgeProgress[pledge.id]} /></li>
        {/each}
      </ul>
    {:else}
      <p class="dim">Nothing in play yet.</p>
    {/if}

    {#if canPlay && inHand.length > 0}
      <h3 class="hand-heading">In your hand</h3>
      <p class="dim hint">
        Play up to {PLEDGE_PLAY_LIMIT} until Tuesday 23:59 UTC. A Pledge is a contract for the week: hit
        it for the bonus, miss it and nothing happens.
      </p>
      <ul class="cards">
        {#each inHand as card (card.id)}
          <li>
            <PledgeCard pledge={card}>
              <button
                type="button"
                class="btn small primary"
                disabled={session.busy !== null}
                onclick={() => void play(card)}
              >
                Play {card.name}
              </button>
              {#if errors[card.id]}
                <p class="error" role="alert">{errors[card.id]}</p>
              {/if}
            </PledgeCard>
          </li>
        {/each}
      </ul>
    {:else if inHand.length > 0}
      <p class="dim small">
        In hand: {inHand.map((card) => card.name).join(', ')}
      </p>
      <p class="dim small">
        {#if !week.pledgeWindowOpen}
          The play window closed on Tuesday at 23:59 UTC; any empty slots were filled for you.
        {:else}
          All {PLEDGE_PLAY_LIMIT} slots are in play.
        {/if}
      </p>
    {/if}
  {:else}
    <p class="dim">
      A hand of five Pledges is drawn every Monday, and you may play up to three. They appear here
      once the weekly run begins.
    </p>
  {/if}
</section>

<style>
  .hand-heading {
    margin: 14px 0 2px;
    font: 600 13px var(--display);
    color: var(--parch);
  }

  .hint {
    margin: 0 0 10px;
    font-size: 12.5px;
  }

  .small {
    margin: 8px 0 0;
    font-size: 12px;
  }
</style>
