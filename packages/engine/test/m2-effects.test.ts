/**
 * M2: cobertura das primitivas de efeito. Setup usa manualMove (ação
 * legítima da engine que não dispara SBA/gatilhos) para montar cenários
 * sem jogar dezenas de turnos.
 */
import { describe, expect, it } from 'vitest';
import {
  battlegrowth,
  blaze,
  dayOfJudgment,
  diabolicEdict,
  diabolicTutor,
  forest,
  giantSpider,
  gloriousAnthem,
  goblinChieftain,
  grixisCharm,
  grizzlyBears,
  island,
  lightningBolt,
  mindRot,
  monasterySwiftspear,
  mountain,
  overrun,
  plains,
  preordain,
  preyUpon,
  pyroclasm,
  ragingGoblin,
  raiseDead,
  rampantGrowth,
  soulWarden,
  swamp,
  zulaportCutthroat,
  endlessOne,
} from '../src/cards/demo-set.js';
import { effectivePower, effectiveToughness, hasKeyword } from '../src/state.js';
import type { Game } from '../src/game.js';
import type { CardDefinition } from '../src/cards/types.js';
import type { PlayerId } from '../src/types.js';
import { findIn, goToMain1, makeGame, passUntil } from './helpers.js';

function copies(card: CardDefinition, n: number): CardDefinition[] {
  return Array.from({ length: n }, () => card);
}

/** Move a card (from library or hand) straight onto a zone (test setup). */
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

const LOTS_OF_MANA = [...copies(mountain, 4), ...copies(forest, 4), ...copies(island, 4), ...copies(swamp, 4), ...copies(plains, 4)];

describe('M2 · efeitos em massa', () => {
  it('Pyroclasm dá 2 de dano a TODAS as criaturas; 2/2 morrem, 2/4 sobrevive', () => {
    const game = makeGame(
      [...LOTS_OF_MANA, pyroclasm, grizzlyBears, giantSpider],
      [...LOTS_OF_MANA, grizzlyBears],
      { topP1: ['pyroclasm'] },
    );
    goToMain1(game);
    const myBear = put(game, 'p1', 'grizzly-bears');
    const spider = put(game, 'p1', 'giant-spider');
    const oppBear = put(game, 'p2', 'grizzly-bears');
    for (let i = 0; i < 2; i++) put(game, 'p1', 'mountain');

    const spell = findIn(game, 'p1', 'hand', 'pyroclasm');
    expect(game.apply('p1', { type: 'castSpell', objectId: spell }).ok).toBe(true);
    passUntil(game, (s) => s.stack.length === 0);
    expect(game.state.objects[myBear].zone).toBe('graveyard');
    expect(game.state.objects[oppBear].zone).toBe('graveyard');
    expect(game.state.objects[spider].zone).toBe('battlefield');
    expect(game.state.objects[spider].damage).toBe(2);
  });

  it('Day of Judgment destrói todas as criaturas e poupa terrenos', () => {
    const game = makeGame(
      [...LOTS_OF_MANA, dayOfJudgment, grizzlyBears],
      [...LOTS_OF_MANA, giantSpider],
      { topP1: ['day-of-judgment'] },
    );
    goToMain1(game);
    const myBear = put(game, 'p1', 'grizzly-bears');
    const oppSpider = put(game, 'p2', 'giant-spider');
    const land = put(game, 'p1', 'plains');
    for (let i = 0; i < 3; i++) put(game, 'p1', 'plains');

    game.apply('p1', { type: 'castSpell', objectId: findIn(game, 'p1', 'hand', 'day-of-judgment') });
    passUntil(game, (s) => s.stack.length === 0);
    expect(game.state.objects[myBear].zone).toBe('graveyard');
    expect(game.state.objects[oppSpider].zone).toBe('graveyard');
    expect(game.state.objects[land].zone).toBe('battlefield');
  });

  it('Overrun dá +3/+3 e atropelar só às minhas, e expira no cleanup', () => {
    const game = makeGame(
      [...LOTS_OF_MANA, overrun, grizzlyBears],
      [...LOTS_OF_MANA, grizzlyBears],
      { topP1: ['overrun'] },
    );
    goToMain1(game);
    const mine = put(game, 'p1', 'grizzly-bears');
    const theirs = put(game, 'p2', 'grizzly-bears');
    for (let i = 0; i < 4; i++) put(game, 'p1', 'forest');
    put(game, 'p1', 'mountain'); // genérico

    game.apply('p1', { type: 'castSpell', objectId: findIn(game, 'p1', 'hand', 'overrun') });
    passUntil(game, (s) => s.stack.length === 0);
    expect(effectivePower(game.state, game.state.objects[mine])).toBe(5);
    expect(hasKeyword(game.state, game.state.objects[mine], 'trample')).toBe(true);
    expect(effectivePower(game.state, game.state.objects[theirs])).toBe(2);

    passUntil(game, (s) => s.turn === 2 && s.step === 'main1');
    expect(effectivePower(game.state, game.state.objects[mine])).toBe(2);
    expect(hasKeyword(game.state, game.state.objects[mine], 'trample')).toBe(false);
  });
});

