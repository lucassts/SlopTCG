/** M20 (Leva 5b): cartas de várias faces (transform, MDFC, aventura, dividida/fuse/aftermath, disturb, dia/noite, saga transformada, batalhas, prepare), P/T variável, soulbond, provoke, enlist, casualty, kinship, gatilho de estado, restrição de conjuração, modos repetidos. */
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
const answerMay = (game: Game, p: PlayerId, yes = true) => {
  const pd = game.state.pendingDecision;
  if (pd?.type === 'effectChoice') game.apply(p, { type: 'effectChoice', picks: [], text: yes ? 'yes' : 'no' });
};

// ---- faces
const delverish = mk({
  name: 'Bear Cultist', manaCost: '{U}', typeLine: 'Creature — Human Wizard', power: 1, toughness: 1, colors: ['U'], layout: 'transform',
  oracleText: '{1}{U}: Transform Bear Cultist. Activate only as a sorcery.',
  backFace: { name: 'Insectile Bear', typeLine: 'Creature — Human Insect', power: 3, toughness: 2, colors: ['U'], oracleText: 'Flying\nWhen this creature transforms into Insectile Bear, you gain 1 life.' },
});
const mdfcLand = mk({
  name: 'Bear Enchanter', manaCost: '{3}{W}', typeLine: 'Creature — Human Warlock', power: 3, toughness: 2, colors: ['W'], layout: 'modal_dfc',
  oracleText: 'When Bear Enchanter enters, you gain 2 life.',
  backFace: { name: 'Bear-Blessed Meadow', typeLine: 'Land', oracleText: 'Bear-Blessed Meadow enters tapped.\n{T}: Add {W}.' },
});
const mdfcSpell = mk({
  name: 'Bear Celebrant', manaCost: '{1}{R}', typeLine: 'Creature — Human Shaman', power: 2, toughness: 1, colors: ['R'], layout: 'modal_dfc',
  oracleText: '{1}{R}: Bear Celebrant gets +2/+0 until end of turn.',
  backFace: { name: 'Revel in Bears', manaCost: '{W}', typeLine: 'Instant', colors: ['W'], oracleText: 'You gain 3 life.' },
});
const adventure = mk({
  name: 'Bear Knight', manaCost: '{1}{G}', typeLine: 'Creature — Bear Knight', power: 2, toughness: 2, colors: ['G'], layout: 'adventure',
  oracleText: 'Vigilance',
  backFace: { name: 'Bear Feast', manaCost: '{G}', typeLine: 'Sorcery — Adventure', colors: ['G'], oracleText: 'You gain 2 life.' },
});
const split = mk({
  name: 'Fire', manaCost: '{1}{R}', typeLine: 'Instant', colors: ['R'], layout: 'split',
  oracleText: 'Fire deals 2 damage to any target.\nFuse',
  backFace: { name: 'Ice', manaCost: '{1}{U}', typeLine: 'Instant', colors: ['U'], oracleText: 'Tap target permanent.\nFuse' },
});
const aftermath = mk({
  name: 'Bear Heaven', manaCost: '{G}', typeLine: 'Instant', colors: ['G'], layout: 'split',
  oracleText: 'You gain 2 life.',
  backFace: { name: 'Bear Earth', manaCost: '{R}', typeLine: 'Sorcery', colors: ['R'], oracleText: 'Aftermath\nBear Earth deals 2 damage to any target.' },
});
const disturb = mk({
  name: 'Bear Veteran', manaCost: '{W}', typeLine: 'Creature — Human Cleric', power: 1, toughness: 1, colors: ['W'], layout: 'transform',
  oracleText: 'Disturb {1}{W}',
  backFace: { name: 'Bear Phantom', typeLine: 'Creature — Spirit Cleric', power: 1, toughness: 1, colors: ['W'], oracleText: 'Flying\nIf Bear Phantom would be put into a graveyard from anywhere, exile it instead.' },
});
const werewolf = mk({
  name: 'Village Bear', manaCost: '{2}{B}', typeLine: 'Creature — Human Werewolf', power: 3, toughness: 3, colors: ['B'], layout: 'transform',
  oracleText: 'Daybound',
  backFace: { name: 'Glutton Bear', typeLine: 'Creature — Werewolf', power: 4, toughness: 4, colors: ['B'], oracleText: 'Nightbound' },
});
const oldWerewolf = mk({
  name: 'Old Bear Wolf', manaCost: '{1}{R}', typeLine: 'Creature — Human Werewolf', power: 2, toughness: 2, colors: ['R'], layout: 'transform',
  oracleText: 'At the beginning of each upkeep, if no spells were cast last turn, transform Old Bear Wolf.',
  backFace: { name: 'Howling Bear', typeLine: 'Creature — Werewolf', power: 3, toughness: 3, colors: ['R'], oracleText: 'At the beginning of each upkeep, if a player cast two or more spells last turn, transform Howling Bear.' },
});
const sagaDfc = mk({
  name: 'Bear Saga', manaCost: '{1}{G}', typeLine: 'Enchantment — Saga', colors: ['G'], layout: 'transform',
  oracleText: 'I — You gain 1 life.\nII — Draw a card.\nIII — Exile Bear Saga, then return it to the battlefield transformed under your control.',
  backFace: { name: 'Bear Avatar', typeLine: 'Enchantment Creature — Bear', power: 4, toughness: 4, colors: ['G'], oracleText: 'Trample' },
});
const battle = mk({
  name: 'Invasion of Bears', manaCost: '{1}{G}', typeLine: 'Battle — Siege', colors: ['G'], layout: 'battle', defense: 3,
  oracleText: 'When Invasion of Bears enters, you gain 2 life.',
  backFace: { name: 'Bear Overlord', typeLine: 'Creature — Bear Elemental', power: 5, toughness: 5, colors: ['G'], oracleText: 'Trample' },
});
const prepare = mk({
  name: 'Adventurous Bear', manaCost: '{2}{B}', typeLine: 'Creature — Human Warlock', power: 3, toughness: 2, colors: ['B'], layout: 'prepare',
  oracleText: 'This creature enters prepared.',
  backFace: { name: 'Have a Bite', manaCost: '{B}', typeLine: 'Sorcery', colors: ['B'], oracleText: 'You gain 1 life.' },
});

