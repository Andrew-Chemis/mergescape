import { describe, expect, it } from 'vitest';
import { FORMER_OWNERS, REGIONS } from './expeditions';
import { UNIQUES } from './gear';
import { PETS } from './pets';
import { namesPattern, productionSources } from './test-sources';

/**
 * Copy review for the depth layers (Requirements 7.5 and 16.3): no real person, company or brand name in
 * the code or the content of expeditions, gear, pets, the Forge or Feats, and the former owners of
 * Reclaimed gear are invented. The Mogul copy has its own review in moguls.test.ts, which also scans
 * every production source file; this one names the new modules and scans their exported content.
 */
describe('no real names in the expedition, gear, pet, Forge and Feat modules', () => {
  // "Oracle" is also a Charm name; it is denied only in the Mogul copy review.
  const pattern = namesPattern(['oracle']);
  const NEW_MODULES = ['supplies', 'expeditions', 'gear', 'pets'];

  it('scans the new source files, and finds nothing in them', () => {
    const sources = productionSources();
    for (const name of NEW_MODULES) {
      const found = sources.find(([file]) => file === `./${name}.ts`);
      expect(found, name).toBeDefined();
      expect(found![1].match(pattern), name).toBeNull();
    }
  });

  it('finds nothing in the exported content', () => {
    const content = JSON.stringify([FORMER_OWNERS, REGIONS, UNIQUES, PETS]);
    expect(content.match(pattern)).toBeNull();
  });

  it('the scan catches a name (positive control)', () => {
    expect('Reclaimed Blade, once Jensen Huang'.match(pattern)).not.toBeNull();
    expect('Forge Jobs'.match(pattern)).not.toBeNull();
    expect('Bessik the Unfiled'.match(pattern)).toBeNull();
  });

  it('every former owner is invented: none matches the denylist or looks like a login', () => {
    for (const owner of FORMER_OWNERS) {
      expect(owner.match(pattern), owner).toBeNull();
      expect(owner).not.toMatch(/[0-9_[\]@]/);
    }
  });
});
