/** M49: Show and Tell põe Wishclaw com marcadores; escolha forçada vai ao jogador (askForcedChoices); Atraxa revela com as escolhidas. */
import { describe, expect, it } from 'vitest';
import { compileOracleCard, type OracleInput } from '../src/cards/oracle-parser.js';
import { forest, grizzlyBears, island, lightningBolt, mountain, plains, swamp } from '../src/cards/demo-set.js';
import type { CardDefinition } from '../src/cards/types.js';
import { Game } from '../src/game.js';
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

const showAndTell = mk({ name: 'Show and Tell', manaCost: '{2}{U}', typeLine: 'Sorcery', colors: ['U'], oracleText: 'Each player may put an artifact, creature, enchantment, or land card from their hand onto the battlefield.' });
const wishclaw = mk({ name: 'Wishclaw Talisman', manaCost: '{2}', typeLine: 'Artifact', colors: [], oracleText: "Wishclaw Talisman enters with three wish counters on it.\n{1}, {T}, Remove a wish counter from Wishclaw Talisman: Search your library for a card, put it into your hand, then shuffle. An opponent gains control of Wishclaw Talisman. Activate only during your turn." });
const duress = mk({ name: 'Duress', manaCost: '{B}', typeLine: 'Sorcery', colors: ['B'], oracleText: 'Target opponent reveals their hand. You choose a noncreature, nonland card from it. That player discards that card.' });
const atraxa = mk({ name: 'Atraxa, Grand Unifier', manaCost: '{G}{W}{U}{B}', typeLine: 'Legendary Creature — Phyrexian Angel', power: 7, toughness: 7, colors: ['W', 'U', 'B', 'G'], oracleText: 'Flying, vigilance, deathtouch, lifelink\nWhen Atraxa, Grand Unifier enters, reveal the top ten cards of your library. For each card type, you may put a card of that type from among the revealed cards into your hand. Put the rest on the bottom of your library in a random order.' });

const realGame = (p1: CardDefinition[], p2: CardDefinition[], top1: string[], top2: string[] = []) => {
  const game = new Game([{ id: 'p1', name: 'Alice', deck: { cards: p1 } }, { id: 'p2', name: 'Bob', deck: { cards: p2 } }], 42, { firstPlayer: 'p1', askForcedChoices: true });
  const stack = (p: PlayerId, ids: string[]) => { const lib = game.state.players[p].zones.library; for (const cid of [...ids].reverse()) { const i = lib.findIndex((oid) => game.state.objects[oid].card.id === cid); lib.unshift(...lib.splice(i, 1)); } };
  stack('p1', top1); if (top2.length) stack('p2', top2);
  game.start();
  game.apply('p1', { type: 'keepHand', bottom: [] });
  game.apply('p2', { type: 'keepHand', bottom: [] });
  return game;
};

