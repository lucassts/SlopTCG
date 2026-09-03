/** M18 (Leva 4): gramática composicional — vários alvos, condições, forEach, quantidades dinâmicas, gatilho atrasado, custos, prevenção, uma vez por turno, modos múltiplos, exert, cópias, cavar o topo, até o seu próximo turno. */
import { describe, expect, it } from 'vitest';
import { compileOracleCard, type OracleInput } from '../src/cards/oracle-parser.js';
import { forest, grizzlyBears, island, lightningBolt, mountain, plains, swamp } from '../src/cards/demo-set.js';
import type { CardDefinition } from '../src/cards/types.js';
import type { Game } from '../src/game.js';
import type { PlayerId } from '../src/types.js';
import { effectivePower, effectiveToughness, hasKeyword } from '../src/state.js';
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
const toMain1Turn = (game: Game, turn: number, p: PlayerId = 'p1') => passUntil(game, (s) => s.turn === turn && s.step === 'main1' && s.priority === p && s.stack.length === 0 && s.pendingDecision === null);

const twoTargets = mk({ name: 'Double Bolt', manaCost: '{1}{R}', typeLine: 'Instant', colors: ['R'], oracleText: 'Double Bolt deals 2 damage to target creature and 1 damage to target player.' });
const upToTwo = mk({ name: 'Twin Smite', manaCost: '{2}{W}', typeLine: 'Sorcery', colors: ['W'], oracleText: 'Destroy up to two target creatures.' });
const conditional = mk({ name: 'Cat Draw', manaCost: '{U}', typeLine: 'Instant', colors: ['U'], oracleText: 'Draw a card. If you control a Bear, draw a card.' });
const unlessPay = mk({ name: 'Tax Bear', manaCost: '{1}{W}', typeLine: 'Creature — Bear', power: 2, toughness: 2, colors: ['W'], oracleText: 'When Tax Bear enters, each opponent loses 3 life unless they pay {2}.' });
const sweeper = mk({ name: 'Bear Wrath', manaCost: '{2}{B}', typeLine: 'Sorcery', colors: ['B'], oracleText: 'Each creature with power 2 or less gets -2/-2 until end of turn.' });
const dynPump = mk({ name: 'Might of Bears', manaCost: '{G}', typeLine: 'Instant', colors: ['G'], oracleText: 'Target creature gets +X/+X until end of turn, where X is the number of creatures you control.' });
const perDraw = mk({ name: 'Bear Wisdom', manaCost: '{2}{U}', typeLine: 'Sorcery', colors: ['U'], oracleText: 'Draw a card for each Bear you control.' });
const delayed = mk({ name: 'Flicker Bear', manaCost: '{1}{W}', typeLine: 'Instant', colors: ['W'], oracleText: 'Exile target creature you control. Return it to the battlefield under its owner\'s control at the beginning of the next end step.' });
const costLord = mk({ name: 'Bear Medallion', manaCost: '{2}', typeLine: 'Artifact', oracleText: 'Creature spells you cast cost {1} less to cast.' });
const affinityish = mk({ name: 'Bear Titan', manaCost: '{5}{G}', typeLine: 'Creature — Bear', power: 5, toughness: 5, colors: ['G'], oracleText: 'Bear Titan costs {1} less to cast for each Bear you control.' });
const shield = mk({ name: 'Bear Ward', manaCost: '{W}', typeLine: 'Instant', colors: ['W'], oracleText: 'Prevent the next 3 damage that would be dealt to target creature this turn.' });
const oncePerTurn = mk({ name: 'Pump Bear', manaCost: '{1}{G}', typeLine: 'Creature — Bear', power: 2, toughness: 2, colors: ['G'], oracleText: '{G}: Pump Bear gets +1/+1 until end of turn. Activate only once each turn.' });
const modal2 = mk({ name: 'Bear Charm', manaCost: '{1}{G}', typeLine: 'Instant', colors: ['G'], oracleText: 'Choose one or both —\n• You gain 3 life.\n• Draw a card.' });
const exerter = mk({ name: 'Exert Bear', manaCost: '{1}{R}', typeLine: 'Creature — Bear', power: 2, toughness: 2, colors: ['R'], oracleText: 'You may exert Exert Bear as it attacks.\nWhenever you exert Exert Bear, it gets +2/+0 until end of turn.' });
const clone = mk({ name: 'Bear Clone', manaCost: '{3}{U}', typeLine: 'Creature — Shapeshifter', power: 0, toughness: 0, colors: ['U'], oracleText: 'You may have Bear Clone enter as a copy of any creature on the battlefield.' });
const digger = mk({ name: 'Bear Anticipate', manaCost: '{1}{U}', typeLine: 'Instant', colors: ['U'], oracleText: 'Look at the top three cards of your library. Put one of them into your hand and the rest on the bottom of your library in a random order.' });
const nextTurn = mk({ name: 'Bear Shield', manaCost: '{W}', typeLine: 'Instant', colors: ['W'], oracleText: 'Target creature gets +0/+3 until your next turn.' });
const tokensPer = mk({ name: 'Bear Assembly', manaCost: '{3}{W}', typeLine: 'Sorcery', colors: ['W'], oracleText: 'Create a 1/1 white Kor Soldier creature token for each creature you control.' });
const raidBear = mk({ name: 'Raid Bear', manaCost: '{1}{R}', typeLine: 'Creature — Bear', power: 2, toughness: 2, colors: ['R'], oracleText: 'Raid — Raid Bear enters with a +1/+1 counter on it if you attacked this turn.' });
const morbid = mk({ name: 'Morbid Bear', manaCost: '{1}{B}', typeLine: 'Creature — Bear', power: 2, toughness: 2, colors: ['B'], oracleText: 'When Morbid Bear enters, if a creature died this turn, draw a card.' });
const anthemSub = mk({ name: 'Bear Lord', manaCost: '{2}{G}', typeLine: 'Creature — Bear', power: 2, toughness: 2, colors: ['G'], oracleText: 'Other Bears you control get +1/+1.' });

