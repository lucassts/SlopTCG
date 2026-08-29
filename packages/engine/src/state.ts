/**
 * GameState and low-level state helpers. Zone arrays hold object ids;
 * library index 0 is the top. Helpers here mutate state but never emit
 * events — that is game.ts / effects.ts territory.
 */
import type { CardDefinition, PlayerConfig } from './cards/types.js';
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
  /** Temporary power/toughness modification, reset at cleanup. */
  untilEot: { power: number; toughness: number };
  attacking: boolean;
  /** Attacker object id this creature is blocking, if any. */
  blocking?: number;
  isToken: boolean;
}

export interface StackItem {
  id: number;
  kind: 'spell' | 'ability';
  /** For spells: the card object on the stack. For abilities: the source permanent. */
  sourceId: number;
  controller: PlayerId;
  cardName: string;
  effect: import('./cards/types.js').EffectScript;
  targets: TargetChoice[];
  description: string;
}

export interface PlayerState {
  id: PlayerId;
  name: string;
  life: number;
  manaPool: ManaPool;
  landsPlayedThisTurn: number;
  zones: Record<Exclude<ZoneName, 'stack'>, number[]>;
}

export type PendingDecision = { type: 'discardToHandSize'; player: PlayerId; count: number };

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
    untilEot: { power: 0, toughness: 0 },
    attacking: false,
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
    obj.untilEot = { power: 0, toughness: 0 };
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

export function effectivePower(obj: GameObject): number {
  return (obj.card.power ?? 0) + obj.untilEot.power + (obj.counters['+1/+1'] ?? 0);
}

export function effectiveToughness(obj: GameObject): number {
  return (obj.card.toughness ?? 0) + obj.untilEot.toughness + (obj.counters['+1/+1'] ?? 0);
}

export function hasKeyword(obj: GameObject, kw: import('./types.js').Keyword): boolean {
  return obj.card.keywords?.includes(kw) ?? false;
}

export function battlefield(state: GameState): GameObject[] {
  return PLAYER_IDS.flatMap((p) => state.players[p].zones.battlefield.map((id) => state.objects[id]));
}

export function creaturesOf(state: GameState, player: PlayerId): GameObject[] {
  return state.players[player].zones.battlefield
    .map((id) => state.objects[id])
    .filter((o) => o.card.types.includes('Creature'));
}
