<script lang="ts">
  import { featName, featRewardText } from '../depth';
  import { prefersReducedMotion } from '../motion';
  import { playCue } from '../sound';

  interface Props {
    /** Feat ids unlocked and not yet dismissed. */
    ids: readonly string[];
    onDismiss: () => void;
  }

  let { ids, onDismiss }: Props = $props();

  /** Read once, when the banner appears: it drops in, or under reduced motion only fades in. */
  const motion = prefersReducedMotion() ? 'fade' : 'slide';

  // A cue for the banner, and again when a further Feat joins it while it is still up (opt-in sound).
  $effect(() => {
    void ids.join(',');
    playCue('feat');
  });
</script>

<!--
  Game-design.md section 9, moment 4: a banner across the top of Town that stays until it is clicked. It is
  a plain status message: the text is there at once and the entrance is only decoration.
-->
<section class="banner" data-motion={motion} role="status" aria-label="Feat unlocked">
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
    <a class="btn small" href="#/feats" onclick={onDismiss}>See your Feats</a>
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
    animation: banner-fade 300ms linear both;
  }

  @keyframes banner-fade {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  @keyframes banner-drop {
    from {
      opacity: 0;
      transform: translateY(-16px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  @media (prefers-reduced-motion: no-preference) {
    /* steps() keeps the drop in whole pixels, like the sprites */
    .banner[data-motion='slide'] {
      animation: banner-drop 450ms steps(6, end) both;
    }
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