describe('M18 · compilação', () => {
  it('tudo compila como full', () => {
    for (const c of [twoTargets, upToTwo, conditional, unlessPay, sweeper, dynPump, perDraw, delayed, costLord, affinityish, shield, oncePerTurn, modal2, exerter, clone, digger, nextTurn, tokensPer, raidBear, morbid, anthemSub])
      expect(c.automation, `${c.name}: ${c.automationNotes?.join(' | ')}`).toBe('full');
    expect(twoTargets.spellTargets).toHaveLength(2);
    expect(upToTwo.spellTargets).toEqual([{ what: 'creature', optional: true }, { what: 'creature', optional: true }]);
    expect(conditional.spellEffect?.[1]).toMatchObject({ op: 'if', cond: { kind: 'controlsAtLeast', count: 1 } });
    expect(sweeper.spellEffect?.[0]).toMatchObject({ op: 'forEach', filter: { what: 'creature', powerAtMost: 2 } });
    expect(costLord.costModifiers?.[0]).toMatchObject({ amount: -1, whose: 'you', filter: { what: 'creature' } });
    expect(oncePerTurn.abilities?.[0]).toMatchObject({ kind: 'activated', maxPerTurn: 1 });
    expect(modal2.spellModeChoice).toEqual({ min: 1, max: 2 });
    expect(exerter.canExert).toBe(true);
    expect(anthemSub.abilities?.[0]).toMatchObject({ kind: 'static', filter: { what: 'creature', subtype: 'Bear', other: true, controlledBy: 'you' }, power: 1, toughness: 1 });
  });
});

