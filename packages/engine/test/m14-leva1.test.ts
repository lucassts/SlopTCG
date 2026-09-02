/** M14 (Leva 1): persist/undying, echo/cumulative upkeep, exile-until-leaves, estáticas condicionais, escolha de cor, blocos, terreno extra, sem ganho de vida. */
import { describe, expect, it } from 'vitest';
import { compileOracleCard, type OracleInput } from '../src/cards/oracle-parser.js';
import { forest, grizzlyBears, island, lightningBolt, mountain, plains, swamp } from '../src/cards/demo-set.js';
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
const FILLER = [...copies(mountain, 6), ...copies(forest, 6), ...copies(island, 4), ...copies(plains, 4), ...copies(swamp, 4)];

const persister = mk({ name: 'Kitchen Bear', manaCost: '{1}{G}', typeLine: 'Creature — Bear', power: 2, toughness: 2, colors: ['G'], oracleText: 'Persist' });
const echoer = mk({ name: 'Echo Bear', manaCost: '{1}{R}', typeLine: 'Creature — Bear', power: 3, toughness: 3, colors: ['R'], oracleText: 'Echo {1}{R}' });
const banisher = mk({ name: 'Banisher Priest', manaCost: '{1}{W}{W}', typeLine: 'Creature — Human Cleric', power: 2, toughness: 2, colors: ['W'], oracleText: 'When this creature enters, exile target creature an opponent controls until this creature leaves the battlefield.' });
const knight = mk({ name: 'Day Knight', manaCost: '{1}{W}', typeLine: 'Creature — Human Knight', power: 2, toughness: 2, colors: ['W'], oracleText: 'During your turn, Day Knight has first strike.' });
const metal = mk({ name: 'Metal Bear', manaCost: '{2}', typeLine: 'Artifact Creature — Bear', power: 2, toughness: 2, oracleText: 'Metalcraft — Metal Bear gets +2/+2 as long as you control three or more artifacts.' });
const chooser = mk({ name: 'Prism Bear', manaCost: '{2}', typeLine: 'Artifact', oracleText: 'As Prism Bear enters, choose a color.\n{T}: Add one mana of the chosen color.' });
const wall = mk({ name: 'Big Wall', manaCost: '{1}{W}', typeLine: 'Creature — Wall', power: 0, toughness: 5, colors: ['W'], oracleText: 'Defender\nBig Wall can block any number of creatures.' });
const explorer = mk({ name: 'Land Bear', manaCost: '{2}{G}', typeLine: 'Creature — Bear', power: 2, toughness: 2, colors: ['G'], oracleText: 'You may play an additional land on each of your turns.' });
const noGain = mk({ name: 'Sulfuric Idol', manaCost: '{2}', typeLine: 'Artifact', oracleText: "Players can't gain life." });
const commanderLine = mk({ name: 'Cmdr Bear', manaCost: '{1}{G}', typeLine: 'Creature — Bear', power: 2, toughness: 2, colors: ['G'], oracleText: 'Cmdr Bear can be your commander.\nPartner' });

describe('M14 · compilação', () => {
  it('tudo compila como full', () => {
    for (const c of [persister, echoer, banisher, knight, metal, chooser, wall, explorer, noGain, commanderLine]) expect(c.automation, c.name).toBe('full');
    expect(persister.persist).toBe(true);
    expect(echoer.echo).toBe('{1}{R}');
    expect(chooser.chooseOnEnter).toBe('color');
    expect(wall.extraBlocks).toBe('any');
    expect(explorer.extraLands).toBe(1);
  });
});

describe('M14 · ciclo de vida', () => {
  it('persist: volta do cemitério com um marcador -1/-1, uma vez só', () => {
    const game = makeGame([...FILLER, persister], [...FILLER, lightningBolt, lightningBolt], { topP1: [persister.id], topP2: ['lightning-bolt', 'lightning-bolt'] });
    goToMain1(game);
    const bear = put(game, 'p1', persister.id);
    put(game, 'p2', 'mountain'); put(game, 'p2', 'mountain');
    game.apply('p1', { type: 'passPriority' });
    game.apply('p2', { type: 'castSpell', objectId: findIn(game, 'p2', 'hand', 'lightning-bolt'), targets: [{ kind: 'object', id: bear }] });
    passUntil(game, (s) => s.stack.length === 0 && s.triggerQueue.length === 0);
    expect(game.state.objects[bear].zone).toBe('battlefield');
    expect(game.state.objects[bear].counters['-1/-1']).toBe(1);
    // segunda morte: fica no cemitério
    if (game.state.priority === 'p1') game.apply('p1', { type: 'passPriority' });
    expect(game.apply('p2', { type: 'castSpell', objectId: findIn(game, 'p2', 'hand', 'lightning-bolt'), targets: [{ kind: 'object', id: bear }] }).ok).toBe(true);
    passUntil(game, (s) => s.stack.length === 0 && s.triggerQueue.length === 0);
    expect(game.state.objects[bear].zone).toBe('graveyard');
  });

  it('echo: na manutenção seguinte pergunta; não pagar sacrifica', () => {
    const game = makeGame([...FILLER, echoer], FILLER, { topP1: [echoer.id] });
    goToMain1(game);
    put(game, 'p1', 'mountain'); put(game, 'p1', 'mountain');
    game.apply('p1', { type: 'castSpell', objectId: findIn(game, 'p1', 'hand', echoer.id) });
    passUntil(game, (s) => s.stack.length === 0);
    const bear = findIn(game, 'p1', 'battlefield', echoer.id);
    passUntil(game, (s) => s.turn === 3 && s.pendingDecision !== null);
    expect(game.state.pendingDecision).toMatchObject({ type: 'effectChoice', mode: 'confirm', player: 'p1' });
    game.apply('p1', { type: 'effectChoice', picks: [], text: 'no' });
    passUntil(game, (s) => s.stack.length === 0);
    expect(game.state.objects[bear].zone).toBe('graveyard');
  });

  it('Banisher Priest: exila até sair; volta quando o Priest morre', () => {
    const game = makeGame([...FILLER, banisher], [...FILLER, grizzlyBears, lightningBolt], { topP1: [banisher.id], topP2: ['grizzly-bears', 'lightning-bolt'] });
    goToMain1(game);
    for (let i = 0; i < 3; i++) put(game, 'p1', 'plains');
    const bears = put(game, 'p2', 'grizzly-bears');
    put(game, 'p2', 'mountain');
    game.apply('p1', { type: 'castSpell', objectId: findIn(game, 'p1', 'hand', banisher.id) });
    passUntil(game, (s) => s.pendingDecision?.type === 'chooseTargets');
    game.apply('p1', { type: 'chooseTargets', targets: [{ kind: 'object', id: bears }] });
    passUntil(game, (s) => s.stack.length === 0);
    expect(game.state.objects[bears].zone).toBe('exile');
    const priest = findIn(game, 'p1', 'battlefield', banisher.id);
    // Bolt do oponente mata o Priest → a carta exilada volta.
    if (game.state.priority === 'p1') game.apply('p1', { type: 'passPriority' });
    expect(game.apply('p2', { type: 'castSpell', objectId: findIn(game, 'p2', 'hand', 'lightning-bolt'), targets: [{ kind: 'object', id: priest }] }).ok).toBe(true);
    passUntil(game, (s) => s.stack.length === 0);
    expect(game.state.objects[priest].zone).toBe('graveyard');
    expect(game.state.objects[bears].zone).toBe('battlefield');
    expect(game.state.objects[bears].controller).toBe('p2');
  });
});

