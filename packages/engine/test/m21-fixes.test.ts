/** M21: correções reportadas em jogo — Urza's Saga (habilidades concedidas por capítulo, sacrifício após o último), Doomsday, contador de tempestade na view. */
import { describe, expect, it } from 'vitest';
import { compileOracleCard, type OracleInput } from '../src/cards/oracle-parser.js';
import { forest, grizzlyBears, island, mountain, plains, swamp } from '../src/cards/demo-set.js';
import type { CardDefinition } from '../src/cards/types.js';
import type { Game } from '../src/game.js';
import type { PlayerId } from '../src/types.js';
import { effectivePower } from '../src/state.js';
import { viewFor } from '../src/view.js';
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
const settle = (game: Game) => passUntil(game, (s) => s.stack.length === 0 && s.triggerQueue.length === 0 && s.pendingDecision === null);
const cast = (game: Game, p: PlayerId, id: number, extra: Record<string, unknown> = {}) => game.apply(p, { type: 'castSpell', objectId: id, ...extra } as never);
const toMain1Turn = (game: Game, turn: number, p: PlayerId = 'p1') => passUntil(game, (s) => s.turn === turn && s.step === 'main1' && s.priority === p && s.stack.length === 0 && s.pendingDecision === null);
const untilChoice = (game: Game) => passUntil(game, (s) => s.pendingDecision?.type === 'effectChoice' || (s.stack.length === 0 && s.triggerQueue.length === 0 && s.pendingDecision === null));

const urzasSaga = mk({
  name: "Urza's Saga", typeLine: "Enchantment Land — Urza's Saga",
  oracleText: "(As this Saga enters and after your draw step, add a lore counter. Sacrifice after III.)\nI — This Saga gains \"{T}: Add {C}.\"\nII — This Saga gains \"{2}, {T}: Create a 0/0 colorless Construct artifact creature token with 'This token gets +1/+1 for each artifact you control.'\"\nIII — Search your library for an artifact card with mana cost {0} or {1}, put it onto the battlefield, then shuffle.",
});
const ornithopter = mk({ name: 'Ornithopter', manaCost: '{0}', typeLine: 'Artifact Creature — Thopter', power: 0, toughness: 2, colors: [], oracleText: 'Flying' });
const doomsday = mk({ name: 'Doomsday', manaCost: '{B}{B}{B}', typeLine: 'Sorcery', colors: ['B'], oracleText: 'Search your library and graveyard for five cards and exile the rest. Put the chosen cards on top of your library in any order. You lose half your life, rounded up.' });

describe('M21 · compilação', () => {
  it("Urza's Saga e Doomsday compilam como full", () => {
    expect(urzasSaga.automation, urzasSaga.automationNotes?.join(' | ')).toBe('full');
    expect(urzasSaga.saga).toEqual({ chapters: 3 });
    expect(urzasSaga.abilities?.[0]).toMatchObject({ trigger: { on: 'chapter', chapters: [1] }, effect: [{ op: 'grantAbility', what: 'self' }] });
    const ch2 = urzasSaga.abilities?.[1];
    expect(ch2?.effect[0]).toMatchObject({ op: 'grantAbility' });
    const granted = (ch2?.effect[0] as { abilities: CardDefinition['abilities'] }).abilities?.[0];
    expect(granted).toMatchObject({ kind: 'activated', cost: { mana: '{2}', tap: true } });
    expect((granted as { effect: { op: string; abilities?: unknown[] }[] }).effect[0]).toMatchObject({ op: 'token', abilities: [{ kind: 'static', selfOnly: true }] });
    expect(urzasSaga.abilities?.[2].effect[0]).toMatchObject({ op: 'search', filter: { what: 'artifact', manaCostIn: ['{0}', '{1}'] }, to: 'battlefield' });
    expect(doomsday.automation).toBe('full');
    expect(doomsday.spellEffect).toEqual([{ op: 'doomsday', count: 5 }, { op: 'loseLife', who: 'controller', amount: { halfLifeOf: 'controller', round: 'up' } }]);
  });
});

