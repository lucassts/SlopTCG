/**
 * Primitive state operations. Every mutation of consequence lives here and
 * emits the events that describe it. effects.ts, combat.ts, sba.ts and
 * game.ts all funnel through these — one source of truth for "what happened".
 */
import type { GameEvent } from './events.js';
import { hasKeyword, moveObject, type GameObject, type GameState } from './state.js';
import type { PlayerId, TargetChoice, ZoneName } from './types.js';
import { shuffle } from './rng.js';

export type Emit = (ev: GameEvent) => void;

/** Runs when an object enters the battlefield through moveWithEvent (effects.ts registers the enter-tapped rules here). */
let enterHook: ((state: GameState, obj: GameObject, emit: Emit) => void) | null = null;
export function setEnterHook(fn: (state: GameState, obj: GameObject, emit: Emit) => void): void { enterHook = fn; }

export function draw(state: GameState, playerId: PlayerId, emit: Emit): void {
  const player = state.players[playerId];
  // Dredge: an armed graveyard card replaces this draw (mill N, return it) if the library allows. A replaced draw is not a draw (no "draws this turn").
  if (player.dredgeNext !== undefined) {
    const d = state.objects[player.dredgeNext];
    const n = d?.card.dredge ?? 0;
    player.dredgeNext = undefined;
    if (d && d.zone === 'graveyard' && n > 0 && player.zones.library.length >= n) {
      for (let i = 0; i < n; i++) {
        const top = player.zones.library[0];
        if (top === undefined) break;
        moveWithEvent(state, state.objects[top], 'graveyard', 'milled', emit);
      }
      moveWithEvent(state, d, 'hand', 'returned', emit);
      emit({ type: 'dredged', player: playerId, cardName: d.card.name, milled: n });
      return;
    }
  }
  player.drawsThisTurn += 1;
  const topId = player.zones.library[0];
  if (topId === undefined) {
    // Laboratory Maniac / Jace: "If you would draw a card while your library has no cards in it, you win the game instead."
    if (player.zones.battlefield.some((id) => state.objects[id]?.card.winOnDrawFromEmpty)) {
      const src = player.zones.battlefield.map((id) => state.objects[id]).find((o) => o?.card.winOnDrawFromEmpty)!;
      lose(state, playerId === 'p1' ? 'p2' : 'p1', `perdeu — ${player.name} tentou comprar com a biblioteca vazia e venceu com ${src.card.name}`, emit);
      return;
    }
    // Rule 704.5b: the player loses at the next state-based check, not immediately.
    player.drewFromEmptyLibrary = true;
    emit({ type: 'fizzled', description: `${player.name} tentou comprar uma carta com a biblioteca vazia` });
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
    nth: player.drawsThisTurn,
  });
}

export function changeLife(state: GameState, playerId: PlayerId, delta: number, reason: string, emit: Emit): void {
  if (delta === 0) return;
  const player = state.players[playerId];
  // "Players can't gain life" / "Your opponents can't gain life".
  if (delta > 0) {
    for (const pid of ['p1', 'p2'] as PlayerId[]) {
      for (const id of state.players[pid].zones.battlefield) {
        const g = state.objects[id].card.noLifeGain;
        if (g === 'all' || (g === 'opponents' && pid !== playerId)) return;
      }
    }
  }
  // "If you would gain life, you gain that much plus N / twice that much instead."
  if (delta > 0) {
    for (const id of player.zones.battlefield) {
      const mod = state.objects[id]?.card.lifeGainModifier;
      if (!mod) continue;
      if (mod.times) delta *= mod.times;
      if (mod.plus) delta += mod.plus;
    }
    player.lifeGainedThisTurn = (player.lifeGainedThisTurn ?? 0) + delta;
  }
  if (delta < 0) player.lifeLostThisTurn = (player.lifeLostThisTurn ?? 0) - delta;
  player.life += delta;
  emit({ type: 'lifeChanged', player: playerId, delta, total: player.life, reason });
}

export function addPoison(state: GameState, playerId: PlayerId, count: number, emit: Emit): void {
  if (count <= 0) return;
  const p = state.players[playerId];
  p.poison += count;
  emit({ type: 'poisonChanged', player: playerId, delta: count, total: p.poison });
}

