/**
 * SlopTCG room server: WebSocket, 5-letter room codes, authoritative engine.
 *
 * Every game rule runs here. Clients send intents; the server validates via
 * the engine and broadcasts per-player redacted events + views. Anyone can
 * self-host this (it's one Node process) — federation is the long-term plan.
 */
import https from 'node:https';
import { WebSocketServer, WebSocket } from 'ws';
import { randomBytes } from 'node:crypto';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { exec } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  compileOracleCard,
  DEMO_CARDS,
  Game,
  redactEvent,
  viewFor,
  type CardDefinition,
  type CardType,
  type DeckList,
  type GameEvent,
  type PlayerId,
} from '@sloptcg/engine';
import type { ClientMessage, CountedCard, DeckSpec, LobbyPlayer, ServerMessage } from '@sloptcg/protocol';
import { PROTOCOL_VERSION } from '@sloptcg/protocol';

const PORT = Number(process.env.PORT ?? 8080);
const ROOM_TTL_MS = 1000 * 60 * 60 * 3;

/** A player's card pool for the match: resolved defs + current main/side. */
interface DeckPool {
  defs: Map<string, CardDefinition>;
  /** Total copies per name across main + side (fixed for the match). */
  total: Map<string, number>;
  main: CountedCard[];
  side: CountedCard[];
}

interface Seat {
  playerId: PlayerId;
  name: string;
  token: string;
  pool: DeckPool | null;
  /** Confirmed the deck in the lobby ("estou pronto"). */
  lobbyReady: boolean;
  socket: WebSocket | null;
}

/** Best-of-3 match progress. */
interface MatchState {
  wins: Record<PlayerId, number>;
  gameNumber: number;
  phase: 'lobby' | 'playing' | 'sideboarding' | 'finished';
  lastLoser?: PlayerId;
  ready: Record<PlayerId, boolean>;
  matchWinner?: PlayerId;
}

interface Room {
  code: string;
  seats: Partial<Record<PlayerId, Seat>>;
  game: Game | null;
  match: MatchState;
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
      deckReady: s.pool !== null,
      ready: s.lobbyReady,
      connected: s.socket !== null && s.socket.readyState === WebSocket.OPEN,
    }));
}

function matchStateMsg(room: Room): Extract<ServerMessage, { type: 'matchState' }> {
  const m = room.match;
  return {
    type: 'matchState',
    wins: m.wins,
    gameNumber: m.gameNumber,
    phase: m.phase === 'lobby' ? 'playing' : m.phase,
    matchWinner: m.matchWinner,
  };
}

function broadcastMatch(room: Room): void {
  for (const seat of Object.values(room.seats)) {
    if (seat.socket) send(seat.socket, matchStateMsg(room));
  }
}

function sendSideboardState(room: Room, seat: Seat): void {
  if (!seat.socket || !seat.pool) return;
  const opp = room.seats[seat.playerId === 'p1' ? 'p2' : 'p1'];
  send(seat.socket, {
    type: 'sideboardState',
    main: seat.pool.main,
    side: seat.pool.side,
    ready: room.match.ready[seat.playerId],
    opponentReady: opp ? room.match.ready[opp.playerId] : false,
  });
}

/** After any batch of game events: advance the match on a game end. */
function afterGameEvents(room: Room, events: GameEvent[]): void {
  const end = events.find((e) => e.type === 'gameEnded');
  if (!end || end.type !== 'gameEnded' || room.match.phase !== 'playing') return;
  const m = room.match;
  if (end.winner !== 'draw') {
    m.wins[end.winner] += 1;
    m.lastLoser = end.winner === 'p1' ? 'p2' : 'p1';
  }
  if (m.wins.p1 >= 2 || m.wins.p2 >= 2) {
    m.phase = 'finished';
    m.matchWinner = m.wins.p1 >= 2 ? 'p1' : 'p2';
  } else {
    m.phase = 'sideboarding';
    m.ready = { p1: false, p2: false };
  }
  broadcastMatch(room);
  if (m.phase === 'sideboarding') {
    for (const seat of Object.values(room.seats)) sendSideboardState(room, seat);
  }
}

