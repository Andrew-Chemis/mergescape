import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import svelte from 'eslint-plugin-svelte';
import tseslint from 'typescript-eslint';

export default defineConfig(
  globalIgnores([
    '**/node_modules/**',
    '**/dist/**',
    '**/coverage/**',
    '**/cdk.out/**',
    // Spec material and mocks are authored outside the code toolchain.
    '.kiro/**',
    'SPEC.md',
    'mergescape-mocks.html',
  ]),
  js.configs.recommended,
  tseslint.configs.recommended,
  svelte.configs['flat/recommended'],
  {
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: {
      globals: { console: 'readonly', process: 'readonly' },
    },
  },
  {
    // Svelte components and runes modules are TypeScript: the Svelte parser hands `<script lang="ts">`
    // to the TypeScript parser. TypeScript itself checks for undefined names (svelte-check), so the
    // base `no-undef` rule, which does not know the DOM or the runes, is off for them.
    files: ['**/*.svelte', '**/*.svelte.ts'],
    languageOptions: {
      parserOptions: { parser: tseslint.parser },
    },
    rules: { 'no-undef': 'off' },
  },
);
