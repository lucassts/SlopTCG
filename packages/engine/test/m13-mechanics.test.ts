/** M13: planeswalkers por texto, "you may", veículos, infect, exalted, Control Magic, terrenos condicionais, P/T dinâmico, ETB modal, custo de descarte. */
import { describe, expect, it } from 'vitest';
import { compileOracleCard, type OracleInput } from '../src/cards/oracle-parser.js';
import { forest, grizzlyBears, island, mountain, plains, swamp } from '../src/cards/demo-set.js';
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
const FILLER = [...copies(mountain, 6), ...copies(forest, 6), ...copies(island, 4), ...copies(plains, 4), ...copies(swamp, 4)];
const pending = (game: Game) => game.state.pendingDecision;

const walker = mk({ name: 'Ajani Lite', manaCost: '{2}{W}', typeLine: 'Legendary Planeswalker — Ajani', loyalty: 3, colors: ['W'], oracleText: '+1: You gain 2 life.\n−2: Target creature gets +2/+2 until end of turn.' });
const mayDraw = mk({ name: 'Curious Bear', manaCost: '{1}{G}', typeLine: 'Creature — Bear', power: 2, toughness: 2, colors: ['G'], oracleText: 'When this creature enters, you may draw a card. If you do, you gain 1 life.' });
const copter = mk({ name: 'Sky Copter', manaCost: '{2}', typeLine: 'Artifact — Vehicle', power: 3, toughness: 3, oracleText: 'Flying\nCrew 1' });
const infector = mk({ name: 'Plague Bear', manaCost: '{1}{B}', typeLine: 'Creature — Bear', power: 2, toughness: 2, colors: ['B'], oracleText: 'Infect' });
const exaltedBear = mk({ name: 'Noble Bear', manaCost: '{1}{W}', typeLine: 'Creature — Bear', power: 2, toughness: 2, colors: ['W'], oracleText: 'Exalted' });
const controlMagic = mk({ name: 'Control Magic', manaCost: '{2}{U}{U}', typeLine: 'Enchantment — Aura', colors: ['U'], oracleText: 'Enchant creature\nYou control enchanted creature.' });
const checkland = mk({ name: 'Rootbound Crag', typeLine: 'Land', oracleText: 'Rootbound Crag enters tapped unless you control a Mountain or a Forest.\n{T}: Add {R} or {G}.' });
const fastland = mk({ name: 'Copperline Gorge', typeLine: 'Land', oracleText: 'Copperline Gorge enters tapped unless you control two or fewer other lands.\n{T}: Add {R} or {G}.' });
const shockland = mk({ name: 'Stomping Ground', typeLine: 'Land — Mountain Forest', oracleText: "As Stomping Ground enters, you may pay 2 life. If you don't, it enters tapped." });
const painland = mk({ name: 'Karplusan Forest', typeLine: 'Land', oracleText: '{T}: Add {C}.\n{T}: Add {R} or {G}. Karplusan Forest deals 1 damage to you.' });
const fetchland = mk({ name: 'Wooded Foothills', typeLine: 'Land', oracleText: '{T}, Pay 1 life, Sacrifice Wooded Foothills: Search your library for a Mountain or Forest card, put it onto the battlefield, then shuffle.' });
const cycler = mk({ name: 'Forest Seeker', manaCost: '{3}{G}', typeLine: 'Creature — Elf', power: 2, toughness: 2, colors: ['G'], oracleText: 'Forestcycling {2}' });
const lord = mk({ name: 'Pack Alpha', manaCost: '{2}{G}', typeLine: 'Creature — Wolf', power: 1, toughness: 1, colors: ['G'], oracleText: 'Pack Alpha gets +1/+1 for each other creature you control.' });
const modalEtb = mk({ name: 'Choosy Cleric', manaCost: '{1}{W}', typeLine: 'Creature — Human Cleric', power: 1, toughness: 1, colors: ['W'], oracleText: 'When this creature enters, choose one —\n• You gain 3 life.\n• Draw a card.' });
const looter = mk({ name: 'Hand Looter', manaCost: '{1}{U}', typeLine: 'Creature — Merfolk', power: 1, toughness: 1, colors: ['U'], oracleText: 'Discard a card: Draw a card.' });

