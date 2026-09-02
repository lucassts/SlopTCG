/** M16 (Leva 3): Sagas, energia, Level up/Class, Station, explore, extort, exploit, bestow, emerge, entwine, overload, gift, bargain, leyline, reconfigure, transmute, split second, annihilator. */
import { describe, expect, it } from 'vitest';
import { compileOracleCard, type OracleInput } from '../src/cards/oracle-parser.js';
import { forest, grizzlyBears, island, lightningBolt, mountain, plains, swamp } from '../src/cards/demo-set.js';
import type { CardDefinition } from '../src/cards/types.js';
import type { Game } from '../src/game.js';
import type { PlayerId } from '../src/types.js';
import { effectivePower, effectiveToughness, hasKeyword, isCreature } from '../src/state.js';
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
const cast = (game: Game, p: PlayerId, id: number, extra: Record<string, unknown> = {}) => game.apply(p, { type: 'castSpell', objectId: id, ...extra } as never);

const saga = mk({ name: 'Tale of Bears', manaCost: '{1}{W}', typeLine: 'Enchantment — Saga', colors: ['W'], oracleText: '(As this Saga enters and after your draw step, add a lore counter. Sacrifice after III.)\nI, II — You gain 2 life.\nIII — Draw a card.' });
const energizer = mk({ name: 'Aether Bear', manaCost: '{1}{G}', typeLine: 'Creature — Bear', power: 2, toughness: 2, colors: ['G'], oracleText: 'When Aether Bear enters, you get {E}{E}.\n{E}, {T}: Draw a card.' });
const leveler = mk({ name: 'Level Bear', manaCost: '{1}{W}', typeLine: 'Creature — Bear', power: 2, toughness: 2, colors: ['W'], oracleText: 'Level up {1}\nLEVEL 1-2\n3/3\nFirst strike\nLEVEL 3+\n5/5\nFirst strike, lifelink' });
const klass = mk({ name: 'Bear Class', manaCost: '{W}', typeLine: 'Enchantment — Class', colors: ['W'], oracleText: '(Gain the next level as a sorcery to add its ability.)\nCreatures you control get +1/+0.\n{2}: Level 2\nCreatures you control get +1/+1.\n{4}: Level 3\nCreatures you control have flying.' });
const ship = mk({ name: 'Bear Cruiser', manaCost: '{3}', typeLine: 'Artifact — Spacecraft', power: 4, toughness: 4, oracleText: 'Station (Tap another creature you control: Put charge counters equal to its power on this Spacecraft. Station only as a sorcery. It\'s an artifact creature at 5+.)\n5+ | Flying' });
const bigBear = mk({ name: 'Big Bear', manaCost: '{4}{G}', typeLine: 'Creature — Bear', power: 5, toughness: 5, colors: ['G'], oracleText: '' });
const explorer = mk({ name: 'Scout Bear', manaCost: '{1}{G}', typeLine: 'Creature — Bear Scout', power: 2, toughness: 2, colors: ['G'], oracleText: 'When Scout Bear enters, it explores.' });
const extorter = mk({ name: 'Extort Bear', manaCost: '{1}{B}', typeLine: 'Creature — Bear', power: 2, toughness: 2, colors: ['B'], oracleText: 'Extort' });
const exploiter = mk({ name: 'Exploit Bear', manaCost: '{1}{B}', typeLine: 'Creature — Bear', power: 2, toughness: 2, colors: ['B'], oracleText: 'Exploit\nWhen Exploit Bear exploits a creature, draw two cards.' });
const bestower = mk({ name: 'Bestow Bear', manaCost: '{1}{W}', typeLine: 'Enchantment Creature — Bear', power: 2, toughness: 2, colors: ['W'], oracleText: 'Bestow {3}{W}\nEnchanted creature gets +2/+2.' });
const emerger = mk({ name: 'Emerge Bear', manaCost: '{6}{U}', typeLine: 'Creature — Bear', power: 4, toughness: 4, colors: ['U'], oracleText: 'Emerge {5}{U}' });
const entwiner = mk({ name: 'Entwine Charm', manaCost: '{W}', typeLine: 'Instant', colors: ['W'], oracleText: 'Choose one —\n• You gain 3 life.\n• Draw a card.\nEntwine {1}' });
const overloader = mk({ name: 'Overload Shatter', manaCost: '{R}', typeLine: 'Sorcery', colors: ['R'], oracleText: 'Destroy target artifact.\nOverload {2}{R}' });
const dud = mk({ name: 'Dud', manaCost: '{0}', typeLine: 'Artifact', oracleText: '' });
const gifter = mk({ name: 'Gift Bear', manaCost: '{1}{U}', typeLine: 'Creature — Bear', power: 1, toughness: 1, colors: ['U'], oracleText: 'Gift a card\nWhen Gift Bear enters, if the gift was promised, draw two cards.' });
const bargainer = mk({ name: 'Bargain Draw', manaCost: '{U}', typeLine: 'Sorcery', colors: ['U'], oracleText: 'Bargain\nDraw a card.\nIf this spell was bargained, you gain 3 life.' });
const leyline = mk({ name: 'Leyline of Bears', manaCost: '{2}{G}{G}', typeLine: 'Enchantment', colors: ['G'], oracleText: 'If this card is in your opening hand, you may begin the game with it on the battlefield.' });
const reconfig = mk({ name: 'Bear Suit', manaCost: '{2}', typeLine: 'Artifact Creature — Equipment Bear', power: 2, toughness: 2, oracleText: 'Reconfigure {2}\nEquipped creature gets +2/+2.' });
const transmuter = mk({ name: 'Transmute Draw', manaCost: '{1}{U}', typeLine: 'Instant', colors: ['U'], oracleText: 'Draw a card.\nTransmute {1}{U}{U}' });
const splitter = mk({ name: 'Split Draw', manaCost: '{U}', typeLine: 'Instant', colors: ['U'], oracleText: 'Split second\nDraw a card.' });
const annihilating = mk({ name: 'Eldrazi Bear', manaCost: '{3}{G}', typeLine: 'Creature — Bear', power: 4, toughness: 4, colors: ['G'], oracleText: 'Annihilator 1' });

