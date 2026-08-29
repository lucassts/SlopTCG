import { useEffect, useRef, useState } from 'react';
import type { DeckSpec, GameView, LobbyPlayer, PlayerAction, ServerMessage } from '@slopmtg/protocol';
import { GameBoard } from './components/GameBoard';
import { Home } from './components/Home';
import { Lobby } from './components/Lobby';
import { eventText } from './logText';
import { clearSession, loadSession, NetClient, saveSession, type Session } from './net';

type Screen = 'home' | 'lobby' | 'game';

export function App() {
  const netRef = useRef<NetClient | null>(null);
  const [screen, setScreen] = useState<Screen>('home');
  const [connecting, setConnecting] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [lobbyPlayers, setLobbyPlayers] = useState<LobbyPlayer[]>([]);
  const [view, setView] = useState<GameView | null>(null);
  const [syncSeq, setSyncSeq] = useState(0);
  const [log, setLog] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const viewRef = useRef<GameView | null>(null);

  const showError = (message: string) => {
    setError(message);
    setTimeout(() => setError(null), 4000);
  };

  const handleMessage = (msg: ServerMessage) => {
    switch (msg.type) {
      case 'roomCreated':
      case 'roomJoined': {
        const s: Session = { roomCode: msg.roomCode, token: msg.token, playerId: msg.playerId };
        setSession(s);
        saveSession(s);
        setScreen((prev) => (prev === 'game' ? 'game' : 'lobby'));
        return;
      }
      case 'lobbyUpdate':
        setLobbyPlayers(msg.players);
        return;
      case 'sync': {
        viewRef.current = msg.view;
        setView(msg.view);
        setSyncSeq((n) => n + 1);
        setScreen('game');
        if (msg.events.length > 0) {
          setLog((prev) => {
            const lines = msg.events
              .map((ev) => eventText(ev, msg.view))
              .filter((l): l is string => l !== null);
            return [...prev, ...lines].slice(-400);
          });
        }
        return;
      }
      case 'serverError':
        showError(msg.message);
        return;
    }
  };

  const connect = async (): Promise<NetClient> => {
    if (netRef.current?.connected) return netRef.current;
    const net = new NetClient();
    net.onMessage = handleMessage;
    net.onStatus = (status) => {
      if (status === 'closed') {
        // tenta reconectar com a sessão salva
        const saved = loadSession();
        if (saved && screenRef.current !== 'home') {
          setTimeout(async () => {
            try {
              await net.connect();
              net.send({ type: 'rejoin', roomCode: saved.roomCode, token: saved.token });
            } catch {
              showError('conexão perdida — tentando de novo…');
            }
          }, 1500);
        }
      }
    };
    setConnecting(true);
    try {
      await net.connect();
      netRef.current = net;
      return net;
    } finally {
      setConnecting(false);
    }
  };

  const screenRef = useRef(screen);
  useEffect(() => {
    screenRef.current = screen;
  }, [screen]);

  // Reconexão automática ao abrir a página com sessão salva.
  useEffect(() => {
    const saved = loadSession();
    if (!saved) return;
    connect()
      .then((net) => net.send({ type: 'rejoin', roomCode: saved.roomCode, token: saved.token }))
      .catch(() => clearSession());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const createRoom = async (name: string) => {
    try {
      (await connect()).send({ type: 'createRoom', playerName: name });
    } catch (err) {
      showError(err instanceof Error ? err.message : 'falha ao conectar');
    }
  };

  const joinRoom = async (name: string, code: string) => {
    try {
      (await connect()).send({ type: 'joinRoom', roomCode: code, playerName: name });
    } catch (err) {
      showError(err instanceof Error ? err.message : 'falha ao conectar');
    }
  };

  const exitToHome = () => {
    clearSession();
    netRef.current?.close();
    netRef.current = null;
    setSession(null);
    setView(null);
    setLog([]);
    setLobbyPlayers([]);
    setScreen('home');
  };

  const sendAction = (action: PlayerAction) => {
    netRef.current?.send({ type: 'action', action });
  };

  return (
    <>
      {screen === 'home' && <Home onCreate={createRoom} onJoin={joinRoom} connecting={connecting} />}
      {screen === 'lobby' && session && (
        <Lobby
          roomCode={session.roomCode}
          you={session.playerId}
          players={lobbyPlayers}
          onSetDeck={(deck: DeckSpec) => netRef.current?.send({ type: 'setDeck', deck })}
          onStart={() => netRef.current?.send({ type: 'startGame' })}
        />
      )}
      {screen === 'game' && view && (
        <GameBoard view={view} syncSeq={syncSeq} log={log} onAction={sendAction} onExit={exitToHome} />
      )}
      {error && <div className="error-toast">{error}</div>}
    </>
  );
}
