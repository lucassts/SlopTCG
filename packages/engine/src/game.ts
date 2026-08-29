/**
 * The Game orchestrator: applies PlayerActions, runs the turn/priority state
 * machine, the stack, triggers and SBAs, and emits GameEvents.
 *
 * Flow after every action: run action → SBAs → collect triggers → advance
 * (resolve stack / move steps) until a player has a real decision to make.
 */
import type { PlayerAction } from './actions.js';
import type { ActivatedAbility, CardDefinition, PlayerConfig, TargetSpec } from './cards/types.js';
import { isPermanentCard } from './cards/types.js';
import { canAttack, canBlock, clearCombat, resolveCombatDamage } from './combat.js';
import { itemStillHasLegalWork, runEffectScript, targetMatchesSpec } from './effects.js';
import type { GameEvent } from './events.js';
import { canPay, parseCost, planPayment } from './mana.js';
import { changeLife, draw, lose, moveWithEvent, setTapped } from './ops.js';
import { checkStateBasedActions } from './sba.js';
import {
  createGameState,
  hasKeyword,
  MAX_HAND_SIZE,
  removeFromCurrentZone,
  STARTING_HAND,
  type GameObject,
  type GameState,
  type StackItem,
} from './state.js';
import { shuffle, nextRandom } from './rng.js';
import { opponentOf, PLAYER_IDS, STEP_ORDER, type PlayerId, type Step, type TargetChoice } from './types.js';

export interface ApplyResult {
  ok: boolean;
  events: GameEvent[];
}

export interface GameOptions {
  /** Force who goes first (otherwise decided by the seeded RNG). */
  firstPlayer?: PlayerId;
}

export class Game {
  state: GameState;
  private buf: GameEvent[] = [];
  private triggerCursor = 0;
  private options: GameOptions;

  constructor(players: PlayerConfig[], seed: number, options: GameOptions = {}) {
    this.state = createGameState(players, seed);
    this.options = options;
  }

  private emit = (ev: GameEvent): void => {
    this.buf.push(ev);
  };

  /** Deal opening hands and start turn 1. Call exactly once. */
  start(): GameEvent[] {
    this.buf = [];
    this.triggerCursor = 0;
    const s = this.state;
    const r = nextRandom(s.rngState);
    s.rngState = r.state;
    const first: PlayerId = this.options.firstPlayer ?? (r.value < 0.5 ? 'p1' : 'p2');
    s.onThePlay = first;
    s.activePlayer = first;
    this.emit({
      type: 'gameStarted',
      players: PLAYER_IDS.map((p) => ({ id: p, name: s.players[p].name })),
      seed: s.seed,
      onThePlay: first,
    });
    for (const p of PLAYER_IDS) {
      this.emit({ type: 'shuffled', player: p });
      for (let i = 0; i < STARTING_HAND; i++) draw(s, p, this.emit);
    }
    s.turn = 1;
    this.emit({ type: 'turnBegan', turn: 1, activePlayer: first });
    this.enterStep('untap');
    this.advanceLoop();
    return this.flush();
  }

  apply(playerId: PlayerId, action: PlayerAction): ApplyResult {
    this.buf = [];
    this.triggerCursor = 0;
    const s = this.state;

    if (s.status === 'finished' && action.type !== 'chat') {
      return this.fail(playerId, 'a partida já terminou');
    }

    try {
      const isManual = action.type.startsWith('manual');
      const ok = this.execute(playerId, action);
      if (!ok) return { ok: false, events: this.flush() };
      if (!isManual && action.type !== 'chat' && s.status === 'playing') {
        checkStateBasedActions(s, this.emit);
        this.scanTriggers();
        this.advanceLoop();
      }
      return { ok: true, events: this.flush() };
    } catch (err) {
      return this.fail(playerId, err instanceof Error ? err.message : 'erro interno');
    }
  }

  private flush(): GameEvent[] {
    const out = this.buf;
    this.buf = [];
    return out;
  }

  private fail(playerId: PlayerId, message: string): ApplyResult {
    this.buf.push({ type: 'error', player: playerId, message });
    return { ok: false, events: this.flush() };
  }

  // ---------------------------------------------------------------- actions

