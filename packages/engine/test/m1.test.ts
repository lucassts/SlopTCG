import { describe, expect, it } from 'vitest';
import {
  bonesplitter,
  fencingAce,
  forest,
  grizzlyBears,
  lightningBolt,
  mountain,
  pacifism,
  plains,
  youthfulKnight,
} from '../src/cards/demo-set.js';
import { canAttack } from '../src/combat.js';
import { effectivePower } from '../src/state.js';
import { viewFor } from '../src/view.js';
import { findIn, goToMain1, makeGame, passUntil } from './helpers.js';
import type { CardDefinition } from '../src/cards/types.js';

function copies(card: CardDefinition, n: number): CardDefinition[] {
  return Array.from({ length: n }, () => card);
}

const GREEN = [...copies(forest, 12), ...copies(grizzlyBears, 8)];

describe('mulligan londrino', () => {
  it('bloqueia ações antes do keep, compra 7 de novo e manda N para o fundo', () => {
    const game = makeGame(GREEN, GREEN, { skipKeep: true });
    expect(game.state.mulligan).not.toBeNull();
    expect(game.state.turn).toBe(0);

    // jogar antes de decidir a mão → erro
    const land = game.state.players.p1.zones.hand[0];
    expect(game.apply('p1', { type: 'playLand', objectId: land }).ok).toBe(false);

    // p1 faz mulligan: continua com 7 na mão (londrino)
    expect(game.apply('p1', { type: 'mulligan' }).ok).toBe(true);
    expect(game.state.players.p1.zones.hand).toHaveLength(7);
    expect(game.state.mulligan!.taken.p1).toBe(1);

    // keep sem escolher o fundo → erro; com 1 carta → ok, mão fica com 6
    expect(game.apply('p1', { type: 'keepHand', bottom: [] }).ok).toBe(false);
    const toBottom = game.state.players.p1.zones.hand[0];
    expect(game.apply('p1', { type: 'keepHand', bottom: [toBottom] }).ok).toBe(true);
    expect(game.state.players.p1.zones.hand).toHaveLength(6);
    // a carta foi para o FUNDO da biblioteca
    const lib = game.state.players.p1.zones.library;
    expect(lib[lib.length - 1]).toBe(toBottom);

    // só depois do keep dos dois o turno 1 começa
    expect(game.state.turn).toBe(0);
    expect(game.apply('p2', { type: 'keepHand', bottom: [] }).ok).toBe(true);
    expect(game.state.mulligan).toBeNull();
    expect(game.state.turn).toBe(1);
    expect(game.state.step).toBe('upkeep');
  });
});