describe('M16 · compilação', () => {
  it('tudo compila como full', () => {
    for (const c of [saga, energizer, leveler, klass, ship, explorer, extorter, exploiter, bestower, emerger, entwiner, overloader, gifter, bargainer, leyline, reconfig, transmuter, splitter, annihilating])
      expect(c.automation, `${c.name}: ${c.automationNotes?.join(' | ')}`).toBe('full');
    expect(saga.saga).toEqual({ chapters: 3 });
    expect(leveler.levels).toHaveLength(2);
    expect(leveler.levels?.[0]).toMatchObject({ min: 1, max: 2, power: 3, toughness: 3, keywords: ['firstStrike'] });
    expect(klass.isClass).toBe(true);
    expect(ship.station).toEqual({ threshold: 5, keywords: ['flying'] });
    expect(entwiner.entwine).toBe('{1}');
    expect(overloader.overloadEffect).toEqual([{ op: 'destroyEach', filter: { what: 'artifact' } }]);
    expect(gifter.kicker?.gift).toBeDefined();
    expect(bargainer.kicker?.sacrifice).toBeDefined();
    expect(leyline.openingHand).toBe(true);
    expect(splitter.splitSecond).toBe(true);
  });
});

describe('M16 · Sagas, energia, níveis', () => {
  it('saga: capítulo I ao entrar, II e III nas fases principais seguintes, depois é sacrificada', () => {
    const game = makeGame([...FILLER, saga], FILLER, { topP1: [saga.id] });
    goToMain1(game);
    put(game, 'p1', 'plains'); put(game, 'p1', 'plains');
    const id = findIn(game, 'p1', 'hand', saga.id);
    expect(cast(game, 'p1', id).ok).toBe(true);
    settle(game);
    expect(game.state.players.p1.life).toBe(22);
    expect(game.state.objects[id].counters['lore']).toBe(1);
    passUntil(game, (s) => s.turn === 3 && s.step === 'main1' && s.stack.length === 0 && s.pendingDecision === null);
    expect(game.state.players.p1.life).toBe(24);
    const before = game.state.players.p1.zones.hand.length;
    passUntil(game, (s) => s.turn === 5 && s.step === 'main1' && s.stack.length === 0 && s.pendingDecision === null);
    expect(game.state.players.p1.zones.hand.length).toBe(before + 2); // compra do turno + capítulo III
    expect(game.state.objects[id].zone).toBe('graveyard');
  });

  it('energia: ganha {E}{E} ao entrar e paga {E} para comprar', () => {
    const game = makeGame([...FILLER, energizer], FILLER, { topP1: [energizer.id] });
    goToMain1(game);
    put(game, 'p1', 'forest'); put(game, 'p1', 'forest');
    const id = findIn(game, 'p1', 'hand', energizer.id);
    expect(cast(game, 'p1', id).ok).toBe(true);
    settle(game);
    expect(game.state.players.p1.energy).toBe(2);
    passUntil(game, (s) => s.turn === 3 && s.step === 'main1' && s.priority === 'p1' && s.stack.length === 0);
    const before = game.state.players.p1.zones.hand.length;
    expect(game.apply('p1', { type: 'activateAbility', objectId: id, abilityIndex: 1 }).ok).toBe(true);
    settle(game);
    expect(game.state.players.p1.energy).toBe(1);
    expect(game.state.players.p1.zones.hand.length).toBe(before + 1);
  });

  it('level up: as bandas mudam P/T e keywords', () => {
    const game = makeGame([...FILLER, leveler], FILLER, { topP1: [leveler.id] });
    goToMain1(game);
    const id = put(game, 'p1', leveler.id);
    for (let i = 0; i < 3; i++) put(game, 'p1', 'plains');
    const obj = game.state.objects[id];
    expect(effectivePower(game.state, obj)).toBe(2);
    expect(hasKeyword(game.state, obj, 'firstStrike')).toBe(false);
    expect(game.apply('p1', { type: 'activateAbility', objectId: id, abilityIndex: 0 }).ok).toBe(true);
    settle(game);
    expect(effectivePower(game.state, obj)).toBe(3);
    expect(hasKeyword(game.state, obj, 'firstStrike')).toBe(true);
    expect(hasKeyword(game.state, obj, 'lifelink')).toBe(false);
    game.apply('p1', { type: 'activateAbility', objectId: id, abilityIndex: 0 }); settle(game);
    game.apply('p1', { type: 'activateAbility', objectId: id, abilityIndex: 0 }); settle(game);
    expect(effectivePower(game.state, obj)).toBe(5);
    expect(effectiveToughness(game.state, obj)).toBe(5);
    expect(hasKeyword(game.state, obj, 'lifelink')).toBe(true);
  });

  it('classe: habilidades do nível 2 só depois de subir', () => {
    const game = makeGame([...FILLER, klass, grizzlyBears], FILLER, { topP1: [klass.id, 'grizzly-bears'] });
    goToMain1(game);
    put(game, 'p1', klass.id);
    const bears = put(game, 'p1', 'grizzly-bears');
    for (let i = 0; i < 6; i++) put(game, 'p1', 'plains');
    expect(effectivePower(game.state, game.state.objects[bears])).toBe(3);
    expect(effectiveToughness(game.state, game.state.objects[bears])).toBe(2);
    const cls = findIn(game, 'p1', 'battlefield', klass.id);
    // Habilidades: [estática N1, "{2}: Nível 2", estática N2, "{4}: Nível 3", estática N3]. Nível 3 antes do 2: recusado.
    expect(game.apply('p1', { type: 'activateAbility', objectId: cls, abilityIndex: 3 }).ok).toBe(false);
    expect(game.apply('p1', { type: 'activateAbility', objectId: cls, abilityIndex: 1 }).ok).toBe(true);
    settle(game);
    expect(effectivePower(game.state, game.state.objects[bears])).toBe(4);
    expect(effectiveToughness(game.state, game.state.objects[bears])).toBe(3);
    expect(hasKeyword(game.state, game.state.objects[bears], 'flying')).toBe(false);
    expect(game.apply('p1', { type: 'activateAbility', objectId: cls, abilityIndex: 3 }).ok).toBe(true);
    settle(game);
    expect(hasKeyword(game.state, game.state.objects[bears], 'flying')).toBe(true);
  });

  it('station: vira criatura voadora com carga 5+', () => {
    const game = makeGame([...FILLER, ship, bigBear], FILLER, { topP1: [ship.id, bigBear.id] });
    goToMain1(game);
    const s = put(game, 'p1', ship.id);
    const big = put(game, 'p1', bigBear.id);
    expect(isCreature(game.state.objects[s])).toBe(false);
    expect(game.apply('p1', { type: 'activateAbility', objectId: s, abilityIndex: 0, tapCreature: big }).ok).toBe(true);
    expect(game.state.objects[s].counters['charge']).toBe(5);
    expect(game.state.objects[big].tapped).toBe(true);
    expect(isCreature(game.state.objects[s])).toBe(true);
    expect(hasKeyword(game.state, game.state.objects[s], 'flying')).toBe(true);
  });
});

