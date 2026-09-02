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
/** 'triggering' = the object that caused the trigger ("whenever another creature enters, … it"). */
export type SubjectRef = `target:${number}` | 'self' | 'host' | 'triggering' | PlayerSel;

/**
 * Object filter, evaluated relative to the effect's controller/source.
 * Used by mass effects (damageEach…), static abilities, global triggers,
 * sacrifice choices and library searches.
 */
export interface FilterSpec {
  what?: 'creature' | 'land' | 'artifact' | 'enchantment' | 'permanent' | 'instant' | 'sorcery';
  subtype?: string;
  /** "a Mountain or Forest card" (fetchlands). */
  subtypeAnyOf?: string[];
  /** Restrict by supertype 'Basic' (library searches for basic lands). */
  basic?: boolean;
  /** Subtype chosen for the source ("creatures of the chosen type"). */
  chosenSubtype?: boolean;
  /** Negations (Duress: "noncreature, nonland card"). */
  nonland?: boolean;
  noncreature?: boolean;
  /** Card color ("exile a blue card from your hand"). */
  color?: Color;
  /** Printed keyword filter ("each creature without flying"). */
  withKeyword?: Keyword;
  withoutKeyword?: Keyword;
  controlledBy?: 'you' | 'opponent' | 'any';
  /** Exclude the effect's own source ("another creature…"). */
  other?: boolean;
  /** "artifact or enchantment" as a filter (overload, bargain). */
  typeAnyOf?: CardType[];
  /** Bargain: "an artifact, enchantment, or token" — a token also qualifies. */
  orToken?: boolean;
  /** Only attacking creatures (battle cry). */
  attacking?: boolean;
  /** Mana value exactly N (transmute). */
  cmcEquals?: number;
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
  | 'sacrificedPower'
  /** Power of a referenced creature ("damage equal to its power" — bites). */
  | { powerOf: SubjectRef };

/** What a target may legally be. Validated at cast time and at resolution. */
export interface TargetSpec {
  what: 'any' | 'creature' | 'player' | 'permanent' | 'spell' | 'land' | 'artifact' | 'enchantment';
  /** For 'spell' targets: restrict by the spell's type (Negate, Essence Scatter…). */
  spellType?: 'creature' | 'noncreature' | 'instantSorcery';
  /** "artifact or enchantment": the object must have at least one of these types. */
  typeAnyOf?: CardType[];
  /** "tapped creature" / "attacking or blocking creature". */
  tapped?: boolean;
  combat?: boolean;
  /** "creature with power N or greater / N or less". */
  powerAtLeast?: number;
  powerAtMost?: number;
  /** Mentor: power less than this object's (id filled at trigger time). */
  powerLessThanSource?: number;
  /** "creature with flying" / "creature without flying". */
  withKeyword?: Keyword;
  withoutKeyword?: Keyword;
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
  /** Soulshift: "Spirit permanent card with mana value N or less". */
  subtype?: string;
  cmcAtMost?: number;
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
  | { op: 'gainLife'; who: WhoSel; amount: DynAmount }
  | { op: 'loseLife'; who: WhoSel; amount: DynAmount }
  | { op: 'destroy'; what: SubjectRef }
  | { op: 'exile'; what: SubjectRef }
  | { op: 'returnToHand'; what: SubjectRef }
  | { op: 'tap'; what: SubjectRef }
  | { op: 'untap'; what: SubjectRef }
  | { op: 'counterSpell'; what: SubjectRef }
  /** (choice) Mana Leak: the spell's controller may pay `cost`; otherwise it is countered. */
  | { op: 'counterUnlessPay'; what: SubjectRef; cost: string }
  /** Put the object on top of its owner's library. */
  | { op: 'putOnLibraryTop'; what: SubjectRef }
  /** Predefined artifact tokens with their own abilities. */
  | { op: 'namedToken'; who: PlayerSel; kind: 'Treasure' | 'Food' | 'Clue'; count: number }
  /** (choice) "You may <effect>" — yes runs `effect`, no runs `else` (if any). */
  | { op: 'mayDo'; prompt?: string; effect: EffectScript; else?: EffectScript; who?: 'opponent' }
  /** Energy: "you get {E}{E}" (negative = pay). */
  | { op: 'energy'; who: WhoSel; amount: number }
  /** (choice) Explore: reveal top; land → hand, else +1/+1 counter and may put it into the graveyard. */
  | { op: 'explore'; what: SubjectRef }
  /** (choice) Exploit: may sacrifice a creature; if so, "exploits" triggers fire. */
  | { op: 'exploit' }
  /** Ingest: that player exiles the top N cards of their library. */
  | { op: 'exileTop'; who: WhoSel; count: number }
  /** Graft: move a counter from one object to another. */
  | { op: 'moveCounter'; counter: string; from: SubjectRef; to: SubjectRef }
  /** Reconfigure: unattach the source. */
  | { op: 'unattach' }
  /** Sagas: add lore counters (chapter abilities trigger via the event). */
  | { op: 'addLore'; count: number }
  /**
   * (choice) "Sacrifice ~ unless you pay {N}" / echo / cumulative upkeep:
   * the controller may pay the cost (per age counter when `perCounter`);
   * otherwise `else` runs.
   */
  | { op: 'payOrElse'; cost: string; perCounter?: string; else: EffectScript; /** Runs only if paid (extort). */ then?: EffectScript; /** Pay energy instead of mana. */ energy?: number }
  /** Poison counters (infect/toxic). */
  | { op: 'poison'; who: WhoSel; count: number }
  /** Sacrifice the source itself. */
  | { op: 'sacrificeSelf' }
  /** Banisher Priest: exile the target until the source leaves the battlefield. */
  | { op: 'exileUntilLeaves'; what: SubjectRef }
  /** Monstrosity / Adapt: put N +1/+1 counters once (flag `once`). */
  | { op: 'putCountersOnce'; counter: string; count: number; flag: string }
  /** (choice) The controller picks a color / creature type stored on the source ("as ~ enters, choose…"). */
  | { op: 'chooseValue'; kind: 'color' | 'creatureType' }
  /** Add mana of the color chosen for the source. */
  | { op: 'addChosenColorMana'; count?: number }
  /** (choice) Devour N: sacrifice any number of creatures, N counters each. */
  | { op: 'devour'; per: number }
  /** Token copy of the source card (Embalm/Eternalize/Encore/Offspring/Squad). */
  | {
      op: 'tokenCopy';
      count?: number;
      /** Overrides: Embalm → white Zombie; Eternalize → 4/4 black Zombie; Offspring → 1/1. */
      colors?: Color[];
      addSubtype?: string;
      power?: number;
      toughness?: number;
      keywords?: Keyword[];
      /** Enters attacking (Encore) / sacrificed at end step / exiled at end step. */
      attacking?: boolean;
      sacrificeAtEnd?: boolean;
      exileAtEnd?: boolean;
    }
  /** Unearth: return the source from the graveyard with haste; exile at end step or if it would leave. */
  | { op: 'unearth' }
  /** Put +1/+1 counters equal to the source card's power on the target (Scavenge). */
  | { op: 'putPowerCounters'; what: SubjectRef }
  /** Schedule the source to be exiled / sacrificed / returned to hand at the next end step. */
  | { op: 'delayed'; at: 'endStep'; action: 'exile' | 'sacrifice' | 'returnToHand' }
  /** Foretell / Plot: exile the source from hand face down to be cast later. */
  | { op: 'exileFromHandForLater'; mode: 'foretold' | 'plotted' }
  /** Madness: pay the cost and cast the source (in exile) for free; otherwise it goes to the graveyard. */
  | { op: 'castSelfForCost'; cost: string }
  | { op: 'selfToGraveyard' }
  | { op: 'pump'; what: SubjectRef; power: number; toughness: number; keywords?: Keyword[] }
  /** Permanent +1/+1 or -1/-1 (or named) counters. */
  | { op: 'putCounters'; what: SubjectRef; counter: string; count: DynAmount }
  | { op: 'putCountersEach'; filter: FilterSpec; counter: string; count: number }
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
  /** (choice) Look at the top N; chosen cards go to the graveyard. */
  | { op: 'surveil'; count: number }
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
  | { op: 'addMana'; who: PlayerSel; mana: ManaSymbol[]; /** Firebending: the mana stays until end of combat. */ untilEndOfCombat?: boolean }
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
      /** Card types (default Creature): "Robot artifact creature token". */
      types?: CardType[];
      /** Mobilize: tapped and attacking, sacrificed at the next end step. */
      tapped?: boolean;
      attacking?: boolean;
      sacrificeAtEnd?: boolean;
      /** Job select / For Mirrodin!: attach the source Equipment to the token. */
      attachSource?: boolean;
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
  | { on: 'blocks'; self: true }
  /** Leaves the battlefield to any zone (dies is the graveyard subset). */
  | { on: 'leaves'; self: true }
  | { on: 'becomesTapped'; self: true }
  | { on: 'becomesBlocked'; self: true }
  /** Becomes the target of a spell or ability (any controller, or opponents' only). */
  | { on: 'becomesTargeted'; self: true; byOpponent?: boolean }
  /** The controller draws a card. */
  | { on: 'youDrawCard' }
  /** This creature deals combat damage to a player. */
  | { on: 'combatDamageToPlayer'; self: true }
  /** An opponent casts a spell. */
  | { on: 'opponentCastsSpell' }
  /** The controller attacks with one or more creatures (fires once). */
  | { on: 'youAttack' }
  | { on: 'upkeep'; whose: 'controller' | 'each' }
  | { on: 'endStep'; whose: 'controller' | 'each' }
  /** The controller casts a spell (prowess-style). */
  | { on: 'youCastSpell'; noncreatureOnly?: boolean; instantSorceryOnly?: boolean }
  /** The controller gains life (Ajani's Pridemate). */
  | { on: 'youGainLife' }
  /** Saga chapter(s): fires when the lore counter total reaches one of these. */
  | { on: 'chapter'; chapters: number[] }
  /** Exploit: this creature sacrificed a creature via its exploit ability. */
  | { on: 'exploits'; self: true };

/** Level up / Class: the ability works only within this level range. */
export interface LevelGate {
  levelMin?: number;
  levelMax?: number;
}

export interface TriggeredAbility extends LevelGate {
  kind: 'triggered';
  trigger: TriggerSpec;
  /** "When ~ enters, if it was kicked / the gift was promised / tribute wasn't paid, …". */
  requiresKicked?: boolean;
  /**
   * Targets chosen by the controller when the trigger goes on the stack
   * (Flametongue Kavu-style). If no legal target exists, the trigger is
   * simply removed.
   */
  targets?: TargetSpec[];
  effect: EffectScript;
  /** "When ~ enters, choose one —": the controller picks a mode when it triggers. */
  modes?: SpellMode[];
  /** Human-readable rules text of just this ability, for the log. */
  text: string;
}

export interface ActivatedAbility extends LevelGate {
  kind: 'activated';
  /** Where the card must be to activate (default battlefield): Unearth/Scavenge/Embalm from the graveyard, Foretell from hand. */
  zone?: 'battlefield' | 'graveyard' | 'hand';
  /** Graveyard abilities that exile the card as a cost (Scavenge, Embalm, Eternalize, Encore). */
  exileSelf?: boolean;
  /** Class: "{cost}: Level N" is available only at level N-1. */
  requiresLevel?: number;
  cost: {
    tap?: boolean;
    mana?: string;
    sacrificeSelf?: boolean;
    /** Sacrifice another permanent matching this filter (chosen in the action). */
    sacrifice?: FilterSpec;
    /** Pay N life (requires having at least N). */
    payLife?: number;
    /** Discard N cards from hand (chosen in the action). */
    discard?: number;
    /** Pay N energy counters. */
    energy?: number;
    /** Station: tap another untapped creature you control (chosen in the action); charge counters = its power. */
    tapCreature?: boolean;
    /** Transmute: discard this card from hand as part of the cost. */
    discardSelf?: boolean;
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
/** "As long as …" conditions for static abilities. */
export type StaticCondition =
  | { kind: 'yourTurn' }
  | { kind: 'attacking' }
  | { kind: 'untapped' }
  | { kind: 'tapped' }
  /** Threshold: ≥ N cards in your graveyard. */
  | { kind: 'graveyardAtLeast'; count: number }
  /** Delirium: ≥ 4 card types among cards in your graveyard. */
  | { kind: 'delirium' }
  /** Metalcraft & friends: you control ≥ count permanents matching the filter. */
  | { kind: 'controlsAtLeast'; count: number; filter: FilterSpec }
  /** Has a counter of this kind. */
  | { kind: 'hasCounter'; counter: string };

export interface StaticAbility extends LevelGate {
  kind: 'static';
  /** Which battlefield objects it applies to (relative to its controller). */
  filter: FilterSpec;
  /** Applies only to the source itself ("~ gets +1/+1 for each…"). */
  selfOnly?: boolean;
  /** Only while the condition holds. */
  condition?: StaticCondition;
  power?: number;
  toughness?: number;
  /** Dynamic bonus: +1 per battlefield object matching the filter. */
  powerPer?: FilterSpec;
  toughnessPer?: FilterSpec;
  keywords?: Keyword[];
  text: string;
}

export type AbilityDef = TriggeredAbility | ActivatedAbility | StaticAbility | LoyaltyAbility;

/** One alternative way to cast a card (Evoke, Dash, Blitz, Escape, Surge, Prowl, Spectacle, Foretell, Plot, Warp). */
export interface CastMethod {
  kind:
    | 'evoke' | 'dash' | 'blitz' | 'escape' | 'surge' | 'prowl' | 'spectacle' | 'foretold' | 'plotted' | 'warp'
    /** Leva 3: bestow (as an Aura), emerge (sacrifice a creature, reduced by its MV), mayhem (from graveyard the turn it was discarded),
     *  retrace (from graveyard discarding a land), freerunning, overload ("target" → "each"), sneak (ninjutsu for spells). */
    | 'bestow' | 'emerge' | 'mayhem' | 'retrace' | 'freerunning' | 'overload' | 'sneak';
  /** Mana cost of this method ('' = free). */
  cost: string;
  /** Escape: exile this many other cards from your graveyard. */
  exileFromGraveyard?: number;
  label: string;
}

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
  /** Kicker: optional extra mana cost; when paid, `effect` is appended
   *  (spells) or the permanent enters with `entersWithCounters` (creatures). */
  kicker?: {
    cost: string;
    effect: EffectScript;
    entersWithCounters?: { counter: string; count: number };
    /** Bargain: the "kicker" is sacrificing an artifact, enchantment or token instead of mana. */
    sacrifice?: FilterSpec;
    /** Gift: what the opponent gets when the gift is promised (runs first). */
    gift?: EffectScript;
    /** Label for the client ("bargain", "gift a card"). */
    label?: string;
  };
  // ---- Leva 3
  /** Saga: number of chapters; read ahead lets the controller pick the starting chapter. */
  saga?: { chapters: number; readAhead?: boolean };
  /** Class enchantment: level = level counters + 1. */
  isClass?: boolean;
  /** Level up {cost}: adds a level counter (sorcery speed). */
  levelUp?: string;
  /** LEVEL bands: printed P/T and keywords by level counter count. */
  levels?: { min: number; max?: number; power?: number; toughness?: number; keywords?: Keyword[] }[];
  /** Spacecraft: an artifact creature with these keywords once it has ≥ threshold charge counters. */
  station?: { threshold: number; keywords?: Keyword[] };
  /** Split second: while on the stack, no spells or non-mana abilities. */
  splitSecond?: boolean;
  /** Entwine {cost}: pay to choose every mode. */
  entwine?: string;
  /** Overload: the spell's effect with "target" turned into "each". */
  overloadEffect?: EffectScript;
  /** Reconfigure {cost}: equipment creature that attaches/unattaches. */
  reconfigure?: string;
  /** Umbra armor: destruction of the enchanted creature destroys this aura instead. */
  umbraArmor?: boolean;
  /** Attack-trigger keywords. */
  battleCry?: boolean;
  melee?: boolean;
  training?: boolean;
  dethrone?: boolean;
  annihilator?: number;
  mobilize?: number;
  firebending?: number;
  /** Ingest: combat damage to a player exiles their top card. */
  ingest?: boolean;
  /** Ravenous: X +1/+1 counters; draw if X ≥ 5. */
  ravenous?: boolean;
  /** Sunburst: enters with a counter per color of mana spent. */
  sunburst?: boolean;
  /** Graft N: enters with N +1/+1 counters; may move one onto each other entering creature. */
  graft?: number;
  /** Tribute N: an opponent may put N +1/+1 counters; otherwise `effect`. */
  tribute?: { count: number; effect: EffectScript };
  /** Amplify N: N counters per creature card in hand sharing a type. */
  amplify?: number;
  /** Leylines: may start on the battlefield from the opening hand. */
  openingHand?: boolean;
  /** Ward—Pay N life. */
  wardLife?: number;
  /** Sneak {cost}: creature spell cast during blockers by returning an unblocked attacker; enters tapped and attacking. */
  sneak?: string;
  /** Blocking restrictions ("can't be blocked by more than one creature" / "except by three or more"). */
  maxBlockers?: number;
  minBlockers?: number;
  /** "Can block an additional creature" / "any number of creatures". */
  extraBlocks?: number | 'any';
  /** Its controller may play this many extra lands per turn. */
  extraLands?: number;
  /** Controller has hexproof (can't be targeted by opponents' spells). */
  playerHexproof?: boolean;
  /** "Players can't gain life" / "Your opponents can't gain life". */
  noLifeGain?: 'all' | 'opponents';
  /** Controller may look at the top card of their library any time. */
  revealTop?: boolean;
  /** Bloodthirst N: enters with N +1/+1 counters if an opponent was dealt damage this turn. */
  bloodthirst?: number;
  /** "~ enters tapped unless you have two or more opponents": always tapped in 1v1. */
  flanking?: boolean;
  rampage?: number;
  afflict?: number;
  /** Skulk: can't be blocked by creatures with greater power. */
  skulk?: boolean;
  /** Renown N: first combat damage to a player → N +1/+1 counters. */
  renown?: number;
  /** Mentor: when attacking, put a +1/+1 counter on an attacking creature with lesser power. */
  mentor?: boolean;
  /** Flashback: castable from the graveyard for this cost; exiles after.
   *  `cost` is mana; `sacrifice` an additional non-mana cost (Cabal Therapy). */
  flashback?: { cost?: string; sacrifice?: FilterSpec };
  /**
   * Alternative cost (Force of Will): instead of the mana cost, pay life
   * and/or exile matching cards from your hand.
   */
  altCost?: { payLife?: number; exileFromHand?: { count: number; filter: FilterSpec }; label: string };
  /**
   * Alternative casting methods with their own mana cost and side effects.
   * The client offers each as a cast option; the engine applies the rules.
   */
  castMethods?: CastMethod[];
  /** Buyback {N}: optional extra cost; if paid the spell returns to hand as it resolves. */
  buyback?: string;
  /** Multikicker: kicker may be paid any number of times (counters × times). */
  multikicker?: boolean;
  /** Cost reductions applied automatically at cast time. */
  affinity?: 'artifact';
  convoke?: boolean;
  delve?: boolean;
  improvise?: boolean;
  /** Cascade: when cast, exile until a cheaper nonland card and may cast it free. */
  cascade?: boolean;
  /** Morph/Disguise: may be cast face down as a 2/2 for {3}; turn up for this cost. Megamorph adds a +1/+1 counter. */
  morph?: { cost: string; megamorph?: boolean; disguise?: boolean };
  /** Ninjutsu cost: swap with an unblocked attacker. */
  ninjutsu?: string;
  /** Rebound: exile on resolve from hand, cast free next upkeep. */
  rebound?: boolean;
  /** Suspend N—cost: exile from hand with N time counters; cast free when they run out. */
  suspend?: { count: number; cost: string };
  /** Madness: may cast for this cost when discarded. */
  madness?: string;
  /** Offspring / Squad: kicker-style extra cost that creates token copies as it enters (1/1 for offspring). */
  offspring?: boolean;
  squad?: boolean;
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
  /** Modular N: enters with N +1/+1 counters; dies → move them to target artifact creature. */
  modular?: number;
  /** Persist / Undying: dies without the counter → returns with one. */
  persist?: boolean;
  undying?: boolean;
  /** Evolve: a creature entering with greater P or T gives a +1/+1 counter. */
  evolve?: boolean;
  /** Afterlife N: dies → N 1/1 white-black Spirit tokens with flying. */
  afterlife?: number;
  /** Living weapon: enters with a 0/0 Germ attached. */
  livingWeapon?: boolean;
  /** Fabricate N: enters → N +1/+1 counters or a 1/1 Servo… simplified to counters. */
  fabricate?: number;
  /** Unleash / Riot: enters with a +1/+1 counter (unleashed can't block) or haste. Simplified: counter. */
  unleash?: boolean;
  riot?: boolean;
  /** Echo: at the beginning of the upkeep after it came under your control, sacrifice unless you pay. */
  echo?: string;
  /** Cumulative upkeep: age counter each upkeep; pay cost × counters or sacrifice. */
  cumulativeUpkeep?: string;
  /** Vanishing / Fading N: time counters; upkeep removes one; sacrifice at 0 (fading: can't attack…). */
  vanishing?: number;
  fading?: number;
  /** "As ~ enters, choose a color / creature type." */
  chooseOnEnter?: 'color' | 'creatureType';
  /** Devour N. */
  devour?: number;
  /**
   * Aura: what it can enchant. Casting requires this target and the aura
   * enters the battlefield attached to it (fizzles if the target is gone).
   */
  enchant?: { what: 'creature' | 'land' | 'artifact' | 'enchantment' | 'permanent'; controlledBy?: 'you' | 'opponent' };
  /** Static effects granted to whatever this aura/equipment is attached to. */
  attachEffect?: {
    power?: number;
    toughness?: number;
    keywords?: Keyword[];
    cantAttack?: boolean;
    cantBlock?: boolean;
    doesntUntap?: boolean;
    /** Control Magic: the aura's controller controls the host while attached. */
    controlHost?: boolean;
  };
  /** Ward N: opponents' spells/abilities targeting this permanent cost {N} more. */
  ward?: number;
  /** Vehicles: tap creatures with total power ≥ N to become a creature until end of turn. */
  crew?: number;
  /** "Can't be blocked by creatures with power N or less / N or greater." */
  evasionPowerAtMost?: number;
  evasionPowerAtLeast?: number;
  /** Checklands / fastlands: enters tapped unless the condition holds. */
  entersTappedUnless?: {
    controlsAtLeast?: { count: number; filter: FilterSpec };
    /** Fastlands: "unless you control two or fewer other lands". */
    controlsAtMost?: { count: number; filter: FilterSpec };
    controlsSubtypeAnyOf?: string[];
  };
  /** Shocklands: may pay N life as it enters; otherwise enters tapped. */
  shockLife?: number;
  /** Damage-as-counters keywords. */
  infect?: boolean;
  wither?: boolean;
  toxic?: number;
  exalted?: boolean;
  bushido?: number;
  /** Instants/sorceries that exile themselves as they resolve ("Exile ~."). */
  exileOnResolve?: boolean;
  /** "You have no maximum hand size." while this permanent is on the battlefield. */
  noMaxHandSize?: boolean;
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
  if (filter.subtypeAnyOf && !filter.subtypeAnyOf.some((s) => card.subtypes.includes(s))) return false;
  if (filter.basic && !card.supertypes?.includes('Basic')) return false;
  if (filter.nonland && card.types.includes('Land')) return false;
  if (filter.noncreature && card.types.includes('Creature')) return false;
  if (filter.color && !card.colors.includes(filter.color)) return false;
  if (filter.withKeyword && !card.keywords?.includes(filter.withKeyword)) return false;
  if (filter.withoutKeyword && card.keywords?.includes(filter.withoutKeyword)) return false;
  if (filter.typeAnyOf && !filter.typeAnyOf.some((t) => card.types.includes(t))) return false;
  if (filter.cmcEquals !== undefined) {
    let mv = 0;
    for (const m of (card.manaCost ?? '').matchAll(/\{([^}]+)\}/g)) mv += /^\d+$/.test(m[1]) ? parseInt(m[1], 10) : m[1] === 'X' ? 0 : 1;
    if (mv !== filter.cmcEquals) return false;
  }
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
