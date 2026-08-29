/** M4: landfall, lifegain, tutores p/ topo, wheels, Duress, kicker, flashback,
 * cycling, custos de habilidade, regeneração, proteção, uncounterable,
 * reanimação e planeswalkers. */
import { describe, expect, it } from 'vitest';
import {
  ajanisPridemate,
  alleyStrangler,
  arguelsBloodFast,
  burstLightning,
  cancel,
  drudgeSkeletons,
  duress,
  forest,
  grazingGladehart,
  grizzlyBears,
  island,
  jaceBeleren,
  lightningBolt,
  mountain,
  murder,
  mysticalTutor,
  plains,
  preyUpon,
  supremeVerdict,
  swamp,
  thinkTwice,
  tranquilThicket,
  vampiricTutor,
  visceraSeer,
  wheelOfFortune,
  whiteKnight,
  zombify,
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

describe('M4 · landfall e ganho de vida', () => {
  it('Grazing Gladehart ganha 2 de vida quando um terreno SEU entra', () => {
    const game = makeGame([...MANA, grazingGladehart, forest], MANA, { topP1: ['forest'] });
    goToMain1(game);
    put(game, 'p1', 'grazing-gladehart');
    const land = findIn(game, 'p1', 'hand', 'forest');
    game.apply('p1', { type: 'playLand', objectId: land });
    passUntil(game, (s) => s.stack.length === 0, 100);
    expect(game.state.players.p1.life).toBe(22);
  });

  it("Ajani's Pridemate cresce com cada ganho de vida", () => {
    const game = makeGame([...MANA, ajanisPridemate, grazingGladehart, forest], MANA, { topP1: ['forest'] });
    goToMain1(game);
    const cat = put(game, 'p1', 'ajanis-pridemate');
    put(game, 'p1', 'grazing-gladehart');
    game.apply('p1', { type: 'playLand', objectId: findIn(game, 'p1', 'hand', 'forest') });
    // landfall ganha 2 → pridemate dispara e ganha marcador
    passUntil(game, (s) => s.stack.length === 0, 100);
    expect(game.state.players.p1.life).toBe(22);
    expect(effectivePower(game.state, game.state.objects[cat])).toBe(3);
  });
});

describe('M4 · tutores para o topo, wheel e Duress', () => {
  it('Mystical Tutor: só instantâneas/feitiços, escolhida vai para o topo', () => {
    const game = makeGame([...MANA, mysticalTutor, lightningBolt, grizzlyBears], MANA, { topP1: ['mystical-tutor'] });
    goToMain1(game);
    put(game, 'p1', 'island');
    const bolt = put(game, 'p1', 'lightning-bolt', 'library');
    put(game, 'p1', 'grizzly-bears', 'library');
    game.apply('p1', { type: 'castSpell', objectId: findIn(game, 'p1', 'hand', 'mystical-tutor') });
    passUntil(game, (s) => s.pendingDecision !== null, 100);
    const pending = game.state.pendingDecision!;
    if (pending.type !== 'effectChoice') throw new Error('esperava busca');
    const optionCards = pending.options.map((id) => game.state.objects[id].card);
    expect(optionCards.every((c) => c.types.includes('Instant') || c.types.includes('Sorcery'))).toBe(true);
    game.apply('p1', { type: 'effectChoice', picks: [bolt] });
    expect(game.state.players.p1.zones.library[0]).toBe(bolt);
    expect(game.state.objects[bolt].zone).toBe('library');
  });

  it('Vampiric Tutor: qualquer carta para o topo, perdendo 2 vidas', () => {
    const game = makeGame([...MANA, vampiricTutor, grizzlyBears], MANA, { topP1: ['vampiric-tutor'] });
    goToMain1(game);
    put(game, 'p1', 'swamp');
    const bear = put(game, 'p1', 'grizzly-bears', 'library');
    game.apply('p1', { type: 'castSpell', objectId: findIn(game, 'p1', 'hand', 'vampiric-tutor') });
    passUntil(game, (s) => s.pendingDecision !== null, 100);
    game.apply('p1', { type: 'effectChoice', picks: [bear] });
    expect(game.state.players.p1.zones.library[0]).toBe(bear);
    expect(game.state.players.p1.life).toBe(18);
  });

  it('Wheel of Fortune: todo mundo descarta a mão e compra 7', () => {
    const game = makeGame([...MANA, wheelOfFortune, ...copies(mountain, 8)], [...MANA, ...copies(forest, 8)], {
      topP1: ['wheel-of-fortune'],
    });
    goToMain1(game);
    for (let i = 0; i < 3; i++) put(game, 'p1', 'mountain');
    const p1HandBefore = game.state.players.p1.zones.hand.length; // inclui a wheel
    const p2HandBefore = game.state.players.p2.zones.hand.length;
    game.apply('p1', { type: 'castSpell', objectId: findIn(game, 'p1', 'hand', 'wheel-of-fortune') });
    passUntil(game, (s) => s.stack.length === 0, 100);
    expect(game.state.players.p1.zones.hand).toHaveLength(7);
    expect(game.state.players.p2.zones.hand).toHaveLength(7);
    // os descartes foram para os cemitérios (menos a própria wheel, que resolve depois)
    expect(game.state.players.p1.zones.graveyard.length).toBe(p1HandBefore - 1 + 1);
    expect(game.state.players.p2.zones.graveyard.length).toBe(p2HandBefore);
  });

  it('Duress: o conjurador escolhe, e só entre cartas não-criatura/não-terreno', () => {
    const game = makeGame(
      [...MANA, duress],
      [...copies(swamp, 10), ...copies(grizzlyBears, 5), ...copies(cancel, 5)],
      { topP1: ['duress'], topP2: ['grizzly-bears', 'cancel', 'swamp', 'cancel', 'grizzly-bears', 'swamp', 'swamp'] },
    );
    goToMain1(game);
    put(game, 'p1', 'swamp');
    game.apply('p1', {
      type: 'castSpell',
      objectId: findIn(game, 'p1', 'hand', 'duress'),
      targets: [{ kind: 'player', player: 'p2' }],
    });
    passUntil(game, (s) => s.pendingDecision !== null, 100);
    const pending = game.state.pendingDecision!;
    if (pending.type !== 'effectChoice') throw new Error('esperava escolha');
    expect(pending.player).toBe('p1'); // o CONJURADOR escolhe
    const optionCards = pending.options.map((id) => game.state.objects[id].card);
    expect(optionCards.every((c) => !c.types.includes('Creature') && !c.types.includes('Land'))).toBe(true);
    expect(optionCards.length).toBe(2); // os dois Cancel
    game.apply('p1', { type: 'effectChoice', picks: [pending.options[0]] });
    expect(game.state.players.p2.zones.graveyard).toHaveLength(1);
  });
});

describe('M4 · kicker, flashback e cycling', () => {
  it('Burst Lightning: 2 sem kicker, 4 com kicker (e custo maior)', () => {
    const game = makeGame([...MANA, burstLightning, burstLightning], MANA, {
      topP1: ['burst-lightning', 'burst-lightning'],
    });
    goToMain1(game);
    put(game, 'p1', 'mountain');
    game.apply('p1', {
      type: 'castSpell',
      objectId: findIn(game, 'p1', 'hand', 'burst-lightning'),
      targets: [{ kind: 'player', player: 'p2' }],
    });
    passUntil(game, (s) => s.stack.length === 0);
    expect(game.state.players.p2.life).toBe(18);

    // com kicker: {R} + {4} = 5 fontes; com só 1 montanha falha
    const second = findIn(game, 'p1', 'hand', 'burst-lightning');
    expect(
      game.apply('p1', { type: 'castSpell', objectId: second, targets: [{ kind: 'player', player: 'p2' }], kicked: true }).ok,
    ).toBe(false);
    for (let i = 0; i < 3; i++) put(game, 'p1', 'mountain');
    put(game, 'p1', 'forest');
    put(game, 'p1', 'island'); // 5ª fonte desvirada (a 1ª montanha ficou virada)
    expect(
      game.apply('p1', { type: 'castSpell', objectId: second, targets: [{ kind: 'player', player: 'p2' }], kicked: true }).ok,
    ).toBe(true);
    passUntil(game, (s) => s.stack.length === 0);
    expect(game.state.players.p2.life).toBe(14);
  });

  it('Think Twice: flashback conjura do cemitério e exila', () => {
    const game = makeGame([...MANA, thinkTwice], MANA, { topP1: ['think-twice'] });
    goToMain1(game);
    for (let i = 0; i < 4; i++) put(game, 'p1', 'island');
    put(game, 'p1', 'forest'); // 5ª fonte: {1}{U} + flashback {2}{U} no mesmo turno
    const card = findIn(game, 'p1', 'hand', 'think-twice');
    game.apply('p1', { type: 'castSpell', objectId: card });
    passUntil(game, (s) => s.stack.length === 0);
    expect(game.state.objects[card].zone).toBe('graveyard');

    const handBefore = game.state.players.p1.zones.hand.length;
    expect(game.apply('p1', { type: 'castSpell', objectId: card }).ok).toBe(true); // flashback {2}{U}
    passUntil(game, (s) => s.stack.length === 0);
    expect(game.state.objects[card].zone).toBe('exile');
    expect(game.state.players.p1.zones.hand.length).toBe(handBefore + 1);
  });

  it('Tranquil Thicket: entra virada e recicla por {G}', () => {
    const game = makeGame([...MANA, tranquilThicket, tranquilThicket], MANA, {
      topP1: ['tranquil-thicket', 'tranquil-thicket'],
    });
    goToMain1(game);
    const land = findIn(game, 'p1', 'hand', 'tranquil-thicket');
    game.apply('p1', { type: 'playLand', objectId: land });
    expect(game.state.objects[land].tapped).toBe(true);

    put(game, 'p1', 'forest');
    const second = findIn(game, 'p1', 'hand', 'tranquil-thicket');
    const handBefore = game.state.players.p1.zones.hand.length;
    expect(game.apply('p1', { type: 'cycle', objectId: second }).ok).toBe(true);
    expect(game.state.objects[second].zone).toBe('graveyard');
    expect(game.state.players.p1.zones.hand.length).toBe(handBefore); // -1 reciclada, +1 comprada
  });
});

describe('M4 · custos de habilidade e regeneração', () => {
  it('Viscera Seer: sacrifica uma criatura como custo e faz vidência', () => {
    const game = makeGame([...MANA, visceraSeer, grizzlyBears], MANA);
    goToMain1(game);
    const seer = put(game, 'p1', 'viscera-seer');
    const bear = put(game, 'p1', 'grizzly-bears');
    const r = game.apply('p1', { type: 'activateAbility', objectId: seer, abilityIndex: 0, sacrifices: [bear] });
    expect(r.ok).toBe(true);
    expect(game.state.objects[bear].zone).toBe('graveyard');
    passUntil(game, (s) => s.pendingDecision !== null, 100);
    expect(game.state.pendingDecision?.type).toBe('effectChoice'); // a vidência
  });

  it("Arguel's Blood Fast: paga 2 vidas para comprar", () => {
    const game = makeGame([...MANA, arguelsBloodFast], MANA);
    goToMain1(game);
    const fast = put(game, 'p1', 'arguels-blood-fast');
    put(game, 'p1', 'swamp');
    put(game, 'p1', 'island');
    const handBefore = game.state.players.p1.zones.hand.length;
    expect(game.apply('p1', { type: 'activateAbility', objectId: fast, abilityIndex: 0 }).ok).toBe(true);
    passUntil(game, (s) => s.stack.length === 0);
    expect(game.state.players.p1.life).toBe(18);
    expect(game.state.players.p1.zones.hand.length).toBe(handBefore + 1);
  });

  it('Drudge Skeletons regenera: sobrevive ao Bolt virado e sem dano', () => {
    const game = makeGame(
      [...MANA, drudgeSkeletons],
      [...MANA, lightningBolt],
      { topP2: ['lightning-bolt'] },
    );
    goToMain1(game);
    const skeletons = put(game, 'p1', 'drudge-skeletons');
    put(game, 'p1', 'swamp');

    passUntil(game, (s) => s.turn === 2 && s.step === 'main1');
    put(game, 'p2', 'mountain');
    game.apply('p2', {
      type: 'castSpell',
      objectId: findIn(game, 'p2', 'hand', 'lightning-bolt'),
      targets: [{ kind: 'object', id: skeletons }],
    });
    // em resposta ao Bolt, p1 regenera (o escudo dura até o fim do turno)
    game.apply('p2', { type: 'passPriority' });
    expect(game.apply('p1', { type: 'activateAbility', objectId: skeletons, abilityIndex: 0 }).ok).toBe(true);
    passUntil(game, (s) => s.stack.length === 0, 200);
    expect(game.state.objects[skeletons].zone).toBe('battlefield');
    expect(game.state.objects[skeletons].tapped).toBe(true);
    expect(game.state.objects[skeletons].damage).toBe(0);
  });
});

describe('M4 · proteção e uncounterable', () => {
  it('White Knight: proteção contra preto — alvo, bloqueio e dano', () => {
    const game = makeGame(
      [...MANA, whiteKnight, preyUpon],
      [...MANA, murder, alleyStrangler],
      { topP1: ['white-knight', 'prey-upon'] },
    );
    goToMain1(game);
    const knight = put(game, 'p1', 'white-knight');
    const strangler = put(game, 'p2', 'alley-strangler');
    put(game, 'p1', 'forest');

    // Murder (preta) não pode alvejar o cavaleiro
    passUntil(game, (s) => s.turn === 2 && s.step === 'main1');
    for (let i = 0; i < 3; i++) put(game, 'p2', 'swamp');
    const murderCard = put(game, 'p2', 'murder', 'hand');
    expect(
      game.apply('p2', {
        type: 'castSpell',
        objectId: murderCard,
        targets: [{ kind: 'object', id: knight }],
      }).ok,
    ).toBe(false);

    // luta: o dano da criatura preta é prevenido; o do cavaleiro não
    passUntil(game, (s) => s.turn === 3 && s.step === 'main1');
    game.apply('p1', {
      type: 'castSpell',
      objectId: findIn(game, 'p1', 'hand', 'prey-upon'),
      targets: [
        { kind: 'object', id: knight },
        { kind: 'object', id: strangler },
      ],
    });
    passUntil(game, (s) => s.stack.length === 0, 200);
    expect(game.state.objects[knight].damage).toBe(0); // prevenido
    expect(game.state.objects[strangler].damage).toBe(2);

    // atacando, não pode ser bloqueado por criatura preta
    passUntil(game, (s) => s.turn === 5 && s.combatAwaiting === 'attackers', 300);
    game.apply('p1', { type: 'declareAttackers', attackers: [knight] });
    passUntil(game, (s) => s.combatAwaiting === 'blockers');
    expect(
      game.apply('p2', { type: 'declareBlockers', blocks: [{ blocker: strangler, attacker: knight }] }).ok,
    ).toBe(false);
  });

  it('Supreme Verdict não pode ser anulada', () => {
    const game = makeGame(
      [...MANA, supremeVerdict, grizzlyBears],
      [...MANA, cancel],
      { topP1: ['supreme-verdict'], topP2: ['cancel'] },
    );
    goToMain1(game);
    const bear = put(game, 'p1', 'grizzly-bears');
    for (let i = 0; i < 2; i++) put(game, 'p1', 'plains');
    for (let i = 0; i < 2; i++) put(game, 'p1', 'island');
    for (let i = 0; i < 3; i++) put(game, 'p2', 'island');

    const verdict = findIn(game, 'p1', 'hand', 'supreme-verdict');
    game.apply('p1', { type: 'castSpell', objectId: verdict });
    game.apply('p1', { type: 'passPriority' });
    expect(
      game.apply('p2', {
        type: 'castSpell',
        objectId: findIn(game, 'p2', 'hand', 'cancel'),
        targets: [{ kind: 'object', id: verdict }],
      }).ok,
    ).toBe(true);
    passUntil(game, (s) => s.stack.length === 0, 200);
    // o Cancel resolveu sem efeito; o Verdict resolveu e limpou o campo
    expect(game.state.objects[bear].zone).toBe('graveyard');
  });
});

describe('M4 · reanimação e planeswalkers', () => {
  it('Zombify devolve a criatura do cemitério direto para o campo', () => {
    const game = makeGame([...MANA, zombify, grizzlyBears], MANA, { topP1: ['zombify'] });
    goToMain1(game);
    const bear = put(game, 'p1', 'grizzly-bears', 'graveyard');
    for (let i = 0; i < 4; i++) put(game, 'p1', 'swamp');
    game.apply('p1', {
      type: 'castSpell',
      objectId: findIn(game, 'p1', 'hand', 'zombify'),
      targets: [{ kind: 'object', id: bear }],
    });
    passUntil(game, (s) => s.stack.length === 0);
    expect(game.state.objects[bear].zone).toBe('battlefield');
    expect(game.state.objects[bear].controller).toBe('p1');
  });

  it('Jace Beleren: lealdade, limite por turno, alvo e morte em combate', () => {
    const game = makeGame(
      [...MANA, jaceBeleren],
      [...MANA, grizzlyBears],
      { topP1: ['jace-beleren'] },
    );
    goToMain1(game);
    for (let i = 0; i < 3; i++) put(game, 'p1', 'island');
    const jace = findIn(game, 'p1', 'hand', 'jace-beleren');
    game.apply('p1', { type: 'castSpell', objectId: jace });
    passUntil(game, (s) => s.stack.length === 0);
    expect(game.state.objects[jace].zone).toBe('battlefield');
    expect(game.state.objects[jace].counters['loyalty']).toBe(3);

    // +2: cada jogador compra; lealdade 5
    const p1Hand = game.state.players.p1.zones.hand.length;
    expect(game.apply('p1', { type: 'activateAbility', objectId: jace, abilityIndex: 0 }).ok).toBe(true);
    passUntil(game, (s) => s.stack.length === 0);
    expect(game.state.objects[jace].counters['loyalty']).toBe(5);
    expect(game.state.players.p1.zones.hand.length).toBe(p1Hand + 1);

    // segunda ativação no mesmo turno → recusada
    expect(game.apply('p1', { type: 'activateAbility', objectId: jace, abilityIndex: 1, targets: [{ kind: 'player', player: 'p1' }] }).ok).toBe(false);

    // próximo turno meu: −1 no jogador alvo
    passUntil(game, (s) => s.turn === 3 && s.step === 'main1', 300);
    expect(
      game.apply('p1', { type: 'activateAbility', objectId: jace, abilityIndex: 1, targets: [{ kind: 'player', player: 'p1' }] }).ok,
    ).toBe(true);
    passUntil(game, (s) => s.stack.length === 0);
    expect(game.state.objects[jace].counters['loyalty']).toBe(4);

    // p2 ataca o Jace com um urso: lealdade cai; repetindo, morre
    passUntil(game, (s) => s.turn === 4 && s.step === 'main1', 300);
    const bear = put(game, 'p2', 'grizzly-bears');
    game.state.objects[bear].summoningSick = false; // setup: pronto para atacar
    passUntil(game, (s) => s.turn === 4 && s.combatAwaiting === 'attackers', 300);
    game.apply('p2', { type: 'declareAttackers', attackers: [bear], defendTarget: jace });
    passUntil(game, (s) => s.combatAwaiting === 'blockers');
    game.apply('p1', { type: 'declareBlockers', blocks: [] });
    passUntil(game, (s) => s.turn === 4 && s.step === 'main2', 300);
    expect(game.state.objects[jace].counters['loyalty']).toBe(2);
    expect(game.state.players.p1.life).toBe(20); // o dano foi no Jace, não no jogador

    passUntil(game, (s) => s.turn === 6 && s.combatAwaiting === 'attackers', 400);
    game.apply('p2', { type: 'declareAttackers', attackers: [bear], defendTarget: jace });
    passUntil(game, (s) => s.combatAwaiting === 'blockers');
    game.apply('p1', { type: 'declareBlockers', blocks: [] });
    passUntil(game, (s) => s.turn === 6 && s.step === 'main2', 300);
    expect(game.state.objects[jace].zone).toBe('graveyard'); // 2 - 2 = 0 → SBA
  });
});
