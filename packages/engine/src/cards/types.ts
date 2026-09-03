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
/** 'triggering' = the object that caused the trigger ("whenever another creature enters, … it"); 'iter' = the current object of a forEach. */
export type SubjectRef = `target:${number}` | 'self' | 'host' | 'triggering' | 'iter' | PlayerSel;

/**
 * Conditions ("if …", "as long as …"). Evaluated relative to the source's
 * controller; `subjectIs` needs the effect context (target / triggering object).
 */
export type Cond =
  | { kind: 'yourTurn' }
  | { kind: 'attacking' }
  | { kind: 'untapped' }
  | { kind: 'tapped' }
  /** Threshold: ≥ N cards in your graveyard (optionally matching a filter — spell mastery, undergrowth). */
  | { kind: 'graveyardAtLeast'; count: number; filter?: FilterSpec }
  /** Delirium: ≥ 4 card types among cards in your graveyard. */
  | { kind: 'delirium' }
  /** Metalcraft & friends: you control ≥ count permanents matching the filter. */
  | { kind: 'controlsAtLeast'; count: number; filter: FilterSpec }
  /** "You control no X" / "an opponent controls a X". */
  | { kind: 'controlsAtMost'; count: number; filter: FilterSpec }
  | { kind: 'opponentControlsAtLeast'; count: number; filter: FilterSpec }
  /** Has a counter of this kind. */
  | { kind: 'hasCounter'; counter: string }
  | { kind: 'isMonarch' }
  | { kind: 'hasInitiative' }
  | { kind: 'completedDungeon' }
  | { kind: 'lifeAtMost'; who: PlayerSel; amount: number }
  | { kind: 'lifeAtLeast'; who: PlayerSel; amount: number }
  | { kind: 'moreLifeThanOpponent' }
  | { kind: 'handSizeAtMost'; who: PlayerSel; amount: number }
  | { kind: 'handSizeAtLeast'; who: PlayerSel; amount: number }
  /** Morbid / raid / revolt / celebration / "cast another spell this turn" / "gained life this turn". */
  | { kind: 'creatureDiedThisTurn' }
  | { kind: 'attackedThisTurn' }
  | { kind: 'permanentLeftThisTurn' }
  | { kind: 'nonlandEnteredThisTurn'; count: number }
  | { kind: 'spellsCastThisTurnAtLeast'; count: number }
  | { kind: 'gainedLifeThisTurn' }
  | { kind: 'dealtCombatDamageThisTurn' }
  /** Pack tactics / formidable: total power of creatures you control (or attacked with) ≥ N. */
  | { kind: 'attackedWithPowerAtLeast'; amount: number }
  | { kind: 'totalPowerAtLeast'; amount: number }
  /** Coven: three or more creatures with different powers. */
  | { kind: 'coven' }
  /** Corrupted: an opponent has three or more poison counters. */
  | { kind: 'opponentPoisonAtLeast'; count: number }
  | { kind: 'isMainPhase' }
  /** The target / triggering object matches the filter ("if it's a creature card"). */
  | { kind: 'subjectIs'; ref: SubjectRef; filter: FilterSpec }
  /** "attacks alone" / "~ and at least two other creatures attack". */
  | { kind: 'attackersAtLeast'; count: number }
  | { kind: 'attackedAlone' }
  | { kind: 'lifeGainedAtLeast'; amount: number }
  | { kind: 'castNoncreatureThisTurn' }
  | { kind: 'opponentLostLifeThisTurn' }
  | { kind: 'anyPermanentLeftThisTurn' }
  | { kind: 'not'; cond: Cond }
  | { kind: 'and'; conds: Cond[] }
  | { kind: 'or'; conds: Cond[] };

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
  cmcAtMost?: number;
  cmcAtLeast?: number;
  /** Power / toughness bounds ("creatures with power 2 or less"). */
  powerAtLeast?: number;
  powerAtMost?: number;
  toughnessAtMost?: number;
  /** Has a counter of this kind ("each creature you control with a +1/+1 counter on it"). */
  withCounter?: string;
  /** Tokens only / nontoken only. */
  token?: boolean;
  nontoken?: boolean;
  /** "nonblack creature" / "non-Zombie creature". */
  notColor?: Color;
  notSubtype?: string;
  tapped?: boolean;
  untapped?: boolean;
  legendary?: boolean;
  /** "creature that's attacking or blocking". */
  inCombat?: boolean;
  /** Two or more colors. */
  multicolored?: boolean;
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
  | { powerOf: SubjectRef }
  | { toughnessOf: SubjectRef }
  | { cmcOf: SubjectRef }
  | { countersOn: SubjectRef; counter: string }
  | { handSize: PlayerSel }
  | { graveyardCount: PlayerSel; filter?: FilterSpec }
  | { lifeOf: PlayerSel }
  /** Amount carried by the trigger ("that much" — damage dealt, life gained). */
  | 'triggerAmount'
  /** Domain: basic land types among lands you control. */
  | 'domain'
  | { times: number; of: DynAmount }
  | { plus: number; of: DynAmount };

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
  subtypeAnyOf?: string[];
  notSubtype?: string;
  cmcAtMost?: number;
  cmcAtLeast?: number;
  toughnessAtMost?: number;
  color?: Color;
  notColor?: Color;
  nontoken?: boolean;
  token?: boolean;
  untapped?: boolean;
  legendary?: boolean;
  /** "target creature you don't control" is the same as opponent in two players; 'any' is the default. */
}

