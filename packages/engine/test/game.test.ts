import { describe, expect, it } from 'vitest';
import {
  cancel,
  colossalDreadmaw,
  divination,
  doomedTraveler,
  elvishVisionary,
  forest,
  giantGrowth,
  grizzlyBears,
  island,
  lightningBolt,
  mountain,
  plains,
  ragingGoblin,
  serraAngel,
  stormCrow,
} from '../src/cards/demo-set.js';
import { parseCost, planPayment } from '../src/mana.js';
import { viewFor } from '../src/view.js';
import { findIn, goToMain1, makeGame, passUntil, stackTop } from './helpers.js';
import type { CardDefinition } from '../src/cards/types.js';

function copies(card: CardDefinition, n: number): CardDefinition[] {
  return Array.from({ length: n }, () => card);
}

const RED_DECK = [...copies(mountain, 12), ...copies(ragingGoblin, 4), ...copies(lightningBolt, 4)];
const GREEN_DECK = [...copies(forest, 12), ...copies(grizzlyBears, 4), ...copies(giantGrowth, 4)];

describe('início de partida', () => {
  it('dá 7 cartas para cada jogador e pula a compra de quem começa', () => {
    const game = makeGame(RED_DECK, GREEN_DECK);
    expect(game.state.players.p1.zones.hand).toHaveLength(7);
    expect(game.state.players.p2.zones.hand).toHaveLength(7);
    expect(game.state.turn).toBe(1);
    expect(game.state.step).toBe('upkeep');
    expect(game.state.priority).toBe('p1');

    passUntil(game, (s) => s.step === 'main1');
    // quem começa não compra no turno 1
    expect(game.state.players.p1.zones.hand).toHaveLength(7);
  });

  it('vida inicial 20 e bibliotecas embaralhadas deterministicamente', () => {
    const a = makeGame(RED_DECK, GREEN_DECK);
    const b = makeGame(RED_DECK, GREEN_DECK);
    expect(a.state.players.p1.life).toBe(20);
    expect(a.state.players.p1.zones.library).toEqual(b.state.players.p1.zones.library);
  });
});

describe('terrenos e mana', () => {
  it('joga terreno, limita a 1 por turno, e auto-paga custos virando terrenos', () => {
    const game = makeGame(RED_DECK, GREEN_DECK, { topP1: ['mountain', 'mountain', 'raging-goblin'] });
    goToMain1(game);

    const land = findIn(game, 'p1', 'hand', 'mountain');
    expect(game.apply('p1', { type: 'playLand', objectId: land }).ok).toBe(true);
    const land2 = game.state.players.p1.zones.hand.find(
      (id) => game.state.objects[id].card.id === 'mountain',
    );
    if (land2 !== undefined) {
      expect(game.apply('p1', { type: 'playLand', objectId: land2 }).ok).toBe(false);
    }

    const goblin = findIn(game, 'p1', 'hand', 'raging-goblin');
    expect(game.apply('p1', { type: 'castSpell', objectId: goblin }).ok).toBe(true);
    // custo {R} auto-virou a montanha
    expect(game.state.objects[land].tapped).toBe(true);
    expect(game.state.stack).toHaveLength(1);

    passUntil(game, (s) => s.stack.length === 0);
    expect(game.state.objects[goblin].zone).toBe('battlefield');
  });

  it('planPayment recusa custo impagável', () => {
    const game = makeGame(RED_DECK, GREEN_DECK);
    expect(planPayment(game.state, 'p1', parseCost('{4}{U}'))).toBeNull();
  });
});

