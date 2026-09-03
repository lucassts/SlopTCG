/** M22 (Leva 6a, Legacy): cartas mais jogadas do metagame — Wasteland, Brainstorm, Daze, Snuff Out, Force of Negation, Fatal Push, Hydroblast, Reanimate, Show and Tell, LED, Spirit Guide, Rest in Peace, Pithing Needle, Aether Vial, Delver, Bowmasters, The One Ring, Emrakul (turno extra), GSZ, Tron, Nethergoyf, Stock Up, Once Upon a Time. */
import { describe, expect, it } from 'vitest';
import { compileOracleCard, type OracleInput } from '../src/cards/oracle-parser.js';
import { forest, grizzlyBears, island, lightningBolt, mountain, plains, swamp } from '../src/cards/demo-set.js';
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

const wasteland = mk({ name: 'Wasteland', typeLine: 'Land', oracleText: '{T}: Add {C}.\n{T}, Sacrifice this land: Destroy target nonbasic land.' });
const brainstorm = mk({ name: 'Brainstorm', manaCost: '{U}', typeLine: 'Instant', colors: ['U'], oracleText: 'Draw three cards, then put two cards from your hand on top of your library in any order.' });
const daze = mk({ name: 'Daze', manaCost: '{1}{U}', typeLine: 'Instant', colors: ['U'], oracleText: "You may return an Island you control to its owner's hand rather than pay this spell's mana cost.\nCounter target spell unless its controller pays {1}." });
const snuffOut = mk({ name: 'Snuff Out', manaCost: '{3}{B}', typeLine: 'Instant', colors: ['B'], oracleText: "If you control a Swamp, you may pay 4 life rather than pay this spell's mana cost.\nDestroy target nonblack creature. It can't be regenerated." });
const forceOfNegation = mk({ name: 'Force of Negation', manaCost: '{1}{U}{U}', typeLine: 'Instant', colors: ['U'], oracleText: "If it's not your turn, you may exile a blue card from your hand rather than pay this spell's mana cost.\nCounter target noncreature spell. If that spell is countered this way, exile it instead of putting it into its owner's graveyard." });
const fatalPush = mk({ name: 'Fatal Push', manaCost: '{B}', typeLine: 'Instant', colors: ['B'], oracleText: 'Destroy target creature if it has mana value 2 or less.\nRevolt — Destroy that creature if it has mana value 4 or less instead if a permanent left the battlefield under your control this turn.' });
const hydroblast = mk({ name: 'Hydroblast', manaCost: '{U}', typeLine: 'Instant', colors: ['U'], oracleText: "Choose one —\n• Counter target spell if it's red.\n• Destroy target permanent if it's red." });
const reanimate = mk({ name: 'Reanimate', manaCost: '{B}', typeLine: 'Sorcery', colors: ['B'], oracleText: "Put target creature card from a graveyard onto the battlefield under your control. You lose life equal to that card's mana value." });
const showAndTell = mk({ name: 'Show and Tell', manaCost: '{2}{U}', typeLine: 'Sorcery', colors: ['U'], oracleText: 'Each player may put an artifact, creature, enchantment, or land card from their hand onto the battlefield.' });
const led = mk({ name: "Lion's Eye Diamond", manaCost: '{0}', typeLine: 'Artifact', oracleText: 'Discard your hand, Sacrifice this artifact: Add three mana of any one color. Activate only as an instant.' });
const spiritGuide = mk({ name: 'Simian Spirit Guide', manaCost: '{2}{R}', typeLine: 'Creature — Ape Spirit', power: 2, toughness: 2, colors: ['R'], oracleText: 'Exile this card from your hand: Add {R}.' });
const restInPeace = mk({ name: 'Rest in Peace', manaCost: '{1}{W}', typeLine: 'Enchantment', colors: ['W'], oracleText: 'When this enchantment enters, exile all graveyards.\nIf a card or token would be put into a graveyard from anywhere, exile it instead.' });
const pithingNeedle = mk({ name: 'Pithing Needle', manaCost: '{1}', typeLine: 'Artifact', oracleText: "As this artifact enters, choose a card name.\nActivated abilities of sources with the chosen name can't be activated unless they're mana abilities." });
const aetherVial = mk({ name: 'Aether Vial', manaCost: '{1}', typeLine: 'Artifact', oracleText: 'At the beginning of your upkeep, you may put a charge counter on this artifact.\n{T}: You may put a creature card with mana value equal to the number of charge counters on this artifact from your hand onto the battlefield.' });
const delver = mk({ name: 'Delver of Secrets', manaCost: '{U}', typeLine: 'Creature — Human Wizard', power: 1, toughness: 1, colors: ['U'], layout: 'transform', oracleText: 'At the beginning of your upkeep, look at the top card of your library. You may reveal that card. If an instant or sorcery card is revealed this way, transform this creature.', backFace: { name: 'Insectile Aberration', typeLine: 'Creature — Human Insect', power: 3, toughness: 2, colors: ['U'], oracleText: 'Flying' } });
const bowmasters = mk({ name: 'Orcish Bowmasters', manaCost: '{1}{B}', typeLine: 'Creature — Orc Archer', power: 1, toughness: 1, colors: ['B'], oracleText: 'Flash\nWhen this creature enters and whenever an opponent draws a card except the first one they draw in each of their draw steps, this creature deals 1 damage to any target. Then amass Orcs 1.' });
const oneRing = mk({ name: 'The One Ring', manaCost: '{4}', typeLine: 'Legendary Artifact', oracleText: 'Indestructible\nWhen The One Ring enters, if you cast it, you gain protection from everything until your next turn.\nAt the beginning of your upkeep, you lose 1 life for each burden counter on The One Ring.\n{T}: Put a burden counter on The One Ring, then draw a card for each burden counter on The One Ring.' });
const timeWalkish = mk({ name: 'Bear Walk', manaCost: '{1}{U}', typeLine: 'Sorcery', colors: ['U'], oracleText: 'Take an extra turn after this one.' });
const gsz = mk({ name: "Green Sun's Zenith", manaCost: '{X}{G}', typeLine: 'Sorcery', colors: ['G'], oracleText: "Search your library for a green creature card with mana value X or less, put it onto the battlefield, then shuffle. Shuffle Green Sun's Zenith into its owner's library." });
const tower = mk({ name: "Urza's Tower", typeLine: "Land — Urza's Tower", oracleText: "{T}: Add {C}. If you control an Urza's Mine and an Urza's Power-Plant, add {C}{C}{C} instead." });
const mine = mk({ name: "Urza's Mine", typeLine: "Land — Urza's Mine", oracleText: "{T}: Add {C}. If you control an Urza's Power-Plant and an Urza's Tower, add {C}{C} instead." });
const plant = mk({ name: "Urza's Power Plant", typeLine: "Land — Urza's Power-Plant", oracleText: "{T}: Add {C}. If you control an Urza's Mine and an Urza's Tower, add {C}{C} instead." });
const goyf = mk({ name: 'Nethergoyf', manaCost: '{B}', typeLine: 'Creature — Lhurgoyf', colors: ['B'], oracleText: "Nethergoyf's power is equal to the number of card types among cards in your graveyard and its toughness is equal to that number plus 1." });
const stockUp = mk({ name: 'Stock Up', manaCost: '{2}{U}', typeLine: 'Sorcery', colors: ['U'], oracleText: 'Look at the top five cards of your library. Put two of them into your hand and the rest on the bottom of your library in any order.' });
const onceUponATime = mk({ name: 'Once Upon a Time', manaCost: '{1}{G}', typeLine: 'Instant', colors: ['G'], oracleText: "If this spell is the first spell you've cast this game, you may cast it without paying its mana cost.\nLook at the top five cards of your library. You may reveal a creature or land card from among them and put it into your hand. Put the rest on the bottom of your library in a random order." });
const deafening = mk({ name: 'Deafening Silence', manaCost: '{W}', typeLine: 'Enchantment', colors: ['W'], oracleText: "Each player can't cast more than one noncreature spell each turn." });
const stony = mk({ name: 'Stony Silence', manaCost: '{1}{W}', typeLine: 'Enchantment', colors: ['W'], oracleText: "Activated abilities of artifacts can't be activated." });
const drc = mk({ name: "Dragon's Rage Channeler", manaCost: '{R}', typeLine: 'Creature — Human Shaman', power: 1, toughness: 1, colors: ['R'], oracleText: 'Whenever you cast a noncreature spell, surveil 1.\nDelirium — As long as there are four or more card types among cards in your graveyard, this creature gets +2/+2, has flying, and attacks each combat if able.' });

