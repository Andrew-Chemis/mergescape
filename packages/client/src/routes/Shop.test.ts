/**
 * The Shop screen from fixtures: the Balatro layout, the purchase flow (success and a 409 shown beside
 * its control), pack opening (keep exactly one), the shrine, selling, the free Raid pack and the
 * Legendary offer. Nothing here touches the network.
 */
import { fireEvent, screen, waitFor, within } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../lib/api';
import type { Api } from '../lib/api';
import { createFixtureApi } from '../lib/fixtures/api';
import { fixtureCharm, fixtureShop } from '../lib/fixtures/state';
import { forbidNetwork, NOW, renderApp } from '../test/helpers';

forbidNetwork();

const shop = (options: Parameters<typeof renderApp>[0] = {}) =>
  renderApp({ hash: '#/shop', ...options });

const region = (name: string | RegExp) => screen.getByRole('region', { name });
const card = (name: string | RegExp) => screen.getByRole('article', { name });
const click = (name: string | RegExp, within_?: HTMLElement) =>
  fireEvent.click(
    (within_ ? within(within_) : screen).getByRole('button', { name }) as HTMLElement,
  );

describe('Shop layout', () => {
  it('draws the Balatro shop: Charms, Packs, a Voucher, re-roll, shrine, sell strip, gold and interest', async () => {
    await shop();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Shop');
    expect(document.title).toBe('Shop · Mergescape');

    // Gold and the interest the next act clear would pay.
    expect(screen.getByText(/^\s*2,340 g/).textContent).toContain('+10 interest next clear');
    expect(screen.getByText(/Interest pays 1 per 25, cap 10/)).toBeTruthy();

    // Two Charms with rarity, price, Power and rules text.
    const charms = region('Charms');
    const grey = within(charms).getByRole('article', { name: 'Grey Beard' });
    expect(grey.textContent).toContain('Rare');
    expect(grey.textContent).toContain('120 g');
    expect(grey.textContent).toContain('+1');
    expect(grey.textContent).toContain('+1.0 Power on any PR in a repository');
    expect(grey.className).toContain('rare');
    const lantern = within(charms).getByRole('article', { name: 'Lantern' });
    expect(lantern.textContent).toContain('Common');
    expect(lantern.textContent).toContain('40 g');
    expect(lantern.textContent).toContain('+0.5');
    expect(within(charms).getAllByRole('article')).toHaveLength(2);

    // Two packs: the Pledge pack was bought (it is open above), the Charm pack is for sale.
    const packs = region('Packs');
    expect(within(packs).getAllByRole('article')).toHaveLength(2);
    expect(within(packs).getByText('Pledge pack · 60 g')).toBeTruthy();
    expect(within(packs).getByText('Bought. It is open above.')).toBeTruthy();
    expect(within(packs).getByText('Charm pack · 100 g')).toBeTruthy();
    expect(within(packs).getByRole('button', { name: 'Buy · 100 g' })).toBeTruthy();

    // One Voucher, priced 150 plus 50 for the one already owned.
    const voucher = region(/Voucher/);
    expect(within(voucher).getByRole('article', { name: 'Charm Belt' }).textContent).toContain(
      'A sixth Charm slot.',
    );
    expect(within(voucher).getByText('Voucher · 200 g')).toBeTruthy();

    // Re-roll, shrine and the sell strip.
    expect(screen.getByRole('button', { name: 'Re-roll · 20 g' })).toBeTruthy();
    expect(
      screen
        .getByRole('button', { name: 'Shrine: remove a Pledge · 50 g' })
        .getAttribute('aria-expanded'),
    ).toBe('false');
    const held = region('Your Charms · 3 of 5 slots');
    const rows = within(held).getAllByRole('listitem');
    expect(rows.map((row) => row.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
      'Rubber Duck Sell · 20 g',
      'Small Hands Sell · 35 g',
      'Hot Potato Sell · 60 g',
    ]);
  });

  it('shows the opened Pledge pack as three cards to keep one of', async () => {
    await shop();
    const open = region('Pledge pack opened');
    expect(within(open).getAllByRole('article')).toHaveLength(3);
    expect(within(open).getAllByRole('button', { name: /^Keep / })).toHaveLength(3);
    expect(open.textContent).toContain('Keep exactly one');
  });

  it('says so when the shop is closed, and links to the Run Map', async () => {
    await shop({ variant: 'monday' });
    const closed = region('The shop is closed');
    expect(closed.textContent).toContain('Your next act is Scout, 1,422,000 XP away.');
    expect(within(closed).getByRole('link', { name: 'See the Run Map' }).getAttribute('href')).toBe(
      '#/map',
    );
    expect(screen.queryByRole('button', { name: /^Buy/ })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Charms' })).toBeNull();
  });

  it('says Deep Pockets raises the interest cap', async () => {
    const base = createFixtureApi({ now: NOW });
    const api: Api = {
      ...base,
      async me() {
        return { ...(await base.me()), vouchers: ['deep-pockets'] };
      },
    };
    await shop({ api });
    expect(screen.getByText(/cap 20/)).toBeTruthy();
  });

  it('tells a player with every Voucher that none is left', async () => {
    const base = createFixtureApi({
      now: NOW,
      week: { shop: { ...fixtureShop(), voucher: null } },
    });
    await shop({ api: base });
    expect(screen.getByText('No Vouchers left. You own all six.')).toBeTruthy();
  });
});

describe('Shop purchase flow', () => {
  it('buys a Charm: gold goes down, the shelf says Sold, the strip gains it, no refetch of the page', async () => {
    await shop();
    await click('Buy · 40 g', card('Lantern'));
    await waitFor(() => expect(screen.getByText(/^\s*2,300 g/)).toBeTruthy());
    expect(screen.getByText('Lantern is yours.')).toBeTruthy();
    const lantern = card('Lantern');
    expect(within(lantern).getByText('Sold')).toBeTruthy();
    expect(within(lantern).queryByRole('button')).toBeNull();
    expect(lantern.className).toContain('sold');
    expect(region('Your Charms · 4 of 5 slots').textContent).toContain('Lantern');
  });

  it('shows how many gold short an item is', async () => {
    const base = createFixtureApi({ now: NOW });
    const api: Api = {
      ...base,
      async me() {
        return { ...(await base.me()), gold: 100 };
      },
    };
    await shop({ api });
    expect(within(card('Grey Beard')).getByText('20 gold short')).toBeTruthy();
    expect(within(card('Lantern')).queryByText(/gold short/)).toBeNull();
  });

  it('shows a 409 beside its control, as an alert, and nothing else changes', async () => {
    const base = createFixtureApi({ now: NOW });
    const api: Api = {
      ...base,
      async shopBuy() {
        throw new ApiError(409, 'no', 'insufficient_gold');
      },
    };
    await shop({ api });
    await click('Buy · 120 g', card('Grey Beard'));
    const alert = await within(card('Grey Beard')).findByRole('alert');
    expect(alert.textContent).toBe('Not enough gold.');
    // Only that control carries it, and the gold, the shelf and the strip are as they were.
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(within(card('Lantern')).queryByRole('alert')).toBeNull();
    expect(screen.getByText(/^\s*2,340 g/)).toBeTruthy();
    expect(within(card('Grey Beard')).getByRole('button', { name: 'Buy · 120 g' })).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows sold_out and shop_closed in words, and clears the message on the next action', async () => {
    const base = createFixtureApi({ now: NOW });
    const refusals = ['sold_out', 'shop_closed'];
    const api: Api = {
      ...base,
      async shopBuy(input, options) {
        const code = refusals.shift();
        if (code) {
          throw new ApiError(409, 'no', code);
        }
        return base.shopBuy(input, options);
      },
    };
    await shop({ api });
    await click('Buy · 40 g', card('Lantern'));
    expect((await within(card('Lantern')).findByRole('alert')).textContent).toBe(
      'That one is already sold.',
    );
    await click('Buy · 40 g', card('Lantern'));
    await waitFor(() =>
      expect(within(card('Lantern')).getByRole('alert').textContent).toBe(
        'The shop is closed. It opens when you clear an act.',
      ),
    );
    await click('Buy · 40 g', card('Lantern'));
    await waitFor(() => expect(within(card('Lantern')).getByText('Sold')).toBeTruthy());
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('answers a network failure in words', async () => {
    const base = createFixtureApi({ now: NOW });
    const api: Api = {
      ...base,
      async shopReroll() {
        throw new ApiError(0, 'Could not reach the server.', null, 'req-1');
      },
    };
    await shop({ api });
    await click('Re-roll · 20 g');
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Could not reach the server. Try again.',
    );
  });

  it('buys the Charm pack and opens it: three Charms to keep one of', async () => {
    await shop();
    await click('Buy · 100 g', region('Packs'));
    const open = await screen.findByRole('region', { name: 'Charm pack opened' });
    expect(within(open).getAllByRole('article')).toHaveLength(3);
    expect(screen.getByText(/^\s*2,240 g/)).toBeTruthy();
    expect(screen.getByText('Charm pack bought. Open it below and keep one card.')).toBeTruthy();
    // The shelf now says it is open, and its Buy button is gone.
    expect(within(region('Packs')).queryByRole('button', { name: 'Buy · 100 g' })).toBeNull();
  });

  it('keeps exactly one card of an opened pack and closes the pack', async () => {
    await shop();
    const open = region('Pledge pack opened');
    const first = within(open).getAllByRole('article')[0] as HTMLElement;
    const name = within(first).getByRole('heading', { level: 3 }).textContent ?? '';
    await click(/^Keep /, first);
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Pledge pack opened' })).toBeNull(),
    );
    expect(screen.getByText(`${name} joins your deck.`)).toBeTruthy();
    expect(within(region('Packs')).getByText('Opened and kept')).toBeTruthy();
  });

  it('shows a refused keep beside the cards and lets the player try again after making room', async () => {
    const base = createFixtureApi({ now: NOW });
    let refuse = true;
    const api: Api = {
      ...base,
      async shopPick(input, options) {
        if (refuse) {
          refuse = false;
          throw new ApiError(409, 'no', 'deck_full');
        }
        return base.shopPick(input, options);
      },
    };
    await shop({ api });
    const open = region('Pledge pack opened');
    await click(/^Keep /, within(open).getAllByRole('article')[1] as HTMLElement);
    expect((await within(open).findByRole('alert')).textContent).toBe(
      'Your Pledge deck is full at 20. Remove a Pledge at the shrine first.',
    );
    await click(/^Keep /, within(open).getAllByRole('article')[1] as HTMLElement);
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Pledge pack opened' })).toBeNull(),
    );
  });

  it('re-rolls: the cost rises by 10 each time', async () => {
    await shop();
    await click('Re-roll · 20 g');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Re-roll · 30 g' })).toBeTruthy(),
    );
    expect(screen.getByText(/^\s*2,320 g/)).toBeTruthy();
    expect(screen.getByText('The shelves are new.')).toBeTruthy();
    // The opened Pledge pack survived the re-roll.
    expect(screen.getByRole('region', { name: 'Pledge pack opened' })).toBeTruthy();
  });

  it('sells a held Charm for its sell price', async () => {
    await shop();
    await click('Sell · 60 g');
    await waitFor(() => expect(screen.getByText(/^\s*2,400 g/)).toBeTruthy());
    expect(screen.getByText('Sold Hot Potato for 60 gold.')).toBeTruthy();
    expect(region('Your Charms · 2 of 5 slots').textContent).not.toContain('Hot Potato');
  });

  it('buys the Voucher: Charm Belt gives a sixth slot', async () => {
    await shop();
    await click('Buy · 200 g', region(/Voucher/));
    await waitFor(() => expect(screen.getByText('Charm Belt is yours for good.')).toBeTruthy());
    expect(region('Your Charms · 3 of 6 slots')).toBeTruthy();
    expect(within(card('Charm Belt')).getByText('Sold')).toBeTruthy();
  });

  it('opens the shrine, lists the deck and removes a Pledge', async () => {
    await shop();
    const toggle = screen.getByRole('button', { name: 'Shrine: remove a Pledge · 50 g' });
    await fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const deck = screen.getByRole('list', { name: 'Your Pledge deck' });
    expect(within(deck).getAllByRole('listitem')).toHaveLength(5);
    await fireEvent.click(
      within(deck).getAllByRole('button', { name: 'Remove' })[3] as HTMLElement,
    );
    await waitFor(() => expect(screen.getByText('Mentor left your deck.')).toBeTruthy());
    expect(screen.getByText(/^\s*2,290 g/)).toBeTruthy();
    expect(
      within(screen.getByRole('list', { name: 'Your Pledge deck' })).getAllByRole('listitem'),
    ).toHaveLength(4);
  });
});