describe('M18 · alvos, condições e quantidades', () => {
  it('dois alvos numa frase: criatura e jogador', () => {
    const game = makeGame([...FILLER, twoTargets], [...FILLER, grizzlyBears], { topP1: [twoTargets.id], topP2: ['grizzly-bears'] });
    goToMain1(game);
    const bears = put(game, 'p2', 'grizzly-bears');
    put(game, 'p1', 'mountain'); put(game, 'p1', 'mountain');
    expect(cast(game, 'p1', findIn(game, 'p1', 'hand', twoTargets.id), { targets: [{ kind: 'object', id: bears }, { kind: 'player', player: 'p2' }] }).ok).toBe(true);
    settle(game);
    expect(game.state.objects[bears].zone).toBe('graveyard');
    expect(game.state.players.p2.life).toBe(19);
  });

  it('"até duas criaturas-alvo": funciona com uma só', () => {
    const game = makeGame([...FILLER, upToTwo], [...FILLER, grizzlyBears], { topP1: [upToTwo.id], topP2: ['grizzly-bears'] });
    goToMain1(game);
    const bears = put(game, 'p2', 'grizzly-bears');
    for (let i = 0; i < 3; i++) put(game, 'p1', 'plains');
    expect(cast(game, 'p1', findIn(game, 'p1', 'hand', upToTwo.id), { targets: [{ kind: 'object', id: bears }] }).ok).toBe(true);
    settle(game);
    expect(game.state.objects[bears].zone).toBe('graveyard');
  });

  it('"if you control a Bear": ramo condicional', () => {
    const game = makeGame([...FILLER, conditional, conditional, grizzlyBears], FILLER, { topP1: [conditional.id, conditional.id, 'grizzly-bears'] });
    goToMain1(game);
    put(game, 'p1', 'island'); put(game, 'p1', 'island');
    let before = game.state.players.p1.zones.hand.length;
    expect(cast(game, 'p1', findIn(game, 'p1', 'hand', conditional.id)).ok).toBe(true);
    settle(game);
    expect(game.state.players.p1.zones.hand.length).toBe(before - 1 + 1);
    put(game, 'p1', 'grizzly-bears');
    before = game.state.players.p1.zones.hand.length;
    expect(cast(game, 'p1', findIn(game, 'p1', 'hand', conditional.id)).ok).toBe(true);
    settle(game);
    expect(game.state.players.p1.zones.hand.length).toBe(before - 1 + 2);
  });

  it('"unless they pay {2}": o oponente sem mana perde a vida', () => {
    const game = makeGame([...FILLER, unlessPay], FILLER, { topP1: [unlessPay.id] });
    goToMain1(game);
    put(game, 'p1', 'plains'); put(game, 'p1', 'plains');
    expect(cast(game, 'p1', findIn(game, 'p1', 'hand', unlessPay.id)).ok).toBe(true);
    settle(game);
    expect(game.state.players.p2.life).toBe(17);
  });

  it('"each creature with power 2 or less gets -2/-2": varredura por filtro', () => {
    const game = makeGame([...FILLER, sweeper], [...FILLER, grizzlyBears], { topP1: [sweeper.id], topP2: ['grizzly-bears'] });
    goToMain1(game);
    const bears = put(game, 'p2', 'grizzly-bears');
    for (let i = 0; i < 3; i++) put(game, 'p1', 'swamp');
    expect(cast(game, 'p1', findIn(game, 'p1', 'hand', sweeper.id)).ok).toBe(true);
    settle(game);
    expect(game.state.objects[bears].zone).toBe('graveyard');
  });

  it('"+X/+X where X is the number of creatures you control" e "draw a card for each Bear"', () => {
    const game = makeGame([...FILLER, dynPump, perDraw, grizzlyBears, grizzlyBears], FILLER, { topP1: [dynPump.id, perDraw.id, 'grizzly-bears', 'grizzly-bears'] });
    goToMain1(game);
    const b1 = put(game, 'p1', 'grizzly-bears'); put(game, 'p1', 'grizzly-bears');
    for (let i = 0; i < 4; i++) put(game, 'p1', 'forest'); for (let i = 0; i < 3; i++) put(game, 'p1', 'island');
    expect(cast(game, 'p1', findIn(game, 'p1', 'hand', dynPump.id), { targets: [{ kind: 'object', id: b1 }] }).ok).toBe(true);
    settle(game);
    expect(effectivePower(game.state, game.state.objects[b1])).toBe(4);
    const before = game.state.players.p1.zones.hand.length;
    expect(cast(game, 'p1', findIn(game, 'p1', 'hand', perDraw.id)).ok).toBe(true);
    settle(game);
    expect(game.state.players.p1.zones.hand.length).toBe(before - 1 + 2);
  });
});

