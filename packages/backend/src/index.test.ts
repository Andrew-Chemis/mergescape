import { describe, expect, it } from 'vitest';
import { BACKEND_PACKAGE, SHARED_DEPENDENCY } from './index';

describe('@mergescape/backend', () => {
  it('exposes its package name and resolves the shared workspace package', () => {
    expect(BACKEND_PACKAGE).toBe('@mergescape/backend');
    expect(SHARED_DEPENDENCY).toBe('@mergescape/shared');
  });
});
