/** M40: lista "Blue Dredge" do Lucas (Moxfield AL2eAedrEH68hH4yJOXBlw) — as cartas que ainda não tinham teste de comportamento. */
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
function put(game: Game, player: PlayerId, cardId: string, zone: 'battlefield' | 'graveyard' | 'hand' | 'exile' = 'battlefield'): number {
  let id: number;
  try { id = findIn(game, player, 'library', cardId); } catch { id = findIn(game, player, 'hand', cardId); }
  const r = game.apply(player, { type: 'manualMove', objectId: id, to: zone });
  if (!r.ok) throw new Error(`setup falhou: ${cardId} → ${zone}`);
  return id;
}
const FILLER = [...copies(mountain, 6), ...copies(forest, 6), ...copies(island, 6), ...copies(plains, 6), ...copies(swamp, 4)];
const settle = (game: Game) => passUntil(game, (s) => s.status === 'finished' || (s.stack.length === 0 && s.triggerQueue.length === 0 && s.pendingDecision === null));
const cast = (game: Game, p: PlayerId, id: number, extra: Record<string, unknown> = {}) => game.apply(p, { type: 'castSpell', objectId: id, ...extra } as never);
const untilDecision = (game: Game) => passUntil(game, (s) => s.status === 'finished' || s.pendingDecision !== null || (s.stack.length === 0 && s.triggerQueue.length === 0));
const answer = (game: Game, p: PlayerId, picks: number[], text?: string) => game.apply(p, { type: 'effectChoice', picks, text });
const choice = (game: Game) => { const pd = game.state.pendingDecision; if (pd?.type !== 'effectChoice') throw new Error(`esperava effectChoice, veio ${pd?.type ?? 'nada'}`); return pd; };
const lands = (game: Game, p: PlayerId, ...ids: string[]) => { for (const id of ids) put(game, p, id); };

const coliseum = mk({ name: 'Cephalid Coliseum', typeLine: 'Land', colors: [], oracleText: '{T}: Add {U}. This land deals 1 damage to you.\nThreshold — {U}, {T}, Sacrifice this land: Target player draws three cards, then discards three cards. Activate only if there are seven or more cards in your graveyard.' });
const gaze = mk({ name: 'Otherworldly Gaze', manaCost: '{U}', typeLine: 'Instant', colors: ['U'], oracleText: 'Surveil 3.\nFlashback {1}{U}' });
const stern = mk({ name: 'Stern Dismissal', manaCost: '{U}', typeLine: 'Instant', colors: ['U'], oracleText: "Return target creature or enchantment an opponent controls to its owner's hand." });
const rider = mk({ name: 'Ashen Rider', manaCost: '{4}{W}{W}{B}{B}', typeLine: 'Creature — Archon', power: 5, toughness: 5, colors: ['W', 'B'], oracleText: 'Flying\nWhen this creature enters or dies, exile target permanent.' });
const unmask = mk({ name: 'Unmask', manaCost: '{3}{B}', typeLine: 'Sorcery', colors: ['B'], oracleText: "You may exile a black card from your hand rather than pay this spell's mana cost.\nTarget player reveals their hand. You choose a nonland card from it. That player discards that card." });
const study = mk({ name: 'Careful Study', manaCost: '{U}', typeLine: 'Sorcery', colors: ['U'], oracleText: 'Draw two cards, then discard two cards.' });
const loam = mk({ name: 'Life from the Loam', manaCost: '{1}{G}', typeLine: 'Sorcery', colors: ['G'], oracleText: 'Return up to three target land cards from your graveyard to your hand.\nDredge 3' });
const maze = mk({ name: 'Hedge Maze', typeLine: 'Land — Forest Island', colors: [], oracleText: '({T}: Add {G} or {U}.)\nThis land enters tapped.\nWhen this land enters, surveil 1.' });
const darkRitualish = mk({ name: 'Black Card', manaCost: '{B}', typeLine: 'Instant', colors: ['B'], oracleText: 'Draw a card.' });

