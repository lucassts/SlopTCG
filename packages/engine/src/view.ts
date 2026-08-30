/**
 * Per-player redacted views. The server sends these — never raw GameState —
 * so a client physically cannot see the opponent's hand or either library.
 */
import type { CardDefinition } from './cards/types.js';
import { effectivePower, effectiveToughness, type GameState, type GameObject } from './state.js';
import { opponentOf, PLAYER_IDS, type ManaPool, type PlayerId, type Step, type TargetChoice } from './types.js';

export interface CardView {
  objectId: number;
  card: CardDefinition;
  tapped: boolean;
  damage: number;
  counters: Record<string, number>;
  power: number | null;
  toughness: number | null;
  attacking: boolean;
  blocking: number | null;
  /** For auras/equipment: the object this is attached to. */
  attachedTo: number | null;
  summoningSick: boolean;
  isToken: boolean;
  /** This tap-for-mana can still be undone by its controller. */
  undoableTap: boolean;
}

export type PendingDecisionView =
  | { type: 'discardToHandSize'; player: PlayerId; count: number }
  | {
      type: 'chooseTargets';
      player: PlayerId;
      cardName: string;
      text: string;
      specs: import('./cards/types.js').TargetSpec[];
    }
  | {
      type: 'effectChoice';
      player: PlayerId;
      prompt: string;
      mode: 'cards' | 'scry' | 'nameCard';
      min: number;
      max: number;
      /** Card data of the options — only for the deciding player. */
      options: CardView[] | null;
    };

export interface StackItemView {
  id: number;
  kind: 'spell' | 'ability' | 'copy';
  /** For spells: the card object's id (usable as a counterspell target). */
  sourceId: number;
  controller: PlayerId;
  cardName: string;
  description: string;
  targets: TargetChoice[];
  card: CardDefinition | null;
}

export interface PlayerView {
  id: PlayerId;
  name: string;
  life: number;
  manaPool: ManaPool;
  librarySize: number;
  handSize: number;
  landsPlayedThisTurn: number;
  /** Full cards only for the viewer's own hand. */
  hand: CardView[] | null;
  battlefield: CardView[];
  graveyard: CardView[];
  exile: CardView[];
}

export interface GameView {
  you: PlayerId;
  turn: number;
  step: Step;
  activePlayer: PlayerId;
  priority: PlayerId | null;
  combatAwaiting: 'attackers' | 'blockers' | null;
  pendingDecision: PendingDecisionView | null;
  /** Non-null while opening hands are being decided. */
  mulligan: { taken: Record<PlayerId, number>; phase: Record<PlayerId, 'deciding' | 'kept'> } | null;
  /** Starting roll / who-plays-first choice, until decided. */
  starter: { rolls: Record<PlayerId, number>; rerolls: number; winner: PlayerId; chosen: boolean } | null;
  stack: StackItemView[];
  players: Record<PlayerId, PlayerView>;
  status: 'playing' | 'finished';
  winner?: PlayerId | 'draw';
}

function pendingDecisionView(state: GameState, viewer: PlayerId): PendingDecisionView | null {
  const pd = state.pendingDecision;
  if (!pd) return null;
  if (pd.type === 'discardToHandSize') return { type: 'discardToHandSize', player: pd.player, count: pd.count };
  if (pd.type === 'chooseTargets')
    return { type: 'chooseTargets', player: pd.player, cardName: pd.cardName, text: pd.text, specs: pd.specs };
  return {
    type: 'effectChoice',
    player: pd.player,
    prompt: pd.prompt,
    mode: pd.mode,
    min: pd.min,
    max: pd.max,
    options:
      viewer === pd.player
        ? pd.options.map((id) => cardView(state, state.objects[id])).filter((c) => !!c.card)
        : null,
  };
}

function cardView(state: GameState, obj: GameObject): CardView {
  const isCreature = obj.card.types.includes('Creature');
  return {
    objectId: obj.id,
    card: obj.card,
    tapped: obj.tapped,
    damage: obj.damage,
    counters: Object.fromEntries(Object.entries(obj.counters).filter(([k]) => !k.startsWith('__'))),
    power: isCreature ? effectivePower(state, obj) : null,
    toughness: isCreature ? effectiveToughness(state, obj) : null,
    attacking: obj.attacking,
    blocking: obj.blocking ?? null,
    attachedTo: obj.attachedTo ?? null,
    undoableTap: state.reversibleTaps.some((r) => r.objectId === obj.id),
    summoningSick: obj.summoningSick,
    isToken: obj.isToken,
  };
}

export function viewFor(state: GameState, viewer: PlayerId): GameView {
  const players = {} as Record<PlayerId, PlayerView>;
  for (const pid of PLAYER_IDS) {
    const p = state.players[pid];
    players[pid] = {
      id: pid,
      name: p.name,
      life: p.life,
      manaPool: p.manaPool,
      librarySize: p.zones.library.length,
      handSize: p.zones.hand.length,
      landsPlayedThisTurn: p.landsPlayedThisTurn,
      hand: pid === viewer ? p.zones.hand.map((id) => cardView(state, state.objects[id])) : null,
      battlefield: p.zones.battlefield.map((id) => cardView(state, state.objects[id])),
      graveyard: p.zones.graveyard.map((id) => cardView(state, state.objects[id])),
      exile: p.zones.exile.map((id) => cardView(state, state.objects[id])),
    };
  }
  return {
    you: viewer,
    turn: state.turn,
    step: state.step,
    activePlayer: state.activePlayer,
    priority: state.priority,
    combatAwaiting: state.combatAwaiting,
    pendingDecision: pendingDecisionView(state, viewer),
    mulligan: state.mulligan,
    starter: state.starter,
    stack: state.stack.map((item) => ({
      id: item.id,
      kind: item.kind,
      sourceId: item.sourceId,
      controller: item.controller,
      cardName: item.cardName,
      description: item.description,
      targets: item.targets,
      card: item.kind === 'spell' ? state.objects[item.sourceId]?.card ?? null : state.objects[item.sourceId]?.card ?? null,
    })),
    players,
    status: state.status,
    winner: state.winner,
  };
}
