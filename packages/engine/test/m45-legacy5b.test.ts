/** M45: Sheltered by Ghosts, Chancellor of the Annex, Call Forth the Tempest, Curie, Abhorrent Oculus. */
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
const untapAll = (game: Game, p: PlayerId) => { for (const id of game.state.players[p].zones.battlefield) game.state.objects[id].tapped = false; };
const toMain1 = (game: Game, turn: number, p: PlayerId) => passUntil(game, (s) => s.turn === turn && s.step === 'main1' && s.priority === p && s.stack.length === 0, 600);

const C = (name: string, extra: Partial<OracleInput> & { oracleText: string; typeLine: string }) => mk({ name, colors: [], ...extra });
const sheltered = C('Sheltered by Ghosts', { manaCost: '{1}{W}', typeLine: 'Enchantment — Aura', colors: ['W'], oracleText: 'Enchant creature you control\nWhen this Aura enters, exile target nonland permanent an opponent controls until this Aura leaves the battlefield.\nEnchanted creature gets +1/+0 and has lifelink and ward {2}.' });
const chancellor = C('Chancellor of the Annex', { manaCost: '{4}{W}{W}{W}', typeLine: 'Creature — Phyrexian Angel', power: 5, toughness: 6, colors: ['W'], oracleText: 'You may reveal this card from your opening hand. If you do, when each opponent casts their first spell of the game, counter that spell unless that player pays {1}.\nFlying\nWhenever an opponent casts a spell, counter it unless that player pays {1}.' });
const tempest = C('Call Forth the Tempest', { manaCost: '{5}{R}{R}{R}', typeLine: 'Sorcery', colors: ['R'], oracleText: "Cascade, cascade\nCall Forth the Tempest deals damage to each creature your opponents control equal to the total mana value of other spells you've cast this turn." });
const curie = C('Curie, Emergent Intelligence', { manaCost: '{1}{U}', typeLine: 'Legendary Artifact Creature — Robot', power: 1, toughness: 3, colors: ['U'], oracleText: 'Whenever Curie deals combat damage to a player, draw cards equal to its base power.\n{1}{U}, Exile another nontoken artifact creature you control: Curie becomes a copy of the exiled creature, except it has "Whenever this creature deals combat damage to a player, draw cards equal to its base power."' });
const oculus = C('Abhorrent Oculus', { manaCost: '{2}{U}', typeLine: 'Creature — Eye', power: 5, toughness: 5, colors: ['U'], oracleText: "As an additional cost to cast this spell, exile six cards from your graveyard.\nFlying\nAt the beginning of each opponent's upkeep, manifest dread." });
const robot = C('Robot Bear', { manaCost: '{4}', typeLine: 'Artifact Creature — Robot Bear', power: 4, toughness: 4, oracleText: 'Flying' });
const giant = C('Hill Giant', { manaCost: '{3}{R}', typeLine: 'Creature — Giant', power: 3, toughness: 3, colors: ['R'], oracleText: '' });
const bigBear = C('Big Bear', { manaCost: '{3}{G}{G}', typeLine: 'Creature — Bear', power: 5, toughness: 5, colors: ['G'], oracleText: '' });

