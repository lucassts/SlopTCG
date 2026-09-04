import type { CardView } from '@sloptcg/protocol';
import { imageUrlById, imageUrlByName } from '../scryfall';
import { useEffect, useState } from 'react';

// ------------------------------------------------------------ hover preview
// Qualquer carta com o mouse em cima emite este evento; o <HoverPreview/>
// montado na tela mostra a carta grande num canto fixo (estilo MTGO).

const HOVER_EVENT = 'sloptcg-hover';

function emitHover(url: string | null) {
  window.dispatchEvent(new CustomEvent<string | null>(HOVER_EVENT, { detail: url }));
}

/** Fixed enlarged preview of whatever card is under the mouse. */
export function HoverPreview() {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const onHover = (e: Event) => setUrl((e as CustomEvent<string | null>).detail);
    window.addEventListener(HOVER_EVENT, onHover);
    return () => window.removeEventListener(HOVER_EVENT, onHover);
  }, []);
  // Slot fixo no topo do painel lateral (acima do log/chat): a carta grande aparece aqui.
  return (
    <div className="preview-slot" title={url ? '' : 'Passe o mouse sobre uma carta'}>
      {url && <img src={url} alt="" draggable={false} />}
    </div>
  );
}

const COLOR_FRAMES: Record<string, string> = {
  W: '#e8e2d0',
  U: '#3b6ea5',
  B: '#3a3542',
  R: '#a33b2e',
  G: '#3d6b45',
};

export function frameColor(colors: string[]): string {
  if (colors.length === 0) return '#8a8f9c';
  if (colors.length > 1) return '#b5985a';
  return COLOR_FRAMES[colors[0]] ?? '#8a8f9c';
}

export interface CardTileProps {
  card: CardView;
  size?: 'hand' | 'field';
  selected?: boolean;
  targetable?: boolean;
  dimmed?: boolean;
  /** Rendered tucked behind the card it is attached to (aura/equipment). */
  attachment?: boolean;
  onClick?: (e: React.MouseEvent) => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  title?: string;
}

/** A card on the table: Scryfall image when available, text frame as fallback. */
export function CardTile({ card, size = 'field', selected, targetable, dimmed, attachment, onClick, onContextMenu, title }: CardTileProps) {
  const [imgFailed, setImgFailed] = useState(false);
  const def = card.card;
  // Leva 5b: verso de cartas dupla-face (transform / MDFC / batalha) tem imagem própria no Scryfall.
  const backImage = !!def.isBackFace && (def.faceLayout === 'transform' || def.faceLayout === 'modal_dfc' || def.faceLayout === 'battle');
  const url = card.isToken && !def.scryfallId
    ? null
    : def.scryfallId
      ? imageUrlById(def.scryfallId, backImage)
      : imageUrlByName(def.name);

  const classes = [
    'card-tile',
    size === 'hand' ? 'card-hand' : 'card-field',
    card.tapped ? 'tapped' : '',
    selected ? 'selected' : '',
    targetable ? 'targetable' : '',
    dimmed ? 'dimmed' : '',
    card.attacking ? 'attacking' : '',
    attachment ? 'attached-tile' : '',
  ].filter(Boolean).join(' ');

  return (
    <div
      className={classes}
      onClick={onClick}
      onContextMenu={onContextMenu}
      title={title ?? tooltip(card)}
      onMouseEnter={() => url && !imgFailed && emitHover(url)}
      onMouseLeave={() => emitHover(null)}
    >
      {url && !imgFailed ? (
        <img src={url} alt={def.name} loading="lazy" draggable={false} onError={() => setImgFailed(true)} />
      ) : (
        <div className="card-fallback" style={{ borderColor: frameColor(def.colors) }}>
          <div className="cf-name">{def.name}</div>
          {def.manaCost && <div className="cf-cost">{def.manaCost}</div>}
          <div className="cf-type">{def.types.join(' ')}{def.subtypes.length > 0 ? ` — ${def.subtypes.join(' ')}` : ''}</div>
          {def.text && <div className="cf-text">{def.text}</div>}
        </div>
      )}
      {card.power !== null && (
        <div className={`card-pt ${card.damage > 0 ? 'damaged' : ''}`}>
          {card.power}/{(card.toughness ?? 0) - card.damage < (card.toughness ?? 0) ? `${(card.toughness ?? 0) - card.damage}` : card.toughness}
        </div>
      )}
      {card.summoningSick && card.card.types.includes('Creature') && <div className="card-sick" title="Enjoo de invocação">💤</div>}
      {card.crewed && <div className="card-sick" title="Tripulado: é uma criatura até o fim do turno">🚗</div>}
      {Object.entries(card.counters).map(([k, v]) => (
        <div key={k} className="card-counter" title={`${v} marcador(es) de ${k}`}>{k}: {v}</div>
      ))}
      {card.blocking !== null && <div className="card-blocking">🛡</div>}
    </div>
  );
}

/**
 * A card face rendered from its definition (or bare name) — used where a
 * full CardView doesn't exist: stack pop-up, zone toasts, deck grids.
 */
export function CardFace({
  def,
  name,
  badge,
  onClick,
  title,
}: {
  def?: CardView['card'] | null;
  name?: string;
  badge?: string;
  onClick?: (e: React.MouseEvent) => void;
  title?: string;
}) {
  const [imgFailed, setImgFailed] = useState(false);
  const cardName = def?.name ?? name ?? '?';
  const url = def?.scryfallId ? imageUrlById(def.scryfallId) : imageUrlByName(cardName);

  return (
    <div
      className="card-face"
      onClick={onClick}
      title={title ?? cardName}
      onMouseEnter={() => !imgFailed && emitHover(url)}
      onMouseLeave={() => emitHover(null)}
    >
      {!imgFailed ? (
        <img src={url} alt={cardName} loading="lazy" draggable={false} onError={() => setImgFailed(true)} />
      ) : (
        <div className="card-fallback" style={{ borderColor: frameColor(def?.colors ?? []) }}>
          <div className="cf-name">{cardName}</div>
          {def?.manaCost && <div className="cf-cost">{def.manaCost}</div>}
          {def && (
            <div className="cf-type">
              {def.types.join(' ')}
              {def.subtypes.length > 0 ? ` — ${def.subtypes.join(' ')}` : ''}
            </div>
          )}
          {def?.text && <div className="cf-text">{def.text}</div>}
        </div>
      )}
      {badge && <div className="card-count-badge">{badge}</div>}
    </div>
  );
}

function tooltip(card: CardView): string {
  const d = card.card;
  const parts = [d.name];
  if (d.manaCost) parts.push(d.manaCost);
  parts.push(d.types.join(' ') + (d.subtypes.length > 0 ? ` — ${d.subtypes.join(' ')}` : ''));
  if (d.text) parts.push(d.text);
  if (d.automation === 'manual') parts.push('⚠ carta em modo manual (mecânica ainda não automatizada)');
  if (d.automation === 'partial')
    parts.push(
      '⚠ parcialmente automatizada — ajuste manualmente:\n' +
        (d.automationNotes ?? []).map((n) => `• ${n}`).join('\n'),
    );
  return parts.join('\n');
}
