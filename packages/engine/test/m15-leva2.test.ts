/** M15 (Leva 2): mecânicas de conjuração — evoke, dash, escape, foretell, buyback, squad, morph, unearth, affinity, delve, suspend, rebound, scavenge, embalm, cascade. */
import { describe, expect, it } from 'vitest';
import { compileOracleCard, type OracleInput } from '../src/cards/oracle-parser.js';
import { forest, grizzlyBears, island, mountain, plains, swamp } from '../src/cards/demo-set.js';
import type { CardDefinition } from '../src/cards/types.js';
import type { Game } from '../src/game.js';
import type { PlayerId } from '../src/types.js';
import { effectivePower, hasKeyword } from '../src/state.js';
import { findIn, goToMain1, makeGame, passUntil } from './helpers.js';

const mk = (input: OracleInput): CardDefinition => {
  const def = compileOracleCard(input);
  if (!def) throw new Error(`não compilou: ${input.name}`);
  return def;
};
const copies = (card: CardDefinition, n: number) => Array.from({ length: n }, () => card);
function put(game: Game, player: PlayerId, cardId: string, zone: 'battlefield' | 'graveyard' | 'hand' = 'battlefield'): number {
  let id: number;
  try { id = findIn(game, player, 'library', cardId); } catch { id = findIn(game, player, 'hand', cardId); }
  const r = game.apply(player, { type: 'manualMove', objectId: id, to: zone });
  if (!r.ok) throw new Error(`setup falhou: ${cardId} → ${zone}`);
  return id;
}
const FILLER = [...copies(mountain, 6), ...copies(forest, 6), ...copies(island, 6), ...copies(plains, 6), ...copies(swamp, 4)];
const settle = (game: Game) => passUntil(game, (s) => s.stack.length === 0 && s.triggerQueue.length === 0 && s.pendingDecision === null);

const evoker = mk({ name: 'Evoke Bear', manaCost: '{2}{G}{G}', typeLine: 'Creature — Bear', power: 3, toughness: 3, colors: ['G'], oracleText: 'Evoke {G}\nWhen Evoke Bear enters, draw a card.' });
const dasher = mk({ name: 'Dash Bear', manaCost: '{2}{R}', typeLine: 'Creature — Bear', power: 2, toughness: 1, colors: ['R'], oracleText: 'Dash {1}{R}' });
const escaper = mk({ name: 'Escape Bear', manaCost: '{1}{B}', typeLine: 'Creature — Bear', power: 2, toughness: 2, colors: ['B'], oracleText: 'Escape—{2}{B}, Exile three other cards from your graveyard.' });
const foreteller = mk({ name: 'Foretold Draw', manaCost: '{2}{U}', typeLine: 'Instant', colors: ['U'], oracleText: 'Foretell {U}\nDraw two cards.' });
const buybacker = mk({ name: 'Buyback Gain', manaCost: '{W}', typeLine: 'Instant', colors: ['W'], oracleText: 'Buyback {3}\nYou gain 2 life.' });
const squadder = mk({ name: 'Squad Bear', manaCost: '{1}{W}', typeLine: 'Creature — Bear', power: 1, toughness: 1, colors: ['W'], oracleText: 'Squad {2}' });
const morpher = mk({ name: 'Morph Bear', manaCost: '{3}{G}{G}', typeLine: 'Creature — Bear', power: 4, toughness: 4, colors: ['G'], oracleText: 'Morph {2}{G}' });
const unearther = mk({ name: 'Unearth Bear', manaCost: '{2}{R}', typeLine: 'Creature — Bear', power: 3, toughness: 1, colors: ['R'], oracleText: 'Unearth {1}{R}' });
const affine = mk({ name: 'Affinity Golem', manaCost: '{4}', typeLine: 'Artifact Creature — Golem', power: 2, toughness: 2, oracleText: 'Affinity for artifacts' });
const dud = mk({ name: 'Dud', manaCost: '{0}', typeLine: 'Artifact', oracleText: '' });
const delver = mk({ name: 'Delve Draw', manaCost: '{5}{U}', typeLine: 'Sorcery', colors: ['U'], oracleText: 'Delve\nDraw two cards.' });
const suspender = mk({ name: 'Suspend Draw', manaCost: '{3}{U}', typeLine: 'Sorcery', colors: ['U'], oracleText: 'Suspend 1—{U}\nDraw two cards.' });
const rebounder = mk({ name: 'Rebound Gain', manaCost: '{W}', typeLine: 'Sorcery', colors: ['W'], oracleText: 'Rebound\nYou gain 3 life.' });
const scavenger = mk({ name: 'Scavenge Bear', manaCost: '{2}{G}', typeLine: 'Creature — Bear', power: 3, toughness: 3, colors: ['G'], oracleText: 'Scavenge {1}{G}' });
const embalmer = mk({ name: 'Embalm Human', manaCost: '{1}{W}', typeLine: 'Creature — Human', power: 2, toughness: 2, colors: ['W'], oracleText: 'Embalm {2}{W}' });
const cascader = mk({ name: 'Cascade Draw', manaCost: '{2}{R}{G}', typeLine: 'Sorcery', colors: ['R', 'G'], oracleText: 'Cascade\nDraw a card.' });
const ninja = mk({ name: 'Ninja Bear', manaCost: '{3}{U}', typeLine: 'Creature — Ninja', power: 2, toughness: 2, colors: ['U'], oracleText: 'Ninjutsu {1}{U}' });

