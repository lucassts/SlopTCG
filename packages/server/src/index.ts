/**
 * SlopMTG room server: WebSocket, 5-letter room codes, authoritative engine.
 *
 * Every game rule runs here. Clients send intents; the server validates via
 * the engine and broadcasts per-player redacted events + views. Anyone can
 * self-host this (it's one Node process) — federation is the long-term plan.
 */
import { WebSocketServer, WebSocket } from 'ws';
import { randomBytes } from 'node:crypto';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  compileOracleCard,
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

const DEMO_BY_NAME = new Map(Object.values(DEMO_CARDS).map((c) => [c.name.toLowerCase(), c]));

interface ScryfallCard {
  name: string;
  id: string;
  oracle_id: string;
  mana_cost?: string;
  type_line?: string;
  power?: string;
  toughness?: string;
  oracle_text?: string;
  colors?: string[];
  card_faces?: { name?: string; mana_cost?: string; type_line?: string; oracle_text?: string; power?: string; toughness?: string; colors?: string[] }[];
}

/** Official card data cache (name, lowercase → card or null when unknown). */
const scryfallCache = new Map<string, ScryfallCard | null>();

/**
 * The server resolves card names against Scryfall ITSELF — the client only
 * supplies names and counts, so it can never inject card data or behaviour.
 */
async function resolveOfficialCards(names: string[]): Promise<Map<string, ScryfallCard | null>> {
  const result = new Map<string, ScryfallCard | null>();
  const missing: string[] = [];
  for (const name of names) {
    const key = name.toLowerCase();
    if (scryfallCache.has(key)) result.set(key, scryfallCache.get(key)!);
    else missing.push(name);
  }
  for (let i = 0; i < missing.length; i += 75) {
    const batch = missing.slice(i, i + 75);
    const res = await fetch('https://api.scryfall.com/cards/collection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'SlopMTG/0.1 (open source card game client)' },
      body: JSON.stringify({ identifiers: batch.map((n) => ({ name: n.split('//')[0].trim() })) }),
    });
    if (!res.ok) throw new Error(`Scryfall respondeu ${res.status}`);
    const data = (await res.json()) as { data: ScryfallCard[] };
    for (const card of data.data) {
      const keys = [card.name.toLowerCase(), card.name.split('//')[0].trim().toLowerCase()];
      for (const k of keys) {
        scryfallCache.set(k, card);
        result.set(k, card);
      }
    }
    for (const n of batch) {
      const key = n.toLowerCase();
      if (!result.has(key)) {
        scryfallCache.set(key, null);
        result.set(key, null);
      }
    }
  }
  return result;
}

const num = (v: string | undefined) => {
  if (v === undefined) return undefined;
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? undefined : n;
};

