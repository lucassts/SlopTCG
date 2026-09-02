/** M17 (fechamento da Leva 3): dredge, miracle, replicate, cipher, haunt, hideaway, monarca, iniciativa/Undercity, masmorras, impulso. */
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
const copies = (card: CardDefinition, n: number) => Array.from({ length: n }, () => card);
function put(game: Game, player: PlayerId, cardId: string, zone: 'battlefield' | 'graveyard' | 'hand' = 'battlefield'): number {
  let id: number;
  try { id = findIn(game, player, 'library', cardId); } catch { id = findIn(game, player, 'hand', cardId); }
  const r = game.apply(player, { type: 'manualMove', objectId: id, to: zone });
  if (!r.ok) throw new Error(`setup falhou: ${cardId} → ${zone}`);
  return id;
}
const FILLER = [...copies(mountain, 6), ...copies(forest, 6), ...copies(island, 6), ...copies(plains, 6), ...copies(swamp, 4)];
const HAND7 = ['mountain', 'mountain', 'forest', 'forest', 'island', 'island', 'plains'];
const settle = (game: Game) => passUntil(game, (s) => s.stack.length === 0 && s.triggerQueue.length === 0 && s.pendingDecision === null);
const cast = (game: Game, p: PlayerId, id: number, extra: Record<string, unknown> = {}) => game.apply(p, { type: 'castSpell', objectId: id, ...extra } as never);

const dredger = mk({ name: 'Dredge Bear', manaCost: '{1}{B}', typeLine: 'Creature — Bear', power: 2, toughness: 2, colors: ['B'], oracleText: 'Dredge 2' });
const miracler = mk({ name: 'Miracle Draw', manaCost: '{3}{U}', typeLine: 'Sorcery', colors: ['U'], oracleText: 'Draw two cards.\nMiracle {U}' });
const replicator = mk({ name: 'Replicate Draw', manaCost: '{U}', typeLine: 'Instant', colors: ['U'], oracleText: 'Replicate {U}\nDraw a card.' });
const cipherer = mk({ name: 'Cipher Draw', manaCost: '{1}{U}', typeLine: 'Sorcery', colors: ['U'], oracleText: 'Draw a card.\nCipher' });
const haunter = mk({ name: 'Haunt Bear', manaCost: '{1}{B}', typeLine: 'Creature — Bear', power: 2, toughness: 2, colors: ['B'], oracleText: 'Haunt\nWhen Haunt Bear enters or the creature it haunts dies, you gain 2 life.' });
const hideIsle = mk({ name: 'Hide Isle', typeLine: 'Land', oracleText: 'Hideaway 4 (When this land enters, look at the top four cards of your library, exile one face down, then put the rest on the bottom in a random order.)\nThis land enters tapped.\n{T}: Add {U}.\n{U}, {T}: You may play the exiled card without paying its mana cost if a library has twenty or fewer cards in it.' });
const monarchBear = mk({ name: 'Monarch Bear', manaCost: '{1}{W}', typeLine: 'Creature — Bear', power: 2, toughness: 2, colors: ['W'], oracleText: 'When Monarch Bear enters, you become the monarch.' });
const initBear = mk({ name: 'Initiative Bear', manaCost: '{1}{W}', typeLine: 'Creature — Bear', power: 2, toughness: 2, colors: ['W'], oracleText: 'When Initiative Bear enters, you take the initiative.' });
const venturer = mk({ name: 'Venture Forth', manaCost: '{G}', typeLine: 'Sorcery', colors: ['G'], oracleText: 'Venture into the dungeon.' });
const impulser = mk({ name: 'Impulse Bolt', manaCost: '{R}', typeLine: 'Sorcery', colors: ['R'], oracleText: 'Exile the top card of your library. You may play that card this turn.' });
const monarchLord = mk({ name: 'Court Bear', manaCost: '{2}{W}', typeLine: 'Creature — Bear', power: 2, toughness: 2, colors: ['W'], oracleText: 'Court Bear gets +2/+2 as long as you\'re the monarch.' });

