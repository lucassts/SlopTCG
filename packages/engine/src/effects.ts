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
  transformObject,
} from './ops.js';
import {
  battlefield,
  cardTypesInGraveyards,
  createObject,
  effectivePower,
  effectiveToughness,
  hasKeyword,
  isCreature,
  manaValueOf,
  matchFilter,
  removeFromCurrentZone,
  staticConditionHolds,
  type GameObject,
  type GameState,
  type PendingDecision,
  type StackItem,
} from './state.js';
import { opponentOf, type PlayerId, type TargetChoice } from './types.js';
import { shuffle } from './rng.js';
import { DUNGEONS } from './dungeons.js';
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
  /** Mana chosen by the player for 'addManaChoice' / 'addManaOptions' abilities. */
  chosenMana?: 'W' | 'U' | 'B' | 'R' | 'G' | 'C';
  /** Triggered abilities: the object that caused the trigger. */
  subjectId?: number;
  /** Triggered abilities: the player the trigger is about ("that player"). */
  subjectPlayer?: PlayerId;
  /** Amount carried by the trigger (damage dealt, life gained — "that much"). */
  triggerAmount?: number;
  /** forEach: the current object. */
  iterId?: number;
  emit: Emit;
}

function resolvePlayers(sel: PlayerSel, controller: PlayerId): PlayerId[] {
  if (sel === 'controller') return [controller];
  if (sel === 'opponent') return [opponentOf(controller)];
  return [controller, opponentOf(controller)];
}

function resolveSubject(ctx: EffectContext, ref: SubjectRef): TargetChoice[] {
  if (ref === 'self') return [{ kind: 'object', id: ctx.sourceId }];
  if (ref === 'triggering') return ctx.subjectId !== undefined ? [{ kind: 'object', id: ctx.subjectId }] : [];
  if (ref === 'iter') return ctx.iterId !== undefined ? [{ kind: 'object', id: ctx.iterId }] : [];
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
  if (who === 'triggerPlayer') return ctx.subjectPlayer ? [ctx.subjectPlayer] : [];
  if (who === 'controllerOfTriggering') { const o = ctx.subjectId !== undefined ? ctx.state.objects[ctx.subjectId] : undefined; return o ? [o.controller] : []; }
  if (who === 'controllerOfIter') { const o = ctx.iterId !== undefined ? ctx.state.objects[ctx.iterId] : undefined; return o ? [o.controller] : []; }
  if (who.startsWith('controllerOf:')) {
    const t = ctx.targets[parseInt(who.slice('controllerOf:'.length), 10)];
    if (t?.kind === 'player') return [t.player];
    const o = t?.kind === 'object' ? ctx.state.objects[t.id] : undefined;
    return o ? [o.controller] : [];
  }
  const t = ctx.targets[parseInt(who.slice('target:'.length), 10)];
  return t?.kind === 'player' ? [t.player] : [];
}

/** Evaluate a condition in the effect context (targets / triggering object for `subjectIs`). */
export function condHolds(ctx: EffectContext, cond: import('./cards/types.js').Cond): boolean {
  if (cond.kind === 'subjectIs') {
    const [t] = resolveSubject(ctx, cond.ref);
    if (!t || t.kind !== 'object') return false;
    const obj = ctx.state.objects[t.id];
    return !!obj && matchFilter({ controller: ctx.controller, sourceId: ctx.sourceId, state: ctx.state }, cond.filter, obj);
  }
  if (cond.kind === 'not') return !condHolds(ctx, cond.cond);
  if (cond.kind === 'and') return cond.conds.every((c) => condHolds(ctx, c));
  if (cond.kind === 'or') return cond.conds.some((c) => condHolds(ctx, c));
  const src = ctx.state.objects[ctx.sourceId];
  // A spell/ability source may be off the battlefield: evaluate relative to its controller.
  const fake = src ? { ...src, controller: ctx.controller } : ({ controller: ctx.controller, id: ctx.sourceId, counters: {}, attacking: false, tapped: false } as unknown as GameObject);
  return staticConditionHolds(ctx.state, fake, cond);
}

/** Colors of the effect's source, for protection checks. */
function sourceColors(ctx: EffectContext): import('./types.js').Color[] {
  return ctx.state.objects[ctx.sourceId]?.card.colors ?? [];
}

