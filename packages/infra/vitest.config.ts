import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'infra',
    include: ['test/**/*.test.ts'],
    // One test builds the client with Vite.
    testTimeout: 120_000,
  },
});