  private execute(playerId: PlayerId, action: PlayerAction): boolean {
    const s = this.state;
    switch (action.type) {
      case 'chat':
        this.emit({ type: 'chat', player: playerId, text: action.text.slice(0, 500) });
        return true;
      case 'concede':
        lose(s, playerId, 'concedeu a partida', this.emit);
        return true;
      case 'passPriority':
        return this.doPassPriority(playerId);
      case 'playLand':
        return this.doPlayLand(playerId, action.objectId);
      case 'castSpell':
        return this.doCastSpell(playerId, action.objectId, action.targets ?? []);
      case 'activateAbility':
        return this.doActivateAbility(playerId, action.objectId, action.abilityIndex, action.targets ?? []);
      case 'declareAttackers':
        return this.doDeclareAttackers(playerId, action.attackers);
      case 'declareBlockers':
        return this.doDeclareBlockers(playerId, action.blocks);
      case 'chooseDiscard':
        return this.doChooseDiscard(playerId, action.objectIds);
      default:
        return this.doManual(playerId, action);
    }
  }

  private requirePriority(playerId: PlayerId): string | null {
    const s = this.state;
    if (s.pendingDecision) return 'há uma decisão pendente';
    if (s.combatAwaiting) return 'aguardando declaração de combate';
    if (s.priority !== playerId) return 'você não tem a prioridade';
    return null;
  }

  private sorceryTiming(playerId: PlayerId): boolean {
    const s = this.state;
    return (
      s.activePlayer === playerId &&
      (s.step === 'main1' || s.step === 'main2') &&
      s.stack.length === 0
    );
  }

  private doPassPriority(playerId: PlayerId): boolean {
    const s = this.state;
    if (s.pendingDecision) {
      this.fail(playerId, 'há uma decisão pendente');
      return false;
    }
    if (s.combatAwaiting === 'attackers' && playerId === s.activePlayer) {
      // Passing while attack declaration is due = attacking with nothing.
      return this.doDeclareAttackers(playerId, []);
    }
    if (s.combatAwaiting === 'blockers' && playerId === opponentOf(s.activePlayer)) {
      return this.doDeclareBlockers(playerId, []);
    }
    if (s.priority !== playerId) {
      this.fail(playerId, 'você não tem a prioridade');
      return false;
    }
    s.passCount += 1;
    s.priority = opponentOf(playerId);
    return true;
  }

  private doPlayLand(playerId: PlayerId, objectId: number): boolean {
    const s = this.state;
    const err = this.requirePriority(playerId);
    if (err) { this.fail(playerId, err); return false; }
    const obj = s.objects[objectId];
    if (!obj || obj.zone !== 'hand' || obj.owner !== playerId)
      { this.fail(playerId, 'carta inválida'); return false; }
    if (!obj.card.types.includes('Land'))
      { this.fail(playerId, 'isso não é um terreno'); return false; }
    if (!this.sorceryTiming(playerId))
      { this.fail(playerId, 'terrenos só podem ser jogados na sua fase principal com a pilha vazia'); return false; }
    if (s.players[playerId].landsPlayedThisTurn >= 1)
      { this.fail(playerId, 'você já jogou um terreno neste turno'); return false; }

    removeFromCurrentZone(s, obj);
    obj.zone = 'battlefield';
    s.players[playerId].zones.battlefield.push(obj.id);
    obj.summoningSick = false;
    s.players[playerId].landsPlayedThisTurn += 1;
    s.passCount = 0;
    this.emit({ type: 'landPlayed', player: playerId, objectId: obj.id, cardName: obj.card.name });
    return true;
  }

  private validateTargets(
    playerId: PlayerId,
    specs: TargetSpec[] | undefined,
    targets: TargetChoice[],
  ): string | null {
    const required = specs ?? [];
    if (targets.length !== required.filter((t) => !t.optional).length && targets.length !== required.length)
      return 'número de alvos incorreto';
    for (let i = 0; i < targets.length; i++) {
      const spec = required[i];
      if (!spec) return 'alvo em excesso';
      if (!targetMatchesSpec(this.state, playerId, spec, targets[i])) return 'alvo ilegal';
    }
    return null;
  }