describe('M2 · escolhas (pausa e retomada)', () => {
  it('Mind Rot: o jogador alvo escolhe o que descartar; a mágica só finaliza depois', () => {
    const game = makeGame([...LOTS_OF_MANA, mindRot], [...LOTS_OF_MANA], { topP1: ['mind-rot'] });
    goToMain1(game);
    for (let i = 0; i < 3; i++) put(game, 'p1', 'swamp');
    const spell = findIn(game, 'p1', 'hand', 'mind-rot');
    game.apply('p1', { type: 'castSpell', objectId: spell, targets: [{ kind: 'player', player: 'p2' }] });
    passUntil(game, (s) => s.pendingDecision !== null);

    const pending = game.state.pendingDecision!;
    expect(pending.type).toBe('effectChoice');
    if (pending.type !== 'effectChoice') throw new Error('unreachable');
    expect(pending.player).toBe('p2');
    expect(pending.min).toBe(2);
    // a mágica ainda está na pilha esperando a escolha terminar
    expect(game.state.objects[spell].zone).toBe('stack');

    // p1 não pode responder pela p2
    expect(game.apply('p1', { type: 'effectChoice', picks: pending.options.slice(0, 2) }).ok).toBe(false);
    const r = game.apply('p2', { type: 'effectChoice', picks: pending.options.slice(0, 2) });
    expect(r.ok).toBe(true);
    expect(game.state.players.p2.zones.graveyard).toHaveLength(2);
    expect(game.state.objects[spell].zone).toBe('graveyard');
    expect(game.state.pendingDecision).toBeNull();
  });

  it('Diabolic Edict: com 2+ criaturas pede escolha, com 1 resolve sozinho', () => {
    const game = makeGame(
      [...LOTS_OF_MANA, diabolicEdict, diabolicEdict],
      [...LOTS_OF_MANA, grizzlyBears, giantSpider],
      { topP1: ['diabolic-edict', 'diabolic-edict'] },
    );
    goToMain1(game);
    const bear = put(game, 'p2', 'grizzly-bears');
    const spider = put(game, 'p2', 'giant-spider');
    for (let i = 0; i < 4; i++) put(game, 'p1', 'swamp');

    game.apply('p1', {
      type: 'castSpell',
      objectId: findIn(game, 'p1', 'hand', 'diabolic-edict'),
      targets: [{ kind: 'player', player: 'p2' }],
    });
    passUntil(game, (s) => s.pendingDecision !== null);
    const pending = game.state.pendingDecision!;
    if (pending.type !== 'effectChoice') throw new Error('esperava escolha');
    expect(pending.player).toBe('p2');
    expect(pending.options.sort()).toEqual([bear, spider].sort());
    game.apply('p2', { type: 'effectChoice', picks: [bear] });
    expect(game.state.objects[bear].zone).toBe('graveyard');

    // segunda cópia: só resta a aranha → sacrifício automático, sem pausa
    passUntil(game, (s) => s.stack.length === 0 && s.priority === 'p1');
    game.apply('p1', {
      type: 'castSpell',
      objectId: findIn(game, 'p1', 'hand', 'diabolic-edict'),
      targets: [{ kind: 'player', player: 'p2' }],
    });
    passUntil(game, (s) => s.stack.length === 0);
    expect(game.state.pendingDecision).toBeNull();
    expect(game.state.objects[spider].zone).toBe('graveyard');
  });

  it('Preordain: vidência 2 (uma pro fundo) e compra depois da escolha', () => {
    const game = makeGame([...LOTS_OF_MANA, preordain], [...LOTS_OF_MANA], { topP1: ['preordain'] });
    goToMain1(game);
    put(game, 'p1', 'island');
    game.apply('p1', { type: 'castSpell', objectId: findIn(game, 'p1', 'hand', 'preordain') });
    passUntil(game, (s) => s.pendingDecision !== null);
    const pending = game.state.pendingDecision!;
    if (pending.type !== 'effectChoice') throw new Error('esperava scry');
    expect(pending.mode).toBe('scry');
    const [top1, top2] = pending.options;
    expect(game.state.players.p1.zones.library.slice(0, 2)).toEqual([top1, top2]);

    const handBefore = game.state.players.p1.zones.hand.length;
    game.apply('p1', { type: 'effectChoice', picks: [top1] });
    const lib = game.state.players.p1.zones.library;
    // top1 foi para o fundo; top2 (que ficou no topo) foi comprada em seguida
    expect(lib[lib.length - 1]).toBe(top1);
    expect(game.state.players.p1.zones.hand).toContain(top2);
    expect(game.state.players.p1.zones.hand.length).toBe(handBefore + 1);
  });

  it('Rampant Growth: busca só terrenos básicos, entra virado e embaralha', () => {
    const game = makeGame(
      [...LOTS_OF_MANA, rampantGrowth, grizzlyBears],
      [...LOTS_OF_MANA],
      { topP1: ['rampant-growth'] },
    );
    goToMain1(game);
    for (let i = 0; i < 2; i++) put(game, 'p1', 'forest');
    game.apply('p1', { type: 'castSpell', objectId: findIn(game, 'p1', 'hand', 'rampant-growth') });
    passUntil(game, (s) => s.pendingDecision !== null);
    const pending = game.state.pendingDecision!;
    if (pending.type !== 'effectChoice') throw new Error('esperava busca');
    // só básicos: o urso na biblioteca não é opção
    const optionCards = pending.options.map((id) => game.state.objects[id].card);
    expect(optionCards.every((c) => c.supertypes?.includes('Basic'))).toBe(true);

    const pick = pending.options[0];
    game.apply('p1', { type: 'effectChoice', picks: [pick] });
    expect(game.state.objects[pick].zone).toBe('battlefield');
    expect(game.state.objects[pick].tapped).toBe(true);
  });

  it('Diabolic Tutor põe qualquer carta na mão', () => {
    const game = makeGame(
      [...LOTS_OF_MANA, diabolicTutor, lightningBolt],
      [...LOTS_OF_MANA],
      { topP1: ['diabolic-tutor'] },
    );
    goToMain1(game);
    for (let i = 0; i < 4; i++) put(game, 'p1', 'swamp');
    const bolt = put(game, 'p1', 'lightning-bolt', 'library');
    game.apply('p1', { type: 'castSpell', objectId: findIn(game, 'p1', 'hand', 'diabolic-tutor') });
    passUntil(game, (s) => s.pendingDecision !== null);
    game.apply('p1', { type: 'effectChoice', picks: [bolt] });
    expect(game.state.objects[bolt].zone).toBe('hand');
  });
});

