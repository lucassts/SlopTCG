/** MF2: leva fácil — Runehorn Hellkite, Firemind's Foresight, Parallax Wave, Jack-o'-Lantern, Lavaspur Boots. */
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
const FILLER = [...copies(mountain, 8), ...copies(forest, 6), ...copies(island, 6), ...copies(plains, 6), ...copies(swamp, 4)];
const settle = (game: Game) => passUntil(game, (s) => s.status === 'finished' || (s.stack.length === 0 && s.triggerQueue.length === 0 && s.pendingDecision === null));

const runehorn = mk({ name: 'Runehorn Hellkite', manaCost: '{5}{R}', typeLine: 'Creature — Dragon', power: 5, toughness: 5, colors: ['R'], oracleText: 'Flying\n{5}{R}, Exile this card from your graveyard: Each player discards their hand, then draws seven cards.' });
const foresight = mk({ name: "Firemind's Foresight", manaCost: '{5}{U}{R}', typeLine: 'Instant', colors: ['U', 'R'], oracleText: 'Search your library for an instant card with mana value 3, reveal it, and put it into your hand. Then repeat this process for instant cards with mana values 2 and 1. Then shuffle.' });
const wave = mk({ name: 'Parallax Wave', manaCost: '{2}{W}{W}', typeLine: 'Enchantment', colors: ['W'], oracleText: 'Fading 5\nRemove a fade counter from this enchantment: Exile target creature.\nWhen this enchantment leaves the battlefield, each player returns to the battlefield all cards they own exiled with it.' });
const lantern = mk({ name: "Jack-o'-Lantern", manaCost: '{1}', typeLine: 'Artifact', colors: [], oracleText: '{1}, {T}, Sacrifice this artifact: Exile up to one target card from a graveyard. Draw a card.\n{1}, Exile this card from your graveyard: Add one mana of any color.' });
const boots = mk({ name: 'Lavaspur Boots', manaCost: '{1}', typeLine: 'Artifact — Equipment', colors: [], oracleText: 'Equipped creature gets +1/+0 and has haste and ward {1}.\nEquip {1}' });
const loran = mk({ name: 'Loran of the Third Path', manaCost: '{2}{W}', typeLine: 'Legendary Creature — Human Artificer', power: 2, toughness: 1, colors: ['W'], oracleText: 'Vigilance\nWhen Loran enters, destroy up to one target artifact or enchantment.\n{T}: You and target opponent each draw a card.' });
const leveler = mk({ name: 'Cityscape Leveler', manaCost: '{8}', typeLine: 'Artifact Creature — Construct', power: 8, toughness: 8, colors: [], oracleText: 'Trample\nWhen you cast this spell and whenever this creature attacks, destroy up to one target nonland permanent. Its controller creates a tapped Powerstone token.\nUnearth {8}' });
const disenchant = mk({ name: 'Test Disenchant', manaCost: '{1}{W}', typeLine: 'Instant', colors: ['W'], oracleText: 'Destroy target artifact or enchantment.' });

