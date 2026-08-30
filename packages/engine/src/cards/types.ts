/**
 * Card definitions and the declarative effect DSL (automation Tier 1).
 *
 * A CardDefinition is pure data: it never touches game state directly.
 * Effects are lists of EffectStep primitives interpreted by effects.ts,
 * which is what makes them contributable without knowing engine internals.
 */
import type { CardType, Color, Keyword, ManaSymbol, PlayerId } from '../types.js';

/** Who an effect applies to, resolved at interpretation time. */
export type PlayerSel = 'controller' | 'opponent' | 'each';

/**
 * Reference to an effect's subject:
 * - 'target:N'    → the Nth chosen target of the spell/ability
 * - 'self'        → the source object itself
 * - a PlayerSel   → player(s)
 */
export type SubjectRef = `target:${number}` | 'self' | PlayerSel;

/**
 * Object filter, evaluated relative to the effect's controller/source.
 * Used by mass effects (damageEach…), static abilities, global triggers,
 * sacrifice choices and library searches.
 */
export interface FilterSpec {
  what?: 'creature' | 'land' | 'artifact' | 'enchantment' | 'permanent' | 'instant' | 'sorcery';
  subtype?: string;
  /** Restrict by supertype 'Basic' (library searches for basic lands). */
  basic?: boolean;
  /** Negations (Duress: "noncreature, nonland card"). */
  nonland?: boolean;
  noncreature?: boolean;
  /** Card color ("exile a blue card from your hand"). */
  color?: Color;
  controlledBy?: 'you' | 'opponent' | 'any';
  /** Exclude the effect's own source ("another creature…"). */
  other?: boolean;
}

/**
 * Amounts may be dynamic: a literal, the spell's X, or a count of objects
 * matching a filter ("equal to the number of creatures you control").
 */
export type DynAmount =
  | number
  | 'X'
  | { per: FilterSpec }
  /** Power of the creature sacrificed as an additional cost (Fling). */
  | 'sacrificedPower';

/** What a target may legally be. Validated at cast time and at resolution. */
export interface TargetSpec {
  what: 'any' | 'creature' | 'player' | 'permanent' | 'spell' | 'land' | 'artifact' | 'enchantment';
  /** Restrict to a controller, relative to the spell's controller. */
  controlledBy?: 'you' | 'opponent';
  /**
   * Zone the target must be in (default 'battlefield'; 'graveyard' enables
   * e.g. "return target creature card from your graveyard to your hand").
   * Graveyard targets are restricted to the spell controller's graveyard
   * when ownedBy 'you' is set.
   */
  zone?: 'battlefield' | 'graveyard';
  ownedBy?: 'you';
  optional?: boolean;
}

/**
 * The effect primitives. Each step emits GameEvents; none mutate state
 * directly. Adding a primitive = one case in effects.ts plus this union.
 *
 * Steps marked (choice) pause resolution and ask a player to pick — the
 * engine resumes the script automatically after the pick.
 */
/** Who an effect applies to, including targeted players ("target player draws…"). */
export type WhoSel = PlayerSel | `target:${number}`;