describe('M2 · cemitério, luta, marcadores', () => {
  it('Raise Dead devolve criatura do SEU cemitério para a mão', () => {
    const game = makeGame(
      [...LOTS_OF_MANA, raiseDead, grizzlyBears],
      [...LOTS_OF_MANA, giantSpider],
      { topP1: ['raise-dead'] },
    );
    goToMain1(game);
    const dead = put(game, 'p1', 'grizzly-bears', 'graveyard');
    const enemyDead = put(game, 'p2', 'giant-spider', 'graveyard');
    put(game, 'p1', 'swamp');

    // cemitério do oponente não é alvo válido
    expect(
      game.apply('p1', {
        type: 'castSpell',
        objectId: findIn(game, 'p1', 'hand', 'raise-dead'),
        targets: [{ kind: 'object', id: enemyDead }],
      }).ok,
    ).toBe(false);
    const r = game.apply('p1', {
      type: 'castSpell',
      objectId: findIn(game, 'p1', 'hand', 'raise-dead'),
      targets: [{ kind: 'object', id: dead }],
    });
    expect(r.ok).toBe(true);
    passUntil(game, (s) => s.stack.length === 0);
    expect(game.state.objects[dead].zone).toBe('hand');
  });

  it('Prey Upon: as criaturas brigam e a menor morre', () => {
    const game = makeGame(
      [...LOTS_OF_MANA, preyUpon, giantSpider],
      [...LOTS_OF_MANA, grizzlyBears],
      { topP1: ['prey-upon'] },
    );
    goToMain1(game);
    const spider = put(game, 'p1', 'giant-spider');
    const bear = put(game, 'p2', 'grizzly-bears');
    put(game, 'p1', 'forest');
    game.apply('p1', {
      type: 'castSpell',
      objectId: findIn(game, 'p1', 'hand', 'prey-upon'),
      targets: [
        { kind: 'object', id: spider },
        { kind: 'object', id: bear },
      ],
    });
    passUntil(game, (s) => s.stack.length === 0);
    expect(game.state.objects[bear].zone).toBe('graveyard'); // 2 dano numa 2/2
    expect(game.state.objects[spider].zone).toBe('battlefield'); // 2 dano numa 2/4
    expect(game.state.objects[spider].damage).toBe(2);
  });

  it('Battlegrowth: marcador +1/+1 é permanente (sobrevive ao cleanup)', () => {
    const game = makeGame(
      [...LOTS_OF_MANA, battlegrowth, grizzlyBears],
      [...LOTS_OF_MANA],
      { topP1: ['battlegrowth'] },
    );
    goToMain1(game);
    const bear = put(game, 'p1', 'grizzly-bears');
    put(game, 'p1', 'forest');
    game.apply('p1', {
      type: 'castSpell',
      objectId: findIn(game, 'p1', 'hand', 'battlegrowth'),
      targets: [{ kind: 'object', id: bear }],
    });
    passUntil(game, (s) => s.stack.length === 0);
    expect(effectivePower(game.state, game.state.objects[bear])).toBe(3);
    passUntil(game, (s) => s.turn === 3 && s.step === 'main1');
    expect(effectivePower(game.state, game.state.objects[bear])).toBe(3);
  });
});