export function resolveAmount(ctx: EffectContext, amount: DynAmount): number {
  if (typeof amount === 'number') return amount;
  if (amount === 'X') return ctx.xValue ?? 0;
  if (amount === 'sacrificedPower') return ctx.sacrificedPower ?? 0;
  if (amount === 'delvedCount') return ctx.state.objects[ctx.sourceId]?.delvedCount ?? 0;
  if (typeof amount === 'object' && 'cardTypesInGraveyard' in amount)
    return cardTypesInGraveyards(ctx.state, amount.cardTypesInGraveyard === 'each' ? ['p1', 'p2'] : amount.cardTypesInGraveyard === 'opponent' ? [opponentOf(ctx.controller)] : [ctx.controller]);
  if (typeof amount === 'object' && 'halfLifeOf' in amount) {
    const who = amount.halfLifeOf === 'opponent' ? opponentOf(ctx.controller) : ctx.controller;
    const life = ctx.state.players[who].life;
    return amount.round === 'up' ? Math.ceil(life / 2) : Math.floor(life / 2);
  }
  if (amount === 'triggerAmount') return ctx.triggerAmount ?? 0;
  if (amount === 'domain') {
    const lands = ctx.state.players[ctx.controller].zones.battlefield.map((id) => ctx.state.objects[id].card);
    return ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'].filter((t) => lands.some((c) => c.subtypes.includes(t))).length;
  }
  const subj = (ref: SubjectRef) => { const [t] = resolveSubject(ctx, ref); return t ? objectAlive(ctx.state, t) : null; };
  if ('powerOf' in amount) { const obj = subj(amount.powerOf); return obj ? Math.max(0, effectivePower(ctx.state, obj)) : 0; }
  if ('toughnessOf' in amount) { const obj = subj(amount.toughnessOf); return obj ? Math.max(0, effectiveToughness(ctx.state, obj)) : 0; }
  if ('cmcOf' in amount) { const obj = subj(amount.cmcOf); return obj ? manaValueOf(obj.card.manaCost) : 0; }
  if ('countersOn' in amount) { const obj = subj(amount.countersOn); return obj ? obj.counters[amount.counter] ?? 0 : 0; }
  if ('handSize' in amount) return resolvePlayers(amount.handSize, ctx.controller).reduce((s, p) => s + ctx.state.players[p].zones.hand.length, 0);
  if ('graveyardCount' in amount)
    return resolvePlayers(amount.graveyardCount, ctx.controller).reduce((s, p) => s + ctx.state.players[p].zones.graveyard.filter((id) => cardMatchesFilter(ctx.state.objects[id].card, amount.filter)).length, 0);
  if ('lifeOf' in amount) return resolvePlayers(amount.lifeOf, ctx.controller).reduce((s, p) => s + ctx.state.players[p].life, 0);
  if ('times' in amount) return amount.times * resolveAmount(ctx, amount.of);
  if ('plus' in amount) return amount.plus + resolveAmount(ctx, amount.of);
  if ('halfLibraryOf' in amount) { const n = ctx.state.players[amount.halfLibraryOf === 'opponent' ? opponentOf(ctx.controller) : ctx.controller].zones.library.length; return amount.round === 'up' ? Math.ceil(n / 2) : Math.floor(n / 2); }
  return battlefield(ctx.state).filter((o) =>
    matchFilter({ controller: ctx.controller, sourceId: ctx.sourceId, state: ctx.state }, amount.per, o),
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

type ChoiceStep = Extract<EffectStep, { op: 'discard' | 'sacrifice' | 'scry' | 'surveil' | 'search' | 'nameCardDiscard' | 'counterUnlessPay' | 'mayDo' | 'payOrElse' | 'chooseValue' | 'devour' | 'explore' | 'exploit' | 'hideaway' | 'cipherEncode' | 'copyOf' | 'populate' | 'support' | 'connive' | 'digTop' | 'if' | 'bounceOwn' | 'learn' | 'putFromHand' | 'doomsday' | 'putHandOnTop' | 'revealTopByType' | 'returnFromExileToHand' | 'imprintFromHand' | 'discardOrDie' | 'addManaChoice' }>;

const CHOICE_OPS = new Set(['discard', 'sacrifice', 'scry', 'surveil', 'search', 'nameCardDiscard', 'counterUnlessPay', 'mayDo', 'payOrElse', 'chooseValue', 'devour', 'explore', 'exploit', 'hideaway', 'cipherEncode', 'copyOf', 'populate', 'support', 'connive', 'digTop', 'if', 'bounceOwn', 'learn', 'putFromHand', 'doomsday', 'putHandOnTop', 'revealTopByType', 'returnFromExileToHand', 'imprintFromHand', 'discardOrDie', 'addManaChoice']);

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
      const scryer = step.who ? resolveWho(ctx, step.who)[0] ?? controller : controller;
      const top = state.players[scryer].zones.library.slice(0, step.count === 'X' ? ctx.xValue ?? 0 : step.count);
      return {
        player: scryer,
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
      const filter = step.filter?.cmcAtMostX ? { ...step.filter, cmcAtMostX: undefined, cmcAtMost: ctx.xValue ?? 0 } : step.filter;
      const options = state.players[controller].zones.library
        .map((id) => state.objects[id])
        .filter((o) => cardMatchesFilter(o.card, filter))
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
    case 'doomsday': {
      const options = [...state.players[controller].zones.library, ...state.players[controller].zones.graveyard];
      const n = Math.min(step.count, options.length);
      return {
        player: controller,
        options,
        min: n,
        max: n,
        prompt: `Escolha ${step.count} cartas (biblioteca e cemitério) para o topo da biblioteca, na ordem em que vão ficar; o resto é exilado`,
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
        player: step.who === 'opponent' ? opponentOf(controller) : controller,
        options: [],
        min: 0,
        max: 0,
        prompt: `${ctx.sourceName}: ${step.prompt ?? 'aplicar o efeito opcional?'}`,
        mode: 'confirm',
      };
    case 'payOrElse': {
      const payer = step.payer === 'opponent' ? opponentOf(controller) : controller;
      if (step.energy !== undefined) {
        const have = state.players[payer].energy;
        return { player: payer, options: [], min: 0, max: 0, prompt: `${ctx.sourceName}: pagar ${'{E}'.repeat(step.energy)}?`, mode: 'confirm', autoAnswer: have >= step.energy ? undefined : 'no' };
      }
      const cost = payOrElseCost(ctx, step);
      return {
        player: payer,
        options: [],
        min: 0,
        max: 0,
        prompt: `${ctx.sourceName}: pagar ${cost}?`,
        mode: 'confirm',
        autoAnswer: canPay(state, payer, parseCost(cost)) ? undefined : 'no',
      };
    }
    case 'explore': {
      // Land on top → hand (no choice); nonland → counter, then may put it into the graveyard.
      const [t] = resolveSubject(ctx, step.what);
      const who = t?.kind === 'object' ? state.objects[t.id]?.controller ?? controller : controller;
      const top = state.players[who].zones.library[0];
      const card = top !== undefined ? state.objects[top].card : undefined;
      if (!card) return { player: controller, options: [], min: 0, max: 0, prompt: '', mode: 'confirm', autoAnswer: 'skip' };
      if (card.types.includes('Land')) return { player: who, options: [], min: 0, max: 0, prompt: '', mode: 'confirm', autoAnswer: 'no' };
      return { player: who, options: [top], min: 0, max: 0, prompt: `${ctx.sourceName} explora: revelou ${card.name}. Colocar no cemitério? (Não = fica no topo)`, mode: 'confirm' };
    }
    case 'exploit': {
      const options = state.players[controller].zones.battlefield
        .map((id) => state.objects[id])
        .filter((o) => isCreature(o))
        .map((o) => o.id);
      if (options.length === 0) return { player: controller, options: [], min: 0, max: 0, prompt: '', mode: 'cards', autoAnswer: 'skip' };
      return { player: controller, options, min: 0, max: 1, prompt: `${ctx.sourceName}: explorar — sacrifique uma criatura (opcional)`, mode: 'cards' };
    }
    case 'hideaway': {
      const top = state.players[controller].zones.library.slice(0, step.count);
      if (top.length === 0) return { player: controller, options: [], min: 0, max: 0, prompt: '', mode: 'cards', autoAnswer: 'skip' };
      return { player: controller, options: top, min: 1, max: 1, prompt: `${ctx.sourceName}: esconderijo — escolha a carta a exilar virada para baixo (as outras vão para o fundo)`, mode: 'cards' };
    }
    case 'cipherEncode': {
      const options = state.players[controller].zones.battlefield
        .map((id) => state.objects[id])
        .filter((o) => isCreature(o))
        .map((o) => o.id);
      if (options.length === 0) return { player: controller, options: [], min: 0, max: 0, prompt: '', mode: 'cards', autoAnswer: 'skip' };
      return { player: controller, options, min: 0, max: 1, prompt: `${ctx.sourceName}: cifra — codificar em qual criatura sua? (opcional)`, mode: 'cards' };
    }
    case 'if': {
      // Não é uma escolha: a condição é avaliada e o ramo emendado (mesmo mecanismo do mayDo).
      return { player: controller, options: [], min: 0, max: 0, prompt: '', mode: 'confirm', autoAnswer: condHolds(ctx, step.cond) ? 'yes' : 'no' };
    }
    case 'copyOf': {
      const options = battlefield(state).filter((o) => isCreature(o) && o.id !== ctx.sourceId).map((o) => o.id);
      if (options.length === 0) return { player: controller, options: [], min: 0, max: 0, prompt: '', mode: 'cards', autoAnswer: 'skip' };
      return { player: controller, options, min: 0, max: 1, prompt: `${ctx.sourceName}: entrar como cópia de qual criatura? (opcional)`, mode: 'cards' };
    }
    case 'populate': {
      const options = state.players[controller].zones.battlefield.map((id) => state.objects[id]).filter((o) => o.isToken && isCreature(o)).map((o) => o.id);
      if (options.length === 0) return { player: controller, options: [], min: 0, max: 0, prompt: '', mode: 'cards', autoAnswer: 'skip' };
      if (options.length === 1) return { player: controller, options, min: 1, max: 1, prompt: '', mode: 'cards' };
      return { player: controller, options, min: 1, max: 1, prompt: `${ctx.sourceName}: povoar — copiar qual ficha?`, mode: 'cards' };
    }
    case 'support': {
      const options = battlefield(state).filter((o) => isCreature(o) && o.id !== ctx.sourceId).map((o) => o.id);
      if (options.length === 0) return { player: controller, options: [], min: 0, max: 0, prompt: '', mode: 'cards', autoAnswer: 'skip' };
      return { player: controller, options, min: 0, max: Math.min(step.count, options.length), prompt: `${ctx.sourceName}: apoiar ${step.count} — escolha até ${step.count} outras criaturas`, mode: 'cards' };
    }
    case 'connive': {
      const hand = state.players[controller].zones.hand;
      // Compra antes de escolher o descarte: feito no setup para a mão já incluir a carta comprada.
      draw(state, controller, ctx.emit);
      const after = state.players[controller].zones.hand;
      if (after.length === 0) return { player: controller, options: [], min: 0, max: 0, prompt: '', mode: 'cards', autoAnswer: 'skip' };
      void hand;
      return { player: controller, options: [...after], min: 1, max: 1, prompt: `${ctx.sourceName}: conspirar — descarte uma carta`, mode: 'cards' };
    }
    case 'bounceOwn': {
      const options = state.players[controller].zones.battlefield.map((id) => state.objects[id]).filter((o) => matchFilter({ controller, sourceId: ctx.sourceId, state }, { ...step.filter, controlledBy: undefined }, o)).map((o) => o.id);
      if (options.length === 0) return { player: controller, options: [], min: 0, max: 0, prompt: '', mode: 'cards', autoAnswer: 'skip' };
      return { player: controller, options, min: 1, max: 1, prompt: `${ctx.sourceName}: devolva uma permanente sua para a mão`, mode: 'cards' };
    }
    case 'learn': {
      const hand = state.players[controller].zones.hand;
      if (hand.length === 0) return { player: controller, options: [], min: 0, max: 0, prompt: '', mode: 'cards', autoAnswer: 'skip' };
      return { player: controller, options: [...hand], min: 0, max: 1, prompt: `${ctx.sourceName}: aprender — descarte uma carta para comprar uma (opcional)`, mode: 'cards' };
    }
    case 'putFromHand': {
      const who = step.who === 'opponent' ? opponentOf(controller) : controller;
      const src = state.objects[ctx.sourceId];
      const filter = step.filter.cmcEqualsCountersOn ? { ...step.filter, cmcEqualsCountersOn: undefined, cmcEquals: src?.counters[step.filter.cmcEqualsCountersOn] ?? 0 } : step.filter;
      const options = state.players[who].zones.hand.filter((id) => cardMatchesFilter(state.objects[id].card, filter));
      if (options.length === 0) return { player: who, options: [], min: 0, max: 0, prompt: '', mode: 'cards', autoAnswer: 'skip' };
      return { player: who, options, min: 0, max: 1, prompt: `${ctx.sourceName}: coloque uma carta da mão no campo de batalha (opcional)`, mode: 'cards' };
    }
    case 'addManaChoice': {
      if (ctx.chosenMana) return { player: controller, options: [], min: 0, max: 0, prompt: '', mode: 'confirm', autoAnswer: 'yes' };
      return { player: controller, options: [], min: 0, max: 0, prompt: `${ctx.sourceName}: escolha a cor da mana`, mode: 'chooseColor' };
    }
    case 'revealTopByType': {
      const top = state.players[controller].zones.library.slice(0, step.count);
      const types = new Set(top.flatMap((id) => state.objects[id].card.types));
      if (top.length === 0) return { player: controller, options: [], min: 0, max: 0, prompt: '', mode: 'cards', autoAnswer: 'skip' };
      return { player: controller, options: top, min: 0, max: types.size, prompt: `${ctx.sourceName}: revele ${top.length} do topo — escolha até uma carta de cada tipo para a mão (o resto vai para o fundo)`, mode: 'cards' };
    }
    case 'returnFromExileToHand': {
      const options = state.players[controller].zones.exile.filter((id) => state.objects[id].owner === controller && cardMatchesFilter(state.objects[id].card, step.filter));
      if (options.length === 0) return { player: controller, options: [], min: 0, max: 0, prompt: '', mode: 'cards', autoAnswer: 'skip' };
      return { player: controller, options, min: 0, max: 1, prompt: `${ctx.sourceName}: escolha uma carta sua no exílio para a mão`, mode: 'cards' };
    }
    case 'imprintFromHand': {
      const options = state.players[controller].zones.hand.filter((id) => cardMatchesFilter(state.objects[id].card, step.filter));
      if (options.length === 0) return { player: controller, options: [], min: 0, max: 0, prompt: '', mode: 'cards', autoAnswer: 'skip' };
      return { player: controller, options, min: 0, max: 1, prompt: `${ctx.sourceName}: exile uma carta da mão (imprint)`, mode: 'cards' };
    }
    case 'discardOrDie': {
      const options = state.players[controller].zones.hand.filter((id) => cardMatchesFilter(state.objects[id].card, step.filter));
      return { player: controller, options, min: 0, max: 1, prompt: `${ctx.sourceName}: descarte uma carta de terreno, ou ${ctx.sourceName} vai para o cemitério`, mode: 'cards' };
    }
    case 'putHandOnTop': {
      const options = [...state.players[controller].zones.hand];
      const n = Math.min(step.count, options.length);
      return { player: controller, options, min: n, max: n, prompt: `${ctx.sourceName}: escolha ${step.count} carta(s) da mão para o topo da biblioteca (a primeira fica no topo)`, mode: 'cards' };
    }
    case 'digTop': {
      const top = state.players[controller].zones.library.slice(0, step.count);
      const options = top.filter((id) => cardMatchesFilter(state.objects[id].card, step.filter));
      if (top.length === 0) return { player: controller, options: [], min: 0, max: 0, prompt: '', mode: 'cards', autoAnswer: 'skip' };
      return { player: controller, options, min: 0, max: Math.min(step.pick, options.length), prompt: `${ctx.sourceName}: olhe as ${top.length} do topo — escolha até ${step.pick} para ${step.to === 'battlefield' ? 'o campo de batalha' : 'a mão'} (o resto vai para ${step.rest === 'graveyard' ? 'o cemitério' : step.rest === 'top' ? 'o topo' : 'o fundo'})`, mode: 'cards' };
    }
    case 'chooseValue':
      return {
        player: controller,
        options: [],
        min: 0,
        max: 0,
        prompt: step.kind === 'color' ? `${ctx.sourceName}: escolha uma cor` : step.kind === 'cardName' ? `${ctx.sourceName}: escolha o nome de uma carta` : `${ctx.sourceName}: escolha um tipo de criatura`,
        mode: step.kind === 'color' ? 'chooseColor' : step.kind === 'cardName' ? 'nameCard' : 'chooseType',
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
      const payer = step.payer === 'opponent' ? opponentOf(ctx.controller) : ctx.controller;
      if (step.energy !== undefined) {
        const p = state.players[payer];
        if (p.energy < step.energy) return false;
        p.energy -= step.energy;
        emit({ type: 'energyChanged', player: payer, delta: -step.energy, total: p.energy });
        return true;
      }
      const paid = payNow(state, payer, payOrElseCost(ctx, step), emit);
      if (paid) emit({ type: 'fizzled', description: `${state.players[payer].name} pagou ${payOrElseCost(ctx, step)} por ${ctx.sourceName}` });
      return paid;
    }
    case 'explore': {
      const [t] = resolveSubject(ctx, step.what);
      const explorer = t?.kind === 'object' ? state.objects[t.id] : undefined;
      const who = explorer?.controller ?? ctx.controller;
      const top = state.players[who].zones.library[0];
      if (top === undefined) return;
      const card = state.objects[top];
      if (card.card.types.includes('Land')) {
        moveWithEvent(state, card, 'hand', 'searched', emit);
        emit({ type: 'explored', player: who, cardName: ctx.sourceName, revealed: card.card.name, toHand: true });
        return;
      }
      if (explorer && explorer.zone === 'battlefield') {
        const total = (explorer.counters['+1/+1'] ?? 0) + 1;
        explorer.counters['+1/+1'] = total;
        emit({ type: 'countersChanged', objectId: explorer.id, cardName: explorer.card.name, counter: '+1/+1', delta: 1, total });
      }
      if (text === 'yes') moveWithEvent(state, card, 'graveyard', 'milled', emit);
      emit({ type: 'explored', player: who, cardName: ctx.sourceName, revealed: card.card.name, toHand: false });
      return;
    }
    case 'exploit': {
      const id = picks[0];
      const victim = id !== undefined ? state.objects[id] : undefined;
      if (!victim || victim.zone !== 'battlefield') return;
      moveWithEvent(state, victim, 'graveyard', 'sacrificed', emit);
      emit({ type: 'exploited', objectId: ctx.sourceId, cardName: ctx.sourceName, sacrificed: victim.card.name });
      return;
    }
    case 'hideaway': {
      const top = state.players[ctx.controller].zones.library.slice(0, step.count);
      const pick = picks[0];
      const src = state.objects[ctx.sourceId];
      for (const id of top) {
        const o = state.objects[id];
        if (id === pick) {
          moveWithEvent(state, o, 'exile', 'exiled', emit);
          o.exiledAs = 'hideaway';
          if (src) src.hideawayCard = id;
        } else moveWithEvent(state, o, 'library', 'returned', emit, 'bottom');
      }
      emit({ type: 'hideawayExiled', player: ctx.controller, sourceName: ctx.sourceName });
      return;
    }
    case 'cipherEncode': {
      const id = picks[0];
      const creature = id !== undefined ? state.objects[id] : undefined;
      const spell = state.objects[ctx.sourceId];
      if (!creature || creature.zone !== 'battlefield' || !spell || spell.zone !== 'stack') return;
      moveWithEvent(state, spell, 'exile', 'exiled', emit);
      spell.exiledAs = 'cipher';
      spell.encodedOn = creature.id;
      emit({ type: 'encoded', cardName: spell.card.name, creatureName: creature.card.name });
      return;
    }
    case 'if':
      return text === 'yes'; // ramo emendado em applyEffectChoice
    case 'copyOf': {
      const id = picks[0];
      const src = state.objects[ctx.sourceId];
      if (src) src.copyPending = false;
      const target = id !== undefined ? state.objects[id] : undefined;
      if (!src || !target) return;
      src.originalCard = src.originalCard ?? src.card;
      src.card = { ...target.card, id: `copy-${target.card.id}`, name: target.card.name };
      emit({ type: 'fizzled', description: `${src.originalCard.name} entrou como cópia de ${target.card.name}` });
      return;
    }
    case 'populate': {
      const id = picks[0];
      const tok = id !== undefined ? state.objects[id] : undefined;
      if (!tok) return;
      runStep(ctx, { op: 'tokenCopy', what: 'iter' } as Extract<EffectStep, { op: 'tokenCopy' }>, tok.id);
      return;
    }
    case 'support': {
      for (const id of picks) {
        const o = state.objects[id];
        if (!o || o.zone !== 'battlefield') continue;
        o.counters['+1/+1'] = (o.counters['+1/+1'] ?? 0) + 1;
        emit({ type: 'countersChanged', objectId: o.id, cardName: o.card.name, counter: '+1/+1', delta: 1, total: o.counters['+1/+1'] });
      }
      return;
    }
    case 'connive': {
      const id = picks[0];
      const card = id !== undefined ? state.objects[id] : undefined;
      if (!card || card.zone !== 'hand') return;
      moveWithEvent(state, card, 'graveyard', 'discarded', emit);
      emit({ type: 'discarded', player: ctx.controller, objectId: card.id, cardName: card.card.name });
      if (!card.card.types.includes('Land')) {
        const [t] = resolveSubject(ctx, step.what);
        const who = t?.kind === 'object' ? state.objects[t.id] : undefined;
        if (who && who.zone === 'battlefield') {
          who.counters['+1/+1'] = (who.counters['+1/+1'] ?? 0) + 1;
          emit({ type: 'countersChanged', objectId: who.id, cardName: who.card.name, counter: '+1/+1', delta: 1, total: who.counters['+1/+1'] });
        }
      }
      return;
    }
    case 'bounceOwn': {
      const o = picks[0] !== undefined ? state.objects[picks[0]] : undefined;
      if (o && o.zone === 'battlefield') moveWithEvent(state, o, 'hand', 'returned', emit);
      return;
    }
    case 'learn': {
      const o = picks[0] !== undefined ? state.objects[picks[0]] : undefined;
      if (!o || o.zone !== 'hand') return;
      moveWithEvent(state, o, 'graveyard', 'discarded', emit);
      emit({ type: 'discarded', player: ctx.controller, objectId: o.id, cardName: o.card.name });
      draw(state, ctx.controller, emit);
      return;
    }
    case 'putFromHand': {
      const o = picks[0] !== undefined ? state.objects[picks[0]] : undefined;
      if (!o || o.zone !== 'hand') return;
      o.controller = step.who === 'opponent' ? opponentOf(ctx.controller) : ctx.controller;
      moveWithEvent(state, o, 'battlefield', 'resolved', emit);
      if (step.tapped) setTapped(state, o, true, emit);
      return;
    }
    case 'addManaChoice': {
      const sym = (ctx.chosenMana ?? text) as import('./types.js').ManaSymbol | undefined;
      if (!sym || !['W', 'U', 'B', 'R', 'G', 'C'].includes(sym)) return;
      const count = step.count ?? 1;
      for (const p of resolvePlayers(step.who, ctx.controller)) {
        state.players[p].manaPool[sym] += count;
        emit({ type: 'manaAdded', player: p, mana: Array(count).fill(sym), sourceName: ctx.sourceName });
      }
      return;
    }
    case 'revealTopByType': {
      const top = state.players[ctx.controller].zones.library.slice(0, step.count);
      const used = new Set<string>();
      const keep: number[] = [];
      for (const id of picks) {
        const o = state.objects[id];
        if (!o || !top.includes(id)) continue;
        const t = o.card.types.find((x) => !used.has(x));
        if (!t) continue;
        used.add(t);
        keep.push(id);
      }
      for (const id of keep) moveWithEvent(state, state.objects[id], 'hand', 'returned', emit);
      const rest = top.filter((id) => !keep.includes(id));
      const r = shuffle(rest, state.rngState);
      state.rngState = r.state;
      for (const id of r.items) moveWithEvent(state, state.objects[id], 'library', 'returned', emit, 'bottom');
      emit({ type: 'fizzled', description: `${ctx.sourceName}: ${keep.map((id) => state.objects[id].card.name).join(', ') || 'nada'} para a mão; ${rest.length} para o fundo` });
      return;
    }
    case 'returnFromExileToHand': {
      const o = picks[0] !== undefined ? state.objects[picks[0]] : undefined;
      if (!o || o.zone !== 'exile' || o.owner !== ctx.controller) return;
      moveWithEvent(state, o, 'hand', 'returned', emit);
      return;
    }
    case 'imprintFromHand': {
      const o = picks[0] !== undefined ? state.objects[picks[0]] : undefined;
      const src = state.objects[ctx.sourceId];
      if (!o || o.zone !== 'hand' || !src) return;
      moveWithEvent(state, o, 'exile', 'exiled', emit);
      src.imprintedId = o.id;
      emit({ type: 'fizzled', description: `${ctx.sourceName} exila ${o.card.name} (imprint)` });
      return;
    }
    case 'discardOrDie': {
      const src = state.objects[ctx.sourceId];
      const o = picks[0] !== undefined ? state.objects[picks[0]] : undefined;
      if (o && o.zone === 'hand') {
        moveWithEvent(state, o, 'graveyard', 'discarded', emit);
        emit({ type: 'discarded', player: ctx.controller, objectId: o.id, cardName: o.card.name });
        return;
      }
      if (src && src.zone === 'battlefield') moveWithEvent(state, src, 'graveyard', 'resolved', emit);
      return;
    }
    case 'putHandOnTop': {
      const chosen = picks.filter((id) => state.objects[id]?.zone === 'hand' && state.objects[id].owner === ctx.controller);
      for (const id of [...chosen].reverse()) moveWithEvent(state, state.objects[id], 'library', 'returned', emit, 'top');
      emit({ type: 'fizzled', description: `${ctx.sourceName}: ${chosen.length} carta(s) da mão foram para o topo da biblioteca` });
      return;
    }
    case 'digTop': {
      const top = state.players[ctx.controller].zones.library.slice(0, step.count);
      const chosen = new Set(picks);
      const rest: number[] = [];
      for (const id of top) {
        const o = state.objects[id];
        if (chosen.has(id)) moveWithEvent(state, o, step.to ?? 'hand', 'searched', emit);
        else rest.push(id);
      }
      for (const id of rest) {
        const o = state.objects[id];
        if (step.rest === 'graveyard') moveWithEvent(state, o, 'graveyard', 'milled', emit);
        else if (step.rest === 'bottom') moveWithEvent(state, o, 'library', 'returned', emit, 'bottom');
      }
      return;
    }
    case 'chooseValue': {
      const src = state.objects[ctx.sourceId];
      if (!src || !text) return;
      if (step.kind === 'color') src.chosenColor = text as import('./types.js').Color;
      else if (step.kind === 'cardName') src.chosenName = text.trim();
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
      const scryer = step.who ? resolveWho(ctx, step.who)[0] ?? ctx.controller : ctx.controller;
      const library = state.players[scryer].zones.library;
      for (const id of picks) {
        const i = library.indexOf(id);
        if (i >= 0) {
          library.splice(i, 1);
          library.push(id);
        }
      }
      emit({ type: 'scried', player: scryer, looked: Math.min(step.count === 'X' ? ctx.xValue ?? 0 : step.count, library.length), bottomed: picks.length });
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
        if (step.to === 'battlefield' && step.withCounters) {
          const { counter, count } = step.withCounters;
          obj.counters[counter] = (obj.counters[counter] ?? 0) + count;
          emit({ type: 'countersChanged', objectId: obj.id, cardName: obj.card.name, counter, delta: count, total: obj.counters[counter] });
        }
      }
      emit({ type: 'searched', player: ctx.controller, found, to: step.to });
      const r = shuffle(state.players[ctx.controller].zones.library, state.rngState);
      state.players[ctx.controller].zones.library = r.items;
      state.rngState = r.state;
      if (toTop.length > 0) state.players[ctx.controller].zones.library.unshift(...toTop);
      emit({ type: 'shuffled', player: ctx.controller });
      return;
    }
    case 'doomsday': {
      const me = ctx.controller;
      const keep = picks.filter((id) => { const o = state.objects[id]; return !!o && (o.zone === 'library' || o.zone === 'graveyard') && o.owner === me; });
      const rest = [...state.players[me].zones.library, ...state.players[me].zones.graveyard].filter((id) => !keep.includes(id));
      for (const id of rest) moveWithEvent(state, state.objects[id], 'exile', 'exiled', emit);
      for (const id of keep) { const o = state.objects[id]; if (o.zone === 'graveyard') moveWithEvent(state, o, 'library', 'returned', emit, 'top'); }
      const lib = state.players[me].zones.library;
      state.players[me].zones.library = [...keep.filter((id) => lib.includes(id)), ...lib.filter((id) => !keep.includes(id))];
      emit({ type: 'searched', player: me, found: keep.map((id) => state.objects[id].card.name), to: 'libraryTop' });
      return;
    }
  }
}

/**
 * Handle a choice step inline: auto-resolve forced/empty choices, otherwise
 * pause the script by setting state.pendingDecision.
 */
/** Branch chosen by a yes/no step ("you may", "pay or else", "if"). */
function branchOf(step: ChoiceStep, outcome: boolean | void, text: string | undefined): EffectStep[] {
  if (step.op === 'mayDo') return text === 'yes' ? step.effect : step.else ?? [];
  if (step.op === 'payOrElse') return outcome === true ? step.then ?? [] : step.else;
  if (step.op === 'if') return outcome === true ? step.then : step.else ?? [];
  return [];
}

/** 'done' | 'paused' | a branch to splice in front of the remaining script (auto-answered yes/no steps). */
function beginChoice(ctx: EffectContext, step: ChoiceStep, remaining: EffectStep[]): 'done' | 'paused' | EffectStep[] {
  const setup = setupChoice(ctx, step);
  if (setup.mode === 'confirm') {
    if (setup.autoAnswer === 'skip') return 'done';
    if (setup.autoAnswer) {
      const outcome = executeChoice(ctx, step, [], setup.autoAnswer);
      return branchOf(step, outcome, setup.autoAnswer);
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
      subjectId: ctx.subjectId,
      subjectPlayer: ctx.subjectPlayer,
      triggerAmount: ctx.triggerAmount,
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
    subjectId: pending.resume.subjectId,
    subjectPlayer: pending.resume.subjectPlayer,
    triggerAmount: pending.resume.triggerAmount,
    emit,
  };
  state.pendingDecision = null;
  const current = pending.resume.current as ChoiceStep;
  const outcome = executeChoice(ctx, current, picks, text);
  // "You may …" / "pay or else": o ramo escolhido roda antes do resto do
  // script (pausas aninhadas continuam funcionando: vira um único script).
  const branch = branchOf(current, outcome, text);
  const result = runEffectScript(ctx, [...branch, ...pending.resume.remaining]);
  if (result === 'paused') {
    const next = state.pendingDecision as PendingDecision | null;
    if (next?.type === 'effectChoice') {
      next.resume.finishSpellId = pending.resume.finishSpellId;
      next.resume.finishSpellExile = pending.resume.finishSpellExile;
      next.resume.finishSpellAdventure = pending.resume.finishSpellAdventure;
    }
    return 'paused';
  }
  const spellId = pending.resume.finishSpellId;
  if (spellId !== null) {
    const spell = state.objects[spellId];
    if (spell && spell.zone === 'stack')
      moveWithEvent(state, spell, pending.resume.finishSpellExile || pending.resume.finishSpellAdventure ? 'exile' : 'graveyard', 'resolved', emit);
      if (pending.resume.finishSpellAdventure) spell.exiledAs = 'adventure';
  }
  return 'done';
}

// ------------------------------------------------------------ interpreter

export function runEffectScript(ctx: EffectContext, script: EffectScript): 'done' | 'paused' {
  let queue = [...script];
  let guard = 0;
  while (queue.length > 0) {
    if (++guard > 10000) throw new Error('runEffectScript travou (bug na engine)');
    const step = queue.shift()!;
    if (isChoiceStep(step)) {
      const r = beginChoice(ctx, step, queue);
      if (r === 'paused') return 'paused';
      if (Array.isArray(r)) queue = [...r, ...queue];
      continue;
    }
    runStep(ctx, step);
  }
  return 'done';
}

function runStep(ctx: EffectContext, step: Exclude<EffectStep, ChoiceStep>, iterId?: number): void {
  const { state, emit } = ctx;
  if (iterId !== undefined) ctx = { ...ctx, iterId };
  switch (step.op) {
    case 'forEach': {
      const objs = selectBattlefield(ctx, step.filter);
      for (const o of objs) {
        if (o.zone !== 'battlefield') continue;
        for (const st of step.effect) {
          if (isChoiceStep(st)) continue; // escolhas dentro de forEach não são suportadas
          runStep(ctx, st, o.id);
        }
      }
      return;
    }
    case 'preventNext': {
      const n = resolveAmount(ctx, step.amount);
      for (const t of resolveSubject(ctx, step.what)) {
        if (t.kind === 'player') state.players[t.player].preventNext = (state.players[t.player].preventNext ?? 0) + n;
        else { const o = state.objects[t.id]; if (o) o.preventNext = (o.preventNext ?? 0) + n; }
      }
      return;
    }
    case 'preventAllTo':
      for (const t of resolveSubject(ctx, step.what)) {
        if (t.kind === 'player') state.players[t.player].preventAllThisTurn = true;
        else { const o = state.objects[t.id]; if (o) o.preventAllThisTurn = true; }
      }
      return;
    case 'delayedEffect':
      state.delayed.push({ at: step.at, player: step.at === 'nextUpkeep' ? ctx.controller : undefined, objectId: ctx.sourceId, action: 'effect', effect: step.effect, controller: ctx.controller, targets: [...ctx.targets] });
      return;
    case 'proliferate':
      for (const id of state.players[ctx.controller].zones.battlefield) {
        const o = state.objects[id];
        for (const [counter, n] of Object.entries(o.counters)) {
          if (n <= 0 || counter.startsWith('__')) continue;
          o.counters[counter] = n + 1;
          emit({ type: 'countersChanged', objectId: o.id, cardName: o.card.name, counter, delta: 1, total: n + 1 });
        }
      }
      return;
    case 'bolster': {
      const mine = state.players[ctx.controller].zones.battlefield.map((id) => state.objects[id]).filter(isCreature);
      if (mine.length === 0) return;
      const weakest = mine.reduce((a, b) => (effectiveToughness(state, b) < effectiveToughness(state, a) ? b : a));
      weakest.counters['+1/+1'] = (weakest.counters['+1/+1'] ?? 0) + step.count;
      emit({ type: 'countersChanged', objectId: weakest.id, cardName: weakest.card.name, counter: '+1/+1', delta: step.count, total: weakest.counters['+1/+1'] });
      return;
    }
    case 'amass': {
      const sub = step.subtype ?? 'Zombie';
      let army = state.players[ctx.controller].zones.battlefield.map((id) => state.objects[id]).find((o) => o.card.subtypes.includes('Army'));
      if (!army) {
        army = createObject(state, { id: 'token-army', name: 'Army', types: ['Creature'], subtypes: [sub, 'Army'], colors: ['B'], power: 0, toughness: 0, automation: 'full' }, ctx.controller);
        army.isToken = true;
        army.zone = 'battlefield';
        army.summoningSick = true;
        state.players[ctx.controller].zones.battlefield.push(army.id);
        emit({ type: 'tokenCreated', player: ctx.controller, objectId: army.id, name: 'Army' });
      }
      army.counters['+1/+1'] = (army.counters['+1/+1'] ?? 0) + step.count;
      emit({ type: 'countersChanged', objectId: army.id, cardName: army.card.name, counter: '+1/+1', delta: step.count, total: army.counters['+1/+1'] });
      return;
    }
    case 'blink':
      for (const t of resolveSubject(ctx, step.what)) {
        const o = t.kind === 'object' ? state.objects[t.id] : undefined;
        if (!o || o.zone !== 'battlefield' || o.isToken) continue;
        moveWithEvent(state, o, 'exile', 'exiled', emit);
        o.controller = o.owner;
        moveWithEvent(state, o, 'battlefield', 'returned', emit);
      }
      return;
    case 'exileTopSelf':
      for (let i = 0; i < step.count; i++) {
        const top = state.players[ctx.controller].zones.library[0];
        if (top === undefined) break;
        moveWithEvent(state, state.objects[top], 'exile', 'exiled', emit);
      }
      return;
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
        if (t.kind === 'player') dealDamageToPlayer(state, t.player, amount, ctx.sourceName, emit, { infect: src?.infect, toxic: src?.toxic, sourceId: ctx.sourceId });
        else {
          const obj = objectAlive(state, t);
          if (obj && obj.zone === 'battlefield') {
            if (step.exileIfDies) obj.exileIfDiesThisTurn = true;
            dealDamageToObject(state, obj, amount, ctx.sourceName, emit, { sourceColors: sourceColors(ctx), infect: src?.infect, wither: src?.wither, sourceId: ctx.sourceId });
          }
        }
      }
      return;
    }

    case 'poison':
      for (const p of resolveWho(ctx, step.who)) addPoison(state, p, step.count, emit);
      return;

    case 'tokenCopy': {
      const [ref] = step.what ? resolveSubject(ctx, step.what) : [{ kind: 'object', id: ctx.sourceId } as TargetChoice];
      const src = ref?.kind === 'object' ? state.objects[ref.id] : undefined;
      if (!src) return;
      const base = src.card;
      const def: import('./cards/types.js').CardDefinition = {
        ...base,
        id: `token-copy-${base.id}`,
        colors: step.colors ?? base.colors,
        subtypes: step.addSubtype && !base.subtypes.includes(step.addSubtype) ? [...base.subtypes, step.addSubtype] : base.subtypes,
        power: step.power ?? base.power,
        toughness: step.toughness ?? base.toughness,
        keywords: step.keywords ? [...(base.keywords ?? []), ...step.keywords] : base.keywords,
        manaCost: undefined,
      };
      for (let i = 0; i < (step.count ?? 1) * tokenMultiplier(state, ctx.controller); i++) {
        const tok = createObject(state, def, ctx.controller);
        tok.isToken = true;
        tok.zone = 'battlefield';
        tok.summoningSick = true;
        state.players[ctx.controller].zones.battlefield.push(tok.id);
        if (step.attacking) { tok.attacking = true; tok.tapped = !hasKeyword(state, tok, 'vigilance'); }
        if (step.sacrificeAtEnd) state.delayed.push({ at: 'endStep', objectId: tok.id, action: 'sacrifice' });
        if (step.exileAtEnd) state.delayed.push({ at: 'endStep', objectId: tok.id, action: 'exile' });
        emit({ type: 'tokenCreated', player: ctx.controller, objectId: tok.id, name: `${base.name} (cópia)` });
      }
      return;
    }

    case 'unearth': {
      const src = state.objects[ctx.sourceId];
      if (!src || src.zone !== 'graveyard') return;
      src.controller = ctx.controller;
      moveWithEvent(state, src, 'battlefield', 'returned', emit);
      src.untilEot.keywords.push('haste');
      src.unearthed = true;
      state.delayed.push({ at: 'endStep', objectId: src.id, action: 'exile' });
      return;
    }

    case 'putPowerCounters': {
      const src = state.objects[ctx.sourceId];
      const n = Math.max(0, src?.card.power ?? 0);
      for (const t of resolveSubject(ctx, step.what)) {
        const obj = objectAlive(state, t);
        if (obj && obj.zone === 'battlefield' && n > 0) {
          const total = (obj.counters['+1/+1'] ?? 0) + n;
          obj.counters['+1/+1'] = total;
          emit({ type: 'countersChanged', objectId: obj.id, cardName: obj.card.name, counter: '+1/+1', delta: n, total });
        }
      }
      return;
    }

    case 'delayed':
      state.delayed.push({ at: step.at, objectId: ctx.sourceId, action: step.action });
      return;

    case 'castSelfForCost': {
      const src = state.objects[ctx.sourceId];
      if (!src || src.zone !== 'exile') return;
      if (!payNow(state, ctx.controller, step.cost, emit)) {
        moveWithEvent(state, src, 'graveyard', 'discarded', emit);
        return;
      }
      castCardFree(state, src, ctx.controller, emit, 'madness');
      return;
    }

    case 'selfToGraveyard': {
      const src = state.objects[ctx.sourceId];
      if (src && src.zone === 'exile') { src.exiledAs = undefined; moveWithEvent(state, src, 'graveyard', 'discarded', emit); }
      return;
    }

    case 'exileFromHandForLater': {
      const src = state.objects[ctx.sourceId];
      if (!src || src.zone !== 'hand') return;
      moveWithEvent(state, src, 'exile', 'exiled', emit);
      src.exiledAs = step.mode;
      src.exiledOnTurn = state.turn;
      return;
    }

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
        if (obj && (obj.zone === 'battlefield' || obj.zone === 'graveyard')) {
          moveWithEvent(state, obj, 'exile', 'exiled', emit);
          if ((obj.zone as string) === 'exile') obj.exiledBy = ctx.sourceId;
        }
      }
      return;

    case 'transform':
      for (const t of resolveSubject(ctx, step.what)) {
        const obj = objectAlive(state, t);
        if (obj && obj.zone === 'battlefield') transformObject(state, obj, emit);
      }
      return;

    case 'returnTransformed':
      for (const t of resolveSubject(ctx, step.what)) {
        const obj = objectAlive(state, t);
        if (!obj || obj.zone !== 'battlefield' || !obj.baseCard?.backFace) continue;
        moveWithEvent(state, obj, 'exile', 'exiled', emit);
        if ((obj.zone as string) !== 'exile') continue;
        obj.card = obj.baseCard.backFace;
        obj.transformed = true;
        moveWithEvent(state, obj, 'battlefield', 'returned', emit);
        emit({ type: 'transformed', objectId: obj.id, cardName: obj.card.name, back: true });
      }
      return;

    case 'unprepare': {
      const src = state.objects[ctx.sourceId];
      if (src) src.prepared = false;
      return;
    }

    case 'lookAtTop': {
      const who = choicePlayer(ctx, step.who);
      const top = state.players[who].zones.library.slice(0, step.count).map((id) => state.objects[id].card.name);
      emit({ type: 'fizzled', description: `${ctx.sourceName}: ${state.players[ctx.controller].name} olhou o topo da biblioteca de ${state.players[who].name} (${top.join(', ') || 'vazia'})` });
      return;
    }
    case 'lookRandomHand': {
      const who = choicePlayer(ctx, step.who);
      const hand = state.players[who].zones.hand;
      if (hand.length === 0) return;
      const r = shuffle([...hand], state.rngState);
      state.rngState = r.state;
      emit({ type: 'fizzled', description: `${ctx.sourceName}: ${state.players[ctx.controller].name} olhou uma carta aleatória da mão de ${state.players[who].name} (${state.objects[r.items[0]].card.name})` });
      return;
    }
    case 'extraTurn':
      for (const p of resolvePlayers(step.who, ctx.controller)) { (state.extraTurns ??= []).push(p); emit({ type: 'fizzled', description: `${state.players[p].name} joga um turno extra depois deste` }); }
      return;
    case 'shuffleSelfIntoLibrary': {
      const src = state.objects[ctx.sourceId];
      if (!src || src.isToken) return;
      moveWithEvent(state, src, 'library', 'returned', emit, 'bottom');
      const r = shuffle(state.players[src.owner].zones.library, state.rngState);
      state.players[src.owner].zones.library = r.items;
      state.rngState = r.state;
      emit({ type: 'shuffled', player: src.owner });
      return;
    }
    case 'playerProtection':
      for (const p of resolvePlayers(step.who, ctx.controller)) {
        state.players[p].protectedUntilTurn = state.turn + (state.activePlayer === p ? 2 : 1);
        emit({ type: 'fizzled', description: `${state.players[p].name} tem proteção contra tudo até o próximo turno` });
      }
      return;

    case 'castFromGraveyardThisTurn':
      state.players[ctx.controller].graveyardCastPermission = { filter: step.filter, untilTurn: state.turn, exileInstantSorcery: step.exileInstantSorcery };
      emit({ type: 'fizzled', description: `${state.players[ctx.controller].name} pode conjurar uma carta do cemitério neste turno` });
      return;
    case 'attackersPenaltyUntilNextTurn':
      state.players[ctx.controller].attackersPenalty = { untilTurn: state.turn + (state.activePlayer === ctx.controller ? 2 : 1), power: step.power };
      return;
    case 'noMaxHandSizeEmblem':
      for (const p of resolvePlayers(step.who, ctx.controller)) { state.players[p].noMaxHandSize = true; emit({ type: 'fizzled', description: `${state.players[p].name} recebe um emblema: sem tamanho máximo de mão` }); }
      return;
    case 'animateArtifactUntilNextTurn':
      for (const t of resolveSubject(ctx, step.what)) {
        const obj = objectAlive(state, t);
        if (!obj || obj.zone !== 'battlefield') continue;
        (obj.untilNextTurn ??= []).push({ player: ctx.controller, power: 0, toughness: 0, keywords: [], becomesCreature: true });
        emit({ type: 'fizzled', description: `${obj.card.name} vira uma criatura artefato ${manaValueOf(obj.card.manaCost)}/${manaValueOf(obj.card.manaCost)} até o seu próximo turno` });
      }
      return;
    case 'shallowGrave': {
      const gy = state.players[ctx.controller].zones.graveyard;
      const top = [...gy].reverse().map((id) => state.objects[id]).find((o) => o.card.types.includes('Creature'));
      if (!top) return;
      top.controller = ctx.controller;
      moveWithEvent(state, top, 'battlefield', 'returned', emit);
      if (top.zone === 'battlefield') {
        top.untilEot.keywords.push('haste');
        state.delayed.push({ at: 'endStep', objectId: top.id, action: 'exile' });
      }
      return;
    }
    case 'sacrificeObject':
      for (const t of resolveSubject(ctx, step.what)) {
        const obj = objectAlive(state, t);
        if (obj && obj.zone === 'battlefield') moveWithEvent(state, obj, 'graveyard', 'sacrificed', emit);
      }
      return;

    case 'grantAbility':
      for (const t of resolveSubject(ctx, step.what)) {
        const obj = objectAlive(state, t);
        if (!obj || obj.zone !== 'battlefield') continue;
        if (!obj.printedCard) obj.printedCard = obj.card;
        obj.card = { ...obj.card, abilities: [...(obj.card.abilities ?? []), ...step.abilities], keywords: [...(obj.card.keywords ?? []), ...(step.keywords ?? [])] };
        emit({ type: 'fizzled', description: `${obj.card.name} ganha: ${[...step.abilities.map((a) => a.text), ...(step.keywords ?? [])].join('; ')}` });
      }
      return;

    case 'pairSoulbond': {
      const src = state.objects[ctx.sourceId];
      if (!src || src.zone !== 'battlefield' || src.pairedWith !== undefined) return;
      const partner = state.players[src.controller].zones.battlefield.map((id) => state.objects[id]).find((o) => o.id !== src.id && isCreature(o) && o.pairedWith === undefined);
      if (!partner) return;
      src.pairedWith = partner.id;
      partner.pairedWith = src.id;
      emit({ type: 'fizzled', description: `${src.card.name} forma par com ${partner.card.name} (soulbond)` });
      return;
    }

    case 'returnExiledBy': {
      for (const o of Object.values(state.objects)) {
        if (o.zone !== 'exile' || o.exiledBy !== ctx.sourceId) continue;
        o.exiledBy = undefined;
        o.exiledAs = undefined;
        if (step.to === 'battlefield') { o.controller = o.owner; moveWithEvent(state, o, 'battlefield', 'returned', emit); }
        else moveWithEvent(state, o, 'hand', 'returned', emit);
      }
      return;
    }

    case 'moveAllCounters': {
      const src = state.objects[ctx.sourceId];
      const [t] = resolveSubject(ctx, step.to);
      const to = t?.kind === 'object' ? state.objects[t.id] : undefined;
      if (!src || !to || to.zone !== 'battlefield') return;
      const counters = src.zone === 'battlefield' ? src.counters : src.lastCounters ?? {};
      for (const [counter, n] of Object.entries(counters)) {
        if (n <= 0 || counter.startsWith('__')) continue;
        to.counters[counter] = (to.counters[counter] ?? 0) + n;
        emit({ type: 'countersChanged', objectId: to.id, cardName: to.card.name, counter, delta: n, total: to.counters[counter] });
      }
      return;
    }

    case 'putOnLibraryBottom':
      for (const t of resolveSubject(ctx, step.what)) {
        const obj = objectAlive(state, t);
        if (obj && (obj.zone === 'battlefield' || obj.zone === 'graveyard')) moveWithEvent(state, obj, 'library', 'returned', emit, 'bottom');
      }
      return;

    case 'removeCounters': {
      const n = resolveAmount(ctx, step.count);
      for (const t of resolveSubject(ctx, step.what)) {
        const obj = objectAlive(state, t);
        if (!obj || obj.zone !== 'battlefield') continue;
        const have = obj.counters[step.counter] ?? 0;
        const delta = Math.min(have, n);
        if (delta <= 0) continue;
        obj.counters[step.counter] = have - delta;
        emit({ type: 'countersChanged', objectId: obj.id, cardName: obj.card.name, counter: step.counter, delta: -delta, total: have - delta });
      }
      return;
    }

    case 'addManaOptions': {
      const sym = ctx.chosenMana;
      if (!sym) return;
      state.players[ctx.controller].manaPool[sym] += 1;
      emit({ type: 'manaAdded', player: ctx.controller, mana: [sym], sourceName: ctx.sourceName });
      return;
    }

    case 'exileGraveyard':
      for (const p of resolveWho(ctx, step.who))
        for (const id of [...state.players[p].zones.graveyard]) moveWithEvent(state, state.objects[id], 'exile', 'exiled', emit);
      return;

    case 'revealHand':
      for (const p of resolveWho(ctx, step.who))
        emit({ type: 'handRevealed', player: p, cards: state.players[p].zones.hand.map((id) => state.objects[id].card.name) });
      return;

    case 'mustBlockSource':
    case 'cantBlockSource':
      for (const t of resolveSubject(ctx, step.what)) {
        const obj = objectAlive(state, t);
        if (!obj || obj.zone !== 'battlefield') continue;
        if (step.op === 'mustBlockSource') obj.mustBlockId = ctx.sourceId; else obj.cantBlockId = ctx.sourceId;
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
        const obj = t.kind === 'object' ? state.objects[t.id] : null;
        if (obj && (obj.zone === 'graveyard' || obj.zone === 'exile' || obj.zone === 'hand')) {
          // Enters under the effect controller's control (Zombify).
          obj.controller = step.owner ? obj.owner : ctx.controller; // Zombify: yours; Phelia: its owner's
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
        if (t.kind === 'stack') {
          const item = state.stack.find((i) => i.id === t.id);
          if (!item) continue;
          state.stack = state.stack.filter((i) => i !== item);
          emit({ type: 'fizzled', description: `${item.description}: anulada` });
          continue;
        }
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
          const dest = item.flashback || step.exile ? 'exile' : 'graveyard';
          obj.zone = dest;
          state.players[obj.owner].zones[dest].push(obj.id);
        }
        emit({ type: 'spellCountered', objectId: t.id, cardName: item.cardName });
      }
      return;

    case 'pump': {
      const p = step.power + (step.powerDyn ? resolveAmount(ctx, step.powerDyn) : 0);
      const tg = step.toughness + (step.toughnessDyn ? resolveAmount(ctx, step.toughnessDyn) : 0);
      for (const t of resolveSubject(ctx, step.what)) {
        const obj = objectAlive(state, t);
        if (!obj || obj.zone !== 'battlefield') continue;
        if (step.duration === 'yourNextTurn') {
          obj.untilNextTurn = [...(obj.untilNextTurn ?? []), { player: ctx.controller, power: p, toughness: tg, keywords: step.keywords ?? [] }];
          emit({ type: 'pumped', objectId: obj.id, cardName: obj.card.name, power: p, toughness: tg });
        } else applyPump(ctx, obj, p, tg, step.keywords);
      }
      return;
    }

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
      if (!t || t.kind !== 'object' || t.id === source.id) return;
      const host = state.objects[t.id];
      if (!host || host.zone !== 'battlefield') return;
      source.attachedTo = host.id;
      source.attacking = false;
      source.blocking = undefined;
      emit({ type: 'attached', sourceId: source.id, sourceName: source.card.name, hostId: host.id, hostName: host.card.name });
      return;
    }

    case 'unattach': {
      const source = state.objects[ctx.sourceId];
      if (!source || source.attachedTo === undefined) return;
      source.attachedTo = undefined;
      emit({ type: 'fizzled', description: `${source.card.name} foi desanexada` });
      return;
    }

    case 'energy':
      for (const p of resolveWho(ctx, step.who)) {
        const ps = state.players[p];
        ps.energy = Math.max(0, ps.energy + step.amount);
        emit({ type: 'energyChanged', player: p, delta: step.amount, total: ps.energy });
      }
      return;

    case 'exileTop':
      for (const p of resolveWho(ctx, step.who)) {
        for (let i = 0; i < step.count; i++) {
          const top = state.players[p].zones.library[0];
          if (top === undefined) break;
          moveWithEvent(state, state.objects[top], 'exile', 'exiled', emit);
        }
      }
      return;

    case 'moveCounter': {
      const [f] = resolveSubject(ctx, step.from);
      const [t] = resolveSubject(ctx, step.to);
      const from = f?.kind === 'object' ? state.objects[f.id] : undefined;
      const to = t?.kind === 'object' ? state.objects[t.id] : undefined;
      if (!from || !to || from.zone !== 'battlefield' || to.zone !== 'battlefield' || (from.counters[step.counter] ?? 0) <= 0) return;
      from.counters[step.counter] -= 1;
      emit({ type: 'countersChanged', objectId: from.id, cardName: from.card.name, counter: step.counter, delta: -1, total: from.counters[step.counter] });
      to.counters[step.counter] = (to.counters[step.counter] ?? 0) + 1;
      emit({ type: 'countersChanged', objectId: to.id, cardName: to.card.name, counter: step.counter, delta: 1, total: to.counters[step.counter] });
      return;
    }

    case 'addLore': {
      const saga = state.objects[ctx.sourceId];
      if (!saga || saga.zone !== 'battlefield') return;
      const total = (saga.counters['lore'] ?? 0) + step.count;
      saga.counters['lore'] = total;
      emit({ type: 'countersChanged', objectId: saga.id, cardName: saga.card.name, counter: 'lore', delta: step.count, total });
      emit({ type: 'loreAdded', objectId: saga.id, cardName: saga.card.name, total });
      return;
    }

    case 'playHideaway': {
      const src = state.objects[ctx.sourceId];
      const hidden = src?.hideawayCard !== undefined ? state.objects[src.hideawayCard] : undefined;
      if (!hidden || hidden.zone !== 'exile') return;
      if (hidden.card.types.includes('Land')) {
        hidden.exiledAs = undefined;
        moveWithEvent(state, hidden, 'battlefield', 'resolved', emit);
        return;
      }
      castCardFree(state, hidden, ctx.controller, emit, 'esconderijo');
      return;
    }

    case 'hauntExile': {
      const [t] = resolveSubject(ctx, step.what);
      const target = t?.kind === 'object' ? state.objects[t.id] : undefined;
      const src = state.objects[ctx.sourceId];
      if (!src || !target || target.zone !== 'battlefield' || (src.zone !== 'graveyard' && src.zone !== 'battlefield')) return;
      moveWithEvent(state, src, 'exile', 'exiled', emit);
      src.exiledAs = 'haunting';
      src.haunting = target.id;
      emit({ type: 'hauntExiled', cardName: src.card.name, hauntedName: target.card.name });
      return;
    }

    case 'becomeMonarch':
      for (const p of resolveWho(ctx, step.who)) {
        if (state.monarch === p) continue;
        state.monarch = p;
        emit({ type: 'monarchChanged', player: p });
      }
      return;

    case 'takeInitiative':
      for (const p of resolveWho(ctx, step.who)) {
        if (state.initiative !== p) {
          state.initiative = p;
          emit({ type: 'initiativeChanged', player: p });
        }
        emit({ type: 'ventureRequested', player: p, sourceId: ctx.sourceId, dungeon: 'Undercity' });
      }
      return;

    case 'venture':
      emit({ type: 'ventureRequested', player: ctx.controller, sourceId: ctx.sourceId });
      return;

    case 'ventureTo': {
      const ps = state.players[ctx.controller];
      const dungeon = DUNGEONS.find((d) => d.name === step.dungeon);
      const room = dungeon?.rooms[step.room];
      if (!dungeon || !room) return;
      const completed = room.next.length === 0;
      ps.dungeon = completed ? undefined : { name: dungeon.name, room: step.room };
      if (completed) ps.completedDungeons += 1;
      emit({ type: 'ventured', player: ctx.controller, dungeon: dungeon.name, room: room.name, completed, note: room.note });
      return;
    }

    case 'armDredge': {
      const src = state.objects[ctx.sourceId];
      if (!src || src.zone !== 'graveyard') return;
      state.players[ctx.controller].dredgeNext = src.id;
      emit({ type: 'fizzled', description: `${src.card.name}: dragar ${step.count} substituirá a próxima compra de ${state.players[ctx.controller].name}` });
      return;
    }

    case 'impulse': {
      const ps = state.players[ctx.controller];
      for (let i = 0; i < step.count; i++) {
        const top = ps.zones.library[0];
        if (top === undefined) break;
        const o = state.objects[top];
        moveWithEvent(state, o, 'exile', 'exiled', emit);
        o.exiledAs = 'playable';
        o.playableUntilTurn = state.turn;
      }
      return;
    }

    case 'goad': {
      const [t] = resolveSubject(ctx, step.what);
      const obj = t?.kind === 'object' ? objectAlive(state, t) : null;
      if (!obj || obj.zone !== 'battlefield') return;
      // Two players: goaded = must attack on its controller's next turn; "can't attack until your next turn" shares the flag.
      if (obj.controller === ctx.controller) obj.cantAttackUntilTurn = state.turn + 1;
      else obj.goadedUntilTurn = state.turn + 1;
      emit({ type: 'fizzled', description: `${obj.card.name} foi ${obj.controller === ctx.controller ? 'impedida de atacar' : 'provocada'} até o próximo turno de ${state.players[ctx.controller].name}` });
      return;
    }

    case 'damageEach': {
      const amount = resolveAmount(ctx, step.amount);
      const src = state.objects[ctx.sourceId]?.card;
      for (const obj of selectBattlefield(ctx, step.filter))
        dealDamageToObject(state, obj, amount, ctx.sourceName, emit, { sourceColors: sourceColors(ctx), infect: src?.infect, wither: src?.wither, sourceId: ctx.sourceId });
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

    case 'namedToken': {
      const n = resolveAmount(ctx, step.count);
      for (const p of resolveWho(ctx, step.who)) {
        for (let i = 0; i < n * tokenMultiplier(state, p); i++) {
          const obj = createObject(state, NAMED_TOKENS[step.kind], p);
          obj.isToken = true;
          obj.zone = 'battlefield';
          if (step.tapped) obj.tapped = true;
          state.players[p].zones.battlefield.push(obj.id);
          emit({ type: 'tokenCreated', player: p, objectId: obj.id, name: step.kind });
        }
      }
      return;
    }

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
        if (step.untilEndOfCombat) {
          // Firebending: this mana survives step changes until the end of combat.
          const ps = state.players[p];
          ps.stickyPool = ps.stickyPool ?? { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
          for (const sym of step.mana) ps.stickyPool[sym] += 1;
        }
        emit({ type: 'manaAdded', player: p, mana: step.mana, sourceName: ctx.sourceName });
      }
      return;



    case 'token':
      for (const p of resolveWho(ctx, step.who)) {
        const total = resolveAmount(ctx, step.count) * tokenMultiplier(state, p); // fixo antes do laço: as fichas criadas não recontam
        for (let i = 0; i < total; i++) {
          const obj = createObject(state, {
            id: `token-${step.name.toLowerCase().replace(/\s+/g, '-')}`,
            name: step.name,
            types: step.types ?? ['Creature'],
            subtypes: step.subtypes,
            colors: step.colors,
            power: step.power,
            toughness: step.toughness,
            keywords: step.keywords,
            abilities: step.abilities,
            automation: 'full',
          }, p);
          obj.isToken = true;
          obj.zone = 'battlefield';
          obj.summoningSick = true;
          if (step.tapped) obj.tapped = true;
          if (step.attacking && state.activePlayer === p && /declare|combat/i.test(state.step)) obj.attacking = true;
          if (step.sacrificeAtEnd) state.delayed.push({ at: 'endStep', objectId: obj.id, action: 'sacrifice' });
          state.players[p].zones.battlefield.push(obj.id);
          emit({ type: 'tokenCreated', player: p, objectId: obj.id, name: step.name });
          if (step.attachSource) {
            const src = state.objects[ctx.sourceId];
            if (src && src.zone === 'battlefield' && src.controller === p) {
              src.attachedTo = obj.id;
              emit({ type: 'attached', sourceId: src.id, sourceName: src.card.name, hostId: obj.id, hostName: obj.card.name });
            }
          }
        }
      }
      return;
  }
}

