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
  opponentOf,
  type ManaPool,
  type ManaSymbol,
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
  /** Vehicles: crewed this turn (is a creature until cleanup). */
  crewedUntilEot?: boolean;
  /** Control Magic: aura currently granting control of this object. */
  controlAura?: number;
  /** Objects exiled "until ~ leaves the battlefield" (returned when it does). */
  exiledUntilLeaves?: number[];
  /** "As ~ enters, choose a color / creature type". */
  chosenColor?: import('./types.js').Color;
  chosenType?: string;
  /** Was kicked when cast (permanents). */
  kicked?: boolean;
  /** Echo: came under control this turn (pay on next upkeep). */
  echoPending?: boolean;
  /** Renown already happened. */
  renowned?: boolean;
  /** Counters it had when it last left the battlefield (persist/undying/modular). */
  lastCounters?: Record<string, number>;
  /** Morph/Disguise: on the battlefield as a face-down 2/2 with no abilities. */
  faceDown?: boolean;
  /** Unearth: exiled instead of going anywhere else when it leaves. */
  unearthed?: boolean;
  /** How it was cast (evoke/dash/blitz…) — drives what happens on resolution. */
  castMethod?: import('./cards/types.js').CastMethod['kind'] | 'suspend';
  buybackPaid?: boolean;
  kickerTimes?: number;
  /** Why it sits in exile face down / waiting (foretell, plot, suspend, rebound, warp, madness, cipher, haunting, hideaway, playable). */
  exiledAs?: 'foretold' | 'plotted' | 'suspended' | 'rebound' | 'warped' | 'madness' | 'cipher' | 'haunting' | 'hideaway' | 'playable' | 'adventure';
  /** Miracle: just drawn as the first card this turn — castable for its miracle cost right now. */
  miracleAvailable?: boolean;
  /** Cipher: creature this exiled spell is encoded on. */
  encodedOn?: number;
  /** Haunt: creature this exiled card haunts. */
  haunting?: number;
  /** Hideaway: the card this permanent exiled face down. */
  hideawayCard?: number;
  /** Impulse ("you may play it this turn"): last turn it can be played from exile. */
  playableUntilTurn?: number;
  /** Goad: must attack while turn ≤ this. */
  goadedUntilTurn?: number;
  /** "Can't attack until your next turn" (Twisted Caverns). */
  cantAttackUntilTurn?: number;
  // ---- Leva 4
  /** "Until your next turn" modifications, cleared when that player's turn begins. */
  untilNextTurn?: { player: PlayerId; power: number; toughness: number; keywords: import('./types.js').Keyword[] }[];
  /** Cast for its prototype cost: smaller P/T. */
  prototyped?: boolean;
  /** Exerted: skips the controller's next untap step. */
  exertedUntilTurn?: number;
  /** Activations per ability index this turn ("activate only once each turn"). */
  activationsThisTurn?: Record<number, number>;
  /** Triggers that already fired this turn (oncePerTurn). */
  triggeredThisTurn?: Record<number, boolean>;
  /** Damage prevention shields (this turn). */
  preventNext?: number;
  preventAllThisTurn?: boolean;
  /** Clone: the printed card before it became a copy. */
  originalCard?: CardDefinition;
  /** Clone: entering as a copy — state-based actions wait for the choice. */
  copyPending?: boolean;
  // ---- Leva 5
  /** Exiled by this object ("return the exiled card"). */
  exiledBy?: number;
  /** Objects that dealt damage to this creature this turn. */
  damagedByThisTurn?: number[];
  /** "If that creature would die this turn, exile it instead." */
  exileIfDiesThisTurn?: boolean;
  /** "Target creature blocks ~ this turn if able" / "can't block ~ this turn". */
  mustBlockId?: number;
  cantBlockId?: number;
  /** Turn it was foretold/plotted (can't be cast the same turn / only as sorcery). */
  exiledOnTurn?: number;
  /** Bestow: on the battlefield as an Aura (not a creature while attached). */
  bestowed?: boolean;
  /** Mayhem: the turn it was discarded. */
  discardedOnTurn?: number;
  /** Sunburst: distinct colors of mana spent to cast it. */
  colorsSpent?: number;
  /** Ravenous: X chosen when cast. */
  castX?: number;
  // ---- Leva 5b
  /** Front-face definition of a double-faced card (obj.card is the current face). */
  baseCard?: CardDefinition;
  transformed?: boolean;
  /** Soulbond partner. */
  pairedWith?: number;
  /** Prepare: may cast a copy of its spell. */
  prepared?: boolean;
  /** "When you control no X, sacrifice ~" already pushed. */
  stateTriggerPending?: boolean;
  /** Printed definition, kept while granted abilities ("~ gains …") replace obj.card. */
  printedCard?: CardDefinition;
  isToken: boolean;
}

