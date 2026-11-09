import { fileURLToPath } from 'node:url';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset URLs so the build works under a GitHub Pages project path.
  base: './',
  plugins: [
    // Absolute path so the config is also found when Vitest runs from the repository root.
    svelte({ configFile: fileURLToPath(new URL('./svelte.config.js', import.meta.url)) }),
  ],
  build: {
    target: 'es2022',
  },
});
