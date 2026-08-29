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

export type DeckSpec =
  | { kind: 'demo'; name: 'gruul' | 'azorius' }
  | { kind: 'external'; cards: ExternalCard[] };

export interface LobbyPlayer {
  playerId: PlayerId;
  name: string;
  deckReady: boolean;
  connected: boolean;
}

export type ClientMessage =
  | { type: 'createRoom'; playerName: string }
  | { type: 'joinRoom'; roomCode: string; playerName: string }
  | { type: 'rejoin'; roomCode: string; token: string }
  | { type: 'setDeck'; deck: DeckSpec }
  | { type: 'startGame' }
  | { type: 'action'; action: PlayerAction };

export type ServerMessage =
  | { type: 'roomCreated'; roomCode: string; token: string; playerId: PlayerId; protocolVersion: number }
  | { type: 'roomJoined'; roomCode: string; token: string; playerId: PlayerId; protocolVersion: number }
  | { type: 'lobbyUpdate'; players: LobbyPlayer[] }
  | { type: 'sync'; view: GameView; events: GameEvent[] }
  | { type: 'serverError'; message: string };

export type { CardDefinition, CardView, GameEvent, GameView, PlayerAction, PlayerId, PlayerView, StackItemView };
