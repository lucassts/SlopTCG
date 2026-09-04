import { useRef, useState } from 'react';
import type { CountedCard, DeckSpec, LobbyPlayer } from '@sloptcg/protocol';
import { serverHttpBase } from '../net';
import { parseDecklist, resolveDecklist } from '../scryfall';
import { HoverPreview } from './CardTile';
import { DeckColumn, DeckModeToggle, type DeckViewMode } from './DeckView';

export interface LobbyProps {
  roomCode: string;
  you: 'p1' | 'p2';
  players: LobbyPlayer[];
  onSetDeck: (deck: DeckSpec) => void;
  onReady: (ready: boolean) => void;
  onStart: () => void;
}

export function Lobby({ roomCode, you, players, onSetDeck, onReady, onStart }: LobbyProps) {
  const [customText, setCustomText] = useState('');
  const [deckUrl, setDeckUrl] = useState('');
  const [importing, setImporting] = useState(false);
  const [importInfo, setImportInfo] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [preview, setPreview] = useState<{ main: CountedCard[]; side: CountedCard[] } | null>(null);
  const [previewMode, setPreviewMode] = useState<DeckViewMode>('list');
  const fileRef = useRef<HTMLInputElement>(null);

  const me = players.find((p) => p.playerId === you);
  const opp = players.find((p) => p.playerId !== you);
  const bothReady = players.length === 2 && players.every((p) => p.deckReady);
  const oppReady = opp?.ready ?? false;

  const finishImport = async (
    entries: { name: string; count: number }[],
    sideboard: { name: string; count: number }[],
  ) => {
    const result = await resolveDecklist(entries);
    if (result.cards.length === 0) throw new Error('nenhuma carta encontrada no Scryfall');
    onSetDeck({ kind: 'external', cards: result.cards, sideboard });
    setPreview({ main: result.cards.map((c) => ({ name: c.name, count: c.count })), side: sideboard });
    const total = result.cards.reduce((n, c) => n + c.count, 0);
    const sideTotal = sideboard.reduce((n, c) => n + c.count, 0);
    setImportInfo(
      `${total} cartas importadas${sideTotal > 0 ? ` + ${sideTotal} de sideboard` : ''}.` +
        (result.notFound.length > 0 ? ` Não encontradas: ${result.notFound.join(', ')}.` : '') +
        ' Cartas com texto reconhecido são automatizadas; as demais, modo manual.',
    );
  };

  const importText = async (text: string) => {
    setImporting(true);
    setImportInfo(null);
    try {
      const { main, side } = parseDecklist(text);
      if (main.length === 0) throw new Error('nenhuma carta reconhecida — use linhas como "4 Lightning Bolt"');
      await finishImport(main, side);
    } catch (err) {
      setImportInfo(`Erro: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setImporting(false);
    }
  };

  const importFile = (file: File) => {
    setImporting(true);
    setImportInfo(null);
    const reader = new FileReader();
    reader.onload = () => void importText(String(reader.result ?? ''));
    reader.onerror = () => {
      setImportInfo('Erro: não consegui ler o arquivo');
      setImporting(false);
    };
    reader.readAsText(file);
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
      <HoverPreview />
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
              <span>
                {p.ready ? '🟢 pronto' : p.deckReady ? '🃏 deck escolhido' : '… escolhendo deck'}
              </span>
            </div>
          ))}
          {players.length < 2 && <div className="lobby-player muted">aguardando oponente…</div>}
        </div>

        <div className="panel-title">Importe seu deck</div>
        <div className="row">
          <input
            placeholder="URL do Moxfield ou do Archidekt (ex.: moxfield.com/decks/abc123)"
            value={deckUrl}
            onChange={(e) => setDeckUrl(e.target.value)}
          />
          <button disabled={importing || !deckUrl.trim()} onClick={() => void importFromUrl()} style={{ flex: '0 0 auto' }}>
            {importing ? '…' : 'Importar URL'}
          </button>
        </div>
        <textarea
          rows={6}
          placeholder={'…cole a lista (Moxfield, MTGO ou Arena):\n4 Lightning Bolt\n4 Grizzly Bears\n12 Mountain\nSideboard\n2 Pyroclasm'}
          value={customText}
          onChange={(e) => setCustomText(e.target.value)}
        />
        <div className="row">
          <button disabled={importing || !customText.trim()} onClick={() => void importText(customText)}>
            {importing ? 'importando…' : 'Importar lista'}
          </button>
          <button disabled={importing} onClick={() => fileRef.current?.click()}>
            📄 Enviar arquivo .txt
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".txt,.dec,.dek,text/plain"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) importFile(f);
              e.target.value = '';
            }}
          />
        </div>
        {importInfo && <div className="muted">{importInfo}</div>}

        {preview && (
          <details className="deck-preview">
            <summary className="muted" style={{ cursor: 'pointer' }}>
              Ver deck ({preview.main.reduce((n, c) => n + c.count, 0)}
              {preview.side.length > 0 ? ` + ${preview.side.reduce((n, c) => n + c.count, 0)} sb` : ''})
            </summary>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
              <DeckModeToggle mode={previewMode} onChange={setPreviewMode} />
              <div className="sb-columns">
                <DeckColumn title="Deck" cards={preview.main} mode={previewMode} />
                {preview.side.length > 0 && <DeckColumn title="Sideboard" cards={preview.side} mode={previewMode} />}
              </div>
            </div>
          </details>
        )}

        {you === 'p1' ? (
          <>
            <button className="primary" disabled={!bothReady || !oppReady} onClick={onStart}>
              {!bothReady
                ? 'aguardando os decks…'
                : !oppReady
                  ? `aguardando ${opp?.name ?? 'o oponente'} ficar pronto…`
                  : 'Começar partida'}
            </button>
            {bothReady && !oppReady && (
              <div className="muted" style={{ textAlign: 'center' }}>
                O oponente escolheu um deck mas ainda não confirmou que está pronto.
              </div>
            )}
          </>
        ) : (
          <>
            <button
              className={me?.ready ? '' : 'primary'}
              disabled={!me?.deckReady}
              onClick={() => onReady(!(me?.ready ?? false))}
            >
              {me?.ready ? 'Cancelar (trocar de deck)' : '✅ Estou pronto'}
            </button>
            <div className="muted" style={{ textAlign: 'center' }}>
              {!me?.deckReady
                ? 'importe um deck acima'
                : me.ready
                  ? 'pronto! aguardando o anfitrião começar…'
                  : 'confirme quando terminar de escolher o deck'}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
