/** M47: Cavern of Souls (mana marcada: só criatura do tipo escolhido, não anulável) + custo de cemitério escolhido pelo jogador + mana manual em virar para cima. */
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
const lands = (game: Game, p: PlayerId, ...ids: string[]) => { for (const id of ids) put(game, p, id); };

const cavern = mk({ name: 'Cavern of Souls', typeLine: 'Land', colors: [], oracleText: "As this land enters, choose a creature type.\n{T}: Add {C}.\n{T}: Add one mana of any color. Spend this mana only to cast a creature spell of the chosen type, and that spell can't be countered." });
const oracle = mk({ name: "Thassa's Oracle", manaCost: '{U}{U}', typeLine: 'Creature — Merfolk Wizard', power: 1, toughness: 3, colors: ['U'], oracleText: '' });
const counterspell = mk({ name: 'Counterspell', manaCost: '{U}{U}', typeLine: 'Instant', colors: ['U'], oracleText: 'Counter target spell.' });
const cantrip = mk({ name: 'Blue Cantrip', manaCost: '{U}', typeLine: 'Instant', colors: ['U'], oracleText: 'Draw a card.' });
const gyAbility = mk({ name: 'Grave Tinkerer', manaCost: '{1}', typeLine: 'Artifact', colors: [], oracleText: 'Exile two cards from your graveyard: You gain 2 life.' });

/** Cavern no campo com o tipo escolhido, e a mana marcada já flutuando. */
const withCavern = (game: Game, type: string) => {
  const cv = put(game, 'p1', cavern.id);
  game.state.objects[cv].chosenType = type;
  const idx = cavern.abilities!.findIndex((ab) => ab.kind === 'activated' && ab.effect.some((e) => e.op === 'addManaChoice'));
  expect(game.apply('p1', { type: 'activateAbility', objectId: cv, abilityIndex: idx, manaColor: 'U' }).ok).toBe(true);
  expect(game.state.players.p1.manaPool.U).toBe(1);
  expect(game.state.players.p1.manaTagged).toEqual([{ sym: 'U', creatureType: type, source: 'Cavern of Souls' }]);
  return cv;
};

