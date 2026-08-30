import type { CountedCard } from '@sloptcg/protocol';
import { CardFace } from './CardTile';

export type DeckViewMode = 'list' | 'grid';

/** ☰/🖼 switch shared by every deck-viewing surface (lobby, sideboard). */
export function DeckModeToggle({ mode, onChange }: { mode: DeckViewMode; onChange: (m: DeckViewMode) => void }) {
  return (
    <div className="deck-mode-toggle">
      <button className={mode === 'list' ? 'active' : ''} title="Ver como lista" onClick={() => onChange('list')}>
        ☰ Lista
      </button>
      <button className={mode === 'grid' ? 'active' : ''} title="Ver as cartas" onClick={() => onChange('grid')}>
        🖼 Cartas
      </button>
    </div>
  );
}

export interface DeckColumnProps {
  title: string;
  cards: CountedCard[];
  mode: DeckViewMode;
  /** When set, clicking a card calls this (used by the sideboard mover). */
  onCardClick?: (name: string) => void;
  clickHint?: string;
  emptyText?: string;
}

/** One deck column (main or sideboard), as text list or Moxfield-style grid. */
export function DeckColumn({ title, cards, mode, onCardClick, clickHint, emptyText = 'vazio' }: DeckColumnProps) {
  const total = cards.reduce((n, c) => n + c.count, 0);
  const sorted = [...cards].sort((a, b) => a.name.localeCompare(b.name));
  return (
    <div className="sb-col">
      <h4>
        {title} ({total})
      </h4>
      {cards.length === 0 && <div className="muted">{emptyText}</div>}
      {mode === 'list' &&
        sorted.map((c) => (
          <div
            key={c.name}
            className={`sb-card ${onCardClick ? '' : 'static'}`}
            title={clickHint}
            onClick={onCardClick ? () => onCardClick(c.name) : undefined}
          >
            <span>
              {c.count}× {c.name}
            </span>
          </div>
        ))}
      {mode === 'grid' && (
        <div className="deck-grid">
          {sorted.map((c) => (
            <CardFace
              key={c.name}
              name={c.name}
              badge={`${c.count}×`}
              title={clickHint ? `${c.name} — ${clickHint}` : c.name}
              onClick={onCardClick ? () => onCardClick(c.name) : undefined}
            />
          ))}
        </div>
      )}
    </div>
  );
}
