/** M48: Duress mostra a mão inteira na decisão — as inelegíveis ficam visíveis (shown), mas fora das opções. */
import { describe, expect, it } from 'vitest';
import { compileOracleCard, type OracleInput } from '../src/cards/oracle-parser.js';
import { forest, grizzlyBears, island, lightningBolt, mountain, plains, swamp } from '../src/cards/demo-set.js';
import type { CardDefinition } from '../src/cards/types.js';
import type { Game } from '../src/game.js';
import type { PlayerId } from '../src/types.js';
import { viewFor } from '../src/view.js';
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
const cast = (game: Game, p: PlayerId, id: number, extra: Record<string, unknown> = {}) => game.apply(p, { type: 'castSpell', objectId: id, ...extra } as never);
const untilDecision = (game: Game) => passUntil(game, (s) => s.status === 'finished' || s.pendingDecision !== null || (s.stack.length === 0 && s.triggerQueue.length === 0));

const cantrip = mk({ name: 'Blue Cantrip', manaCost: '{U}', typeLine: 'Instant', colors: ['U'], oracleText: 'Draw a card.' });
const duress = mk({ name: 'Duress', manaCost: '{B}', typeLine: 'Sorcery', colors: ['B'], oracleText: 'Target opponent reveals their hand. You choose a noncreature, nonland card from it. That player discards that card.' });

describe('M48 · mão revelada inteira na decisão', () => {
  it('Duress: opções = não-criatura não-terreno; shown = o resto da mão; o oponente não vê nada', () => {
    const game = makeGame([...FILLER, duress], [...FILLER, lightningBolt, cantrip, grizzlyBears], { topP1: [duress.id], topP2: ['lightning-bolt', cantrip.id, 'grizzly-bears'] });
    goToMain1(game);
    put(game, 'p1', 'swamp');
    const bolt = findIn(game, 'p2', 'hand', 'lightning-bolt');
    const bears = findIn(game, 'p2', 'hand', 'grizzly-bears');
    const cant = findIn(game, 'p2', 'hand', cantrip.id);
    expect(cast(game, 'p1', findIn(game, 'p1', 'hand', duress.id), { targets: [{ kind: 'player', player: 'p2' }] }).ok).toBe(true);
    untilDecision(game);
    const pd = game.state.pendingDecision;
    expect(pd?.type).toBe('effectChoice');
    if (pd?.type !== 'effectChoice') return;
    expect(pd.player).toBe('p1');
    expect([...pd.options].sort()).toEqual([bolt, cant].sort());
    const hand = game.state.players.p2.zones.hand;
    expect(pd.shown).toEqual(hand.filter((id) => id !== bolt && id !== cant));
    expect(pd.shown).toContain(bears);
    expect(pd.shown!.length + pd.options.length).toBe(hand.length);
    // visão: quem decide vê as cartas; o dono da mão não recebe as opções nem as mostradas
    const v1 = viewFor(game.state, 'p1').pendingDecision;
    const v2 = viewFor(game.state, 'p2').pendingDecision;
    expect(v1?.type).toBe('effectChoice');
    if (v1?.type === 'effectChoice') { expect(v1.options?.length).toBe(2); expect(v1.shown?.length).toBe(hand.length - 2); }
    if (v2?.type === 'effectChoice') { expect(v2.options).toBeNull(); expect(v2.shown).toBeNull(); }
    // só a elegível pode ser escolhida
    expect(game.apply('p1', { type: 'effectChoice', picks: [bears] }).ok).toBe(false);
    expect(game.apply('p1', { type: 'effectChoice', picks: [bolt] }).ok).toBe(true);
    expect(game.state.objects[bolt].zone).toBe('graveyard');
  });
});