  private doCastSpell(playerId: PlayerId, objectId: number, targets: TargetChoice[]): boolean {
    const s = this.state;
    const err = this.requirePriority(playerId);
    if (err) { this.fail(playerId, err); return false; }
    const obj = s.objects[objectId];
    if (!obj || obj.zone !== 'hand' || obj.owner !== playerId)
      { this.fail(playerId, 'carta inválida'); return false; }
    const card = obj.card;
    if (card.types.includes('Land'))
      { this.fail(playerId, 'terrenos são jogados, não conjurados'); return false; }
    if (card.automation === 'manual')
      { this.fail(playerId, `${card.name} ainda não é automatizada — use o modo manual`); return false; }
    const isInstant = card.types.includes('Instant');
    if (!isInstant && !this.sorceryTiming(playerId))
      { this.fail(playerId, 'só pode ser conjurada na sua fase principal com a pilha vazia'); return false; }

    const targetErr = this.validateTargets(playerId, card.spellTargets, targets);
    if (targetErr) { this.fail(playerId, targetErr); return false; }

    const cost = parseCost(card.manaCost);
    const plan = planPayment(s, playerId, cost);
    if (!plan) { this.fail(playerId, 'mana insuficiente'); return false; }
    this.payWithPlan(playerId, plan);

    removeFromCurrentZone(s, obj);
    obj.zone = 'stack';
    s.stack.push({
      id: s.nextStackId++,
      kind: 'spell',
      sourceId: obj.id,
      controller: playerId,
      cardName: card.name,
      effect: card.spellEffect ?? [],
      targets,
      description: card.name,
    });
    s.passCount = 0;
    s.priority = playerId;
    this.emit({ type: 'spellCast', player: playerId, objectId: obj.id, cardName: card.name, targets });
    return true;
  }

  private payWithPlan(playerId: PlayerId, plan: import('./mana.js').PaymentPlan): void {
    const s = this.state;
    for (const tap of plan.taps) {
      const src = s.objects[tap.objectId];
      setTapped(s, src, true, this.emit);
    }
    for (const sym of plan.fromPool) {
      s.players[playerId].manaPool[sym] = Math.max(0, s.players[playerId].manaPool[sym] - 1);
    }
  }

  private doActivateAbility(
    playerId: PlayerId,
    objectId: number,
    abilityIndex: number,
    targets: TargetChoice[],
  ): boolean {
    const s = this.state;
    const obj = s.objects[objectId];
    if (!obj || obj.zone !== 'battlefield' || obj.controller !== playerId)
      { this.fail(playerId, 'permanente inválida'); return false; }
    const ability = obj.card.abilities?.[abilityIndex];
    if (!ability || ability.kind !== 'activated')
      { this.fail(playerId, 'habilidade inválida'); return false; }

    // Mana abilities may be activated at any time; others need priority.
    if (!ability.isManaAbility) {
      const err = this.requirePriority(playerId);
      if (err) { this.fail(playerId, err); return false; }
    } else if (s.pendingDecision || s.status !== 'playing') {
      { this.fail(playerId, 'agora não'); return false; }
    }

    if (ability.cost.tap) {
      if (obj.tapped) { this.fail(playerId, `${obj.card.name} já está virada`); return false; }
      if (obj.card.types.includes('Creature') && obj.summoningSick && !hasKeyword(obj, 'haste'))
        { this.fail(playerId, `${obj.card.name} tem enjoo de invocação`); return false; }
    }
    const targetErr = this.validateTargets(playerId, ability.targets, targets);
    if (targetErr) { this.fail(playerId, targetErr); return false; }

    if (ability.cost.mana) {
      const plan = planPayment(s, playerId, parseCost(ability.cost.mana));
      if (!plan) { this.fail(playerId, 'mana insuficiente'); return false; }
      this.payWithPlan(playerId, plan);
    }
    if (ability.cost.tap) setTapped(s, obj, true, this.emit);
    if (ability.cost.sacrificeSelf) moveWithEvent(s, obj, 'graveyard', 'sacrificed', this.emit);

    if (ability.isManaAbility) {
      runEffectScript(
        { state: s, controller: playerId, sourceId: obj.id, sourceName: obj.card.name, targets, emit: this.emit },
        ability.effect,
      );
      return true;
    }

    s.stack.push({
      id: s.nextStackId++,
      kind: 'ability',
      sourceId: obj.id,
      controller: playerId,
      cardName: obj.card.name,
      effect: ability.effect,
      targets,
      description: `${obj.card.name}: ${ability.text}`,
    });
    s.passCount = 0;
    s.priority = playerId;
    this.emit({
      type: 'abilityActivated',
      player: playerId,
      sourceId: obj.id,
      sourceName: obj.card.name,
      text: ability.text,
      targets,
    });
    return true;
  }