/** Both players ready: rebuild decks from their pools and start the next game. */
function startNextGame(room: Room): void {
  const p1 = room.seats.p1;
  const p2 = room.seats.p2;
  if (!p1?.pool || !p2?.pool) return;
  const expandEntries = (pool: DeckPool, entries: CountedCard[]): CardDefinition[] =>
    entries.flatMap((entry) => {
      const def = pool.defs.get(entry.name.toLowerCase());
      return def ? Array.from({ length: entry.count }, () => def) : [];
    });
  // O sideboard entra na partida como zona "fora do jogo" (Wishes, Karn).
  const expand = (pool: DeckPool): DeckList => ({ cards: expandEntries(pool, pool.main), sideboard: expandEntries(pool, pool.side) });
  const m = room.match;
  m.gameNumber += 1;
  m.phase = 'playing';
  const seed = randomBytes(4).readUInt32LE(0);
  room.game = new Game(
    [
      { id: 'p1', name: p1.name, deck: expand(p1.pool) },
      { id: 'p2', name: p2.name, deck: expand(p2.pool) },
    ],
    seed,
    { starterChooser: m.lastLoser, manualMana: true },
  );
  broadcastMatch(room);
  broadcastGame(room, room.game.start());
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
  loyalty?: string;
  layout?: string;
  oracle_text?: string;
  colors?: string[];
  defense?: string;
  card_faces?: { name?: string; mana_cost?: string; type_line?: string; oracle_text?: string; power?: string; toughness?: string; loyalty?: string; defense?: string; colors?: string[] }[];
}

/** Multi-face layouts whose front face is a normal card we can play. */
const FRONT_FACE_LAYOUTS = new Set(['transform', 'modal_dfc', 'adventure', 'split', 'flip', 'battle', 'prepare']);

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
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'SlopTCG/0.1 (open source card game client)' },
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

/**
 * Build a definition from OFFICIAL data. Order: oracle compiler when it
 * fully understands the card (the official text is the source of truth) >
 * hand-written registry > partial compile > manual. The registry used to
 * win by name, and a hand-written mistake (Darksteel Myr as 0/3) silently
 * overrode the real card.
 */
