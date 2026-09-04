/**
 * The Game orchestrator: applies PlayerActions, runs the turn/priority state
 * machine, the stack, triggers and SBAs, and emits GameEvents.
 *
 * Flow after every action: run action → SBAs → collect triggers → advance
 * (resolve stack / move steps) until a player has a real decision to make.
 */
import type { PlayerAction } from './actions.js';
import type { ActivatedAbility, CardDefinition, PlayerConfig, TargetSpec } from './cards/types.js';
import { cardMatchesFilter, isPermanentCard } from './cards/types.js';
import { canAttack, canBlock, clearCombat, resolveCombatDamage } from './combat.js';
import {
  applyEffectChoice,
  condHolds,
  itemStillHasLegalWork,
  resolveAmount,
  runEffectScript,
  targetMatchesSpec,
} from './effects.js';
import type { GameEvent } from './events.js';
import { canPay, costCmc, costLabel, parseCost, planPayment } from './mana.js';
import { applyEnterTapRules, castCardFree, dredgeOptions } from './effects.js';
import { changeLife, draw, lose, moveWithEvent, setTapped, transformObject } from './ops.js';
import { checkStateBasedActions } from './sba.js';
import { DUNGEONS } from './dungeons.js';
import {
  abilityActive,
  staticConditionHolds,
  createGameState,
  currentLevel,
  effectivePower,
  attachmentForbids,
  createObject,
  effectiveToughness,
  hasKeyword,
  isCreature,
  manaValueOf,
  matchFilter,
  MAX_HAND_SIZE,
  removeFromCurrentZone,
  STARTING_HAND,
  type GameObject,
  type GameState,
  type QueuedTrigger,
  type StackItem,
} from './state.js';
import { shuffle, nextRandom } from './rng.js';
import { opponentOf, PLAYER_IDS, STEP_ORDER, type PlayerId, type Step, type TargetChoice } from './types.js';

export interface ApplyResult {
  ok: boolean;
  events: GameEvent[];
}

export interface GameOptions {
  /** Manual mana: spells and abilities wait for the player to float the mana (no automatic tapping). */
  manualMana?: boolean;
  /** Force who goes first, skipping the roll AND the choice (tests). */
  firstPlayer?: PlayerId;
  /**
   * Skip the roll and let this player choose who starts (match rules: the
   * loser of the previous game decides).
   */
  starterChooser?: PlayerId;
}

/** Extra options of a castSpell action (alternative methods, costs, faces). */
interface CastExtra {
  method?: Extract<import('./actions.js').PlayerAction, { type: 'castSpell' }>['method'];
  escapeExile?: number[];
  faceDown?: boolean;
  buyback?: boolean;
  kickerTimes?: number;
  entwine?: boolean;
  discards?: number[];
  attackerId?: number;
  replicateTimes?: number;
  modes?: number[];
  face?: 'back';
  fuse?: boolean;
  casualty?: number;
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

  /** Deal opening hands and begin the pre-game flow. Call exactly once. */
  start(): GameEvent[] {
    this.buf = [];
    this.triggerCursor = 0;
    const s = this.state;
    this.emit({
      type: 'gameStarted',
      players: PLAYER_IDS.map((p) => ({ id: p, name: s.players[p].name })),
      seed: s.seed,
      onThePlay: s.onThePlay,
    });
    for (const p of PLAYER_IDS) {
      this.emit({ type: 'shuffled', player: p });
      for (let i = 0; i < STARTING_HAND; i++) draw(s, p, this.emit);
    }

    if (this.options.firstPlayer) {
      // Tests: skip roll + choice entirely.
      s.onThePlay = this.options.firstPlayer;
      s.activePlayer = this.options.firstPlayer;
      this.beginMulligan();
      return this.flush();
    }

    if (this.options.starterChooser) {
      // Match games 2+: the previous loser decides, no roll.
      s.starter = { rolls: { p1: 0, p2: 0 }, rerolls: 0, winner: this.options.starterChooser, chosen: false };
      this.emit({ type: 'decisionRequired', player: this.options.starterChooser, decision: 'chooseStarter' });
      return this.flush();
    }

    // Game 1: both players roll 1–100; ties reroll automatically.
    let p1 = 0;
    let p2 = 0;
    let rerolls = -1;
    do {
      rerolls += 1;
      let r = nextRandom(s.rngState);
      s.rngState = r.state;
      p1 = 1 + Math.floor(r.value * 100);
      r = nextRandom(s.rngState);
      s.rngState = r.state;
      p2 = 1 + Math.floor(r.value * 100);
    } while (p1 === p2);
    const winner: PlayerId = p1 > p2 ? 'p1' : 'p2';
    s.starter = { rolls: { p1, p2 }, rerolls, winner, chosen: false };
    this.emit({ type: 'startingRoll', rolls: { p1, p2 }, rerolls, winner });
    this.emit({ type: 'decisionRequired', player: winner, decision: 'chooseStarter' });
    return this.flush();
  }

  private beginMulligan(): void {
    const s = this.state;
    s.mulligan = {
      taken: { p1: 0, p2: 0 },
      phase: { p1: 'deciding', p2: 'deciding' },
    };
    for (const p of PLAYER_IDS) this.emit({ type: 'decisionRequired', player: p, decision: 'mulligan' });
  }

  private doChooseStarter(playerId: PlayerId, first: PlayerId): boolean {
    const s = this.state;
    if (!s.starter || s.starter.chosen)
      { this.fail(playerId, 'não há escolha de quem começa pendente'); return false; }
    if (s.starter.winner !== playerId)
      { this.fail(playerId, 'a escolha de quem começa não é sua'); return false; }
    if (!PLAYER_IDS.includes(first))
      { this.fail(playerId, 'jogador inválido'); return false; }
    s.starter.chosen = true;
    s.onThePlay = first;
    s.activePlayer = first;
    this.emit({ type: 'starterChosen', first, by: playerId });
    this.beginMulligan();
    return true;
  }

  private beginFirstTurn(): void {
    const s = this.state;
    s.turn = 1;
    // A mão inicial não é "comprada em um turno": Tamiyo ("third card in a turn") e afins contam do zero.
    for (const p of PLAYER_IDS) s.players[p].drawsThisTurn = 0;
    this.emit({ type: 'turnBegan', turn: 1, activePlayer: s.activePlayer });
    this.enterStep('untap');
    this.advanceLoop();
  }

  private doMulligan(playerId: PlayerId): boolean {
    const s = this.state;
    const mull = s.mulligan;
    if (!mull || mull.phase[playerId] !== 'deciding')
      { this.fail(playerId, 'você não está decidindo mulligan'); return false; }
    if (mull.taken[playerId] >= STARTING_HAND)
      { this.fail(playerId, 'não dá para baixar de 0 cartas — mantenha a mão'); return false; }
    const player = s.players[playerId];
    for (const id of [...player.zones.hand]) {
      const obj = s.objects[id];
      removeFromCurrentZone(s, obj);
      obj.zone = 'library';
      player.zones.library.push(id);
    }
    const r = shuffle(player.zones.library, s.rngState);
    player.zones.library = r.items;
    s.rngState = r.state;
    this.emit({ type: 'shuffled', player: playerId });
    for (let i = 0; i < STARTING_HAND; i++) draw(s, playerId, this.emit);
    mull.taken[playerId] += 1;
    this.emit({ type: 'mulliganTaken', player: playerId, taken: mull.taken[playerId] });
    return true;
  }

  private doKeepHand(playerId: PlayerId, bottom: number[], beginOnBattlefield?: number[]): boolean {
    const s = this.state;
    const mull = s.mulligan;
    if (!mull || mull.phase[playerId] !== 'deciding')
      { this.fail(playerId, 'você não está decidindo mulligan'); return false; }
    const mustBottom = mull.taken[playerId];
    if (bottom.length !== mustBottom)
      { this.fail(playerId, `escolha exatamente ${mustBottom} carta(s) para o fundo da biblioteca`); return false; }
    if (new Set(bottom).size !== bottom.length)
      { this.fail(playerId, 'carta repetida na escolha'); return false; }
    const player = s.players[playerId];
    for (const id of bottom) {
      const obj = s.objects[id];
      if (!obj || obj.zone !== 'hand' || obj.owner !== playerId)
        { this.fail(playerId, 'carta inválida'); return false; }
    }
    for (const id of bottom) {
      const obj = s.objects[id];
      removeFromCurrentZone(s, obj);
      obj.zone = 'library';
      player.zones.library.push(id); // fundo da biblioteca, na ordem escolhida
    }
    mull.phase[playerId] = 'kept';
    this.emit({ type: 'handKept', player: playerId, bottomed: mustBottom });
    // Leylines: "If this card is in your opening hand, you may begin the game with it on the battlefield."
    // O cliente manda quais começam no campo; sem a lista, todas começam.
    const leylines = [...player.zones.hand].filter((id) => s.objects[id].card.openingHand);
    const chosen = beginOnBattlefield ? leylines.filter((id) => beginOnBattlefield.includes(id)) : leylines;
    for (const id of chosen) {
      const ley = s.objects[id];
      moveWithEvent(s, ley, 'battlefield', 'resolved', this.emit);
      this.applyEnterTapRules(ley);
      this.emit({ type: 'fizzled', description: `${player.name} começa o jogo com ${ley.card.name} no campo de batalha` });
    }
    if (PLAYER_IDS.every((p) => mull.phase[p] === 'kept')) {
      s.mulligan = null;
      this.beginFirstTurn();
    }
    return true;
  }

  /** The action being applied (stored for manual-mana deferral). */
  private currentAction: PlayerAction | null = null;

  apply(playerId: PlayerId, action: PlayerAction): ApplyResult {
    this.buf = [];
    this.triggerCursor = 0;
    const s = this.state;
    this.currentAction = action;
    // Miracle: the window closes as soon as its owner does anything else.
    if (action.type !== 'chat' && !(action.type === 'castSpell' && action.method === 'miracle'))
      for (const id of s.players[playerId].zones.hand) s.objects[id].miracleAvailable = undefined;

    if (s.status === 'finished' && action.type !== 'chat') {
      return this.fail(playerId, 'a partida já terminou');
    }

    if (
      s.starter !== null &&
      !s.starter.chosen &&
      !['chooseStarter', 'concede', 'chat'].includes(action.type)
    ) {
      return this.fail(playerId, 'aguardando a escolha de quem começa');
    }

    if (
      s.mulligan !== null &&
      !['mulligan', 'keepHand', 'concede', 'chat'].includes(action.type)
    ) {
      return this.fail(playerId, 'decida sua mão inicial primeiro (mulligan ou manter)');
    }

    try {
      const isManual = action.type.startsWith('manual');
      const ok = this.execute(playerId, action);
      if (!ok) return { ok: false, events: this.flush() };
      // Manual mana: after a mana ability, retry the spell/ability waiting for payment.
      if (ok && s.pendingPayment && action.type === 'activateAbility') this.retryPendingPayment();
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
    // NÃO fazer flush aqui: os do* usam fail() como expressão e o apply()
    // faz o flush final — flushar duas vezes engolia a mensagem de erro
    // (todo erro chegava ao cliente como "ação inválida").
    return { ok: false, events: [...this.buf] };
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
      case 'chooseStarter':
        return this.doChooseStarter(playerId, action.first);
      case 'undoTap':
        return this.doUndoTap(playerId, action.objectId);
      case 'mulligan':
        return this.doMulligan(playerId);
      case 'keepHand':
        return this.doKeepHand(playerId, action.bottom, action.beginOnBattlefield);
      case 'playLand':
        return this.doPlayLand(playerId, action.objectId, action.face);
      case 'castSpell':
        return this.doCastSpell(playerId, action.objectId, action.targets ?? [], action.x, action.mode, action.sacrifices, action.kicked, action.useAltCost, action.altExile, {
          method: action.method,
          escapeExile: action.escapeExile,
          faceDown: action.faceDown,
          buyback: action.buyback,
          kickerTimes: action.kickerTimes,
          entwine: action.entwine,
          discards: action.discards,
          attackerId: action.attackerId,
          replicateTimes: action.replicateTimes,
          modes: action.modes,
          face: action.face,
          fuse: action.fuse,
          casualty: action.casualty,
        });
      case 'turnFaceUp':
        return this.doTurnFaceUp(playerId, action.objectId);
      case 'ninjutsu':
        return this.doNinjutsu(playerId, action.objectId, action.attackerId);
      case 'effectChoice':
        return this.doEffectChoice(playerId, action.picks, action.text);
      case 'chooseTargets':
        return this.doChooseTargets(playerId, action.targets);
      case 'activateAbility':
        return this.doActivateAbility(playerId, action.objectId, action.abilityIndex, action.targets ?? [], action.sacrifices, action.manaColor, action.discards, action.tapCreature, action.x);
      case 'crew':
        return this.doCrew(playerId, action.objectId, action.creatures);
      case 'chooseMode':
        return this.doChooseMode(playerId, action.mode);
      case 'cycle':
        return this.doCycle(playerId, action.objectId, action.sacrifice);
      case 'declareAttackers':
        return this.doDeclareAttackers(playerId, action.attackers, action.defendTarget, action.exerted, action.enlist);
      case 'declareBlockers':
        return this.doDeclareBlockers(playerId, action.blocks);
      case 'chooseDiscard':
        return this.doChooseDiscard(playerId, action.objectIds);
      case 'cancelPayment':
        return this.doCancelPayment(playerId);
      default:
        return this.doManual(playerId, action);
    }
  }

  /** Manual mana: park the action until the player floats the mana. Returns true so the action is not an error. */
  private deferPayment(playerId: PlayerId, cardName: string, cost: import('./mana.js').ParsedCost): boolean {
    const s = this.state;
    if (!this.currentAction) { this.fail(playerId, 'mana insuficiente'); return false; }
    const label = costLabel(cost);
    s.pendingPayment = { player: playerId, action: this.currentAction, cardName, cost: label };
    s.pendingDecision = { type: 'payMana', player: playerId, cardName, cost: label };
    this.emit({ type: 'fizzled', description: `${cardName}: pague ${label} — ative suas fontes de mana (ou cancele)` });
    return true;
  }

  private retryPendingPayment(): void {
    const s = this.state;
    const pp = s.pendingPayment;
    if (!pp) return;
    s.pendingPayment = undefined;
    s.pendingDecision = null;
    this.currentAction = pp.action;
    const ok = this.execute(pp.player, pp.action);
    if (!ok && !s.pendingPayment) this.emit({ type: 'fizzled', description: `${pp.cardName}: a conjuração foi cancelada (a mana continua flutuando)` });
  }

  private doCancelPayment(playerId: PlayerId): boolean {
    const s = this.state;
    if (!s.pendingPayment || s.pendingPayment.player !== playerId) { this.fail(playerId, 'nada aguardando pagamento'); return false; }
    const name = s.pendingPayment.cardName;
    s.pendingPayment = undefined;
    s.pendingDecision = null;
    this.emit({ type: 'fizzled', description: `${name}: pagamento cancelado (a mana continua flutuando)` });
    return true;
  }

  private requirePriority(playerId: PlayerId, opts: { manaAbility?: boolean } = {}): string | null {
    const s = this.state;
    if (s.pendingDecision && !(opts.manaAbility && s.pendingDecision.type === 'payMana' && s.pendingDecision.player === playerId)) return 'há uma decisão pendente';
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
    s.reversibleTaps = [];
    return true;
  }

  /** Undo a tap-for-mana whose mana is still floating (MTGO-style). */
  private doUndoTap(playerId: PlayerId, objectId: number): boolean {
    const s = this.state;
    const idx = s.reversibleTaps.findIndex((r) => r.objectId === objectId);
    const obj = s.objects[objectId];
    if (idx < 0 || !obj || obj.controller !== playerId || !obj.tapped)
      { this.fail(playerId, 'essa virada não pode mais ser desfeita'); return false; }
    const entry = s.reversibleTaps[idx];
    const pool = s.players[playerId].manaPool;
    const needed: Partial<Record<string, number>> = {};
    for (const sym of entry.mana) needed[sym] = (needed[sym] ?? 0) + 1;
    for (const [sym, n] of Object.entries(needed)) {
      if ((pool[sym as keyof typeof pool] ?? 0) < (n ?? 0))
        { this.fail(playerId, 'a mana já foi usada — não dá para desfazer'); return false; }
    }
    for (const sym of entry.mana) pool[sym] -= 1;
    s.reversibleTaps.splice(idx, 1);
    setTapped(s, obj, false, this.emit);
    this.emit({ type: 'tapUndone', objectId: obj.id, cardName: obj.card.name, player: playerId });
    return true;
  }

  private doPlayLand(playerId: PlayerId, objectId: number, face?: 'back'): boolean {
    const obj = this.state.objects[objectId];
    if (face === 'back') {
      if (!obj?.baseCard?.backFace || obj.baseCard.faceLayout !== 'modal_dfc') { this.fail(playerId, 'essa carta não tem verso jogável'); return false; }
      obj.card = obj.baseCard.backFace;
      obj.transformed = true;
    }
    const ok = this.doPlayLandInner(playerId, objectId);
    if (!ok && face === 'back' && obj?.baseCard) { obj.card = obj.baseCard; obj.transformed = false; }
    return ok;
  }

  private doPlayLandInner(playerId: PlayerId, objectId: number): boolean {
    const s = this.state;
    const err = this.requirePriority(playerId);
    if (err) { this.fail(playerId, err); return false; }
    const obj = s.objects[objectId];
    const playableFromExile = !!obj && obj.zone === 'exile' && obj.exiledAs === 'playable' && obj.playableUntilTurn === s.turn;
    const gyLands = s.players[playerId].graveyardCastPermission;
    const fromGraveyard = !!obj && obj.zone === 'graveyard' && (s.players[playerId].zones.battlefield.some((id) => s.objects[id].card.playLandsFromGraveyard) || (!!gyLands?.lands && gyLands.untilTurn === s.turn));
    if (!obj || (obj.zone !== 'hand' && !playableFromExile && !fromGraveyard) || obj.owner !== playerId)
      { this.fail(playerId, 'carta inválida'); return false; }
    if (!obj.card.types.includes('Land'))
      { this.fail(playerId, 'isso não é um terreno'); return false; }
    obj.exiledAs = undefined;
    if (!this.sorceryTiming(playerId))
      { this.fail(playerId, 'terrenos só podem ser jogados na sua fase principal com a pilha vazia'); return false; }
    const extraLands = s.players[playerId].zones.battlefield.reduce((n, id) => n + (s.objects[id].card.extraLands ?? 0), 0);
    if (s.players[playerId].landsPlayedThisTurn >= 1 + extraLands)
      { this.fail(playerId, 'você já jogou seus terrenos neste turno'); return false; }

    removeFromCurrentZone(s, obj);
    obj.zone = 'battlefield';
    s.players[playerId].zones.battlefield.push(obj.id);
    obj.summoningSick = false;
    s.players[playerId].landsPlayedThisTurn += 1;
    s.passCount = 0;
    this.emit({ type: 'landPlayed', player: playerId, objectId: obj.id, cardName: obj.card.name });
    this.applyEnterTapRules(obj);
    return true;
  }

