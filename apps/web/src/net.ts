/** WebSocket client with rejoin support. */
import type { ClientMessage, ServerMessage } from '@slopmtg/protocol';

const env = (import.meta as { env?: Record<string, string | boolean> }).env ?? {};

/**
 * Where the room server lives. In dev (vite on 5173) it's the separate
 * process on :8080; in a self-hosted build the same origin that served the
 * page IS the server (XMage-style single process).
 */
const DEFAULT_URL =
  (env.VITE_WS_URL as string | undefined) ??
  (env.DEV
    ? 'ws://localhost:8080'
    : `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`);

/** HTTP base of the room server (same host/port as the WebSocket). */
export function serverHttpBase(): string {
  return DEFAULT_URL.replace(/^ws/, 'http');
}

export interface Session {
  roomCode: string;
  token: string;
  playerId: 'p1' | 'p2';
}

export class NetClient {
  private ws: WebSocket | null = null;
  onMessage: (msg: ServerMessage) => void = () => {};
  onStatus: (status: 'connecting' | 'open' | 'closed') => void = () => {};

  connect(url: string = DEFAULT_URL): Promise<void> {
    return new Promise((resolve, reject) => {
      this.onStatus('connecting');
      const ws = new WebSocket(url);
      ws.onopen = () => {
        this.ws = ws;
        this.onStatus('open');
        resolve();
      };
      ws.onerror = () => reject(new Error('não foi possível conectar ao servidor'));
      ws.onclose = () => {
        if (this.ws === ws) {
          this.ws = null;
          this.onStatus('closed');
        }
      };
      ws.onmessage = (event) => {
        try {
          this.onMessage(JSON.parse(event.data as string) as ServerMessage);
        } catch {
          // mensagem malformada: ignorar
        }
      };
    });
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  send(msg: ClientMessage): void {
    if (this.connected) this.ws!.send(JSON.stringify(msg));
  }

  close(): void {
    this.ws?.close();
    this.ws = null;
  }
}

export function saveSession(session: Session): void {
  sessionStorage.setItem('slopmtg-session', JSON.stringify(session));
}

export function loadSession(): Session | null {
  try {
    const raw = sessionStorage.getItem('slopmtg-session');
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

export function clearSession(): void {
  sessionStorage.removeItem('slopmtg-session');
}
