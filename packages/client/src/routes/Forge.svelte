<script lang="ts">
  import { onMount } from 'svelte';
  import {
    AFFIX_ORDER,
    GEAR_SLOTS,
    GEAR_TIER_RULES,
    petDefinition,
    recipeDefinition,
    STATION_IDS,
  } from '@mergescape/shared';
  import type { CapeColor, GearPiece, GearSlot } from '@mergescape/shared';
  import {
    AFFIX_LABELS,
    CAPE_COLOR_HEX,
    CAPE_COLOR_LABELS,
    canPay,
    formatCost,
    formatCountdown,
    forgeViewFrom,
    pieceDetail,
    pieceName,
    shortOf,
    SLOT_LABELS,
    stationStatusOf,
    STATION_LABELS,
    TIER_LABELS,
    UPGRADE_LABELS,
    affixCost,
  } from '../lib/depth';
  import Frame from '../lib/components/Frame.svelte';
  import GearSprite from '../lib/components/GearSprite.svelte';
  import Satchel from '../lib/components/Satchel.svelte';
  import type { ActionResult } from '../lib/errors';
  import { formatDecimal } from '../lib/format';
  import type { Session } from '../lib/session.svelte';
  import type { RecipeView, Station } from '../lib/types';

  interface Props {
    session: Session;
  }

  let { session }: Props = $props();

  const me = $derived(session.me);
  /** Ticks every second so order timers count down and a finished order flips to "ready" on its own. */
  let now = $state(Date.now());
  const view = $derived(session.forge ?? (me ? forgeViewFrom(me, now) : null));
  const working = $derived(session.busy !== null);
  const worn = $derived(me?.gear.equipped ?? {});
  const capeHex = $derived(me?.gear.capeColor ? CAPE_COLOR_HEX[me.gear.capeColor] : null);
  const hasDyes = $derived(me?.forge.upgrades.includes('dyes') ?? false);

  /** The inventory piece chosen for an affix order. */
  let pieceId = $state<string | null>(null);
  const chosen = $derived(me?.inventory.find((piece) => piece.id === pieceId) ?? null);
  let errors = $state<Record<string, string>>({});
  let notice = $state<string | null>(null);
  /** What the last collected order made. */
  let made = $state<GearPiece | null>(null);

  const gearPower = $derived(
    Object.values(worn).reduce((sum, piece) => sum + piece.power, 0) + (me?.gear.setBonus ?? 0),
  );
  const setTier = $derived.by(() => {
    const pieces = Object.values(worn);
    const tiers = new Set(pieces.map((piece) => piece.tier));
    return me && me.gear.setBonus > 0 && tiers.size === 1 ? (pieces[0]?.tier ?? null) : null;
  });

  onMount(() => {
    void session.loadForge();
    const timer = setInterval(() => {
      now = Date.now();
    }, 1000);
    return () => clearInterval(timer);
  });

  async function act(
    scope: string,
    run: () => Promise<ActionResult>,
    done?: () => string,
  ): Promise<boolean> {
    errors = {};
    notice = null;
    const result = await run();
    if (result.ok) {
      notice = done ? done() : null;
    } else {
      errors = { [scope]: result.message };
    }
    return result.ok;
  }

  function start(recipe: RecipeView): Promise<boolean> {
    const scope = `start:${recipe.id}`;
    return act(
      scope,
      () => session.forgeStart(scope, { recipeId: recipe.id }),
      () => `${recipe.name} is on the ${STATION_LABELS[recipe.station].name}.`,
    );
  }

  async function startAffix(): Promise<void> {
    const piece = chosen;
    if (!piece) {
      return;
    }
    const ok = await act(
      'affix',
      () => session.forgeStart('affix', { recipeId: 'scriptorium:affix', pieceId: piece.id }),
      () => `${pieceName(piece)} is at the Scriptorium for a new affix.`,
    );
    if (ok) {
      pieceId = null;
    }
  }

  async function collect(station: Station): Promise<void> {
    errors = {};
    notice = null;
    made = null;
    const scope = `collect:${station}`;
    const result = await session.forgeCollect(scope, station);
    if (result.ok) {
      made = result.piece ?? null;
      notice = result.piece
        ? result.applied === false
          ? `That order was already collected: ${pieceName(result.piece)}.`
          : `${pieceName(result.piece)} is in your inventory.`
        : 'Collected.';
    } else {
      errors = { [scope]: result.message };
    }
  }

  function equip(piece: GearPiece): Promise<boolean> {
    const scope = `equip:${piece.id}`;
    return act(
      scope,
      () => session.gearEquip(scope, { pieceId: piece.id }),
      () => `${pieceName(piece)} is on. It counts from your next event.`,
    );
  }

  function unequip(slot: GearSlot): Promise<boolean> {
    const scope = `unequip:${slot}`;
    return act(
      scope,
      () => session.gearEquip(scope, { unequip: slot }),
      () => `${SLOT_LABELS[slot]} taken off.`,
    );
  }

  function follow(petId: string): Promise<boolean> {
    const scope = `pet:${petId}`;
    const name = petDefinition(petId)?.name ?? petId;
    return act(
      scope,
      () => session.gearEquip(scope, { petId }),
      () => `${name} follows you now.`,
    );
  }

  function buyUpgrade(id: 'bellows' | 'dyes' | 'index'): Promise<boolean> {
    const scope = `upgrade:${id}`;
    return act(
      scope,
      () => session.forgeUpgrade(scope, { upgrade: id }),
      () => `${UPGRADE_LABELS[id]?.name ?? id} is yours for good.`,
    );
  }

  function dye(color: CapeColor | null): Promise<boolean> {
    return act(
      'dye',
      () => session.forgeUpgrade('dye', { capeColor: color }),
      () =>
        color ? `Your cape is ${CAPE_COLOR_LABELS[color]}.` : 'Your cape is its natural colour.',
    );
  }

  /** What stops a recipe from starting, in words; null when it can start. */
  function blocker(recipe: RecipeView, busy: boolean): string | null {
    if (!recipe.unlocked) {
      const definition = recipeDefinition(recipe.id);
      const rule = definition?.kind === 'craft' ? GEAR_TIER_RULES[definition.tier] : null;
      return rule
        ? `Needs level ${rule.unlockLevel}${rule.unlockRenown === null ? '' : ` or Renown ${rule.unlockRenown}`}`
        : 'Locked';
    }
    if (!recipe.affordable && me) {
      return `Short: ${shortOf(me.satchel, recipe.inputs)}`;
    }
    return busy ? 'The station is busy' : null;
  }

  function recipesOf(station: Station): RecipeView[] {
    return (view?.recipes ?? []).filter(
      (recipe) => recipe.station === station && recipe.id !== 'scriptorium:affix',
    );
  }

  const affixFlux = $derived(chosen ? affixCost(chosen) : { flux: AFFIX_ORDER.flux });
  const affixBlocker = $derived.by(() => {
    if (!me || !chosen) {
      return 'Choose a piece from your inventory below.';
    }
    const busy =
      stationStatusOf(me.forge.stations['scriptorium'], now) !== 'idle' &&
      stationStatusOf(me.forge.stations['scriptorium'], now) !== 'collected';
    if (busy) {
      return 'The Scriptorium is busy';
    }
    return canPay(me.satchel, affixFlux) ? null : `Short: ${shortOf(me.satchel, affixFlux)}`;
  });
