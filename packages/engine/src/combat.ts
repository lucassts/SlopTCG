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
  isCreature,
  type GameObject,
  type GameState,
} from './state.js';
import { opponentOf, type PlayerId } from './types.js';

export function canAttack(state: GameState, obj: GameObject): string | null {
  if (!isCreature(obj)) return 'não é uma criatura';
  if (obj.tapped) return 'está virada';
  if (obj.summoningSick && !hasKeyword(state, obj, 'haste')) return 'tem enjoo de invocação';
  if (hasKeyword(state, obj, 'defender')) return 'tem defensor';
  if (hasKeyword(state, obj, 'cantAttack')) return 'não pode atacar';
  // Ensnaring Bridge: power greater than the number of cards in the Bridge controller's hand.
  for (const p of ['p1', 'p2'] as PlayerId[]) for (const id of state.players[p].zones.battlefield) {
    if (state.objects[id]?.card.ensnaringBridge && effectivePower(state, obj) > state.players[p].zones.hand.length) return `Ensnaring Bridge: poder maior que as ${state.players[p].zones.hand.length} carta(s) na mão do controlador`;
  }
  if ((obj.cantAttackUntilTurn ?? -1) >= state.turn) return 'não pode atacar até o próximo turno do controlador';
  if (obj.card.attackRequiresDefenderSubtype) {
    const sub = obj.card.attackRequiresDefenderSubtype;
    const defender = state.players[opponentOf(obj.controller)];
    if (!defender.zones.battlefield.some((id) => state.objects[id].card.subtypes.includes(sub))) return `só pode atacar se o defensor controlar ${sub}`;
  }
  if (attachmentForbids(state, obj, 'cantAttack')) return 'não pode atacar (encantamento)';
  return null;
}

const LANDWALK: [import('./types.js').Keyword, string][] = [
  ['plainswalk', 'Plains'],
  ['islandwalk', 'Island'],
  ['swampwalk', 'Swamp'],
  ['mountainwalk', 'Mountain'],
  ['forestwalk', 'Forest'],
];