  private doDeclareAttackers(playerId: PlayerId, attackerIds: number[]): boolean {
    const s = this.state;
    if (s.combatAwaiting !== 'attackers' || playerId !== s.activePlayer)
      { this.fail(playerId, 'não é hora de declarar atacantes'); return false; }

    const attackers: GameObject[] = [];
    for (const id of attackerIds) {
      const obj = s.objects[id];
      if (!obj || obj.zone !== 'battlefield' || obj.controller !== playerId)
        { this.fail(playerId, 'atacante inválido'); return false; }
      const why = canAttack(obj);
      if (why) { this.fail(playerId, `${obj.card.name} não pode atacar: ${why}`); return false; }
      attackers.push(obj);
    }
    for (const obj of attackers) {
      obj.attacking = true;
      if (!hasKeyword(obj, 'vigilance')) setTapped(s, obj, true, this.emit);
    }
    s.combatAwaiting = null;
    this.emit({
      type: 'attackersDeclared',
      player: playerId,
      attackers: attackers.map((o) => ({ objectId: o.id, cardName: o.card.name })),
    });
    if (attackers.length === 0) {
      this.enterStep('combatEnd');
      return true;
    }
    s.passCount = 0;
    s.priority = s.activePlayer;
    return true;
  }

  private doDeclareBlockers(playerId: PlayerId, blocks: { blocker: number; attacker: number }[]): boolean {
    const s = this.state;
    if (s.combatAwaiting !== 'blockers' || playerId !== opponentOf(s.activePlayer))
      { this.fail(playerId, 'não é hora de declarar bloqueadores'); return false; }

    const seen = new Set<number>();
    const resolved: { blocker: GameObject; attacker: GameObject }[] = [];
    for (const b of blocks) {
      const blocker = s.objects[b.blocker];
      const attacker = s.objects[b.attacker];
      if (!blocker || blocker.zone !== 'battlefield' || blocker.controller !== playerId)
        { this.fail(playerId, 'bloqueador inválido'); return false; }
      if (seen.has(blocker.id))
        { this.fail(playerId, `${blocker.card.name} só pode bloquear um atacante`); return false; }
      if (!attacker || !attacker.attacking)
        { this.fail(playerId, 'atacante inválido'); return false; }
      const why = canBlock(blocker, attacker);
      if (why) { this.fail(playerId, `${blocker.card.name} não pode bloquear: ${why}`); return false; }
      seen.add(blocker.id);
      resolved.push({ blocker, attacker });
    }
    // Menace: attackers with menace must be blocked by 2+ or not at all.
    for (const atk of Object.values(s.objects).filter((o) => o.attacking && hasKeyword(o, 'menace'))) {
      const count = resolved.filter((r) => r.attacker.id === atk.id).length;
      if (count === 1)
        { this.fail(playerId, `${atk.card.name} tem ameaçar: precisa de 2+ bloqueadores`); return false; }
    }
    for (const r of resolved) r.blocker.blocking = r.attacker.id;
    s.combatAwaiting = null;
    this.emit({
      type: 'blockersDeclared',
      player: playerId,
      blocks: resolved.map((r) => ({
        blocker: r.blocker.id,
        blockerName: r.blocker.card.name,
        attacker: r.attacker.id,
        attackerName: r.attacker.card.name,
      })),
    });
    s.passCount = 0;
    s.priority = s.activePlayer;
    return true;
  }