export type EffectStep =
  | { op: 'draw'; who: WhoSel; count: DynAmount }
  | { op: 'discardRandom'; who: PlayerSel; count: number }
  /**
   * (choice) Cards are chosen and discarded. By default the discarding
   * player chooses; `chooser: 'caster'` makes the effect's controller pick
   * from that hand instead (Duress), optionally restricted by `filter`.
   */
  | { op: 'discard'; who: WhoSel; count: number; chooser?: 'caster'; filter?: FilterSpec }
  /** The whole hand goes to the graveyard (wheels). */
  | { op: 'discardHand'; who: WhoSel }
  | { op: 'mill'; who: WhoSel; count: number }
  | { op: 'damage'; to: SubjectRef; amount: DynAmount }
  | { op: 'gainLife'; who: PlayerSel; amount: DynAmount }
  | { op: 'loseLife'; who: PlayerSel; amount: DynAmount }
  | { op: 'destroy'; what: SubjectRef }
  | { op: 'exile'; what: SubjectRef }
  | { op: 'returnToHand'; what: SubjectRef }
  | { op: 'tap'; what: SubjectRef }
  | { op: 'untap'; what: SubjectRef }
  | { op: 'counterSpell'; what: SubjectRef }
  | { op: 'pump'; what: SubjectRef; power: number; toughness: number; keywords?: Keyword[] }
  /** Permanent +1/+1 or -1/-1 (or named) counters. */
  | { op: 'putCounters'; what: SubjectRef; counter: string; count: DynAmount }
  /** Attach the source permanent (aura/equipment) to target:0. */
  | { op: 'attach' }
  /** Mass effects over every object matching the filter. */
  | { op: 'damageEach'; filter: FilterSpec; amount: DynAmount }
  | { op: 'destroyEach'; filter: FilterSpec }
  | { op: 'exileEach'; filter: FilterSpec }
  | { op: 'pumpEach'; filter: FilterSpec; power: number; toughness: number; keywords?: Keyword[] }
  | { op: 'tapEach'; filter: FilterSpec }
  | { op: 'untapEach'; filter: FilterSpec }
  /** Two creatures deal damage equal to their power to each other. */
  | { op: 'fight'; a: SubjectRef; b: SubjectRef }
  /** (choice) The player sacrifices `count` permanents matching the filter. */
  | { op: 'sacrifice'; who: WhoSel; filter?: FilterSpec; count: number }
  /** (choice) Look at the top N; chosen cards go to the bottom. */
  | { op: 'scry'; count: number }
  /** (choice) Search your library for up to `count` cards matching the filter. */
  | {
      op: 'search';
      filter?: FilterSpec;
      count: number;
      to: 'hand' | 'battlefield' | 'libraryTop';
      tapped?: boolean;
    }
  /** Reanimation: move a (graveyard) target onto the battlefield. */
  | { op: 'returnToBattlefield'; what: SubjectRef; tapped?: boolean }
  /** Regeneration shield: the next destruction this turn is replaced. */
  | { op: 'regenerate'; what: SubjectRef }
  | { op: 'shuffle'; who: PlayerSel }
  /** Take control of a permanent (optionally until end of turn, Act of Treason-style). */
  | { op: 'gainControl'; what: SubjectRef; untilEndOfTurn?: boolean }
  /** Copy a spell on the stack (the copy keeps the same targets). */
  | { op: 'copySpell'; what: SubjectRef }
  /** Fog: no combat damage is dealt for the rest of this turn. */
  | { op: 'preventCombatDamage' }
  | { op: 'addMana'; who: PlayerSel; mana: ManaSymbol[] }
  /** "Add one mana of any color" (or "of these colors") — the activation
   *  carries the chosen color; `colors` restricts the legal choices. */
  | { op: 'addManaChoice'; who: PlayerSel; count?: number; colors?: Color[] }
  /**
   * (choice) Cabal Therapy: the controller names a nonland card; the `who`
   * player reveals their hand and discards every card with that name.
   */
  | { op: 'nameCardDiscard'; who: WhoSel }
  | {
      op: 'token';
      who: PlayerSel;
      count: number;
      name: string;
      power: number;
      toughness: number;
      colors: Color[];
      subtypes: string[];
      keywords?: Keyword[];
    };

export type EffectScript = EffectStep[];

/** Trigger conditions for triggered abilities. */
export type TriggerSpec =
  | { on: 'etb'; self: true }
  /** Any object matching the filter enters the battlefield. */
  | { on: 'etb'; what: FilterSpec }
  | { on: 'dies'; self: true }
  /** Any object matching the filter dies (battlefield → graveyard). */
  | { on: 'dies'; what: FilterSpec }
  | { on: 'attacks'; self: true }
  | { on: 'upkeep'; whose: 'controller' | 'each' }
  | { on: 'endStep'; whose: 'controller' | 'each' }
  /** The controller casts a spell (prowess-style). */
  | { on: 'youCastSpell'; noncreatureOnly?: boolean }
  /** The controller gains life (Ajani's Pridemate). */
  | { on: 'youGainLife' };

export interface TriggeredAbility {
  kind: 'triggered';
  trigger: TriggerSpec;
  /**
   * Targets chosen by the controller when the trigger goes on the stack
   * (Flametongue Kavu-style). If no legal target exists, the trigger is
   * simply removed.
   */
  targets?: TargetSpec[];
  effect: EffectScript;
  /** Human-readable rules text of just this ability, for the log. */
  text: string;
}

export interface ActivatedAbility {
  kind: 'activated';
  cost: {
    tap?: boolean;
    mana?: string;
    sacrificeSelf?: boolean;
    /** Sacrifice another permanent matching this filter (chosen in the action). */
    sacrifice?: FilterSpec;
    /** Pay N life (requires having at least N). */
    payLife?: number;
  };
  targets?: TargetSpec[];
  effect: EffectScript;
  text: string;
  /** Mana abilities resolve immediately, without using the stack. */
  isManaAbility?: boolean;
  /** Equip-style: only during your main phase with an empty stack. */
  sorceryOnly?: boolean;
  /** Metalcraft-style: activatable only while controlling ≥ count of filter. */
  condition?: { controlsAtLeast: { count: number; filter: FilterSpec } };
}

/** Planeswalker loyalty ability: sorcery speed, once per turn per walker. */
export interface LoyaltyAbility {
  kind: 'loyalty';
  /** Loyalty cost: +N adds counters, -N requires and removes them. */
  cost: number;
  targets?: TargetSpec[];
  effect: EffectScript;
  text: string;
}

/** Continuous effect from a permanent (anthems, lords). */
export interface StaticAbility {
  kind: 'static';
  /** Which battlefield objects it applies to (relative to its controller). */
  filter: FilterSpec;
  power?: number;
  toughness?: number;
  keywords?: Keyword[];
  text: string;
}

export type AbilityDef = TriggeredAbility | ActivatedAbility | StaticAbility | LoyaltyAbility;

