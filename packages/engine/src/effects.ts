/**
 * Interpreter for the declarative effect DSL (Tier 1 automation).
 *
 * Runs when a stack item resolves. Steps marked as "choice" ops pause the
 * script (state.pendingDecision) and resume via applyEffectChoice once the
 * player picks; forced choices auto-resolve without a round-trip.
 *
 * Targets were validated at cast time; here they are re-checked ("fizzle"
 * rules: an illegal target is skipped).
 */
import type {
  DynAmount,
  EffectScript,
  EffectStep,
  FilterSpec,
  PlayerSel,
  SubjectRef,
  TargetSpec,
} from './cards/types.js';
import { cardMatchesFilter } from './cards/types.js';
import {
  addPoison,
  changeLife,
  dealDamageToObject,
  dealDamageToPlayer,
  destroyObject,
  draw,
  moveWithEvent,
  setTapped,
  type Emit,
} from './ops.js';
import {
  battlefield,
  createObject,
  effectivePower,
  hasKeyword,
  matchFilter,
  type GameObject,
  type GameState,
  type PendingDecision,
  type StackItem,
} from './state.js';
import { opponentOf, type PlayerId, type TargetChoice } from './types.js';
import { shuffle } from './rng.js';
import { canPay, parseCost, planPayment } from './mana.js';

export interface EffectContext {
  state: GameState;
  controller: PlayerId;
  /** Source object (the spell card or the ability's permanent). */
  sourceId: number;
  sourceName: string;
  targets: TargetChoice[];
  xValue?: number;
  sacrificedPower?: number;
  /** Color chosen by the player for 'addManaChoice' abilities. */
  chosenMana?: 'W' | 'U' | 'B' | 'R' | 'G';
  emit: Emit;
}

function resolvePlayers(sel: PlayerSel, controller: PlayerId): PlayerId[] {
  if (sel === 'controller') return [controller];
  if (sel === 'opponent') return [opponentOf(controller)];
  return [controller, opponentOf(controller)];
}

function resolveSubject(ctx: EffectContext, ref: SubjectRef): TargetChoice[] {
  if (ref === 'self') return [{ kind: 'object', id: ctx.sourceId }];
  if (ref === 'host') {
    const host = ctx.state.objects[ctx.sourceId]?.attachedTo;
    return host !== undefined ? [{ kind: 'object', id: host }] : [];
  }
  if (ref === 'controller' || ref === 'opponent' || ref === 'each')
    return resolvePlayers(ref, ctx.controller).map((p) => ({ kind: 'player', player: p }));
  const idx = parseInt(ref.slice('target:'.length), 10);
  const t = ctx.targets[idx];
  return t ? [t] : [];
}

/** Resolve a WhoSel ('controller'/'opponent'/'each'/'target:N') to players. */
function resolveWho(ctx: EffectContext, who: import('./cards/types.js').WhoSel): PlayerId[] {
  if (who === 'controller' || who === 'opponent' || who === 'each')
    return resolvePlayers(who, ctx.controller);
  const t = ctx.targets[parseInt(who.slice('target:'.length), 10)];
  return t?.kind === 'player' ? [t.player] : [];
}

/** Colors of the effect's source, for protection checks. */
function sourceColors(ctx: EffectContext): import('./types.js').Color[] {
  return ctx.state.objects[ctx.sourceId]?.card.colors ?? [];
}

export function resolveAmount(ctx: EffectContext, amount: DynAmount): number {
  if (typeof amount === 'number') return amount;
  if (amount === 'X') return ctx.xValue ?? 0;
  if (amount === 'sacrificedPower') return ctx.sacrificedPower ?? 0;
  if ('powerOf' in amount) {
    const [t] = resolveSubject(ctx, amount.powerOf);
    const obj = t ? objectAlive(ctx.state, t) : null;
    return obj ? Math.max(0, effectivePower(ctx.state, obj)) : 0;
  }
  return battlefield(ctx.state).filter((o) =>
    matchFilter({ controller: ctx.controller, sourceId: ctx.sourceId }, amount.per, o),
  ).length;
}

function selectBattlefield(ctx: EffectContext, filter: FilterSpec): GameObject[] {
  return battlefield(ctx.state).filter((o) =>
    matchFilter({ controller: ctx.controller, sourceId: ctx.sourceId }, filter, o),
  );
}

/** A target is still legal if the object is somewhere it can be affected. */
function objectAlive(state: GameState, t: TargetChoice): GameObject | null {
  if (t.kind !== 'object') return null;
  const obj = state.objects[t.id];
  if (!obj) return null;
  if (obj.zone !== 'battlefield' && obj.zone !== 'stack' && obj.zone !== 'graveyard') return null;
  return obj;
}

// ------------------------------------------------------------- choice ops

type ChoiceStep = Extract<EffectStep, { op: 'discard' | 'sacrifice' | 'scry' | 'surveil' | 'search' | 'nameCardDiscard' | 'counterUnlessPay' | 'mayDo' | 'payOrElse' | 'chooseValue' | 'devour' }>;

const CHOICE_OPS = new Set(['discard', 'sacrifice', 'scry', 'surveil', 'search', 'nameCardDiscard', 'counterUnlessPay', 'mayDo', 'payOrElse', 'chooseValue', 'devour']);

function isChoiceStep(step: EffectStep): step is ChoiceStep {
  return CHOICE_OPS.has(step.op);
}