/** Build a definition from OFFICIAL data: demo registry > oracle compiler > manual. */
function officialToDefinition(official: ScryfallCard): CardDefinition {
  const registry = DEMO_BY_NAME.get(official.name.toLowerCase());
  if (registry) return { ...registry, scryfallId: official.id, oracleId: official.oracle_id };

  const face = official.card_faces?.[0];
  const input = {
    name: official.name.split('//')[0].trim(),
    manaCost: official.mana_cost || face?.mana_cost,
    typeLine: (official.type_line || face?.type_line || '').split('//')[0].trim(),
    oracleText: official.oracle_text ?? face?.oracle_text,
    power: num(official.power ?? face?.power),
    toughness: num(official.toughness ?? face?.toughness),
    colors: (official.colors ?? face?.colors ?? []) as CardDefinition['colors'],
    oracleId: official.oracle_id,
    scryfallId: official.id,
  };
  // Double-faced cards stay manual (only the front face is modelled).
  const compiled = official.card_faces ? null : compileOracleCard(input);
  if (compiled) return compiled;

  const { types, subtypes } = splitTypeLine(input.typeLine);
  return {
    id: `ext-${input.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    name: input.name,
    manaCost: input.manaCost,
    types: types.length > 0 ? types : ['Creature'],
    subtypes,
    colors: input.colors,
    power: input.power,
    toughness: input.toughness,
    text: input.oracleText?.slice(0, 2000),
    scryfallId: official.id,
    oracleId: official.oracle_id,
    automation: 'manual',
  };
}

const KNOWN_TYPES: CardType[] = ['Land', 'Creature', 'Artifact', 'Enchantment', 'Instant', 'Sorcery', 'Planeswalker', 'Battle'];

function splitTypeLine(typeLine: string): { types: CardType[]; subtypes: string[] } {
  const [left, right] = typeLine.split(/\s+—\s+/);
  return {
    types: KNOWN_TYPES.filter((t) => (left ?? '').includes(t)),
    subtypes: right ? right.trim().split(/\s+/).slice(0, 5) : [],
  };
}

async function buildDeck(spec: DeckSpec): Promise<DeckList | string> {
  if (spec.kind === 'demo') {
    return spec.name === 'gruul' ? demoDeckGruul() : demoDeckAzorius();
  }
  if (!Array.isArray(spec.cards) || spec.cards.length === 0) return 'deck vazio';
  const entries = spec.cards
    .map((c) => ({ name: String(c.name ?? '').slice(0, 200), count: Math.min(Math.max(1, Math.floor(c.count || 1)), 99) }))
    .filter((c) => c.name.length > 0);
  const official = await resolveOfficialCards(entries.map((e) => e.name));
  const cards: CardDefinition[] = [];
  const notFound: string[] = [];
  for (const entry of entries) {
    const data = official.get(entry.name.toLowerCase());
    if (!data) {
      notFound.push(entry.name);
      continue;
    }
    const def = officialToDefinition(data);
    for (let i = 0; i < entry.count; i++) cards.push(def);
  }
  if (notFound.length > 0) return `cartas não encontradas: ${notFound.slice(0, 5).join(', ')}`;
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
      buildDeck(msg.deck)
        .then((deck) => {
          if (typeof deck === 'string') return send(socket, { type: 'serverError', message: deck });
          if (room.game) return send(socket, { type: 'serverError', message: 'a partida já começou' });
          room.seats[playerId]!.deck = deck;
          room.lastActivity = Date.now();
          broadcastLobby(room);
        })
        .catch((err: unknown) => {
          send(socket, { type: 'serverError', message: err instanceof Error ? err.message : 'falha ao montar o deck' });
        });
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

// -------------------------------------------------- deck import proxy (HTTP)

/**
 * GET /api/deck?url=<archidekt deck url> → { name, cards: [{name, count}] }
 * Browsers can't call Archidekt directly (CORS), so the room server proxies.
 * Only deck ids extracted from known hosts are fetched — the client never
 * controls the outgoing URL.
 */
async function fetchArchidektDeck(deckUrl: string): Promise<{ name: string; cards: { name: string; count: number }[] }> {
  const m = deckUrl.match(/archidekt\.com\/(?:api\/)?decks\/(\d+)/);
  if (!m) throw new Error('URL não reconhecida — cole um link de deck do Archidekt');
  const res = await fetch(`https://archidekt.com/api/decks/${m[1]}/`, {
    headers: { 'User-Agent': 'SlopMTG/0.1 (open source card game client)' },
  });
  if (!res.ok) throw new Error(`Archidekt respondeu ${res.status}`);
  const deck = (await res.json()) as {
    name: string;
    categories?: { name: string; includedInDeck: boolean }[];
    cards: { quantity: number; categories?: string[]; card?: { oracleCard?: { name?: string } } }[];
  };
  const excluded = new Set(
    (deck.categories ?? []).filter((c) => !c.includedInDeck).map((c) => c.name),
  );
  const counts = new Map<string, number>();
  for (const entry of deck.cards ?? []) {
    const name = entry.card?.oracleCard?.name;
    if (!name) continue;
    if ((entry.categories ?? []).some((c) => excluded.has(c))) continue;
    counts.set(name, (counts.get(name) ?? 0) + (entry.quantity || 1));
  }
  return { name: deck.name ?? 'Deck', cards: [...counts].map(([name, count]) => ({ name, count })) };
}

// ---------------------------------------------- static web app (self-host)

/**
 * XMage-style self-hosting: this one process serves the built web client AND
 * the WebSocket, so a host runs `npm start` and shares http://<ip>:8080.
 */
const WEB_DIR =
  process.env.SLOPMTG_WEB_DIR ??
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../apps/web/dist');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function serveStatic(pathname: string, res: http.ServerResponse): void {
  const safe = path.normalize(pathname).replace(/^([/\\])+/, '').replace(/^(\.\.[/\\])+/, '');
  let file = path.join(WEB_DIR, safe || 'index.html');
  if (!file.startsWith(WEB_DIR)) file = path.join(WEB_DIR, 'index.html');
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(WEB_DIR, 'index.html');
  if (!fs.existsSync(file)) {
    res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Cliente web não compilado. Rode: npm run build');
    return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}

const httpServer = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'GET' && url.pathname === '/api/deck') {
    const deckUrl = url.searchParams.get('url') ?? '';
    fetchArchidektDeck(deckUrl)
      .then((deck) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(deck));
      })
      .catch((err: unknown) => {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err instanceof Error ? err.message : 'falha ao importar' }));
      });
    return;
  }
  if (req.method === 'GET') {
    serveStatic(url.pathname, res);
    return;
  }
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'não encontrado' }));
});

// ------------------------------------------------------------------- server

const wss = new WebSocketServer({ server: httpServer });

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

httpServer.listen(PORT, () => {
  console.log(`SlopMTG server ouvindo em ws://localhost:${PORT} (HTTP: /api/deck)`);
});