describe('M13 · compilação', () => {
  it('tudo compila como full', () => {
    for (const c of [walker, mayDraw, copter, infector, exaltedBear, controlMagic, checkland, fastland, shockland, painland, fetchland, cycler, lord, modalEtb, looter])
      expect(c.automation, c.name).toBe('full');
    expect(walker.loyalty).toBe(3);
    expect(walker.abilities?.filter((a) => a.kind === 'loyalty')).toHaveLength(2);
    expect(copter.crew).toBe(1);
    expect(fetchland.abilities?.[0]).toMatchObject({ kind: 'activated', cost: { tap: true, payLife: 1, sacrificeSelf: true } });
    expect(looter.abilities?.[0]).toMatchObject({ kind: 'activated', cost: { discard: 1 } });
  });
});

describe('M13 · planeswalker e opcionais', () => {
  it('planeswalker entra com lealdade e usa +1', () => {
    const game = makeGame([...FILLER, walker], FILLER, { topP1: [walker.id] });
    goToMain1(game);
    for (let i = 0; i < 3; i++) put(game, 'p1', 'plains');
    game.apply('p1', { type: 'castSpell', objectId: findIn(game, 'p1', 'hand', walker.id) });
    passUntil(game, (s) => s.stack.length === 0);
    const pw = findIn(game, 'p1', 'battlefield', walker.id);
    expect(game.state.objects[pw].counters['loyalty']).toBe(3);
    expect(game.apply('p1', { type: 'activateAbility', objectId: pw, abilityIndex: 0 }).ok).toBe(true);
    passUntil(game, (s) => s.stack.length === 0);
    expect(game.state.players.p1.life).toBe(22);
    expect(game.state.objects[pw].counters['loyalty']).toBe(4);
  });

  it('"you may draw a card. If you do, gain 1 life": sim → compra e ganha; não → nada', () => {
    const game = makeGame([...FILLER, mayDraw, mayDraw], FILLER, { topP1: [mayDraw.id, mayDraw.id] });
    goToMain1(game);
    for (let i = 0; i < 4; i++) put(game, 'p1', 'forest');
    const hand0 = game.state.players.p1.zones.hand.length;
    game.apply('p1', { type: 'castSpell', objectId: findIn(game, 'p1', 'hand', mayDraw.id) });
    passUntil(game, (s) => s.pendingDecision !== null);
    expect(pending(game)).toMatchObject({ type: 'effectChoice', mode: 'confirm', player: 'p1' });
    game.apply('p1', { type: 'effectChoice', picks: [], text: 'yes' });
    passUntil(game, (s) => s.stack.length === 0);
    expect(game.state.players.p1.zones.hand.length).toBe(hand0); // -1 conjurada +1 comprada
    expect(game.state.players.p1.life).toBe(21);
    game.apply('p1', { type: 'castSpell', objectId: findIn(game, 'p1', 'hand', mayDraw.id) });
    passUntil(game, (s) => s.pendingDecision !== null);
    game.apply('p1', { type: 'effectChoice', picks: [], text: 'no' });
    passUntil(game, (s) => s.stack.length === 0);
    expect(game.state.players.p1.life).toBe(21);
  });

  it('ETB modal: escolher "Draw a card"', () => {
    const game = makeGame([...FILLER, modalEtb], FILLER, { topP1: [modalEtb.id] });
    goToMain1(game);
    put(game, 'p1', 'plains'); put(game, 'p1', 'plains');
    const hand0 = game.state.players.p1.zones.hand.length;
    game.apply('p1', { type: 'castSpell', objectId: findIn(game, 'p1', 'hand', modalEtb.id) });
    passUntil(game, (s) => s.pendingDecision !== null);
    expect(pending(game)).toMatchObject({ type: 'chooseMode', player: 'p1' });
    expect(game.apply('p1', { type: 'chooseMode', mode: 1 }).ok).toBe(true);
    passUntil(game, (s) => s.stack.length === 0);
    expect(game.state.players.p1.zones.hand.length).toBe(hand0); // -1 +1
    expect(game.state.players.p1.life).toBe(20);
  });

  it('custo "Discard a card:" descarta e compra', () => {
    const game = makeGame([...FILLER, looter], FILLER, { topP1: [looter.id] });
    goToMain1(game);
    const l = put(game, 'p1', looter.id);
    const toDiscard = game.state.players.p1.zones.hand[0];
    expect(game.apply('p1', { type: 'activateAbility', objectId: l, abilityIndex: 0 }).ok).toBe(false);
    expect(game.apply('p1', { type: 'activateAbility', objectId: l, abilityIndex: 0, discards: [toDiscard] }).ok).toBe(true);
    expect(game.state.objects[toDiscard].zone).toBe('graveyard');
    passUntil(game, (s) => s.stack.length === 0);
  });
});