interface ChoiceSetup {
  player: PlayerId;
  options: number[];
  min: number;
  max: number;
  prompt: string;
  mode: 'cards' | 'scry' | 'nameCard' | 'confirm' | 'chooseColor' | 'chooseType';
  /** 'confirm' with nothing to decide (target gone / can't pay) resolves immediately. */
  autoAnswer?: 'yes' | 'no' | 'skip';
}

/** Pay a mana cost for a player right now (taps + pool + phyrexian life). Returns false if unaffordable. */
function payNow(state: GameState, player: PlayerId, cost: string, emit: Emit): boolean {
  const plan = planPayment(state, player, parseCost(cost));
  if (!plan) return false;
  for (const tap of plan.taps) {
    setTapped(state, state.objects[tap.objectId], true, emit);
    for (const sym of tap.produce) state.players[player].manaPool[sym] += 1;
  }
  for (const sym of plan.fromPool) state.players[player].manaPool[sym] = Math.max(0, state.players[player].manaPool[sym] - 1);
  if (plan.lifePaid > 0) changeLife(state, player, -plan.lifePaid, 'mana phyrexiana', emit);
  return true;
}

/** Cost text for payOrElse (cumulative upkeep multiplies by age counters). */
function payOrElseCost(ctx: EffectContext, step: Extract<EffectStep, { op: 'payOrElse' }>): string {
  if (!step.perCounter) return step.cost;
  const n = ctx.state.objects[ctx.sourceId]?.counters[step.perCounter] ?? 0;
  return step.cost.repeat(Math.max(1, n));
}

/** Resolve who a choice belongs to ('target:N' → the targeted player). */
function choicePlayer(ctx: EffectContext, who: import('./cards/types.js').WhoSel): PlayerId {
  if (who === 'each') return ctx.controller;
  if (who === 'controller') return ctx.controller;
  if (who === 'opponent') return opponentOf(ctx.controller);
  const t = ctx.targets[parseInt(who.slice('target:'.length), 10)];
  return t?.kind === 'player' ? t.player : ctx.controller;
}

function setupChoice(ctx: EffectContext, step: ChoiceStep): ChoiceSetup {
  const { state, controller } = ctx;
  switch (step.op) {
    case 'discard': {
      const victim = choicePlayer(ctx, step.who);
      // Duress-style: the caster looks at that hand and picks.
      const decider = step.chooser === 'caster' ? controller : victim;
      const hand = state.players[victim].zones.hand.filter((id) =>
        cardMatchesFilter(state.objects[id].card, step.filter),
      );
      const n = Math.min(step.count, hand.length);
      return {
        player: decider,
        options: hand,
        min: n,
        max: n,
        prompt:
          decider === victim
            ? `${ctx.sourceName}: descarte ${n} carta(s)`
            : `${ctx.sourceName}: escolha ${n} carta(s) da mão do oponente para descartar`,
        mode: 'cards',
      };
    }
    case 'sacrifice': {
      const player = choicePlayer(ctx, step.who);
      const filter = step.filter ?? { what: 'permanent' as const };
      const options = state.players[player].zones.battlefield
        .map((id) => state.objects[id])
        .filter((o) => matchFilter({ controller: player, sourceId: ctx.sourceId }, { ...filter, controlledBy: undefined }, o))
        .map((o) => o.id);
      const n = Math.min(step.count, options.length);
      return {
        player,
        options,
        min: n,
        max: n,
        prompt: `${ctx.sourceName}: sacrifique ${n} permanente(s)`,
        mode: 'cards',
      };
    }
    case 'scry': {
      const top = state.players[controller].zones.library.slice(0, step.count);
      return {
        player: controller,
        options: top,
        min: 0,
        max: top.length,
        prompt: `Vidência ${top.length}: selecione as cartas que vão para o FUNDO (as demais ficam no topo)`,
        mode: 'scry',
      };
    }
    case 'surveil': {
      const top = state.players[controller].zones.library.slice(0, step.count);
      return {
        player: controller,
        options: top,
        min: 0,
        max: top.length,
        prompt: `Vigiar ${top.length}: selecione as cartas que vão para o CEMITÉRIO (as demais ficam no topo)`,
        mode: 'scry',
      };
    }
    case 'search': {
      const options = state.players[controller].zones.library
        .map((id) => state.objects[id])
        .filter((o) => cardMatchesFilter(o.card, step.filter))
        .map((o) => o.id);
      return {
        player: controller,
        options,
        min: 0,
        max: Math.min(step.count, options.length),
        prompt: `Busque até ${step.count} carta(s) na sua biblioteca`,
        mode: 'cards',
      };
    }
    case 'nameCardDiscard':
      return {
        player: controller,
        options: [],
        min: 0,
        max: 0,
        prompt: `${ctx.sourceName}: escolha o nome de uma carta que não seja terreno`,
        mode: 'nameCard',
      };
    case 'mayDo':
      return {
        player: controller,
        options: [],
        min: 0,
        max: 0,
        prompt: `${ctx.sourceName}: ${step.prompt ?? 'aplicar o efeito opcional?'}`,
        mode: 'confirm',
      };
    case 'payOrElse': {
      const cost = payOrElseCost(ctx, step);
      return {
        player: controller,
        options: [],
        min: 0,
        max: 0,
        prompt: `${ctx.sourceName}: pagar ${cost}?`,
        mode: 'confirm',
        autoAnswer: canPay(state, controller, parseCost(cost)) ? undefined : 'no',
      };
    }
    case 'chooseValue':
      return {
        player: controller,
        options: [],
        min: 0,
        max: 0,
        prompt: step.kind === 'color' ? `${ctx.sourceName}: escolha uma cor` : `${ctx.sourceName}: escolha um tipo de criatura`,
        mode: step.kind === 'color' ? 'chooseColor' : 'chooseType',
      };
    case 'devour': {
      const options = state.players[controller].zones.battlefield
        .map((id) => state.objects[id])
        .filter((o) => o.id !== ctx.sourceId && o.card.types.includes('Creature'))
        .map((o) => o.id);
      return {
        player: controller,
        options,
        min: 0,
        max: options.length,
        prompt: `${ctx.sourceName}: devorar — sacrifique quantas criaturas quiser (${step.per} marcador(es) cada)`,
        mode: 'cards',
      };
    }
    case 'counterUnlessPay': {
      const [t] = resolveSubject(ctx, step.what);
      const item = t?.kind === 'object' ? state.stack.find((s) => s.kind === 'spell' && s.sourceId === t.id) : undefined;
      if (!item) return { player: controller, options: [], min: 0, max: 0, prompt: '', mode: 'confirm', autoAnswer: 'skip' };
      const canPayIt = canPay(state, item.controller, parseCost(step.cost));
      return {
        player: item.controller,
        options: [],
        min: 0,
        max: 0,
        prompt: `${ctx.sourceName}: pagar ${step.cost} para ${item.cardName} não ser anulada?`,
        mode: 'confirm',
        autoAnswer: canPayIt ? undefined : 'no',
      };
    }
  }
}

