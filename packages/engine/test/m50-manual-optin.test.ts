/** M50: controles manuais (Tier 3) desligados por padrão em partida real — pedido, recusa e aceite. */
import { describe, expect, it } from 'vitest';
import { forest, mountain } from '../src/cards/demo-set.js';
import type { CardDefinition } from '../src/cards/types.js';
import { Game } from '../src/game.js';
import { viewFor } from '../src/view.js';
import { findIn, goToMain1, makeGame } from './helpers.js';

const copies = (card: CardDefinition, n: number) => Array.from({ length: n }, () => card);
const FILLER = [...copies(mountain, 30), ...copies(forest, 30)];

const realGame = () => {
  const game = new Game([{ id: 'p1', name: 'Alice', deck: { cards: FILLER } }, { id: 'p2', name: 'Bob', deck: { cards: FILLER } }], 42, { firstPlayer: 'p1', manualToolsOptIn: true });
  game.start();
  game.apply('p1', { type: 'keepHand', bottom: [] });
  game.apply('p2', { type: 'keepHand', bottom: [] });
  goToMain1(game);
  return game;
};

describe('M50 · controles manuais por consentimento', () => {
  it('em partida real começam desligados: ação manual recusada; a visão diz enabled=false', () => {
    const game = realGame();
    const id = findIn(game, 'p1', 'hand', 'mountain');
    expect(game.apply('p1', { type: 'manualMove', objectId: id, to: 'battlefield' }).ok).toBe(false);
    expect(game.apply('p1', { type: 'manualDraw', count: 1 }).ok).toBe(false);
    expect(viewFor(game.state, 'p1').manualTools).toEqual({ enabled: false });
  });

  it('pedido + recusa: continua desligado; pedido + aceite: liga para os dois', () => {
    const game = realGame();
    expect(game.apply('p1', { type: 'requestManual' }).ok).toBe(true);
    expect(viewFor(game.state, 'p2').manualTools).toEqual({ enabled: false, requestedBy: 'p1' });
    expect(game.apply('p1', { type: 'answerManual', accept: true }).ok).toBe(false); // quem pediu não responde
    const r = game.apply('p2', { type: 'answerManual', accept: false });
    expect(r.ok).toBe(true);
    expect(r.events.some((e) => e.type === 'manualAnswered' && !e.accept)).toBe(true);
    expect(viewFor(game.state, 'p1').manualTools).toEqual({ enabled: false });
    expect(game.apply('p1', { type: 'manualDraw', count: 1 }).ok).toBe(false);

    expect(game.apply('p2', { type: 'requestManual' }).ok).toBe(true);
    expect(game.apply('p1', { type: 'answerManual', accept: true }).ok).toBe(true);
    expect(viewFor(game.state, 'p2').manualTools).toEqual({ enabled: true });
    expect(game.apply('p1', { type: 'manualDraw', count: 1 }).ok).toBe(true);
    expect(game.apply('p2', { type: 'manualDraw', count: 1 }).ok).toBe(true);
    expect(game.apply('p2', { type: 'requestManual' }).ok).toBe(false); // já ativos
  });

  it('sem a opção (testes/simulador) as ações manuais seguem livres', () => {
    const game = makeGame(FILLER, FILLER);
    goToMain1(game);
    expect(game.apply('p1', { type: 'manualDraw', count: 1 }).ok).toBe(true);
    expect(viewFor(game.state, 'p1').manualTools).toEqual({ enabled: true });
  });
});