/**
 * The effect primitives. Each step emits GameEvents; none mutate state
 * directly. Adding a primitive = one case in effects.ts plus this union.
 *
 * Steps marked (choice) pause resolution and ask a player to pick — the
 * engine resumes the script automatically after the pick.
 */
/** Who an effect applies to, including targeted players ("target player draws…"), the player a trigger is about, and controllers of objects. */
export type WhoSel = PlayerSel | `target:${number}` | 'triggerPlayer' | `controllerOf:${number}` | 'controllerOfTriggering' | 'controllerOfIter';

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
  | { op: 'damage'; to: SubjectRef; amount: DynAmount; /** "If that creature would die this turn, exile it instead." */ exileIfDies?: boolean }
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
  | { op: 'namedToken'; who: PlayerSel; kind: 'Treasure' | 'Food' | 'Clue' | 'Blood' | 'Powerstone' | 'Map' | 'Gold'; count: DynAmount; tapped?: boolean }
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
  /** (choice) Hideaway: look at the top N, exile one face down (linked to the source), rest to the bottom. */
  | { op: 'hideaway'; count: number }
  /** Play the card hidden away by the source without paying its cost. */
  | { op: 'playHideaway' }
  /** (choice) Cipher: after resolving, may exile the spell encoded on a creature you control. */
  | { op: 'cipherEncode' }
  /** Haunt: exile the source from the graveyard haunting the target creature. */
  | { op: 'hauntExile'; what: SubjectRef }
  | { op: 'becomeMonarch'; who: WhoSel }
  | { op: 'takeInitiative'; who: WhoSel }
  /** Venture into the dungeon (the engine asks which dungeon / which room). */
  | { op: 'venture' }
  /** Internal: move the controller to a dungeon room (room effects follow). */
  | { op: 'ventureTo'; dungeon: string; room: number }
  /** Dredge: the source (in the graveyard) replaces the controller's next draw. */
  | { op: 'armDredge'; count: number }
  /** "Exile the top N cards of your library. You may play them this turn." */
  | { op: 'impulse'; count: number }
  /** Goad: must attack (a player other than you) until your next turn. */
  | { op: 'goad'; what: SubjectRef }
  // ---- Leva 4: gramática composicional
  /** "If <cond>, <then>[. Otherwise, <else>]". */
  | { op: 'if'; cond: Cond; then: EffectScript; else?: EffectScript }
  /** "Each <filter> <verb>": run the effect once per matching battlefield object, with 'iter' as the subject. */
  | { op: 'forEach'; filter: FilterSpec; effect: EffectScript }
  /** Prevention shield: the next N damage to the subject this turn is prevented. */
  | { op: 'preventNext'; what: SubjectRef; amount: DynAmount }
  /** Prevent all damage that would be dealt to the subject this turn. */
  | { op: 'preventAllTo'; what: SubjectRef }
  /** Delayed trigger with an arbitrary effect (targets captured now). */
  | { op: 'delayedEffect'; at: 'endStep' | 'nextUpkeep'; effect: EffectScript }
  /** (choice) Clone: the source enters as a copy of a creature on the battlefield. */
  | { op: 'copyOf' }
  /** (choice) Populate: create a copy of a creature token you control. */
  | { op: 'populate' }
  /** Proliferate: one more of each kind of counter on each permanent you control that has counters. */
  | { op: 'proliferate' }
  /** Bolster N: N +1/+1 counters on your creature with the least toughness. */
  | { op: 'bolster'; count: number }
  /** (choice) Support N: a +1/+1 counter on each of up to N other creatures. */
  | { op: 'support'; count: number }
  /** Amass N: N +1/+1 counters on your Army (created 0/0 if none). */
  | { op: 'amass'; count: number; subtype?: string }
  /** (choice) Connive: draw, then discard; a nonland discard gives a +1/+1 counter. */
  | { op: 'connive'; what: SubjectRef }
  /** Flicker: exile the subject and return it to the battlefield under its owner's control. */
  | { op: 'blink'; what: SubjectRef }
  /** (choice) "Look at the top N cards. Put up to `pick` of them (matching filter) into your hand; the rest on the bottom / into your graveyard." */
  | { op: 'digTop'; count: number; pick: number; filter?: FilterSpec; rest: 'bottom' | 'graveyard' | 'top'; to?: 'hand' | 'battlefield' }
  /** "Exile the top N cards of your library" (no play permission). */
  | { op: 'exileTopSelf'; count: number }
  // ---- Leva 5 (gramática 2)
  /** "Return the exiled card(s) to the battlefield under its owner's control / to its owner's hand" (cards the source exiled). */
  | { op: 'returnExiledBy'; to: 'battlefield' | 'hand' }
  /** (choice) "Return a land you control to its owner's hand". */
  | { op: 'bounceOwn'; filter: FilterSpec }
  /** "Put its counters on target creature" (counters the source had when it died). */
  | { op: 'moveAllCounters'; to: SubjectRef }
  | { op: 'putOnLibraryBottom'; what: SubjectRef }
  /** Learn (no sideboard here): may discard a card to draw a card. */
  | { op: 'learn' }
  /** (choice) "You may put a land card from your hand onto the battlefield (tapped)". */
  | { op: 'putFromHand'; filter: FilterSpec; tapped?: boolean }
  | { op: 'removeCounters'; what: SubjectRef; counter: string; count: DynAmount }
  /** "Add {C} or one mana of the chosen color" / "Add {G} or {U}": the activation carries the pick. */
  | { op: 'addManaOptions'; options: ManaSymbol[]; chosenColor?: boolean }
  | { op: 'exileGraveyard'; who: WhoSel }
  | { op: 'revealHand'; who: WhoSel }
  /** "Tap that creature and it doesn't untap…" is a pump; "target creature blocks ~ this turn if able" / "can't block ~ this turn". */
  | { op: 'mustBlockSource'; what: SubjectRef }
  | { op: 'cantBlockSource'; what: SubjectRef }
  /**
   * (choice) "Sacrifice ~ unless you pay {N}" / echo / cumulative upkeep:
   * the controller may pay the cost (per age counter when `perCounter`);
   * otherwise `else` runs.
   */
  | { op: 'payOrElse'; cost: string; perCounter?: string; else: EffectScript; /** Runs only if paid (extort). */ then?: EffectScript; /** Pay energy instead of mana. */ energy?: number; /** Who decides/pays (default the controller). */ payer?: 'opponent' }
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
      /** What to copy (default: the source). */
      what?: SubjectRef;
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
  | { op: 'pump'; what: SubjectRef; power: number; toughness: number; keywords?: Keyword[]; /** Default until end of turn; 'yourNextTurn' lasts until the controller's next turn begins. */ duration?: 'eot' | 'yourNextTurn'; /** Dynamic bonus ("gets +X/+X where X is …"). */ powerDyn?: DynAmount; toughnessDyn?: DynAmount }
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
      /** Undercity's throne: enters with counters. */
      withCounters?: { counter: string; count: number };
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
      count: DynAmount;
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
      /** Granted abilities ("It has 'Sacrifice this token: Add {C}.'"). */
      abilities?: AbilityDef[];
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
  | { on: 'exploits'; self: true }
  /** Haunt: the creature this (exiled) card haunts dies. */
  | { on: 'hauntedDies'; self: true }
  | { on: 'youBecomeMonarch' }
  | { on: 'youVenture' }
  | { on: 'youCompleteDungeon' }
  // ---- Leva 4
  | { on: 'beginCombat'; whose: 'controller' | 'each' }
  | { on: 'main1'; whose: 'controller' }
  | { on: 'main2'; whose: 'controller' }
  | { on: 'turnedFaceUp'; self: true }
  /** Enrage: this creature is dealt damage (triggerAmount = damage). */
  | { on: 'dealtDamage'; self: true }
  /** This creature deals damage (any) / combat damage to a creature (triggerAmount). */
  | { on: 'dealsDamage'; self: true }
  | { on: 'combatDamageToCreature'; self: true }
  /** Attacks and isn't blocked (fires after blockers are declared). */
  | { on: 'attacksUnblocked'; self: true }
  /** "When you cast ~" (fires when it's put on the stack). */
  | { on: 'youCastThis' }
  /** Aura/Equipment host triggers. */
  | { on: 'hostDies' }
  | { on: 'hostAttacks' }
  | { on: 'hostCombatDamageToPlayer' }
  | { on: 'hostDealtDamage' }
  /** Any player casts a spell. */
  | { on: 'anyCastsSpell' }
  /** A creature you control deals combat damage to a player (triggerPlayer = the damaged player). */
  | { on: 'yourCreatureCombatDamageToPlayer' }
  | { on: 'youExertThis' }
  /** A creature you control dies / a permanent you control leaves … are covered by dies/leaves filters. */
  | { on: 'youDrawCardNth'; nth: number }
  | { on: 'youCastSpellNth'; nth: number }
  | { on: 'youCastSpellOf'; filter: FilterSpec }
  /** Heroic: you cast a spell that targets this permanent. */
  | { on: 'youCastSpellTargetingThis' }
  /** Landfall-style etb for the host's controller is covered by etb filters. */
  | { on: 'youSacrifice'; filter?: FilterSpec }
  | { on: 'anyPlayerDiscards' }
  | { on: 'youDiscard' }
  // ---- Leva 5
  | { on: 'becomesUntapped'; self: true }
  | { on: 'hostDealsDamage' }
  /** "Whenever a creature dealt damage by ~ this turn dies". */
  | { on: 'damagedCreatureDies'; self: true }
  /** "When you cycle this card". */
  | { on: 'youCycleThis' }
  /** "At the beginning of the upkeep of enchanted creature's controller". */
  | { on: 'hostControllerUpkeep' };

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
  /** Intervening "if": "…, if you're the monarch, …" — checked when it would trigger. */
  condition?: Cond;
  /** Valiant-style: triggers only the first time each turn. */
  oncePerTurn?: boolean;
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
    /** "Remove N X counters from ~". */
    removeCounters?: { counter: string; count: number };
    /** "Exile a creature card from your graveyard" (engine picks the first matching card unless the action names one). */
    exileFromGraveyard?: { filter: FilterSpec; count: number };
    /** "Return a land you control to its owner's hand" (first land unless the action names one). */
    returnLand?: boolean;
    /** "Exile ~" (from the battlefield). */
    exileSelfFromBattlefield?: boolean;
  };
  targets?: TargetSpec[];
  effect: EffectScript;
  text: string;
  /** Mana abilities resolve immediately, without using the stack. */
  isManaAbility?: boolean;
  /** Equip-style: only during your main phase with an empty stack. */
  sorceryOnly?: boolean;
  /** Metalcraft-style / hideaway conditions: all present fields must hold. */
  condition?: {
    controlsAtLeast?: { count: number; filter: FilterSpec };
    /** Shelldock Isle: "if a library has twenty or fewer cards in it". */
    libraryAtMost?: number;
    /** Windbrisk Heights: "if you attacked with three or more creatures this turn". */
    attackedWithAtLeast?: number;
    completedDungeon?: boolean;
    isMonarch?: boolean;
    /** Any other condition ("Activate only if you attacked this turn" — boast). */
    cond?: Cond;
  };
  /** Resolves immediately, like a mana ability (dredge arming). */
  immediate?: boolean;
  /** "Activate only once each turn" / "no more than twice each turn". */
  maxPerTurn?: number;
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
/** "As long as …" conditions for static abilities (same vocabulary as effect conditions). */
export type StaticCondition = Cond;