describe('M15 · compilação', () => {
  it('tudo compila como full', () => {
    for (const c of [evoker, dasher, escaper, foreteller, buybacker, squadder, morpher, unearther, affine, dud, delver, suspender, rebounder, scavenger, embalmer, cascader, ninja])
      expect(c.automation, `${c.name}: ${c.automationNotes?.join(' | ')}`).toBe('full');
    expect(evoker.castMethods?.[0]).toMatchObject({ kind: 'evoke', cost: '{G}' });
    expect(escaper.castMethods?.[0]).toMatchObject({ kind: 'escape', cost: '{2}{B}', exileFromGraveyard: 3 });
    expect(foreteller.abilities?.[0]).toMatchObject({ kind: 'activated', zone: 'hand' });
    expect(buybacker.buyback).toBe('{3}');
    expect(squadder.kicker?.cost).toBe('{2}');
    expect(squadder.multikicker).toBe(true);
    expect(morpher.morph?.cost).toBe('{2}{G}');
    expect(unearther.abilities?.[0]).toMatchObject({ kind: 'activated', zone: 'graveyard' });
    expect(affine.affinity).toBe('artifact');
    expect(delver.delve).toBe(true);
    expect(suspender.suspend).toEqual({ count: 1, cost: '{U}' });
    expect(rebounder.rebound).toBe(true);
    expect(cascader.cascade).toBe(true);
    expect(ninja.ninjutsu).toBe('{1}{U}');
  });
});