/** Something scheduled for a later step (dash return, blitz sacrifice, unearth exile, rebound cast…). */
export interface DelayedAction {
  at: 'endStep' | 'nextUpkeep';
  /** For 'nextUpkeep': whose upkeep. */
  player?: PlayerId;
  objectId: number;
  action: 'exile' | 'sacrifice' | 'returnToHand' | 'castFree' | 'effect';
  /** action 'effect': an arbitrary script run as an ability of `objectId` for `controller`, with the targets captured when scheduled. */
  effect?: import('./cards/types.js').EffectScript;
  controller?: PlayerId;
  targets?: TargetChoice[];
}

/** Creature on the battlefield — printed type, a crewed vehicle, or a face-down 2/2. */
export function isCreature(obj: GameObject): boolean {
  // Bestowed auras and attached reconfigure equipment aren't creatures while attached.
  if (obj.attachedTo !== undefined && (obj.bestowed || obj.card.reconfigure)) return false;
  if (obj.card.station && (obj.counters['charge'] ?? 0) >= obj.card.station.threshold) return true;
  return obj.card.types.includes('Creature') || !!obj.crewedUntilEot || !!obj.faceDown;
}

/** Current level for Level up creatures (level counters) and Classes (counters + 1). */
export function currentLevel(obj: GameObject): number {
  const n = obj.counters['level'] ?? 0;
  return obj.card.isClass ? n + 1 : n;
}

/** Level-gated abilities (Level up bands, Class levels) apply only inside their range. */
export function abilityActive(obj: GameObject, ability: { levelMin?: number; levelMax?: number }): boolean {
  if (ability.levelMin === undefined && ability.levelMax === undefined) return true;
  const lvl = currentLevel(obj);
  if (ability.levelMin !== undefined && lvl < ability.levelMin) return false;
  if (ability.levelMax !== undefined && lvl > ability.levelMax) return false;
  return true;
}

/** The LEVEL band a leveler is currently in, if any. */
export function currentBand(obj: GameObject): NonNullable<CardDefinition['levels']>[number] | undefined {
  if (!obj.card.levels) return undefined;
  const lvl = currentLevel(obj);
  return obj.card.levels.find((b) => lvl >= b.min && (b.max === undefined || lvl <= b.max));
}

/** Mana value of a mana cost string ("{2}{R}{R}" → 4; X counts as 0). */
export function manaValueOf(manaCost: string | undefined): number {
  if (!manaCost) return 0;
  let total = 0;
  for (const m of manaCost.matchAll(/\{([^}]+)\}/g)) {
    const sym = m[1];
    if (/^\d+$/.test(sym)) total += parseInt(sym, 10);
    else if (sym !== 'X') total += 1;
  }
  return total;
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
  /** Triggered abilities: the object that caused the trigger ("it"). */
  subjectId?: number;
  /** Triggered abilities: the player it's about ("that player") and the amount ("that much"). */
  subjectPlayer?: PlayerId;
  triggerAmount?: number;
  /** Saga chapter ability (keeps the saga alive until it resolves). */
  chapter?: number;
}

