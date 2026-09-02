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
  itemStillHasLegalWork,
  resolveAmount,
  runEffectScript,
  targetMatchesSpec,
} from './effects.js';
import type { GameEvent } from './events.js';
import { canPay, parseCost, planPayment } from './mana.js';
import { changeLife, draw, lose, moveWithEvent, setTapped } from './ops.js';
import { checkStateBasedActions } from './sba.js';
import {
  createGameState,
  effectivePower,
  attachmentForbids,
  createObject,
  effectiveToughness,
  hasKeyword,
  isCreature,
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
  /** Force who goes first, skipping the roll AND the choice (tests). */
  firstPlayer?: PlayerId;
  /**
   * Skip the roll and let this player choose who starts (match rules: the
   * loser of the previous game decides).
   */
  starterChooser?: PlayerId;
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

  private doKeepHand(playerId: PlayerId, bottom: number[]): boolean {
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
    if (PLAYER_IDS.every((p) => mull.phase[p] === 'kept')) {
      s.mulligan = null;
      this.beginFirstTurn();
    }
    return true;
  }

  apply(playerId: PlayerId, action: PlayerAction): ApplyResult {
    this.buf = [];
    this.triggerCursor = 0;
    const s = this.state;

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
        return this.doKeepHand(playerId, action.bottom);
      case 'playLand':
        return this.doPlayLand(playerId, action.objectId);
      case 'castSpell':
        return this.doCastSpell(playerId, action.objectId, action.targets ?? [], action.x, action.mode, action.sacrifices, action.kicked, action.useAltCost, action.altExile);
      case 'effectChoice':
        return this.doEffectChoice(playerId, action.picks, action.text);
      case 'chooseTargets':
        return this.doChooseTargets(playerId, action.targets);
      case 'activateAbility':
        return this.doActivateAbility(playerId, action.objectId, action.abilityIndex, action.targets ?? [], action.sacrifices, action.manaColor, action.discards);
      case 'crew':
        return this.doCrew(playerId, action.objectId, action.creatures);
      case 'chooseMode':
        return this.doChooseMode(playerId, action.mode);
      case 'cycle':
        return this.doCycle(playerId, action.objectId);
      case 'declareAttackers':
        return this.doDeclareAttackers(playerId, action.attackers, action.defendTarget);
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
    if (obj.kicked && card.kicker?.entersWithCounters) add(card.kicker.entersWithCounters.counter, card.kicker.entersWithCounters.count);
    if (card.vanishing) add('time', card.vanishing);
    if (card.fading) add('fade', card.fading);
    if (card.echo) obj.echoPending = true;
    if (card.livingWeapon) {
      const germ = createObject(s, { id: 'token-germ', name: 'Phyrexian Germ', types: ['Creature'], subtypes: ['Phyrexian', 'Germ'], colors: ['B'], power: 0, toughness: 0, automation: 'full' }, obj.controller);
      germ.isToken = true;
      germ.zone = 'battlefield';
      germ.summoningSick = true;
      s.players[obj.controller].zones.battlefield.push(germ.id);
      obj.attachedTo = germ.id;
      this.emit({ type: 'tokenCreated', player: obj.controller, objectId: germ.id, name: 'Phyrexian Germ' });
    }
    // Escolhas e devorar ao entrar: viram habilidade na pilha (podem pausar).
    const enterScript: import('./cards/types.js').EffectStep[] = [];
    if (card.chooseOnEnter) enterScript.push({ op: 'chooseValue', kind: card.chooseOnEnter });
    if (card.devour) enterScript.push({ op: 'devour', per: card.devour });
    if (enterScript.length > 0) this.pushTrigger(obj, { text: 'ao entrar', effect: enterScript });
  }

  /** entersTapped / checklands & fastlands / shocklands, as a permanent enters. */
  private applyEnterTapRules(obj: GameObject): void {
    const s = this.state;
    const card = obj.card;
    this.applyEnterKeywords(obj);
    if (card.entersTapped) { setTapped(s, obj, true, this.emit); return; }
    if (card.entersTappedUnless) {
      const mine = s.players[obj.controller].zones.battlefield.map((id) => s.objects[id]).filter((o) => o.id !== obj.id);
      const u = card.entersTappedUnless;
      let ok = true;
      if (u.controlsAtLeast) {
        const n = mine.filter((o) => matchFilter({ controller: obj.controller, sourceId: obj.id }, u.controlsAtLeast!.filter, o)).length;
        ok = n >= u.controlsAtLeast.count;
      }
      if (ok && u.controlsAtMost) {
        const n = mine.filter((o) => matchFilter({ controller: obj.controller, sourceId: obj.id }, u.controlsAtMost!.filter, o)).length;
        ok = n <= u.controlsAtMost.count;
      }
      if (ok && u.controlsSubtypeAnyOf) ok = mine.some((o) => u.controlsSubtypeAnyOf!.some((t) => o.card.subtypes.includes(t)));
      if (!ok) setTapped(s, obj, true, this.emit);
      return;
    }
    if (card.shockLife) {
      // "You may pay N life. If you don't, it enters tapped." — pergunta ao controlador.
      runEffectScript(
        { state: s, controller: obj.controller, sourceId: obj.id, sourceName: card.name, targets: [], emit: this.emit },
        [{ op: 'mayDo', prompt: `pagar ${card.shockLife} de vida para ${card.name} entrar desvirado?`, effect: [{ op: 'loseLife', who: 'controller', amount: card.shockLife }], else: [{ op: 'tap', what: 'self' }] }],
      );
    }
  }

  private validateTargets(
    playerId: PlayerId,
    specs: TargetSpec[] | undefined,
    targets: TargetChoice[],
    srcColors?: import('./types.js').Color[],
  ): string | null {
    const required = specs ?? [];
    if (targets.length !== required.filter((t) => !t.optional).length && targets.length !== required.length)
      return 'número de alvos incorreto';
    for (let i = 0; i < targets.length; i++) {
      const spec = required[i];
      if (!spec) return 'alvo em excesso';
      if (!targetMatchesSpec(this.state, playerId, spec, targets[i], srcColors)) return 'alvo ilegal';
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
  ): boolean {
    const s = this.state;
    const err = this.requirePriority(playerId);
    if (err) { this.fail(playerId, err); return false; }
    const obj = s.objects[objectId];
    if (!obj || obj.owner !== playerId)
      { this.fail(playerId, 'carta inválida'); return false; }
    // Flashback: castable from your graveyard for its flashback cost.
    const viaFlashback = obj.zone === 'graveyard' && !!obj.card.flashback;
    if (obj.zone !== 'hand' && !viaFlashback)
      { this.fail(playerId, 'carta inválida'); return false; }
    const card = obj.card;
    if (kicked && !card.kicker)
      { this.fail(playerId, 'essa mágica não tem kicker'); return false; }
    if (card.types.includes('Land'))
      { this.fail(playerId, 'terrenos são jogados, não conjurados'); return false; }
    if (card.automation === 'manual')
      { this.fail(playerId, `${card.name} ainda não é automatizada — use o modo manual`); return false; }
    const isInstant = card.types.includes('Instant') || !!card.keywords?.includes('flash');
    if (!isInstant && !this.sorceryTiming(playerId))
      { this.fail(playerId, 'só pode ser conjurada na sua fase principal com a pilha vazia'); return false; }

    // Modal spells: exactly one mode chosen at cast time.
    let mode: import('./cards/types.js').SpellMode | undefined;
    if (card.spellModes && card.spellModes.length > 0) {
      if (modeIndex === undefined || !card.spellModes[modeIndex])
        { this.fail(playerId, 'escolha um modo da mágica'); return false; }
      mode = card.spellModes[modeIndex];
    }

    // Auras derive their (mandatory) target from the enchant spec.
    const specs = mode
      ? mode.targets
      : card.enchant
        ? [{ what: card.enchant.what, controlledBy: card.enchant.controlledBy }]
        : card.spellTargets;
    const targetErr = this.validateTargets(playerId, specs, targets, card.colors);
    if (targetErr) { this.fail(playerId, targetErr); return false; }
    for (const t of targets) if (t.kind === 'object') this.emit({ type: 'targeted', objectId: t.id, by: playerId });

    // Additional cost: sacrifice (Fling-style; flashback may also demand one,
    // e.g. Cabal Therapy). Validated before any payment.
    const sacReq =
      card.additionalCost ??
      (viaFlashback && card.flashback?.sacrifice
        ? { sacrifice: card.flashback.sacrifice, count: 1 }
        : undefined);
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

    let xValue: number | undefined;
    if (alt) {
      // X with an alternative cost is untypical; treat as 0 when present.
      if (alt.payLife) changeLife(s, playerId, -alt.payLife, `custo de ${card.name}`, this.emit);
      for (const id of exiles) moveWithEvent(s, s.objects[id], 'exile', 'exiled', this.emit);
    } else {
      const cost = parseCost(viaFlashback ? card.flashback!.cost : card.manaCost);
      if (kicked && card.kicker) {
        const kick = parseCost(card.kicker.cost);
        cost.generic += kick.generic;
        cost.colorless += kick.colorless;
        cost.colored.push(...kick.colored);
        cost.hybrid.push(...kick.hybrid);
        cost.phyrexian.push(...kick.phyrexian);
        cost.xCount += kick.xCount;
      }
      if (cost.xCount > 0) {
        if (x === undefined || !Number.isInteger(x) || x < 0)
          { this.fail(playerId, 'escolha um valor de X'); return false; }
        xValue = x;
        cost.generic += x * cost.xCount;
      }
      cost.generic += this.wardTax(playerId, targets);
      const plan = planPayment(s, playerId, cost);
      if (!plan) { this.fail(playerId, 'mana insuficiente'); return false; }
      this.payWithPlan(playerId, plan);
    }

    // Pay the sacrifice cost (power recorded first, for 'sacrificedPower').
    let sacrificedPower: number | undefined;
    if (sacs.length > 0) {
      sacrificedPower = sacs.reduce((sum, id) => sum + Math.max(0, effectivePower(s, s.objects[id])), 0);
      for (const id of sacs) moveWithEvent(s, s.objects[id], 'graveyard', 'sacrificed', this.emit);
    }

    removeFromCurrentZone(s, obj);
    obj.zone = 'stack';
    obj.kicked = !!kicked;
    const description =
      (mode ? `${card.name} — ${mode.label}` : card.name) +
      (xValue !== undefined ? ` (X=${xValue})` : '') +
      (kicked ? ' (com kicker)' : '') +
      (viaFlashback ? ' (flashback)' : '') +
      (alt ? ' (custo alternativo)' : '');
    const baseEffect = mode ? mode.effect : card.spellEffect ?? [];
    const effect = kicked && card.kicker ? [...baseEffect, ...card.kicker.effect] : baseEffect;
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
    // Storm: one copy per spell cast earlier this turn (they resolve first).
    const copies = card.storm ? s.spellsCastThisTurn : 0;
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
    this.emit({ type: 'spellCast', player: playerId, objectId: obj.id, cardName: card.name, targets });
    if (copies > 0) this.emit({ type: 'copiesCreated', cardName: card.name, count: copies, reason: 'storm' });
    this.fireCastTriggers(playerId, card);
    return true;
  }

  /** Ward: targeting an opponent's warded permanent costs {N} more (paid up front). */
  private wardTax(playerId: PlayerId, targets: TargetChoice[]): number {
    let tax = 0;
    for (const t of targets) {
      if (t.kind !== 'object') continue;
      const obj = this.state.objects[t.id];
      if (obj && obj.zone === 'battlefield' && obj.controller !== playerId && obj.card.ward) tax += obj.card.ward;
    }
    return tax;
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
    manaColor?: 'W' | 'U' | 'B' | 'R' | 'G',
    discards?: number[],
  ): boolean {
    const s = this.state;
    const obj = s.objects[objectId];
    if (!obj || obj.zone !== 'battlefield' || obj.controller !== playerId)
      { this.fail(playerId, 'permanente inválida'); return false; }
    const ability = obj.card.abilities?.[abilityIndex];
    if (ability?.kind === 'loyalty') return this.doActivateLoyalty(playerId, obj, ability, targets);
    if (!ability || ability.kind !== 'activated')
      { this.fail(playerId, 'habilidade inválida'); return false; }

    // Mana abilities may be activated at any time; others need priority.
    if (!ability.isManaAbility) {
      const err = this.requirePriority(playerId);
      if (err) { this.fail(playerId, err); return false; }
      if (ability.sorceryOnly && !this.sorceryTiming(playerId))
        { this.fail(playerId, 'só na sua fase principal com a pilha vazia (como uma feitiçaria)'); return false; }
    } else if (s.pendingDecision || s.status !== 'playing') {
      { this.fail(playerId, 'agora não'); return false; }
    }

    // Metalcraft-style activation condition.
    if (ability.condition) {
      const req = ability.condition.controlsAtLeast;
      const have = s.players[playerId].zones.battlefield
        .map((id) => s.objects[id])
        .filter((o) => matchFilter({ controller: playerId, sourceId: obj.id }, req.filter, o)).length;
      if (have < req.count) {
        this.fail(playerId, `${obj.card.name}: requer ${req.count} ${req.filter.what ?? 'permanente'}(s) — você controla ${have}`);
        return false;
      }
    }

    // "Add one mana of any color": the activation must carry the color.
    const choiceStep = ability.effect.find((e) => e.op === 'addManaChoice');
    if (choiceStep && choiceStep.op === 'addManaChoice') {
      if (!manaColor) { this.fail(playerId, 'escolha a cor da mana'); return false; }
      if (choiceStep.colors && !choiceStep.colors.includes(manaColor))
        { this.fail(playerId, `${obj.card.name} não produz {${manaColor}}`); return false; }
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
    const targetErr = this.validateTargets(playerId, ability.targets, targets, obj.card.colors);
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
    if (ability.cost.payLife && s.players[playerId].life < ability.cost.payLife)
      { this.fail(playerId, `você precisa de ${ability.cost.payLife} pontos de vida para pagar`); return false; }

    const abilityTax = this.wardTax(playerId, targets);
    if (ability.cost.mana || abilityTax > 0) {
      const cost = parseCost(ability.cost.mana);
      cost.generic += abilityTax;
      const plan = planPayment(s, playerId, cost);
      if (!plan) { this.fail(playerId, 'mana insuficiente'); return false; }
      this.payWithPlan(playerId, plan);
    }
    if (ability.cost.tap) setTapped(s, obj, true, this.emit);
    if (ability.cost.payLife)
      changeLife(s, playerId, -ability.cost.payLife, `custo de ${obj.card.name}`, this.emit);
    for (const id of discardIds) {
      const c = s.objects[id];
      moveWithEvent(s, c, 'graveyard', 'discarded', this.emit);
      this.emit({ type: 'discarded', player: playerId, objectId: id, cardName: c.card.name });
    }
    for (const id of abilitySacs) moveWithEvent(s, s.objects[id], 'graveyard', 'sacrificed', this.emit);
    if (ability.cost.sacrificeSelf) moveWithEvent(s, obj, 'graveyard', 'sacrificed', this.emit);

    if (ability.isManaAbility) {
      runEffectScript(
        { state: s, controller: playerId, sourceId: obj.id, sourceName: obj.card.name, targets, chosenMana: manaColor, emit: this.emit },
        ability.effect,
      );
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
  private doCycle(playerId: PlayerId, objectId: number): boolean {
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
    if (cycling.mana) {
      const plan = planPayment(s, playerId, parseCost(cycling.mana));
      if (!plan) { this.fail(playerId, 'mana insuficiente'); return false; }
      this.payWithPlan(playerId, plan);
    }
    if (cycling.life) changeLife(s, playerId, -cycling.life, `reciclar ${obj.card.name}`, this.emit);
    moveWithEvent(s, obj, 'graveyard', 'discarded', this.emit);
    this.emit({ type: 'cycled', player: playerId, cardName: obj.card.name });
    runEffectScript(
      { state: s, controller: playerId, sourceId: obj.id, sourceName: obj.card.name, targets: [], emit: this.emit },
      cycling.effect ?? [{ op: 'draw', who: 'controller', count: 1 }],
    );
    s.passCount = 0;
    return true;
  }

  private doDeclareAttackers(playerId: PlayerId, attackerIds: number[], defendTarget?: number): boolean {
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
      if (hasKeyword(s, obj, 'mustAttack') && canAttack(s, obj) === null && !attackerIds.includes(id))
        { this.fail(playerId, `${obj.card.name} precisa atacar este combate`); return false; }
    }
    // Optional: attack a defender's planeswalker instead of the player.
    if (defendTarget !== undefined) {
      const pw = s.objects[defendTarget];
      if (
        !pw ||
        pw.zone !== 'battlefield' ||
        pw.controller !== opponentOf(playerId) ||
        !pw.card.types.includes('Planeswalker')
      )
        { this.fail(playerId, 'alvo de ataque inválido (planeswalker do oponente)'); return false; }
    }
    for (const obj of attackers) {
      obj.attacking = true;
      obj.pwTarget = defendTarget;
      if (!hasKeyword(s, obj, 'vigilance')) setTapped(s, obj, true, this.emit);
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
  }

  private beginTurn(): void {
    const s = this.state;
    s.turn += 1;
    s.activePlayer = opponentOf(s.activePlayer);
    s.spellsCastThisTurn = 0;
    s.combatDamagePrevented = false;
    for (const obj of Object.values(s.objects)) obj.activatedLoyaltyThisTurn = false;
    this.emit({ type: 'turnBegan', turn: s.turn, activePlayer: s.activePlayer });
    this.enterStep('untap');
  }

  private enterStep(step: Step): void {
    const s = this.state;
    s.step = step;
    s.passCount = 0;
    s.reversibleTaps = [];
    for (const p of PLAYER_IDS) s.players[p].manaPool = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
    this.emit({ type: 'stepChanged', step });

    switch (step) {
      case 'untap': {
        const player = s.players[s.activePlayer];
        player.landsPlayedThisTurn = 0;
        for (const id of player.zones.battlefield) {
          const obj = s.objects[id];
          obj.summoningSick = false;
          if (hasKeyword(s, obj, 'doesntUntap') || attachmentForbids(s, obj, 'doesntUntap')) continue;
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
        this.fireUpkeepKeywords();
        this.fireStepTriggers('upkeep');
        s.priority = s.activePlayer;
        return;
      }
      case 'end': {
        this.fireStepTriggers('endStep');
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
        const unlimited = player.zones.battlefield.some((id) => s.objects[id].card.noMaxHandSize);
        const over = unlimited ? 0 : player.zones.hand.length - MAX_HAND_SIZE;
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
        obj.untilEot = { power: 0, toughness: 0, keywords: [] };
        obj.crewedUntilEot = undefined;
        delete obj.counters['__deathtouched'];
        delete obj.counters['__regen']; // regeneration shields expire
      }
    }
    for (const p of PLAYER_IDS) s.players[p].damagedThisTurn = false;
    {
    }
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
        // Aura: enters attached to its target (fizzle above covers a dead one).
        const enchantTarget = obj.card.enchant ? item.targets[0] : undefined;
        if (enchantTarget && enchantTarget.kind === 'object') {
          const host = s.objects[enchantTarget.id];
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
        // "Enters the battlefield with N +1/+1 counters" (N may be X).
        if (obj.card.entersWithCounters) {
          const ctx = {
            state: s,
            controller: item.controller,
            sourceId: obj.id,
            sourceName: item.cardName,
            targets: item.targets,
            xValue: item.xValue,
            emit: this.emit,
          };
          const count = resolveAmount(ctx, obj.card.entersWithCounters.count);
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
        }
        this.emit({ type: 'stackResolved', description: `${item.description} está resolvendo` });
        return;
      }
      this.emit({ type: 'stackResolved', description: `${item.description} resolveu` });
      // Finishes in the graveyard — or exile, for flashback / "Exile ~" spells.
      if (obj.zone === 'stack')
        moveWithEvent(s, obj, item.flashback || obj.card.exileOnResolve ? 'exile' : 'graveyard', 'resolved', this.emit);
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
        emit: this.emit,
      },
      item.effect,
    );
    this.emit({ type: 'stackResolved', description: item.description });
  }

  // -------------------------------------------------------------- triggers

  /** Derive triggered abilities from events emitted since the last scan. */
  private scanTriggers(): void {
    while (this.triggerCursor < this.buf.length) {
      const ev = this.buf[this.triggerCursor++];
      if (ev.type === 'zoneChanged' && ev.to === 'battlefield') this.fireZoneTriggers(ev.objectId, 'etb');
      if (ev.type === 'tokenCreated') this.fireZoneTriggers(ev.objectId, 'etb');
      if (ev.type === 'landPlayed') this.fireZoneTriggers(ev.objectId, 'etb'); // landfall
      if (ev.type === 'zoneChanged' && ev.from === 'battlefield' && ev.to === 'graveyard')
        this.fireZoneTriggers(ev.objectId, 'dies');
      if (ev.type === 'attackersDeclared') {
        for (const a of ev.attackers) this.fireSelfTrigger(a.objectId, 'attacks');
        if (ev.attackers.length > 0) this.fireControllerTriggers(ev.player, 'youAttack');
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
        for (const b of ev.blocks) {
          this.fireSelfTrigger(b.blocker, 'blocks');
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
          this.pushTrigger(o!, ability);
        }
      }
      if (ev.type === 'cardDrawn') this.fireControllerTriggers(ev.player, 'youDrawCard');
      if (ev.type === 'zoneChanged' && ev.from === 'battlefield') {
        this.fireSelfTrigger(ev.objectId, 'leaves');
        this.onLeaveKeywords(ev.objectId, ev.to);
      }
      if (ev.type === 'zoneChanged' && ev.to === 'battlefield') this.fireEvolve(ev.objectId);
      if (ev.type === 'tappedChanged' && ev.tapped) this.fireSelfTrigger(ev.objectId, 'becomesTapped');
      if (ev.type === 'combatDamageToPlayer') {
        this.fireSelfTrigger(ev.attackerId, 'combatDamageToPlayer');
        const atk = this.state.objects[ev.attackerId];
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
        this.pushTrigger(obj, ability);
      }
    }
  }

  /** Self triggers on the moved object + global filter triggers everywhere. */
  private fireZoneTriggers(subjectId: number, on: 'etb' | 'dies'): void {
    const s = this.state;
    const subject = s.objects[subjectId];
    if (!subject) return;
    this.fireSelfTrigger(subjectId, on);
    for (const source of Object.values(s.objects)) {
      if (source.zone !== 'battlefield') continue;
      for (const ability of source.card.abilities ?? []) {
        if (ability.kind !== 'triggered' || ability.trigger.on !== on) continue;
        if (!('what' in ability.trigger)) continue;
        if (!matchFilter({ controller: source.controller, sourceId: source.id }, ability.trigger.what, subject))
          continue;
        this.pushTrigger(source, ability);
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

  /** Triggers on a player's permanents keyed on the player ("whenever you attack"). */
  private fireControllerTriggers(player: PlayerId, on: 'youAttack' | 'youDrawCard'): void {
    const s = this.state;
    for (const id of [...s.players[player].zones.battlefield]) {
      const obj = s.objects[id];
      for (const ability of obj.card.abilities ?? []) {
        if (ability.kind !== 'triggered' || ability.trigger.on !== on) continue;
        this.pushTrigger(obj, ability);
      }
    }
  }

  private fireSelfTrigger(objectId: number, on: 'etb' | 'dies' | 'attacks' | 'blocks' | 'leaves' | 'becomesTapped' | 'becomesBlocked' | 'combatDamageToPlayer'): void {
    const obj = this.state.objects[objectId];
    if (!obj) return;
    for (const ability of obj.card.abilities ?? []) {
      if (ability.kind !== 'triggered') continue;
      if (ability.trigger.on !== on || !('self' in ability.trigger)) continue;
      this.pushTrigger(obj, ability);
    }
  }

  /** Prowess-style: "whenever you cast a (noncreature) spell". */
  private fireCastTriggers(caster: PlayerId, card: CardDefinition): void {
    const s = this.state;
    for (const id of s.players[caster].zones.battlefield) {
      const obj = s.objects[id];
      for (const ability of obj.card.abilities ?? []) {
        if (ability.kind !== 'triggered' || ability.trigger.on !== 'youCastSpell') continue;
        if (ability.trigger.noncreatureOnly && card.types.includes('Creature')) continue;
        if (ability.trigger.instantSorceryOnly && !card.types.includes('Instant') && !card.types.includes('Sorcery')) continue;
        this.pushTrigger(obj, ability);
      }
    }
    // "Whenever an opponent casts a spell" on the other player's permanents.
    for (const id of s.players[opponentOf(caster)].zones.battlefield) {
      const obj = s.objects[id];
      for (const ability of obj.card.abilities ?? []) {
        if (ability.kind !== 'triggered' || ability.trigger.on !== 'opponentCastsSpell') continue;
        this.pushTrigger(obj, ability);
      }
    }
  }

  /** Echo, cumulative upkeep, vanishing, fading — as stack abilities of the active player's permanents. */
  private fireUpkeepKeywords(): void {
    const s = this.state;
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

  private fireStepTriggers(on: 'upkeep' | 'endStep'): void {
    const s = this.state;
    for (const p of PLAYER_IDS) {
      for (const id of s.players[p].zones.battlefield) {
        const obj = s.objects[id];
        for (const ability of obj.card.abilities ?? []) {
          if (ability.kind !== 'triggered' || ability.trigger.on !== on) continue;
          const whose = ability.trigger.whose;
          if (whose === 'controller' && obj.controller !== s.activePlayer) continue;
          this.pushTrigger(obj, ability);
        }
      }
    }
  }

  private pushTrigger(
    obj: GameObject,
    ability: { text: string; effect: StackItem['effect']; targets?: import('./cards/types.js').TargetSpec[]; modes?: import('./cards/types.js').SpellMode[] },
  ): void {
    const s = this.state;
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
        s.triggerQueue.push({ sourceId: obj.id, controller: obj.controller, cardName: obj.card.name, text: ability.text, specs: [], effect: [], modes: ability.modes });
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
      if (obj) this.pushTrigger(obj, { text: trig.text, effect: [], modes: trig.modes });
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
    s.stack.push({
      id: s.nextStackId++,
      kind: 'ability',
      sourceId: pending.sourceId,
      controller: playerId,
      cardName: pending.cardName,
      effect: pending.effect,
      targets,
      description: `${pending.cardName}: ${pending.text}`,
    });
    s.passCount = 0;
    s.priority = s.activePlayer;
    return true;
  }
}