describe('M49 · Show and Tell + marcadores, escolha forçada, Atraxa', () => {
  it('Wishclaw Talisman posto no campo por Show and Tell entra com três marcadores', () => {
    expect(wishclaw.entersWithCounters).toEqual({ counter: 'wish', count: 3 });
    const game = makeGame([...FILLER, showAndTell], [...FILLER, wishclaw], { topP1: [showAndTell.id], topP2: [wishclaw.id] });
    goToMain1(game);
    lands(game, 'p1', 'island', 'island', 'island');
    const w = findIn(game, 'p2', 'hand', wishclaw.id);
    expect(cast(game, 'p1', findIn(game, 'p1', 'hand', showAndTell.id)).ok).toBe(true);
    // cada jogador decide o que põe: p1 nada (mão só de terrenos serve, mas escolhe nenhum), p2 o Talisman
    for (let i = 0; i < 6; i++) {
      untilDecision(game);
      const pd = game.state.pendingDecision;
      if (!pd) break;
      if (pd.type !== 'effectChoice') throw new Error(`decisão inesperada: ${pd.type}`);
      answer(game, pd.player, pd.player === 'p2' ? [w] : []);
    }
    settle(game);
    expect(game.state.objects[w].zone).toBe('battlefield');
    expect(game.state.objects[w].counters['wish']).toBe(3);
  });

  it('Wishclaw conjurado normalmente continua entrando com três (sem dobrar)', () => {
    const game = makeGame([...FILLER, wishclaw], FILLER, { topP1: [wishclaw.id] });
    goToMain1(game);
    lands(game, 'p1', 'island', 'island');
    const w = findIn(game, 'p1', 'hand', wishclaw.id);
    expect(cast(game, 'p1', w).ok).toBe(true);
    settle(game);
    expect(game.state.objects[w].counters['wish']).toBe(3);
  });

  it('askForcedChoices: Duress com uma carta elegível ainda pergunta ao jogador; sem a opção, resolve sozinho', () => {
    const g1 = realGame([...FILLER, duress], [...FILLER, lightningBolt], [duress.id], ['lightning-bolt']);
    goToMain1(g1);
    put(g1, 'p1', 'swamp');
    const bolt1 = findIn(g1, 'p2', 'hand', 'lightning-bolt');
    expect(cast(g1, 'p1', findIn(g1, 'p1', 'hand', duress.id), { targets: [{ kind: 'player', player: 'p2' }] }).ok).toBe(true);
    untilDecision(g1);
    const pd = choice(g1);
    expect(pd.player).toBe('p1');
    expect(pd.options).toEqual([bolt1]);
    expect(pd.min).toBe(1);
    expect(pd.shown?.length).toBe(6);
    answer(g1, 'p1', [bolt1]);
    expect(g1.state.objects[bolt1].zone).toBe('graveyard');

    const g2 = makeGame([...FILLER, duress], [...FILLER, lightningBolt], { topP1: [duress.id], topP2: ['lightning-bolt'] });
    goToMain1(g2);
    put(g2, 'p1', 'swamp');
    const bolt2 = findIn(g2, 'p2', 'hand', 'lightning-bolt');
    expect(cast(g2, 'p1', findIn(g2, 'p1', 'hand', duress.id), { targets: [{ kind: 'player', player: 'p2' }] }).ok).toBe(true);
    settle(g2);
    expect(g2.state.pendingDecision).toBeNull();
    expect(g2.state.objects[bolt2].zone).toBe('graveyard');
  });

  it('Atraxa: revela as dez e o evento traz quais foram escolhidas', () => {
    const game = makeGame([...FILLER, atraxa, lightningBolt, grizzlyBears], FILLER, { topP1: [atraxa.id] });
    goToMain1(game);
    const bolt = findIn(game, 'p1', 'library', 'lightning-bolt'); const bears = findIn(game, 'p1', 'library', 'grizzly-bears');
    game.apply('p1', { type: 'manualMove', objectId: bears, to: 'library', position: 'top' });
    game.apply('p1', { type: 'manualMove', objectId: bolt, to: 'library', position: 'top' });
    const events: import('../src/events.js').GameEvent[] = [];
    lands(game, 'p1', 'forest', 'plains', 'island', 'swamp');
    expect(cast(game, 'p1', findIn(game, 'p1', 'hand', atraxa.id)).ok).toBe(true);
    untilDecision(game);
    const pd = choice(game);
    expect(pd.player).toBe('p1');
    expect(pd.options.length).toBe(10);
    const r = game.apply('p1', { type: 'effectChoice', picks: [bolt, bears] });
    events.push(...r.events);
    const rev = events.find((e) => e.type === 'cardsRevealed' && 'picked' in e && e.picked);
    expect(rev).toBeDefined();
    if (rev?.type === 'cardsRevealed') {
      expect(rev.cards.length).toBe(10);
      expect(rev.picked).toEqual(['Lightning Bolt', 'Grizzly Bears']);
    }
    expect(game.state.objects[bolt].zone).toBe('hand');
    expect(game.state.objects[bears].zone).toBe('hand');
  });
});
