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
  // Ascend: ten or more permanents → city's blessing for the rest of the game.
  for (const p of PLAYER_IDS) {
    const ps = state.players[p];
    if (!ps.cityBlessing && ps.zones.battlefield.length >= 10 && ps.zones.battlefield.some((id) => state.objects[id].card.ascend)) { ps.cityBlessing = true; emit({ type: 'fizzled', description: `${ps.name} recebe a bênção da cidade` }); }
  }
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
      if (obj.copyPending) continue; // clone escolhendo o que copiar: ainda não é o 0/0 impresso
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

      // Saga past its last chapter with no chapter ability pending is sacrificed (714.4).
      if (obj.card.saga && (obj.counters['lore'] ?? 0) >= obj.card.saga.chapters) {
        const pending =
          state.stack.some((i) => i.kind === 'ability' && i.sourceId === obj.id && i.chapter !== undefined) ||
          state.triggerQueue.some((t) => t.sourceId === obj.id && t.chapter !== undefined) ||
          (state.pendingDecision !== null && 'sourceId' in state.pendingDecision && state.pendingDecision.sourceId === obj.id) ||
          (state.pendingDecision?.type === 'effectChoice' && state.pendingDecision.resume.sourceId === obj.id);
        if (!pending) {
          moveWithEvent(state, obj, 'graveyard', 'sacrificed', emit);
          changed = true;
          anyChange = true;
          break;
        }
      }

      // Planeswalker with no loyalty goes to the graveyard.
      if (obj.card.types.includes('Planeswalker') && (obj.counters['loyalty'] ?? 0) <= 0) {
        moveWithEvent(state, obj, 'graveyard', 'destroyed', emit);
        changed = true;
        anyChange = true;
        break;
      }
      // Battle with no defense is defeated: exiled, then "cast transformed" (put onto the battlefield as its back face).
      if (obj.card.types.includes('Battle') && !obj.transformed && (obj.counters['defense'] ?? 0) <= 0) {
        const back = obj.baseCard?.backFace;
        moveWithEvent(state, obj, 'exile', 'exiled', emit);
        if (back && (obj.zone as string) === 'exile') {
          obj.card = back;
          obj.transformed = true;
          moveWithEvent(state, obj, 'battlefield', 'returned', emit);
          emit({ type: 'transformed', objectId: obj.id, cardName: back.name, back: true });
        }
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
        const anyOf = obj.card.enchant?.typeAnyOf;
        const hostGone =
          !host || host.zone !== 'battlefield' ||
          (anyOf ? !anyOf.some((t) => (t === 'Creature' ? isCreature(host) : host.card.types.includes(t))) : wants !== 'permanent' && !(wants === 'creature' ? isCreature(host) : host.card.types.includes(wantedType)));
        if (hostGone) {
          // Bestowed aura: becomes a creature again instead of dying (702.103).
          if (obj.bestowed) {
            obj.attachedTo = undefined;
            obj.bestowed = false;
            emit({ type: 'fizzled', description: `${obj.card.name} volta a ser uma criatura` });
            anyChange = true;
          } else if (obj.card.enchant) {
            moveWithEvent(state, obj, 'graveyard', 'destroyed', emit);
            changed = true;
            anyChange = true;
            break;
          } else {
            obj.attachedTo = undefined;
            anyChange = true;
          }
        }
      } else if (obj.card.enchant && !obj.bestowed) {
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
