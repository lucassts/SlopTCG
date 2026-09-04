/** M29: mana manual — a mágica/habilidade espera o jogador gerar a mana; nada é virado automaticamente. */
import { describe, expect, it } from 'vitest';
import { forest, grizzlyBears, island, lightningBolt, mountain, plains, swamp } from '../src/cards/demo-set.js';
import type { CardDefinition } from '../src/cards/types.js';
import { Game } from '../src/game.js';
import type { PlayerId } from '../src/types.js';
import { findIn, passUntil } from './helpers.js';

const copies = (card: CardDefinition, n: number) => Array.from({ length: n }, () => card);
const FILLER = [...copies(mountain, 6), ...copies(forest, 6), ...copies(island, 6), ...copies(plains, 6), ...copies(swamp, 4)];

function manualGame(p1Deck: CardDefinition[], topP1: string[]): Game {
  const game = new Game(
    [
      { id: 'p1', name: 'Alice', deck: { cards: p1Deck } },
      { id: 'p2', name: 'Bob', deck: { cards: FILLER } },
    ],
    7,
    { firstPlayer: 'p1', manualMana: true },
  );
  const lib = game.state.players.p1.zones.library;
  const pool = [...lib];
  const ordered: number[] = [];
  for (const cardId of topP1) {
    const idx = pool.findIndex((oid) => game.state.objects[oid].card.id === cardId);
    ordered.push(pool[idx]);
    pool.splice(idx, 1);
  }
  game.state.players.p1.zones.library = [...ordered, ...pool];
  game.start();
  game.apply('p1', { type: 'keepHand', bottom: [] });
  game.apply('p2', { type: 'keepHand', bottom: [] });
  passUntil(game, (s) => s.step === 'main1' && s.priority === 'p1' && s.stack.length === 0);
  return game;
}
function put(game: Game, player: PlayerId, cardId: string): number {
  let id: number;
  try { id = findIn(game, player, 'library', cardId); } catch { id = findIn(game, player, 'hand', cardId); }
  game.apply(player, { type: 'manualMove', objectId: id, to: 'battlefield' });
  return id;
}

describe('M29 · mana manual', () => {
  it('conjurar sem mana flutuando fica esperando; virar terrenos completa a conjuração', () => {
    const game = manualGame([...FILLER, grizzlyBears], ['grizzly-bears']);
    const f1 = put(game, 'p1', 'forest');
    const f2 = put(game, 'p1', 'forest');
    const bears = findIn(game, 'p1', 'hand', 'grizzly-bears');
    const r = game.apply('p1', { type: 'castSpell', objectId: bears });
    expect(r.ok).toBe(true);
    expect(game.state.pendingDecision).toMatchObject({ type: 'payMana', player: 'p1', cardName: 'Grizzly Bears', cost: '{1}{G}' });
    expect(game.state.objects[bears].zone).toBe('hand');
    expect(game.state.objects[f1].tapped).toBe(false); // nada virado sozinho
    expect(game.apply('p1', { type: 'passPriority' }).ok).toBe(false); // não passa enquanto paga
    expect(game.apply('p1', { type: 'activateAbility', objectId: f1, abilityIndex: 0 }).ok).toBe(true);
    expect(game.state.pendingDecision?.type).toBe('payMana'); // ainda falta {1}
    expect(game.state.players.p1.manaPool.G).toBe(1);
    expect(game.apply('p1', { type: 'activateAbility', objectId: f2, abilityIndex: 0 }).ok).toBe(true);
    expect(game.state.pendingDecision).toBeNull();
    expect(game.state.objects[bears].zone).toBe('stack');
    expect(game.state.players.p1.manaPool.G).toBe(0);
    passUntil(game, (s) => s.stack.length === 0 && s.pendingDecision === null);
    expect(game.state.objects[bears].zone).toBe('battlefield');
  });

  it('com mana já flutuando, a conjuração é imediata', () => {
    const game = manualGame([...FILLER, lightningBolt], ['lightning-bolt']);
    const m = put(game, 'p1', 'mountain');
    expect(game.apply('p1', { type: 'activateAbility', objectId: m, abilityIndex: 0 }).ok).toBe(true);
    const bolt = findIn(game, 'p1', 'hand', 'lightning-bolt');
    expect(game.apply('p1', { type: 'castSpell', objectId: bolt, targets: [{ kind: 'player', player: 'p2' }] }).ok).toBe(true);
    expect(game.state.pendingDecision).toBeNull();
    expect(game.state.objects[bolt].zone).toBe('stack');
    passUntil(game, (s) => s.stack.length === 0 && s.pendingDecision === null);
    expect(game.state.players.p2.life).toBe(17);
  });

  it('cancelar o pagamento devolve o controle e deixa a mana flutuando', () => {
    const game = manualGame([...FILLER, grizzlyBears], ['grizzly-bears']);
    const f1 = put(game, 'p1', 'forest'); put(game, 'p1', 'forest');
    const bears = findIn(game, 'p1', 'hand', 'grizzly-bears');
    game.apply('p1', { type: 'castSpell', objectId: bears });
    game.apply('p1', { type: 'activateAbility', objectId: f1, abilityIndex: 0 });
    expect(game.apply('p1', { type: 'cancelPayment' }).ok).toBe(true);
    expect(game.state.pendingDecision).toBeNull();
    expect(game.state.objects[bears].zone).toBe('hand');
    expect(game.state.players.p1.manaPool.G).toBe(1);
    expect(game.apply('p1', { type: 'passPriority' }).ok).toBe(true);
  });

  it('habilidade ativada com custo de mana também espera o pagamento', () => {
    const game = manualGame([...FILLER, grizzlyBears], []);
    const bears = put(game, 'p1', 'grizzly-bears');
    void bears;
    const pump = { ...grizzlyBears, id: 'pumper', name: 'Pumper', abilities: [{ kind: 'activated' as const, cost: { mana: '{G}' }, effect: [{ op: 'gainLife' as const, who: 'controller' as const, amount: 1 }], text: 'ganhe 1 de vida' }] };
    const g2 = manualGame([...FILLER, pump], []);
    const p = put(g2, 'p1', 'pumper');
    const f = put(g2, 'p1', 'forest');
    expect(g2.apply('p1', { type: 'activateAbility', objectId: p, abilityIndex: 0 }).ok).toBe(true);
    expect(g2.state.pendingDecision?.type).toBe('payMana');
    expect(g2.apply('p1', { type: 'activateAbility', objectId: f, abilityIndex: 0 }).ok).toBe(true);
    expect(g2.state.pendingDecision).toBeNull();
    passUntil(g2, (s) => s.stack.length === 0 && s.pendingDecision === null);
    expect(g2.state.players.p1.life).toBe(21);
  });
});