describe('M18 · tempo, custo e prevenção', () => {
  it('flicker atrasado: exila e volta no fim do turno', () => {
    const game = makeGame([...FILLER, delayed, grizzlyBears], FILLER, { topP1: [delayed.id, 'grizzly-bears'] });
    goToMain1(game);
    const bears = put(game, 'p1', 'grizzly-bears');
    put(game, 'p1', 'plains'); put(game, 'p1', 'plains');
    expect(cast(game, 'p1', findIn(game, 'p1', 'hand', delayed.id), { targets: [{ kind: 'object', id: bears }] }).ok).toBe(true);
    settle(game);
    expect(game.state.objects[bears].zone).toBe('exile');
    passUntil(game, (s) => s.turn === 2);
    expect(game.state.objects[bears].zone).toBe('battlefield');
  });

  it('custos: "creature spells cost {1} less" e "costs {1} less for each Bear"', () => {
    const game = makeGame([...FILLER, costLord, affinityish, grizzlyBears, grizzlyBears], FILLER, { topP1: [costLord.id, affinityish.id, 'grizzly-bears', 'grizzly-bears'] });
    goToMain1(game);
    put(game, 'p1', costLord.id);
    put(game, 'p1', 'grizzly-bears'); put(game, 'p1', 'grizzly-bears');
    // {5}{G} − 1 (medalhão) − 2 (dois ursos) = {2}{G}: três florestas bastam.
    for (let i = 0; i < 3; i++) put(game, 'p1', 'forest');
    const id = findIn(game, 'p1', 'hand', affinityish.id);
    expect(cast(game, 'p1', id).ok).toBe(true);
    settle(game);
    expect(game.state.objects[id].zone).toBe('battlefield');
  });

  it('prevenção: os próximos 3 de dano não passam', () => {
    const game = makeGame([...FILLER, shield, grizzlyBears], [...FILLER, lightningBolt], { topP1: [shield.id, 'grizzly-bears'], topP2: ['lightning-bolt'] });
    goToMain1(game);
    const bears = put(game, 'p1', 'grizzly-bears');
    put(game, 'p1', 'plains'); put(game, 'p2', 'mountain');
    expect(cast(game, 'p1', findIn(game, 'p1', 'hand', shield.id), { targets: [{ kind: 'object', id: bears }] }).ok).toBe(true);
    settle(game);
    game.apply('p1', { type: 'passPriority' });
    expect(cast(game, 'p2', findIn(game, 'p2', 'hand', 'lightning-bolt'), { targets: [{ kind: 'object', id: bears }] }).ok).toBe(true);
    settle(game);
    expect(game.state.objects[bears].zone).toBe('battlefield');
    expect(game.state.objects[bears].damage).toBe(0);
  });

  it('"activate only once each turn"', () => {
    const game = makeGame([...FILLER, oncePerTurn], FILLER, { topP1: [oncePerTurn.id] });
    goToMain1(game);
    const id = put(game, 'p1', oncePerTurn.id);
    put(game, 'p1', 'forest'); put(game, 'p1', 'forest');
    expect(game.apply('p1', { type: 'activateAbility', objectId: id, abilityIndex: 0 }).ok).toBe(true);
    settle(game);
    expect(game.apply('p1', { type: 'activateAbility', objectId: id, abilityIndex: 0 }).ok).toBe(false);
    expect(effectivePower(game.state, game.state.objects[id])).toBe(3);
  });

  it('"until your next turn": dura o turno do oponente e acaba no seu', () => {
    const game = makeGame([...FILLER, nextTurn, grizzlyBears], FILLER, { topP1: [nextTurn.id, 'grizzly-bears'] });
    goToMain1(game);
    const bears = put(game, 'p1', 'grizzly-bears');
    put(game, 'p1', 'plains');
    expect(cast(game, 'p1', findIn(game, 'p1', 'hand', nextTurn.id), { targets: [{ kind: 'object', id: bears }] }).ok).toBe(true);
    settle(game);
    expect(effectiveToughness(game.state, game.state.objects[bears])).toBe(5);
    passUntil(game, (s) => s.turn === 2 && s.step === 'main1');
    expect(effectiveToughness(game.state, game.state.objects[bears])).toBe(5);
    passUntil(game, (s) => s.turn === 3 && s.step === 'main1');
    expect(effectiveToughness(game.state, game.state.objects[bears])).toBe(2);
  });
});