describe('M14 · estáticas condicionais e escolhas', () => {
  it('"During your turn" dá first strike só no seu turno', () => {
    const game = makeGame([...FILLER, knight], FILLER, { topP1: [knight.id] });
    goToMain1(game);
    const k = put(game, 'p1', knight.id);
    expect(hasKeyword(game.state, game.state.objects[k], 'firstStrike')).toBe(true);
    passUntil(game, (s) => s.turn === 2 && s.step === 'main1');
    expect(hasKeyword(game.state, game.state.objects[k], 'firstStrike')).toBe(false);
  });

  it('metalcraft: +2/+2 só com 3 artefatos', () => {
    const game = makeGame([...FILLER, metal, noGain, noGain], FILLER, { topP1: [metal.id, noGain.id, noGain.id] });
    goToMain1(game);
    const m = put(game, 'p1', metal.id);
    expect(effectivePower(game.state, game.state.objects[m])).toBe(2);
    put(game, 'p1', noGain.id); put(game, 'p1', noGain.id);
    expect(effectivePower(game.state, game.state.objects[m])).toBe(4);
  });

  it('escolhe cor ao entrar e produz mana dela', () => {
    const game = makeGame([...FILLER, chooser], FILLER, { topP1: [chooser.id] });
    goToMain1(game);
    put(game, 'p1', 'forest'); put(game, 'p1', 'forest');
    game.apply('p1', { type: 'castSpell', objectId: findIn(game, 'p1', 'hand', chooser.id) });
    passUntil(game, (s) => s.pendingDecision !== null);
    expect(game.state.pendingDecision).toMatchObject({ type: 'effectChoice', mode: 'chooseColor' });
    game.apply('p1', { type: 'effectChoice', picks: [], text: 'U' });
    passUntil(game, (s) => s.stack.length === 0);
    const prism = findIn(game, 'p1', 'battlefield', chooser.id);
    expect(game.apply('p1', { type: 'activateAbility', objectId: prism, abilityIndex: 0 }).ok).toBe(true);
    expect(game.state.players.p1.manaPool.U).toBe(1);
  });

  it('terreno extra e "players can\'t gain life"', () => {
    const game = makeGame([...FILLER, explorer, noGain], FILLER, { topP1: [explorer.id, noGain.id] });
    goToMain1(game);
    put(game, 'p1', explorer.id);
    const a = findIn(game, 'p1', 'hand', 'mountain');
    expect(game.apply('p1', { type: 'playLand', objectId: a }).ok).toBe(true);
    const b = game.state.players.p1.zones.hand.find((id) => game.state.objects[id].card.types.includes('Land'))!;
    expect(game.apply('p1', { type: 'playLand', objectId: b }).ok).toBe(true);
    put(game, 'p1', noGain.id);
    game.apply('p1', { type: 'manualLife', player: 'p1', delta: 3 });
    expect(game.state.players.p1.life).toBe(20);
  });

  it('parede bloqueia dois atacantes', () => {
    const game = makeGame([...FILLER, grizzlyBears, grizzlyBears], [...FILLER, wall], { topP1: ['grizzly-bears', 'grizzly-bears'], topP2: [wall.id] });
    goToMain1(game);
    const a = put(game, 'p1', 'grizzly-bears'); const b = put(game, 'p1', 'grizzly-bears');
    game.state.objects[a].summoningSick = false; game.state.objects[b].summoningSick = false;
    const w = put(game, 'p2', wall.id);
    passUntil(game, (s) => s.combatAwaiting === 'attackers');
    game.apply('p1', { type: 'declareAttackers', attackers: [a, b] });
    passUntil(game, (s) => s.combatAwaiting === 'blockers');
    expect(game.apply('p2', { type: 'declareBlockers', blocks: [{ blocker: w, attacker: a }, { blocker: w, attacker: b }] }).ok).toBe(true);
  });
});
