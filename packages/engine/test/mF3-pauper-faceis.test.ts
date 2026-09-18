/** MF3: leva fácil (pauper) — 15 lacunas do meta Pauper que a engine já sabia executar. */
import { describe, expect, it } from 'vitest';
import { compileOracleCard, type OracleInput } from '../src/cards/oracle-parser.js';
import { forest, island, mountain, plains, swamp } from '../src/cards/demo-set.js';
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

const tolarian = mk({ name: 'Tolarian Terror', manaCost: '{6}{U}', typeLine: 'Creature — Serpent', power: 5, toughness: 5, colors: ['U'], oracleText: 'This spell costs {1} less to cast for each instant and sorcery card in your graveyard.\nWard {2}' });
const cryptic = mk({ name: 'Cryptic Serpent', manaCost: '{5}{U}{U}', typeLine: 'Creature — Serpent', power: 6, toughness: 5, colors: ['U'], oracleText: 'This spell costs {1} less to cast for each instant and sorcery card in your graveyard.' });
const ichor = mk({ name: 'Ichor Wellspring', manaCost: '{2}', typeLine: 'Artifact', colors: [], oracleText: 'When this artifact enters or is put into a graveyard from the battlefield, draw a card.' });
const lavaDart = mk({ name: 'Lava Dart', manaCost: '{R}', typeLine: 'Instant', colors: ['R'], oracleText: 'Lava Dart deals 1 damage to any target.\nFlashback—Sacrifice a Mountain.' });
const stirrings = mk({ name: 'Ancient Stirrings', manaCost: '{G}', typeLine: 'Sorcery', colors: ['G'], oracleText: 'Look at the top five cards of your library. You may reveal a colorless card from among them and put it into your hand. Then put the rest on the bottom of your library in any order.' });
const stampede = mk({ name: 'Lead the Stampede', manaCost: '{2}{G}', typeLine: 'Sorcery', colors: ['G'], oracleText: 'Look at the top five cards of your library. You may reveal any number of creature cards from among them and put the revealed cards into your hand. Put the rest on the bottom of your library in any order.' });
const augur = mk({ name: 'Augur of Bolas', manaCost: '{1}{U}', typeLine: 'Creature — Human Wizard', power: 1, toughness: 3, colors: ['U'], oracleText: 'When this creature enters, look at the top three cards of your library. You may reveal an instant or sorcery card from among them and put it into your hand. Put the rest on the bottom of your library in any order.' });
const wurm = mk({ name: 'Bramble Wurm', manaCost: '{6}{G}', typeLine: 'Creature — Wurm', power: 6, toughness: 6, colors: ['G'], oracleText: 'Reach, trample\nWhen this creature enters, you gain 5 life.\n{2}{G}, Exile this card from your graveyard: You gain 5 life.' });
const lembas = mk({ name: 'Lembas', manaCost: '{2}', typeLine: 'Artifact — Food', colors: [], oracleText: 'When this artifact enters, scry 1, then draw a card.\n{2}, {T}, Sacrifice this artifact: You gain 3 life.\nWhen this artifact is put into a graveyard from the battlefield, its owner shuffles it into their library.' });
const armor = mk({ name: 'Ethereal Armor', manaCost: '{W}', typeLine: 'Enchantment — Aura', colors: ['W'], oracleText: 'Enchant creature\nEnchanted creature gets +1/+1 for each enchantment you control and has first strike.' });
const lotleth = mk({ name: 'Lotleth Giant', manaCost: '{6}{B}', typeLine: 'Creature — Zombie Giant', power: 5, toughness: 6, colors: ['B'], oracleText: 'Undergrowth — When this creature enters, it deals 1 damage to target opponent for each creature card in your graveyard.' });
const moxite = mk({ name: 'Melded Moxite', manaCost: '{1}{R}', typeLine: 'Artifact', colors: ['R'], oracleText: 'When this artifact enters, you may discard a card. If you do, draw two cards.\n{3}, Sacrifice this artifact: Create a tapped 2/2 colorless Robot artifact creature token.' });
const disciple = mk({ name: "Nylea's Disciple", manaCost: '{2}{G}{G}', typeLine: 'Creature — Centaur Archer', power: 3, toughness: 3, colors: ['G'], oracleText: 'When this creature enters, you gain life equal to your devotion to green.' });
const bargain = mk({ name: "Reckoner's Bargain", manaCost: '{1}{B}', typeLine: 'Instant', colors: ['B'], oracleText: "As an additional cost to cast this spell, sacrifice an artifact or creature.\nYou gain life equal to the sacrificed permanent's mana value. Draw two cards." });
const shatter = mk({ name: 'Test Shatter', manaCost: '{1}{R}', typeLine: 'Instant', colors: ['R'], oracleText: 'Destroy target artifact.' });
const dust = mk({ name: 'Dust to Dust', manaCost: '{1}{W}{W}', typeLine: 'Sorcery', colors: ['W'], oracleText: 'Exile two target artifacts.' });