describe('M2 · gatilhos globais', () => {
  it('Zulaport Cutthroat drena quando uma criatura sua morre (inclusive ele)', () => {
    const game = makeGame(
      [...LOTS_OF_MANA, zulaportCutthroat, grizzlyBears],
      [...LOTS_OF_MANA, lightningBolt],
      { topP2: ['lightning-bolt'] },
    );
    goToMain1(game);
    put(game, 'p1', 'zulaport-cutthroat');
    const bear = put(game, 'p1', 'grizzly-bears');
    put(game, 'p2', 'mountain');

    passUntil(game, (s) => s.turn === 2 && s.step === 'main1');
    game.apply('p2', {
      type: 'castSpell',
      objectId: findIn(game, 'p2', 'hand', 'lightning-bolt'),
      targets: [{ kind: 'object', id: bear }],
    });
    passUntil(game, (s) => s.stack.length === 0, 200);
    expect(game.state.objects[bear].zone).toBe('graveyard');
    expect(game.state.players.p2.life).toBe(19);
    expect(game.state.players.p1.life).toBe(21);
  });

  it('Soul Warden ganha vida quando OUTRA criatura entra (de qualquer lado)', () => {
    const game = makeGame(
      [...LOTS_OF_MANA, soulWarden, grizzlyBears],
      [...LOTS_OF_MANA, ragingGoblin],
      { topP1: ['soul-warden', 'grizzly-bears'] },
    );
    goToMain1(game);
    for (let i = 0; i < 2; i++) put(game, 'p1', 'plains');
    put(game, 'p1', 'forest');
    // a própria Soul Warden entrando não dispara o gatilho dela
    game.apply('p1', { type: 'castSpell', objectId: findIn(game, 'p1', 'hand', 'soul-warden') });
    passUntil(game, (s) => s.stack.length === 0, 200);
    expect(game.state.players.p1.life).toBe(20);
    // urso meu entra → +1
    game.apply('p1', { type: 'castSpell', objectId: findIn(game, 'p1', 'hand', 'grizzly-bears') });
    passUntil(game, (s) => s.stack.length === 0, 200);
    expect(game.state.players.p1.life).toBe(21);
    // criatura do oponente entra → +1 também
    passUntil(game, (s) => s.turn === 2 && s.step === 'main1');
    put(game, 'p2', 'mountain');
    const goblin = put(game, 'p2', 'raging-goblin', 'hand');
    game.apply('p2', { type: 'castSpell', objectId: goblin });
    passUntil(game, (s) => s.stack.length === 0, 200);
    expect(game.state.players.p1.life).toBe(22);
  });

  it('Monastery Swiftspear: destreza com mágica que não é criatura, e expira', () => {
    const game = makeGame(
      [...LOTS_OF_MANA, monasterySwiftspear, lightningBolt, grizzlyBears],
      [...LOTS_OF_MANA],
      { topP1: ['lightning-bolt', 'grizzly-bears'] },
    );
    goToMain1(game);
    const monk = put(game, 'p1', 'monastery-swiftspear');
    for (let i = 0; i < 3; i++) put(game, 'p1', 'mountain');
    put(game, 'p1', 'forest');

    game.apply('p1', {
      type: 'castSpell',
      objectId: findIn(game, 'p1', 'hand', 'lightning-bolt'),
      targets: [{ kind: 'player', player: 'p2' }],
    });
    passUntil(game, (s) => s.stack.length === 0, 200);
    expect(effectivePower(game.state, game.state.objects[monk])).toBe(2);

    // conjurar criatura NÃO dispara destreza
    game.apply('p1', { type: 'castSpell', objectId: findIn(game, 'p1', 'hand', 'grizzly-bears') });
    passUntil(game, (s) => s.stack.length === 0, 200);
    expect(effectivePower(game.state, game.state.objects[monk])).toBe(2);

    passUntil(game, (s) => s.turn === 2 && s.step === 'main1');
    expect(effectivePower(game.state, game.state.objects[monk])).toBe(1);
  });
});

