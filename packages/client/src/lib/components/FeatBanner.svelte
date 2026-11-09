<script lang="ts">
  import { featName, featRewardText } from '../depth';

  interface Props {
    /** Feat ids unlocked and not yet dismissed. */
    ids: readonly string[];
    onDismiss: () => void;
  }

  let { ids, onDismiss }: Props = $props();
</script>

<!--
  Game-design.md section 9, moment 4: a banner across the top of Town that stays until it is clicked.
  It is a plain status message, so it needs no animation and nothing to fall back to.
-->
<section class="banner" role="status" aria-label="Feat unlocked">
  <div class="text">
    <h2>{ids.length === 1 ? 'Feat unlocked' : `${ids.length} Feats unlocked`}</h2>
    <ul>
      {#each ids as id (id)}
        <li>
          <b>{featName(id)}</b>
          {#if featRewardText(id)}<span class="reward">{featRewardText(id)}</span>{/if}
        </li>
      {/each}
    </ul>
  </div>
  <div class="row actions">
    <a class="btn small" href="#/feats">See your Feats</a>
    <button type="button" class="btn small primary" onclick={onDismiss}>Dismiss</button>
  </div>
</section>

<style>
  .banner {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 8px 16px;
    padding: 10px 14px;
    background: linear-gradient(var(--act-now), var(--bg2));
    border: 3px solid var(--gold);
    box-shadow: 4px 4px 0 #000;
  }

  h2 {
    margin: 0 0 2px;
    font: 700 15px var(--display);
    color: var(--gold);
  }

  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 2px;
  }

  li {
    font-size: 13px;
  }

  .reward {
    margin-left: 8px;
    color: var(--fg-dim);
  }

  .actions {
    gap: 8px;
  }
</style>
