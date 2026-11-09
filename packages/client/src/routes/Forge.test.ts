import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/svelte';
import { makePiece } from '@mergescape/shared';
import { ApiError } from '../lib/api';
import type { Api } from '../lib/api';
import { createFixtureApi } from '../lib/fixtures/api';
import { fixtureMe } from '../lib/fixtures/state';
import { forbidNetwork, NOW, renderApp, textOf } from '../test/helpers';

forbidNetwork();

/** The fixture api for these tests: the clock is the test's NOW, so every time is exact. */
function fixtureApi(options: Parameters<typeof createFixtureApi>[0] = {}): Api {
  return createFixtureApi({ now: NOW, ...options });
}

const section = (name: string): HTMLElement =>
  screen.getByRole('heading', { name, level: 2 }).closest('section') as HTMLElement;

describe('Forge, the three stations', () => {
  it('shows each station with its job: one working with a timer, one ready, one idle', async () => {
    await renderApp({ hash: '#/forge' });
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Forge');
    const forge = section('Forge');
    expect(textOf(forge)).toContain('Working: Silver Blade');
    // Started 3 h ago on an 8 h order.
    expect(within(forge).getByRole('timer').textContent?.trim()).toBe('5:00:00');
    expect(within(forge).queryByRole('button', { name: /^Collect/ })).toBeNull();

    const loom = section('Loom');
    expect(textOf(loom)).toContain('Ready: Iron Cape');
    expect(within(loom).getByRole('button', { name: 'Collect Iron Cape' })).toBeTruthy();
    expect(within(loom).queryByRole('timer')).toBeNull();

    const scriptorium = section('Scriptorium');
    expect(textOf(scriptorium)).toContain('Idle');
    expect(textOf(forge)).toContain('Weapons and Body armour.');
    expect(textOf(loom)).toContain('Capes.');
  });

  it('groups the recipes by station with their inputs and hours', async () => {
    await renderApp({ hash: '#/forge' });
    const forge = within(section('Forge')).getByRole('list', { name: 'Forge recipes' });
    const loom = within(section('Loom')).getByRole('list', { name: 'Loom recipes' });
    const scriptorium = within(section('Scriptorium')).getByRole('list', {
      name: 'Scriptorium recipes',
    });
    // Two slots at six tiers at the Forge, one at the Loom, one at the Scriptorium.
    expect(within(forge).getAllByRole('listitem')).toHaveLength(12);
    expect(within(loom).getAllByRole('listitem')).toHaveLength(6);
    expect(within(scriptorium).getAllByRole('listitem')).toHaveLength(6);
    expect(textOf(forge)).toContain('Iron Blade 8 Ore 4 h');
    expect(textOf(forge)).toContain('Silver Armour 6 Ore, 3 Silver 8 h');
    expect(textOf(loom)).toContain('Leather Cape 6 Timber, 2 Provisions 2 h');
    expect(textOf(scriptorium)).toContain('Dragon Trinket 6 Dragon scale 12 h');
  });

  it('says why a recipe cannot start: busy, locked by tier, or short of supplies', async () => {
    await renderApp({ hash: '#/forge' });
    const forge = within(section('Forge')).getByRole('list', { name: 'Forge recipes' });
    const row = (name: string) => within(forge).getByText(name).closest('li') as HTMLElement;
    // Iron: affordable, but the Forge is working.
    expect(textOf(row('Iron Blade'))).toContain('The station is busy');
    // Mithril needs level 50, which a level-41 character has not reached.
    expect(textOf(row('Mithril Blade'))).toContain('Needs level 50');
    // Silver is open at Renown 16 (Silverhall), and the Dragon tier names both ways in.
    expect(textOf(row('Silver Blade'))).not.toContain('Needs');
    expect(textOf(row('Dragon Blade'))).toContain('Needs level 90 or Renown 64');
    // Every recipe that could start is disabled while the Forge is busy; tiers not yet open have no button at all.
    const buttons = within(forge).getAllByRole('button', { name: /^Start / });
    expect(buttons).toHaveLength(6);
    for (const button of buttons) {
      expect((button as HTMLButtonElement).disabled).toBe(true);
    }
    expect(within(row('Mithril Blade')).queryByRole('button')).toBeNull();
    // The Scriptorium is idle: Leather is affordable and startable, Iron is short of nothing, Silver is.
    const scriptorium = within(section('Scriptorium')).getByRole('list', {
      name: 'Scriptorium recipes',
    });
    expect(
      (
        within(scriptorium).getByRole('button', {
          name: 'Start Leather Trinket',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
  });

  it('says what a recipe is short of when the satchel cannot pay', async () => {
    await renderApp({
      hash: '#/forge',
      me: { satchel: { ...fixtureMe(NOW).satchel, timber: 2, provisions: 0 } },
    });
    const scriptorium = within(section('Scriptorium')).getByRole('list', {
      name: 'Scriptorium recipes',
    });
    const leather = within(scriptorium).getByText('Leather Trinket').closest('li') as HTMLElement;
    expect(textOf(leather)).toContain('Short: 4 Timber, 2 Provisions');
    expect(
      (within(leather).getByRole('button', { name: 'Start Leather Trinket' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });
});

describe('Forge, starting and collecting orders', () => {
  it('starts an order: the inputs are spent and the station starts its timer', async () => {
    const { session } = await renderApp({ hash: '#/forge' });
    await fireEvent.click(screen.getByRole('button', { name: 'Start Leather Trinket' }));
    await screen.findByText('Leather Trinket is on the Scriptorium.');
    const scriptorium = section('Scriptorium');
    expect(textOf(scriptorium)).toContain('Working: Leather Trinket');
    expect(within(scriptorium).getByRole('timer').textContent?.trim()).toBe('4:00:00');
    expect(session.me!.satchel.timber).toBe(18);
    expect(session.me!.satchel.provisions).toBe(2);
    // The station is busy now, so its other recipes cannot start.
    expect(
      (within(scriptorium).getByRole('button', { name: 'Start Iron Trinket' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it('collects a finished order into the inventory, and names it', async () => {
    const { session } = await renderApp({ hash: '#/forge' });
    const before = session.me!.inventory.length;
    await fireEvent.click(screen.getByRole('button', { name: 'Collect Iron Cape' }));
    await screen.findByText('Iron Cape is in your inventory.');
    expect(session.me!.inventory).toHaveLength(before + 1);
    expect(textOf(section('Loom'))).toContain('Idle');
    const inventory = section(`Inventory · ${before + 1}`);
    expect(within(inventory).getAllByText('Iron Cape').length).toBeGreaterThanOrEqual(1);
  });

  it('says so when a collect was a replay: the order was already collected', async () => {
    const base = fixtureApi();
    const api: Api = {
      ...base,
      async forgeCollect(station, options) {
        await base.forgeCollect(station, options);
        return base.forgeCollect(station, options);
      },
    };
    const { session } = await renderApp({ hash: '#/forge', api });
    const before = session.me!.inventory.length;
    await fireEvent.click(screen.getByRole('button', { name: 'Collect Iron Cape' }));
    await screen.findByText('That order was already collected: Iron Cape.');
    // Granted once, not twice.
    expect(session.me!.inventory).toHaveLength(before + 1);
  });

  it('shows a refused start or collect beside its control, in words', async () => {
    const base = fixtureApi();
    const api: Api = {
      ...base,
      async forgeStart() {
        throw new ApiError(409, 'no', 'station_busy');
      },
      async forgeCollect() {
        throw new ApiError(409, 'no', 'not_ready');
      },
    };
    await renderApp({ hash: '#/forge', api });
    await fireEvent.click(screen.getByRole('button', { name: 'Start Leather Trinket' }));
    const scriptorium = section('Scriptorium');
    expect((await within(scriptorium).findByRole('alert')).textContent).toBe(
      'That station is busy. Collect its order or wait for it to finish.',
    );
    await fireEvent.click(screen.getByRole('button', { name: 'Collect Iron Cape' }));
    expect((await within(section('Loom')).findByRole('alert')).textContent).toBe(
      'That order is not finished yet.',
    );
  });

  it('turns a finished order into "ready" when the clock passes it', async () => {
    const { vi } = await import('vitest');
    await renderApp({ hash: '#/forge' });
    expect(textOf(section('Forge'))).toContain('Working: Silver Blade');
    vi.setSystemTime(NOW + 5 * 3_600_000);
    expect(
      await screen.findByRole('button', { name: 'Collect Silver Blade' }, { timeout: 3000 }),
    ).toBeTruthy();
  });
});

describe('Forge, gear', () => {
  it('shows what is worn per slot with the set bonus, and the inventory', async () => {
    await renderApp({ hash: '#/forge' });
    const worn = section('Wearing · Power +0.75');
    expect(textOf(worn)).toContain('Iron Blade');
    expect(textOf(worn)).toContain('Iron Armour');
    expect(textOf(worn)).toContain('Iron Cape');
    expect(textOf(worn)).toContain('Iron Trinket');
    expect(textOf(worn)).toContain('Goblin Runt');
    expect(textOf(worn)).toContain('Stout');
    expect(textOf(worn)).toContain('A full Iron set: +0.25 Power on top of the pieces.');
    const inventory = section('Inventory · 4');
    expect(textOf(inventory)).toContain('Fernblade');
    expect(textOf(inventory)).toContain('Leather Armour');
    expect(textOf(inventory)).toContain('Silver Cape');
    expect(textOf(inventory)).toContain("Pedlar's Lucky Button");
    expect(textOf(inventory)).toContain('Expeditions 10% shorter');
  });

  it('equips a piece: it takes the slot, the old one goes back, and the set bonus is gone', async () => {
    const { session } = await renderApp({ hash: '#/forge' });
    await fireEvent.click(screen.getByRole('button', { name: 'Equip Silver Cape' }));
    await screen.findByText('Silver Cape is on. It counts from your next event.');
    expect(session.me!.gear.equipped.cape?.name).toBe('Silver Cape');
    expect(session.me!.inventory.map((piece) => piece.name)).toContain('Iron Cape');
    // 0.1 + 0.1 + 0.15 + 0.1 + 0.05 (the pet is Iron: 0.1) = 0.55; no set.
    const worn = section('Wearing · Power +0.55');
    expect(textOf(worn)).toContain('Wear all five slots in one tier for +0.25 Power.');
  });

  it('takes a slot off', async () => {
    const { session } = await renderApp({ hash: '#/forge' });
    await fireEvent.click(screen.getByRole('button', { name: 'Take off Iron Blade' }));
    await screen.findByText('Weapon taken off.');
    expect(session.me!.gear.equipped.weapon).toBeUndefined();
    expect(session.me!.inventory.map((piece) => piece.name)).toContain('Iron Blade');
    const worn = within(section('Wearing · Power +0.4'));
    expect(worn.getByText('Empty')).toBeTruthy();
  });

  it('follows another pet', async () => {
    const { session } = await renderApp({ hash: '#/forge' });
    expect(session.me!.pets).toEqual(['linter-cat', 'rubber-duck', 'goblin-runt']);
    const pets = section('Pets · 3');
    expect(textOf(pets)).toContain('Following you');
    await fireEvent.click(within(pets).getByRole('button', { name: 'Follow Linter Cat' }));
    await screen.findByText('Linter Cat follows you now.');
    expect(session.me!.gear.equipped.pet?.ref).toBe('linter-cat');
    expect(textOf(pets)).toContain('+1 Ink each week.');
  });

  it('shows a refused equip beside the piece', async () => {
    const base = fixtureApi();
    const api: Api = {
      ...base,
      async gearEquip() {
        throw new ApiError(409, 'no', 'tier_locked');
      },
    };
    await renderApp({ hash: '#/forge', api });
    await fireEvent.click(screen.getByRole('button', { name: 'Equip Silver Cape' }));
    const cell = screen
      .getByRole('button', { name: 'Equip Silver Cape' })
      .closest('li') as HTMLElement;
    expect((await within(cell).findByRole('alert')).textContent).toBe(
      'You have not unlocked that tier yet.',
    );
  });

  it('says there is nothing spare when the inventory is empty', async () => {
    await renderApp({ hash: '#/forge', variant: 'noevents' });
    expect(screen.getByText('Nothing spare. Orders and expeditions put gear here.')).toBeTruthy();
    expect(textOf(section('Wearing · Power +0'))).toContain('Empty');
  });
});

describe('Forge, affixes', () => {
  it('rolls an affix on the chosen piece: 2 Flux, and the piece goes to the Scriptorium', async () => {
    const { session } = await renderApp({ hash: '#/forge' });
    const affix = within(section('Scriptorium'));
    expect(affix.getByText('No piece chosen.')).toBeTruthy();
    expect(
      (affix.getByRole('button', { name: 'Roll an affix' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(affix.getByText('Choose a piece from your inventory below.')).toBeTruthy();

    const pick = screen.getByRole('button', { name: 'Affix: Fernblade' });
    await fireEvent.click(pick);
    expect(pick.getAttribute('aria-pressed')).toBe('true');
    expect(affix.getByText('Fernblade')).toBeTruthy();
    expect(textOf(affix.getByText('Fernblade').closest('p'))).toContain('2 Flux');
    await fireEvent.click(affix.getByRole('button', { name: 'Roll an affix' }));
    await screen.findByText('Fernblade is at the Scriptorium for a new affix.');
    expect(session.me!.satchel.flux).toBe(1);
    expect(session.me!.inventory.some((piece) => piece.name === 'Fernblade')).toBe(false);
    expect(textOf(section('Scriptorium'))).toContain('Working: Roll an affix');
  });

  it('prices a re-roll at 4 Flux and says when the satchel is short', async () => {
    await renderApp({ hash: '#/forge' });
    await fireEvent.click(screen.getByRole('button', { name: 'Affix: Leather Armour' }));
    const affix = within(section('Scriptorium'));
    expect(textOf(affix.getByText('Leather Armour').closest('p'))).toContain('4 Flux');
    expect(affix.getByText('Short: 1 Flux')).toBeTruthy();
    expect(
      (affix.getByRole('button', { name: 'Roll an affix' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    // Choosing the same piece again clears the choice.
    await fireEvent.click(screen.getByRole('button', { name: 'Affix: Leather Armour' }));
    expect(affix.getByText('No piece chosen.')).toBeTruthy();
  });

  it('waits for the Scriptorium to be free', async () => {
    await renderApp({ hash: '#/forge' });
    await fireEvent.click(screen.getByRole('button', { name: 'Start Leather Trinket' }));
    await screen.findByText('Leather Trinket is on the Scriptorium.');
    await fireEvent.click(screen.getByRole('button', { name: 'Affix: Fernblade' }));
    expect(within(section('Scriptorium')).getByText('The Scriptorium is busy')).toBeTruthy();
  });

  it('shows a refused affix order beside the button', async () => {
    const base = fixtureApi();
    const api: Api = {
      ...base,
      async forgeStart() {
        throw new ApiError(409, 'no', 'piece_not_found');
      },
    };
    await renderApp({ hash: '#/forge', api });
    await fireEvent.click(screen.getByRole('button', { name: 'Affix: Fernblade' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Roll an affix' }));
    expect((await within(section('Scriptorium')).findByRole('alert')).textContent).toBe(
      'That piece is no longer in your inventory.',
    );
  });
});

describe('Forge, upgrades and cape colour', () => {
  it('lists the three upgrades with their cost and what each does', async () => {
    await renderApp({ hash: '#/forge' });
    const upgrades = section('Upgrades');
    expect(textOf(upgrades)).toContain('Bellows');
    expect(textOf(upgrades)).toContain('3 Flux');
    expect(textOf(upgrades)).toContain('Every Forge order takes 25% less time.');
    expect(textOf(upgrades)).toContain('10 Ink');
    expect(textOf(upgrades)).toContain('50 Lore');
    expect(within(upgrades).getByText('Short: 1 Ink')).toBeTruthy();
    expect(within(upgrades).getByText('Short: 38 Lore')).toBeTruthy();
    expect(
      (within(upgrades).getByRole('button', { name: 'Buy Bellows' }) as HTMLButtonElement).disabled,
    ).toBe(false);
    expect(
      (within(upgrades).getByRole('button', { name: 'Buy Dyes' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    // No cape colours until the Dyes are owned.
    expect(screen.queryByRole('group', { name: 'Cape colour' })).toBeNull();
  });

  it('buys the Bellows: it is owned for good, and Forge orders take a quarter less time', async () => {
    const { session } = await renderApp({ hash: '#/forge' });
    await fireEvent.click(screen.getByRole('button', { name: 'Buy Bellows' }));
    await screen.findByText('Bellows is yours for good.');
    expect(session.me!.forge.upgrades).toEqual(['bellows']);
    expect(session.me!.satchel.flux).toBe(0);
    const upgrades = section('Upgrades');
    expect(within(upgrades).getByText('Owned')).toBeTruthy();
    expect(within(upgrades).queryByRole('button', { name: 'Buy Bellows' })).toBeNull();
    const forge = within(section('Forge')).getByRole('list', { name: 'Forge recipes' });
    expect(textOf(forge)).toContain('Iron Blade 8 Ore 3 h');
    expect(textOf(within(section('Loom')).getByRole('list', { name: 'Loom recipes' }))).toContain(
      'Iron Cape 8 Ore 4 h',
    );
  });

  it('colours the cape once the Dyes are owned', async () => {
    const { session } = await renderApp({
      hash: '#/forge',
      me: {
        satchel: { ...fixtureMe(NOW).satchel, ink: 12 },
        forge: { upgrades: ['dyes'], stations: {} },
      },
    });
    const colours = screen.getByRole('group', { name: 'Cape colour' });
    expect(within(colours).getAllByRole('radio')).toHaveLength(7);
    expect(
      (within(colours).getByRole('radio', { name: 'Natural' }) as HTMLInputElement).checked,
    ).toBe(true);
    await fireEvent.click(within(colours).getByRole('radio', { name: 'Azure' }));
    await screen.findByText('Your cape is Azure.');
    expect(session.me!.gear.capeColor).toBe('azure');
    expect(
      (within(colours).getByRole('radio', { name: 'Azure' }) as HTMLInputElement).checked,
    ).toBe(true);
    // The worn cape is drawn in the dye, in the worn gear panel.
    const wornCape = section('Wearing · Power +0.75').querySelector('[data-sprite="cape-iron"]');
    expect(wornCape?.innerHTML).toContain('#3a78d8');
    await fireEvent.click(within(colours).getByRole('radio', { name: 'Natural' }));
    await screen.findByText('Your cape is its natural colour.');
    expect(session.me!.gear.capeColor).toBeNull();
  });

  it('shows a refused upgrade or dye beside its control', async () => {
    const base = fixtureApi({ me: { forge: { upgrades: ['dyes'], stations: {} } } });
    const api: Api = {
      ...base,
      async forgeUpgrade() {
        throw new ApiError(409, 'no', 'already_owned');
      },
    };
    await renderApp({
      hash: '#/forge',
      api,
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Buy Bellows' }));
    expect((await within(section('Upgrades')).findByRole('alert')).textContent).toBe(
      'You already own that.',
    );
    await fireEvent.click(screen.getByRole('radio', { name: 'Crimson' }));
    await waitFor(() =>
      expect(within(section('Upgrades')).getAllByRole('alert').length).toBeGreaterThan(0),
    );
  });
});

describe('Forge, offline and loading', () => {
  it('draws from the profile before GET /forge answers, and agrees with it after', async () => {
    const { session } = await renderApp({ hash: '#/forge' });
    await waitFor(() => expect(session.forge).not.toBeNull());
    // Leather, Iron and Silver are open at level 41 with Renown 17: three tiers at six recipe slots.
    expect(screen.getAllByRole('button', { name: /^Start / })).toHaveLength(12);
  });

  it('survives a failed read of the view', async () => {
    const base = fixtureApi();
    const api: Api = {
      ...base,
      async forge() {
        throw new ApiError(0, 'offline');
      },
    };
    const { session } = await renderApp({ hash: '#/forge', api });
    expect(session.forge).toBeNull();
    expect(screen.getByRole('button', { name: 'Collect Iron Cape' })).toBeTruthy();
  });

  it('draws a legacy piece stored without a tier', async () => {
    await renderApp({
      hash: '#/forge',
      me: {
        inventory: [
          { id: 'old', slot: 'weapon', power: 0.05 },
          makePiece({ id: 'n', slot: 'body', tier: 'rune' }),
        ],
      },
    });
    const inventory = section('Inventory · 2');
    expect(textOf(inventory)).toContain('Weapon');
    expect(textOf(inventory)).toContain('Rune Armour');
  });
});