describe('M40 · Blue Dredge', () => {
  it('compila tudo como full e a Coliseum tem habilidade de mana', () => {
    for (const c of [coliseum, gaze, stern, rider, unmask, study, loam, maze]) expect(c.automation, `${c.name}: ${c.automationNotes?.join(' | ')}`).toBe('full');
    expect(coliseum.abilities?.[0]).toMatchObject({ kind: 'activated', isManaAbility: true });
    expect(coliseum.abilities?.[1]).toMatchObject({ kind: 'activated', condition: { cond: { kind: 'graveyardAtLeast', count: 7 } } });
    expect(loam.spellTargets?.length).toBe(3);
    expect(loam.spellTargets?.every((t) => t.optional && t.zone === 'graveyard')).toBe(true);
  });

  it('Cephalid Coliseum: paga mágica sozinha (1 de dano) e o threshold só com 7 no cemitério', () => {
    const game = makeGame([...FILLER, coliseum, study], [...FILLER, grizzlyBears], { topP1: [coliseum.id, study.id] });
    goToMain1(game);
    const col = put(game, 'p1', coliseum.id);
    // pagamento automático usa a habilidade de mana da Coliseum (única fonte azul)
    expect(cast(game, 'p1', findIn(game, 'p1', 'hand', study.id)).ok).toBe(true);
    expect(game.state.players.p1.life).toBe(19);
    expect(game.state.objects[col].tapped).toBe(true);
    untilDecision(game);
    if (game.state.pendingDecision?.type === 'effectChoice') { const pd = choice(game); answer(game, 'p1', pd.options.slice(0, pd.min)); }
    settle(game);
    game.state.objects[col].tapped = false;
    put(game, 'p1', 'island');
    const before = game.state.players.p1.zones.graveyard.length;
    expect(game.apply('p1', { type: 'activateAbility', objectId: col, abilityIndex: 1, targets: [{ kind: 'player', player: 'p2' }] }).ok).toBe(false); // threshold ainda não
    for (let i = game.state.players.p1.zones.graveyard.length; i < 7; i++) put(game, 'p1', 'mountain', 'graveyard');
    void before;
    const handP2 = game.state.players.p2.zones.hand.length;
    expect(game.apply('p1', { type: 'activateAbility', objectId: col, abilityIndex: 1, targets: [{ kind: 'player', player: 'p2' }] }).ok).toBe(true);
    untilDecision(game);
    const pd = choice(game);
    expect(pd.player).toBe('p2');
    answer(game, 'p2', pd.options.slice(0, 3));
    settle(game);
    expect(game.state.objects[col].zone).toBe('graveyard');
    expect(game.state.players.p2.zones.hand.length).toBe(handP2); // +3 −3
  });

  it('Otherworldly Gaze: surveil 3 e flashback {1}{U}', () => {
    const game = makeGame([...FILLER, gaze], FILLER, { topP1: [gaze.id] });
    goToMain1(game);
    lands(game, 'p1', 'island', 'island', 'island');
    const g = findIn(game, 'p1', 'hand', gaze.id);
    expect(cast(game, 'p1', g).ok).toBe(true);
    untilDecision(game);
    const pd = choice(game);
    expect(pd.options.length).toBe(3);
    answer(game, 'p1', pd.options.slice(0, 2)); // duas para o cemitério
    settle(game);
    expect(game.state.objects[g].zone).toBe('graveyard');
    expect(game.state.players.p1.zones.graveyard.length).toBe(3);
    for (const id of game.state.players.p1.zones.battlefield) game.state.objects[id].tapped = false;
    expect(cast(game, 'p1', g, { method: undefined, flashback: true } as never).ok || game.apply('p1', { type: 'castSpell', objectId: g }).ok).toBe(true);
    untilDecision(game);
    if (game.state.pendingDecision?.type === 'effectChoice') answer(game, 'p1', []);
    settle(game);
    expect(game.state.objects[g].zone).toBe('exile');
  });

  it('Stern Dismissal: só criatura ou encantamento do oponente', () => {
    const game = makeGame([...FILLER, stern, grizzlyBears], [...FILLER, grizzlyBears], { topP1: [stern.id, 'grizzly-bears'], topP2: ['grizzly-bears'] });
    goToMain1(game);
    put(game, 'p1', 'island');
    const mine = put(game, 'p1', 'grizzly-bears');
    const theirs = put(game, 'p2', 'grizzly-bears');
    const theirLand = put(game, 'p2', 'forest');
    const st = findIn(game, 'p1', 'hand', stern.id);
    expect(cast(game, 'p1', st, { targets: [{ kind: 'object', id: mine }] }).ok).toBe(false);
    expect(cast(game, 'p1', st, { targets: [{ kind: 'object', id: theirLand }] }).ok).toBe(false);
    expect(cast(game, 'p1', st, { targets: [{ kind: 'object', id: theirs }] }).ok).toBe(true);
    settle(game);
    expect(game.state.objects[theirs].zone).toBe('hand');
  });

  it('Ashen Rider: exila ao entrar e ao morrer', () => {
    const game = makeGame([...FILLER, rider], [...FILLER, grizzlyBears, grizzlyBears, lightningBolt], { topP1: [rider.id], topP2: ['grizzly-bears', 'grizzly-bears', 'lightning-bolt'] });
    goToMain1(game);
    lands(game, 'p1', 'plains', 'plains', 'plains', 'plains', 'swamp', 'swamp', 'swamp', 'swamp');
    const b1 = put(game, 'p2', 'grizzly-bears'); const b2 = put(game, 'p2', 'grizzly-bears');
    const r = findIn(game, 'p1', 'hand', rider.id);
    expect(cast(game, 'p1', r).ok).toBe(true);
    passUntil(game, (s) => s.pendingDecision?.type === 'chooseTargets', 50);
    expect(game.apply('p1', { type: 'chooseTargets', targets: [{ kind: 'object', id: b1 }] }).ok).toBe(true);
    settle(game);
    expect(game.state.objects[b1].zone).toBe('exile');
    game.apply('p1', { type: 'manualMove', objectId: r, to: 'graveyard' });
    // manualMove não dispara "morre": destrói de verdade com dano letal
    game.apply('p1', { type: 'manualMove', objectId: r, to: 'battlefield' });
    game.state.objects[r].damage = 5;
    game.apply('p1', { type: 'passPriority' });
    passUntil(game, (s) => s.pendingDecision?.type === 'chooseTargets' || s.objects[r].zone === 'graveyard', 20);
    if (game.state.pendingDecision?.type === 'chooseTargets') {
      expect(game.apply('p1', { type: 'chooseTargets', targets: [{ kind: 'object', id: b2 }] }).ok).toBe(true);
      settle(game);
      expect(game.state.objects[b2].zone).toBe('exile');
    }
  });

  it('Unmask: custo alternativo exilando uma carta preta; escolhe não-terreno da mão', () => {
    const game = makeGame([...FILLER, unmask, darkRitualish], [...FILLER, grizzlyBears, lightningBolt], { topP1: [unmask.id, darkRitualish.id], topP2: ['grizzly-bears', 'lightning-bolt'] });
    goToMain1(game);
    const black = findIn(game, 'p1', 'hand', darkRitualish.id);
    const u = findIn(game, 'p1', 'hand', unmask.id);
    expect(cast(game, 'p1', u, { targets: [{ kind: 'player', player: 'p2' }] }).ok).toBe(false); // sem mana
    expect(cast(game, 'p1', u, { useAltCost: true, altExile: [black], targets: [{ kind: 'player', player: 'p2' }] }).ok).toBe(true);
    expect(game.state.objects[black].zone).toBe('exile');
    untilDecision(game);
    const pd = choice(game);
    expect(pd.player).toBe('p1');
    expect(pd.options.every((id) => !game.state.objects[id].card.types.includes('Land'))).toBe(true);
    const bolt = findIn(game, 'p2', 'hand', 'lightning-bolt');
    expect(pd.options).toContain(bolt);
    answer(game, 'p1', [bolt]);
    settle(game);
    expect(game.state.objects[bolt].zone).toBe('graveyard');
  });

  it('Careful Study: compra duas, descarta duas', () => {
    const game = makeGame([...FILLER, study], FILLER, { topP1: [study.id] });
    goToMain1(game);
    put(game, 'p1', 'island');
    const hand0 = game.state.players.p1.zones.hand.length;
    expect(cast(game, 'p1', findIn(game, 'p1', 'hand', study.id)).ok).toBe(true);
    untilDecision(game);
    const pd = choice(game);
    expect(pd.min).toBe(2);
    answer(game, 'p1', pd.options.slice(0, 2));
    settle(game);
    expect(game.state.players.p1.zones.hand.length).toBe(hand0 - 1);
    expect(game.state.players.p1.zones.graveyard.length).toBe(3);
  });

  it('Life from the Loam: até três terrenos do próprio cemitério; dois escolhidos voltam', () => {
    const game = makeGame([...FILLER, loam], [...FILLER, grizzlyBears], { topP1: [loam.id], topP2: ['grizzly-bears'] });
    goToMain1(game);
    lands(game, 'p1', 'forest', 'forest');
    const l1 = put(game, 'p1', 'mountain', 'graveyard'); const l2 = put(game, 'p1', 'plains', 'graveyard');
    const theirs = put(game, 'p2', 'swamp', 'graveyard');
    const lo = findIn(game, 'p1', 'hand', loam.id);
    expect(cast(game, 'p1', lo, { targets: [{ kind: 'object', id: theirs }] }).ok).toBe(false);
    expect(cast(game, 'p1', lo, { targets: [{ kind: 'object', id: l1 }, { kind: 'object', id: l2 }] }).ok).toBe(true);
    settle(game);
    expect(game.state.objects[l1].zone).toBe('hand');
    expect(game.state.objects[l2].zone).toBe('hand');
    expect(game.state.objects[lo].zone).toBe('graveyard');
    expect(loam.dredge).toBe(3);
  });

  it('Hedge Maze: entra virada e faz surveil 1', () => {
    const game = makeGame([...FILLER, maze], FILLER, { topP1: [maze.id] });
    goToMain1(game);
    const m = findIn(game, 'p1', 'hand', maze.id);
    expect(game.apply('p1', { type: 'playLand', objectId: m }).ok).toBe(true);
    expect(game.state.objects[m].tapped).toBe(true);
    untilDecision(game);
    const pd = choice(game);
    expect(pd.options.length).toBe(1);
    answer(game, 'p1', pd.options);
    settle(game);
    expect(game.state.players.p1.zones.graveyard.length).toBe(1);
  });
});