describe('M15 · conjuração alternativa', () => {
  it('evoke: entra, gatilho de entrada resolve, e a criatura é sacrificada', () => {
    const game = makeGame([...FILLER, evoker], FILLER, { topP1: [evoker.id] });
    goToMain1(game);
    put(game, 'p1', 'forest');
    const before = game.state.players.p1.zones.hand.length;
    const id = findIn(game, 'p1', 'hand', evoker.id);
    expect(game.apply('p1', { type: 'castSpell', objectId: id, method: 'evoke' }).ok).toBe(true);
    settle(game);
    expect(game.state.objects[id].zone).toBe('graveyard');
    expect(game.state.players.p1.zones.hand.length).toBe(before); // -1 conjurada, +1 comprada
  });

  it('dash: entra com ímpeto e volta para a mão no fim do turno', () => {
    const game = makeGame([...FILLER, dasher], FILLER, { topP1: [dasher.id] });
    goToMain1(game);
    put(game, 'p1', 'mountain'); put(game, 'p1', 'mountain');
    const id = findIn(game, 'p1', 'hand', dasher.id);
    expect(game.apply('p1', { type: 'castSpell', objectId: id, method: 'dash' }).ok).toBe(true);
    settle(game);
    expect(game.state.objects[id].zone).toBe('battlefield');
    expect(hasKeyword(game.state, game.state.objects[id], 'haste')).toBe(true);
    passUntil(game, (s) => s.turn === 2);
    expect(game.state.objects[id].zone).toBe('hand');
  });

  it('escape: conjura do cemitério exilando três outras cartas', () => {
    const game = makeGame([...FILLER, escaper], FILLER, { topP1: [escaper.id] });
    goToMain1(game);
    const id = put(game, 'p1', escaper.id, 'graveyard');
    const fodder = [put(game, 'p1', 'mountain', 'graveyard'), put(game, 'p1', 'mountain', 'graveyard'), put(game, 'p1', 'forest', 'graveyard')];
    put(game, 'p1', 'swamp'); put(game, 'p1', 'swamp'); put(game, 'p1', 'swamp');
    expect(game.apply('p1', { type: 'castSpell', objectId: id, method: 'escape', escapeExile: fodder }).ok).toBe(true);
    settle(game);
    expect(game.state.objects[id].zone).toBe('battlefield');
    for (const f of fodder) expect(game.state.objects[f].zone).toBe('exile');
  });

  it('foretell: exila da mão por {2}; conjura num turno seguinte pelo custo de prever', () => {
    const game = makeGame([...FILLER, foreteller], FILLER, { topP1: [foreteller.id] });
    goToMain1(game);
    put(game, 'p1', 'island'); put(game, 'p1', 'island');
    const id = findIn(game, 'p1', 'hand', foreteller.id);
    expect(game.apply('p1', { type: 'activateAbility', objectId: id, abilityIndex: 0 }).ok).toBe(true);
    settle(game);
    expect(game.state.objects[id].zone).toBe('exile');
    expect(game.state.objects[id].exiledAs).toBe('foretold');
    // mesmo turno: não pode
    put(game, 'p1', 'island');
    expect(game.apply('p1', { type: 'castSpell', objectId: id, method: 'foretold' }).ok).toBe(false);
    passUntil(game, (s) => s.turn === 3 && s.step === 'main1' && s.priority === 'p1' && s.stack.length === 0);
    const before = game.state.players.p1.zones.hand.length;
    expect(game.apply('p1', { type: 'castSpell', objectId: id, method: 'foretold' }).ok).toBe(true);
    settle(game);
    expect(game.state.players.p1.zones.hand.length).toBe(before + 2);
  });

  it('buyback: pagando {3} a mais, a mágica volta para a mão', () => {
    const game = makeGame([...FILLER, buybacker], FILLER, { topP1: [buybacker.id] });
    goToMain1(game);
    for (let i = 0; i < 4; i++) put(game, 'p1', 'plains');
    const id = findIn(game, 'p1', 'hand', buybacker.id);
    expect(game.apply('p1', { type: 'castSpell', objectId: id, buyback: true }).ok).toBe(true);
    settle(game);
    expect(game.state.players.p1.life).toBe(22);
    expect(game.state.objects[id].zone).toBe('hand');
  });

  it('squad (multikicker): duas cópias-ficha ao pagar duas vezes', () => {
    const game = makeGame([...FILLER, squadder], FILLER, { topP1: [squadder.id] });
    goToMain1(game);
    for (let i = 0; i < 6; i++) put(game, 'p1', 'plains');
    const id = findIn(game, 'p1', 'hand', squadder.id);
    expect(game.apply('p1', { type: 'castSpell', objectId: id, kicked: true, kickerTimes: 2 }).ok).toBe(true);
    settle(game);
    const bears = game.state.players.p1.zones.battlefield.map((o) => game.state.objects[o]).filter((o) => o.card.name === squadder.name);
    expect(bears).toHaveLength(3);
    expect(bears.filter((b) => b.isToken)).toHaveLength(2);
  });

  it('morph: conjura virada para baixo por {3} como 2/2; vira para cima pagando o custo', () => {
    const game = makeGame([...FILLER, morpher], FILLER, { topP1: [morpher.id] });
    goToMain1(game);
    for (let i = 0; i < 3; i++) put(game, 'p1', 'forest');
    const id = findIn(game, 'p1', 'hand', morpher.id);
    expect(game.apply('p1', { type: 'castSpell', objectId: id, faceDown: true }).ok).toBe(true);
    settle(game);
    const obj = game.state.objects[id];
    expect(obj.zone).toBe('battlefield');
    expect(obj.faceDown).toBe(true);
    expect(effectivePower(game.state, obj)).toBe(2);
    for (let i = 0; i < 3; i++) put(game, 'p1', 'forest');
    expect(game.apply('p1', { type: 'turnFaceUp', objectId: id }).ok).toBe(true);
    expect(obj.faceDown).toBeFalsy();
    expect(effectivePower(game.state, obj)).toBe(4);
  });

  it('unearth: volta do cemitério com ímpeto e é exilada no fim do turno', () => {
    const game = makeGame([...FILLER, unearther], FILLER, { topP1: [unearther.id] });
    goToMain1(game);
    const id = put(game, 'p1', unearther.id, 'graveyard');
    put(game, 'p1', 'mountain'); put(game, 'p1', 'mountain');
    expect(game.apply('p1', { type: 'activateAbility', objectId: id, abilityIndex: 0 }).ok).toBe(true);
    settle(game);
    expect(game.state.objects[id].zone).toBe('battlefield');
    expect(hasKeyword(game.state, game.state.objects[id], 'haste')).toBe(true);
    passUntil(game, (s) => s.turn === 2);
    expect(game.state.objects[id].zone).toBe('exile');
  });

  it('affinity for artifacts: {4} com três artefatos custa {1}', () => {
    const game = makeGame([...FILLER, affine, dud, dud, dud], FILLER, { topP1: [affine.id, dud.id, dud.id, dud.id] });
    goToMain1(game);
    for (let i = 0; i < 3; i++) put(game, 'p1', dud.id);
    put(game, 'p1', 'mountain');
    const id = findIn(game, 'p1', 'hand', affine.id);
    expect(game.apply('p1', { type: 'castSpell', objectId: id }).ok).toBe(true);
    settle(game);
    expect(game.state.objects[id].zone).toBe('battlefield');
  });

  it('delve: cinco cartas do cemitério pagam o genérico', () => {
    const game = makeGame([...FILLER, delver], FILLER, { topP1: [delver.id] });
    goToMain1(game);
    for (let i = 0; i < 5; i++) put(game, 'p1', 'mountain', 'graveyard');
    put(game, 'p1', 'island');
    const id = findIn(game, 'p1', 'hand', delver.id);
    const before = game.state.players.p1.zones.hand.length;
    expect(game.apply('p1', { type: 'castSpell', objectId: id }).ok).toBe(true);
    settle(game);
    expect(game.state.players.p1.zones.hand.length).toBe(before + 1);
    expect(game.state.players.p1.zones.exile.length).toBe(5);
  });

  it('suspend: exila com marcador de tempo; na manutenção seguinte é conjurada de graça', () => {
    const game = makeGame([...FILLER, suspender], FILLER, { topP1: [suspender.id] });
    goToMain1(game);
    put(game, 'p1', 'island');
    const id = findIn(game, 'p1', 'hand', suspender.id);
    expect(game.apply('p1', { type: 'castSpell', objectId: id, method: 'suspend' }).ok).toBe(true);
    expect(game.state.objects[id].zone).toBe('exile');
    expect(game.state.objects[id].counters['time']).toBe(1);
    passUntil(game, (s) => s.turn === 3 && s.step === 'main1' && s.stack.length === 0 && s.pendingDecision === null);
    expect(game.state.objects[id].zone).toBe('graveyard');
  });

  it('rebound: resolve, vai para o exílio e é conjurada de novo na manutenção seguinte', () => {
    const game = makeGame([...FILLER, rebounder], FILLER, { topP1: [rebounder.id] });
    goToMain1(game);
    put(game, 'p1', 'plains');
    const id = findIn(game, 'p1', 'hand', rebounder.id);
    expect(game.apply('p1', { type: 'castSpell', objectId: id }).ok).toBe(true);
    settle(game);
    expect(game.state.players.p1.life).toBe(23);
    expect(game.state.objects[id].zone).toBe('exile');
    expect(game.state.objects[id].exiledAs).toBe('rebound');
    passUntil(game, (s) => s.turn === 3 && s.step === 'main1' && s.stack.length === 0 && s.pendingDecision === null);
    expect(game.state.players.p1.life).toBe(26);
    expect(game.state.objects[id].zone).toBe('graveyard');
  });
});

