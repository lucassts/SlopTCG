/** MF1: leva fácil — Craterhoof Behemoth, Koma World-Eater, Conjurer's Bauble. */
import { describe, expect, it } from 'vitest';
import { compileOracleCard, type OracleInput } from '../src/cards/oracle-parser.js';
import { forest, grizzlyBears, island, mountain, plains, swamp } from '../src/cards/demo-set.js';
import type { CardDefinition } from '../src/cards/types.js';
import type { Game } from '../src/game.js';
import type { PlayerId } from '../src/types.js';
import { effectivePower, effectiveToughness, hasKeyword } from '../src/state.js';
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

const craterhoof = mk({ name: 'Craterhoof Behemoth', manaCost: '{5}{G}{G}{G}', typeLine: 'Creature — Beast', power: 5, toughness: 5, colors: ['G'], oracleText: 'Haste\nWhen this creature enters, creatures you control gain trample and get +X/+X until end of turn, where X is the number of creatures you control.' });
const koma = mk({ name: 'Koma, World-Eater', manaCost: '{3}{G}{G}{U}{U}', typeLine: 'Legendary Creature — Serpent', power: 8, toughness: 12, colors: ['G', 'U'], oracleText: "This spell can't be countered.\nTrample, ward {4}\nWhenever Koma deals combat damage to a player, create four 3/3 blue Serpent creature tokens named Koma's Coil." });
const bauble = mk({ name: "Conjurer's Bauble", manaCost: '{1}', typeLine: 'Artifact', colors: [], oracleText: '{T}, Sacrifice this artifact: Put up to one target card from your graveyard on the bottom of your library. Draw a card.' });

describe('MF1 · compilação', () => {
  it('Craterhoof Behemoth: full, ETB com forEach + pump dinâmico', () => {
    expect(craterhoof.automation).toBe('full');
    const trig = craterhoof.abilities.find((a) => a.kind === 'triggered');
    expect(trig).toBeDefined();
    expect(trig!.effect).toEqual([
      {
        op: 'forEach',
        filter: { what: 'creature', controlledBy: 'you' },
        effect: [{ op: 'pump', what: 'iter', power: 0, toughness: 0, powerDyn: { per: { what: 'creature', controlledBy: 'you' } }, toughnessDyn: { per: { what: 'creature', controlledBy: 'you' } }, keywords: ['trample'] }],
      },
    ]);
  });

  it('Koma, World-Eater: full, ficha com o nome derivado do nome da carta', () => {
    expect(koma.automation).toBe('full');
    const trig = koma.abilities.find((a) => a.kind === 'triggered');
    expect(trig!.trigger).toEqual({ on: 'combatDamageToPlayer', self: true });
    expect(trig!.effect).toEqual([{ op: 'token', who: 'controller', count: 4, name: "Koma's Coil", power: 3, toughness: 3, colors: ['U'], subtypes: ['Serpent'] }]);
  });

  it("Conjurer's Bauble: full, {T}+sacrifício, alvo opcional no cemitério", () => {
    expect(bauble.automation).toBe('full');
    const act = bauble.abilities.find((a) => a.kind === 'activated');
    expect(act!.cost).toEqual({ tap: true, sacrificeSelf: true });
    expect(act!.targets).toEqual([{ what: 'card', zone: 'graveyard', ownedBy: 'you', optional: true }]);
    expect(act!.effect).toEqual([{ op: 'putOnLibraryBottom', what: 'target:0' }, { op: 'draw', who: 'controller', count: 1 }]);
  });
});

describe('MF1 · comportamento', () => {
  it('Craterhoof: com três criaturas em jogo, todas ficam +3/+3 e com atropelar', () => {
    const game = makeGame([...FILLER, craterhoof, ...copies(grizzlyBears, 2)], FILLER, { topP1: [craterhoof.id, 'grizzly-bears', 'grizzly-bears'] });
    goToMain1(game);
    const b1 = put(game, 'p1', 'grizzly-bears');
    const b2 = put(game, 'p1', 'grizzly-bears');
    for (let i = 0; i < 6; i++) put(game, 'p1', 'forest');
    for (let i = 0; i < 2; i++) put(game, 'p1', 'island');
    const hand = findIn(game, 'p1', 'hand', craterhoof.id);
    expect(game.apply('p1', { type: 'castSpell', objectId: hand } as never).ok).toBe(true);
    settle(game);
    const hoof = hand;
    expect(game.state.objects[hoof].zone).toBe('battlefield');
    for (const id of [b1, b2]) {
      expect(effectivePower(game.state, game.state.objects[id])).toBe(5);
      expect(effectiveToughness(game.state, game.state.objects[id])).toBe(5);
      expect(hasKeyword(game.state, game.state.objects[id], 'trample')).toBe(true);
    }
    expect(effectivePower(game.state, game.state.objects[hoof])).toBe(8);
    expect(effectiveToughness(game.state, game.state.objects[hoof])).toBe(8);
  });

  it("Conjurer's Bauble: manda a carta escolhida do cemitério para o fundo do grimório e compra", () => {
    const game = makeGame([...FILLER, bauble], FILLER, { topP1: [bauble.id] });
    goToMain1(game);
    const b = put(game, 'p1', bauble.id);
    const dead = put(game, 'p1', 'mountain', 'graveyard');
    const handBefore = game.state.players.p1.zones.hand.length;
    const libBefore = game.state.players.p1.zones.library.length;
    const r = game.apply('p1', { type: 'activateAbility', objectId: b, abilityIndex: 0, targets: [{ kind: 'object', id: dead }] } as never);
    expect(r.ok).toBe(true);
    settle(game);
    expect(game.state.objects[dead].zone).toBe('library');
    expect(game.state.players.p1.zones.library[game.state.players.p1.zones.library.length - 1]).toBe(dead);
    expect(game.state.objects[b].zone).toBe('graveyard');
    expect(game.state.players.p1.zones.hand.length).toBe(handBefore + 1);
    expect(game.state.players.p1.zones.library.length).toBe(libBefore); // +1 do cemitério, -1 da compra
  });
});