describe('M13 · combate', () => {
  it('veículo: tripula com um urso e ataca', () => {
    const game = makeGame([...FILLER, copter, grizzlyBears], FILLER, { topP1: [copter.id, 'grizzly-bears'] });
    goToMain1(game);
    const v = put(game, 'p1', copter.id);
    const bears = put(game, 'p1', 'grizzly-bears');
    game.state.objects[v].summoningSick = false;
    expect(game.apply('p1', { type: 'crew', objectId: v, creatures: [bears] }).ok).toBe(true);
    expect(game.state.objects[bears].tapped).toBe(true);
    passUntil(game, (s) => s.combatAwaiting === 'attackers');
    expect(game.apply('p1', { type: 'declareAttackers', attackers: [v] }).ok).toBe(true);
    passUntil(game, (s) => s.step === 'main2');
    expect(game.state.players.p2.life).toBe(17);
    passUntil(game, (s) => s.turn === 2);
    expect(game.state.objects[v].crewedUntilEot).toBeUndefined();
  });

  it('infect: dano vira veneno, vida intacta', () => {
    const game = makeGame([...FILLER, infector], FILLER, { topP1: [infector.id] });
    goToMain1(game);
    const b = put(game, 'p1', infector.id);
    game.state.objects[b].summoningSick = false;
    passUntil(game, (s) => s.combatAwaiting === 'attackers');
    game.apply('p1', { type: 'declareAttackers', attackers: [b] });
    passUntil(game, (s) => s.step === 'main2');
    expect(game.state.players.p2.life).toBe(20);
    expect(game.state.players.p2.poison).toBe(2);
  });

  it('exalted: atacando sozinho ganha +1/+1', () => {
    const game = makeGame([...FILLER, exaltedBear], FILLER, { topP1: [exaltedBear.id] });
    goToMain1(game);
    const b = put(game, 'p1', exaltedBear.id);
    game.state.objects[b].summoningSick = false;
    passUntil(game, (s) => s.combatAwaiting === 'attackers');
    game.apply('p1', { type: 'declareAttackers', attackers: [b] });
    passUntil(game, (s) => s.step === 'main2');
    expect(game.state.players.p2.life).toBe(17);
  });

  it('lord dinâmico: +1/+1 por outra criatura', () => {
    const game = makeGame([...FILLER, lord, grizzlyBears, grizzlyBears], FILLER, { topP1: [lord.id, 'grizzly-bears', 'grizzly-bears'] });
    goToMain1(game);
    const l = put(game, 'p1', lord.id);
    expect(effectivePower(game.state, game.state.objects[l])).toBe(1);
    put(game, 'p1', 'grizzly-bears'); put(game, 'p1', 'grizzly-bears');
    expect(effectivePower(game.state, game.state.objects[l])).toBe(3);
  });
});

describe('M13 · Control Magic', () => {
  it('rouba a criatura e devolve quando a aura sai', () => {
    const game = makeGame([...FILLER, controlMagic], [...FILLER, grizzlyBears], { topP1: [controlMagic.id], topP2: ['grizzly-bears'] });
    goToMain1(game);
    for (let i = 0; i < 4; i++) put(game, 'p1', 'island');
    const bears = put(game, 'p2', 'grizzly-bears');
    const aura = findIn(game, 'p1', 'hand', controlMagic.id);
    expect(game.apply('p1', { type: 'castSpell', objectId: aura, targets: [{ kind: 'object', id: bears }] }).ok).toBe(true);
    passUntil(game, (s) => s.stack.length === 0);
    expect(game.state.objects[bears].controller).toBe('p1');
    expect(game.state.players.p1.zones.battlefield).toContain(bears);
    game.apply('p1', { type: 'manualMove', objectId: aura, to: 'graveyard' });
    game.apply('p1', { type: 'passPriority' }); // SBA roda ao passar
    expect(game.state.objects[bears].controller).toBe('p2');
  });
});

