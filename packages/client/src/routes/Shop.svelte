<script lang="ts">
  import { onMount } from 'svelte';
  import { charmSellPrice, INTEREST, voucherDefinition } from '@mergescape/shared';
  import type { Charm } from '@mergescape/shared';
  import CharmCard from '../lib/components/CharmCard.svelte';
  import Frame from '../lib/components/Frame.svelte';
  import PackOpen from '../lib/components/PackOpen.svelte';
  import Sprite from '../lib/components/Sprite.svelte';
  import type { ActionResult } from '../lib/errors';
  import { formatInt } from '../lib/format';
  import { ACT_LABELS, PACK_LABELS } from '../lib/names';
  import type { Session } from '../lib/session.svelte';
  import { charmSprite } from '../lib/sprites';
  import type { ShopOption } from '../lib/types';

  interface Props {
    session: Session;
  }

  let { session }: Props = $props();

  const me = $derived(session.me);
  const week = $derived(session.week);
  const shop = $derived(week?.shop ?? null);
  const gold = $derived(me?.gold ?? 0);
  const working = $derived(session.busy !== null);
  const interestCap = $derived(
    me?.vouchers.includes('deep-pockets') ? INTEREST.capWithDeepPockets : INTEREST.cap,
  );
  const opened = $derived(shop?.packs.filter((pack) => pack.bought && !pack.picked) ?? []);
  const slotsUsed = $derived(me?.charms.length ?? 0);

  /** The message beside the control that failed, keyed by the control's scope; one at a time. */
  let errors = $state<Record<string, string>>({});
  /** What the last successful action did, spoken politely. */
  let notice = $state<string | null>(null);
  let shrineOpen = $state(false);

  onMount(() => {
    // The shop may have opened since the last poll.
    void session.refreshWeek();
  });

  async function act(
    scope: string,
    run: () => Promise<ActionResult>,
    done?: () => string,
  ): Promise<void> {
    errors = {};
    notice = null;
    const result = await run();
    if (result.ok) {
      notice = done ? done() : null;
    } else {
      errors = { [scope]: result.message };
    }
  }

  function buyCharm(index: number, charm: Charm): Promise<void> {
    const scope = `charm:${index}`;
    return act(
      scope,
      () => session.shopBuy(scope, { kind: 'charm', index }),
      () => `${charm.name} is yours.`,
    );
  }

  function buyPack(index: number, name: string): Promise<void> {
    const scope = `pack:${index}`;
    return act(
      scope,
      () => session.shopBuy(scope, { kind: 'pack', index }),
      () => `${name} bought. Open it below and keep one card.`,
    );
  }

  function buyVoucher(name: string): Promise<void> {
    return act(
      'voucher',
      () => session.shopBuy('voucher', { kind: 'voucher' }),
      () => `${name} is yours for good.`,
    );
  }

  function takeLegendary(charm: Charm): Promise<void> {
    return act(
      'legendary',
      () => session.shopBuy('legendary', { kind: 'legendary' }),
      () => `${charm.name} is yours.`,
    );
  }

  function reroll(): Promise<void> {
    return act(
      'reroll',
      () => session.shopReroll('reroll'),
      () => 'The shelves are new.',
    );
  }

  function sell(charm: Charm, price: number): Promise<void> {
    const scope = `sell:${charm.id}`;
    return act(
      scope,
      () => session.shopSell(scope, charm.id),
      () => `Sold ${charm.name} for ${formatInt(price)} gold.`,
    );
  }

  function removePledge(id: string, name: string): Promise<void> {
    const scope = `shrine:${id}`;
    return act(
      scope,
      () => session.shrineRemove(scope, id),
      () => `${name} left your deck.`,
    );
  }

  /** What keeping a card did, in words. A face-down card is found by what is new in the deck. */
  function describeKept(option: ShopOption | null, deckBefore: readonly { id: string }[]): string {
    if (option?.kind === 'charm') {
      return `${option.charm.name} is yours.`;
    }
    if (option?.kind === 'pledge') {
      return `${option.pledge.name} joins your deck.`;
    }
    if (option?.kind === 'cosmetic') {
      return `${option.name} added to your collection.`;
    }
    const before: Record<string, number> = {};
    for (const card of deckBefore) {
      before[card.id] = (before[card.id] ?? 0) + 1;
    }
    for (const card of session.me?.deck ?? []) {
      const left = before[card.id] ?? 0;
      if (left === 0) {
        return `${card.name} joins your deck.`;
      }
      before[card.id] = left - 1;
    }
    return 'The card joins your deck.';
  }

  function keep(packIndex: number, option: number, options: ShopOption[] | null): Promise<void> {
    const scope = `keep:${packIndex}`;
    const deckBefore = me?.deck ?? [];
    return act(
      scope,
      () => session.shopPick(scope, { index: packIndex, option }),
      () => describeKept(options?.[option] ?? null, deckBefore),
    );
  }

  function sellPrice(charm: Charm): number {
    return shop?.sellPrices[charm.id] ?? charmSellPrice(charm.rarity);
  }

  function shortBy(price: number): number {
    return Math.max(0, price - gold);
  }

  function toNext(): string | null {
    if (!week || week.act === null) {
      return null;
    }
    const left = Math.max(0, week.targets[week.act] - week.weeklyXp);
    return `Your next act is ${ACT_LABELS[week.act].name}, ${formatInt(left)} XP away.`;
  }