describe('M16 · gatilhos e escolhas', () => {
  it('explore: carta que não é terreno → marcador e escolha de manter no topo', () => {
    const game = makeGame([...FILLER, explorer, grizzlyBears], FILLER, { topP1: [explorer.id, 'mountain', 'mountain', 'forest', 'forest', 'island', 'island', 'grizzly-bears'] });
    goToMain1(game);
    put(game, 'p1', 'forest'); put(game, 'p1', 'forest');
    const id = findIn(game, 'p1', 'hand', explorer.id);
    expect(cast(game, 'p1', id).ok).toBe(true);
    passUntil(game, (s) => s.pendingDecision !== null);
    expect(game.state.pendingDecision).toMatchObject({ type: 'effectChoice', mode: 'confirm', player: 'p1' });
    game.apply('p1', { type: 'effectChoice', picks: [], text: 'no' });
    settle(game);
    expect(game.state.objects[id].counters['+1/+1']).toBe(1);
    expect(game.state.objects[game.state.players.p1.zones.library[0]].card.id).toBe('grizzly-bears');
  });

  it('extort: pagar {W/B} ao conjurar drena 1', () => {
    const game = makeGame([...FILLER, extorter, grizzlyBears], FILLER, { topP1: [extorter.id, 'grizzly-bears'] });
    goToMain1(game);
    put(game, 'p1', extorter.id);
    for (let i = 0; i < 3; i++) put(game, 'p1', 'forest');
    put(game, 'p1', 'swamp');
    expect(cast(game, 'p1', findIn(game, 'p1', 'hand', 'grizzly-bears')).ok).toBe(true);
    passUntil(game, (s) => s.pendingDecision !== null);
    game.apply('p1', { type: 'effectChoice', picks: [], text: 'yes' });
    settle(game);
    expect(game.state.players.p2.life).toBe(19);
    expect(game.state.players.p1.life).toBe(21);
  });

  it('exploit: sacrifica uma criatura e o gatilho "exploits" compra duas', () => {
    const game = makeGame([...FILLER, exploiter, grizzlyBears], FILLER, { topP1: [exploiter.id, 'grizzly-bears'] });
    goToMain1(game);
    const bears = put(game, 'p1', 'grizzly-bears');
    put(game, 'p1', 'swamp'); put(game, 'p1', 'swamp');
    expect(cast(game, 'p1', findIn(game, 'p1', 'hand', exploiter.id)).ok).toBe(true);
    passUntil(game, (s) => s.pendingDecision !== null);
    const before = game.state.players.p1.zones.hand.length;
    game.apply('p1', { type: 'effectChoice', picks: [bears] });
    settle(game);
    expect(game.state.objects[bears].zone).toBe('graveyard');
    expect(game.state.players.p1.zones.hand.length).toBe(before + 2);
  });

  it('annihilator: ao atacar, o defensor sacrifica uma permanente', () => {
    const game = makeGame([...FILLER, annihilating], [...FILLER, grizzlyBears], { topP1: [annihilating.id], topP2: ['grizzly-bears'] });
    goToMain1(game);
    put(game, 'p1', annihilating.id);
    const bears = put(game, 'p2', 'grizzly-bears');
    passUntil(game, (s) => s.turn === 3 && s.step === 'main1' && s.priority === 'p1' && s.stack.length === 0);
    game.apply('p1', { type: 'passPriority' });
    passUntil(game, (s) => s.combatAwaiting === 'attackers');
    expect(game.apply('p1', { type: 'declareAttackers', attackers: [findIn(game, 'p1', 'battlefield', annihilating.id)] }).ok).toBe(true);
    // Única permanente do defensor: a escolha forçada resolve sozinha.
    passUntil(game, (s) => s.stack.length === 0 && s.pendingDecision === null);
    expect(game.state.objects[bears].zone).toBe('graveyard');
  });
});