  /** Keyword "enters with…" rules (modular, fabricate, unleash/riot, bloodthirst, kicker, living weapon, echo, vanishing, devour, choose-as-enters). */
  private applyEnterKeywords(obj: GameObject): void {
    const s = this.state;
    const card = obj.card;
    const add = (counter: string, n: number) => {
      if (n <= 0) return;
      const total = (obj.counters[counter] ?? 0) + n;
      obj.counters[counter] = total;
      this.emit({ type: 'countersChanged', objectId: obj.id, cardName: card.name, counter, delta: n, total });
    };
    if (card.modular) add('+1/+1', card.modular);
    if (card.fabricate) add('+1/+1', card.fabricate);
    if (card.unleash || card.riot) add('+1/+1', 1);
    if (card.bloodthirst && s.players[opponentOf(obj.controller)].damagedThisTurn) add('+1/+1', card.bloodthirst);
    if (obj.kicked && card.kicker?.entersWithCounters) add(card.kicker.entersWithCounters.counter, card.kicker.entersWithCounters.count * Math.max(1, obj.kickerTimes ?? 1));
    if (card.vanishing) add('time', card.vanishing);
    if (obj.impending && card.altCost?.impending) add('time', card.altCost.impending);
    if (card.fading) add('fade', card.fading);
    if (card.echo) obj.echoPending = true;
    if (card.livingWeapon) {
      const germ = createObject(s, { id: 'token-germ', name: 'Phyrexian Germ', types: ['Creature'], subtypes: ['Phyrexian', 'Germ'], colors: ['B'], power: 0, toughness: 0, automation: 'full' }, obj.controller);
      germ.isToken = true;
      germ.zone = 'battlefield';
      germ.summoningSick = true;
      germ.enteredOnTurn = this.state.turn;
      s.players[obj.controller].zones.battlefield.push(germ.id);
      obj.attachedTo = germ.id;
      this.emit({ type: 'tokenCreated', player: obj.controller, objectId: germ.id, name: 'Phyrexian Germ' });
    }
    // Offspring / Squad: cópias-ficha se o custo extra foi pago.
    if (obj.kicked && card.offspring) this.pushTrigger(obj, { text: 'prole', effect: [{ op: 'tokenCopy', power: 1, toughness: 1 }] });
    if (obj.kicked && card.squad) this.pushTrigger(obj, { text: 'esquadrão', effect: [{ op: 'tokenCopy', count: Math.max(1, obj.kickerTimes ?? 1) }] });
    // Gift on a permanent: the opponent gets it as this enters.
    if (obj.kicked && card.kicker?.gift) this.pushTrigger(obj, { text: 'presente', effect: card.kicker.gift });
    // ---- Leva 3
    if (card.ravenous && (obj.castX ?? 0) >= 5) this.pushTrigger(obj, { text: 'voraz: compre uma carta', effect: [{ op: 'draw', who: 'controller', count: 1 }] });
    if (card.sunburst && (obj.colorsSpent ?? 0) > 0) add(card.types.includes('Creature') ? '+1/+1' : 'charge', obj.colorsSpent ?? 0);
    if (card.graft) add('+1/+1', card.graft);
    if (card.amplify) {
      const n = s.players[obj.controller].zones.hand
        .map((id) => s.objects[id].card)
        .filter((c) => c.types.includes('Creature') && c.subtypes.some((t) => card.subtypes.includes(t))).length;
      add('+1/+1', card.amplify * n);
    }
    if (card.tribute)
      this.pushTrigger(obj, {
        text: `tributo ${card.tribute.count}`,
        effect: [{ op: 'mayDo', who: 'opponent', prompt: `pagar tributo: colocar ${card.tribute.count} marcador(es) +1/+1 em ${card.name}?`, effect: [{ op: 'putCounters', what: 'self', counter: '+1/+1', count: card.tribute.count }], else: card.tribute.effect }],
      });
    if (card.saga) {
      if (card.saga.readAhead) {
        const modes = Array.from({ length: card.saga.chapters }, (_, i) => ({ label: `começar no capítulo ${'I'.repeat(i + 1).replace('IIII', 'IV').replace('IIIII', 'V')}`, effect: [{ op: 'addLore' as const, count: i + 1 }] }));
        this.pushTrigger(obj, { text: 'ler adiante', effect: [], modes });
      } else {
        obj.counters['lore'] = 1;
        this.emit({ type: 'countersChanged', objectId: obj.id, cardName: card.name, counter: 'lore', delta: 1, total: 1 });
        this.emit({ type: 'loreAdded', objectId: obj.id, cardName: card.name, total: 1 });
      }
    }
    // ---- Leva 5b: batalhas, prepare, soulbond, dia/noite
    if (card.defense !== undefined) add('defense', card.defense);
    if (card.entersPrepared) obj.prepared = true;
    if (card.setsDayOnEnter && s.dayNight === undefined) this.setDayNight('day');
    if (card.daybound) {
      if (s.dayNight === undefined) this.setDayNight('day');
      else if (s.dayNight === 'night' && !obj.transformed) transformObject(s, obj, this.emit);
    }
    if (isCreature(obj) && !card.soulbond) {
      for (const id of s.players[obj.controller].zones.battlefield) {
        const sb = s.objects[id];
        if (sb.id !== obj.id && sb.card.soulbond && sb.pairedWith === undefined && sb.zone === 'battlefield')
          this.pushTrigger(sb, { text: 'soulbond', effect: [{ op: 'mayDo', prompt: `formar par entre ${sb.card.name} e ${card.name}?`, effect: [{ op: 'pairSoulbond' }] }] });
      }
    }
    // Escolhas e devorar ao entrar: viram habilidade na pilha (podem pausar).
    const enterScript: import('./cards/types.js').EffectStep[] = [];
    if (card.soulbond) enterScript.push({ op: 'mayDo', prompt: `${card.name}: formar par com outra criatura (soulbond)?`, effect: [{ op: 'pairSoulbond' }] });
    if (card.copyOnEnter) { obj.copyPending = true; enterScript.push({ op: 'copyOf' }); }
    if (card.chooseOnEnter) enterScript.push({ op: 'chooseValue', kind: card.chooseOnEnter });
    if (card.devour) enterScript.push({ op: 'devour', per: card.devour });
    if (enterScript.length > 0) this.pushTrigger(obj, { text: 'ao entrar', effect: enterScript });
  }

  /** Keyword enter rules, then the shared enter-tapped rules (effects.applyEnterTapRules — idempotent per stay on the battlefield). */
  private applyEnterTapRules(obj: GameObject): void {
    this.applyEnterKeywords(obj);
    applyEnterTapRules(this.state, obj, this.emit);
  }

  private validateTargets(
    playerId: PlayerId,
    specs: TargetSpec[] | undefined,
    targets: TargetChoice[],
    srcColors?: import('./types.js').Color[],
    xValue?: number,
    kicked?: boolean,
  ): string | null {
    // "If this spell was kicked, instead <target …>": the kicked spec replaces the base one.
    const required = (specs ?? []).map((t) => (kicked && t.kickedSpec ? t.kickedSpec : t));
    const mandatory = required.filter((t) => !t.optional).length;
    if (targets.length < mandatory || targets.length > required.length)
      return 'número de alvos incorreto';
    const upToX = required.filter((t) => t.upToX).length;
    if (upToX > 0 && targets.length > (xValue ?? 0)) return `no máximo X = ${xValue ?? 0} alvo(s)`;
    for (let i = 0; i < targets.length; i++) {
      const spec = required[i];
      if (!spec) return 'alvo em excesso';
      if (!targetMatchesSpec(this.state, playerId, spec, targets[i], srcColors, xValue)) return 'alvo ilegal';
    }
    return null;
  }

  private doCastSpell(
    playerId: PlayerId,
    objectId: number,
    targets: TargetChoice[],
    x?: number,
    modeIndex?: number,
    sacrifices?: number[],
    kicked?: boolean,
    useAltCost?: boolean,
    altExile?: number[],
    extra: CastExtra = {},
  ): boolean {
    // Leva 5b: casting the back face (MDFC spell, adventure, split half, aftermath, disturb) swaps the face first;
    // if the cast is refused the card goes back to its front.
    const obj = this.state.objects[objectId];
    const wantBack = extra.face === 'back' || extra.method === 'disturb';
    if (wantBack) {
      const base = obj?.baseCard;
      const layout = base?.faceLayout;
      if (!obj || !base?.backFace || !(layout === 'modal_dfc' || layout === 'adventure' || layout === 'split' || extra.method === 'disturb'))
        { this.fail(playerId, 'essa carta não tem outra face conjurável'); return false; }
      if (obj.transformed) { this.fail(playerId, 'a carta já está mostrando o verso'); return false; }
      obj.card = base.backFace;
      obj.transformed = true;
    }
    const ok = this.doCastSpellInner(playerId, objectId, targets, x, modeIndex, sacrifices, kicked, useAltCost, altExile, extra);
    if (!ok && wantBack && obj?.baseCard && obj.zone !== 'stack') { obj.card = obj.baseCard; obj.transformed = false; }
    return ok;
  }

