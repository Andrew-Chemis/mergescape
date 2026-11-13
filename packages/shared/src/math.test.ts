import { describe, expect, it } from 'vitest';
import { clamp, clamp01, isRecord, sumBy, tidy } from './math';

describe('tidy', () => {
  it('rounds away float noise from 0.05-style sums', () => {
    expect(tidy(0.05 + 0.05 + 0.05)).toBe(0.15);
    expect(tidy(0.1 + 0.2)).toBe(0.3);
    expect(tidy(2)).toBe(2);
  });
});

describe('clamp', () => {
  it('holds a value within its bounds, inclusive', () => {
    expect(clamp(5, 1, 10)).toBe(5);
    expect(clamp(0, 1, 10)).toBe(1);
    expect(clamp(11, 1, 10)).toBe(10);
    expect(clamp(1, 1, 10)).toBe(1);
    expect(clamp(10, 1, 10)).toBe(10);
    expect(clamp(-3, -5, -1)).toBe(-3);
  });
});

describe('clamp01', () => {
  it('holds a value within 0..1', () => {
    expect(clamp01(0.4)).toBe(0.4);
    expect(clamp01(-0.4)).toBe(0);
    expect(clamp01(1.4)).toBe(1);
    expect(clamp01(0)).toBe(0);
    expect(clamp01(1)).toBe(1);
  });
});

describe('sumBy', () => {
  it('adds what `pick` reads from each item, and is 0 for none', () => {
    expect(sumBy([], (item: { n: number }) => item.n)).toBe(0);
    expect(sumBy([{ n: 1 }, { n: 2.5 }, { n: 4 }], (item) => item.n)).toBe(7.5);
    expect(sumBy(['a', 'bcd'], (text) => text.length)).toBe(4);
  });
});

describe('isRecord', () => {
  it('accepts plain objects only', () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord({ a: 1 })).toBe(true);
    expect(isRecord(null)).toBe(false);
    expect(isRecord(undefined)).toBe(false);
    expect(isRecord([])).toBe(false);
    expect(isRecord([{}])).toBe(false);
    expect(isRecord('text')).toBe(false);
    expect(isRecord(3)).toBe(false);
    expect(isRecord(() => ({}))).toBe(false);
  });
});
