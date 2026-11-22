import { loadedDiceFires } from './charms';
import { mogulChainAfter } from './moguls';
import type { PledgeEvaluation } from './pledges';
import type {
  CounterUpdates,
  GameEvent,
  MogulId,
  PlayerState,
  PowerContext,
  PRState,
} from './types';

/**
 * The player-side counter updates a scored event causes beyond the original three (opens, daily first,
 * streak): Pledge progress and completions, the Leather Jacket chain, Loaded Dice's spent charge, and the
 * lifetime merge count of the repository (Grey Beard, Mentor). Only keys that changed are present.
 */
export function stateUpdates(input: {
  player: PlayerState;
  event: GameEvent;
  pr: PRState;
  mogul: MogulId | null;
  pledge: PledgeEvaluation;
  ctx: PowerContext | undefined;
}): Pick<CounterUpdates, 'pledges' | 'mogulChain' | 'loadedDiceUsed' | 'repoMerges'> {
  const { player, event, pr, mogul, pledge, ctx } = input;
  const updates: Pick<CounterUpdates, 'pledges' | 'mogulChain' | 'loadedDiceUsed' | 'repoMerges'> =
    {};
  if (pledge.next !== null) {
    updates.pledges = pledge.next;
  }
  const chain = mogulChainAfter(mogul, event, pr, player);
  if (chain !== null) {
    updates.mogulChain = chain;
  }
  if (loadedDiceFires(player, ctx)) {
    updates.loadedDiceUsed = true;
  }
  if (event.kind === 'pr_merged') {
    const count = (player.repoMerges[String(event.pr.repoId)] ?? 0) + 1;
    updates.repoMerges = { repoId: event.pr.repoId, count };
  }
  return updates;
}
