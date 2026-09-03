/**
 * Compositional grammar for rules text (Leva 4).
 *
 * A sentence is SUBJECT × VERB × QUANTITY × CONDITION × DURATION. Instead of
 * one regex per card phrase, nouns ("nontoken creature you control with power
 * 2 or less"), amounts ("equal to the number of Zombies you control"),
 * conditions ("if you control a Cat") and verbs are parsed separately and
 * combined, so each new rule unlocks whole families of phrasings.
 *
 * Used by oracle-parser.ts as the fallback after its hand-written patterns,
 * and directly for conditions and generic statics.
 */
import type { CardType, Color, Keyword } from '../types.js';
import { BASIC_TYPES, CARD_TYPE_WORD, COLOR_WORDS, KEYWORDS, keywordList, num } from './lexicon.js';
import type { Cond, DynAmount, EffectStep, FilterSpec, PlayerSel, SubjectRef, TargetSpec, WhoSel } from './types.js';

export interface GCtx {
  /** What "it" / "that creature" refers to when no target came earlier in the sentence. */
  pronoun: SubjectRef;
  /** What "that player" refers to. */
  pronounPlayer: WhoSel;
  /** Index of the next target this sentence may introduce. */
  base: number;
  /** Targets already introduced in this line (pronouns refer to the last one). */
  priorSpecs: TargetSpec[];
}

export interface GResult {
  steps: EffectStep[];
  /** New target specs introduced by this sentence (appended after ctx.base). */
  specs: TargetSpec[];
}

// ----------------------------------------------------------------- nouns

/** Rich noun phrase → filter. Also reports player nouns and the zone a "card" noun lives in. */
export interface NounInfo {
  filter: FilterSpec;
  player?: 'you' | 'opponent' | 'each' | 'target' | 'targetOpponent';
  /** "card in/from your graveyard" etc. */
  zone?: 'graveyard' | 'hand' | 'library' | 'exile';
  /** "spell" nouns (counterspells). */
  spell?: { spellType?: TargetSpec['spellType'] };
  /** "any target". */
  any?: boolean;
}

const SUBTYPE_RE = /^[A-Z][a-z]+(?:-[A-Z][a-z]+)?$/;

