/**
 * The plain-words privacy promise (design.md section 10) with the five statements Requirement 13.3
 * requires: no code is read, counts and timestamps only, export and delete are available, activity from
 * people who have not signed in is discarded, and the game is not a performance-review tool. Landing and
 * the Privacy page show these same sentences, so they cannot drift apart.
 */
export const PROMISES: readonly string[] = [
  'We never read your code. No file contents, diffs, titles or comment text, ever.',
  'We store counts and timestamps only.',
  'You can export or delete everything in one click.',
  "The App can't write to GitHub.",
  "Activity from people who haven't signed in is discarded.",
  'Mergescape is a game, not a performance-review tool. There is no manager view.',
];

/** When the Privacy and Terms text last changed. */
export const LEGAL_UPDATED = '8 November 2026';