describe('auras', () => {
  function setupPacifiedBear() {
    const game = makeGame(
      [...copies(plains, 8), ...copies(mountain, 8), ...copies(pacifism, 4), ...copies(lightningBolt, 4)],
      GREEN,
      { topP1: ['plains', 'plains', 'lightning-bolt', 'pacifism'], topP2: ['forest', 'forest', 'grizzly-bears'] },
    );
    goToMain1(game);
    game.apply('p1', { type: 'playLand', objectId: findIn(game, 'p1', 'hand', 'plains') });
    passUntil(game, (s) => s.turn === 2 && s.step === 'main1');
    game.apply('p2', { type: 'playLand', objectId: findIn(game, 'p2', 'hand', 'forest') });
    passUntil(game, (s) => s.turn === 3 && s.step === 'main1');
    game.apply('p1', { type: 'playLand', objectId: findIn(game, 'p1', 'hand', 'plains') });
    passUntil(game, (s) => s.turn === 4 && s.step === 'main1');
    game.apply('p2', { type: 'playLand', objectId: findIn(game, 'p2', 'hand', 'forest') });
    const bear = findIn(game, 'p2', 'hand', 'grizzly-bears');
    expect(game.apply('p2', { type: 'castSpell', objectId: bear }).ok).toBe(true);
    passUntil(game, (s) => s.stack.length === 0);
    passUntil(game, (s) => s.turn === 5 && s.step === 'main1');
    const aura = findIn(game, 'p1', 'hand', 'pacifism');
    expect(
      game.apply('p1', { type: 'castSpell', objectId: aura, targets: [{ kind: 'object', id: bear }] }).ok,
    ).toBe(true);
    passUntil(game, (s) => s.stack.length === 0);
    return { game, bear, aura };
  }

  it('Pacifism entra anexada e impede a criatura de atacar', () => {
    const { game, bear, aura } = setupPacifiedBear();
    expect(game.state.objects[aura].zone).toBe('battlefield');
    expect(game.state.objects[aura].attachedTo).toBe(bear);
    // turno do p2: única criatura pacificada → etapa de atacantes é pulada
    passUntil(game, (s) => s.turn === 6 && s.step === 'main2');
    expect(canAttack(game.state, game.state.objects[bear])).toContain('não pode atacar');
    expect(game.state.players.p1.life).toBe(20);
  });

  it('aura vai para o cemitério quando a criatura morre', () => {
    const { game, bear, aura } = setupPacifiedBear();
    passUntil(game, (s) => s.turn === 7 && s.step === 'main1');
    const bolt = findIn(game, 'p1', 'hand', 'lightning-bolt');
    // precisa de mountain: t7 joga a montanha comprada/stackada
    game.apply('p1', { type: 'playLand', objectId: findIn(game, 'p1', 'hand', 'mountain') });
    expect(
      game.apply('p1', { type: 'castSpell', objectId: bolt, targets: [{ kind: 'object', id: bear }] }).ok,
    ).toBe(true);
    passUntil(game, (s) => s.stack.length === 0);
    expect(game.state.objects[bear].zone).toBe('graveyard');
    expect(game.state.objects[aura].zone).toBe('graveyard');
  });
});

describe('equipamentos', () => {
  it('Bonesplitter dá +2/+0, só equipa em sorcery speed, e sobrevive à criatura', () => {
    const game = makeGame(
      [...copies(forest, 12), ...copies(grizzlyBears, 4), ...copies(bonesplitter, 4)],
      [...copies(mountain, 12), ...copies(lightningBolt, 8)],
      { topP1: ['forest', 'forest', 'grizzly-bears', 'forest', 'bonesplitter'], topP2: ['mountain', 'lightning-bolt'] },
    );
    goToMain1(game);
    game.apply('p1', { type: 'playLand', objectId: findIn(game, 'p1', 'hand', 'forest') });
    passUntil(game, (s) => s.turn === 2 && s.step === 'main1');
    game.apply('p2', { type: 'playLand', objectId: findIn(game, 'p2', 'hand', 'mountain') });
    passUntil(game, (s) => s.turn === 3 && s.step === 'main1');
    game.apply('p1', { type: 'playLand', objectId: findIn(game, 'p1', 'hand', 'forest') });
    const bear = findIn(game, 'p1', 'hand', 'grizzly-bears');
    game.apply('p1', { type: 'castSpell', objectId: bear });
    passUntil(game, (s) => s.stack.length === 0);
    passUntil(game, (s) => s.turn === 5 && s.step === 'main1');
    game.apply('p1', { type: 'playLand', objectId: findIn(game, 'p1', 'hand', 'forest') });
    const equip = findIn(game, 'p1', 'hand', 'bonesplitter');
    game.apply('p1', { type: 'castSpell', objectId: equip });
    passUntil(game, (s) => s.stack.length === 0);

    // equipar: habilidade sorceryOnly com alvo
    const r = game.apply('p1', {
      type: 'activateAbility',
      objectId: equip,
      abilityIndex: 0,
      targets: [{ kind: 'object', id: bear }],
    });
    expect(r.ok).toBe(true);
    passUntil(game, (s) => s.stack.length === 0);
    expect(game.state.objects[equip].attachedTo).toBe(bear);
    expect(effectivePower(game.state, game.state.objects[bear])).toBe(4);
    const view = viewFor(game.state, 'p1');
    const bearView = view.players.p1.battlefield.find((c) => c.objectId === bear)!;
    expect(bearView.power).toBe(4);

    // p2 mata o urso: o equipamento fica no campo, desanexado
    passUntil(game, (s) => s.turn === 6 && s.step === 'main1');
    const bolt = findIn(game, 'p2', 'hand', 'lightning-bolt');
    expect(
      game.apply('p2', { type: 'castSpell', objectId: bolt, targets: [{ kind: 'object', id: bear }] }).ok,
    ).toBe(true);
    passUntil(game, (s) => s.stack.length === 0);
    expect(game.state.objects[bear].zone).toBe('graveyard');
    expect(game.state.objects[equip].zone).toBe('battlefield');
    expect(game.state.objects[equip].attachedTo).toBeUndefined();
  });
});

