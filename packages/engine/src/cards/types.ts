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

/** What a target may legally be. Validated at cast time and at resolution. */
export interface TargetSpec {
  what: 'any' | 'creature' | 'player' | 'permanent' | 'spell' | 'land' | 'artifact' | 'enchantment';
  /** Restrict to a controller, relative to the spell's controller. */
  controlledBy?: 'you' | 'opponent';
  optional?: boolean;
}

/**
 * The effect primitives. Each step emits GameEvents; none mutate state
 * directly. Adding a primitive = one case in effects.ts plus this union.
 */
export type EffectStep =
  | { op: 'draw'; who: PlayerSel; count: number }
  | { op: 'discardRandom'; who: PlayerSel; count: number }
  | { op: 'mill'; who: PlayerSel; count: number }
  | { op: 'damage'; to: SubjectRef; amount: number }
  | { op: 'gainLife'; who: PlayerSel; amount: number }
  | { op: 'loseLife'; who: PlayerSel; amount: number }
  | { op: 'destroy'; what: SubjectRef }
  | { op: 'exile'; what: SubjectRef }
  | { op: 'returnToHand'; what: SubjectRef }
  | { op: 'tap'; what: SubjectRef }
  | { op: 'untap'; what: SubjectRef }
  | { op: 'counterSpell'; what: SubjectRef }
  | { op: 'pump'; what: SubjectRef; power: number; toughness: number }
  /** Attach the source permanent (aura/equipment) to target:0. */
  | { op: 'attach' }
  | { op: 'addMana'; who: PlayerSel; mana: ManaSymbol[] }
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

/** Trigger conditions for triggered abilities (Tier 1 subset). */
export type TriggerSpec =
  | { on: 'etb'; self: true }
  | { on: 'dies'; self: true }
  | { on: 'attacks'; self: true }
  | { on: 'upkeep'; whose: 'controller' | 'each' };

export interface TriggeredAbility {
  kind: 'triggered';
  trigger: TriggerSpec;
  targets?: TargetSpec[];
  effect: EffectScript;
  /** Human-readable rules text of just this ability, for the log. */
  text: string;
}

export interface ActivatedAbility {
  kind: 'activated';
  cost: { tap?: boolean; mana?: string; sacrificeSelf?: boolean };
  targets?: TargetSpec[];
  effect: EffectScript;
  text: string;
  /** Mana abilities resolve immediately, without using the stack. */
  isManaAbility?: boolean;
  /** Equip-style: only during your main phase with an empty stack. */
  sorceryOnly?: boolean;
}

export type AbilityDef = TriggeredAbility | ActivatedAbility;

export interface CardDefinition {
  /** Stable slug unique within a set, e.g. 'lightning-strike'. */
  id: string;
  name: string;
  /** Scryfall oracle_id when known — the universal join key. */
  oracleId?: string;
  /** Scryfall card (printing) id, used by clients to fetch the card image. */
  scryfallId?: string;
  /** Mana cost in oracle syntax, e.g. '{1}{R}{R}'. Lands have none. */
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
  abilities?: AbilityDef[];
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
   * 'full'   → the engine automates this card entirely.
   * 'manual' → playable via manual mode only (Tier 3); engine logs, players adjudicate.
   */
  automation: 'full' | 'manual';
}

export function isType(card: CardDefinition, t: CardType): boolean {
  return card.types.includes(t);
}

export function isPermanentCard(card: CardDefinition): boolean {
  return card.types.some((t) =>
    ['Land', 'Creature', 'Artifact', 'Enchantment', 'Planeswalker', 'Battle'].includes(t),
  );
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