// ---- P/T variável e mecânicas
const cdaLands = mk({ name: 'Bear Titan', manaCost: '{2}{G}', typeLine: 'Creature — Bear', colors: ['G'], oracleText: "Bear Titan's power and toughness are each equal to the number of lands you control." });
const cdaHand = mk({ name: 'Bear Maro', manaCost: '{2}{U}', typeLine: 'Creature — Bear', colors: ['U'], oracleText: "Bear Maro's power is equal to the number of cards in your hand and its toughness is equal to that number plus 1." });
const soulbond = mk({ name: 'Bonded Bear', manaCost: '{1}{G}', typeLine: 'Creature — Bear', power: 2, toughness: 2, colors: ['G'], oracleText: 'Soulbond\nAs long as Bonded Bear is paired with another creature, both creatures get +1/+1 and have trample.' });
const provoke = mk({ name: 'Grappler Bear', manaCost: '{R}', typeLine: 'Creature — Bear', power: 1, toughness: 1, colors: ['R'], oracleText: 'Provoke' });
const enlist = mk({ name: 'Sage Bear', manaCost: '{2}{R}', typeLine: 'Creature — Bear', power: 2, toughness: 3, colors: ['R'], oracleText: 'Enlist' });
const casualty = mk({ name: 'Bear Finale', manaCost: '{B}', typeLine: 'Sorcery', colors: ['B'], oracleText: 'Casualty 1\nYou gain 2 life.' });
const kinship = mk({ name: 'Consul Bear', manaCost: '{2}{R}', typeLine: 'Creature — Bear Shaman', power: 2, toughness: 2, colors: ['R'], oracleText: 'Kinship — At the beginning of your upkeep, you may look at the top card of your library. If it shares a creature type with Consul Bear, you may reveal it. If you do, you gain 2 life.' });
const noIslands = mk({ name: 'Island Bear', manaCost: '{U}', typeLine: 'Creature — Bear', power: 2, toughness: 1, colors: ['U'], oracleText: 'When you control no Islands, sacrifice Island Bear.' });
const attackedOnly = mk({ name: 'Bear Ambush', manaCost: '{1}{W}', typeLine: 'Instant', colors: ['W'], oracleText: "Cast Bear Ambush only during the declare attackers step and only if you've been attacked this step.\nYou gain 3 life." });
const chooseThree = mk({ name: 'Bear Triad', manaCost: '{2}{G}', typeLine: 'Sorcery', colors: ['G'], oracleText: 'Choose three. You may choose the same mode more than once.\n• You gain 1 life.\n• Draw a card.' });