describe('combate', () => {
  function setupCombat() {
    const game = makeGame(RED_DECK, GREEN_DECK, { topP1: ['mountain', 'raging-goblin'] });
    goToMain1(game);
    const land = findIn(game, 'p1', 'hand', 'mountain');
    game.apply('p1', { type: 'playLand', objectId: land });
    const goblin = findIn(game, 'p1', 'hand', 'raging-goblin');
    game.apply('p1', { type: 'castSpell', objectId: goblin });
    passUntil(game, (s) => s.stack.length === 0);
    return { game, goblin };
  }

  it('criatura com ímpeto ataca no turno em que entra e causa dano', () => {
    const { game, goblin } = setupCombat();
    passUntil(game, (s) => s.combatAwaiting === 'attackers');
    expect(game.apply('p1', { type: 'declareAttackers', attackers: [goblin] }).ok).toBe(true);
    expect(game.state.objects[goblin].tapped).toBe(true);

    passUntil(game, (s) => s.combatAwaiting === 'blockers');
    expect(game.apply('p2', { type: 'declareBlockers', blocks: [] }).ok).toBe(true);
    passUntil(game, (s) => s.step === 'main2');
    expect(game.state.players.p2.life).toBe(19);
  });

  it('bloqueador troca dano e criaturas letais morrem', () => {
    const game = makeGame(
      [...copies(forest, 12), ...copies(grizzlyBears, 8)],
      [...copies(forest, 12), ...copies(grizzlyBears, 8)],
      { topP1: ['forest', 'forest', 'grizzly-bears'], topP2: ['forest', 'forest', 'grizzly-bears'] },
    );
    // t1 p1: terreno
    goToMain1(game);
    game.apply('p1', { type: 'playLand', objectId: findIn(game, 'p1', 'hand', 'forest') });
    // t2 p2: terreno
    passUntil(game, (s) => s.activePlayer === 'p2' && s.step === 'main1');
    game.apply('p2', { type: 'playLand', objectId: findIn(game, 'p2', 'hand', 'forest') });
    // t3 p1: segundo terreno + urso
    passUntil(game, (s) => s.activePlayer === 'p1' && s.step === 'main1' && s.turn === 3);
    game.apply('p1', { type: 'playLand', objectId: findIn(game, 'p1', 'hand', 'forest') });
    const bear1 = findIn(game, 'p1', 'hand', 'grizzly-bears');
    expect(game.apply('p1', { type: 'castSpell', objectId: bear1 }).ok).toBe(true);
    passUntil(game, (s) => s.stack.length === 0);
    // t4 p2: segundo terreno + urso
    passUntil(game, (s) => s.activePlayer === 'p2' && s.step === 'main1' && s.turn === 4);
    game.apply('p2', { type: 'playLand', objectId: findIn(game, 'p2', 'hand', 'forest') });
    const bear2 = findIn(game, 'p2', 'hand', 'grizzly-bears');
    game.apply('p2', { type: 'castSpell', objectId: bear2 });
    passUntil(game, (s) => s.stack.length === 0);
    // t5 p1: ataca com urso, p2 bloqueia com urso → ambos morrem
    passUntil(game, (s) => s.turn === 5 && s.combatAwaiting === 'attackers');
    game.apply('p1', { type: 'declareAttackers', attackers: [bear1] });
    passUntil(game, (s) => s.combatAwaiting === 'blockers');
    game.apply('p2', { type: 'declareBlockers', blocks: [{ blocker: bear2, attacker: bear1 }] });
    passUntil(game, (s) => s.step === 'main2');
    expect(game.state.objects[bear1].zone).toBe('graveyard');
    expect(game.state.objects[bear2].zone).toBe('graveyard');
    expect(game.state.players.p2.life).toBe(20);
  });

  it('voar só pode ser bloqueado por voar/alcance', () => {
    const game = makeGame(
      [...copies(island, 12), ...copies(stormCrow, 8)],
      [...copies(forest, 12), ...copies(grizzlyBears, 8)],
      { topP1: ['island', 'island', 'storm-crow'], topP2: ['forest', 'forest', 'grizzly-bears'] },
    );
    goToMain1(game);
    game.apply('p1', { type: 'playLand', objectId: findIn(game, 'p1', 'hand', 'island') });
    passUntil(game, (s) => s.activePlayer === 'p2' && s.step === 'main1');
    game.apply('p2', { type: 'playLand', objectId: findIn(game, 'p2', 'hand', 'forest') });
    passUntil(game, (s) => s.turn === 3 && s.step === 'main1');
    game.apply('p1', { type: 'playLand', objectId: findIn(game, 'p1', 'hand', 'island') });
    const crow = findIn(game, 'p1', 'hand', 'storm-crow');
    game.apply('p1', { type: 'castSpell', objectId: crow });
    passUntil(game, (s) => s.stack.length === 0);
    passUntil(game, (s) => s.activePlayer === 'p2' && s.step === 'main1');
    game.apply('p2', { type: 'playLand', objectId: findIn(game, 'p2', 'hand', 'forest') });
    const bear = findIn(game, 'p2', 'hand', 'grizzly-bears');
    game.apply('p2', { type: 'castSpell', objectId: bear });
    passUntil(game, (s) => s.stack.length === 0);
    passUntil(game, (s) => s.turn === 5 && s.combatAwaiting === 'attackers');
    game.apply('p1', { type: 'declareAttackers', attackers: [crow] });
    passUntil(game, (s) => s.combatAwaiting === 'blockers');
    const res = game.apply('p2', { type: 'declareBlockers', blocks: [{ blocker: bear, attacker: crow }] });
    expect(res.ok).toBe(false);
  });
});

