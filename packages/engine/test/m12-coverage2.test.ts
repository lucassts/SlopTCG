/** M12: segunda rodada de cobertura — Mana Leak, lutas, fichas, Thoughtseize, qualificadores de alvo, Storm/Convoke. */
import { describe, expect, it } from 'vitest';
import { compileOracleCard, type OracleInput } from '../src/cards/oracle-parser.js';
import { forest, grizzlyBears, island, lightningBolt, mountain, plains, swamp } from '../src/cards/demo-set.js';
import type { CardDefinition } from '../src/cards/types.js';
import type { Game } from '../src/game.js';
import type { PlayerId } from '../src/types.js';
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

const manaLeak = mk({ name: 'Mana Leak', manaCost: '{1}{U}', typeLine: 'Instant', colors: ['U'], oracleText: 'Counter target spell unless its controller pays {3}.' });
const prey = mk({ name: 'Prey Upon', manaCost: '{G}', typeLine: 'Sorcery', colors: ['G'], oracleText: "Target creature you control fights target creature you don't control." });
const bite = mk({ name: 'Rabid Bite', manaCost: '{1}{G}', typeLine: 'Sorcery', colors: ['G'], oracleText: "Target creature you control deals damage equal to its power to target creature you don't control." });
const thoughtseize = mk({ name: 'Thoughtseize', manaCost: '{B}', typeLine: 'Sorcery', colors: ['B'], oracleText: 'Target player reveals their hand. You choose a nonland card from it. That player discards that card. You lose 2 life.' });
const treasureMaker = mk({ name: 'Gold Digger', manaCost: '{1}{R}', typeLine: 'Creature — Goblin', power: 1, toughness: 1, colors: ['R'], oracleText: 'When this creature enters, create a Treasure token.' });
const smite = mk({ name: 'Smite the Tapped', manaCost: '{W}', typeLine: 'Instant', colors: ['W'], oracleText: 'Destroy target tapped creature.' });
const convoked = mk({ name: 'Chord Lite', manaCost: '{2}{G}', typeLine: 'Instant', colors: ['G'], oracleText: 'Convoke\nTarget creature gets +3/+3 until end of turn.' });
const grapeshotOracle = mk({ name: 'Grapeshot', manaCost: '{1}{R}', typeLine: 'Sorcery', colors: ['R'], oracleText: 'Grapeshot deals 1 damage to any target.\nStorm' });
const naturalize = mk({ name: 'Naturalize', manaCost: '{1}{G}', typeLine: 'Instant', colors: ['G'], oracleText: 'Destroy target artifact or enchantment.' });
const solRing = mk({ name: 'Sol Ring', manaCost: '{1}', typeLine: 'Artifact', oracleText: '{T}: Add {C}{C}.' });

describe('M12 · terrenos básicos', () => {
  it('Forest oficial (texto só de lembrete) ganha {T}: Add {G} (regra 305.6)', () => {
    const forestOracle = mk({ name: 'Forest', typeLine: 'Basic Land — Forest', oracleText: '({T}: Add {G}.)' });
    expect(forestOracle.automation).toBe('full');
    expect(forestOracle.abilities?.[0]).toMatchObject({ kind: 'activated', isManaAbility: true, effect: [{ op: 'addMana', mana: ['G'] }] });
    const snow = mk({ name: 'Snow-Covered Island', typeLine: 'Basic Snow Land — Island', oracleText: '({T}: Add {U}.)' });
    expect(snow.abilities?.[0]).toMatchObject({ effect: [{ op: 'addMana', mana: ['U'] }] });
    // dual básico-tipado (Tropical Island) ganha as duas
    const trop = mk({ name: 'Tropical Island', typeLine: 'Land — Forest Island', oracleText: '({T}: Add {G} or {U}.)' });
    expect(trop.abilities).toHaveLength(2);
  });
});