export function canBlock(state: GameState, blocker: GameObject, attacker: GameObject): string | null {
  if (!isCreature(blocker)) return 'não é uma criatura';
  if (blocker.tapped) return 'está virada';
  if (attacker.card.evasionPowerAtMost !== undefined && effectivePower(state, blocker) <= attacker.card.evasionPowerAtMost)
    return `o atacante não pode ser bloqueado por criaturas com poder ${attacker.card.evasionPowerAtMost} ou menos`;
  if (attacker.card.evasionPowerAtLeast !== undefined && effectivePower(state, blocker) >= attacker.card.evasionPowerAtLeast)
    return `o atacante não pode ser bloqueado por criaturas com poder ${attacker.card.evasionPowerAtLeast} ou mais`;
  if (attacker.card.skulk && effectivePower(state, blocker) > effectivePower(state, attacker))
    return 'esgueirar: não pode ser bloqueado por criaturas com poder maior';
  if (attacker.card.evasionPowerLessThanSelf && effectivePower(state, blocker) < effectivePower(state, attacker))
    return 'não pode ser bloqueado por criaturas com poder menor';
  const cbb = attacker.card.cantBeBlockedBy;
  if (cbb) {
    if (cbb.types?.some((t) => blocker.card.types.includes(t))) return `não pode ser bloqueado por ${cbb.types.join('/')}`;
    if (cbb.subtypes?.some((t) => blocker.card.subtypes.includes(t))) return `não pode ser bloqueado por ${cbb.subtypes.join('/')}`;
    if (cbb.colors?.some((c) => blocker.card.colors.includes(c))) return 'não pode ser bloqueado por criaturas dessa cor';
  }
  if (hasKeyword(state, blocker, 'cantBlock')) return 'não pode bloquear';
  if (attachmentForbids(state, blocker, 'cantBlock')) return 'não pode bloquear (encantamento)';
  if (hasKeyword(state, attacker, 'unblockable')) return 'o atacante não pode ser bloqueado';
  if (
    hasKeyword(state, attacker, 'flying') &&
    !hasKeyword(state, blocker, 'flying') &&
    !hasKeyword(state, blocker, 'reach')
  )
    return 'não alcança criaturas com voar';
  // Evasões clássicas.
  const isArtifact = blocker.card.types.includes('Artifact');
  if (hasKeyword(state, attacker, 'fear') && !isArtifact && !blocker.card.colors.includes('B'))
    return 'medo: só criaturas artefato ou pretas bloqueiam';
  if (
    hasKeyword(state, attacker, 'intimidate') &&
    !isArtifact &&
    !blocker.card.colors.some((c) => attacker.card.colors.includes(c))
  )
    return 'intimidar: só artefatos ou criaturas da mesma cor bloqueiam';
  if (hasKeyword(state, attacker, 'shadow') !== hasKeyword(state, blocker, 'shadow'))
    return 'sombra: só criaturas com sombra bloqueiam (e são bloqueadas por) criaturas com sombra';
  if (hasKeyword(state, attacker, 'horsemanship') !== hasKeyword(state, blocker, 'horsemanship'))
    return 'horsemanship: só criaturas com horsemanship bloqueiam (e são bloqueadas por) criaturas com horsemanship';
  if (hasKeyword(state, blocker, 'blockOnlyFlying') && !hasKeyword(state, attacker, 'flying'))
    return 'só pode bloquear criaturas com voar';
  for (const [kw, land] of LANDWALK) {
    if (
      hasKeyword(state, attacker, kw) &&
      state.players[blocker.controller].zones.battlefield.some((id) =>
        state.objects[id].card.subtypes.includes(land),
      )
    )
      return `${land.toLowerCase()}walk: não pode ser bloqueado enquanto o defensor controla ${land}`;
  }
  if (hasKeyword(state, attacker, 'protectionFromCreatures')) return 'proteção contra criaturas: não pode ser bloqueado';
  // Protection: the attacker can't be blocked by creatures of those colors.
  if ([...(attacker.card.protectionFrom ?? []), ...(attacker.protectionUntilEot ?? [])].some((c) => blocker.card.colors.includes(c)))
    return `o atacante tem proteção contra as cores do bloqueador`;
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
  if (state.combatDamagePrevented) return; // Fog
  state.combatDamageThisTurn = true;

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
    const atkOpts = { deathtouch, sourceColors: atk.card.colors, infect: atk.card.infect, wither: atk.card.wither, sourceId: atk.id, combat: true };

    // Unblocked damage goes to the attacked planeswalker, if one was chosen
    // and is still around; otherwise to the defending player.
    const pw = atk.pwTarget !== undefined ? state.objects[atk.pwTarget] : undefined;
    const hitFace = () => {
      if (pw && pw.zone === 'battlefield') {
        dealDamageToObject(state, pw, power, atk.card.name, emit, { sourceColors: atk.card.colors, sourceId: atk.id, combat: true });
      } else {
        dealDamageToPlayer(state, defender, power, atk.card.name, emit, { infect: atk.card.infect, toxic: atk.card.toxic, sourceId: atk.id, combat: true });
        emit({ type: 'combatDamageToPlayer', attackerId: atk.id, player: defender, amount: power });
      }
      if (lifelink) changeLife(state, atk.controller, power, `vínculo com a vida de ${atk.card.name}`, emit);
    };

    if (atkDeals && power > 0) {
      if (!atk.wasBlocked || atk.card.assignAsUnblocked) {
        hitFace();
      } else if (blockers.length === 0) {
        // All blockers already died; only trample lets damage through.
        if (trample) hitFace();
      } else {
        // Assign lethal to each blocker in order; deathtouch makes 1 lethal.
        let remaining = power;
        for (const blk of blockers) {
          if (remaining <= 0) break;
          const lethal = deathtouch ? 1 : Math.max(1, effectiveToughness(state, blk) - blk.damage);
          const isLast = blockers.indexOf(blk) === blockers.length - 1;
          const assigned = isLast && !trample ? remaining : Math.min(remaining, lethal);
          dealDamageToObject(state, blk, assigned, atk.card.name, emit, atkOpts);
          remaining -= assigned;
        }
        if (remaining > 0 && trample) {
          if (pw && pw.zone === 'battlefield')
            dealDamageToObject(state, pw, remaining, atk.card.name, emit, { sourceColors: atk.card.colors, sourceId: atk.id, combat: true });
          else {
            dealDamageToPlayer(state, defender, remaining, atk.card.name, emit, { infect: atk.card.infect, toxic: atk.card.toxic, sourceId: atk.id, combat: true });
            emit({ type: 'combatDamageToPlayer', attackerId: atk.id, player: defender, amount: remaining });
          }
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
          sourceColors: blk.card.colors,
          infect: blk.card.infect,
          wither: blk.card.wither,
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
    obj.pwTarget = undefined;
  }
}