describe('mágicas, alvos e pilha', () => {
  it('Lightning Bolt mata Grizzly Bears via SBA', () => {
    const game = makeGame(
      [...copies(mountain, 12), ...copies(lightningBolt, 8)],
      [...copies(forest, 12), ...copies(grizzlyBears, 8)],
      { topP1: ['mountain', 'lightning-bolt'], topP2: ['forest', 'forest', 'grizzly-bears'] },
    );
    goToMain1(game);
    game.apply('p1', { type: 'playLand', objectId: findIn(game, 'p1', 'hand', 'mountain') });
    passUntil(game, (s) => s.activePlayer === 'p2' && s.step === 'main1');
    game.apply('p2', { type: 'playLand', objectId: findIn(game, 'p2', 'hand', 'forest') });
    passUntil(game, (s) => s.turn === 4 && s.activePlayer === 'p2' && s.step === 'main1');
    game.apply('p2', { type: 'playLand', objectId: findIn(game, 'p2', 'hand', 'forest') });
    const bear = findIn(game, 'p2', 'hand', 'grizzly-bears');
    game.apply('p2', { type: 'castSpell', objectId: bear });
    passUntil(game, (s) => s.stack.length === 0);

    passUntil(game, (s) => s.turn === 5 && s.step === 'main1');
    const bolt = findIn(game, 'p1', 'hand', 'lightning-bolt');
    const r = game.apply('p1', {
      type: 'castSpell',
      objectId: bolt,
      targets: [{ kind: 'object', id: bear }],
    });
    expect(r.ok).toBe(true);
    passUntil(game, (s) => s.stack.length === 0);
    expect(game.state.objects[bear].zone).toBe('graveyard');
  });

  it('Bolt na cara reduz a vida', () => {
    const game = makeGame(RED_DECK, GREEN_DECK, { topP1: ['mountain', 'lightning-bolt'] });
    goToMain1(game);
    game.apply('p1', { type: 'playLand', objectId: findIn(game, 'p1', 'hand', 'mountain') });
    const bolt = findIn(game, 'p1', 'hand', 'lightning-bolt');
    game.apply('p1', { type: 'castSpell', objectId: bolt, targets: [{ kind: 'player', player: 'p2' }] });
    passUntil(game, (s) => s.stack.length === 0);
    expect(game.state.players.p2.life).toBe(17);
  });

  it('Cancel anula mágica na pilha', () => {
    const game = makeGame(
      [...copies(mountain, 12), ...copies(ragingGoblin, 8)],
      [...copies(island, 12), ...copies(cancel, 8)],
      { topP1: ['mountain', 'raging-goblin'], topP2: ['island', 'island', 'island', 'cancel'] },
    );
    goToMain1(game);
    game.apply('p1', { type: 'playLand', objectId: findIn(game, 'p1', 'hand', 'mountain') });
    // p2 desenvolve 3 ilhas
    for (const turn of [2, 4, 6]) {
      passUntil(game, (s) => s.turn === turn && s.activePlayer === 'p2' && s.step === 'main1');
      game.apply('p2', { type: 'playLand', objectId: findIn(game, 'p2', 'hand', 'island') });
    }
    passUntil(game, (s) => s.turn === 7 && s.step === 'main1');
    const goblin = findIn(game, 'p1', 'hand', 'raging-goblin');
    game.apply('p1', { type: 'castSpell', objectId: goblin });
    // p1 passa, p2 responde com Cancel
    game.apply('p1', { type: 'passPriority' });
    const counter = findIn(game, 'p2', 'hand', 'cancel');
    const r = game.apply('p2', {
      type: 'castSpell',
      objectId: counter,
      targets: [{ kind: 'object', id: goblin }],
    });
    expect(r.ok).toBe(true);
    passUntil(game, (s) => s.stack.length === 0);
    expect(game.state.objects[goblin].zone).toBe('graveyard');
    expect(game.state.players.p1.zones.battlefield).toHaveLength(1); // só a montanha
  });

  it('Giant Growth salva criatura do Bolt (fizzle parcial não existe: dano < resistência)', () => {
    const game = makeGame(
      [...copies(mountain, 12), ...copies(lightningBolt, 8)],
      [...copies(forest, 12), ...copies(grizzlyBears, 4), ...copies(giantGrowth, 4)],
      { topP1: ['mountain', 'lightning-bolt'], topP2: ['forest', 'forest', 'forest', 'grizzly-bears', 'giant-growth'] },
    );
    goToMain1(game);
    game.apply('p1', { type: 'playLand', objectId: findIn(game, 'p1', 'hand', 'mountain') });
    passUntil(game, (s) => s.activePlayer === 'p2' && s.step === 'main1');
    game.apply('p2', { type: 'playLand', objectId: findIn(game, 'p2', 'hand', 'forest') });
    passUntil(game, (s) => s.turn === 4 && s.step === 'main1');
    game.apply('p2', { type: 'playLand', objectId: findIn(game, 'p2', 'hand', 'forest') });
    const bear = findIn(game, 'p2', 'hand', 'grizzly-bears');
    expect(game.apply('p2', { type: 'castSpell', objectId: bear }).ok).toBe(true);
    passUntil(game, (s) => s.stack.length === 0);
    // t6: p2 joga a 3ª floresta para ter mana aberta no turno do oponente
    passUntil(game, (s) => s.turn === 6 && s.step === 'main1');
    game.apply('p2', { type: 'playLand', objectId: findIn(game, 'p2', 'hand', 'forest') });
    passUntil(game, (s) => s.turn === 7 && s.step === 'main1');
    const bolt = findIn(game, 'p1', 'hand', 'lightning-bolt');
    game.apply('p1', { type: 'castSpell', objectId: bolt, targets: [{ kind: 'object', id: bear }] });
    game.apply('p1', { type: 'passPriority' });
    const growth = findIn(game, 'p2', 'hand', 'giant-growth');
    expect(
      game.apply('p2', { type: 'castSpell', objectId: growth, targets: [{ kind: 'object', id: bear }] }).ok,
    ).toBe(true);
    passUntil(game, (s) => s.stack.length === 0);
    // 2/2 +3/+3 = 5/5 com 3 de dano: sobrevive
    expect(game.state.objects[bear].zone).toBe('battlefield');
    expect(game.state.objects[bear].damage).toBe(3);
  });
});

