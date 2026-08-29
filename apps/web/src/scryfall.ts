/**
 * Scryfall integration: card images by name and decklist resolution.
 * All Wizards card data stays out of the repo — fetched at runtime, cached
 * by the service worker / localStorage.
 */
import type { ExternalCard } from '@slopmtg/protocol';

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

/** Parse "4 Lightning Bolt" style decklists (also "4x", ignores blanks/comments). */
export function parseDecklist(text: string): { name: string; count: number }[] {
  const out: { name: string; count: number }[] = [];
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('//') || line.startsWith('#')) continue;
    const m = line.match(/^(\d+)x?\s+(.+)$/i);
    if (m) out.push({ count: parseInt(m[1], 10), name: m[2].trim() });
    else out.push({ count: 1, name: line });
  }
  return out;
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
      body: JSON.stringify({ identifiers: batch.map((e) => ({ name: e.name })) }),
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
