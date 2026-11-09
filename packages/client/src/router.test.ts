import { describe, expect, it } from 'vitest';
import { normalizePath, parseHash, PUBLIC_ROUTES, ROUTE_TITLES } from './router';

describe('normalizePath', () => {
  it.each([
    ['', '/'],
    ['#', '/'],
    ['#/', '/'],
    ['#/log', '/log'],
    ['#/log/', '/log'],
    ['#log', '/log'],
    ['#/log?page=2', '/log'],
    ['#/?x=1', '/'],
  ])('%j -> %j', (hash, expected) => {
    expect(normalizePath(hash)).toBe(expected);
  });
});

describe('parseHash', () => {
  it('routes the empty hash and the root to home', () => {
    expect(parseHash('')).toEqual({ name: 'home' });
    expect(parseHash('#/')).toEqual({ name: 'home' });
  });

  it.each([
    ['#/log', 'log'],
    ['#/character', 'character'],
    ['#/shop', 'shop'],
    ['#/map', 'map'],
    ['#/bestiary', 'bestiary'],
    ['#/settings', 'settings'],
    ['#/privacy', 'privacy'],
    ['#/terms', 'terms'],
    ['#/cookies', 'cookies'],
    ['#/welcome', 'welcome'],
  ])('routes %s to %s', (hash, name) => {
    expect(parseHash(hash)).toEqual({ name });
  });

  it('routes unknown paths to not-found with the normalised path', () => {
    expect(parseHash('#/nope/')).toEqual({ name: 'not-found', path: '/nope' });
  });
});

describe('route titles and public routes', () => {
  it('titles every screen', () => {
    expect(ROUTE_TITLES).toMatchObject({
      shop: 'Shop',
      map: 'Run Map',
      bestiary: 'Bestiary',
      settings: 'Settings',
      privacy: 'Privacy',
      terms: 'Terms',
      cookies: 'Cookies',
    });
  });

  it('opens only Privacy, Terms and Cookies without signing in', () => {
    expect(PUBLIC_ROUTES).toEqual(['privacy', 'terms', 'cookies']);
  });
});