describe('habilidades desencadeadas', () => {
  it('ETB do Elvish Visionary compra carta', () => {
    const game = makeGame(
      [...copies(forest, 12), ...copies(elvishVisionary, 8)],
      GREEN_DECK,
      { topP1: ['forest', 'forest', 'elvish-visionary'] },
    );
    goToMain1(game);
    game.apply('p1', { type: 'playLand', objectId: findIn(game, 'p1', 'hand', 'forest') });
    passUntil(game, (s) => s.turn === 3 && s.step === 'main1');
    game.apply('p1', { type: 'playLand', objectId: findIn(game, 'p1', 'hand', 'forest') });
    const elf = findIn(game, 'p1', 'hand', 'elvish-visionary');
    const before = game.state.players.p1.zones.hand.length;
    game.apply('p1', { type: 'castSpell', objectId: elf });
    passUntil(game, (s) => s.stack.length === 0 && s.objects[elf].zone === 'battlefield');
    passUntil(game, (s) => s.stack.length === 0);
    // -1 (conjurou) +1 (gatilho) = mesma quantidade
    expect(game.state.players.p1.zones.hand.length).toBe(before);
  });

  it('Doomed Traveler morre e vira Espírito', () => {
    const game = makeGame(
      [...copies(plains, 12), ...copies(doomedTraveler, 8)],
      [...copies(mountain, 12), ...copies(lightningBolt, 8)],
      { topP1: ['plains', 'doomed-traveler'], topP2: ['mountain', 'lightning-bolt'] },
    );
    goToMain1(game);
    game.apply('p1', { type: 'playLand', objectId: findIn(game, 'p1', 'hand', 'plains') });
    const traveler = findIn(game, 'p1', 'hand', 'doomed-traveler');
    game.apply('p1', { type: 'castSpell', objectId: traveler });
    passUntil(game, (s) => s.stack.length === 0);
    passUntil(game, (s) => s.activePlayer === 'p2' && s.step === 'main1');
    game.apply('p2', { type: 'playLand', objectId: findIn(game, 'p2', 'hand', 'mountain') });
    const bolt = findIn(game, 'p2', 'hand', 'lightning-bolt');
    game.apply('p2', { type: 'castSpell', objectId: bolt, targets: [{ kind: 'object', id: traveler }] });
    passUntil(game, (s) => s.stack.length === 0);
    expect(game.state.objects[traveler].zone).toBe('graveyard');
    const spirits = game.state.players.p1.zones.battlefield
      .map((id) => game.state.objects[id])
      .filter((o) => o.card.name === 'Spirit');
    expect(spirits).toHaveLength(1);
    expect(spirits[0].isToken).toBe(true);
  });
});