  private doCastSpellInner(
    playerId: PlayerId,
    objectId: number,
    targets: TargetChoice[],
    x?: number,
    modeIndex?: number,
    sacrifices?: number[],
    kicked?: boolean,
    useAltCost?: boolean,
    altExile?: number[],
    extra: CastExtra = {},
  ): boolean {
    const s = this.state;
    const err = this.requirePriority(playerId);
    if (err) { this.fail(playerId, err); return false; }
    const obj = s.objects[objectId];
    if (!obj || obj.owner !== playerId)
      { this.fail(playerId, 'carta inválida'); return false; }
    const card = obj.card;
    const method = extra.method;
    const cm: import('./cards/types.js').CastMethod | undefined =
      method === 'disturb'
        ? (obj.baseCard?.disturb !== undefined ? { kind: 'disturb', cost: obj.baseCard.disturb, label: `perturbar ${obj.baseCard.disturb}` } : undefined)
        : method && method !== 'suspend' ? card.castMethods?.find((m) => m.kind === method) : undefined;
    if (method && method !== 'suspend' && !cm)
      { this.fail(playerId, `${card.name} não pode ser conjurada assim`); return false; }
    // "Cast ~ only during the declare attackers step and only if you've been attacked this step." etc.
    if (card.castOnly && !staticConditionHolds(s, { ...obj, controller: playerId }, card.castOnly))
      { this.fail(playerId, `${card.name} só pode ser conjurada quando a condição do texto vale`); return false; }
    // Split second: nothing can be cast while such a spell is on the stack.
    if (s.stack.some((i) => i.kind === 'spell' && s.objects[i.sourceId]?.card.splitSecond))
      { this.fail(playerId, 'fração de segundo: nada pode ser conjurado agora'); return false; }
    // "Each player can't cast more than one spell each turn."
    if ((s.players[playerId].spellsCastThisTurn ?? 0) >= 1 && PLAYER_IDS.some((p) => s.players[p].zones.battlefield.some((id) => s.objects[id].card.oneSpellPerTurn === true)))
      { this.fail(playerId, 'só uma mágica por turno'); return false; }
    if (!card.types.includes('Creature') && (s.players[playerId].noncreatureSpellsThisTurn ?? 0) >= 1 && PLAYER_IDS.some((p) => s.players[p].zones.battlefield.some((id) => s.objects[id].card.oneSpellPerTurn === 'noncreature')))
      { this.fail(playerId, 'só uma mágica que não seja criatura por turno'); return false; }
    // "You may cast <X> spells from the top of your library."
    const viaLibraryTop = obj.zone === 'library' && s.players[playerId].zones.library[0] === obj.id &&
      s.players[playerId].zones.battlefield.some((id) => { const f = s.objects[id].card.castFromLibraryTop; return !!f && cardMatchesFilter(card, f); });
    // Suspend: não vai para a pilha — exila com marcadores de tempo.
    if (method === 'suspend') {
      if (!card.suspend || obj.zone !== 'hand') { this.fail(playerId, 'essa carta não tem suspender'); return false; }
      if (!this.sorceryTiming(playerId) && !card.types.includes('Instant')) { this.fail(playerId, 'suspender: só na sua fase principal com a pilha vazia'); return false; }
      const plan = planPayment(s, playerId, parseCost(card.suspend.cost));
      if (!plan) { this.fail(playerId, 'mana insuficiente'); return false; }
      this.payWithPlan(playerId, plan);
      moveWithEvent(s, obj, 'exile', 'exiled', this.emit);
      obj.exiledAs = 'suspended';
      obj.counters['time'] = card.suspend.count;
      this.emit({ type: 'countersChanged', objectId: obj.id, cardName: card.name, counter: 'time', delta: card.suspend.count, total: card.suspend.count });
      return true;
    }
    // Flashback / escape / mayhem / retrace: from your graveyard. Foretold / plotted / warped: from exile.
    const viaGraveyard = method === 'mayhem' || method === 'retrace' || method === 'disturb';
    const viaFlashback = obj.zone === 'graveyard' && !!obj.card.flashback && method !== 'escape' && !viaGraveyard;
    const viaEscape = method === 'escape';
    const viaExile = method === 'foretold' || method === 'plotted' || method === 'warp';
    if ((viaEscape || viaGraveyard) && obj.zone !== 'graveyard') { this.fail(playerId, `${method}: a carta precisa estar no seu cemitério`); return false; }
    if (method === 'mayhem' && obj.discardedOnTurn !== s.turn)
      { this.fail(playerId, 'mayhem: só no turno em que a carta foi descartada'); return false; }
    const retraceDiscard = method === 'retrace' ? s.objects[extra.discards?.[0] ?? -1] : undefined;
    if (method === 'retrace' && (!retraceDiscard || retraceDiscard.zone !== 'hand' || retraceDiscard.owner !== playerId || !retraceDiscard.card.types.includes('Land')))
      { this.fail(playerId, 'retrace: descarte uma carta de terreno da sua mão'); return false; }
    if (method === 'freerunning' && !s.combatDamageSubtypesThisTurn?.includes('Assassin'))
      { this.fail(playerId, 'freerunning: um Assassino seu precisa ter causado dano de combate a um jogador neste turno'); return false; }
    const sneakAttacker = method === 'sneak' ? s.objects[extra.attackerId ?? -1] : undefined;
    if (method === 'sneak') {
      if (s.step !== 'declareBlockers' || s.combatAwaiting !== null || s.activePlayer !== playerId)
        { this.fail(playerId, 'sneak: só depois dos bloqueadores serem declarados, no seu turno'); return false; }
      if (!sneakAttacker || sneakAttacker.zone !== 'battlefield' || sneakAttacker.controller !== playerId || !sneakAttacker.attacking || sneakAttacker.wasBlocked)
        { this.fail(playerId, 'sneak: escolha um atacante seu não bloqueado'); return false; }
    }
    if (extra.entwine && (!card.entwine || !card.spellModes))
      { this.fail(playerId, 'essa mágica não tem entwine'); return false; }
    if (method === 'miracle' && !obj.miracleAvailable)
      { this.fail(playerId, 'milagre: só no momento em que é a primeira carta comprada no turno'); return false; }
    const viaImpulse = obj.zone === 'exile' && obj.exiledAs === 'playable' && obj.playableUntilTurn === s.turn && !method;
    // Adventure: the creature half is castable from exile after the adventure resolved; aftermath: the back half only from the graveyard.
    const viaAdventure = obj.zone === 'exile' && obj.exiledAs === 'adventure' && !method && !obj.transformed;
    const viaAftermath = !!card.aftermath && obj.transformed === true && obj.zone === 'graveyard';
    const gyPerm = s.players[playerId].graveyardCastPermission;
    const viaGraveyardPermission = !!gyPerm && gyPerm.untilTurn === s.turn && obj.zone === 'graveyard' && !method && cardMatchesFilter(card, gyPerm.filter);
    // Emry: "You may cast that card this turn" (a single card in the graveyard).
    const viaGraveyardCard = obj.zone === 'graveyard' && obj.castableFromGraveyardTurn === s.turn && !method;
    // Grafdigger's Cage: players can't cast spells from graveyards or libraries.
    if ((obj.zone === 'graveyard' || obj.zone === 'library') && PLAYER_IDS.some((p) => s.players[p].zones.battlefield.some((id) => s.objects[id]?.card.cageNoCastFromGraveyardLibrary)))
      { this.fail(playerId, `${card.name}: não se conjura mágicas do cemitério ou da biblioteca (Grafdigger's Cage)`); return false; }
    if (card.aftermath && obj.transformed && obj.zone !== 'graveyard') { this.fail(playerId, 'aftermath: essa metade só pode ser conjurada do cemitério'); return false; }
    const replicateTimes = Math.max(0, extra.replicateTimes ?? 0);
    if (replicateTimes > 0 && !card.replicate) { this.fail(playerId, 'essa mágica não tem replicar'); return false; }
    if (viaExile) {
      if (obj.zone !== 'exile' || (method === 'warp' ? obj.exiledAs !== 'warped' : obj.exiledAs !== method))
        { this.fail(playerId, 'essa carta não está exilada para isso'); return false; }
      if (obj.exiledOnTurn === s.turn && method !== 'warp')
        { this.fail(playerId, 'não pode ser conjurada no mesmo turno em que foi exilada'); return false; }
    } else if (obj.zone !== 'hand' && !viaFlashback && !viaEscape && !viaGraveyard && !viaImpulse && !viaLibraryTop && !viaAdventure && !viaAftermath && !viaGraveyardPermission && !viaGraveyardCard) {
      { this.fail(playerId, 'carta inválida'); return false; }
    }
    if (kicked && !card.kicker)
      { this.fail(playerId, 'essa mágica não tem kicker'); return false; }
    if (card.types.includes('Land'))
      { this.fail(playerId, 'terrenos são jogados, não conjurados'); return false; }
    if (card.automation === 'manual')
      { this.fail(playerId, `${card.name} ainda não é automatizada — use o modo manual`); return false; }
    if (extra.faceDown && !card.morph)
      { this.fail(playerId, 'essa carta não pode ser conjurada virada para baixo'); return false; }
    if (cm?.exileFromHand) {
      const pick = s.players[playerId].zones.hand.map((id) => s.objects[id]).find((o) => o.id !== obj.id && cardMatchesFilter(o.card, cm.exileFromHand!));
      if (!pick) { this.fail(playerId, `${cm.label}: você precisa exilar uma carta da mão`); return false; }
      moveWithEvent(s, pick, 'exile', 'exiled', this.emit);
    }
    if (s.activePlayer !== playerId && s.players[s.activePlayer].zones.battlefield.some((id) => s.objects[id].card.opponentsCantCastOnYourTurn))
      { this.fail(playerId, 'você não pode conjurar mágicas durante o turno do oponente (Voice of Victory)'); return false; }
    if (cm?.kind === 'surge' && s.spellsCastThisTurn === 0)
      { this.fail(playerId, 'surge: você precisa ter conjurado outra mágica neste turno'); return false; }
    if ((cm?.kind === 'prowl' || cm?.kind === 'spectacle') && !s.combatDamageThisTurn)
      { this.fail(playerId, `${cm.kind}: precisa ter causado dano de combate neste turno`); return false; }
    const alurenOn = PLAYER_IDS.some((p) => s.players[p].zones.battlefield.some((id) => s.objects[id].card.aluren));
    const viaAluren = alurenOn && obj.zone === 'hand' && card.types.includes('Creature') && manaValueOf(card.manaCost) <= 3 && !method;
    const viaOmniscience = obj.zone === 'hand' && !method && s.players[playerId].zones.battlefield.some((id) => s.objects[id].card.freeSpellsFromHand);
    const viaFreeExile = viaImpulse && obj.freeCastUntilTurn === s.turn;
    const isInstant = card.types.includes('Instant') || !!card.keywords?.includes('flash') || method === 'sneak' || method === 'miracle' || viaAluren;
    if (!isInstant && !this.sorceryTiming(playerId))
      { this.fail(playerId, 'só pode ser conjurada na sua fase principal com a pilha vazia'); return false; }

    // Modal spells: exactly one mode chosen at cast time — or several ("choose one or both", entwine).
    let mode: import('./cards/types.js').SpellMode | undefined;
    const combineModes = (idxs: number[]): import('./cards/types.js').SpellMode => {
      const allTargets: TargetSpec[] = [];
      const allEffect: import('./cards/types.js').EffectStep[] = [];
      for (const i of idxs) {
        const m = card.spellModes![i];
        const offset = allTargets.length;
        allTargets.push(...(m.targets ?? []));
        allEffect.push(...(JSON.parse(JSON.stringify(m.effect).replace(/"target:(\d+)"/g, (_s, n) => `"target:${parseInt(n, 10) + offset}"`)) as import('./cards/types.js').EffectStep[]));
      }
      return { label: idxs.map((i) => card.spellModes![i].label).join(' + '), targets: allTargets, effect: allEffect };
    };
    if (card.spellModes && card.spellModes.length > 0) {
      const choice = card.spellModeChoice ?? { min: 1, max: 1 };
      if (extra.entwine) mode = combineModes(card.spellModes.map((_, i) => i));
      else {
        const picked = extra.modes ?? (modeIndex !== undefined ? [modeIndex] : []);
        if (picked.length < choice.min || picked.length > choice.max || (!choice.repeat && new Set(picked).size !== picked.length) || picked.some((i) => !card.spellModes![i]))
          { this.fail(playerId, choice.max > 1 ? `escolha de ${choice.min} a ${choice.max} modos da mágica` : 'escolha um modo da mágica'); return false; }
        mode = picked.length === 1 ? card.spellModes[picked[0]] : combineModes(picked);
      }
    }
    // Fuse: both halves of a split card, from the hand, as one spell (costs add up).
    if (extra.fuse) {
      const back = obj.baseCard?.backFace;
      if (!card.fuse || !back || obj.zone !== 'hand' || obj.transformed) { this.fail(playerId, 'fundir: só da mão, em uma carta dividida com fuse'); return false; }
      const off = (card.spellTargets ?? []).length;
      const backEffect = JSON.parse(JSON.stringify(back.spellEffect ?? []).replace(/"target:(\d+)"/g, (_s, n) => `"target:${parseInt(n, 10) + off}"`)) as import('./cards/types.js').EffectStep[];
      mode = { label: `${card.name} + ${back.name} (fuse)`, targets: [...(card.spellTargets ?? []), ...(back.spellTargets ?? [])], effect: [...(card.spellEffect ?? []), ...backEffect] };
    }
    // Casualty N: sacrifice a creature with power ≥ N to copy the spell.
    let casualtyObj: GameObject | undefined;
    if (extra.casualty !== undefined) {
      casualtyObj = s.objects[extra.casualty];
      if (card.casualty === undefined || !casualtyObj || casualtyObj.zone !== 'battlefield' || casualtyObj.controller !== playerId || !isCreature(casualtyObj) || effectivePower(s, casualtyObj) < card.casualty)
        { this.fail(playerId, `casualty ${card.casualty ?? ''}: sacrifique uma criatura sua com poder ${card.casualty ?? 0} ou mais`); return false; }
    }

    // Auras derive their (mandatory) target from the enchant spec; bestow makes the card an Aura; overload has no targets.
    const specs = mode
      ? mode.targets
      : cm?.kind === 'bestow'
        ? [{ what: 'creature' as const }]
        : cm?.kind === 'overload'
          ? []
          : card.enchant
            ? [{ what: card.enchant.what, controlledBy: card.enchant.controlledBy, typeAnyOf: card.enchant.typeAnyOf, zone: card.enchant.zone }]
            : card.spellTargets;
    const targetErr = this.validateTargets(playerId, specs, targets, card.colors, x, kicked);
    if (targetErr) { this.fail(playerId, targetErr); return false; }
    for (const t of targets) if (t.kind === 'object') this.emit({ type: 'targeted', objectId: t.id, by: playerId });
    // Ward — Pay N life: paid up front when targeting an opponent's warded permanent.
    let wardLife = 0;
    for (const t of targets) {
      if (t.kind !== 'object') continue;
      const w = s.objects[t.id];
      if (w && w.zone === 'battlefield' && w.controller !== playerId) {
        if (w.card.wardLife) wardLife += w.card.wardLife;
        // Hexing Squelcher: "Other creatures you control have 'Ward—Pay 2 life.'"
        if (isCreature(w)) for (const gid of s.players[w.controller].zones.battlefield) { const g = s.objects[gid]; if (g && gid !== w.id && g.card.grantWardLifeOthers) wardLife += g.card.grantWardLifeOthers; }
      }
    }
    if (wardLife > 0 && s.players[playerId].life < wardLife)
      { this.fail(playerId, `ward: você precisa pagar ${wardLife} pontos de vida`); return false; }

    // Additional cost: sacrifice (Fling-style; flashback may also demand one,
    // e.g. Cabal Therapy; emerge sacrifices a creature; bargain sacrifices an artifact/enchantment/token). Validated before any payment.
    const sacReq =
      (card.additionalCost?.sacrifice && !(card.additionalCost.either && (sacrifices ?? []).length === 0) ? { sacrifice: card.additionalCost.sacrifice, count: card.additionalCost.count } : undefined) ??
      (viaFlashback && card.flashback?.sacrifice
        ? { sacrifice: card.flashback.sacrifice, count: card.flashback.sacrificeCount ?? 1 }
        : cm?.kind === 'emerge'
          ? { sacrifice: { what: 'creature' as const }, count: 1 }
          : kicked && card.kicker?.sacrifice
            ? { sacrifice: card.kicker.sacrifice, count: 1 }
            : undefined);
    // Other additional costs: discard N (from the action), pay N life, exile N cards from your graveyard (first matching if not given).
    const addl = card.additionalCost;
    const addlDiscards = addl?.discard ? (extra.discards ?? []) : [];
    if (addl?.discard && !(addl.either && (sacrifices ?? []).length > 0)) {
      if (addlDiscards.length !== addl.discard || new Set(addlDiscards).size !== addlDiscards.length)
        { this.fail(playerId, `custo adicional: descarte ${addl.discard} carta(s)`); return false; }
      for (const id of addlDiscards) { const c = s.objects[id]; if (!c || c.zone !== 'hand' || c.owner !== playerId || id === obj.id) { this.fail(playerId, 'carta inválida para descartar'); return false; } }
    }
    if (addl?.payLife && s.players[playerId].life < addl.payLife)
      { this.fail(playerId, `custo adicional: pague ${addl.payLife} pontos de vida`); return false; }
    if (viaFlashback && card.flashback?.payLife && s.players[playerId].life < card.flashback.payLife)
      { this.fail(playerId, `flashback: pague ${card.flashback.payLife} pontos de vida`); return false; }
    let addlGyExile: number[] = [];
    if (addl?.exileFromGraveyard) {
      const { filter, count } = addl.exileFromGraveyard;
      const given = method !== 'escape' ? extra.escapeExile ?? [] : [];
      addlGyExile = given.length > 0 ? given : s.players[playerId].zones.graveyard.filter((id) => id !== obj.id && cardMatchesFilter(s.objects[id].card, filter)).slice(0, count);
      if (addlGyExile.length !== count || addlGyExile.some((id) => { const g = s.objects[id]; return !g || g.zone !== 'graveyard' || g.owner !== playerId || !cardMatchesFilter(g.card, filter); }))
        { this.fail(playerId, `custo adicional: exile ${count} carta(s) do seu cemitério`); return false; }
    }
    const sacs = sacrifices ?? [];
    if (sacReq) {
      const need = sacReq.count ?? 1;
      if (sacs.length !== need)
        { this.fail(playerId, `custo adicional: sacrifique ${need} permanente(s)`); return false; }
      for (const id of sacs) {
        const sacObj = s.objects[id];
        if (!sacObj || sacObj.zone !== 'battlefield' || sacObj.controller !== playerId)
          { this.fail(playerId, 'sacrifício inválido'); return false; }
        if (!matchFilter({ controller: playerId, sourceId: obj.id }, sacReq.sacrifice, sacObj))
          { this.fail(playerId, `${sacObj.card.name} não satisfaz o custo adicional`); return false; }
      }
    } else if (sacs.length > 0) {
      { this.fail(playerId, 'essa mágica não tem custo adicional de sacrifício'); return false; }
    }

    // Alternative cost (Force of Will): life and/or exiling hand cards
    // replace the mana cost entirely.
    const alt = useAltCost ? card.altCost : undefined;
    if (useAltCost && !alt)
      { this.fail(playerId, 'essa mágica não tem custo alternativo'); return false; }
    if (alt?.condition && !staticConditionHolds(s, { ...obj, controller: playerId }, alt.condition))
      { this.fail(playerId, `${card.name}: a condição do custo alternativo não vale agora`); return false; }
    let altLand: GameObject | undefined;
    if (alt?.returnLand) {
      const lands = s.players[playerId].zones.battlefield.map((id) => s.objects[id]).filter((o) => matchFilter({ controller: playerId, sourceId: obj.id }, alt.returnLand!, o));
      altLand = lands.find((o) => o.tapped) ?? lands[0];
      if (!altLand) { this.fail(playerId, `${card.name}: você precisa controlar um terreno para devolver`); return false; }
    }
    if (useAltCost && viaFlashback)
      { this.fail(playerId, 'custo alternativo não se combina com flashback'); return false; }
    const exiles = altExile ?? [];
    if (alt) {
      const needExile = alt.exileFromHand?.count ?? 0;
      if (exiles.length !== needExile || new Set(exiles).size !== exiles.length)
        { this.fail(playerId, `custo alternativo: exile ${needExile} carta(s) da mão`); return false; }
      for (const id of exiles) {
        const exObj = s.objects[id];
        if (!exObj || exObj.zone !== 'hand' || exObj.owner !== playerId || id === obj.id)
          { this.fail(playerId, 'carta inválida para exilar'); return false; }
        if (alt.exileFromHand && !cardMatchesFilter(exObj.card, alt.exileFromHand.filter))
          { this.fail(playerId, `${exObj.card.name} não satisfaz o custo alternativo`); return false; }
      }
      if (alt.payLife && s.players[playerId].life < alt.payLife)
        { this.fail(playerId, `você precisa de ${alt.payLife} pontos de vida para pagar`); return false; }
    } else if (exiles.length > 0) {
      { this.fail(playerId, 'essa mágica não tem custo alternativo'); return false; }
    }

    // Escape: exile other graveyard cards as part of the cost.
    const escapeIds = extra.escapeExile ?? [];
    if (viaEscape && cm) {
      const need = cm.exileFromGraveyard ?? 0;
      if (cm.escapeTypes !== undefined) {
        const types = new Set(escapeIds.flatMap((id) => s.objects[id]?.card.types ?? []));
        if (types.size < cm.escapeTypes || new Set(escapeIds).size !== escapeIds.length)
          { this.fail(playerId, `escapar: exile outras cartas do seu cemitério com ${cm.escapeTypes} ou mais tipos de carta entre elas`); return false; }
      } else if (escapeIds.length !== need || new Set(escapeIds).size !== escapeIds.length)
        { this.fail(playerId, `escapar: exile ${need} outras cartas do seu cemitério`); return false; }
      for (const id of escapeIds) {
        const g = s.objects[id];
        if (!g || g.zone !== 'graveyard' || g.owner !== playerId || id === obj.id)
          { this.fail(playerId, 'carta inválida para exilar do cemitério'); return false; }
      }
    }

    let xValue: number | undefined;
    const kickerTimes = card.multikicker ? Math.max(0, extra.kickerTimes ?? (kicked ? 1 : 0)) : kicked ? 1 : 0;
    if (alt && !alt.manaCost) {
      // X with an alternative cost is untypical; treat as 0 when present.
      if (alt.payLife) changeLife(s, playerId, -alt.payLife, `custo de ${card.name}`, this.emit);
      for (const id of exiles) moveWithEvent(s, s.objects[id], 'exile', 'exiled', this.emit);
      if (altLand) moveWithEvent(s, altLand, 'hand', 'returned', this.emit);
    } else {
      const baseCost = extra.faceDown ? '{3}' : cm ? cm.cost : viaFlashback ? card.flashback!.cost : alt?.manaCost ?? card.manaCost;
      // No mana cost (Gaea's Will, Ancestral Vision): only castable by another means (suspend, free casts).
      if (!card.manaCost && !cm && !viaFlashback && !extra.faceDown && !viaOmniscience && !viaAluren && !viaFreeExile)
        { this.fail(playerId, `${card.name} não tem custo de mana: só pode ser conjurada de outro jeito (suspender, de graça)`); return false; }
      const cost = parseCost(baseCost);
      if (extra.fuse && obj.baseCard?.backFace) {
        const bc = parseCost(obj.baseCard.backFace.manaCost);
        cost.generic += bc.generic;
        cost.colorless += bc.colorless;
        cost.colored.push(...bc.colored);
        cost.hybrid.push(...bc.hybrid);
        cost.phyrexian.push(...bc.phyrexian);
        cost.xCount += bc.xCount;
      }
      if (kickerTimes > 0 && card.kicker) {
        const kick = parseCost(card.kicker.cost);
        for (let i = 0; i < kickerTimes; i++) {
          cost.generic += kick.generic;
          cost.colorless += kick.colorless;
          cost.colored.push(...kick.colored);
          cost.hybrid.push(...kick.hybrid);
          cost.phyrexian.push(...kick.phyrexian);
          cost.xCount += kick.xCount;
        }
      }
      if (extra.buyback) {
        if (!card.buyback) { this.fail(playerId, 'essa mágica não tem buyback'); return false; }
        const bb = parseCost(card.buyback);
        cost.generic += bb.generic;
        cost.colorless += bb.colorless;
        cost.colored.push(...bb.colored);
      }
      if (extra.entwine && card.entwine) {
        const en = parseCost(card.entwine);
        cost.generic += en.generic;
        cost.colorless += en.colorless;
        cost.colored.push(...en.colored);
      }
      // Spree: each chosen mode adds its own cost.
      if (card.spellModes && card.spellModes.some((m) => m.cost)) {
        const chosenIdx = extra.entwine ? card.spellModes.map((_, i) => i) : extra.modes ?? (modeIndex !== undefined ? [modeIndex] : []);
        for (const i of chosenIdx) {
          const mc = card.spellModes[i]?.cost;
          if (!mc) continue;
          const pc = parseCost(mc);
          cost.generic += pc.generic;
          cost.colorless += pc.colorless;
          cost.colored.push(...pc.colored);
        }
      }
      if (replicateTimes > 0 && card.replicate) {
        const rp = parseCost(card.replicate);
        for (let i = 0; i < replicateTimes; i++) {
          cost.generic += rp.generic;
          cost.colorless += rp.colorless;
          cost.colored.push(...rp.colored);
        }
      }
      if (cost.xCount > 0) {
        if (x === undefined || !Number.isInteger(x) || x < 0)
          { this.fail(playerId, 'escolha um valor de X'); return false; }
        xValue = x;
        cost.generic += x * cost.xCount;
      }
      cost.generic += this.wardTax(playerId, targets);
      // Cost modifiers: "X spells you cast cost {N} less", "~ costs {1} less for each Y", "spells your opponents cast cost more".
      cost.generic = Math.max(0, cost.generic + this.costModifierTotal(playerId, card, obj, targets, obj.zone !== 'hand'));
      // Emerge: the emerge cost is reduced by the sacrificed creature's mana value.
      if (cm?.kind === 'emerge' && sacs[0] !== undefined)
        cost.generic = Math.max(0, cost.generic - manaValueOf(s.objects[sacs[0]].card.manaCost));
      // Affinity for artifacts: {1} less per artifact you control.
      if (card.affinity === 'artifact')
        cost.generic = Math.max(0, cost.generic - s.players[playerId].zones.battlefield.filter((id) => s.objects[id].card.types.includes('Artifact')).length);
      if (viaOmniscience || viaAluren || (viaFreeExile && !obj.payWithEnergy)) { cost.generic = 0; cost.colorless = 0; cost.colored = []; cost.hybrid = []; cost.phyrexian = []; }
      if (viaFreeExile && obj.payWithEnergy) {
        const need = manaValueOf(card.manaCost);
        if (s.players[playerId].energy < need) { this.fail(playerId, `você precisa de ${need} de energia para conjurar ${card.name}`); return false; }
        s.players[playerId].energy -= need;
        cost.generic = 0; cost.colorless = 0; cost.colored = []; cost.hybrid = []; cost.phyrexian = [];
      }
      // Strive (Kiora's Dismissal): {cost} more for each target beyond the first.
      if (card.strive && targets.length > 1) {
        const extra = parseCost(card.strive);
        for (let i = 1; i < targets.length; i++) { cost.generic += extra.generic; cost.colorless += extra.colorless; cost.colored.push(...extra.colored); cost.hybrid.push(...extra.hybrid); }
      }
      let plan = planPayment(s, playerId, cost, { poolOnly: !!this.options.manualMana });
      // Convoke / Improvise / Delve: only when the mana alone doesn't cover it —
      // tap creatures / artifacts, exile graveyard cards, one generic each.
      const helpers: { kind: 'convoke' | 'improvise' | 'delve'; ids: number[] }[] = [];
      if (!plan && (card.convoke || card.improvise || card.delve)) {
        const pool = (pred: (o: GameObject) => boolean) => s.players[playerId].zones.battlefield.map((id) => s.objects[id]).filter((o) => !o.tapped && pred(o)).map((o) => o.id);
        const candidates: { kind: 'convoke' | 'improvise' | 'delve'; ids: number[] }[] = [];
        if (card.convoke) candidates.push({ kind: 'convoke', ids: pool((o) => isCreature(o)) });
        if (card.improvise) candidates.push({ kind: 'improvise', ids: pool((o) => o.card.types.includes('Artifact') && !isCreature(o)) });
        if (card.delve) candidates.push({ kind: 'delve', ids: s.players[playerId].zones.graveyard.filter((id) => id !== obj.id) });
        for (const c of candidates) {
          for (const id of c.ids) {
            if (cost.generic <= 0) break;
            cost.generic -= 1;
            (helpers.find((h) => h.kind === c.kind) ?? helpers[helpers.push({ kind: c.kind, ids: [] }) - 1]).ids.push(id);
            plan = planPayment(s, playerId, cost);
            if (plan) break;
          }
          if (plan) break;
        }
      }
      if (!plan && this.options.manualMana) return this.deferPayment(playerId, card.name, cost);
      if (!plan) { this.fail(playerId, 'mana insuficiente'); return false; }
      this.payWithPlan(playerId, plan);
      // Sunburst / converge: distinct colors of mana actually spent.
      const spentColors = new Set<string>();
      for (const t of plan.taps) for (const sym of t.produce) if (sym !== 'C') spentColors.add(sym);
      for (const sym of plan.fromPool) if (sym !== 'C') spentColors.add(sym);
      obj.colorsSpent = spentColors.size;
      obj.manaSpent = cost.generic + cost.colored.length + cost.colorless + cost.hybrid.length + (cost.phyrexian?.length ?? 0);
      for (const h of helpers) {
        for (const id of h.ids) {
          const o = s.objects[id];
          if (h.kind === 'delve') { moveWithEvent(s, o, 'exile', 'exiled', this.emit); if (o.card.types.includes('Instant') || o.card.types.includes('Sorcery')) obj.delvedCount = (obj.delvedCount ?? 0) + 1; }
          else setTapped(s, o, true, this.emit);
        }
        this.emit({ type: 'fizzled', description: `${card.name}: ${h.kind} pagou ${h.ids.length} de mana genérica` });
      }
    }
    for (const id of escapeIds) moveWithEvent(s, s.objects[id], 'exile', 'exiled', this.emit);
    for (const id of addlGyExile) moveWithEvent(s, s.objects[id], 'exile', 'exiled', this.emit);
    for (const id of addlDiscards) {
      const c = s.objects[id];
      moveWithEvent(s, c, 'graveyard', 'discarded', this.emit);
      this.emit({ type: 'discarded', player: playerId, objectId: id, cardName: c.card.name });
    }
    if (addl?.payLife) changeLife(s, playerId, -addl.payLife, `custo adicional de ${card.name}`, this.emit);
    if (viaFlashback && card.flashback?.payLife) changeLife(s, playerId, -card.flashback.payLife, `flashback de ${card.name}`, this.emit);
    if (wardLife > 0) changeLife(s, playerId, -wardLife, 'ward (vida)', this.emit);
    if (retraceDiscard) {
      moveWithEvent(s, retraceDiscard, 'graveyard', 'discarded', this.emit);
      this.emit({ type: 'discarded', player: playerId, objectId: retraceDiscard.id, cardName: retraceDiscard.card.name });
    }
    if (sneakAttacker) moveWithEvent(s, sneakAttacker, 'hand', 'returned', this.emit);

    // Pay the sacrifice cost (power recorded first, for 'sacrificedPower').
    let sacrificedPower: number | undefined;
    if (sacs.length > 0) {
      sacrificedPower = sacs.reduce((sum, id) => sum + Math.max(0, effectivePower(s, s.objects[id])), 0);
      for (const id of sacs) moveWithEvent(s, s.objects[id], 'graveyard', 'sacrificed', this.emit);
    }
    if (casualtyObj) moveWithEvent(s, casualtyObj, 'graveyard', 'sacrificed', this.emit);

    const fromHand = obj.zone === 'hand';
    removeFromCurrentZone(s, obj);
    obj.zone = 'stack';
    obj.kicked = kickerTimes > 0;
    obj.impending = !!alt?.impending;
    obj.kickerTimes = kickerTimes;
    obj.castMethod = cm?.kind;
    obj.buybackPaid = !!extra.buyback;
    obj.faceDown = !!extra.faceDown;
    obj.exiledAs = undefined;
    obj.miracleAvailable = undefined;
    obj.castX = xValue;
    obj.wasCast = true;
    obj.castFromHand = fromHand;
    obj.freeCastUntilTurn = undefined;
    obj.payWithEnergy = undefined;
    for (const c of card.colors) if (!(s.players[playerId].colorsCastThisTurn ??= []).includes(c)) s.players[playerId].colorsCastThisTurn!.push(c);
    if (viaGraveyardPermission && gyPerm) {
      if (!gyPerm.keep) s.players[playerId].graveyardCastPermission = undefined;
      if (gyPerm.exileInstantSorcery && (card.types.includes('Instant') || card.types.includes('Sorcery'))) obj.exileOnResolveOnce = true;
    }
    if (fromHand && card.rebound) obj.castMethod = obj.castMethod ?? undefined, (obj as GameObject & { reboundFromHand?: boolean }).reboundFromHand = true;
    const description =
      (mode ? `${card.name} — ${mode.label}` : card.name) +
      (xValue !== undefined ? ` (X=${xValue})` : '') +
      (kickerTimes > 0 ? ` (com kicker${kickerTimes > 1 ? ` ×${kickerTimes}` : ''})` : '') +
      (viaFlashback ? ' (flashback)' : '') +
      (cm ? ` (${cm.label})` : '') +
      (extra.faceDown ? ' (virada para baixo)' : '') +
      (extra.buyback ? ' (buyback)' : '') +
      (alt ? ' (custo alternativo)' : '');
    const baseEffect = mode ? mode.effect : cm?.kind === 'overload' && card.overloadEffect ? card.overloadEffect : card.spellEffect ?? [];
    const gift = kicked && card.kicker?.gift ? card.kicker.gift : [];
    const effect = kicked && card.kicker ? [...gift, ...baseEffect, ...card.kicker.effect] : baseEffect;
    s.stack.push({
      id: s.nextStackId++,
      kind: 'spell',
      sourceId: obj.id,
      controller: playerId,
      cardName: card.name,
      effect,
      targets,
      description,
      xValue,
      sacrificedPower,
      flashback: viaFlashback,
    });
    // Storm: one copy per spell cast earlier this turn (they resolve first). Replicate: one copy per extra payment.
    const copies = (card.storm ? s.spellsCastThisTurn : 0) + replicateTimes + (casualtyObj ? 1 : 0);
    s.spellsCastThisTurn += 1;
    for (let i = 0; i < copies; i++) {
      s.stack.push({
        id: s.nextStackId++,
        kind: 'copy',
        sourceId: obj.id,
        controller: playerId,
        cardName: card.name,
        effect,
        targets: [...targets],
        description: `Cópia de ${card.name}`,
        xValue,
        sacrificedPower,
      });
    }
    s.passCount = 0;
    s.priority = playerId;
    s.players[playerId].spellsCastThisTurn = (s.players[playerId].spellsCastThisTurn ?? 0) + 1;
    s.players[playerId].spellsCastThisGame = (s.players[playerId].spellsCastThisGame ?? 0) + 1;
    if (!card.types.includes('Creature')) s.players[playerId].noncreatureSpellsThisTurn = (s.players[playerId].noncreatureSpellsThisTurn ?? 0) + 1;
    this.emit({ type: 'spellCast', player: playerId, objectId: obj.id, cardName: card.name, targets });
    if (copies > 0) this.emit({ type: 'copiesCreated', cardName: card.name, count: copies, reason: 'storm' });
    this.fireCastTriggers(playerId, card, obj, targets);
    if (card.cascade && !extra.faceDown) this.doCascade(playerId, obj);
    return true;
  }