const ALL = [wasteland, brainstorm, daze, snuffOut, forceOfNegation, fatalPush, hydroblast, reanimate, showAndTell, led, spiritGuide, restInPeace, pithingNeedle, aetherVial, delver, bowmasters, oneRing, timeWalkish, gsz, tower, mine, plant, goyf, stockUp, onceUponATime, deafening, stony, drc];

describe('M22 · compilação', () => {
  it('tudo compila como full', () => {
    for (const c of ALL) expect(c.automation, `${c.name}: ${c.automationNotes?.join(' | ')}`).toBe('full');
    expect(wasteland.abilities?.[1]).toMatchObject({ cost: { tap: true, sacrificeSelf: true }, targets: [{ what: 'land', nonbasic: true }] });
    expect(brainstorm.spellEffect).toEqual([{ op: 'draw', who: 'controller', count: 3 }, { op: 'putHandOnTop', count: 2 }]);
    expect(daze.altCost).toMatchObject({ returnLand: { what: 'land', subtype: 'Island', controlledBy: 'you' } });
    expect(snuffOut.altCost).toMatchObject({ payLife: 4, condition: { kind: 'controlsAtLeast' } });
    expect(forceOfNegation.altCost).toMatchObject({ exileFromHand: { count: 1, filter: { color: 'U' } }, condition: { kind: 'not', cond: { kind: 'yourTurn' } } });
    expect(fatalPush.spellEffect?.[0]).toMatchObject({ op: 'if', cond: { kind: 'subjectIs', ref: 'target:0', filter: { cmcAtMost: 2 } } });
    expect(fatalPush.spellEffect?.[1]).toMatchObject({ op: 'if', cond: { kind: 'permanentLeftThisTurn' }, then: [{ op: 'if', cond: { kind: 'subjectIs', ref: 'target:0', filter: { cmcAtMost: 4 } } }] });
    expect(hydroblast.spellModes?.[0].effect[0]).toMatchObject({ op: 'if', cond: { kind: 'subjectIs', ref: 'target:0', filter: { color: 'R' } }, then: [{ op: 'counterSpell' }] });
    expect(reanimate.spellEffect?.[1]).toMatchObject({ op: 'loseLife', amount: { cmcOf: 'target:0' } });
    expect(showAndTell.spellEffect).toEqual([{ op: 'putFromHand', filter: { what: 'permanent', typeAnyOf: ['Artifact', 'Creature', 'Enchantment', 'Land'] }, who: 'controller' }, { op: 'putFromHand', filter: { what: 'permanent', typeAnyOf: ['Artifact', 'Creature', 'Enchantment', 'Land'] }, who: 'opponent' }]);
    expect(led.abilities?.[0]).toMatchObject({ cost: { discardHand: true, sacrificeSelf: true }, effect: [{ op: 'addManaChoice', count: 3 }], isManaAbility: true });
    expect(spiritGuide.abilities?.[0]).toMatchObject({ zone: 'hand', cost: { exileSelfFromHand: true }, isManaAbility: true });
    expect(restInPeace.exileInsteadOfGraveyardFor).toBe('all');
    expect(pithingNeedle).toMatchObject({ chooseOnEnter: 'cardName', lockChosenName: true });
    expect(aetherVial.abilities?.[1].effect[0]).toMatchObject({ op: 'mayDo', effect: [{ op: 'putFromHand', filter: { what: 'creature', cmcEqualsCountersOn: 'charge' } }] });
    expect(delver.abilities?.[0].effect[0]).toMatchObject({ op: 'if', cond: { kind: 'topCardIs', filter: { typeAnyOf: ['Instant', 'Sorcery'] } }, then: [{ op: 'transform', what: 'self' }] });
    expect(bowmasters.abilities?.map((a) => (a.kind === 'triggered' ? a.trigger.on : ''))).toEqual(['etb', 'opponentDrawsExtra']);
    expect(oneRing.abilities?.[0].effect[0]).toMatchObject({ op: 'playerProtection' });
    expect(timeWalkish.spellEffect).toEqual([{ op: 'extraTurn', who: 'controller' }]);
    expect(gsz.spellEffect).toEqual([{ op: 'search', filter: { what: 'creature', color: 'G', cmcAtMostX: true }, count: 1, to: 'battlefield' }, { op: 'shuffleSelfIntoLibrary' }]);
    expect(tower.abilities?.[0].effect[1]).toMatchObject({ op: 'if', then: [{ op: 'addMana', mana: ['C', 'C'] }] });
    expect(goyf.cdaPower).toEqual({ cardTypesInGraveyard: 'controller' });
    expect(stockUp.spellEffect).toEqual([{ op: 'digTop', count: 5, pick: 2, rest: 'bottom' }]);
    expect(onceUponATime.altCost).toMatchObject({ free: true, condition: { kind: 'firstSpellThisGame' } });
    expect(deafening.oneSpellPerTurn).toBe('noncreature');
    expect(stony.artifactAbilitiesLocked).toBe(true);
    expect(drc.abilities?.[1]).toMatchObject({ kind: 'static', condition: { kind: 'delirium' }, power: 2, keywords: ['flying', 'mustAttack'] });
  });
});

