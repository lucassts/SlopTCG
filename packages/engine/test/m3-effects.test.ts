/** M3: storm, gatilhos com alvo, custos adicionais, proteções, controle e cópias. */
import { describe, expect, it } from 'vitest';
import {
  actOfTreason,
  darksteelMyr,
  dayOfJudgment,
  emptyTheWarrens,
  flametongueKavu,
  fling,
  fog,
  forest,
  gladecoverScout,
  grapeshot,
  grizzlyBears,
  island,
  lightningBolt,
  mountain,
  plains,
  ragingGoblin,
  ravenousChupacabra,
  swamp,
  battlegrowth,
  twincast,
} from '../src/cards/demo-set.js';
import { effectivePower } from '../src/state.js';
import type { Game } from '../src/game.js';
import type { CardDefinition } from '../src/cards/types.js';
import type { PlayerId } from '../src/types.js';
import { findIn, goToMain1, makeGame, passUntil } from './helpers.js';

function copies(card: CardDefinition, n: number): CardDefinition[] {
  return Array.from({ length: n }, () => card);
}

function put(game: Game, player: PlayerId, cardId: string, zone: 'battlefield' | 'graveyard' | 'hand' | 'library' = 'battlefield'): number {
  let id: number;
  try {
    id = findIn(game, player, 'library', cardId);
  } catch {
    id = findIn(game, player, 'hand', cardId);
  }
  const r = game.apply(player, { type: 'manualMove', objectId: id, to: zone });
  if (!r.ok) throw new Error(`setup falhou: ${cardId} → ${zone}`);
  return id;
}

const MANA = [...copies(mountain, 4), ...copies(forest, 4), ...copies(island, 4), ...copies(swamp, 4), ...copies(plains, 4)];

describe('M3 · storm', () => {
  it('Grapeshot copia uma vez por mágica conjurada antes no turno', () => {
    const game = makeGame(
      [...MANA, lightningBolt, lightningBolt, grapeshot],
      MANA,
      { topP1: ['lightning-bolt', 'lightning-bolt', 'grapeshot'] },
    );
    goToMain1(game);
    for (let i = 0; i < 4; i++) put(game, 'p1', 'mountain');

    for (let i = 0; i < 2; i++) {
      game.apply('p1', {
        type: 'castSpell',
        objectId: findIn(game, 'p1', 'hand', 'lightning-bolt'),
        targets: [{ kind: 'player', player: 'p2' }],
      });
      passUntil(game, (s) => s.stack.length === 0);
    }
    expect(game.state.players.p2.life).toBe(14);

    game.apply('p1', {
      type: 'castSpell',
      objectId: findIn(game, 'p1', 'hand', 'grapeshot'),
      targets: [{ kind: 'player', player: 'p2' }],
    });
    // pilha: original + 2 cópias
    expect(game.state.stack).toHaveLength(3);
    expect(game.state.stack.filter((s) => s.kind === 'copy')).toHaveLength(2);
    passUntil(game, (s) => s.stack.length === 0);
    expect(game.state.players.p2.life).toBe(11); // 3 × 1 de dano
  });

  it('Empty the Warrens: cópias também criam fichas', () => {
    const game = makeGame(
      [...MANA, lightningBolt, emptyTheWarrens],
      MANA,
      { topP1: ['lightning-bolt', 'empty-the-warrens'] },
    );
    goToMain1(game);
    for (let i = 0; i < 4; i++) put(game, 'p1', 'mountain');
    put(game, 'p1', 'forest'); // 5ª fonte para o genérico
    game.apply('p1', {
      type: 'castSpell',
      objectId: findIn(game, 'p1', 'hand', 'lightning-bolt'),
      targets: [{ kind: 'player', player: 'p2' }],
    });
    passUntil(game, (s) => s.stack.length === 0);
    game.apply('p1', { type: 'castSpell', objectId: findIn(game, 'p1', 'hand', 'empty-the-warrens') });
    passUntil(game, (s) => s.stack.length === 0);
    const goblins = game.state.players.p1.zones.battlefield
      .map((id) => game.state.objects[id])
      .filter((o) => o.card.name === 'Goblin');
    expect(goblins).toHaveLength(4); // 2 do original + 2 da cópia
  });
});

