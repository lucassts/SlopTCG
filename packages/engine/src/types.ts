/** Core identifiers and enums shared across the engine. */

export type PlayerId = 'p1' | 'p2';

export const PLAYER_IDS: PlayerId[] = ['p1', 'p2'];

export function opponentOf(p: PlayerId): PlayerId {
  return p === 'p1' ? 'p2' : 'p1';
}

export type Color = 'W' | 'U' | 'B' | 'R' | 'G';
/** Mana symbols: colors plus colorless. Generic cost is tracked separately. */
export type ManaSymbol = Color | 'C';

export type ZoneName =
  | 'library'
  | 'hand'
  | 'battlefield'
  | 'graveyard'
  | 'exile'
  | 'stack';

export type CardType =
  | 'Land'
  | 'Creature'
  | 'Artifact'
  | 'Enchantment'
  | 'Instant'
  | 'Sorcery'
  | 'Planeswalker'
  | 'Battle';

/** Turn steps, in order. Phases are derivable from the step. */
export type Step =
  | 'untap'
  | 'upkeep'
  | 'draw'
  | 'main1'
  | 'combatBegin'
  | 'declareAttackers'
  | 'declareBlockers'
  | 'combatDamage'
  | 'combatEnd'
  | 'main2'
  | 'end'
  | 'cleanup';

export const STEP_ORDER: Step[] = [
  'untap',
  'upkeep',
  'draw',
  'main1',
  'combatBegin',
  'declareAttackers',
  'declareBlockers',
  'combatDamage',
  'combatEnd',
  'main2',
  'end',
  'cleanup',
];

/** Steps where no player receives priority (turn-based actions only). */
export const NO_PRIORITY_STEPS: Step[] = ['untap', 'cleanup'];

export type Keyword =
  | 'flying'
  | 'reach'
  | 'haste'
  | 'vigilance'
  | 'trample'
  | 'lifelink'
  | 'deathtouch'
  | 'defender'
  | 'menace';

/** A chosen target, stored on stack items and validated on resolution. */
export type TargetChoice =
  | { kind: 'object'; id: number }
  | { kind: 'player'; player: PlayerId };

export type ManaPool = Record<ManaSymbol, number>;

export function emptyManaPool(): ManaPool {
  return { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
}

export function poolTotal(pool: ManaPool): number {
  return pool.W + pool.U + pool.B + pool.R + pool.G + pool.C;
}