describe('Shop: the free Raid pack and the Legendary offer', () => {
  it('shows the three cards of the free Pledge pack and keeps one with index -1', async () => {
    const base = createFixtureApi({ now: NOW, week: { freePack: 'pledge' } });
    const shopPick = vi.fn(base.shopPick);
    await shop({ api: { ...base, shopPick } });
    const free = region('Free Pledge pack');
    const cards = within(free).getAllByRole('article');
    expect(cards.map((c) => within(c).getByRole('heading', { level: 3 }).textContent)).toEqual([
      'Well Reviewed',
      'Defend',
      'Mentor',
    ]);
    expect(free.textContent).toContain('Keep exactly one');
    await click('Keep Mentor', free);
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Free Pledge pack' })).toBeNull(),
    );
    expect(shopPick).toHaveBeenCalledTimes(1);
    expect((shopPick.mock.calls[0] as unknown as [{ index: number; option: number }])[0]).toEqual({
      index: -1,
      option: 2,
    });
    expect(screen.getByText('Mentor joins your deck.')).toBeTruthy();
  });

  it('falls back to face-down cards if a free pack ever arrives without its options', async () => {
    await shop({ week: { freePack: 'pledge', freePackOptions: null } });
    const free = region('Free Pledge pack');
    expect(within(free).getAllByRole('button', { name: /^Take card/ })).toHaveLength(3);
    expect(free.textContent).toContain('face down');
  });

  it('shows a refused free-pack pick beside the cards', async () => {
    const base = createFixtureApi({ now: NOW, week: { freePack: 'pledge' } });
    const api: Api = {
      ...base,
      async shopPick() {
        throw new ApiError(409, 'no', 'no_free_pack');
      },
    };
    await shop({ api });
    const free = region('Free Pledge pack');
    await click('Keep Mentor', free);
    expect((await within(free).findByRole('alert')).textContent).toBe(
      'There is no free pack waiting for you.',
    );
  });

  it('shows a Legendary offer and takes it', async () => {
    await shop({ week: { legendaryOffer: fixtureCharm('oracle') } });
    const offer = region('A Legendary Charm is on offer');
    expect(within(offer).getByRole('article', { name: 'Oracle' }).className).toContain('legendary');
    expect(offer.textContent).toContain('free');
    expect(offer.textContent).toContain('open Charm slot');
    await click('Take Oracle', offer);
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'A Legendary Charm is on offer' })).toBeNull(),
    );
    expect(screen.getByText('Oracle is yours.')).toBeTruthy();
    expect(region('Your Charms · 4 of 5 slots').textContent).toContain('Oracle');
  });

  it('shows no such panels when there is nothing to take', async () => {
    await shop();
    expect(screen.queryByRole('region', { name: 'Free Pledge pack' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'A Legendary Charm is on offer' })).toBeNull();
  });
});