describe('M12 · compilação', () => {
  it('fixtures compilam; Convoke vira parcial com nota; Storm liga o storm', () => {
    for (const c of [manaLeak, prey, bite, thoughtseize, treasureMaker, smite, grapeshotOracle, naturalize]) expect(c.automation, c.name).toBe('full');
    expect(convoked.automation).toBe('partial');
    expect(convoked.automationNotes?.[0]).toContain('Convoke');
    expect(grapeshotOracle.storm).toBe(true);
    expect(prey.spellTargets).toHaveLength(2);
    expect(naturalize.spellTargets?.[0]).toMatchObject({ what: 'permanent', typeAnyOf: ['Artifact', 'Enchantment'] });
    expect(smite.spellTargets?.[0]).toMatchObject({ what: 'creature', tapped: true });
  });
});

describe('M12 · Mana Leak', () => {
  it('controlador paga {3} e a mágica sobrevive; sem mana, é anulada', () => {
    const game = makeGame([...FILLER, manaLeak, manaLeak], [...FILLER, grizzlyBears, grizzlyBears], { topP1: [manaLeak.id, manaLeak.id], topP2: ['grizzly-bears', 'grizzly-bears'] });
    goToMain1(game);
    put(game, 'p1', 'island'); put(game, 'p1', 'island'); put(game, 'p1', 'island'); put(game, 'p1', 'island');
    passUntil(game, (s) => s.turn === 2 && s.step === 'main1' && s.priority === 'p2');
    for (let i = 0; i < 5; i++) put(game, 'p2', 'forest');
    const bears = findIn(game, 'p2', 'hand', 'grizzly-bears');
    game.apply('p2', { type: 'castSpell', objectId: bears });
    game.apply('p2', { type: 'passPriority' });
    expect(game.apply('p1', { type: 'castSpell', objectId: findIn(game, 'p1', 'hand', manaLeak.id), targets: [{ kind: 'object', id: bears }] }).ok).toBe(true);
    passUntil(game, (s) => s.pendingDecision !== null);
    expect(game.state.pendingDecision).toMatchObject({ type: 'effectChoice', mode: 'confirm', player: 'p2' });
    expect(game.apply('p2', { type: 'effectChoice', picks: [], text: 'yes' }).ok).toBe(true);
    passUntil(game, (s) => s.stack.length === 0);
    expect(game.state.objects[bears].zone).toBe('battlefield'); // pagou, resolveu

    // segunda: sem mana sobrando → anulada automaticamente
    const bears2 = findIn(game, 'p2', 'hand', 'grizzly-bears');
    // p2 gastou 2 + 3 = 5 das 5 florestas; dá mana só para conjurar (não para pagar o Leak)
    put(game, 'p2', 'forest'); put(game, 'p2', 'mountain');
    game.apply('p2', { type: 'castSpell', objectId: bears2 });
    game.apply('p2', { type: 'passPriority' });
    expect(game.apply('p1', { type: 'castSpell', objectId: findIn(game, 'p1', 'hand', manaLeak.id), targets: [{ kind: 'object', id: bears2 }] }).ok).toBe(true);
    passUntil(game, (s) => s.stack.length === 0);
    expect(game.state.objects[bears2].zone).toBe('graveyard');
  });
});

