<script lang="ts">
  import Frame from '../lib/components/Frame.svelte';
  import LegalSection from '../lib/components/LegalSection.svelte';
  import { LEGAL_UPDATED, PROMISES } from '../lib/promises';

  interface Props {
    /** Where the back link goes: Settings for a signed-in player, the start page otherwise. */
    from?: 'settings' | 'landing';
  }

  let { from = 'landing' }: Props = $props();
</script>

<Frame title="Privacy">
  <!-- Keep this page in step with PRIVACY.md at the repository root; Legal.test.ts checks the dates. -->
  <LegalSection id="promise" title="In plain words">
    <ul>
      {#each PROMISES as promise (promise)}
        <li>{promise}</li>
      {/each}
    </ul>
  </LegalSection>

  <LegalSection id="store" title="What we store">
    <p>Only numbers, ids and times. That is the complete list.</p>
    <ul>
      <li>
        <b>You:</b> your numeric GitHub id and your login, learned once when you sign in, the ids of the
        App installations you can see, plus the game state they earn: experience, gold, Charms, Pledges,
        Vouchers, kills, weekly runs, supplies and expeditions.
      </li>
      <li>
        <b>Pull requests:</b> the repository's numeric id and whether it is private, the pull request
        number, the author's and the merger's numeric ids, when it was opened, merged or closed, whether
        it is a draft, whether it targets the default branch, lines added and deleted, files changed,
        commits, and how many review rounds and pushes it saw.
      </li>
      <li>
        <b>Reviews:</b> the reviewer's numeric id, whether they approved, asked for changes or commented,
        when, and how many inline comments they left.
      </li>
      <li>
        <b>Combat Log rows:</b> when an event happened, its kind, the repository id and pull request number,
        the points, Power, Zone, level, XP and supplies, the monster it was in the game, and the lines
        of the score breakdown. They contain no text from GitHub.
      </li>
      <li>
        <b>Your badge setting:</b> whether the public README badge may show you (on by default).
      </li>
      <li>
        <b>Plumbing:</b> the App installations and the repositories they cover, webhook delivery ids so
        nothing is counted twice, a one-time sign-in code, and anonymous counters with no person attached.
      </li>
    </ul>
  </LegalSection>

  <LegalSection id="never" title="What we never store">
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
      <li>Your email address, your real name or your avatar.</li>
      <li>
        The names of private repositories. Your own are fetched from GitHub live when you look at
        them.
      </li>
      <li>Payment details. There is nothing to buy.</li>
    </ul>
    <p class="dim">
      The App asks GitHub for read-only access to pull request metadata. It cannot comment, merge,
      push or change anything.
    </p>
  </LegalSection>

  <LegalSection id="why" title="Why, and where">
    <ul>
      <li>
        <b>Why:</b> to credit the right person, work out the score and show the Combat Log, run your weekly
        run and draw the README badge. We do not sell data or use it to profile anyone.
      </li>
      <li>
        <b>Where:</b> on Amazon Web Services in the US East (N. Virginia, us-east-1) region by default,
        so if you are outside the United States your data is processed there. The page itself is served
        by GitHub Pages and holds no personal data.
      </li>
    </ul>
  </LegalSection>

  <LegalSection id="keep" title="How long we keep it">
    <ul>
      <li><b>Raw events (Combat Log rows):</b> 90 days, then deleted automatically.</li>
      <li><b>Your profile and weekly run state:</b> until you delete them.</li>
      <li>
        <b>Pull request and review records:</b> until you delete everything, when the records only you
        appear in go too.
      </li>
      <li><b>Webhook delivery ids:</b> 7 days. <b>Sign-in codes:</b> 10 minutes.</li>
      <li><b>Sign-in sessions:</b> 7 days. <b>Server logs:</b> 14 days, errors only.</li>
      <li><b>The public badge:</b> up to 6 hours in caches after a change.</li>
    </ul>
  </LegalSection>

  <LegalSection id="others" title="People who haven't signed in">
    <p>
      If the App is installed on a shared repository, GitHub tells us about everyone's pull
      requests. We keep only what belongs to people who have signed in to Mergescape. Activity from
      anyone else is dropped before it is saved: it earns nobody anything and creates no profile and
      no Combat Log row. Only an anonymous count that something was dropped is kept, to watch for
      problems.
    </p>
    <p class="dim">
      One narrow exception: some rules (the party bonus, solo kills and the Riposte) need to know
      that a review happened. When a player who has signed in wrote, merged or reviewed a pull
      request, its shared record also notes each human review on it: the reviewer's numeric id, the
      verdict, the time and the number of inline comments, even if that reviewer never signed in. It
      is a number, not a name, and it goes when that pull request record does.
    </p>
  </LegalSection>

  <LegalSection id="controls" title="Your controls">
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
      <li>
        <b>This device:</b> Sign out, or Clear local data on the <a href="#/cookies">Cookies</a> page.
      </li>
    </ul>
  </LegalSection>

  <LegalSection id="third" title="Cookies and other parties">
    <ul>
      <li>
        No cookies, no ads, no analytics and no trackers today. Your sign-in token, the week the
        Mogul reveal last played and your analytics choice live in your browser's local storage on
        this device. See the <a href="#/cookies">Cookies</a> page.
      </li>
      <li>
        The page loads its three fonts from Google Fonts, so Google sees your IP address when your
        browser fetches them. Nothing else is loaded from anywhere else.
      </li>
      <li>
        GitHub is where you sign in and where the webhooks come from. Amazon Web Services runs the
        game and keeps ordinary request records for operating its network.
      </li>
    </ul>
  </LegalSection>

  <LegalSection id="future" title="Future analytics">
    <p class="dim">Stated on 9 November 2026. Nothing in this section exists yet.</p>
    <p>
      The maintainer intends to add first-party, privacy-respecting analytics later, using a package
      called noren. If that happens:
    </p>
    <ul>
      <li>It will be opt-in: off by default, with nothing measured until you switch it on.</li>
      <li>
        It will be documented here first: this page will say what is measured, why, where it goes
        and for how long, before any analytics code is released.
      </li>
      <li>
        It will be controllable from the <a href="#/cookies">Cookies</a> page, where you can switch it
        off again at any time.
      </li>
      <li>
        It will be first-party only: no ad networks, no third-party analytics and no cross-site
        tracking.
      </li>
    </ul>
  </LegalSection>

  <LegalSection id="badge" title="The README badge">
    <p>
      If you put the Mergescape badge in a README it is a public image: anyone who knows your GitHub
      login can see your level, Vocation and Renown, the small icons of the (up to three) Feats you
      chose to pin, and the Old Coin if you found it, and nothing else.
    </p>
    <p>
      <b>You can turn it off.</b> The switch "Show my badge publicly" in
      <a href="#/settings">Settings</a> is on by default. Turned off, the same address shows the neutral
      "unranked" badge that a login nobody has used gets, so it does not even show that you play. Places
      that have already loaded the picture can keep it for up to 6 hours. The choice is stored with your
      profile, and the public badge reads it together with the fields above. After you delete your data
      the badge also shows the neutral "unranked" badge.
    </p>
  </LegalSection>

  <LegalSection id="perf" title="Not a performance tool">
    <p>
      Mergescape is a game you play for yourself. Nobody else can see your character, there is no
      team dashboard and no manager view, and we do not plan to build one. Please don't use it to
      judge anyone's work.
    </p>
  </LegalSection>

  <LegalSection id="contact" title="Contact">
    <p>
      Open an issue in the project's repository on GitHub, or reach the maintainer through the
      contact options on their GitHub profile. Please don't put personal data in a public issue.
    </p>
  </LegalSection>

  <p class="foot dim">
    Last updated {LEGAL_UPDATED}. See also the <a href="#/terms">Terms</a> and the
    <a href="#/cookies">Cookies</a> page.
    {#if from === 'settings'}
      <a class="back" href="#/settings">Back to Settings</a>
    {:else}
      <a class="back" href="#/welcome">Back to the start</a>
    {/if}
  </p>
</Frame>

<style>
  :global(.panel) ul + p {
    margin-top: 8px;
  }

  .foot {
    margin: 0;
    font-size: 13px;
  }

  .foot .back {
    margin-left: 8px;
  }
</style>
