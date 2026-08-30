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
  /** Drag & drop: this column's id; cards become draggable and the column a drop target. */
  dragId?: string;
  onDropCard?: (name: string, fromColumn: string) => void;
}

const DRAG_MIME = 'application/x-sloptcg-card';

/** One deck column (main or sideboard), as text list or Moxfield-style grid. */
export function DeckColumn({
  title,
  cards,
  mode,
  onCardClick,
  clickHint,
  emptyText = 'vazio',
  dragId,
  onDropCard,
}: DeckColumnProps) {
  const total = cards.reduce((n, c) => n + c.count, 0);
  const sorted = [...cards].sort((a, b) => a.name.localeCompare(b.name));

  const dragProps = (name: string) =>
    dragId
      ? {
          draggable: true,
          onDragStart: (e: React.DragEvent) => {
            e.dataTransfer.setData(DRAG_MIME, JSON.stringify({ name, from: dragId }));
            e.dataTransfer.effectAllowed = 'move';
          },
        }
      : {};

  const dropProps = dragId && onDropCard
    ? {
        onDragOver: (e: React.DragEvent) => {
          if (e.dataTransfer.types.includes(DRAG_MIME)) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
          }
        },
        onDrop: (e: React.DragEvent) => {
          const raw = e.dataTransfer.getData(DRAG_MIME);
          if (!raw) return;
          e.preventDefault();
          try {
            const { name, from } = JSON.parse(raw) as { name: string; from: string };
            if (from !== dragId) onDropCard(name, from);
          } catch {
            // payload estranho: ignora o drop
          }
        },
      }
    : {};

  return (
    <div className="sb-col" {...dropProps}>
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
            {...dragProps(c.name)}
          >
            <span>
              {c.count}× {c.name}
            </span>
          </div>
        ))}
      {mode === 'grid' && (
        <div className="deck-grid">
          {sorted.map((c) => (
            <div key={c.name} className="deck-grid-card" {...dragProps(c.name)}>
              <CardFace
                name={c.name}
                badge={`${c.count}×`}
                title={clickHint ? `${c.name} — ${clickHint}` : c.name}
                onClick={onCardClick ? () => onCardClick(c.name) : undefined}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
