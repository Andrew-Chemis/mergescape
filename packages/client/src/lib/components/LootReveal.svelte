<script lang="ts">
  import type { LootItem } from '@mergescape/shared';
  import { lootCaption, lootKindLabel, lootRarity, lootSpoken, lootTitle } from '../depth';
  import { prefersReducedMotion } from '../motion';
  import GearSprite from './GearSprite.svelte';

  interface Props {
    loot: LootItem[];
    /**
     * True at the moment of collecting: the cards flip face up one after another, left to right
     * (game-design.md section 9, moment 3). False shows them face up at once (the last haul, a replay).
     */
    play?: boolean;
  }

  let { loot, play = true }: Props = $props();

  /** The gap between one card turning and the next, and how long one turn takes. */
  const STEP_MS = 380;
  const FLIP_MS = 520;

  let finished = $state(false);
  let skipped = $state(false);

  /**
   * - `flip`: each card turns over in turn, rare ones glint after
   * - `fade`: prefers-reduced-motion, every card fades in together and nothing glints
   * - `still`: face up already (not playing, skipped, or the animation has run its course)
   */
  const motion = $derived<'flip' | 'fade' | 'still'>(
    !play || skipped || finished ? 'still' : prefersReducedMotion() ? 'fade' : 'flip',
  );

  $effect(() => {
    if (motion === 'still') {
      return;
    }
    const total = motion === 'flip' ? loot.length * STEP_MS + FLIP_MS + 900 : 700;
    const timer = setTimeout(() => {
      finished = true;
    }, total);
    return () => clearTimeout(timer);
  });

  const summary = $derived(
    `${loot.length} ${loot.length === 1 ? 'item' : 'items'}: ${loot.map(lootTitle).join(', ')}.`,
  );
</script>

<div class="reveal" data-motion={motion}>
  <ol class="cards-row" aria-label="Haul">
    {#each loot as item, index (index)}
      {@const rarity = lootRarity(item)}
      <li class="slot" style:--i={index}>
        <span class="back" aria-hidden="true"><span class="mark">?</span></span>
        <article
          class="card {rarity}"
          class:glint={rarity === 'rare' || rarity === 'legendary'}
          aria-label={lootSpoken(item)}
        >
          <span class="rar">{lootKindLabel(item)}</span>
          <div class="icon">
            {#if item.kind === 'gear' || item.kind === 'unique'}
              <GearSprite piece={item.piece} scale={3} />
            {:else if item.kind === 'pet'}
              <GearSprite
                piece={{ slot: 'pet', ref: item.petId, name: lootTitle(item) }}
                scale={3}
              />
            {:else if item.kind === 'material'}
              <span class="pip {item.material}" aria-hidden="true"></span>
            {:else if item.kind === 'charm_pack'}
              <span class="initial" aria-hidden="true">C</span>
            {:else}
              <span class="initial" aria-hidden="true">7</span>
            {/if}
          </div>
          <h3 class="name">{lootTitle(item)}</h3>
          {#if lootCaption(item)}
            <p class="desc">{lootCaption(item)}</p>
          {/if}
        </article>
      </li>
    {/each}
  </ol>
  {#if motion === 'flip'}
    <p class="skip">
      <button type="button" class="btn small" onclick={() => (skipped = true)}>Skip</button>
    </p>
  {/if}
  {#if play}
    <p class="visually-hidden" role="status">{summary}</p>
  {/if}
</div>

<style>
  .reveal {
    display: grid;
    gap: 8px;
  }

  .cards-row {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 150px), 1fr));
    gap: 14px 12px;
  }

  .slot {
    position: relative;
    min-width: 0;
    display: grid;
  }

  .card {
    overflow: hidden;
  }

  /* The face-down card that turns away; it only exists while a reveal is playing. */
  .back {
    display: none;
    position: absolute;
    inset: 0;
    z-index: 1;
    place-items: center;
    border: 3px solid #000;
    background: repeating-linear-gradient(45deg, var(--stone2) 0 6px, var(--stone) 6px 12px);
    box-shadow:
      inset 0 0 0 3px var(--purple),
      4px 4px 0 #000;
  }

  .mark {
    font: 700 28px var(--display);
    color: var(--parch);
  }

  .icon {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 48px;
  }

  .pip {
    width: 32px;
    height: 32px;
    border: 2px solid #000;
    background: var(--pip, var(--fg-dim));
  }

  .pip.ore {
    --pip: #c0794a;
  }

  .pip.timber {
    --pip: #8c5a2b;
  }

  .pip.lore {
    --pip: #7fb0ff;
  }

  .pip.ink {
    --pip: #a371f7;
  }

  .pip.provisions {
    --pip: #ffd23f;
  }

  .pip.flux {
    --pip: #ff9c2b;
  }

  .pip.silver {
    --pip: #cfd8e6;
  }

  .pip.mithril {
    --pip: #2f8f93;
  }

  .pip.rune {
    --pip: #3a8fb5;
  }

  .pip.dragon {
    --pip: #b3272b;
  }

  .skip {
    margin: 0;
  }

  /* Rare and legendary cards carry a glint: a light band that sweeps across once they are face up. */
  .glint::after {
    content: '';
    position: absolute;
    inset: 0 auto 0 -40%;
    width: 30%;
    background: linear-gradient(100deg, transparent, rgba(255, 255, 255, 0.35), transparent);
    transform: skewX(-18deg);
    opacity: 0;
    pointer-events: none;
  }

  .card.legendary {
    box-shadow:
      4px 4px 0 #000,
      0 0 14px 2px rgba(242, 193, 78, 0.45);
  }

  @keyframes turn-away {
    from {
      transform: scaleX(1);
    }
    to {
      transform: scaleX(0);
    }
  }

  @keyframes turn-up {
    from {
      transform: scaleX(0);
    }
    to {
      transform: scaleX(1);
    }
  }

  @keyframes fade {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  @keyframes glint {
    from {
      left: -40%;
      opacity: 1;
    }
    to {
      left: 120%;
      opacity: 1;
    }
  }

  /* Reduced motion (Requirement 10.5) collapses the reveal to one fade, whatever the script decided. */
  .reveal[data-motion='fade'] .card {
    animation: fade 450ms linear both;
  }

  @media (prefers-reduced-motion: no-preference) {
    /* steps() keeps the turn in whole pixels, like the sprites */
    .reveal[data-motion='flip'] .back {
      display: grid;
      animation: turn-away calc(var(--turn, 520ms) / 2) steps(5, end) both;
      animation-delay: calc(var(--i) * 380ms);
      transform-origin: center;
    }

    .reveal[data-motion='flip'] .card {
      animation: turn-up calc(var(--turn, 520ms) / 2) steps(5, end) both;
      animation-delay: calc(var(--i) * 380ms + var(--turn, 520ms) / 2);
    }

    .reveal[data-motion='flip'] .glint::after {
      animation: glint 800ms ease-out both;
      animation-delay: calc(var(--i) * 380ms + var(--turn, 520ms));
    }
  }
</style>