const ALL = [delverish, mdfcLand, mdfcSpell, adventure, split, aftermath, disturb, werewolf, oldWerewolf, sagaDfc, battle, prepare, cdaLands, cdaHand, soulbond, provoke, enlist, casualty, kinship, noIslands, attackedOnly, chooseThree];

describe('M20 · compilação', () => {
  it('tudo compila como full, com as duas faces', () => {
    for (const c of ALL) expect(c.automation, `${c.name}: ${c.automationNotes?.join(' | ')}`).toBe('full');
    for (const c of [delverish, mdfcLand, mdfcSpell, adventure, split, aftermath, disturb, werewolf, oldWerewolf, sagaDfc, battle, prepare]) {
      expect(c.backFace, c.name).toBeDefined();
      expect(c.backFace?.isBackFace).toBe(true);
      expect(c.backFace?.automation).toBe('full');
    }
    expect(delverish.abilities?.[0]).toMatchObject({ kind: 'activated', effect: [{ op: 'transform', what: 'self' }], sorceryOnly: true });
    expect(delverish.backFace?.abilities?.find((a) => a.kind === 'triggered')).toMatchObject({ trigger: { on: 'transformsInto', self: true } });
    expect(mdfcLand.backFace?.types).toEqual(['Land']);
    expect(split.fuse).toBe(true);
    expect(aftermath.backFace).toMatchObject({ aftermath: true, exileOnResolve: true });
    expect(disturb.disturb).toBe('{1}{W}');
    expect(disturb.backFace?.exileInsteadOfGraveyard).toBe(true);
    expect(werewolf.daybound).toBe(true);
    expect(werewolf.backFace?.nightbound).toBe(true);
    expect(oldWerewolf.abilities?.[0]).toMatchObject({ trigger: { on: 'upkeep', whose: 'each' }, condition: { kind: 'noSpellsLastTurn' }, effect: [{ op: 'transform', what: 'self' }] });
    expect(sagaDfc.abilities?.[2].effect).toEqual([{ op: 'returnTransformed', what: 'self' }]);
    expect(battle.defense).toBe(3);
    expect(battle.types).toEqual(['Battle']);
    expect(prepare.entersPrepared).toBe(true);
    expect(prepare.abilities?.[0]).toMatchObject({ kind: 'activated', cost: { mana: '{B}' }, condition: { cond: { kind: 'prepared' } }, effect: [{ op: 'unprepare' }, { op: 'gainLife', who: 'controller', amount: 1 }] });
    expect(cdaLands.cdaPower).toEqual({ per: { what: 'land', controlledBy: 'you' } });
    expect(cdaHand.cdaToughness).toEqual({ plus: 1, of: { handSize: 'controller' } });
    expect(soulbond.pairedBonus).toEqual({ power: 1, toughness: 1, keywords: ['trample'] });
    expect(provoke.abilities?.[0]).toMatchObject({ trigger: { on: 'attacks', self: true }, effect: [{ op: 'untap' }, { op: 'mustBlockSource' }] });
    expect(enlist.enlist).toBe(true);
    expect(casualty.casualty).toBe(1);
    expect(kinship.abilities?.[0]).toMatchObject({ trigger: { on: 'upkeep', whose: 'controller' }, effect: [{ op: 'if', cond: { kind: 'topCardSharesCreatureType' } }] });
    expect(noIslands.abilities?.[0]).toMatchObject({ trigger: { on: 'controlsNone', filter: { what: 'land', subtype: 'Island', controlledBy: 'you' } }, effect: [{ op: 'sacrificeSelf' }] });
    expect(attackedOnly.castOnly).toEqual({ kind: 'beingAttacked' });
    expect(chooseThree.spellModeChoice).toEqual({ min: 3, max: 3, repeat: true });
  });
  it('criatura com * sem definição de P/T não compila', () => {
    expect(compileOracleCard({ name: 'Mystery Bear', manaCost: '{G}', typeLine: 'Creature — Bear', colors: ['G'], oracleText: 'Trample' })).toBeNull();
  });
});