describe('MF2 · compilação', () => {
  it('Runehorn Hellkite: full, habilidade do cemitério que exila a própria carta', () => {
    expect(runehorn.automation).toBe('full');
    const act = runehorn.abilities.find((a) => a.kind === 'activated');
    expect(act!.zone).toBe('graveyard');
    expect(act!.exileSelf).toBe(true);
    expect(act!.cost).toEqual({ mana: '{5}{R}' });
    expect(act!.effect).toEqual([{ op: 'discardHand', who: 'each' }, { op: 'draw', who: 'each', count: 7 }]);
  });

  it("Firemind's Foresight: full, três buscas por valor de mana exato", () => {
    expect(foresight.automation).toBe('full');
    expect(foresight.spellEffect).toEqual([
      { op: 'search', filter: { what: 'instant', cmcEquals: 3 }, count: 1, to: 'hand' },
      { op: 'search', filter: { what: 'instant', cmcEquals: 2 }, count: 1, to: 'hand' },
      { op: 'search', filter: { what: 'instant', cmcEquals: 1 }, count: 1, to: 'hand' },
    ]);
  });

  it('Parallax Wave: full, gatilho de saída devolve o que ela exilou', () => {
    expect(wave.automation).toBe('full');
    const trig = wave.abilities.find((a) => a.kind === 'triggered' && a.trigger.on === 'leaves');
    expect(trig!.effect).toEqual([{ op: 'returnExiledBy', to: 'battlefield' }]);
  });

  it("Jack-o'-Lantern: full, habilidade de mana do cemitério", () => {
    expect(lantern.automation).toBe('full');
    const gy = lantern.abilities.find((a) => a.kind === 'activated' && a.zone === 'graveyard');
    expect(gy!.exileSelf).toBe(true);
    expect(gy!.isManaAbility).toBe(true);
    expect(gy!.cost).toEqual({ mana: '{1}' });
    expect(gy!.effect).toEqual([{ op: 'addManaChoice', who: 'controller' }]);
  });

  it('Loran of the Third Path: full — o nome curto da lendária vira ~ e as duas habilidades compilam', () => {
    expect(loran.automation).toBe('full');
    const etb = loran.abilities.find((a) => a.kind === 'triggered');
    expect(etb!.targets).toEqual([{ what: 'permanent', typeAnyOf: ['Artifact', 'Enchantment'], optional: true }]);
    expect(etb!.effect).toEqual([{ op: 'destroy', what: 'target:0' }]);
    const act = loran.abilities.find((a) => a.kind === 'activated');
    expect(act!.cost).toEqual({ tap: true });
    expect(act!.targets).toEqual([{ what: 'player', controlledBy: 'opponent' }]);
    expect(act!.effect).toEqual([{ op: 'draw', who: 'controller', count: 1 }, { op: 'draw', who: 'target:0', count: 1 }]);
  });

  it('Lavaspur Boots: full, +1/+0, haste e ward {1} para a criatura equipada', () => {
    expect(boots.automation).toBe('full');
    expect(boots.attachEffect).toMatchObject({ power: 1, toughness: 0, keywords: ['haste'], ward: 1 });
  });

  it('Cityscape Leveler: full — "quando conjurar E sempre que atacar" vira dois gatilhos com o mesmo corpo', () => {
    expect(leveler.automation).toBe('full');
    const trigs = leveler.abilities.filter((a) => a.kind === 'triggered');
    expect(trigs.map((t) => t.trigger.on).sort()).toEqual(['attacks', 'youCastThis']);
    for (const t of trigs) {
      expect(t.targets).toEqual([{ what: 'permanent', typeAnyOf: ['Creature', 'Artifact', 'Enchantment', 'Planeswalker'], optional: true }]);
      expect(t.effect).toEqual([
        { op: 'destroy', what: 'target:0' },
        { op: 'namedToken', who: 'controllerOf:0', kind: 'Powerstone', count: 1, tapped: true },
      ]);
    }
  });
});

describe('MF2 · comportamento', () => {
  it('Runehorn Hellkite: do cemitério, cada jogador descarta a mão e compra sete', () => {
    const game = makeGame([...FILLER, runehorn], FILLER, { topP1: [runehorn.id] });
    goToMain1(game);
    const hell = put(game, 'p1', runehorn.id, 'graveyard');
    for (let i = 0; i < 6; i++) put(game, 'p1', 'mountain');
    const idx = runehorn.abilities.findIndex((a) => a.kind === 'activated');
    expect(game.apply('p1', { type: 'activateAbility', objectId: hell, abilityIndex: idx, targets: [] } as never).ok).toBe(true);
    settle(game);
    expect(game.state.objects[hell].zone).toBe('exile');
    expect(game.state.players.p1.zones.hand.length).toBe(7);
    expect(game.state.players.p2.zones.hand.length).toBe(7);
  });

  it('Parallax Wave: a criatura exilada volta ao campo quando a Wave sai', () => {
    const game = makeGame([...FILLER, wave, disenchant], [...FILLER, grizzlyBears], { topP1: [wave.id, disenchant.id], topP2: ['grizzly-bears'] });
    goToMain1(game);
    const bear = put(game, 'p2', 'grizzly-bears');
    const w = put(game, 'p1', wave.id);
    game.state.objects[w].counters.fade = 5;
    for (let i = 0; i < 2; i++) put(game, 'p1', 'plains');
    const exileIdx = wave.abilities.findIndex((a) => a.kind === 'activated');
    expect(game.apply('p1', { type: 'activateAbility', objectId: w, abilityIndex: exileIdx, targets: [{ kind: 'object', id: bear }] } as never).ok).toBe(true);
    settle(game);
    expect(game.state.objects[bear].zone).toBe('exile');
    const dis = findIn(game, 'p1', 'hand', disenchant.id);
    expect(game.apply('p1', { type: 'castSpell', objectId: dis, targets: [{ kind: 'object', id: w }] } as never).ok).toBe(true);
    settle(game);
    expect(game.state.objects[w].zone).toBe('graveyard');
    expect(game.state.objects[bear].zone).toBe('battlefield');
    expect(game.state.objects[bear].controller).toBe('p2');
  });
});
