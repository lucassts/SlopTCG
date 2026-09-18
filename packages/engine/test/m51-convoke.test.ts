/** M51: convoke/improvise escolhidos pelo jogador (Hogaak do cemitério: delve + convoke, sem mana). */
import { describe, expect, it } from 'vitest';
import { compileOracleCard, type OracleInput } from '../src/cards/oracle-parser.js';
import { forest, grizzlyBears, island, mountain, plains, swamp } from '../src/cards/demo-set.js';
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

const hogaak = mk({ name: 'Hogaak, Arisen Necropolis', manaCost: '{5}{B/G}{B/G}', typeLine: 'Legendary Creature — Avatar', power: 8, toughness: 8, colors: ['B', 'G'], oracleText: "You can't spend mana to cast this spell.\nConvoke, delve\nYou may cast this card from your graveyard.\nTrample" });
const convokeSpell = mk({ name: 'Convoke Bear', manaCost: '{2}{G}', typeLine: 'Creature — Bear', power: 3, toughness: 3, colors: ['G'], oracleText: 'Convoke' });

const setup = () => {
  const game = makeGame([...FILLER, hogaak, ...copies(grizzlyBears, 4)], FILLER, { topP1: [hogaak.id, 'grizzly-bears', 'grizzly-bears', 'grizzly-bears', 'grizzly-bears'] });
  goToMain1(game);
  const h = put(game, 'p1', hogaak.id, 'graveyard');
  const bears = [0, 1, 2, 3].map(() => put(game, 'p1', 'grizzly-bears'));
  const gy = ['mountain', 'mountain', 'mountain', 'forest'].map((l) => put(game, 'p1', l, 'graveyard'));
  return { game, h, bears, gy };
};

describe('M51 · convoke escolhido pelo jogador', () => {
  it('Hogaak do cemitério: vira exatamente as criaturas escolhidas e exila exatamente as cartas escolhidas', () => {
    const { game, h, bears, gy } = setup();
    // {5}{B/G}{B/G} = 7: 4 do cemitério + 3 criaturas
    expect(cast(game, 'p1', h, { delve: gy, convoke: bears.slice(0, 3) }).ok).toBe(true);
    settle(game);
    expect(game.state.objects[h].zone).toBe('battlefield');
    for (const id of bears.slice(0, 3)) expect(game.state.objects[id].tapped).toBe(true);
    expect(game.state.objects[bears[3]].tapped).toBe(false);
    for (const id of gy) expect(game.state.objects[id].zone).toBe('exile');
  });

  it('escolha insuficiente falha (nada vira, nada é exilado); criatura virada ou do oponente é recusada', () => {
    const { game, h, bears, gy } = setup();
    expect(cast(game, 'p1', h, { delve: gy.slice(0, 2), convoke: bears.slice(0, 2) }).ok).toBe(false); // 4 de 7
    for (const id of bears) expect(game.state.objects[id].tapped).toBe(false);
    for (const id of gy) expect(game.state.objects[id].zone).toBe('graveyard');
    game.state.objects[bears[0]].tapped = true;
    expect(cast(game, 'p1', h, { delve: gy, convoke: [bears[0], bears[1], bears[2]] }).ok).toBe(false); // virada
    const theirs = put(game, 'p2', 'forest');
    expect(cast(game, 'p1', h, { delve: gy, convoke: [theirs, bears[1], bears[2]] }).ok).toBe(false); // não é criatura sua
  });

  it('sem os campos a engine continua escolhendo sozinha (compatibilidade)', () => {
    const { game, h } = setup();
    expect(cast(game, 'p1', h).ok).toBe(true);
    settle(game);
    expect(game.state.objects[h].zone).toBe('battlefield');
  });

  it('convoke comum: as criaturas escolhidas pagam parte e a mana paga o resto', () => {
    const game = makeGame([...FILLER, convokeSpell, grizzlyBears, grizzlyBears], FILLER, { topP1: [convokeSpell.id, 'grizzly-bears', 'grizzly-bears'] });
    goToMain1(game);
    const b1 = put(game, 'p1', 'grizzly-bears'); const b2 = put(game, 'p1', 'grizzly-bears');
    const f = put(game, 'p1', 'forest');
    const c = findIn(game, 'p1', 'hand', convokeSpell.id);
    expect(cast(game, 'p1', c, { convoke: [b1, b2] }).ok).toBe(true); // {2} pelas criaturas, {G} pela Forest
    settle(game);
    expect(game.state.objects[c].zone).toBe('battlefield');
    expect(game.state.objects[b1].tapped).toBe(true);
    expect(game.state.objects[b2].tapped).toBe(true);
    expect(game.state.objects[f].tapped).toBe(true);
  });
});
