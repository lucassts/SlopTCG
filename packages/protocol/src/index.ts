/**
 * Client ↔ server message types. The wire format is JSON.
 *
 * Deck security model: the server only automates cards from its own
 * registry (matched by name). Cards sent by clients (e.g. imported from
 * Scryfall) are forced to automation 'manual' — a client can never inject
 * card behaviour, only card identity.
 */
import type {
  CardDefinition,
  CardView,
  GameEvent,
  GameView,
  PlayerAction,
  PlayerId,
  PlayerView,
  StackItemView,
} from '@sloptcg/engine';

export const PROTOCOL_VERSION = 1;

/** A card as submitted by a client for a custom deck (identity only). */
export interface ExternalCard {
  name: string;
  manaCost?: string;
  typeLine?: string;
  power?: number;
  toughness?: number;
  text?: string;
  scryfallId?: string;
  oracleId?: string;
  /** Number of copies in the deck. */
  count: number;
}

/** Card name + copy count (deck configuration between match games). */
export interface CountedCard {
  name: string;
  count: number;
}

export type DeckSpec = { kind: 'external'; cards: ExternalCard[]; sideboard?: CountedCard[] };

export interface LobbyPlayer {
  playerId: PlayerId;
  name: string;
  deckReady: boolean;
  /** Player confirmed the deck and wants the match to start. */
  ready: boolean;
  connected: boolean;
}

export type ClientMessage =
  | { type: 'createRoom'; playerName: string }
  | { type: 'joinRoom'; roomCode: string; playerName: string }
  | { type: 'rejoin'; roomCode: string; token: string }
  | { type: 'setDeck'; deck: DeckSpec }
  | { type: 'lobbyReady'; ready: boolean }
  | { type: 'startGame' }
  | { type: 'action'; action: PlayerAction }
  /** Between match games: submit the reconfigured mainboard (side = rest). */
  | { type: 'sideboard'; main: CountedCard[] }
  | { type: 'readyNextGame' };

/** Best-of-3 match progress. */
export interface MatchStateMsg {
  type: 'matchState';
  wins: Record<PlayerId, number>;
  gameNumber: number;
  phase: 'playing' | 'sideboarding' | 'finished';
  matchWinner?: PlayerId;
}

export type ServerMessage =
  | { type: 'roomCreated'; roomCode: string; token: string; playerId: PlayerId; protocolVersion: number }
  | { type: 'roomJoined'; roomCode: string; token: string; playerId: PlayerId; protocolVersion: number }
  | { type: 'lobbyUpdate'; players: LobbyPlayer[] }
  | { type: 'sync'; view: GameView; events: GameEvent[] }
  | MatchStateMsg
  /** Your own current deck configuration (sent privately). */
  | { type: 'sideboardState'; main: CountedCard[]; side: CountedCard[]; ready: boolean; opponentReady: boolean }
  | { type: 'serverError'; message: string };

export type { CardDefinition, CardView, GameEvent, GameView, PlayerAction, PlayerId, PlayerView, StackItemView };