/** One mode of a modal spell ("Choose one —"). */
export interface SpellMode {
  label: string;
  targets?: TargetSpec[];
  effect: EffectScript;
}

export interface CardDefinition {
  /** Stable slug unique within a set, e.g. 'lightning-strike'. */
  id: string;
  name: string;
  /** Scryfall oracle_id when known — the universal join key. */
  oracleId?: string;
  /** Scryfall card (printing) id, used by clients to fetch the card image. */
  scryfallId?: string;
  /** Mana cost in oracle syntax, e.g. '{1}{R}{R}' or '{X}{R}'. Lands have none. */
  manaCost?: string;
  types: CardType[];
  subtypes: string[];
  supertypes?: string[];
  colors: Color[];
  power?: number;
  toughness?: number;
  /** Oracle rules text (display only; behaviour comes from the fields below). */
  text?: string;
  keywords?: Keyword[];
  /** For instants/sorceries: what happens on resolution. */
  spellTargets?: TargetSpec[];
  spellEffect?: EffectScript;
  /** Modal spells: exactly one mode is chosen at cast time. */
  spellModes?: SpellMode[];
  /** Storm: when cast, copy this spell once per spell cast earlier this turn. */
  storm?: boolean;
  /** Additional cost paid at cast time (e.g. Fling's sacrifice). */
  additionalCost?: { sacrifice: FilterSpec; count?: number };
  /** Kicker: optional extra mana cost; when paid, `effect` is appended. */
  kicker?: { cost: string; effect: EffectScript };
  /** Flashback: castable from the graveyard for this cost; exiles after.
   *  `cost` is mana; `sacrifice` an additional non-mana cost (Cabal Therapy). */
  flashback?: { cost?: string; sacrifice?: FilterSpec };
  /**
   * Alternative cost (Force of Will): instead of the mana cost, pay life
   * and/or exile matching cards from your hand.
   */
  altCost?: { payLife?: number; exileFromHand?: { count: number; filter: FilterSpec }; label: string };
  /** Cycling: pay the cost, discard this card, apply `effect` (default: draw 1). */
  cycling?: { mana?: string; life?: number; effect?: EffectScript };
  /** This spell can't be countered. */
  uncounterable?: boolean;
  /** Protection from these colors: can't be targeted, blocked, or damaged by them. */
  protectionFrom?: Color[];
  /** Planeswalkers enter with this many loyalty counters. */
  loyalty?: number;
  /** Taplands and permanents that enter the battlefield tapped. */
  entersTapped?: boolean;
  abilities?: AbilityDef[];
  /** Permanent that "enters the battlefield with N counters" (N may be X). */
  entersWithCounters?: { counter: string; count: DynAmount };
  /**
   * Aura: what it can enchant. Casting requires this target and the aura
   * enters the battlefield attached to it (fizzles if the target is gone).
   */
  enchant?: { what: 'creature'; controlledBy?: 'you' | 'opponent' };
  /** Static effects granted to whatever this aura/equipment is attached to. */
  attachEffect?: {
    power?: number;
    toughness?: number;
    keywords?: Keyword[];
    cantAttack?: boolean;
    cantBlock?: boolean;
  };
  /**
   * 'full'    → the engine automates this card entirely.
   * 'partial' → castable/playable with the recognized parts automated; the
   *             lines in `automationNotes` still need manual adjudication.
   * 'manual'  → playable via manual mode only (Tier 3); engine logs, players adjudicate.
   */
  automation: 'full' | 'partial' | 'manual';
  /** Rules-text lines the oracle compiler did NOT automate (partial cards). */
  automationNotes?: string[];
}

export function isType(card: CardDefinition, t: CardType): boolean {
  return card.types.includes(t);
}

export function isPermanentCard(card: CardDefinition): boolean {
  return card.types.some((t) =>
    ['Land', 'Creature', 'Artifact', 'Enchantment', 'Planeswalker', 'Battle'].includes(t),
  );
}

/** Does a card definition match a FilterSpec, ignoring controller context? */
export function cardMatchesFilter(card: CardDefinition, filter: FilterSpec | undefined): boolean {
  if (!filter) return true;
  if (filter.what && filter.what !== 'permanent') {
    const typeName = filter.what.charAt(0).toUpperCase() + filter.what.slice(1);
    if (!card.types.includes(typeName as CardType)) return false;
  }
  if (filter.subtype && !card.subtypes.includes(filter.subtype)) return false;
  if (filter.basic && !card.supertypes?.includes('Basic')) return false;
  if (filter.nonland && card.types.includes('Land')) return false;
  if (filter.noncreature && card.types.includes('Creature')) return false;
  if (filter.color && !card.colors.includes(filter.color)) return false;
  return true;
}

/** A deck as handed to the engine: resolved definitions, order irrelevant (will be shuffled). */
export interface DeckList {
  cards: CardDefinition[];
}

export interface PlayerConfig {
  id: PlayerId;
  name: string;
  deck: DeckList;
}