export function dealDamageToObject(
  state: GameState,
  target: GameObject,
  amount: number,
  sourceName: string,
  emit: Emit,
  opts?: { deathtouch?: boolean; sourceColors?: import('./types.js').Color[]; infect?: boolean; wither?: boolean; sourceId?: number; combat?: boolean },
): void {
  if (amount <= 0) return;
  // Protection from [color]: all damage from sources of that color is prevented.
  const prot = target.card.protectionFrom;
  if (prot && opts?.sourceColors?.some((c) => prot.includes(c))) {
    emit({ type: 'damagePrevented', sourceName, targetName: target.card.name, amount });
    return;
  }
  // Protection from creatures: damage from creature sources is prevented.
  if (opts?.sourceId !== undefined && state.objects[opts.sourceId]?.card.types.includes('Creature') && hasKeyword(state, target, 'protectionFromCreatures')) {
    emit({ type: 'damagePrevented', sourceName, targetName: target.card.name, amount });
    return;
  }
  // Prevention: "prevent all damage that would be dealt to ~" / shields for this turn / "the next N damage".
  if (target.card.preventAllDamageToSelf || target.preventAllThisTurn) {
    emit({ type: 'damagePrevented', sourceName, targetName: target.card.name, amount });
    return;
  }
  // "Prevent all damage that would be dealt by ~" (source flag, or an aura on the source).
  const srcObj = opts?.sourceId !== undefined ? state.objects[opts.sourceId] : undefined;
  if (srcObj && (srcObj.card.preventsOwnDamage || Object.values(state.objects).some((a) => a.zone === 'battlefield' && a.attachedTo === srcObj.id && a.card.attachEffect?.preventsDamage))) {
    emit({ type: 'damagePrevented', sourceName, targetName: target.card.name, amount });
    return;
  }
  // "If damage would be dealt to ~, prevent that damage. Remove a +1/+1 counter from ~."
  if (target.card.preventDamageRemoveCounter && (target.counters[target.card.preventDamageRemoveCounter] ?? 0) > 0) {
    const c = target.card.preventDamageRemoveCounter;
    target.counters[c] -= 1;
    emit({ type: 'countersChanged', objectId: target.id, cardName: target.card.name, counter: c, delta: -1, total: target.counters[c] });
    emit({ type: 'damagePrevented', sourceName, targetName: target.card.name, amount });
    return;
  }
  if (opts?.sourceId !== undefined) target.damagedByThisTurn = [...(target.damagedByThisTurn ?? []), opts.sourceId];
  if ((target.preventNext ?? 0) > 0) {
    const prevented = Math.min(amount, target.preventNext!);
    target.preventNext! -= prevented;
    amount -= prevented;
    emit({ type: 'damagePrevented', sourceName, targetName: target.card.name, amount: prevented });
    if (amount <= 0) return;
  }
  // Infect / wither: damage to creatures becomes -1/-1 counters.
  if ((opts?.infect || opts?.wither) && (target.card.types.includes('Creature') || target.crewedUntilEot)) {
    const total = (target.counters['-1/-1'] ?? 0) + amount;
    target.counters['-1/-1'] = total;
    emit({ type: 'countersChanged', objectId: target.id, cardName: target.card.name, counter: '-1/-1', delta: amount, total });
    return;
  }
  // Planeswalkers take damage as loyalty loss.
  if (target.card.types.includes('Planeswalker')) {
    const total = Math.max(0, (target.counters['loyalty'] ?? 0) - amount);
    target.counters['loyalty'] = total;
    emit({
      type: 'damageDealt',
      sourceName,
      sourceId: opts?.sourceId,
      combat: opts?.combat,
      target: { kind: 'object', id: target.id },
      targetName: target.card.name,
      amount,
    });
    emit({ type: 'countersChanged', objectId: target.id, cardName: target.card.name, counter: 'loyalty', delta: -amount, total });
    return;
  }
  // Battles take damage as defense loss.
  if (target.card.types.includes('Battle')) {
    const total = Math.max(0, (target.counters['defense'] ?? 0) - amount);
    target.counters['defense'] = total;
    emit({ type: 'damageDealt', sourceName, sourceId: opts?.sourceId, combat: opts?.combat, target: { kind: 'object', id: target.id }, targetName: target.card.name, amount });
    emit({ type: 'countersChanged', objectId: target.id, cardName: target.card.name, counter: 'defense', delta: -amount, total });
    return;
  }
  target.damage += amount;
  if (opts?.deathtouch) target.counters['__deathtouched'] = 1;
  emit({
    type: 'damageDealt',
    sourceName,
    sourceId: opts?.sourceId,
    combat: opts?.combat,
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
  if ((obj.counters['__regen'] ?? 0) > 0 || obj.card.autoRegenerate) {
    if ((obj.counters['__regen'] ?? 0) > 0) obj.counters['__regen'] -= 1;
    if (obj.counters['__regen'] === 0) delete obj.counters['__regen'];
    obj.damage = 0;
    delete obj.counters['__deathtouched'];
    obj.attacking = false;
    obj.blocking = undefined;
    if (!obj.tapped) setTapped(state, obj, true, emit);
    emit({ type: 'regenerated', objectId: obj.id, cardName: obj.card.name });
    return false;
  }
  // Umbra armor: destroy the aura instead, and heal the creature.
  const umbra = Object.values(state.objects).find((a) => a.zone === 'battlefield' && a.attachedTo === obj.id && a.card.umbraArmor);
  if (umbra) {
    obj.damage = 0;
    delete obj.counters['__deathtouched'];
    moveWithEvent(state, umbra, 'graveyard', 'destroyed', emit);
    emit({ type: 'fizzled', description: `${umbra.card.name} (armadura umbra) foi destruída no lugar de ${obj.card.name}` });
    return false;
  }
  moveWithEvent(state, obj, 'graveyard', 'destroyed', emit);
  return true;
}

export function dealDamageToPlayer(
  state: GameState,
  playerId: PlayerId,
  amount: number,
  sourceName: string,
  emit: Emit,
  opts?: { infect?: boolean; toxic?: number; sourceId?: number; combat?: boolean },
): void {
  if ((state.players[playerId].protectedUntilTurn ?? -1) > state.turn) { emit({ type: 'fizzled', description: `${state.players[playerId].name}: dano prevenido (proteção contra tudo)` }); return; }
  if (amount <= 0) return;
  const ps = state.players[playerId];
  if (ps.preventAllThisTurn) {
    emit({ type: 'damagePrevented', sourceName, targetName: ps.name, amount });
    return;
  }
  const srcObj = opts?.sourceId !== undefined ? state.objects[opts.sourceId] : undefined;
  if (srcObj && (srcObj.card.preventsOwnDamage || Object.values(state.objects).some((a) => a.zone === 'battlefield' && a.attachedTo === srcObj.id && a.card.attachEffect?.preventsDamage))) {
    emit({ type: 'damagePrevented', sourceName, targetName: ps.name, amount });
    return;
  }
  if ((ps.preventNext ?? 0) > 0) {
    const prevented = Math.min(amount, ps.preventNext!);
    ps.preventNext! -= prevented;
    amount -= prevented;
    emit({ type: 'damagePrevented', sourceName, targetName: ps.name, amount: prevented });
    if (amount <= 0) return;
  }
  emit({
    type: 'damageDealt',
    sourceName,
    sourceId: opts?.sourceId,
    combat: opts?.combat,
    target: { kind: 'player', player: playerId },
    targetName: state.players[playerId].name,
    amount,
  });
  state.players[playerId].damagedThisTurn = true; // bloodthirst
  // Infect: poison instead of life. Toxic N: life AND N poison.
  if (opts?.infect) {
    addPoison(state, playerId, amount, emit);
    return;
  }
  changeLife(state, playerId, -amount, `dano de ${sourceName}`, emit);
  if (opts?.toxic) addPoison(state, playerId, opts.toxic, emit);
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
  // Unearth: if it would leave the battlefield, exile it instead.
  if (obj.unearthed && from === 'battlefield' && to !== 'exile') to = 'exile';
  // "If ~ would die, exile it instead" / "If a creature (an opponent controls) would die, exile it instead."
  if (from === 'battlefield' && to === 'graveyard' && !obj.isToken) {
    const dyingCreature = obj.card.types.includes('Creature');
    const staticExile = dyingCreature && (['p1', 'p2'] as PlayerId[]).some((p) =>
      state.players[p].zones.battlefield.some((id) => {
        const mode = state.objects[id]?.card.exileDyingCreatures;
        return mode === 'all' || (mode === 'opponents' && p !== obj.controller);
      }),
    );
    if (obj.card.exileInsteadOfDying || staticExile || obj.exileIfDiesThisTurn) to = 'exile';
  }
  // "If ~ would be put into a graveyard from anywhere, shuffle it into its owner's library instead."
  if (to === 'graveyard' && obj.card.shuffleInsteadOfGraveyard && !obj.isToken) {
    moveObject(state, obj, 'library', 'bottom');
    const r = shuffle(state.players[obj.owner].zones.library, state.rngState);
    state.players[obj.owner].zones.library = r.items;
    state.rngState = r.state;
    emit({ type: 'zoneChanged', objectId: obj.id, cardName: obj.card.name, from, to: 'library', player: obj.owner, reason });
    return;
  }
  // "If ~ would be put into a graveyard from anywhere, exile it instead." (disturb back faces).
  if (to === 'graveyard' && obj.card.exileInsteadOfGraveyard && !obj.isToken) to = 'exile';
  // Gaea's Will: "If a card would be put into your graveyard from anywhere this turn, exile that card instead."
  if (to === 'graveyard' && !obj.isToken && state.players[obj.owner].exileInsteadOfGraveyardUntilTurn === state.turn) to = 'exile';
  // Grafdigger's Cage: creature cards in graveyards and libraries can't enter the battlefield.
  if (to === 'battlefield' && (from === 'graveyard' || from === 'library') && obj.card.types.includes('Creature') &&
    (['p1', 'p2'] as PlayerId[]).some((p) => state.players[p].zones.battlefield.some((id) => state.objects[id]?.card.cageNoEnterFromGraveyardLibrary))) {
    emit({ type: 'fizzled', description: `${obj.card.name}: não pode entrar no campo de batalha (Grafdigger's Cage)` });
    return;
  }
  // Containment Priest: a nontoken creature that wasn't cast is exiled instead of entering.
  if (to === 'battlefield' && from !== 'stack' && !obj.isToken && obj.card.types.includes('Creature') && !obj.wasCast &&
    (['p1', 'p2'] as PlayerId[]).some((p) => state.players[p].zones.battlefield.some((id) => state.objects[id]?.card.exileNoncastCreatures))) {
    emit({ type: 'fizzled', description: `${obj.card.name}: exilada em vez de entrar (Containment Priest)` });
    to = 'exile';
  }
  // Animate Dead: when the Aura leaves, the creature it brought back is sacrificed.
  if (from === 'battlefield' && obj.card.reanimateAura && obj.attachedTo !== undefined) {
    const host = state.objects[obj.attachedTo];
    obj.attachedTo = undefined;
    if (host && host.zone === 'battlefield') moveWithEvent(state, host, 'graveyard', 'sacrificed', emit);
  }
  // Rest in Peace / Leyline of the Void.
  if (to === 'graveyard' && !obj.isToken && (['p1', 'p2'] as PlayerId[]).some((p) => state.players[p].zones.battlefield.some((id) => {
    const mode = state.objects[id]?.card.exileInsteadOfGraveyardFor;
    return mode === 'all' || (mode === 'opponents' && p !== obj.owner);
  }))) to = 'exile';
  // Turn bookkeeping for conditions (morbid, revolt, celebration).
  if (from === 'battlefield') {
    const ps = state.players[obj.controller];
    ps.permanentsLeftThisTurn = (ps.permanentsLeftThisTurn ?? 0) + 1;
    if (to === 'graveyard' && (obj.card.types.includes('Creature') || obj.crewedUntilEot)) state.creaturesDiedThisTurn = (state.creaturesDiedThisTurn ?? 0) + 1;
  }
  if (to === 'battlefield' && !obj.card.types.includes('Land')) {
    const ps = state.players[obj.controller];
    ps.nonlandEnteredThisTurn = (ps.nonlandEnteredThisTurn ?? 0) + 1;
  }
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
  // Lands (and everything else) put onto the battlefield by an effect follow the same enter-tapped rules as a played/cast one.
  if (to === 'battlefield' && from !== 'battlefield' && reason !== 'manual') enterHook?.(state, obj, emit);
  // Earthbend: "When it dies or is exiled, return it to the battlefield tapped."
  if (obj.earthbendReturn && from === 'battlefield' && (to === 'graveyard' || to === 'exile')) {
    obj.earthbendReturn = undefined;
    moveObject(state, obj, 'battlefield');
    obj.tapped = true;
    emit({ type: 'zoneChanged', objectId: obj.id, cardName: obj.card.name, from: to, to: 'battlefield', player: obj.owner, reason: 'returned' });
    emit({ type: 'fizzled', description: `${obj.card.name} volta ao campo de batalha virado (earthbend)` });
  }
}

function removeToken(state: GameState, obj: GameObject): void {
  const arr = state.players[obj.controller].zones.battlefield;
  const i = arr.indexOf(obj.id);
  if (i >= 0) arr.splice(i, 1);
  (state.lki ??= {})[obj.id] = obj;
  delete state.objects[obj.id];
}

/** Transform / flip a double-faced permanent (no-op when it has no back face). */
export function transformObject(state: GameState, obj: GameObject, emit: Emit): boolean {
  const base = obj.baseCard;
  if (!base?.backFace || obj.zone !== 'battlefield') return false;
  obj.transformed = !obj.transformed;
  obj.card = obj.transformed ? base.backFace : base;
  emit({ type: 'transformed', objectId: obj.id, cardName: obj.card.name, back: !!obj.transformed });
  void state;
  return true;
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
