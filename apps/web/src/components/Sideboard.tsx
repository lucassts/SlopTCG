import { useEffect, useState } from 'react';
import type { CountedCard, MatchStateMsg, PlayerId } from '@sloptcg/protocol';
import { DeckColumn, DeckModeToggle, type DeckViewMode } from './DeckView';

export interface SideboardProps {
  info: { main: CountedCard[]; side: CountedCard[]; ready: boolean; opponentReady: boolean };
  match: MatchStateMsg;
  you: PlayerId;
  onSubmit: (main: CountedCard[]) => void;
  onReady: () => void;
}

function loadMode(): DeckViewMode {
  try {
    return localStorage.getItem('sloptcg-deckmode') === 'grid' ? 'grid' : 'list';
  } catch {
    return 'list';
  }
}

/** Between match games: move cards between mainboard and sideboard. */
export function Sideboard({ info, match, you, onSubmit, onReady }: SideboardProps) {
  const [main, setMain] = useState<CountedCard[]>(info.main);
  const [side, setSide] = useState<CountedCard[]>(info.side);
  const [dirty, setDirty] = useState(false);
  const [mode, setMode] = useState<DeckViewMode>(loadMode);

  // O servidor confirma cada mudança reenviando o estado — ressincroniza.
  useEffect(() => {
    setMain(info.main);
    setSide(info.side);
    setDirty(false);
  }, [info.main, info.side]);

  const saveMode = (m: DeckViewMode) => {
    setMode(m);
    try {
      localStorage.setItem('sloptcg-deckmode', m);
    } catch {
      // localStorage indisponível: preferência só vale para a sessão
    }
  };

  const oppId: PlayerId = you === 'p1' ? 'p2' : 'p1';

  const move = (from: CountedCard[], to: CountedCard[], name: string): [CountedCard[], CountedCard[]] => {
    const src = from
      .map((c) => (c.name === name ? { ...c, count: c.count - 1 } : c))
      .filter((c) => c.count > 0);
    const existing = to.find((c) => c.name === name);
    const dst = existing
      ? to.map((c) => (c.name === name ? { ...c, count: c.count + 1 } : c))
      : [...to, { name, count: 1 }];
    return [src, dst];
  };

  const toSide = (name: string) => {
    const [m, s] = move(main, side, name);
    setMain(m);
    setSide(s);
    setDirty(true);
  };
  const toMain = (name: string) => {
    const [s, m] = move(side, main, name);
    setSide(s);
    setMain(m);
    setDirty(true);
  };

  const confirm = () => {
    if (dirty) onSubmit(main);
    onReady();
  };

  return (
    <div className="screen-center">
      <div className="brand">
        Sideboard
        <small>
          Jogo {match.gameNumber} encerrado · placar {match.wins[you]}–{match.wins[oppId]}
        </small>
      </div>
      <div className="home-card" style={{ width: mode === 'grid' ? 'min(1100px, 96vw)' : 'min(720px, 94vw)' }}>
        <DeckModeToggle mode={mode} onChange={saveMode} />
        <div className="sb-columns">
          <DeckColumn title="Deck" cards={main} mode={mode} onCardClick={toSide} clickHint="mover para o sideboard" />
          <DeckColumn title="Sideboard" cards={side} mode={mode} onCardClick={toMain} clickHint="mover para o deck" />
        </div>
        <button className="primary" disabled={info.ready && !dirty} onClick={confirm}>
          {info.ready && !dirty ? 'Aguardando o oponente…' : `Pronto para o jogo ${match.gameNumber + 1}`}
        </button>
        <div className="muted" style={{ textAlign: 'center' }}>
          {info.opponentReady ? 'O oponente já está pronto.' : 'O oponente ainda está ajustando o deck.'}
          {' '}Quem perdeu o jogo anterior escolhe quem começa.
        </div>
      </div>
    </div>
  );
}