/** Execute a choice step once the picks are known. */
export function executeChoice(ctx: EffectContext, step: ChoiceStep, picks: number[], text?: string): boolean | void {
  const { state, emit } = ctx;
  switch (step.op) {
    case 'mayDo':
      return; // o script escolhido é emendado em applyEffectChoice
    case 'payOrElse': {
      // Retorna true se pagou; o ramo "else" é emendado em applyEffectChoice.
      if (text !== 'yes') return false;
      const paid = payNow(state, ctx.controller, payOrElseCost(ctx, step), emit);
      if (paid) emit({ type: 'fizzled', description: `${state.players[ctx.controller].name} pagou ${payOrElseCost(ctx, step)} por ${ctx.sourceName}` });
      return paid;
    }
    case 'chooseValue': {
      const src = state.objects[ctx.sourceId];
      if (!src || !text) return;
      if (step.kind === 'color') src.chosenColor = text as import('./types.js').Color;
      else src.chosenType = text.trim();
      emit({ type: 'valueChosen', player: ctx.controller, cardName: ctx.sourceName, value: text });
      return;
    }
    case 'devour': {
      const src = state.objects[ctx.sourceId];
      let eaten = 0;
      for (const id of picks) {
        const obj = state.objects[id];
        if (!obj || obj.zone !== 'battlefield') continue;
        moveWithEvent(state, obj, 'graveyard', 'sacrificed', emit);
        eaten++;
      }
      if (src && src.zone === 'battlefield' && eaten > 0) {
        const total = (src.counters['+1/+1'] ?? 0) + eaten * step.per;
        src.counters['+1/+1'] = total;
        emit({ type: 'countersChanged', objectId: src.id, cardName: src.card.name, counter: '+1/+1', delta: eaten * step.per, total });
      }
      return;
    }
    case 'counterUnlessPay': {
      const [t] = resolveSubject(ctx, step.what);
      if (t?.kind !== 'object') return;
      const item = state.stack.find((s) => s.kind === 'spell' && s.sourceId === t.id);
      if (!item) return;
      const obj = state.objects[t.id];
      if (text === 'yes') {
        const plan = planPayment(state, item.controller, parseCost(step.cost));
        if (plan) {
          for (const tap of plan.taps) {
            setTapped(state, state.objects[tap.objectId], true, emit);
            for (const sym of tap.produce) state.players[item.controller].manaPool[sym] += 1;
          }
          for (const sym of plan.fromPool)
            state.players[item.controller].manaPool[sym] = Math.max(0, state.players[item.controller].manaPool[sym] - 1);
          if (plan.lifePaid > 0) changeLife(state, item.controller, -plan.lifePaid, 'mana phyrexiana', emit);
          emit({ type: 'fizzled', description: `${state.players[item.controller].name} pagou ${step.cost}: ${item.cardName} não foi anulada` });
          return;
        }
      }
      if (obj?.card.uncounterable) {
        emit({ type: 'fizzled', description: `${item.cardName} não pode ser anulada` });
        return;
      }
      state.stack = state.stack.filter((s) => s !== item);
      if (obj) {
        const dest = item.flashback ? 'exile' : 'graveyard';
        obj.zone = dest;
        state.players[obj.owner].zones[dest].push(obj.id);
      }
      emit({ type: 'spellCountered', objectId: t.id, cardName: item.cardName });
      return;
    }
    case 'nameCardDiscard': {
      const name = (text ?? '').trim();
      if (!name) return;
      emit({ type: 'cardNamed', player: ctx.controller, name });
      for (const victim of resolveWho(ctx, step.who)) {
        const hand = state.players[victim].zones.hand;
        emit({ type: 'handRevealed', player: victim, cards: hand.map((id) => state.objects[id].card.name) });
        const matching = hand.filter(
          (id) => state.objects[id].card.name.toLowerCase() === name.toLowerCase(),
        );
        for (const id of matching) {
          const obj = state.objects[id];
          moveWithEvent(state, obj, 'graveyard', 'discarded', emit);
          emit({ type: 'discarded', player: victim, objectId: id, cardName: obj.card.name });
        }
      }
      return;
    }
    case 'discard': {
      for (const id of picks) {
        const obj = state.objects[id];
        if (!obj || obj.zone !== 'hand') continue;
        moveWithEvent(state, obj, 'graveyard', 'discarded', emit);
        emit({ type: 'discarded', player: obj.owner, objectId: id, cardName: obj.card.name });
      }
      return;
    }
    case 'sacrifice': {
      for (const id of picks) {
        const obj = state.objects[id];
        if (!obj || obj.zone !== 'battlefield') continue;
        moveWithEvent(state, obj, 'graveyard', 'sacrificed', emit);
      }
      return;
    }
    case 'scry': {
      const library = state.players[ctx.controller].zones.library;
      for (const id of picks) {
        const i = library.indexOf(id);
        if (i >= 0) {
          library.splice(i, 1);
          library.push(id);
        }
      }
      emit({ type: 'scried', player: ctx.controller, looked: Math.min(step.count, library.length), bottomed: picks.length });
      return;
    }
    case 'surveil': {
      for (const id of picks) {
        const obj = state.objects[id];
        if (!obj || obj.zone !== 'library') continue;
        moveWithEvent(state, obj, 'graveyard', 'milled', emit);
      }
      emit({ type: 'scried', player: ctx.controller, looked: step.count, bottomed: 0 });
      return;
    }
    case 'search': {
      const found: string[] = [];
      const toTop: number[] = [];
      for (const id of picks) {
        const obj = state.objects[id];
        if (!obj || obj.zone !== 'library') continue;
        found.push(obj.card.name);
        if (step.to === 'libraryTop') {
          // Removed now, put back on top after the shuffle (Mystical Tutor).
          const lib = state.players[ctx.controller].zones.library;
          const i = lib.indexOf(id);
          if (i >= 0) lib.splice(i, 1);
          toTop.push(id);
          continue;
        }
        moveWithEvent(state, obj, step.to, 'searched', emit);
        if (step.to === 'battlefield' && step.tapped) setTapped(state, obj, true, emit);
      }
      emit({ type: 'searched', player: ctx.controller, found, to: step.to });
      const r = shuffle(state.players[ctx.controller].zones.library, state.rngState);
      state.players[ctx.controller].zones.library = r.items;
      state.rngState = r.state;
      if (toTop.length > 0) state.players[ctx.controller].zones.library.unshift(...toTop);
      emit({ type: 'shuffled', player: ctx.controller });
      return;
    }
  }
}

