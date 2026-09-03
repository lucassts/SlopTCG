/** Shared vocabulary for the oracle parser and the compositional grammar. */
import type { CardType, Color, Keyword } from '../types.js';
import type { FilterSpec } from './types.js';

export const BASIC_TYPES = ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'];

export const KEYWORDS: Record<string, Keyword> = {
  flying: 'flying',
  reach: 'reach',
  haste: 'haste',
  vigilance: 'vigilance',
  trample: 'trample',
  lifelink: 'lifelink',
  deathtouch: 'deathtouch',
  defender: 'defender',
  menace: 'menace',
  'first strike': 'firstStrike',
  'double strike': 'doubleStrike',
  indestructible: 'indestructible',
  hexproof: 'hexproof',
  shroud: 'shroud',
  flash: 'flash',
  fear: 'fear',
  intimidate: 'intimidate',
  shadow: 'shadow',
  plainswalk: 'plainswalk',
  islandwalk: 'islandwalk',
  swampwalk: 'swampwalk',
  mountainwalk: 'mountainwalk',
  forestwalk: 'forestwalk',
  changeling: 'changeling',
  partner: 'partner',
  horsemanship: 'horsemanship',
};

export const COLOR_WORDS: Record<string, Color> = {
  white: 'W',
  blue: 'U',
  black: 'B',
  red: 'R',
  green: 'G',
};

export const NUMBER_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
};

export function num(word: string): number | null {
  if (/^\d+$/.test(word)) return parseInt(word, 10);
  return NUMBER_WORDS[word.toLowerCase()] ?? null;
}

export function keywordList(text: string): Keyword[] | null {
  const parts = text.split(/,\s*|\s+and\s+/).map((p) => p.trim().toLowerCase()).filter(Boolean);
  const out: Keyword[] = [];
  for (const p of parts) {
    const kw = KEYWORDS[p];
    if (!kw) return null;
    out.push(kw);
  }
  return out.length > 0 ? out : null;
}

export const TYPE_WORD: Record<string, FilterSpec['what']> = {
  creature: 'creature', land: 'land', artifact: 'artifact', enchantment: 'enchantment', permanent: 'permanent',
  instant: 'instant', sorcery: 'sorcery',
};

export const CARD_TYPE_WORD: Record<string, CardType> = {
  creature: 'Creature', land: 'Land', artifact: 'Artifact', enchantment: 'Enchantment', instant: 'Instant', sorcery: 'Sorcery', planeswalker: 'Planeswalker',
};