describe('M16 · conjuração', () => {
  it('bestow: entra como Aura (+2/+2) e vira criatura quando o hospedeiro morre', () => {
    const game = makeGame([...FILLER, bestower, grizzlyBears], [...FILLER, lightningBolt, lightningBolt], { topP1: [bestower.id, 'grizzly-bears'], topP2: ['lightning-bolt', 'lightning-bolt'] });
    goToMain1(game);
    const bears = put(game, 'p1', 'grizzly-bears');
    for (let i = 0; i < 4; i++) put(game, 'p1', 'plains');
    const id = findIn(game, 'p1', 'hand', bestower.id);
    expect(cast(game, 'p1', id, { method: 'bestow', targets: [{ kind: 'object', id: bears }] }).ok).toBe(true);
    settle(game);
    expect(game.state.objects[id].attachedTo).toBe(bears);
    expect(isCreature(game.state.objects[id])).toBe(false);
    expect(effectivePower(game.state, game.state.objects[bears])).toBe(4);
    put(game, 'p2', 'mountain'); put(game, 'p2', 'mountain');
    game.apply('p1', { type: 'passPriority' });
    // 4/4 com o bestow: precisa de dois raios.
    expect(cast(game, 'p2', findIn(game, 'p2', 'hand', 'lightning-bolt'), { targets: [{ kind: 'object', id: bears }] }).ok).toBe(true);
    settle(game);
    if (game.state.priority === 'p1') game.apply('p1', { type: 'passPriority' });
    expect(cast(game, 'p2', findIn(game, 'p2', 'hand', 'lightning-bolt'), { targets: [{ kind: 'object', id: bears }] }).ok).toBe(true);
    settle(game);
    expect(game.state.objects[bears].zone).toBe('graveyard');
    expect(game.state.objects[id].zone).toBe('battlefield');
    expect(isCreature(game.state.objects[id])).toBe(true);
  });

  it('emerge: sacrifica uma criatura e o custo cai pelo valor de mana dela', () => {
    const game = makeGame([...FILLER, emerger, grizzlyBears], FILLER, { topP1: [emerger.id, 'grizzly-bears'] });
    goToMain1(game);
    const bears = put(game, 'p1', 'grizzly-bears');
    for (let i = 0; i < 4; i++) put(game, 'p1', 'island');
    const id = findIn(game, 'p1', 'hand', emerger.id);
    expect(cast(game, 'p1', id, { method: 'emerge', sacrifices: [bears] }).ok).toBe(true);
    settle(game);
    expect(game.state.objects[bears].zone).toBe('graveyard');
    expect(game.state.objects[id].zone).toBe('battlefield');
  });

  it('entwine: paga a mais e resolve os dois modos', () => {
    const game = makeGame([...FILLER, entwiner], FILLER, { topP1: [entwiner.id] });
    goToMain1(game);
    put(game, 'p1', 'plains'); put(game, 'p1', 'plains');
    const before = game.state.players.p1.zones.hand.length;
    expect(cast(game, 'p1', findIn(game, 'p1', 'hand', entwiner.id), { entwine: true }).ok).toBe(true);
    settle(game);
    expect(game.state.players.p1.life).toBe(23);
    expect(game.state.players.p1.zones.hand.length).toBe(before); // -1 conjurada, +1 comprada
  });

  it('overload: "alvo" vira "cada"', () => {
    const game = makeGame([...FILLER, overloader], [...FILLER, dud, dud], { topP1: [overloader.id], topP2: [dud.id, dud.id] });
    goToMain1(game);
    const d1 = put(game, 'p2', dud.id); const d2 = put(game, 'p2', dud.id);
    for (let i = 0; i < 3; i++) put(game, 'p1', 'mountain');
    expect(cast(game, 'p1', findIn(game, 'p1', 'hand', overloader.id), { method: 'overload' }).ok).toBe(true);
    settle(game);
    expect(game.state.objects[d1].zone).toBe('graveyard');
    expect(game.state.objects[d2].zone).toBe('graveyard');
  });

  it('gift: o oponente compra uma carta e o gatilho condicional dispara', () => {
    const game = makeGame([...FILLER, gifter], FILLER, { topP1: [gifter.id] });
    goToMain1(game);
    put(game, 'p1', 'island'); put(game, 'p1', 'island');
    const mine = game.state.players.p1.zones.hand.length;
    const theirs = game.state.players.p2.zones.hand.length;
    expect(cast(game, 'p1', findIn(game, 'p1', 'hand', gifter.id), { kicked: true }).ok).toBe(true);
    settle(game);
    expect(game.state.players.p2.zones.hand.length).toBe(theirs + 1);
    expect(game.state.players.p1.zones.hand.length).toBe(mine - 1 + 2);
  });

  it('bargain: sacrificar um artefato liga o efeito extra', () => {
    const game = makeGame([...FILLER, bargainer, dud], FILLER, { topP1: [bargainer.id, dud.id] });
    goToMain1(game);
    const d = put(game, 'p1', dud.id);
    put(game, 'p1', 'island');
    expect(cast(game, 'p1', findIn(game, 'p1', 'hand', bargainer.id), { kicked: true, sacrifices: [d] }).ok).toBe(true);
    settle(game);
    expect(game.state.objects[d].zone).toBe('graveyard');
    expect(game.state.players.p1.life).toBe(23);
  });

  it('leyline: começa no campo de batalha a partir da mão inicial', () => {
    const game = makeGame([...FILLER, leyline], FILLER, { topP1: [leyline.id] });
    expect(() => findIn(game, 'p1', 'battlefield', leyline.id)).not.toThrow();
  });

  it('split second: nada pode ser conjurado em resposta', () => {
    const game = makeGame([...FILLER, splitter], [...FILLER, lightningBolt], { topP1: [splitter.id], topP2: ['lightning-bolt'] });
    goToMain1(game);
    put(game, 'p1', 'island'); put(game, 'p2', 'mountain');
    expect(cast(game, 'p1', findIn(game, 'p1', 'hand', splitter.id)).ok).toBe(true);
    game.apply('p1', { type: 'passPriority' });
    const r = cast(game, 'p2', findIn(game, 'p2', 'hand', 'lightning-bolt'), { targets: [{ kind: 'player', player: 'p1' }] });
    expect(r.ok).toBe(false);
  });
});