export interface StaticAbility extends LevelGate {
  kind: 'static';
  /** Which battlefield objects it applies to (relative to its controller). */
  filter: FilterSpec;
  /** Applies only to the source itself ("~ gets +1/+1 for each…"). */
  selfOnly?: boolean;
  /** Applies to the attached host ("enchanted creature gets +1/+1 as long as…"). */
  hostOnly?: boolean;
  /** Only while the condition holds. */
  condition?: Cond;
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
    | 'bestow' | 'emerge' | 'mayhem' | 'retrace' | 'freerunning' | 'overload' | 'sneak'
    /** Miracle: castable for this cost the moment it's the first card drawn this turn. */
    | 'miracle'
    /** Prototype: cast for a smaller cost as a smaller creature. */
    | 'prototype';
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
  /** Spree: extra mana cost of choosing this mode. */
  cost?: string;
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
  /** Additional cost paid at cast time (Fling's sacrifice; discard / pay life / exile from graveyard). */
  additionalCost?: { sacrifice?: FilterSpec; count?: number; discard?: number; payLife?: number; exileFromGraveyard?: { filter: FilterSpec; count: number } };
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
  /** Dredge N: from the graveyard, replace your next draw by milling N and returning this. */
  dredge?: number;
  /** Replicate {cost}: pay any number of times when casting; one copy per payment. */
  replicate?: string;
  /** Cipher: may be exiled encoded on a creature after resolving; copies cast on combat damage. */
  cipher?: boolean;
  /** Haunt: exiled haunting a creature (creature: when it dies; spell: after resolving). */
  haunt?: boolean;
  /** Hideaway N. */
  hideaway?: number;
  // ---- Leva 4
  /** "X spells you cast cost {N} less" / "~ costs {1} less for each Y" / "spells your opponents cast cost more". */
  costModifiers?: {
    amount: number;
    /** Which cards it applies to (card filter); undefined = all spells. */
    filter?: FilterSpec;
    whose: 'you' | 'opponent' | 'any';
    /** Applies to this card only ("~ costs {1} less to cast for each…"). */
    self?: boolean;
    /** Scale by battlefield objects / graveyard cards matching the filter. */
    per?: FilterSpec;
    perGraveyard?: FilterSpec;
    /** "Spells your opponents cast that target ~ cost {N} more". */
    targetsSelf?: boolean;
  }[];
  /** "If ~ would die, exile it instead." */
  exileInsteadOfDying?: boolean;
  /** "If a creature (an opponent controls) would die, exile it instead." */
  exileDyingCreatures?: 'all' | 'opponents';
  /** "Prevent all damage that would be dealt to ~." */
  preventAllDamageToSelf?: boolean;
  /** "If you would gain life, you gain that much plus N / twice that much instead." */
  lifeGainModifier?: { plus?: number; times?: number };
  /** "If one or more tokens would be created under your control, twice that many are created instead." */
  tokenDoubling?: boolean;
  /** "~ can't attack unless defending player controls an Island." */
  attackRequiresDefenderSubtype?: string;
  /** "~ must be blocked if able." / "All creatures able to block ~ do so." */
  mustBeBlocked?: boolean;
  /** "Skip your draw step." */
  skipDraw?: boolean;
  /** "~ can't be blocked by artifact creatures / Walls / creatures with power N or less". */
  cantBeBlockedBy?: { types?: CardType[]; subtypes?: string[]; colors?: Color[] };
  /** "Creatures with power less than ~'s power can't block it." */
  evasionPowerLessThanSelf?: boolean;
  /** Prototype {cost} — N/N: may be cast smaller. */
  prototype?: { cost: string; power: number; toughness: number };
  /** Modal spells: how many modes may be chosen ("choose one or both", "choose two"). Default exactly one. */
  spellModeChoice?: { min: number; max: number };
  /** "You may exert ~ as it attacks." */
  canExert?: boolean;
  /** Clone: "You may have ~ enter as a copy of any creature on the battlefield." */
  copyOnEnter?: boolean;
  // ---- Leva 5
  /** "~ enters tapped unless <cond>" / "If <cond>, ~ enters tapped". */
  entersTappedUnlessCond?: Cond;
  entersTappedIf?: Cond;
  /** "You may have ~ assign its combat damage as though it weren't blocked." */
  assignAsUnblocked?: boolean;
  /** "You may play lands from your graveyard." */
  playLandsFromGraveyard?: boolean;
  /** "You may cast <filter> spells from the top of your library." */
  castFromLibraryTop?: FilterSpec;
  /** "If damage would be dealt to ~, prevent that damage. Remove a +1/+1 counter from ~." */
  preventDamageRemoveCounter?: string;
  /** "~ can't attack alone." / "~ can't attack or block alone." */
  cantAttackAlone?: boolean;
  /** "If ~ would be destroyed, regenerate it." */
  autoRegenerate?: boolean;
  /** "If ~ would be put into a graveyard from anywhere, shuffle it into its owner's library instead." */
  shuffleInsteadOfGraveyard?: boolean;
  /** "Creatures your opponents control enter tapped." */
  opponentsCreaturesEnterTapped?: boolean;
  /** "Prevent all damage that would be dealt by ~" (also on auras: by enchanted creature). */
  preventsOwnDamage?: boolean;
  /** "Each player can't cast more than one spell each turn." */
  oneSpellPerTurn?: boolean;
  /** Cycling trigger ("When you cycle this card, X"). */
  cyclingTrigger?: EffectScript;
  /** "Raid — ~ enters with a +1/+1 counter if you attacked this turn" (counters conditioned). */
  entersWithCountersIf?: Cond;
  /** "~ enters with a +1/+1 counter on it for each time it was kicked" handled by kicker.entersWithCounters × times. */
  /** Reinforce N—{cost}: from hand, discard to put N +1/+1 counters on target creature (compiled as a hand ability). */
  /** "You may cast ~ as though it had flash." → keyword flash. */
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
  enchant?: { what: 'creature' | 'land' | 'artifact' | 'enchantment' | 'permanent'; controlledBy?: 'you' | 'opponent'; /** "Enchant artifact or creature". */ typeAnyOf?: CardType[] };
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
    /** "Enchanted creature has ward {N}". */
    ward?: number;
    /** "Enchanted creature gets +1/+1 for each X" (dynamic). */
    powerPer?: FilterSpec;
    toughnessPer?: FilterSpec;
    /** "Prevent all damage that would be dealt by enchanted creature." */
    preventsDamage?: boolean;
    /** "Enchanted creature is goaded." */
    goaded?: boolean;
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
  if (filter.cmcEquals !== undefined || filter.cmcAtMost !== undefined || filter.cmcAtLeast !== undefined) {
    let mv = 0;
    for (const m of (card.manaCost ?? '').matchAll(/\{([^}]+)\}/g)) mv += /^\d+$/.test(m[1]) ? parseInt(m[1], 10) : m[1] === 'X' ? 0 : 1;
    if (filter.cmcEquals !== undefined && mv !== filter.cmcEquals) return false;
    if (filter.cmcAtMost !== undefined && mv > filter.cmcAtMost) return false;
    if (filter.cmcAtLeast !== undefined && mv < filter.cmcAtLeast) return false;
  }
  if (filter.notColor && card.colors.includes(filter.notColor)) return false;
  if (filter.notSubtype && card.subtypes.includes(filter.notSubtype)) return false;
  if (filter.legendary && !card.supertypes?.includes('Legendary')) return false;
  if (filter.multicolored && card.colors.length < 2) return false;
  if (filter.powerAtLeast !== undefined && (card.power ?? 0) < filter.powerAtLeast) return false;
  if (filter.powerAtMost !== undefined && (card.power ?? 0) > filter.powerAtMost) return false;
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