describe('M20 · faces', () => {
  it('transformar troca as características e dispara "transforms into"', () => {
    const game = makeGame([...FILLER, delverish], FILLER, { topP1: [delverish.id] });
    goToMain1(game);
    const id = put(game, 'p1', delverish.id);
    put(game, 'p1', 'island'); put(game, 'p1', 'island');
    expect(effectivePower(game.state, game.state.objects[id])).toBe(1);
    expect(game.apply('p1', { type: 'activateAbility', objectId: id, abilityIndex: 0 }).ok).toBe(true);
    settle(game);
    const o = game.state.objects[id];
    expect(o.transformed).toBe(true);
    expect(o.card.name).toBe('Insectile Bear');
    expect(effectivePower(game.state, o)).toBe(3);
    expect(hasKeyword(game.state, o, 'flying')).toBe(true);
    expect(game.state.players.p1.life).toBe(21);
    // Ao sair do campo volta para a frente.
    game.apply('p1', { type: 'manualMove', objectId: id, to: 'hand' });
    expect(o.transformed).toBeFalsy();
    expect(o.card.name).toBe('Bear Cultist');
  });

  it('MDFC: jogar o verso como terreno', () => {
    const game = makeGame([...FILLER, mdfcLand], FILLER, { topP1: [mdfcLand.id] });
    goToMain1(game);
    const id = findIn(game, 'p1', 'hand', mdfcLand.id);
    expect(game.apply('p1', { type: 'playLand', objectId: id, face: 'back' }).ok).toBe(true);
    const o = game.state.objects[id];
    expect(o.zone).toBe('battlefield');
    expect(o.card.name).toBe('Bear-Blessed Meadow');
    expect(o.tapped).toBe(true);
  });

  it('MDFC: conjurar o verso como mágica', () => {
    const game = makeGame([...FILLER, mdfcSpell], FILLER, { topP1: [mdfcSpell.id] });
    goToMain1(game);
    put(game, 'p1', 'plains');
    const id = findIn(game, 'p1', 'hand', mdfcSpell.id);
    expect(cast(game, 'p1', id, { face: 'back' }).ok).toBe(true);
    settle(game);
    expect(game.state.players.p1.life).toBe(23);
    expect(game.state.objects[id].zone).toBe('graveyard');
    expect(game.state.objects[id].card.name).toBe('Bear Celebrant');
  });

  it('aventura: conjura a aventura, fica no exílio, depois conjura a criatura', () => {
    const game = makeGame([...FILLER, adventure], FILLER, { topP1: [adventure.id] });
    goToMain1(game);
    put(game, 'p1', 'forest'); put(game, 'p1', 'forest'); put(game, 'p1', 'forest');
    const id = findIn(game, 'p1', 'hand', adventure.id);
    expect(cast(game, 'p1', id, { face: 'back' }).ok).toBe(true);
    settle(game);
    const o = game.state.objects[id];
    expect(game.state.players.p1.life).toBe(22);
    expect(o.zone).toBe('exile');
    expect(o.exiledAs).toBe('adventure');
    expect(cast(game, 'p1', id).ok).toBe(true);
    settle(game);
    expect(o.zone).toBe('battlefield');
    expect(o.card.name).toBe('Bear Knight');
  });

  it('carta dividida: uma metade, a outra metade, e fuse', () => {
    const game = makeGame([...FILLER, split, split], [...FILLER, grizzlyBears], { topP1: [split.id, split.id], topP2: ['grizzly-bears'] });
    goToMain1(game);
    const bears = put(game, 'p2', 'grizzly-bears');
    for (let i = 0; i < 2; i++) { put(game, 'p1', 'mountain'); put(game, 'p1', 'island'); }
    const a = findIn(game, 'p1', 'hand', split.id);
    expect(cast(game, 'p1', a, { face: 'back', targets: [{ kind: 'object', id: bears }] })).toMatchObject({ ok: true });
    settle(game);
    expect(game.state.objects[bears].tapped).toBe(true);
    game.apply('p1', { type: 'manualTap', objectId: bears, tapped: false });
    for (let i = 0; i < 2; i++) { put(game, 'p1', 'mountain'); put(game, 'p1', 'island'); }
    const b = findIn(game, 'p1', 'hand', split.id);
    expect(cast(game, 'p1', b, { fuse: true, targets: [{ kind: 'player', player: 'p2' }, { kind: 'object', id: bears }] }).ok).toBe(true);
    settle(game);
    expect(game.state.players.p2.life).toBe(18);
    expect(game.state.objects[bears].tapped).toBe(true);
  });

  it('aftermath: a segunda metade só do cemitério, depois exílio', () => {
    const game = makeGame([...FILLER, aftermath], FILLER, { topP1: [aftermath.id] });
    goToMain1(game);
    put(game, 'p1', 'forest'); put(game, 'p1', 'mountain');
    const id = findIn(game, 'p1', 'hand', aftermath.id);
    expect(cast(game, 'p1', id, { face: 'back', targets: [{ kind: 'player', player: 'p2' }] }).ok).toBe(false);
    expect(cast(game, 'p1', id).ok).toBe(true);
    settle(game);
    expect(game.state.objects[id].zone).toBe('graveyard');
    expect(cast(game, 'p1', id, { face: 'back', targets: [{ kind: 'player', player: 'p2' }] }).ok).toBe(true);
    settle(game);
    expect(game.state.players.p2.life).toBe(18);
    expect(game.state.objects[id].zone).toBe('exile');
  });

  it('disturb: do cemitério, transformada, e vai para o exílio em vez do cemitério', () => {
    const game = makeGame([...FILLER, disturb], FILLER, { topP1: [disturb.id] });
    goToMain1(game);
    put(game, 'p1', 'plains'); put(game, 'p1', 'plains');
    const id = put(game, 'p1', disturb.id, 'graveyard');
    expect(cast(game, 'p1', id, { method: 'disturb' }).ok).toBe(true);
    settle(game);
    const o = game.state.objects[id];
    expect(o.zone).toBe('battlefield');
    expect(o.card.name).toBe('Bear Phantom');
    expect(hasKeyword(game.state, o, 'flying')).toBe(true);
    game.apply('p1', { type: 'manualMove', objectId: id, to: 'graveyard' });
    expect(o.zone).toBe('exile');
  });

  it('daybound: vira noite quando o jogador ativo não conjura nada', () => {
    const game = makeGame([...FILLER, werewolf], FILLER, { topP1: [werewolf.id] });
    goToMain1(game);
    put(game, 'p1', 'swamp'); put(game, 'p1', 'swamp'); put(game, 'p1', 'swamp');
    const id = findIn(game, 'p1', 'hand', werewolf.id);
    expect(cast(game, 'p1', id).ok).toBe(true);
    settle(game);
    expect(game.state.dayNight).toBe('day');
    toMain1Turn(game, 2, 'p2'); // p2 não conjura nada
    toMain1Turn(game, 3, 'p1');
    expect(game.state.dayNight).toBe('night');
    const o = game.state.objects[id];
    expect(o.card.name).toBe('Glutton Bear');
    expect(effectivePower(game.state, o)).toBe(4);
  });

  it('lobisomem antigo: transforma no upkeep se ninguém conjurou no turno anterior', () => {
    const game = makeGame([...FILLER, oldWerewolf], FILLER, { topP1: [oldWerewolf.id] });
    goToMain1(game);
    const id = put(game, 'p1', oldWerewolf.id);
    toMain1Turn(game, 2, 'p2');
    toMain1Turn(game, 3, 'p1');
    expect(game.state.objects[id].card.name).toBe('Howling Bear');
  });

  it('saga que volta transformada no capítulo III', () => {
    const game = makeGame([...FILLER, sagaDfc], FILLER, { topP1: [sagaDfc.id] });
    goToMain1(game);
    put(game, 'p1', 'forest'); put(game, 'p1', 'forest');
    const id = findIn(game, 'p1', 'hand', sagaDfc.id);
    expect(cast(game, 'p1', id).ok).toBe(true);
    settle(game);
    toMain1Turn(game, 3); settle(game);
    toMain1Turn(game, 5); settle(game);
    const o = game.state.objects[id];
    expect(o.zone).toBe('battlefield');
    expect(o.card.name).toBe('Bear Avatar');
    expect(effectivePower(game.state, o)).toBe(4);
  });

  it('batalha: atacada pelo controlador, derrotada vira o verso', () => {
    const game = makeGame([...FILLER, battle, grizzlyBears, grizzlyBears], FILLER, { topP1: [battle.id, 'grizzly-bears', 'grizzly-bears'] });
    goToMain1(game);
    put(game, 'p1', 'forest'); put(game, 'p1', 'forest');
    const b1 = put(game, 'p1', 'grizzly-bears');
    const b2 = put(game, 'p1', 'grizzly-bears');
    const id = findIn(game, 'p1', 'hand', battle.id);
    expect(cast(game, 'p1', id).ok).toBe(true);
    settle(game);
    expect(game.state.objects[id].counters['defense']).toBe(3);
    toMain1Turn(game, 3);
    game.apply('p1', { type: 'passPriority' });
    passUntil(game, (s) => s.combatAwaiting === 'attackers');
    expect(game.apply('p1', { type: 'declareAttackers', attackers: [b1, b2], defendTarget: id }).ok).toBe(true);
    passUntil(game, (s) => s.combatAwaiting === 'blockers');
    game.apply('p2', { type: 'declareBlockers', blocks: [] });
    passUntil(game, (s) => s.step === 'main2');
    const o = game.state.objects[id];
    expect(o.zone).toBe('battlefield');
    expect(o.card.name).toBe('Bear Overlord');
    expect(game.state.players.p2.life).toBe(20);
  });

  it('prepare: conjura a cópia da mágica uma vez', () => {
    const game = makeGame([...FILLER, prepare], FILLER, { topP1: [prepare.id] });
    goToMain1(game);
    put(game, 'p1', 'swamp'); put(game, 'p1', 'swamp'); put(game, 'p1', 'swamp'); put(game, 'p1', 'swamp');
    const id = findIn(game, 'p1', 'hand', prepare.id);
    expect(cast(game, 'p1', id).ok).toBe(true);
    settle(game);
    expect(game.state.objects[id].prepared).toBe(true);
    expect(game.apply('p1', { type: 'activateAbility', objectId: id, abilityIndex: 0 }).ok).toBe(true);
    settle(game);
    expect(game.state.players.p1.life).toBe(21);
    expect(game.state.objects[id].prepared).toBe(false);
    expect(game.apply('p1', { type: 'activateAbility', objectId: id, abilityIndex: 0 }).ok).toBe(false);
  });
});

