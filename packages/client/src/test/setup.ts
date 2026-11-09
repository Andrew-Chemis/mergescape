import { afterEach, vi } from 'vitest';

// jsdom starts with a bare document; the app's index.html sets these.
document.documentElement.lang = 'en';

// jsdom has no canvas: its stub logs "not implemented" and returns null. axe-core probes a canvas for
// icon ligatures; answer null quietly (the same result, without the noise).
HTMLCanvasElement.prototype.getContext = (() =>
  null) as typeof HTMLCanvasElement.prototype.getContext;

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  // Tests that pretend to prefer reduced motion define matchMedia; jsdom has none of its own.
  Reflect.deleteProperty(window, 'matchMedia');
  window.history.replaceState(null, '', '/');
  window.localStorage.clear();
});
