import { describe, expect, it } from 'vitest';
import { normalizePath, parseHash } from './router';

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

  it('routes unknown paths to not-found with the normalised path', () => {
    expect(parseHash('#/nope/')).toEqual({ name: 'not-found', path: '/nope' });
  });
});