export function parseNounG(raw: string): NounInfo | null {
  let n = raw.trim().replace(/\s+/g, ' ');
  const filter: FilterSpec = {};
  let zone: NounInfo['zone'];
  let m: RegExpMatchArray | null;

  // Players.
  const lower = n.toLowerCase();
  if (lower === 'you') return { filter: {}, player: 'you' };
  if (lower === 'each opponent' || lower === 'opponent' || lower === 'an opponent') return { filter: {}, player: 'opponent' };
  if (lower === 'each player' || lower === 'player') return { filter: {}, player: lower === 'player' ? 'target' : 'each' };
  if (lower === 'any target') return { filter: {}, any: true };
  if (lower === 'player or planeswalker' || lower === 'opponent or planeswalker') return { filter: {}, player: lower.startsWith('opponent') ? 'targetOpponent' : 'target' };

  // Spells.
  if ((m = n.match(/^(creature |noncreature |instant or sorcery |instant |sorcery |artifact |enchantment |planeswalker )?spell$/i))) {
    const t = (m[1] ?? '').trim().toLowerCase();
    const spellType: TargetSpec['spellType'] | undefined = t === 'creature' ? 'creature' : t === 'noncreature' ? 'noncreature' : t === 'instant or sorcery' ? 'instantSorcery' : undefined;
    if (t && !spellType) return null;
    return { filter: {}, spell: { spellType } };
  }

  // Zone suffixes: "creature card in/from your graveyard", "card from your hand".
  if ((m = n.match(/^(.+?) (?:cards? )?(?:in|from) (?:your|a|an opponent's|any|a single|target player's|that player's|their) (graveyard|hand|library|exile)$/i))) {
    n = m[1].replace(/ cards?$/i, '');
    zone = m[2].toLowerCase() as NounInfo['zone'];
    if (/an opponent's/i.test(raw)) filter.controlledBy = 'opponent';
    else if (/your/i.test(raw)) filter.controlledBy = 'you';
  }
  n = n.replace(/ cards?$/i, '');
  // "creature card with mana value 3 or less" → "creature with…" (the word "card" is not a type).
  n = n.replace(/ cards? (with|without|that)\b/i, ' $1');
  if (/^multicolored /i.test(n)) { n = n.replace(/^multicolored /i, ''); filter.multicolored = true; }

  const controllerSuffix = (): boolean => {
    const mm = n.match(/^(.+?) (you control|an opponent controls|your opponents control|you don't control|defending player controls|that player controls|its controller controls)$/i);
    if (!mm) return false;
    n = mm[1];
    const c = mm[2].toLowerCase();
    filter.controlledBy = c === 'you control' ? 'you' : c === 'that player controls' || c === 'its controller controls' ? undefined : 'opponent';
    return true;
  };
  // Controller suffixes.
  controllerSuffix();
  // Qualifier suffixes (may stack; the controller may sit between them: "creature you control with power 2 or less").
  let changed = true;
  while (changed) {
    changed = false;
    if (controllerSuffix()) changed = true;
    if ((m = n.match(/^(.+?) with (?:power|mana value|toughness) (\d+) or (greater|less|more|fewer)$/i))) {
      n = m[1];
      const v = parseInt(m[2], 10);
      const hi = /greater|more/i.test(m[3]);
      if (/with power/i.test(m[0])) { if (hi) filter.powerAtLeast = v; else filter.powerAtMost = v; }
      else if (/mana value/i.test(m[0])) { if (hi) filter.cmcAtLeast = v; else filter.cmcAtMost = v; }
      else { if (!hi) filter.toughnessAtMost = v; else return null; }
      changed = true;
    }
    if ((m = n.match(/^(.+?) with mana value (\d+)$/i))) { n = m[1]; filter.cmcEquals = parseInt(m[2], 10); changed = true; }
    if ((m = n.match(/^(.+?) (with|without) (flying|reach|trample|haste|vigilance|lifelink|deathtouch|menace|defender|flash|first strike|double strike|hexproof|indestructible)$/i))) {
      n = m[1];
      if (m[2].toLowerCase() === 'with') filter.withKeyword = KEYWORDS[m[3].toLowerCase()];
      else filter.withoutKeyword = KEYWORDS[m[3].toLowerCase()];
      changed = true;
    }
    if ((m = n.match(/^(.+?) with (?:a|an) ([\w+/-]+) counter on (?:it|them)$/i))) { n = m[1]; filter.withCounter = m[2]; changed = true; }
    if ((m = n.match(/^(.+?) that's (attacking or blocking|attacking|blocking|tapped|untapped)$/i))) {
      n = m[1];
      const q = m[2].toLowerCase();
      if (q === 'tapped') filter.tapped = true; else if (q === 'untapped') filter.untapped = true; else if (q === 'attacking') filter.attacking = true; else filter.inCombat = true;
      changed = true;
    }
  }
  // Prefix qualifiers.
  const prefixes: [RegExp, (mm: RegExpMatchArray) => boolean][] = [
    [/^(?:another|other) /i, () => { filter.other = true; return true; }],
    [/^nontoken /i, () => { filter.nontoken = true; return true; }],
    [/^token /i, () => { filter.token = true; return true; }],
    [/^legendary /i, () => { filter.legendary = true; return true; }],
    [/^(tapped|untapped) /i, (mm) => { if (mm[1].toLowerCase() === 'tapped') filter.tapped = true; else filter.untapped = true; return true; }],
    [/^(attacking or blocking|attacking|blocking) /i, (mm) => { if (mm[1].toLowerCase() === 'attacking') filter.attacking = true; else filter.inCombat = true; return true; }],
    [/^non(white|blue|black|red|green) /i, (mm) => { filter.notColor = COLOR_WORDS[mm[1].toLowerCase()]; return true; }],
    [/^(white|blue|black|red|green) /i, (mm) => { filter.color = COLOR_WORDS[mm[1].toLowerCase()]; return true; }],
    [/^non-([A-Z][a-z]+) /, (mm) => { filter.notSubtype = mm[1]; return true; }],
    [/^nonland /i, () => { filter.nonland = true; return true; }],
    [/^noncreature /i, () => { filter.noncreature = true; return true; }],
    [/^basic /i, () => { filter.basic = true; return true; }],
  ];
  changed = true;
  while (changed) {
    changed = false;
    for (const [re, apply] of prefixes) {
      const mm = n.match(re);
      if (mm && n.length > mm[0].length) { n = n.slice(mm[0].length); apply(mm); changed = true; }
    }
  }
  // Core noun: types / subtypes / alternatives.
  const core = n.trim();
  const words = core.split(' ');
  const typeWord = (w: string) => CARD_TYPE_WORD[w.toLowerCase().replace(/s$/, '')];
  const alts = core.split(/,?\s+or\s+|,\s*/).map((s) => s.trim()).filter(Boolean);
  if (alts.length > 1) {
    // "artifact or enchantment", "Elf or Goblin", "Mountain or Forest card".
    if (alts.every((a) => BASIC_TYPES.includes(a))) return { filter: { ...filter, what: 'land', subtypeAnyOf: alts }, zone };
    if (alts.every((a) => typeWord(a))) {
      const types = alts.map((a) => typeWord(a)!);
      if (types.includes('Instant') || types.includes('Sorcery')) return { filter: { ...filter, typeAnyOf: types }, zone };
      return { filter: { ...filter, what: 'permanent', typeAnyOf: types }, zone };
    }
    if (alts.every((a) => SUBTYPE_RE.test(a))) return { filter: { ...filter, what: 'creature', subtypeAnyOf: alts }, zone };
    // "creature or planeswalker" → creature (planeswalkers automated partially).
    if (alts.length === 2 && typeWord(alts[0]) === 'Creature' && /planeswalker/i.test(alts[1])) return { filter: { ...filter, what: 'creature' }, zone };
    return null;
  }
  if (words.length === 1) {
    const w = words[0];
    if (typeWord(w)) {
      const t = typeWord(w)!;
      if (t === 'Planeswalker') return null;
      return { filter: { ...filter, what: t.toLowerCase() as FilterSpec['what'] }, zone };
    }
    if (w.toLowerCase() === 'permanent' || w.toLowerCase() === 'permanents') return { filter: { ...filter, what: 'permanent' }, zone };
    if (w.toLowerCase() === 'card' || w.toLowerCase() === 'cards') return { filter, zone };
    if (SUBTYPE_RE.test(w.replace(/s$/, '')) || BASIC_TYPES.includes(w)) {
      const sub = BASIC_TYPES.includes(w) ? w : w.replace(/s$/, '');
      return { filter: { ...filter, what: BASIC_TYPES.includes(sub) ? 'land' : 'creature', subtype: sub }, zone };
    }
    return null;
  }
  if (words.length === 2) {
    const [a, b] = words;
    // "artifact creature", "creature token", "Zombie creature", "Elf creature", "land creature".
    if (typeWord(a) && typeWord(b)) {
      const tb = typeWord(b)!;
      return { filter: { ...filter, what: tb.toLowerCase() as FilterSpec['what'], typeAnyOf: [typeWord(a)!] }, zone };
    }
    if (b.toLowerCase() === 'token' || b.toLowerCase() === 'tokens') {
      const inner = parseNounG(a);
      if (!inner) return null;
      return { filter: { ...filter, ...inner.filter, token: true }, zone };
    }
    if (SUBTYPE_RE.test(a) && typeWord(b)) return { filter: { ...filter, what: typeWord(b)!.toLowerCase() as FilterSpec['what'], subtype: a }, zone };
    if (typeWord(a) && (b.toLowerCase() === 'permanent' || b.toLowerCase() === 'permanents')) return { filter: { ...filter, what: typeWord(a)!.toLowerCase() as FilterSpec['what'] }, zone };
    if (SUBTYPE_RE.test(a) && /^permanents?$/i.test(b)) return { filter: { ...filter, what: 'permanent', subtype: a }, zone };
    return null;
  }
  if (words.length === 3 && words[1].toLowerCase() === 'creature' && (words[2].toLowerCase() === 'token' || words[2].toLowerCase() === 'tokens') && SUBTYPE_RE.test(words[0]))
    return { filter: { ...filter, what: 'creature', subtype: words[0], token: true }, zone };
  return null;
}

/** Filter → target spec (targets are mostly battlefield permanents; graveyard cards keep zone). */
export function filterToTargetSpec(info: NounInfo): TargetSpec | null {
  if (info.any) return { what: 'any' };
  if (info.player) {
    return info.player === 'opponent' || info.player === 'targetOpponent' ? { what: 'player', controlledBy: 'opponent' } : { what: 'player' };
  }
  if (info.spell) return { what: 'spell', spellType: info.spell.spellType };
  const f = info.filter;
  const what: TargetSpec['what'] =
    f.what === 'creature' || f.what === 'land' || f.what === 'artifact' || f.what === 'enchantment' ? f.what : 'permanent';
  const spec: TargetSpec = { what };
  if (f.controlledBy === 'you') spec.controlledBy = 'you';
  if (f.controlledBy === 'opponent') spec.controlledBy = 'opponent';
  if (f.typeAnyOf) spec.typeAnyOf = f.typeAnyOf;
  if (f.nonland) spec.typeAnyOf = spec.typeAnyOf ?? ['Creature', 'Artifact', 'Enchantment', 'Planeswalker'];
  if (f.noncreature) { if (what === 'creature') return null; spec.typeAnyOf = spec.typeAnyOf ?? ['Land', 'Artifact', 'Enchantment', 'Planeswalker']; }
  if (f.withKeyword) spec.withKeyword = f.withKeyword;
  if (f.withoutKeyword) spec.withoutKeyword = f.withoutKeyword;
  if (f.powerAtLeast !== undefined) spec.powerAtLeast = f.powerAtLeast;
  if (f.powerAtMost !== undefined) spec.powerAtMost = f.powerAtMost;
  if (f.toughnessAtMost !== undefined) spec.toughnessAtMost = f.toughnessAtMost;
  if (f.cmcAtMost !== undefined) spec.cmcAtMost = f.cmcAtMost;
  if (f.cmcAtLeast !== undefined) spec.cmcAtLeast = f.cmcAtLeast;
  if (f.subtype) spec.subtype = f.subtype;
  if (f.subtypeAnyOf) spec.subtypeAnyOf = f.subtypeAnyOf;
  if (f.notSubtype) spec.notSubtype = f.notSubtype;
  if (f.color) spec.color = f.color;
  if (f.notColor) spec.notColor = f.notColor;
  if (f.token) spec.token = true;
  if (f.nontoken) spec.nontoken = true;
  if (f.tapped) spec.tapped = true;
  if (f.untapped) spec.untapped = true;
  if (f.attacking || f.inCombat) spec.combat = true;
  if (f.legendary) spec.legendary = true;
  if (f.withCounter) return null; // sem suporte em alvo
  if (info.zone === 'graveyard') { spec.zone = 'graveyard'; if (f.controlledBy === 'you') { spec.ownedBy = 'you'; spec.controlledBy = undefined; } }
  else if (info.zone) return null;
  return spec;
}

// ---------------------------------------------------------------- amounts

/** Dynamic amount phrase → DynAmount. `subject` is what "its" refers to. */
export function parseAmountG(text: string, subject: SubjectRef): DynAmount | null {
  const t = text.trim().toLowerCase();
  let m: RegExpMatchArray | null;
  if (t === 'x') return 'X';
  if (t === 'that much' || t === 'that many') return 'triggerAmount';
  const n = num(t);
  if (n !== null) return n;
  if ((m = t.match(/^(?:its|that creature's|that permanent's|~'s|this creature's) (power|toughness|mana value)$/))) {
    const k = m[1];
    return k === 'power' ? { powerOf: subject } : k === 'toughness' ? { toughnessOf: subject } : { cmcOf: subject };
  }
  if ((m = t.match(/^the number of (.+?) (?:you control|on the battlefield)$/))) {
    const info = parseNounG(m[1]);
    if (!info || info.player) return null;
    return { per: { ...info.filter, controlledBy: /you control/.test(t) ? 'you' : 'any' } };
  }
  if ((m = t.match(/^the number of (.+?) in your graveyard$/))) {
    const info = parseNounG(m[1].replace(/ cards?$/, ''));
    if (!info || info.player) return null;
    return { graveyardCount: 'controller', filter: Object.keys(info.filter).length ? info.filter : undefined };
  }
  if (t === 'the number of cards in your hand') return { handSize: 'controller' };
  if (t === 'the number of cards in your graveyard') return { graveyardCount: 'controller' };
  if (t === 'your life total') return { lifeOf: 'controller' };
  if (t === 'the number of basic land types among lands you control') return 'domain';
  if ((m = t.match(/^the number of ([\w+/-]+) counters on (?:it|~|this creature|that creature)$/))) return { countersOn: subject, counter: m[1] };
  if ((m = t.match(/^twice (.+)$/))) { const inner = parseAmountG(m[1], subject); return inner === null ? null : { times: 2, of: inner }; }
  return null;
}

/** "N" / "a" / "X" / "an amount equal to …" at the start of a phrase. */
function amountHead(text: string, subject: SubjectRef): { amount: DynAmount; rest: string } | null {
  let m: RegExpMatchArray | null;
  if ((m = text.match(/^(?:an amount of )?(?:damage |life |cards )?equal to (.+)$/i))) {
    const a = parseAmountG(m[1], subject);
    return a === null ? null : { amount: a, rest: '' };
  }
  if ((m = text.match(/^(\w+|X) (.+)$/i))) {
    const a = parseAmountG(m[1], subject);
    if (a !== null) return { amount: a, rest: m[2] };
  }
  return null;
}

/** "… for each <noun>" suffix → scale. */
function forEachSuffix(text: string): { rest: string; per: DynAmount } | null {
  const m = text.match(/^(.+?) for each (.+)$/i);
  if (!m) return null;
  const per = parseAmountG(`the number of ${m[2]}`, 'self') ?? (() => {
    const info = parseNounG(m[2].replace(/ you control$/i, '').replace(/ in your graveyard$/i, ''));
    if (!info || info.player) return null;
    if (/in your graveyard$/i.test(m[2])) return { graveyardCount: 'controller' as const, filter: info.filter };
    return { per: { ...info.filter, controlledBy: /you control$/i.test(m[2]) ? 'you' : info.filter.controlledBy } };
  })();
  return per ? { rest: m[1], per } : null;
}

function scaled(base: DynAmount, per: DynAmount): DynAmount {
  if (base === 1) return per;
  if (typeof base === 'number') return { times: base, of: per };
  return per;
}

// ------------------------------------------------------------- conditions

export function parseCondG(raw: string): Cond | null {
  const t = raw.trim().replace(/\.$/, '');
  let m: RegExpMatchArray | null;
  if ((m = t.match(/^(.+?) and (.+)$/i)) && !/ or /i.test(t)) {
    const a = parseCondG(m[1]);
    const b = parseCondG(m[2]);
    if (a && b) return { kind: 'and', conds: [a, b] };
  }
  if ((m = t.match(/^(.+?) or (.+)$/i)) && !/ and /i.test(t) && !/control|counter|life|card/i.test(m[1].split(' ').slice(-2).join(' '))) {
    const a = parseCondG(m[1]);
    const b = parseCondG(m[2]);
    if (a && b) return { kind: 'or', conds: [a, b] };
  }
  const low = t.toLowerCase();
  if (low === "it's your turn" || low === 'it is your turn') return { kind: 'yourTurn' };
  if (low === "it's not your turn") return { kind: 'not', cond: { kind: 'yourTurn' } };
  if (low === "you're the monarch" || low === 'you are the monarch') return { kind: 'isMonarch' };
  if (low === 'you have the initiative') return { kind: 'hasInitiative' };
  if (low === "you've completed a dungeon" || low === 'you have completed a dungeon') return { kind: 'completedDungeon' };
  if (low === 'a creature died this turn') return { kind: 'creatureDiedThisTurn' };
  if (low === 'you attacked this turn' || low === 'you attacked with a creature this turn') return { kind: 'attackedThisTurn' };
  if (low === 'a permanent left the battlefield under your control this turn' || low === 'a permanent you controlled left the battlefield this turn') return { kind: 'permanentLeftThisTurn' };
  if (low === "you've cast another spell this turn" || low === 'you cast another spell this turn' || low === "you've cast a spell this turn") return { kind: 'spellsCastThisTurnAtLeast', count: 2 };
  if ((m = low.match(/^you've cast (\w+) or more (?:other )?spells this turn$/))) { const n = num(m[1]); return n === null ? null : { kind: 'spellsCastThisTurnAtLeast', count: n }; }
  if (low === 'you gained life this turn' || low === "you've gained life this turn") return { kind: 'gainedLifeThisTurn' };
  // ---- Leva 5b
  if (low === 'no spells were cast last turn') return { kind: 'noSpellsLastTurn' };
  if (low === 'a player cast two or more spells last turn') return { kind: 'twoSpellsLastTurn' };
  if (low === "it's day" || low === 'it is day') return { kind: 'dayNight', value: 'day' };
  if (low === "it's night" || low === 'it is night') return { kind: 'dayNight', value: 'night' };
  if ((m = low.match(/^you(?:'ve)? gained (\w+) or more life this turn$/))) { const n = num(m[1]); return n === null ? null : { kind: 'lifeGainedAtLeast', amount: n }; }
  if (low === "you've cast a noncreature spell this turn" || low === 'you cast a noncreature spell this turn') return { kind: 'castNoncreatureThisTurn' };
  if (low === 'an opponent lost life this turn') return { kind: 'opponentLostLifeThisTurn' };
  if (low === 'a permanent left the battlefield this turn') return { kind: 'anyPermanentLeftThisTurn' };
  if (low === '~ attacked alone' || low === "it's attacking alone" || low === '~ is attacking alone') return { kind: 'attackedAlone' };
  if (low === 'you have no cards in hand' || low === 'your hand is empty') return { kind: 'handSizeAtMost', who: 'controller', amount: 0 };
  if ((m = low.match(/^you have (\w+) or more cards in hand$/))) { const n = num(m[1]); return n === null ? null : { kind: 'handSizeAtLeast', who: 'controller', amount: n }; }
  if ((m = low.match(/^you have (\w+) or fewer cards in hand$/))) { const n = num(m[1]); return n === null ? null : { kind: 'handSizeAtMost', who: 'controller', amount: n }; }
  if ((m = low.match(/^(?:you have|your life total is) (\d+) or (less|more|fewer|greater) life$/)) || (m = low.match(/^your life total is (\d+) or (less|more)$/)))
    return /less|fewer/.test(m[2]) ? { kind: 'lifeAtMost', who: 'controller', amount: parseInt(m[1], 10) } : { kind: 'lifeAtLeast', who: 'controller', amount: parseInt(m[1], 10) };
  if ((m = low.match(/^an opponent has (\d+) or less life$/))) return { kind: 'lifeAtMost', who: 'opponent', amount: parseInt(m[1], 10) };
  if ((m = low.match(/^a player has (\d+) or less life$/))) return { kind: 'lifeAtMost', who: 'each', amount: parseInt(m[1], 10) };
  if (low === 'you have more life than an opponent' || low === 'you have the most life or are tied for most life') return { kind: 'moreLifeThanOpponent' };
  if ((m = low.match(/^there are (\w+) or more (.+?) cards? in your graveyard$/))) {
    const n = num(m[1]);
    const info = parseNounG(m[2]);
    return n === null || !info ? null : { kind: 'graveyardAtLeast', count: n, filter: info.filter };
  }
  if ((m = low.match(/^there are (\w+) or more cards in your graveyard$/))) { const n = num(m[1]); return n === null ? null : { kind: 'graveyardAtLeast', count: n }; }
  if (low === 'there are four or more card types among cards in your graveyard') return { kind: 'delirium' };
  if ((m = t.match(/^you control (\w+) or more (.+)$/i))) {
    const n = num(m[1]);
    const info = parseNounG(m[2]);
    return n === null || !info ? null : { kind: 'controlsAtLeast', count: n, filter: { ...info.filter, controlledBy: 'you' } };
  }
  if ((m = t.match(/^you control (?:a|an) (.+)$/i))) {
    const info = parseNounG(m[1]);
    return !info ? null : { kind: 'controlsAtLeast', count: 1, filter: { ...info.filter, controlledBy: 'you' } };
  }
  if ((m = t.match(/^you control no (.+)$/i))) {
    const info = parseNounG(m[1]);
    return !info ? null : { kind: 'controlsAtMost', count: 0, filter: { ...info.filter, controlledBy: 'you' } };
  }
  if ((m = t.match(/^you control (\w+) or fewer (.+)$/i))) {
    const n = num(m[1]);
    const info = parseNounG(m[2]);
    return n === null || !info ? null : { kind: 'controlsAtMost', count: n, filter: { ...info.filter, controlledBy: 'you' } };
  }
  if ((m = t.match(/^an opponent controls (?:a|an) (.+)$/i))) {
    const info = parseNounG(m[1]);
    return !info ? null : { kind: 'opponentControlsAtLeast', count: 1, filter: info.filter };
  }
  if ((m = t.match(/^an opponent controls (\w+) or more (.+)$/i))) {
    const n = num(m[1]);
    const info = parseNounG(m[2]);
    return n === null || !info ? null : { kind: 'opponentControlsAtLeast', count: n, filter: info.filter };
  }
  if ((m = low.match(/^you attacked with creatures with total power (\d+) or greater this turn$/))) return { kind: 'attackedWithPowerAtLeast', amount: parseInt(m[1], 10) };
  if ((m = low.match(/^creatures you control have total power (\d+) or greater$/))) return { kind: 'totalPowerAtLeast', amount: parseInt(m[1], 10) };
  if (low === 'you control three or more creatures with different powers') return { kind: 'coven' };
  if ((m = low.match(/^an opponent has (\w+) or more poison counters$/))) { const n = num(m[1]); return n === null ? null : { kind: 'opponentPoisonAtLeast', count: n }; }
  if ((m = low.match(/^(\w+) or more nonland permanents entered the battlefield under your control this turn$/))) { const n = num(m[1]); return n === null ? null : { kind: 'nonlandEnteredThisTurn', count: n }; }
  if ((m = t.match(/^(?:it's|that card is|it is|that creature is) (?:a|an) (.+?)(?: card)?$/i))) {
    const info = parseNounG(m[1]);
    return !info || info.player ? null : { kind: 'subjectIs', ref: 'triggering', filter: info.filter };
  }
  if (low === "it's tapped" || low === '~ is tapped') return { kind: 'tapped' };
  if (low === "it's untapped" || low === '~ is untapped') return { kind: 'untapped' };
  if (low === '~ is attacking' || low === "it's attacking") return { kind: 'attacking' };
  if ((m = low.match(/^~ has (?:a|an) ([\w+/-]+) counter on it$/))) return { kind: 'hasCounter', counter: m[1] };
  return null;
}

// ------------------------------------------------------------- subjects

type Subj =
  | { kind: 'ref'; ref: SubjectRef }
  /** "up to N target creatures": one ref per (optional) target. */
  | { kind: 'multi'; refs: SubjectRef[] }
  | { kind: 'each'; filter: FilterSpec }
  | { kind: 'player'; who: WhoSel };

const PRONOUN_RE = /^(it|that creature|that permanent|that land|that artifact|that enchantment|that card|that token|this creature|~|enchanted creature|enchanted permanent|enchanted land|equipped creature)$/i;
const PLURAL_PRONOUN_RE = /^(those creatures|those permanents|those cards|those tokens|them)$/i;

/** Resolve a subject noun phrase (already isolated). */
function parseSubject(text: string, ctx: GCtx, specs: TargetSpec[], baseIdx: number): Subj | null {
  const t = text.trim();
  let m: RegExpMatchArray | null;
  if (PRONOUN_RE.test(t)) {
    if (/^(enchanted|equipped)/i.test(t)) return { kind: 'ref', ref: 'host' };
    if (t === '~' || /^this creature$/i.test(t)) return { kind: 'ref', ref: 'self' };
    const last = ctx.priorSpecs.length + specs.length;
    if (last > 0) return { kind: 'ref', ref: `target:${last - 1}` };
    return { kind: 'ref', ref: ctx.pronoun };
  }
  if (PLURAL_PRONOUN_RE.test(t)) {
    // "those creatures": every object target introduced so far in this line.
    const all = [...ctx.priorSpecs, ...specs].map((s, i) => ({ s, i })).filter((x) => x.s.what !== 'player').map((x) => `target:${x.i}` as SubjectRef);
    if (all.length > 1) return { kind: 'multi', refs: all };
    if (all.length === 1) return { kind: 'ref', ref: all[0] };
    return null;
  }
  if (/^any target$/i.test(t)) { specs.push({ what: 'any' }); return { kind: 'ref', ref: `target:${baseIdx + specs.length - 1}` }; }
  if (/^(you)$/i.test(t)) return { kind: 'player', who: 'controller' };
  if (/^(each opponent)$/i.test(t)) return { kind: 'player', who: 'opponent' };
  if (/^(each player)$/i.test(t)) return { kind: 'player', who: 'each' };
  if (/^(that player|that player's controller)$/i.test(t)) {
    const idx = [...ctx.priorSpecs, ...specs].map((s, i) => ({ s, i })).filter((x) => x.s.what === 'player').pop();
    return { kind: 'player', who: idx ? `target:${idx.i}` : ctx.pronounPlayer };
  }
  if (/^(its controller|that creature's controller|that permanent's controller)$/i.test(t)) {
    const last = ctx.priorSpecs.length + specs.length;
    return { kind: 'player', who: last > 0 ? `controllerOf:${last - 1}` : 'controllerOfTriggering' };
  }
  if (/^defending player$/i.test(t)) return { kind: 'player', who: 'opponent' };
  if ((m = t.match(/^(?:up to (\w+) )?(?:another )?target (.+)$/i))) {
    const info = parseNounG(m[2]);
    if (!info) return null;
    const spec = filterToTargetSpec(info);
    if (!spec) return null;
    if (/^another target/i.test(t) && spec.what !== 'player') (spec as TargetSpec & { other?: boolean }).other = true;
    const n = m[1] ? num(m[1]) : 1;
    if (n === null || n === 0) return null;
    if (n > 1) {
      // "up to N target creatures": N optional targets; the verb applies to each.
      const refs: SubjectRef[] = [];
      for (let i = 0; i < n; i++) { specs.push({ ...spec, optional: true }); refs.push(`target:${baseIdx + specs.length - 1}`); }
      return { kind: 'multi', refs };
    }
    if (m[1]) spec.optional = true;
    specs.push(spec);
    return { kind: 'ref', ref: `target:${baseIdx + specs.length - 1}` };
  }
  if ((m = t.match(/^(?:each|all|every) (.+)$/i))) {
    const info = parseNounG(m[1]);
    // Só objetos do campo de batalha ("all cards from your hand" não é um forEach de permanentes).
    if (!info || info.player || info.zone || info.spell || info.any) return null;
    if (!info.filter.what && !info.filter.subtype && !info.filter.subtypeAnyOf && !info.filter.typeAnyOf && !info.filter.token) return null;
    return { kind: 'each', filter: { ...info.filter, controlledBy: info.filter.controlledBy ?? 'any' } };
  }
  return null;
}

// ---------------------------------------------------------------- tokens

const TOKEN_NAMED = /^(?:a|an|\w+|X) (tapped )?(Treasure|Food|Clue|Blood|Powerstone|Map|Gold) tokens?$/i;

/** "create …" token phrase (without the verb). */
export function parseTokenG(text: string, who: PlayerSel = 'controller'): EffectStep[] | null {
  let m: RegExpMatchArray | null;
  let t = text.trim();
  let tappedAttacking = false;
  let tapped = false;
  if ((m = t.match(/^(.+?) that's tapped and attacking$/i))) { t = m[1]; tappedAttacking = true; }
  else if ((m = t.match(/^(.+?) that's tapped$/i))) { t = m[1]; tapped = true; }
  else if ((m = t.match(/^(.+?) that are tapped and attacking$/i))) { t = m[1]; tappedAttacking = true; }
  if ((m = t.match(TOKEN_NAMED))) {
    const n = t.match(/^(\w+|X) /i);
    const count: DynAmount = n ? (n[1] === 'X' ? 'X' : num(n[1]) ?? 1) : 1;
    return [{ op: 'namedToken', who, kind: m[2] as 'Treasure', count, tapped: !!m[1] || undefined }];
  }
  if ((m = t.match(/^(\w+|X) (\d+)\/(\d+) ((?:white|blue|black|red|green|colorless)(?:(?: and |, )(?:white|blue|black|red|green))*) ([\w\s'-]+?) ((?:artifact |enchantment )?creature) tokens?(?: named ([\w\s',]+?))?(?: with (\w[\w\s,]*?))?$/i))) {
    const count: DynAmount = m[1] === 'X' ? 'X' : num(m[1]) ?? -1;
    if (count === -1) return null;
    const colors = m[4].toLowerCase().split(/ and |, /).filter((c) => c !== 'colorless').map((c) => COLOR_WORDS[c]);
    const kws = m[8] ? keywordList(m[8]) : undefined;
    if (m[8] && !kws) return null;
    const subtypes = m[5].trim().split(/\s+/);
    const types: CardType[] = ['Creature'];
    if (/artifact/i.test(m[6])) types.unshift('Artifact');
    if (/enchantment/i.test(m[6])) types.unshift('Enchantment');
    return [{
      op: 'token', who, count, name: m[7]?.trim() ?? subtypes.join(' '), power: parseInt(m[2], 10), toughness: parseInt(m[3], 10),
      colors, subtypes, keywords: kws ?? undefined, types, tapped: tapped || tappedAttacking || undefined, attacking: tappedAttacking || undefined,
    }];
  }
  return null;
}

// ------------------------------------------------------------ sentences

const OBJECT_VERBS = /\b(gets|gains|has|have|can't|fights|deals|explores|connives|becomes|doesn't|loses|attacks|blocks|phases|is|are|ventures)\b/i;
const PLAYER_VERBS = /\b(draws?|discards?|loses?|gains?|mills?|sacrifices?|creates?|gets?|exiles?|reveals?|puts?|searches?|scry|surveil|takes?|becomes?|ventures?|may|adds?|shuffles?)\b/i;

function keywordsOf(text: string): Keyword[] | null {
  const t = text.trim().replace(/^(?:and )?(?:gains?|has|have) /i, '');
  return keywordList(t);
}

/** Effects applied to an object subject (target / self / pronoun / each). */
function objectEffect(subj: Subj, verb: string, ctx: GCtx, specs: TargetSpec[]): EffectStep[] | null {
  if (subj.kind === 'multi') {
    const all: EffectStep[] = [];
    for (const r of subj.refs) {
      const st = objectEffect({ kind: 'ref', ref: r }, verb, ctx, specs);
      if (!st) return null;
      all.push(...st);
    }
    return all;
  }
  const v = verb.trim().replace(/\.$/, '');
  let m: RegExpMatchArray | null;
  const ref: SubjectRef = subj.kind === 'ref' ? subj.ref : 'iter';
  const wrap = (steps: EffectStep[] | null): EffectStep[] | null => {
    if (!steps) return null;
    if (subj.kind === 'each') return [{ op: 'forEach', filter: subj.filter, effect: steps }];
    return steps;
  };
  // "…, where X is <amount>" (applies to +X/+X pumps).
  let whereX: string | undefined;
  let core = v;
  if (/^blocks ~(?: this turn)? if able$/i.test(v)) return wrap([{ op: 'mustBlockSource', what: ref }]);
  if ((m = core.match(/^(.+?),? where X is (.+)$/i))) { core = m[1]; whereX = m[2]; }
  // Duration.
  let duration: 'eot' | 'yourNextTurn' | undefined;
  if ((m = core.match(/^(.+?) until end of turn$/i))) { core = m[1]; duration = 'eot'; }
  else if ((m = core.match(/^(.+?) until your next turn$/i))) { core = m[1]; duration = 'yourNextTurn'; }
  else if ((m = core.match(/^(.+?) this turn$/i))) { core = m[1]; duration = 'eot'; }

  // gets +N/+N (and gains KW) / gets +X/+X where X is… / +1/+1 for each …
  if ((m = core.match(/^gets ([+-]\d+|[+-]X)\/([+-]\d+|[+-]X)(?: and (?:gains|has) (\w[\w\s,]*?))?$/i))) {
    const kws = m[3] ? keywordList(m[3]) : undefined;
    if (m[3] && !kws) return null;
    const dyn = whereX ? parseAmountG(whereX, ref) : m[1].endsWith('X') ? ('X' as DynAmount) : undefined;
    if ((whereX || m[1].endsWith('X')) && (dyn === undefined || dyn === null)) return null;
    const sign = (s: string) => (s.startsWith('-') ? -1 : 1);
    const p = m[1].endsWith('X') ? 0 : parseInt(m[1], 10);
    const tg = m[2].endsWith('X') ? 0 : parseInt(m[2], 10);
    const step: Extract<EffectStep, { op: 'pump' }> = { op: 'pump', what: ref, power: p, toughness: tg, keywords: kws ?? undefined, duration: duration === 'yourNextTurn' ? 'yourNextTurn' : undefined };
    if (dyn !== undefined && dyn !== null) {
      if (m[1].endsWith('X')) step.powerDyn = sign(m[1]) === 1 ? dyn : { times: -1, of: dyn };
      if (m[2].endsWith('X')) step.toughnessDyn = sign(m[2]) === 1 ? dyn : { times: -1, of: dyn };
    }
    return wrap([step]);
  }
  if ((m = core.match(/^gets ([+-]\d+)\/([+-]\d+) for each (.+)$/i))) {
    const per = forEachSuffix(`x for each ${m[3]}`)?.per;
    if (!per) return null;
    const p = parseInt(m[1], 10), tg = parseInt(m[2], 10);
    return wrap([{ op: 'pump', what: ref, power: 0, toughness: 0, powerDyn: p === 1 ? per : { times: p, of: per }, toughnessDyn: tg === 1 ? per : { times: tg, of: per }, duration: duration === 'yourNextTurn' ? 'yourNextTurn' : undefined }]);
  }
  if ((m = core.match(/^(?:gains?|has|have) (\w[\w\s,]*?)$/i))) {
    const kws = keywordList(m[1]);
    if (!kws) return null;
    return wrap([{ op: 'pump', what: ref, power: 0, toughness: 0, keywords: kws, duration: duration === 'yourNextTurn' ? 'yourNextTurn' : undefined }]);
  }
  if (/^can't block$/i.test(core)) return wrap([{ op: 'pump', what: ref, power: 0, toughness: 0, keywords: ['cantBlock'], duration: duration === 'yourNextTurn' ? 'yourNextTurn' : undefined }]);
  if (/^can't attack$/i.test(core)) return wrap([{ op: 'pump', what: ref, power: 0, toughness: 0, keywords: ['cantAttack'], duration: duration === 'yourNextTurn' ? 'yourNextTurn' : undefined }]);
  if (/^can't attack or block$/i.test(core)) return wrap([{ op: 'pump', what: ref, power: 0, toughness: 0, keywords: ['cantAttack', 'cantBlock'], duration: duration === 'yourNextTurn' ? 'yourNextTurn' : undefined }]);
  if (/^can't be blocked$/i.test(core)) return wrap([{ op: 'pump', what: ref, power: 0, toughness: 0, keywords: ['unblockable'] }]);
  if (/^can't be blocked except by creatures with flying(?: or reach)?$/i.test(core)) return wrap([{ op: 'pump', what: ref, power: 0, toughness: 0, keywords: ['flying'] }]);
  if (/^can't be blocked by more than one creature$/i.test(core)) return null;
  if (/^doesn't untap during (?:its controller's|your) next untap step$/i.test(core)) return wrap([{ op: 'pump', what: ref, power: 0, toughness: 0, keywords: ['doesntUntap'], duration: 'yourNextTurn' }]);
  if (/^don't untap during their controller's next untap step$/i.test(core)) return wrap([{ op: 'pump', what: ref, power: 0, toughness: 0, keywords: ['doesntUntap'], duration: 'yourNextTurn' }]);
  if (/^can't block ~$/i.test(core)) return wrap([{ op: 'cantBlockSource', what: ref }]);
  if (/^explores$/i.test(core)) return wrap([{ op: 'explore', what: ref }]);
  if (/^connives$/i.test(core)) return wrap([{ op: 'connive', what: ref }]);
  if ((m = core.match(/^fights (.+)$/i))) {
    const other = parseSubject(m[1], ctx, specs, ctx.base);
    if (!other || other.kind !== 'ref') return null;
    return wrap([{ op: 'fight', a: ref, b: other.ref }]);
  }
  // "deals damage equal to X to Y".
  if ((m = core.match(/^deals damage equal to (.+?) to (.+)$/i))) {
    const amount = parseAmountG(m[1], ref);
    if (amount === null) return null;
    const other = parseSubject(m[2], ctx, specs, ctx.base);
    if (!other) return null;
    if (other.kind === 'player') return wrap([{ op: 'damage', to: other.who as SubjectRef, amount }]);
    if (other.kind === 'ref') return wrap([{ op: 'damage', to: other.ref, amount }]);
    if (other.kind === 'multi') return wrap(other.refs.map((r) => ({ op: 'damage' as const, to: r, amount })));
    return wrap([{ op: 'damageEach', filter: other.filter, amount }]);
  }
  // "deals N damage to X and M damage to Y" (dois alvos numa frase).
  if ((m = core.match(/^deals (.+?) damage to (.+?) and (.+?) damage to (.+)$/i))) {
    const a1 = parseAmountG(m[1].replace(/^equal to /i, ''), ref);
    const a2 = parseAmountG(m[3].replace(/^equal to /i, ''), ref);
    if (a1 === null || a2 === null) return null;
    const s1 = parseSubject(m[2], ctx, specs, ctx.base);
    const s2 = parseSubject(m[4], ctx, specs, ctx.base);
    if (!s1 || !s2 || (s1.kind !== 'ref' && s1.kind !== 'player') || (s2.kind !== 'ref' && s2.kind !== 'player')) return null;
    const to1 = s1.kind === 'player' ? (s1.who as SubjectRef) : s1.ref;
    const to2 = s2.kind === 'player' ? (s2.who as SubjectRef) : s2.ref;
    return wrap([{ op: 'damage', to: to1, amount: a1 }, { op: 'damage', to: to2, amount: a2 }]);
  }
  if ((m = core.match(/^deals (.+?) damage to (.+)$/i))) {
    const head = amountHead(m[1] + ' x', ref);
    let amount: DynAmount | null = null;
    if (/^damage equal to/i.test(m[0])) amount = parseAmountG(m[1].replace(/^equal to /i, ''), ref);
    else if (head && head.rest === 'x') amount = head.amount;
    else amount = parseAmountG(m[1].replace(/^equal to /i, ''), ref);
    if (amount === null) return null;
    const other = parseSubject(m[2], ctx, specs, ctx.base);
    if (!other) {
      const info = parseNounG(m[2].replace(/^each /i, ''));
      if (/^each /i.test(m[2]) && info) {
        if (info.player === 'opponent') return wrap([{ op: 'damage', to: 'opponent', amount }]);
        if (info.player === 'each') return wrap([{ op: 'damage', to: 'each', amount }]);
        return wrap([{ op: 'damageEach', filter: { ...info.filter, controlledBy: info.filter.controlledBy ?? 'any' }, amount }]);
      }
      return null;
    }
    if (other.kind === 'player') return wrap([{ op: 'damage', to: other.who as SubjectRef, amount }]);
    if (other.kind === 'ref') return wrap([{ op: 'damage', to: other.ref, amount }]);
    if (other.kind === 'multi') return wrap(other.refs.map((r) => ({ op: 'damage' as const, to: r, amount })));
    return wrap([{ op: 'damageEach', filter: other.filter, amount }]);
  }
  if ((m = core.match(/^loses all abilities$/i))) return null;
  return null;
}

/** Verb-first effects on an object noun: destroy/exile/tap/untap/return/put counters/… */
function verbFirst(clause: string, ctx: GCtx, specs: TargetSpec[]): EffectStep[] | null {
  let m: RegExpMatchArray | null;
  const subjOf = (text: string): Subj | null => parseSubject(text, ctx, specs, ctx.base);
  const apply = (subj: Subj, make: (ref: SubjectRef) => EffectStep[]): EffectStep[] | null => {
    if (subj.kind === 'each') return [{ op: 'forEach', filter: subj.filter, effect: make('iter') }];
    if (subj.kind === 'ref') return make(subj.ref);
    if (subj.kind === 'multi') return subj.refs.flatMap((r) => make(r));
    return null;
  };
  // ---- Leva 5
  if (/^return the exiled cards? to the battlefield under (?:its|their) owner's control(?: tapped)?$/i.test(clause)) return [{ op: 'returnExiledBy', to: 'battlefield' }];
  if (/^return the exiled cards? to (?:its|their) owner's hand$/i.test(clause)) return [{ op: 'returnExiledBy', to: 'hand' }];
  if ((m = clause.match(/^return (?:a|an) (.+?) you control to its owner's hand$/i))) {
    const info = parseNounG(m[1]);
    if (!info || info.player || info.zone) return null;
    return [{ op: 'bounceOwn', filter: { ...info.filter, controlledBy: 'you' } }];
  }
  if (/^sacrifice ~$/i.test(clause)) return [{ op: 'sacrificeSelf' }];
  if ((m = clause.match(/^remove (a|an|\w+|X) ([\w+/-]+) counters? from (.+)$/i))) {
    const count: DynAmount | null = m[1] === 'X' ? 'X' : /^an?$/i.test(m[1]) ? 1 : num(m[1]);
    if (count === null) return null;
    const subj = subjOf(m[3]);
    if (!subj || subj.kind === 'player') return null;
    const counter = m[2];
    return apply(subj, (r) => [{ op: 'removeCounters', what: r, counter, count }]);
  }
  if ((m = clause.match(/^move all (?:[\w+/-]+ )?counters from (?:~|it|that creature) onto (.+)$/i))) {
    const subj = subjOf(m[1]);
    if (!subj || subj.kind !== 'ref') return null;
    return [{ op: 'moveAllCounters', to: subj.ref }];
  }
  if ((m = clause.match(/^put (.+?) on the bottom of (?:its|their) owner'?s'? librar(?:y|ies)$/i))) {
    const subj = subjOf(m[1]);
    if (!subj || subj.kind === 'player') return null;
    return apply(subj, (r) => [{ op: 'putOnLibraryBottom', what: r }]);
  }
  if ((m = clause.match(/^exile (?:all cards from )?(target player's|target opponent's|each opponent's|that player's|your|each player's) graveyard$/i))) {
    const w = m[1].toLowerCase();
    if (w.startsWith('target')) {
      specs.push(w === "target opponent's" ? { what: 'player', controlledBy: 'opponent' } : { what: 'player' });
      return [{ op: 'exileGraveyard', who: `target:${ctx.base + specs.length - 1}` }];
    }
    return [{ op: 'exileGraveyard', who: w === 'your' ? 'controller' : w === "each player's" ? 'each' : w === "that player's" ? ctx.pronounPlayer : 'opponent' }];
  }
  if ((m = clause.match(/^look at (target player's|target opponent's) hand$/i))) {
    specs.push(/opponent/i.test(m[1]) ? { what: 'player', controlledBy: 'opponent' } : { what: 'player' });
    return [{ op: 'revealHand', who: `target:${ctx.base + specs.length - 1}` }];
  }
  if ((m = clause.match(/^prevent the next (\w+|X) damage that would be dealt to (.+?)(?: this turn)?$/i))) {
    const amount: DynAmount | null = m[1] === 'X' ? 'X' : num(m[1]);
    if (amount === null) return null;
    const subj = subjOf(m[2]);
    if (!subj) return null;
    if (subj.kind === 'player') return [{ op: 'preventNext', what: subj.who as SubjectRef, amount }];
    return apply(subj, (r) => [{ op: 'preventNext', what: r, amount }]);
  }
  if ((m = clause.match(/^prevent all (?:combat )?damage that would be dealt to (.+?)(?: this turn)?$/i))) {
    const subj = subjOf(m[1]);
    if (!subj) return null;
    if (subj.kind === 'player') return [{ op: 'preventAllTo', what: subj.who as SubjectRef }];
    return apply(subj, (r) => [{ op: 'preventAllTo', what: r }]);
  }
  // Leva 5b: dupla-face.
  if ((m = clause.match(/^exile (.+?), then return (?:it|that card) to the battlefield transformed under (?:your|its owner's) control$/i))) {
    const subj = subjOf(m[1]);
    if (!subj || subj.kind === 'player') return null;
    return apply(subj, (r) => [{ op: 'returnTransformed', what: r }]);
  }
  if ((m = clause.match(/^(destroy|exile|tap|untap|regenerate|goad|sacrifice|blink|transform|flip) (.+)$/i))) {
    const verb = m[1].toLowerCase();
    const rest = m[2];
    if (verb === 'sacrifice') return null; // player verb
    if (verb === 'transform' || verb === 'flip') {
      const subj = subjOf(rest);
      if (!subj || subj.kind === 'player') return null;
      return apply(subj, (r) => [{ op: 'transform', what: r }]);
    }
    let noun = rest;
    let untilLeaves = false;
    let cantRegen = false;
    if ((m = noun.match(/^(.+?) until ~ leaves the battlefield$/i))) { noun = m[1]; untilLeaves = true; }
    if ((m = noun.match(/^(.+?)\. it can't be regenerated$/i))) { noun = m[1]; cantRegen = true; }
    void cantRegen;
    const subj = subjOf(noun);
    if (!subj || subj.kind === 'player') return null;
    if (verb === 'exile' && untilLeaves) return apply(subj, (r) => [{ op: 'exileUntilLeaves', what: r }]);
    const op = verb === 'blink' ? 'blink' : (verb as 'destroy' | 'exile' | 'tap' | 'untap' | 'regenerate' | 'goad');
    return apply(subj, (r) => [{ op, what: r } as EffectStep]);
  }
  if ((m = clause.match(/^return (.+?) to (?:(?:its|their) owner'?s'? hands?|your hand)$/i))) {
    const subj = subjOf(m[1]);
    if (!subj || subj.kind === 'player') return null;
    return apply(subj, (r) => [{ op: 'returnToHand', what: r }]);
  }
  if ((m = clause.match(/^return (.+?) to the battlefield(?: under (?:your|its owner's) control)?( tapped)?$/i))) {
    const subj = subjOf(m[1]);
    if (!subj || subj.kind === 'player') return null;
    const tapped = !!m[2];
    return apply(subj, (r) => [{ op: 'returnToBattlefield', what: r, tapped: tapped || undefined }]);
  }
  if ((m = clause.match(/^put (.+?) on top of (?:its|their) owner'?s'? librar(?:y|ies)$/i))) {
    const subj = subjOf(m[1]);
    if (!subj || subj.kind === 'player') return null;
    return apply(subj, (r) => [{ op: 'putOnLibraryTop', what: r }]);
  }
  if ((m = clause.match(/^put (\w+|X) ([\w+/-]+) counters? on (.+?)(?: for each (.+))?$/i))) {
    const base = m[1] === 'X' ? 'X' : num(m[1]);
    if (base === null) return null;
    let count: DynAmount = base;
    if (m[4]) {
      const per = forEachSuffix(`x for each ${m[4]}`)?.per;
      if (!per) return null;
      count = scaled(base, per);
    }
    const subj = subjOf(m[3]);
    if (!subj || subj.kind === 'player') return null;
    const counter = m[2];
    return apply(subj, (r) => [{ op: 'putCounters', what: r, counter, count }]);
  }
  if ((m = clause.match(/^put (?:a|an) ([\w+/-]+) counter on each of up to (\w+) (?:other )?target creatures$/i))) {
    const n = num(m[2]);
    if (n === null) return null;
    const steps: EffectStep[] = [];
    for (let i = 0; i < n; i++) { specs.push({ what: 'creature', optional: true }); steps.push({ op: 'putCounters', what: `target:${ctx.base + specs.length - 1}`, counter: m[1], count: 1 }); }
    return steps;
  }
  if ((m = clause.match(/^gain control of (.+?)( until end of turn)?$/i))) {
    const subj = subjOf(m[1]);
    if (!subj || subj.kind !== 'ref') return null;
    return [{ op: 'gainControl', what: subj.ref, untilEndOfTurn: !!m[2] || undefined }];
  }
  if ((m = clause.match(/^attach (?:~|it) to (.+)$/i))) {
    const subj = subjOf(m[1]);
    if (!subj || subj.kind !== 'ref' || !subj.ref.startsWith('target:')) return null;
    return [{ op: 'attach' }];
  }
  if ((m = clause.match(/^counter (.+)$/i))) {
    const subj = subjOf(m[1]);
    if (!subj || subj.kind !== 'ref') return null;
    return [{ op: 'counterSpell', what: subj.ref }];
  }
  if ((m = clause.match(/^exile (.+?)\. return (?:it|that card|them) to the battlefield under (?:its|their) owner's control(?: at the beginning of the next end step)?$/i))) {
    const subj = subjOf(m[1]);
    if (!subj || subj.kind === 'player') return null;
    if (/at the beginning of the next end step/i.test(clause)) return apply(subj, (r) => [{ op: 'exile', what: r }, { op: 'delayedEffect', at: 'endStep', effect: [{ op: 'returnToBattlefield', what: r }] }]);
    return apply(subj, (r) => [{ op: 'blink', what: r }]);
  }
  return null;
}

/** Player-subject effects ("you draw two cards", "each opponent loses 2 life", "target player discards…"). */
function playerEffect(who: WhoSel, verb: string, ctx: GCtx, specs: TargetSpec[]): EffectStep[] | null {
  const v = verb.trim().replace(/\.$/, '');
  let m: RegExpMatchArray | null;
  const subjRef: SubjectRef = ctx.priorSpecs.length + specs.length > 0 ? `target:${ctx.priorSpecs.length + specs.length - 1}` : ctx.pronoun;
  const suffix = forEachSuffix(v);
  const body = suffix ? suffix.rest : v;
  const scale = (a: DynAmount): DynAmount => (suffix ? scaled(a, suffix.per) : a);
  if ((m = body.match(/^draws? (.+?) cards?$/i)) || (m = body.match(/^draws? (?:a|an) card$/i) && ['', 'a'])) {
    const a = m[1] ? parseAmountG(m[1], subjRef) : 1;
    return a === null ? null : [{ op: 'draw', who, count: scale(a) }];
  }
  if ((m = body.match(/^(?:gains?|gain) (.+?) life$/i))) { const a = parseAmountG(m[1].replace(/^an amount of life equal to /i, '').replace(/^life equal to /i, ''), subjRef); return a === null ? null : [{ op: 'gainLife', who, amount: scale(a) }]; }
  if ((m = body.match(/^(?:gains?|gain) life equal to (.+)$/i))) { const a = parseAmountG(m[1], subjRef); return a === null ? null : [{ op: 'gainLife', who, amount: a }]; }
  if ((m = body.match(/^loses? (.+?) life$/i))) { const a = parseAmountG(m[1], subjRef); return a === null ? null : [{ op: 'loseLife', who, amount: scale(a) }]; }
  if ((m = body.match(/^loses? life equal to (.+)$/i))) { const a = parseAmountG(m[1], subjRef); return a === null ? null : [{ op: 'loseLife', who, amount: a }]; }
  if ((m = body.match(/^discards? (\w+) cards?( at random)?$/i))) {
    const n = num(m[1]);
    if (n === null) return null;
    if (m[2]) return who === 'controller' || who === 'opponent' || who === 'each' ? [{ op: 'discardRandom', who, count: n }] : null;
    return [{ op: 'discard', who, count: n }];
  }
  if (/^discards? (?:their|your|his or her) hand$/i.test(body)) return [{ op: 'discardHand', who }];
  if (/^reveals? (?:their|your) hand$/i.test(body)) return [{ op: 'revealHand', who }];
  if ((m = body.match(/^mills? (\w+|X) cards?$/i))) { const n = m[1] === 'X' ? null : num(m[1]); return n === null ? null : [{ op: 'mill', who, count: n }]; }
  if ((m = body.match(/^sacrifices? (?:a|an) (.+?)(?: of (?:their|your) choice)?$/i))) {
    const info = parseNounG(m[1]);
    if (!info || info.player) return null;
    return [{ op: 'sacrifice', who, filter: info.filter, count: 1 }];
  }
  if ((m = body.match(/^sacrifices? (\w+) (.+?)(?: of (?:their|your) choice)?$/i))) {
    const n = num(m[1]);
    const info = parseNounG(m[2].replace(/s$/, ''));
    if (n === null || !info || info.player) return null;
    return [{ op: 'sacrifice', who, filter: info.filter, count: n }];
  }
  if ((m = body.match(/^exiles? the top (\w+) cards? of (?:their|your) library$/i))) { const n = num(m[1]); return n === null ? null : [{ op: 'exileTop', who, count: n }]; }
  if ((m = body.match(/^gets? ((?:\{E\})+)$/i))) return [{ op: 'energy', who, amount: m[1].split('{E}').length - 1 }];
  if ((m = body.match(/^gets? (\w+) poison counters?$/i))) { const n = num(m[1]); return n === null || (who !== 'controller' && who !== 'opponent' && who !== 'each' && !who.startsWith('target:')) ? null : [{ op: 'poison', who, count: n }]; }
  if ((m = body.match(/^creates? (.+)$/i))) {
    const psel: PlayerSel = who === 'opponent' ? 'opponent' : who === 'each' ? 'each' : 'controller';
    if (who !== 'controller' && who !== 'opponent' && who !== 'each') return null;
    const tok = parseTokenG(m[1], psel);
    if (!tok) return null;
    if (suffix) for (const s of tok) if ((s.op === 'token' || s.op === 'namedToken') && typeof s.count !== 'undefined') s.count = scaled(s.count, suffix.per);
    return tok;
  }
  if (who === 'controller') {
    if ((m = body.match(/^scry (\d+)$/i))) return [{ op: 'scry', count: parseInt(m[1], 10) }];
    if (/^learn$/i.test(body)) return [{ op: 'learn' }];
    if ((m = body.match(/^puts? (?:a|an) (.+?) from your hand onto the battlefield( tapped)?$/i))) {
      const info = parseNounG(m[1]);
      if (!info || info.player || info.zone) return null;
      return [{ op: 'putFromHand', filter: info.filter, tapped: !!m[2] || undefined }];
    }
    if (/^add one mana of any color$/i.test(body)) return [{ op: 'addManaChoice', who: 'controller' }];
    if (/^add one mana of the chosen color$/i.test(body)) return [{ op: 'addChosenColorMana' }];
    if ((m = body.match(/^add \{([WUBRGC])\} or (?:\{([WUBRGC])\}|one mana of the chosen color)$/i))) {
      const options = [m[1].toUpperCase(), ...(m[2] ? [m[2].toUpperCase()] : [])] as ('W' | 'U' | 'B' | 'R' | 'G' | 'C')[];
      return [{ op: 'addManaOptions', options, chosenColor: m[2] ? undefined : true }];
    }
    if ((m = body.match(/^surveil (\d+)$/i))) return [{ op: 'surveil', count: parseInt(m[1], 10) }];
    if (/^investigate$/i.test(body)) return [{ op: 'namedToken', who: 'controller', kind: 'Clue', count: 1 }];
    if (/^proliferate$/i.test(body)) return [{ op: 'proliferate' }];
    if (/^populate$/i.test(body)) return [{ op: 'populate' }];
    if ((m = body.match(/^bolster (\d+)$/i))) return [{ op: 'bolster', count: parseInt(m[1], 10) }];
    if ((m = body.match(/^support (\d+)$/i))) return [{ op: 'support', count: parseInt(m[1], 10) }];
    if ((m = body.match(/^amass (?:([A-Z][a-z]+) )?(\d+)$/))) return [{ op: 'amass', count: parseInt(m[2], 10), subtype: m[1] }];
    if (/^venture into the dungeon$/i.test(body)) return [{ op: 'venture' }];
    if (/^become the monarch$/i.test(body)) return [{ op: 'becomeMonarch', who: 'controller' }];
    if (/^take the initiative$/i.test(body)) return [{ op: 'takeInitiative', who: 'controller' }];
    if (/^shuffle$/i.test(body) || /^shuffle your library$/i.test(body)) return [{ op: 'shuffle', who: 'controller' }];
    if ((m = body.match(/^add ((?:\{[WUBRGC]\})+)$/i))) return [{ op: 'addMana', who: 'controller', mana: [...m[1].matchAll(/\{([WUBRGC])\}/g)].map((x) => x[1] as Color | 'C') }];
    if ((m = body.match(/^look at the top (\w+) cards? of your library[.,]?(?: (.+))?$/i))) {
      const n = num(m[1]);
      if (n === null) return null;
      const tail = (m[2] ?? '').trim().replace(/\.$/, '');
      if (!tail || /^then put them back in any order$/i.test(tail) || /^you may put them back in any order$/i.test(tail)) return [{ op: 'scry', count: n }];
      if (/^you may put (?:it|that card|one of them) into your graveyard$/i.test(tail) || /^you may put any of them into your graveyard$/i.test(tail)) return [{ op: 'surveil', count: n }];
      let mm: RegExpMatchArray | null;
      if ((mm = tail.match(/^(?:you may )?put (?:one of them|up to (\w+) of them|(?:a|an) (.+?) card from among them) into your hand and the rest (?:on the bottom of your library in a random order|into your graveyard|on the bottom of your library)$/i))) {
        const pick = mm[1] ? num(mm[1]) ?? 1 : 1;
        const info = mm[2] ? parseNounG(mm[2]) : null;
        if (mm[2] && !info) return null;
        return [{ op: 'digTop', count: n, pick, filter: info?.filter, rest: /graveyard/i.test(tail) ? 'graveyard' : 'bottom' }];
      }
      if ((mm = tail.match(/^put (?:one of them|(?:a|an) (.+?) card from among them) (?:into your hand|on top of your library)\.? ?(?:put the rest|and the rest) (?:on the bottom of your library in a random order|into your graveyard)$/i))) {
        const info = mm[1] ? parseNounG(mm[1]) : null;
        if (mm[1] && !info) return null;
        return [{ op: 'digTop', count: n, pick: 1, filter: info?.filter, rest: /graveyard/i.test(tail) ? 'graveyard' : 'bottom' }];
      }
      return null;
    }
    if ((m = body.match(/^reveal the top card of your library\. if it's (?:a|an) (.+?) card, put it into your hand\. otherwise, put it (?:on the bottom of your library|into your graveyard)$/i))) {
      const info = parseNounG(m[1]);
      if (!info) return null;
      return [{ op: 'digTop', count: 1, pick: 1, filter: info.filter, rest: /graveyard/i.test(body) ? 'graveyard' : 'bottom' }];
    }
  }
  return null;
}

/** Sentence → steps + new targets. Returns null when any part is unknown (all-or-nothing). */
export function parseSentenceG(sentence: string, ctx: GCtx): GResult | null {
  const specs: TargetSpec[] = [];
  let s = sentence.trim().replace(/\.$/, '');
  let m: RegExpMatchArray | null;

  // Conditional prefix / suffix.
  if ((m = s.match(/^if (.+?), (.+)$/i))) {
    const cond = parseCondG(m[1]);
    if (cond) {
      const inner = parseSentenceG(m[2], { ...ctx, priorSpecs: [...ctx.priorSpecs] });
      if (!inner) return null;
      return { steps: [{ op: 'if', cond, then: inner.steps }], specs: inner.specs };
    }
  }
  if ((m = s.match(/^(.+?) if (.+)$/i)) && !/^if /i.test(s)) {
    const cond = parseCondG(m[2]);
    if (cond) {
      const inner = parseSentenceG(m[1], ctx);
      if (inner) return { steps: [{ op: 'if', cond, then: inner.steps }], specs: inner.specs };
    }
  }
  // "… unless you pay {cost}" / "… unless you discard a card / sacrifice a creature".
  if ((m = s.match(/^(.+?) unless (you|its controller|that player|they|that opponent|each opponent) pays? ((?:\{[^}]+\})+)$/i))) {
    const inner = parseSentenceG(m[1], ctx);
    if (!inner) return null;
    const who = m[2].toLowerCase();
    const payerOpp = who === 'they' || who === 'that opponent' || who === 'each opponent' ? /opponent/i.test(m[1]) || who !== 'they' : false;
    return { steps: [{ op: 'payOrElse', cost: m[3], then: [], else: inner.steps, payer: payerOpp ? 'opponent' : undefined }], specs: inner.specs };
  }
  if ((m = s.match(/^(.+?) unless you (discard a card|sacrifice (?:a|an) (.+))$/i))) {
    const inner = parseSentenceG(m[1], ctx);
    if (!inner) return null;
    const alt: EffectStep[] = m[3]
      ? (() => { const info = parseNounG(m[3]); return info ? [{ op: 'sacrifice' as const, who: 'controller' as const, filter: info.filter, count: 1 }] : []; })()
      : [{ op: 'discard', who: 'controller', count: 1 }];
    if (alt.length === 0) return null;
    return { steps: [{ op: 'mayDo', prompt: `${m[2]} em vez disso?`, effect: alt, else: inner.steps }], specs: inner.specs };
  }
  // Delayed: "at the beginning of the next end step, X" / "…your next upkeep, X".
  if ((m = s.match(/^at the beginning of (the next end step|your next upkeep|the next turn's upkeep), (.+)$/i))) {
    const inner = parseSentenceG(m[2], ctx);
    if (!inner) return null;
    return { steps: [{ op: 'delayedEffect', at: /end step/i.test(m[1]) ? 'endStep' : 'nextUpkeep', effect: inner.steps }], specs: inner.specs };
  }
  if ((m = s.match(/^(.+?) at the beginning of (the next end step|your next upkeep|the next turn's upkeep)$/i))) {
    const inner = parseSentenceG(m[1], ctx);
    if (!inner) return null;
    return { steps: [{ op: 'delayedEffect', at: /end step/i.test(m[2]) ? 'endStep' : 'nextUpkeep', effect: inner.steps }], specs: inner.specs };
  }

  // Verb-first object effects.
  const vf = verbFirst(s, ctx, specs);
  if (vf) return { steps: vf, specs };

  // "~ deals N damage to X" with a subject; "each creature gets…"; "target creature gains…"; players.
  const vm = s.match(OBJECT_VERBS);
  const pm = s.match(PLAYER_VERBS);
  const cut = (idx: number) => ({ subject: s.slice(0, idx).trim(), verb: s.slice(idx).trim() });
  const candidates: number[] = [];
  if (vm && vm.index !== undefined) candidates.push(vm.index);
  if (pm && pm.index !== undefined) candidates.push(pm.index);
  for (const idx of [...new Set(candidates)].sort((a, b) => a - b)) {
    if (idx === 0) continue;
    const { subject, verb } = cut(idx);
    const subj = parseSubject(subject, ctx, specs, ctx.base);
    if (!subj) continue;
    if (subj.kind === 'player') {
      const r = playerEffect(subj.who, verb, ctx, specs);
      if (r) return { steps: r, specs };
      continue;
    }
    const r = objectEffect(subj, verb, ctx, specs);
    if (r) return { steps: r, specs };
    // "target creature's controller sacrifices…" etc. not handled.
    specs.length = 0;
  }
  // Imperative player effects with an implicit "you".
  const r = playerEffect('controller', s, ctx, specs);
  if (r) return { steps: r, specs };
  return null;
}

// -------------------------------------------------------------- statics

export interface StaticG {
  filter: FilterSpec;
  selfOnly?: boolean;
  hostOnly?: boolean;
  power?: number;
  toughness?: number;
  keywords?: Keyword[];
  powerPer?: FilterSpec;
  toughnessPer?: FilterSpec;
}

/** "<noun> get +N/+N (and have KW)" / "<noun> have KW" / "~ gets +N/+N for each <noun>". */
export function parseStaticG(line: string): StaticG | null {
  const t = line.trim().replace(/\.$/, '');
  let m: RegExpMatchArray | null;
  if ((m = t.match(/^(~|enchanted creature|equipped creature) gets ([+-]\d+)\/([+-]\d+) for each (.+)$/i))) {
    const per = forEachSuffix(`x for each ${m[4]}`)?.per;
    if (!per || !('per' in (per as object))) return null;
    const f = (per as { per: FilterSpec }).per;
    const p = parseInt(m[2], 10), tg = parseInt(m[3], 10);
    if (Math.abs(p) !== 1 && p !== 0) return null;
    if (Math.abs(tg) !== 1 && tg !== 0) return null;
    return { filter: {}, selfOnly: m[1] === '~', hostOnly: m[1] !== '~', powerPer: p !== 0 ? f : undefined, toughnessPer: tg !== 0 ? f : undefined };
  }
  let subject: string | undefined;
  let pw: string | undefined;
  let tg: string | undefined;
  let kwText: string | undefined;
  if ((m = t.match(/^(.+?) (?:get|gets) ([+-]\d+)\/([+-]\d+)(?: and (?:have|has) (\w[\w\s,]*?))?$/i))) { subject = m[1]; pw = m[2]; tg = m[3]; kwText = m[4]; }
  else if ((m = t.match(/^(.+?) (?:have|has) (\w[\w\s,]*?)$/i))) { subject = m[1]; kwText = m[2]; }
  if (subject !== undefined) {
    m = [t, subject, pw ?? '', tg ?? '', kwText ?? ''] as unknown as RegExpMatchArray;
    const kws = kwText ? keywordList(kwText) : undefined;
    if (kwText && !kws) return null;
    const power = pw ? parseInt(pw, 10) : undefined;
    const toughness = tg ? parseInt(tg, 10) : undefined;
    if (subject === '~') return { filter: {}, selfOnly: true, power, toughness, keywords: kws ?? undefined };
    if (/^(enchanted|equipped) /i.test(subject)) return { filter: {}, hostOnly: true, power, toughness, keywords: kws ?? undefined };
    const info = parseNounG(subject.replace(/^(other |all |each )/i, (x) => (/other/i.test(x) ? 'other ' : '')));
    if (!info || info.player || info.zone) return null;
    const filter: FilterSpec = { ...info.filter, controlledBy: info.filter.controlledBy ?? 'any' };
    if (!filter.what && !filter.subtype && !filter.subtypeAnyOf && !filter.typeAnyOf) return null;
    return { filter, power, toughness, keywords: kws ?? undefined };
  }
  return null;
}