/**
 * Handle a choice step inline: auto-resolve forced/empty choices, otherwise
 * pause the script by setting state.pendingDecision.
 */
function beginChoice(ctx: EffectContext, step: ChoiceStep, remaining: EffectStep[]): 'done' | 'paused' {
  const setup = setupChoice(ctx, step);
  if (setup.mode === 'confirm') {
    if (setup.autoAnswer === 'skip') return 'done';
    if (setup.autoAnswer) {
      executeChoice(ctx, step, [], setup.autoAnswer);
      return 'done';
    }
  }
  // Text answers always need the round-trip (the answer is text, not picks).
  if (setup.mode !== 'nameCard' && setup.mode !== 'confirm' && setup.mode !== 'chooseColor' && setup.mode !== 'chooseType') {
    // Forced choice (all options must be picked) or nothing to pick → no round-trip.
    if (setup.mode === 'cards' && setup.options.length <= setup.min) {
      executeChoice(ctx, step, setup.options);
      return 'done';
    }
    if (setup.options.length === 0) {
      executeChoice(ctx, step, []);
      return 'done';
    }
  }
  const pending: PendingDecision = {
    type: 'effectChoice',
    player: setup.player,
    prompt: setup.prompt,
    mode: setup.mode,
    options: setup.options,
    min: setup.min,
    max: setup.max,
    resume: {
      controller: ctx.controller,
      sourceId: ctx.sourceId,
      sourceName: ctx.sourceName,
      targets: ctx.targets,
      xValue: ctx.xValue,
      current: step,
      remaining,
      finishSpellId: null,
    },
  };
  ctx.state.pendingDecision = pending;
  ctx.emit({ type: 'decisionRequired', player: setup.player, decision: setup.prompt });
  return 'paused';
}

/**
 * Resume after the player picked. Returns 'paused' if a later step paused
 * again (finishSpellId is carried over), 'done' when the script completed
 * (the finished spell, if any, is moved to the graveyard here).
 */
export function applyEffectChoice(
  state: GameState,
  pending: Extract<PendingDecision, { type: 'effectChoice' }>,
  picks: number[],
  emit: Emit,
  text?: string,
): 'done' | 'paused' {
  const ctx: EffectContext = {
    state,
    controller: pending.resume.controller,
    sourceId: pending.resume.sourceId,
    sourceName: pending.resume.sourceName,
    targets: pending.resume.targets,
    xValue: pending.resume.xValue,
    emit,
  };
  state.pendingDecision = null;
  const current = pending.resume.current as ChoiceStep;
  const outcome = executeChoice(ctx, current, picks, text);
  // "You may …" / "pay or else": o ramo escolhido roda antes do resto do
  // script (pausas aninhadas continuam funcionando: vira um único script).
  const branch =
    current.op === 'mayDo' ? (text === 'yes' ? current.effect : current.else ?? [])
    : current.op === 'payOrElse' ? (outcome === true ? [] : current.else)
    : [];
  const result = runEffectScript(ctx, [...branch, ...pending.resume.remaining]);
  if (result === 'paused') {
    const next = state.pendingDecision as PendingDecision | null;
    if (next?.type === 'effectChoice') {
      next.resume.finishSpellId = pending.resume.finishSpellId;
      next.resume.finishSpellExile = pending.resume.finishSpellExile;
    }
    return 'paused';
  }
  const spellId = pending.resume.finishSpellId;
  if (spellId !== null) {
    const spell = state.objects[spellId];
    if (spell && spell.zone === 'stack')
      moveWithEvent(state, spell, pending.resume.finishSpellExile ? 'exile' : 'graveyard', 'resolved', emit);
  }
  return 'done';
}

