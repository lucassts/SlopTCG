/**
 * SlopMTG room server: WebSocket, 5-letter room codes, authoritative engine.
 *
 * Every game rule runs here. Clients send intents; the server validates via
 * the engine and broadcasts per-player redacted events + views. Anyone can
 * self-host this (it's one Node process) — federation is the long-term plan.
 */
import { WebSocketServer, WebSocket } from 'ws';
import { randomBytes } from 'node:crypto';
import {
  DEMO_CARDS,
  demoDeckAzorius,
  demoDeckGruul,
  Game,
  redactEvent,
  viewFor,
  type CardDefinition,
  type CardType,
  type DeckList,
  type GameEvent,
  type PlayerId,
} from '@slopmtg/engine';
import type { ClientMessage, DeckSpec, ExternalCard, LobbyPlayer, ServerMessage } from '@slopmtg/protocol';
import { PROTOCOL_VERSION } from '@slopmtg/protocol';

const PORT = Number(process.env.PORT ?? 8080);
const ROOM_TTL_MS = 1000 * 60 * 60 * 3;

interface Seat {
  playerId: PlayerId;
  name: string;
  token: string;
  deck: DeckList | null;
  socket: WebSocket | null;
}

interface Room {
  code: string;
  seats: Partial<Record<PlayerId, Seat>>;
  game: Game | null;
  lastActivity: number;
}

const rooms = new Map<string, Room>();

// ------------------------------------------------------------------ helpers

function makeRoomCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sem 0/O/1/I
  let code = '';
  do {
    code = Array.from(randomBytes(5), (b) => alphabet[b % alphabet.length]).join('');
  } while (rooms.has(code));
  return code;
}

function send(socket: WebSocket, msg: ServerMessage): void {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg));
}

function lobbyState(room: Room): LobbyPlayer[] {
  return (['p1', 'p2'] as PlayerId[])
    .map((pid) => room.seats[pid])
    .filter((s): s is Seat => !!s)
    .map((s) => ({
      playerId: s.playerId,
      name: s.name,
      deckReady: s.deck !== null,
      connected: s.socket !== null && s.socket.readyState === WebSocket.OPEN,
    }));
}

function broadcastLobby(room: Room): void {
  for (const seat of Object.values(room.seats)) {
    if (seat.socket) send(seat.socket, { type: 'lobbyUpdate', players: lobbyState(room) });
  }
}

function broadcastGame(room: Room, events: GameEvent[]): void {
  if (!room.game) return;
  for (const seat of Object.values(room.seats)) {
    if (!seat.socket) continue;
    const visible = events
      .filter((ev) => ev.type !== 'error')
      .map((ev) => redactEvent(ev, seat.playerId));
    send(seat.socket, { type: 'sync', view: viewFor(room.game.state, seat.playerId), events: visible });
  }
}

// ------------------------------------------------------------ deck building

const KNOWN_TYPES: CardType[] = ['Land', 'Creature', 'Artifact', 'Enchantment', 'Instant', 'Sorcery', 'Planeswalker', 'Battle'];
const DEMO_BY_NAME = new Map(Object.values(DEMO_CARDS).map((c) => [c.name.toLowerCase(), c]));