function officialToDefinition(official: ScryfallCard): CardDefinition {
  const registry = DEMO_BY_NAME.get(official.name.toLowerCase());
  const face = official.card_faces?.[0];
  const input: Parameters<typeof compileOracleCard>[0] = {
    name: official.name.split('//')[0].trim(),
    manaCost: official.mana_cost || face?.mana_cost,
    typeLine: (official.type_line || face?.type_line || '').split('//')[0].trim(),
    oracleText: official.oracle_text ?? face?.oracle_text,
    power: num(official.power ?? face?.power),
    toughness: num(official.toughness ?? face?.toughness),
    loyalty: num(official.loyalty ?? face?.loyalty),
    defense: num(official.defense ?? face?.defense),
    colors: (official.colors ?? face?.colors ?? []) as CardDefinition['colors'],
    oracleId: official.oracle_id,
    scryfallId: official.id,
  };
  // Leva 5b: the second face is compiled too (transform, MDFC, adventure, split, flip, battle, prepare).
  const back = official.card_faces?.[1];
  const multiface = !!official.card_faces;
  if (back && FRONT_FACE_LAYOUTS.has(official.layout ?? '')) {
    input.layout = official.layout;
    input.backFace = {
      name: (back.name ?? '').trim(),
      manaCost: back.mana_cost,
      typeLine: (back.type_line ?? '').trim(),
      oracleText: back.oracle_text,
      power: num(back.power),
      toughness: num(back.toughness),
      loyalty: num(back.loyalty),
      defense: num(back.defense),
      colors: (back.colors ?? []) as CardDefinition['colors'],
    };
  }
  const compiled = multiface && !FRONT_FACE_LAYOUTS.has(official.layout ?? '') ? null : compileOracleCard(input);
  if (compiled && multiface && !compiled.backFace) {
    compiled.automation = 'partial';
    compiled.automationNotes = [...(compiled.automationNotes ?? []), 'Outra face / verso não modelado — use o modo manual para virar'];
  }
  if (compiled && compiled.automation === 'full') return compiled;
  if (registry) return { ...registry, scryfallId: official.id, oracleId: official.oracle_id };
  if (compiled) return compiled;

  const { types, subtypes } = splitTypeLine(input.typeLine);
  return {
    id: `ext-${input.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    name: input.name,
    manaCost: input.manaCost,
    types: types.length > 0 ? types : ['Creature'],
    subtypes,
    colors: input.colors ?? [],
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

function sanitizeEntries(raw: CountedCard[] | undefined): CountedCard[] {
  return (raw ?? [])
    .map((c) => ({ name: String(c.name ?? '').slice(0, 200), count: Math.min(Math.max(1, Math.floor(c.count || 1)), 99) }))
    .filter((c) => c.name.length > 0);
}

async function buildPool(spec: DeckSpec): Promise<DeckPool | string> {
  if (spec.kind !== 'external') return 'formato de deck desconhecido';
  const main = sanitizeEntries(spec.cards as CountedCard[]);
  const side = sanitizeEntries(spec.sideboard);
  if (main.length === 0) return 'deck vazio';
  const mainTotal = main.reduce((n, c) => n + c.count, 0);
  const sideTotal = side.reduce((n, c) => n + c.count, 0);
  if (mainTotal < 20) return 'deck precisa de pelo menos 20 cartas';
  if (mainTotal > 300) return 'deck grande demais (máx. 300)';
  if (sideTotal > 15) return 'sideboard: no máximo 15 cartas';

  const names = [...new Set([...main, ...side].map((e) => e.name))];
  const official = await resolveOfficialCards(names);
  const defs = new Map<string, CardDefinition>();
  const notFound: string[] = [];
  for (const name of names) {
    const data = official.get(name.toLowerCase());
    if (!data) notFound.push(name);
    else defs.set(name.toLowerCase(), officialToDefinition(data));
  }
  if (notFound.length > 0) return `cartas não encontradas: ${notFound.slice(0, 5).join(', ')}`;
  const total = new Map<string, number>();
  for (const e of [...main, ...side]) total.set(e.name, (total.get(e.name) ?? 0) + e.count);
  return { defs, total, main, side };
}

// ---------------------------------------------------------------- handlers

interface ConnState {
  room: Room | null;
  playerId: PlayerId | null;
}

function handleMessage(socket: WebSocket, conn: ConnState, msg: ClientMessage): void {
  switch (msg.type) {
    case 'createRoom': {
      const room: Room = {
        code: makeRoomCode(),
        seats: {},
        game: null,
        match: { wins: { p1: 0, p2: 0 }, gameNumber: 0, phase: 'lobby', ready: { p1: false, p2: false } },
        lastActivity: Date.now(),
      };
      const seat: Seat = {
        playerId: 'p1',
        name: sanitizeName(msg.playerName),
        token: randomBytes(16).toString('hex'),
        pool: null,
        lobbyReady: false,
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
        pool: null,
        lobbyReady: false,
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
      if (room.match.phase !== 'lobby') send(socket, matchStateMsg(room));
      if (room.match.phase === 'sideboarding') {
        sendSideboardState(room, seat);
      } else if (room.game) {
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
      buildPool(msg.deck)
        .then((pool) => {
          if (typeof pool === 'string') return send(socket, { type: 'serverError', message: pool });
          if (room.game) return send(socket, { type: 'serverError', message: 'a partida já começou' });
          room.seats[playerId]!.pool = pool;
          // Trocar de deck desfaz o "estou pronto" — o oponente precisa saber.
          room.seats[playerId]!.lobbyReady = false;
          room.lastActivity = Date.now();
          broadcastLobby(room);
        })
        .catch((err: unknown) => {
          send(socket, { type: 'serverError', message: err instanceof Error ? err.message : 'falha ao montar o deck' });
        });
      return;
    }
    case 'lobbyReady': {
      const { room, playerId } = conn;
      if (!room || !playerId) return send(socket, { type: 'serverError', message: 'você não está numa sala' });
      if (room.game) return;
      const seat = room.seats[playerId];
      if (!seat) return;
      if (msg.ready && !seat.pool)
        return send(socket, { type: 'serverError', message: 'escolha um deck antes de ficar pronto' });
      seat.lobbyReady = msg.ready;
      room.lastActivity = Date.now();
      broadcastLobby(room);
      return;
    }
    case 'startGame': {
      const { room, playerId } = conn;
      if (!room || playerId !== 'p1') return send(socket, { type: 'serverError', message: 'só o anfitrião inicia a partida' });
      if (room.game) return send(socket, { type: 'serverError', message: 'a partida já começou' });
      if (!room.seats.p1?.pool || !room.seats.p2?.pool)
        return send(socket, { type: 'serverError', message: 'os dois jogadores precisam escolher um deck' });
      if (!room.seats.p2.lobbyReady)
        return send(socket, { type: 'serverError', message: 'aguarde o oponente confirmar que está pronto' });
      room.lastActivity = Date.now();
      startNextGame(room); // jogo 1: quem começa sai do roll 1-100
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
        if (rest.length > 0) {
          broadcastGame(room, rest);
          afterGameEvents(room, rest);
        }
        return;
      }
      broadcastGame(room, result.events);
      afterGameEvents(room, result.events);
      return;
    }
    case 'sideboard': {
      const { room, playerId } = conn;
      if (!room || !playerId) return send(socket, { type: 'serverError', message: 'você não está numa sala' });
      const seat = room.seats[playerId];
      if (room.match.phase !== 'sideboarding' || !seat?.pool)
        return send(socket, { type: 'serverError', message: 'não é hora de mexer no sideboard' });
      const main = sanitizeEntries(msg.main);
      const pool = seat.pool;
      // Every card must come from the registered pool, never exceeding it.
      for (const entry of main) {
        if ((pool.total.get(entry.name) ?? 0) < entry.count)
          return send(socket, { type: 'serverError', message: `${entry.name}: mais cópias do que o seu pool tem` });
      }
      const mainTotal = main.reduce((n, c) => n + c.count, 0);
      if (mainTotal < 20) return send(socket, { type: 'serverError', message: 'deck precisa de pelo menos 20 cartas' });
      const side: CountedCard[] = [];
      for (const [name, total] of pool.total) {
        const inMain = main.find((m) => m.name === name)?.count ?? 0;
        if (total - inMain > 0) side.push({ name, count: total - inMain });
      }
      pool.main = main;
      pool.side = side;
      room.match.ready[playerId] = false;
      sendSideboardState(room, seat);
      return;
    }
    case 'readyNextGame': {
      const { room, playerId } = conn;
      if (!room || !playerId) return send(socket, { type: 'serverError', message: 'você não está numa sala' });
      if (room.match.phase !== 'sideboarding')
        return send(socket, { type: 'serverError', message: 'nenhum jogo aguardando' });
      room.match.ready[playerId] = true;
      for (const seat of Object.values(room.seats)) sendSideboardState(room, seat);
      if (room.match.ready.p1 && room.match.ready.p2) startNextGame(room);
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
 * GET /api/deck?url=<archidekt or moxfield deck url> → { name, cards: [{name, count}], sideboard }
 * Browsers can't call Archidekt/Moxfield directly (CORS), so the room server proxies.
 * Only deck ids extracted from known hosts are fetched — the client never
 * controls the outgoing URL.
 */
async function fetchDeckByUrl(deckUrl: string): Promise<{ name: string; cards: CountedCard[]; sideboard: CountedCard[] }> {
  if (/moxfield\.com\/decks\//i.test(deckUrl)) return fetchMoxfieldDeck(deckUrl);
  if (/archidekt\.com\//i.test(deckUrl)) return fetchArchidektDeck(deckUrl);
  throw new Error('URL não reconhecida — cole um link de deck do Moxfield ou do Archidekt');
}

/** GET JSON via o módulo https (o fetch do Node é barrado pelo anti-bot do Moxfield). */
function httpsGetJson(target: string): Promise<{ status: number; json: unknown }> {
  return new Promise((resolve, reject) => {
    const req = https.get(target, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36', Accept: 'application/json' } }, (r) => {
      const chunks: Buffer[] = [];
      r.on('data', (c: Buffer) => chunks.push(c));
      r.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        try { resolve({ status: r.statusCode ?? 0, json: body ? JSON.parse(body) : null }); } catch { resolve({ status: r.statusCode ?? 0, json: null }); }
      });
      r.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(new Error('Moxfield não respondeu a tempo')); });
  });
}

/** Moxfield: a API pública v2 devolve o deck inteiro por id; mainboard/sideboard são mapas nome → { quantity, card }. */
async function fetchMoxfieldDeck(deckUrl: string): Promise<{ name: string; cards: CountedCard[]; sideboard: CountedCard[] }> {
  const m = deckUrl.match(/moxfield\.com\/decks\/([A-Za-z0-9_-]+)/i);
  if (!m) throw new Error('URL não reconhecida — cole um link de deck do Moxfield (moxfield.com/decks/…)');
  // O fetch do Node (undici) leva 403 do anti-bot do Moxfield; o módulo https passa.
  const res = await httpsGetJson(`https://api2.moxfield.com/v2/decks/all/${m[1]}`);
  if (res.status !== 200) throw new Error(`Moxfield respondeu ${res.status}${res.status === 404 ? ' — deck não encontrado (é privado?)' : ''}`);
  const deck = res.json as {
    name?: string;
    mainboard?: Record<string, { quantity?: number; card?: { name?: string } }>;
    sideboard?: Record<string, { quantity?: number; card?: { name?: string } }>;
  };
  const list = (board?: Record<string, { quantity?: number; card?: { name?: string } }>): CountedCard[] =>
    Object.values(board ?? {}).flatMap((e) => (e.card?.name ? [{ name: e.card.name, count: e.quantity || 1 }] : []));
  return { name: deck.name ?? 'Deck', cards: list(deck.mainboard), sideboard: list(deck.sideboard) };
}

async function fetchArchidektDeck(
  deckUrl: string,
): Promise<{ name: string; cards: CountedCard[]; sideboard: CountedCard[] }> {
  const m = deckUrl.match(/archidekt\.com\/(?:api\/)?decks\/(\d+)/);
  if (!m) throw new Error('URL não reconhecida — cole um link de deck do Archidekt');
  const res = await fetch(`https://archidekt.com/api/decks/${m[1]}/`, {
    headers: { 'User-Agent': 'SlopTCG/0.1 (open source card game client)' },
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
  const sideCounts = new Map<string, number>();
  for (const entry of deck.cards ?? []) {
    const name = entry.card?.oracleCard?.name;
    if (!name) continue;
    const cats = entry.categories ?? [];
    // "Sideboard" vira o side do match; outras categorias fora do deck
    // (Maybeboard etc.) continuam ignoradas.
    if (cats.some((c) => c.toLowerCase() === 'sideboard')) {
      sideCounts.set(name, (sideCounts.get(name) ?? 0) + (entry.quantity || 1));
      continue;
    }
    if (cats.some((c) => excluded.has(c))) continue;
    counts.set(name, (counts.get(name) ?? 0) + (entry.quantity || 1));
  }
  return {
    name: deck.name ?? 'Deck',
    cards: [...counts].map(([name, count]) => ({ name, count })),
    sideboard: [...sideCounts].map(([name, count]) => ({ name, count })),
  };
}

// ---------------------------------------------- static web app (self-host)

/**
 * XMage-style self-hosting: this one process serves the built web client AND
 * the WebSocket, so a host runs `npm start` and shares http://<ip>:8080.
 */
/**
 * When packaged as a single executable, the web build is embedded as
 * base64 (injected by scripts/package.mjs) and served from memory.
 */
const EMBEDDED_WEB: Record<string, string> | undefined = (
  globalThis as { __SLOPTCG_ASSETS__?: Record<string, string> }
).__SLOPTCG_ASSETS__;

function resolveWebDir(): string {
  if (process.env.SLOPTCG_WEB_DIR) return process.env.SLOPTCG_WEB_DIR;
  try {
    return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../apps/web/dist');
  } catch {
    return path.resolve(process.cwd(), 'apps/web/dist');
  }
}
const WEB_DIR = resolveWebDir();

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

  if (EMBEDDED_WEB) {
    const key = (safe || 'index.html').replace(/\\/g, '/');
    const data = EMBEDDED_WEB[key] ?? EMBEDDED_WEB['index.html'];
    const ext = EMBEDDED_WEB[key] ? path.extname(key) : '.html';
    res.writeHead(200, { 'Content-Type': MIME[ext] ?? 'application/octet-stream' });
    res.end(Buffer.from(data, 'base64'));
    return;
  }

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
    fetchDeckByUrl(deckUrl)
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

function lanAddresses(): string[] {
  const out: string[] = [];
  for (const infos of Object.values(os.networkInterfaces())) {
    for (const info of infos ?? []) {
      if (info.family === 'IPv4' && !info.internal) out.push(info.address);
    }
  }
  return out;
}

httpServer.listen(PORT, () => {
  // ASCII only: the Windows console default codepage mangles anything else.
  const local = `http://localhost:${PORT}`;
  console.log('');
  console.log('  ==================== SlopTCG ====================');
  console.log('');
  console.log(`  Jogue em:          ${local}`);
  for (const ip of lanAddresses()) {
    console.log(`  Mande ao oponente: http://${ip}:${PORT}  (mesma rede/VPN)`);
  }
  console.log('');
  console.log('  Crie a sala, compartilhe o codigo de 5 letras e boa partida.');
  console.log('  Feche esta janela para desligar o servidor.');
  console.log('');
  // Packaged (.exe) experience: pop the browser automatically.
  if (EMBEDDED_WEB && !process.env.SLOPTCG_NO_OPEN) {
    const cmd =
      process.platform === 'win32'
        ? `start "" "${local}"`
        : process.platform === 'darwin'
          ? `open "${local}"`
          : `xdg-open "${local}"`;
    exec(cmd, () => undefined);
  }
});
