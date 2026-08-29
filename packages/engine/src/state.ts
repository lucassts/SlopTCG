/**
 * GameState and low-level state helpers. Zone arrays hold object ids;
 * library index 0 is the top. Helpers here mutate state but never emit
 * events — that is game.ts / effects.ts territory.
 */
import type { CardDefinition, EffectStep, FilterSpec, PlayerConfig } from './cards/types.js';
import { cardMatchesFilter } from './cards/types.js';
import { shuffle } from './rng.js';
import {
  emptyManaPool,
  type ManaPool,
  type PlayerId,
  type Step,
  type TargetChoice,
  type ZoneName,
  PLAYER_IDS,
} from './types.js';

export interface GameObject {
  id: number;
  card: CardDefinition;
  owner: PlayerId;
  controller: PlayerId;
  zone: ZoneName;
  tapped: boolean;
  damage: number;
  counters: Record<string, number>;
  summoningSick: boolean;
  /** Temporary modifications, reset at cleanup. */
  untilEot: { power: number; toughness: number; keywords: import('./types.js').Keyword[] };
  attacking: boolean;
  /** Attacker object id this creature is blocking, if any. */
  blocking?: number;
  /** Set at blocker declaration; a blocked attacker whose blockers all die
   * still deals no damage to the player (unless it has trample). */
  wasBlocked: boolean;
  /** For auras/equipment on the battlefield: the object they're attached to. */
  attachedTo?: number;
  /** Planeswalkers: one loyalty ability per turn. */
  activatedLoyaltyThisTurn?: boolean;
  /** Attackers: planeswalker being attacked instead of the player. */
  pwTarget?: number;
  isToken: boolean;
}

export interface StackItem {
  id: number;
  /** 'copy' = a spell copy (storm, Twincast): resolves like the spell but no card moves. */
  kind: 'spell' | 'ability' | 'copy';
  /** For spells/copies: the card object. For abilities: the source permanent. */
  sourceId: number;
  controller: PlayerId;
  cardName: string;
  effect: import('./cards/types.js').EffectScript;
  targets: TargetChoice[];
  description: string;
  /** Value chosen for {X} at cast time, if any. */
  xValue?: number;
  /** Power of the creature sacrificed as an additional cost (Fling). */
  sacrificedPower?: number;
  /** Cast via flashback: the card is exiled instead of going to the graveyard. */
  flashback?: boolean;
}

export interface PlayerState {
  id: PlayerId;
  name: string;
  life: number;
  manaPool: ManaPool;
  landsPlayedThisTurn: number;
  zones: Record<Exclude<ZoneName, 'stack'>, number[]>;
}

/** Info needed to resume a paused effect script after a player's choice. */
export interface EffectResume {
  controller: PlayerId;
  sourceId: number;
  sourceName: string;
  targets: TargetChoice[];
  xValue?: number;
  /** The step that asked for the choice. */
  current: EffectStep;
  /** Steps still to run after the current one. */
  remaining: EffectStep[];
  /** Spell card to move to the graveyard once the whole script finishes. */
  finishSpellId: number | null;
  /** Flashback: the finished spell is exiled instead. */
  finishSpellExile?: boolean;
}

/** A triggered ability waiting for its controller to choose targets. */
export interface QueuedTrigger {
  sourceId: number;
  controller: PlayerId;
  cardName: string;
  text: string;
  specs: import('./cards/types.js').TargetSpec[];
  effect: EffectStep[];
}

export type PendingDecision =
  | { type: 'discardToHandSize'; player: PlayerId; count: number }
  | {
      type: 'chooseTargets';
      player: PlayerId;
      sourceId: number;
      cardName: string;
      text: string;
      specs: import('./cards/types.js').TargetSpec[];
      effect: EffectStep[];
    }
  | {
      type: 'effectChoice';
      player: PlayerId;
      prompt: string;
      /** 'cards' → pick objects from options; 'scry' → picks go to the bottom. */
      mode: 'cards' | 'scry';
      options: number[];
      min: number;
      max: number;
      resume: EffectResume;
    };

/** London mulligan bookkeeping, active only before turn 1. */
export interface MulliganState {
  /** Mulligans taken so far (= cards to bottom when keeping). */
  taken: Record<PlayerId, number>;
  /** 'deciding' → may mulligan or keep; 'kept' → waiting for the other player. */
  phase: Record<PlayerId, 'deciding' | 'kept'>;
}