describe('M3 · gatilhos com alvo', () => {
  it('Flametongue Kavu pede alvo ao entrar e causa 4 de dano', () => {
    const game = makeGame(
      [...MANA, flametongueKavu],
      [...MANA, grizzlyBears],
      { topP1: ['flametongue-kavu'] },
    );
    goToMain1(game);
    const bear = put(game, 'p2', 'grizzly-bears');
    for (let i = 0; i < 4; i++) put(game, 'p1', 'mountain');
    const kavu = findIn(game, 'p1', 'hand', 'flametongue-kavu');
    game.apply('p1', { type: 'castSpell', objectId: kavu });
    passUntil(game, (s) => s.pendingDecision !== null, 100);

    const pending = game.state.pendingDecision!;
    expect(pending.type).toBe('chooseTargets');
    if (pending.type !== 'chooseTargets') throw new Error('unreachable');
    expect(pending.player).toBe('p1');
    // p2 não pode escolher pelos outros
    expect(game.apply('p2', { type: 'chooseTargets', targets: [{ kind: 'object', id: bear }] }).ok).toBe(false);
    expect(game.apply('p1', { type: 'chooseTargets', targets: [{ kind: 'object', id: bear }] }).ok).toBe(true);
    passUntil(game, (s) => s.stack.length === 0);
    expect(game.state.objects[bear].zone).toBe('graveyard');
    expect(game.state.objects[kavu].zone).toBe('battlefield');
  });

  it('Chupacabra sem criatura do oponente: gatilho é removido sem travar', () => {
    const game = makeGame([...MANA, ravenousChupacabra], MANA, { topP1: ['ravenous-chupacabra'] });
    goToMain1(game);
    for (let i = 0; i < 4; i++) put(game, 'p1', 'swamp');
    game.apply('p1', { type: 'castSpell', objectId: findIn(game, 'p1', 'hand', 'ravenous-chupacabra') });
    passUntil(game, (s) => s.stack.length === 0, 100);
    expect(game.state.pendingDecision).toBeNull();
    expect(game.state.triggerQueue).toHaveLength(0);
  });

  it('Chupacabra vs Darksteel Myr: indestrutível sobrevive ao destroy', () => {
    const game = makeGame(
      [...MANA, ravenousChupacabra],
      [...MANA, darksteelMyr],
      { topP1: ['ravenous-chupacabra'] },
    );
    goToMain1(game);
    const myr = put(game, 'p2', 'darksteel-myr');
    for (let i = 0; i < 4; i++) put(game, 'p1', 'swamp');
    game.apply('p1', { type: 'castSpell', objectId: findIn(game, 'p1', 'hand', 'ravenous-chupacabra') });
    passUntil(game, (s) => s.pendingDecision !== null, 100);
    game.apply('p1', { type: 'chooseTargets', targets: [{ kind: 'object', id: myr }] });
    passUntil(game, (s) => s.stack.length === 0);
    expect(game.state.objects[myr].zone).toBe('battlefield');
  });
});

describe('M3 · custos adicionais', () => {
  it('Fling: exige sacrifício e o dano é igual ao poder da criatura sacrificada', () => {
    const game = makeGame([...MANA, fling, grizzlyBears], MANA, { topP1: ['fling'] });
    goToMain1(game);
    const bear = put(game, 'p1', 'grizzly-bears');
    for (let i = 0; i < 2; i++) put(game, 'p1', 'mountain');
    const spell = findIn(game, 'p1', 'hand', 'fling');

    // sem sacrifício → erro
    expect(
      game.apply('p1', { type: 'castSpell', objectId: spell, targets: [{ kind: 'player', player: 'p2' }] }).ok,
    ).toBe(false);
    const r = game.apply('p1', {
      type: 'castSpell',
      objectId: spell,
      targets: [{ kind: 'player', player: 'p2' }],
      sacrifices: [bear],
    });
    expect(r.ok).toBe(true);
    expect(game.state.objects[bear].zone).toBe('graveyard'); // custo pago já no cast
    passUntil(game, (s) => s.stack.length === 0);
    expect(game.state.players.p2.life).toBe(18); // poder 2
  });
});

