/**
 * GameEvents are the only output of the engine and the only thing clients
 * render. Every state mutation emits one. The match log is this stream.
 *
 * Events that reveal hidden information carry `hiddenFrom`: the server
 * redacts `cardName`/`cardId` before sending to that player.
 */
import type { PlayerId, Step, TargetChoice, ZoneName, ManaSymbol } from './types.js';

export type GameEvent =
  | { type: 'gameStarted'; players: { id: PlayerId; name: string }[]; seed: number; onThePlay: PlayerId }
  | { type: 'turnBegan'; turn: number; activePlayer: PlayerId }
  | { type: 'stepChanged'; step: Step }
  | { type: 'cardDrawn'; player: PlayerId; objectId: number; cardName: string | null; hiddenFrom?: PlayerId }
  | {
      type: 'zoneChanged';
      objectId: number;
      cardName: string | null;
      from: ZoneName;
      to: ZoneName;
      player: PlayerId;
      reason?: 'destroyed' | 'sacrificed' | 'discarded' | 'milled' | 'exiled' | 'returned' | 'resolved' | 'searched' | 'manual';
      hiddenFrom?: PlayerId;
    }
  | { type: 'landPlayed'; player: PlayerId; objectId: number; cardName: string }
  | { type: 'spellCast'; player: PlayerId; objectId: number; cardName: string; targets: TargetChoice[] }
  | { type: 'abilityActivated'; player: PlayerId; sourceId: number; sourceName: string; text: string; targets: TargetChoice[] }
  | { type: 'abilityTriggered'; player: PlayerId; sourceId: number; sourceName: string; text: string }
  | { type: 'stackResolved'; description: string }
  | { type: 'spellCountered'; objectId: number; cardName: string }
  | { type: 'fizzled'; description: string }
  | { type: 'tappedChanged'; objectId: number; cardName: string; tapped: boolean }
  | { type: 'manaAdded'; player: PlayerId; mana: ManaSymbol[]; sourceName: string }
  | { type: 'manaPoolEmptied'; player: PlayerId }
  | { type: 'lifeChanged'; player: PlayerId; delta: number; total: number; reason: string }
  | { type: 'damageDealt'; sourceName: string; target: TargetChoice; targetName: string; amount: number; sourceId?: number; combat?: boolean }
  | { type: 'pumped'; objectId: number; cardName: string; power: number; toughness: number }
  | { type: 'countersChanged'; objectId: number; cardName: string; counter: string; delta: number; total: number }
  | { type: 'tokenCreated'; player: PlayerId; objectId: number; name: string }
  | { type: 'attached'; sourceId: number; sourceName: string; hostId: number; hostName: string }
  | { type: 'scried'; player: PlayerId; looked: number; bottomed: number }
  | { type: 'copiesCreated'; cardName: string; count: number; reason: 'storm' | 'copy' }
  | { type: 'damagePrevented'; sourceName: string; targetName: string; amount: number }
  | { type: 'regenerated'; objectId: number; cardName: string }
  | { type: 'cycled'; player: PlayerId; cardName: string }
  | { type: 'controlChanged'; objectId: number; cardName: string; to: PlayerId }
  | { type: 'searched'; player: PlayerId; found: string[]; to: 'hand' | 'battlefield' | 'libraryTop' | 'exile' }
  | { type: 'mulliganTaken'; player: PlayerId; taken: number }
  | { type: 'handKept'; player: PlayerId; bottomed: number }
  | { type: 'startingRoll'; rolls: Record<PlayerId, number>; rerolls: number; winner: PlayerId }
  | { type: 'starterChosen'; first: PlayerId; by: PlayerId }
  | { type: 'tapUndone'; objectId: number; cardName: string; player: PlayerId }
  | { type: 'attackersDeclared'; player: PlayerId; attackers: { objectId: number; cardName: string }[] }
  /** Fired after an attacker deals combat damage to a player (trigger hook). */
  | { type: 'combatDamageToPlayer'; attackerId: number; player: PlayerId; amount: number }
  | { type: 'blockersDeclared'; player: PlayerId; blocks: { blocker: number; blockerName: string; attacker: number; attackerName: string }[] }
  | { type: 'discarded'; player: PlayerId; objectId: number; cardName: string }
  /** A hand is revealed to everyone (Cabal Therapy naming). */
  | { type: 'handRevealed'; player: PlayerId; cards: string[] }
  | { type: 'cardNamed'; player: PlayerId; name: string }
  | { type: 'poisonChanged'; player: PlayerId; delta: number; total: number }
  | { type: 'crewed'; objectId: number; cardName: string; player: PlayerId }
  | { type: 'modeChosen'; player: PlayerId; cardName: string; mode: string }
  | { type: 'valueChosen'; player: PlayerId; cardName: string; value: string }
  | { type: 'turnedFaceUp'; objectId: number; cardName: string; player: PlayerId }
  /** Leva 5b: a double-faced permanent changed face (`back` = now showing its back face). */
  | { type: 'transformed'; objectId: number; cardName: string; back: boolean }
  | { type: 'dayNightChanged'; value: 'day' | 'night' }
  | { type: 'cascaded'; player: PlayerId; cardName: string; hit: string | null }
  | { type: 'energyChanged'; player: PlayerId; delta: number; total: number }
  | { type: 'explored'; player: PlayerId; cardName: string; revealed: string; toHand: boolean }
  | { type: 'exploited'; objectId: number; cardName: string; sacrificed: string }
  /** Saga: lore counters reached `total` (chapter abilities trigger from this). */
  | { type: 'loreAdded'; objectId: number; cardName: string; total: number }
  | { type: 'miracleRevealed'; player: PlayerId; objectId: number; cardName: string; cost: string }
  | { type: 'dredged'; player: PlayerId; cardName: string; milled: number }
  | { type: 'monarchChanged'; player: PlayerId }
  | { type: 'initiativeChanged'; player: PlayerId }
  /** Internal hook: an effect asked its controller to venture (the engine picks dungeon/room). */
  | { type: 'ventureRequested'; player: PlayerId; sourceId: number; dungeon?: string }
  | { type: 'ventured'; player: PlayerId; dungeon: string; room: string; completed: boolean; note?: string }
  | { type: 'hauntExiled'; cardName: string; hauntedName: string }
  | { type: 'encoded'; cardName: string; creatureName: string }
  | { type: 'hideawayExiled'; player: PlayerId; sourceName: string }
  /** An object became the target of a spell or ability (trigger hook). */
  | { type: 'targeted'; objectId: number; by: PlayerId }
  | { type: 'shuffled'; player: PlayerId }
  | { type: 'priorityChanged'; player: PlayerId | null }
  | { type: 'decisionRequired'; player: PlayerId; decision: string }
  | { type: 'gameEnded'; winner: PlayerId | 'draw'; reason: string }
  | { type: 'manualAction'; player: PlayerId; text: string }
  | { type: 'chat'; player: PlayerId; text: string }
  | { type: 'error'; player: PlayerId; message: string };

/** Redact hidden information from an event before sending it to `viewer`. */
export function redactEvent(ev: GameEvent, viewer: PlayerId): GameEvent {
  if ('hiddenFrom' in ev && ev.hiddenFrom === viewer) {
    if (ev.type === 'cardDrawn') return { ...ev, cardName: null };
    if (ev.type === 'zoneChanged') return { ...ev, cardName: null };
  }
  return ev;
}
