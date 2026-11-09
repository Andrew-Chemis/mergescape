<script lang="ts">
  import { MOGUL_DISCLAIMER } from '@mergescape/shared';
  import Frame from '../lib/components/Frame.svelte';
  import { LEGAL_UPDATED } from '../lib/promises';

  interface Props {
    /** Where the back link goes: Settings for a signed-in player, the start page otherwise. */
    from?: 'settings' | 'landing';
  }

  let { from = 'landing' }: Props = $props();
</script>

<Frame title="Terms">
  <section class="panel" aria-labelledby="what-heading">
    <h2 id="what-heading">What Mergescape is</h2>
    <p>
      A free idle game. Your character gains experience only from your own real activity on GitHub:
      opening, reviewing and merging pull requests. There is nothing to buy. Gold is earned by
      shipping and can never be bought, and there is no real-money store.
    </p>
  </section>

  <section class="panel" aria-labelledby="using-heading">
    <h2 id="using-heading">Using it</h2>
    <ul>
      <li>You sign in with GitHub. One GitHub account is one character.</li>
      <li>
        Install the App only on repositories you are allowed to install it on. If you are not the
        owner, ask them first.
      </li>
      <li>
        Play for yourself. Please don't script events or flood the service. We may slow down or
        block anything that does.
      </li>
      <li>
        You can stop at any time: export your data, delete it, or uninstall the App. See the
        <a href="#/privacy">Privacy</a> page.
      </li>
    </ul>
  </section>

  <section class="panel" aria-labelledby="asis-heading">
    <h2 id="asis-heading">As is</h2>
    <p>
      Mergescape is open source under the MIT licence and comes with no warranty. It may change,
      pause or go away. We may rebalance the numbers as the game grows; the Combat Log always shows
      every term of every score so you can see what changed.
    </p>
  </section>

  <section class="panel" aria-labelledby="notperf-heading">
    <h2 id="notperf-heading">Not a performance tool</h2>
    <p>
      The game is not a measure of anyone's work and must not be used to judge, rank or pay people.
      There is no manager view.
    </p>
  </section>

  <section class="panel" aria-labelledby="notaff-heading">
    <h2 id="notaff-heading">Not affiliated, and satire</h2>
    <p>
      Mergescape is an independent project. It is not made, endorsed or sponsored by GitHub. GitHub
      is a trademark of its owner.
    </p>
    <p class="dim">{MOGUL_DISCLAIMER}</p>
  </section>

  <p class="foot dim">
    Last updated {LEGAL_UPDATED}. If these terms change, this page changes with them.
    {#if from === 'settings'}
      <a href="#/settings">Back to Settings</a>
    {:else}
      <a href="#/welcome">Back to the start</a>
    {/if}
  </p>
</Frame>

<style>
  .panel ul {
    margin: 0;
    padding-left: 20px;
    display: grid;
    gap: 6px;
  }

  .panel p + p {
    margin-top: 8px;
  }

  .foot {
    margin: 0;
    font-size: 13px;
  }

  .foot a {
    margin-left: 8px;
  }
</style>
