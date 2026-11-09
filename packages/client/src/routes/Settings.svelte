<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import { installUrl } from '../lib/api';
  import Frame from '../lib/components/Frame.svelte';
  import Switch from '../lib/components/Switch.svelte';
  import { consent } from '../lib/consent';
  import { formatInt } from '../lib/format';
  import { prefersReducedMotion } from '../lib/motion';
  import { exportFileName, timezoneInfo } from '../lib/settings';
  import type { Session } from '../lib/session.svelte';
  import { playCue } from '../lib/sound';

  interface Props {
    session: Session;
    /** Present when there is a real session to end. */
    onSignOut?: () => void;
  }

  let { session, onSignOut }: Props = $props();

  const me = $derived(session.me);
  const zone = timezoneInfo();

  // --- Badge --------------------------------------------------------------------------------------
  const badgePublic = $derived(me?.badgePublic ?? true);
  let badgeError = $state<string | null>(null);

  async function chooseBadge(event: Event & { currentTarget: HTMLInputElement }) {
    // The event forgets its target once the handler has returned, so hold on to it for the answer.
    const input = event.currentTarget;
    const wanted = input.checked;
    badgeError = null;
    const result = await session.setBadgePublic('badge', wanted);
    if (!result.ok) {
      badgeError = result.message;
      // The control follows the profile, which did not change.
      input.checked = !wanted;
    }
  }

  // --- Sound --------------------------------------------------------------------------------------
  let soundSaveFailed = $state(false);
  /** Read once: only used to explain that the system setting does not decide anything about sound. */
  const reducedMotion = prefersReducedMotion();

  function chooseSound(event: Event & { currentTarget: HTMLInputElement }) {
    soundSaveFailed = !consent.setSound(event.currentTarget.checked);
  }

  // --- Export -------------------------------------------------------------------------------------
  let exporting = $state(false);
  let exportError = $state<string | null>(null);
  let download = $state<{ href: string; name: string } | null>(null);

  function forgetDownload() {
    if (download) {
      try {
        URL.revokeObjectURL(download.href);
      } catch {
        // Nothing to release.
      }
      download = null;
    }
  }

  onDestroy(forgetDownload);

  async function exportJson() {
    exportError = null;
    forgetDownload();
    exporting = true;
    const result = await session.exportData();
    exporting = false;
    if (!result.ok) {
      exportError = result.message;
      return;
    }
    if (typeof URL.createObjectURL !== 'function') {
      exportError = 'This browser cannot save files from the page.';
      return;
    }
    const blob = new Blob([JSON.stringify(result.data ?? {}, null, 2)], {
      type: 'application/json',
    });
    const name = exportFileName(me?.login ?? 'player', new Date());
    download = { href: URL.createObjectURL(blob), name };
    // Offer the file at once; the visible link stays in case the browser wanted a fresh click.
    const link = document.createElement('a');
    link.href = download.href;
    link.download = name;
    link.click();
  }

  // --- Delete -------------------------------------------------------------------------------------
  /** Step one is the button; step two is typing the login. */
  let confirming = $state(false);
  let typed = $state('');
  let deleting = $state(false);
  let deleteError = $state<string | null>(null);
  let deleted = $state(false);
  let field = $state<HTMLInputElement | undefined>();

  const matches = $derived(
    me !== null && typed.trim().toLowerCase() === me.login.toLowerCase() && typed.trim() !== '',
  );

  async function startDelete() {
    confirming = true;
    typed = '';
    deleteError = null;
    // Step two starts with the cursor in the field, so a keyboard user can type at once.
    await tick();
    field?.focus();
  }

  function cancelDelete() {
    confirming = false;
    typed = '';
    deleteError = null;
  }

  async function deleteEverything(event: SubmitEvent) {
    event.preventDefault();
    if (!matches || deleting) {
      return;
    }
    deleteError = null;
    deleting = true;
    const result = await session.deleteEverything(typed.trim());
    deleting = false;
    if (result.ok) {
      deleted = true;
      confirming = false;
    } else {
      deleteError = result.message;
    }
  }
</script>