describe('Shop keeps itself current', () => {
  it('reads GET /week when it opens, so a shop that just opened shows without waiting for a poll', async () => {
    const closed = createFixtureApi({ now: NOW, variant: 'monday' });
    const open = createFixtureApi({ now: NOW });
    let reads = 0;
    const api: Api = {
      ...closed,
      async getWeek() {
        reads += 1;
        return open.getWeek();
      },
    };
    await renderApp({ api, hash: '#/' });
    expect(screen.getByText(/shop opens when you clear your first act/)).toBeTruthy();
    expect(reads).toBe(0);

    window.location.hash = '#/shop';
    await waitFor(() => expect(screen.getByRole('region', { name: 'Charms' })).toBeTruthy());
    expect(reads).toBe(1);
  });

  it('drops a stale shelf after a 409 by re-reading the profile', async () => {
    const base = createFixtureApi({ now: NOW });
    let me = 0;
    const api: Api = {
      ...base,
      async me() {
        me += 1;
        return base.me();
      },
      async shopBuy() {
        throw new ApiError(409, 'no', 'sold_out');
      },
    };
    await shop({ api });
    me = 0;
    await click('Buy · 40 g', card('Lantern'));
    await within(card('Lantern')).findByRole('alert');
    await waitFor(() => expect(me).toBe(1));
  });
});
