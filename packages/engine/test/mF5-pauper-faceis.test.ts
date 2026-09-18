/** MF5: leva fácil (pauper, 3ª) — Refurbished Familiar, Cast into the Fire, Temur Battle Rage. */
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
const FILLER = [...copies(mountain, 8), ...copies(forest, 6), ...copies(island, 6), ...copies(plains, 6), ...copies(swamp, 6)];
const settle = (game: Game) => passUntil(game, (s) => s.status === 'finished' || (s.stack.length === 0 && s.triggerQueue.length === 0 && s.pendingDecision === null));

const familiar = mk({ name: 'Refurbished Familiar', manaCost: '{3}{B}', typeLine: 'Artifact Creature — Zombie Rat', power: 3, toughness: 2, colors: ['B'], oracleText: "Affinity for artifacts\nFlying\nWhen this creature enters, each opponent discards a card. For each opponent who can't, you draw a card." });
const castFire = mk({ name: 'Cast into the Fire', manaCost: '{1}{R}', typeLine: 'Instant', colors: ['R'], oracleText: 'Choose one —\n• Cast into the Fire deals 1 damage to each of up to two target creatures.\n• Exile target artifact.' });
const battleRage = mk({ name: 'Temur Battle Rage', manaCost: '{1}{R}', typeLine: 'Instant', colors: ['R'], oracleText: 'Target creature gains double strike until end of turn.\nFerocious — That creature also gains trample until end of turn if you control a creature with power 4 or greater.' });

describe('MF5 · compilação (pauper, 3ª)', () => {
  it('Refurbished Familiar: numa partida de dois, "quem não puder descartar" é mão vazia', () => {
    expect(familiar.automation).toBe('full');
    const t = familiar.abilities.find((a) => a.kind === 'triggered');
    expect(t!.effect).toEqual([{
      op: 'if',
      cond: { kind: 'compare', left: { handSize: 'opponent' }, cmp: 'eq', right: 0 },
      then: [{ op: 'draw', who: 'controller', count: 1 }],
      else: [{ op: 'discard', who: 'opponent', count: 1 }],
    }]);
  });

  it('Cast into the Fire: o modo com "até duas criaturas alvo" vira dois alvos opcionais', () => {
    expect(castFire.automation).toBe('full');
    const mode = castFire.spellModes!.find((x) => x.label.includes('damage'));
    expect(mode!.targets).toEqual([{ what: 'creature', optional: true }, { what: 'creature', optional: true }]);
    expect(mode!.effect).toEqual([{ op: 'damage', to: 'target:0', amount: 1 }, { op: 'damage', to: 'target:1', amount: 1 }]);
  });

  it('Temur Battle Rage: a segunda linha reaproveita o alvo da primeira, sob condição', () => {
    expect(battleRage.automation).toBe('full');
    expect(battleRage.spellTargets).toEqual([{ what: 'creature' }]);
    expect(battleRage.spellEffect).toEqual([
      { op: 'pump', what: 'target:0', power: 0, toughness: 0, keywords: ['doubleStrike'] },
      {
        op: 'if',
        cond: { kind: 'controlsAtLeast', count: 1, filter: { what: 'creature', controlledBy: 'you', powerAtLeast: 4 } },
        then: [{ op: 'pump', what: 'target:0', power: 0, toughness: 0, keywords: ['trample'] }],
      },
    ]);
  });
});

describe('MF5 · comportamento (pauper, 3ª)', () => {
  it('Refurbished Familiar: com a mão do oponente vazia, você compra em vez de nada acontecer', () => {
    const game = makeGame([...FILLER, familiar], FILLER, { topP1: [familiar.id] });
    goToMain1(game);
    // esvazia a mão do oponente
    for (const id of [...game.state.players.p2.zones.hand]) game.apply('p2', { type: 'manualMove', objectId: id, to: 'graveyard' });
    expect(game.state.players.p2.zones.hand.length).toBe(0);
    for (let i = 0; i < 4; i++) put(game, 'p1', 'swamp');
    const hand = findIn(game, 'p1', 'hand', familiar.id);
    const before = game.state.players.p1.zones.hand.length;
    expect(game.apply('p1', { type: 'castSpell', objectId: hand } as never).ok).toBe(true);
    settle(game);
    // -1 (o próprio Familiar saiu da mão) +1 (compra do gatilho)
    expect(game.state.players.p1.zones.hand.length).toBe(before);
    expect(game.state.players.p2.zones.hand.length).toBe(0);
  });

  it('Refurbished Familiar: com carta na mão, o oponente descarta e você não compra', () => {
    const game = makeGame([...FILLER, familiar], FILLER, { topP1: [familiar.id] });
    goToMain1(game);
    for (let i = 0; i < 4; i++) put(game, 'p1', 'swamp');
    const oppBefore = game.state.players.p2.zones.hand.length;
    expect(oppBefore).toBeGreaterThan(0);
    const hand = findIn(game, 'p1', 'hand', familiar.id);
    const before = game.state.players.p1.zones.hand.length;
    expect(game.apply('p1', { type: 'castSpell', objectId: hand } as never).ok).toBe(true);
    // o descarte é uma escolha do oponente: responde antes de deixar a partida seguir.
    passUntil(game, (st) => st.pendingDecision !== null);
    const pd = game.state.pendingDecision as { player: PlayerId; options?: number[] };
    expect(game.apply(pd.player, { type: 'effectChoice', picks: [(pd.options ?? [])[0]] } as never).ok).toBe(true);
    settle(game);
    expect(game.state.players.p2.zones.hand.length).toBe(oppBefore - 1);
    expect(game.state.players.p1.zones.hand.length).toBe(before - 1);
  });

  it('Temur Battle Rage: sem criatura de poder 4, só o golpe duplo', () => {
    const game = makeGame([...FILLER, battleRage, grizzlyBears], FILLER, { topP1: [battleRage.id, 'grizzly-bears'] });
    goToMain1(game);
    const bear = put(game, 'p1', 'grizzly-bears');
    for (let i = 0; i < 2; i++) put(game, 'p1', 'mountain');
    const hand = findIn(game, 'p1', 'hand', battleRage.id);
    expect(game.apply('p1', { type: 'castSpell', objectId: hand, targets: [{ kind: 'object', id: bear }] } as never).ok).toBe(true);
    settle(game);
    const o = game.state.objects[bear];
    expect(o.untilEot.keywords).toContain('doubleStrike');
    expect(o.untilEot.keywords).not.toContain('trample');
  });
});
