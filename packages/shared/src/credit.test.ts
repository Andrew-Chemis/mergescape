import { describe, expect, it } from 'vitest';
import { riposteCreditEvents, verifiedKillEvents } from './credit';
import { score } from './score';
import {
  AUTHOR_ID,
  bot,
  human,
  mergedEvent,
  mergedFacts,
  NOW,
  OTHER_REVIEWER_ID,
  prStateFor,
  REVIEWER_ID,
  settledPlayer,
} from './test-builders';
import type { PRState, ReviewRecord } from './types';

const approved = (id: number): ReviewRecord => ({ reviewerId: id, state: 'APPROVED' });
const changes = (id: number): ReviewRecord => ({ reviewerId: id, state: 'CHANGES_REQUESTED' });

describe('merge credits go to other humans only', () => {
  // A bot-authored PR: the normaliser credits the human who merged it, so the merge event's actor is
  // the merger, not the author.
  const merger = human(5);
  const botPr = mergedFacts({ author: bot(9), mergedBy: merger });
  const botMerge = mergedEvent(botPr, merger);

  it('never gives the merger a verified kill for approving the PR they merged themselves', () => {
    const pr = prStateFor(botPr, { reviews: [approved(5), approved(REVIEWER_ID)] });
    expect(verifiedKillEvents(botMerge, pr).map((event) => event.actor.id)).toEqual([REVIEWER_ID]);
    const alone = prStateFor(botPr, { reviews: [approved(5)] });
    expect(verifiedKillEvents(botMerge, alone)).toEqual([]);
  });

  it('never gives the merger a Riposte credit for the changes they requested on it', () => {
    const pr = prStateFor(botPr, { reviews: [changes(5), changes(OTHER_REVIEWER_ID)] });
    expect(riposteCreditEvents(botMerge, pr).map((event) => event.actor.id)).toEqual([
      OTHER_REVIEWER_ID,
    ]);
  });

  it('still excludes the author of a human PR, and keeps other humans in review order', () => {
    const humanPr = mergedEvent(mergedFacts());
    const pr = prStateFor(humanPr.pr, {
      reviews: [approved(AUTHOR_ID), approved(OTHER_REVIEWER_ID), changes(AUTHOR_ID), changes(7)],
    });
    expect(verifiedKillEvents(humanPr, pr).map((event) => event.actor.id)).toEqual([
      OTHER_REVIEWER_ID,
    ]);
    expect(riposteCreditEvents(humanPr, pr).map((event) => event.actor.id)).toEqual([7]);
  });

  it('a human approving then merging a bot PR earns the review and a solo merge, not a kill', () => {
    // Before: 40 (approval) + 161 (merge, unhalved because the merger was not the author) + 25 (kill).
    const pr: PRState = prStateFor(botPr, { reviews: [approved(5)] });
    const player = settledPlayer(5);
    const merge = score(botMerge, player, pr, NOW);
    expect(merge.points).toBe(45 + 35);
    const kills = verifiedKillEvents(botMerge, pr);
    expect(kills).toEqual([]);
    const own = mergedFacts();
    expect(score(mergedEvent(own), settledPlayer(), prStateFor(own), NOW).points).toBe(
      merge.points,
    );
  });
});