  private doChooseDiscard(playerId: PlayerId, objectIds: number[]): boolean {
    const s = this.state;
    const pending = s.pendingDecision;
    if (!pending || pending.type !== 'discardToHandSize' || pending.player !== playerId)
      { this.fail(playerId, 'nenhum descarte pendente'); return false; }
    if (objectIds.length !== pending.count)
      { this.fail(playerId, `descarte exatamente ${pending.count} carta(s)`); return false; }
    for (const id of objectIds) {
      const obj = s.objects[id];
      if (!obj || obj.zone !== 'hand' || obj.owner !== playerId)
        { this.fail(playerId, 'carta inválida'); return false; }
    }
    for (const id of objectIds) {
      const obj = s.objects[id];
      moveWithEvent(s, obj, 'graveyard', 'discarded', this.emit);
      this.emit({ type: 'discarded', player: playerId, objectId: id, cardName: obj.card.name });
    }
    s.pendingDecision = null;
    this.finishCleanup();
    return true;
  }

  // ------------------------------------------------------------ manual mode

  private doManual(playerId: PlayerId, action: PlayerAction): boolean {
    const s = this.state;
    const player = s.players[playerId];
    const say = (text: string) => this.emit({ type: 'manualAction', player: playerId, text });

    switch (action.type) {
      case 'manualMove': {
        const obj = s.objects[action.objectId];
        if (!obj) { this.fail(playerId, 'objeto inválido'); return false; }
        if (obj.owner !== playerId && obj.controller !== playerId)
          { this.fail(playerId, 'essa carta não é sua'); return false; }
        const from = obj.zone;
        moveWithEvent(s, obj, action.to, 'manual', this.emit, action.position ?? 'top');
        say(`moveu ${obj.card.name} de ${from} para ${action.to}`);
        return true;
      }
      case 'manualTap': {
        const obj = s.objects[action.objectId];
        if (!obj || obj.zone !== 'battlefield') { this.fail(playerId, 'objeto inválido'); return false; }
        setTapped(s, obj, action.tapped, this.emit);
        say(`${action.tapped ? 'virou' : 'desvirou'} ${obj.card.name}`);
        return true;
      }
      case 'manualLife': {
        changeLife(s, action.player, action.delta, `ajuste manual de ${player.name}`, this.emit);
        return true;
      }
      case 'manualCounter': {
        const obj = s.objects[action.objectId];
        if (!obj) { this.fail(playerId, 'objeto inválido'); return false; }
        const total = (obj.counters[action.counter] ?? 0) + action.delta;
        obj.counters[action.counter] = total;
        this.emit({
          type: 'countersChanged',
          objectId: obj.id,
          cardName: obj.card.name,
          counter: action.counter,
          delta: action.delta,
          total,
        });
        return true;
      }
      case 'manualDraw': {
        for (let i = 0; i < action.count; i++) {
          if (player.zones.library.length === 0) break;
          draw(s, playerId, this.emit);
        }
        say(`comprou ${action.count} carta(s) manualmente`);
        return true;
      }
      case 'manualShuffle': {
        const r = shuffle(player.zones.library, s.rngState);
        player.zones.library = r.items;
        s.rngState = r.state;
        this.emit({ type: 'shuffled', player: playerId });
        return true;
      }
      case 'manualToken': {
        const def: CardDefinition = {
          id: `token-${action.name.toLowerCase().replace(/\s+/g, '-')}`,
          name: action.name,
          types: ['Creature'],
          subtypes: [],
          colors: [],
          power: action.power,
          toughness: action.toughness,
          automation: 'manual',
        };
        runEffectScript(
          { state: s, controller: playerId, sourceId: -1, sourceName: 'modo manual', targets: [], emit: this.emit },
          [
            {
              op: 'token',
              who: 'controller',
              count: 1,
              name: def.name,
              power: action.power,
              toughness: action.toughness,
              colors: [],
              subtypes: [],
            },
          ],
        );
        return true;
      }
      case 'manualUntapAll': {
        for (const id of player.zones.battlefield) setTapped(s, s.objects[id], false, this.emit);
        say('desvirou todas as suas permanentes');
        return true;
      }
      default:
        { this.fail(playerId, 'ação desconhecida'); return false; }
    }
  }

  // -------------------------------------------------------- state machine