/**
 * Put a card on the stack without paying its cost (cascade, suspend, rebound,
 * madness after paying). Only cards that need no targets — a free cast that
 * needs targets stays where it is and is logged.
 */
export function castCardFree(state: GameState, obj: GameObject, controller: PlayerId, emit: Emit, note: string): boolean {
  const card = obj.card;
  if (card.types.includes('Land')) return false;
  const needsTargets = (card.spellTargets?.length ?? 0) > 0 || !!card.enchant || (card.spellModes?.length ?? 0) > 0;
  if (needsTargets) {
    emit({ type: 'fizzled', description: `${card.name}: precisa de alvos — não pode ser conjurada automaticamente (${note})` });
    return false;
  }
  removeFromCurrentZone(state, obj);
  obj.zone = 'stack';
  obj.exiledAs = undefined;
  obj.controller = controller;
  state.stack.push({
    id: state.nextStackId++,
    kind: 'spell',
    sourceId: obj.id,
    controller,
    cardName: card.name,
    effect: card.spellEffect ?? [],
    targets: [],
    description: `${card.name} (${note})`,
  });
  state.spellsCastThisTurn += 1;
  state.passCount = 0;
  emit({ type: 'spellCast', player: controller, objectId: obj.id, cardName: card.name, targets: [] });
  return true;
}

