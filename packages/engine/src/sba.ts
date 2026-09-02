/**
 * State-based actions: checked whenever a player would receive priority
 * and after combat damage. Loop until nothing changes (704.3).
 */
import type { Emit } from './ops.js';
import { destroyObject, lose, moveWithEvent } from './ops.js';
import { battlefield, effectiveToughness, hasKeyword, isCreature, type GameState } from './state.js';
import { PLAYER_IDS, type CardType, type PlayerId } from './types.js';

/** Move a permanent between controllers' battlefield lists. */
function transferControl(state: GameState, obj: GameState['objects'][number], to: PlayerId, emit: Emit): void {
  const from = obj.controller;
  if (from === to) return;
  const arr = state.players[from].zones.battlefield;
  const i = arr.indexOf(obj.id);
  if (i >= 0) arr.splice(i, 1);
  obj.controller = to;
  state.players[to].zones.battlefield.push(obj.id);
  obj.attacking = false;
  obj.blocking = undefined;
  emit({ type: 'controlChanged', objectId: obj.id, cardName: obj.card.name, to });
}

/** Control Magic auras: the host follows the aura's controller while attached. */
function syncControlAuras(state: GameState, emit: Emit): void {
  for (const obj of battlefield(state)) {
    const aura = battlefield(state).find((a) => a.attachedTo === obj.id && a.card.attachEffect?.controlHost);
    if (aura) {
      if (obj.controller !== aura.controller) transferControl(state, obj, aura.controller, emit);
      obj.controlAura = aura.id;
    } else if (obj.controlAura !== undefined) {
      obj.controlAura = undefined;
      transferControl(state, obj, obj.owner, emit);
    }
  }
}

export function checkStateBasedActions(state: GameState, emit: Emit): boolean {
  let anyChange = false;
  let changed = true;
  syncControlAuras(state, emit);
  while (changed && state.status === 'playing') {
    changed = false;

    for (const p of PLAYER_IDS) {
      if (state.players[p].life <= 0) {
        lose(state, p, 'ficou com 0 ou menos pontos de vida', emit);
        return true;
      }
      if (state.players[p].poison >= 10) {
        lose(state, p, 'recebeu 10 marcadores de veneno', emit);
        return true;
      }
    }

    for (const obj of battlefield(state)) {
      if (isCreature(obj)) {
        const toughness = effectiveToughness(state, obj);
        const deathtouched = (obj.counters['__deathtouched'] ?? 0) > 0 && obj.damage > 0;
        // Indestructible ignores lethal damage/deathtouch, NOT toughness ≤ 0.
        const lethal = (obj.damage >= toughness || deathtouched) && !hasKeyword(state, obj, 'indestructible');
        if (toughness <= 0) {
          // Toughness ≤ 0 is not destruction: regeneration can't save it.
          moveWithEvent(state, obj, 'graveyard', 'destroyed', emit);
          changed = true;
          anyChange = true;
          break;
        }
        if (lethal) {
          destroyObject(state, obj, emit); // regeneration may replace this
          changed = true;
          anyChange = true;
          break; // battlefield list changed; rescan
        }
      }

      // Planeswalker with no loyalty goes to the graveyard.
      if (obj.card.types.includes('Planeswalker') && (obj.counters['loyalty'] ?? 0) <= 0) {
        moveWithEvent(state, obj, 'graveyard', 'destroyed', emit);
        changed = true;
        anyChange = true;
        break;
      }

      // Aura attached to nothing (or to something gone) goes to the graveyard;
      // equipment just becomes unattached (704.5n / 704.5p).
      if (obj.attachedTo !== undefined) {
        const host = state.objects[obj.attachedTo];
        // Auras: the host must still match "Enchant X"; equipment needs a creature.
        const wants = obj.card.enchant?.what ?? 'creature';
        const wantedType = (wants.charAt(0).toUpperCase() + wants.slice(1)) as CardType;
        const hostGone =
          !host || host.zone !== 'battlefield' || (wants !== 'permanent' && !host.card.types.includes(wantedType));
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