function externalToDefinition(card: ExternalCard): CardDefinition {
  const registry = DEMO_BY_NAME.get(card.name.trim().toLowerCase());
  if (registry) {
    // Known card: full automation from OUR registry; keep the client's
    // Scryfall ids so the client can show the exact printing.
    return { ...registry, scryfallId: card.scryfallId ?? registry.scryfallId, oracleId: card.oracleId ?? registry.oracleId };
  }
  const typeLine = card.typeLine ?? '';
  const [left, right] = typeLine.split(/[—-]/).map((s) => s?.trim() ?? '');
  const types = KNOWN_TYPES.filter((t) => left.includes(t));
  return {
    id: `ext-${card.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    name: card.name.slice(0, 200),
    manaCost: card.manaCost,
    types: types.length > 0 ? types : ['Creature'],
    subtypes: right ? right.split(/\s+/).slice(0, 5) : [],
    colors: [],
    power: card.power,
    toughness: card.toughness,
    text: card.text?.slice(0, 2000),
    scryfallId: card.scryfallId,
    oracleId: card.oracleId,
    // Never trust client-declared behaviour: unknown cards are manual-only.
    automation: 'manual',
  };
}

function buildDeck(spec: DeckSpec): DeckList | string {
  if (spec.kind === 'demo') {
    return spec.name === 'gruul' ? demoDeckGruul() : demoDeckAzorius();
  }
  if (!Array.isArray(spec.cards) || spec.cards.length === 0) return 'deck vazio';
  const cards: CardDefinition[] = [];
  for (const entry of spec.cards) {
    const count = Math.min(Math.max(1, Math.floor(entry.count || 1)), 99);
    const def = externalToDefinition(entry);
    for (let i = 0; i < count; i++) cards.push(def);
  }
  if (cards.length < 20) return 'deck precisa de pelo menos 20 cartas';
  if (cards.length > 300) return 'deck grande demais (máx. 300)';
  return { cards };
}

// ---------------------------------------------------------------- handlers

interface ConnState {
  room: Room | null;
  playerId: PlayerId | null;
}

function handleMessage(socket: WebSocket, conn: ConnState, msg: ClientMessage): void {
  switch (msg.type) {
    case 'createRoom': {
      const room: Room = { code: makeRoomCode(), seats: {}, game: null, lastActivity: Date.now() };
      const seat: Seat = {
        playerId: 'p1',
        name: sanitizeName(msg.playerName),
        token: randomBytes(16).toString('hex'),
        deck: null,
        socket,
      };
      room.seats.p1 = seat;
      rooms.set(room.code, room);
      conn.room = room;
      conn.playerId = 'p1';
      send(socket, { type: 'roomCreated', roomCode: room.code, token: seat.token, playerId: 'p1', protocolVersion: PROTOCOL_VERSION });
      broadcastLobby(room);
      return;
    }
    case 'joinRoom': {
      const room = rooms.get(msg.roomCode.trim().toUpperCase());
      if (!room) return send(socket, { type: 'serverError', message: 'sala não encontrada' });
      if (room.seats.p2) return send(socket, { type: 'serverError', message: 'a sala já está cheia' });
      const seat: Seat = {
        playerId: 'p2',
        name: sanitizeName(msg.playerName),
        token: randomBytes(16).toString('hex'),
        deck: null,
        socket,
      };
      room.seats.p2 = seat;
      room.lastActivity = Date.now();
      conn.room = room;
      conn.playerId = 'p2';
      send(socket, { type: 'roomJoined', roomCode: room.code, token: seat.token, playerId: 'p2', protocolVersion: PROTOCOL_VERSION });
      broadcastLobby(room);
      return;
    }
    case 'rejoin': {
      const room = rooms.get(msg.roomCode.trim().toUpperCase());
      const seat = room && Object.values(room.seats).find((s) => s.token === msg.token);
      if (!room || !seat) return send(socket, { type: 'serverError', message: 'não foi possível reconectar' });
      if (seat.socket && seat.socket !== socket) seat.socket.close();
      seat.socket = socket;
      room.lastActivity = Date.now();
      conn.room = room;
      conn.playerId = seat.playerId;
      send(socket, { type: 'roomJoined', roomCode: room.code, token: seat.token, playerId: seat.playerId, protocolVersion: PROTOCOL_VERSION });
      if (room.game) {
        send(socket, { type: 'sync', view: viewFor(room.game.state, seat.playerId), events: [] });
      } else {
        broadcastLobby(room);
      }
      return;
    }
    case 'setDeck': {
      const { room, playerId } = conn;
      if (!room || !playerId) return send(socket, { type: 'serverError', message: 'você não está numa sala' });
      if (room.game) return send(socket, { type: 'serverError', message: 'a partida já começou' });
      const deck = buildDeck(msg.deck);
      if (typeof deck === 'string') return send(socket, { type: 'serverError', message: deck });
      room.seats[playerId]!.deck = deck;
      room.lastActivity = Date.now();
      broadcastLobby(room);
      return;
    }
    case 'startGame': {
      const { room, playerId } = conn;
      if (!room || playerId !== 'p1') return send(socket, { type: 'serverError', message: 'só o anfitrião inicia a partida' });
      if (room.game) return send(socket, { type: 'serverError', message: 'a partida já começou' });
      const p1 = room.seats.p1;
      const p2 = room.seats.p2;
      if (!p1?.deck || !p2?.deck)
        return send(socket, { type: 'serverError', message: 'os dois jogadores precisam escolher um deck' });
      const seed = randomBytes(4).readUInt32LE(0);
      room.game = new Game(
        [
          { id: 'p1', name: p1.name, deck: p1.deck },
          { id: 'p2', name: p2.name, deck: p2.deck },
        ],
        seed,
      );
      const events = room.game.start();
      room.lastActivity = Date.now();
      broadcastGame(room, events);
      return;
    }
    case 'action': {
      const { room, playerId } = conn;
      if (!room || !playerId || !room.game)
        return send(socket, { type: 'serverError', message: 'nenhuma partida em andamento' });
      const result = room.game.apply(playerId, msg.action);
      room.lastActivity = Date.now();
      if (!result.ok) {
        const err = result.events.find((e) => e.type === 'error');
        send(socket, { type: 'serverError', message: err?.type === 'error' ? err.message : 'ação inválida' });
        // Non-error events may still have been emitted before the failure.
        const rest = result.events.filter((e) => e.type !== 'error');
        if (rest.length > 0) broadcastGame(room, rest);
        return;
      }
      broadcastGame(room, result.events);
      return;
    }
  }
}

function sanitizeName(name: string): string {
  const clean = String(name ?? '').replace(/[\r\n\t]/g, ' ').trim().slice(0, 32);
  return clean.length > 0 ? clean : 'Jogador';
}

// ------------------------------------------------------------------- server

const wss = new WebSocketServer({ port: PORT });

wss.on('connection', (socket) => {
  const conn: ConnState = { room: null, playerId: null };
  socket.on('message', (data) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(String(data));
    } catch {
      return send(socket, { type: 'serverError', message: 'mensagem inválida' });
    }
    try {
      handleMessage(socket, conn, msg);
    } catch (err) {
      console.error('erro ao processar mensagem:', err);
      send(socket, { type: 'serverError', message: 'erro interno do servidor' });
    }
  });
  socket.on('close', () => {
    const { room, playerId } = conn;
    if (room && playerId && room.seats[playerId]?.socket === socket) {
      room.seats[playerId]!.socket = null;
      broadcastLobby(room);
    }
  });
});

setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    const anyConnected = Object.values(room.seats).some(
      (s) => s.socket && s.socket.readyState === WebSocket.OPEN,
    );
    if (!anyConnected && now - room.lastActivity > ROOM_TTL_MS) rooms.delete(code);
  }
}, 60_000).unref();

console.log(`SlopMTG server ouvindo em ws://localhost:${PORT}`);