export interface GameState {
  seed: number;
  rngState: number;
  nextId: number;
  objects: Record<number, GameObject>;
  players: Record<PlayerId, PlayerState>;
  turn: number;
  activePlayer: PlayerId;
  priority: PlayerId | null;
  step: Step;
  stack: StackItem[];
  nextStackId: number;
  /** Consecutive priority passes; 2 → resolve top of stack or advance step. */
  passCount: number;
  /** Who plays first (skips the draw on turn 1). */
  onThePlay: PlayerId;
  /** Combat declaration the engine is waiting for, if any. */
  combatAwaiting: 'attackers' | 'blockers' | null;
  pendingDecision: PendingDecision | null;
  /** Targeted triggers waiting to have their targets chosen (FIFO). */
  triggerQueue: QueuedTrigger[];
  /** Spells cast this turn by anyone (storm count). */
  spellsCastThisTurn: number;
  /** Fog effect: combat deals no damage for the rest of this turn. */
  combatDamagePrevented: boolean;
  /** Control changes to undo at cleanup (Act of Treason). */
  controlReverts: { objectId: number; to: PlayerId }[];
  /** Non-null while opening hands are being decided (before turn 1). */
  mulligan: MulliganState | null;
  status: 'playing' | 'finished';
  winner?: PlayerId | 'draw';
}

export const STARTING_LIFE = 20;
export const STARTING_HAND = 7;
export const MAX_HAND_SIZE = 7;

export function createGameState(players: PlayerConfig[], seed: number): GameState {
  const state: GameState = {
    seed,
    rngState: seed,
    nextId: 1,
    objects: {},
    players: {} as Record<PlayerId, PlayerState>,
    turn: 0,
    activePlayer: 'p1',
    priority: null,
    step: 'cleanup', // advanced to turn 1 untap by Game.start()
    stack: [],
    nextStackId: 1,
    passCount: 0,
    onThePlay: 'p1',
    combatAwaiting: null,
    pendingDecision: null,
    triggerQueue: [],
    spellsCastThisTurn: 0,
    combatDamagePrevented: false,
    controlReverts: [],
    mulligan: null,
    status: 'playing',
  };

  for (const cfg of players) {
    const ps: PlayerState = {
      id: cfg.id,
      name: cfg.name,
      life: STARTING_LIFE,
      manaPool: emptyManaPool(),
      landsPlayedThisTurn: 0,
      zones: { library: [], hand: [], battlefield: [], graveyard: [], exile: [] },
    };
    state.players[cfg.id] = ps;
    for (const card of cfg.deck.cards) {
      const obj = createObject(state, card, cfg.id);
      obj.zone = 'library';
      ps.zones.library.push(obj.id);
    }
    const s = shuffle(ps.zones.library, state.rngState);
    ps.zones.library = s.items;
    state.rngState = s.state;
  }
  return state;
}

export function createObject(state: GameState, card: CardDefinition, owner: PlayerId): GameObject {
  const obj: GameObject = {
    id: state.nextId++,
    card,
    owner,
    controller: owner,
    zone: 'library',
    tapped: false,
    damage: 0,
    counters: {},
    summoningSick: false,
    untilEot: { power: 0, toughness: 0, keywords: [] },
    attacking: false,
    wasBlocked: false,
    isToken: false,
  };
  state.objects[obj.id] = obj;
  return obj;
}

export function getObject(state: GameState, id: number): GameObject | undefined {
  return state.objects[id];
}

export function zoneOf(state: GameState, obj: GameObject): number[] {
  if (obj.zone === 'stack') throw new Error('stack items are not in player zones');
  return state.players[obj.zone === 'battlefield' ? obj.controller : obj.owner].zones[obj.zone];
}

/**
 * Move an object between zones (no events). Battlefield state (damage,
 * counters, taps) resets on leaving — a new "object" in rules terms.
 */
export function moveObject(
  state: GameState,
  obj: GameObject,
  to: Exclude<ZoneName, 'stack'>,
  position: 'top' | 'bottom' = 'top',
): void {
  removeFromCurrentZone(state, obj);
  obj.zone = to;
  const target = state.players[to === 'battlefield' ? obj.controller : obj.owner].zones[to];
  if (to === 'library' && position === 'bottom') target.push(obj.id);
  else if (to === 'library') target.unshift(obj.id);
  else target.push(obj.id);
  if (to !== 'battlefield') {
    obj.tapped = false;
    obj.damage = 0;
    obj.counters = {};
    obj.attacking = false;
    obj.blocking = undefined;
    obj.wasBlocked = false;
    obj.attachedTo = undefined;
    obj.untilEot = { power: 0, toughness: 0, keywords: [] };
    obj.summoningSick = false;
  } else {
    obj.summoningSick = obj.card.types.includes('Creature');
  }
}

