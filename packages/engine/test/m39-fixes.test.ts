/** M39: relatos do Lucas — Daze devolvendo Tundra, Duress revela a mão sem alvo, Dread Return (3 sacrifícios + alvo só no próprio cemitério), Reanimate em qualquer cemitério. */
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
const lands = (game: Game, p: PlayerId, ...ids: string[]) => { for (const id of ids) put(game, p, id); };

const daze = mk({ name: 'Daze', manaCost: '{1}{U}', typeLine: 'Instant', colors: ['U'], oracleText: "You may return an Island you control to its owner's hand rather than pay this spell's mana cost.\nCounter target spell unless its controller pays {1}." });
const tundra = mk({ name: 'Tundra', typeLine: 'Land — Plains Island', colors: [], oracleText: '({T}: Add {W} or {U}.)' });
const duress = mk({ name: 'Duress', manaCost: '{B}', typeLine: 'Sorcery', colors: ['B'], oracleText: 'Target opponent reveals their hand. You choose a noncreature, nonland card from it. That player discards that card.' });
const dreadReturn = mk({ name: 'Dread Return', manaCost: '{2}{B}{B}', typeLine: 'Sorcery', colors: ['B'], oracleText: 'Return target creature card from your graveyard to the battlefield.\nFlashback—Sacrifice three creatures.' });
const reanimate = mk({ name: 'Reanimate', manaCost: '{B}', typeLine: 'Sorcery', colors: ['B'], oracleText: 'Put target creature card from a graveyard onto the battlefield under your control. You lose life equal to its mana value.' });

describe('M39 · relatos', () => {
  it('Daze: Tundra (Plains Island) serve como Ilha para o custo alternativo, escolhida pelo jogador', () => {
    const game = makeGame([...FILLER, lightningBolt], [...FILLER, daze, tundra], { topP1: ['lightning-bolt'], topP2: [daze.id, tundra.id] });
    goToMain1(game);
    put(game, 'p1', 'mountain');
    const t = put(game, 'p2', tundra.id);
    const pl = put(game, 'p2', 'plains');
    const bolt = findIn(game, 'p1', 'hand', 'lightning-bolt');
    expect(cast(game, 'p1', bolt, { targets: [{ kind: 'player', player: 'p2' }] }).ok).toBe(true);
    passUntil(game, (s) => s.priority === 'p2', 10);
    const d = findIn(game, 'p2', 'hand', daze.id);
    // Plains não serve; Tundra serve.
    expect(cast(game, 'p2', d, { useAltCost: true, altReturnLand: pl, targets: [{ kind: 'object', id: bolt }] }).ok).toBe(false);
    const rd = cast(game, 'p2', d, { useAltCost: true, altReturnLand: t, targets: [{ kind: 'object', id: bolt }] });
    expect(rd.ok, JSON.stringify(rd.events.filter((e) => e.type === 'error'))).toBe(true);
    expect(game.state.objects[t].zone).toBe('hand');
    expect(game.state.stack.length).toBe(2);
  });

  it('Duress: revela a mão inteira mesmo sem carta que sirva para o descarte', () => {
    const game = makeGame([...FILLER, duress], [...FILLER, grizzlyBears], { topP1: [duress.id], topP2: ['grizzly-bears'] });
    goToMain1(game);
    put(game, 'p1', 'swamp');
    // mão do p2: só terrenos e criatura
    const r = cast(game, 'p1', findIn(game, 'p1', 'hand', duress.id), { targets: [{ kind: 'player', player: 'p2' }] });
    expect(r.ok).toBe(true);
    const before = game.state.players.p2.zones.hand.length;
    const evs = [...game.apply('p1', { type: 'passPriority' }).events, ...game.apply('p2', { type: 'passPriority' }).events];
    settle(game);
    expect(game.state.players.p2.zones.hand.length).toBe(before);
    // o evento de revelação saiu com a mão completa
    const revealed = evs.find((e) => e.type === 'handRevealed');
    expect(revealed).toBeDefined();
    if (revealed?.type === 'handRevealed') { expect(revealed.player).toBe('p2'); expect(revealed.cards.length).toBe(before); }
  });

  it('Dread Return: alvo só no próprio cemitério; flashback exige sacrificar três criaturas', () => {
    const game = makeGame([...FILLER, dreadReturn, ...copies(grizzlyBears, 5)], [...FILLER, grizzlyBears], { topP1: [dreadReturn.id, 'grizzly-bears', 'grizzly-bears', 'grizzly-bears', 'grizzly-bears', 'grizzly-bears'], topP2: ['grizzly-bears'] });
    goToMain1(game);
    lands(game, 'p1', 'swamp', 'swamp', 'swamp', 'swamp');
    const mine = put(game, 'p1', 'grizzly-bears', 'graveyard');
    const theirs = put(game, 'p2', 'grizzly-bears', 'graveyard');
    const dr = findIn(game, 'p1', 'hand', dreadReturn.id);
    expect(cast(game, 'p1', dr, { targets: [{ kind: 'object', id: theirs }] }).ok).toBe(false);
    expect(cast(game, 'p1', dr, { targets: [{ kind: 'object', id: mine }] }).ok).toBe(true);
    settle(game);
    expect(game.state.objects[mine].zone).toBe('battlefield');
    expect(game.state.objects[dr].zone).toBe('graveyard');
    // flashback: três criaturas sacrificadas como custo
    const b1 = put(game, 'p1', 'grizzly-bears'); const b2 = put(game, 'p1', 'grizzly-bears'); const b3 = put(game, 'p1', 'grizzly-bears');
    const dead = put(game, 'p1', 'grizzly-bears', 'graveyard');
    expect(cast(game, 'p1', dr, { targets: [{ kind: 'object', id: dead }] }).ok).toBe(false); // sem sacrifícios
    expect(cast(game, 'p1', dr, { sacrifices: [b1, b2], targets: [{ kind: 'object', id: dead }] }).ok).toBe(false); // só dois
    expect(cast(game, 'p1', dr, { sacrifices: [b1, b2, b3], targets: [{ kind: 'object', id: dead }] }).ok).toBe(true);
    settle(game);
    expect([b1, b2, b3].every((id) => game.state.objects[id].zone === 'graveyard')).toBe(true);
    expect(game.state.objects[dead].zone).toBe('battlefield');
    expect(game.state.objects[dr].zone).toBe('exile');
  });

  it('Reanimate: pode escolher criatura no cemitério do oponente', () => {
    const game = makeGame([...FILLER, reanimate], [...FILLER, grizzlyBears], { topP1: [reanimate.id], topP2: ['grizzly-bears'] });
    goToMain1(game);
    put(game, 'p1', 'swamp');
    const theirs = put(game, 'p2', 'grizzly-bears', 'graveyard');
    expect(cast(game, 'p1', findIn(game, 'p1', 'hand', reanimate.id), { targets: [{ kind: 'object', id: theirs }] }).ok).toBe(true);
    settle(game);
    expect(game.state.objects[theirs].zone).toBe('battlefield');
    expect(game.state.objects[theirs].controller).toBe('p1');
    expect(game.state.players.p1.life).toBe(18);
  });
});
