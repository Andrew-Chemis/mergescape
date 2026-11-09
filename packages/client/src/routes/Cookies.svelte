<script lang="ts">
  import { TOKEN_KEY } from '../lib/api';
  import Frame from '../lib/components/Frame.svelte';
  import { clearLocalData, consent, CONSENT_KEY, pageControls } from '../lib/consent';
  import { LEGAL_UPDATED } from '../lib/promises';
  import { REVEAL_KEY } from '../lib/reveal';

  interface Props {
    /** Where the back link goes: Settings for a signed-in player, the start page otherwise. */
    from?: 'settings' | 'landing';
  }

  let { from = 'landing' }: Props = $props();

  /** Everything this app keeps in local storage. COOKIES.md lists the same three keys. */
  const STORED = [
    {
      key: TOKEN_KEY,
      what: 'Your sign-in token: a signed session token that names your numeric GitHub id and expires after 7 days.',
      why: "It keeps you signed in. It is sent only to Mergescape's own server, in a request header.",
      removed:
        'Sign out, Clear local data, or automatically when the server turns it down (for example when it has expired).',
    },
    {
      key: REVEAL_KEY,
      what: 'The number of the week for which the Mogul reveal last played, for example 2026-46.',
      why: 'So that reloading the page does not replay the reveal.',
      removed: 'Clear local data.',
    },
    {
      key: CONSENT_KEY,
      what: 'Your analytics choice, as analytics on or off and when you changed it.',
      why: 'To remember what you chose. It is written only when you use the switch below.',
      removed: 'Clear local data.',
    },
  ] as const;

  // --- Analytics choice ---------------------------------------------------------------------------
  let saveFailed = $state(false);

  function chooseAnalytics(event: Event & { currentTarget: HTMLInputElement }) {
    saveFailed = !consent.setAnalytics(event.currentTarget.checked);
  }

  const changedOn = $derived.by(() => {
    const stamp = $consent.updatedAt;
    const date = stamp === null ? null : new Date(stamp);
    return date !== null && !Number.isNaN(date.getTime()) ? date.toISOString().slice(0, 10) : null;
  });

  const choiceText = $derived(
    changedOn === null
      ? 'You have not made a choice, so analytics are off.'
      : `Your choice is analytics ${$consent.analytics ? 'on' : 'off'}, set on ${changedOn}.`,
  );

  // --- Clear local data ---------------------------------------------------------------------------
  let cleared = $state<string | null>(null);

  function clearData() {
    const removed = clearLocalData();
    consent.reset();
    saveFailed = false;
    cleared =
      removed.length === 0
        ? 'Nothing was stored on this device. Reloading the page.'
        : `Removed ${removed.length} ${removed.length === 1 ? 'item' : 'items'} from this device. Reloading the page.`;
    pageControls.reload();
  }
</script>