  private advanceLoop(): void {
    const s = this.state;
    let guard = 0;
    while (s.status === 'playing' && !s.pendingDecision && !s.combatAwaiting) {
      if (++guard > 500) throw new Error('advanceLoop travou (bug na engine)');
      if (s.priority === null) {
        this.advanceStep();
        continue;
      }
      if (s.passCount >= 2) {
        if (s.stack.length > 0) {
          this.resolveTop();
          checkStateBasedActions(s, this.emit);
          this.scanTriggers();
          s.passCount = 0;
          s.priority = s.activePlayer;
          continue;
        }
        this.advanceStep();
        continue;
      }
      break;
    }
  }

  private advanceStep(): void {
    const s = this.state;
    if (s.step === 'cleanup') {
      this.beginTurn();
      return;
    }
    const idx = STEP_ORDER.indexOf(s.step);
    this.enterStep(STEP_ORDER[idx + 1]);
  }

  private beginTurn(): void {
    const s = this.state;
    s.turn += 1;
    s.activePlayer = opponentOf(s.activePlayer);
    this.emit({ type: 'turnBegan', turn: s.turn, activePlayer: s.activePlayer });
    this.enterStep('untap');
  }

  private enterStep(step: Step): void {
    const s = this.state;
    s.step = step;
    s.passCount = 0;
    for (const p of PLAYER_IDS) s.players[p].manaPool = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
    this.emit({ type: 'stepChanged', step });

    switch (step) {
      case 'untap': {
        const player = s.players[s.activePlayer];
        player.landsPlayedThisTurn = 0;
        for (const id of player.zones.battlefield) {
          const obj = s.objects[id];
          obj.summoningSick = false;
          if (obj.tapped) setTapped(s, obj, false, this.emit);
        }
        s.priority = null; // no one gets priority during untap
        return;
      }
      case 'draw': {
        if (!(s.turn === 1 && s.activePlayer === s.onThePlay)) {
          draw(s, s.activePlayer, this.emit);
          checkStateBasedActions(s, this.emit);
        }
        s.priority = s.activePlayer;
        return;
      }
      case 'upkeep': {
        this.fireUpkeepTriggers();
        s.priority = s.activePlayer;
        return;
      }
      case 'declareAttackers': {
        const canAny = s.players[s.activePlayer].zones.battlefield
          .map((id) => s.objects[id])
          .some((o) => canAttack(o) === null);
        if (!canAny) {
          this.emit({ type: 'attackersDeclared', player: s.activePlayer, attackers: [] });
          this.enterStep('combatEnd');
          return;
        }
        s.combatAwaiting = 'attackers';
        s.priority = s.activePlayer;
        this.emit({ type: 'decisionRequired', player: s.activePlayer, decision: 'declareAttackers' });
        return;
      }
      case 'declareBlockers': {
        s.combatAwaiting = 'blockers';
        s.priority = opponentOf(s.activePlayer);
        this.emit({ type: 'decisionRequired', player: opponentOf(s.activePlayer), decision: 'declareBlockers' });
        return;
      }
      case 'combatDamage': {
        resolveCombatDamage(s, this.emit);
        checkStateBasedActions(s, this.emit);
        this.scanTriggers();
        s.priority = s.activePlayer;
        return;
      }
      case 'combatEnd': {
        clearCombat(s);
        s.priority = s.activePlayer;
        return;
      }
      case 'cleanup': {
        const player = s.players[s.activePlayer];
        const over = player.zones.hand.length - MAX_HAND_SIZE;
        s.priority = null;
        if (over > 0) {
          s.pendingDecision = { type: 'discardToHandSize', player: s.activePlayer, count: over };
          this.emit({ type: 'decisionRequired', player: s.activePlayer, decision: `discard:${over}` });
          return;
        }
        this.finishCleanup();
        return;
      }
      default:
        s.priority = s.activePlayer;
        return;
    }
  }

  private finishCleanup(): void {
    const s = this.state;
    for (const obj of Object.values(s.objects)) {
      if (obj.zone === 'battlefield') {
        obj.damage = 0;
        obj.untilEot = { power: 0, toughness: 0 };
        delete obj.counters['__deathtouched'];
      }
    }
    checkStateBasedActions(s, this.emit);
    if (s.status === 'playing') this.beginTurn();
  }

