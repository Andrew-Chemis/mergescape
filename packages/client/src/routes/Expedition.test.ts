import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/svelte';
import { lootPackOptions, makePiece, reclaimedPiece, rollLoot } from '@mergescape/shared';
import type { LootItem } from '@mergescape/shared';
import { ApiError } from '../lib/api';
import type { Api } from '../lib/api';
import { createFixtureApi } from '../lib/fixtures/api';
import { fixtureCharm, fixtureMe } from '../lib/fixtures/state';
import {
  forbidNetwork,
  mockReducedMotion,
  NOW,
  renderApp,
  restoreMatchMedia,
  textOf,
} from '../test/helpers';

forbidNetwork();

const HOUR = 3_600_000;

/** The fixture api for these tests: the clock is the test's NOW, so every time is exact. */
function fixtureApi(options: Parameters<typeof createFixtureApi>[0] = {}): Api {
  return createFixtureApi({ now: NOW, ...options });
}

describe('Expedition, a trip that has returned (fixture)', () => {
  it('shows the returned expedition with a Collect button, and the satchel', async () => {
    await renderApp({ hash: '#/expedition' });
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Expedition');
    expect(screen.getByRole('heading', { name: 'Back from Silverhall' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Collect' })).toBeTruthy();
    const satchel = screen.getByRole('list', { name: 'Satchel' });
    expect(textOf(satchel)).toContain('Provisions 4');
    expect(textOf(satchel)).toContain('Silver 5');
    // Nothing is away, so there is no timer, and the character cannot go out until it has collected.
    expect(screen.queryByRole('timer')).toBeNull();
    expect((screen.getByRole('button', { name: /^Send to / }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(screen.getByText(/Collect the haul first/)).toBeTruthy();
  });

  it('draws the region map: every region with its Renown gate, locked ones disabled', async () => {
    await renderApp({ hash: '#/expedition' });
    const group = screen.getByRole('group', { name: 'Region' });
    const radios = within(group).getAllByRole('radio') as HTMLInputElement[];
    expect(radios).toHaveLength(8);
    expect(radios.map((radio) => radio.disabled)).toEqual([
      false,
      false,
      false,
      false,
      true,
      true,
      true,
      true,
    ]);
    expect(within(group).getByText('Open · Renown 8')).toBeTruthy();
    expect(within(group).getByText('Locked · needs Renown 24, you have 17')).toBeTruthy();
    expect(within(group).getByText('Locked · needs Renown 64, you have 17')).toBeTruthy();
    expect(within(group).getByText('Starter forest, friendly')).toBeTruthy();
  });

  it('keeps the loot lean unknown until the Index is owned, then shows it', async () => {
    await renderApp({ hash: '#/expedition' });
    expect(screen.getAllByText('Leans: unknown')).toHaveLength(8);
    expect(screen.getByText(/The Index, a Scriptorium upgrade/)).toBeTruthy();
    document.body.innerHTML = '';
    await renderApp({
      hash: '#/expedition',
      me: { forge: { upgrades: ['index'], stations: {} } },
    });
    expect(screen.getByText('Leans: Timber, Provisions, Leather gear')).toBeTruthy();
    expect(screen.getByText('Leans: Ore, Iron gear')).toBeTruthy();
    expect(screen.queryByText(/The Index, a Scriptorium upgrade/)).toBeNull();
  });

  it('draws the duration picker with Provisions cost and affordability', async () => {
    await renderApp({ hash: '#/expedition' });
    const group = screen.getByRole('group', { name: 'Length' });
    const radios = within(group).getAllByRole('radio') as HTMLInputElement[];
    expect(radios.map((radio) => radio.disabled)).toEqual([false, false, false, false, true]);
    expect(textOf(group)).toContain('Forage · 4 h free');
    expect(textOf(group)).toContain('4 h 1 Provision');
    expect(textOf(group)).toContain('12 h 2 Provisions');
    expect(textOf(group)).toContain('24 h 4 Provisions');
    expect(textOf(group)).toContain('48 h 6 Provisions');
    expect(within(group).getByText('Need 6 Provisions, you have 4')).toBeTruthy();
    expect(screen.getByText(/checking in daily is the best deal/)).toBeTruthy();
  });

  it('says how long a trip takes with Quick gear, and nothing when gear changes nothing', async () => {
    await renderApp({ hash: '#/expedition' });
    expect(screen.queryByText(/with your gear/)).toBeNull();
    document.body.innerHTML = '';
    const base = fixtureMe(NOW).gear;
    const quick = makePiece({ id: 'q', slot: 'weapon', tier: 'iron', affix: 'quick' });
    await renderApp({
      hash: '#/expedition',
      me: { gear: { ...base, equipped: { ...base.equipped, weapon: quick } } },
    });
    const group = screen.getByRole('group', { name: 'Length' });
    expect(within(group).getAllByText('Takes 3 h 36 min with your gear')).toHaveLength(2);
    expect(within(group).getByText('Takes 10 h 48 min with your gear')).toBeTruthy();
    expect(within(group).getByText('Takes 21 h 36 min with your gear')).toBeTruthy();
    expect(within(group).getByText('Takes 43 h 12 min with your gear')).toBeTruthy();
  });

  it('lists the last haul face up once collected', async () => {
    const { session } = await renderApp({ hash: '#/expedition' });
    await fireEvent.click(screen.getByRole('button', { name: 'Collect' }));
    await waitFor(() => expect(session.me?.expedition?.collected).toBe(true));
    expect(screen.getByRole('heading', { name: 'The haul' })).toBeTruthy();
  });
});

describe('Expedition, collecting (the loot reveal)', () => {
  it('collects: the cards flip, the unique carries its caption, and the satchel and packs update', async () => {
    mockReducedMotion(false);
    const { session } = await renderApp({ hash: '#/expedition' });
    const before = session.me!;
    await fireEvent.click(screen.getByRole('button', { name: 'Collect' }));
    const haul = await screen.findByRole('heading', { name: 'The haul' });
    const section = haul.closest('section') as HTMLElement;

    // Five items, as the stored seed rolled them.
    const expected = rollLoot(before.expedition!);
    const cards = within(section).getAllByRole('article');
    expect(cards).toHaveLength(5);
    const names = cards.map((card) => card.querySelector('.name')?.textContent);
    expect(names).toContain("Hallkeeper's Mail");
    expect(names).toContain('Silver Armour');
    expect(names).toContain('Charm pack');
    expect(expected).toHaveLength(5);

    // The unique gets its one line of story, and the legendary border.
    const unique = cards.find((card) =>
      card.textContent?.includes("Hallkeeper's Mail"),
    ) as HTMLElement;
    expect(unique.className).toContain('legendary');
    expect(unique.textContent).toContain('Worn by whoever was left in charge of Silverhall.');
    expect(unique.getAttribute('aria-label')).toBe(
      "Unique: Hallkeeper's Mail. Worn by whoever was left in charge of Silverhall.",
    );

    // The reveal is playing (cards flip left to right) and can be skipped.
    const reveal = section.querySelector('.reveal') as HTMLElement;
    expect(reveal.getAttribute('data-motion')).toBe('flip');
    expect(section.querySelectorAll('.back')).toHaveLength(5);
    await fireEvent.click(within(section).getByRole('button', { name: 'Skip' }));
    expect(reveal.getAttribute('data-motion')).toBe('still');
    expect(within(section).queryByRole('button', { name: 'Skip' })).toBeNull();

    // What it brought is in the satchel, the inventory and the packs; the Feat is announced.
    expect(session.me!.satchel.ore).toBe(before.satchel.ore + 4);
    expect(session.me!.charmPacks).toHaveLength(3);
    expect(session.me!.inventory.length).toBe(before.inventory.length + 2);
    expect(within(section).getByText(/Feat unlocked/)).toBeTruthy();
    // The trip is no longer waiting, and the character can go out again.
    expect(screen.queryByRole('button', { name: 'Collect' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'In Town' })).toBeTruthy();
  });

  it('flips to a plain fade under prefers-reduced-motion, with no skip button and no glint', async () => {
    mockReducedMotion(true);
    await renderApp({ hash: '#/expedition' });
    await fireEvent.click(screen.getByRole('button', { name: 'Collect' }));
    const haul = await screen.findByRole('heading', { name: 'The haul' });
    const reveal = haul.closest('section')!.querySelector('.reveal') as HTMLElement;
    expect(reveal.getAttribute('data-motion')).toBe('fade');
    expect(
      within(haul.closest('section') as HTMLElement).queryByRole('button', { name: 'Skip' }),
    ).toBeNull();
    // Every card is already in the page for a screen reader, whatever the animation does.
    expect(within(reveal).getAllByRole('article')).toHaveLength(5);
    restoreMatchMedia();
  });

  it('answers a replay with the same loot, face up, saying nothing was granted twice', async () => {
    const base = fixtureApi();
    // The player's second tab already collected: this click is the replay.
    const api: Api = {
      ...base,
      async expeditionCollect(options) {
        await base.expeditionCollect(options);
        return base.expeditionCollect(options);
      },
    };
    const { session } = await renderApp({ hash: '#/expedition', api });
    const before = session.me!.satchel;
    await fireEvent.click(screen.getByRole('button', { name: 'Collect' }));
    const heading = await screen.findByRole('heading', { name: 'Already collected' });
    const section = heading.closest('section') as HTMLElement;
    expect(textOf(section)).toContain('nothing was granted twice');
    expect(within(section).getAllByRole('article')).toHaveLength(5);
    expect(section.querySelector('.reveal')?.getAttribute('data-motion')).toBe('still');
    // Collected once, not twice: ore went up by the 4 the haul held, not 8.
    expect(session.me!.satchel.ore).toBe(before.ore + 4);
    expect(within(section).queryByText(/Feat unlocked/)).toBeNull();
  });

  it('reveals a Reclaimed unique with its invented former owner, and a pet, a coin and a pack', async () => {
    const loot: LootItem[] = [
      { kind: 'unique', piece: reclaimedPiece('r', 'weapon', 'Ambrel of the Low Road') },
      { kind: 'pet', petId: 'owl' },
      { kind: 'coin', year: 7960 },
      { kind: 'charm_pack', seed: 9 },
      { kind: 'material', material: 'dragon', quantity: 3 },
      { kind: 'gear', piece: makePiece({ id: 'g', slot: 'cape', tier: 'rune', affix: 'quick' }) },
    ];
    const base = fixtureApi();
    const api: Api = {
      ...base,
      async expeditionCollect(options) {
        const answer = await base.expeditionCollect(options);
        return { ...answer, loot };
      },
    };
    await renderApp({ hash: '#/expedition', api });
    await fireEvent.click(screen.getByRole('button', { name: 'Collect' }));
    const section = (await screen.findByRole('heading', { name: 'The haul' })).closest(
      'section',
    ) as HTMLElement;
    expect(textOf(section)).toContain('Former owner: Ambrel of the Low Road');
    expect(textOf(section)).toContain('Owl');
    expect(textOf(section)).toContain('Coin dated 7960');
    expect(textOf(section)).toContain('3 Dragon scale');
    expect(textOf(section)).toContain('Quick: Expeditions 10% shorter');
    // Reclaimed and the coin are legendary; the pack, the pet and the affixed cape are rare.
    const rarities = within(section)
      .getAllByRole('article')
      .map((card) =>
        ['legendary', 'rare', 'uncommon', 'common'].find((rarity) =>
          card.classList.contains(rarity),
        ),
      );
    expect(rarities).toEqual(['legendary', 'rare', 'legendary', 'rare', 'common', 'rare']);
  });

  it('shows a refused collect beside the button, in words', async () => {
    const base = fixtureApi();
    const api: Api = {
      ...base,
      async expeditionCollect() {
        throw new ApiError(409, 'no', 'not_returned');
      },
    };
    await renderApp({ hash: '#/expedition', api });
    await fireEvent.click(screen.getByRole('button', { name: 'Collect' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Your character is not back yet.');
  });
});

describe('Expedition, an expedition away', () => {
  it('counts down in the timer, with the region and the length', async () => {
    await renderApp({ hash: '#/expedition', variant: 'day0' });
    expect(screen.getByRole('heading', { name: 'Away at Koko Woods' })).toBeTruthy();
    // Sent 6 minutes ago for 4 hours.
    const timer = screen.getByRole('timer');
    expect(timer.textContent?.trim()).toBe('3:54:00');
    expect(timer.getAttribute('aria-label')).toBe('Time until your character is back');
    expect(screen.getByText(/A Forage, sent 6 min ago/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Collect' })).toBeNull();
    expect(screen.getByText(/Your character is away/)).toBeTruthy();
    expect((screen.getByRole('button', { name: /^Send to / }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('ticks once a second', async () => {
    const { session } = await renderApp({ hash: '#/expedition', variant: 'day0' });
    expect(session.status).toBe('ready');
    const timer = screen.getByRole('timer');
    expect(timer.textContent?.trim()).toBe('3:54:00');
    // Date is faked by the harness: move it forward and let the real one-second interval notice.
    vi.setSystemTime(NOW + 5_000);
    await waitFor(() => expect(timer.textContent?.trim()).toBe('3:53:55'), { timeout: 3000 });
  });

  it('turns into "back" when the clock passes the return', async () => {
    await renderApp({ hash: '#/expedition', variant: 'day0' });
    expect(screen.queryByRole('button', { name: 'Collect' })).toBeNull();
    vi.setSystemTime(NOW + 4 * HOUR);
    expect(await screen.findByRole('button', { name: 'Collect' }, { timeout: 3000 })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Back from Koko Woods' })).toBeTruthy();
  });
});

describe('Expedition, the clock', () => {
  const oneSecondClocks = (spy: { mock: { calls: unknown[][] } }): number =>
    spy.mock.calls.filter(([, delay]) => delay === 1000).length;
  /** The timer the screen's one-second clock got (other code, such as `waitFor`, also uses intervals). */
  const clockTimer = (spy: { mock: { calls: unknown[][]; results: { value: unknown }[] } }) =>
    spy.mock.results[spy.mock.calls.findIndex(([, delay]) => delay === 1000)]?.value;

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('ticks while the character is away and stops once the trip is back', async () => {
    const started = vi.spyOn(globalThis, 'setInterval');
    const stopped = vi.spyOn(globalThis, 'clearInterval');
    await renderApp({ hash: '#/expedition', variant: 'day0' });
    expect(oneSecondClocks(started)).toBe(1);
    const timer = clockTimer(started);
    expect(timer).toBeDefined();
    expect(stopped).not.toHaveBeenCalledWith(timer);
    // Its own ticks do not restart it.
    vi.setSystemTime(NOW + 5_000);
    await waitFor(() => expect(screen.getByRole('timer').textContent?.trim()).toBe('3:53:55'), {
      timeout: 3000,
    });
    expect(oneSecondClocks(started)).toBe(1);
    expect(stopped).not.toHaveBeenCalledWith(timer);
    vi.setSystemTime(NOW + 4 * HOUR);
    await screen.findByRole('button', { name: 'Collect' }, { timeout: 3000 });
    expect(stopped).toHaveBeenCalledWith(timer);
  });

  it('does not tick when the character is not away', async () => {
    const started = vi.spyOn(globalThis, 'setInterval');
    await renderApp({ hash: '#/expedition' });
    expect(oneSecondClocks(started)).toBe(0);
  });
});

describe('Expedition, sending the character out', () => {
  it('sends a 12 h trip once the last haul is collected: the Provisions are paid and the timer starts', async () => {
    const { session } = await renderApp({ hash: '#/expedition' });
    await fireEvent.click(screen.getByRole('button', { name: 'Collect' }));
    await screen.findByRole('heading', { name: 'In Town' });
    await fireEvent.click(screen.getByRole('radio', { name: /Orrl Falls/ }));
    await fireEvent.click(screen.getByRole('radio', { name: /12 h/ }));
    const send = screen.getByRole('button', {
      name: 'Send to Orrl Falls · 12 h',
    }) as HTMLButtonElement;
    expect(send.disabled).toBe(false);
    await fireEvent.click(send);
    await screen.findByRole('heading', { name: 'Away at Orrl Falls' });
    expect(session.me!.satchel.provisions).toBe(2);
    expect(screen.getByRole('timer').textContent?.trim()).toBe('12:00:00');
    expect(screen.getByText('Sent to Orrl Falls. Back in 12 h.')).toBeTruthy();
    expect(textOf(screen.getByRole('list', { name: 'Satchel' }))).toContain('Provisions 2');
  });

  it('sends the free Forage by default', async () => {
    const { session } = await renderApp({ hash: '#/expedition', variant: 'noevents' });
    // A brand-new character has no Provisions: only the Forage is on offer.
    const group = screen.getByRole('group', { name: 'Length' });
    const radios = within(group).getAllByRole('radio') as HTMLInputElement[];
    expect(radios.map((radio) => radio.disabled)).toEqual([false, true, true, true, true]);
    await fireEvent.click(
      screen.getByRole('button', { name: 'Send to Koko Woods · Forage · 4 h' }),
    );
    await screen.findByRole('heading', { name: 'Away at Koko Woods' });
    expect(session.me!.expedition).toMatchObject({ forage: true, hours: 4, collected: false });
  });

  it('shows a refused send beside the button, in words', async () => {
    const base = fixtureApi({ variant: 'noevents' });
    const api: Api = {
      ...base,
      async expeditionSend() {
        throw new ApiError(409, 'no', 'insufficient_provisions');
      },
    };
    await renderApp({ hash: '#/expedition', variant: 'noevents', api });
    await fireEvent.click(screen.getByRole('button', { name: /^Send to Koko Woods/ }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Not enough Provisions. The 4 h Forage is always free.',
    );
  });

  it('offers only the regions and trips it can take: the rest are disabled radios', async () => {
    await renderApp({ hash: '#/expedition' });
    await fireEvent.click(screen.getByRole('button', { name: 'Collect' }));
    await screen.findByRole('heading', { name: 'In Town' });
    expect((screen.getByRole('radio', { name: /Quu Spire/ }) as HTMLInputElement).disabled).toBe(
      true,
    );
    expect((screen.getByRole('radio', { name: /48 h/ }) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole('radio', { name: /Silverhall/ }) as HTMLInputElement).disabled).toBe(
      false,
    );
    expect((screen.getByRole('radio', { name: /24 h/ }) as HTMLInputElement).disabled).toBe(false);
    // The default is Koko Woods and the free Forage, which can always go.
    expect(screen.getByRole('button', { name: 'Send to Koko Woods · Forage · 4 h' })).toBeTruthy();
  });

  it('says a character with no trip yet is in Town', async () => {
    await renderApp({ hash: '#/expedition', variant: 'noevents' });
    expect(screen.getByRole('heading', { name: 'In Town' })).toBeTruthy();
    expect(screen.getByText(/Your character is in Town/)).toBeTruthy();
  });
});

describe('Expedition, Charm packs', () => {
  it('lists the unopened packs and opens one: three Charms, keep one', async () => {
    const { session } = await renderApp({ hash: '#/expedition' });
    expect(screen.getByRole('heading', { name: 'Charm packs · 2 unopened' })).toBeTruthy();
    const options = lootPackOptions(4101);
    await fireEvent.click(screen.getAllByRole('button', { name: 'Open' })[0] as HTMLElement);
    const panel = (await screen.findByRole('heading', { name: 'Charm pack opened' })).closest(
      'section',
    ) as HTMLElement;
    const keeps = within(panel).getAllByRole('button', { name: /^Keep / });
    expect(keeps).toHaveLength(3);
    for (const charm of options) {
      expect(within(panel).getByRole('button', { name: `Keep ${charm.name}` })).toBeTruthy();
    }
    expect(textOf(panel)).toContain('Keep exactly one.');
    await fireEvent.click(keeps[1] as HTMLElement);
    await screen.findByText(`${options[1]!.name} is yours.`);
    expect(session.me!.charms.map((charm) => charm.id)).toContain(options[1]!.id);
    expect(session.me!.charmPacks).toEqual([4102]);
    expect(screen.queryByRole('heading', { name: 'Charm pack opened' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Charm packs · 1 unopened' })).toBeTruthy();
  });

  it('says so beside the cards when the Charm bar is full, and keeps the pack', async () => {
    const bar = ['rubber-duck', 'small-hands', 'hot-potato', 'lantern', 'grey-beard'].map(
      fixtureCharm,
    );
    const { session } = await renderApp({ hash: '#/expedition', me: { charms: bar } });
    await fireEvent.click(screen.getAllByRole('button', { name: 'Open' })[0] as HTMLElement);
    const panel = (await screen.findByRole('heading', { name: 'Charm pack opened' })).closest(
      'section',
    ) as HTMLElement;
    const fresh = lootPackOptions(4101).find((charm) => !bar.some((held) => held.id === charm.id))!;
    await fireEvent.click(within(panel).getByRole('button', { name: `Keep ${fresh.name}` }));
    expect((await within(panel).findByRole('alert')).textContent).toBe(
      'Your Charm slots are full. Sell a Charm first.',
    );
    expect(session.me!.charmPacks).toEqual([4101, 4102]);
  });

  it('shows a pack that has gone beside its button', async () => {
    const base = fixtureApi();
    const api: Api = {
      ...base,
      async packOptions() {
        throw new ApiError(409, 'no', 'no_such_pack');
      },
    };
    await renderApp({ hash: '#/expedition', api });
    await fireEvent.click(screen.getAllByRole('button', { name: 'Open' })[1] as HTMLElement);
    expect((await screen.findByRole('alert')).textContent).toBe(
      'That Charm pack is no longer in your satchel.',
    );
  });

  it('shows no pack list when there are none', async () => {
    await renderApp({ hash: '#/expedition', variant: 'noevents' });
    expect(screen.queryByRole('heading', { name: /Charm packs/ })).toBeNull();
  });
});

describe('Expedition, offline and loading', () => {
  it('draws from the profile before the view has been read, and agrees with it afterwards', async () => {
    const { session } = await renderApp({ hash: '#/expedition' });
    // The view from GET /expedition has landed by now.
    await waitFor(() => expect(session.expedition).not.toBeNull());
    expect(screen.getAllByRole('radio').length).toBe(13);
  });

  it('survives a failed read of the view', async () => {
    const base = fixtureApi();
    const api: Api = {
      ...base,
      async expedition() {
        throw new ApiError(0, 'offline');
      },
    };
    const { session } = await renderApp({ hash: '#/expedition', api });
    expect(session.expedition).toBeNull();
    expect(screen.getByRole('button', { name: 'Collect' })).toBeTruthy();
  });
});
