/** M42 (leva pesada): Wastescape Battlemage (dois kickers), Mycosynth Lattice, Painter's Servant, Opposition Agent, companions (Yorion, Jegantha). */
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
const untilDecision = (game: Game) => passUntil(game, (s) => s.status === 'finished' || s.pendingDecision !== null || (s.stack.length === 0 && s.triggerQueue.length === 0));
const answer = (game: Game, p: PlayerId, picks: number[], text?: string) => game.apply(p, { type: 'effectChoice', picks, text });
const choice = (game: Game) => { const pd = game.state.pendingDecision; if (pd?.type !== 'effectChoice') throw new Error(`esperava effectChoice, veio ${pd?.type ?? 'nada'}`); return pd; };
const lands = (game: Game, p: PlayerId, ...ids: string[]) => { for (const id of ids) put(game, p, id); };
const untapAll = (game: Game, p: PlayerId) => { for (const id of game.state.players[p].zones.battlefield) game.state.objects[id].tapped = false; };

const battlemage = mk({ name: 'Wastescape Battlemage', manaCost: '{1}{C}', typeLine: 'Creature — Eldrazi Wizard', power: 2, toughness: 2, colors: [], oracleText: "Kicker {G} and/or {1}{U}\nWhen you cast this spell, if it was kicked with its {G} kicker, exile target artifact or enchantment an opponent controls.\nWhen you cast this spell, if it was kicked with its {1}{U} kicker, return target creature an opponent controls to its owner's hand." });
const lattice = mk({ name: 'Mycosynth Lattice', manaCost: '{6}', typeLine: 'Artifact', colors: [], oracleText: "All permanents are artifacts in addition to their other types.\nAll cards that aren't on the battlefield, spells, and permanents are colorless.\nPlayers may spend mana as though it were mana of any color." });
const painter = mk({ name: "Painter's Servant", manaCost: '{2}', typeLine: 'Artifact Creature — Scarecrow', power: 1, toughness: 3, colors: [], oracleText: "As this creature enters, choose a color.\nAll cards that aren't on the battlefield, spells, and permanents are the chosen color in addition to their other colors." });
const agent = mk({ name: 'Opposition Agent', manaCost: '{2}{B}', typeLine: 'Creature — Human Rogue', power: 3, toughness: 2, colors: ['B'], oracleText: "Flash\nYou control your opponents while they're searching their libraries.\nWhile an opponent is searching their library, they exile each card they find. You may play those cards for as long as they remain exiled, and you may spend mana as though it were mana of any color to cast them." });
const yorion = mk({ name: 'Yorion, Sky Nomad', manaCost: '{3}{W/U}{W/U}', typeLine: 'Legendary Creature — Bird Serpent', power: 4, toughness: 5, colors: ['W', 'U'], oracleText: 'Companion — Your starting deck contains at least twenty cards more than the minimum deck size.\nFlying\nWhen Yorion enters, exile any number of other nonland permanents you own and control. Return those cards to the battlefield at the beginning of the next end step.' });
const jegantha = mk({ name: 'Jegantha, the Wellspring', manaCost: '{4}{R/G}', typeLine: 'Legendary Creature — Elemental Elk', power: 5, toughness: 5, colors: ['R', 'G'], oracleText: "Companion — No card in your starting deck has more than one of the same mana symbol in its mana cost.\n{T}: Add {W}{U}{B}{R}{G}. This mana can't be spent to pay generic mana costs." });
const idol = mk({ name: 'Bear Idol', manaCost: '{2}', typeLine: 'Artifact', colors: [], oracleText: '{T}: Add {C}.' });
const eldraziLand = mk({ name: 'Eldrazi Temple', typeLine: 'Land', colors: [], oracleText: '{T}: Add {C}.' });
const tutor = mk({ name: 'Green Tutor', manaCost: '{G}', typeLine: 'Sorcery', colors: ['G'], oracleText: 'Search your library for a creature card, reveal it, put it into your hand, then shuffle.' });
const blueTwo = mk({ name: 'Blue Two', manaCost: '{U}{U}', typeLine: 'Instant', colors: ['U'], oracleText: 'Draw a card.' });
const genericTwo = mk({ name: 'Generic Two', manaCost: '{2}', typeLine: 'Instant', colors: [], oracleText: 'Draw a card.' });