export function removeFromCurrentZone(state: GameState, obj: GameObject): void {
  if (obj.zone === 'stack') {
    state.stack = state.stack.filter((s) => !(s.kind === 'spell' && s.sourceId === obj.id));
    return;
  }
  const arr = zoneOf(state, obj);
  const i = arr.indexOf(obj.id);
  if (i >= 0) arr.splice(i, 1);
}

/** Auras/equipment on the battlefield attached to `obj`. */
export function attachmentsOf(state: GameState, obj: GameObject): GameObject[] {
  return Object.values(state.objects).filter(
    (o) => o.zone === 'battlefield' && o.attachedTo === obj.id,
  );
}

/**
 * Does a battlefield object match a filter, relative to a source
 * (controller decides 'you'/'opponent'; sourceId decides 'other')?
 */
export function matchFilter(
  ctx: { controller: PlayerId; sourceId: number },
  filter: FilterSpec,
  obj: GameObject,
): boolean {
  if (!cardMatchesFilter(obj.card, filter)) return false;
  if (filter.controlledBy === 'you' && obj.controller !== ctx.controller) return false;
  if (filter.controlledBy === 'opponent' && obj.controller === ctx.controller) return false;
  if (filter.other && obj.id === ctx.sourceId) return false;
  return true;
}

/** Static abilities on the battlefield that currently apply to `obj`. */
function staticsFor(state: GameState, obj: GameObject): { power: number; toughness: number; keywords: import('./types.js').Keyword[] } {
  const total = { power: 0, toughness: 0, keywords: [] as import('./types.js').Keyword[] };
  if (obj.zone !== 'battlefield') return total;
  for (const source of battlefield(state)) {
    for (const ability of source.card.abilities ?? []) {
      if (ability.kind !== 'static') continue;
      if (!matchFilter({ controller: source.controller, sourceId: source.id }, ability.filter, obj)) continue;
      total.power += ability.power ?? 0;
      total.toughness += ability.toughness ?? 0;
      if (ability.keywords) total.keywords.push(...ability.keywords);
    }
  }
  return total;
}

export function effectivePower(state: GameState, obj: GameObject): number {
  const fromAttachments = attachmentsOf(state, obj).reduce(
    (sum, a) => sum + (a.card.attachEffect?.power ?? 0),
    0,
  );
  const counters = (obj.counters['+1/+1'] ?? 0) - (obj.counters['-1/-1'] ?? 0);
  return (obj.card.power ?? 0) + obj.untilEot.power + counters + fromAttachments + staticsFor(state, obj).power;
}

export function effectiveToughness(state: GameState, obj: GameObject): number {
  const fromAttachments = attachmentsOf(state, obj).reduce(
    (sum, a) => sum + (a.card.attachEffect?.toughness ?? 0),
    0,
  );
  const counters = (obj.counters['+1/+1'] ?? 0) - (obj.counters['-1/-1'] ?? 0);
  return (obj.card.toughness ?? 0) + obj.untilEot.toughness + counters + fromAttachments + staticsFor(state, obj).toughness;
}

export function hasKeyword(state: GameState, obj: GameObject, kw: import('./types.js').Keyword): boolean {
  if (obj.card.keywords?.includes(kw)) return true;
  if (obj.untilEot.keywords.includes(kw)) return true;
  if (attachmentsOf(state, obj).some((a) => a.card.attachEffect?.keywords?.includes(kw))) return true;
  return staticsFor(state, obj).keywords.includes(kw);
}

/** True if an attachment forbids this creature from attacking/blocking. */
export function attachmentForbids(state: GameState, obj: GameObject, what: 'cantAttack' | 'cantBlock'): boolean {
  return attachmentsOf(state, obj).some((a) => a.card.attachEffect?.[what]);
}

export function battlefield(state: GameState): GameObject[] {
  return PLAYER_IDS.flatMap((p) => state.players[p].zones.battlefield.map((id) => state.objects[id]));
}

export function creaturesOf(state: GameState, player: PlayerId): GameObject[] {
  return state.players[player].zones.battlefield
    .map((id) => state.objects[id])
    .filter((o) => o.card.types.includes('Creature'));
}
