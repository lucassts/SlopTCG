/** M46: delve escolhido pelo jogador antes do pagamento (Murktide Regent). */
import { describe, expect, it } from 'vitest';
import { compileOracleCard, type OracleInput } from '../src/cards/oracle-parser.js';
import { forest, island, lightningBolt, mountain, plains, swamp } from '../src/cards/demo-set.js';
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
const lands = (game: Game, p: PlayerId, ...ids: string[]) => { for (const id of ids) put(game, p, id); };

const murktide = mk({ name: 'Murktide Regent', manaCost: '{5}{U}{U}', typeLine: 'Creature — Dragon', power: 3, toughness: 3, colors: ['U'], oracleText: 'Delve\nFlying\nMurktide Regent enters with a +1/+1 counter on it for each instant and sorcery card exiled with it.\nWhenever an instant or sorcery card leaves your graveyard, put a +1/+1 counter on Murktide Regent.' });

const setup = (opts: { manualMana?: boolean } = {}) => {
  const game = opts.manualMana
    ? new Game([{ id: 'p1', name: 'Alice', deck: { cards: [...FILLER, murktide] } }, { id: 'p2', name: 'Bob', deck: { cards: FILLER } }], 42, { firstPlayer: 'p1', manualMana: true })
    : makeGame([...FILLER, murktide], FILLER, { topP1: [murktide.id] });
  if (opts.manualMana) {
    const lib = game.state.players.p1.zones.library;
    const idx = lib.findIndex((oid) => game.state.objects[oid].card.id === murktide.id);
    lib.unshift(...lib.splice(idx, 1));
    game.start();
    game.apply('p1', { type: 'keepHand', bottom: [] });
    game.apply('p2', { type: 'keepHand', bottom: [] });
  }
  goToMain1(game);
  lands(game, 'p1', 'island', 'island');
  const gy = ['mountain', 'mountain', 'mountain', 'forest', 'forest', 'plains'].map((l) => put(game, 'p1', l, 'graveyard'));
  return { game, gy, m: findIn(game, 'p1', 'hand', murktide.id) };
};

describe('M46 · delve escolhido antes do pagamento', () => {
  it('exila exatamente as cartas escolhidas e paga só o resto', () => {
    const { game, gy, m } = setup();
    expect(cast(game, 'p1', m, { delve: gy.slice(0, 5) }).ok).toBe(true);
    settle(game);
    expect(game.state.objects[m].zone).toBe('battlefield');
    for (const id of gy.slice(0, 5)) expect(game.state.objects[id].zone).toBe('exile');
    expect(game.state.objects[gy[5]].zone).toBe('graveyard'); // a sexta ficou
    expect(game.state.players.p1.zones.battlefield.filter((id) => game.state.objects[id].tapped).length).toBe(2);
  });

  it('delve vazio ([]) não exila nada — e sem mana para o custo cheio a conjuração falha', () => {
    const { game, gy, m } = setup();
    expect(cast(game, 'p1', m, { delve: [] }).ok).toBe(false);
    for (const id of gy) expect(game.state.objects[id].zone).toBe('graveyard');
  });

  it('não aceita mais cartas que o custo genérico, nem carta fora do seu cemitério', () => {
    const { game, gy, m } = setup();
    expect(cast(game, 'p1', m, { delve: gy }).ok).toBe(false); // 6 > {5}
    const opp = put(game, 'p2', 'swamp', 'graveyard');
    expect(cast(game, 'p1', m, { delve: [opp, ...gy.slice(0, 4)] }).ok).toBe(false);
    for (const id of gy) expect(game.state.objects[id].zone).toBe('graveyard');
  });

  it('sem o campo delve a engine continua escolhendo sozinha (compatibilidade)', () => {
    const { game, m } = setup();
    expect(cast(game, 'p1', m).ok).toBe(true);
    settle(game);
    expect(game.state.objects[m].zone).toBe('battlefield');
    expect(game.state.players.p1.zones.exile.length).toBe(5);
  });

  it('mana manual: o pedido de pagamento já vem com o custo reduzido pelo delve', () => {
    const { game, gy, m } = setup({ manualMana: true });
    expect(cast(game, 'p1', m, { delve: gy.slice(0, 5) }).ok).toBe(true);
    expect(game.state.pendingPayment?.cost).toBe('{U}{U}');
    for (const id of gy) expect(game.state.objects[id].zone).toBe('graveyard'); // só exila quando o pagamento fecha
  });
});
