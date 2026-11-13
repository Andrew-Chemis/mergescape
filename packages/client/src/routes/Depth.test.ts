/**
 * Town and Character with the depth layer on them (task 23): the satchel strip, the expedition status card,
 * the Forge-ready notice, the Feat unlock banner, the hero's look and the gear, titles and pinned Feats.
 */
import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/svelte';
import { forbidNetwork, named, NOW, renderApp, textOf } from '../test/helpers';
import { fixtureMe } from '../lib/fixtures/state';

forbidNetwork();

const panel = (name: string): HTMLElement =>
  screen.getByRole('heading', { name, level: 2 }).closest('section') as HTMLElement;

/** The fills of the hero in the Town scene or the Character header. */
function heroFills(host: Element | null): string[] {
  return [...(host?.querySelectorAll('svg path') ?? [])].map(
    (path) => path.getAttribute('fill') ?? '',
  );
}

describe('Town, the satchel and the expedition card', () => {
  it('shows the satchel strip with the six supplies and the materials expeditions found', async () => {
    await renderApp();
    const satchel = within(panel('Satchel')).getByRole('list', { name: 'Satchel' });
    expect(textOf(satchel)).toBe('Ore 18 Timber 24 Lore 12 Ink 9 Provisions 4 Flux 3 Silver 5');
  });

  it('hides materials the character does not have yet', async () => {
    await renderApp({ variant: 'noevents' });
    const satchel = within(panel('Satchel')).getByRole('list', { name: 'Satchel' });
    expect(textOf(satchel)).toBe('Ore 0 Timber 0 Lore 0 Ink 0 Provisions 0 Flux 0');
  });

  it('says "Returned: collect" for a trip that is back, with a link to collect', async () => {
    await renderApp();
    const card = panel('Expedition');
    expect(textOf(card)).toContain('Returned: collect');
    expect(textOf(card)).toContain('Silverhall · 24 h');
    const link = within(card).getByRole('link', { name: 'Collect the loot' });
    expect(link.getAttribute('href')).toBe('#/expedition');
  });

  it('says "Returns in 4 h" while the first Forage is away', async () => {
    await renderApp({ variant: 'day0' });
    const card = panel('Expedition');
    expect(textOf(card)).toContain('Returns in 4 h');
    expect(textOf(card)).toContain('Koko Woods · Forage');
    expect(
      within(card).getByRole('link', { name: 'Open the Expedition map' }).getAttribute('href'),
    ).toBe('#/expedition');
  });

  it('says "In Town" when there is no trip, and offers to send the character out', async () => {
    await renderApp({ variant: 'noevents' });
    const card = panel('Expedition');
    expect(textOf(card)).toContain('In Town');
    expect(textOf(card)).not.toContain('·');
    expect(
      within(card).getByRole('link', { name: 'Send the character out' }).getAttribute('href'),
    ).toBe('#/expedition');
  });

  it('counts a collected trip as in Town, and remembers where it went', async () => {
    const { session } = await renderApp({ hash: '#/expedition' });
    await fireEvent.click(screen.getByRole('button', { name: 'Collect' }));
    await waitFor(() => expect(session.me?.expedition?.collected).toBe(true));
    window.location.hash = '#/';
    const card = (await screen.findByRole('heading', { name: 'Expedition', level: 2 })).closest(
      'section',
    ) as HTMLElement;
    expect(textOf(card)).toContain('In Town');
    expect(textOf(card)).toContain('Silverhall · 24 h');
    expect(within(card).getByRole('link', { name: 'Send the character out' })).toBeTruthy();
  });
});

describe('Town, the Forge-ready notice', () => {
  it('names an order that is ready and links to the Forge', async () => {
    await renderApp();
    const notice = screen.getByText(/Your Loom order is ready/).closest('p') as HTMLElement;
    expect(textOf(notice)).toBe('Your Loom order is ready: Iron Cape. Open the Forge');
    expect(within(notice).getByRole('link', { name: 'Open the Forge' }).getAttribute('href')).toBe(
      '#/forge',
    );
    // The working Forge order is not news yet.
    expect(screen.queryByText(/Your Forge order is ready/)).toBeNull();
  });

  it('goes away once the order is collected', async () => {
    await renderApp({ hash: '#/forge' });
    await fireEvent.click(screen.getByRole('button', { name: 'Collect Iron Cape' }));
    await screen.findByText('Iron Cape is in your inventory.');
    window.location.hash = '#/';
    await screen.findByRole('heading', { name: 'Town', level: 1 });
    expect(screen.queryByText(/order is ready/)).toBeNull();
  });

  it('is not there for a character with no orders', async () => {
    await renderApp({ variant: 'day0' });
    expect(screen.queryByText(/order is ready/)).toBeNull();
  });
});