describe('first strike e double strike', () => {
  it('bloqueador com iniciativa mata o atacante antes de levar dano', () => {
    const game = makeGame(
      GREEN,
      [...copies(plains, 12), ...copies(youthfulKnight, 8)],
      { topP1: ['forest', 'forest', 'grizzly-bears'], topP2: ['plains', 'plains', 'youthful-knight'] },
    );
    goToMain1(game);
    game.apply('p1', { type: 'playLand', objectId: findIn(game, 'p1', 'hand', 'forest') });
    passUntil(game, (s) => s.turn === 2 && s.step === 'main1');
    game.apply('p2', { type: 'playLand', objectId: findIn(game, 'p2', 'hand', 'plains') });
    passUntil(game, (s) => s.turn === 3 && s.step === 'main1');
    game.apply('p1', { type: 'playLand', objectId: findIn(game, 'p1', 'hand', 'forest') });
    const bear = findIn(game, 'p1', 'hand', 'grizzly-bears');
    game.apply('p1', { type: 'castSpell', objectId: bear });
    passUntil(game, (s) => s.stack.length === 0);
    passUntil(game, (s) => s.turn === 4 && s.step === 'main1');
    game.apply('p2', { type: 'playLand', objectId: findIn(game, 'p2', 'hand', 'plains') });
    const knight = findIn(game, 'p2', 'hand', 'youthful-knight');
    game.apply('p2', { type: 'castSpell', objectId: knight });
    passUntil(game, (s) => s.stack.length === 0);

    passUntil(game, (s) => s.turn === 5 && s.combatAwaiting === 'attackers');
    game.apply('p1', { type: 'declareAttackers', attackers: [bear] });
    passUntil(game, (s) => s.combatAwaiting === 'blockers');
    game.apply('p2', { type: 'declareBlockers', blocks: [{ blocker: knight, attacker: bear }] });
    passUntil(game, (s) => s.step === 'main2');

    // cavaleiro 2/1 com iniciativa mata o urso 2/2 antes do dano normal
    expect(game.state.objects[bear].zone).toBe('graveyard');
    expect(game.state.objects[knight].zone).toBe('battlefield');
    expect(game.state.objects[knight].damage).toBe(0);
    expect(game.state.players.p2.life).toBe(20);
  });

  it('golpe duplo não bloqueado causa o dano duas vezes', () => {
    const game = makeGame(
      [...copies(plains, 12), ...copies(fencingAce, 8)],
      GREEN,
      { topP1: ['plains', 'plains', 'fencing-ace'] },
    );
    goToMain1(game);
    game.apply('p1', { type: 'playLand', objectId: findIn(game, 'p1', 'hand', 'plains') });
    passUntil(game, (s) => s.turn === 3 && s.step === 'main1');
    game.apply('p1', { type: 'playLand', objectId: findIn(game, 'p1', 'hand', 'plains') });
    const ace = findIn(game, 'p1', 'hand', 'fencing-ace');
    game.apply('p1', { type: 'castSpell', objectId: ace });
    passUntil(game, (s) => s.stack.length === 0);
    passUntil(game, (s) => s.turn === 5 && s.combatAwaiting === 'attackers');
    game.apply('p1', { type: 'declareAttackers', attackers: [ace] });
    passUntil(game, (s) => s.step === 'main2');
    // 1/1 golpe duplo: 1 na iniciativa + 1 no dano normal
    expect(game.state.players.p2.life).toBe(18);
  });
});