describe('M15 · habilidades do cemitério', () => {
  it('scavenge: exila do cemitério e põe marcadores iguais ao poder', () => {
    const game = makeGame([...FILLER, scavenger, grizzlyBears], FILLER, { topP1: [scavenger.id, 'grizzly-bears'] });
    goToMain1(game);
    const id = put(game, 'p1', scavenger.id, 'graveyard');
    const bears = put(game, 'p1', 'grizzly-bears');
    put(game, 'p1', 'forest'); put(game, 'p1', 'forest');
    expect(game.apply('p1', { type: 'activateAbility', objectId: id, abilityIndex: 0, targets: [{ kind: 'object', id: bears }] }).ok).toBe(true);
    settle(game);
    expect(game.state.objects[id].zone).toBe('exile');
    expect(game.state.objects[bears].counters['+1/+1']).toBe(3);
  });

  it('embalm: cria uma cópia-ficha branca Zumbi e exila a carta', () => {
    const game = makeGame([...FILLER, embalmer], FILLER, { topP1: [embalmer.id] });
    goToMain1(game);
    const id = put(game, 'p1', embalmer.id, 'graveyard');
    for (let i = 0; i < 3; i++) put(game, 'p1', 'plains');
    expect(game.apply('p1', { type: 'activateAbility', objectId: id, abilityIndex: 0 }).ok).toBe(true);
    settle(game);
    expect(game.state.objects[id].zone).toBe('exile');
    const token = game.state.players.p1.zones.battlefield.map((o) => game.state.objects[o]).find((o) => o.isToken);
    expect(token?.card.name).toBe(embalmer.name);
    expect(token?.card.colors).toEqual(['W']);
    expect(token?.card.subtypes).toContain('Zombie');
  });
});