describe('Town, the Feat unlock banner', () => {
  it('shows nothing for Feats the player already had', async () => {
    await renderApp();
    expect(screen.queryByRole('status', { name: 'Feat unlocked' })).toBeNull();
  });

  it('appears when a collect unlocks a Feat, and stays until it is dismissed', async () => {
    const { session } = await renderApp({ hash: '#/expedition' });
    await fireEvent.click(screen.getByRole('button', { name: 'Collect' }));
    await waitFor(() => expect(session.pendingFeats).toEqual(['spelunker']));

    window.location.hash = '#/';
    const banner = await screen.findByRole('status', { name: 'Feat unlocked' });
    expect(within(banner).getByRole('heading', { name: 'Feat unlocked' })).toBeTruthy();
    expect(textOf(banner)).toContain('Spelunker');
    expect(textOf(banner)).toContain('Title: Wayfarer');
    expect(within(banner).getByRole('link', { name: 'See your Feats' }).getAttribute('href')).toBe(
      '#/feats',
    );

    // It survives leaving Town and coming back.
    window.location.hash = '#/log';
    await screen.findByRole('heading', { name: 'Combat Log', level: 1 });
    window.location.hash = '#/';
    expect(await screen.findByRole('status', { name: 'Feat unlocked' })).toBeTruthy();

    await fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('status', { name: 'Feat unlocked' })).toBeNull();
    window.location.hash = '#/feats';
    await screen.findByRole('heading', { name: 'Feats', level: 1 });
    window.location.hash = '#/';
    await screen.findByRole('heading', { name: 'Town', level: 1 });
    expect(screen.queryByRole('status', { name: 'Feat unlocked' })).toBeNull();
    // And the Feat is on the list, unlocked.
    expect(session.feats?.find((feat) => feat.id === 'spelunker')?.unlocked).toBe(true);
  });

  it('counts as clicked when the player follows its link to the Feat list', async () => {
    const { session } = await renderApp({ hash: '#/expedition' });
    await fireEvent.click(screen.getByRole('button', { name: 'Collect' }));
    await waitFor(() => expect(session.pendingFeats).toEqual(['spelunker']));
    window.location.hash = '#/';
    const banner = await screen.findByRole('status', { name: 'Feat unlocked' });
    await fireEvent.click(within(banner).getByRole('link', { name: 'See your Feats' }));
    expect(session.pendingFeats).toEqual([]);
    // The link goes on to the Feat list; coming back to Town, the banner is gone.
    await screen.findByRole('heading', { name: 'Feats', level: 1 });
    window.location.hash = '#/';
    await screen.findByRole('heading', { name: 'Town', level: 1 });
    expect(screen.queryByRole('status', { name: 'Feat unlocked' })).toBeNull();
  });

  it('adds the unlocked Feat to the Feats list', async () => {
    await renderApp({ hash: '#/expedition' });
    await fireEvent.click(screen.getByRole('button', { name: 'Collect' }));
    await screen.findByRole('heading', { name: 'The haul' });
    window.location.hash = '#/feats';
    const unlocked = (
      await screen.findByRole('heading', { name: 'Unlocked · 3', level: 2 })
    ).closest('section') as HTMLElement;
    expect(within(unlocked).getByRole('heading', { name: 'Spelunker', level: 3 })).toBeTruthy();
  });
});

describe('the hero look (Requirement 16.4)', () => {
  it('wears the palette of the highest tier worn, on Town and on Character', async () => {
    await renderApp();
    const town = heroFills(document.querySelector('.scene .hero'));
    // Iron: body #8e8e8e, weapon #d6d6d6.
    expect(town).toContain('#8e8e8e');
    expect(town).toContain('#d6d6d6');
    window.location.hash = '#/character';
    await screen.findByRole('heading', { name: 'Character', level: 1 });
    const sheet = heroFills(panelOfHero());
    expect(sheet).toContain('#8e8e8e');
  });

  it('moves up to Dragon with a Monolith Plate, which only looks like Dragon', async () => {
    const plate = fixtureMe(NOW).inventory[0]!;
    await renderApp({
      me: {
        gear: {
          equipped: { body: { ...plate, slot: 'body', tier: 'iron', look: 'dragon' } },
          setBonus: 0,
          capeColor: null,
        },
      },
    });
    expect(heroFills(document.querySelector('.scene .hero'))).toContain('#b3272b');
  });

  it('wears the cape colour the Dyes chose, and the natural cape without them', async () => {
    await renderApp();
    const plain = heroFills(document.querySelector('.scene .hero'));
    expect(plain).not.toContain('#3a78d8');
    document.body.innerHTML = '';
    const base = fixtureMe(NOW).gear;
    await renderApp({ me: { gear: { ...base, capeColor: 'azure' } } });
    expect(heroFills(document.querySelector('.scene .hero'))).toContain('#3a78d8');
  });

  it('has no cape when none is worn, and the level palette when nothing is', async () => {
    await renderApp({ variant: 'noevents' });
    const fills = heroFills(document.querySelector('.scene .hero'));
    // Rags at level 1: no cape pixels, and the Rags body colour.
    expect(fills).toContain('#7a5330');
    expect(fills).not.toContain('#8e8e8e');
  });
});