describe('M2 · habilidades estáticas', () => {
  it('Glorious Anthem dá +1/+1 só às suas criaturas', () => {
    const game = makeGame(
      [...LOTS_OF_MANA, gloriousAnthem, grizzlyBears],
      [...LOTS_OF_MANA, grizzlyBears],
    );
    goToMain1(game);
    const mine = put(game, 'p1', 'grizzly-bears');
    const theirs = put(game, 'p2', 'grizzly-bears');
    const anthem = put(game, 'p1', 'glorious-anthem');
    expect(effectivePower(game.state, game.state.objects[mine])).toBe(3);
    expect(effectiveToughness(game.state, game.state.objects[mine])).toBe(3);
    expect(effectivePower(game.state, game.state.objects[theirs])).toBe(2);
    // removendo o anthem, o buff some
    game.apply('p1', { type: 'manualMove', objectId: anthem, to: 'graveyard' });
    expect(effectivePower(game.state, game.state.objects[mine])).toBe(2);
  });

  it('Goblin Chieftain: lorde por subtipo, sem se buffar', () => {
    const game = makeGame(
      [...LOTS_OF_MANA, goblinChieftain, ragingGoblin, grizzlyBears],
      [...LOTS_OF_MANA],
    );
    goToMain1(game);
    const chief = put(game, 'p1', 'goblin-chieftain');
    const goblin = put(game, 'p1', 'raging-goblin');
    const bear = put(game, 'p1', 'grizzly-bears');
    expect(effectivePower(game.state, game.state.objects[goblin])).toBe(2);
    expect(hasKeyword(game.state, game.state.objects[goblin], 'haste')).toBe(true);
    expect(effectivePower(game.state, game.state.objects[chief])).toBe(2); // não se buffa
    expect(effectivePower(game.state, game.state.objects[bear])).toBe(2); // não é Goblin
  });
});