describe('fim de jogo e limpeza', () => {
  it('comprar de biblioteca vazia perde o jogo', () => {
    const game = makeGame(RED_DECK, GREEN_DECK);
    game.state.players.p2.zones.library = [];
    passUntil(game, (s) => s.status === 'finished', 60);
    expect(game.state.winner).toBe('p1');
  });

  it('conceder termina a partida', () => {
    const game = makeGame(RED_DECK, GREEN_DECK);
    game.apply('p2', { type: 'concede' });
    expect(game.state.status).toBe('finished');
    expect(game.state.winner).toBe('p1');
  });

  it('Divination compra 2 e o jogador ocioso descarta para 7 no cleanup', () => {
    const game = makeGame(
      [...copies(island, 12), ...copies(divination, 8)],
      GREEN_DECK,
      { topP1: ['island', 'island', 'island', 'divination'] },
    );
    goToMain1(game);
    game.apply('p1', { type: 'playLand', objectId: findIn(game, 'p1', 'hand', 'island') });
    passUntil(game, (s) => s.turn === 3 && s.step === 'main1');
    game.apply('p1', { type: 'playLand', objectId: findIn(game, 'p1', 'hand', 'island') });
    passUntil(game, (s) => s.turn === 5 && s.step === 'main1');
    game.apply('p1', { type: 'playLand', objectId: findIn(game, 'p1', 'hand', 'island') });
    const div = findIn(game, 'p1', 'hand', 'divination');
    const before = game.state.players.p1.zones.hand.length;
    expect(game.apply('p1', { type: 'castSpell', objectId: div }).ok).toBe(true);
    passUntil(game, (s) => s.stack.length === 0);
    expect(game.state.players.p1.zones.hand.length).toBe(before + 1); // -1 conjurada, +2 compradas

    // p2 nunca joga nada: acumula cartas e precisa descartar no próprio cleanup
    passUntil(game, (s) => s.pendingDecision?.player === 'p2', 80);
    const pending = game.state.pendingDecision!;
    expect(pending.type).toBe('discardToHandSize');
    const hand = game.state.players.p2.zones.hand;
    const r = game.apply('p2', { type: 'chooseDiscard', objectIds: hand.slice(0, pending.count) });
    expect(r.ok).toBe(true);
    expect(game.state.players.p2.zones.hand.length).toBeLessThanOrEqual(7);
  });
});

describe('view redigido', () => {
  it('esconde a mão do oponente e o conteúdo das bibliotecas', () => {
    const game = makeGame(RED_DECK, GREEN_DECK);
    const view = viewFor(game.state, 'p1');
    expect(view.players.p1.hand).not.toBeNull();
    expect(view.players.p2.hand).toBeNull();
    expect(view.players.p2.handSize).toBe(7);
    expect(view.players.p2.librarySize).toBeGreaterThan(0);
  });
});

describe('modo manual (Tier 3)', () => {
  it('move carta, vira, ajusta vida e cria ficha com log transparente', () => {
    const game = makeGame(RED_DECK, GREEN_DECK);
    const hand = game.state.players.p1.zones.hand;
    const cardId = hand[0];
    const r1 = game.apply('p1', { type: 'manualMove', objectId: cardId, to: 'battlefield' });
    expect(r1.ok).toBe(true);
    expect(game.state.objects[cardId].zone).toBe('battlefield');
    expect(r1.events.some((e) => e.type === 'manualAction')).toBe(true);

    const r2 = game.apply('p1', { type: 'manualTap', objectId: cardId, tapped: true });
    expect(r2.ok).toBe(true);

    game.apply('p1', { type: 'manualLife', player: 'p1', delta: -4 });
    expect(game.state.players.p1.life).toBe(16);

    game.apply('p1', { type: 'manualToken', name: 'Dragão', power: 5, toughness: 5 });
    expect(
      game.state.players.p1.zones.battlefield.some((id) => game.state.objects[id].card.name === 'Dragão'),
    ).toBe(true);
  });

  it('não pode mover carta do oponente', () => {
    const game = makeGame(RED_DECK, GREEN_DECK);
    const opponentCard = game.state.players.p2.zones.hand[0];
    const r = game.apply('p1', { type: 'manualMove', objectId: opponentCard, to: 'graveyard' });
    expect(r.ok).toBe(false);
  });
});