<Frame title="Cookies">
  <section class="panel" aria-labelledby="plain-heading">
    <h2 id="plain-heading">In plain words</h2>
    <ul>
      <li><b>Mergescape sets no cookies.</b></li>
      <li>
        It keeps three small items in your browser's local storage on this device, and nothing else.
      </li>
      <li>There are no analytics today. Nothing about your visit is measured.</li>
    </ul>
  </section>

  <section class="panel" aria-labelledby="stored-heading">
    <h2 id="stored-heading">What is stored on this device</h2>
    <p>
      Local storage is a small store that only this site can read. Unlike cookies, its contents are
      not sent along with every request. These are exactly the keys Mergescape uses.
    </p>
    <ul class="keys">
      {#each STORED as item (item.key)}
        <li>
          <b><code>{item.key}</code></b>
          <span>{item.what}</span>
          <span class="dim"><b>Why:</b> {item.why}</span>
          <span class="dim"><b>Removed by:</b> {item.removed}</span>
        </li>
      {/each}
    </ul>
    <p class="dim">
      All three are needed for the game to work or record a choice you made, so there is no cookie
      banner. Nothing else is written to local storage, session storage, IndexedDB or cookies.
    </p>
  </section>

  <section class="panel" aria-labelledby="clear-heading">
    <h2 id="clear-heading">Clear local data</h2>
    <ul>
      <li>
        <b>Settings, then Sign out</b> removes the sign-in token and reloads the page. It leaves the other
        two items alone.
      </li>
      <li>
        <b>The button below</b> removes every item whose key starts with <code>mergescape.</code>,
        including the token, and reloads the page. You are signed out afterwards.
      </li>
      <li>Your browser's own settings for site data will also clear them.</li>
    </ul>
    <p class="dim">
      This changes only this browser. Your character and your records on the server stay as they
      were. To delete those, use <b>Delete everything</b> in <a href="#/settings">Settings</a>.
    </p>
    <p class="row">
      <button type="button" class="btn" onclick={clearData}>Clear local data</button>
    </p>
    <div aria-live="polite">
      {#if cleared}
        <p class="ok">{cleared}</p>
      {/if}
    </div>
  </section>

  <section class="panel" aria-labelledby="github-heading">
    <h2 id="github-heading">GitHub's own cookies</h2>
    <p>
      When you sign in, your browser goes to github.com, and GitHub sets its own cookies there under
      its own privacy statement. Mergescape cannot see, read or control them. You manage them in
      your browser's settings, and your GitHub account settings show which Apps you have authorised,
      including this one.
    </p>
  </section>

  <section class="panel" aria-labelledby="analytics-heading">
    <h2 id="analytics-heading">Analytics choice</h2>
    <p>
      <b>Analytics are not yet enabled.</b> Mergescape does not measure anything about your visit
      today, whatever this switch says. The maintainer intends to add first-party,
      privacy-respecting analytics later. When that happens it will be opt-in, so it will be off
      unless you switch it on, and the
      <a href="#/privacy">Privacy</a> page will describe it first.
    </p>
    <p class="dim">
      The switch is already here so that your choice is in place before any analytics exists. It is
      off by default. Changing it saves your choice on this device and does nothing else yet,
      because nothing reads it.
    </p>
    <div class="choice">
      <label class="switch" for="analytics-switch">
        <input
          id="analytics-switch"
          type="checkbox"
          role="switch"
          checked={$consent.analytics}
          aria-describedby="analytics-status"
          onchange={chooseAnalytics}
        />
        <span class="track" aria-hidden="true"><span class="knob"></span></span>
        <span class="switch-text">
          Allow first-party analytics
          <b class="state num" aria-hidden="true">{$consent.analytics ? 'On' : 'Off'}</b>
        </span>
      </label>
      <div id="analytics-status" aria-live="polite">
        <p class="dim">{choiceText}</p>
        {#if saveFailed}
          <p class="error">
            This browser would not let Mergescape save your choice, so it only lasts until you leave
            this page.
          </p>
        {/if}
      </div>
    </div>
  </section>

  <p class="foot dim">
    Last updated {LEGAL_UPDATED}. See also the <a href="#/privacy">Privacy</a> page.
    {#if from === 'settings'}
      <a class="back" href="#/settings">Back to Settings</a>
    {:else}
      <a class="back" href="#/welcome">Back to the start</a>
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
  .panel ul + p,
  .panel p + p,
  .panel p + .row,
  .panel p + .choice,
  .panel .row + div {
    margin-top: 8px;
  }

  .panel ul.keys {
    list-style: none;
    padding-left: 0;
    margin-top: 8px;
    gap: 8px;
  }

  .keys li {
    display: grid;
    gap: 2px;
    padding: 8px 10px;
    border: 2px solid #000;
    background: var(--row);
    font-size: 13.5px;
  }

  code {
    font-family: var(--mono);
    font-size: 0.92em;
    color: var(--gold);
  }

  .choice {
    display: grid;
    gap: 6px;
  }

  .switch {
    display: inline-flex;
    align-items: center;
    gap: 12px;
    min-height: 44px;
    cursor: pointer;
  }

  /* The real checkbox stays in the page, focusable and clickable through its label; only its look is
     replaced. */
  .switch input {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: -1px;
    padding: 0;
    overflow: hidden;
    clip-path: inset(50%);
    border: 0;
  }

  .track {
    flex: none;
    width: 48px;
    height: 26px;
    padding: 2px;
    border: 2px solid #000;
    background: var(--track);
    box-shadow: inset 0 0 0 2px var(--wood);
    display: flex;
    align-items: center;
  }

  .knob {
    width: 16px;
    height: 16px;
    background: var(--fg-dim);
    border: 2px solid #000;
  }

  .switch input:checked + .track {
    background: var(--act-done);
    justify-content: flex-end;
  }

  .switch input:checked + .track .knob {
    background: var(--xp);
  }

  .switch input:focus-visible + .track {
    outline: 3px solid var(--focus);
    outline-offset: 2px;
    box-shadow:
      inset 0 0 0 2px var(--wood),
      0 0 0 2px #000;
  }

  .state {
    margin-left: 6px;
    padding: 1px 6px;
    background: var(--stone2);
    font-size: 12px;
  }

  .foot {
    margin: 0;
    font-size: 13px;
  }

  .foot .back {
    margin-left: 8px;
  }
</style>
