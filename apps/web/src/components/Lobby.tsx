import { useState } from 'react';
import type { DeckSpec, LobbyPlayer } from '@slopmtg/protocol';
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

  const importCustom = async () => {
    setImporting(true);
    setImportInfo(null);
    try {
      const entries = parseDecklist(customText);
      if (entries.length === 0) throw new Error('cole uma lista tipo "4 Lightning Bolt"');
      const result = await resolveDecklist(entries);
      if (result.cards.length === 0) throw new Error('nenhuma carta encontrada no Scryfall');
      onSetDeck({ kind: 'external', cards: result.cards });
      setChoice('custom');
      const total = result.cards.reduce((n, c) => n + c.count, 0);
      setImportInfo(
        `${total} cartas importadas.` +
          (result.notFound.length > 0 ? ` Não encontradas: ${result.notFound.join(', ')}.` : '') +
          ' Cartas fora do set demo entram em modo manual.',
      );
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
          <summary className="muted" style={{ cursor: 'pointer' }}>Importar deck próprio (via Scryfall)</summary>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
            <textarea
              rows={6}
              placeholder={'4 Lightning Bolt\n4 Grizzly Bears\n12 Mountain\n...'}
              value={customText}
              onChange={(e) => setCustomText(e.target.value)}
            />
            <button disabled={importing || !customText.trim()} onClick={importCustom}>
              {importing ? 'importando…' : 'Importar deck'}
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