describe('MF3 · compilação (pauper)', () => {
  it('Tolarian Terror / Cryptic Serpent: "instant and sorcery" vira união de tipos no cemitério', () => {
    for (const card of [tolarian, cryptic]) {
      expect(card.automation).toBe('full');
      expect(card.costModifiers).toEqual([{ amount: -1, whose: 'you', self: true, perGraveyard: { typeAnyOf: ['Instant', 'Sorcery'] } }]);
    }
  });

  it('Ichor Wellspring: "entra ou vai para o cemitério" vira dois gatilhos', () => {
    expect(ichor.automation).toBe('full');
    const trigs = ichor.abilities.filter((a) => a.kind === 'triggered');
    expect(trigs.map((t) => t.trigger.on).sort()).toEqual(['dies', 'etb']);
    for (const t of trigs) expect(t.effect).toEqual([{ op: 'draw', who: 'controller', count: 1 }]);
  });

  it('Lava Dart: flashback pago sacrificando uma Montanha', () => {
    expect(lavaDart.automation).toBe('full');
    expect(lavaDart.flashback).toEqual({ sacrifice: { what: 'land', subtype: 'Mountain' } });
  });

  it('Ancient Stirrings / Lead the Stampede / Augur of Bolas: digTop com filtro', () => {
    expect(stirrings.spellEffect).toEqual([{ op: 'digTop', count: 5, pick: 1, filter: { colorless: true }, rest: 'bottom' }]);
    expect(stampede.spellEffect).toEqual([{ op: 'digTop', count: 5, pick: 5, filter: { what: 'creature' }, rest: 'bottom' }]);
    const etb = augur.abilities.find((a) => a.kind === 'triggered');
    expect(etb!.effect).toEqual([{ op: 'digTop', count: 3, pick: 1, filter: { typeAnyOf: ['Instant', 'Sorcery'] }, rest: 'bottom' }]);
  });

  it('Bramble Wurm: forma geral da habilidade que exila a carta do cemitério como custo', () => {
    expect(wurm.automation).toBe('full');
    const gy = wurm.abilities.find((a) => a.kind === 'activated' && a.zone === 'graveyard');
    expect(gy!.exileSelf).toBe(true);
    expect(gy!.cost).toEqual({ mana: '{2}{G}' });
    expect(gy!.effect).toEqual([{ op: 'gainLife', who: 'controller', amount: 5 }]);
  });

  it('Lembas: ao ir para o cemitério, volta embaralhada para o grimório', () => {
    expect(lembas.automation).toBe('full');
    const dies = lembas.abilities.find((a) => a.kind === 'triggered' && a.trigger.on === 'dies');
    expect(dies!.effect).toEqual([{ op: 'shuffleSelfIntoLibrary' }]);
  });

  it('Ethereal Armor: bônus por contagem e keyword na mesma frase', () => {
    expect(armor.automation).toBe('full');
    expect(armor.attachEffect).toMatchObject({
      powerPer: { what: 'enchantment', controlledBy: 'you' },
      toughnessPer: { what: 'enchantment', controlledBy: 'you' },
      keywords: ['firstStrike'],
    });
  });

  it('Lotleth Giant: dano igual às criaturas no seu cemitério', () => {
    expect(lotleth.automation).toBe('full');
    const etb = lotleth.abilities.find((a) => a.kind === 'triggered');
    expect(etb!.targets).toEqual([{ what: 'player', controlledBy: 'opponent' }]);
    expect(etb!.effect).toEqual([{ op: 'damage', to: 'target:0', amount: { graveyardCount: 'controller', filter: { what: 'creature' } } }]);
  });

  it('Melded Moxite: ficha de artefato-criatura virada', () => {
    expect(moxite.automation).toBe('full');
    const act = moxite.abilities.find((a) => a.kind === 'activated');
    expect(act!.cost).toEqual({ mana: '{3}', sacrificeSelf: true });
    expect(act!.effect).toEqual([{ op: 'token', who: 'controller', count: 1, name: 'Robot', power: 2, toughness: 2, colors: [], subtypes: ['Robot'], types: ['Artifact', 'Creature'], tapped: true }]);
  });

  it("Nylea's Disciple: vida igual à devoção ao verde", () => {
    expect(disciple.automation).toBe('full');
    const etb = disciple.abilities.find((a) => a.kind === 'triggered');
    expect(etb!.effect).toEqual([{ op: 'gainLife', who: 'controller', amount: { devotion: 'G' } }]);
  });

  it("Reckoner's Bargain: custo adicional de sacrifício e vida pelo valor de mana sacrificado", () => {
    expect(bargain.automation).toBe('full');
    expect(bargain.additionalCost).toMatchObject({ sacrifice: { what: 'permanent', typeAnyOf: ['Artifact', 'Creature'] } });
    expect(bargain.spellEffect).toEqual([
      { op: 'gainLife', who: 'controller', amount: { sacrificedManaValuePlus: 0 } },
      { op: 'draw', who: 'controller', count: 2 },
    ]);
  });

  it('Dust to Dust: dois alvos de artefato', () => {
    expect(dust.automation).toBe('full');
    expect(dust.spellTargets).toEqual([{ what: 'artifact' }, { what: 'artifact' }]);
    expect(dust.spellEffect).toEqual([{ op: 'exile', what: 'target:0' }, { op: 'exile', what: 'target:1' }]);
  });
});