describe('M45 · Sheltered by Ghosts, Chancellor, Call Forth the Tempest, Curie, Abhorrent Oculus', () => {
  it('compila tudo como full', () => {
    for (const c of [sheltered, chancellor, tempest, curie, oculus]) expect(c.automation, `${c.name}: ${c.automationNotes?.join(' | ')}`).toBe('full');
    expect(sheltered.attachEffect).toEqual({ power: 1, toughness: 0, keywords: ['lifelink'], ward: 2 });
    expect(chancellor.chancellor).toEqual({ cost: '{1}' });
  });

  it('Sheltered by Ghosts: exila permanente do oponente até sair; +1/+0, vínculo com a vida e proteção {2}', () => {
    const game = makeGame([...FILLER, sheltered, grizzlyBears], [...FILLER, grizzlyBears, lightningBolt], { topP1: [sheltered.id, 'grizzly-bears'], topP2: ['grizzly-bears', 'lightning-bolt'] });
    goToMain1(game);
    lands(game, 'p1', 'plains', 'plains');
    const mine = put(game, 'p1', 'grizzly-bears'); const theirs = put(game, 'p2', 'grizzly-bears');
    const aura = findIn(game, 'p1', 'hand', sheltered.id);
    expect(cast(game, 'p1', aura, { targets: [{ kind: 'object', id: mine }] }).ok).toBe(true);
    passUntil(game, (s) => s.pendingDecision?.type === 'chooseTargets', 50);
    expect(game.apply('p1', { type: 'chooseTargets', targets: [{ kind: 'object', id: theirs }] }).ok).toBe(true);
    settle(game);
    expect(game.state.objects[theirs].zone).toBe('exile');
    expect(effectivePower(game.state, game.state.objects[mine])).toBe(3);
    expect(hasKeyword(game.state, game.state.objects[mine], 'lifelink')).toBe(true);
    // proteção {2}: Bolt com um Mountain só não paga
    toMain1(game, 2, 'p2');
    put(game, 'p2', 'mountain');
    const bolt = findIn(game, 'p2', 'hand', 'lightning-bolt');
    expect(cast(game, 'p2', bolt, { targets: [{ kind: 'object', id: mine }] }).ok).toBe(false);
    put(game, 'p2', 'mountain'); put(game, 'p2', 'mountain');
    expect(cast(game, 'p2', bolt, { targets: [{ kind: 'object', id: mine }] }).ok).toBe(true);
    settle(game);
    expect(game.state.objects[mine].zone).toBe('graveyard');
    expect(game.state.objects[theirs].zone).toBe('battlefield'); // a Aura saiu junto: a carta volta
  });

  it('Chancellor of the Annex: revelada da mão inicial, a primeira mágica do oponente é anulada a menos que pague {1}', () => {
    const game = makeGame([...FILLER, chancellor], [...FILLER, grizzlyBears, grizzlyBears], { topP1: [chancellor.id], topP2: ['grizzly-bears', 'grizzly-bears'] });
    goToMain1(game);
    expect(game.state.objects[findIn(game, 'p1', 'hand', chancellor.id)].chancellorRevealed).toBe(true);
    toMain1(game, 2, 'p2');
    lands(game, 'p2', 'forest', 'forest');
    const b1 = findIn(game, 'p2', 'hand', 'grizzly-bears');
    expect(cast(game, 'p2', b1).ok).toBe(true); // sem mana sobrando: não paga
    settle(game);
    expect(game.state.objects[b1].zone).toBe('graveyard');
    untapAll(game, 'p2');
    const b2 = findIn(game, 'p2', 'hand', 'grizzly-bears');
    expect(cast(game, 'p2', b2).ok).toBe(true); // segunda mágica: nada
    settle(game);
    expect(game.state.objects[b2].zone).toBe('battlefield');
  });

  it('Chancellor of the Annex no campo: cada mágica do oponente é anulada a menos que pague {1}', () => {
    const game = makeGame([...FILLER, chancellor], [...FILLER, grizzlyBears], { topP1: [chancellor.id], topP2: ['grizzly-bears'] });
    goToMain1(game);
    game.state.objects[findIn(game, 'p1', 'hand', chancellor.id)].chancellorRevealed = false; // isola o gatilho do campo
    put(game, 'p1', chancellor.id);
    toMain1(game, 2, 'p2');
    lands(game, 'p2', 'forest', 'forest', 'forest');
    const bears = findIn(game, 'p2', 'hand', 'grizzly-bears');
    expect(cast(game, 'p2', bears).ok).toBe(true);
    untilDecision(game);
    const pd = choice(game);
    expect(pd.player).toBe('p2');
    expect(pd.mode).toBe('confirm');
    answer(game, 'p2', [], 'yes');
    settle(game);
    expect(game.state.objects[bears].zone).toBe('battlefield');
    expect(game.state.players.p2.zones.battlefield.filter((id) => game.state.objects[id].tapped).length).toBe(3); // pagou o {1} extra
  });

  it('Call Forth the Tempest: dano igual ao valor de mana das outras mágicas do turno', () => {
    const game = makeGame([...FILLER, tempest, lightningBolt, grizzlyBears], [...FILLER, grizzlyBears, bigBear], { topP1: [tempest.id, 'lightning-bolt', 'grizzly-bears'], topP2: ['grizzly-bears', bigBear.id] });
    goToMain1(game);
    lands(game, 'p1', 'mountain', 'mountain', 'mountain', 'mountain', 'mountain', 'mountain', 'forest', 'forest', 'forest', 'forest', 'forest');
    const small = put(game, 'p2', 'grizzly-bears'); const big = put(game, 'p2', bigBear.id);
    expect(cast(game, 'p1', findIn(game, 'p1', 'hand', 'lightning-bolt'), { targets: [{ kind: 'player', player: 'p2' }] }).ok).toBe(true);
    settle(game);
    expect(cast(game, 'p1', findIn(game, 'p1', 'hand', 'grizzly-bears')).ok).toBe(true);
    settle(game);
    expect(game.state.players.p1.mvCastThisTurn).toBe(3);
    expect(cast(game, 'p1', findIn(game, 'p1', 'hand', tempest.id)).ok).toBe(true);
    settle(game);
    expect(game.state.objects[small].zone).toBe('graveyard');
    expect(game.state.objects[big].zone).toBe('battlefield');
    expect(game.state.objects[big].damage).toBe(3);
  });

  it('Curie: vira cópia da criatura exilada como custo, mantém o gatilho e compra pelo poder base', () => {
    const game = makeGame([...FILLER, curie, robot], FILLER, { topP1: [curie.id, robot.id] });
    goToMain1(game);
    lands(game, 'p1', 'island', 'island');
    const c = put(game, 'p1', curie.id); const r = put(game, 'p1', robot.id);
    game.state.objects[c].summoningSick = false;
    const idx = curie.abilities!.findIndex((ab) => ab.kind === 'activated');
    expect(game.apply('p1', { type: 'activateAbility', objectId: c, abilityIndex: idx, sacrifices: [r] }).ok).toBe(true);
    settle(game);
    expect(game.state.objects[r].zone).toBe('exile');
    const cu = game.state.objects[c];
    expect(cu.card.name).toBe('Robot Bear');
    expect(effectivePower(game.state, cu)).toBe(4);
    expect(hasKeyword(game.state, cu, 'flying')).toBe(true);
    expect(cu.card.abilities?.some((ab) => ab.kind === 'triggered')).toBe(true);
    expect(cu.card.abilities?.some((ab) => ab.kind === 'activated')).toBe(false);
    const h = game.state.players.p1.zones.hand.length;
    passUntil(game, (s) => s.combatAwaiting === 'attackers', 30);
    expect(game.apply('p1', { type: 'declareAttackers', attackers: [c] }).ok).toBe(true);
    passUntil(game, (s) => s.combatAwaiting === 'blockers', 30);
    expect(game.apply('p2', { type: 'declareBlockers', blocks: [] }).ok).toBe(true);
    settle(game);
    passUntil(game, (s) => s.step === 'main2' || s.turn > 1, 60);
    expect(game.state.players.p2.life).toBe(16);
    expect(game.state.players.p1.zones.hand.length).toBe(h + 4);
  });

  it('Abhorrent Oculus: na manutenção do oponente, manifesta pavor; a carta vira para cima pelo custo de mana', () => {
    const game = makeGame([...FILLER, oculus, giant], FILLER, { topP1: [oculus.id, giant.id] });
    goToMain1(game);
    put(game, 'p1', oculus.id);
    lands(game, 'p1', 'mountain', 'mountain', 'mountain', 'mountain');
    const g = findIn(game, 'p1', 'hand', giant.id);
    game.apply('p1', { type: 'manualMove', objectId: g, to: 'library', position: 'top' });
    const second = game.state.players.p1.zones.library[1];
    passUntil(game, (s) => s.turn === 2 && s.pendingDecision?.type === 'effectChoice', 400);
    const pd = choice(game);
    expect(pd.player).toBe('p1');
    expect(pd.options).toEqual([g, second]);
    answer(game, 'p1', [g]);
    passUntil(game, (s) => s.priority === 'p1' && s.stack.length === 0, 30);
    const go = game.state.objects[g];
    expect(go.zone).toBe('battlefield');
    expect(go.faceDown).toBe(true);
    expect(go.manifested).toBe(true);
    expect(effectivePower(game.state, go)).toBe(2);
    expect(game.state.objects[second].zone).toBe('graveyard');
    untapAll(game, 'p1');
    expect(game.apply('p1', { type: 'turnFaceUp', objectId: g }).ok).toBe(true); // {3}{R}
    expect(go.faceDown).toBe(false);
    expect(effectivePower(game.state, go)).toBe(3);
  });
});
