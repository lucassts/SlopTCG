/** MF4: leva fácil (pauper, 2ª leva) — 22 lacunas do meta Pauper. */
import { describe, expect, it } from 'vitest';
import { compileOracleCard, type OracleInput } from '../src/cards/oracle-parser.js';
import { forest, grizzlyBears, island, mountain, plains, swamp } from '../src/cards/demo-set.js';
import type { CardDefinition } from '../src/cards/types.js';
import type { Game } from '../src/game.js';
import type { PlayerId } from '../src/types.js';
import { effectivePower, effectiveToughness } from '../src/state.js';
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

const faithful = mk({ name: "God-Pharaoh's Faithful", manaCost: '{1}{W}', typeLine: 'Creature — Human Soldier', power: 0, toughness: 4, colors: ['W'], oracleText: 'Whenever you cast a blue, black, or red spell, you gain 1 life.' });
const sunscape = mk({ name: 'Sunscape Familiar', manaCost: '{1}{U}', typeLine: 'Creature — Bird Wizard', power: 1, toughness: 3, colors: ['U'], oracleText: 'Green spells and blue spells you cast cost {1} less to cast.' });
const anarcho = mk({ name: 'Goblin Anarchomancer', manaCost: '{R/G}{R/G}', typeLine: 'Creature — Goblin Shaman', power: 2, toughness: 2, colors: ['R', 'G'], oracleText: "Each spell you cast that's red or green costs {1} less to cast." });
const pledge = mk({ name: "Guardians' Pledge", manaCost: '{1}{W}', typeLine: 'Instant', colors: ['W'], oracleText: 'White creatures you control get +2/+2 until end of turn.' });
const holyLight = mk({ name: 'Holy Light', manaCost: '{1}{W}', typeLine: 'Instant', colors: ['W'], oracleText: 'Nonwhite creatures get -1/-1 until end of turn.' });
const seaGate = mk({ name: 'Sea Gate Oracle', manaCost: '{2}{U}', typeLine: 'Creature — Human Wizard', power: 1, toughness: 3, colors: ['U'], oracleText: 'When this creature enters, look at the top two cards of your library. Put one of them into your hand and the other on the bottom of your library.' });
const wisdom = mk({ name: 'Words of Wisdom', manaCost: '{1}{U}', typeLine: 'Instant', colors: ['U'], oracleText: 'You draw two cards, then each other player draws a card.' });
const lifestaff = mk({ name: 'Sylvok Lifestaff', manaCost: '{1}', typeLine: 'Artifact — Equipment', colors: [], oracleText: 'Whenever equipped creature dies, you gain 3 life.\nEquip {1}' });
const insight = mk({ name: "Kruphix's Insight", manaCost: '{2}{G}', typeLine: 'Sorcery', colors: ['G'], oracleText: 'Reveal the top six cards of your library. Put up to three enchantment cards from among them into your hand and the rest of the revealed cards into your graveyard.' });
const flicker = mk({ name: 'Ghostly Flicker', manaCost: '{2}{U}', typeLine: 'Instant', colors: ['U'], oracleText: 'Exile two target artifacts, creatures, or lands you control, then return those cards to the battlefield under your control.' });
const dance = mk({ name: "Visionary's Dance", manaCost: '{5}{U}{R}', typeLine: 'Sorcery', colors: ['U', 'R'], oracleText: 'Create two 3/3 blue and red Elemental creature tokens with flying.\n{2}, Discard this card: Look at the top two cards of your library. Put one of them into your hand and the other into your graveyard.' });
const shambler = mk({ name: 'Nested Shambler', manaCost: '{B}', typeLine: 'Creature — Squirrel Warrior', power: 1, toughness: 1, colors: ['B'], oracleText: "When this creature dies, create X tapped 1/1 green Squirrel creature tokens, where X is this creature's power." });
const rally = mk({ name: 'Rally at the Hornburg', manaCost: '{1}{R}', typeLine: 'Sorcery', colors: ['R'], oracleText: 'Create two 1/1 white Human Soldier creature tokens. Humans you control gain haste until end of turn.' });
const impulse = mk({ name: 'Reckless Impulse', manaCost: '{1}{R}', typeLine: 'Sorcery', colors: ['R'], oracleText: 'Exile the top two cards of your library. Until the end of your next turn, you may play those cards.' });
const percussionist = mk({ name: 'Clockwork Percussionist', manaCost: '{R}', typeLine: 'Artifact Creature — Monkey Toy', power: 1, toughness: 1, colors: ['R'], oracleText: 'Haste\nWhen this creature dies, exile the top card of your library. You may play it until the end of your next turn.' });
const defile = mk({ name: 'Defile', manaCost: '{B}', typeLine: 'Instant', colors: ['B'], oracleText: 'Target creature gets -1/-1 until end of turn for each Swamp you control.' });
const festivities = mk({ name: 'End the Festivities', manaCost: '{R}', typeLine: 'Sorcery', colors: ['R'], oracleText: 'End the Festivities deals 1 damage to each opponent and each creature and planeswalker they control.' });
const pestilence = mk({ name: 'Pestilence', manaCost: '{2}{B}{B}', typeLine: 'Enchantment', colors: ['B'], oracleText: 'At the beginning of the end step, if no creatures are on the battlefield, sacrifice this enchantment.\n{B}: This enchantment deals 1 damage to each creature and each player.' });
const eidolon = mk({ name: 'Aurora Eidolon', manaCost: '{3}{W}', typeLine: 'Creature — Spirit', power: 2, toughness: 3, colors: ['W'], oracleText: '{W}, Sacrifice this creature: Prevent the next 3 damage that would be dealt to any target this turn.\nWhenever you cast a multicolored spell, you may return this card from your graveyard to your hand.' });
const fanged = mk({ name: 'Fanged Flames', manaCost: '{2}{R}', typeLine: 'Instant', colors: [], oracleText: 'Devoid\nFanged Flames deals 4 damage to target creature or planeswalker. If that creature or planeswalker would die this turn, exile it instead.' });
const crescendo = mk({ name: 'Grand Crescendo', manaCost: '{X}{W}{W}', typeLine: 'Instant', colors: ['W'], oracleText: 'Create X 1/1 green and white Citizen creature tokens. Creatures you control gain indestructible until end of turn.' });

