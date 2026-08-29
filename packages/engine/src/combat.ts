/**
 * Combat: declaration validation and automatic damage assignment.
 * MVP: no first strike sub-step; blocked attackers assign lethal damage to
 * blockers in declaration order, trample overflows to the defending player.
 */
import type { Emit } from './ops.js';
import { changeLife, dealDamageToObject, dealDamageToPlayer } from './ops.js';
import {
  effectivePower,
  effectiveToughness,
  hasKeyword,
  type GameObject,
  type GameState,
} from './state.js';
import { opponentOf, type PlayerId } from './types.js';

export function canAttack(obj: GameObject): string | null {
  if (!obj.card.types.includes('Creature')) return 'não é uma criatura';
  if (obj.tapped) return 'está virada';
  if (obj.summoningSick && !hasKeyword(obj, 'haste')) return 'tem enjoo de invocação';
  if (hasKeyword(obj, 'defender')) return 'tem defensor';
  return null;
}

export function canBlock(blocker: GameObject, attacker: GameObject): string | null {
  if (!blocker.card.types.includes('Creature')) return 'não é uma criatura';
  if (blocker.tapped) return 'está virada';
  if (hasKeyword(attacker, 'flying') && !hasKeyword(blocker, 'flying') && !hasKeyword(blocker, 'reach'))
    return 'não alcança criaturas com voar';
  return null;
}

/** Resolve the combat damage step. Attackers/blocking marks are on objects. */
export function resolveCombatDamage(state: GameState, emit: Emit): void {
  const attackerId = state.activePlayer;
  const defender: PlayerId = opponentOf(attackerId);
  const attackers = state.players[attackerId].zones.battlefield
    .map((id) => state.objects[id])
    .filter((o) => o.attacking);

  for (const atk of attackers) {
    const blockers = state.players[defender].zones.battlefield
      .map((id) => state.objects[id])
      .filter((o) => o.blocking === atk.id);
    const power = Math.max(0, effectivePower(atk));
    const lifelink = hasKeyword(atk, 'lifelink');
    const deathtouch = hasKeyword(atk, 'deathtouch');

    if (blockers.length === 0) {
      if (power > 0) {
        dealDamageToPlayer(state, defender, power, atk.card.name, emit);
        if (lifelink) changeLife(state, atk.controller, power, `vínculo com a vida de ${atk.card.name}`, emit);
      }
    } else {
      // Assign lethal to each blocker in order; deathtouch makes 1 lethal.
      let remaining = power;
      for (const blk of blockers) {
        if (remaining <= 0) break;
        const lethal = deathtouch ? 1 : Math.max(1, effectiveToughness(blk) - blk.damage);
        const assigned = blockers.indexOf(blk) === blockers.length - 1 && !hasKeyword(atk, 'trample')
          ? remaining
          : Math.min(remaining, lethal);
        dealDamageToObject(state, blk, assigned, atk.card.name, emit, { deathtouch });
        remaining -= assigned;
      }
      if (remaining > 0 && hasKeyword(atk, 'trample')) {
        dealDamageToPlayer(state, defender, remaining, atk.card.name, emit);
      }
      if (lifelink && power > 0) changeLife(state, atk.controller, power, `vínculo com a vida de ${atk.card.name}`, emit);

      // Blockers hit back simultaneously.
      for (const blk of blockers) {
        const bPower = Math.max(0, effectivePower(blk));
        if (bPower > 0) {
          dealDamageToObject(state, atk, bPower, blk.card.name, emit, { deathtouch: hasKeyword(blk, 'deathtouch') });
          if (hasKeyword(blk, 'lifelink'))
            changeLife(state, blk.controller, bPower, `vínculo com a vida de ${blk.card.name}`, emit);
        }
      }
    }
  }
}

export function clearCombat(state: GameState): void {
  for (const id of Object.keys(state.objects)) {
    const obj = state.objects[Number(id)];
    obj.attacking = false;
    obj.blocking = undefined;
  }
}