<Frame title="Settings">
  {#if me}
    <section class="panel" aria-labelledby="account-heading">
      <h2 id="account-heading">Account</h2>
      <p>
        Signed in as <b>{me.login}</b>. One GitHub account is one character.
      </p>
      <p class="dim zone">
        Your browser is in <b class="num">{zone.name}</b> (<span class="num">{zone.offset}</span>).
        The game runs on UTC: weeks start on Monday at 00:00 UTC, which is {zone.mondayLocal} for you,
        the Pledge window closes on Tuesday at 23:59 UTC, and the "first event of the day" bonus follows
        the UTC day.
      </p>
      {#if onSignOut}
        <p class="row">
          <button type="button" class="btn small" onclick={onSignOut}>Sign out</button>
        </p>
      {/if}
    </section>

    <section class="panel" aria-labelledby="installs-heading">
      <h2 id="installs-heading">Installations</h2>
      {#if session.installations.length > 0}
        <ul class="installs">
          {#each session.installations as install (install.installationId)}
            <li>
              <span>
                Installation <span class="num">{install.installationId}</span> on account
                <span class="num">{install.accountId}</span>
              </span>
              <span class="num"
                >{formatInt(install.repoCount)}
                {install.repoCount === 1 ? 'repository' : 'repositories'}</span
              >
              {#if install.suspended}
                <b class="flag">Suspended</b>
              {/if}
            </li>
          {/each}
        </ul>
      {:else}
        <p>The App is not installed anywhere yet, so nothing can wake your character.</p>
      {/if}
      <p class="row links">
        <a class="btn small primary" href={installUrl()} target="_blank" rel="noopener noreferrer">
          Install on more repositories
        </a>
        <a
          class="btn small"
          href="https://github.com/settings/installations"
          target="_blank"
          rel="noopener noreferrer"
        >
          Manage on GitHub
        </a>
      </p>
      <p class="dim small">
        Adding or removing repositories happens on GitHub. Uninstalling the App stops its events
        counting at once.
      </p>
    </section>

    <section class="panel" aria-labelledby="badge-heading">
      <h2 id="badge-heading">README badge</h2>
      <p>
        The badge you can put in a README shows your level, Vocation, Renown and the Feats you
        pinned to anyone who knows your GitHub login. Turn it off and the same address shows a
        neutral "unranked" badge, exactly as it does for a login that has never played.
      </p>
      <Switch
        id="badge-switch"
        checked={badgePublic}
        label="Show my badge publicly"
        describedBy="badge-status"
        disabled={session.busy === 'badge'}
        onchange={(event) => void chooseBadge(event)}
      />
      <div id="badge-status" aria-live="polite">
        <p class="dim small">
          {#if badgePublic}
            Your badge is public. It can take up to 6 hours to change in places that have already
            loaded it.
          {:else}
            Your badge is hidden. It can take up to 6 hours to change in places that have already
            loaded it.
          {/if}
        </p>
        {#if badgeError}
          <p class="error" role="alert">{badgeError}</p>
        {/if}
      </div>
    </section>

    <section class="panel" aria-labelledby="sound-heading">
      <h2 id="sound-heading">Sound</h2>
      <p>
        Short chimes for the big moments: the score ticker, a level-up, loot, a Feat, a Mogul
        arriving, a purchase, an act clear and the character coming home. They are made in your
        browser as they play; there are no audio files.
      </p>
      <Switch
        id="sound-switch"
        checked={$consent.sound}
        label="Play sound effects"
        describedBy="sound-status"
        onchange={chooseSound}
      />
      <div id="sound-status" aria-live="polite">
        <p class="dim small">
          {#if $consent.sound}
            Sound is on. Your browser starts it after your first click, tap or key press on the
            page.
          {:else}
            Sound is off, which is how it starts. Nothing is played, and no audio is set up, until
            you turn it on here.
          {/if}
          {#if reducedMotion}
            Your device asks for reduced motion. That never turns sound on; only this switch does.
          {/if}
        </p>
        {#if soundSaveFailed}
          <p class="error">
            This browser would not let Mergescape save your choice, so it only lasts until you leave
            this page.
          </p>
        {/if}
      </div>
      <p class="row">
        <button
          type="button"
          class="btn small"
          disabled={!$consent.sound}
          onclick={() => playCue('levelUp')}
        >
          Hear a sample
        </button>
      </p>
    </section>

    <section class="panel" aria-labelledby="data-heading">
      <h2 id="data-heading">Your data</h2>
      <p>
        Everything stored about you is counts and timestamps. Export it, or delete the lot, any
        time.
      </p>

      <div class="block">
        <h3>Export</h3>
        <p class="dim small">
          A JSON file with your profile, events, weeks and everything else we hold.
        </p>
        <p class="row">
          <button type="button" class="btn" disabled={exporting} onclick={() => void exportJson()}>
            {exporting ? 'Preparing…' : 'Export JSON'}
          </button>
        </p>
        <div aria-live="polite">
          {#if download}
            <p class="ok">
              Your export is ready.
              <a href={download.href} download={download.name}>Download {download.name}</a>
            </p>
          {/if}
        </div>
        {#if exportError}
          <p class="error" role="alert">{exportError}</p>
        {/if}
      </div>

      <div class="block danger">
        <h3>Delete everything</h3>
        {#if deleted}
          <p class="ok" role="status">
            Everything was deleted. Your next visit starts a fresh level 1 character.
          </p>
          <p class="row">
            {#if onSignOut}
              <button type="button" class="btn small" onclick={onSignOut}>Sign out</button>
            {:else}
              <button type="button" class="btn small" onclick={() => void session.load()}>
                Start again
              </button>
            {/if}
          </p>
        {:else if !confirming}
          <p class="dim small">
            This removes your character, your Combat Log, your runs, gold, Charms and Pledges, and
            every pull request record that only you appear in. It cannot be undone.
          </p>
          <p class="row">
            <button
              type="button"
              class="btn danger-btn"
              aria-expanded="false"
              aria-controls="confirm-delete"
              onclick={startDelete}
            >
              Delete everything&hellip;
            </button>
          </p>
        {:else}
          <form id="confirm-delete" class="confirm" onsubmit={deleteEverything}>
            <p>
              <b>This cannot be undone.</b> Your character, Combat Log, runs, gold, Charms and Pledges
              are deleted for good. Export first if you want a copy.
            </p>
            <label for="confirm-login">
              Type your GitHub login, <b class="num">{me.login}</b>, to confirm
            </label>
            <input
              id="confirm-login"
              class="field"
              type="text"
              autocomplete="off"
              autocapitalize="off"
              spellcheck="false"
              bind:value={typed}
              bind:this={field}
              aria-describedby={deleteError ? 'delete-error' : undefined}
            />
            <p class="row">
              <button type="submit" class="btn danger-btn" disabled={!matches || deleting}>
                {deleting ? 'Deleting…' : 'Delete everything'}
              </button>
              <button type="button" class="btn small" disabled={deleting} onclick={cancelDelete}>
                Cancel
              </button>
            </p>
          </form>
        {/if}
        {#if deleteError}
          <p class="error" id="delete-error" role="alert">{deleteError}</p>
        {/if}
      </div>
    </section>

    <section class="panel" aria-labelledby="legal-heading">
      <h2 id="legal-heading">The small print</h2>
      <p class="row links">
        <a href="#/privacy">Privacy</a>
        <a href="#/terms">Terms</a>
        <a href="#/cookies">Cookies</a>
      </p>
    </section>
  {/if}
</Frame>

<style>
  .panel p + p {
    margin-top: 8px;
  }

  .zone {
    font-size: 13px;
  }

  .small {
    font-size: 12.5px;
  }

  .installs {
    list-style: none;
    margin: 0 0 12px;
    padding: 0;
    display: grid;
    gap: 4px;
  }

  .installs li {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 16px;
    justify-content: space-between;
    padding: 6px 8px;
    border: 2px solid #000;
    background: var(--row);
    font-size: 13px;
  }

  .flag {
    font: 600 11px var(--mono);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--mult);
  }

  .links {
    gap: 8px 16px;
  }

  .block {
    margin-top: 16px;
    padding-top: 12px;
    border-top: 2px solid var(--wood);
  }

  .block h3 {
    margin-bottom: 4px;
    font: 600 14px var(--display);
    color: var(--parch);
  }

  .block.danger h3 {
    color: var(--mult);
  }

  .confirm {
    display: grid;
    gap: 8px;
    max-width: 480px;
    padding: 10px 12px;
    border: 2px solid var(--red);
    background: var(--row);
  }

  .confirm p {
    margin: 0;
  }

  .field {
    min-height: 40px;
    padding: 6px 10px;
    border: 2px solid #000;
    background: var(--track);
    color: var(--fg);
    font: 500 15px var(--mono);
  }

  .danger-btn {
    border-color: var(--red);
  }
</style>