describe('MF4 · compilação (pauper, 2ª leva)', () => {
  it("God-Pharaoh's Faithful: gatilho por cor da mágica conjurada", () => {
    expect(faithful.automation).toBe('full');
    const t = faithful.abilities.find((a) => a.kind === 'triggered');
    expect(t!.trigger).toEqual({ on: 'youCastSpellOf', filter: { colorAnyOf: ['U', 'B', 'R'] } });
    expect(t!.effect).toEqual([{ op: 'gainLife', who: 'controller', amount: 1 }]);
  });

  it('Sunscape Familiar / Goblin Anarchomancer: desconto por cor', () => {
    expect(sunscape.costModifiers).toEqual([{ amount: -1, whose: 'you', filter: { colorAnyOf: ['G', 'U'] } }]);
    expect(anarcho.costModifiers).toEqual([{ amount: -1, whose: 'you', filter: { colorAnyOf: ['R', 'G'] } }]);
  });

  it("Guardians' Pledge / Holy Light: pump coletivo por cor e por não-cor", () => {
    expect(pledge.spellEffect).toEqual([{ op: 'pumpEach', filter: { what: 'creature', controlledBy: 'you', color: 'W' }, power: 2, toughness: 2 }]);
    expect(holyLight.spellEffect).toEqual([{ op: 'pumpEach', filter: { what: 'creature', controlledBy: 'any', notColor: 'W' }, power: -1, toughness: -1 }]);
  });

  it('Sea Gate Oracle: "uma para a mão e a outra para o fundo"', () => {
    expect(seaGate.automation).toBe('full');
    const t = seaGate.abilities.find((a) => a.kind === 'triggered');
    expect(t!.effect).toEqual([{ op: 'digTop', count: 2, pick: 1, rest: 'bottom' }]);
  });

  it('Words of Wisdom', () => {
    expect(wisdom.spellEffect).toEqual([{ op: 'draw', who: 'controller', count: 2 }, { op: 'draw', who: 'opponent', count: 1 }]);
  });

  it('Sylvok Lifestaff: gatilho da criatura equipada morrendo', () => {
    expect(lifestaff.automation).toBe('full');
    const t = lifestaff.abilities.find((a) => a.kind === 'triggered');
    expect(t!.trigger).toEqual({ on: 'hostDies' });
    expect(t!.effect).toEqual([{ op: 'gainLife', who: 'controller', amount: 3 }]);
  });

  it("Kruphix's Insight / Ghostly Flicker / Visionary's Dance", () => {
    expect(insight.spellEffect).toEqual([{ op: 'digTop', count: 6, pick: 3, filter: { what: 'enchantment' }, rest: 'graveyard' }]);
    expect(flicker.spellTargets).toHaveLength(2);
    expect(flicker.spellEffect).toEqual([{ op: 'blink', what: 'target:0' }, { op: 'blink', what: 'target:1' }]);
    const act = dance.abilities.find((a) => a.kind === 'activated' && a.zone === 'hand');
    expect(act!.cost).toEqual({ mana: '{2}', discardSelf: true });
    expect(act!.effect).toEqual([{ op: 'digTop', count: 2, pick: 1, rest: 'graveyard' }]);
  });

  it('Nested Shambler: fichas iguais ao próprio poder', () => {
    expect(shambler.automation).toBe('full');
    const t = shambler.abilities.find((a) => a.kind === 'triggered');
    expect(t!.effect).toEqual([{ op: 'token', who: 'controller', count: { powerOf: 'self' }, name: 'Squirrel', power: 1, toughness: 1, colors: ['G'], subtypes: ['Squirrel'], tapped: true }]);
  });

  it('Rally at the Hornburg: fichas + ímpeto por subtipo', () => {
    expect(rally.automation).toBe('full');
    expect(rally.spellEffect).toEqual([
      { op: 'token', who: 'controller', count: 2, name: 'Human Soldier', power: 1, toughness: 1, colors: ['W'], subtypes: ['Human', 'Soldier'] },
      { op: 'pumpEach', filter: { what: 'creature', subtype: 'Human', controlledBy: 'you' }, power: 0, toughness: 0, keywords: ['haste'] },
    ]);
  });

  it('Grand Crescendo continua full: a regra do Rally não derruba o "Create X …"', () => {
    expect(crescendo.automation).toBe('full');
  });

  it('Reckless Impulse / Clockwork Percussionist: impulse até o fim do próximo turno', () => {
    expect(impulse.spellEffect).toEqual([{ op: 'impulse', count: 2, untilNextEndStep: true }]);
    const t = percussionist.abilities.find((a) => a.kind === 'triggered');
    expect(t!.trigger).toEqual({ on: 'dies', self: true });
    expect(t!.effect).toEqual([{ op: 'impulse', count: 1, untilNextEndStep: true }]);
  });

  it('Defile: -1/-1 por Pântano', () => {
    expect(defile.spellTargets).toEqual([{ what: 'creature' }]);
    expect(defile.spellEffect).toEqual([{
      op: 'pump', what: 'target:0', power: 0, toughness: 0,
      powerDyn: { times: -1, of: { per: { what: 'land', subtype: 'Swamp', controlledBy: 'you' } } },
      toughnessDyn: { times: -1, of: { per: { what: 'land', subtype: 'Swamp', controlledBy: 'you' } } },
    }]);
  });

  it('End the Festivities / Fanged Flames', () => {
    expect(festivities.spellEffect).toEqual([
      { op: 'damage', to: 'opponent', amount: 1 },
      { op: 'damageEach', filter: { what: 'permanent', typeAnyOf: ['Creature', 'Planeswalker'], controlledBy: 'opponent' }, amount: 1 },
    ]);
    expect(fanged.spellEffect).toEqual([{ op: 'damage', to: 'target:0', amount: 4, exileIfDies: true }]);
  });

  it('Pestilence: sacrifício no fim do turno sem criaturas em jogo', () => {
    expect(pestilence.automation).toBe('full');
    const t = pestilence.abilities.find((a) => a.kind === 'triggered');
    expect(t!.trigger).toEqual({ on: 'endStep', whose: 'each' });
    expect(t!.condition).toEqual({ kind: 'compare', left: { per: { what: 'creature', controlledBy: 'any' } }, cmp: 'eq', right: 0 });
    expect(t!.effect).toEqual([{ op: 'sacrificeSelf' }]);
  });

  it('Aurora Eidolon: gatilho ativo no cemitério', () => {
    expect(eidolon.automation).toBe('full');
    const t = eidolon.abilities.find((a) => a.kind === 'triggered');
    expect(t!.zone).toBe('graveyard');
    expect(t!.trigger).toEqual({ on: 'youCastSpellOf', filter: { multicolored: true } });
  });
});

