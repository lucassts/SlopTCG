/**
 * Combat: declaration validation and automatic damage assignment.
 *
 * Damage runs in up to two sub-steps (510/508): if any combatant has first
 * or double strike, a first-strike step happens first (only FS/DS deal),
 * SBAs apply, then the normal step (everyone still alive without FS, plus
 * DS again). A blocked attacker whose blockers all died deals no damage to
 * the player unless it has trample.
 */
import type { Emit } from './ops.js';
import { changeLife, dealDamageToObject, dealDamageToPlayer } from './ops.js';
import { checkStateBasedActions } from './sba.js';
import {
  attachmentForbids,
  effectivePower,
  effectiveToughness,
  hasKeyword,
  type GameObject,
  type GameState,
} from './state.js';
import { opponentOf, type PlayerId } from './types.js';

export function canAttack(state: GameState, obj: GameObject): string | null {
  if (!obj.card.types.includes('Creature')) return 'não é uma criatura';
  if (obj.tapped) return 'está virada';
  if (obj.summoningSick && !hasKeyword(state, obj, 'haste')) return 'tem enjoo de invocação';
  if (hasKeyword(state, obj, 'defender')) return 'tem defensor';
  if (attachmentForbids(state, obj, 'cantAttack')) return 'não pode atacar (encantamento)';
  return null;
}

export function canBlock(state: GameState, blocker: GameObject, attacker: GameObject): string | null {
  if (!blocker.card.types.includes('Creature')) return 'não é uma criatura';
  if (blocker.tapped) return 'está virada';
  if (attachmentForbids(state, blocker, 'cantBlock')) return 'não pode bloquear (encantamento)';
  if (
    hasKeyword(state, attacker, 'flying') &&
    !hasKeyword(state, blocker, 'flying') &&
    !hasKeyword(state, blocker, 'reach')
  )
    return 'não alcança criaturas com voar';
  return null;
}

/** Resolve the combat damage step (both sub-steps + interleaved SBAs). */
export function resolveCombatDamage(state: GameState, emit: Emit): void {
  const dealsInFirstStrikeStep = (o: GameObject) =>
    hasKeyword(state, o, 'firstStrike') || hasKeyword(state, o, 'doubleStrike');
  const dealsInNormalStep = (o: GameObject) =>
    !hasKeyword(state, o, 'firstStrike') || hasKeyword(state, o, 'doubleStrike');

  const combatants = Object.values(state.objects).filter(
    (o) => o.zone === 'battlefield' && (o.attacking || o.blocking !== undefined),
  );
  if (combatants.some(dealsInFirstStrikeStep)) {
    dealCombatDamage(state, emit, dealsInFirstStrikeStep);
    checkStateBasedActions(state, emit);
  }
  dealCombatDamage(state, emit, dealsInNormalStep);
}

function dealCombatDamage(state: GameState, emit: Emit, deals: (o: GameObject) => boolean): void {
  if (state.status !== 'playing') return;
  const attackerId = state.activePlayer;
  const defender: PlayerId = opponentOf(attackerId);
  const attackers = state.players[attackerId].zones.battlefield
    .map((id) => state.objects[id])
    .filter((o) => o && o.attacking);

  for (const atk of attackers) {
    const blockers = state.players[defender].zones.battlefield
      .map((id) => state.objects[id])
      .filter((o) => o && o.blocking === atk.id);
    const atkDeals = deals(atk);
    const power = Math.max(0, effectivePower(state, atk));
    const lifelink = hasKeyword(state, atk, 'lifelink');
    const deathtouch = hasKeyword(state, atk, 'deathtouch');
    const trample = hasKeyword(state, atk, 'trample');

    if (atkDeals && power > 0) {
      if (!atk.wasBlocked) {
        dealDamageToPlayer(state, defender, power, atk.card.name, emit);
        if (lifelink) changeLife(state, atk.controller, power, `vínculo com a vida de ${atk.card.name}`, emit);
      } else if (blockers.length === 0) {
        // All blockers already died; only trample lets damage through.
        if (trample) {
          dealDamageToPlayer(state, defender, power, atk.card.name, emit);
          if (lifelink) changeLife(state, atk.controller, power, `vínculo com a vida de ${atk.card.name}`, emit);
        }
      } else {
        // Assign lethal to each blocker in order; deathtouch makes 1 lethal.
        let remaining = power;
        for (const blk of blockers) {
          if (remaining <= 0) break;
          const lethal = deathtouch ? 1 : Math.max(1, effectiveToughness(state, blk) - blk.damage);
          const isLast = blockers.indexOf(blk) === blockers.length - 1;
          const assigned = isLast && !trample ? remaining : Math.min(remaining, lethal);
          dealDamageToObject(state, blk, assigned, atk.card.name, emit, { deathtouch });
          remaining -= assigned;
        }
        if (remaining > 0 && trample) {
          dealDamageToPlayer(state, defender, remaining, atk.card.name, emit);
        }
        if (lifelink) changeLife(state, atk.controller, power, `vínculo com a vida de ${atk.card.name}`, emit);
      }
    }

    // Blockers hit back (simultaneously within this sub-step).
    for (const blk of blockers) {
      if (!deals(blk)) continue;
      const bPower = Math.max(0, effectivePower(state, blk));
      if (bPower > 0) {
        dealDamageToObject(state, atk, bPower, blk.card.name, emit, {
          deathtouch: hasKeyword(state, blk, 'deathtouch'),
        });
        if (hasKeyword(state, blk, 'lifelink'))
          changeLife(state, blk.controller, bPower, `vínculo com a vida de ${blk.card.name}`, emit);
      }
    }
  }
}

export function clearCombat(state: GameState): void {
  for (const id of Object.keys(state.objects)) {
    const obj = state.objects[Number(id)];
    obj.attacking = false;
    obj.blocking = undefined;
    obj.wasBlocked = false;
  }
}
