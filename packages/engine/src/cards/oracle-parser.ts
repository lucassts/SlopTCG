/**
 * Oracle text → DSL compiler (automation Tier 1.5).
 *
 * Takes official card data (Scryfall shape) and, when EVERY line of rules
 * text matches a known pattern, emits a fully automated CardDefinition.
 * Anything unrecognized returns null and the card stays manual — the
 * compiler is deliberately conservative: a partially understood card would
 * be worse than a manual one.
 *
 * This is what makes "every card printed so far" playable with automation
 * growing over time: new patterns added here light up thousands of cards
 * at once, with no per-card work.
 */
import type { CardType, Color, Keyword } from '../types.js';
import type {
  AbilityDef,
  CardDefinition,
  EffectScript,
  EffectStep,
  TargetSpec,
} from './types.js';

export interface OracleInput {
  name: string;
  manaCost?: string;
  typeLine: string;
  oracleText?: string;
  power?: number;
  toughness?: number;
  colors?: Color[];
  oracleId?: string;
  scryfallId?: string;
}

const KNOWN_TYPES: CardType[] = ['Land', 'Creature', 'Artifact', 'Enchantment', 'Instant', 'Sorcery', 'Planeswalker', 'Battle'];

const KEYWORDS: Record<string, Keyword> = {
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
};

const COLOR_WORDS: Record<string, Color> = {
  white: 'W',
  blue: 'U',
  black: 'B',
  red: 'R',
  green: 'G',
};

const NUMBER_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

function num(word: string): number | null {
  if (/^\d+$/.test(word)) return parseInt(word, 10);
  return NUMBER_WORDS[word.toLowerCase()] ?? null;
}

function parseTypeLine(typeLine: string): { supertypes: string[]; types: CardType[]; subtypes: string[] } {
  const [left, right] = typeLine.split(/\s+—\s+/);
  const words = (left ?? '').trim().split(/\s+/);
  const types = words.filter((w) => KNOWN_TYPES.includes(w as CardType)) as CardType[];
  const supertypes = words.filter((w) => ['Basic', 'Legendary', 'Snow', 'World'].includes(w));
  const subtypes = right ? right.trim().split(/\s+/) : [];
  return { supertypes, types, subtypes };
}

interface ParseState {
  keywords: Keyword[];
  protectionFrom: Color[];
  entersTapped: boolean;
  cyclingMana?: string;
  flashbackCost?: string;
  abilities: AbilityDef[];
  spellTargets: TargetSpec[];
  spellEffect: EffectStep[];
  enchant?: { what: 'creature' };
  attachEffect?: { power?: number; toughness?: number; keywords?: Keyword[] };
  equipCost?: string;
}

/** Parse one simple effect clause (no targets). Returns null if unknown. */
function parseSimpleEffect(clause: string): EffectStep[] | null {
  let m: RegExpMatchArray | null;
  if ((m = clause.match(/^draw (\w+) cards?$/i))) {
    const n = num(m[1]);
    return n === null ? null : [{ op: 'draw', who: 'controller', count: n }];
  }
  if ((m = clause.match(/^you gain (\w+) life$/i))) {
    const n = num(m[1]);
    return n === null ? null : [{ op: 'gainLife', who: 'controller', amount: n }];
  }
  if ((m = clause.match(/^you lose (\w+) life$/i))) {
    const n = num(m[1]);
    return n === null ? null : [{ op: 'loseLife', who: 'controller', amount: n }];
  }
  if ((m = clause.match(/^each opponent loses (\w+) life$/i))) {
    const n = num(m[1]);
    return n === null ? null : [{ op: 'loseLife', who: 'opponent', amount: n }];
  }
  if ((m = clause.match(/^each player draws (\w+) cards?$/i))) {
    const n = num(m[1]);
    return n === null ? null : [{ op: 'draw', who: 'each', count: n }];
  }
  if ((m = clause.match(/^scry (\d+)$/i))) {
    return [{ op: 'scry', count: parseInt(m[1], 10) }];
  }
  if ((m = clause.match(/^~ deals (\w+) damage to each creature$/i))) {
    const n = num(m[1]);
    return n === null ? null : [{ op: 'damageEach', filter: { what: 'creature', controlledBy: 'any' }, amount: n }];
  }
  if (/^destroy all creatures$/i.test(clause)) {
    return [{ op: 'destroyEach', filter: { what: 'creature', controlledBy: 'any' } }];
  }
  if ((m = clause.match(/^create (\w+) (\d+)\/(\d+) (white|blue|black|red|green|colorless) ([\w\s]+?) creature tokens?(?: with (\w[\w\s]*?))?$/i))) {
    const count = num(m[1]);
    if (count === null) return null;
    const color = m[4].toLowerCase();
    const kw = m[6] ? KEYWORDS[m[6].trim().toLowerCase()] : undefined;
    if (m[6] && !kw) return null;
    return [{
      op: 'token',
      who: 'controller',
      count,
      name: m[5].trim(),
      power: parseInt(m[2], 10),
      toughness: parseInt(m[3], 10),
      colors: color === 'colorless' ? [] : [COLOR_WORDS[color]],
      subtypes: m[5].trim().split(/\s+/),
      keywords: kw ? [kw] : undefined,
    }];
  }
  return null;
}

