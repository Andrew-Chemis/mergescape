<script lang="ts">
  import Frame from '../lib/components/Frame.svelte';
  import { LEGAL_UPDATED, PROMISES } from '../lib/promises';

  interface Props {
    /** Where the back link goes: Settings for a signed-in player, the start page otherwise. */
    from?: 'settings' | 'landing';
  }

  let { from = 'landing' }: Props = $props();
</script>

<Frame title="Privacy">
  <section class="panel" aria-labelledby="promise-heading">
    <h2 id="promise-heading">In plain words</h2>
    <ul>
      {#each PROMISES as promise (promise)}
        <li>{promise}</li>
      {/each}
    </ul>
  </section>

  <section class="panel" aria-labelledby="store-heading">
    <h2 id="store-heading">What we store</h2>
    <p>Only numbers, ids and times. That is the complete list.</p>
    <ul>
      <li>
        <b>You:</b> your numeric GitHub id and your login, learned once when you sign in, plus the game
        state they earn: experience, gold, Charms, Pledges, Vouchers and weekly runs.
      </li>
      <li>
        <b>Pull requests:</b> the repository's numeric id, the pull request number, the author's numeric
        id, when it was opened, merged or closed, whether it is a draft, lines added and deleted, files
        changed, commits, how many review rounds and pushes it saw.
      </li>
      <li>
        <b>Reviews:</b> the reviewer's numeric id, whether they approved, asked for changes or commented,
        when, and how many inline comments they left.
      </li>
    </ul>
  </section>

  <section class="panel" aria-labelledby="never-heading">
    <h2 id="never-heading">What we never store</h2>
    <ul>
      <li>
        Code, diffs, file paths, pull request titles or descriptions, and the text of any comment.
        GitHub's notifications can carry some of these; our code keeps a short list of allowed
        numbers and drops the rest before anything is saved.
      </li>
      <li>
        Your GitHub access token. Signing in uses it once to learn who you are and then throws it
        away, so there is nothing stored that could be used to reach your account.
      </li>
      <li>Your email address.</li>
      <li>The names of private repositories.</li>
    </ul>
    <p class="dim">
      The App asks GitHub for read-only access to pull request metadata. It cannot comment, merge,
      push or change anything.
    </p>
  </section>

  <section class="panel" aria-labelledby="others-heading">
    <h2 id="others-heading">People who haven't signed in</h2>
    <p>
      If the App is installed on a shared repository, GitHub tells us about everyone's pull
      requests. We keep only what belongs to people who have signed in to Mergescape. Everything
      about anyone else is dropped before it is saved; only an anonymous count that something was
      dropped is kept, to watch for problems.
    </p>
  </section>

  <section class="panel" aria-labelledby="controls-heading">
    <h2 id="controls-heading">Your controls</h2>
    <ul>
      <li>
        <b>Export:</b> one button in <a href="#/settings">Settings</a> downloads everything we hold about
        you as a JSON file.
      </li>
      <li>
        <b>Delete:</b> one button in <a href="#/settings">Settings</a> removes your character and every
        record that is only yours. The next time you sign in you start again at level 1.
      </li>
      <li>
        <b>Uninstall:</b> removing the App on GitHub stops its events counting at once. Delete your data
        as well if you want the records gone.
      </li>
    </ul>
  </section>

  <section class="panel" aria-labelledby="third-heading">
    <h2 id="third-heading">Cookies and other parties</h2>
    <ul>
      <li>No cookies, no ads, no analytics and no trackers.</li>
      <li>
        Your sign-in token lives in your browser's local storage on this device and is sent only to
        our own server.
      </li>
      <li>
        The page loads its three fonts from Google Fonts, so Google sees your IP address when your
        browser fetches them. Nothing else is loaded from anywhere else.
      </li>
      <li>The game is served by GitHub Pages and runs on Amazon Web Services.</li>
    </ul>
  </section>

  <section class="panel" aria-labelledby="perf-heading">
    <h2 id="perf-heading">Not a performance tool</h2>
    <p>
      Mergescape is a game you play for yourself. Nobody else can see your character, there is no
      team dashboard and no manager view, and we do not plan to build one. Please don't use it to
      judge anyone's work.
    </p>
  </section>

  <p class="foot dim">
    Last updated {LEGAL_UPDATED}. See also the <a href="#/terms">Terms</a>.
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

  .panel p + ul,
  .panel ul + p {
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
