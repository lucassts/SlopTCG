/**
 * PlayerActions are intents sent by clients. The engine validates every one;
 * invalid actions produce an 'error' event and change nothing.
 *
 * The `manual*` family implements automation Tier 3: any card is playable
 * Cockatrice-style even before its mechanics are implemented. Manual actions
 * are always legal (the opponent can see the log and object) — the engine's
 * job there is bookkeeping and total transparency, not enforcement.
 */
import type { PlayerId, TargetChoice, ZoneName } from './types.js';

export type PlayerAction =
  | { type: 'passPriority' }
  /** Winner of the starting roll (or previous game's loser) picks who plays first. */
  | { type: 'chooseStarter'; first: PlayerId }
  /** Undo a mana tap whose mana wasn't spent yet. */
  | { type: 'undoTap'; objectId: number }
  /** London mulligan: shuffle the hand back and draw 7 again. */
  | { type: 'mulligan' }
  /** Keep the hand, putting exactly `bottom` (= mulligans taken) on the bottom. */
  | { type: 'keepHand'; bottom: number[] }
  | { type: 'playLand'; objectId: number; /** MDFC: play the back face (a land). */ face?: 'back' }
  | {
      type: 'castSpell';
      objectId: number;
      targets?: TargetChoice[];
      x?: number;
      mode?: number;
      sacrifices?: number[];
      /** Pay the optional kicker cost. */
      kicked?: boolean;
      /** Pay the card's alternative cost (Force of Will) instead of mana. */
      useAltCost?: boolean;
      /** Hand cards exiled to pay the alternative cost. */
      altExile?: number[];
      /** Alternative casting method (evoke, dash, blitz, escape, foretold…, or 'suspend' to exile with time counters). */
      method?:
        | 'evoke' | 'dash' | 'blitz' | 'escape' | 'surge' | 'prowl' | 'spectacle' | 'foretold' | 'plotted' | 'warp' | 'suspend'
        | 'bestow' | 'emerge' | 'mayhem' | 'retrace' | 'freerunning' | 'overload' | 'sneak' | 'miracle' | 'prototype' | 'disturb';
      /** Escape: graveyard cards exiled as part of the cost. */
      escapeExile?: number[];
      /** Morph/Disguise: cast face down as a 2/2 for {3}. */
      faceDown?: boolean;
      /** Pay buyback. */
      buyback?: boolean;
      /** Multikicker: how many times the kicker is paid. */
      kickerTimes?: number;
      /** Entwine: pay the entwine cost and choose every mode. */
      entwine?: boolean;
      /** Retrace: the land card discarded from hand. */
      discards?: number[];
      /** Sneak: the unblocked attacker returned to hand. */
      attackerId?: number;
      /** Replicate: how many extra times the replicate cost is paid (one copy each). */
      replicateTimes?: number;
      /** Modal spells that allow several modes ("choose one or both", "choose two"). */
      modes?: number[];
      /** Leva 5b: cast the back face (MDFC spell, adventure, split half). */
      face?: 'back';
      /** Fuse: cast both halves of a split card. */
      fuse?: boolean;
      /** Casualty: creature sacrificed to copy the spell. */
      casualty?: number;
    }
  /** Morph: turn a face-down permanent face up by paying its morph cost. */
  | { type: 'turnFaceUp'; objectId: number }
  /** Ninjutsu: return an unblocked attacker to hand, put this card from hand attacking. */
  | { type: 'ninjutsu'; objectId: number; attackerId: number }
  /** Cycle a card from hand (pay its cycling cost, discard it, draw). */
  | { type: 'cycle'; objectId: number }
  /** Choose targets for a triggered ability waiting on the queue. */
  | { type: 'chooseTargets'; targets: TargetChoice[] }
  | {
      type: 'activateAbility';
      objectId: number;
      abilityIndex: number;
      targets?: TargetChoice[];
      /** Permanents sacrificed to pay the ability's sacrifice cost. */
      sacrifices?: number[];
      /** Chosen color for "add one mana of any color" abilities. */
      manaColor?: 'W' | 'U' | 'B' | 'R' | 'G' | 'C';
      /** Hand cards discarded to pay a "Discard a card:" cost. */
      discards?: number[];
      /** Station: the other untapped creature tapped as the cost. */
      tapCreature?: number;
    }
  /** Vehicles: tap these creatures (total power ≥ crew N) to animate the vehicle. */
  | { type: 'crew'; objectId: number; creatures: number[] }
  /** Answer a pending "choose one —" for a triggered ability. */
  | { type: 'chooseMode'; mode: number }
  | {
      type: 'declareAttackers';
      attackers: number[];
      /** Planeswalker (of the defender) these attackers attack instead of the player. */
      defendTarget?: number;
      /** Attackers exerted as they attack (won't untap next untap step). */
      exerted?: number[];
      /** Enlist: tap another creature to add its power to an attacker. */
      enlist?: { attacker: number; creature: number }[];
    }
  | { type: 'declareBlockers'; blocks: { blocker: number; attacker: number }[] }
  | { type: 'chooseDiscard'; objectIds: number[] }
  /** Answer to a pending effectChoice (discard/sacrifice/scry/search/nameCard…). */
  | { type: 'effectChoice'; picks: number[]; text?: string }
  | { type: 'concede' }
  | { type: 'chat'; text: string }
  // --- manual mode (Tier 3) ---
  | { type: 'manualMove'; objectId: number; to: Exclude<ZoneName, 'stack'>; position?: 'top' | 'bottom' }
  | { type: 'manualTap'; objectId: number; tapped: boolean }
  | { type: 'manualLife'; player: PlayerId; delta: number }
  | { type: 'manualCounter'; objectId: number; counter: string; delta: number }
  | { type: 'manualDraw'; count: number }
  | { type: 'manualShuffle' }
  | { type: 'manualToken'; name: string; power: number; toughness: number }
  | { type: 'manualUntapAll' };