describe('M16 · equipamento e mão', () => {
  it('reconfigure: anexa (+2/+2, deixa de ser criatura) e desanexa', () => {
    const game = makeGame([...FILLER, reconfig, grizzlyBears], FILLER, { topP1: [reconfig.id, 'grizzly-bears'] });
    goToMain1(game);
    const eq = put(game, 'p1', reconfig.id);
    const bears = put(game, 'p1', 'grizzly-bears');
    for (let i = 0; i < 4; i++) put(game, 'p1', 'plains');
    expect(game.apply('p1', { type: 'activateAbility', objectId: eq, abilityIndex: 0, targets: [{ kind: 'object', id: bears }] }).ok).toBe(true);
    settle(game);
    expect(game.state.objects[eq].attachedTo).toBe(bears);
    expect(isCreature(game.state.objects[eq])).toBe(false);
    expect(effectivePower(game.state, game.state.objects[bears])).toBe(4);
    expect(game.apply('p1', { type: 'activateAbility', objectId: eq, abilityIndex: 1 }).ok).toBe(true);
    settle(game);
    expect(game.state.objects[eq].attachedTo).toBeUndefined();
    expect(isCreature(game.state.objects[eq])).toBe(true);
  });

  it('transmute: descarta da mão e busca uma carta do mesmo valor de mana', () => {
    const game = makeGame([...FILLER, transmuter, grizzlyBears], FILLER, { topP1: [transmuter.id, 'mountain', 'mountain', 'forest', 'forest', 'island', 'island', 'grizzly-bears'] });
    goToMain1(game);
    for (let i = 0; i < 3; i++) put(game, 'p1', 'island');
    const id = findIn(game, 'p1', 'hand', transmuter.id);
    expect(game.apply('p1', { type: 'activateAbility', objectId: id, abilityIndex: 0 }).ok).toBe(true);
    expect(game.state.objects[id].zone).toBe('graveyard');
    passUntil(game, (s) => s.pendingDecision !== null);
    const pd = game.state.pendingDecision;
    expect(pd?.type).toBe('effectChoice');
    const bearsId = (pd as { options: number[] }).options.find((o) => game.state.objects[o].card.id === 'grizzly-bears');
    expect(bearsId).toBeDefined();
    game.apply('p1', { type: 'effectChoice', picks: [bearsId!] });
    settle(game);
    expect(game.state.objects[bearsId!].zone).toBe('hand');
  });
});