describe('M42 · leva pesada', () => {
  it('compila tudo como full', () => {
    for (const c of [battlemage, lattice, painter, agent, yorion, jegantha]) expect(c.automation, `${c.name}: ${c.automationNotes?.join(' | ')}`).toBe('full');
    expect(battlemage.kicker?.cost).toBe('{G}');
    expect(battlemage.kicker2?.cost).toBe('{1}{U}');
    expect(yorion.companion).toEqual({ rule: 'deckPlus20' });
    expect(jegantha.companion).toEqual({ rule: 'noRepeatedManaSymbols' });
  });

  it('Wastescape Battlemage: cada kicker liga o seu gatilho; os dois juntos ligam ambos', () => {
    const run = (kickers: number[]) => {
      const game = makeGame([...FILLER, battlemage, eldraziLand], [...FILLER, grizzlyBears, idol], { topP1: [battlemage.id, eldraziLand.id], topP2: ['grizzly-bears', idol.id] });
      goToMain1(game);
      lands(game, 'p1', eldraziLand.id, 'forest', 'forest', 'island', 'island');
      const bears = put(game, 'p2', 'grizzly-bears'); const art = put(game, 'p2', idol.id);
      const b = findIn(game, 'p1', 'hand', battlemage.id);
      expect(cast(game, 'p1', b, { kickers }).ok).toBe(true);
      // gatilhos de conjuração pedem alvo, na ordem em que foram postos
      for (let i = 0; i < kickers.length; i++) {
        passUntil(game, (s) => s.pendingDecision?.type === 'chooseTargets', 30);
        const pd = game.state.pendingDecision;
        if (pd?.type !== 'chooseTargets') throw new Error('esperava alvo do gatilho');
        const wantsCreature = pd.specs[0]?.what === 'creature';
        expect(game.apply('p1', { type: 'chooseTargets', targets: [{ kind: 'object', id: wantsCreature ? bears : art }] }).ok).toBe(true);
      }
      settle(game);
      return { bears: game.state.objects[bears].zone, art: game.state.objects[art].zone, tapped: game.state.players.p1.zones.battlefield.filter((id) => game.state.objects[id].tapped).length, mage: game.state.objects[b].zone };
    };
    expect(run([])).toMatchObject({ bears: 'battlefield', art: 'battlefield', tapped: 2, mage: 'battlefield' });
    expect(run([0])).toMatchObject({ bears: 'battlefield', art: 'exile', tapped: 3 });
    expect(run([1])).toMatchObject({ bears: 'hand', art: 'battlefield', tapped: 4 });
    expect(run([0, 1])).toMatchObject({ bears: 'hand', art: 'exile', tapped: 5 });
  });

  it('Mycosynth Lattice: tudo vira artefato e incolor; mana de qualquer cor paga custos coloridos', () => {
    const game = makeGame([...FILLER, lattice, blueTwo, grizzlyBears], [...FILLER, lightningBolt], { topP1: [lattice.id, blueTwo.id, 'grizzly-bears'], topP2: ['lightning-bolt'] });
    goToMain1(game);
    const bears = put(game, 'p1', 'grizzly-bears');
    const bolt = findIn(game, 'p2', 'hand', 'lightning-bolt');
    expect(game.state.objects[bears].card.colors).toEqual(['G']);
    put(game, 'p1', lattice.id);
    game.apply('p1', { type: 'passPriority' }); // SBA
    passUntil(game, (s) => s.priority === 'p1', 10);
    expect(game.state.objects[bears].card.types).toContain('Artifact');
    expect(game.state.objects[bears].card.colors).toEqual([]);
    expect(game.state.objects[bolt].card.colors).toEqual([]); // até na mão do oponente
    lands(game, 'p1', 'mountain', 'mountain');
    expect(cast(game, 'p1', findIn(game, 'p1', 'hand', blueTwo.id)).ok).toBe(true); // {U}{U} pago com duas Mountains
    settle(game);
    // some a Lattice: tudo volta
    game.apply('p1', { type: 'manualMove', objectId: findIn(game, 'p1', 'battlefield', lattice.id), to: 'graveyard' });
    game.apply('p1', { type: 'passPriority' });
    passUntil(game, (s) => s.priority === 'p1', 10);
    expect(game.state.objects[bears].card.types).not.toContain('Artifact');
    expect(game.state.objects[bears].card.colors).toEqual(['G']);
  });

  it("Painter's Servant: tudo ganha a cor escolhida", () => {
    const game = makeGame([...FILLER, painter], [...FILLER, grizzlyBears], { topP1: [painter.id], topP2: ['grizzly-bears'] });
    goToMain1(game);
    lands(game, 'p1', 'plains', 'plains');
    const bears = put(game, 'p2', 'grizzly-bears');
    expect(cast(game, 'p1', findIn(game, 'p1', 'hand', painter.id)).ok).toBe(true);
    untilDecision(game);
    expect(choice(game).mode).toBe('chooseColor');
    answer(game, 'p1', [], 'B');
    settle(game);
    expect(game.state.objects[bears].card.colors.sort()).toEqual(['B', 'G']);
    expect(game.state.objects[findIn(game, 'p1', 'battlefield', painter.id)].card.colors).toEqual(['B']);
  });

  it('Opposition Agent: o oponente busca, mas quem escolhe sou eu; a carta vai para o exílio e eu a conjuro com qualquer mana', () => {
    const game = makeGame([...FILLER, agent], [...FILLER, tutor, grizzlyBears], { topP1: [agent.id], topP2: [tutor.id, 'grizzly-bears'] });
    goToMain1(game);
    put(game, 'p1', agent.id);
    lands(game, 'p1', 'swamp', 'swamp');
    // o Bears fica na biblioteca do p2 para ser buscado
    const bears = findIn(game, 'p2', 'hand', 'grizzly-bears');
    game.apply('p2', { type: 'manualMove', objectId: bears, to: 'library', position: 'bottom' });
    passUntil(game, (s) => s.turn === 2 && s.step === 'main1' && s.priority === 'p2' && s.stack.length === 0, 400);
    put(game, 'p2', 'forest');
    expect(cast(game, 'p2', findIn(game, 'p2', 'hand', tutor.id)).ok).toBe(true);
    untilDecision(game);
    const pd = choice(game);
    expect(pd.player).toBe('p1'); // eu controlo a busca
    expect(pd.options).toContain(bears);
    answer(game, 'p1', [bears]);
    settle(game);
    expect(game.state.objects[bears].zone).toBe('exile');
    expect(game.state.objects[bears].playableBy).toBe('p1');
    passUntil(game, (s) => s.turn === 3 && s.step === 'main1' && s.priority === 'p1' && s.stack.length === 0, 400);
    untapAll(game, 'p1');
    expect(cast(game, 'p1', bears).ok).toBe(true); // {1}{G} pago com dois Swamps
    settle(game);
    expect(game.state.objects[bears].zone).toBe('battlefield');
    expect(game.state.objects[bears].controller).toBe('p1');
  });

  it('Companion: Yorion no sideboard com deck de 80 vira companion; {3} traz para a mão; ETB pisca e volta no fim do turno', () => {
    const deck80 = [...copies(plains, 40), ...copies(island, 30), ...copies(grizzlyBears, 10)];
    const game = new Game([{ id: 'p1', name: 'Alice', deck: { cards: deck80, sideboard: [yorion] } }, { id: 'p2', name: 'Bob', deck: { cards: FILLER } }], 7, { firstPlayer: 'p1' });
    game.start();
    expect(game.state.players.p1.companion).toBeDefined();
    game.apply('p1', { type: 'keepHand', bottom: [] });
    game.apply('p2', { type: 'keepHand', bottom: [] });
    passUntil(game, (s) => s.step === 'main1' && s.priority === 'p1' && s.stack.length === 0);
    lands(game, 'p1', 'plains', 'plains', 'plains', 'island', 'island', 'island', 'island', 'island');
    expect(game.apply('p1', { type: 'takeCompanion' }).ok).toBe(true);
    const y = findIn(game, 'p1', 'hand', yorion.id);
    expect(game.state.players.p1.companionTaken).toBe(true);
    expect(game.apply('p1', { type: 'takeCompanion' }).ok).toBe(false);
    const bears = put(game, 'p1', 'grizzly-bears');
    untapAll(game, 'p1');
    expect(cast(game, 'p1', y).ok).toBe(true);
    untilDecision(game);
    const pd = choice(game);
    expect(pd.options).toContain(bears);
    expect(pd.options).not.toContain(y);
    answer(game, 'p1', [bears]);
    settle(game);
    expect(game.state.objects[bears].zone).toBe('exile');
    passUntil(game, (s) => s.turn === 2 && s.step === 'upkeep', 200);
    expect(game.state.objects[bears].zone).toBe('battlefield');
  });

  it('Companion: Jegantha só entra se nenhuma carta repetir símbolo; a mana dela não paga genérico', () => {
    const bad = new Game([{ id: 'p1', name: 'Alice', deck: { cards: [...FILLER, blueTwo], sideboard: [jegantha] } }, { id: 'p2', name: 'Bob', deck: { cards: FILLER } }], 7, { firstPlayer: 'p1' });
    bad.start();
    expect(bad.state.players.p1.companion).toBeUndefined(); // {U}{U} repete
    const game = new Game([{ id: 'p1', name: 'Alice', deck: { cards: [...FILLER, genericTwo, grizzlyBears], sideboard: [jegantha] } }, { id: 'p2', name: 'Bob', deck: { cards: FILLER } }], 7, { firstPlayer: 'p1' });
    game.start();
    expect(game.state.players.p1.companion).toBeDefined();
    game.apply('p1', { type: 'keepHand', bottom: [] });
    game.apply('p2', { type: 'keepHand', bottom: [] });
    passUntil(game, (s) => s.step === 'main1' && s.priority === 'p1' && s.stack.length === 0);
    const j = findIn(game, 'p1', 'sideboard', jegantha.id);
    game.apply('p1', { type: 'manualMove', objectId: j, to: 'battlefield' });
    game.state.objects[j].summoningSick = false;
    expect(game.apply('p1', { type: 'activateAbility', objectId: j, abilityIndex: 0 }).ok).toBe(true);
    expect(game.state.players.p1.manaPoolRestricted?.G).toBe(1);
    const g2 = put(game, 'p1', genericTwo.id, 'hand');
    expect(cast(game, 'p1', g2).ok).toBe(false); // {2} genérico: a mana restrita não serve
    const bears = put(game, 'p1', 'grizzly-bears', 'hand');
    put(game, 'p1', 'mountain');
    expect(cast(game, 'p1', bears).ok).toBe(true); // {1}{G}: {G} da Jegantha, {1} da Mountain
    expect(game.state.players.p1.manaPoolRestricted?.G).toBe(0);
  });
});