describe('M17 · compilação', () => {
  it('tudo compila como full', () => {
    for (const c of [dredger, miracler, replicator, cipherer, haunter, hideIsle, monarchBear, initBear, venturer, impulser, monarchLord])
      expect(c.automation, `${c.name}: ${c.automationNotes?.join(' | ')}`).toBe('full');
    expect(dredger.dredge).toBe(2);
    expect(miracler.castMethods?.[0]).toMatchObject({ kind: 'miracle', cost: '{U}' });
    expect(replicator.replicate).toBe('{U}');
    expect(cipherer.spellEffect?.at(-1)).toEqual({ op: 'cipherEncode' });
    expect(haunter.abilities?.map((a) => a.kind === 'triggered' && a.trigger.on)).toEqual(['dies', 'etb', 'hauntedDies']);
    expect(hideIsle.hideaway).toBe(4);
    expect(hideIsle.abilities?.find((a) => a.kind === 'activated' && a.condition)).toMatchObject({ condition: { libraryAtMost: 20 } });
    expect(monarchLord.abilities?.[0]).toMatchObject({ kind: 'static', condition: { kind: 'isMonarch' }, power: 2 });
  });
});

describe('M17 · compra e conjuração', () => {
  it('dredge: armado do cemitério, substitui a compra seguinte', () => {
    const game = makeGame([...FILLER, dredger], FILLER, { topP1: [dredger.id] });
    goToMain1(game);
    const id = put(game, 'p1', dredger.id, 'graveyard');
    expect(game.apply('p1', { type: 'activateAbility', objectId: id, abilityIndex: 0 }).ok).toBe(true);
    expect(game.state.players.p1.dredgeNext).toBe(id);
    const gy = game.state.players.p1.zones.graveyard.length;
    passUntil(game, (s) => s.turn === 3 && s.step === 'main1' && s.stack.length === 0 && s.pendingDecision === null);
    expect(game.state.objects[id].zone).toBe('hand');
    expect(game.state.players.p1.zones.graveyard.length).toBe(gy - 1 + 2);
  });

  it('miracle: a primeira carta comprada no turno pode ser conjurada pelo custo de milagre na hora', () => {
    const game = makeGame([...FILLER, miracler], FILLER, { topP1: [...HAND7, miracler.id] });
    goToMain1(game);
    put(game, 'p1', 'island');
    passUntil(game, (s) => s.turn === 3 && s.step === 'draw' && s.priority === 'p1');
    const id = findIn(game, 'p1', 'hand', miracler.id);
    expect(game.state.objects[id].miracleAvailable).toBe(true);
    const before = game.state.players.p1.zones.hand.length;
    expect(cast(game, 'p1', id, { method: 'miracle' }).ok).toBe(true);
    settle(game);
    expect(game.state.players.p1.zones.hand.length).toBe(before - 1 + 2);
  });

  it('miracle: a janela fecha se o jogador fizer outra coisa', () => {
    const game = makeGame([...FILLER, miracler], FILLER, { topP1: [...HAND7, miracler.id] });
    goToMain1(game);
    put(game, 'p1', 'island');
    passUntil(game, (s) => s.turn === 3 && s.step === 'draw' && s.priority === 'p1');
    const id = findIn(game, 'p1', 'hand', miracler.id);
    game.apply('p1', { type: 'passPriority' });
    expect(game.state.objects[id].miracleAvailable).toBeFalsy();
  });

  it('replicate: cada pagamento extra cria uma cópia', () => {
    const game = makeGame([...FILLER, replicator], FILLER, { topP1: [replicator.id] });
    goToMain1(game);
    for (let i = 0; i < 3; i++) put(game, 'p1', 'island');
    const before = game.state.players.p1.zones.hand.length;
    expect(cast(game, 'p1', findIn(game, 'p1', 'hand', replicator.id), { replicateTimes: 2 }).ok).toBe(true);
    settle(game);
    expect(game.state.players.p1.zones.hand.length).toBe(before - 1 + 3);
  });

  it('cipher: codifica numa criatura e conjura uma cópia grátis ao causar dano de combate', () => {
    const game = makeGame([...FILLER, cipherer, grizzlyBears], FILLER, { topP1: [cipherer.id, 'grizzly-bears'] });
    goToMain1(game);
    const bears = put(game, 'p1', 'grizzly-bears');
    put(game, 'p1', 'island'); put(game, 'p1', 'island');
    const id = findIn(game, 'p1', 'hand', cipherer.id);
    expect(cast(game, 'p1', id).ok).toBe(true);
    passUntil(game, (s) => s.pendingDecision?.type === 'effectChoice');
    game.apply('p1', { type: 'effectChoice', picks: [bears] });
    settle(game);
    expect(game.state.objects[id].zone).toBe('exile');
    expect(game.state.objects[id].encodedOn).toBe(bears);
    passUntil(game, (s) => s.turn === 3 && s.step === 'main1' && s.priority === 'p1' && s.stack.length === 0);
    game.apply('p1', { type: 'passPriority' });
    passUntil(game, (s) => s.combatAwaiting === 'attackers');
    expect(game.apply('p1', { type: 'declareAttackers', attackers: [bears] }).ok).toBe(true);
    passUntil(game, (s) => s.combatAwaiting === 'blockers');
    game.apply('p2', { type: 'declareBlockers', blocks: [] });
    passUntil(game, (s) => s.pendingDecision?.type === 'effectChoice');
    const before = game.state.players.p1.zones.hand.length;
    game.apply('p1', { type: 'effectChoice', picks: [], text: 'yes' });
    settle(game);
    expect(game.state.players.p2.life).toBe(18);
    expect(game.state.players.p1.zones.hand.length).toBe(before + 1);
  });
});