  // ---------------------------------------------------------------- stack

  private resolveTop(): void {
    const s = this.state;
    const item = s.stack.pop();
    if (!item) return;

    if (item.kind === 'spell') {
      const obj = s.objects[item.sourceId];
      if (!obj) return;
      if (item.targets.length > 0 && !itemStillHasLegalWork(s, item)) {
        this.emit({ type: 'fizzled', description: `${item.cardName} foi anulada (todos os alvos são ilegais)` });
        moveWithEvent(s, obj, 'graveyard', 'resolved', this.emit);
        return;
      }
      if (isPermanentCard(obj.card)) {
        moveWithEvent(s, obj, 'battlefield', 'resolved', this.emit);
        this.emit({ type: 'stackResolved', description: `${item.cardName} entra no campo de batalha` });
        return;
      }
      runEffectScript(
        {
          state: s,
          controller: item.controller,
          sourceId: obj.id,
          sourceName: item.cardName,
          targets: item.targets,
          emit: this.emit,
        },
        item.effect,
      );
      this.emit({ type: 'stackResolved', description: `${item.cardName} resolveu` });
      // The spell finishes in the graveyard (unless an effect moved it).
      if (obj.zone === 'stack') moveWithEvent(s, obj, 'graveyard', 'resolved', this.emit);
      return;
    }

    // Ability
    if (item.targets.length > 0 && !itemStillHasLegalWork(s, item)) {
      this.emit({ type: 'fizzled', description: `${item.description} foi anulada` });
      return;
    }
    runEffectScript(
      {
        state: s,
        controller: item.controller,
        sourceId: item.sourceId,
        sourceName: item.cardName,
        targets: item.targets,
        emit: this.emit,
      },
      item.effect,
    );
    this.emit({ type: 'stackResolved', description: item.description });
  }

  // -------------------------------------------------------------- triggers

  /** Derive triggered abilities from events emitted since the last scan. */
  private scanTriggers(): void {
    const s = this.state;
    while (this.triggerCursor < this.buf.length) {
      const ev = this.buf[this.triggerCursor++];
      if (ev.type === 'zoneChanged' && ev.to === 'battlefield') this.fireObjectTriggers(ev.objectId, 'etb');
      if (ev.type === 'zoneChanged' && ev.from === 'battlefield' && ev.to === 'graveyard')
        this.fireObjectTriggers(ev.objectId, 'dies');
      if (ev.type === 'attackersDeclared')
        for (const a of ev.attackers) this.fireObjectTriggers(a.objectId, 'attacks');
    }
  }

  private fireObjectTriggers(objectId: number, on: 'etb' | 'dies' | 'attacks'): void {
    const s = this.state;
    const obj = s.objects[objectId];
    if (!obj) return;
    for (const ability of obj.card.abilities ?? []) {
      if (ability.kind !== 'triggered') continue;
      if (ability.trigger.on !== on) continue;
      this.pushTrigger(obj, ability.text, ability.effect);
    }
  }

  private fireUpkeepTriggers(): void {
    const s = this.state;
    for (const p of PLAYER_IDS) {
      for (const id of s.players[p].zones.battlefield) {
        const obj = s.objects[id];
        for (const ability of obj.card.abilities ?? []) {
          if (ability.kind !== 'triggered' || ability.trigger.on !== 'upkeep') continue;
          const whose = ability.trigger.whose;
          if (whose === 'controller' && obj.controller !== s.activePlayer) continue;
          this.pushTrigger(obj, ability.text, ability.effect);
        }
      }
    }
  }

  private pushTrigger(obj: GameObject, text: string, effect: StackItem['effect']): void {
    const s = this.state;
    s.stack.push({
      id: s.nextStackId++,
      kind: 'ability',
      sourceId: obj.id,
      controller: obj.controller,
      cardName: obj.card.name,
      effect,
      targets: [],
      description: `${obj.card.name}: ${text}`,
    });
    s.passCount = 0;
    s.priority = s.activePlayer;
    this.emit({
      type: 'abilityTriggered',
      player: obj.controller,
      sourceId: obj.id,
      sourceName: obj.card.name,
      text,
    });
  }
}
