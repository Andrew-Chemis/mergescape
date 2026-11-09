import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig(
  globalIgnores([
    '**/node_modules/**',
    '**/dist/**',
    '**/coverage/**',
    '**/.aws-sam/**',
    // Spec material and mocks are authored outside the code toolchain.
    '.kiro/**',
    'SPEC.md',
    'mergescape-mocks.html',
    // Svelte files are checked by svelte-check; no Svelte lint plugin is installed yet.
    '**/*.svelte',
  ]),
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: {
      globals: { console: 'readonly', process: 'readonly' },
    },
  },
);
