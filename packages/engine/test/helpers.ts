import { Game } from '../src/game.js';
import type { CardDefinition } from '../src/cards/types.js';
import type { PlayerId } from '../src/types.js';
import type { GameState } from '../src/state.js';

export function makeGame(
  p1Cards: CardDefinition[],
  p2Cards: CardDefinition[],
  opts: { topP1?: string[]; topP2?: string[] } = {},
): Game {
  const game = new Game(
    [
      { id: 'p1', name: 'Alice', deck: { cards: p1Cards } },
      { id: 'p2', name: 'Bob', deck: { cards: p2Cards } },
    ],
    42,
    { firstPlayer: 'p1' },
  );
  if (opts.topP1) stackTop(game, 'p1', opts.topP1);
  if (opts.topP2) stackTop(game, 'p2', opts.topP2);
  game.start();
  return game;
}

/** Reorder a (shuffled) library so the given card ids are on top, in order. */
export function stackTop(game: Game, player: PlayerId, cardIds: string[]): void {
  const lib = game.state.players[player].zones.library;
  const pool = [...lib];
  const ordered: number[] = [];
  for (const cardId of cardIds) {
    const idx = pool.findIndex((oid) => game.state.objects[oid].card.id === cardId);
    if (idx < 0) throw new Error(`carta não está na biblioteca: ${cardId}`);
    ordered.push(pool[idx]);
    pool.splice(idx, 1);
  }
  game.state.players[player].zones.library = [...ordered, ...pool];
}

/** Whoever holds priority passes, until `pred` is true (or a decision blocks). */
export function passUntil(game: Game, pred: (s: GameState) => boolean, max = 100): void {
  while (!pred(game.state)) {
    if (--max < 0) throw new Error(`passUntil travou em ${game.state.step} (turno ${game.state.turn})`);
    const pending = game.state.pendingDecision;
    if (pending?.type === 'discardToHandSize') {
      const hand = game.state.players[pending.player].zones.hand;
      game.apply(pending.player, { type: 'chooseDiscard', objectIds: hand.slice(0, pending.count) });
      continue;
    }
    const p = game.state.priority;
    if (!p) throw new Error(`ninguém tem prioridade em ${game.state.step}`);
    const r = game.apply(p, { type: 'passPriority' });
    if (!r.ok) throw new Error('passe de prioridade falhou');
  }
}

/** Find an object id in a zone by card id. */
export function findIn(game: Game, player: PlayerId, zone: 'hand' | 'battlefield' | 'graveyard' | 'library' | 'exile', cardId: string): number {
  const id = game.state.players[player].zones[zone].find(
    (oid) => game.state.objects[oid].card.id === cardId,
  );
  if (id === undefined) throw new Error(`${cardId} não está em ${zone} de ${player}`);
  return id;
}

export function goToMain1(game: Game): void {
  passUntil(game, (s) => s.step === 'main1' && s.priority === s.activePlayer && s.stack.length === 0);
}
