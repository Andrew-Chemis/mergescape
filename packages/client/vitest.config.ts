import { fileURLToPath } from 'node:url';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { svelteTesting } from '@testing-library/svelte/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    // Absolute path so the config is also found when Vitest runs from the repository root.
    svelte({ configFile: fileURLToPath(new URL('./svelte.config.js', import.meta.url)) }),
    // Resolves Svelte's browser build under Vitest and cleans up rendered components after each test.
    svelteTesting(),
  ],
  test: {
    name: 'client',
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'tools/**/*.test.ts'],
    setupFiles: ['./src/test/setup.ts'],
    // The contrast test reads theme.css as text (?raw); Vitest otherwise replaces CSS with an empty module.
    css: { include: [/theme\.css/] },
  },
});
