/**
 * The raw text of every source file in `src`, keyed by `./name.ts`, for tests that scan the code itself
 * (the real-names review of the Mogul copy, the guard that only economy.ts writes gold). Vite inlines the
 * files at test time, so no file-system types are needed. Not part of the package API.
 */
export const SOURCES: Readonly<Record<string, string>> = (
  import.meta as unknown as {
    glob: (
      pattern: string,
      options: { query: string; import: string; eager: true },
    ) => Record<string, string>;
  }
).glob('./*.ts', { query: '?raw', import: 'default', eager: true });

/** The package's own code: no tests and no test builders. */
export function productionSources(): [string, string][] {
  return Object.entries(SOURCES).filter(
    ([file]) => !file.endsWith('.test.ts') && !file.startsWith('./test-'),
  );
}
