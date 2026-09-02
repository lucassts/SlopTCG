/**
 * Oracle text → DSL compiler (automation Tier 1.5).
 *
 * Takes official card data (Scryfall shape) and emits a CardDefinition:
 * - instants/sorceries are all-or-nothing: EVERY sentence must be understood
 *   (a half-understood resolution would be worse than manual);
 * - permanents compile as long as they can be played: recognized lines are
 *   automated, the rest is listed in `automationNotes` ('partial').
 *
 * This is what makes "every card printed so far" playable with automation
 * growing over time: new patterns added here light up thousands of cards
 * at once, with no per-card work. Keep patterns conservative — a wrong
 * automation is a rules violation nobody notices.
 */
import type { CardType, Color, Keyword } from '../types.js';
import type {
  AbilityDef,
  CardDefinition,
  EffectScript,
  EffectStep,
  FilterSpec,
  SpellMode,
  TargetSpec,
  TriggerSpec,
} from './types.js';

export interface OracleInput {
  name: string;
  manaCost?: string;
  typeLine: string;
  oracleText?: string;
  power?: number;
  toughness?: number;
  /** Planeswalkers: starting loyalty. */
  loyalty?: number;
  colors?: Color[];
  oracleId?: string;
  scryfallId?: string;
}

const BASIC_TYPES = ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'];

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

const COLOR_WORDS: Record<string, Color> = {
  white: 'W',
  blue: 'U',
  black: 'B',
  red: 'R',
  green: 'G',
};

const COLOR_PT: Record<string, string> = { white: 'branca', blue: 'azul', black: 'preta', red: 'vermelha', green: 'verde' };

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

/** "flying and lifelink" / "flying, lifelink" → keywords, or null if any is unknown. */
function keywordList(text: string): Keyword[] | null {
  const parts = text.split(/,\s*|\s+and\s+/).map((p) => p.trim().toLowerCase()).filter(Boolean);
  const out: Keyword[] = [];
  for (const p of parts) {
    const kw = KEYWORDS[p];
    if (!kw) return null;
    out.push(kw);
  }
  return out.length > 0 ? out : null;
}

const TYPE_WORD: Record<string, FilterSpec['what']> = {
  creature: 'creature', land: 'land', artifact: 'artifact', enchantment: 'enchantment', permanent: 'permanent',
};

/** "creature" / "artifact" / "nonland permanent"… → filter, or null. */
function filterFromNoun(noun: string): FilterSpec | null {
  const n = noun.toLowerCase().trim();
  if (TYPE_WORD[n]) return { what: TYPE_WORD[n] };
  if (n === 'nonland permanent') return { what: 'permanent', nonland: true };
  if (n === 'noncreature permanent') return { what: 'permanent', noncreature: true };
  if (n === 'creature or planeswalker') return { what: 'creature' }; // sem planeswalkers automatizados: aproximação
  if (n === 'artifact or enchantment') return { what: 'permanent' };
  return null;
}

// ------------------------------------------------------------------ effects

/** Search-your-library clause → search step, or null. */
function parseSearch(clause: string): EffectStep[] | null {
  const m = clause.match(
    /^search your library for (?:up to (\w+) )?(?:a|an) (basic land|land|creature|artifact|enchantment|instant or sorcery|instant|sorcery|[A-Za-z]+(?: or [A-Za-z]+)*)? ?cards?(?:, reveal (?:it|them|that card|those cards))?,? (?:and )?put (?:it|them|that card|those cards) (into your hand|onto the battlefield tapped|onto the battlefield|on top of your library)(?:, then shuffle| and shuffle|\. then shuffle)?$/i,
  );
  if (!m) return null;
  const count = m[1] ? num(m[1]) : 1;
  if (count === null) return null;
  const kind = (m[2] ?? '').toLowerCase();
  let filter: FilterSpec | undefined;
  // Fetchlands: "a Mountain or Forest card" — tipos básicos de terreno.
  const words = (m[2] ?? '').split(/ or /).map((w) => w.trim());
  if (words.length > 0 && words.every((w) => BASIC_TYPES.includes(w))) {
    filter = { what: 'land', subtypeAnyOf: words };
  } else if (kind === 'basic land') filter = { what: 'land', basic: true };
  else if (kind === 'land') filter = { what: 'land' };
  else if (kind === 'creature') filter = { what: 'creature' };
  else if (kind === 'artifact') filter = { what: 'artifact' };
  else if (kind === 'enchantment') filter = { what: 'enchantment' };
  else if (kind === 'instant' || kind === 'sorcery') filter = { what: kind as 'instant' | 'sorcery' };
  else if (kind === 'instant or sorcery') return null; // sem filtro OR na DSL
  else if (kind && !filter) return null; // palavra desconhecida
  const dest = m[3].toLowerCase();
  const to = dest === 'into your hand' ? 'hand' : dest === 'on top of your library' ? 'libraryTop' : 'battlefield';
  return [{ op: 'search', filter, count, to, tapped: dest.endsWith('tapped') || undefined }];
}

