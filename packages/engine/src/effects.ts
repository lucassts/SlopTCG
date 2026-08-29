/**
 * Interpreter for the declarative effect DSL (Tier 1 automation).
 *
 * Runs when a stack item resolves. Targets were validated at cast time;
 * here they are re-checked ("fizzle" rules: an illegal target is skipped,
 * and a spell whose every target is illegal does nothing).
 */
import type { EffectScript, EffectStep, PlayerSel, SubjectRef, TargetSpec } from './cards/types.js';
import type { GameEvent } from './events.js';
import {
  changeLife,
  dealDamageToObject,
  dealDamageToPlayer,
  draw,
  moveWithEvent,
  setTapped,
  type Emit,
} from './ops.js';
import { createObject, hasKeyword, type GameObject, type GameState, type StackItem } from './state.js';
import { opponentOf, type PlayerId, type TargetChoice } from './types.js';
import { shuffle } from './rng.js';

export interface EffectContext {
  state: GameState;
  controller: PlayerId;
  /** Source object (the spell card or the ability's permanent). */
  sourceId: number;
  sourceName: string;
  targets: TargetChoice[];
  emit: Emit;
}

function resolvePlayers(sel: PlayerSel, controller: PlayerId): PlayerId[] {
  if (sel === 'controller') return [controller];
  if (sel === 'opponent') return [opponentOf(controller)];
  return [controller, opponentOf(controller)];
}

function resolveSubject(ctx: EffectContext, ref: SubjectRef): TargetChoice[] {
  if (ref === 'self') return [{ kind: 'object', id: ctx.sourceId }];
  if (ref === 'controller' || ref === 'opponent' || ref === 'each')
    return resolvePlayers(ref, ctx.controller).map((p) => ({ kind: 'player', player: p }));
  const idx = parseInt(ref.slice('target:'.length), 10);
  const t = ctx.targets[idx];
  return t ? [t] : [];
}

/** A target is still legal if the object is where a target can be hit. */
function objectAlive(state: GameState, t: TargetChoice): GameObject | null {
  if (t.kind !== 'object') return null;
  const obj = state.objects[t.id];
  if (!obj) return null;
  if (obj.zone !== 'battlefield' && obj.zone !== 'stack') return null;
  return obj;
}

export function runEffectScript(ctx: EffectContext, script: EffectScript): void {
  for (const step of script) runStep(ctx, step);
}

function runStep(ctx: EffectContext, step: EffectStep): void {
  const { state, emit } = ctx;
  switch (step.op) {
    case 'draw':
      for (const p of resolvePlayers(step.who, ctx.controller))
        for (let i = 0; i < step.count; i++) draw(state, p, emit);
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
      for (const p of resolvePlayers(step.who, ctx.controller)) {
        for (let i = 0; i < step.count; i++) {
          const top = state.players[p].zones.library[0];
          if (top === undefined) break;
          moveWithEvent(state, state.objects[top], 'graveyard', 'milled', emit);
        }
      }
      return;

    case 'damage':
      for (const t of resolveSubject(ctx, step.to)) {
        if (t.kind === 'player') dealDamageToPlayer(state, t.player, step.amount, ctx.sourceName, emit);
        else {
          const obj = objectAlive(state, t);
          if (obj) dealDamageToObject(state, obj, step.amount, ctx.sourceName, emit);
        }
      }
      return;

    case 'gainLife':
      for (const p of resolvePlayers(step.who, ctx.controller))
        changeLife(state, p, step.amount, ctx.sourceName, emit);
      return;

    case 'loseLife':
      for (const p of resolvePlayers(step.who, ctx.controller))
        changeLife(state, p, -step.amount, ctx.sourceName, emit);
      return;

    case 'destroy':
      for (const t of resolveSubject(ctx, step.what)) {
        const obj = objectAlive(state, t);
        if (obj && obj.zone === 'battlefield') moveWithEvent(state, obj, 'graveyard', 'destroyed', emit);
      }
      return;

    case 'exile':
      for (const t of resolveSubject(ctx, step.what)) {
        const obj = objectAlive(state, t);
        if (obj) moveWithEvent(state, obj, 'exile', 'exiled', emit);
      }
      return;

    case 'returnToHand':
      for (const t of resolveSubject(ctx, step.what)) {
        const obj = objectAlive(state, t);
        if (obj && obj.zone === 'battlefield') moveWithEvent(state, obj, 'hand', 'returned', emit);
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
        state.stack = state.stack.filter((s) => s !== item);
        const obj = state.objects[t.id];
        if (obj) {
          obj.zone = 'graveyard';
          state.players[obj.owner].zones.graveyard.push(obj.id);
        }
        emit({ type: 'spellCountered', objectId: t.id, cardName: item.cardName });
      }
      return;

    case 'pump':
      for (const t of resolveSubject(ctx, step.what)) {
        const obj = objectAlive(state, t);
        if (obj && obj.zone === 'battlefield') {
          obj.untilEot.power += step.power;
          obj.untilEot.toughness += step.toughness;
          emit({ type: 'pumped', objectId: obj.id, cardName: obj.card.name, power: step.power, toughness: step.toughness });
        }
      }
      return;

    case 'attach': {
      const source = state.objects[ctx.sourceId];
      const t = ctx.targets[0];
      if (!source || source.zone !== 'battlefield') return;
      if (!t || t.kind !== 'object') return;
      const host = objectAlive(state, t);
      if (!host || host.zone !== 'battlefield') return;
      source.attachedTo = host.id;
      emit({
        type: 'attached',
        sourceId: source.id,
        sourceName: source.card.name,
        hostId: host.id,
        hostName: host.card.name,
      });
      return;
    }

    case 'addMana':
      for (const p of resolvePlayers(step.who, ctx.controller)) {
        for (const sym of step.mana) state.players[p].manaPool[sym] += 1;
        emit({ type: 'manaAdded', player: p, mana: step.mana, sourceName: ctx.sourceName });
      }
      return;

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

/** Validate a chosen target against its spec at cast/activation time. */
export function targetMatchesSpec(
  state: GameState,
  controller: PlayerId,
  spec: TargetSpec,
  choice: TargetChoice,
): boolean {
  if (spec.what === 'player') return choice.kind === 'player';
  if (choice.kind === 'player') return spec.what === 'any';
  const obj = state.objects[choice.id];
  if (!obj) return false;
  if (spec.what === 'spell') return obj.zone === 'stack';
  if (obj.zone !== 'battlefield') return false;
  if (spec.controlledBy === 'you' && obj.controller !== controller) return false;
  if (spec.controlledBy === 'opponent' && obj.controller === controller) return false;
  switch (spec.what) {
    case 'any':
    case 'creature':
      return spec.what === 'any' ? true : obj.card.types.includes('Creature');
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
    return !!obj && (obj.zone === 'battlefield' || obj.zone === 'stack');
  });
}
