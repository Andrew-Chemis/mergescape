import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'shared',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts'],
      reporter: ['text'],
      // Requirement 4.10: at least 95% line coverage for the package and 100% branch coverage on the scorer.
      thresholds: {
        lines: 95,
        'src/score.ts': { branches: 100, lines: 95 },
      },
    },
  },
});