// ------------------------------------------------------------ interpreter

export function runEffectScript(ctx: EffectContext, script: EffectScript): 'done' | 'paused' {
  for (let i = 0; i < script.length; i++) {
    const step = script[i];
    if (isChoiceStep(step)) {
      if (beginChoice(ctx, step, script.slice(i + 1)) === 'paused') return 'paused';
      continue;
    }
    runStep(ctx, step);
  }
  return 'done';
}

function runStep(ctx: EffectContext, step: Exclude<EffectStep, ChoiceStep>): void {
  const { state, emit } = ctx;
  switch (step.op) {
    case 'draw': {
      const count = resolveAmount(ctx, step.count);
      for (const p of resolveWho(ctx, step.who))
        for (let i = 0; i < count; i++) draw(state, p, emit);
      return;
    }

    case 'discardHand':
      for (const p of resolveWho(ctx, step.who)) {
        for (const id of [...state.players[p].zones.hand]) {
          const obj = state.objects[id];
          moveWithEvent(state, obj, 'graveyard', 'discarded', emit);
          emit({ type: 'discarded', player: p, objectId: id, cardName: obj.card.name });
        }
      }
      return;

    case 'discardRandom':
      for (const p of resolvePlayers(step.who, ctx.controller)) {
        for (let i = 0; i < step.count; i++) {
          const hand = state.players[p].zones.hand;
          if (hand.length === 0) break;
          const r = shuffle(hand, state.rngState);
          state.rngState = r.state;
          const obj = state.objects[r.items[0]];
          moveWithEvent(state, obj, 'graveyard', 'discarded', emit);
          emit({ type: 'discarded', player: p, objectId: obj.id, cardName: obj.card.name });
        }
      }
      return;

    case 'mill':
      for (const p of resolveWho(ctx, step.who)) {
        for (let i = 0; i < step.count; i++) {
          const top = state.players[p].zones.library[0];
          if (top === undefined) break;
          moveWithEvent(state, state.objects[top], 'graveyard', 'milled', emit);
        }
      }
      return;

    case 'damage': {
      const amount = resolveAmount(ctx, step.amount);
      const src = state.objects[ctx.sourceId]?.card;
      for (const t of resolveSubject(ctx, step.to)) {
        if (t.kind === 'player') dealDamageToPlayer(state, t.player, amount, ctx.sourceName, emit, { infect: src?.infect, toxic: src?.toxic });
        else {
          const obj = objectAlive(state, t);
          if (obj && obj.zone === 'battlefield')
            dealDamageToObject(state, obj, amount, ctx.sourceName, emit, { sourceColors: sourceColors(ctx), infect: src?.infect, wither: src?.wither });
        }
      }
      return;
    }

    case 'poison':
      for (const p of resolveWho(ctx, step.who)) addPoison(state, p, step.count, emit);
      return;

    case 'putCountersEach':
      for (const obj of selectBattlefield(ctx, step.filter)) {
        const total = (obj.counters[step.counter] ?? 0) + step.count;
        obj.counters[step.counter] = total;
        emit({ type: 'countersChanged', objectId: obj.id, cardName: obj.card.name, counter: step.counter, delta: step.count, total });
      }
      return;

    case 'sacrificeSelf': {
      const src = state.objects[ctx.sourceId];
      if (src && src.zone === 'battlefield') moveWithEvent(state, src, 'graveyard', 'sacrificed', emit);
      return;
    }

    case 'exileUntilLeaves': {
      const src = state.objects[ctx.sourceId];
      for (const t of resolveSubject(ctx, step.what)) {
        const obj = objectAlive(state, t);
        if (!obj || obj.zone !== 'battlefield') continue;
        if (!src || src.zone !== 'battlefield') { moveWithEvent(state, obj, 'exile', 'exiled', emit); continue; }
        moveWithEvent(state, obj, 'exile', 'exiled', emit);
        if (!obj.isToken) (src.exiledUntilLeaves ??= []).push(obj.id);
      }
      return;
    }

    case 'putCountersOnce': {
      const src = state.objects[ctx.sourceId];
      if (!src || src.zone !== 'battlefield' || src.counters[`__${step.flag}`]) return;
      src.counters[`__${step.flag}`] = 1;
      const total = (src.counters[step.counter] ?? 0) + step.count;
      src.counters[step.counter] = total;
      emit({ type: 'countersChanged', objectId: src.id, cardName: src.card.name, counter: step.counter, delta: step.count, total });
      return;
    }

    case 'addChosenColorMana': {
      const src = state.objects[ctx.sourceId];
      const sym = src?.chosenColor;
      if (!sym) return;
      const count = step.count ?? 1;
      state.players[ctx.controller].manaPool[sym] += count;
      emit({ type: 'manaAdded', player: ctx.controller, mana: Array(count).fill(sym), sourceName: ctx.sourceName });
      return;
    }

    case 'gainLife': {
      const amount = resolveAmount(ctx, step.amount);
      for (const p of resolveWho(ctx, step.who)) changeLife(state, p, amount, ctx.sourceName, emit);
      return;
    }

    case 'loseLife': {
      const amount = resolveAmount(ctx, step.amount);
      for (const p of resolveWho(ctx, step.who)) changeLife(state, p, -amount, ctx.sourceName, emit);
      return;
    }

    case 'destroy':
      for (const t of resolveSubject(ctx, step.what)) {
        const obj = objectAlive(state, t);
        if (obj && obj.zone === 'battlefield' && !hasKeyword(state, obj, 'indestructible'))
          destroyObject(state, obj, emit);
      }
      return;

    case 'exile':
      for (const t of resolveSubject(ctx, step.what)) {
        const obj = objectAlive(state, t);
        if (obj && (obj.zone === 'battlefield' || obj.zone === 'graveyard'))
          moveWithEvent(state, obj, 'exile', 'exiled', emit);
      }
      return;

    case 'returnToHand':
      for (const t of resolveSubject(ctx, step.what)) {
        const obj = objectAlive(state, t);
        if (obj && (obj.zone === 'battlefield' || obj.zone === 'graveyard'))
          moveWithEvent(state, obj, 'hand', 'returned', emit);
      }
      return;

    case 'returnToBattlefield':
      for (const t of resolveSubject(ctx, step.what)) {
        const obj = objectAlive(state, t);
        if (obj && obj.zone === 'graveyard') {
          // Enters under the effect controller's control (Zombify).
          obj.controller = ctx.controller;
          moveWithEvent(state, obj, 'battlefield', 'returned', emit);
          if (step.tapped) setTapped(state, obj, true, emit);
        }
      }
      return;

    case 'regenerate':
      for (const t of resolveSubject(ctx, step.what)) {
        const obj = objectAlive(state, t);
        if (obj && obj.zone === 'battlefield') {
          obj.counters['__regen'] = (obj.counters['__regen'] ?? 0) + 1;
        }
      }
      return;

    case 'tap':
    case 'untap':
      for (const t of resolveSubject(ctx, step.what)) {
        const obj = objectAlive(state, t);
        if (obj && obj.zone === 'battlefield') setTapped(state, obj, step.op === 'tap', emit);
      }
      return;

    case 'counterSpell':
      for (const t of resolveSubject(ctx, step.what)) {
        if (t.kind !== 'object') continue;
        const item = state.stack.find((s) => s.kind === 'spell' && s.sourceId === t.id);
        if (!item) continue;
        const obj = state.objects[t.id];
        if (obj?.card.uncounterable) {
          emit({ type: 'fizzled', description: `${item.cardName} não pode ser anulada` });
          continue;
        }
        state.stack = state.stack.filter((s) => s !== item);
        if (obj) {
          // Flashback: a countered flashback spell is exiled instead.
          const dest = item.flashback ? 'exile' : 'graveyard';
          obj.zone = dest;
          state.players[obj.owner].zones[dest].push(obj.id);
        }
        emit({ type: 'spellCountered', objectId: t.id, cardName: item.cardName });
      }
      return;

    case 'pump':
      for (const t of resolveSubject(ctx, step.what)) {
        const obj = objectAlive(state, t);
        if (obj && obj.zone === 'battlefield') applyPump(ctx, obj, step.power, step.toughness, step.keywords);
      }
      return;

    case 'putCounters': {
      const count = resolveAmount(ctx, step.count);
      for (const t of resolveSubject(ctx, step.what)) {
        const obj = objectAlive(state, t);
        if (obj && obj.zone === 'battlefield') {
          const total = (obj.counters[step.counter] ?? 0) + count;
          obj.counters[step.counter] = total;
          emit({ type: 'countersChanged', objectId: obj.id, cardName: obj.card.name, counter: step.counter, delta: count, total });
        }
      }
      return;
    }

    case 'attach': {
      const source = state.objects[ctx.sourceId];
      const t = ctx.targets[0];
      if (!source || source.zone !== 'battlefield') return;
      if (!t || t.kind !== 'object') return;
      const host = state.objects[t.id];
      if (!host || host.zone !== 'battlefield') return;
      source.attachedTo = host.id;
      emit({ type: 'attached', sourceId: source.id, sourceName: source.card.name, hostId: host.id, hostName: host.card.name });
      return;
    }

    case 'damageEach': {
      const amount = resolveAmount(ctx, step.amount);
      const src = state.objects[ctx.sourceId]?.card;
      for (const obj of selectBattlefield(ctx, step.filter))
        dealDamageToObject(state, obj, amount, ctx.sourceName, emit, { sourceColors: sourceColors(ctx), infect: src?.infect, wither: src?.wither });
      return;
    }

    case 'destroyEach':
      for (const obj of selectBattlefield(ctx, step.filter))
        if (!hasKeyword(state, obj, 'indestructible')) destroyObject(state, obj, emit);
      return;

    case 'exileEach':
      for (const obj of selectBattlefield(ctx, step.filter))
        moveWithEvent(state, obj, 'exile', 'exiled', emit);
      return;

    case 'pumpEach':
      for (const obj of selectBattlefield(ctx, step.filter))
        applyPump(ctx, obj, step.power, step.toughness, step.keywords);
      return;

    case 'tapEach':
    case 'untapEach':
      for (const obj of selectBattlefield(ctx, step.filter))
        setTapped(state, obj, step.op === 'tapEach', emit);
      return;

    case 'fight': {
      const [ta] = resolveSubject(ctx, step.a);
      const [tb] = resolveSubject(ctx, step.b);
      const a = ta ? objectAlive(state, ta) : null;
      const b = tb ? objectAlive(state, tb) : null;
      if (!a || !b || a.zone !== 'battlefield' || b.zone !== 'battlefield') return;
      const aPower = Math.max(0, effectivePower(state, a));
      const bPower = Math.max(0, effectivePower(state, b));
      if (aPower > 0)
        dealDamageToObject(state, b, aPower, a.card.name, emit, {
          deathtouch: hasKeyword(state, a, 'deathtouch'),
          sourceColors: a.card.colors,
        });
      if (bPower > 0)
        dealDamageToObject(state, a, bPower, b.card.name, emit, {
          deathtouch: hasKeyword(state, b, 'deathtouch'),
          sourceColors: b.card.colors,
        });
      return;
    }

    case 'gainControl':
      for (const t of resolveSubject(ctx, step.what)) {
        const obj = objectAlive(state, t);
        if (!obj || obj.zone !== 'battlefield' || obj.controller === ctx.controller) continue;
        const from = obj.controller;
        const fromArr = state.players[from].zones.battlefield;
        const i = fromArr.indexOf(obj.id);
        if (i >= 0) fromArr.splice(i, 1);
        obj.controller = ctx.controller;
        state.players[ctx.controller].zones.battlefield.push(obj.id);
        if (step.untilEndOfTurn) state.controlReverts.push({ objectId: obj.id, to: from });
        emit({ type: 'controlChanged', objectId: obj.id, cardName: obj.card.name, to: ctx.controller });
      }
      return;

    case 'copySpell':
      for (const t of resolveSubject(ctx, step.what)) {
        if (t.kind !== 'object') continue;
        const original = state.stack.find(
          (s) => (s.kind === 'spell' || s.kind === 'copy') && s.sourceId === t.id,
        );
        if (!original) continue;
        state.stack.push({
          id: state.nextStackId++,
          kind: 'copy',
          sourceId: original.sourceId,
          controller: ctx.controller,
          cardName: original.cardName,
          effect: original.effect,
          targets: [...original.targets],
          description: `Cópia de ${original.cardName}`,
          xValue: original.xValue,
          sacrificedPower: original.sacrificedPower,
        });
        emit({ type: 'copiesCreated', cardName: original.cardName, count: 1, reason: 'copy' });
      }
      return;

    case 'preventCombatDamage':
      // O log já registra a resolução da mágica; aqui só o estado muda.
      state.combatDamagePrevented = true;
      return;

    case 'putOnLibraryTop':
      for (const t of resolveSubject(ctx, step.what)) {
        const obj = objectAlive(state, t);
        if (obj && (obj.zone === 'battlefield' || obj.zone === 'graveyard'))
          moveWithEvent(state, obj, 'library', 'returned', emit, 'top');
      }
      return;

    case 'namedToken':
      for (const p of resolvePlayers(step.who, ctx.controller)) {
        for (let i = 0; i < step.count; i++) {
          const obj = createObject(state, NAMED_TOKENS[step.kind], p);
          obj.isToken = true;
          obj.zone = 'battlefield';
          state.players[p].zones.battlefield.push(obj.id);
          emit({ type: 'tokenCreated', player: p, objectId: obj.id, name: step.kind });
        }
      }
      return;

    case 'shuffle':
      for (const p of resolvePlayers(step.who, ctx.controller)) {
        const r = shuffle(state.players[p].zones.library, state.rngState);
        state.players[p].zones.library = r.items;
        state.rngState = r.state;
        emit({ type: 'shuffled', player: p });
      }
      return;

    case 'addMana':
      for (const p of resolvePlayers(step.who, ctx.controller)) {
        for (const sym of step.mana) state.players[p].manaPool[sym] += 1;
        emit({ type: 'manaAdded', player: p, mana: step.mana, sourceName: ctx.sourceName });
      }
      return;

    case 'addManaChoice': {
      const sym = ctx.chosenMana;
      if (!sym) return; // guarded at activation; never silently guess a color
      const count = step.count ?? 1;
      for (const p of resolvePlayers(step.who, ctx.controller)) {
        state.players[p].manaPool[sym] += count;
        emit({ type: 'manaAdded', player: p, mana: Array(count).fill(sym), sourceName: ctx.sourceName });
      }
      return;
    }

    case 'token':
      for (const p of resolvePlayers(step.who, ctx.controller)) {
        for (let i = 0; i < step.count; i++) {
          const obj = createObject(state, {
            id: `token-${step.name.toLowerCase().replace(/\s+/g, '-')}`,
            name: step.name,
            types: ['Creature'],
            subtypes: step.subtypes,
            colors: step.colors,
            power: step.power,
            toughness: step.toughness,
            keywords: step.keywords,
            automation: 'full',
          }, p);
          obj.isToken = true;
          obj.zone = 'battlefield';
          obj.summoningSick = true;
          state.players[p].zones.battlefield.push(obj.id);
          emit({ type: 'tokenCreated', player: p, objectId: obj.id, name: step.name });
        }
      }
      return;
  }
}