describe('M3 · indestrutível, hexproof e Fog', () => {
  it('Darksteel Myr sobrevive a Bolt e a Day of Judgment', () => {
    const game = makeGame(
      [...MANA, lightningBolt, dayOfJudgment, grizzlyBears],
      [...MANA, darksteelMyr],
      { topP1: ['lightning-bolt', 'day-of-judgment'] },
    );
    goToMain1(game);
    const myr = put(game, 'p2', 'darksteel-myr');
    const bear = put(game, 'p1', 'grizzly-bears');
    for (let i = 0; i < 2; i++) put(game, 'p1', 'mountain');
    for (let i = 0; i < 4; i++) put(game, 'p1', 'plains');

    game.apply('p1', {
      type: 'castSpell',
      objectId: findIn(game, 'p1', 'hand', 'lightning-bolt'),
      targets: [{ kind: 'object', id: myr }],
    });
    passUntil(game, (s) => s.stack.length === 0);
    expect(game.state.objects[myr].zone).toBe('battlefield'); // 3 dano numa 0/3 indestrutível

    game.apply('p1', { type: 'castSpell', objectId: findIn(game, 'p1', 'hand', 'day-of-judgment') });
    passUntil(game, (s) => s.stack.length === 0);
    expect(game.state.objects[myr].zone).toBe('battlefield');
    expect(game.state.objects[bear].zone).toBe('graveyard'); // o resto morre
  });

  it('Hexproof: oponente não pode alvejar, o dono pode', () => {
    const game = makeGame(
      [...MANA, lightningBolt],
      [...MANA, gladecoverScout, battlegrowth],
      { topP1: ['lightning-bolt'] },
    );
    goToMain1(game);
    const scout = put(game, 'p2', 'gladecover-scout');
    put(game, 'p1', 'mountain');
    expect(
      game.apply('p1', {
        type: 'castSpell',
        objectId: findIn(game, 'p1', 'hand', 'lightning-bolt'),
        targets: [{ kind: 'object', id: scout }],
      }).ok,
    ).toBe(false);

    passUntil(game, (s) => s.turn === 2 && s.step === 'main1');
    put(game, 'p2', 'forest');
    const growth = put(game, 'p2', 'battlegrowth', 'hand');
    expect(
      game.apply('p2', { type: 'castSpell', objectId: growth, targets: [{ kind: 'object', id: scout }] }).ok,
    ).toBe(true);
    passUntil(game, (s) => s.stack.length === 0);
    expect(effectivePower(game.state, game.state.objects[scout])).toBe(2);
  });

  it('Fog previne todo o dano de combate do turno (e só desse turno)', () => {
    const game = makeGame(
      [...MANA, ragingGoblin],
      [...MANA, fog],
      { topP1: ['raging-goblin'] },
    );
    goToMain1(game);
    const goblin = put(game, 'p1', 'raging-goblin', 'hand');
    put(game, 'p1', 'mountain');
    put(game, 'p2', 'forest');
    const fogCard = put(game, 'p2', 'fog', 'hand');
    game.apply('p1', { type: 'castSpell', objectId: goblin });
    passUntil(game, (s) => s.stack.length === 0);
    passUntil(game, (s) => s.combatAwaiting === 'attackers');
    game.apply('p1', { type: 'declareAttackers', attackers: [goblin] });
    // janela de resposta: p1 passa, p2 conjura Fog
    game.apply('p1', { type: 'passPriority' });
    expect(game.apply('p2', { type: 'castSpell', objectId: fogCard }).ok).toBe(true);
    passUntil(game, (s) => s.step === 'main2', 200);
    expect(game.state.players.p2.life).toBe(20); // dano prevenido

    // turno 3: ataca de novo, sem Fog → dano normal
    passUntil(game, (s) => s.turn === 3 && s.combatAwaiting === 'attackers', 200);
    game.apply('p1', { type: 'declareAttackers', attackers: [goblin] });
    passUntil(game, (s) => s.turn === 3 && s.step === 'main2', 200);
    expect(game.state.players.p2.life).toBe(19);
  });
});

describe('M3 · controle e cópias', () => {
  it('Act of Treason rouba a criatura até o fim do turno', () => {
    const game = makeGame(
      [...MANA, actOfTreason],
      [...MANA, grizzlyBears],
      { topP1: ['act-of-treason'] },
    );
    goToMain1(game);
    const bear = put(game, 'p2', 'grizzly-bears');
    for (let i = 0; i < 3; i++) put(game, 'p1', 'mountain');
    game.apply('p1', {
      type: 'castSpell',
      objectId: findIn(game, 'p1', 'hand', 'act-of-treason'),
      targets: [{ kind: 'object', id: bear }],
    });
    passUntil(game, (s) => s.stack.length === 0);
    expect(game.state.objects[bear].controller).toBe('p1');
    expect(game.state.players.p1.zones.battlefield).toContain(bear);
    expect(game.state.players.p2.zones.battlefield).not.toContain(bear);

    // no fim do turno volta para o dono
    passUntil(game, (s) => s.turn === 2 && s.step === 'main1', 200);
    expect(game.state.objects[bear].controller).toBe('p2');
    expect(game.state.players.p2.zones.battlefield).toContain(bear);
  });

  it('Twincast copia um Bolt: 6 de dano no total', () => {
    const game = makeGame(
      [...MANA, lightningBolt, twincast],
      MANA,
      { topP1: ['lightning-bolt', 'twincast'] },
    );
    goToMain1(game);
    put(game, 'p1', 'mountain');
    for (let i = 0; i < 2; i++) put(game, 'p1', 'island');
    const bolt = findIn(game, 'p1', 'hand', 'lightning-bolt');
    game.apply('p1', {
      type: 'castSpell',
      objectId: bolt,
      targets: [{ kind: 'player', player: 'p2' }],
    });
    // p1 mantém prioridade e responde ao próprio Bolt com Twincast
    expect(
      game.apply('p1', {
        type: 'castSpell',
        objectId: findIn(game, 'p1', 'hand', 'twincast'),
        targets: [{ kind: 'object', id: bolt }],
      }).ok,
    ).toBe(true);
    passUntil(game, (s) => s.stack.length === 0, 200);
    expect(game.state.players.p2.life).toBe(14);
  });
});