export interface PlayerState {
  id: PlayerId;
  name: string;
  life: number;
  /** Poison counters (10 = loss). */
  poison: number;
  /** Energy counters ({E}). */
  energy: number;
  /** Bloodthirst: this player was dealt damage this turn. */
  damagedThisTurn?: boolean;
  manaPool: ManaPool;
  /** Firebending: mana that survives step changes until the end of combat. */
  stickyPool?: ManaPool;
  /** Cards drawn this turn (miracle: the first one). */
  drawsThisTurn: number;
  /** Dredge: graveyard card armed to replace the next draw. */
  dredgeNext?: number;
  /** Dungeon the player is currently in, and the room index. */
  dungeon?: { name: string; room: number };
  completedDungeons: number;
  /** Turn bookkeeping for conditions (revolt, celebration, "cast another spell", "gained life"). */
  permanentsLeftThisTurn?: number;
  nonlandEnteredThisTurn?: number;
  spellsCastThisTurn?: number;
  noncreatureSpellsThisTurn?: number;
  lifeGainedThisTurn?: number;
  lifeLostThisTurn?: number;
  /** Damage prevention shields on the player (this turn). */
  preventNext?: number;
  preventAllThisTurn?: boolean;
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
  subjectId?: number;
  subjectPlayer?: PlayerId;
  triggerAmount?: number;
  /** The step that asked for the choice. */
  current: EffectStep;
  /** Steps still to run after the current one. */
  remaining: EffectStep[];
  /** Spell card to move to the graveyard once the whole script finishes. */
  finishSpellId: number | null;
  /** Flashback: the finished spell is exiled instead. */
  finishSpellExile?: boolean;
      /** Adventure: the card waits in exile after resolving. */
      finishSpellAdventure?: boolean;
}