describe('M15 · ninjutsu', () => {
  it('troca um atacante não bloqueado pelo ninja da mão, virado e atacando', () => {
    const game = makeGame([...FILLER, ninja, grizzlyBears], FILLER, { topP1: [ninja.id, 'grizzly-bears'] });
    goToMain1(game);
    const bears = put(game, 'p1', 'grizzly-bears');
    put(game, 'p1', 'island'); put(game, 'p1', 'island');
    passUntil(game, (s) => s.turn === 3 && s.step === 'main1' && s.priority === 'p1' && s.stack.length === 0);
    game.apply('p1', { type: 'passPriority' });
    passUntil(game, (s) => s.combatAwaiting === 'attackers');
    expect(game.apply('p1', { type: 'declareAttackers', attackers: [bears] }).ok).toBe(true);
    passUntil(game, (s) => s.combatAwaiting === 'blockers');
    expect(game.apply('p2', { type: 'declareBlockers', blocks: [] }).ok).toBe(true);
    passUntil(game, (s) => s.step === 'declareBlockers' && s.priority === 'p1');
    const id = findIn(game, 'p1', 'hand', ninja.id);
    expect(game.apply('p1', { type: 'ninjutsu', objectId: id, attackerId: bears }).ok).toBe(true);
    expect(game.state.objects[bears].zone).toBe('hand');
    const n = game.state.objects[id];
    expect(n.zone).toBe('battlefield');
    expect(n.attacking).toBe(true);
    expect(n.tapped).toBe(true);
    passUntil(game, (s) => s.step === 'main2');
    expect(game.state.players.p2.life).toBe(18);
  });
});

describe('M15 · cascade', () => {
  it('cascade: exila até uma carta mais barata e a conjura de graça', () => {
    const game = makeGame([...FILLER, cascader, grizzlyBears], FILLER, {
      topP1: [cascader.id, 'mountain', 'mountain', 'forest', 'forest', 'island', 'island', 'grizzly-bears'],
    });
    goToMain1(game);
    put(game, 'p1', 'mountain'); put(game, 'p1', 'mountain'); put(game, 'p1', 'forest'); put(game, 'p1', 'forest');
    const id = findIn(game, 'p1', 'hand', cascader.id);
    expect(game.apply('p1', { type: 'castSpell', objectId: id }).ok).toBe(true);
    settle(game);
    expect(() => findIn(game, 'p1', 'battlefield', 'grizzly-bears')).not.toThrow();
    expect(game.state.objects[id].zone).toBe('graveyard');
  });
});