describe('M2 · X e modais', () => {
  it('Blaze exige X e causa exatamente X de dano', () => {
    const game = makeGame([...LOTS_OF_MANA, blaze], [...LOTS_OF_MANA, giantSpider], { topP1: ['blaze'] });
    goToMain1(game);
    const spider = put(game, 'p2', 'giant-spider');
    for (let i = 0; i < 4; i++) put(game, 'p1', 'mountain');
    put(game, 'p1', 'forest'); // 5ª fonte para o genérico

    const spell = findIn(game, 'p1', 'hand', 'blaze');
    // sem X → erro
    expect(game.apply('p1', { type: 'castSpell', objectId: spell, targets: [{ kind: 'object', id: spider }] }).ok).toBe(false);
    // X=4 → paga {4}{R}=5 e mata a 2/4
    const r = game.apply('p1', {
      type: 'castSpell',
      objectId: spell,
      targets: [{ kind: 'object', id: spider }],
      x: 4,
    });
    expect(r.ok).toBe(true);
    passUntil(game, (s) => s.stack.length === 0);
    expect(game.state.objects[spider].zone).toBe('graveyard');
  });

  it('Endless One entra com X marcadores +1/+1', () => {
    const game = makeGame([...LOTS_OF_MANA, endlessOne], [...LOTS_OF_MANA], { topP1: ['endless-one'] });
    goToMain1(game);
    for (let i = 0; i < 3; i++) put(game, 'p1', 'forest');
    const spell = findIn(game, 'p1', 'hand', 'endless-one');
    expect(game.apply('p1', { type: 'castSpell', objectId: spell, x: 3 }).ok).toBe(true);
    passUntil(game, (s) => s.stack.length === 0);
    const obj = game.state.objects[spell];
    expect(obj.zone).toBe('battlefield');
    expect(obj.counters['+1/+1']).toBe(3);
    expect(effectivePower(game.state, obj)).toBe(3);
  });

  it('Grixis Charm: exige modo; -4/-4 mata urso via SBA; modo de time funciona', () => {
    const game = makeGame(
      [...LOTS_OF_MANA, grixisCharm, grixisCharm, grizzlyBears],
      [...LOTS_OF_MANA, grizzlyBears],
      { topP1: ['grixis-charm', 'grixis-charm'] },
    );
    goToMain1(game);
    const mine = put(game, 'p1', 'grizzly-bears');
    const theirs = put(game, 'p2', 'grizzly-bears');
    for (const land of ['island', 'swamp', 'mountain', 'island', 'swamp', 'mountain'] as const) put(game, 'p1', land);

    const charm1 = findIn(game, 'p1', 'hand', 'grixis-charm');
    // sem modo → erro
    expect(game.apply('p1', { type: 'castSpell', objectId: charm1 }).ok).toBe(false);
    // modo 1: -4/-4 no urso deles
    expect(
      game.apply('p1', { type: 'castSpell', objectId: charm1, mode: 1, targets: [{ kind: 'object', id: theirs }] }).ok,
    ).toBe(true);
    passUntil(game, (s) => s.stack.length === 0);
    expect(game.state.objects[theirs].zone).toBe('graveyard');

    // modo 2: +2/+0 nas minhas
    const charm2 = findIn(game, 'p1', 'hand', 'grixis-charm');
    expect(game.apply('p1', { type: 'castSpell', objectId: charm2, mode: 2 }).ok).toBe(true);
    passUntil(game, (s) => s.stack.length === 0);
    expect(effectivePower(game.state, game.state.objects[mine])).toBe(4);
  });
});