/** "If one or more tokens would be created under your control, twice that many are created instead." */
function tokenMultiplier(state: GameState, player: PlayerId): number {
  return state.players[player].zones.battlefield.some((id) => state.objects[id]?.card.tokenDoubling) ? 2 : 1;
}

/** Artifact tokens with their own abilities (Treasure, Food, Clue, Blood, Powerstone, Map, Gold). */
const NAMED_TOKENS: Record<'Treasure' | 'Food' | 'Clue' | 'Blood' | 'Powerstone' | 'Map' | 'Gold', import('./cards/types.js').CardDefinition> = {
  Blood: {
    id: 'token-blood', name: 'Blood', types: ['Artifact'], subtypes: ['Blood'], colors: [],
    text: '{1}, {T}, Discard a card, Sacrifice this artifact: Draw a card.',
    abilities: [{ kind: 'activated', cost: { mana: '{1}', tap: true, discard: 1, sacrificeSelf: true }, effect: [{ op: 'draw', who: 'controller', count: 1 }], text: '{1}, descartar, sacrificar: compre uma carta' }],
    automation: 'full',
  },
  Powerstone: {
    id: 'token-powerstone', name: 'Powerstone', types: ['Artifact'], subtypes: ['Powerstone'], colors: [],
    text: "{T}: Add {C}. This mana can't be spent to cast a nonartifact spell.",
    abilities: [{ kind: 'activated', cost: { tap: true }, effect: [{ op: 'addMana', who: 'controller', mana: ['C'] }], text: 'Adicionar {C} (só para artefatos/habilidades — não verificado)', isManaAbility: true }],
    automation: 'full',
  },
  Map: {
    id: 'token-map', name: 'Map', types: ['Artifact'], subtypes: ['Map'], colors: [],
    text: '{1}, {T}, Sacrifice this artifact: Target creature you control explores.',
    abilities: [{ kind: 'activated', cost: { mana: '{1}', tap: true, sacrificeSelf: true }, targets: [{ what: 'creature', controlledBy: 'you' }], effect: [{ op: 'explore', what: 'target:0' }], text: '{1}, sacrificar: uma criatura sua explora', sorceryOnly: true }],
    automation: 'full',
  },
  Gold: {
    id: 'token-gold', name: 'Gold', types: ['Artifact'], subtypes: ['Gold'], colors: [],
    text: 'Sacrifice this artifact: Add one mana of any color.',
    abilities: [{ kind: 'activated', cost: { sacrificeSelf: true }, effect: [{ op: 'addManaChoice', who: 'controller' }], text: 'Sacrificar: uma mana de qualquer cor', isManaAbility: true }],
    automation: 'full',
  },
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
  /** X chosen at cast time ("with mana value X or less"). */
  xValue?: number,
): boolean {
  if (choice.kind === 'stack') {
    if (spec.what !== 'stackItem') return false;
    const item = state.stack.find((i) => i.id === choice.id);
    if (!item) return false;
    if (item.kind === 'ability') return (spec.abilityKinds ?? ['activated', 'triggered']).includes(item.activated ? 'activated' : 'triggered');
    if (!spec.allowSpell) return false;
    const card = state.objects[item.sourceId]?.card;
    return !!card && (!spec.allowSpell.colorless || card.colors.length === 0);
  }
  if (spec.what === 'stackItem') return false;
  if (choice.kind === 'player') {
    if (spec.what !== 'player' && spec.what !== 'any') return false;
    // "You have hexproof": opponents can't target you.
    if (choice.player !== controller && state.players[choice.player].zones.battlefield.some((id) => state.objects[id].card.playerHexproof)) return false;
    if ((state.players[choice.player].protectedUntilTurn ?? -1) > state.turn) return false;
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
  if (spec.subtype && !obj.card.subtypes.includes(spec.subtype)) return false;
  if (spec.subtypeAnyOf && !spec.subtypeAnyOf.some((t) => obj.card.subtypes.includes(t))) return false;
  if (spec.notSubtype && obj.card.subtypes.includes(spec.notSubtype)) return false;
  if (spec.cmcAtMost !== undefined && manaValueOf(obj.card.manaCost) > spec.cmcAtMost) return false;
  if (spec.cmcAtLeast !== undefined && manaValueOf(obj.card.manaCost) < spec.cmcAtLeast) return false;
  if (spec.toughnessAtMost !== undefined && effectiveToughness(state, obj) > spec.toughnessAtMost) return false;
  if (spec.color && !obj.card.colors.includes(spec.color)) return false;
  if (spec.notColor && obj.card.colors.includes(spec.notColor)) return false;
  if (spec.token && !obj.isToken) return false;
  if (spec.nontoken && obj.isToken) return false;
  if (spec.untapped && obj.tapped) return false;
  if (spec.legendary && !obj.card.supertypes?.includes('Legendary')) return false;
  if (spec.nonbasic && obj.card.supertypes?.includes('Basic')) return false;
  if (spec.cmcAtMostX && xValue !== undefined && manaValueOf(obj.card.manaCost) > xValue) return false;
  switch (spec.what) {
    case 'any':
      return true;
    case 'creature':
      return requiredZone === 'graveyard' ? obj.card.types.includes('Creature') : isCreature(obj);
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
    if (t.kind === 'stack') return state.stack.some((i) => i.id === t.id);
    const obj = state.objects[t.id];
    return !!obj && (obj.zone === 'battlefield' || obj.zone === 'stack' || obj.zone === 'graveyard' || obj.zone === 'exile');
  });
}
