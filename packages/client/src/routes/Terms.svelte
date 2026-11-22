<script lang="ts">
  import { MOGUL_DISCLAIMER } from '@mergescape/shared';
  import Frame from '../lib/components/Frame.svelte';
  import LegalSection from '../lib/components/LegalSection.svelte';
  import { LEGAL_UPDATED } from '../lib/promises';

  interface Props {
    /** Where the back link goes: Settings for a signed-in player, the start page otherwise. */
    from?: 'settings' | 'landing';
  }

  let { from = 'landing' }: Props = $props();
</script>

<Frame title="Terms">
  <!-- Keep this page in step with TERMS.md at the repository root; Legal.test.ts checks the dates. -->
  <LegalSection id="what" title="What Mergescape is">
    <p>
      A free idle game. Your character gains experience only from your own real activity on GitHub:
      opening, reviewing and merging pull requests. There is nothing to buy. Gold is earned by
      shipping and can never be bought, and there is no real-money store.
    </p>
  </LegalSection>

  <LegalSection id="who" title="Who can use it">
    <ul>
      <li>
        You need a GitHub account in good standing, and you must be old enough to hold one (13 at
        the minimum). Where your country sets a higher age for agreeing to the processing of your
        data online, such as 16, you must be at least that old or have a parent's or guardian's
        permission where the law allows it.
      </li>
      <li>You sign in with GitHub. One GitHub account is one character.</li>
      <li>
        Install the App only on repositories you are allowed to install it on. If you are not the
        owner, ask them first.
      </li>
    </ul>
  </LegalSection>

  <LegalSection id="using" title="Acceptable use">
    <p>Play for yourself, and play nicely. Please don't:</p>
    <ul>
      <li>send forged, replayed or crafted deliveries to the webhook endpoint, or probe it;</li>
      <li>flood, load-test or script the service in a way that strains it for others;</li>
      <li>
        try to inflate, change, read or delete anyone else's character or data, or fabricate
        activity that counts for another person;
      </li>
      <li>break the sign-in flow or go around the limits the service sets.</li>
    </ul>
    <p class="dim">
      Playing your own game your own way, including farming your own numbers, is fine: it is
      single-player and harms nobody. Found a security problem? Please report it privately.
    </p>
  </LegalSection>

  <LegalSection id="notperf" title="Not a performance tool">
    <p>
      The game is not a measure of anyone's work and must not be used to judge, rank, monitor,
      discipline or pay people. Employers and managers must not require anyone to use it or to share
      their character, export or badge. There is no manager view.
    </p>
  </LegalSection>

  <LegalSection id="notaff" title="Not affiliated, and satire">
    <p>
      Mergescape is an independent project. It is not made, endorsed or sponsored by GitHub or by
      Amazon Web Services. GitHub is a trademark of its owner.
    </p>
    <p class="dim">{MOGUL_DISCLAIMER}</p>
  </LegalSection>

  <LegalSection id="data" title="Your data">
    <p>
      We store counts, ids and timestamps about pull requests and reviews, and your game state, and
      nothing else. You can export it or delete it at any time. See the
      <a href="#/privacy">Privacy</a> page for the details and the
      <a href="#/cookies">Cookies</a> page for what stays in your browser.
    </p>
  </LegalSection>

  <LegalSection id="asis" title="As is">
    <p>
      Mergescape is open source under the MIT licence and is provided as is, with no warranty. In
      particular:
    </p>
    <ul>
      <li>
        <b>No guarantee of uptime.</b> It runs on free-tier cloud resources and may be slow, paused, changed
        or shut down.
      </li>
      <li>
        <b>No guarantee that your data is kept.</b> Raw events are deleted after 90 days, and progress
        can be lost to a bug or a reset. The only copy you can rely on is the one you make with Export
        in Settings.
      </li>
      <li>
        <b>Scores can change.</b> We may rebalance the numbers as the game grows; the Combat Log always
        shows every term of every score so you can see what changed.
      </li>
      <li>
        <b>It may stop.</b> If the service closes we will try to say so in the repository and to leave
        Export working for a reasonable time, but that is a best effort.
      </li>
    </ul>
  </LegalSection>

  <LegalSection id="liability" title="Limits on liability">
    <p>
      To the extent the law allows, the maintainer is not liable for indirect or consequential loss,
      or for lost data, progress or time, arising from your use of the service. It is free, and
      using it is at your own risk. Nothing here limits rights you have under the law of your
      country that cannot be limited.
    </p>
  </LegalSection>

  <LegalSection id="ending" title="Ending your use">
    <ul>
      <li>
        You can stop at any time: export your data, delete it in <a href="#/settings">Settings</a>,
        uninstall the App on GitHub, and sign out.
      </li>
      <li>
        The maintainer may suspend or remove a character, or block access, for abuse as described
        above or to protect the service or other people, without notice when that is needed to stop
        an attack.
      </li>
    </ul>
  </LegalSection>

  <LegalSection id="changes" title="Changes to these terms">
    <p>
      If these terms change, this page changes with them and the date below changes. Changes are
      announced in the project's repository, where the history of the terms file is public. If you
      keep using the service after a change takes effect, you accept the new terms.
    </p>
  </LegalSection>

  <LegalSection id="law" title="Governing law">
    <p>[Governing law and venue: to be filled in by the maintainer before public launch.]</p>
  </LegalSection>

  <LegalSection id="contact" title="Contact">
    <p>
      Open an issue in the project's repository on GitHub, or reach the maintainer through the
      contact options on their GitHub profile.
    </p>
  </LegalSection>

  <p class="foot dim">
    Last updated {LEGAL_UPDATED}. See also the <a href="#/privacy">Privacy</a> and
    <a href="#/cookies">Cookies</a> pages.
    {#if from === 'settings'}
      <a class="back" href="#/settings">Back to Settings</a>
    {:else}
      <a class="back" href="#/welcome">Back to the start</a>
    {/if}
  </p>
</Frame>

<style>
  .foot {
    margin: 0;
    font-size: 13px;
  }

  .foot .back {
    margin-left: 8px;
  }
</style>
