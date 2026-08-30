/** M6: roll inicial 1-100 com escolha, e undo de virada para mana. */
import { describe, expect, it } from 'vitest';
import { forest, grizzlyBears, mountain } from '../src/cards/demo-set.js';
import { Game } from '../src/game.js';
import type { CardDefinition } from '../src/cards/types.js';
import { findIn, goToMain1, makeGame } from './helpers.js';

function copies(card: CardDefinition, n: number): CardDefinition[] {
  return Array.from({ length: n }, () => card);
}

const DECK = [...copies(mountain, 12), ...copies(grizzlyBears, 8)];

function newGame(opts?: { starterChooser?: 'p1' | 'p2' }) {
  return new Game(
    [
      { id: 'p1', name: 'Alice', deck: { cards: DECK } },
      { id: 'p2', name: 'Bob', deck: { cards: DECK } },
    ],
    123,
    opts,
  );
}

describe('M6 · roll inicial e escolha de quem começa', () => {
  it('rola 1-100 sem empate, o vencedor escolhe, e só então vem o mulligan', () => {
    const game = newGame();
    const events = game.start();
    const starter = game.state.starter!;
    expect(starter).not.toBeNull();
    expect(starter.rolls.p1).toBeGreaterThanOrEqual(1);
    expect(starter.rolls.p1).toBeLessThanOrEqual(100);
    expect(starter.rolls.p1).not.toBe(starter.rolls.p2);
    expect(starter.winner).toBe(starter.rolls.p1 > starter.rolls.p2 ? 'p1' : 'p2');
    expect(events.some((e) => e.type === 'startingRoll')).toBe(true);
    expect(game.state.mulligan).toBeNull(); // mulligan ainda não começou

    const loser = starter.winner === 'p1' ? 'p2' : 'p1';
    // perdedor não escolhe; e nada de jogar antes da escolha
    expect(game.apply(loser, { type: 'chooseStarter', first: loser }).ok).toBe(false);
    expect(game.apply(starter.winner, { type: 'keepHand', bottom: [] }).ok).toBe(false);

    // vencedor manda o OPONENTE começar
    expect(game.apply(starter.winner, { type: 'chooseStarter', first: loser }).ok).toBe(true);
    expect(game.state.onThePlay).toBe(loser);
    expect(game.state.mulligan).not.toBeNull();
  });

  it('starterChooser (jogos 2+): sem roll, o perdedor anterior decide', () => {
    const game = newGame({ starterChooser: 'p2' });
    game.start();
    const starter = game.state.starter!;
    expect(starter.rolls.p1).toBe(0); // sem roll
    expect(starter.winner).toBe('p2');
    expect(game.apply('p2', { type: 'chooseStarter', first: 'p2' }).ok).toBe(true);
    expect(game.state.onThePlay).toBe('p2');
  });

  it('rolls são determinísticos por seed (replay)', () => {
    const a = newGame();
    const b = newGame();
    a.start();
    b.start();
    expect(a.state.starter!.rolls).toEqual(b.state.starter!.rolls);
  });
});

describe('M6 · desfazer virada de mana', () => {
  it('vira para mana, desfaz (desvirado, pool limpo); depois de gastar, não desfaz', () => {
    const game = makeGame([...copies(forest, 12), ...copies(grizzlyBears, 8)], DECK, {
      topP1: ['forest', 'forest', 'grizzly-bears'],
    });
    goToMain1(game);
    game.apply('p1', { type: 'playLand', objectId: findIn(game, 'p1', 'hand', 'forest') });
    const land = game.state.players.p1.zones.battlefield[0];

    // vira para mana
    expect(game.apply('p1', { type: 'activateAbility', objectId: land, abilityIndex: 0 }).ok).toBe(true);
    expect(game.state.objects[land].tapped).toBe(true);
    expect(game.state.players.p1.manaPool.G).toBe(1);

    // desfaz
    expect(game.apply('p1', { type: 'undoTap', objectId: land }).ok).toBe(true);
    expect(game.state.objects[land].tapped).toBe(false);
    expect(game.state.players.p1.manaPool.G).toBe(0);

    // vira de novo e gasta a mana num cast: undo deve falhar
    goToMain1(game);
    passToTurn3(game);
    game.apply('p1', { type: 'playLand', objectId: findIn(game, 'p1', 'hand', 'forest') });
    const lands = game.state.players.p1.zones.battlefield;
    game.apply('p1', { type: 'activateAbility', objectId: lands[0], abilityIndex: 0 });
    game.apply('p1', { type: 'activateAbility', objectId: lands[1], abilityIndex: 0 });
    const bear = findIn(game, 'p1', 'hand', 'grizzly-bears');
    expect(game.apply('p1', { type: 'castSpell', objectId: bear }).ok).toBe(true);
    expect(game.apply('p1', { type: 'undoTap', objectId: lands[0] }).ok).toBe(false);
  });

  it('passar prioridade também trava o undo', () => {
    const game = makeGame([...copies(forest, 12), ...copies(grizzlyBears, 8)], DECK, {
      topP1: ['forest'],
    });
    goToMain1(game);
    game.apply('p1', { type: 'playLand', objectId: findIn(game, 'p1', 'hand', 'forest') });
    const land = game.state.players.p1.zones.battlefield[0];
    game.apply('p1', { type: 'activateAbility', objectId: land, abilityIndex: 0 });
    game.apply('p1', { type: 'passPriority' });
    expect(game.apply('p1', { type: 'undoTap', objectId: land }).ok).toBe(false);
  });
});

import { passUntil } from './helpers.js';
function passToTurn3(game: Game): void {
  passUntil(game, (s) => s.turn === 3 && s.step === 'main1' && s.priority === 'p1');
}
