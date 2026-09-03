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

export function imageUrlById(scryfallId: string, back = false): string {
  return `https://cards.scryfall.io/normal/${back ? 'back' : 'front'}/${scryfallId.slice(0, 1)}/${scryfallId.slice(1, 2)}/${scryfallId}.jpg`;
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
 * Parse decklists in the common export formats:
 * - simple: "4 Lightning Bolt" / "4x Lightning Bolt" / bare names
 * - Moxfield / Arena: "4 Lightning Bolt (2X2) 117" (set/collector stripped),
 *   optional "Deck" / "Sideboard" section headers, foil markers "*F*"
 * - MTGO text: "SB:" prefix, or main deck + blank line + sideboard block
 * Comments (// or #) and blank lines are ignored for counting.
 */
export function parseDecklist(text: string): {
  main: { name: string; count: number }[];
  side: { name: string; count: number }[];
} {
  interface Entry { name: string; count: number; side: boolean; block: number }
  const entries: Entry[] = [];
  let inSide = false;
  let sawHeader = false;
  let block = 0;
  let blankPending = false;

  for (const rawLine of text.split('\n')) {
    let line = rawLine.trim();
    if (!line) {
      blankPending = entries.length > 0;
      continue;
    }
    if (line.startsWith('//') || line.startsWith('#')) continue;
    if (/^(deck|main|maindeck|mainboard|companion|commander):?$/i.test(line)) {
      sawHeader = true;
      inSide = false;
      blankPending = false;
      continue;
    }
    if (/^sideboard:?$/i.test(line)) {
      sawHeader = true;
      inSide = true;
      blankPending = false;
      continue;
    }
    if (blankPending) {
      block += 1;
      blankPending = false;
    }
    let side = inSide;
    if (/^sb:\s*/i.test(line)) {
      side = true;
      sawHeader = true;
      line = line.replace(/^sb:\s*/i, '');
    }
    const m = line.match(/^(\d+)x?\s+(.+)$/i);
    let count = 1;
    let name = line;
    if (m) {
      count = parseInt(m[1], 10);
      name = m[2].trim();
    }
    // Moxfield/Arena: "(SET) 123" no fim; Moxfield: marcador de foil "*F*".
    name = name
      .replace(/\s+\*[A-Za-z]+\*\s*$/, '')
      .replace(/\s+\([A-Z0-9]{2,6}\)(\s+[\w★†-]+)?\s*$/, '')
      .trim();
    if (name) entries.push({ name, count, side, block });
  }

  // MTGO text: sem cabeçalho, o bloco final após linha em branco é o
  // sideboard — mas só quando tem cara de sideboard (≤15 cartas, deck ≥ 20).
  if (!sawHeader && block > 0) {
    const lastBlock = entries.filter((e) => e.block === block);
    const rest = entries.filter((e) => e.block < block);
    const lastCount = lastBlock.reduce((n, e) => n + e.count, 0);
    const restCount = rest.reduce((n, e) => n + e.count, 0);
    if (lastCount <= 15 && restCount >= 20) for (const e of lastBlock) e.side = true;
  }

  const fold = (list: Entry[]) => {
    const out: { name: string; count: number }[] = [];
    for (const e of list) {
      const hit = out.find((o) => o.name.toLowerCase() === e.name.toLowerCase());
      if (hit) hit.count += e.count;
      else out.push({ name: e.name, count: e.count });
    }
    return out;
  };
  return { main: fold(entries.filter((e) => !e.side)), side: fold(entries.filter((e) => e.side)) };
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
