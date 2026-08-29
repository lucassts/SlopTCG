/**
 * State-based actions: checked whenever a player would receive priority
 * and after combat damage. Loop until nothing changes (704.3).
 */
import type { Emit } from './ops.js';
import { lose, moveWithEvent } from './ops.js';
import { battlefield, effectiveToughness, type GameState } from './state.js';
import { PLAYER_IDS } from './types.js';

export function checkStateBasedActions(state: GameState, emit: Emit): boolean {
  let anyChange = false;
  let changed = true;
  while (changed && state.status === 'playing') {
    changed = false;

    for (const p of PLAYER_IDS) {
      if (state.players[p].life <= 0) {
        lose(state, p, 'ficou com 0 ou menos pontos de vida', emit);
        return true;
      }
    }

    for (const obj of battlefield(state)) {
      if (!obj.card.types.includes('Creature')) continue;
      const toughness = effectiveToughness(obj);
      const deathtouched = (obj.counters['__deathtouched'] ?? 0) > 0 && obj.damage > 0;
      if (toughness <= 0 || obj.damage >= toughness || deathtouched) {
        moveWithEvent(state, obj, 'graveyard', 'destroyed', emit);
        changed = true;
        anyChange = true;
        break; // battlefield list changed; rescan
      }
    }
  }
  return anyChange;
}