describe('M22 · jogo', () => {
  it('Wasteland destrói terreno não básico e não pode mirar básico', () => {
    const game = makeGame([...FILLER, wasteland], [...FILLER, tower], { topP1: [wasteland.id], topP2: [tower.id] });
    goToMain1(game);
    const w = put(game, 'p1', wasteland.id);
    const t = put(game, 'p2', tower.id);
    const basic = put(game, 'p2', 'plains');
    expect(game.apply('p1', { type: 'activateAbility', objectId: w, abilityIndex: 1, targets: [{ kind: 'object', id: basic }] }).ok).toBe(false);
    expect(game.apply('p1', { type: 'activateAbility', objectId: w, abilityIndex: 1, targets: [{ kind: 'object', id: t }] }).ok).toBe(true);
    settle(game);
    expect(game.state.objects[t].zone).toBe('graveyard');
    expect(game.state.objects[w].zone).toBe('graveyard');
  });

  it('Brainstorm: compra 3 e devolve 2 na ordem escolhida', () => {
    const game = makeGame([...FILLER, brainstorm], FILLER, { topP1: [brainstorm.id] });
    goToMain1(game);
    put(game, 'p1', 'island');
    const before = game.state.players.p1.zones.hand.length;
    expect(cast(game, 'p1', findIn(game, 'p1', 'hand', brainstorm.id)).ok).toBe(true);
    untilChoice(game);
    const pd = game.state.pendingDecision;
    expect(pd?.type).toBe('effectChoice');
    const hand = game.state.players.p1.zones.hand;
    const picks = [hand[1], hand[0]];
    game.apply('p1', { type: 'effectChoice', picks });
    settle(game);
    expect(game.state.players.p1.zones.library.slice(0, 2)).toEqual(picks);
    expect(game.state.players.p1.zones.hand.length).toBe(before - 1 + 3 - 2);
  });

  it('Daze: devolve uma Ilha em vez de pagar; Snuff Out exige Pântano', () => {
    const game = makeGame([...FILLER, daze, snuffOut], [...FILLER, lightningBolt, grizzlyBears], { topP1: [daze.id, snuffOut.id], topP2: ['lightning-bolt', 'grizzly-bears'] });
    goToMain1(game);
    const isl = put(game, 'p1', 'island');
    game.apply('p1', { type: 'manualTap', objectId: isl, tapped: true });
    const bears = put(game, 'p2', 'grizzly-bears');
    // Snuff Out sem Pântano: recusado; com Pântano: paga 4 de vida.
    const snuff = findIn(game, 'p1', 'hand', snuffOut.id);
    expect(cast(game, 'p1', snuff, { useAltCost: true, targets: [{ kind: 'object', id: bears }] }).ok).toBe(false);
    put(game, 'p1', 'swamp');
    expect(cast(game, 'p1', snuff, { useAltCost: true, targets: [{ kind: 'object', id: bears }] }).ok).toBe(true);
    settle(game);
    expect(game.state.players.p1.life).toBe(16);
    expect(game.state.objects[bears].zone).toBe('graveyard');
    // Daze no turno do oponente contra o Bolt.
    toMain1Turn(game, 2, 'p2');
    put(game, 'p2', 'mountain');
    expect(cast(game, 'p2', findIn(game, 'p2', 'hand', 'lightning-bolt'), { targets: [{ kind: 'player', player: 'p1' }] }).ok).toBe(true);
    const bolt = game.state.stack[0];
    game.apply('p2', { type: 'passPriority' }); // o conjurador passa; p1 responde com Daze
    expect(cast(game, 'p1', findIn(game, 'p1', 'hand', daze.id), { useAltCost: true, targets: [{ kind: 'object', id: bolt.sourceId }] })).toMatchObject({ ok: true });
    expect(game.state.objects[isl].zone).toBe('hand');
    settle(game);
    expect(game.state.players.p1.life).toBe(16); // Bolt anulado (oponente não paga {1})
  });

  it('Fatal Push: só destrói valor de mana ≤ 2 (≤ 4 com revolta)', () => {
    const big = mk({ name: 'Big Bear', manaCost: '{3}{G}', typeLine: 'Creature — Bear', power: 4, toughness: 4, colors: ['G'] });
    const game = makeGame([...FILLER, fatalPush, fatalPush], [...FILLER, grizzlyBears, big], { topP1: [fatalPush.id, fatalPush.id], topP2: ['grizzly-bears', big.id] });
    goToMain1(game);
    const bears = put(game, 'p2', 'grizzly-bears');
    const bigId = put(game, 'p2', big.id);
    put(game, 'p1', 'swamp'); put(game, 'p1', 'swamp');
    expect(cast(game, 'p1', findIn(game, 'p1', 'hand', fatalPush.id), { targets: [{ kind: 'object', id: bigId }] }).ok).toBe(true);
    settle(game);
    expect(game.state.objects[bigId].zone).toBe('battlefield');
    expect(cast(game, 'p1', findIn(game, 'p1', 'hand', fatalPush.id), { targets: [{ kind: 'object', id: bears }] }).ok).toBe(true);
    settle(game);
    expect(game.state.objects[bears].zone).toBe('graveyard');
  });

  it('Reanimate: volta do cemitério do oponente e perde vida igual ao valor de mana', () => {
    const game = makeGame([...FILLER, reanimate], [...FILLER, grizzlyBears], { topP1: [reanimate.id], topP2: ['grizzly-bears'] });
    goToMain1(game);
    const bears = put(game, 'p2', 'grizzly-bears', 'graveyard');
    put(game, 'p1', 'swamp');
    expect(cast(game, 'p1', findIn(game, 'p1', 'hand', reanimate.id), { targets: [{ kind: 'object', id: bears }] }).ok).toBe(true);
    settle(game);
    expect(game.state.objects[bears].zone).toBe('battlefield');
    expect(game.state.objects[bears].controller).toBe('p1');
    expect(game.state.players.p1.life).toBe(18);
  });

  it('Show and Tell: cada jogador escolhe', () => {
    const game = makeGame([...FILLER, showAndTell, grizzlyBears], [...FILLER, grizzlyBears], { topP1: [showAndTell.id, 'grizzly-bears'], topP2: ['grizzly-bears'] });
    goToMain1(game);
    put(game, 'p1', 'island'); put(game, 'p1', 'island'); put(game, 'p1', 'island');
    const mine1 = findIn(game, 'p1', 'hand', 'grizzly-bears');
    const theirs = put(game, 'p2', 'grizzly-bears', 'hand');
    expect(cast(game, 'p1', findIn(game, 'p1', 'hand', showAndTell.id)).ok).toBe(true);
    untilChoice(game);
    expect(game.state.pendingDecision?.type === 'effectChoice' && game.state.pendingDecision.player).toBe('p1');
    game.apply('p1', { type: 'effectChoice', picks: [mine1] });
    untilChoice(game);
    expect(game.state.pendingDecision?.type === 'effectChoice' && game.state.pendingDecision.player).toBe('p2');
    game.apply('p2', { type: 'effectChoice', picks: [theirs] });
    settle(game);
    expect(game.state.objects[mine1].zone).toBe('battlefield');
    expect(game.state.objects[theirs].zone).toBe('battlefield');
    expect(game.state.objects[theirs].controller).toBe('p2');
  });

  it('LED e Spirit Guide: mana da mão e descartando a mão', () => {
    const game = makeGame([...FILLER, led, spiritGuide], FILLER, { topP1: [led.id, spiritGuide.id] });
    goToMain1(game);
    const guide = findIn(game, 'p1', 'hand', spiritGuide.id);
    expect(game.apply('p1', { type: 'activateAbility', objectId: guide, abilityIndex: 0 }).ok).toBe(true);
    expect(game.state.objects[guide].zone).toBe('exile');
    expect(game.state.players.p1.manaPool.R).toBe(1);
    const diamond = put(game, 'p1', led.id);
    expect(game.apply('p1', { type: 'activateAbility', objectId: diamond, abilityIndex: 0, manaColor: 'B' }).ok).toBe(true);
    expect(game.state.players.p1.manaPool.B).toBe(3);
    expect(game.state.players.p1.zones.hand.length).toBe(0);
    expect(game.state.objects[diamond].zone).toBe('graveyard');
  });

  it('Rest in Peace: exila cemitérios e cartas que iriam para lá', () => {
    const game = makeGame([...FILLER, restInPeace, lightningBolt], [...FILLER, grizzlyBears], { topP1: [restInPeace.id, 'lightning-bolt'], topP2: ['grizzly-bears'] });
    goToMain1(game);
    const dead = put(game, 'p2', 'grizzly-bears', 'graveyard');
    put(game, 'p1', 'plains'); put(game, 'p1', 'plains'); put(game, 'p1', 'mountain');
    expect(cast(game, 'p1', findIn(game, 'p1', 'hand', restInPeace.id)).ok).toBe(true);
    settle(game);
    expect(game.state.objects[dead].zone).toBe('exile');
    const bolt = findIn(game, 'p1', 'hand', 'lightning-bolt');
    expect(cast(game, 'p1', bolt, { targets: [{ kind: 'player', player: 'p2' }] }).ok).toBe(true);
    settle(game);
    expect(game.state.objects[bolt].zone).toBe('exile');
  });

  it('Pithing Needle trava a habilidade com o nome escolhido', () => {
    const game = makeGame([...FILLER, pithingNeedle], [...FILLER, wasteland], { topP1: [pithingNeedle.id], topP2: [wasteland.id] });
    goToMain1(game);
    put(game, 'p1', 'plains');
    const needle = findIn(game, 'p1', 'hand', pithingNeedle.id);
    expect(cast(game, 'p1', needle).ok).toBe(true);
    untilChoice(game);
    expect(game.state.pendingDecision?.type).toBe('effectChoice');
    game.apply('p1', { type: 'effectChoice', picks: [], text: 'Wasteland' });
    settle(game);
    expect(game.state.objects[needle].chosenName).toBe('Wasteland');
    toMain1Turn(game, 2, 'p2');
    const w = put(game, 'p2', wasteland.id);
    const t = put(game, 'p1', 'forest');
    expect(game.apply('p2', { type: 'activateAbility', objectId: w, abilityIndex: 0 }).ok).toBe(true); // mana continua
    game.apply('p2', { type: 'manualTap', objectId: w, tapped: false });
    expect(game.apply('p2', { type: 'activateAbility', objectId: w, abilityIndex: 1, targets: [{ kind: 'object', id: t }] }).ok).toBe(false);
  });

  it('Delver transforma quando o topo é instantâneo', () => {
    const game = makeGame([...FILLER, delver, lightningBolt], FILLER, { topP1: [delver.id, 'lightning-bolt'] });
    goToMain1(game);
    const d = put(game, 'p1', delver.id);
    const bolt = findIn(game, 'p1', 'hand', 'lightning-bolt');
    game.apply('p1', { type: 'manualMove', objectId: bolt, to: 'library', position: 'top' });
    toMain1Turn(game, 3);
    expect(game.state.objects[d].card.name).toBe('Insectile Aberration');
  });

  it('Bowmasters atira quando o oponente compra fora do passo de compra', () => {
    const game = makeGame([...FILLER, bowmasters], [...FILLER, brainstorm], { topP1: [bowmasters.id], topP2: [brainstorm.id] });
    goToMain1(game);
    put(game, 'p1', 'swamp'); put(game, 'p1', 'swamp');
    expect(cast(game, 'p1', findIn(game, 'p1', 'hand', bowmasters.id)).ok).toBe(true);
    passUntil(game, (s) => s.pendingDecision?.type === 'chooseTargets' || (s.stack.length === 0 && s.triggerQueue.length === 0 && s.pendingDecision === null));
    if (game.state.pendingDecision?.type === 'chooseTargets') game.apply('p1', { type: 'chooseTargets', targets: [{ kind: 'player', player: 'p2' }] });
    settle(game);
    expect(game.state.players.p2.life).toBe(19);
    toMain1Turn(game, 2, 'p2');
    expect(game.state.players.p2.life).toBe(19); // compra do passo de compra não dispara
    put(game, 'p2', 'island');
    expect(cast(game, 'p2', findIn(game, 'p2', 'hand', brainstorm.id)).ok).toBe(true);
    passUntil(game, (s) => s.pendingDecision !== null, 200);
    // Brainstorm compra 3: três gatilhos de Bowmasters (alvos) intercalados com a escolha do Brainstorm.
    let guard = 20;
    while (guard-- > 0 && game.state.pendingDecision) {
      const pd = game.state.pendingDecision;
      if (pd.type === 'chooseTargets') game.apply('p1', { type: 'chooseTargets', targets: [{ kind: 'player', player: 'p2' }] });
      else if (pd.type === 'effectChoice') game.apply(pd.player, { type: 'effectChoice', picks: game.state.players.p2.zones.hand.slice(0, 2) });
      passUntil(game, (s) => s.pendingDecision !== null || (s.stack.length === 0 && s.triggerQueue.length === 0), 200);
    }
    settle(game);
    expect(game.state.players.p2.life).toBe(16);
  });

  it('The One Ring: proteção contra tudo até o próximo turno, marcadores e compras', () => {
    const game = makeGame([...FILLER, oneRing], [...FILLER, lightningBolt], { topP1: [oneRing.id], topP2: ['lightning-bolt'] });
    goToMain1(game);
    for (let i = 0; i < 4; i++) put(game, 'p1', 'plains');
    const ring = findIn(game, 'p1', 'hand', oneRing.id);
    expect(cast(game, 'p1', ring).ok).toBe(true);
    settle(game);
    toMain1Turn(game, 2, 'p2');
    put(game, 'p2', 'mountain');
    expect(cast(game, 'p2', findIn(game, 'p2', 'hand', 'lightning-bolt'), { targets: [{ kind: 'player', player: 'p1' }] }).ok).toBe(false); // alvo ilegal
    toMain1Turn(game, 3);
    const before = game.state.players.p1.zones.hand.length;
    expect(game.apply('p1', { type: 'activateAbility', objectId: ring, abilityIndex: 2 }).ok).toBe(true);
    settle(game);
    expect(game.state.objects[ring].counters['burden']).toBe(1);
    expect(game.state.players.p1.zones.hand.length).toBe(before + 1);
    toMain1Turn(game, 5);
    expect(game.state.players.p1.life).toBe(19); // upkeep: perde 1 por marcador
  });

  it('turno extra', () => {
    const game = makeGame([...FILLER, timeWalkish], FILLER, { topP1: [timeWalkish.id] });
    goToMain1(game);
    put(game, 'p1', 'island'); put(game, 'p1', 'island');
    expect(cast(game, 'p1', findIn(game, 'p1', 'hand', timeWalkish.id)).ok).toBe(true);
    settle(game);
    passUntil(game, (s) => s.turn === 2 && s.step === 'main1' && s.stack.length === 0 && s.pendingDecision === null);
    expect(game.state.activePlayer).toBe('p1');
    passUntil(game, (s) => s.turn === 3 && s.step === 'main1');
    expect(game.state.activePlayer).toBe('p2');
  });

  it("Green Sun's Zenith: busca com X e volta para a biblioteca", () => {
    const game = makeGame([...FILLER, gsz, grizzlyBears], FILLER, { topP1: [gsz.id, 'grizzly-bears'] });
    goToMain1(game);
    const bears = findIn(game, 'p1', 'hand', 'grizzly-bears');
    game.apply('p1', { type: 'manualMove', objectId: bears, to: 'library', position: 'bottom' });
    put(game, 'p1', 'forest'); put(game, 'p1', 'forest'); put(game, 'p1', 'forest');
    const z = findIn(game, 'p1', 'hand', gsz.id);
    expect(cast(game, 'p1', z, { x: 2 }).ok).toBe(true);
    untilChoice(game);
    const pd = game.state.pendingDecision;
    expect(pd?.type).toBe('effectChoice');
    if (pd?.type === 'effectChoice') { expect(pd.options).toContain(bears); game.apply('p1', { type: 'effectChoice', picks: [bears] }); }
    settle(game);
    expect(game.state.objects[bears].zone).toBe('battlefield');
    expect(game.state.objects[z].zone).toBe('library');
  });

  it('Tron completo produz 7 manas', () => {
    const game = makeGame([...FILLER, tower, mine, plant], FILLER, { topP1: [tower.id, mine.id, plant.id] });
    goToMain1(game);
    const t = put(game, 'p1', tower.id);
    expect(game.apply('p1', { type: 'activateAbility', objectId: t, abilityIndex: 0 }).ok).toBe(true);
    expect(game.state.players.p1.manaPool.C).toBe(1);
    game.apply('p1', { type: 'manualTap', objectId: t, tapped: false });
    const m = put(game, 'p1', mine.id);
    const p = put(game, 'p1', plant.id);
    expect(game.apply('p1', { type: 'activateAbility', objectId: t, abilityIndex: 0 }).ok).toBe(true);
    expect(game.apply('p1', { type: 'activateAbility', objectId: m, abilityIndex: 0 }).ok).toBe(true);
    expect(game.apply('p1', { type: 'activateAbility', objectId: p, abilityIndex: 0 }).ok).toBe(true);
    expect(game.state.players.p1.manaPool.C).toBe(1 + 3 + 2 + 2);
  });

  it('Nethergoyf conta tipos de carta no cemitério', () => {
    const game = makeGame([...FILLER, goyf, lightningBolt, grizzlyBears], FILLER, { topP1: [goyf.id, 'lightning-bolt', 'grizzly-bears'] });
    goToMain1(game);
    const g = put(game, 'p1', goyf.id);
    expect(effectivePower(game.state, game.state.objects[g])).toBe(0);
    expect(effectiveToughness(game.state, game.state.objects[g])).toBe(1);
    put(game, 'p1', 'lightning-bolt', 'graveyard');
    put(game, 'p1', 'grizzly-bears', 'graveyard');
    put(game, 'p1', 'forest', 'graveyard');
    expect(effectivePower(game.state, game.state.objects[g])).toBe(3);
    expect(effectiveToughness(game.state, game.state.objects[g])).toBe(4);
  });

  it('Once Upon a Time de graça como primeira mágica; Deafening Silence limita não-criaturas', () => {
    const game = makeGame([...FILLER, onceUponATime, deafening, lightningBolt], FILLER, { topP1: [onceUponATime.id, deafening.id, 'lightning-bolt'] });
    goToMain1(game);
    expect(cast(game, 'p1', findIn(game, 'p1', 'hand', onceUponATime.id), { useAltCost: true }).ok).toBe(true);
    untilChoice(game);
    if (game.state.pendingDecision?.type === 'effectChoice') game.apply('p1', { type: 'effectChoice', picks: [] });
    settle(game);
    put(game, 'p1', 'plains'); put(game, 'p1', 'mountain');
    toMain1Turn(game, 3);
    expect(cast(game, 'p1', findIn(game, 'p1', 'hand', deafening.id)).ok).toBe(true);
    settle(game);
    expect(cast(game, 'p1', findIn(game, 'p1', 'hand', 'lightning-bolt'), { targets: [{ kind: 'player', player: 'p2' }] }).ok).toBe(false);
  });
});
