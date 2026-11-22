import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: ['packages/*'],
    // Coverage is a root-level option under projects: one run collects every package, and the
    // thresholds below are scoped to each package by glob. `pnpm test` fails when any is missed.
    coverage: {
      provider: 'v8',
      include: [
        'packages/shared/src/**/*.ts',
        'packages/backend/src/**/*.ts',
        'packages/client/src/**/*.{ts,svelte}',
      ],
      exclude: [
        '**/*.test.ts',
        '**/*.d.ts',
        // Test builders and the client's test setup are not product code.
        'packages/shared/src/test-*.ts',
        'packages/client/src/test/**',
      ],
      reporter: ['text-summary', 'json-summary'],
      thresholds: {
        // Requirement 4.10: at least 95% line coverage for shared and 100% branch coverage on the scorer.
        'packages/shared/src/**': { lines: 95 },
        'packages/shared/src/score.ts': { branches: 100 },
        // Requirement 18.2 leaves the other packages' floors open. They sit a few points under the
        // numbers when they were set (backend 96 %, client 96 % lines), so a real drop fails CI without
        // blocking a small change. Raise them as the packages grow.
        'packages/backend/src/**': { lines: 90 },
        'packages/client/src/**': { lines: 90 },
      },
    },
  },
});