  /** Cascade: exile from the top until a cheaper nonland card; cast it free (if it needs no targets); rest to the bottom. */
  private doCascade(playerId: PlayerId, spell: GameObject): void {
    const s = this.state;
    const mv = costCmc(parseCost(spell.card.manaCost));
    const lib = s.players[playerId].zones.library;
    const exiled: GameObject[] = [];
    let hit: GameObject | null = null;
    while (lib.length > 0) {
      const top = s.objects[lib[0]];
      moveWithEvent(s, top, 'exile', 'exiled', this.emit);
      exiled.push(top);
      if (!top.card.types.includes('Land') && costCmc(parseCost(top.card.manaCost)) < mv && top.card.automation !== 'manual') { hit = top; break; }
    }
    this.emit({ type: 'cascaded', player: playerId, cardName: spell.card.name, hit: hit?.card.name ?? null });
    if (hit) castCardFree(s, hit, playerId, this.emit, 'cascade');
    // As demais vão para o fundo da biblioteca (ordem aleatória simplificada: a mesma).
    for (const o of exiled) if (o.zone === 'exile') moveWithEvent(s, o, 'library', 'returned', this.emit, 'bottom');
  }

  /** Morph / Disguise: turn a face-down permanent face up by paying its morph cost (special action, any time you have priority). */
  private doTurnFaceUp(playerId: PlayerId, objectId: number): boolean {
    const s = this.state;
    const err = this.requirePriority(playerId);
    if (err) { this.fail(playerId, err); return false; }
    const obj = s.objects[objectId];
    if (!obj || obj.zone !== 'battlefield' || obj.controller !== playerId || !obj.faceDown || !obj.card.morph)
      { this.fail(playerId, 'isso não é uma permanente sua virada para baixo'); return false; }
    const plan = planPayment(s, playerId, parseCost(obj.card.morph.cost));
    if (!plan) { this.fail(playerId, 'mana insuficiente'); return false; }
    this.payWithPlan(playerId, plan);
    obj.faceDown = false;
    if (obj.card.morph.megamorph) {
      const total = (obj.counters['+1/+1'] ?? 0) + 1;
      obj.counters['+1/+1'] = total;
      this.emit({ type: 'countersChanged', objectId: obj.id, cardName: obj.card.name, counter: '+1/+1', delta: 1, total });
    }
    this.emit({ type: 'turnedFaceUp', objectId: obj.id, cardName: obj.card.name, player: playerId });
    return true;
  }

  /** Ninjutsu: after blockers, return an unblocked attacker to hand and put the ninja onto the battlefield attacking. */
  private doNinjutsu(playerId: PlayerId, ninjaId: number, attackerId: number): boolean {
    const s = this.state;
    const err = this.requirePriority(playerId);
    if (err) { this.fail(playerId, err); return false; }
    const ninja = s.objects[ninjaId];
    const atk = s.objects[attackerId];
    if (!ninja || ninja.zone !== 'hand' || ninja.owner !== playerId || !ninja.card.ninjutsu)
      { this.fail(playerId, 'essa carta não tem ninjutsu'); return false; }
    if (s.step !== 'declareBlockers' || s.combatAwaiting !== null || s.activePlayer !== playerId)
      { this.fail(playerId, 'ninjutsu: só depois dos bloqueadores serem declarados, no seu turno'); return false; }
    if (!atk || atk.zone !== 'battlefield' || atk.controller !== playerId || !atk.attacking || atk.wasBlocked)
      { this.fail(playerId, 'escolha um atacante seu não bloqueado'); return false; }
    const plan = planPayment(s, playerId, parseCost(ninja.card.ninjutsu));
    if (!plan) { this.fail(playerId, 'mana insuficiente'); return false; }
    this.payWithPlan(playerId, plan);
    const pw = atk.pwTarget;
    moveWithEvent(s, atk, 'hand', 'returned', this.emit);
    moveWithEvent(s, ninja, 'battlefield', 'resolved', this.emit);
    ninja.tapped = true;
    ninja.attacking = true;
    ninja.pwTarget = pw;
    this.emit({ type: 'tappedChanged', objectId: ninja.id, cardName: ninja.card.name, tapped: true });
    return true;
  }

  /** Scheduled actions (dash/blitz/unearth/encore/warp/rebound/suspend). */
  private runDelayed(at: 'endStep' | 'nextUpkeep', player?: PlayerId): void {
    const s = this.state;
    const due = s.delayed.filter((d) => d.at === at && (at === 'endStep' || d.player === player));
    s.delayed = s.delayed.filter((d) => !due.includes(d));
    for (const d of due) {
      const obj = s.objects[d.objectId];
      if (!obj) continue;
      switch (d.action) {
        case 'exile':
          if (obj.zone === 'battlefield') {
            const warped = obj.castMethod === 'warp';
            obj.unearthed = false;
            moveWithEvent(s, obj, 'exile', 'exiled', this.emit);
            if (warped) obj.exiledAs = 'warped';
          }
          break;
        case 'sacrifice':
          if (obj.zone === 'battlefield') moveWithEvent(s, obj, 'graveyard', 'sacrificed', this.emit);
          break;
        case 'returnToHand':
          if (obj.zone === 'battlefield') moveWithEvent(s, obj, 'hand', 'returned', this.emit);
          break;
        case 'castFree':
          if (obj.zone === 'exile') {
            if (castCardFree(s, obj, obj.owner, this.emit, obj.exiledAs === 'suspended' ? 'suspender' : 'rebound') && obj.card.types.includes('Creature'))
              obj.untilEot.keywords.push('haste');
          }
          break;
        case 'effect':
          s.stack.push({
            id: s.nextStackId++,
            kind: 'ability',
            sourceId: obj.id,
            controller: d.controller ?? obj.controller,
            cardName: obj.card.name,
            effect: d.effect ?? [],
            targets: d.targets ?? [],
            description: `${obj.card.name}: efeito atrasado`,
          });
          s.passCount = 0;
          break;
      }
    }
  }

  /** Ward: targeting an opponent's warded permanent costs {N} more (paid up front). */
  private wardTax(playerId: PlayerId, targets: TargetChoice[]): number {
    let tax = 0;
    for (const t of targets) {
      if (t.kind !== 'object') continue;
      const obj = this.state.objects[t.id];
      if (!obj || obj.zone !== 'battlefield' || obj.controller === playerId) continue;
      if (obj.card.ward) tax += obj.card.ward;
      // "Enchanted creature has ward {N}".
      for (const a of Object.values(this.state.objects)) if (a.zone === 'battlefield' && a.attachedTo === obj.id && a.card.attachEffect?.ward) tax += a.card.attachEffect.ward;
    }
    return tax;
  }

  /** Sum of generic-cost changes from cost modifiers on the battlefield and on the card itself (negative = cheaper). */
  private costModifierTotal(playerId: PlayerId, card: CardDefinition, obj: GameObject, targets: TargetChoice[], notFromHand = false): number {
    const s = this.state;
    let delta = 0;
    const countOn = (filter: import('./cards/types.js').FilterSpec, controller: PlayerId) =>
      PLAYER_IDS.flatMap((p) => s.players[p].zones.battlefield).map((id) => s.objects[id]).filter((o) => matchFilter({ controller, sourceId: obj.id, state: s }, filter, o)).length;
    const countGy = (filter: import('./cards/types.js').FilterSpec, controller: PlayerId) =>
      s.players[controller].zones.graveyard.filter((id) => cardMatchesFilter(s.objects[id].card, filter)).length;
    const domain = (controller: PlayerId) => {
      const basics = ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'];
      const types = new Set<string>();
      for (const id of s.players[controller].zones.battlefield) {
        const o = s.objects[id];
        if (!o.card.types.includes('Land')) continue;
        for (const st of o.card.subtypes) if (basics.includes(st)) types.add(st);
        if (o.card.everyNonbasicLandType) { /* Planar Nexus: only nonbasic types */ }
      }
      return types.size;
    };
    // The card's own "~ costs {N} less for each X".
    for (const m of card.costModifiers ?? []) {
      if (!m.self) continue;
      const scale = m.perSpellsCastThisTurn ? (s.players[playerId].spellsCastThisTurn ?? 0) : m.per ? countOn(m.per, playerId) : m.perGraveyard ? countGy(m.perGraveyard, playerId) : m.perDomain ? domain(playerId) : 1;
      delta += m.amount * scale;
    }
    // Permanents on the battlefield.
    for (const p of PLAYER_IDS) {
      for (const id of s.players[p].zones.battlefield) {
        const src = s.objects[id];
        for (const m of src.card.costModifiers ?? []) {
          if (m.self) continue;
          const mineToCaster = src.controller === playerId;
          if (m.whose === 'you' && !mineToCaster) continue;
          if (m.whose === 'opponent' && mineToCaster) continue;
          if (m.filter && !cardMatchesFilter(card, m.filter)) continue;
          if (m.notFromHand && !notFromHand) continue;
          if (m.chosenName && src.chosenName !== card.name) continue;
          if (m.targetsSelf && !targets.some((t) => t.kind === 'object' && t.id === src.id)) continue;
          const scale = m.perSpellsCastThisTurn ? (s.players[playerId].spellsCastThisTurn ?? 0) : m.per ? countOn(m.per, src.controller) : m.perGraveyard ? countGy(m.perGraveyard, src.controller) : m.perDomain ? domain(src.controller) : 1;
          delta += m.amount * scale;
        }
      }
    }
    return delta;
  }

  private payWithPlan(playerId: PlayerId, plan: import('./mana.js').PaymentPlan): void {
    const s = this.state;
    s.reversibleTaps = []; // mana committed: taps are no longer undoable
    for (const tap of plan.taps) {
      const src = s.objects[tap.objectId];
      setTapped(s, src, true, this.emit);
      // A fonte produz tudo de uma vez (Sol Ring); a sobra fica flutuando.
      for (const sym of tap.produce) s.players[playerId].manaPool[sym] += 1;
    }
    for (const sym of plan.fromPool) {
      s.players[playerId].manaPool[sym] = Math.max(0, s.players[playerId].manaPool[sym] - 1);
    }
    if (plan.lifePaid > 0) changeLife(s, playerId, -plan.lifePaid, 'mana phyrexiana', this.emit);
  }

