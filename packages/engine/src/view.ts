/**
 * Per-player redacted views. The server sends these — never raw GameState —
 * so a client physically cannot see the opponent's hand or either library.
 */
import type { CardDefinition } from './cards/types.js';
import { effectivePower, effectiveToughness, type GameState, type GameObject } from './state.js';
import { opponentOf, PLAYER_IDS, type ManaPool, type PlayerId, type Step, type TargetChoice } from './types.js';
import { DUNGEONS } from './dungeons.js';

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
  /** Vehicle crewed this turn (is a creature). */
  crewed: boolean;
  /** Morph/Disguise: currently face down (the controller still sees the real card). */
  faceDown?: boolean;
  /** Leva 5b: double-faced permanent currently showing its back face. */
  transformed?: boolean;
  /** "As ~ enters, choose a color": the chosen color (for "add {C} or one mana of the chosen color"). */
  chosenColor?: string;
  /** Why the card waits in exile (foretold/plotted/suspended…), for the owner's exile viewer. */
  exiledAs?: string;
  /** Attacker was blocked this combat (ninjutsu needs an unblocked one). */
  wasBlocked?: boolean;
  /** Miracle: castable for its miracle cost right now. */
  miracleAvailable?: boolean;
  /** Impulse: playable from exile this turn. */
  playableNow?: boolean;
}

export type PendingDecisionView =
  | { type: 'discardToHandSize'; player: PlayerId; count: number }
  | { type: 'chooseMode'; player: PlayerId; cardName: string; modes: string[] }
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
      mode: 'cards' | 'scry' | 'nameCard' | 'confirm' | 'chooseColor' | 'chooseType';
      min: number;
      max: number;
      /** Card data of the options — only for the deciding player. */
      options: CardView[] | null;
    };

export interface StackItemView {
  id: number;
  kind: 'spell' | 'ability' | 'copy';
  /** Abilities: activated (vs triggered) — Stifle-style targeting. */
  activated?: boolean;
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
  poison: number;
  energy: number;
  /** Dungeon exploration (AFR): current dungeon and room, dungeons completed. */
  dungeon?: { name: string; room: string };
  completedDungeons: number;
  /** A dredge card is armed to replace the next draw. */
  dredgeArmed?: string;
  manaPool: ManaPool;
  librarySize: number;
  handSize: number;
  landsPlayedThisTurn: number;
  /** Full cards only for the viewer's own hand. */
  hand: CardView[] | null;
  /** Top of the library when a controlled permanent lets this player look at it (viewer only). */
  libraryTop?: CardView;
  battlefield: CardView[];
  graveyard: CardView[];
  exile: CardView[];
}

export interface GameView {
  you: PlayerId;
  turn: number;
  /** Spells cast this turn by anyone (storm count). */
  spellsCastThisTurn: number;
  step: Step;
  activePlayer: PlayerId;
  priority: PlayerId | null;
  combatAwaiting: 'attackers' | 'blockers' | null;
  monarch?: PlayerId;
  initiative?: PlayerId;
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
  if (pd.type === 'chooseMode') return { type: 'chooseMode', player: pd.player, cardName: pd.cardName, modes: pd.options.map((o) => o.label) };
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

const FACE_DOWN_CARD: CardDefinition = {
  id: 'face-down',
  name: 'Carta virada para baixo',
  types: ['Creature'],
  subtypes: [],
  colors: [],
  power: 2,
  toughness: 2,
  text: 'Criatura 2/2 sem nome, tipo, cor ou habilidades (morph/disguise).',
  automation: 'full',
};

function cardView(state: GameState, obj: GameObject, viewer?: PlayerId): CardView {
  const creature = obj.card.types.includes('Creature') || !!obj.crewedUntilEot || !!obj.faceDown;
  // Face-down permanents: the opponent sees only a 2/2; the controller sees the real card.
  const card = obj.faceDown && viewer !== undefined && viewer !== obj.controller ? FACE_DOWN_CARD : obj.card;
  return {
    objectId: obj.id,
    card,
    faceDown: obj.faceDown || undefined,
    transformed: obj.transformed || undefined,
    tapped: obj.tapped,
    damage: obj.damage,
    counters: Object.fromEntries(Object.entries(obj.counters).filter(([k]) => !k.startsWith('__'))),
    chosenColor: obj.chosenColor,
    power: creature ? effectivePower(state, obj) : null,
    toughness: creature ? effectiveToughness(state, obj) : null,
    attacking: obj.attacking,
    blocking: obj.blocking ?? null,
    attachedTo: obj.attachedTo ?? null,
    undoableTap: state.reversibleTaps.some((r) => r.objectId === obj.id),
    crewed: !!obj.crewedUntilEot,
    exiledAs: obj.exiledAs,
    wasBlocked: obj.wasBlocked || undefined,
    miracleAvailable: obj.miracleAvailable || undefined,
    playableNow: obj.exiledAs === 'playable' && obj.playableUntilTurn === state.turn ? true : undefined,
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
      poison: p.poison,
      energy: p.energy,
      dungeon: p.dungeon ? { name: p.dungeon.name, room: DUNGEONS.find((d) => d.name === p.dungeon!.name)?.rooms[p.dungeon.room]?.name ?? '' } : undefined,
      completedDungeons: p.completedDungeons,
      dredgeArmed: p.dredgeNext !== undefined ? state.objects[p.dredgeNext]?.card.name : undefined,
      manaPool: p.manaPool,
      librarySize: p.zones.library.length,
      handSize: p.zones.hand.length,
      landsPlayedThisTurn: p.landsPlayedThisTurn,
      hand: pid === viewer ? p.zones.hand.map((id) => cardView(state, state.objects[id])) : null,
      libraryTop:
        pid === viewer && p.zones.library.length > 0 && p.zones.battlefield.some((id) => state.objects[id].card.revealTop)
          ? cardView(state, state.objects[p.zones.library[0]])
          : undefined,
      battlefield: p.zones.battlefield.map((id) => cardView(state, state.objects[id], viewer)),
      graveyard: p.zones.graveyard.map((id) => cardView(state, state.objects[id])),
      // Cartas exiladas "para depois" (foretell, suspend…) são viradas para baixo para o oponente.
      exile: p.zones.exile.map((id) => {
        const o = state.objects[id];
        const cv = cardView(state, o);
        return o.exiledAs && (o.exiledAs === 'foretold' || o.exiledAs === 'plotted' || o.exiledAs === 'hideaway') && viewer !== o.owner ? { ...cv, card: FACE_DOWN_CARD, exiledAs: 'oculta' } : cv;
      }),
    };
  }
  return {
    you: viewer,
    turn: state.turn,
    spellsCastThisTurn: state.spellsCastThisTurn,
    step: state.step,
    activePlayer: state.activePlayer,
    priority: state.priority,
    combatAwaiting: state.combatAwaiting,
    monarch: state.monarch,
    initiative: state.initiative,
    pendingDecision: pendingDecisionView(state, viewer),
    mulligan: state.mulligan,
    starter: state.starter,
    stack: state.stack.map((item) => {
      const src = state.objects[item.sourceId];
      const hidden = src?.faceDown && viewer !== item.controller;
      return {
        id: item.id,
        kind: item.kind,
      activated: item.activated || undefined,
        sourceId: item.sourceId,
        controller: item.controller,
        cardName: hidden ? FACE_DOWN_CARD.name : item.cardName,
        description: hidden ? 'Mágica virada para baixo (morph)' : item.description,
        targets: item.targets,
        card: hidden ? FACE_DOWN_CARD : src?.card ?? null,
      };
    }),
    players,
    status: state.status,
    winner: state.winner,
  };
}
