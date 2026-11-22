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

/**
 * Obvious real names and brands that must not appear in the code or the copy (Requirement 7.5, 16.3).
 * Matched as whole words, case-insensitive. Shared by the Mogul copy review and the review of the
 * expedition, gear, pet and Feat content.
 */
export const NAME_DENYLIST: readonly string[] = [
  'elon',
  'musk',
  'tesla',
  'spacex',
  'jensen',
  'huang',
  'nvidia',
  'zuckerberg',
  'zuck',
  'facebook',
  'instagram',
  'meta',
  'steve jobs',
  'jobs',
  'apple',
  'bezos',
  'amazon',
  'gates',
  'microsoft',
  'altman',
  'openai',
  'anthropic',
  'sam altman',
  'google',
  'alphabet',
  'pichai',
  'nadella',
  'twitter',
  'oracle',
  'netflix',
  'uber',
  'ellison',
  'dorsey',
  'cook',
];

/** A whole-word, case-insensitive pattern for the denylist, leaving out any names in `except`. */
export function namesPattern(except: readonly string[] = []): RegExp {
  const names = NAME_DENYLIST.filter((name) => !except.includes(name));
  return new RegExp(`\\b(${names.join('|')})\\b`, 'i');
}