/** Artifact tokens with their own abilities (Treasure, Food, Clue). */
const NAMED_TOKENS: Record<'Treasure' | 'Food' | 'Clue', import('./cards/types.js').CardDefinition> = {
  Treasure: {
    id: 'token-treasure', name: 'Treasure', types: ['Artifact'], subtypes: ['Treasure'], colors: [],
    text: '{T}, Sacrifice this artifact: Add one mana of any color.',
    abilities: [{ kind: 'activated', cost: { tap: true, sacrificeSelf: true }, effect: [{ op: 'addManaChoice', who: 'controller' }], text: 'Sacrificar: uma mana de qualquer cor', isManaAbility: true }],
    automation: 'full',
  },
  Food: {
    id: 'token-food', name: 'Food', types: ['Artifact'], subtypes: ['Food'], colors: [],
    text: '{2}, {T}, Sacrifice this artifact: You gain 3 life.',
    abilities: [{ kind: 'activated', cost: { mana: '{2}', tap: true, sacrificeSelf: true }, effect: [{ op: 'gainLife', who: 'controller', amount: 3 }], text: '{2}, sacrificar: ganhe 3 de vida' }],
    automation: 'full',
  },
  Clue: {
    id: 'token-clue', name: 'Clue', types: ['Artifact'], subtypes: ['Clue'], colors: [],
    text: '{2}, Sacrifice this artifact: Draw a card.',
    abilities: [{ kind: 'activated', cost: { mana: '{2}', sacrificeSelf: true }, effect: [{ op: 'draw', who: 'controller', count: 1 }], text: '{2}, sacrificar: compre uma carta' }],
    automation: 'full',
  },
};