describe('M12 · dois alvos e fichas', () => {
  it('Prey Upon: luta entre as duas criaturas', () => {
    const game = makeGame([...FILLER, prey, grizzlyBears], [...FILLER, grizzlyBears], { topP1: [prey.id, 'grizzly-bears'], topP2: ['grizzly-bears'] });
    goToMain1(game);
    put(game, 'p1', 'forest');
    const mine = put(game, 'p1', 'grizzly-bears');
    const theirs = put(game, 'p2', 'grizzly-bears');
    expect(game.apply('p1', { type: 'castSpell', objectId: findIn(game, 'p1', 'hand', prey.id), targets: [{ kind: 'object', id: mine }, { kind: 'object', id: theirs }] }).ok).toBe(true);
    passUntil(game, (s) => s.stack.length === 0);
    expect(game.state.objects[mine].zone).toBe('graveyard');
    expect(game.state.objects[theirs].zone).toBe('graveyard');
  });

  it('Rabid Bite: só a minha causa dano', () => {
    const game = makeGame([...FILLER, bite, grizzlyBears], [...FILLER, grizzlyBears], { topP1: [bite.id, 'grizzly-bears'], topP2: ['grizzly-bears'] });
    goToMain1(game);
    put(game, 'p1', 'forest'); put(game, 'p1', 'forest');
    const mine = put(game, 'p1', 'grizzly-bears');
    const theirs = put(game, 'p2', 'grizzly-bears');
    game.apply('p1', { type: 'castSpell', objectId: findIn(game, 'p1', 'hand', bite.id), targets: [{ kind: 'object', id: mine }, { kind: 'object', id: theirs }] });
    passUntil(game, (s) => s.stack.length === 0);
    expect(game.state.objects[mine].zone).toBe('battlefield');
    expect(game.state.objects[theirs].zone).toBe('graveyard');
  });

  it('Treasure: ficha sacrifica por mana de qualquer cor', () => {
    const game = makeGame([...FILLER, treasureMaker, solRing], FILLER, { topP1: [treasureMaker.id, solRing.id] });
    goToMain1(game);
    put(game, 'p1', 'mountain'); put(game, 'p1', 'mountain');
    game.apply('p1', { type: 'castSpell', objectId: findIn(game, 'p1', 'hand', treasureMaker.id) });
    passUntil(game, (s) => s.stack.length === 0 && s.triggerQueue.length === 0);
    const treasure = game.state.players.p1.zones.battlefield.map((id) => game.state.objects[id]).find((o) => o.card.name === 'Treasure');
    expect(treasure).toBeDefined();
    expect(game.apply('p1', { type: 'activateAbility', objectId: treasure!.id, abilityIndex: 0, manaColor: 'U' }).ok).toBe(true);
    expect(game.state.players.p1.manaPool.U).toBe(1);
    expect(game.state.objects[treasure!.id]).toBeUndefined(); // ficha some
  });
});

describe('M12 · Thoughtseize e qualificadores', () => {
  it('Thoughtseize: conjurador escolhe carta não-terreno da mão alvo e perde 2', () => {
    const game = makeGame([...FILLER, thoughtseize], [...FILLER, grizzlyBears], { topP1: [thoughtseize.id], topP2: ['grizzly-bears'] });
    goToMain1(game);
    put(game, 'p1', 'swamp');
    const bears = findIn(game, 'p2', 'hand', 'grizzly-bears');
    game.apply('p1', { type: 'castSpell', objectId: findIn(game, 'p1', 'hand', thoughtseize.id), targets: [{ kind: 'player', player: 'p2' }] });
    // Só uma carta não-terreno na mão: escolha forçada, resolve sem round-trip.
    passUntil(game, (s) => s.stack.length === 0);
    expect(game.state.objects[bears].zone).toBe('graveyard');
    expect(game.state.players.p1.life).toBe(18);
  });

  it('"Destroy target tapped creature" recusa criatura desvirada', () => {
    const game = makeGame([...FILLER, smite], [...FILLER, grizzlyBears], { topP1: [smite.id], topP2: ['grizzly-bears'] });
    goToMain1(game);
    put(game, 'p1', 'plains');
    const bears = put(game, 'p2', 'grizzly-bears');
    const spell = findIn(game, 'p1', 'hand', smite.id);
    expect(game.apply('p1', { type: 'castSpell', objectId: spell, targets: [{ kind: 'object', id: bears }] }).ok).toBe(false);
    game.apply('p2', { type: 'manualTap', objectId: bears, tapped: true });
    expect(game.apply('p1', { type: 'castSpell', objectId: spell, targets: [{ kind: 'object', id: bears }] }).ok).toBe(true);
  });

  it('Convoke parcial: conjura pagando o custo cheio', () => {
    const game = makeGame([...FILLER, convoked, grizzlyBears], FILLER, { topP1: [convoked.id, 'grizzly-bears'] });
    goToMain1(game);
    for (let i = 0; i < 3; i++) put(game, 'p1', 'forest');
    const bears = put(game, 'p1', 'grizzly-bears');
    expect(game.apply('p1', { type: 'castSpell', objectId: findIn(game, 'p1', 'hand', convoked.id), targets: [{ kind: 'object', id: bears }] }).ok).toBe(true);
  });
});

void lightningBolt;