describe('MF4 · comportamento (pauper, 2ª leva)', () => {
  it("Guardians' Pledge: só as criaturas brancas suas crescem", () => {
    const white = mk({ name: 'Test Soldier', manaCost: '{W}', typeLine: 'Creature — Human Soldier', power: 1, toughness: 1, colors: ['W'], oracleText: '' });
    const game = makeGame([...FILLER, pledge, white, grizzlyBears], FILLER, { topP1: [pledge.id, white.id, 'grizzly-bears'] });
    goToMain1(game);
    const soldier = put(game, 'p1', white.id);
    const bear = put(game, 'p1', 'grizzly-bears', 'battlefield');
    for (let i = 0; i < 2; i++) put(game, 'p1', 'plains');
    const hand = findIn(game, 'p1', 'hand', pledge.id);
    expect(game.apply('p1', { type: 'castSpell', objectId: hand } as never).ok).toBe(true);
    settle(game);
    expect(effectivePower(game.state, game.state.objects[soldier])).toBe(3);
    expect(effectiveToughness(game.state, game.state.objects[soldier])).toBe(3);
    expect(effectivePower(game.state, game.state.objects[bear])).toBe(2); // urso verde: não muda
  });

  it('Defile: -1/-1 por Pântano que você controla', () => {
    const game = makeGame([...FILLER, defile], [...FILLER, grizzlyBears], { topP1: [defile.id], topP2: ['grizzly-bears'] });
    goToMain1(game);
    const bear = put(game, 'p2', 'grizzly-bears');
    for (let i = 0; i < 3; i++) put(game, 'p1', 'swamp');
    const hand = findIn(game, 'p1', 'hand', defile.id);
    expect(game.apply('p1', { type: 'castSpell', objectId: hand, targets: [{ kind: 'object', id: bear }] } as never).ok).toBe(true);
    settle(game);
    // 2/2 com três Pântanos → -3/-3 → morre
    expect(game.state.objects[bear].zone).toBe('graveyard');
  });
});