/**
 * Parse an effect clause that may introduce ONE target. Returns the steps
 * plus the target spec it requires (or none).
 */
function parseTargetedEffect(clause: string): { steps: EffectStep[]; spec?: TargetSpec } | null {
  let m: RegExpMatchArray | null;
  const simple = parseSimpleEffect(clause);
  if (simple) return { steps: simple };

  if ((m = clause.match(/^~ deals (\w+) damage to any target$/i))) {
    const n = num(m[1]);
    return n === null ? null : { steps: [{ op: 'damage', to: 'target:0', amount: n }], spec: { what: 'any' } };
  }
  if ((m = clause.match(/^~ deals (\w+) damage to target creature$/i))) {
    const n = num(m[1]);
    return n === null ? null : { steps: [{ op: 'damage', to: 'target:0', amount: n }], spec: { what: 'creature' } };
  }
  if ((m = clause.match(/^~ deals (\w+) damage to target player(?: or planeswalker)?$/i))) {
    const n = num(m[1]);
    return n === null ? null : { steps: [{ op: 'damage', to: 'target:0', amount: n }], spec: { what: 'player' } };
  }
  if ((m = clause.match(/^destroy target (creature|artifact|enchantment|land)$/i))) {
    return { steps: [{ op: 'destroy', what: 'target:0' }], spec: { what: m[1].toLowerCase() as TargetSpec['what'] } };
  }
  if (/^counter target spell$/i.test(clause)) {
    return { steps: [{ op: 'counterSpell', what: 'target:0' }], spec: { what: 'spell' } };
  }
  if ((m = clause.match(/^target creature gets ([+-]\d+)\/([+-]\d+) until end of turn$/i))) {
    return {
      steps: [{ op: 'pump', what: 'target:0', power: parseInt(m[1], 10), toughness: parseInt(m[2], 10) }],
      spec: { what: 'creature' },
    };
  }
  if ((m = clause.match(/^target creature gains (\w[\w\s]*?) until end of turn$/i))) {
    const kw = KEYWORDS[m[1].trim().toLowerCase()];
    if (!kw) return null;
    return { steps: [{ op: 'pump', what: 'target:0', power: 0, toughness: 0, keywords: [kw] }], spec: { what: 'creature' } };
  }
  if (/^return target creature to its owner's hand$/i.test(clause)) {
    return { steps: [{ op: 'returnToHand', what: 'target:0' }], spec: { what: 'creature' } };
  }
  if ((m = clause.match(/^exile target (creature|artifact|enchantment)$/i))) {
    return { steps: [{ op: 'exile', what: 'target:0' }], spec: { what: m[1].toLowerCase() as TargetSpec['what'] } };
  }
  if ((m = clause.match(/^(tap|untap) target (creature|permanent|land|artifact)$/i))) {
    return {
      steps: [{ op: m[1].toLowerCase() as 'tap' | 'untap', what: 'target:0' }],
      spec: { what: m[2].toLowerCase() as TargetSpec['what'] },
    };
  }
  if ((m = clause.match(/^target player discards (\w+) cards?$/i))) {
    const n = num(m[1]);
    return n === null ? null : { steps: [{ op: 'discard', who: 'target:0', count: n }], spec: { what: 'player' } };
  }
  if ((m = clause.match(/^target player draws (\w+) cards?$/i))) {
    const n = num(m[1]);
    return n === null ? null : { steps: [{ op: 'draw', who: 'target:0', count: n }], spec: { what: 'player' } };
  }
  if ((m = clause.match(/^put (\w+) \+1\/\+1 counters? on target creature$/i))) {
    const n = num(m[1]);
    return n === null ? null : { steps: [{ op: 'putCounters', what: 'target:0', counter: '+1/+1', count: n }], spec: { what: 'creature' } };
  }
  return null;
}