describe('M17 · assombrar e esconderijo', () => {
  it('haunt: ao morrer assombra uma criatura; quando ela morre, o gatilho dispara de novo', () => {
    const game = makeGame([...FILLER, haunter], [...FILLER, grizzlyBears, lightningBolt, lightningBolt], { topP1: [haunter.id], topP2: ['grizzly-bears', 'lightning-bolt', 'lightning-bolt'] });
    goToMain1(game);
    put(game, 'p1', 'swamp'); put(game, 'p1', 'swamp');
    const bears = put(game, 'p2', 'grizzly-bears');
    put(game, 'p2', 'mountain'); put(game, 'p2', 'mountain');
    const id = findIn(game, 'p1', 'hand', haunter.id);
    expect(cast(game, 'p1', id).ok).toBe(true);
    settle(game);
    expect(game.state.players.p1.life).toBe(22);
    game.apply('p1', { type: 'passPriority' });
    expect(cast(game, 'p2', findIn(game, 'p2', 'hand', 'lightning-bolt'), { targets: [{ kind: 'object', id }] }).ok).toBe(true);
    passUntil(game, (s) => s.pendingDecision?.type === 'chooseTargets');
    expect(game.apply('p1', { type: 'chooseTargets', targets: [{ kind: 'object', id: bears }] }).ok).toBe(true);
    settle(game);
    expect(game.state.objects[id].zone).toBe('exile');
    expect(game.state.objects[id].haunting).toBe(bears);
    if (game.state.priority === 'p1') game.apply('p1', { type: 'passPriority' });
    expect(cast(game, 'p2', findIn(game, 'p2', 'hand', 'lightning-bolt'), { targets: [{ kind: 'object', id: bears }] }).ok).toBe(true);
    settle(game);
    expect(game.state.objects[bears].zone).toBe('graveyard');
    expect(game.state.players.p1.life).toBe(24);
  });

  it('hideaway: esconde uma das quatro do topo; joga de graça quando a condição vale', () => {
    const game = makeGame([...FILLER, hideIsle, grizzlyBears], FILLER, { topP1: [...HAND7, hideIsle.id, 'grizzly-bears'] });
    goToMain1(game);
    // A ilha está no topo da biblioteca: leva para a mão e joga.
    const isle = put(game, 'p1', hideIsle.id, 'hand');
    expect(game.apply('p1', { type: 'playLand', objectId: isle }).ok).toBe(true);
    passUntil(game, (s) => s.pendingDecision?.type === 'effectChoice');
    const bears = findIn(game, 'p1', 'library', 'grizzly-bears');
    game.apply('p1', { type: 'effectChoice', picks: [bears] });
    settle(game);
    expect(game.state.objects[bears].zone).toBe('exile');
    expect(game.state.objects[isle].hideawayCard).toBe(bears);
    passUntil(game, (s) => s.turn === 3 && s.step === 'main1' && s.priority === 'p1' && s.stack.length === 0);
    put(game, 'p1', 'island');
    // Habilidades: [esconderijo, {T}: {U}, jogar a carta escondida]. Biblioteca com mais de 20 cartas: recusado.
    if (game.state.players.p1.zones.library.length > 20)
      expect(game.apply('p1', { type: 'activateAbility', objectId: isle, abilityIndex: 2 }).ok).toBe(false);
    while (game.state.players.p1.zones.library.length > 20) put(game, 'p1', game.state.objects[game.state.players.p1.zones.library[0]].card.id, 'graveyard');
    expect(game.apply('p1', { type: 'activateAbility', objectId: isle, abilityIndex: 2 }).ok).toBe(true);
    settle(game);
    expect(game.state.objects[bears].zone).toBe('battlefield');
  });
});