  private doActivateAbility(
    playerId: PlayerId,
    objectId: number,
    abilityIndex: number,
    targets: TargetChoice[],
    sacrifices?: number[],
    manaColor?: 'W' | 'U' | 'B' | 'R' | 'G' | 'C',
    discards?: number[],
    tapCreature?: number,
    x?: number,
  ): boolean {
    const s = this.state;
    const obj = s.objects[objectId];
    const mine = !!obj && (obj.zone === 'battlefield' ? obj.controller === playerId : obj.owner === playerId);
    if (!obj || !mine || (obj.zone !== 'battlefield' && obj.zone !== 'graveyard' && obj.zone !== 'hand'))
      { this.fail(playerId, 'permanente inválida'); return false; }
    const ability = obj.card.abilities?.[abilityIndex];
    if (ability?.kind === 'loyalty') return this.doActivateLoyalty(playerId, obj, ability, targets);
    if (!ability || ability.kind !== 'activated')
      { this.fail(playerId, 'habilidade inválida'); return false; }
    // Face-down permanents have no abilities.
    if (obj.faceDown) { this.fail(playerId, 'carta virada para baixo não tem habilidades'); return false; }
    // Level up bands / Class levels.
    if (!abilityActive(obj, ability)) { this.fail(playerId, `${obj.card.name}: essa habilidade não está ativa neste nível`); return false; }
    if (ability.requiresLevel !== undefined && currentLevel(obj) !== ability.requiresLevel)
      { this.fail(playerId, `${obj.card.name}: só no nível ${ability.requiresLevel}`); return false; }
    // Split second.
    if (!ability.isManaAbility && s.stack.some((i) => i.kind === 'spell' && s.objects[i.sourceId]?.card.splitSecond))
      { this.fail(playerId, 'fração de segundo: nenhuma habilidade pode ser ativada agora'); return false; }
    // Graveyard / hand abilities (Unearth, Scavenge, Embalm, Foretell…).
    if ((ability.zone ?? 'battlefield') !== obj.zone)
      { this.fail(playerId, `${obj.card.name}: essa habilidade só funciona ${ability.zone === 'graveyard' ? 'do cemitério' : ability.zone === 'hand' ? 'da mão' : 'no campo de batalha'}`); return false; }

    // Stony Silence / Pithing Needle.
    if (obj.card.types.includes('Artifact') && PLAYER_IDS.some((p) => s.players[p].zones.battlefield.some((id) => { const l = s.objects[id].card.artifactAbilitiesLocked; return l === true || (l === 'opponents' && p !== playerId); })))
      { this.fail(playerId, `${obj.card.name}: habilidades ativadas de artefatos não podem ser ativadas`); return false; }
    if (!ability.isManaAbility && PLAYER_IDS.some((p) => s.players[p].zones.battlefield.some((id) => s.objects[id].card.lockChosenName && s.objects[id].chosenName === obj.card.name)))
      { this.fail(playerId, `${obj.card.name}: habilidades com esse nome estão travadas`); return false; }
    // Mana abilities may be activated at any time; others need priority.
    if (!ability.isManaAbility && !ability.immediate) {
      const err = this.requirePriority(playerId, { manaAbility: !!ability.isManaAbility });
      if (err) { this.fail(playerId, err); return false; }
      if (ability.sorceryOnly && !this.sorceryTiming(playerId))
        { this.fail(playerId, 'só na sua fase principal com a pilha vazia (como uma feitiçaria)'); return false; }
    } else if ((s.pendingDecision && !(s.pendingDecision.type === 'payMana' && s.pendingDecision.player === playerId)) || s.status !== 'playing') {
      { this.fail(playerId, 'agora não'); return false; }
    }

    // Metalcraft-style / hideaway activation conditions.
    if (ability.condition) {
      const c = ability.condition;
      if (c.controlsAtLeast) {
        const req = c.controlsAtLeast;
        const have = s.players[playerId].zones.battlefield
          .map((id) => s.objects[id])
          .filter((o) => matchFilter({ controller: playerId, sourceId: obj.id }, req.filter, o)).length;
        if (have < req.count) {
          this.fail(playerId, `${obj.card.name}: requer ${req.count} ${req.filter.what ?? 'permanente'}(s) — você controla ${have}`);
          return false;
        }
      }
      if (c.libraryAtMost !== undefined && !PLAYER_IDS.some((p) => s.players[p].zones.library.length <= c.libraryAtMost!))
        { this.fail(playerId, `${obj.card.name}: só se uma biblioteca tiver ${c.libraryAtMost} cartas ou menos`); return false; }
      if (c.attackedWithAtLeast !== undefined && (s.attackersThisTurn ?? 0) < c.attackedWithAtLeast)
        { this.fail(playerId, `${obj.card.name}: só se você atacou com ${c.attackedWithAtLeast} ou mais criaturas neste turno`); return false; }
      if (c.completedDungeon && s.players[playerId].completedDungeons === 0)
        { this.fail(playerId, `${obj.card.name}: só se você completou uma masmorra`); return false; }
      if (c.isMonarch && s.monarch !== playerId)
        { this.fail(playerId, `${obj.card.name}: só se você for o monarca`); return false; }
      if (c.cond && !staticConditionHolds(s, { ...obj, controller: playerId }, c.cond))
        { this.fail(playerId, `${obj.card.name}: a condição de ativação não vale agora`); return false; }
    }
    // "Activate only once each turn" / "no more than twice each turn".
    if (ability.maxPerTurn !== undefined && (obj.activationsThisTurn?.[abilityIndex] ?? 0) >= ability.maxPerTurn)
      { this.fail(playerId, `${obj.card.name}: essa habilidade só pode ser ativada ${ability.maxPerTurn === 1 ? 'uma vez' : `${ability.maxPerTurn} vezes`} por turno`); return false; }

    // "Add one mana of any color": the activation must carry the color.
    const choiceStep = ability.effect.find((e) => e.op === 'addManaChoice' || e.op === 'addManaOptions');
    if (choiceStep && choiceStep.op === 'addManaChoice') {
      if (!manaColor || manaColor === 'C') { this.fail(playerId, 'escolha a cor da mana'); return false; }
      if (choiceStep.colors && !choiceStep.colors.includes(manaColor))
        { this.fail(playerId, `${obj.card.name} não produz {${manaColor}}`); return false; }
      if (choiceStep.colorsOfImprint) {
        const imp = obj.imprintedId !== undefined ? s.objects[obj.imprintedId] : undefined;
        if (!imp || !imp.card.colors.includes(manaColor)) { this.fail(playerId, `${obj.card.name}: a carta exilada não tem essa cor`); return false; }
      }
    }
    if (choiceStep && choiceStep.op === 'addManaOptions') {
      if (!manaColor) { this.fail(playerId, 'escolha a mana'); return false; }
      const chosen = obj.chosenColor;
      if (!choiceStep.options.includes(manaColor) && !(choiceStep.chosenColor && chosen === manaColor))
        { this.fail(playerId, `${obj.card.name} não produz {${manaColor}}`); return false; }
    }
    // Custos de ativação da Leva 5: remover marcadores, exilar do cemitério, devolver terreno, exilar ~.
    if (ability.cost.removeCounters) {
      const { counter, count } = ability.cost.removeCounters;
      if ((obj.counters[counter] ?? 0) < count) { this.fail(playerId, `${obj.card.name}: precisa de ${count} marcador(es) ${counter}`); return false; }
    }
    let gyExile: number[] = [];
    if (ability.cost.exileFromGraveyard) {
      const { filter, count } = ability.cost.exileFromGraveyard;
      gyExile = s.players[playerId].zones.graveyard.filter((id) => id !== obj.id && cardMatchesFilter(s.objects[id].card, filter)).slice(0, count);
      if (gyExile.length < count) { this.fail(playerId, `${obj.card.name}: precisa exilar ${count} carta(s) do cemitério`); return false; }
    }
    let landBack: number | undefined;
    if (ability.cost.returnLand) {
      landBack = s.players[playerId].zones.battlefield.find((id) => s.objects[id].card.types.includes('Land') && id !== obj.id);
      if (landBack === undefined) { this.fail(playerId, `${obj.card.name}: precisa devolver um terreno para a mão`); return false; }
    }

    if (ability.cost.tap) {
      if (obj.tapped) { this.fail(playerId, `${obj.card.name} já está virada`); return false; }
      if (isCreature(obj) && obj.summoningSick && !hasKeyword(s, obj, 'haste'))
        { this.fail(playerId, `${obj.card.name} tem enjoo de invocação`); return false; }
    }
    // "Discard a card:" cost — the cards come with the action.
    const discardIds = discards ?? [];
    if (ability.cost.discard) {
      if (discardIds.length !== ability.cost.discard || new Set(discardIds).size !== discardIds.length)
        { this.fail(playerId, `descarte ${ability.cost.discard} carta(s) como custo`); return false; }
      for (const id of discardIds) {
        const c = s.objects[id];
        if (!c || c.zone !== 'hand' || c.owner !== playerId)
          { this.fail(playerId, 'carta inválida para descartar'); return false; }
      }
    } else if (discardIds.length > 0) {
      { this.fail(playerId, 'essa habilidade não tem custo de descarte'); return false; }
    }
    const targetErr = this.validateTargets(playerId, ability.targets, targets, obj.card.colors, x);
    if (targetErr) { this.fail(playerId, targetErr); return false; }
    for (const t of targets) if (t.kind === 'object') this.emit({ type: 'targeted', objectId: t.id, by: playerId });

    // Sacrifice-another cost (Viscera Seer): validated before paying anything.
    const abilitySacs = sacrifices ?? [];
    if (ability.cost.sacrifice) {
      if (abilitySacs.length !== 1)
        { this.fail(playerId, 'escolha 1 permanente para sacrificar como custo'); return false; }
      const sacObj = s.objects[abilitySacs[0]];
      if (!sacObj || sacObj.zone !== 'battlefield' || sacObj.controller !== playerId)
        { this.fail(playerId, 'sacrifício inválido'); return false; }
      if (!matchFilter({ controller: playerId, sourceId: obj.id }, ability.cost.sacrifice, sacObj))
        { this.fail(playerId, `${sacObj.card.name} não satisfaz o custo`); return false; }
    } else if (abilitySacs.length > 0) {
      { this.fail(playerId, 'essa habilidade não tem custo de sacrifício'); return false; }
    }
    // Boast: mana value of the permanent sacrificed as a cost (recorded before it leaves).
    const sacrificedManaValue = abilitySacs.reduce((sum, id) => sum + manaValueOf(s.objects[id]?.card.manaCost), 0);
    if (ability.cost.payLife && s.players[playerId].life < ability.cost.payLife)
      { this.fail(playerId, `você precisa de ${ability.cost.payLife} pontos de vida para pagar`); return false; }
    if (ability.cost.energy && s.players[playerId].energy < ability.cost.energy)
      { this.fail(playerId, `você precisa de ${ability.cost.energy} de energia para pagar`); return false; }
    // Station: tap another untapped creature you control.
    let stationPower = 0;
    if (ability.cost.tapCreature) {
      const c = tapCreature !== undefined ? s.objects[tapCreature] : undefined;
      if (!c || c.zone !== 'battlefield' || c.controller !== playerId || c.id === obj.id || !isCreature(c) || c.tapped)
        { this.fail(playerId, 'estacionar: escolha outra criatura sua desvirada'); return false; }
      stationPower = Math.max(0, effectivePower(s, c));
      setTapped(s, c, true, this.emit);
    }

    const abilityTax = this.wardTax(playerId, targets);
    if (ability.cost.mana || abilityTax > 0) {
      const cost = parseCost(ability.cost.mana);
      cost.generic += abilityTax;
      if (cost.xCount > 0) { if (x === undefined || x < 0) { this.fail(playerId, 'escolha o valor de X'); return false; } cost.generic += x * cost.xCount; }
      if (ability.costLessPer) cost.generic = Math.max(0, cost.generic - s.players[playerId].zones.battlefield.filter((id) => matchFilter({ controller: playerId, sourceId: obj.id, state: s }, ability.costLessPer!, s.objects[id])).length);
      const plan = planPayment(s, playerId, cost, { poolOnly: !!this.options.manualMana });
      if (!plan && this.options.manualMana) return this.deferPayment(playerId, obj.card.name, cost);
      if (!plan) { this.fail(playerId, 'mana insuficiente'); return false; }
      this.payWithPlan(playerId, plan);
    }
    if (ability.cost.tap) setTapped(s, obj, true, this.emit);
    obj.activationsThisTurn = { ...(obj.activationsThisTurn ?? {}), [abilityIndex]: (obj.activationsThisTurn?.[abilityIndex] ?? 0) + 1 };
    if (ability.cost.payLife)
      changeLife(s, playerId, -ability.cost.payLife, `custo de ${obj.card.name}`, this.emit);
    if (ability.cost.energy) {
      s.players[playerId].energy -= ability.cost.energy;
      this.emit({ type: 'energyChanged', player: playerId, delta: -ability.cost.energy, total: s.players[playerId].energy });
    }
    if (ability.cost.discardHand) {
      for (const id of [...s.players[playerId].zones.hand]) { const c = s.objects[id]; if (c.id === obj.id && ability.zone === 'hand') continue; moveWithEvent(s, c, 'graveyard', 'discarded', this.emit); this.emit({ type: 'discarded', player: playerId, objectId: id, cardName: c.card.name }); }
    }
    if (ability.cost.exileSelfFromHand && obj.zone === 'hand') moveWithEvent(s, obj, 'exile', 'exiled', this.emit);
    if (ability.cost.discardSelf && obj.zone === 'hand') {
      moveWithEvent(s, obj, 'graveyard', 'discarded', this.emit);
      this.emit({ type: 'discarded', player: playerId, objectId: obj.id, cardName: obj.card.name });
    }
    if (ability.cost.tapCreature && obj.card.station) {
      const total = (obj.counters['charge'] ?? 0) + stationPower;
      obj.counters['charge'] = total;
      this.emit({ type: 'countersChanged', objectId: obj.id, cardName: obj.card.name, counter: 'charge', delta: stationPower, total });
    }
    if (ability.cost.removeCounters) {
      const { counter, count } = ability.cost.removeCounters;
      obj.counters[counter] = (obj.counters[counter] ?? 0) - count;
      this.emit({ type: 'countersChanged', objectId: obj.id, cardName: obj.card.name, counter, delta: -count, total: obj.counters[counter] });
    }
    for (const id of gyExile) moveWithEvent(s, s.objects[id], 'exile', 'exiled', this.emit);
    if (landBack !== undefined) moveWithEvent(s, s.objects[landBack], 'hand', 'returned', this.emit);
    if (ability.cost.exileSelfFromBattlefield && obj.zone === 'battlefield') moveWithEvent(s, obj, 'exile', 'exiled', this.emit);
    for (const id of discardIds) {
      const c = s.objects[id];
      moveWithEvent(s, c, 'graveyard', 'discarded', this.emit);
      this.emit({ type: 'discarded', player: playerId, objectId: id, cardName: c.card.name });
    }
    for (const id of abilitySacs) moveWithEvent(s, s.objects[id], 'graveyard', 'sacrificed', this.emit);
    if (ability.cost.sacrificeSelf) moveWithEvent(s, obj, 'graveyard', 'sacrificed', this.emit);
    if (ability.exileSelf && obj.zone === 'graveyard') moveWithEvent(s, obj, 'exile', 'exiled', this.emit);

    if (ability.isManaAbility || ability.immediate) {
      runEffectScript(
        { state: s, controller: playerId, sourceId: obj.id, sourceName: obj.card.name, targets, chosenMana: manaColor, emit: this.emit },
        ability.effect,
      );
      // Badgermole Cub: "Whenever you tap a creature for mana, add an additional {G}."
      if (ability.isManaAbility && ability.cost.tap && isCreature(obj)) {
        for (const id of s.players[playerId].zones.battlefield) {
          const extra = s.objects[id]?.card.extraManaOnCreatureTap;
          if (!extra) continue;
          s.players[playerId].manaPool[extra] += 1;
          this.emit({ type: 'manaAdded', player: playerId, mana: [extra], sourceName: s.objects[id].card.name });
        }
      }
      if (ability.immediate) return true;
      // A tap for mana can be undone until the mana is spent or priority
      // moves — but never when other costs were paid (sacrifice, life).
      if (ability.cost.tap && !ability.cost.sacrificeSelf && !ability.cost.sacrifice && !ability.cost.payLife) {
        const mana = ability.effect.flatMap((step) =>
          step.op === 'addMana' ? step.mana : step.op === 'addManaChoice' && manaColor ? [manaColor] : [],
        );
        if (mana.length > 0) s.reversibleTaps.push({ objectId: obj.id, mana });
      }
      return true;
    }

    s.stack.push({
      id: s.nextStackId++,
      kind: 'ability',
      sourceId: obj.id,
      controller: playerId,
      activated: true,
      cardName: obj.card.name,
      effect: ability.effect,
      targets,
      description: `${obj.card.name}: ${ability.text}`,
      xValue: x,
      sacrificedManaValue,
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

  /** Loyalty abilities: sorcery speed, once per turn per planeswalker. */
  private doActivateLoyalty(
    playerId: PlayerId,
    obj: GameObject,
    ability: import('./cards/types.js').LoyaltyAbility,
    targets: TargetChoice[],
  ): boolean {
    const s = this.state;
    const err = this.requirePriority(playerId);
    if (err) { this.fail(playerId, err); return false; }
    if (!this.sorceryTiming(playerId))
      { this.fail(playerId, 'habilidades de lealdade: só na sua fase principal com a pilha vazia'); return false; }
    if (obj.activatedLoyaltyThisTurn)
      { this.fail(playerId, `${obj.card.name} já ativou uma habilidade neste turno`); return false; }
    const loyalty = obj.counters['loyalty'] ?? 0;
    if (ability.cost < 0 && loyalty + ability.cost < 0)
      { this.fail(playerId, 'lealdade insuficiente'); return false; }
    const targetErr = this.validateTargets(playerId, ability.targets, targets, obj.card.colors);
    if (targetErr) { this.fail(playerId, targetErr); return false; }

    obj.activatedLoyaltyThisTurn = true;
    const total = loyalty + ability.cost;
    obj.counters['loyalty'] = total;
    this.emit({
      type: 'countersChanged',
      objectId: obj.id,
      cardName: obj.card.name,
      counter: 'loyalty',
      delta: ability.cost,
      total,
    });
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

  /** Cycling: pay the cost, discard the card, draw (or custom effect). */
  private doCycle(playerId: PlayerId, objectId: number, sacrificeId?: number): boolean {
    const s = this.state;
    const err = this.requirePriority(playerId);
    if (err) { this.fail(playerId, err); return false; }
    const obj = s.objects[objectId];
    if (!obj || obj.zone !== 'hand' || obj.owner !== playerId)
      { this.fail(playerId, 'carta inválida'); return false; }
    const cycling = obj.card.cycling;
    if (!cycling) { this.fail(playerId, `${obj.card.name} não tem reciclar`); return false; }
    if (cycling.life && s.players[playerId].life < cycling.life)
      { this.fail(playerId, `você precisa de ${cycling.life} pontos de vida`); return false; }
    // "Cycling—Sacrifice a land": the sacrifice is part of the cost, chosen with the action.
    let sacObj: GameObject | undefined;
    if (cycling.sacrifice) {
      sacObj = sacrificeId !== undefined ? s.objects[sacrificeId] : undefined;
      if (!sacObj || sacObj.zone !== 'battlefield' || sacObj.controller !== playerId || !matchFilter({ controller: playerId, sourceId: obj.id, state: s }, cycling.sacrifice, sacObj))
        { this.fail(playerId, 'escolha uma permanente válida para sacrificar ao reciclar'); return false; }
    }
    if (cycling.mana) {
      const plan = planPayment(s, playerId, parseCost(cycling.mana));
      if (!plan) { this.fail(playerId, 'mana insuficiente'); return false; }
      this.payWithPlan(playerId, plan);
    }
    if (cycling.life) changeLife(s, playerId, -cycling.life, `reciclar ${obj.card.name}`, this.emit);
    if (sacObj) moveWithEvent(s, sacObj, 'graveyard', 'sacrificed', this.emit);
    moveWithEvent(s, obj, 'graveyard', 'discarded', this.emit);
    this.emit({ type: 'cycled', player: playerId, cardName: obj.card.name });
    runEffectScript(
      { state: s, controller: playerId, sourceId: obj.id, sourceName: obj.card.name, targets: [], emit: this.emit },
      cycling.effect ?? [{ op: 'draw', who: 'controller', count: 1 }],
    );
    // "When you cycle this card, X".
    if (obj.card.cyclingTrigger) this.pushTrigger(obj, { text: 'ao reciclar', effect: obj.card.cyclingTrigger });
    s.passCount = 0;
    return true;
  }

  private doDeclareAttackers(playerId: PlayerId, attackerIds: number[], defendTarget?: number, exerted: number[] = [], enlist: { attacker: number; creature: number }[] = []): boolean {
    const s = this.state;
    if (s.combatAwaiting !== 'attackers' || playerId !== s.activePlayer)
      { this.fail(playerId, 'não é hora de declarar atacantes'); return false; }

    const attackers: GameObject[] = [];
    for (const id of attackerIds) {
      const obj = s.objects[id];
      if (!obj || obj.zone !== 'battlefield' || obj.controller !== playerId)
        { this.fail(playerId, 'atacante inválido'); return false; }
      const why = canAttack(s, obj);
      if (why) { this.fail(playerId, `${obj.card.name} não pode atacar: ${why}`); return false; }
      attackers.push(obj);
    }
    // "Attacks each combat if able": must be among the attackers when it can.
    for (const id of s.players[playerId].zones.battlefield) {
      const obj = s.objects[id];
      const goadedByAura = Object.values(s.objects).some((a) => a.zone === 'battlefield' && a.attachedTo === obj.id && a.card.attachEffect?.goaded);
      if ((hasKeyword(s, obj, 'mustAttack') || goadedByAura || (obj.goadedUntilTurn ?? -1) >= s.turn) && canAttack(s, obj) === null && !attackerIds.includes(id))
        { this.fail(playerId, `${obj.card.name} precisa atacar este combate`); return false; }
    }
    // Optional: attack a defender's planeswalker instead of the player.
    if (defendTarget !== undefined) {
      const pw = s.objects[defendTarget];
      const isBattle = !!pw && pw.card.types.includes('Battle') && pw.controller === playerId && !pw.transformed; // Siege: protected by the opponent
      if (
        !pw ||
        pw.zone !== 'battlefield' ||
        (!isBattle && (pw.controller !== opponentOf(playerId) || !pw.card.types.includes('Planeswalker')))
      )
        { this.fail(playerId, 'alvo de ataque inválido (planeswalker do oponente ou batalha sua)'); return false; }
    }
    for (const e of enlist) {
      const atk = s.objects[e.attacker];
      const c = s.objects[e.creature];
      if (!atk || !attackerIds.includes(e.attacker) || !atk.card.enlist) { this.fail(playerId, 'enlist: só atacantes com alistar'); return false; }
      if (!c || c.zone !== 'battlefield' || c.controller !== playerId || attackerIds.includes(c.id) || c.tapped || !isCreature(c) || (c.summoningSick && !hasKeyword(s, c, 'haste')) || enlist.filter((x) => x.creature === c.id).length > 1)
        { this.fail(playerId, 'alistar: vire outra criatura sua desvirada, que não ataca e sem enjoo'); return false; }
    }
    for (const id of exerted) {
      const o = s.objects[id];
      if (!o || !attackerIds.includes(id) || !o.card.canExert) { this.fail(playerId, 'exert: só atacantes com "you may exert"'); return false; }
    }
    if (attackers.length === 1 && attackers[0].card.cantAttackAlone)
      { this.fail(playerId, `${attackers[0].card.name} não pode atacar sozinha`); return false; }
    for (const obj of attackers) {
      obj.attacking = true;
      obj.pwTarget = defendTarget;
      if (!hasKeyword(s, obj, 'vigilance')) setTapped(s, obj, true, this.emit);
      if (exerted.includes(obj.id)) obj.exertedUntilTurn = s.turn + 2;
    }
    const penalty = s.players[opponentOf(playerId)].attackersPenalty;
    if (penalty && penalty.untilTurn > s.turn) for (const obj of attackers) obj.untilEot.power -= penalty.power;
    for (const e of enlist) {
      const c = s.objects[e.creature];
      const atk = s.objects[e.attacker];
      setTapped(s, c, true, this.emit);
      atk.untilEot.power += Math.max(0, effectivePower(s, c));
      this.emit({ type: 'fizzled', description: `${atk.card.name} alista ${c.card.name} (+${Math.max(0, effectivePower(s, c))}/+0)` });
    }
    s.attackersPowerThisTurn = (s.attackersPowerThisTurn ?? 0) + attackers.reduce((sum, o) => sum + Math.max(0, effectivePower(s, o)), 0);
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
    // "~ must be blocked if able": if some untapped creature could block it, one must.
    for (const atk of Object.values(s.objects).filter((o) => o.zone === 'battlefield' && o.attacking && o.card.mustBeBlocked)) {
      const couldBlock = s.players[playerId].zones.battlefield.map((id) => s.objects[id]).filter((o) => canBlock(s, o, atk) === null);
      if (couldBlock.length > 0 && !blocks.some((b) => b.attacker === atk.id))
        { this.fail(playerId, `${atk.card.name} precisa ser bloqueada se possível`); return false; }
    }
    // "Target creature blocks ~ this turn if able" / "can't block ~ this turn".
    for (const id of s.players[playerId].zones.battlefield) {
      const blk = s.objects[id];
      if (blk.mustBlockId !== undefined) {
        const atk = s.objects[blk.mustBlockId];
        if (atk?.attacking && canBlock(s, blk, atk) === null && !blocks.some((b) => b.blocker === blk.id && b.attacker === atk.id))
          { this.fail(playerId, `${blk.card.name} precisa bloquear ${atk.card.name}`); return false; }
      }
      if (blk.cantBlockId !== undefined && blocks.some((b) => b.blocker === blk.id && b.attacker === blk.cantBlockId))
        { this.fail(playerId, `${blk.card.name} não pode bloquear essa criatura neste turno`); return false; }
    }
    for (const b of blocks) {
      const blocker = s.objects[b.blocker];
      const attacker = s.objects[b.attacker];
      if (!blocker || blocker.zone !== 'battlefield' || blocker.controller !== playerId)
        { this.fail(playerId, 'bloqueador inválido'); return false; }
      const already = resolved.filter((r) => r.blocker.id === blocker.id).length;
      const extra = blocker.card.extraBlocks === 'any' ? Infinity : blocker.card.extraBlocks ?? 0;
      if (seen.has(blocker.id) && already > extra)
        { this.fail(playerId, `${blocker.card.name} só pode bloquear ${1 + extra} atacante(s)`); return false; }
      if (!attacker || !attacker.attacking)
        { this.fail(playerId, 'atacante inválido'); return false; }
      const why = canBlock(s, blocker, attacker);
      if (why) { this.fail(playerId, `${blocker.card.name} não pode bloquear: ${why}`); return false; }
      seen.add(blocker.id);
      resolved.push({ blocker, attacker });
    }
    // Menace / minBlockers / maxBlockers.
    for (const atk of Object.values(s.objects).filter((o) => o.attacking)) {
      const count = resolved.filter((r) => r.attacker.id === atk.id).length;
      if (count === 0) continue;
      const min = Math.max(hasKeyword(s, atk, 'menace') ? 2 : 1, atk.card.minBlockers ?? 1);
      if (count < min)
        { this.fail(playerId, `${atk.card.name} só pode ser bloqueada por ${min} ou mais criaturas`); return false; }
      if (atk.card.maxBlockers !== undefined && count > atk.card.maxBlockers)
        { this.fail(playerId, `${atk.card.name} não pode ser bloqueada por mais de ${atk.card.maxBlockers} criatura(s)`); return false; }
    }
    for (const r of resolved) {
      r.blocker.blocking = r.attacker.id;
      r.attacker.wasBlocked = true;
    }
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

  private doEffectChoice(playerId: PlayerId, picks: number[], text?: string): boolean {
    const s = this.state;
    const pending = s.pendingDecision;
    if (!pending || pending.type !== 'effectChoice' || pending.player !== playerId)
      { this.fail(playerId, 'nenhuma escolha pendente para você'); return false; }
    if (pending.mode === 'nameCard') {
      const name = (text ?? '').trim();
      if (!name || name.length > 120)
        { this.fail(playerId, 'digite o nome de uma carta'); return false; }
      applyEffectChoice(s, pending, [], this.emit, name);
      return true;
    }
    if (pending.mode === 'confirm') {
      if (text !== 'yes' && text !== 'no') { this.fail(playerId, 'responda sim ou não'); return false; }
      applyEffectChoice(s, pending, [], this.emit, text);
      return true;
    }
    if (pending.mode === 'chooseColor') {
      if (!text || !['W', 'U', 'B', 'R', 'G'].includes(text)) { this.fail(playerId, 'escolha uma cor'); return false; }
      applyEffectChoice(s, pending, [], this.emit, text);
      return true;
    }
    if (pending.mode === 'number') {
      const n = parseInt((text ?? '').trim(), 10);
      if (!Number.isFinite(n) || n < 0) { this.fail(playerId, 'digite um número'); return false; }
      applyEffectChoice(s, pending, [], this.emit, String(n));
      return true;
    }
    if (pending.mode === 'chooseType') {
      const t = (text ?? '').trim();
      if (!t || t.length > 40) { this.fail(playerId, 'digite um tipo de criatura'); return false; }
      applyEffectChoice(s, pending, [], this.emit, t.charAt(0).toUpperCase() + t.slice(1));
      return true;
    }
    if (new Set(picks).size !== picks.length)
      { this.fail(playerId, 'escolha repetida'); return false; }
    if (picks.length < pending.min || picks.length > pending.max)
      { this.fail(playerId, `escolha entre ${pending.min} e ${pending.max} carta(s)`); return false; }
    if (!picks.every((p) => pending.options.includes(p)))
      { this.fail(playerId, 'escolha inválida'); return false; }
    applyEffectChoice(s, pending, picks, this.emit);
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
    while (s.status === 'playing' && s.mulligan === null && !s.pendingDecision && !s.combatAwaiting) {
      if (++guard > 500) throw new Error('advanceLoop travou (bug na engine)');
      if (s.triggerQueue.length > 0) {
        this.processTriggerQueue();
        continue;
      }
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
    // Gatilhos gerados ao entrar no passo (Sagas na fase principal) vão para a pilha antes de alguém agir.
    this.scanTriggers();
  }

  private beginTurn(): void {
    const s = this.state;
    s.turn += 1;
    const extra = s.extraTurns?.shift();
    s.activePlayer = extra ?? opponentOf(s.activePlayer);
    if (extra) this.emit({ type: 'fizzled', description: `Turno extra de ${s.players[extra].name}` });
    s.spellsCastThisTurn = 0;
    s.combatDamagePrevented = false;
    for (const obj of Object.values(s.objects)) {
      obj.activatedLoyaltyThisTurn = false;
      // "Until your next turn" effects of the new active player wear off.
      if (obj.untilNextTurn?.length) obj.untilNextTurn = obj.untilNextTurn.filter((u) => u.player !== s.activePlayer);
    }
    this.emit({ type: 'turnBegan', turn: s.turn, activePlayer: s.activePlayer });
    this.enterStep('untap');
  }

  private enterStep(step: Step): void {
    const s = this.state;
    s.step = step;
    s.passCount = 0;
    s.reversibleTaps = [];
    const inCombat = /combat|declare/i.test(step);
    for (const p of PLAYER_IDS) {
      const ps = s.players[p];
      // Firebending: mana added "until end of combat" survives the combat steps.
      ps.manaPool = inCombat && ps.stickyPool ? { ...ps.stickyPool } : { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
      if (!inCombat) ps.stickyPool = undefined;
    }
    this.emit({ type: 'stepChanged', step });
    if (step === 'main1') this.fireStepTriggers('main1');
    // Sagas: a lore counter as the precombat main phase begins (714.2b).
    if (step === 'main1') {
      for (const id of [...s.players[s.activePlayer].zones.battlefield]) {
        const saga = s.objects[id];
        if (!saga?.card.saga) continue;
        const total = (saga.counters['lore'] ?? 0) + 1;
        saga.counters['lore'] = total;
        this.emit({ type: 'countersChanged', objectId: saga.id, cardName: saga.card.name, counter: 'lore', delta: 1, total });
        this.emit({ type: 'loreAdded', objectId: saga.id, cardName: saga.card.name, total });
      }
    }

    switch (step) {
      case 'untap': {
        this.checkDayNight();
        const player = s.players[s.activePlayer];
        player.landsPlayedThisTurn = 0;
        for (const id of player.zones.battlefield) {
          const obj = s.objects[id];
          obj.summoningSick = false;
          if (hasKeyword(s, obj, 'doesntUntap') || attachmentForbids(s, obj, 'doesntUntap')) continue;
          if (obj.exertedUntilTurn !== undefined && obj.exertedUntilTurn >= s.turn) { if (obj.exertedUntilTurn === s.turn) obj.exertedUntilTurn = undefined; continue; }
          if (obj.tapped) setTapped(s, obj, false, this.emit);
        }
        s.priority = null; // no one gets priority during untap
        return;
      }
      case 'draw': {
        const skip = s.players[s.activePlayer].zones.battlefield.some((id) => s.objects[id].card.skipDraw);
        if (!(s.turn === 1 && s.activePlayer === s.onThePlay) && !skip) {
          // Dredge: with a dredge card in the graveyard, the draw step asks draw-or-dredge before drawing.
          const dredges = s.players[s.activePlayer].dredgeNext === undefined ? dredgeOptions(s, s.activePlayer) : [];
          if (dredges.length > 0) {
            s.pendingDecision = {
              type: 'effectChoice', player: s.activePlayer, mode: 'cards', options: dredges, min: 0, max: 1, skipLabel: 'Comprar a carta',
              prompt: 'Etapa de compra: comprar uma carta ou dragar? Escolha a carta do cemitério para dragar, ou compre normalmente',
              resume: { controller: s.activePlayer, sourceId: -1, sourceName: 'Etapa de compra', targets: [], current: { op: 'draw', who: 'controller', count: 1 }, remaining: [], finishSpellId: null },
            };
            s.priority = s.activePlayer;
            return;
          }
          draw(s, s.activePlayer, this.emit);
          if (s.players[s.activePlayer].zones.hand.length <= 2 && s.players[s.activePlayer].zones.battlefield.some((id) => s.objects[id].card.drawPlusOneWhenHandSmall)) draw(s, s.activePlayer, this.emit); // Quantum Riddler (mão tinha ≤ 1 antes da compra)
          checkStateBasedActions(s, this.emit);
        }
        s.priority = s.activePlayer;
        return;
      }
      case 'combatBegin': {
        this.fireStepTriggers('beginCombat');
        s.priority = s.activePlayer;
        return;
      }
      case 'main2': {
        this.fireStepTriggers('main2');
        s.priority = s.activePlayer;
        return;
      }
      case 'upkeep': {
        this.fireUpkeepKeywords();
        this.runDelayed('nextUpkeep', s.activePlayer);
        this.fireStepTriggers('upkeep');
        s.priority = s.activePlayer;
        return;
      }
      case 'end': {
        // The monarch draws a card at the beginning of their end step.
        if (s.monarch === s.activePlayer) {
          draw(s, s.activePlayer, this.emit);
          this.emit({ type: 'fizzled', description: `${s.players[s.activePlayer].name} comprou uma carta por ser o monarca` });
        }
        this.fireStepTriggers('endStep');
        this.runDelayed('endStep');
        s.priority = s.activePlayer;
        return;
      }
      case 'declareAttackers': {
        const canAny = s.players[s.activePlayer].zones.battlefield
          .map((id) => s.objects[id])
          .some((o) => canAttack(s, o) === null);
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
        const unlimited = player.noMaxHandSize || player.zones.battlefield.some((id) => s.objects[id].card.noMaxHandSize);
        const limit = Math.min(MAX_HAND_SIZE, ...player.zones.battlefield.map((id) => s.objects[id].card.maxHandSize ?? MAX_HAND_SIZE));
        const over = unlimited ? 0 : player.zones.hand.length - limit;
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
      obj.activationsThisTurn = undefined;
      obj.triggeredThisTurn = undefined;
      obj.preventNext = undefined;
      obj.preventAllThisTurn = undefined;
      obj.damagedByThisTurn = undefined;
      obj.exileIfDiesThisTurn = undefined;
      obj.mustBlockId = undefined;
      obj.cantBlockId = undefined;
      if (obj.zone === 'battlefield') {
        obj.damage = 0;
        obj.untilEot = { power: 0, toughness: 0, keywords: [] };
        obj.crewedUntilEot = undefined;
        delete obj.counters['__deathtouched'];
        delete obj.counters['__regen']; // regeneration shields expire
      }
    }
    s.spellsCastLastTurn = s.spellsCastThisTurn;
    s.activeSpellsLastTurn = s.players[s.activePlayer].spellsCastThisTurn ?? 0;
    for (const p of PLAYER_IDS) {
      const ps = s.players[p];
      ps.damagedThisTurn = false;
      ps.drawsThisTurn = 0;
      ps.permanentsLeftThisTurn = 0;
      ps.nonlandEnteredThisTurn = 0;
      ps.spellsCastThisTurn = 0;
      ps.noncreatureSpellsThisTurn = 0;
      ps.colorsCastThisTurn = [];
      for (const id of ps.zones.battlefield) s.objects[id].attackedThisTurn = undefined;
      s.lki = undefined;
      ps.lifeGainedThisTurn = 0;
      ps.lifeLostThisTurn = 0;
      ps.preventNext = undefined;
      ps.preventAllThisTurn = undefined;
    }
    s.combatDamageThisTurn = false;
    s.combatDamageSubtypesThisTurn = undefined;
    s.attackersThisTurn = 0;
    s.attackersPowerThisTurn = 0;
    s.creaturesDiedThisTurn = 0;
    // "Until end of turn" control effects wear off (Act of Treason).
    for (const revert of s.controlReverts) {
      const obj = s.objects[revert.objectId];
      if (obj && obj.zone === 'battlefield' && obj.controller !== revert.to) {
        const fromArr = s.players[obj.controller].zones.battlefield;
        const i = fromArr.indexOf(obj.id);
        if (i >= 0) fromArr.splice(i, 1);
        obj.controller = revert.to;
        s.players[revert.to].zones.battlefield.push(obj.id);
        this.emit({ type: 'controlChanged', objectId: obj.id, cardName: obj.card.name, to: revert.to });
      }
    }
    s.controlReverts = [];
    s.combatDamagePrevented = false;
    checkStateBasedActions(s, this.emit);
    if (s.status === 'playing') this.beginTurn();
  }

  // ---------------------------------------------------------------- stack

  private resolveTop(): void {
    const s = this.state;
    const item = s.stack.pop();
    if (!item) return;

    if (item.kind === 'copy') {
      if (item.targets.length > 0 && !itemStillHasLegalWork(s, item)) {
        this.emit({ type: 'fizzled', description: `${item.description} foi anulada (alvos ilegais)` });
        return;
      }
      const result = runEffectScript(
        {
          state: s,
          controller: item.controller,
          sourceId: item.sourceId,
          sourceName: item.description,
          targets: item.targets,
          xValue: item.xValue,
          sacrificedPower: item.sacrificedPower,
          sacrificedManaValue: item.sacrificedManaValue,
          emit: this.emit,
        },
        item.effect,
      );
      if (result !== 'paused') this.emit({ type: 'stackResolved', description: `${item.description} resolveu` });
      return;
    }

    if (item.kind === 'spell') {
      const obj = s.objects[item.sourceId];
      if (!obj) return;
      if (item.targets.length > 0 && !itemStillHasLegalWork(s, item)) {
        this.emit({ type: 'fizzled', description: `${item.cardName} foi anulada (todos os alvos são ilegais)` });
        moveWithEvent(s, obj, item.flashback ? 'exile' : 'graveyard', 'resolved', this.emit);
        return;
      }
      if (isPermanentCard(obj.card)) {
        moveWithEvent(s, obj, 'battlefield', 'resolved', this.emit);
        this.applyEnterTapRules(obj);
        // Métodos de conjuração com consequência ao entrar.
        switch (obj.castMethod) {
          case 'evoke':
            this.pushTrigger(obj, { text: 'evocar: sacrifique', effect: [{ op: 'sacrificeSelf' }] });
            break;
          case 'dash':
            obj.untilEot.keywords.push('haste');
            s.delayed.push({ at: 'endStep', objectId: obj.id, action: 'returnToHand' });
            break;
          case 'blitz':
            obj.untilEot.keywords.push('haste');
            s.delayed.push({ at: 'endStep', objectId: obj.id, action: 'sacrifice' });
            break;
          case 'warp':
            s.delayed.push({ at: 'endStep', objectId: obj.id, action: 'exile' });
            break;
          case 'sneak':
            obj.tapped = true;
            obj.attacking = true;
            this.emit({ type: 'tappedChanged', objectId: obj.id, cardName: obj.card.name, tapped: true });
            break;
          case 'prototype':
            obj.prototyped = true;
            break;
        }
        // Aura: enters attached to its target (fizzle above covers a dead one). Bestow: the creature card enters as an Aura.
        const enchantTarget = obj.card.enchant || obj.castMethod === 'bestow' ? item.targets[0] : undefined;
        if (obj.castMethod === 'bestow') obj.bestowed = true;
        if (enchantTarget && enchantTarget.kind === 'object') {
          const host = s.objects[enchantTarget.id];
          if (obj.card.reanimateAura && host && host.zone === 'graveyard') {
            host.controller = item.controller;
            moveWithEvent(s, host, 'battlefield', 'returned', this.emit);
          }
          if (host && host.zone === 'battlefield') {
            obj.attachedTo = host.id;
            this.emit({
              type: 'attached',
              sourceId: obj.id,
              sourceName: obj.card.name,
              hostId: host.id,
              hostName: host.card.name,
            });
          }
        }
        if (obj.card.entersUnlessDiscard) this.pushTrigger(obj, { text: 'descarte um terreno ou vai para o cemitério', effect: [{ op: 'discardOrDie', filter: obj.card.entersUnlessDiscard }] });
        // "Enters the battlefield with N +1/+1 counters" (N may be X; raid-style conditions honored).
        if (obj.card.entersWithCounters) {
          const ctx = {
            state: s,
            controller: item.controller,
            sourceId: obj.id,
            sourceName: item.cardName,
            targets: item.targets,
            xValue: item.xValue,
            sacrificedManaValue: item.sacrificedManaValue,
            emit: this.emit,
          };
          const count = obj.card.entersWithCountersIf && !condHolds(ctx, obj.card.entersWithCountersIf) ? 0 : resolveAmount(ctx, obj.card.entersWithCounters.count);
          if (count > 0) {
            const counter = obj.card.entersWithCounters.counter;
            obj.counters[counter] = (obj.counters[counter] ?? 0) + count;
            this.emit({
              type: 'countersChanged',
              objectId: obj.id,
              cardName: obj.card.name,
              counter,
              delta: count,
              total: obj.counters[counter],
            });
          }
        }
        // Planeswalkers enter with their printed loyalty.
        if (obj.card.types.includes('Planeswalker') && obj.card.loyalty) {
          obj.counters['loyalty'] = obj.card.loyalty;
          this.emit({
            type: 'countersChanged',
            objectId: obj.id,
            cardName: obj.card.name,
            counter: 'loyalty',
            delta: obj.card.loyalty,
            total: obj.card.loyalty,
          });
        }
        this.emit({ type: 'stackResolved', description: `${item.description} entra no campo de batalha` });
        return;
      }
      const result = runEffectScript(
        {
          state: s,
          controller: item.controller,
          sourceId: obj.id,
          sourceName: item.cardName,
          targets: item.targets,
          xValue: item.xValue,
          sacrificedPower: item.sacrificedPower,
          sacrificedManaValue: item.sacrificedManaValue,
          emit: this.emit,
        },
        item.effect,
      );
      if (result === 'paused') {
        // Script waits for a player's choice; the card stays on the stack
        // and moves to the graveyard when applyEffectChoice finishes it.
        if (s.pendingDecision?.type === 'effectChoice') {
          s.pendingDecision.resume.finishSpellId = obj.id;
          s.pendingDecision.resume.finishSpellExile = item.flashback || !!obj.card.exileOnResolve;
          s.pendingDecision.resume.finishSpellAdventure = !!obj.transformed && obj.baseCard?.faceLayout === 'adventure';
        }
        this.emit({ type: 'stackResolved', description: `${item.description} está resolvendo` });
        return;
      }
      this.emit({ type: 'stackResolved', description: `${item.description} resolveu` });
      // Finishes in the graveyard — or exile (flashback / "Exile ~" / rebound), or hand (buyback).
      if (obj.zone === 'stack') {
        if (obj.buybackPaid) moveWithEvent(s, obj, 'hand', 'returned', this.emit);
        else if (obj.card.rebound && (obj as GameObject & { reboundFromHand?: boolean }).reboundFromHand) {
          moveWithEvent(s, obj, 'exile', 'exiled', this.emit);
          obj.exiledAs = 'rebound';
          s.delayed.push({ at: 'nextUpkeep', player: item.controller, objectId: obj.id, action: 'castFree' });
        } else if (obj.transformed && obj.baseCard?.faceLayout === 'adventure') {
          // Adventure: the card waits in exile; the creature may be cast from there later.
          moveWithEvent(s, obj, 'exile', 'exiled', this.emit);
          obj.exiledAs = 'adventure';
        } else moveWithEvent(s, obj, item.flashback || obj.card.exileOnResolve || obj.exileOnResolveOnce ? 'exile' : 'graveyard', 'resolved', this.emit);
        obj.exileOnResolveOnce = undefined;
        (obj as GameObject & { reboundFromHand?: boolean }).reboundFromHand = false;
        // Haunt (spell): after resolving, exile it haunting target creature.
        if (obj.card.haunt && (obj.zone as string) === 'graveyard')
          this.pushTrigger(obj, { text: 'assombrar', targets: [{ what: 'creature' }], effect: [{ op: 'hauntExile', what: 'target:0' }] });
      }
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
        xValue: item.xValue,
        sacrificedManaValue: item.sacrificedManaValue,
        subjectId: item.subjectId,
        subjectPlayer: item.subjectPlayer,
        triggerAmount: item.triggerAmount,
        emit: this.emit,
      },
      item.effect,
    );
    this.emit({ type: 'stackResolved', description: item.description });
  }

  // -------------------------------------------------------------- triggers

  /** Derive triggered abilities from events emitted since the last scan. */
  /** "Whenever one or more … die": (source, ability) pairs that already fired in this scan. */
  private diesBatch = new Set<number>();

  /** State triggers ("When you control no Islands, sacrifice ~"): checked whenever triggers are scanned. */
  private checkStateTriggers(): void {
    const s = this.state;
    // Grants end when their source leaves the battlefield (Yavimaya, Petrified Hamlet); the loops below re-apply the live ones.
    for (const p of PLAYER_IDS) {
      for (const id of s.players[p].zones.battlefield) {
        const o = s.objects[id];
        if (!o?.grantedFrom?.some((sid) => s.objects[sid]?.zone !== 'battlefield')) continue;
        if (o.printedCard) { o.card = o.printedCard; o.printedCard = undefined; }
        o.grantedFrom = undefined;
      }
    }
    // Yavimaya: every land is also a Forest (with the intrinsic mana ability, 305.6).
    for (const p of PLAYER_IDS) {
      for (const id of s.players[p].zones.battlefield) {
        const src = s.objects[id];
        const type = src?.card.allLandsAreType;
        if (!type) continue;
        const mana = ({ Plains: 'W', Island: 'U', Swamp: 'B', Mountain: 'R', Forest: 'G' } as const)[type];
        for (const q of PLAYER_IDS) for (const lid of s.players[q].zones.battlefield) {
          const land = s.objects[lid];
          if (!land || !land.card.types.includes('Land') || land.grantedFrom?.includes(src.id)) continue;
          (land.grantedFrom ??= []).push(src.id);
          if (!land.printedCard) land.printedCard = land.card;
          land.card = {
            ...land.card,
            subtypes: land.card.subtypes.includes(type) ? land.card.subtypes : [...land.card.subtypes, type],
            abilities: [...(land.card.abilities ?? []), { kind: 'activated', cost: { tap: true }, effect: [{ op: 'addMana', who: 'controller', mana: [mana] }], text: `Adicionar {${mana}}`, isManaAbility: true }],
          };
        }
      }
    }
    // Petrified Hamlet: lands with the chosen name gain the granted abilities.
    for (const p of PLAYER_IDS) {
      for (const id of s.players[p].zones.battlefield) {
        const src = s.objects[id];
        if (!src?.card.grantToNamed || !src.chosenName) continue;
        for (const q of PLAYER_IDS) for (const lid of s.players[q].zones.battlefield) {
          const land = s.objects[lid];
          if (!land || land.card.name !== src.chosenName || land.grantedFrom?.includes(src.id)) continue;
          (land.grantedFrom ??= []).push(src.id);
          if (!land.printedCard) land.printedCard = land.card;
          land.card = { ...land.card, abilities: [...(land.card.abilities ?? []), ...src.card.grantToNamed] };
        }
      }
    }
    for (const p of PLAYER_IDS) {
      for (const id of [...s.players[p].zones.battlefield]) {
        const o = s.objects[id];
        if (!o || o.stateTriggerPending) continue;
        (o.card.abilities ?? []).forEach((ab, idx) => {
          if (ab.kind !== 'triggered' || o.stateTriggerPending) return;
          if (ab.trigger.on === 'noCounters') {
            if ((o.counters[ab.trigger.counter] ?? 0) > 0) return;
            o.stateTriggerPending = true;
            this.pushTrigger(o, ab, undefined, undefined, { abilityIndex: idx });
            return;
          }
          if (ab.trigger.on !== 'controlsNone') return;
          const f = ab.trigger.filter;
          if (s.players[o.controller].zones.battlefield.some((oid) => oid !== o.id && matchFilter({ controller: o.controller, sourceId: o.id, state: s }, f, s.objects[oid]))) return;
          o.stateTriggerPending = true;
          this.pushTrigger(o, ab, undefined, undefined, { abilityIndex: idx });
        });
      }
    }
  }

  /** Day/night: as the untap step begins, the previous turn's spell count may flip it (726.2). */
  private checkDayNight(): void {
    const s = this.state;
    if (!s.dayNight || s.turn <= 1) return;
    const last = s.activeSpellsLastTurn ?? 0;
    if (s.dayNight === 'day' && last === 0) this.setDayNight('night');
    else if (s.dayNight === 'night' && last >= 2) this.setDayNight('day');
  }

  private setDayNight(v: 'day' | 'night'): void {
    const s = this.state;
    if (s.dayNight === v) return;
    s.dayNight = v;
    this.emit({ type: 'dayNightChanged', value: v });
    for (const p of PLAYER_IDS) {
      for (const id of [...s.players[p].zones.battlefield]) {
        const o = s.objects[id];
        if (!o?.baseCard?.daybound || !o.baseCard.backFace) continue;
        const wantBack = v === 'night';
        if (!!o.transformed !== wantBack) transformObject(s, o, this.emit);
      }
    }
  }

  private scanTriggers(): void {
    this.checkStateTriggers();
    this.diesBatch = new Set<number>();
    const gyBatch = new Set<number>(); // "one or more cards put into your graveyard": once per scan
    while (this.triggerCursor < this.buf.length) {
      const ev = this.buf[this.triggerCursor++];
      if (ev.type === 'zoneChanged' && ev.from === 'graveyard') {
        // Murktide Regent: "whenever an instant or sorcery card leaves your graveyard".
        const moved = this.state.objects[ev.objectId];
        if (moved) for (const id of [...this.state.players[ev.player].zones.battlefield]) {
          const o = this.state.objects[id];
          (o?.card.abilities ?? []).forEach((ab, idx) => {
            if (ab.kind !== 'triggered' || ab.trigger.on !== 'cardLeavesYourGraveyard') return;
            if (ab.trigger.filter && !cardMatchesFilter(moved.card, ab.trigger.filter)) return;
            this.pushTrigger(o, ab, ev.objectId, undefined, { abilityIndex: idx });
          });
        }
      }
      if (ev.type === 'zoneChanged' && ev.to === 'graveyard') {
        const moved = this.state.objects[ev.objectId];
        // Emrakul: "When ~ is put into a graveyard from anywhere".
        if (moved) (moved.card.abilities ?? []).forEach((ab, idx) => {
          if (ab.kind === 'triggered' && ab.trigger.on === 'toGraveyardFromAnywhere' && (!ab.trigger.fromZone || ev.from === ab.trigger.fromZone)) this.pushTrigger(moved, ab, moved.id, undefined, { abilityIndex: idx });
        });
        if (moved && !moved.isToken) {
          for (const id of [...this.state.players[ev.player].zones.battlefield]) {
            const o = this.state.objects[id];
            (o?.card.abilities ?? []).forEach((ab, idx) => {
              if (ab.kind !== 'triggered' || ab.trigger.on !== 'cardsToYourGraveyard' || gyBatch.has(o.id * 100 + idx)) return;
              if (ab.trigger.filter && !cardMatchesFilter(moved.card, ab.trigger.filter)) return;
              if (ab.condition && !staticConditionHolds(this.state, o, ab.condition)) return;
              gyBatch.add(o.id * 100 + idx);
              this.pushTrigger(o, ab, ev.objectId, undefined, { abilityIndex: idx });
            });
          }
        }
      }
      if (ev.type === 'zoneChanged' && ev.to === 'battlefield') this.fireZoneTriggers(ev.objectId, 'etb');
      if (ev.type === 'tokenCreated') this.fireZoneTriggers(ev.objectId, 'etb');
      if (ev.type === 'landPlayed') this.fireZoneTriggers(ev.objectId, 'etb'); // landfall
      if (ev.type === 'zoneChanged' && ev.from === 'battlefield' && ev.reason === 'sacrificed') {
        const so = this.state.objects[ev.objectId];
        this.fireControllerTriggers(ev.player, 'youSacrifice', { subjectId: ev.objectId, subjectCard: so?.card });
      }
      if (ev.type === 'zoneChanged' && ev.from === 'battlefield' && ev.to === 'graveyard') {
        this.fireZoneTriggers(ev.objectId, 'dies');
        this.fireHostTriggers(ev.objectId, 'hostDies');
        // "Whenever a creature dealt damage by ~ this turn dies".
        const dead = this.state.objects[ev.objectId];
        for (const srcId of new Set(dead?.damagedByThisTurn ?? [])) this.fireSelfTrigger(srcId, 'damagedCreatureDies', { subjectId: ev.objectId });
        // Haunt: cards in exile haunting this creature trigger, then stop haunting.
        for (const h of Object.values(this.state.objects)) {
          if (h.zone !== 'exile' || h.haunting !== ev.objectId) continue;
          h.haunting = undefined;
          for (const ability of h.card.abilities ?? [])
            if (ability.kind === 'triggered' && ability.trigger.on === 'hauntedDies') this.pushTrigger(h, ability);
        }
      }
      if (ev.type === 'attackersDeclared') {
        this.state.attackersThisTurn = (this.state.attackersThisTurn ?? 0) + ev.attackers.length;
        for (const a of ev.attackers) {
          this.fireHostTriggers(a.objectId, 'hostAttacks');
          const ao = this.state.objects[a.objectId];
          if (ao) ao.attackedThisTurn = true; // boast
          if (ao?.exertedUntilTurn === this.state.turn + 2) this.fireSelfTrigger(a.objectId, 'youExertThis');
        }
      }
      if (ev.type === 'attackersDeclared') {
        for (const a of ev.attackers) this.fireSelfTrigger(a.objectId, 'attacks');
        if (ev.attackers.length > 0) this.fireControllerTriggers(ev.player, 'youAttack');
        // Leva 3: attack-trigger keywords.
        const atks = ev.attackers.map((a) => this.state.objects[a.objectId]).filter((o): o is GameObject => !!o);
        for (const a of atks) {
          const c = a.card;
          if (c.battleCry) this.pushTrigger(a, { text: 'grito de guerra', effect: [{ op: 'pumpEach', filter: { what: 'creature', attacking: true, other: true, controlledBy: 'you' }, power: 1, toughness: 0 }] });
          if (c.melee) this.pushTrigger(a, { text: 'corpo a corpo', effect: [{ op: 'pump', what: 'self', power: 1, toughness: 1 }] });
          if (c.training && atks.some((o) => o.id !== a.id && effectivePower(this.state, o) > effectivePower(this.state, a)))
            this.pushTrigger(a, { text: 'treinamento', effect: [{ op: 'putCounters', what: 'self', counter: '+1/+1', count: 1 }] });
          if (c.dethrone && this.state.players[opponentOf(a.controller)].life >= this.state.players[a.controller].life)
            this.pushTrigger(a, { text: 'destronar', effect: [{ op: 'putCounters', what: 'self', counter: '+1/+1', count: 1 }] });
          if (c.annihilator) this.pushTrigger(a, { text: `aniquilador ${c.annihilator}`, effect: [{ op: 'sacrifice', who: 'opponent', count: c.annihilator }] });
          if (c.mobilize) this.pushTrigger(a, { text: `mobilizar ${c.mobilize}`, effect: [{ op: 'token', who: 'controller', count: c.mobilize, name: 'Warrior', power: 1, toughness: 1, colors: ['R'], subtypes: ['Warrior'], tapped: true, attacking: true, sacrificeAtEnd: true }] });
          if (c.firebending) this.pushTrigger(a, { text: `dobra de fogo ${c.firebending}`, effect: [{ op: 'addMana', who: 'controller', mana: Array.from({ length: c.firebending }, () => 'R' as const), untilEndOfCombat: true }] });
        }
        // Mentor: +1/+1 counter on target attacking creature with lesser power.
        for (const a of ev.attackers) {
          const m = this.state.objects[a.objectId];
          if (m?.card.mentor)
            this.pushTrigger(m, {
              text: 'mentor',
              targets: [{ what: 'creature', controlledBy: 'you', combat: true, powerLessThanSource: m.id }],
              effect: [{ op: 'putCounters', what: 'target:0', counter: '+1/+1', count: 1 }],
            });
        }
        // Exalted: a lone attacker gets +1/+1 per exalted permanent its controller controls.
        if (ev.attackers.length === 1) {
          const atk = this.state.objects[ev.attackers[0].objectId];
          const n = this.state.players[ev.player].zones.battlefield.filter((id) => this.state.objects[id].card.exalted).length;
          if (atk && n > 0) {
            atk.untilEot.power += n;
            atk.untilEot.toughness += n;
            this.emit({ type: 'pumped', objectId: atk.id, cardName: atk.card.name, power: n, toughness: n });
          }
        }
      }
      if (ev.type === 'blockersDeclared') {
        const s = this.state;
        const pump = (o: GameObject, n: number) => {
          o.untilEot.power += n;
          o.untilEot.toughness += n;
          this.emit({ type: 'pumped', objectId: o.id, cardName: o.card.name, power: n, toughness: n });
        };
        const blockedAttackers = new Set(ev.blocks.map((b) => b.attacker));
        // "Whenever ~ attacks and isn't blocked".
        for (const a of Object.values(s.objects)) if (a.zone === 'battlefield' && a.attacking && !blockedAttackers.has(a.id)) this.fireSelfTrigger(a.id, 'attacksUnblocked');
        for (const b of ev.blocks) {
          this.fireSelfTrigger(b.blocker, 'blocks', { subjectId: b.attacker });
          // Bushido: blocker and blocked attacker get +N/+N.
          for (const id of [b.blocker, b.attacker]) {
            const o = s.objects[id];
            if (o?.card.bushido) pump(o, o.card.bushido);
          }
          // Flanking: a blocker without flanking gets -1/-1.
          const atk = s.objects[b.attacker];
          const blk = s.objects[b.blocker];
          if (atk?.card.flanking && blk && !blk.card.flanking) pump(blk, -1);
        }
        for (const id of blockedAttackers) {
          this.fireSelfTrigger(id, 'becomesBlocked');
          const atk = s.objects[id];
          if (!atk) continue;
          const n = ev.blocks.filter((b) => b.attacker === id).length;
          if (atk.card.rampage && n > 1) pump(atk, atk.card.rampage * (n - 1));
          if (atk.card.afflict) changeLife(s, opponentOf(atk.controller), -atk.card.afflict, `afligir de ${atk.card.name}`, this.emit);
        }
      }
      if (ev.type === 'targeted') {
        const o = this.state.objects[ev.objectId];
        for (const ability of o?.card.abilities ?? []) {
          if (ability.kind !== 'triggered' || ability.trigger.on !== 'becomesTargeted' || o!.zone !== 'battlefield') continue;
          if (ability.trigger.byOpponent && ev.by === o!.controller) continue;
          if (!abilityActive(o!, ability)) continue;
          this.pushTrigger(o!, ability);
        }
      }
      if (ev.type === 'cardDrawn') {
        const nth = ev.nth ?? this.state.players[ev.player].drawsThisTurn;
        const firstInDrawStep = this.state.step === 'draw' && this.state.activePlayer === ev.player && nth === 1;
        if (!firstInDrawStep) {
          const foe = opponentOf(ev.player);
          for (const id of [...this.state.players[foe].zones.battlefield]) {
            const o = this.state.objects[id];
            (o?.card.abilities ?? []).forEach((ab, idx) => {
              if (ab.kind === 'triggered' && ab.trigger.on === 'opponentDrawsExtra' && abilityActive(o, ab)) this.pushTrigger(o, ab, undefined, undefined, { subjectPlayer: ev.player, abilityIndex: idx });
            });
          }
        }
        this.fireControllerTriggers(ev.player, 'youDrawCard', { subjectId: ev.objectId, subjectPlayer: ev.player });
        this.fireControllerTriggers(ev.player, 'youDrawCardNth', { subjectId: ev.objectId, subjectPlayer: ev.player, nth });
        // Miracle: the first card drawn this turn may be cast for its miracle cost right now.
        const drawn = this.state.objects[ev.objectId];
        const miracle = drawn?.card.castMethods?.find((m) => m.kind === 'miracle');
        if (drawn && miracle && drawn.zone === 'hand' && nth === 1) {
          drawn.miracleAvailable = true;
          this.emit({ type: 'miracleRevealed', player: ev.player, objectId: drawn.id, cardName: drawn.card.name, cost: miracle.cost });
        }
      }
      if (ev.type === 'loreAdded') this.fireChapter(ev.objectId, ev.total);
      if (ev.type === 'ventureRequested') this.handleVenture(ev.player, ev.sourceId, ev.dungeon);
      if (ev.type === 'monarchChanged') this.fireControllerTriggers(ev.player, 'youBecomeMonarch');
      if (ev.type === 'ventured') {
        this.fireControllerTriggers(ev.player, 'youVenture');
        if (ev.completed) this.fireControllerTriggers(ev.player, 'youCompleteDungeon');
      }
      if (ev.type === 'exploited') {
        const o = this.state.objects[ev.objectId];
        if (o && o.zone === 'battlefield')
          for (const ability of o.card.abilities ?? [])
            if (ability.kind === 'triggered' && ability.trigger.on === 'exploits' && abilityActive(o, ability)) this.pushTrigger(o, ability);
      }
      if (ev.type === 'discarded') {
        const d = this.state.objects[ev.objectId];
        if (d) d.discardedOnTurn = this.state.turn;
        this.fireControllerTriggers(ev.player, 'youDiscard', { subjectId: ev.objectId, subjectPlayer: ev.player });
        for (const p of PLAYER_IDS) this.fireControllerTriggers(p, 'anyPlayerDiscards', { subjectId: ev.objectId, subjectPlayer: ev.player });
        // Madness: the discarded card goes to exile and may be cast for its madness cost.
        const o = this.state.objects[ev.objectId];
        if (o?.card.madness && o.zone === 'graveyard') {
          moveWithEvent(this.state, o, 'exile', 'exiled', this.emit);
          o.exiledAs = 'madness';
          this.pushTrigger(o, {
            text: `loucura ${o.card.madness}`,
            effect: [{ op: 'mayDo', prompt: `conjurar ${o.card.name} por ${o.card.madness}?`, effect: [{ op: 'castSelfForCost', cost: o.card.madness }], else: [{ op: 'selfToGraveyard' }] }],
          });
        }
      }
      if (ev.type === 'zoneChanged' && ev.from === 'battlefield') {
        this.fireSelfTrigger(ev.objectId, 'leaves');
        this.onLeaveKeywords(ev.objectId, ev.to);
      }
      if (ev.type === 'zoneChanged' && ev.to === 'battlefield') this.fireEvolve(ev.objectId);
      if (ev.type === 'tappedChanged' && ev.tapped) this.fireSelfTrigger(ev.objectId, 'becomesTapped');
      if (ev.type === 'tappedChanged' && !ev.tapped) this.fireSelfTrigger(ev.objectId, 'becomesUntapped');
      if (ev.type === 'transformed') this.fireSelfTrigger(ev.objectId, 'transformsInto');
      if (ev.type === 'turnedFaceUp') this.fireSelfTrigger(ev.objectId, 'turnedFaceUp');
      if (ev.type === 'damageDealt') {
        if (ev.target.kind === 'object') {
          this.fireSelfTrigger(ev.target.id, 'dealtDamage', { subjectId: ev.sourceId, triggerAmount: ev.amount });
          this.fireHostTriggers(ev.target.id, 'hostDealtDamage', { triggerAmount: ev.amount });
          const tgt = this.state.objects[ev.target.id];
          if (ev.sourceId !== undefined && ev.combat && tgt && isCreature(tgt))
            this.fireSelfTrigger(ev.sourceId, 'combatDamageToCreature', { subjectId: ev.target.id, triggerAmount: ev.amount });
        }
        if (ev.sourceId !== undefined) {
          this.fireSelfTrigger(ev.sourceId, 'dealsDamage', { subjectId: ev.target.kind === 'object' ? ev.target.id : undefined, subjectPlayer: ev.target.kind === 'player' ? ev.target.player : undefined, triggerAmount: ev.amount });
          this.fireHostTriggers(ev.sourceId, 'hostDealsDamage', { subjectPlayer: ev.target.kind === 'player' ? ev.target.player : undefined, triggerAmount: ev.amount });
        }
      }
      if (ev.type === 'combatDamageToPlayer') {
        this.fireSelfTrigger(ev.attackerId, 'combatDamageToPlayer', { subjectPlayer: ev.player, triggerAmount: ev.amount });
        this.fireHostTriggers(ev.attackerId, 'hostCombatDamageToPlayer', { subjectPlayer: ev.player, triggerAmount: ev.amount });
        const atk = this.state.objects[ev.attackerId];
        if (atk) this.fireControllerTriggers(atk.controller, 'yourCreatureCombatDamageToPlayer', { subjectId: atk.id, subjectPlayer: ev.player, triggerAmount: ev.amount });
        if (atk) {
          const s3 = this.state;
          s3.combatDamageSubtypesThisTurn = [...new Set([...(s3.combatDamageSubtypesThisTurn ?? []), ...atk.card.subtypes])];
          if (atk.card.ingest) this.pushTrigger(atk, { text: 'ingerir', effect: [{ op: 'exileTop', who: 'opponent', count: 1 }] });
          // Monarch / initiative pass to whoever dealt the combat damage.
          if (s3.monarch === ev.player && atk.controller !== ev.player) { s3.monarch = atk.controller; this.emit({ type: 'monarchChanged', player: atk.controller }); }
          if (s3.initiative === ev.player && atk.controller !== ev.player) {
            s3.initiative = atk.controller;
            this.emit({ type: 'initiativeChanged', player: atk.controller });
            this.emit({ type: 'ventureRequested', player: atk.controller, sourceId: atk.id, dungeon: 'Undercity' });
          }
          // Cipher: cast a copy of each spell encoded on this creature.
          for (const enc of Object.values(s3.objects)) {
            if (enc.zone !== 'exile' || enc.exiledAs !== 'cipher' || enc.encodedOn !== atk.id) continue;
            const effect = (enc.card.spellEffect ?? []).filter((st) => st.op !== 'cipherEncode');
            this.pushTrigger(atk, { text: `cifra: ${enc.card.name}`, targets: enc.card.spellTargets, effect: [{ op: 'mayDo', prompt: `conjurar uma cópia de ${enc.card.name} de graça?`, effect }] });
          }
        }
        if (atk?.card.renown && !atk.renowned && atk.zone === 'battlefield') {
          atk.renowned = true;
          const total = (atk.counters['+1/+1'] ?? 0) + atk.card.renown;
          atk.counters['+1/+1'] = total;
          this.emit({ type: 'countersChanged', objectId: atk.id, cardName: atk.card.name, counter: '+1/+1', delta: atk.card.renown, total });
        }
      }
      if (ev.type === 'lifeChanged' && ev.delta > 0) this.fireLifeGainTriggers(ev.player);
    }
  }

  /** "Whenever you gain life" (Ajani's Pridemate). */
  private fireLifeGainTriggers(player: PlayerId): void {
    const s = this.state;
    for (const id of [...s.players[player].zones.battlefield]) {
      const obj = s.objects[id];
      for (const ability of obj.card.abilities ?? []) {
        if (ability.kind !== 'triggered' || ability.trigger.on !== 'youGainLife') continue;
        if (!abilityActive(obj, ability)) continue;
        this.pushTrigger(obj, ability);
      }
    }
  }

  /** Saga chapter abilities whose chapter list includes the new lore total. */
  private fireChapter(sagaId: number, total: number): void {
    const saga = this.state.objects[sagaId];
    if (!saga || saga.zone !== 'battlefield') return;
    for (const ability of saga.card.abilities ?? []) {
      if (ability.kind !== 'triggered' || ability.trigger.on !== 'chapter') continue;
      if (!ability.trigger.chapters.includes(total)) continue;
      this.pushTrigger(saga, ability, undefined, total);
    }
  }

  /** Self triggers on the moved object + global filter triggers everywhere. */
  private fireZoneTriggers(subjectId: number, on: 'etb' | 'dies'): void {
    const s = this.state;
    const subject = s.objects[subjectId] ?? s.lki?.[subjectId];
    if (!subject) return;
    this.fireSelfTrigger(subjectId, on);
    for (const source of Object.values(s.objects)) {
      const gySource = source.zone === 'graveyard' && (source.card.abilities ?? []).some((a) => a.kind === 'triggered' && a.zone === 'graveyard');
      if (source.zone !== 'battlefield' && !gySource) continue;
      // Graft: may move a +1/+1 counter onto another creature entering under your control.
      if (on === 'etb' && source.card.graft && source.id !== subjectId && subject.controller === source.controller && isCreature(subject) && (source.counters['+1/+1'] ?? 0) > 0)
        this.pushTrigger(source, { text: 'enxertar', effect: [{ op: 'mayDo', prompt: `mover um marcador +1/+1 de ${source.card.name} para ${subject.card.name}?`, effect: [{ op: 'moveCounter', counter: '+1/+1', from: 'self', to: 'triggering' }] }] }, subjectId);
      for (const ability of source.card.abilities ?? []) {
        if (ability.kind !== 'triggered' || ability.trigger.on !== on) continue;
        if ((ability.zone === 'graveyard') !== gySource) continue;
        if (!('what' in ability.trigger)) continue;
        if (!abilityActive(source, ability)) continue;
        if (!matchFilter({ controller: source.controller, sourceId: source.id, state: s }, ability.trigger.what, subject))
          continue;
        if (ability.kind === 'triggered' && 'oncePerBatch' in ability.trigger && ability.trigger.oncePerBatch) { const key = source.id * 100 + (source.card.abilities ?? []).indexOf(ability); if (this.diesBatch.has(key)) return; this.diesBatch.add(key); }
        this.pushTrigger(source, ability, subjectId);
      }
    }
  }

  /** Evolve: a creature entering under your control with greater P or T gives +1/+1. */
  private fireEvolve(enteringId: number): void {
    const s = this.state;
    const entering = s.objects[enteringId];
    if (!entering || !entering.card.types.includes('Creature')) return;
    for (const id of [...s.players[entering.controller].zones.battlefield]) {
      const o = s.objects[id];
      if (!o?.card.evolve || o.id === enteringId) continue;
      if (effectivePower(s, entering) > effectivePower(s, o) || effectiveToughness(s, entering) > effectiveToughness(s, o))
        this.pushTrigger(o, { text: 'evoluir', effect: [{ op: 'putCounters', what: 'self', counter: '+1/+1', count: 1 }] });
    }
  }

  /** Persist / undying / afterlife / modular / exile-until-leaves, when a permanent leaves. */
  private onLeaveKeywords(objectId: number, to: string): void {
    const s = this.state;
    const obj = s.objects[objectId];
    if (!obj) return;
    // Cartas exiladas "até ~ sair" voltam para o campo.
    if (obj.exiledUntilLeaves?.length) {
      for (const id of obj.exiledUntilLeaves) {
        const ex = s.objects[id];
        if (ex && ex.zone === 'exile') {
          ex.controller = ex.owner;
          moveWithEvent(s, ex, 'battlefield', 'returned', this.emit);
        }
      }
      obj.exiledUntilLeaves = undefined;
    }
    if (to !== 'graveyard' || obj.isToken) return;
    const card = obj.card;
    // Persist / undying / modular use the counters it had when it died.
    const last = obj.lastCounters ?? {};
    if (card.persist && !(last['-1/-1'] > 0))
      this.pushTrigger(obj, { text: 'persistir', effect: [{ op: 'returnToBattlefield', what: 'self' }, { op: 'putCounters', what: 'self', counter: '-1/-1', count: 1 }] });
    if (card.undying && !(last['+1/+1'] > 0))
      this.pushTrigger(obj, { text: 'imortal', effect: [{ op: 'returnToBattlefield', what: 'self' }, { op: 'putCounters', what: 'self', counter: '+1/+1', count: 1 }] });
    if (card.modular && last['+1/+1'] > 0)
      this.pushTrigger(obj, {
        text: 'modular',
        targets: [{ what: 'creature', controlledBy: 'you', typeAnyOf: ['Artifact'] }],
        effect: [{ op: 'putCounters', what: 'target:0', counter: '+1/+1', count: last['+1/+1'] }],
      });
    if (card.afterlife)
      this.pushTrigger(obj, { text: 'vida após a morte', effect: [{ op: 'token', who: 'controller', count: card.afterlife, name: 'Spirit', power: 1, toughness: 1, colors: ['W', 'B'], subtypes: ['Spirit'], keywords: ['flying'] }] });
  }

  /** Venture into the dungeon: pick the dungeon (first room) or the next room; room effects run as a trigger. */
  private handleVenture(player: PlayerId, sourceId: number, forced?: string): void {
    const s = this.state;
    const ps = s.players[player];
    const src = s.objects[sourceId] ?? Object.values(s.objects).find((o) => o.owner === player);
    if (!src) return;
    const roomMode = (d: import('./dungeons.js').Dungeon, i: number) => {
      const room = d.rooms[i];
      return { label: `${d.name} — ${room.name}`, targets: room.targets, effect: [{ op: 'ventureTo' as const, dungeon: d.name, room: i }, ...room.effect] };
    };
    let options: { label: string; targets?: TargetSpec[]; effect: import('./cards/types.js').EffectStep[] }[];
    if (!ps.dungeon) {
      const pool = forced ? DUNGEONS.filter((d) => d.name === forced) : DUNGEONS.filter((d) => d.name !== 'Undercity');
      options = pool.map((d) => roomMode(d, 0));
    } else {
      const d = DUNGEONS.find((x) => x.name === ps.dungeon!.name);
      if (!d) return;
      options = d.rooms[ps.dungeon.room].next.map((i) => roomMode(d, i));
    }
    if (options.length === 0) return;
    const trig = { text: 'aventurar-se na masmorra' };
    if (options.length === 1) this.pushTriggerAs(src, player, { ...trig, targets: options[0].targets, effect: options[0].effect });
    else this.pushTriggerAs(src, player, { ...trig, effect: [], modes: options });
  }

  /** pushTrigger with an explicit controller (venture sources may be cards in the graveyard). */
  private pushTriggerAs(obj: GameObject, controller: PlayerId, ability: Parameters<Game['pushTrigger']>[1]): void {
    const prev = obj.controller;
    obj.controller = controller;
    this.pushTrigger(obj, ability);
    if (obj.zone !== 'battlefield') obj.controller = prev;
  }

  /** Triggers on a player's permanents keyed on the player ("whenever you attack"). */
  private fireControllerTriggers(
    player: PlayerId,
    on: 'youAttack' | 'youDrawCard' | 'youBecomeMonarch' | 'youVenture' | 'youCompleteDungeon' | 'yourCreatureCombatDamageToPlayer' | 'youDiscard' | 'anyPlayerDiscards' | 'youSacrifice' | 'youDrawCardNth',
    extra: { subjectId?: number; subjectPlayer?: PlayerId; triggerAmount?: number; nth?: number; subjectCard?: CardDefinition } = {},
  ): void {
    const s = this.state;
    for (const id of [...s.players[player].zones.battlefield]) {
      const obj = s.objects[id];
      if (!obj) continue;
      (obj.card.abilities ?? []).forEach((ability, idx) => {
        if (ability.kind !== 'triggered' || ability.trigger.on !== on) return;
        if (!abilityActive(obj, ability)) return;
        const t = ability.trigger;
        if (t.on === 'youDrawCardNth' && t.nth !== extra.nth) return;
        if (t.on === 'youSacrifice' && t.filter && extra.subjectCard && !cardMatchesFilter(extra.subjectCard, t.filter)) return;
        this.pushTrigger(obj, ability, extra.subjectId, undefined, { subjectPlayer: extra.subjectPlayer, triggerAmount: extra.triggerAmount, abilityIndex: idx });
      });
    }
  }

  private fireSelfTrigger(
    objectId: number,
    on: 'etb' | 'dies' | 'attacks' | 'blocks' | 'leaves' | 'becomesTapped' | 'becomesBlocked' | 'combatDamageToPlayer' | 'turnedFaceUp' | 'dealtDamage' | 'dealsDamage' | 'combatDamageToCreature' | 'attacksUnblocked' | 'youExertThis' | 'youCastThis' | 'becomesUntapped' | 'damagedCreatureDies' | 'transformsInto',
    extra: { subjectId?: number; subjectPlayer?: PlayerId; triggerAmount?: number } = {},
  ): void {
    const obj = this.state.objects[objectId];
    if (!obj) return;
    (obj.card.abilities ?? []).forEach((ability, idx) => {
      if (ability.kind !== 'triggered') return;
      if (ability.trigger.on !== on) return;
      if ('what' in ability.trigger) return; // gatilho global (filtro), não próprio
      if (!abilityActive(obj, ability)) return;
      if (ability.requiresKicked && !obj.kicked) return;
      this.pushTrigger(obj, ability, extra.subjectId, undefined, { subjectPlayer: extra.subjectPlayer, triggerAmount: extra.triggerAmount, abilityIndex: idx });
    });
  }

  /** Triggers on auras/equipment attached to `hostId` ("whenever enchanted creature attacks"). */
  private fireHostTriggers(hostId: number, on: 'hostDies' | 'hostAttacks' | 'hostCombatDamageToPlayer' | 'hostDealtDamage' | 'hostDealsDamage', extra: { subjectPlayer?: PlayerId; triggerAmount?: number } = {}): void {
    const s = this.state;
    for (const a of Object.values(s.objects)) {
      if (a.zone !== 'battlefield' || a.attachedTo !== hostId) continue;
      (a.card.abilities ?? []).forEach((ability, idx) => {
        if (ability.kind !== 'triggered' || ability.trigger.on !== on) return;
        if (!abilityActive(a, ability)) return;
        this.pushTrigger(a, ability, hostId, undefined, { ...extra, abilityIndex: idx });
      });
    }
  }

  /** Prowess-style: "whenever you cast a (noncreature) spell", nth spell, spells of a kind, heroic, "when you cast ~", "whenever a player casts". */
  private fireCastTriggers(caster: PlayerId, card: CardDefinition, spellObj?: GameObject, targets: TargetChoice[] = []): void {
    const s = this.state;
    const nth = s.players[caster].spellsCastThisTurn ?? 1;
    for (const id of [...s.players[caster].zones.battlefield, ...s.players[caster].zones.graveyard]) {
      const obj = s.objects[id];
      if (!obj) continue;
      (obj.card.abilities ?? []).forEach((ability, idx) => {
        if (ability.kind !== 'triggered' || !abilityActive(obj, ability)) return;
        if ((ability.zone === 'graveyard') !== (obj.zone === 'graveyard')) return; // Poxwalkers: só do cemitério
        const t = ability.trigger;
        let fires = false;
        if (t.on === 'youCastSpell') {
          fires = true;
          if (t.noncreatureOnly && card.types.includes('Creature')) fires = false;
          if (t.instantSorceryOnly && !card.types.includes('Instant') && !card.types.includes('Sorcery')) fires = false;
          if (t.notFromHand && spellObj?.castFromHand) fires = false;
        } else if (t.on === 'youCastSpellNth') fires = nth === t.nth;
        else if (t.on === 'youCastSpellOf') fires = cardMatchesFilter(card, t.filter);
        else if (t.on === 'youCastSpellTargetingThis') fires = targets.some((x) => x.kind === 'object' && x.id === obj.id);
        else if (t.on === 'anyCastsSpell') fires = !t.filter || cardMatchesFilter(card, t.filter.cmcEqualsCountersOn ? { ...t.filter, cmcEqualsCountersOn: undefined, cmcEquals: obj.counters[t.filter.cmcEqualsCountersOn] ?? 0 } : t.filter);
        if (fires) this.pushTrigger(obj, ability, spellObj?.id, undefined, { subjectPlayer: caster, abilityIndex: idx });
      });
    }
    // "Whenever an opponent casts a spell" / "whenever a player casts a spell" on the other player's permanents.
    for (const id of [...s.players[opponentOf(caster)].zones.battlefield]) {
      const obj = s.objects[id];
      if (!obj) continue;
      (obj.card.abilities ?? []).forEach((ability, idx) => {
        if (ability.kind !== 'triggered' || !abilityActive(obj, ability)) return;
        if (ability.trigger.on !== 'opponentCastsSpell' && ability.trigger.on !== 'anyCastsSpell') return;
        if (ability.trigger.on === 'anyCastsSpell' && ability.trigger.filter && !cardMatchesFilter(card, ability.trigger.filter.cmcEqualsCountersOn ? { ...ability.trigger.filter, cmcEqualsCountersOn: undefined, cmcEquals: obj.counters[ability.trigger.filter.cmcEqualsCountersOn] ?? 0 } : ability.trigger.filter)) return;
        this.pushTrigger(obj, ability, spellObj?.id, undefined, { subjectPlayer: caster, abilityIndex: idx });
      });
    }
    // "When you cast ~" on the spell itself.
    if (spellObj) this.fireSelfTrigger(spellObj.id, 'youCastThis');
  }

  /** Echo, cumulative upkeep, vanishing, fading — as stack abilities of the active player's permanents. */
  private fireUpkeepKeywords(): void {
    const s = this.state;
    // "At the beginning of the upkeep of enchanted creature's controller".
    for (const a of Object.values(s.objects)) {
      if (a.zone !== 'battlefield' || a.attachedTo === undefined) continue;
      const host = s.objects[a.attachedTo];
      if (!host || host.controller !== s.activePlayer) continue;
      (a.card.abilities ?? []).forEach((ability, idx) => {
        if (ability.kind === 'triggered' && ability.trigger.on === 'hostControllerUpkeep' && abilityActive(a, ability)) this.pushTrigger(a, ability, host.id, undefined, { abilityIndex: idx, subjectPlayer: host.controller });
      });
    }
    // Initiative: its holder ventures into Undercity at the beginning of their upkeep.
    if (s.initiative === s.activePlayer) {
      const src = Object.values(s.objects).find((o) => o.owner === s.activePlayer);
      if (src) this.emit({ type: 'ventureRequested', player: s.activePlayer, sourceId: src.id, dungeon: 'Undercity' });
    }
    // Suspend: remove a time counter from each suspended card; at zero, cast it.
    for (const id of [...s.players[s.activePlayer].zones.exile]) {
      const obj = s.objects[id];
      if (obj.exiledAs !== 'suspended') continue;
      const left = Math.max(0, (obj.counters['time'] ?? 0) - 1);
      obj.counters['time'] = left;
      this.emit({ type: 'countersChanged', objectId: obj.id, cardName: obj.card.name, counter: 'time', delta: -1, total: left });
      if (left === 0) s.delayed.push({ at: 'nextUpkeep', player: s.activePlayer, objectId: obj.id, action: 'castFree' });
    }
    for (const id of [...s.players[s.activePlayer].zones.battlefield]) {
      const obj = s.objects[id];
      const card = obj.card;
      if (card.echo && obj.echoPending) {
        obj.echoPending = false;
        this.pushTrigger(obj, { text: `eco ${card.echo}`, effect: [{ op: 'payOrElse', cost: card.echo, else: [{ op: 'sacrificeSelf' }] }] });
      }
      if (card.cumulativeUpkeep) {
        const total = (obj.counters['age'] ?? 0) + 1;
        obj.counters['age'] = total;
        this.emit({ type: 'countersChanged', objectId: obj.id, cardName: card.name, counter: 'age', delta: 1, total });
        this.pushTrigger(obj, { text: `manutenção cumulativa ${card.cumulativeUpkeep}`, effect: [{ op: 'payOrElse', cost: card.cumulativeUpkeep, perCounter: 'age', else: [{ op: 'sacrificeSelf' }] }] });
      }
      for (const [kw, counter] of [['vanishing', 'time'], ['fading', 'fade']] as const) {
        if (!card[kw]) continue;
        const left = (obj.counters[counter] ?? 0) - 1;
        if (left >= 0) {
          obj.counters[counter] = left;
          this.emit({ type: 'countersChanged', objectId: obj.id, cardName: card.name, counter, delta: -1, total: left });
        }
        if (left <= 0) this.pushTrigger(obj, { text: `${kw}: sem marcadores`, effect: [{ op: 'sacrificeSelf' }] });
      }
    }
  }

  private fireStepTriggers(on: 'upkeep' | 'endStep' | 'beginCombat' | 'main1' | 'main2'): void {
    const s = this.state;
    if (on === 'endStep') {
      // Impending: "At the beginning of your end step, remove a time counter from it."
      for (const id of [...s.players[s.activePlayer].zones.battlefield]) {
        const obj = s.objects[id];
        if (!obj?.impending || (obj.counters['time'] ?? 0) <= 0) continue;
        obj.counters['time'] -= 1;
        this.emit({ type: 'countersChanged', objectId: obj.id, cardName: obj.card.name, counter: 'time', delta: -1, total: obj.counters['time'] });
      }
    }
    for (const p of PLAYER_IDS) {
      for (const id of [...s.players[p].zones.battlefield]) {
        const obj = s.objects[id];
        if (!obj) continue;
        (obj.card.abilities ?? []).forEach((ability, idx) => {
          if (ability.kind !== 'triggered' || ability.trigger.on !== on) return;
          const whose = (ability.trigger as { whose?: 'controller' | 'each' | 'opponent' }).whose ?? 'controller';
          if (whose === 'controller' && obj.controller !== s.activePlayer) return;
          if (whose === 'opponent' && obj.controller === s.activePlayer) return;
          if (!abilityActive(obj, ability)) return;
          this.pushTrigger(obj, ability, undefined, undefined, { abilityIndex: idx });
        });
      }
    }
  }

  private pushTrigger(
    obj: GameObject,
    ability: { text: string; effect: StackItem['effect']; targets?: import('./cards/types.js').TargetSpec[]; modes?: import('./cards/types.js').SpellMode[]; condition?: import('./cards/types.js').Cond; oncePerTurn?: boolean },
    subjectId?: number,
    chapter?: number,
    extra: { subjectPlayer?: PlayerId; triggerAmount?: number; abilityIndex?: number } = {},
  ): void {
    const s = this.state;
    // Intervening "if" ("…, if you're the monarch, …"): checked as it would trigger.
    if (ability.condition) {
      const cond = ability.condition;
      const ok = cond.kind === 'subjectIs' || (cond.kind === 'and' && cond.conds.some((c) => c.kind === 'subjectIs'))
        ? condHolds({ state: s, controller: obj.controller, sourceId: obj.id, sourceName: obj.card.name, targets: [], subjectId, subjectPlayer: extra.subjectPlayer, triggerAmount: extra.triggerAmount, emit: this.emit }, cond)
        : staticConditionHolds(s, obj, cond);
      if (!ok) return;
    }
    // "For the first time each turn" (valiant & friends).
    if (ability.oncePerTurn && extra.abilityIndex !== undefined) {
      if (obj.triggeredThisTurn?.[extra.abilityIndex]) return;
      obj.triggeredThisTurn = { ...(obj.triggeredThisTurn ?? {}), [extra.abilityIndex]: true };
    }
    const { subjectPlayer, triggerAmount } = extra;
    this.emit({
      type: 'abilityTriggered',
      player: obj.controller,
      sourceId: obj.id,
      sourceName: obj.card.name,
      text: ability.text,
    });
    // "Choose one —": the controller picks the mode first (doChooseMode re-enters here).
    if (ability.modes && ability.modes.length > 0) {
      if (s.pendingDecision) {
        // Outra decisão em curso: enfileira como gatilho sem alvo que pede o modo depois.
        s.triggerQueue.push({ sourceId: obj.id, controller: obj.controller, cardName: obj.card.name, text: ability.text, specs: [], effect: [], modes: ability.modes, subjectId, subjectPlayer, triggerAmount, chapter });
        return;
      }
      s.pendingDecision = {
        type: 'chooseMode',
        player: obj.controller,
        sourceId: obj.id,
        cardName: obj.card.name,
        options: ability.modes.map((m) => ({ label: m.label, effect: m.effect, targets: m.targets })),
      };
      this.emit({ type: 'decisionRequired', player: obj.controller, decision: `mode:${obj.card.name}` });
      return;
    }
    // Targeted trigger: queue it — the controller picks targets before it
    // goes on the stack (processed by advanceLoop).
    if (ability.targets && ability.targets.length > 0) {
      s.triggerQueue.push({
        sourceId: obj.id,
        controller: obj.controller,
        cardName: obj.card.name,
        text: ability.text,
        specs: ability.targets,
        effect: ability.effect,
        subjectId,
        subjectPlayer,
        triggerAmount,
        chapter,
      });
      return;
    }
    s.stack.push({
      id: s.nextStackId++,
      kind: 'ability',
      sourceId: obj.id,
      controller: obj.controller,
      cardName: obj.card.name,
      effect: ability.effect,
      targets: [],
      description: `${obj.card.name}: ${ability.text}`,
      subjectId,
      subjectPlayer,
      triggerAmount,
      chapter,
    });
    s.passCount = 0;
    s.priority = s.activePlayer;
  }

  /** Pop the next queued targeted trigger; skip it if no legal target exists. */
  private processTriggerQueue(): void {
    const s = this.state;
    const trig = s.triggerQueue.shift();
    if (!trig) return;
    if (trig.modes) {
      const obj = s.objects[trig.sourceId];
      if (obj) this.pushTrigger(obj, { text: trig.text, effect: [], modes: trig.modes }, trig.subjectId, trig.chapter, { subjectPlayer: trig.subjectPlayer, triggerAmount: trig.triggerAmount });
      return;
    }
    const srcColors = s.objects[trig.sourceId]?.card.colors;
    const anyLegal = trig.specs.every((spec) => this.hasLegalTarget(trig.controller, spec, srcColors));
    if (!anyLegal) {
      this.emit({ type: 'fizzled', description: `${trig.cardName}: ${trig.text} — removida (sem alvos legais)` });
      return;
    }
    s.pendingDecision = {
      type: 'chooseTargets',
      player: trig.controller,
      sourceId: trig.sourceId,
      cardName: trig.cardName,
      text: trig.text,
      specs: trig.specs,
      effect: trig.effect,
      subjectId: trig.subjectId,
      subjectPlayer: trig.subjectPlayer,
      triggerAmount: trig.triggerAmount,
      chapter: trig.chapter,
    };
    this.emit({ type: 'decisionRequired', player: trig.controller, decision: `targets:${trig.cardName}` });
  }

  private hasLegalTarget(
    controller: PlayerId,
    spec: import('./cards/types.js').TargetSpec,
    srcColors?: import('./types.js').Color[],
  ): boolean {
    if (spec.what === 'player' || spec.what === 'any') return true;
    return Object.values(this.state.objects).some((o) =>
      targetMatchesSpec(this.state, controller, spec, { kind: 'object', id: o.id }, srcColors),
    );
  }

  /** Crew N: tap untapped creatures with total power ≥ N; the vehicle becomes a creature until end of turn. */
  private doCrew(playerId: PlayerId, objectId: number, creatureIds: number[]): boolean {
    const s = this.state;
    const err = this.requirePriority(playerId);
    if (err) { this.fail(playerId, err); return false; }
    const vehicle = s.objects[objectId];
    if (!vehicle || vehicle.zone !== 'battlefield' || vehicle.controller !== playerId || vehicle.card.crew === undefined)
      { this.fail(playerId, 'isso não é um veículo seu'); return false; }
    if (vehicle.crewedUntilEot) { this.fail(playerId, `${vehicle.card.name} já está tripulado`); return false; }
    if (new Set(creatureIds).size !== creatureIds.length || creatureIds.length === 0)
      { this.fail(playerId, 'escolha as criaturas que vão tripular'); return false; }
    let power = 0;
    const crew: GameObject[] = [];
    for (const id of creatureIds) {
      const c = s.objects[id];
      if (!c || c.zone !== 'battlefield' || c.controller !== playerId || !isCreature(c) || c.tapped || c.id === vehicle.id)
        { this.fail(playerId, 'tripulante inválido (precisa ser criatura sua desvirada)'); return false; }
      power += Math.max(0, effectivePower(s, c));
      crew.push(c);
    }
    if (power < vehicle.card.crew)
      { this.fail(playerId, `${vehicle.card.name}: tripular ${vehicle.card.crew} — poder total ${power} não basta`); return false; }
    for (const c of crew) setTapped(s, c, true, this.emit);
    vehicle.crewedUntilEot = true;
    this.emit({ type: 'crewed', objectId: vehicle.id, cardName: vehicle.card.name, player: playerId });
    return true;
  }

  /** Answer a "choose one —" on a triggered ability; then it proceeds like any trigger. */
  private doChooseMode(playerId: PlayerId, mode: number): boolean {
    const s = this.state;
    const pending = s.pendingDecision;
    if (!pending || pending.type !== 'chooseMode' || pending.player !== playerId)
      { this.fail(playerId, 'nenhuma escolha de modo pendente para você'); return false; }
    const opt = pending.options[mode];
    if (!opt) { this.fail(playerId, 'modo inválido'); return false; }
    s.pendingDecision = null;
    this.emit({ type: 'modeChosen', player: playerId, cardName: pending.cardName, mode: opt.label });
    const obj = s.objects[pending.sourceId];
    if (!obj) return true;
    this.pushTrigger(obj, { text: opt.label, effect: opt.effect, targets: opt.targets });
    return true;
  }

  private doChooseTargets(playerId: PlayerId, targets: TargetChoice[]): boolean {
    const s = this.state;
    const pending = s.pendingDecision;
    if (!pending || pending.type !== 'chooseTargets' || pending.player !== playerId)
      { this.fail(playerId, 'nenhuma escolha de alvos pendente para você'); return false; }
    const err = this.validateTargets(playerId, pending.specs, targets, s.objects[pending.sourceId]?.card.colors);
    if (err) { this.fail(playerId, err); return false; }
    s.pendingDecision = null;
    if (pending.freeCast) {
      const obj = s.objects[pending.sourceId];
      if (!obj) return true;
      castCardFree(s, obj, playerId, this.emit, pending.freeCast.note, targets, { bargained: pending.freeCast.bargained, bargainDecided: true });
      this.fireCastTriggers(playerId, obj.card, obj, targets);
      s.priority = playerId;
      return true;
    }
    s.stack.push({
      id: s.nextStackId++,
      kind: 'ability',
      sourceId: pending.sourceId,
      controller: playerId,
      cardName: pending.cardName,
      effect: pending.effect,
      targets,
      description: `${pending.cardName}: ${pending.text}`,
      subjectId: pending.subjectId,
      subjectPlayer: pending.subjectPlayer,
      triggerAmount: pending.triggerAmount,
      chapter: pending.chapter,
    });
    s.passCount = 0;
    s.priority = s.activePlayer;
    return true;
  }
}