/** Effects allowed inside simple ETB/dies triggers (no targets). */
function parseTriggerEffect(clause: string): EffectScript | null {
  return parseSimpleEffect(clause);
}

/** Try to parse a whole line; mutates `st`. Returns false if unrecognized. */
function parseLine(line: string, st: ParseState, isSpell: boolean): boolean {
  let m: RegExpMatchArray | null;

  // Keyword line ("Flying, first strike" / "Protection from black")
  const parts = line.split(/,\s*/).map((p) => p.trim().replace(/\.$/, ''));
  if (
    parts.length > 0 &&
    parts.every((p) => KEYWORDS[p.toLowerCase()] !== undefined || /^protection from (white|blue|black|red|green)$/i.test(p))
  ) {
    for (const p of parts) {
      const prot = p.match(/^protection from (white|blue|black|red|green)$/i);
      if (prot) st.protectionFrom.push(COLOR_WORDS[prot[1].toLowerCase()]);
      else st.keywords.push(KEYWORDS[p.toLowerCase()]);
    }
    return true;
  }

  if (/^~ enters (the battlefield )?tapped\.$/i.test(line)) {
    st.entersTapped = true;
    return true;
  }

  if ((m = line.match(/^\{T\}: Add \{([WUBRGC])\}\.$/))) {
    st.abilities.push({
      kind: 'activated',
      cost: { tap: true },
      effect: [{ op: 'addMana', who: 'controller', mana: [m[1] as Color | 'C'] }],
      text: `Adicionar {${m[1]}}`,
      isManaAbility: true,
    });
    return true;
  }

  if ((m = line.match(/^Cycling (\{[^}]+\})$/i))) {
    st.cyclingMana = m[1];
    return true;
  }

  if ((m = line.match(/^Flashback (\{[^ ]+?\})$/i)) || (m = line.match(/^Flashback ((?:\{[^}]+\})+)$/i))) {
    st.flashbackCost = m[1];
    return true;
  }

  // Aura framing
  if (/^Enchant creature$/i.test(line)) {
    st.enchant = { what: 'creature' };
    return true;
  }
  if ((m = line.match(/^Enchanted creature gets ([+-]\d+)\/([+-]\d+)\.$/i))) {
    st.attachEffect = { ...(st.attachEffect ?? {}), power: parseInt(m[1], 10), toughness: parseInt(m[2], 10) };
    return true;
  }
  if ((m = line.match(/^Enchanted creature gets ([+-]\d+)\/([+-]\d+) and has (\w[\w\s]*?)\.$/i))) {
    const kw = KEYWORDS[m[3].trim().toLowerCase()];
    if (!kw) return false;
    st.attachEffect = { power: parseInt(m[1], 10), toughness: parseInt(m[2], 10), keywords: [kw] };
    return true;
  }
  // Equipment framing
  if ((m = line.match(/^Equip (\{[^}]+\})$/i))) {
    st.equipCost = m[1];
    return true;
  }
  if ((m = line.match(/^Equipped creature gets ([+-]\d+)\/([+-]\d+)\.$/i))) {
    st.attachEffect = { ...(st.attachEffect ?? {}), power: parseInt(m[1], 10), toughness: parseInt(m[2], 10) };
    return true;
  }

  // Simple ETB / dies triggers
  if ((m = line.match(/^(?:When|Whenever) ~ enters(?: the battlefield)?, (.+)\.$/i))) {
    const effect = parseTriggerEffect(m[1]);
    if (!effect) return false;
    st.abilities.push({ kind: 'triggered', trigger: { on: 'etb', self: true }, effect, text: m[1] });
    return true;
  }
  if ((m = line.match(/^When ~ dies, (.+)\.$/i))) {
    const effect = parseTriggerEffect(m[1]);
    if (!effect) return false;
    st.abilities.push({ kind: 'triggered', trigger: { on: 'dies', self: true }, effect, text: m[1] });
    return true;
  }

  // Spell text: every sentence must parse; at most one target overall.
  if (isSpell) {
    const sentences = line.split(/\.\s+|\.$/).map((s) => s.trim()).filter(Boolean);
    if (sentences.length === 0) return false;
    for (const sentence of sentences) {
      const parsed = parseTargetedEffect(sentence);
      if (!parsed) return false;
      if (parsed.spec) {
        if (st.spellTargets.length > 0) return false; // multi-target: bail
        st.spellTargets.push(parsed.spec);
      }
      st.spellEffect.push(...parsed.steps);
    }
    return true;
  }

  return false;
}