describe('MF3 · comportamento (pauper)', () => {
  it('Ichor Wellspring: compra ao entrar e compra de novo ao ir para o cemitério', () => {
    const game = makeGame([...FILLER, ichor, shatter], FILLER, { topP1: [ichor.id, shatter.id] });
    goToMain1(game);
    for (let i = 0; i < 2; i++) put(game, 'p1', 'mountain');
    const hand = findIn(game, 'p1', 'hand', ichor.id);
    const before = game.state.players.p1.zones.hand.length;
    expect(game.apply('p1', { type: 'castSpell', objectId: hand } as never).ok).toBe(true);
    settle(game);
    // saiu da mão (-1) e comprou (+1)
    expect(game.state.players.p1.zones.hand.length).toBe(before);
    expect(game.state.objects[hand].zone).toBe('battlefield');
    // Destruir de verdade (movimento manual não varre gatilhos).
    for (let i = 0; i < 2; i++) put(game, 'p1', 'mountain');
    const shatterId = findIn(game, 'p1', 'hand', shatter.id);
    const afterEtb = game.state.players.p1.zones.hand.length;
    expect(game.apply('p1', { type: 'castSpell', objectId: shatterId, targets: [{ kind: 'object', id: hand }] } as never).ok).toBe(true);
    settle(game);
    expect(game.state.objects[hand].zone).toBe('graveyard');
    // -1 da mão (Shatter conjurado) +1 do gatilho de morte
    expect(game.state.players.p1.zones.hand.length).toBe(afterEtb);
  });

  it('Tolarian Terror: com quatro instantâneos/feitiços no cemitério custa {2}{U}', () => {
    const bolt = mk({ name: 'Test Bolt', manaCost: '{R}', typeLine: 'Instant', colors: ['R'], oracleText: 'Test Bolt deals 3 damage to any target.' });
    const game = makeGame([...FILLER, tolarian, ...copies(bolt, 4)], FILLER, { topP1: [tolarian.id, bolt.id, bolt.id, bolt.id, bolt.id] });
    goToMain1(game);
    for (let i = 0; i < 4; i++) put(game, 'p1', bolt.id, 'graveyard');
    for (let i = 0; i < 2; i++) put(game, 'p1', 'island');
    const hand = findIn(game, 'p1', 'hand', tolarian.id);
    // {6}{U} - 4 = {2}{U}: três terrenos bastam, dois não.
    expect(game.apply('p1', { type: 'castSpell', objectId: hand } as never).ok).toBe(false);
    put(game, 'p1', 'island');
    expect(game.apply('p1', { type: 'castSpell', objectId: hand } as never).ok).toBe(true);
    settle(game);
    expect(game.state.objects[hand].zone).toBe('battlefield');
  });

  it("Nylea's Disciple: ganha vida igual à devoção ao verde", () => {
    const game = makeGame([...FILLER, disciple], FILLER, { topP1: [disciple.id] });
    goToMain1(game);
    for (let i = 0; i < 4; i++) put(game, 'p1', 'forest');
    const hand = findIn(game, 'p1', 'hand', disciple.id);
    const life = game.state.players.p1.life;
    expect(game.apply('p1', { type: 'castSpell', objectId: hand } as never).ok).toBe(true);
    settle(game);
    // a própria Disciple em jogo vale {G}{G} de devoção
    expect(game.state.players.p1.life).toBe(life + 2);
  });
});