/** A triggered ability waiting for its controller to choose targets (or a mode). */
export interface QueuedTrigger {
  sourceId: number;
  controller: PlayerId;
  cardName: string;
  /** "Choose one —" triggers wait for the mode before anything else. */
  modes?: import('./cards/types.js').SpellMode[];
  text: string;
  specs: import('./cards/types.js').TargetSpec[];
  effect: EffectStep[];
  subjectId?: number;
  subjectPlayer?: PlayerId;
  triggerAmount?: number;
  chapter?: number;
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
      subjectId?: number;
      subjectPlayer?: PlayerId;
      triggerAmount?: number;
      chapter?: number;
    }
  | {
      type: 'chooseMode';
      player: PlayerId;
      sourceId: number;
      cardName: string;
      options: { label: string; effect: EffectStep[]; targets?: import('./cards/types.js').TargetSpec[] }[];
    }
  | {
      type: 'effectChoice';
      player: PlayerId;
      prompt: string;
      /** 'cards' → pick objects; 'scry' → picks go to the bottom; text answers: 'nameCard', 'confirm' (yes/no), 'chooseColor' (WUBRG), 'chooseType' (creature type). */
      mode: 'cards' | 'scry' | 'nameCard' | 'confirm' | 'chooseColor' | 'chooseType';
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
  /**
   * Who plays first: decided by a 1–100 roll (game 1) or handed to a chosen
   * player (match rules: the previous game's loser). Non-null until chosen.
   */
  starter: {
    rolls: Record<PlayerId, number>;
    rerolls: number;
    winner: PlayerId;
    chosen: boolean;
  } | null;
  /** Mana taps that can still be undone (nothing consumed the mana yet). */
  reversibleTaps: { objectId: number; mana: ManaSymbol[] }[];
  /** Non-null while opening hands are being decided (before turn 1). */
  mulligan: MulliganState | null;
  /** Scheduled end-step / next-upkeep actions (dash, blitz, unearth, rebound, suspend…). */
  delayed: DelayedAction[];
  /** Any combat damage was dealt this turn (Prowl/Spectacle-style conditions). */
  combatDamageThisTurn: boolean;
  /** Creature subtypes that dealt combat damage to a player this turn (freerunning). */
  combatDamageSubtypesThisTurn?: string[];
  /** Creatures declared as attackers this turn (Windbrisk Heights). */
  attackersThisTurn?: number;
  /** Total power of creatures declared as attackers this turn (pack tactics). */
  attackersPowerThisTurn?: number;
  /** Morbid. */
  creaturesDiedThisTurn?: number;
  /** Day/night (daybound/nightbound); undefined until something makes it day or night. */
  dayNight?: 'day' | 'night';
  /** Spells cast during the previous turn (all players / by its active player). */
  spellsCastLastTurn?: number;
  activeSpellsLastTurn?: number;
  monarch?: PlayerId;
  initiative?: PlayerId;
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
    starter: null,
    reversibleTaps: [],
    mulligan: null,
    delayed: [],
    combatDamageThisTurn: false,
    status: 'playing',
  };

  for (const cfg of players) {
    const ps: PlayerState = {
      id: cfg.id,
      name: cfg.name,
      life: STARTING_LIFE,
      poison: 0,
      energy: 0,
      drawsThisTurn: 0,
      completedDungeons: 0,
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
  if (card.backFace) obj.baseCard = card;
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
    obj.lastCounters = { ...obj.counters };
    obj.tapped = false;
    obj.damage = 0;
    obj.counters = {};
    obj.attacking = false;
    obj.blocking = undefined;
    obj.wasBlocked = false;
    obj.attachedTo = undefined;
    obj.untilEot = { power: 0, toughness: 0, keywords: [] };
    obj.summoningSick = false;
    obj.crewedUntilEot = undefined;
    obj.pairedWith = undefined;
    obj.prepared = undefined;
    obj.stateTriggerPending = undefined;
    // Granted abilities end when the object leaves the battlefield.
    if (obj.printedCard) { obj.card = obj.printedCard; obj.printedCard = undefined; }
    // Double-faced cards leave the battlefield front face up (711.4 / 712.8).
    if (obj.baseCard && obj.transformed) { obj.card = obj.baseCard; obj.transformed = false; }
  } else {
    // Vale para tudo que entra: um veículo tripulado no turno em que entrou
    // também tem "enjoo" (302.6). Só criaturas consultam a flag.
    obj.summoningSick = true;
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
  ctx: { controller: PlayerId; sourceId: number; state?: GameState },
  filter: FilterSpec,
  obj: GameObject,
): boolean {
  if (!cardMatchesFilter(obj.card, filter)) {
    // Veículo tripulado / nave estacionada conta como criatura; ficha satisfaz "or token" (bargain).
    const asCreature = filter.what === 'creature' && isCreature(obj) && cardMatchesFilter(obj.card, { ...filter, what: undefined });
    const asToken = filter.orToken && obj.isToken;
    if (!asCreature && !asToken) return false;
  }
  if (filter.controlledBy === 'you' && obj.controller !== ctx.controller) return false;
  if (filter.controlledBy === 'opponent' && obj.controller === ctx.controller) return false;
  if (filter.other && obj.id === ctx.sourceId) return false;
  if (filter.attacking && !obj.attacking) return false;
  if (filter.inCombat && !obj.attacking && obj.blocking === undefined) return false;
  if (filter.multicolored && obj.card.colors.length < 2) return false;
  if (filter.token && !obj.isToken) return false;
  if (filter.nontoken && obj.isToken) return false;
  if (filter.tapped && !obj.tapped) return false;
  if (filter.untapped && obj.tapped) return false;
  if (filter.withCounter && (obj.counters[filter.withCounter] ?? 0) <= 0) return false;
  if (ctx.state) {
    if (filter.powerAtLeast !== undefined && effectivePower(ctx.state, obj) < filter.powerAtLeast) return false;
    if (filter.powerAtMost !== undefined && effectivePower(ctx.state, obj) > filter.powerAtMost) return false;
    if (filter.toughnessAtMost !== undefined && effectiveToughness(ctx.state, obj) > filter.toughnessAtMost) return false;
  } else {
    if (filter.powerAtLeast !== undefined && (obj.card.power ?? 0) < filter.powerAtLeast) return false;
    if (filter.powerAtMost !== undefined && (obj.card.power ?? 0) > filter.powerAtMost) return false;
    if (filter.toughnessAtMost !== undefined && (obj.card.toughness ?? 0) > filter.toughnessAtMost) return false;
  }
  if (filter.chosenSubtype) {
    const chosen = ctx.state?.objects[ctx.sourceId]?.chosenType;
    if (!chosen || !obj.card.subtypes.includes(chosen)) return false;
  }
  return true;
}

/** Evaluate an "as long as" / "if" condition for `source` (its controller is "you"). `subjectIs` needs the effect context: use condHolds in effects.ts. */
export function staticConditionHolds(state: GameState, source: GameObject, cond: import('./cards/types.js').Cond): boolean {
  const me = source.controller;
  const opp = opponentOf(me);
  const gy = state.players[me].zones.graveyard.map((id) => state.objects[id]);
  const mine = () => state.players[me].zones.battlefield.map((id) => state.objects[id]);
  const theirs = () => state.players[opp].zones.battlefield.map((id) => state.objects[id]);
  const count = (objs: GameObject[], filter: import('./cards/types.js').FilterSpec) =>
    objs.filter((o) => matchFilter({ controller: me, sourceId: source.id, state }, { ...filter, controlledBy: undefined }, o)).length;
  const who = (sel: import('./cards/types.js').PlayerSel) => (sel === 'opponent' ? [opp] : sel === 'each' ? [me, opp] : [me]);
  switch (cond.kind) {
    case 'yourTurn': return state.activePlayer === me;
    // ---- Leva 5b
    case 'dayNight': return state.dayNight === cond.value;
    case 'noSpellsLastTurn': return (state.spellsCastLastTurn ?? 0) === 0;
    case 'twoSpellsLastTurn': return (state.spellsCastLastTurn ?? 0) >= 2;
    case 'inCombat': return /combat|declare/i.test(state.step);
    case 'prepared': return !!source.prepared;
    case 'beingAttacked': return state.step === 'declareAttackers' && state.combatAwaiting === null && state.activePlayer !== me && battlefield(state).some((o) => o.attacking);
    case 'topCardSharesCreatureType': {
      const top = state.objects[state.players[me].zones.library[0]];
      return !!top && top.card.types.includes('Creature') && top.card.subtypes.some((t) => source.card.subtypes.includes(t));
    }
    case 'attacking': return source.attacking;
    case 'untapped': return !source.tapped;
    case 'tapped': return source.tapped;
    case 'graveyardAtLeast': return (cond.filter ? gy.filter((o) => cardMatchesFilter(o.card, cond.filter)).length : gy.length) >= cond.count;
    case 'delirium': return new Set(gy.flatMap((o) => o.card.types)).size >= 4;
    case 'controlsAtLeast': return count(mine(), cond.filter) >= cond.count;
    case 'controlsAtMost': return count(mine(), cond.filter) <= cond.count;
    case 'opponentControlsAtLeast': return count(theirs(), cond.filter) >= cond.count;
    case 'hasCounter': return (source.counters[cond.counter] ?? 0) > 0;
    case 'isMonarch': return state.monarch === me;
    case 'hasInitiative': return state.initiative === me;
    case 'completedDungeon': return state.players[me].completedDungeons > 0;
    case 'lifeAtMost': return who(cond.who).some((p) => state.players[p].life <= cond.amount);
    case 'lifeAtLeast': return who(cond.who).some((p) => state.players[p].life >= cond.amount);
    case 'moreLifeThanOpponent': return state.players[me].life > state.players[opp].life;
    case 'handSizeAtMost': return who(cond.who).some((p) => state.players[p].zones.hand.length <= cond.amount);
    case 'handSizeAtLeast': return who(cond.who).some((p) => state.players[p].zones.hand.length >= cond.amount);
    case 'creatureDiedThisTurn': return (state.creaturesDiedThisTurn ?? 0) > 0;
    case 'attackedThisTurn': return state.activePlayer === me && (state.attackersThisTurn ?? 0) > 0;
    case 'permanentLeftThisTurn': return (state.players[me].permanentsLeftThisTurn ?? 0) > 0;
    case 'nonlandEnteredThisTurn': return (state.players[me].nonlandEnteredThisTurn ?? 0) >= cond.count;
    case 'spellsCastThisTurnAtLeast': return (state.players[me].spellsCastThisTurn ?? 0) >= cond.count;
    case 'gainedLifeThisTurn': return (state.players[me].lifeGainedThisTurn ?? 0) > 0;
    case 'dealtCombatDamageThisTurn': return state.combatDamageThisTurn;
    case 'attackedWithPowerAtLeast': return state.activePlayer === me && (state.attackersPowerThisTurn ?? 0) >= cond.amount;
    case 'totalPowerAtLeast': return mine().filter(isCreature).reduce((s, o) => s + Math.max(0, effectivePower(state, o)), 0) >= cond.amount;
    case 'coven': return new Set(mine().filter(isCreature).map((o) => effectivePower(state, o))).size >= 3;
    case 'opponentPoisonAtLeast': return state.players[opp].poison >= cond.count;
    case 'isMainPhase': return state.step === 'main1' || state.step === 'main2';
    case 'subjectIs': return false; // precisa do contexto do efeito (condHolds)
    case 'attackersAtLeast': return (state.attackersThisTurn ?? 0) >= cond.count;
    case 'attackedAlone': return (state.attackersThisTurn ?? 0) === 1;
    case 'lifeGainedAtLeast': return (state.players[me].lifeGainedThisTurn ?? 0) >= cond.amount;
    case 'castNoncreatureThisTurn': return (state.players[me].noncreatureSpellsThisTurn ?? 0) > 0;
    case 'opponentLostLifeThisTurn': return (state.players[opp].lifeLostThisTurn ?? 0) > 0;
    case 'anyPermanentLeftThisTurn': return PLAYER_IDS.some((p) => (state.players[p].permanentsLeftThisTurn ?? 0) > 0);
    case 'not': return !staticConditionHolds(state, source, cond.cond);
    case 'and': return cond.conds.every((c) => staticConditionHolds(state, source, c));
    case 'or': return cond.conds.some((c) => staticConditionHolds(state, source, c));
  }
}

/** Static abilities on the battlefield that currently apply to `obj`. */
function staticsFor(state: GameState, obj: GameObject): { power: number; toughness: number; keywords: import('./types.js').Keyword[] } {
  const total = { power: 0, toughness: 0, keywords: [] as import('./types.js').Keyword[] };
  if (obj.zone !== 'battlefield') return total;
  for (const source of battlefield(state)) {
    for (const ability of source.card.abilities ?? []) {
      if (ability.kind !== 'static') continue;
      if (!abilityActive(source, ability)) continue;
      if (ability.hostOnly) { if (source.attachedTo !== obj.id) continue; }
      else if (ability.selfOnly ? source.id !== obj.id : !matchFilter({ controller: source.controller, sourceId: source.id, state }, ability.filter, obj)) continue;
      if (ability.condition && !staticConditionHolds(state, source, ability.condition)) continue;
      total.power += ability.power ?? 0;
      total.toughness += ability.toughness ?? 0;
      const ctx = { controller: source.controller, sourceId: source.id, state };
      if (ability.powerPer) total.power += battlefield(state).filter((o) => matchFilter(ctx, ability.powerPer!, o)).length;
      if (ability.toughnessPer) total.toughness += battlefield(state).filter((o) => matchFilter(ctx, ability.toughnessPer!, o)).length;
      if (ability.keywords) total.keywords.push(...ability.keywords);
    }
  }
  return total;
}

/** Bonus from attachments, including dynamic "+1/+1 for each X". */
function attachmentBonus(state: GameState, obj: GameObject): { power: number; toughness: number } {
  let power = 0;
  let toughness = 0;
  for (const a of attachmentsOf(state, obj)) {
    const e = a.card.attachEffect;
    if (!e) continue;
    power += e.power ?? 0;
    toughness += e.toughness ?? 0;
    const ctx = { controller: a.controller, sourceId: a.id, state };
    if (e.powerPer) power += battlefield(state).filter((o) => matchFilter(ctx, e.powerPer!, o)).length;
    if (e.toughnessPer) toughness += battlefield(state).filter((o) => matchFilter(ctx, e.toughnessPer!, o)).length;
  }
  return { power, toughness };
}

/** Characteristic-defining P/T ("~'s power is equal to the number of…"): a DynAmount evaluated from the object's controller. */
export function cdaValue(state: GameState, obj: GameObject, amount: import('./cards/types.js').DynAmount): number {
  const me = obj.controller;
  if (typeof amount === 'number') return amount;
  if (typeof amount === 'string') {
    if (amount === 'domain') {
      const lands = state.players[me].zones.battlefield.map((id) => state.objects[id].card);
      return ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'].filter((t) => lands.some((c) => c.subtypes.includes(t))).length;
    }
    return 0;
  }
  const ctx = { controller: me, sourceId: obj.id, state };
  if ('per' in amount) return battlefield(state).filter((o) => matchFilter(ctx, amount.per, o)).length;
  if ('graveyardCount' in amount) {
    const who: PlayerId[] = amount.graveyardCount === 'each' ? [...PLAYER_IDS] : amount.graveyardCount === 'opponent' ? [opponentOf(me)] : [me];
    return who.reduce((n, p) => n + state.players[p].zones.graveyard.filter((id) => !amount.filter || cardMatchesFilter(state.objects[id].card, amount.filter)).length, 0);
  }
  if ('handSize' in amount) return state.players[amount.handSize === 'opponent' ? opponentOf(me) : me].zones.hand.length;
  if ('lifeOf' in amount) return state.players[amount.lifeOf === 'opponent' ? opponentOf(me) : me].life;
  if ('countersOn' in amount) return obj.counters[amount.counter] ?? 0;
  if ('times' in amount) return amount.times * cdaValue(state, obj, amount.of);
  if ('plus' in amount) return amount.plus + cdaValue(state, obj, amount.of);
  return 0;
}

/** Soulbond: the partner while both are on the battlefield under the same controller. */
export function soulbondPartner(state: GameState, obj: GameObject): GameObject | undefined {
  if (obj.pairedWith === undefined || obj.zone !== 'battlefield') return undefined;
  const p = state.objects[obj.pairedWith];
  if (!p || p.zone !== 'battlefield' || p.controller !== obj.controller || p.pairedWith !== obj.id) return undefined;
  return p;
}

function pairedBonus(state: GameState, obj: GameObject): { power: number; toughness: number; keywords: import('./types.js').Keyword[] } {
  const total = { power: 0, toughness: 0, keywords: [] as import('./types.js').Keyword[] };
  const partner = soulbondPartner(state, obj);
  if (!partner) return total;
  for (const src of [obj, partner]) {
    const b = src.card.pairedBonus;
    if (!b) continue;
    total.power += b.power ?? 0;
    total.toughness += b.toughness ?? 0;
    total.keywords.push(...(b.keywords ?? []));
  }
  return total;
}

export function effectivePower(state: GameState, obj: GameObject): number {
  const fromAttachments = attachmentBonus(state, obj).power;
  const counters = (obj.counters['+1/+1'] ?? 0) - (obj.counters['-1/-1'] ?? 0);
  const band = currentBand(obj);
  const base = obj.faceDown ? 2 : obj.prototyped && obj.card.prototype ? obj.card.prototype.power : band?.power ?? obj.card.power ?? (obj.card.cdaPower !== undefined ? cdaValue(state, obj, obj.card.cdaPower) : 0); // virada para baixo: 2/2
  const untilNext = (obj.untilNextTurn ?? []).reduce((s, u) => s + u.power, 0);
  return base + obj.untilEot.power + untilNext + counters + fromAttachments + staticsFor(state, obj).power + pairedBonus(state, obj).power;
}

export function effectiveToughness(state: GameState, obj: GameObject): number {
  const fromAttachments = attachmentBonus(state, obj).toughness;
  const counters = (obj.counters['+1/+1'] ?? 0) - (obj.counters['-1/-1'] ?? 0);
  const band = currentBand(obj);
  const base = obj.faceDown ? 2 : obj.prototyped && obj.card.prototype ? obj.card.prototype.toughness : band?.toughness ?? obj.card.toughness ?? (obj.card.cdaToughness !== undefined ? cdaValue(state, obj, obj.card.cdaToughness) : 0);
  const untilNext = (obj.untilNextTurn ?? []).reduce((s, u) => s + u.toughness, 0);
  return base + obj.untilEot.toughness + untilNext + counters + fromAttachments + staticsFor(state, obj).toughness + pairedBonus(state, obj).toughness;
}

export function hasKeyword(state: GameState, obj: GameObject, kw: import('./types.js').Keyword): boolean {
  // Virada para baixo: sem habilidades impressas (disguise dá ward {2}, tratado no custo).
  if (!obj.faceDown && obj.card.keywords?.includes(kw)) return true;
  if (obj.untilNextTurn?.some((u) => u.keywords.includes(kw))) return true;
  if (!obj.faceDown && currentBand(obj)?.keywords?.includes(kw)) return true;
  if (!obj.faceDown && obj.card.station && (obj.counters['charge'] ?? 0) >= obj.card.station.threshold && obj.card.station.keywords?.includes(kw)) return true;
  if (obj.untilEot.keywords.includes(kw)) return true;
  if (attachmentsOf(state, obj).some((a) => a.card.attachEffect?.keywords?.includes(kw))) return true;
  if (pairedBonus(state, obj).keywords.includes(kw)) return true;
  return staticsFor(state, obj).keywords.includes(kw);
}

/** True if an attachment forbids this creature from attacking/blocking. */
export function attachmentForbids(state: GameState, obj: GameObject, what: 'cantAttack' | 'cantBlock' | 'doesntUntap'): boolean {
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
