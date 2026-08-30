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
  | { type: 'playLand'; objectId: number }
  | {
      type: 'castSpell';
      objectId: number;
      targets?: TargetChoice[];
      x?: number;
      mode?: number;
      sacrifices?: number[];
      /** Pay the optional kicker cost. */
      kicked?: boolean;
    }
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
    }
  | {
      type: 'declareAttackers';
      attackers: number[];
      /** Planeswalker (of the defender) these attackers attack instead of the player. */
      defendTarget?: number;
    }
  | { type: 'declareBlockers'; blocks: { blocker: number; attacker: number }[] }
  | { type: 'chooseDiscard'; objectIds: number[] }
  /** Answer to a pending effectChoice (discard/sacrifice/scry/search…). */
  | { type: 'effectChoice'; picks: number[] }
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
