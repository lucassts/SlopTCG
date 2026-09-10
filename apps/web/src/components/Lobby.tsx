import { useEffect, useRef, useState } from 'react';
import { t, useLang } from '../i18n';
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
  useLang();
  const [customText, setCustomText] = useState('');
  const [deckUrl, setDeckUrl] = useState('');
  const [importing, setImporting] = useState(false);
  const [importInfo, setImportInfo] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // Link público (túnel): só o host, servido por localhost, pode abrir.
  const isHost = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  const [tunnel, setTunnel] = useState<{ status: string; url?: string; error?: string; detail?: string } | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const refreshTunnel = async () => {
    try { const r = await fetch(`${serverHttpBase()}/api/tunnel`); if (r.ok) setTunnel(await r.json()); } catch { /* servidor fora */ }
  };
  const startTunnel = async () => {
    setTunnel({ status: 'starting', detail: t('preparando…') });
    try { const r = await fetch(`${serverHttpBase()}/api/tunnel`, { method: 'POST' }); setTunnel(await r.json()); } catch (e) { setTunnel({ status: 'error', error: e instanceof Error ? e.message : t('falha') }); }
  };
  const stopTunnel = async () => { try { const r = await fetch(`${serverHttpBase()}/api/tunnel`, { method: 'DELETE' }); setTunnel(await r.json()); } catch { /* ignora */ } };
  useEffect(() => {
    if (!isHost) return;
    void refreshTunnel();
    const timer = setInterval(() => { void refreshTunnel(); }, 2000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHost]);
  const publicLink = tunnel?.status === 'on' && tunnel.url ? `${tunnel.url}/?sala=${roomCode}` : null;
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
    if (result.cards.length === 0) throw new Error(t('nenhuma carta encontrada no Scryfall'));
    onSetDeck({ kind: 'external', cards: result.cards, sideboard });
    setPreview({ main: result.cards.map((c) => ({ name: c.name, count: c.count })), side: sideboard });
    const total = result.cards.reduce((n, c) => n + c.count, 0);
    const sideTotal = sideboard.reduce((n, c) => n + c.count, 0);
    setImportInfo(
      `${t('{total} cartas importadas', { total })}${sideTotal > 0 ? ` ${t('+ {n} de sideboard', { n: sideTotal })}` : ''}.` +
        (result.notFound.length > 0 ? ` ${t('Não encontradas: {names}.', { names: result.notFound.join(', ') })}` : '') +
        ` ${t('Cartas com texto reconhecido são automatizadas; as demais, modo manual.')}`,
    );
  };

  const importText = async (text: string) => {
    setImporting(true);
    setImportInfo(null);
    try {
      const { main, side } = parseDecklist(text);
      if (main.length === 0) throw new Error(t('nenhuma carta reconhecida — use linhas como "4 Lightning Bolt"'));
      const mainTotal = main.reduce((n, c) => n + c.count, 0);
      const sideTotal = side.reduce((n, c) => n + c.count, 0);
      if (mainTotal < 60) throw new Error(t('deck com {n} cartas — precisa de pelo menos 60', { n: mainTotal }));
      if (sideTotal > 15) throw new Error(t('sideboard com {n} cartas — o máximo é 15', { n: sideTotal }));
      if (sideTotal > 0 && sideTotal < 15) throw new Error(t('sideboard com {n} cartas — precisa ter 15 (ou nenhum)', { n: sideTotal }));
      await finishImport(main, side);
    } catch (err) {
      setImportInfo(t('Erro: {msg}', { msg: err instanceof Error ? err.message : String(err) }));
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
      setImportInfo(t('Erro: não consegui ler o arquivo'));
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
      if (!res.ok || !data.cards) throw new Error(data.error ?? t('servidor respondeu {status}', { status: res.status }));
      await finishImport(data.cards, data.sideboard ?? []);
      setImportInfo((prev) => t('Deck "{name}": {rest}', { name: data.name ?? '', rest: prev ?? '' }));
    } catch (err) {
      setImportInfo(t('Erro: {msg}', { msg: err instanceof Error ? err.message : String(err) }));
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="screen-center">
      <HoverPreview />
      <div className="brand">{t('Sala')}</div>
      <div
        className="room-code"
        title={t('Clique para copiar')}
        onClick={() => {
          navigator.clipboard?.writeText(roomCode);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {roomCode}
      </div>
      <div className="muted">{copied ? t('copiado!') : t('mande este código para o seu oponente')}</div>
      {isHost && (
        <div className="home-card" style={{ marginTop: 10 }}>
          <div className="panel-title">{t('Jogar pela internet')}</div>
          {publicLink ? (
            <>
              <div
                className="room-code"
                style={{ fontSize: 14, letterSpacing: 0, wordBreak: 'break-all', cursor: 'pointer' }}
                title={t('Clique para copiar')}
                onClick={() => { navigator.clipboard?.writeText(publicLink); setLinkCopied(true); setTimeout(() => setLinkCopied(false), 1500); }}
              >
                {publicLink}
              </div>
              <div className="muted">{linkCopied ? t('link copiado!') : t('mande este link ao oponente — ele abre o jogo já com o código da sala. O link vale enquanto o SlopTCG estiver aberto.')}</div>
              <button onClick={() => void stopTunnel()}>{t('Desligar o link')}</button>
            </>
          ) : (
            <>
              <div className="muted">
                {tunnel?.status === 'error'
                  ? t('Não deu: {error}', { error: tunnel.error ?? t('erro') })
                  : tunnel?.status === 'downloading' || tunnel?.status === 'starting'
                    ? tunnel.detail ?? t('preparando…')
                    : t('Gera um link https temporário para o oponente entrar de qualquer lugar, sem VPN nem porta no roteador (túnel da Cloudflare, sem conta).')}
              </div>
              <button className="primary" disabled={tunnel?.status === 'downloading' || tunnel?.status === 'starting'} onClick={() => void startTunnel()}>
                {tunnel?.status === 'downloading' || tunnel?.status === 'starting' ? '…' : t('🌐 Gerar link público')}
              </button>
            </>
          )}
        </div>
      )}

      <div className="home-card">
        <div className="lobby-players">
          {players.map((p) => (
            <div key={p.playerId} className="lobby-player">
              <span>
                {p.name} {p.playerId === you ? t('(você)') : ''} {p.connected ? '' : t('⚠ desconectado')}
              </span>
              <span>
                {p.ready ? t('🟢 pronto') : p.deckReady ? t('🃏 deck escolhido') : t('… escolhendo deck')}
              </span>
            </div>
          ))}
          {players.length < 2 && <div className="lobby-player muted">{t('aguardando oponente…')}</div>}
        </div>

        <div className="panel-title">{t('Importe seu deck')}</div>
        <div className="row">
          <input
            placeholder={t('URL do Moxfield ou do Archidekt (ex.: moxfield.com/decks/abc123)')}
            value={deckUrl}
            onChange={(e) => setDeckUrl(e.target.value)}
          />
          <button disabled={importing || !deckUrl.trim()} onClick={() => void importFromUrl()} style={{ flex: '0 0 auto' }}>
            {importing ? '…' : t('Importar URL')}
          </button>
        </div>
        <textarea
          rows={6}
          placeholder={t('…cole a lista (Moxfield, MTGO ou Arena):\n4 Lightning Bolt\n4 Grizzly Bears\n12 Mountain\nSideboard\n2 Pyroclasm')}
          value={customText}
          onChange={(e) => setCustomText(e.target.value)}
        />
        <div className="row">
          <button disabled={importing || !customText.trim()} onClick={() => void importText(customText)}>
            {importing ? t('importando…') : t('Importar lista')}
          </button>
          <button disabled={importing} onClick={() => fileRef.current?.click()}>
            {t('📄 Enviar arquivo .txt')}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".txt,.dec,.dek,.mwdeck,.cod,.csv,text/plain"
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
              {t('Ver deck')} ({preview.main.reduce((n, c) => n + c.count, 0)}
              {preview.side.length > 0 ? ` + ${preview.side.reduce((n, c) => n + c.count, 0)} sb` : ''})
            </summary>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
              <DeckModeToggle mode={previewMode} onChange={setPreviewMode} />
              <div className="sb-columns">
                <DeckColumn title={t('Deck')} cards={preview.main} mode={previewMode} />
                {preview.side.length > 0 && <DeckColumn title={t('Sideboard')} cards={preview.side} mode={previewMode} />}
              </div>
            </div>
          </details>
        )}

        {you === 'p1' ? (
          <>
            <button className="primary" disabled={!bothReady || !oppReady} onClick={onStart}>
              {!bothReady
                ? t('aguardando os decks…')
                : !oppReady
                  ? t('aguardando {name} ficar pronto…', { name: opp?.name ?? t('o oponente') })
                  : t('Começar partida')}
            </button>
            {bothReady && !oppReady && (
              <div className="muted" style={{ textAlign: 'center' }}>
                {t('O oponente escolheu um deck mas ainda não confirmou que está pronto.')}
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
              {me?.ready ? t('Cancelar (trocar de deck)') : t('✅ Estou pronto')}
            </button>
            <div className="muted" style={{ textAlign: 'center' }}>
              {!me?.deckReady
                ? t('importe um deck acima')
                : me.ready
                  ? t('pronto! aguardando o anfitrião começar…')
                  : t('confirme quando terminar de escolher o deck')}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
