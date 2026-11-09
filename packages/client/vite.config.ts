import { fileURLToPath } from 'node:url';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig, loadEnv } from 'vite';
import { cspPlugin } from './tools/csp.ts';

export default defineConfig(({ mode }) => {
  // VITE_API_ORIGIN feeds both the client (import.meta.env) and the CSP connect-src.
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const apiOrigin = process.env['VITE_API_ORIGIN'] ?? env['VITE_API_ORIGIN'];
  return {
    // Relative asset URLs so the build works under a GitHub Pages project path.
    base: './',
    plugins: [
      // Absolute path so the config is also found when Vitest runs from the repository root.
      svelte({ configFile: fileURLToPath(new URL('./svelte.config.js', import.meta.url)) }),
      cspPlugin(apiOrigin),
    ],
    build: {
      target: 'es2022',
    },
  };
});
