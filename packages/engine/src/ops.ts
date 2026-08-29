/**
 * Primitive state operations. Every mutation of consequence lives here and
 * emits the events that describe it. effects.ts, combat.ts, sba.ts and
 * game.ts all funnel through these — one source of truth for "what happened".
 */
import type { GameEvent } from './events.js';
import { moveObject, type GameObject, type GameState } from './state.js';
import type { PlayerId, TargetChoice, ZoneName } from './types.js';

export type Emit = (ev: GameEvent) => void;

export function draw(state: GameState, playerId: PlayerId, emit: Emit): void {
  const player = state.players[playerId];
  const topId = player.zones.library[0];
  if (topId === undefined) {
    // Drawing from an empty library loses the game (SBA, applied immediately).
    lose(state, playerId, 'tentou comprar de uma biblioteca vazia', emit);
    return;
  }
  const obj = state.objects[topId];
  moveObject(state, obj, 'hand');
  emit({
    type: 'cardDrawn',
    player: playerId,
    objectId: obj.id,
    cardName: obj.card.name,
    hiddenFrom: playerId === 'p1' ? 'p2' : 'p1',
  });
}

export function changeLife(state: GameState, playerId: PlayerId, delta: number, reason: string, emit: Emit): void {
  if (delta === 0) return;
  const player = state.players[playerId];
  player.life += delta;
  emit({ type: 'lifeChanged', player: playerId, delta, total: player.life, reason });
}

export function dealDamageToObject(
  state: GameState,
  target: GameObject,
  amount: number,
  sourceName: string,
  emit: Emit,
  opts?: { deathtouch?: boolean; sourceColors?: import('./types.js').Color[] },
): void {
  if (amount <= 0) return;
  // Protection from [color]: all damage from sources of that color is prevented.
  const prot = target.card.protectionFrom;
  if (prot && opts?.sourceColors?.some((c) => prot.includes(c))) {
    emit({ type: 'damagePrevented', sourceName, targetName: target.card.name, amount });
    return;
  }
  // Planeswalkers take damage as loyalty loss.
  if (target.card.types.includes('Planeswalker')) {
    const total = Math.max(0, (target.counters['loyalty'] ?? 0) - amount);
    target.counters['loyalty'] = total;
    emit({
      type: 'damageDealt',
      sourceName,
      target: { kind: 'object', id: target.id },
      targetName: target.card.name,
      amount,
    });
    emit({ type: 'countersChanged', objectId: target.id, cardName: target.card.name, counter: 'loyalty', delta: -amount, total });
    return;
  }
  target.damage += amount;
  if (opts?.deathtouch) target.counters['__deathtouched'] = 1;
  emit({
    type: 'damageDealt',
    sourceName,
    target: { kind: 'object', id: target.id },
    targetName: target.card.name,
    amount,
  });
}

/**
 * Destruction with regeneration replacement (614.8): if the object has a
 * regeneration shield, consume it — tap, clear damage, leave combat —
 * instead of dying. Returns true if the object actually died.
 */
export function destroyObject(state: GameState, obj: GameObject, emit: Emit): boolean {
  if ((obj.counters['__regen'] ?? 0) > 0) {
    obj.counters['__regen'] -= 1;
    if (obj.counters['__regen'] === 0) delete obj.counters['__regen'];
    obj.damage = 0;
    delete obj.counters['__deathtouched'];
    obj.attacking = false;
    obj.blocking = undefined;
    if (!obj.tapped) setTapped(state, obj, true, emit);
    emit({ type: 'regenerated', objectId: obj.id, cardName: obj.card.name });
    return false;
  }
  moveWithEvent(state, obj, 'graveyard', 'destroyed', emit);
  return true;
}

export function dealDamageToPlayer(state: GameState, playerId: PlayerId, amount: number, sourceName: string, emit: Emit): void {
  if (amount <= 0) return;
  emit({
    type: 'damageDealt',
    sourceName,
    target: { kind: 'player', player: playerId },
    targetName: state.players[playerId].name,
    amount,
  });
  changeLife(state, playerId, -amount, `dano de ${sourceName}`, emit);
}

export function moveWithEvent(
  state: GameState,
  obj: GameObject,
  to: Exclude<ZoneName, 'stack'>,
  reason: NonNullable<Extract<GameEvent, { type: 'zoneChanged' }>['reason']>,
  emit: Emit,
  position: 'top' | 'bottom' = 'top',
): void {
  const from = obj.zone;
  const hidden = to === 'hand' || to === 'library';
  if (obj.isToken && to !== 'battlefield') {
    // Tokens cease to exist when they leave the battlefield.
    removeToken(state, obj);
    emit({ type: 'zoneChanged', objectId: obj.id, cardName: obj.card.name, from, to, player: obj.owner, reason });
    return;
  }
  moveObject(state, obj, to, position);
  emit({
    type: 'zoneChanged',
    objectId: obj.id,
    cardName: obj.card.name,
    from,
    to,
    player: obj.owner,
    reason,
    hiddenFrom: hidden && from !== 'battlefield' && from !== 'graveyard' && from !== 'stack' ? (obj.owner === 'p1' ? 'p2' : 'p1') : undefined,
  });
}

function removeToken(state: GameState, obj: GameObject): void {
  const arr = state.players[obj.controller].zones.battlefield;
  const i = arr.indexOf(obj.id);
  if (i >= 0) arr.splice(i, 1);
  delete state.objects[obj.id];
}

export function setTapped(state: GameState, obj: GameObject, tapped: boolean, emit: Emit): void {
  if (obj.tapped === tapped) return;
  obj.tapped = tapped;
  emit({ type: 'tappedChanged', objectId: obj.id, cardName: obj.card.name, tapped });
}

export function lose(state: GameState, playerId: PlayerId, reason: string, emit: Emit): void {
  if (state.status === 'finished') return;
  state.status = 'finished';
  const winner: PlayerId = playerId === 'p1' ? 'p2' : 'p1';
  state.winner = winner;
  state.priority = null;
  emit({ type: 'gameEnded', winner, reason: `${state.players[playerId].name} ${reason}` });
}

export function targetName(state: GameState, t: TargetChoice): string {
  return t.kind === 'player' ? state.players[t.player].name : state.objects[t.id]?.card.name ?? '?';
}
