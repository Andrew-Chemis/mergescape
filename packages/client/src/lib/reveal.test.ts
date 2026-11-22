import { describe, expect, it, vi } from 'vitest';
import { isNewWeek, markWeekSeen, REVEAL_KEY, seenWeek } from './reveal';

function memory(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (key: string) => data[key] ?? null,
    setItem: (key: string, value: string) => {
      data[key] = value;
    },
  };
}

const blocked = {
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('blocked');
  },
};

describe('the seen week', () => {
  it('is new until it is marked, then not, then new again for the next week', () => {
    const store = memory();
    expect(seenWeek(store)).toBeNull();
    expect(isNewWeek('2026-46', store)).toBe(true);
    expect(markWeekSeen('2026-46', store)).toBe(true);
    expect(store.data[REVEAL_KEY]).toBe('2026-46');
    expect(isNewWeek('2026-46', store)).toBe(false);
    expect(isNewWeek('2026-47', store)).toBe(true);
  });

  it('survives storage that throws: every week is new, marking says it failed', () => {
    expect(seenWeek(blocked)).toBeNull();
    expect(isNewWeek('2026-46', blocked)).toBe(true);
    expect(markWeekSeen('2026-46', blocked)).toBe(false);
  });

  it('survives there being no storage at all', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(markWeekSeen('2026-46')).toBe(false);
    expect(isNewWeek('2026-46')).toBe(true);
  });

  it('uses the real localStorage by default', () => {
    expect(isNewWeek('2026-46')).toBe(true);
    markWeekSeen('2026-46');
    expect(window.localStorage.getItem(REVEAL_KEY)).toBe('2026-46');
    expect(isNewWeek('2026-46')).toBe(false);
  });
});