</script>

<Frame title="Forge">
  {#if me && view}
    <section class="panel" aria-labelledby="satchel-heading">
      <h2 id="satchel-heading">Satchel</h2>
      <Satchel satchel={me.satchel} />
    </section>

    <div class="notices" aria-live="polite">
      {#if notice}
        <p class="ok row">
          {#if made}<GearSprite piece={made} scale={2} capeColor={capeHex} />{/if}
          <span>{notice}</span>
        </p>
      {/if}
    </div>

    <div class="stations">
      {#each STATION_IDS as station (station)}
        {@const job = me.forge.stations[station] ?? null}
        {@const state = stationStatusOf(job ?? undefined, now)}
        {@const busy = state === 'working' || state === 'ready'}
        {@const jobRecipe = job ? recipeDefinition(job.recipe) : undefined}
        <section class="panel station" aria-labelledby="station-{station}">
          <h2 id="station-{station}">{STATION_LABELS[station].name}</h2>
          <p class="dim makes">{STATION_LABELS[station].makes}.</p>

          <div class="job" data-state={state}>
            {#if state === 'working' && job}
              <p class="state">Working: {jobRecipe?.name ?? job.recipe}</p>
              <p class="timer num" role="timer" aria-label="Time until the order is ready">
                {formatCountdown(job.doneAt - now)}
              </p>
            {:else if state === 'ready' && job}
              <p class="state">Ready: {jobRecipe?.name ?? job.recipe}</p>
              <button
                type="button"
                class="btn small primary"
                disabled={working}
                onclick={() => void collect(station)}
              >
                Collect {jobRecipe?.name ?? 'the order'}
              </button>
              {#if errors[`collect:${station}`]}
                <p class="error" role="alert">{errors[`collect:${station}`]}</p>
              {/if}
            {:else}
              <p class="state">Idle</p>
            {/if}
          </div>

          <ul class="recipes" aria-label="{STATION_LABELS[station].name} recipes">
            {#each recipesOf(station) as recipe (recipe.id)}
              {@const why = blocker(recipe, busy)}
              <li class="recipe" class:dim-row={!recipe.unlocked}>
                <div class="what">
                  <b class="rname">{recipe.name}</b>
                  <span class="num cost">{formatCost(recipe.inputs)}</span>
                  <span class="num hours">{formatDecimal(recipe.hours)} h</span>
                </div>
                {#if recipe.unlocked}
                  <div class="go">
                    <button
                      type="button"
                      class="btn small"
                      disabled={why !== null || working}
                      aria-label="Start {recipe.name}"
                      onclick={() => void start(recipe)}
                    >
                      Start
                    </button>
                    {#if why}
                      <span class="why">{why}</span>
                    {/if}
                  </div>
                {:else}
                  <!-- A tier that is not open yet has nothing to start: just say when it opens. -->
                  <span class="why">{why}</span>
                {/if}
                {#if errors[`start:${recipe.id}`]}
                  <p class="error" role="alert">{errors[`start:${recipe.id}`]}</p>
                {/if}
              </li>
            {/each}
          </ul>

          {#if station === 'scriptorium'}
            <div class="affix">
              <h3>Roll an affix</h3>
              <p class="dim small">
                Costs {AFFIX_ORDER.flux} Flux, or {AFFIX_ORDER.rerollFlux} to re-roll a piece that has
                one. Takes {AFFIX_ORDER.hours} h. Pick the piece in your inventory.
              </p>
              <p class="pick">
                {#if chosen}
                  On <b>{pieceName(chosen)}</b> &middot;
                  <span class="num">{formatCost(affixFlux)}</span>
                {:else}
                  No piece chosen.
                {/if}
              </p>
              <button
                type="button"
                class="btn small"
                disabled={affixBlocker !== null || working}
                onclick={() => void startAffix()}
              >
                Roll an affix
              </button>
              {#if affixBlocker}
                <span class="why">{affixBlocker}</span>
              {/if}
              {#if errors['affix']}
                <p class="error" role="alert">{errors['affix']}</p>
              {/if}
            </div>
          {/if}
        </section>
      {/each}
    </div>

    <section class="panel" aria-labelledby="worn-heading">
      <h2 id="worn-heading">
        Wearing &middot; Power +{formatDecimal(gearPower)}
      </h2>
      <ul class="slots">
        {#each GEAR_SLOTS as slot (slot)}
          {@const piece = worn[slot]}
          <li class="slot" class:empty={!piece}>
            <span class="slot-name">{SLOT_LABELS[slot]}</span>
            {#if piece}
              <GearSprite {piece} scale={3} capeColor={capeHex} />
              <b class="pname">{pieceName(piece)}</b>
              <span class="detail">{pieceDetail(piece)}</span>
              {#if piece.affix}
                <span class="detail">{AFFIX_LABELS[piece.affix].text}</span>
              {/if}
              <button
                type="button"
                class="btn small"
                disabled={working}
                aria-label="Take off {pieceName(piece)}"
                onclick={() => void unequip(slot)}
              >
                Take off
              </button>
              {#if errors[`unequip:${slot}`]}
                <p class="error" role="alert">{errors[`unequip:${slot}`]}</p>
              {/if}
            {:else}
              <span class="detail">Empty</span>
            {/if}
          </li>
        {/each}
      </ul>
      <p class="dim small">
        {#if setTier}
          A full {TIER_LABELS[setTier]} set: +{formatDecimal(me.gear.setBonus)} Power on top of the pieces.
        {:else}
          Wear all five slots in one tier for +0.25 Power. What you wear counts for events scored
          from now on, never for ones already in the log.
        {/if}
      </p>
    </section>

    <section class="panel" aria-labelledby="inventory-heading">
      <h2 id="inventory-heading">Inventory &middot; {me.inventory.length}</h2>
      {#if me.inventory.length === 0}
        <p class="dim">Nothing spare. Orders and expeditions put gear here.</p>
      {:else}
        <ul class="grid">
          {#each me.inventory as piece (piece.id)}
            <li class="cell" class:picked={piece.id === pieceId}>
              <GearSprite {piece} scale={3} capeColor={capeHex} />
              <b class="pname">{pieceName(piece)}</b>
              <span class="detail">{pieceDetail(piece)}</span>
              {#if piece.affix}
                <span class="detail">{AFFIX_LABELS[piece.affix].text}</span>
              {/if}
              {#if piece.unique === 'reclaimed' && piece.owner}
                <span class="detail">Former owner: {piece.owner}</span>
              {/if}
              {#if piece.id === pieceId}
                <span class="detail chosen">Chosen for an affix</span>
              {/if}
              <div class="row buttons">
                <button
                  type="button"
                  class="btn small primary"
                  disabled={working}
                  aria-label="Equip {pieceName(piece)}"
                  onclick={() => void equip(piece)}
                >
                  Equip
                </button>
                <button
                  type="button"
                  class="btn small"
                  aria-pressed={piece.id === pieceId}
                  aria-label="Affix: {pieceName(piece)}"
                  onclick={() => (pieceId = piece.id === pieceId ? null : piece.id)}
                >
                  Affix
                </button>
              </div>
              {#if errors[`equip:${piece.id}`]}
                <p class="error" role="alert">{errors[`equip:${piece.id}`]}</p>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </section>

    <section class="panel" aria-labelledby="pets-heading">
      <h2 id="pets-heading">Pets &middot; {me.pets.length}</h2>
      <ul class="grid">
        {#each me.pets as petId (petId)}
          {@const definition = petDefinition(petId)}
          {@const following = worn.pet?.ref === petId}
          <li class="cell" class:picked={following}>
            <GearSprite piece={{ slot: 'pet', ref: petId, name: definition?.name }} scale={3} />
            <b class="pname">{definition?.name ?? petId}</b>
            <span class="detail">
              {definition?.passiveText || definition?.description || ''}
            </span>
            {#if following}
              <span class="detail">Following you</span>
            {:else}
              <button
                type="button"
                class="btn small"
                disabled={working}
                aria-label="Follow {definition?.name ?? petId}"
                onclick={() => void follow(petId)}
              >
                Follow
              </button>
            {/if}
            {#if errors[`pet:${petId}`]}
              <p class="error" role="alert">{errors[`pet:${petId}`]}</p>
            {/if}
          </li>
        {/each}
      </ul>
    </section>

    <section class="panel" aria-labelledby="upgrades-heading">
      <h2 id="upgrades-heading">Upgrades</h2>
      <ul class="upgrades">
        {#each view.upgrades as upgrade (upgrade.id)}
          {@const label = UPGRADE_LABELS[upgrade.id]}
          <li class="upgrade">
            <b class="pname">{label?.name ?? upgrade.id}</b>
            <span class="detail">{label?.text}</span>
            <span class="num detail">{formatCost(upgrade.cost)}</span>
            {#if upgrade.owned}
              <span class="owned">Owned</span>
            {:else}
              <button
                type="button"
                class="btn small"
                disabled={working || !canPay(me.satchel, upgrade.cost)}
                aria-label="Buy {label?.name ?? upgrade.id}"
                onclick={() => void buyUpgrade(upgrade.id)}
              >
                Buy
              </button>
              {#if !canPay(me.satchel, upgrade.cost)}
                <span class="why">Short: {shortOf(me.satchel, upgrade.cost)}</span>
              {/if}
            {/if}
            {#if errors[`upgrade:${upgrade.id}`]}
              <p class="error" role="alert">{errors[`upgrade:${upgrade.id}`]}</p>
            {/if}
          </li>
        {/each}
      </ul>

      {#if hasDyes}
        <fieldset class="dyes">
          <legend>Cape colour</legend>
          <ul class="swatches">
            <li>
              <label class="swatch">
                <input
                  type="radio"
                  name="cape-colour"
                  checked={me.gear.capeColor === null}
                  disabled={working}
                  onchange={() => void dye(null)}
                />
                <span class="chip natural" aria-hidden="true"></span>
                <span>Natural</span>
              </label>
            </li>
            {#each Object.keys(CAPE_COLOR_HEX) as key (key)}
              {@const color = key as CapeColor}
              <li>
                <label class="swatch">
                  <input
                    type="radio"
                    name="cape-colour"
                    checked={me.gear.capeColor === color}
                    disabled={working}
                    onchange={() => void dye(color)}
                  />
                  <span class="chip" style:--swatch={CAPE_COLOR_HEX[color]} aria-hidden="true"
                  ></span>
                  <span>{CAPE_COLOR_LABELS[color]}</span>
                </label>
              </li>
            {/each}
          </ul>
          {#if errors['dye']}
            <p class="error" role="alert">{errors['dye']}</p>
          {/if}
        </fieldset>
      {/if}
    </section>
  {/if}
</Frame>

<style>
  .stations {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 300px), 1fr));
    gap: 12px;
    align-items: start;
  }

  .makes {
    margin: 0 0 8px;
    font-size: 12.5px;
  }

  .job {
    margin-bottom: 10px;
    padding: 8px 10px;
    background: var(--row);
    border: 2px solid #000;
    display: grid;
    gap: 4px;
    justify-items: start;
  }

  .job[data-state='ready'] {
    border-color: var(--gold);
  }

  .state {
    margin: 0;
    font: 600 13px var(--display);
    color: var(--parch);
  }

  .timer {
    margin: 0;
    font-size: 22px;
    color: var(--gold);
  }

  .recipes,
  .upgrades,
  .slots,
  .grid,
  .swatches {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .recipes {
    display: grid;
    gap: 6px;
  }

  .recipe {
    display: grid;
    gap: 4px;
    padding: 6px 8px;
    background: var(--row);
    border: 2px solid #000;
  }

  .recipe.dim-row {
    border-style: dashed;
    border-color: var(--wood);
  }

  .what {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 2px 10px;
  }

  .rname {
    font: 700 13.5px var(--display);
    color: var(--parch);
  }

  .cost,
  .hours {
    font-size: 12px;
    color: var(--fg-dim);
  }

  .go {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 10px;
  }

  .why {
    font-size: 12px;
    color: var(--fg-dim);
  }

  .affix {
    margin-top: 12px;
    padding-top: 10px;
    border-top: 2px solid var(--wood);
    display: grid;
    gap: 6px;
    justify-items: start;
  }

  .affix h3 {
    font: 600 13px var(--display);
    color: var(--parch);
  }

  .small {
    margin: 0;
    font-size: 12.5px;
  }

  .pick {
    margin: 0;
    font-size: 13px;
  }

  .slots,
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 150px), 1fr));
    gap: 8px;
  }

  .slot,
  .cell {
    display: grid;
    gap: 3px;
    justify-items: start;
    align-content: start;
    min-width: 0;
    padding: 8px;
    background: var(--row);
    border: 2px solid #000;
  }

  .slot.empty {
    border-style: dashed;
    border-color: var(--wood);
  }

  .cell.picked {
    border-color: var(--gold);
    background: var(--row-open);
  }

  .slot-name {
    font: 600 10px/1.4 var(--mono);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--fg-dim);
  }

  .pname {
    font: 700 13.5px var(--display);
    color: var(--parch);
  }

  .detail {
    font-size: 12px;
    color: var(--fg-dim);
  }

  .buttons {
    gap: 6px;
    margin-top: 4px;
  }

  .chosen {
    color: var(--gold);
  }

  .upgrades {
    display: grid;
    gap: 8px;
  }

  .upgrade {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 12px;
    padding: 6px 8px;
    background: var(--row);
    border: 2px solid #000;
  }

  .owned {
    font: 600 12px var(--mono);
    color: var(--xp);
  }

  .dyes {
    margin: 12px 0 0;
    padding: 8px 10px;
    border: 2px solid var(--wood);
    min-width: 0;
  }

  .dyes legend {
    padding: 0 6px;
    font: 600 13px var(--display);
    color: var(--parch);
  }

  .swatches {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 14px;
  }

  .swatch {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    cursor: pointer;
  }

  .swatch input {
    accent-color: var(--gold);
  }

  .chip {
    width: 18px;
    height: 18px;
    border: 2px solid #000;
    background: var(--swatch, var(--stone2));
  }

  .chip.natural {
    background: repeating-linear-gradient(45deg, var(--stone2) 0 4px, var(--wood) 4px 8px);
  }
</style>