function applyPump(
  ctx: EffectContext,
  obj: GameObject,
  power: number,
  toughness: number,
  keywords?: import('./types.js').Keyword[],
): void {
  obj.untilEot.power += power;
  obj.untilEot.toughness += toughness;
  if (keywords) obj.untilEot.keywords.push(...keywords);
  ctx.emit({ type: 'pumped', objectId: obj.id, cardName: obj.card.name, power, toughness });
}

/** Validate a chosen target against its spec at cast/activation time. */
export function targetMatchesSpec(
  state: GameState,
  controller: PlayerId,
  spec: TargetSpec,
  choice: TargetChoice,
  /** Colors of the targeting source, for protection checks. */
  srcColors?: import('./types.js').Color[],
): boolean {
  if (choice.kind === 'player') {
    if (spec.what !== 'player' && spec.what !== 'any') return false;
    // "You have hexproof": opponents can't target you.
    if (choice.player !== controller && state.players[choice.player].zones.battlefield.some((id) => state.objects[id].card.playerHexproof)) return false;
    return true;
  }
  if (spec.what === 'player') return false;
  const obj = state.objects[choice.id];
  if (!obj) return false;
  if (spec.what === 'spell') {
    if (obj.zone !== 'stack') return false;
    const isCreature = obj.card.types.includes('Creature');
    if (spec.spellType === 'creature') return isCreature;
    if (spec.spellType === 'noncreature') return !isCreature;
    if (spec.spellType === 'instantSorcery') return obj.card.types.includes('Instant') || obj.card.types.includes('Sorcery');
    return true;
  }

  const requiredZone = spec.zone ?? 'battlefield';
  if (obj.zone !== requiredZone) return false;
  if (requiredZone === 'graveyard') {
    if (spec.ownedBy === 'you' && obj.owner !== controller) return false;
  } else {
    if (spec.controlledBy === 'you' && obj.controller !== controller) return false;
    if (spec.controlledBy === 'opponent' && obj.controller === controller) return false;
    // Hexproof: opponents' spells/abilities can't target it. Shroud: nobody's.
    if (obj.controller !== controller && hasKeyword(state, obj, 'hexproof')) return false;
    if (hasKeyword(state, obj, 'shroud')) return false;
    // Protection from [color]: can't be targeted by sources of that color.
    if (obj.card.protectionFrom && srcColors?.some((c) => obj.card.protectionFrom!.includes(c))) return false;
  }
  // Qualificadores ("tapped creature", "attacking or blocking", "with flying", "power 4 or greater"…).
  if (spec.tapped && !obj.tapped) return false;
  if (spec.combat && !obj.attacking && obj.blocking === undefined) return false;
  if (spec.withKeyword && !hasKeyword(state, obj, spec.withKeyword)) return false;
  if (spec.withoutKeyword && hasKeyword(state, obj, spec.withoutKeyword)) return false;
  if (spec.powerAtLeast !== undefined && effectivePower(state, obj) < spec.powerAtLeast) return false;
  if (spec.powerAtMost !== undefined && effectivePower(state, obj) > spec.powerAtMost) return false;
  if (spec.powerLessThanSource !== undefined) {
    const src = state.objects[spec.powerLessThanSource];
    if (!src || effectivePower(state, obj) >= effectivePower(state, src)) return false;
  }
  if (spec.typeAnyOf && !spec.typeAnyOf.some((t) => obj.card.types.includes(t))) return false;
  switch (spec.what) {
    case 'any':
      return true;
    case 'creature':
      return obj.card.types.includes('Creature') || !!obj.crewedUntilEot;
    case 'permanent':
      return true;
    case 'land':
      return obj.card.types.includes('Land');
    case 'artifact':
      return obj.card.types.includes('Artifact');
    case 'enchantment':
      return obj.card.types.includes('Enchantment');
    default:
      return false;
  }
}

/** Re-check all targets at resolution; returns false if the item fizzles. */
export function itemStillHasLegalWork(state: GameState, item: StackItem): boolean {
  if (item.targets.length === 0) return true;
  return item.targets.some((t) => {
    if (t.kind === 'player') return true;
    const obj = state.objects[t.id];
    return !!obj && (obj.zone === 'battlefield' || obj.zone === 'stack' || obj.zone === 'graveyard');
  });
}
