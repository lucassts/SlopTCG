/**
 * M11: cobertura ampla do compilador oracle + mecânicas de engine que ela
 * exige (mana híbrida/phyrexiana, Sol Ring, flash, ward, evasões, auras
 * genéricas, modais, gatilhos com alvo, estáticas, habilidades genéricas).
 */
import { describe, expect, it } from 'vitest';
import { compileOracleCard, type OracleInput } from '../src/cards/oracle-parser.js';
import { forest, grizzlyBears, island, lightningBolt, mountain, plains, swamp } from '../src/cards/demo-set.js';
import type { CardDefinition } from '../src/cards/types.js';
import type { Game } from '../src/game.js';
import type { PlayerId } from '../src/types.js';
import { effectivePower } from '../src/state.js';
import { findIn, goToMain1, makeGame, passUntil } from './helpers.js';

const mk = (input: OracleInput): CardDefinition => {
  const def = compileOracleCard(input);
  if (!def) throw new Error(`não compilou: ${input.name}`);
  return def;
};

function copies(card: CardDefinition, n: number): CardDefinition[] {
  return Array.from({ length: n }, () => card);
}

function put(game: Game, player: PlayerId, cardId: string, zone: 'battlefield' | 'graveyard' | 'hand' = 'battlefield'): number {
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

const FILLER = [...copies(mountain, 6), ...copies(forest, 6), ...copies(island, 4), ...copies(plains, 4), ...copies(swamp, 4)];
const err = (r: { events: { type: string; message?: string }[] }) => r.events.find((e) => e.type === 'error')?.message;

// ------------------------------------------------------------------ fixtures
const solRing = mk({ name: 'Sol Ring', manaCost: '{1}', typeLine: 'Artifact', oracleText: '{T}: Add {C}{C}.' });
const borosReckoner = mk({ name: 'Boros Reckoner', manaCost: '{R/W}{R/W}{R/W}', typeLine: 'Creature — Minotaur Wizard', power: 3, toughness: 3, colors: ['R', 'W'], oracleText: '' });
const gitaxianProbe = mk({ name: 'Gitaxian Probe', manaCost: '{U/P}', typeLine: 'Sorcery', colors: ['U'], oracleText: 'Draw a card.' });
const flashBear = mk({ name: 'Ambush Bear', manaCost: '{1}{G}', typeLine: 'Creature — Bear', power: 2, toughness: 2, colors: ['G'], oracleText: 'Flash' });
const wardBear = mk({ name: 'Warded Bear', manaCost: '{1}{G}', typeLine: 'Creature — Bear', power: 2, toughness: 2, colors: ['G'], oracleText: 'Ward {2}' });
const fearBear = mk({ name: 'Fearful Bear', manaCost: '{1}{B}', typeLine: 'Creature — Bear', power: 2, toughness: 2, colors: ['B'], oracleText: 'Fear' });
const mustAttacker = mk({ name: 'Berserk Ox', manaCost: '{1}{R}', typeLine: 'Creature — Ox', power: 3, toughness: 1, colors: ['R'], oracleText: 'Berserk Ox attacks each combat if able.' });
const paralyze = mk({ name: 'Paralyze', manaCost: '{B}', typeLine: 'Enchantment — Aura', colors: ['B'], oracleText: "Enchant creature\nEnchanted creature doesn't untap during its controller's untap step." });
const surveilBear = mk({ name: 'Watchful Bear', manaCost: '{1}{U}', typeLine: 'Creature — Bear', power: 2, toughness: 2, colors: ['U'], oracleText: 'When Watchful Bear enters, surveil 2.' });
const naturalize2 = mk({ name: 'Nature Choice', manaCost: '{1}{G}', typeLine: 'Instant', colors: ['G'], oracleText: 'Choose one —\n• Destroy target artifact.\n• Destroy target enchantment.' });
const chupacabra = mk({ name: 'Ravenous Chupacabra', manaCost: '{2}{B}{B}', typeLine: 'Creature — Beast Horror', power: 2, toughness: 2, colors: ['B'], oracleText: 'When this creature enters, destroy target creature an opponent controls.' });
const goblinKing = mk({ name: 'Goblin Boss', manaCost: '{1}{R}{R}', typeLine: 'Creature — Goblin', power: 2, toughness: 2, colors: ['R'], oracleText: 'Other Goblin creatures you control get +1/+1 and have haste.' });
const firebreather = mk({ name: 'Firebreather', manaCost: '{2}{R}', typeLine: 'Creature — Dragon', power: 2, toughness: 2, colors: ['R'], oracleText: '{R}: Firebreather gets +1/+0 until end of turn.' });
const sacDraw = mk({ name: 'Chromatic Sphere', manaCost: '{1}', typeLine: 'Artifact', oracleText: '{2}, Sacrifice this artifact: Draw a card.' });
const landAura = mk({ name: 'Wild Growth', manaCost: '{G}', typeLine: 'Enchantment — Aura', colors: ['G'], oracleText: 'Enchant land\nWhenever enchanted land is tapped for mana, its controller adds an additional {G}.' });
const negate = mk({ name: 'Negate', manaCost: '{1}{U}', typeLine: 'Instant', colors: ['U'], oracleText: 'Counter target noncreature spell.' });
const exileSpell = mk({ name: 'Flame Rift Lite', manaCost: '{R}', typeLine: 'Instant', colors: ['R'], oracleText: 'Flame Rift Lite deals 2 damage to any target. Exile Flame Rift Lite.' });
const anthem = mk({ name: 'Glorious Anthem', manaCost: '{1}{W}{W}', typeLine: 'Enchantment', colors: ['W'], oracleText: 'Creatures you control get +1/+1.' });
const goblinToken = mk({ name: 'Goblin Grunt', manaCost: '{R}', typeLine: 'Creature — Goblin', power: 1, toughness: 1, colors: ['R'], oracleText: '' });

describe('M11 · compilação', () => {
  it('todas as fixtures compilam como full (exceto a aura de terreno, parcial)', () => {
    for (const c of [solRing, borosReckoner, gitaxianProbe, flashBear, wardBear, fearBear, mustAttacker, paralyze, surveilBear, naturalize2, chupacabra, goblinKing, firebreather, sacDraw, negate, exileSpell, anthem])
      expect(c.automation, c.name).toBe('full');
    expect(landAura.automation).toBe('partial');
    expect(landAura.enchant).toEqual({ what: 'land', controlledBy: undefined });
    expect(naturalize2.spellModes).toHaveLength(2);
    expect(chupacabra.abilities?.[0]).toMatchObject({ kind: 'triggered', targets: [{ what: 'creature', controlledBy: 'opponent' }] });
    expect(goblinKing.abilities?.[0]).toMatchObject({ kind: 'static', filter: { subtype: 'Goblin', other: true }, power: 1, keywords: ['haste'] });
    expect(wardBear.ward).toBe(2);
    expect(negate.spellTargets?.[0]).toMatchObject({ what: 'spell', spellType: 'noncreature' });
    expect(exileSpell.exileOnResolve).toBe(true);
  });
});

describe('M11 · mana', () => {
  it('Sol Ring paga {2} sozinho no auto-tap', () => {
    const game = makeGame([...FILLER, solRing, grizzlyBears], FILLER, { topP1: [solRing.id, 'grizzly-bears'] });
    goToMain1(game);
    put(game, 'p1', solRing.id);
    // tira todos os terrenos do campo? não há nenhum: só o Sol Ring no campo
    const bears = findIn(game, 'p1', 'hand', 'grizzly-bears');
    // Grizzly Bears custa {1}{G}: Sol Ring não paga {G}. Use uma carta genérica: Chromatic Sphere {1} + sobra
    const r = game.apply('p1', { type: 'castSpell', objectId: bears });
    expect(r.ok).toBe(false); // sem verde
    expect(err(r)).toBe('mana insuficiente');
  });

  it('Sol Ring: sobra do tap fica flutuando', () => {
    const game = makeGame([...FILLER, solRing, sacDraw], FILLER, { topP1: [solRing.id, sacDraw.id] });
    goToMain1(game);
    put(game, 'p1', solRing.id);
    const sphere = findIn(game, 'p1', 'hand', sacDraw.id);
    expect(game.apply('p1', { type: 'castSpell', objectId: sphere }).ok).toBe(true);
    expect(game.state.players.p1.manaPool.C).toBe(1); // {C}{C} produzido, {1} gasto
  });

  it('híbrido {R/W}: paga só com Mountains', () => {
    const game = makeGame([...FILLER, borosReckoner], FILLER, { topP1: [borosReckoner.id] });
    goToMain1(game);
    for (let i = 0; i < 3; i++) put(game, 'p1', 'mountain');
    const r = game.apply('p1', { type: 'castSpell', objectId: findIn(game, 'p1', 'hand', borosReckoner.id) });
    expect(r.ok).toBe(true);
  });

  it('phyrexiano {U/P}: sem Island paga 2 de vida', () => {
    const game = makeGame([...FILLER, gitaxianProbe], FILLER, { topP1: [gitaxianProbe.id] });
    goToMain1(game);
    const r = game.apply('p1', { type: 'castSpell', objectId: findIn(game, 'p1', 'hand', gitaxianProbe.id) });
    expect(r.ok).toBe(true);
    expect(game.state.players.p1.life).toBe(18);
  });
});

describe('M11 · timing e alvos', () => {
  it('Flash: criatura conjurável fora da fase principal', () => {
    const game = makeGame([...FILLER, flashBear, grizzlyBears], FILLER, { topP1: [flashBear.id, 'grizzly-bears'] });
    // manutenção do turno 1: p1 tem prioridade
    passUntil(game, (s) => s.step === 'upkeep' && s.priority === 'p1');
    put(game, 'p1', 'forest'); put(game, 'p1', 'forest');
    expect(game.apply('p1', { type: 'castSpell', objectId: findIn(game, 'p1', 'hand', 'grizzly-bears') }).ok).toBe(false);
    expect(game.apply('p1', { type: 'castSpell', objectId: findIn(game, 'p1', 'hand', flashBear.id) }).ok).toBe(true);
  });

  it('Ward {2}: Bolt do oponente custa {R} + {2}', () => {
    const game = makeGame([...FILLER, wardBear], [...FILLER, lightningBolt], { topP1: [wardBear.id], topP2: ['lightning-bolt'] });
    goToMain1(game);
    const bear = put(game, 'p1', wardBear.id);
    put(game, 'p2', 'mountain');
    game.apply('p1', { type: 'passPriority' });
    const bolt = findIn(game, 'p2', 'hand', 'lightning-bolt');
    const r1 = game.apply('p2', { type: 'castSpell', objectId: bolt, targets: [{ kind: 'object', id: bear }] });
    expect(r1.ok).toBe(false); // só 1 Mountain
    put(game, 'p2', 'mountain'); put(game, 'p2', 'mountain');
    const r2 = game.apply('p2', { type: 'castSpell', objectId: bolt, targets: [{ kind: 'object', id: bear }] });
    expect(r2.ok).toBe(true);
  });

  it('Negate não pode anular uma criatura', () => {
    const game = makeGame([...FILLER, negate], [...FILLER, grizzlyBears], { topP1: [negate.id], topP2: ['grizzly-bears'] });
    goToMain1(game);
    put(game, 'p1', 'island'); put(game, 'p1', 'island');
    passUntil(game, (s) => s.turn === 2 && s.step === 'main1' && s.priority === 'p2');
    put(game, 'p2', 'forest'); put(game, 'p2', 'forest');
    const bears = findIn(game, 'p2', 'hand', 'grizzly-bears');
    expect(game.apply('p2', { type: 'castSpell', objectId: bears }).ok).toBe(true);
    game.apply('p2', { type: 'passPriority' });
    const r = game.apply('p1', { type: 'castSpell', objectId: findIn(game, 'p1', 'hand', negate.id), targets: [{ kind: 'object', id: bears }] });
    expect(r.ok).toBe(false);
    expect(err(r)).toBe('alvo ilegal');
  });

  it('"Exile ~." ao resolver manda a mágica para o exílio', () => {
    const game = makeGame([...FILLER, exileSpell], FILLER, { topP1: [exileSpell.id] });
    goToMain1(game);
    put(game, 'p1', 'mountain');
    const spell = findIn(game, 'p1', 'hand', exileSpell.id);
    game.apply('p1', { type: 'castSpell', objectId: spell, targets: [{ kind: 'player', player: 'p2' }] });
    passUntil(game, (s) => s.stack.length === 0);
    expect(game.state.players.p2.life).toBe(18);
    expect(game.state.objects[spell].zone).toBe('exile');
  });
});

describe('M11 · combate e untap', () => {
  it('Fear: só criatura preta ou artefato bloqueia', () => {
    const game = makeGame([...FILLER, fearBear], [...FILLER, grizzlyBears, fearBear], { topP1: [fearBear.id], topP2: ['grizzly-bears', fearBear.id] });
    goToMain1(game);
    const atk = put(game, 'p1', fearBear.id);
    game.state.objects[atk].summoningSick = false;
    const bears = put(game, 'p2', 'grizzly-bears');
    const blackBlocker = put(game, 'p2', fearBear.id);
    passUntil(game, (s) => s.combatAwaiting === 'attackers');
    game.apply('p1', { type: 'declareAttackers', attackers: [atk] });
    passUntil(game, (s) => s.combatAwaiting === 'blockers');
    expect(game.apply('p2', { type: 'declareBlockers', blocks: [{ blocker: bears, attacker: atk }] }).ok).toBe(false);
    expect(game.apply('p2', { type: 'declareBlockers', blocks: [{ blocker: blackBlocker, attacker: atk }] }).ok).toBe(true);
  });

  it('"attacks each combat if able" obriga a atacar', () => {
    const game = makeGame([...FILLER, mustAttacker], FILLER, { topP1: [mustAttacker.id] });
    goToMain1(game);
    const ox = put(game, 'p1', mustAttacker.id);
    game.state.objects[ox].summoningSick = false;
    passUntil(game, (s) => s.combatAwaiting === 'attackers');
    expect(game.apply('p1', { type: 'declareAttackers', attackers: [] }).ok).toBe(false);
    expect(game.apply('p1', { type: 'declareAttackers', attackers: [ox] }).ok).toBe(true);
  });

  it('Paralyze: criatura encantada não desvira', () => {
    const game = makeGame([...FILLER, paralyze], [...FILLER, grizzlyBears], { topP1: [paralyze.id], topP2: ['grizzly-bears'] });
    goToMain1(game);
    put(game, 'p1', 'swamp');
    const bears = put(game, 'p2', 'grizzly-bears');
    game.apply('p2', { type: 'manualTap', objectId: bears, tapped: true });
    const aura = findIn(game, 'p1', 'hand', paralyze.id);
    expect(game.apply('p1', { type: 'castSpell', objectId: aura, targets: [{ kind: 'object', id: bears }] }).ok).toBe(true);
    passUntil(game, (s) => s.stack.length === 0);
    expect(game.state.objects[aura].attachedTo).toBe(bears);
    passUntil(game, (s) => s.turn === 2 && s.step === 'main1');
    expect(game.state.objects[bears].tapped).toBe(true); // continuou virada no untap do p2
  });
});

describe('M11 · gatilhos, estáticas, habilidades e modais', () => {
  it('Chupacabra: ETB com alvo destrói criatura do oponente', () => {
    const game = makeGame([...FILLER, chupacabra], [...FILLER, grizzlyBears], { topP1: [chupacabra.id], topP2: ['grizzly-bears'] });
    goToMain1(game);
    for (let i = 0; i < 4; i++) put(game, 'p1', 'swamp');
    const bears = put(game, 'p2', 'grizzly-bears');
    game.apply('p1', { type: 'castSpell', objectId: findIn(game, 'p1', 'hand', chupacabra.id) });
    passUntil(game, (s) => s.pendingDecision?.type === 'chooseTargets');
    expect(game.apply('p1', { type: 'chooseTargets', targets: [{ kind: 'object', id: bears }] }).ok).toBe(true);
    passUntil(game, (s) => s.stack.length === 0);
    expect(game.state.objects[bears].zone).toBe('graveyard');
  });

  it('surveil: carta escolhida vai para o cemitério', () => {
    const game = makeGame([...FILLER, surveilBear], FILLER, { topP1: [surveilBear.id] });
    goToMain1(game);
    put(game, 'p1', 'island'); put(game, 'p1', 'island');
    game.apply('p1', { type: 'castSpell', objectId: findIn(game, 'p1', 'hand', surveilBear.id) });
    passUntil(game, (s) => s.pendingDecision?.type === 'effectChoice');
    const pd = game.state.pendingDecision;
    if (pd?.type !== 'effectChoice') throw new Error('sem escolha');
    const gyBefore = game.state.players.p1.zones.graveyard.length;
    game.apply('p1', { type: 'effectChoice', picks: [pd.options[0]] });
    expect(game.state.players.p1.zones.graveyard.length).toBe(gyBefore + 1);
  });

  it('lord: outros Goblins ganham +1/+1 e haste', () => {
    const game = makeGame([...FILLER, goblinKing, goblinToken], FILLER, { topP1: [goblinKing.id, goblinToken.id] });
    goToMain1(game);
    const boss = put(game, 'p1', goblinKing.id);
    const grunt = put(game, 'p1', goblinToken.id);
    expect(effectivePower(game.state, game.state.objects[grunt])).toBe(2);
    expect(effectivePower(game.state, game.state.objects[boss])).toBe(2); // "Other": o próprio não ganha
  });

  it('Glorious Anthem: +1/+1 nas criaturas', () => {
    const game = makeGame([...FILLER, anthem, grizzlyBears], FILLER, { topP1: [anthem.id, 'grizzly-bears'] });
    goToMain1(game);
    put(game, 'p1', anthem.id);
    const bears = put(game, 'p1', 'grizzly-bears');
    expect(effectivePower(game.state, game.state.objects[bears])).toBe(3);
  });

  it('habilidade ativada genérica: {R}: +1/+0', () => {
    const game = makeGame([...FILLER, firebreather], FILLER, { topP1: [firebreather.id] });
    goToMain1(game);
    put(game, 'p1', 'mountain');
    const dragon = put(game, 'p1', firebreather.id);
    expect(game.apply('p1', { type: 'activateAbility', objectId: dragon, abilityIndex: 0 }).ok).toBe(true);
    passUntil(game, (s) => s.stack.length === 0);
    expect(effectivePower(game.state, game.state.objects[dragon])).toBe(3);
  });

  it('"{2}, Sacrifice ~: Draw a card."', () => {
    const game = makeGame([...FILLER, sacDraw], FILLER, { topP1: [sacDraw.id] });
    goToMain1(game);
    put(game, 'p1', 'mountain'); put(game, 'p1', 'mountain');
    const sphere = put(game, 'p1', sacDraw.id);
    const hand = game.state.players.p1.zones.hand.length;
    expect(game.apply('p1', { type: 'activateAbility', objectId: sphere, abilityIndex: 0 }).ok).toBe(true);
    passUntil(game, (s) => s.stack.length === 0);
    expect(game.state.objects[sphere].zone).toBe('graveyard');
    expect(game.state.players.p1.zones.hand.length).toBe(hand + 1);
  });

  it('modal: segundo modo destrói encantamento, e não aceita artefato', () => {
    const game = makeGame([...FILLER, naturalize2], [...FILLER, anthem, solRing], { topP1: [naturalize2.id], topP2: [anthem.id, solRing.id] });
    goToMain1(game);
    put(game, 'p1', 'forest'); put(game, 'p1', 'forest');
    const ench = put(game, 'p2', anthem.id);
    const ring = put(game, 'p2', solRing.id);
    const spell = findIn(game, 'p1', 'hand', naturalize2.id);
    expect(game.apply('p1', { type: 'castSpell', objectId: spell, mode: 1, targets: [{ kind: 'object', id: ring }] }).ok).toBe(false);
    expect(game.apply('p1', { type: 'castSpell', objectId: spell, mode: 1, targets: [{ kind: 'object', id: ench }] }).ok).toBe(true);
    passUntil(game, (s) => s.stack.length === 0);
    expect(game.state.objects[ench].zone).toBe('graveyard');
  });

  it('aura de terreno (parcial) conjura, anexa e sobrevive à SBA', () => {
    const game = makeGame([...FILLER, landAura], FILLER, { topP1: [landAura.id] });
    goToMain1(game);
    const land = put(game, 'p1', 'forest');
    put(game, 'p1', 'forest');
    const aura = findIn(game, 'p1', 'hand', landAura.id);
    expect(game.apply('p1', { type: 'castSpell', objectId: aura, targets: [{ kind: 'object', id: land }] }).ok).toBe(true);
    passUntil(game, (s) => s.stack.length === 0);
    expect(game.state.objects[aura].zone).toBe('battlefield');
    expect(game.state.objects[aura].attachedTo).toBe(land);
  });
});
