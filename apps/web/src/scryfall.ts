/**
 * Scryfall integration: card images by name and decklist resolution.
 * All Wizards card data stays out of the repo — fetched at runtime, cached
 * by the service worker / localStorage.
 */
import type { ExternalCard } from '@sloptcg/protocol';

const API = 'https://api.scryfall.com';

/** Direct image URL by exact name (Scryfall serves the image itself). */
export function imageUrlByName(name: string): string {
  return `${API}/cards/named?exact=${encodeURIComponent(name)}&format=image&version=normal`;
}

export function imageUrlById(scryfallId: string): string {
  return `https://cards.scryfall.io/normal/front/${scryfallId.slice(0, 1)}/${scryfallId.slice(1, 2)}/${scryfallId}.jpg`;
}

interface CollectionCard {
  name: string;
  id: string;
  oracle_id: string;
  mana_cost?: string;
  type_line?: string;
  power?: string;
  toughness?: string;
  oracle_text?: string;
  card_faces?: { mana_cost?: string; type_line?: string; oracle_text?: string; power?: string; toughness?: string }[];
}

export interface DecklistResult {
  cards: ExternalCard[];
  notFound: string[];
}

/**
 * Parse "4 Lightning Bolt" style decklists (also "4x"; blanks/comments
 * ignored). A "Sideboard" line — or the MTGO "SB:" prefix — starts the
 * sideboard section.
 */
export function parseDecklist(text: string): {
  main: { name: string; count: number }[];
  side: { name: string; count: number }[];
} {
  const main: { name: string; count: number }[] = [];
  const side: { name: string; count: number }[] = [];
  let inSide = false;
  for (const rawLine of text.split('\n')) {
    let line = rawLine.trim();
    if (!line || line.startsWith('//') || line.startsWith('#')) continue;
    if (/^sideboard:?$/i.test(line)) {
      inSide = true;
      continue;
    }
    let target = inSide ? side : main;
    if (/^sb:\s*/i.test(line)) {
      target = side;
      line = line.replace(/^sb:\s*/i, '');
    }
    const m = line.match(/^(\d+)x?\s+(.+)$/i);
    if (m) target.push({ count: parseInt(m[1], 10), name: m[2].trim() });
    else target.push({ count: 1, name: line });
  }
  return { main, side };
}

/** Resolve a decklist against Scryfall's collection endpoint (batches of 75). */
export async function resolveDecklist(entries: { name: string; count: number }[]): Promise<DecklistResult> {
  const cards: ExternalCard[] = [];
  const notFound: string[] = [];
  for (let i = 0; i < entries.length; i += 75) {
    const batch = entries.slice(i, i + 75);
    const res = await fetch(`${API}/cards/collection`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Cartas dupla-face vêm como "Frente // Verso"; o Scryfall resolve pela frente.
      body: JSON.stringify({ identifiers: batch.map((e) => ({ name: e.name.split('//')[0].trim() })) }),
    });
    if (!res.ok) throw new Error(`Scryfall respondeu ${res.status}`);
    const data = (await res.json()) as { data: CollectionCard[]; not_found?: { name: string }[] };
    for (const nf of data.not_found ?? []) notFound.push(nf.name);
    for (const card of data.data) {
      const entry = batch.find((e) => e.name.toLowerCase() === card.name.toLowerCase())
        ?? batch.find((e) => card.name.toLowerCase().startsWith(e.name.toLowerCase()));
      const face = card.card_faces?.[0];
      cards.push({
        name: card.name,
        manaCost: card.mana_cost || face?.mana_cost,
        typeLine: card.type_line || face?.type_line,
        power: numOrUndef(card.power ?? face?.power),
        toughness: numOrUndef(card.toughness ?? face?.toughness),
        text: card.oracle_text || face?.oracle_text,
        scryfallId: card.id,
        oracleId: card.oracle_id,
        count: entry?.count ?? 1,
      });
    }
  }
  return { cards, notFound };
}

function numOrUndef(v: string | undefined): number | undefined {
  if (v === undefined) return undefined;
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? undefined : n;
}