describe('M47 · Cavern of Souls e escolhas de cemitério', () => {
  it('compila full e a habilidade marca a mana', () => {
    expect(cavern.automation, cavern.automationNotes?.join(' | ')).toBe('full');
    expect(cavern.abilities!.some((ab) => ab.kind === 'activated' && ab.effect.some((e) => e.op === 'addManaChoice' && e.cavern))).toBe(true);
  });

  it('mana marcada Wizard paga Thassa\'s Oracle, que fica não anulável', () => {
    const game = makeGame([...FILLER, cavern, oracle], [...FILLER, counterspell], { topP1: [cavern.id, oracle.id], topP2: [counterspell.id] });
    goToMain1(game);
    withCavern(game, 'Wizard');
    lands(game, 'p1', 'island');
    lands(game, 'p2', 'island', 'island');
    const o = findIn(game, 'p1', 'hand', oracle.id);
    expect(cast(game, 'p1', o).ok).toBe(true);
    expect(game.state.players.p1.manaTagged).toBeUndefined(); // a mana marcada foi gasta
    expect(game.state.objects[o].uncounterable).toBe(true);
    passUntil(game, (s) => s.priority === 'p2', 10);
    expect(cast(game, 'p2', findIn(game, 'p2', 'hand', counterspell.id), { targets: [{ kind: 'object', id: o }] }).ok).toBe(true);
    settle(game);
    expect(game.state.objects[o].zone).toBe('battlefield');
  });

  it('mana marcada não paga instantâneo: com só ela na pool, falha; com Island, gasta a Island e a marcada continua flutuando', () => {
    const game = makeGame([...FILLER, cavern, cantrip], FILLER, { topP1: [cavern.id, cantrip.id] });
    goToMain1(game);
    withCavern(game, 'Wizard');
    const c = findIn(game, 'p1', 'hand', cantrip.id);
    expect(cast(game, 'p1', c).ok).toBe(false);
    const isl = put(game, 'p1', 'island');
    expect(cast(game, 'p1', c).ok).toBe(true);
    settle(game);
    expect(game.state.objects[isl].tapped).toBe(true);
    expect(game.state.players.p1.manaTagged).toHaveLength(1); // a da Cavern ficou
    expect(game.state.players.p1.manaPool.U).toBe(1);
  });

  it('mana marcada de outro tipo não paga a criatura', () => {
    const game = makeGame([...FILLER, cavern, oracle], FILLER, { topP1: [cavern.id, oracle.id] });
    goToMain1(game);
    withCavern(game, 'Elf');
    lands(game, 'p1', 'island');
    const o = findIn(game, 'p1', 'hand', oracle.id);
    expect(cast(game, 'p1', o).ok).toBe(false); // {U}{U}: só uma Island utilizável
  });

  it('a mana marcada some com o pool no fim da etapa', () => {
    const game = makeGame([...FILLER, cavern], FILLER, { topP1: [cavern.id] });
    goToMain1(game);
    withCavern(game, 'Wizard');
    passUntil(game, (s) => s.step === 'combatBegin', 20);
    expect(game.state.players.p1.manaTagged).toBeUndefined();
    expect(game.state.players.p1.manaPool.U).toBe(0);
  });

  it('custo "exile N cards from your graveyard": as cartas dadas pelo jogador são as exiladas', () => {
    const game = makeGame([...FILLER, gyAbility], FILLER, { topP1: [gyAbility.id] });
    goToMain1(game);
    const a = put(game, 'p1', gyAbility.id);
    const gy = ['mountain', 'forest', 'plains', 'swamp'].map((l) => put(game, 'p1', l, 'graveyard'));
    expect(game.apply('p1', { type: 'activateAbility', objectId: a, abilityIndex: 0, gyExile: [gy[2], gy[3]] }).ok).toBe(true);
    settle(game);
    expect(game.state.objects[gy[2]].zone).toBe('exile');
    expect(game.state.objects[gy[3]].zone).toBe('exile');
    expect(game.state.objects[gy[0]].zone).toBe('graveyard');
    expect(game.state.players.p1.life).toBe(22);
    expect(game.apply('p1', { type: 'activateAbility', objectId: a, abilityIndex: 0, gyExile: [gy[0]] }).ok).toBe(false); // uma só
    expect(game.apply('p1', { type: 'activateAbility', objectId: a, abilityIndex: 0, gyExile: [gy[0], gy[2]] }).ok).toBe(false); // já exilada
  });

  it('mana manual: virar para cima pede pagamento em vez de virar terrenos sozinho', () => {
    const morph = mk({ name: 'Morph Bear', manaCost: '{2}{G}', typeLine: 'Creature — Bear', power: 3, toughness: 3, colors: ['G'], oracleText: 'Morph {1}{G}' });
    const game = new Game([{ id: 'p1', name: 'Alice', deck: { cards: [...FILLER, morph] } }, { id: 'p2', name: 'Bob', deck: { cards: FILLER } }], 42, { firstPlayer: 'p1', manualMana: true });
    game.start();
    game.apply('p1', { type: 'keepHand', bottom: [] });
    game.apply('p2', { type: 'keepHand', bottom: [] });
    goToMain1(game);
    const m = put(game, 'p1', morph.id);
    game.state.objects[m].faceDown = true;
    const f1 = put(game, 'p1', 'forest'); put(game, 'p1', 'forest');
    expect(game.apply('p1', { type: 'turnFaceUp', objectId: m }).ok).toBe(true);
    expect(game.state.pendingPayment?.cost).toBe('{1}{G}');
    expect(game.state.objects[f1].tapped).toBe(false); // nada virado sozinho
    expect(game.state.objects[m].faceDown).toBe(true);
  });
});
