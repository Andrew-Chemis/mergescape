<script lang="ts">
  import Breakdown from '../lib/components/Breakdown.svelte';
  import Sprite from '../lib/components/Sprite.svelte';
  import { fixtureLogEntries } from '../lib/fixtures/state';
  import { formatGain, monsterLabel, summarize } from '../lib/format';
  import { PROMISES } from '../lib/promises';

  interface Props {
    /** The api's `/auth/login` URL, or null when this build has no backend. */
    signInHref: string | null;
    /** Shown above the button when a stored session was rejected. */
    notice?: string;
  }

  let { signInHref, notice }: Props = $props();

  // A real kill from the scorer, so the page shows what the game explains.
  const sample = fixtureLogEntries(Date.now())[0];

  const steps = [
    {
      title: 'Sign in with GitHub',
      text: 'One click. We learn your numeric GitHub id and your login, nothing else.',
    },
    {
      title: 'Install the App on your repositories',
      text: 'Pick the repositories you want counted. The App is read-only: pull request metadata and nothing more.',
    },
    {
      title: 'Merge something',
      text: 'Your character sleeps until real work wakes it. Open the tab whenever you like; nothing needs you.',
    },
  ];
</script>

<div class="landing">
  <header class="hero">
    <Sprite name="hero" palette="rune" scale={7} />
    <div class="intro">
      <p class="eyebrow">An idle RPG powered by your real pull requests</p>
      <h1>Mergescape</h1>
      <p class="tagline">
        Pull requests are monsters. Your real reviews and merges are the only way to gain
        experience, on Diablo II's level curve, with every number explained.
      </p>
      {#if notice}
        <p class="notice" role="status">{notice}</p>
      {/if}
      <div class="row">
        {#if signInHref}
          <a class="btn primary" href={signInHref}>Sign in with GitHub</a>
        {:else}
          <button type="button" class="btn" disabled>Sign in with GitHub</button>
        {/if}
      </div>
      {#if !signInHref}
        <p class="note">
          This build has no backend configured, so sign-in is switched off.
          <a href="?fixture=1#/">Look around with demo data</a> instead.
        </p>
      {/if}
    </div>
  </header>

  <section aria-labelledby="steps-heading">
    <h2 id="steps-heading" class="section">How it works</h2>
    <ol class="steps">
      {#each steps as step, index (step.title)}
        <li class="panel step">
          <span class="n num" aria-hidden="true">{index + 1}</span>
          <h3>{step.title}</h3>
          <p>{step.text}</p>
        </li>
      {/each}
    </ol>
  </section>

  <section class="panel promise" aria-labelledby="promise-heading">
    <h2 id="promise-heading">Our promise</h2>
    <ul>
      {#each PROMISES as promise (promise)}
        <li>{promise}</li>
      {/each}
    </ul>
    <p class="legal">
      Read the full <a href="#/privacy">Privacy</a> page and the <a href="#/terms">Terms</a>.
    </p>
  </section>

  {#if sample}
    <section class="panel parch sample" aria-labelledby="sample-heading">
      <h2 id="sample-heading">What a kill looks like</h2>
      <p class="summary">
        {summarize(sample)} &middot; {monsterLabel(sample)} &middot;
        <span class="num">{formatGain(sample.xp)} XP</span>
      </p>
      <Breakdown entry={sample} label="Example score breakdown" />
    </section>
  {/if}
</div>

<style>
  .landing {
    max-width: 900px;
    margin: 0 auto;
    padding: 32px max(var(--gutter), env(safe-area-inset-left, 0px)) 72px;
    display: grid;
    gap: 28px;
  }

  .hero {
    display: flex;
    gap: 28px;
    align-items: center;
    flex-wrap: wrap;
  }

  .hero :global(.spr) {
    filter: drop-shadow(4px 4px 0 #000);
  }

  .intro {
    flex: 1 1 300px;
    min-width: 0;
    display: grid;
    gap: 12px;
  }

  h1 {
    font-size: clamp(34px, 8vw, 56px);
    line-height: 1;
    color: var(--gold);
    text-shadow: 3px 3px 0 #000;
  }

  .tagline {
    color: var(--fg);
  }

  .notice {
    padding: 8px 12px;
    border-left: 3px solid var(--gold);
    background: var(--panel);
  }

  .section {
    margin: 0 0 10px;
    font-size: 24px;
    color: var(--parch);
  }

  .steps {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 240px), 1fr));
    gap: 12px;
  }

  .step {
    display: grid;
    gap: 6px;
    align-content: start;
  }

  .step h3 {
    font-size: 17px;
    color: var(--gold);
  }

  .step .n {
    width: 28px;
    height: 28px;
    display: grid;
    place-items: center;
    background: var(--wood);
    border: 2px solid #000;
    color: var(--parch);
    font-weight: 600;
  }

  .promise ul {
    margin: 0;
    padding-left: 20px;
    display: grid;
    gap: 6px;
  }

  .legal {
    margin-top: 10px;
    font-size: 13px;
  }

  .sample .summary {
    margin: 0 0 8px;
    font-weight: 500;
  }
</style>