/** Parse one simple effect clause (no targets). Returns null if unknown. */
function parseSimpleEffect(clause: string): EffectStep[] | null {
  let m: RegExpMatchArray | null;
  if ((m = clause.match(/^draw (\w+) cards?$/i))) {
    const n = num(m[1]);
    return n === null ? null : [{ op: 'draw', who: 'controller', count: n }];
  }
  if ((m = clause.match(/^you draw (\w+) cards?$/i))) {
    const n = num(m[1]);
    return n === null ? null : [{ op: 'draw', who: 'controller', count: n }];
  }
  if ((m = clause.match(/^(?:you )?gain (\w+) life$/i))) {
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
  if ((m = clause.match(/^each player loses (\w+) life$/i))) {
    const n = num(m[1]);
    return n === null ? null : [{ op: 'loseLife', who: 'each', amount: n }];
  }
  if ((m = clause.match(/^each player draws (\w+) cards?$/i))) {
    const n = num(m[1]);
    return n === null ? null : [{ op: 'draw', who: 'each', count: n }];
  }
  if ((m = clause.match(/^(?:you )?discard (\w+) cards?(?: at random)?$/i))) {
    const n = num(m[1]);
    if (n === null) return null;
    return /at random$/i.test(clause)
      ? [{ op: 'discardRandom', who: 'controller', count: n }]
      : [{ op: 'discard', who: 'controller', count: n }];
  }
  if (/^(?:you )?discard your hand$/i.test(clause)) return [{ op: 'discardHand', who: 'controller' }];
  if (/^each player discards (?:their|his or her) hand$/i.test(clause)) return [{ op: 'discardHand', who: 'each' }];
  if ((m = clause.match(/^(?:you )?mill (\w+) cards?$/i))) {
    const n = num(m[1]);
    return n === null ? null : [{ op: 'mill', who: 'controller', count: n }];
  }
  if ((m = clause.match(/^scry (\d+)$/i))) return [{ op: 'scry', count: parseInt(m[1], 10) }];
  if ((m = clause.match(/^surveil (\d+)$/i))) return [{ op: 'surveil', count: parseInt(m[1], 10) }];
  if (/^(?:then )?shuffle(?: your library)?$/i.test(clause)) return [{ op: 'shuffle', who: 'controller' }];
  if (/^it can't be regenerated$/i.test(clause)) return [];
  if ((m = clause.match(/^~ deals (\w+) damage to each (creature|opponent|player)$/i))) {
    const n = num(m[1]);
    if (n === null) return null;
    const who = m[2].toLowerCase();
    if (who === 'creature') return [{ op: 'damageEach', filter: { what: 'creature', controlledBy: 'any' }, amount: n }];
    return [{ op: 'damage', to: who === 'opponent' ? 'opponent' : 'each', amount: n }];
  }
  if ((m = clause.match(/^~ deals (\w+) damage to you$/i))) {
    const n = num(m[1]);
    return n === null ? null : [{ op: 'damage', to: 'controller', amount: n }];
  }
  if ((m = clause.match(/^~ deals (\w+) damage to each creature and each player$/i))) {
    const n = num(m[1]);
    return n === null ? null : [
      { op: 'damageEach', filter: { what: 'creature', controlledBy: 'any' }, amount: n },
      { op: 'damage', to: 'each', amount: n },
    ];
  }
  if ((m = clause.match(/^destroy all (creatures|artifacts|enchantments|lands|nonland permanents)$/i))) {
    const f = filterFromNoun(m[1].replace(/s$/, ''));
    return f ? [{ op: 'destroyEach', filter: { ...f, controlledBy: 'any' } }] : null;
  }
  if ((m = clause.match(/^exile all (creatures|artifacts|enchantments)$/i))) {
    const f = filterFromNoun(m[1].replace(/s$/, ''));
    return f ? [{ op: 'exileEach', filter: { ...f, controlledBy: 'any' } }] : null;
  }
  if (/^untap all creatures you control$/i.test(clause)) return [{ op: 'untapEach', filter: { what: 'creature', controlledBy: 'you' } }];
  if (/^tap all creatures your opponents control$/i.test(clause)) return [{ op: 'tapEach', filter: { what: 'creature', controlledBy: 'opponent' } }];
  if ((m = clause.match(/^creatures you control get ([+-]\d+)\/([+-]\d+)(?: and gain (\w[\w\s]*?))? until end of turn$/i))) {
    const kws = m[3] ? keywordList(m[3]) : undefined;
    if (m[3] && !kws) return null;
    return [{ op: 'pumpEach', filter: { what: 'creature', controlledBy: 'you' }, power: parseInt(m[1], 10), toughness: parseInt(m[2], 10), keywords: kws ?? undefined }];
  }
  if ((m = clause.match(/^all creatures get ([+-]\d+)\/([+-]\d+) until end of turn$/i))) {
    return [{ op: 'pumpEach', filter: { what: 'creature', controlledBy: 'any' }, power: parseInt(m[1], 10), toughness: parseInt(m[2], 10) }];
  }
  if ((m = clause.match(/^creatures your opponents control get ([+-]\d+)\/([+-]\d+) until end of turn$/i))) {
    return [{ op: 'pumpEach', filter: { what: 'creature', controlledBy: 'opponent' }, power: parseInt(m[1], 10), toughness: parseInt(m[2], 10) }];
  }
  if ((m = clause.match(/^~ deals (\w+) damage to each creature (with|without) flying$/i))) {
    const n = amt(m[1]);
    return n === null ? null : [{ op: 'damageEach', filter: { what: 'creature', controlledBy: 'any', [m[2] === 'with' ? 'withKeyword' : 'withoutKeyword']: 'flying' }, amount: n }];
  }
  if ((m = clause.match(/^create (\w+) (Treasure|Food|Clue) tokens?$/i))) {
    const n = num(m[1]);
    return n === null ? null : [{ op: 'namedToken', who: 'controller', kind: (m[2][0].toUpperCase() + m[2].slice(1).toLowerCase()) as 'Treasure', count: n }];
  }
  if (/^investigate$/i.test(clause)) return [{ op: 'namedToken', who: 'controller', kind: 'Clue', count: 1 }];
  if ((m = clause.match(/^creatures you control gain (\w[\w\s]*?) until end of turn$/i))) {
    const kws = keywordList(m[1]);
    return kws ? [{ op: 'pumpEach', filter: { what: 'creature', controlledBy: 'you' }, power: 0, toughness: 0, keywords: kws }] : null;
  }
  if ((m = clause.match(/^~ gets ([+-]\d+)\/([+-]\d+)(?: and gains (\w[\w\s]*?))? until end of turn$/i))) {
    const kws = m[3] ? keywordList(m[3]) : undefined;
    if (m[3] && !kws) return null;
    return [{ op: 'pump', what: 'self', power: parseInt(m[1], 10), toughness: parseInt(m[2], 10), keywords: kws ?? undefined }];
  }
  if ((m = clause.match(/^~ gains (\w[\w\s]*?) until end of turn$/i))) {
    const kws = keywordList(m[1]);
    return kws ? [{ op: 'pump', what: 'self', power: 0, toughness: 0, keywords: kws }] : null;
  }
  if (/^regenerate ~$/i.test(clause)) return [{ op: 'regenerate', what: 'self' }];
  if (/^untap ~$/i.test(clause)) return [{ op: 'untap', what: 'self' }];
  if (/^tap ~$/i.test(clause)) return [{ op: 'tap', what: 'self' }];
  if (/^return ~ to its owner's hand$/i.test(clause)) return [{ op: 'returnToHand', what: 'self' }];
  if ((m = clause.match(/^put (\w+) ([\w+/-]+) counters? on (?:~|it)$/i))) {
    const n = num(m[1]);
    return n === null ? null : [{ op: 'putCounters', what: 'self', counter: m[2], count: n }];
  }
  if (/^sacrifice ~$/i.test(clause) || /^sacrifice it$/i.test(clause)) return [{ op: 'sacrificeSelf' }];
  if ((m = clause.match(/^add ((?:\{[WUBRGC]\})+)$/i))) {
    return [{ op: 'addMana', who: 'controller', mana: [...m[1].matchAll(/\{([WUBRGC])\}/g)].map((x) => x[1] as Color | 'C') }];
  }
  if (/^add one mana of any color$/i.test(clause)) return [{ op: 'addManaChoice', who: 'controller' }];
  if (/^add one mana of the chosen color$/i.test(clause)) return [{ op: 'addChosenColorMana' }];
  if ((m = clause.match(/^add ((?:\{[WUBRG]\},? )*(?:or )?\{[WUBRG]\})$/i)) && m[1].includes('or')) {
    return [{ op: 'addManaChoice', who: 'controller', colors: [...m[1].matchAll(/\{([WUBRG])\}/g)].map((x) => x[1] as Color) }];
  }
  if ((m = clause.match(/^each opponent discards a card$/i))) return [{ op: 'discard', who: 'opponent', count: 1 }];
  if ((m = clause.match(/^each player discards a card$/i))) return [{ op: 'discard', who: 'each', count: 1 }];
  if ((m = clause.match(/^put a \+1\/\+1 counter on each (?:other )?creature you control$/i))) return [{ op: 'putCountersEach', filter: { what: 'creature', controlledBy: 'you', other: /other/i.test(clause) || undefined }, counter: '+1/+1', count: 1 }];
  if ((m = clause.match(/^create (\w+) (\d+)\/(\d+) (white|blue|black|red|green|colorless) ([\w\s]+?) (?:artifact )?creature tokens?(?: with (\w[\w\s]*?))?$/i))) {
    const count = num(m[1]);
    if (count === null) return null;
    const color = m[4].toLowerCase();
    const kws = m[6] ? keywordList(m[6]) : undefined;
    if (m[6] && !kws) return null;
    return [{
      op: 'token',
      who: 'controller',
      count,
      name: m[5].trim(),
      power: parseInt(m[2], 10),
      toughness: parseInt(m[3], 10),
      colors: color === 'colorless' ? [] : [COLOR_WORDS[color]],
      subtypes: m[5].trim().split(/\s+/),
      keywords: kws ?? undefined,
    }];
  }
  if (/^sacrifice a creature$/i.test(clause)) return [{ op: 'sacrifice', who: 'controller', filter: { what: 'creature' }, count: 1 }];
  if (/^each player sacrifices a creature$/i.test(clause)) return [{ op: 'sacrifice', who: 'each', filter: { what: 'creature' }, count: 1 }];
  if (/^each opponent sacrifices a creature$/i.test(clause)) return [{ op: 'sacrifice', who: 'opponent', filter: { what: 'creature' }, count: 1 }];
  const search = parseSearch(clause);
  if (search) return search;
  return null;
}

interface Parsed {
  steps: EffectStep[];
  spec?: TargetSpec;
  /** Two-target patterns (fights, bites): replaces `spec`. */
  specs?: TargetSpec[];
}

/** Number word, digit or X → DynAmount-compatible value. */
function amt(word: string): number | 'X' | null {
  if (word === 'X') return 'X';
  return num(word);
}

/**
 * Target noun → spec. Understands controller suffixes, tapped/attacking
 * qualifiers, "with/without flying", "with power N or greater/less" and
 * type alternatives ("artifact or enchantment").
 */
function targetSpecFromNoun(noun: string): TargetSpec | null {
  let n = noun.toLowerCase().trim();
  let controlledBy: TargetSpec['controlledBy'];
  if (n.endsWith(' you control')) { controlledBy = 'you'; n = n.slice(0, -' you control'.length); }
  else if (n.endsWith(' an opponent controls')) { controlledBy = 'opponent'; n = n.slice(0, -' an opponent controls'.length); }
  else if (n.endsWith(" you don't control")) { controlledBy = 'opponent'; n = n.slice(0, -" you don't control".length); }
  const spec: TargetSpec = { what: 'permanent' };
  if (controlledBy) spec.controlledBy = controlledBy;
  let m: RegExpMatchArray | null;
  if ((m = n.match(/^(.+?) with power (\d+) or (greater|less)$/))) {
    n = m[1];
    if (m[3] === 'greater') spec.powerAtLeast = parseInt(m[2], 10);
    else spec.powerAtMost = parseInt(m[2], 10);
  }
  if ((m = n.match(/^(.+?) (with|without) (flying|reach|trample|haste|vigilance|lifelink|deathtouch|menace|defender|flash)$/))) {
    n = m[1];
    if (m[2] === 'with') spec.withKeyword = KEYWORDS[m[3]];
    else spec.withoutKeyword = KEYWORDS[m[3]];
  }
  if ((m = n.match(/^(attacking or blocking|tapped|untapped|attacking|blocking) (.+)$/))) {
    n = m[2];
    if (m[1] === 'tapped') spec.tapped = true;
    else if (m[1] === 'untapped') return null;
    else spec.combat = true;
  }
  const map: Record<string, TargetSpec['what']> = {
    creature: 'creature', player: 'player', permanent: 'permanent', land: 'land', artifact: 'artifact',
    enchantment: 'enchantment', 'creature or planeswalker': 'creature', 'nonland permanent': 'permanent',
    'player or planeswalker': 'player', 'creature or player': 'any', opponent: 'player',
  };
  if (map[n]) {
    spec.what = map[n];
    if (n === 'nonland permanent') spec.what = 'permanent';
    if (n === 'opponent' && !controlledBy) spec.controlledBy = 'opponent';
    return spec;
  }
  // "artifact or enchantment", "artifact, creature, or land"
  const alts = n.split(/,\s*or\s+|\s+or\s+|,\s*/).map((s) => s.trim());
  const typeMap: Record<string, CardType> = { creature: 'Creature', artifact: 'Artifact', enchantment: 'Enchantment', land: 'Land' };
  if (alts.length > 1 && alts.every((a) => typeMap[a])) {
    spec.what = 'permanent';
    spec.typeAnyOf = alts.map((a) => typeMap[a]);
    return spec;
  }
  return null;
}

/**
 * Parse an effect clause that may introduce ONE target. Handles pronouns
 * ("it", "that creature") when a target already exists in the sentence.
 */
function parseTargetedEffect(clause: string): Parsed | null {
  let m: RegExpMatchArray | null;
  const simple = parseSimpleEffect(clause);
  if (simple) return { steps: simple };

  if ((m = clause.match(/^~ deals (\w+) damage to any target$/i))) {
    const n = amt(m[1]);
    return n === null ? null : { steps: [{ op: 'damage', to: 'target:0', amount: n }], spec: { what: 'any' } };
  }
  if ((m = clause.match(/^~ deals (\w+) damage to target (.+)$/i))) {
    const n = amt(m[1]);
    const spec = targetSpecFromNoun(m[2]);
    return n === null || !spec ? null : { steps: [{ op: 'damage', to: 'target:0', amount: n }], spec };
  }
  // Dois alvos: lutas e mordidas.
  if (/^target creature you control fights target creature you don't control$/i.test(clause)) {
    return {
      steps: [{ op: 'fight', a: 'target:0', b: 'target:1' }],
      specs: [{ what: 'creature', controlledBy: 'you' }, { what: 'creature', controlledBy: 'opponent' }],
    };
  }
  if (/^target creature you control deals damage equal to its power to target creature(?: or planeswalker)? you don't control$/i.test(clause)) {
    return {
      steps: [{ op: 'damage', to: 'target:1', amount: { powerOf: 'target:0' } }],
      specs: [{ what: 'creature', controlledBy: 'you' }, { what: 'creature', controlledBy: 'opponent' }],
    };
  }
  if ((m = clause.match(/^counter target (creature |noncreature |instant or sorcery )?spell unless its controller pays ((?:\{[^}]+\})+)$/i))) {
    const t = (m[1] ?? '').trim().toLowerCase();
    const spec: TargetSpec = { what: 'spell' };
    if (t === 'creature') spec.spellType = 'creature';
    else if (t === 'noncreature') spec.spellType = 'noncreature';
    else if (t === 'instant or sorcery') spec.spellType = 'instantSorcery';
    return { steps: [{ op: 'counterUnlessPay', what: 'target:0', cost: m[2] }], spec };
  }
  if (/^put target creature on top of its owner's library$/i.test(clause)) {
    return { steps: [{ op: 'putOnLibraryTop', what: 'target:0' }], spec: { what: 'creature' } };
  }
  if ((m = clause.match(/^~ deals damage equal to (?:its|~'s) power to target (.+)$/i))) {
    const spec = targetSpecFromNoun(m[1]);
    return spec ? { steps: [{ op: 'fight', a: 'self', b: 'target:0' }], spec } : null; // aproximação: luta unilateral não existe; usa fight
  }
  if ((m = clause.match(/^destroy target (.+)$/i))) {
    const spec = targetSpecFromNoun(m[1]);
    return spec && spec.what !== 'player' && spec.what !== 'any' ? { steps: [{ op: 'destroy', what: 'target:0' }], spec } : null;
  }
  if ((m = clause.match(/^exile target (.+?) until ~ leaves the battlefield$/i))) {
    const spec = targetSpecFromNoun(m[1]);
    return spec && spec.what !== 'player' && spec.what !== 'any' ? { steps: [{ op: 'exileUntilLeaves', what: 'target:0' }], spec } : null;
  }
  if ((m = clause.match(/^exile target (.+)$/i)) && !/card|spell/i.test(m[1])) {
    const spec = targetSpecFromNoun(m[1]);
    return spec && spec.what !== 'player' && spec.what !== 'any' ? { steps: [{ op: 'exile', what: 'target:0' }], spec } : null;
  }
  if ((m = clause.match(/^exile target card from a graveyard$/i))) {
    return { steps: [{ op: 'exile', what: 'target:0' }], spec: { what: 'permanent', zone: 'graveyard' } };
  }
  if ((m = clause.match(/^exile target (.+?) until ~ leaves the battlefield$/i))) {
    const spec = targetSpecFromNoun(m[1]);
    return spec && spec.what !== 'player' && spec.what !== 'any' ? { steps: [{ op: 'exileUntilLeaves', what: 'target:0' }], spec } : null;
  }
  if ((m = clause.match(/^target (opponent|player) loses (\w+) life and you gain (\w+) life$/i))) {
    const a = num(m[2]), b = num(m[3]);
    return a === null || b === null ? null : { steps: [{ op: 'loseLife', who: 'target:0', amount: a }, { op: 'gainLife', who: 'controller', amount: b }], spec: targetSpecFromNoun(m[1])! };
  }
  if (/^counter target spell$/i.test(clause)) {
    return { steps: [{ op: 'counterSpell', what: 'target:0' }], spec: { what: 'spell' } };
  }
  if ((m = clause.match(/^counter target (creature|noncreature|instant or sorcery) spell$/i))) {
    const t = m[1].toLowerCase();
    const spellType = t === 'creature' ? 'creature' : t === 'noncreature' ? 'noncreature' : 'instantSorcery';
    return { steps: [{ op: 'counterSpell', what: 'target:0' }], spec: { what: 'spell', spellType } };
  }
  if ((m = clause.match(/^target creature( you control| an opponent controls)? gets ([+-]\d+)\/([+-]\d+)(?: and gains (\w[\w\s]*?))? until end of turn$/i))) {
    const kws = m[4] ? keywordList(m[4]) : undefined;
    if (m[4] && !kws) return null;
    const spec = targetSpecFromNoun('creature' + (m[1] ?? ''));
    return spec
      ? { steps: [{ op: 'pump', what: 'target:0', power: parseInt(m[2], 10), toughness: parseInt(m[3], 10), keywords: kws ?? undefined }], spec }
      : null;
  }
  if ((m = clause.match(/^target creature (?:you control )?gains (\w[\w\s]*?) until end of turn$/i))) {
    const kws = keywordList(m[1]);
    if (!kws) return null;
    return { steps: [{ op: 'pump', what: 'target:0', power: 0, toughness: 0, keywords: kws }], spec: { what: 'creature' } };
  }
  if (/^target creature can't block this turn$/i.test(clause)) {
    return { steps: [{ op: 'pump', what: 'target:0', power: 0, toughness: 0, keywords: ['cantBlock'] }], spec: { what: 'creature' } };
  }
  if (/^target creature can't be blocked this turn$/i.test(clause)) {
    return { steps: [{ op: 'pump', what: 'target:0', power: 0, toughness: 0, keywords: ['unblockable'] }], spec: { what: 'creature' } };
  }
  if ((m = clause.match(/^return target (creature|artifact|enchantment|permanent|nonland permanent|land)( you control| an opponent controls)? to its owner's hand$/i))) {
    const spec = targetSpecFromNoun(m[1] + (m[2] ?? ''));
    return spec ? { steps: [{ op: 'returnToHand', what: 'target:0' }], spec } : null;
  }
  if ((m = clause.match(/^return target (creature|artifact|enchantment|permanent|land|instant or sorcery)? ?card from your graveyard to your hand$/i))) {
    const what = (m[1] ?? 'permanent').toLowerCase();
    const spec: TargetSpec = { what: what === 'instant or sorcery' ? 'permanent' : (what as TargetSpec['what']), zone: 'graveyard', ownedBy: 'you' };
    if (what === 'instant or sorcery') return null;
    return { steps: [{ op: 'returnToHand', what: 'target:0' }], spec };
  }
  if ((m = clause.match(/^return target creature card from your graveyard to the battlefield( tapped)?$/i))) {
    return { steps: [{ op: 'returnToBattlefield', what: 'target:0', tapped: !!m[1] || undefined }], spec: { what: 'creature', zone: 'graveyard', ownedBy: 'you' } };
  }
  if ((m = clause.match(/^(tap|untap) target (creature|permanent|land|artifact)( you control| an opponent controls)?$/i))) {
    const spec = targetSpecFromNoun(m[2] + (m[3] ?? ''));
    return spec ? { steps: [{ op: m[1].toLowerCase() as 'tap' | 'untap', what: 'target:0' }], spec } : null;
  }
  if ((m = clause.match(/^target player discards (\w+) cards?(?: at random)?$/i))) {
    const n = num(m[1]);
    if (n === null) return null;
    return /at random$/i.test(clause)
      ? null
      : { steps: [{ op: 'discard', who: 'target:0', count: n }], spec: { what: 'player' } };
  }
  if (/^target player discards (?:their|his or her) hand$/i.test(clause)) {
    return { steps: [{ op: 'discardHand', who: 'target:0' }], spec: { what: 'player' } };
  }
  if ((m = clause.match(/^target player draws (\w+) cards?$/i))) {
    const n = num(m[1]);
    return n === null ? null : { steps: [{ op: 'draw', who: 'target:0', count: n }], spec: { what: 'player' } };
  }
  if ((m = clause.match(/^target player loses (\w+) life$/i))) {
    const n = num(m[1]);
    return n === null ? null : { steps: [{ op: 'loseLife', who: 'target:0', amount: n }], spec: { what: 'player' } };
  }
  if ((m = clause.match(/^target player gains (\w+) life$/i))) {
    const n = num(m[1]);
    return n === null ? null : { steps: [{ op: 'gainLife', who: 'target:0', amount: n }], spec: { what: 'player' } };
  }
  if ((m = clause.match(/^target player mills (\w+) cards?$/i))) {
    const n = num(m[1]);
    return n === null ? null : { steps: [{ op: 'mill', who: 'target:0', count: n }], spec: { what: 'player' } };
  }
  if ((m = clause.match(/^target player sacrifices (?:a|an) (creature|artifact|enchantment|land|permanent)(?: of their choice)?$/i))) {
    const f = filterFromNoun(m[1]);
    return f ? { steps: [{ op: 'sacrifice', who: 'target:0', filter: f, count: 1 }], spec: { what: 'player' } } : null;
  }
  if ((m = clause.match(/^target opponent sacrifices (?:a|an) (creature|artifact|enchantment|land|permanent)(?: of their choice)?$/i))) {
    const f = filterFromNoun(m[1]);
    return f ? { steps: [{ op: 'sacrifice', who: 'target:0', filter: f, count: 1 }], spec: { what: 'player' } } : null;
  }
  if ((m = clause.match(/^put (\w+) \+1\/\+1 counters? on target creature( you control)?$/i))) {
    const n = num(m[1]);
    return n === null ? null : { steps: [{ op: 'putCounters', what: 'target:0', counter: '+1/+1', count: n }], spec: { what: 'creature', controlledBy: m[2] ? 'you' : undefined } };
  }
  if ((m = clause.match(/^put (\w+) -1\/-1 counters? on target creature$/i))) {
    const n = num(m[1]);
    return n === null ? null : { steps: [{ op: 'putCounters', what: 'target:0', counter: '-1/-1', count: n }], spec: { what: 'creature' } };
  }
  if (/^gain control of target creature until end of turn$/i.test(clause)) {
    return { steps: [{ op: 'gainControl', what: 'target:0', untilEndOfTurn: true }], spec: { what: 'creature' } };
  }
  if ((m = clause.match(/^gain control of target (creature|artifact|enchantment|permanent|land)$/i))) {
    const spec = targetSpecFromNoun(m[1]);
    return spec ? { steps: [{ op: 'gainControl', what: 'target:0' }], spec } : null;
  }
  if (/^target creature you control fights target creature you don't control$/i.test(clause)) return null; // dois alvos
  if (/^copy target instant or sorcery spell$/i.test(clause)) {
    return { steps: [{ op: 'copySpell', what: 'target:0' }], spec: { what: 'spell', spellType: 'instantSorcery' } };
  }
  if (/^regenerate target creature$/i.test(clause)) {
    return { steps: [{ op: 'regenerate', what: 'target:0' }], spec: { what: 'creature' } };
  }
  if (/^prevent all combat damage that would be dealt this turn$/i.test(clause)) {
    return { steps: [{ op: 'preventCombatDamage' }] };
  }
  return null;
}

/** Pronoun follow-ups after a targeted sentence ("Untap it. It gains haste…"). */
function parsePronounEffect(clause: string, spec: TargetSpec): EffectStep[] | null {
  let m: RegExpMatchArray | null;
  const c = clause.replace(/^(?:it|that creature|that permanent|that player)\b/i, 'IT');
  if (/^untap IT$/i.test(c) || /^untap that creature$/i.test(clause)) return [{ op: 'untap', what: 'target:0' }];
  if (/^tap IT$/i.test(c)) return [{ op: 'tap', what: 'target:0' }];
  if ((m = c.match(/^IT gains (\w[\w\s]*?) until end of turn$/i))) {
    const kws = keywordList(m[1]);
    return kws ? [{ op: 'pump', what: 'target:0', power: 0, toughness: 0, keywords: kws }] : null;
  }
  if ((m = c.match(/^IT gets ([+-]\d+)\/([+-]\d+) until end of turn$/i))) {
    return [{ op: 'pump', what: 'target:0', power: parseInt(m[1], 10), toughness: parseInt(m[2], 10) }];
  }
  if (/^IT can't be regenerated$/i.test(c)) return [];
  if (/^IT can't block this turn$/i.test(c)) return [{ op: 'pump', what: 'target:0', power: 0, toughness: 0, keywords: ['cantBlock'] }];
  if (spec.what === 'player' && (m = c.match(/^IT loses (\w+) life$/i))) {
    const n = num(m[1]);
    return n === null ? null : [{ op: 'loseLife', who: 'target:0', amount: n }];
  }
  return null;
}

/**
 * Parse a full rules sentence list (one line) into steps + at most one
 * target. Sentences are split on ". "; " and " compounds are tried whole
 * first, then piecewise.
 */
function parseEffectText(text: string): { steps: EffectStep[]; spec?: TargetSpec; specs?: TargetSpec[]; selfExile?: boolean; kickerSteps?: EffectStep[] } | null {
  let m: RegExpMatchArray | null;
  const steps: EffectStep[] = [];
  const kickerSteps: EffectStep[] = [];
  let spec: TargetSpec | undefined;
  let specs: TargetSpec[] | undefined;
  let selfExile = false;
  // Thoughtseize/Duress: frases acopladas, tratadas inteiras; o que sobra
  // ("You lose 2 life.") segue o caminho normal.
  if ((m = text.match(/^Target (player|opponent) reveals their hand\. You choose a (nonland|noncreature, nonland|creature|instant or sorcery|noncreature)? ?card from it\. That player discards that card\.?\s*(.*)$/i))) {
    const kind = (m[2] ?? '').toLowerCase();
    if (kind === 'instant or sorcery') return null;
    const filter: FilterSpec | undefined =
      kind === 'nonland' ? { nonland: true }
      : kind === 'noncreature, nonland' ? { nonland: true, noncreature: true }
      : kind === 'noncreature' ? { noncreature: true }
      : kind === 'creature' ? { what: 'creature' }
      : undefined;
    steps.push({ op: 'discard', who: 'target:0', count: 1, chooser: 'caster', filter });
    spec = { what: 'player' };
    text = m[3];
    if (!text.trim()) return { steps, spec };
  }
  const sentences = text.split(/\.\s+|\.$/).map((s) => s.trim()).filter(Boolean);
  if (sentences.length === 0) return null;
  let lastMayDo: Extract<EffectStep, { op: 'mayDo' }> | null = null;
  for (const rawSentence of sentences) {
    let sentence = rawSentence;
    if (/^exile ~$/i.test(sentence)) { selfExile = true; continue; }
    // Kicker aditivo: "If this spell was kicked, draw a card" (sem "instead").
    let kicked = false;
    if ((m = sentence.match(/^If (?:this spell|~) was kicked, (.+)$/i))) {
      if (/\binstead\b/i.test(m[1])) return null;
      kicked = true;
      sentence = m[1];
    }
    // "You may <efeito>" → decisão sim/não; "If you do, <efeito>" entra no mesmo ramo.
    let optional = false;
    let ifYouDo = false;
    if ((m = sentence.match(/^you may (.+)$/i))) { optional = true; sentence = m[1]; }
    else if ((m = sentence.match(/^If you do, (.+)$/i))) {
      if (!lastMayDo) return null;
      ifYouDo = true;
      sentence = m[1];
    }
    let parsed = parseTargetedEffect(sentence);
    if (parsed?.specs) {
      if (spec || specs) return null;
      specs = parsed.specs;
      steps.push(...parsed.steps);
      continue;
    }
    if (!parsed && spec) {
      const pron = parsePronounEffect(sentence, spec);
      if (pron) parsed = { steps: pron };
    }
    if (!parsed) {
      // "X and Y" / "X, then Y": cada parte simples, no máximo um alvo no todo.
      const parts = sentence.split(/,? then |,? and (?!gains?\b|have\b|has\b|it\b)/i).map((p) => p.trim());
      if (parts.length < 2) return null;
      const acc: EffectStep[] = [];
      let partSpec: TargetSpec | undefined;
      for (const p of parts) {
        let pp = parseTargetedEffect(p);
        if (!pp && (partSpec ?? spec)) {
          const pron = parsePronounEffect(p, (partSpec ?? spec)!);
          if (pron) pp = { steps: pron };
        }
        if (!pp) return null;
        if (pp.spec) {
          if (partSpec || spec) return null;
          partSpec = pp.spec;
        }
        acc.push(...pp.steps);
      }
      parsed = { steps: acc, spec: partSpec };
    }
    if (parsed.spec) {
      if (spec || specs) return null; // multi-alvo: fora do escopo
      spec = parsed.spec;
    }
    if (ifYouDo && lastMayDo) { lastMayDo.effect.push(...parsed.steps); continue; }
    if (optional) {
      const step: Extract<EffectStep, { op: 'mayDo' }> = { op: 'mayDo', prompt: sentence, effect: parsed.steps };
      lastMayDo = step;
      (kicked ? kickerSteps : steps).push(step);
      continue;
    }
    lastMayDo = null;
    (kicked ? kickerSteps : steps).push(...parsed.steps);
  }
  return { steps, spec, specs, selfExile: selfExile || undefined, kickerSteps: kickerSteps.length > 0 ? kickerSteps : undefined };
}

/** Targets of a parsed effect text as a list (single or double). */
function specsOf(p: { spec?: TargetSpec; specs?: TargetSpec[] }): TargetSpec[] | undefined {
  return p.specs ?? (p.spec ? [p.spec] : undefined);
}

// ----------------------------------------------------------------- state

interface ParseState {
  keywords: Keyword[];
  protectionFrom: Color[];
  entersTapped: boolean;
  cyclingMana?: string;
  flashbackCost?: string;
  flashbackSacrifice?: FilterSpec;
  altCost?: CardDefinition['altCost'];
  additionalCost?: CardDefinition['additionalCost'];
  entersWithCounters?: CardDefinition['entersWithCounters'];
  abilities: AbilityDef[];
  spellTargets: TargetSpec[];
  spellEffect: EffectStep[];
  spellModes: SpellMode[];
  modalOpen: boolean;
  enchant?: CardDefinition['enchant'];
  attachEffect?: CardDefinition['attachEffect'];
  equipCost?: string;
  ward?: number;
  devoid: boolean;
  uncounterable: boolean;
  exileOnResolve: boolean;
  storm: boolean;
  noMaxHandSize: boolean;
  kickerCost?: string;
  kickerEffect: EffectStep[];
  cyclingEffect?: EffectStep[];
  crew?: number;
  evasionPowerAtMost?: number;
  entersTappedUnless?: CardDefinition['entersTappedUnless'];
  shockLife?: number;
  infect: boolean;
  wither: boolean;
  toxic?: number;
  exalted: boolean;
  bushido?: number;
  modalTrigger?: TriggerSpec;
  modalTriggerModes?: SpellMode[];
  /** Keyword flags copied verbatim onto the definition (persist, echo, rampage…). */
  flags: Partial<Pick<CardDefinition, 'flanking' | 'skulk' | 'persist' | 'undying' | 'evolve' | 'mentor' | 'unleash' | 'riot' | 'livingWeapon' | 'rampage' | 'afflict' | 'renown' | 'modular' | 'afterlife' | 'fabricate' | 'bloodthirst' | 'vanishing' | 'fading' | 'devour' | 'echo' | 'cumulativeUpkeep'>>;
  revealTop: boolean;
  extraLands?: number;
  playerHexproof: boolean;
  noLifeGain?: 'all' | 'opponents';
  maxBlockers?: number;
  minBlockers?: number;
  extraBlocks?: number | 'any';
  evasionPowerAtLeast?: number;
  chooseOnEnter?: 'color' | 'creatureType';
  kickerEnters?: { counter: string; count: number };
  /** Recognized-but-ignored lines (cost reducers etc.): card becomes 'partial'. */
  softNotes: string[];
}

/** "Activate only if you control three or more artifacts." → condition. */
function parseActivationCondition(
  clause: string,
): NonNullable<Extract<AbilityDef, { kind: 'activated' }>['condition']> | null {
  const m = clause.match(
    /^Activate only if you control (a|an|\w+)(?: or more)? (artifact|creature|land|enchantment)s?$/i,
  );
  if (!m) return null;
  const count = m[1].toLowerCase() === 'a' || m[1].toLowerCase() === 'an' ? 1 : num(m[1]);
  if (count === null) return null;
  return { controlsAtLeast: { count, filter: { what: m[2].toLowerCase() as 'artifact' } } };
}

/** Cost text ("{1}{R}, {T}, Sacrifice ~") → activated cost, or null. */
function parseActivationCost(text: string): Extract<AbilityDef, { kind: 'activated' }>['cost'] | null {
  const cost: Extract<AbilityDef, { kind: 'activated' }>['cost'] = {};
  let any = false;
  for (const tokRaw of text.split(/,\s*/)) {
    const tok = tokRaw.trim();
    let m: RegExpMatchArray | null;
    if (tok === '{T}') { cost.tap = true; any = true; continue; }
    if (/^(?:\{[^}]+\})+$/.test(tok)) {
      if (tok.includes('{Q}') || tok.includes('{E}')) return null;
      cost.mana = (cost.mana ?? '') + tok; any = true; continue;
    }
    if (/^Sacrifice ~$/i.test(tok)) { cost.sacrificeSelf = true; any = true; continue; }
    if ((m = tok.match(/^Sacrifice (?:a|an|another) (creature|artifact|land|permanent|enchantment)$/i))) {
      cost.sacrifice = { what: TYPE_WORD[m[1].toLowerCase()], other: true }; any = true; continue;
    }
    if ((m = tok.match(/^Pay (\d+) life$/i))) { cost.payLife = parseInt(m[1], 10); any = true; continue; }
    if ((m = tok.match(/^Discard (a|two|three) cards?$/i))) { cost.discard = num(m[1]) ?? 1; any = true; continue; }
    return null; // exile from graveyard, counters… fora da DSL
  }
  return any ? cost : null;
}

/** Trigger header → TriggerSpec (self triggers, filters, steps, casts). */
function parseTriggerHeader(head: string): { trigger: TriggerSpec; extraSelf?: TriggerSpec } | null {
  let m: RegExpMatchArray | null;
  if (/^(?:When|Whenever) ~ enters(?: the battlefield)?$/i.test(head)) return { trigger: { on: 'etb', self: true } };
  if (/^(?:When|Whenever) ~ dies$/i.test(head)) return { trigger: { on: 'dies', self: true } };
  if (/^When ~ is put into a graveyard from the battlefield$/i.test(head)) return { trigger: { on: 'dies', self: true } };
  if (/^Whenever ~ becomes blocked$/i.test(head)) return { trigger: { on: 'becomesBlocked', self: true } };
  if (/^Whenever ~ becomes the target of a spell or ability$/i.test(head)) return { trigger: { on: 'becomesTargeted', self: true } };
  if (/^Whenever ~ becomes the target of a spell or ability an opponent controls$/i.test(head)) return { trigger: { on: 'becomesTargeted', self: true, byOpponent: true } };
  if (/^Whenever you draw a card$/i.test(head)) return { trigger: { on: 'youDrawCard' } };
  if (/^Whenever ~ attacks$/i.test(head)) return { trigger: { on: 'attacks', self: true } };
  if (/^Whenever ~ blocks$/i.test(head)) return { trigger: { on: 'blocks', self: true } };
  if (/^Whenever ~ attacks or blocks$/i.test(head)) return { trigger: { on: 'attacks', self: true }, extraSelf: { on: 'blocks', self: true } };
  if (/^Whenever ~ enters or attacks$/i.test(head)) return { trigger: { on: 'etb', self: true }, extraSelf: { on: 'attacks', self: true } };
  if (/^When ~ leaves the battlefield$/i.test(head)) return { trigger: { on: 'leaves', self: true } };
  if (/^Whenever ~ becomes tapped$/i.test(head)) return { trigger: { on: 'becomesTapped', self: true } };
  if (/^Whenever an opponent casts a spell$/i.test(head)) return { trigger: { on: 'opponentCastsSpell' } };
  if (/^Whenever you attack$/i.test(head)) return { trigger: { on: 'youAttack' } };
  if (/^Whenever ~ deals combat damage to a player$/i.test(head)) return { trigger: { on: 'combatDamageToPlayer', self: true } };
  const zoneTrigger = (on: 'etb' | 'dies', what: FilterSpec): TriggerSpec =>
    on === 'etb' ? { on: 'etb', what } : { on: 'dies', what };
  const selfTrigger = (on: 'etb' | 'dies'): TriggerSpec => (on === 'etb' ? { on: 'etb', self: true } : { on: 'dies', self: true });
  if ((m = head.match(/^Whenever (?:another|a) creature( you control)? (enters|dies)$/i))) {
    const another = /^Whenever another/i.test(head);
    const filter: FilterSpec = { what: 'creature', controlledBy: m[1] ? 'you' : 'any', other: true };
    const on = m[2].toLowerCase() === 'enters' ? 'etb' : 'dies';
    // "a creature you control dies" inclui a própria: gatilho próprio extra.
    return { trigger: zoneTrigger(on, filter), extraSelf: another ? undefined : selfTrigger(on) };
  }
  if (/^Whenever ~ or another creature you control dies$/i.test(head))
    return { trigger: { on: 'dies', what: { what: 'creature', controlledBy: 'you', other: true } }, extraSelf: { on: 'dies', self: true } };
  if ((m = head.match(/^Whenever (?:a|another) (\w+) you control (enters|dies)$/i))) {
    const sub = m[1];
    const on = m[2].toLowerCase() === 'enters' ? 'etb' : 'dies';
    const typeWhat = TYPE_WORD[sub.toLowerCase()];
    if (typeWhat) return { trigger: zoneTrigger(on, { what: typeWhat, controlledBy: 'you', other: true }) };
    return { trigger: zoneTrigger(on, { what: 'creature', subtype: sub, controlledBy: 'you', other: true }) };
  }
  if (/^(?:Landfall — )?Whenever a land (?:you control )?enters(?: the battlefield under your control)?$/i.test(head))
    return { trigger: { on: 'etb', what: { what: 'land', controlledBy: 'you' } } };
  if ((m = head.match(/^At the beginning of (your|each) (upkeep|end step)$/i)))
    return { trigger: { on: m[2].toLowerCase() === 'upkeep' ? 'upkeep' : 'endStep', whose: m[1].toLowerCase() === 'your' ? 'controller' : 'each' } };
  if (/^At the beginning of each player's upkeep$/i.test(head)) return { trigger: { on: 'upkeep', whose: 'each' } };
  if (/^Whenever you cast a noncreature spell$/i.test(head)) return { trigger: { on: 'youCastSpell', noncreatureOnly: true } };
  if (/^Whenever you cast an instant or sorcery spell$/i.test(head)) return { trigger: { on: 'youCastSpell', instantSorceryOnly: true } };
  if (/^Whenever you cast a spell$/i.test(head)) return { trigger: { on: 'youCastSpell' } };
  if (/^Whenever you gain life$/i.test(head)) return { trigger: { on: 'youGainLife' } };
  return null;
}

/** Try to parse a whole line; mutates `st`. Returns false if unrecognized. */
function parseLine(rawLine: string, st: ParseState, isSpell: boolean, subtypes: string[]): boolean {
  let m: RegExpMatchArray | null;
  // Palavra de habilidade ("Metalcraft — ", "Landfall — ") é rótulo, não regra.
  const line = rawLine.replace(/^(?!Landfall)[A-Z][a-z]+(?: [a-z]+)* — (?=\{|When|Whenever|At |~)/, '');

  // ---- modal spells: "Choose one —" + "• …" lines
  if (isSpell && /^Choose one —$/i.test(line)) { st.modalOpen = true; return true; }
  if (st.modalOpen && line.startsWith('• ')) {
    const parsed = parseEffectText(line.slice(2).trim().replace(/\.?$/, '.'));
    if (!parsed) return false;
    st.spellModes.push({ label: line.slice(2).trim(), targets: specsOf(parsed), effect: parsed.steps });
    return true;
  }
  // ETB modal de permanente: "When ~ enters, choose one —" + bullets.
  if (/^When ~ enters, choose one —$/i.test(line)) { st.modalTrigger = { on: 'etb', self: true }; st.modalTriggerModes = []; return true; }
  if (st.modalTrigger && line.startsWith('• ')) {
    const parsed = parseEffectText(line.slice(2).trim().replace(/\.?$/, '.'));
    if (!parsed) return false;
    st.modalTriggerModes!.push({ label: line.slice(2).trim(), targets: specsOf(parsed), effect: parsed.steps });
    return true;
  }
  if (line.startsWith('• ')) return false;

  // Linhas de formato (Commander/draft/ante) sem efeito num jogo de dois: reconhecidas e ignoradas.
  if (/^(~ can be your commander\.|Choose a Background|Doctor's companion|Partner(?:—.+)?|Friends forever|Draft ~ face up\.|Draft this card face up\.|A deck can have any number of cards named ~\.|Remove this card from your deck before playing if you're not playing for ante\.|Job select|Companion — .+|Start your engines!|Ascend|Increment|Storied|Read ahead|Play with the top card of your library revealed\.)$/i.test(line)) return true;
  if (/^You may look at the top card of your library any time\.$/i.test(line)) { st.revealTop = true; return true; }
  if (/^~ enters tapped unless you have two or more opponents\.$/i.test(line)) { st.entersTapped = true; return true; }
  if (/^You may play an additional land on each of your turns\.$/i.test(line)) { st.extraLands = 1; return true; }
  if (/^You have hexproof\.$/i.test(line)) { st.playerHexproof = true; return true; }
  if (/^Players can't gain life\.$/i.test(line)) { st.noLifeGain = 'all'; return true; }
  if (/^Your opponents can't gain life\.$/i.test(line)) { st.noLifeGain = 'opponents'; return true; }
  if (/^~ can't be blocked by more than one creature\.$/i.test(line)) { st.maxBlockers = 1; return true; }
  if ((m = line.match(/^~ can't be blocked except by (\w+) or more creatures\.$/i))) { const n = num(m[1]); if (n === null) return false; st.minBlockers = n; return true; }
  if (/^~ can block an additional creature each combat\.$/i.test(line)) { st.extraBlocks = 1; return true; }
  if (/^~ can block any number of creatures\.$/i.test(line)) { st.extraBlocks = 'any'; return true; }
  if ((m = line.match(/^~ can't be blocked by creatures with power (\d+) or greater\.$/i))) { st.evasionPowerAtLeast = parseInt(m[1], 10); return true; }
  if (/^As ~ enters, choose a color\.$/i.test(line)) { st.chooseOnEnter = 'color'; return true; }
  if (/^As ~ enters, choose a creature type\.$/i.test(line)) { st.chooseOnEnter = 'creatureType'; return true; }
  if (/^~ enters tapped\. As it enters, choose a color\.$/i.test(line)) { st.entersTapped = true; st.chooseOnEnter = 'color'; return true; }
  if ((m = line.match(/^\{T\}: Add one mana of the chosen color\.$/i))) {
    st.abilities.push({ kind: 'activated', cost: { tap: true }, effect: [{ op: 'addChosenColorMana' }], text: 'Adicionar uma mana da cor escolhida', isManaAbility: true });
    return true;
  }
  if ((m = line.match(/^Creatures you control of the chosen type get ([+-]\d+)\/([+-]\d+)\.$/i))) {
    st.abilities.push({ kind: 'static', filter: { what: 'creature', controlledBy: 'you', chosenSubtype: true }, power: parseInt(m[1], 10), toughness: parseInt(m[2], 10), text: line });
    return true;
  }
  if ((m = line.match(/^~ enters with (\w+|X) ([\w+/-]+) counters? on it\.$/i))) {
    const n = m[1] === 'X' ? 'X' : num(m[1]);
    if (n === null) return false;
    st.entersWithCounters = { counter: m[2], count: n };
    return true;
  }
  if ((m = line.match(/^If ~ was kicked, it enters with (\w+) \+1\/\+1 counters? on it\.$/i))) {
    const n = num(m[1]);
    if (n === null) return false;
    st.kickerEnters = { counter: '+1/+1', count: n };
    return true;
  }
  if ((m = line.match(/^At the beginning of your upkeep, sacrifice ~ unless you pay ((?:\{[^}]+\})+)\.$/i))) {
    st.abilities.push({ kind: 'triggered', trigger: { on: 'upkeep', whose: 'controller' }, effect: [{ op: 'payOrElse', cost: m[1], else: [{ op: 'sacrificeSelf' }] }], text: `pague ${m[1]} ou sacrifique` });
    return true;
  }
  if (/^At the beginning of the end step, sacrifice ~\.$/i.test(line)) {
    st.abilities.push({ kind: 'triggered', trigger: { on: 'endStep', whose: 'each' }, effect: [{ op: 'sacrificeSelf' }], text: 'sacrifique no fim do turno' });
    return true;
  }
  if (/^At the beginning of the end step, return ~ to its owner's hand\.$/i.test(line)) {
    st.abilities.push({ kind: 'triggered', trigger: { on: 'endStep', whose: 'each' }, effect: [{ op: 'returnToHand', what: 'self' }], text: 'volta para a mão no fim do turno' });
    return true;
  }
  if (/^When ~ becomes the target of a spell or ability, sacrifice it\.$/i.test(line)) {
    st.abilities.push({ kind: 'triggered', trigger: { on: 'becomesTargeted', self: true }, effect: [{ op: 'sacrificeSelf' }], text: 'sacrifique ao virar alvo' });
    return true;
  }
  if ((m = line.match(/^(?:\{[^}]+\})+: Monstrosity (\d+)\.$/i)) || (m = line.match(/^(?:\{[^}]+\})+: Adapt (\d+)\.$/i))) {
    const costText = line.split(':')[0];
    const kind = /Monstrosity/i.test(line) ? 'monstrous' : 'adapted';
    st.abilities.push({ kind: 'activated', cost: { mana: costText }, effect: [{ op: 'putCountersOnce', counter: '+1/+1', count: parseInt(m[1], 10), flag: kind }], text: `${kind === 'monstrous' ? 'Monstruosidade' : 'Adaptar'} ${m[1]}` });
    return true;
  }
  // "During your turn, ~ has first strike." / "~ has hexproof as long as it's untapped." / "Threshold — ~ gets +N/+N as long as…"
  if ((m = line.match(/^During your turn, ~ (?:has (\w[\w\s]*?)|gets ([+-]\d+)\/([+-]\d+))\.$/i))) {
    const kws = m[1] ? keywordList(m[1]) : undefined;
    if (m[1] && !kws) return false;
    st.abilities.push({ kind: 'static', selfOnly: true, filter: {}, condition: { kind: 'yourTurn' }, keywords: kws ?? undefined, power: m[2] ? parseInt(m[2], 10) : undefined, toughness: m[3] ? parseInt(m[3], 10) : undefined, text: line });
    return true;
  }
  if ((m = line.match(/^~ has (\w[\w\s]*?) as long as (?:it's|it is) (untapped|tapped|attacking)\.$/i))) {
    const kws = keywordList(m[1]);
    if (!kws) return false;
    st.abilities.push({ kind: 'static', selfOnly: true, filter: {}, condition: { kind: m[2].toLowerCase() as 'untapped' }, keywords: kws, text: line });
    return true;
  }
  if ((m = line.match(/^(?:Threshold — )?(?:As long as there are seven or more cards in your graveyard, ~ gets ([+-]\d+)\/([+-]\d+)(?: and has (\w[\w\s]*?))?|~ gets ([+-]\d+)\/([+-]\d+)(?: and has (\w[\w\s]*?))? as long as there are seven or more cards in your graveyard)\.$/i))) {
    const p = m[1] ?? m[4], t = m[2] ?? m[5], k = m[3] ?? m[6];
    const kws = k ? keywordList(k) : undefined;
    if (k && !kws) return false;
    st.abilities.push({ kind: 'static', selfOnly: true, filter: {}, condition: { kind: 'graveyardAtLeast', count: 7 }, power: parseInt(p, 10), toughness: parseInt(t, 10), keywords: kws ?? undefined, text: line });
    return true;
  }
  if ((m = line.match(/^(?:Metalcraft — )?~ gets ([+-]\d+)\/([+-]\d+)(?: and has (\w[\w\s]*?))? as long as you control (\w+) or more (artifacts|creatures|lands|enchantments)\.$/i))) {
    const n = num(m[4]);
    const kws = m[3] ? keywordList(m[3]) : undefined;
    if (n === null || (m[3] && !kws)) return false;
    st.abilities.push({ kind: 'static', selfOnly: true, filter: {}, condition: { kind: 'controlsAtLeast', count: n, filter: { what: m[5].replace(/s$/, '').toLowerCase() as 'artifact', controlledBy: 'you' } }, power: parseInt(m[1], 10), toughness: parseInt(m[2], 10), keywords: kws ?? undefined, text: line });
    return true;
  }
  if ((m = line.match(/^(?:Delirium — )?~ gets ([+-]\d+)\/([+-]\d+)(?: and has (\w[\w\s]*?))? as long as there are four or more card types among cards in your graveyard\.$/i))) {
    const kws = m[3] ? keywordList(m[3]) : undefined;
    if (m[3] && !kws) return false;
    st.abilities.push({ kind: 'static', selfOnly: true, filter: {}, condition: { kind: 'delirium' }, power: parseInt(m[1], 10), toughness: parseInt(m[2], 10), keywords: kws ?? undefined, text: line });
    return true;
  }
  if ((m = line.match(/^~ has (\w[\w\s]*?) as long as it has a ([\w+/-]+) counter on it\.$/i))) {
    const kws = keywordList(m[1]);
    if (!kws) return false;
    st.abilities.push({ kind: 'static', selfOnly: true, filter: {}, condition: { kind: 'hasCounter', counter: m[2] }, keywords: kws, text: line });
    return true;
  }
  if ((m = line.match(/^(Other )?creatures you control with (flying|trample|haste|vigilance|lifelink|deathtouch|reach|menace) get ([+-]\d+)\/([+-]\d+)\.$/i))) {
    st.abilities.push({ kind: 'static', filter: { what: 'creature', controlledBy: 'you', withKeyword: KEYWORDS[m[2].toLowerCase()], other: !!m[1] || undefined }, power: parseInt(m[3], 10), toughness: parseInt(m[4], 10), text: line });
    return true;
  }
  if ((m = line.match(/^Creatures your opponents control get ([+-]\d+)\/([+-]\d+)\.$/i))) {
    st.abilities.push({ kind: 'static', filter: { what: 'creature', controlledBy: 'opponent' }, power: parseInt(m[1], 10), toughness: parseInt(m[2], 10), text: line });
    return true;
  }
  if ((m = line.match(/^All (\w+) creatures get ([+-]\d+)\/([+-]\d+)\.$/i))) {
    st.abilities.push({ kind: 'static', filter: { what: 'creature', controlledBy: 'any', subtype: m[1] }, power: parseInt(m[2], 10), toughness: parseInt(m[3], 10), text: line });
    return true;
  }

  // Keywords de custo/extra que não mudam a resolução: a mágica fica jogável
  // pagando o custo cheio (parcial, com nota). Storm a engine já faz.
  if (/^Storm$/i.test(line)) { st.storm = true; return true; }
  if (/^(Convoke|Delve|Improvise|Assist|Affinity for artifacts|Buyback (?:\{[^}]+\})+|Rebound|Cascade|Split second|Retrace|Cipher|Gravestorm|Replicate (?:\{[^}]+\})+|Escalate (?:\{[^}]+\})+|Entwine (?:\{[^}]+\})+|Miracle (?:\{[^}]+\})+|Overload (?:\{[^}]+\})+|Madness (?:\{[^}]+\})+)$/i.test(line)) {
    st.softNotes.push(line);
    return true;
  }
  if (/^You have no maximum hand size\.$/i.test(line)) { st.noMaxHandSize = true; return true; }

  // ---- planeswalker loyalty abilities ("+1: …", "−3: …", "0: …")
  if ((m = line.match(/^([+−-]?\d+): (.+)$/))) {
    const cost = parseInt(m[1].replace('−', '-'), 10);
    const parsed = parseEffectText(m[2]);
    if (!parsed || parsed.selfExile) return false;
    st.abilities.push({ kind: 'loyalty', cost, targets: specsOf(parsed), effect: parsed.steps, text: line });
    return true;
  }

  // ---- keyword line ("Flying, first strike" / "Protection from black" / "Ward {2}" / "Prowess")
  const parts = line.split(/,\s*/).map((p) => p.trim().replace(/\.$/, ''));
  const isKw = (p: string) =>
    KEYWORDS[p.toLowerCase()] !== undefined ||
    /^protection from (white|blue|black|red|green)$/i.test(p) ||
    /^ward \{\d+\}$/i.test(p) ||
    /^(prowess|devoid|infect|wither|exalted|flanking|skulk|persist|undying|evolve|mentor|unleash|riot|living weapon)$/i.test(p) ||
    /^(toxic|bushido|crew|saddle|rampage|afflict|renown|modular|afterlife|fabricate|bloodthirst|vanishing|fading|devour) \d+$/i.test(p) ||
    /^(echo|cumulative upkeep) (?:\{[^}]+\})+$/i.test(p);
  if (parts.length > 0 && parts.every(isKw)) {
    for (const p of parts) {
      const prot = p.match(/^protection from (white|blue|black|red|green)$/i);
      const ward = p.match(/^ward \{(\d+)\}$/i);
      const numKw = p.match(/^(toxic|bushido|crew|saddle|rampage|afflict|renown|modular|afterlife|fabricate|bloodthirst|vanishing|fading|devour) (\d+)$/i);
      const costKw = p.match(/^(echo|cumulative upkeep) ((?:\{[^}]+\})+)$/i);
      if (prot) st.protectionFrom.push(COLOR_WORDS[prot[1].toLowerCase()]);
      else if (ward) st.ward = parseInt(ward[1], 10);
      else if (numKw) {
        const n = parseInt(numKw[2], 10);
        const k = numKw[1].toLowerCase();
        if (k === 'toxic') st.toxic = n;
        else if (k === 'bushido') st.bushido = n;
        else if (k === 'crew' || k === 'saddle') st.crew = n;
        else (st.flags as Record<string, number>)[k] = n;
      }
      else if (costKw) (st.flags as Record<string, string>)[costKw[1].toLowerCase() === 'echo' ? 'echo' : 'cumulativeUpkeep'] = costKw[2];
      else if (/^infect$/i.test(p)) st.infect = true;
      else if (/^wither$/i.test(p)) st.wither = true;
      else if (/^exalted$/i.test(p)) st.exalted = true;
      else if (/^(flanking|skulk|persist|undying|evolve|mentor|unleash|riot)$/i.test(p)) (st.flags as Record<string, boolean>)[p.toLowerCase()] = true;
      else if (/^living weapon$/i.test(p)) (st.flags as Record<string, boolean>).livingWeapon = true;
      else if (/^devoid$/i.test(p)) st.devoid = true;
      else if (/^prowess$/i.test(p))
        st.abilities.push({
          kind: 'triggered',
          trigger: { on: 'youCastSpell', noncreatureOnly: true },
          effect: [{ op: 'pump', what: 'self', power: 1, toughness: 1 }],
          text: 'Prowess: +1/+1 até o fim do turno',
        });
      else st.keywords.push(KEYWORDS[p.toLowerCase()]);
    }
    return true;
  }

  // ---- single-line statics about the card itself
  if (/^~ enters (the battlefield )?tapped\.$/i.test(line)) { st.entersTapped = true; return true; }
  if (/^~ can't block\.$/i.test(line)) { st.keywords.push('cantBlock'); return true; }
  if (/^~ can't be blocked\.$/i.test(line)) { st.keywords.push('unblockable'); return true; }
  if (/^~ attacks each combat if able\.$/i.test(line)) { st.keywords.push('mustAttack'); return true; }
  if (/^~ doesn't untap during your untap step\.$/i.test(line)) { st.keywords.push('doesntUntap'); return true; }
  if (/^~ can block only creatures with flying\.$/i.test(line)) { st.keywords.push('blockOnlyFlying'); return true; }
  if ((m = line.match(/^~ can't be blocked by creatures with power (\d+) or less\.$/i))) { st.evasionPowerAtMost = parseInt(m[1], 10); return true; }
  if (/^You control enchanted creature\.$/i.test(line)) { st.attachEffect = { ...(st.attachEffect ?? {}), controlHost: true }; return true; }
  if ((m = line.match(/^~ enters tapped unless you control (\w+) or (more|fewer) other lands\.$/i))) {
    const n = num(m[1]);
    if (n === null) return false;
    const filter: FilterSpec = { what: 'land', other: true };
    st.entersTappedUnless = m[2].toLowerCase() === 'more'
      ? { controlsAtLeast: { count: n, filter } }
      : { controlsAtMost: { count: n, filter } };
    return true;
  }
  if ((m = line.match(/^~ enters tapped unless you control (?:a|an) (\w+) or (?:a|an) (\w+)\.$/i))) {
    if (!BASIC_TYPES.includes(m[1]) || !BASIC_TYPES.includes(m[2])) return false;
    st.entersTappedUnless = { controlsSubtypeAnyOf: [m[1], m[2]] };
    return true;
  }
  if ((m = line.match(/^As ~ enters, you may pay (\d+) life\. If you don't, it enters tapped\.$/i))) { st.shockLife = parseInt(m[1], 10); return true; }
  if ((m = line.match(/^~ gets \+1\/\+1 for each (other )?(\w+) you control\.$/i))) {
    const word = m[2];
    const filter: FilterSpec = TYPE_WORD[word.toLowerCase()]
      ? { what: TYPE_WORD[word.toLowerCase()], controlledBy: 'you', other: !!m[1] || undefined }
      : { what: 'creature', subtype: word.replace(/s$/, ''), controlledBy: 'you', other: !!m[1] || undefined };
    if (!TYPE_WORD[word.toLowerCase()] && !/^[A-Z]/.test(word)) return false;
    st.abilities.push({ kind: 'static', selfOnly: true, filter: {}, powerPer: filter, toughnessPer: filter, text: line.replace(/\.$/, '') });
    return true;
  }
  if ((m = line.match(/^(Basic landcycling|Plainscycling|Islandcycling|Swampcycling|Mountaincycling|Forestcycling) ((?:\{[^}]+\})+)$/i))) {
    const k = m[1].toLowerCase();
    const filter: FilterSpec = k === 'basic landcycling' ? { what: 'land', basic: true } : { what: 'land', subtype: k.replace('cycling', '').replace(/^\w/, (c) => c.toUpperCase()) };
    st.cyclingMana = m[2];
    st.cyclingEffect = [{ op: 'search', filter, count: 1, to: 'hand' }];
    return true;
  }
  if (/^~ can't be blocked except by creatures with flying(?: or reach)?\.$/i.test(line)) { st.keywords.push('flying'); return true; } // aproximação: evasão igual a voar, sem bloquear voadores
  if (/^When ~ enters, tap enchanted creature\.$/i.test(line)) {
    st.abilities.push({ kind: 'triggered', trigger: { on: 'etb', self: true }, effect: [{ op: 'tap', what: 'host' }], text: 'vira a criatura encantada' });
    return true;
  }
  if (/^When ~ enters, attach it to target creature you control\.$/i.test(line)) {
    st.abilities.push({ kind: 'triggered', trigger: { on: 'etb', self: true }, targets: [{ what: 'creature', controlledBy: 'you' }], effect: [{ op: 'attach' }], text: 'anexa a uma criatura sua' });
    return true;
  }
  if (/^~ can't be countered\.$/i.test(line)) { st.uncounterable = true; return true; }
  if ((m = line.match(/^~ enters (?:the battlefield )?with (\w+|X) \+1\/\+1 counters? on it\.$/i))) {
    const n = m[1] === 'X' ? 'X' : num(m[1]);
    if (n === null) return false;
    st.entersWithCounters = { counter: '+1/+1', count: n };
    return true;
  }
  if ((m = line.match(/^As an additional cost to cast (?:this spell|~), sacrifice (?:a|an) (creature|artifact|land|permanent|enchantment)\.$/i))) {
    st.additionalCost = { sacrifice: { what: TYPE_WORD[m[1].toLowerCase()] } };
    return true;
  }

  // ---- mana abilities
  // Painlands: "{T}: Add {R} or {G}. ~ deals 1 damage to you."
  if ((m = line.match(/^\{T\}: Add ((?:\{[WUBRG]\},? )*(?:or )?\{[WUBRG]\})\. ~ deals (\d+) damage to you\.$/)) && m[1].includes('or')) {
    const colors = [...m[1].matchAll(/\{([WUBRG])\}/g)].map((x) => x[1] as Color);
    st.abilities.push({
      kind: 'activated',
      cost: { tap: true },
      effect: [{ op: 'addManaChoice', who: 'controller', colors }, { op: 'damage', to: 'controller', amount: parseInt(m[2], 10) }],
      text: `Adicionar ${colors.map((c) => `{${c}}`).join(' ou ')} (${m[2]} de dano em você)`,
      isManaAbility: true,
    });
    return true;
  }
  if ((m = line.match(/^\{T\}: Add ((?:\{[WUBRGC]\})+)\.$/))) {
    const mana = [...m[1].matchAll(/\{([WUBRGC])\}/g)].map((x) => x[1] as Color | 'C');
    st.abilities.push({
      kind: 'activated',
      cost: { tap: true },
      effect: [{ op: 'addMana', who: 'controller', mana }],
      text: `Adicionar ${m[1]}`,
      isManaAbility: true,
    });
    return true;
  }
  if ((m = line.match(/^\{T\}: Add ((?:\{[WUBRG]\},? )*(?:or )?\{[WUBRG]\})\.$/)) && m[1].includes('or')) {
    const colors = [...m[1].matchAll(/\{([WUBRG])\}/g)].map((x) => x[1] as Color);
    st.abilities.push({
      kind: 'activated',
      cost: { tap: true },
      effect: [{ op: 'addManaChoice', who: 'controller', colors }],
      text: `Adicionar ${colors.map((c) => `{${c}}`).join(' ou ')}`,
      isManaAbility: true,
    });
    return true;
  }
  if ((m = line.match(/^((?:\{[^}]+\})+, )?\{T\}(?:, Sacrifice ~)?(?:, Pay (\d+) life)?: Add one mana of any color\.(?: (Activate only if [^.]+)\.)?$/))) {
    const sacSelf = line.includes(', Sacrifice ~');
    const payLife = m[2] ? parseInt(m[2], 10) : undefined;
    const mana = m[1] ? m[1].slice(0, -2) : undefined;
    let condition: Extract<AbilityDef, { kind: 'activated' }>['condition'];
    if (m[3]) {
      const parsed = parseActivationCondition(m[3]);
      if (!parsed) return false;
      condition = parsed;
    }
    st.abilities.push({
      kind: 'activated',
      cost: { tap: true, sacrificeSelf: sacSelf || undefined, payLife, mana },
      effect: [{ op: 'addManaChoice', who: 'controller' }],
      text:
        'Adicionar uma mana de qualquer cor' +
        (mana ? ` (${mana})` : '') +
        (sacSelf ? ' (sacrificando)' : '') +
        (payLife ? ` (pague ${payLife} de vida)` : ''),
      isManaAbility: true,
      condition,
    });
    return true;
  }
  if ((m = line.match(/^\{T\}, Sacrifice ~: Add ((?:\{[WUBRGC]\})+)\.$/))) {
    const mana = [...m[1].matchAll(/\{([WUBRGC])\}/g)].map((x) => x[1] as Color | 'C');
    st.abilities.push({
      kind: 'activated',
      cost: { tap: true, sacrificeSelf: true },
      effect: [{ op: 'addMana', who: 'controller', mana }],
      text: `Sacrificar: adicionar ${m[1]}`,
      isManaAbility: true,
    });
    return true;
  }

  // ---- cycling / flashback / alt cost
  if ((m = line.match(/^Cycling (\{[^}]+\}(?:\{[^}]+\})*)$/i))) { st.cyclingMana = m[1]; return true; }
  if ((m = line.match(/^Kicker ((?:\{[^}]+\})+)$/i))) { st.kickerCost = m[1]; return true; }
  if ((m = line.match(/^Flashback ((?:\{[^}]+\})+)$/i))) { st.flashbackCost = m[1]; return true; }
  if (/^Flashback—Sacrifice a creature\.$/i.test(line)) { st.flashbackSacrifice = { what: 'creature' }; return true; }
  if ((m = line.match(/^You may (?:pay (\d+) life and )?exile a (white|blue|black|red|green) card from your hand rather than pay (?:this spell's|~'s) mana cost\.$/i))) {
    const payLife = m[1] ? parseInt(m[1], 10) : undefined;
    st.altCost = {
      payLife,
      exileFromHand: { count: 1, filter: { color: COLOR_WORDS[m[2].toLowerCase()] } },
      label: (payLife ? `pague ${payLife} de vida e ` : '') + `exile uma carta ${COLOR_PT[m[2].toLowerCase()]} da mão`,
    };
    return true;
  }

  // ---- aura / equipment framing
  if ((m = line.match(/^Enchant (creature|land|artifact|enchantment|permanent)( you control| an opponent controls)?$/i))) {
    const what = m[1].toLowerCase() as NonNullable<CardDefinition['enchant']>['what'];
    st.enchant = { what, controlledBy: m[2] ? (/you control/i.test(m[2]) ? 'you' : 'opponent') : undefined };
    return true;
  }
  if ((m = line.match(/^(Enchanted|Equipped) (?:creature|permanent|land) (.+)\.$/i))) {
    const body = m[2];
    const eff = { ...(st.attachEffect ?? {}) };
    let mm: RegExpMatchArray | null;
    if ((mm = body.match(/^gets ([+-]\d+)\/([+-]\d+)(?: and has (\w[\w\s,]*?))?$/i))) {
      eff.power = (eff.power ?? 0) + parseInt(mm[1], 10);
      eff.toughness = (eff.toughness ?? 0) + parseInt(mm[2], 10);
      if (mm[3]) {
        const kws = keywordList(mm[3]);
        if (!kws) return false;
        eff.keywords = [...(eff.keywords ?? []), ...kws];
      }
    } else if ((mm = body.match(/^has (\w[\w\s,]*?)$/i))) {
      const kws = keywordList(mm[1]);
      if (!kws) return false;
      eff.keywords = [...(eff.keywords ?? []), ...kws];
    } else if (/^can't attack or block$/i.test(body)) { eff.cantAttack = true; eff.cantBlock = true; }
    else if (/^can't attack$/i.test(body)) eff.cantAttack = true;
    else if (/^can't block$/i.test(body)) eff.cantBlock = true;
    else if (/^doesn't untap during its controller's untap step$/i.test(body)) eff.doesntUntap = true;
    else if (/^can't attack, block, or crew Vehicles$/i.test(body)) { eff.cantAttack = true; eff.cantBlock = true; }
    else return false;
    st.attachEffect = eff;
    return true;
  }
  if ((m = line.match(/^Equip (\{[^}]+\}(?:\{[^}]+\})*)$/i))) { st.equipCost = m[1]; return true; }

  // ---- triggered abilities
  if ((m = line.match(/^((?:When|Whenever|At the beginning of|Landfall — Whenever)[^,]+), (.+)\.$/i))) {
    const header = parseTriggerHeader(m[1].trim());
    if (!header) return false;
    let body = m[2].trim();
    // Pronomes referindo a própria permanente: "it deals/gets/gains" → "~ …".
    body = body.replace(/^it (deals|gets|gains) /i, '~ $1 ');
    const parsed = parseEffectText(body + '.');
    if (!parsed || parsed.selfExile) return false;
    const ability: AbilityDef = {
      kind: 'triggered',
      trigger: header.trigger,
      targets: specsOf(parsed),
      effect: parsed.steps,
      text: m[2].trim(),
    };
    st.abilities.push(ability);
    if (header.extraSelf) st.abilities.push({ ...ability, trigger: header.extraSelf });
    return true;
  }

  // ---- static anthems / lords
  if ((m = line.match(/^(Other )?(?:([A-Z]\w+) )?creatures you control (?:get ([+-]\d+)\/([+-]\d+))?(?: and )?(?:have (\w[\w\s,]*?))?\.$/i)) && (m[3] || m[5])) {
    const kws = m[5] ? keywordList(m[5]) : undefined;
    if (m[5] && !kws) return false;
    const filter: FilterSpec = { what: 'creature', controlledBy: 'you', other: m[1] ? true : undefined, subtype: m[2] || undefined };
    st.abilities.push({
      kind: 'static',
      filter,
      power: m[3] ? parseInt(m[3], 10) : undefined,
      toughness: m[4] ? parseInt(m[4], 10) : undefined,
      keywords: kws ?? undefined,
      text: line.replace(/\.$/, ''),
    });
    return true;
  }

  // ---- generic activated abilities: "<cost>: <effect>. [Activate only as a sorcery.]"
  if ((m = line.match(/^([^:]+): (.+)$/)) && !/^(?:When|Whenever|At |If |As )/i.test(line)) {
    const cost = parseActivationCost(m[1]);
    if (!cost) return false;
    let body = m[2].trim();
    let sorceryOnly = false;
    if (/ Activate only as a sorcery\.$/i.test(body)) { sorceryOnly = true; body = body.replace(/ Activate only as a sorcery\.$/i, '.'); }
    if (/Activate only/i.test(body)) return false;
    const parsed = parseEffectText(body);
    if (!parsed || parsed.selfExile) return false;
    if (parsed.steps.length === 0) return false;
    st.abilities.push({
      kind: 'activated',
      cost,
      targets: specsOf(parsed),
      effect: parsed.steps,
      text: m[2].trim().replace(/\.$/, ''),
      sorceryOnly: sorceryOnly || undefined,
    });
    return true;
  }

  // ---- spell text: every sentence must parse; at most one target overall.
  if (isSpell) {
    if (/^Choose a nonland card name\. Target player reveals their hand and discards all cards with that name\.$/i.test(line)) {
      if (st.spellTargets.length > 0) return false;
      st.spellTargets.push({ what: 'player' });
      st.spellEffect.push({ op: 'nameCardDiscard', who: 'target:0' });
      return true;
    }
    const parsed = parseEffectText(line);
    if (!parsed) return false;
    const specs = specsOf(parsed);
    if (specs) {
      if (st.spellTargets.length > 0) return false;
      st.spellTargets.push(...specs);
    }
    st.spellEffect.push(...parsed.steps);
    if (parsed.kickerSteps) st.kickerEffect.push(...parsed.kickerSteps);
    if (parsed.selfExile) st.exileOnResolve = true;
    return true;
  }

  void subtypes;
  return false;
}

/** Optional diagnostics: which lines the compiler could not understand. */
export interface OracleDiagnostics {
  failedLines: string[];
}

export function compileOracleCard(input: OracleInput, diag?: OracleDiagnostics): CardDefinition | null {
  const { supertypes, types, subtypes } = parseTypeLine(input.typeLine);
  if (types.length === 0) return null;
  if (types.includes('Battle')) return null;
  // Planeswalker sem lealdade numérica (ou 0, que entra "com X marcadores"): manual.
  if (types.includes('Planeswalker') && (input.loyalty === undefined || input.loyalty <= 0)) return null;
  // Criatura com poder/resistência não numéricos (*/*, X/X): a engine
  // trataria como 0/0 e ela morreria ao entrar — fica manual.
  if (types.includes('Creature') && (input.power === undefined || input.toughness === undefined)) return null;
  const isSpell = types.includes('Instant') || types.includes('Sorcery');

  // Normalize: strip reminder text, replace the card's own name with ~.
  const shortName = input.name.split(',')[0];
  let text = (input.oracleText ?? '')
    .replace(/\([^)]*\)/g, '')
    .split(input.name).join('~')
    .split(shortName).join('~')
    .replace(/\bThis (creature|land|artifact|enchantment|permanent|Aura|Equipment|Vehicle|spell)\b/gi, '~')
    .replace(/[ \t]+/g, ' ')
    .trim();

  const st: ParseState = {
    keywords: [],
    protectionFrom: [],
    entersTapped: false,
    abilities: [],
    spellTargets: [],
    spellEffect: [],
    spellModes: [],
    modalOpen: false,
    devoid: false,
    uncounterable: false,
    exileOnResolve: false,
    storm: false,
    noMaxHandSize: false,
    kickerEffect: [],
    infect: false,
    wither: false,
    exalted: false,
    flags: {},
    revealTop: false,
    playerHexproof: false,
    softNotes: [],
  };

  // Spells stay all-or-nothing (a resolução tem que estar certa); permanentes
  // sem linhas de spell podem ser jogados mesmo com habilidades não
  // reconhecidas — elas ficam listadas em automationNotes (Tier 1.5 parcial).
  const unparsed: string[] = [];
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    if (!parseLine(line, st, isSpell, subtypes)) {
      diag?.failedLines.push(line);
      if (isSpell) return null;
      unparsed.push(line);
    }
  }

  // Regra 305.6: terrenos básicos têm a habilidade de mana intrínseca — o
  // texto oracle deles é só lembrete entre parênteses (descartado acima).
  const BASIC_MANA: Record<string, Color | 'C'> = { Plains: 'W', Island: 'U', Swamp: 'B', Mountain: 'R', Forest: 'G', Wastes: 'C' };
  if (types.includes('Land')) {
    for (const sub of subtypes) {
      const sym = BASIC_MANA[sub];
      if (!sym) continue;
      const already = st.abilities.some((a) => a.kind === 'activated' && a.isManaAbility && a.effect.some((e) => e.op === 'addMana' && e.mana.length === 1 && e.mana[0] === sym));
      if (!already)
        st.abilities.push({ kind: 'activated', cost: { tap: true }, effect: [{ op: 'addMana', who: 'controller', mana: [sym] }], text: `Adicionar {${sym}}`, isManaAbility: true });
    }
  }
  if (isSpell && st.spellEffect.length === 0 && st.spellModes.length === 0) return null;
  if (isSpell && st.spellModes.length > 0 && st.spellEffect.length > 0) return null; // modal + efeito solto: fora do escopo
  // Kicker sem efeito condicional reconhecido (ou vice-versa): fora do escopo.
  if (isSpell && (!!st.kickerCost !== st.kickerEffect.length > 0)) return null;
  if (!isSpell && st.kickerCost && !st.kickerEnters) unparsed.push(`Kicker ${st.kickerCost} (efeito do kicker não reconhecido)`);
  if (isSpell && st.modalOpen && st.spellModes.length < 2) return null;
  // Aura sem "Enchant X" reconhecido não pode ser conjurada nem parcialmente.
  if (subtypes.includes('Aura') && !st.enchant) return null;
  if (st.attachEffect && !st.enchant && !st.equipCost && !subtypes.includes('Equipment')) return null;

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
  if (st.modalTrigger) {
    if ((st.modalTriggerModes?.length ?? 0) < 2) unparsed.push('When ~ enters, choose one — (modos não reconhecidos)');
    else st.abilities.push({ kind: 'triggered', trigger: st.modalTrigger, effect: [], modes: st.modalTriggerModes, text: 'ao entrar, escolha um' });
  }
  // Planeswalker: precisa de ao menos uma habilidade de lealdade reconhecida.
  if (types.includes('Planeswalker') && !st.abilities.some((a) => a.kind === 'loyalty')) return null;

  return {
    id: `oracle-${input.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    name: input.name,
    oracleId: input.oracleId,
    scryfallId: input.scryfallId,
    manaCost: input.manaCost,
    types,
    subtypes,
    supertypes: supertypes.length > 0 ? supertypes : undefined,
    colors: st.devoid ? [] : input.colors ?? [],
    power: input.power,
    toughness: input.toughness,
    text: input.oracleText,
    keywords: st.keywords.length > 0 ? st.keywords : undefined,
    protectionFrom: st.protectionFrom.length > 0 ? st.protectionFrom : undefined,
    ward: st.ward,
    entersTapped: st.entersTapped || undefined,
    entersWithCounters: st.entersWithCounters,
    additionalCost: st.additionalCost,
    cycling: st.cyclingMana ? { mana: st.cyclingMana, effect: st.cyclingEffect } : undefined,
    loyalty: types.includes('Planeswalker') ? input.loyalty : undefined,
    crew: st.crew,
    evasionPowerAtMost: st.evasionPowerAtMost,
    entersTappedUnless: st.entersTappedUnless,
    shockLife: st.shockLife,
    infect: st.infect || undefined,
    wither: st.wither || undefined,
    toxic: st.toxic,
    exalted: st.exalted || undefined,
    bushido: st.bushido,
    ...st.flags,
    revealTop: st.revealTop || undefined,
    extraLands: st.extraLands,
    playerHexproof: st.playerHexproof || undefined,
    noLifeGain: st.noLifeGain,
    maxBlockers: st.maxBlockers,
    minBlockers: st.minBlockers,
    extraBlocks: st.extraBlocks,
    evasionPowerAtLeast: st.evasionPowerAtLeast,
    chooseOnEnter: st.chooseOnEnter,
    flashback: st.flashbackCost
      ? { cost: st.flashbackCost }
      : st.flashbackSacrifice
        ? { sacrifice: st.flashbackSacrifice }
        : undefined,
    altCost: st.altCost,
    uncounterable: st.uncounterable || undefined,
    exileOnResolve: st.exileOnResolve || undefined,
    storm: st.storm || undefined,
    noMaxHandSize: st.noMaxHandSize || undefined,
    kicker: st.kickerCost && (st.kickerEffect.length > 0 || st.kickerEnters)
      ? { cost: st.kickerCost, effect: st.kickerEffect, entersWithCounters: st.kickerEnters }
      : undefined,
    enchant: st.enchant,
    attachEffect: st.attachEffect,
    spellTargets: isSpell && st.spellTargets.length > 0 ? st.spellTargets : undefined,
    spellEffect: isSpell && st.spellModes.length === 0 ? st.spellEffect : undefined,
    spellModes: st.spellModes.length > 0 ? st.spellModes : undefined,
    abilities: st.abilities.length > 0 ? st.abilities : undefined,
    automation: unparsed.length > 0 || st.softNotes.length > 0 ? 'partial' : 'full',
    automationNotes:
      unparsed.length > 0 || st.softNotes.length > 0
        ? [...unparsed, ...st.softNotes.map((l) => `${l} (não aplicado — pague o custo normal)`)].slice(0, 8)
        : undefined,
  };
}