describe('M13 · terrenos', () => {
  it('checkland: virado sem Mountain/Forest, desvirado com', () => {
    const game = makeGame([...FILLER, checkland, checkland], FILLER, { topP1: [checkland.id, checkland.id] });
    goToMain1(game);
    const a = findIn(game, 'p1', 'hand', checkland.id);
    game.apply('p1', { type: 'playLand', objectId: a });
    expect(game.state.objects[a].tapped).toBe(true);
    put(game, 'p1', 'forest');
    passUntil(game, (s) => s.turn === 3 && s.step === 'main1' && s.priority === 'p1');
    const b = findIn(game, 'p1', 'hand', checkland.id);
    game.apply('p1', { type: 'playLand', objectId: b });
    expect(game.state.objects[b].tapped).toBe(false);
  });

  it('fastland: desvirado com ≤ 2 outros terrenos, virado com 3', () => {
    const game = makeGame([...FILLER, fastland, fastland], FILLER, { topP1: [fastland.id, fastland.id] });
    goToMain1(game);
    put(game, 'p1', 'forest'); put(game, 'p1', 'forest');
    const a = findIn(game, 'p1', 'hand', fastland.id);
    game.apply('p1', { type: 'playLand', objectId: a });
    expect(game.state.objects[a].tapped).toBe(false); // 2 outros → desvirado
    passUntil(game, (s) => s.turn === 3 && s.step === 'main1' && s.priority === 'p1');
    const b = findIn(game, 'p1', 'hand', fastland.id);
    game.apply('p1', { type: 'playLand', objectId: b });
    expect(game.state.objects[b].tapped).toBe(true); // 3 outros → virado
  });

  it('shockland: pergunta; sim → paga 2 e entra desvirado', () => {
    const game = makeGame([...FILLER, shockland], FILLER, { topP1: [shockland.id] });
    goToMain1(game);
    const a = findIn(game, 'p1', 'hand', shockland.id);
    game.apply('p1', { type: 'playLand', objectId: a });
    expect(pending(game)).toMatchObject({ type: 'effectChoice', mode: 'confirm' });
    game.apply('p1', { type: 'effectChoice', picks: [], text: 'yes' });
    expect(game.state.players.p1.life).toBe(18);
    expect(game.state.objects[a].tapped).toBe(false);
    // básico-tipado: {T}: Add {R} ou {G} pela regra 305.6
    expect(game.apply('p1', { type: 'activateAbility', objectId: a, abilityIndex: 0 }).ok).toBe(true);
  });

  it('painland: mana da cor e 1 de dano', () => {
    const game = makeGame([...FILLER, painland], FILLER, { topP1: [painland.id] });
    goToMain1(game);
    const a = put(game, 'p1', painland.id);
    expect(game.apply('p1', { type: 'activateAbility', objectId: a, abilityIndex: 1, manaColor: 'G' }).ok).toBe(true);
    expect(game.state.players.p1.manaPool.G).toBe(1);
    expect(game.state.players.p1.life).toBe(19);
  });

  it('fetchland: paga 1, sacrifica, busca Forest para o campo', () => {
    const game = makeGame([...FILLER, fetchland], FILLER, { topP1: [fetchland.id] });
    goToMain1(game);
    const f = put(game, 'p1', fetchland.id);
    expect(game.apply('p1', { type: 'activateAbility', objectId: f, abilityIndex: 0 }).ok).toBe(true);
    passUntil(game, (s) => s.pendingDecision !== null);
    const pd = pending(game);
    if (pd?.type !== 'effectChoice') throw new Error('sem busca');
    const forestId = pd.options.find((id) => game.state.objects[id].card.id === 'forest')!;
    game.apply('p1', { type: 'effectChoice', picks: [forestId] });
    expect(game.state.objects[forestId].zone).toBe('battlefield');
    expect(game.state.objects[f].zone).toBe('graveyard');
    expect(game.state.players.p1.life).toBe(19);
  });

  it('Forestcycling: descarta e busca uma Forest para a mão', () => {
    const game = makeGame([...FILLER, cycler], FILLER, { topP1: [cycler.id] });
    goToMain1(game);
    put(game, 'p1', 'mountain'); put(game, 'p1', 'mountain');
    const c = findIn(game, 'p1', 'hand', cycler.id);
    expect(game.apply('p1', { type: 'cycle', objectId: c }).ok).toBe(true);
    passUntil(game, (s) => s.pendingDecision !== null);
    const pd = pending(game);
    if (pd?.type !== 'effectChoice') throw new Error('sem busca');
    expect(pd.options.every((id) => game.state.objects[id].card.subtypes.includes('Forest'))).toBe(true);
    game.apply('p1', { type: 'effectChoice', picks: [pd.options[0]] });
    expect(game.state.objects[pd.options[0]].zone).toBe('hand');
  });
});
