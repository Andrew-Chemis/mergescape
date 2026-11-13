import { describe, expect, it } from 'vitest';
import { SHARED_PACKAGE } from './index';

describe('@mergescape/shared', () => {
  it('exposes its package name', () => {
    expect(SHARED_PACKAGE).toBe('@mergescape/shared');
  });
});
