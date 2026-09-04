/** M32: Leyline of the Void (escolha "you may" na mão inicial + exílio do cemitério do oponente) e Tamiyo, Inquisitive Student (terceira compra do turno transforma; a mão inicial não conta). */
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

const leyline = mk({ name: 'Leyline of the Void', manaCost: '{2}{B}{B}', typeLine: 'Enchantment', colors: ['B'], oracleText: "If this card is in your opening hand, you may begin the game with it on the battlefield.\nIf a card would be put into an opponent's graveyard from anywhere, exile it instead." });
const tamiyo = mk({ name: 'Tamiyo, Inquisitive Student', manaCost: '{U}', typeLine: 'Legendary Creature — Moonfolk Wizard', power: 0, toughness: 3, colors: ['U'], layout: 'transform', oracleText: 'Flying\nWhenever Tamiyo attacks, investigate.\nWhen you draw your third card in a turn, exile Tamiyo, then return her to the battlefield transformed under her owner\'s control.', backFace: { name: 'Tamiyo, Seasoned Scholar', typeLine: 'Legendary Planeswalker — Tamiyo', colors: ['G', 'U'], loyalty: 2, oracleText: '+2: Until your next turn, whenever a creature attacks you or a planeswalker you control, it gets -1/-0 until end of turn.\n−3: Return target instant or sorcery card from your graveyard to your hand. If it\'s a green card, add one mana of any color.\n−7: Draw cards equal to half the number of cards in your library, rounded up. You get an emblem with "You have no maximum hand size."' } });
const divination = mk({ name: 'Divination', manaCost: '{2}{U}', typeLine: 'Sorcery', colors: ['U'], oracleText: 'Draw two cards.' });

describe('M32 · Leyline of the Void e Tamiyo', () => {
  it('compila tudo como full', () => {
    for (const c of [leyline, tamiyo, divination]) expect(c.automation, `${c.name}: ${c.automationNotes?.join(' | ')}`).toBe('full');
    expect(leyline.openingHand).toBe(true);
    expect(tamiyo.backFace?.loyalty).toBe(2);
  });

  it('Leyline na mão inicial: por padrão começa no campo; o jogador pode escolher deixá-la na mão', () => {
    const game = makeGame([...FILLER, leyline], FILLER, { topP1: [leyline.id], skipKeep: true });
    const ley = findIn(game, 'p1', 'hand', leyline.id);
    expect(game.apply('p1', { type: 'keepHand', bottom: [] }).ok).toBe(true);
    expect(game.state.objects[ley].zone).toBe('battlefield');
    game.apply('p2', { type: 'keepHand', bottom: [] });
    expect(game.state.players.p1.drawsThisTurn).toBe(0); // a mão inicial não conta como compra do turno
    // Segundo jogo: escolhe não começar com ela.
    const g2 = makeGame([...FILLER, leyline], FILLER, { topP1: [leyline.id], skipKeep: true });
    const ley2 = findIn(g2, 'p1', 'hand', leyline.id);
    expect(g2.apply('p1', { type: 'keepHand', bottom: [], beginOnBattlefield: [] }).ok).toBe(true);
    expect(g2.state.objects[ley2].zone).toBe('hand');
  });

  it('Leyline no campo: cartas do oponente que iriam para o cemitério são exiladas; as suas não', () => {
    const game = makeGame([...FILLER, leyline, lightningBolt], [...FILLER, grizzlyBears], { topP1: [leyline.id, 'lightning-bolt'], topP2: ['grizzly-bears'] });
    goToMain1(game);
    expect(game.state.objects[findIn(game, 'p1', 'battlefield', leyline.id)].zone).toBe('battlefield');
    const bears = put(game, 'p2', 'grizzly-bears');
    put(game, 'p1', 'mountain');
    const bolt = put(game, 'p1', 'lightning-bolt', 'hand');
    expect(cast(game, 'p1', bolt, { targets: [{ kind: 'object', id: bears }] }).ok).toBe(true);
    settle(game);
    expect(game.state.objects[bears].zone).toBe('exile'); // do oponente: exilada
    expect(game.state.objects[bolt].zone).toBe('graveyard'); // sua: cemitério normal
  });

  it('Tamiyo: a terceira compra do turno a exila e devolve transformada como planeswalker com 2 de lealdade', () => {
    const game = makeGame([...FILLER, tamiyo, divination, divination], FILLER, { topP1: [tamiyo.id, divination.id, divination.id] });
    goToMain1(game);
    put(game, 'p1', 'island'); put(game, 'p1', 'island'); put(game, 'p1', 'island'); put(game, 'p1', 'island');
    const t = findIn(game, 'p1', 'hand', tamiyo.id);
    expect(cast(game, 'p1', t).ok).toBe(true);
    settle(game);
    expect(game.state.objects[t].zone).toBe('battlefield');
    // Turno 3 (de novo da Alice): compra da etapa (1) + Divination (2, 3) → transforma.
    passUntil(game, (s) => s.turn === 3 && s.step === 'main1' && s.priority === 'p1' && s.stack.length === 0, 400);
    expect(game.state.players.p1.drawsThisTurn).toBe(1);
    for (const id of game.state.players.p1.zones.battlefield) game.state.objects[id].tapped = false;
    const d = findIn(game, 'p1', 'hand', divination.id);
    expect(cast(game, 'p1', d).ok).toBe(true);
    settle(game);
    const tam = game.state.objects[t];
    expect(tam.zone).toBe('battlefield');
    expect(tam.transformed).toBe(true);
    expect(tam.card.name).toBe('Tamiyo, Seasoned Scholar');
    expect(tam.card.types).toContain('Planeswalker');
    expect(tam.counters['loyalty']).toBe(2);
  });
});
