import { loadedDiceFires } from './charms';
import type { CounterUpdates, GameEvent, PlayerState, PowerContext } from './types';

/**
 * The player-side counter updates a scored event causes beyond the original three (opens, daily first,
 * streak): Loaded Dice's spent charge, and the
 * lifetime merge count of the repository (Grey Beard, Mentor). Only keys that changed are present.
 */
export function stateUpdates(input: {
  player: PlayerState;
  event: GameEvent;
  ctx: PowerContext | undefined;
}): Pick<CounterUpdates, 'loadedDiceUsed' | 'repoMerges'> {
  const { player, event, ctx } = input;
  const updates: Pick<CounterUpdates, 'loadedDiceUsed' | 'repoMerges'> = {};
  if (loadedDiceFires(player, ctx)) {
    updates.loadedDiceUsed = true;
  }
  if (event.kind === 'pr_merged') {
    const count = (player.repoMerges[String(event.pr.repoId)] ?? 0) + 1;
    updates.repoMerges = { repoId: event.pr.repoId, count };
  }
  return updates;
}