describe('M17 · monarca, iniciativa e masmorras', () => {
  it('monarca: compra no fim do turno; passa para quem causar dano de combate', () => {
    const game = makeGame([...FILLER, monarchBear, monarchLord], [...FILLER, grizzlyBears], { topP1: [monarchBear.id, monarchLord.id], topP2: ['grizzly-bears'] });
    goToMain1(game);
    put(game, 'p1', 'plains'); put(game, 'p1', 'plains');
    const lord = put(game, 'p1', monarchLord.id);
    const bears = put(game, 'p2', 'grizzly-bears');
    expect(cast(game, 'p1', findIn(game, 'p1', 'hand', monarchBear.id)).ok).toBe(true);
    settle(game);
    expect(game.state.monarch).toBe('p1');
    expect(effectivePower(game.state, game.state.objects[lord])).toBe(4);
    const before = game.state.players.p1.zones.hand.length;
    passUntil(game, (s) => s.turn === 1 && s.step === 'end');
    expect(game.state.players.p1.zones.hand.length).toBe(before + 1);
    passUntil(game, (s) => s.turn === 2 && s.combatAwaiting === 'attackers');
    expect(game.apply('p2', { type: 'declareAttackers', attackers: [bears] }).ok).toBe(true);
    passUntil(game, (s) => s.combatAwaiting === 'blockers');
    game.apply('p1', { type: 'declareBlockers', blocks: [] });
    passUntil(game, (s) => s.step === 'main2');
    expect(game.state.monarch).toBe('p2');
    expect(effectivePower(game.state, game.state.objects[lord])).toBe(2);
  });

  it('iniciativa: entra em Undercity (Secret Entrance) e avança na manutenção com escolha de sala', () => {
    const game = makeGame([...FILLER, initBear], FILLER, { topP1: [initBear.id] });
    goToMain1(game);
    put(game, 'p1', 'plains'); put(game, 'p1', 'plains');
    expect(cast(game, 'p1', findIn(game, 'p1', 'hand', initBear.id)).ok).toBe(true);
    passUntil(game, (s) => s.pendingDecision?.type === 'effectChoice');
    expect(game.state.initiative).toBe('p1');
    const pd = game.state.pendingDecision as { options: number[] };
    const basic = pd.options[0];
    game.apply('p1', { type: 'effectChoice', picks: [basic] });
    settle(game);
    expect(game.state.objects[basic].zone).toBe('hand');
    expect(game.state.players.p1.dungeon).toEqual({ name: 'Undercity', room: 0 });
    passUntil(game, (s) => s.turn === 3 && s.pendingDecision?.type === 'chooseMode');
    const modes = game.state.pendingDecision as { options: { label: string }[] };
    expect(modes.options.map((o) => o.label)).toEqual(['Undercity — Forge', 'Undercity — Lost Well']);
    game.apply('p1', { type: 'chooseMode', mode: 1 });
    passUntil(game, (s) => s.pendingDecision?.type === 'effectChoice');
    game.apply('p1', { type: 'effectChoice', picks: [] }); // vidência 2: nada para o fundo
    settle(game);
    expect(game.state.players.p1.dungeon).toEqual({ name: 'Undercity', room: 2 });
  });

  it('aventurar-se: escolhe a masmorra e entra na primeira sala', () => {
    const game = makeGame([...FILLER, venturer], FILLER, { topP1: [venturer.id] });
    goToMain1(game);
    put(game, 'p1', 'forest');
    expect(cast(game, 'p1', findIn(game, 'p1', 'hand', venturer.id)).ok).toBe(true);
    passUntil(game, (s) => s.pendingDecision?.type === 'chooseMode');
    const modes = game.state.pendingDecision as { options: { label: string }[] };
    expect(modes.options).toHaveLength(3);
    game.apply('p1', { type: 'chooseMode', mode: 2 }); // Dungeon of the Mad Mage — Yawning Portal
    settle(game);
    expect(game.state.players.p1.life).toBe(21);
    expect(game.state.players.p1.dungeon).toEqual({ name: 'Dungeon of the Mad Mage', room: 0 });
  });

  it('impulso: exila o topo e deixa jogar neste turno (terreno do exílio)', () => {
    const game = makeGame([...FILLER, impulser], FILLER, { topP1: [impulser.id, 'mountain', 'mountain', 'forest', 'forest', 'island', 'island', 'swamp'] });
    goToMain1(game);
    put(game, 'p1', 'mountain');
    const top = game.state.players.p1.zones.library[0];
    expect(cast(game, 'p1', findIn(game, 'p1', 'hand', impulser.id)).ok).toBe(true);
    settle(game);
    expect(game.state.objects[top].zone).toBe('exile');
    expect(game.state.objects[top].exiledAs).toBe('playable');
    expect(game.apply('p1', { type: 'playLand', objectId: top }).ok).toBe(true);
    expect(game.state.objects[top].zone).toBe('battlefield');
  });
});