</script>

<Frame title="Shop">
  {#if me}
    <div class="keeper row">
      <div class="who row">
        <span class="portrait"><Sprite name="hero" palette="leather" scale={3} /></span>
        <p class="say">
          "Spend it or save it. Interest pays 1 per {INTEREST.heldPerGold}, cap {interestCap}."
        </p>
      </div>
      <p class="purse num">
        {formatInt(gold)} g
        {#if shop}
          <small>+{formatInt(shop.interestPreview)} interest next clear</small>
        {/if}
      </p>
    </div>

    <div class="notices" aria-live="polite">
      {#if notice}
        <p class="ok">{notice}</p>
      {/if}
    </div>

    {#if week?.freePack === 'pledge'}
      <PackOpen
        title="Free Pledge pack"
        options={week.freePackOptions}
        busy={working}
        error={errors['keep:-1']}
        onKeep={(option) => void keep(-1, option, week?.freePackOptions ?? null)}
      />
    {/if}

    {#if week?.legendaryOffer}
      {@const offer = week.legendaryOffer}
      <section class="panel legend" aria-labelledby="legendary-heading">
        <h2 id="legendary-heading">A Legendary Charm is on offer</h2>
        <p class="dim lead">
          Beating a Mogul on every fourth Renown earns one, free. It needs an open Charm slot, so
          sell one first if they are full.
        </p>
        <ul class="cards one">
          <li>
            <CharmCard charm={offer}>
              <button
                type="button"
                class="btn small primary"
                disabled={working}
                onclick={() => void takeLegendary(offer)}
              >
                Take {offer.name}
              </button>
              {#if errors['legendary']}
                <p class="error" role="alert">{errors['legendary']}</p>
              {/if}
            </CharmCard>
          </li>
        </ul>
      </section>
    {/if}

    {#each opened as pack (pack.index)}
      <PackOpen
        title="{PACK_LABELS[pack.kind].name} opened"
        options={pack.options}
        busy={working}
        error={errors[`keep:${pack.index}`]}
        onKeep={(option) => void keep(pack.index, option, pack.options)}
      />
    {/each}

    {#if shop}
      <section class="panel" aria-labelledby="charms-heading">
        <h2 id="charms-heading">Charms</h2>
        <ul class="cards two">
          {#each shop.charms as slot (slot.index)}
            <li>
              <CharmCard charm={slot.charm} price={slot.price} sold={slot.sold}>
                {#snippet children(nameId)}
                  {#if slot.sold}
                    <p class="sold-note">Sold</p>
                  {:else}
                    <button
                      type="button"
                      class="btn small primary"
                      disabled={working}
                      aria-describedby={nameId}
                      onclick={() => void buyCharm(slot.index, slot.charm)}
                    >
                      Buy &middot; {formatInt(slot.price)} g
                    </button>
                    {#if shortBy(slot.price) > 0}
                      <p class="short">{formatInt(shortBy(slot.price))} gold short</p>
                    {/if}
                    {#if errors[`charm:${slot.index}`]}
                      <p class="error" role="alert">{errors[`charm:${slot.index}`]}</p>
                    {/if}
                  {/if}
                {/snippet}
              </CharmCard>
            </li>
          {/each}
        </ul>
      </section>

      <div class="row shelves">
        <section class="panel grow" aria-labelledby="packs-heading">
          <h2 id="packs-heading">Packs</h2>
          <ul class="cards two">
            {#each shop.packs as pack (pack.index)}
              {@const label = PACK_LABELS[pack.kind]}
              <li>
                <article
                  class="card pack"
                  class:sold={pack.picked}
                  aria-labelledby="pack-{pack.index}-name"
                >
                  <span class="rar">{label.name} &middot; {formatInt(pack.price)} g</span>
                  <h3 class="name" id="pack-{pack.index}-name">See 3, keep 1</h3>
                  <p class="desc">{label.blurb}</p>
                  {#if pack.picked}
                    <p class="sold-note">Opened and kept</p>
                  {:else if pack.bought}
                    <p class="sold-note">Bought. It is open above.</p>
                  {:else}
                    <button
                      type="button"
                      class="btn small primary"
                      disabled={working}
                      aria-describedby="pack-{pack.index}-name"
                      onclick={() => void buyPack(pack.index, label.name)}
                    >
                      Buy &middot; {formatInt(pack.price)} g
                    </button>
                    {#if shortBy(pack.price) > 0}
                      <p class="short">{formatInt(shortBy(pack.price))} gold short</p>
                    {/if}
                    {#if errors[`pack:${pack.index}`]}
                      <p class="error" role="alert">{errors[`pack:${pack.index}`]}</p>
                    {/if}
                  {/if}
                </article>
              </li>
            {/each}
          </ul>
        </section>

        <section class="panel grow" aria-labelledby="voucher-heading">
          <h2 id="voucher-heading">Voucher &middot; one per act</h2>
          {#if shop.voucher}
            {@const voucher = shop.voucher}
            {@const info = voucherDefinition(voucher.id)}
            <article class="card voucher" class:sold={voucher.sold} aria-labelledby="voucher-name">
              <span class="rar">Voucher &middot; {formatInt(voucher.price)} g</span>
              <h3 class="name" id="voucher-name">{info?.name ?? voucher.id}</h3>
              {#if info}
                <p class="desc">{info.description}</p>
              {/if}
              {#if voucher.sold}
                <p class="sold-note">Sold</p>
              {:else}
                <button
                  type="button"
                  class="btn small primary"
                  disabled={working}
                  aria-describedby="voucher-name"
                  onclick={() => void buyVoucher(info?.name ?? voucher.id)}
                >
                  Buy &middot; {formatInt(voucher.price)} g
                </button>
                {#if shortBy(voucher.price) > 0}
                  <p class="short">{formatInt(shortBy(voucher.price))} gold short</p>
                {/if}
                {#if errors['voucher']}
                  <p class="error" role="alert">{errors['voucher']}</p>
                {/if}
              {/if}
            </article>
          {:else}
            <p class="dim">No Vouchers left. You own all six.</p>
          {/if}
        </section>
      </div>

      <section class="panel" aria-labelledby="tools-heading">
        <h2 id="tools-heading">Re-roll and shrine</h2>
        <div class="row tools">
          <div class="tool">
            <button type="button" class="btn" disabled={working} onclick={() => void reroll()}>
              Re-roll &middot; {formatInt(shop.rerollCost)} g
            </button>
            <p class="dim small">
              New Charms and packs. A pack you bought stays. Each re-roll costs 10 more.
            </p>
            {#if errors['reroll']}
              <p class="error" role="alert">{errors['reroll']}</p>
            {/if}
          </div>
          <div class="tool">
            <button
              type="button"
              class="btn"
              aria-expanded={shrineOpen}
              aria-controls="shrine"
              onclick={() => (shrineOpen = !shrineOpen)}
            >
              Shrine: remove a Pledge &middot; {shop.shrineCost === 0
                ? 'free'
                : `${formatInt(shop.shrineCost)} g`}
            </button>
            <p class="dim small">
              Thin the deck so the good Pledges come up more. {me.deck.length} in your deck.
            </p>
          </div>
        </div>
        {#if shrineOpen}
          <ul class="deck" id="shrine" aria-label="Your Pledge deck">
            {#each me.deck as card, index (index)}
              <li class="deck-row">
                <span class="deck-name" id="deck-{index}-name">{card.name}</span>
                <button
                  type="button"
                  class="btn small"
                  disabled={working}
                  aria-describedby="deck-{index}-name"
                  onclick={() => void removePledge(card.id, card.name)}
                >
                  Remove
                </button>
                {#if errors[`shrine:${card.id}`]}
                  <p class="error" role="alert">{errors[`shrine:${card.id}`]}</p>
                {/if}
              </li>
            {/each}
          </ul>
        {/if}
      </section>

      <section class="panel" aria-labelledby="sell-heading">
        <h2 id="sell-heading">
          Your Charms &middot; {slotsUsed} of {me.charmSlots} slots
        </h2>
        {#if me.charms.length > 0}
          <ul class="sell">
            {#each me.charms as charm (charm.id)}
              {@const icon = charmSprite(charm.id)}
              {@const price = sellPrice(charm)}
              <li class="sell-row">
                <span class="mini">
                  {#if icon}
                    <Sprite name={icon} scale={2} />
                  {:else}
                    <span class="initial" aria-hidden="true">{charm.name.slice(0, 1)}</span>
                  {/if}
                </span>
                <span class="sell-name" id="sell-{charm.id}-name">
                  {charm.name}{#if (charm.copies ?? 1) > 1}&nbsp;&times;{charm.copies}{/if}
                </span>
                <button
                  type="button"
                  class="btn small"
                  disabled={working}
                  aria-describedby="sell-{charm.id}-name"
                  onclick={() => void sell(charm, price)}
                >
                  Sell &middot; {formatInt(price)} g
                </button>
                {#if errors[`sell:${charm.id}`]}
                  <p class="error" role="alert">{errors[`sell:${charm.id}`]}</p>
                {/if}
              </li>
            {/each}
          </ul>
          <p class="dim small">
            A sold Charm pays half its shop price. You can sell any time the shop is open.
          </p>
        {:else}
          <p class="dim">You hold no Charms. Buy one above.</p>
        {/if}
      </section>
    {:else}
      <section class="panel" aria-labelledby="closed-heading">
        <h2 id="closed-heading">The shop is closed</h2>
        <p>
          The Grizzled Reviewer opens his stall each time you clear an act, and it stays open until
          the next one clears. Nothing is lost if an act goes uncleared.
        </p>
        {#if toNext()}
          <p class="dim next">{toNext()}</p>
        {/if}
        <p class="next"><a href="#/map">See the Run Map</a></p>
      </section>
    {/if}
  {/if}
</Frame>

<style>
  .keeper {
    justify-content: space-between;
    gap: 12px 24px;
  }

  .who {
    gap: 12px;
    flex: 1 1 280px;
    min-width: 0;
  }

  .portrait :global(.spr) {
    filter: sepia(0.6) drop-shadow(2px 2px 0 #000);
  }

  .say {
    margin: 0;
    font: 600 13px var(--display);
    color: var(--parch);
  }

  .purse {
    margin: 0;
    font: 700 20px var(--display);
    color: var(--gold);
    text-align: right;
  }

  .purse small {
    display: block;
    font: 500 11px var(--mono);
    color: var(--fg-dim);
  }

  .notices {
    min-height: 0;
  }

  .legend {
    border-color: var(--gold);
  }

  .lead {
    margin: 0 0 12px;
    font-size: 13px;
  }

  .two {
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 200px), 1fr));
  }

  .one {
    grid-template-columns: minmax(min(100%, 220px), 280px);
  }

  .shelves {
    align-items: flex-start;
  }

  .shelves > :global(.grow) {
    flex-basis: 300px;
  }

  .sold-note,
  .short {
    margin: 0;
    font-size: 12.5px;
    color: var(--fg-dim);
  }

  .small {
    margin: 6px 0 0;
    font-size: 12px;
  }

  .tools {
    align-items: flex-start;
    gap: 16px 28px;
  }

  .tool {
    flex: 1 1 240px;
    min-width: 0;
  }

  .deck,
  .sell {
    list-style: none;
    margin: 12px 0 0;
    padding: 0;
    display: grid;
    gap: 4px;
  }

  .deck-row,
  .sell-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 10px;
    padding: 4px 8px;
    border: 2px solid #000;
    background: var(--row);
  }

  .deck-name,
  .sell-name {
    flex: 1 1 120px;
    min-width: 0;
    font-size: 13px;
  }

  .mini {
    flex: none;
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
  }

  .deck-row .error,
  .sell-row .error {
    flex-basis: 100%;
  }

  .next {
    margin-top: 8px;
  }
</style>
