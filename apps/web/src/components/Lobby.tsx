import { useState } from 'react';
import type { DeckSpec, LobbyPlayer } from '@sloptcg/protocol';
import { serverHttpBase } from '../net';
import { parseDecklist, resolveDecklist } from '../scryfall';

export interface LobbyProps {
  roomCode: string;
  you: 'p1' | 'p2';
  players: LobbyPlayer[];
  onSetDeck: (deck: DeckSpec) => void;
  onStart: () => void;
}

type DeckChoice = 'gruul' | 'azorius' | 'custom';

export function Lobby({ roomCode, you, players, onSetDeck, onStart }: LobbyProps) {
  const [choice, setChoice] = useState<DeckChoice | null>(null);
  const [customText, setCustomText] = useState('');
  const [deckUrl, setDeckUrl] = useState('');
  const [importing, setImporting] = useState(false);
  const [importInfo, setImportInfo] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const me = players.find((p) => p.playerId === you);
  const bothReady = players.length === 2 && players.every((p) => p.deckReady);

  const pickDemo = (name: 'gruul' | 'azorius') => {
    setChoice(name);
    setImportInfo(null);
    onSetDeck({ kind: 'demo', name });
  };

  const finishImport = async (
    entries: { name: string; count: number }[],
    sideboard: { name: string; count: number }[],
  ) => {
    const result = await resolveDecklist(entries);
    if (result.cards.length === 0) throw new Error('nenhuma carta encontrada no Scryfall');
    onSetDeck({ kind: 'external', cards: result.cards, sideboard });
    setChoice('custom');
    const total = result.cards.reduce((n, c) => n + c.count, 0);
    const sideTotal = sideboard.reduce((n, c) => n + c.count, 0);
    setImportInfo(
      `${total} cartas importadas${sideTotal > 0 ? ` + ${sideTotal} de sideboard` : ''}.` +
        (result.notFound.length > 0 ? ` Não encontradas: ${result.notFound.join(', ')}.` : '') +
        ' Cartas com texto reconhecido são automatizadas; as demais, modo manual.',
    );
  };

  const importCustom = async () => {
    setImporting(true);
    setImportInfo(null);
    try {
      const { main, side } = parseDecklist(customText);
      if (main.length === 0) throw new Error('cole uma lista tipo "4 Lightning Bolt"');
      await finishImport(main, side);
    } catch (err) {
      setImportInfo(`Erro: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setImporting(false);
    }
  };

  const importFromUrl = async () => {
    setImporting(true);
    setImportInfo(null);
    try {
      const res = await fetch(`${serverHttpBase()}/api/deck?url=${encodeURIComponent(deckUrl.trim())}`);
      const data = (await res.json()) as {
        name?: string;
        cards?: { name: string; count: number }[];
        sideboard?: { name: string; count: number }[];
        error?: string;
      };
      if (!res.ok || !data.cards) throw new Error(data.error ?? `servidor respondeu ${res.status}`);
      await finishImport(data.cards, data.sideboard ?? []);
      setImportInfo((prev) => `Deck "${data.name}": ${prev ?? ''}`);
    } catch (err) {
      setImportInfo(`Erro: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="screen-center">
      <div className="brand">Sala</div>
      <div
        className="room-code"
        title="Clique para copiar"
        onClick={() => {
          navigator.clipboard?.writeText(roomCode);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {roomCode}
      </div>
      <div className="muted">{copied ? 'copiado!' : 'mande este código para o seu oponente'}</div>

      <div className="home-card">
        <div className="lobby-players">
          {players.map((p) => (
            <div key={p.playerId} className="lobby-player">
              <span>
                {p.name} {p.playerId === you ? '(você)' : ''} {p.connected ? '' : '⚠ desconectado'}
              </span>
              <span>{p.deckReady ? '✅ deck pronto' : '… escolhendo deck'}</span>
            </div>
          ))}
          {players.length < 2 && <div className="lobby-player muted">aguardando oponente…</div>}
        </div>

        <div className="panel-title">Escolha seu deck</div>
        <div className="deck-options">
          <div className={`deck-option ${choice === 'gruul' ? 'chosen' : ''}`} onClick={() => pickDemo('gruul')}>
            <h4>🔴🟢 Gruul Smash</h4>
            <div className="muted">Agressivo. Criaturas grandes, Bolts, Giant Growth. 100% automatizado.</div>
          </div>
          <div className={`deck-option ${choice === 'azorius' ? 'chosen' : ''}`} onClick={() => pickDemo('azorius')}>
            <h4>⚪🔵 Azorius Wings</h4>
            <div className="muted">Voadores, fichas, counters e card advantage. 100% automatizado.</div>
          </div>
        </div>
        <details>
          <summary className="muted" style={{ cursor: 'pointer' }}>Importar deck próprio</summary>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
            <div className="row">
              <input
                placeholder="URL do Archidekt (ex.: archidekt.com/decks/123456)"
                value={deckUrl}
                onChange={(e) => setDeckUrl(e.target.value)}
              />
              <button disabled={importing || !deckUrl.trim()} onClick={importFromUrl} style={{ flex: '0 0 auto' }}>
                {importing ? '…' : 'Importar URL'}
              </button>
            </div>
            <textarea
              rows={6}
              placeholder={'…ou cole a lista (Moxfield: Export → copy):\n4 Lightning Bolt\n4 Grizzly Bears\n12 Mountain'}
              value={customText}
              onChange={(e) => setCustomText(e.target.value)}
            />
            <button disabled={importing || !customText.trim()} onClick={importCustom}>
              {importing ? 'importando…' : 'Importar lista'}
            </button>
            {importInfo && <div className="muted">{importInfo}</div>}
          </div>
        </details>

        {you === 'p1' ? (
          <button className="primary" disabled={!bothReady} onClick={onStart}>
            {bothReady ? 'Começar partida' : 'aguardando decks…'}
          </button>
        ) : (
          <div className="muted" style={{ textAlign: 'center' }}>
            {me?.deckReady ? 'aguardando o anfitrião começar…' : 'escolha um deck acima'}
          </div>
        )}
      </div>
    </div>
  );
}