describe("M21 · Urza's Saga", () => {
  it('ganha as habilidades dos capítulos I e II, busca no III e é sacrificada', () => {
    const game = makeGame([...FILLER, urzasSaga, ornithopter], FILLER, { topP1: [urzasSaga.id, ornithopter.id] });
    goToMain1(game);
    // O Ornithopter fica na biblioteca para a busca do capítulo III.
    const thopter = findIn(game, 'p1', 'hand', ornithopter.id);
    game.apply('p1', { type: 'manualMove', objectId: thopter, to: 'library', position: 'bottom' });
    const saga = findIn(game, 'p1', 'hand', urzasSaga.id);
    expect(game.apply('p1', { type: 'playLand', objectId: saga }).ok).toBe(true);
    settle(game);
    const o = game.state.objects[saga];
    expect(o.counters['lore']).toBe(1);
    expect(o.card.abilities?.some((a) => a.kind === 'activated' && a.isManaAbility)).toBe(true);
    const manaIdx = o.card.abilities!.findIndex((a) => a.kind === 'activated' && a.isManaAbility);
    expect(game.apply('p1', { type: 'activateAbility', objectId: saga, abilityIndex: manaIdx }).ok).toBe(true);
    expect(game.state.players.p1.manaPool.C).toBe(1);
    // Capítulo II no turno 3.
    toMain1Turn(game, 3);
    settle(game);
    expect(o.counters['lore']).toBe(2);
    const tokIdx = o.card.abilities!.findIndex((a) => a.kind === 'activated' && !a.isManaAbility);
    expect(tokIdx).toBeGreaterThanOrEqual(0);
    put(game, 'p1', 'forest'); put(game, 'p1', 'forest');
    expect(game.apply('p1', { type: 'activateAbility', objectId: saga, abilityIndex: tokIdx }).ok).toBe(true);
    settle(game);
    const construct = game.state.players.p1.zones.battlefield.map((id) => game.state.objects[id]).find((c) => c.isToken && c.card.name === 'Construct');
    expect(construct).toBeDefined();
    expect(effectivePower(game.state, construct!)).toBe(1); // conta a si mesmo
    // Capítulo III no turno 5: busca o artefato de custo {0} e a Saga é sacrificada.
    passUntil(game, (s) => s.pendingDecision?.type === 'effectChoice', 200);
    expect(game.state.turn).toBe(5);
    const pd = game.state.pendingDecision;
    expect(pd?.type).toBe('effectChoice');
    if (pd?.type === 'effectChoice') {
      expect(pd.options).toContain(thopter);
      game.apply('p1', { type: 'effectChoice', picks: [thopter] });
    }
    settle(game);
    expect(game.state.objects[thopter].zone).toBe('battlefield');
    expect(o.zone).toBe('graveyard');
    expect(o.card.abilities?.length ?? 0).toBe(3); // habilidades concedidas somem ao sair
    expect(effectivePower(game.state, construct!)).toBe(2); // Ornithopter também é artefato
  });
});

describe('M21 · Doomsday e tempestade', () => {
  it('Doomsday: cinco cartas no topo na ordem escolhida, resto exilado, metade da vida', () => {
    const game = makeGame([...FILLER, doomsday, grizzlyBears], FILLER, { topP1: [doomsday.id, 'grizzly-bears'] });
    goToMain1(game);
    const bears = put(game, 'p1', 'grizzly-bears', 'graveyard');
    put(game, 'p1', 'swamp'); put(game, 'p1', 'swamp'); put(game, 'p1', 'swamp');
    expect(cast(game, 'p1', findIn(game, 'p1', 'hand', doomsday.id)).ok).toBe(true);
    untilChoice(game);
    const pd = game.state.pendingDecision;
    expect(pd?.type).toBe('effectChoice');
    if (pd?.type !== 'effectChoice') return;
    const lib = game.state.players.p1.zones.library;
    const picks = [bears, lib[3], lib[0], lib[7], lib[1]];
    expect(game.apply('p1', { type: 'effectChoice', picks }).ok).toBe(true);
    settle(game);
    expect(game.state.players.p1.zones.library).toEqual(picks);
    expect(game.state.players.p1.zones.graveyard.filter((id) => id !== findIn(game, 'p1', 'graveyard', doomsday.id))).toEqual([]);
    expect(game.state.players.p1.life).toBe(10);
  });

  it('a view expõe as mágicas conjuradas no turno', () => {
    const game = makeGame([...FILLER, doomsday], FILLER, { topP1: [doomsday.id] });
    goToMain1(game);
    expect(viewFor(game.state, 'p1').spellsCastThisTurn).toBe(0);
  });
});
