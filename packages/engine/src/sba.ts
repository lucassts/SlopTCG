/**
 * State-based actions: checked whenever a player would receive priority
 * and after combat damage. Loop until nothing changes (704.3).
 */
import type { Emit } from './ops.js';
import { lose, moveWithEvent } from './ops.js';
import { battlefield, effectiveToughness, hasKeyword, type GameState } from './state.js';
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
      if (obj.card.types.includes('Creature')) {
        const toughness = effectiveToughness(state, obj);
        const deathtouched = (obj.counters['__deathtouched'] ?? 0) > 0 && obj.damage > 0;
        // Indestructible ignores lethal damage/deathtouch, NOT toughness ≤ 0.
        const lethal = (obj.damage >= toughness || deathtouched) && !hasKeyword(state, obj, 'indestructible');
        if (toughness <= 0 || lethal) {
          moveWithEvent(state, obj, 'graveyard', 'destroyed', emit);
          changed = true;
          anyChange = true;
          break; // battlefield list changed; rescan
        }
      }

      // Aura attached to nothing (or to something gone) goes to the graveyard;
      // equipment just becomes unattached (704.5n / 704.5p).
      if (obj.attachedTo !== undefined) {
        const host = state.objects[obj.attachedTo];
        const hostGone = !host || host.zone !== 'battlefield' || !host.card.types.includes('Creature');
        if (hostGone) {
          if (obj.card.enchant) {
            moveWithEvent(state, obj, 'graveyard', 'destroyed', emit);
            changed = true;
            anyChange = true;
            break;
          }
          obj.attachedTo = undefined;
          anyChange = true;
        }
      } else if (obj.card.enchant) {
        // An aura must always be attached to something.
        moveWithEvent(state, obj, 'graveyard', 'destroyed', emit);
        changed = true;
        anyChange = true;
        break;
      }
    }
  }
  return anyChange;
}