describe('M18 · modos, exert, cópia, cavar, fichas', () => {
  it('"choose one or both": os dois modos', () => {
    const game = makeGame([...FILLER, modal2], FILLER, { topP1: [modal2.id] });
    goToMain1(game);
    put(game, 'p1', 'forest'); put(game, 'p1', 'forest');
    const before = game.state.players.p1.zones.hand.length;
    expect(cast(game, 'p1', findIn(game, 'p1', 'hand', modal2.id), { modes: [0, 1] }).ok).toBe(true);
    settle(game);
    expect(game.state.players.p1.life).toBe(23);
    expect(game.state.players.p1.zones.hand.length).toBe(before);
  });

  it('exert: bônus ao atacar e não desvira no próximo turno', () => {
    const game = makeGame([...FILLER, exerter], FILLER, { topP1: [exerter.id] });
    goToMain1(game);
    const id = put(game, 'p1', exerter.id);
    toMain1Turn(game, 3);
    game.apply('p1', { type: 'passPriority' });
    passUntil(game, (s) => s.combatAwaiting === 'attackers');
    expect(game.apply('p1', { type: 'declareAttackers', attackers: [id], exerted: [id] }).ok).toBe(true);
    passUntil(game, (s) => s.combatAwaiting === 'blockers');
    game.apply('p2', { type: 'declareBlockers', blocks: [] });
    passUntil(game, (s) => s.step === 'main2');
    expect(game.state.players.p2.life).toBe(16);
    toMain1Turn(game, 5);
    expect(game.state.objects[id].tapped).toBe(true);
  });

  it('clone: entra como cópia de uma criatura', () => {
    const game = makeGame([...FILLER, clone], [...FILLER, grizzlyBears], { topP1: [clone.id], topP2: ['grizzly-bears'] });
    goToMain1(game);
    const bears = put(game, 'p2', 'grizzly-bears');
    for (let i = 0; i < 4; i++) put(game, 'p1', 'island');
    const id = findIn(game, 'p1', 'hand', clone.id);
    expect(cast(game, 'p1', id).ok).toBe(true);
    passUntil(game, (s) => s.pendingDecision?.type === 'effectChoice');
    game.apply('p1', { type: 'effectChoice', picks: [bears] });
    settle(game);
    expect(game.state.objects[id].zone).toBe('battlefield');
    expect(game.state.objects[id].card.name).toBe('Grizzly Bears');
    expect(effectivePower(game.state, game.state.objects[id])).toBe(2);
  });

  it('cavar o topo: uma para a mão, o resto para o fundo', () => {
    const game = makeGame([...FILLER, digger], FILLER, { topP1: [digger.id] });
    goToMain1(game);
    put(game, 'p1', 'island'); put(game, 'p1', 'island');
    const top3 = game.state.players.p1.zones.library.slice(0, 3);
    expect(cast(game, 'p1', findIn(game, 'p1', 'hand', digger.id)).ok).toBe(true);
    passUntil(game, (s) => s.pendingDecision?.type === 'effectChoice');
    game.apply('p1', { type: 'effectChoice', picks: [top3[1]] });
    settle(game);
    expect(game.state.objects[top3[1]].zone).toBe('hand');
    const lib = game.state.players.p1.zones.library;
    expect(lib.slice(-2)).toEqual([top3[0], top3[2]]);
  });

  it('"create a token for each creature you control" não entra em loop', () => {
    const game = makeGame([...FILLER, tokensPer, grizzlyBears, grizzlyBears], FILLER, { topP1: [tokensPer.id, 'grizzly-bears', 'grizzly-bears'] });
    goToMain1(game);
    put(game, 'p1', 'grizzly-bears'); put(game, 'p1', 'grizzly-bears');
    for (let i = 0; i < 4; i++) put(game, 'p1', 'plains');
    expect(cast(game, 'p1', findIn(game, 'p1', 'hand', tokensPer.id)).ok).toBe(true);
    settle(game);
    expect(game.state.players.p1.zones.battlefield.map((id) => game.state.objects[id]).filter((o) => o.isToken)).toHaveLength(2);
  });

  it('raid e morbid: contadores e gatilhos condicionados ao turno', () => {
    const game = makeGame([...FILLER, raidBear, morbid, grizzlyBears], [...FILLER, lightningBolt], { topP1: [raidBear.id, morbid.id, 'grizzly-bears'], topP2: ['lightning-bolt'] });
    goToMain1(game);
    for (let i = 0; i < 4; i++) put(game, 'p1', 'mountain'); put(game, 'p1', 'swamp'); put(game, 'p1', 'swamp');
    const raid = findIn(game, 'p1', 'hand', raidBear.id);
    expect(cast(game, 'p1', raid).ok).toBe(true);
    settle(game);
    expect(game.state.objects[raid].counters['+1/+1']).toBeUndefined(); // não atacou
    const bears = put(game, 'p1', 'grizzly-bears');
    put(game, 'p2', 'mountain');
    game.apply('p1', { type: 'passPriority' });
    expect(cast(game, 'p2', findIn(game, 'p2', 'hand', 'lightning-bolt'), { targets: [{ kind: 'object', id: bears }] }).ok).toBe(true);
    settle(game);
    if (game.state.priority !== 'p1') game.apply('p2', { type: 'passPriority' });
    const before = game.state.players.p1.zones.hand.length;
    expect(cast(game, 'p1', findIn(game, 'p1', 'hand', morbid.id)).ok).toBe(true);
    settle(game);
    expect(game.state.players.p1.zones.hand.length).toBe(before - 1 + 1); // uma criatura morreu neste turno
  });
});