describe('M20 · P/T variável e mecânicas rules-heavy', () => {
  it('P/T igual ao número de terrenos; toughness = cartas na mão + 1', () => {
    const game = makeGame([...FILLER, cdaLands, cdaHand], FILLER, { topP1: [cdaLands.id, cdaHand.id] });
    goToMain1(game);
    const t = put(game, 'p1', cdaLands.id);
    put(game, 'p1', 'forest'); put(game, 'p1', 'forest'); put(game, 'p1', 'forest');
    expect(effectivePower(game.state, game.state.objects[t])).toBe(3);
    expect(effectiveToughness(game.state, game.state.objects[t])).toBe(3);
    const m = put(game, 'p1', cdaHand.id);
    const hand = game.state.players.p1.zones.hand.length;
    expect(effectivePower(game.state, game.state.objects[m])).toBe(hand);
    expect(effectiveToughness(game.state, game.state.objects[m])).toBe(hand + 1);
  });

  it('soulbond: par dá +1/+1 e atropelar aos dois, e desfaz quando um sai', () => {
    const game = makeGame([...FILLER, soulbond, grizzlyBears], FILLER, { topP1: [soulbond.id, 'grizzly-bears'] });
    goToMain1(game);
    const bears = put(game, 'p1', 'grizzly-bears');
    put(game, 'p1', 'forest'); put(game, 'p1', 'forest');
    const id = findIn(game, 'p1', 'hand', soulbond.id);
    expect(cast(game, 'p1', id).ok).toBe(true);
    passUntil(game, (s) => s.pendingDecision?.type === 'effectChoice' || (s.stack.length === 0 && s.triggerQueue.length === 0 && s.pendingDecision === null));
    answerMay(game, 'p1');
    settle(game);
    expect(game.state.objects[id].pairedWith).toBe(bears);
    expect(effectivePower(game.state, game.state.objects[bears])).toBe(3);
    expect(hasKeyword(game.state, game.state.objects[bears], 'trample')).toBe(true);
    expect(effectivePower(game.state, game.state.objects[id])).toBe(3);
    game.apply('p1', { type: 'manualMove', objectId: bears, to: 'graveyard' });
    expect(effectivePower(game.state, game.state.objects[id])).toBe(2);
  });

  it('enlist: vira outra criatura e soma o poder dela ao atacante', () => {
    const game = makeGame([...FILLER, enlist, grizzlyBears], FILLER, { topP1: [enlist.id, 'grizzly-bears'] });
    goToMain1(game);
    const sage = put(game, 'p1', enlist.id);
    const bears = put(game, 'p1', 'grizzly-bears');
    toMain1Turn(game, 3);
    game.apply('p1', { type: 'passPriority' });
    passUntil(game, (s) => s.combatAwaiting === 'attackers');
    expect(game.apply('p1', { type: 'declareAttackers', attackers: [sage], enlist: [{ attacker: sage, creature: bears }] }).ok).toBe(true);
    expect(game.state.objects[bears].tapped).toBe(true);
    passUntil(game, (s) => s.combatAwaiting === 'blockers');
    game.apply('p2', { type: 'declareBlockers', blocks: [] });
    passUntil(game, (s) => s.step === 'main2');
    expect(game.state.players.p2.life).toBe(16);
  });

  it('casualty: sacrifica uma criatura e copia a mágica', () => {
    const game = makeGame([...FILLER, casualty, grizzlyBears], FILLER, { topP1: [casualty.id, 'grizzly-bears'] });
    goToMain1(game);
    const bears = put(game, 'p1', 'grizzly-bears');
    put(game, 'p1', 'swamp');
    const id = findIn(game, 'p1', 'hand', casualty.id);
    expect(cast(game, 'p1', id, { casualty: bears }).ok).toBe(true);
    settle(game);
    expect(game.state.objects[bears].zone).toBe('graveyard');
    expect(game.state.players.p1.life).toBe(24);
  });

  it('"when you control no Islands, sacrifice ~" é gatilho de estado', () => {
    const game = makeGame([...FILLER, noIslands], FILLER, { topP1: [noIslands.id] });
    goToMain1(game);
    const isl = put(game, 'p1', 'island');
    const id = put(game, 'p1', noIslands.id);
    settle(game);
    expect(game.state.objects[id].zone).toBe('battlefield');
    game.apply('p1', { type: 'manualMove', objectId: isl, to: 'hand' });
    game.apply('p1', { type: 'passPriority' });
    settle(game);
    expect(game.state.objects[id].zone).toBe('graveyard');
  });

  it('"cast only … if you\'ve been attacked": recusada fora da hora', () => {
    const game = makeGame([...FILLER, attackedOnly], FILLER, { topP1: [attackedOnly.id] });
    goToMain1(game);
    put(game, 'p1', 'plains'); put(game, 'p1', 'plains');
    expect(cast(game, 'p1', findIn(game, 'p1', 'hand', attackedOnly.id)).ok).toBe(false);
  });

  it('"choose three, same mode more than once"', () => {
    const game = makeGame([...FILLER, chooseThree], FILLER, { topP1: [chooseThree.id] });
    goToMain1(game);
    put(game, 'p1', 'forest'); put(game, 'p1', 'forest'); put(game, 'p1', 'forest');
    const id = findIn(game, 'p1', 'hand', chooseThree.id);
    expect(cast(game, 'p1', id, { modes: [0, 0, 0] }).ok).toBe(true);
    settle(game);
    expect(game.state.players.p1.life).toBe(23);
  });
});