/** The Character header's hero. */
function panelOfHero(): Element | null {
  return screen.getByRole('heading', { name: /octo-dev/ }).closest('section');
}

describe('Character, gear, titles and pinned Feats', () => {
  it('shows each slot with its sprite, name and Power, and the set bonus', async () => {
    await renderApp({ hash: '#/character' });
    const gear = panel('Equipped gear · Power +0.75');
    for (const slot of ['Weapon', 'Body', 'Cape', 'Trinket', 'Pet']) {
      expect(within(gear).getByText(slot)).toBeTruthy();
    }
    expect(textOf(gear)).toContain('Iron Blade');
    expect(textOf(gear)).toContain('Iron · +0.1 Power · Stout');
    expect(textOf(gear)).toContain('Goblin Runt');
    expect(textOf(gear)).toContain('A full set of one tier: +0.25 Power.');
    expect(gear.querySelectorAll('svg[data-sprite]')).toHaveLength(5);
    expect(gear.querySelector('[data-sprite="weapon-iron"]')).not.toBeNull();
    expect(gear.querySelector('[data-sprite="pet-goblin-runt"]')).not.toBeNull();
    expect(within(gear).getByRole('link', { name: 'Forge' }).getAttribute('href')).toBe('#/forge');
  });

  it('shows empty slots for a character with nothing worn', async () => {
    await renderApp({ hash: '#/character', variant: 'noevents' });
    const gear = panel('Equipped gear · Power +0');
    expect(within(gear).getAllByText('Empty')).toHaveLength(5);
    expect(textOf(gear)).toContain('Wear all five slots in one tier for a +0.25 Power set bonus.');
  });

  it('shows the earned titles', async () => {
    await renderApp({ hash: '#/character' });
    const titles = screen.getByRole('list', { name: 'Titles' });
    expect(
      within(titles)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['Imp Whisperer']);
    document.body.innerHTML = '';
    await renderApp({ hash: '#/character', variant: 'noevents' });
    expect(screen.queryByRole('list', { name: 'Titles' })).toBeNull();
  });

  it('shows the pinned Feats with what they say and give', async () => {
    await renderApp({ hash: '#/character' });
    const pinned = panel('Pinned Feats · 1 of 3');
    expect(textOf(pinned)).toContain('Goblin Slayer');
    expect(textOf(pinned)).toContain('Pet: Goblin Runt');
    expect(within(pinned).getByRole('link', { name: 'Feats' }).getAttribute('href')).toBe(
      '#/feats',
    );
  });

  it('says so when no Feats are pinned', async () => {
    await renderApp({ hash: '#/character', variant: 'noevents' });
    const pinned = panel('Pinned Feats · 0 of 3');
    expect(textOf(pinned)).toContain('No Feats pinned yet.');
  });

  it('keeps the level tier ladder it always had', async () => {
    await renderApp({ hash: '#/character' });
    expect(screen.getByRole('heading', { name: /^Gear tier/ })).toBeTruthy();
  });
});

describe('the day-0 onboarding sequence (?fixture=day0)', () => {
  it('shows the first kill, the free Charm, the Forage away and the Scout act, all on Town', async () => {
    await renderApp({ variant: 'day0' });
    // The scripted first kill, with its roll.
    expect(screen.getByRole('heading', { name: /Last kill · Merge Goblin/ })).toBeTruthy();
    expect(textOf(document.querySelector('.last-kill'))).toContain('XP = 639');
    expect(textOf(document.querySelector('.last-kill'))).toContain(
      '+2 Ore, +1 Timber, +3 Provisions',
    );
    // The Forage is out.
    expect(textOf(panel('Expedition'))).toContain('Returns in 4 h');
    // The Scout act has the flat 2,000 target.
    expect(textOf(panel('Satchel'))).toContain('Provisions 3');
    expect(screen.getByRole('heading', { name: named("This week's Run · Act I") })).toBeTruthy();
  });

  it('has the Forage waiting on the Expedition screen, then home with leather and provisions', async () => {
    const { session } = await renderApp({ hash: '#/expedition', variant: 'day0' });
    expect(screen.getByRole('timer').textContent?.trim()).toBe('3:54:00');
    // Four hours later the Forage is back.
    const { vi } = await import('vitest');
    vi.setSystemTime(NOW + 4 * 3_600_000);
    const collect = await screen.findByRole('button', { name: 'Collect' }, { timeout: 3000 });
    await fireEvent.click(collect);
    const haul = (await screen.findByRole('heading', { name: 'The haul' })).closest(
      'section',
    ) as HTMLElement;
    expect(textOf(haul)).toContain('Leather Armour');
    expect(textOf(haul)).toContain('4 Timber');
    expect(textOf(haul)).toContain('1 Provisions');
    expect(session.me!.satchel.provisions).toBe(4);
    // And the character can go out again, on a real trip it can now pay for.
    expect(screen.getByRole('heading', { name: 'In Town' })).toBeTruthy();
  });
});