export function compileOracleCard(input: OracleInput): CardDefinition | null {
  const { supertypes, types, subtypes } = parseTypeLine(input.typeLine);
  if (types.length === 0) return null;
  if (types.includes('Planeswalker') || types.includes('Battle')) return null;
  const isSpell = types.includes('Instant') || types.includes('Sorcery');

  // Normalize: strip reminder text, replace the card's own name with ~.
  const shortName = input.name.split(',')[0];
  let text = (input.oracleText ?? '')
    .replace(/\([^)]*\)/g, '')
    .split(input.name).join('~')
    .split(shortName).join('~')
    .replace(/\bThis (creature|land|artifact|enchantment|permanent)\b/gi, '~')
    .replace(/[ \t]+/g, ' ')
    .trim();

  const st: ParseState = {
    keywords: [],
    protectionFrom: [],
    entersTapped: false,
    abilities: [],
    spellTargets: [],
    spellEffect: [],
  };

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    if (!parseLine(line, st, isSpell)) return null;
  }

  if (isSpell && st.spellEffect.length === 0) return null;
  // Aura/equipment must have parsed their framing coherently.
  if (st.enchant && !st.attachEffect) return null;
  if (st.equipCost && !st.attachEffect) return null;
  if (st.attachEffect && !st.enchant && !st.equipCost) return null;

  if (st.equipCost) {
    st.abilities.push({
      kind: 'activated',
      cost: { mana: st.equipCost },
      targets: [{ what: 'creature', controlledBy: 'you' }],
      effect: [{ op: 'attach' }],
      text: `Equipar ${st.equipCost}`,
      sorceryOnly: true,
    });
  }

  return {
    id: `oracle-${input.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    name: input.name,
    oracleId: input.oracleId,
    scryfallId: input.scryfallId,
    manaCost: input.manaCost,
    types,
    subtypes,
    supertypes: supertypes.length > 0 ? supertypes : undefined,
    colors: input.colors ?? [],
    power: input.power,
    toughness: input.toughness,
    text: input.oracleText,
    keywords: st.keywords.length > 0 ? st.keywords : undefined,
    protectionFrom: st.protectionFrom.length > 0 ? st.protectionFrom : undefined,
    entersTapped: st.entersTapped || undefined,
    cycling: st.cyclingMana ? { mana: st.cyclingMana } : undefined,
    flashback: st.flashbackCost ? { cost: st.flashbackCost } : undefined,
    enchant: st.enchant,
    attachEffect: st.attachEffect,
    spellTargets: isSpell && st.spellTargets.length > 0 ? st.spellTargets : undefined,
    spellEffect: isSpell ? st.spellEffect : undefined,
    abilities: st.abilities.length > 0 ? st.abilities : undefined,
    automation: 'full',
  };
}
