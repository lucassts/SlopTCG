/** M19 (Leva 5, gramática 2): custos adicionais genéricos, Spree, custos de ativação novos, Enchant generalizado, "return the exiled card", habilidades do cemitério, busca genérica, condições de turno, estáticas e gatilhos novos. */
import { describe, expect, it } from 'vitest';
import { compileOracleCard, type OracleInput } from '../src/cards/oracle-parser.js';
import { bonesplitter, forest, grizzlyBears, island, lightningBolt, mountain, plains, swamp } from '../src/cards/demo-set.js';
import type { CardDefinition } from '../src/cards/types.js';
import type { Game } from '../src/game.js';
import type { PlayerId } from '../src/types.js';
import { effectivePower } from '../src/state.js';
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
const abilityIdx = (def: CardDefinition, pred: (a: NonNullable<CardDefinition['abilities']>[number]) => boolean) => {
  const i = (def.abilities ?? []).findIndex(pred);
  if (i < 0) throw new Error(`habilidade não encontrada em ${def.name}`);
  return i;
};

// ---- custos adicionais e Spree
const discardCost = mk({ name: 'Bear Tutelage', manaCost: '{U}', typeLine: 'Sorcery', colors: ['U'], oracleText: 'As an additional cost to cast this spell, discard a card.\nDraw two cards.' });
const lifeCost = mk({ name: 'Blood Bear Pact', manaCost: '{B}', typeLine: 'Instant', colors: ['B'], oracleText: 'As an additional cost to cast this spell, pay 2 life.\nDraw a card.' });
const gyExileCost = mk({ name: 'Bear Remembrance', manaCost: '{G}', typeLine: 'Instant', colors: ['G'], oracleText: 'As an additional cost to cast this spell, exile a creature card from your graveyard.\nDraw a card.' });
const sacArtOrCreature = mk({ name: 'Bear Fling', manaCost: '{1}{R}', typeLine: 'Instant', colors: ['R'], oracleText: 'As an additional cost to cast this spell, sacrifice an artifact or creature.\nBear Fling deals 3 damage to any target.' });
const spree = mk({ name: 'Bear Spree', manaCost: '{R}', typeLine: 'Instant', colors: ['R'], oracleText: 'Spree (Choose one or more additional costs.)\n+ {1} — Draw a card.\n+ {2} — You gain 3 life.' });

// ---- Enchant generalizado e cartas exiladas
const enchantArtOrCreature = mk({ name: 'Bear Shackles', manaCost: '{W}', typeLine: 'Enchantment — Aura', colors: ['W'], oracleText: 'Enchant artifact or creature\nEnchanted permanent gets +1/+1.' });
const disenchant = mk({ name: 'Bear Disenchant', manaCost: '{1}{W}', typeLine: 'Instant', colors: ['W'], oracleText: 'Destroy target enchantment.' });
const oblivion = mk({ name: 'Bear Ring', manaCost: '{2}{W}', typeLine: 'Enchantment', colors: ['W'], oracleText: 'When Bear Ring enters, exile target creature an opponent controls.\nWhen Bear Ring leaves the battlefield, return the exiled card to the battlefield under its owner\'s control.' });

// ---- custos de ativação e habilidades do cemitério
const sporeBear = mk({ name: 'Spore Bear', manaCost: '{1}{G}', typeLine: 'Creature — Bear', power: 1, toughness: 1, colors: ['G'], oracleText: 'Spore Bear enters with three spore counters on it.\nRemove three spore counters from Spore Bear: Create a 1/1 green Saproling creature token.' });
const gyReturn = mk({ name: 'Returning Bear', manaCost: '{1}{B}', typeLine: 'Creature — Bear', power: 2, toughness: 2, colors: ['B'], oracleText: '{1}{B}: Return this card from your graveyard to your hand.' });
const gyExileAct = mk({ name: 'Bear Reliquary', manaCost: '{2}', typeLine: 'Artifact', oracleText: '{T}, Exile a creature card from your graveyard: Draw a card.' });
const manaOptions = mk({ name: 'Bear Prism', manaCost: '{2}', typeLine: 'Artifact', oracleText: 'As Bear Prism enters, choose a color.\n{T}: Add {C} or one mana of the chosen color.' });
const tapCreatureMana = mk({ name: 'Bear Cradle', manaCost: '{1}', typeLine: 'Artifact', oracleText: '{1}, Tap an untapped creature you control: Add one mana of any color.' });

// ---- estáticas e substituições
const tappedUnless = mk({ name: 'Bear Cavern', typeLine: 'Land', oracleText: 'Bear Cavern enters tapped unless you control two or more basic lands.\n{T}: Add {G}.' });
const lonelyBear = mk({ name: 'Lonely Bear', manaCost: '{1}{G}', typeLine: 'Creature — Bear', power: 3, toughness: 3, colors: ['G'], oracleText: 'Lonely Bear can\'t attack alone.' });
const prowessish = mk({ name: 'Spell Bear', manaCost: '{1}{R}', typeLine: 'Creature — Bear', power: 2, toughness: 2, colors: ['R'], oracleText: 'Spell Bear gets +1/+1 as long as you\'ve cast a noncreature spell this turn.' });
const topCaster = mk({ name: 'Bear Oracle', manaCost: '{2}{G}', typeLine: 'Enchantment', colors: ['G'], oracleText: 'You may cast creature spells from the top of your library.' });
const gyLands = mk({ name: 'Bear Crucible', manaCost: '{3}', typeLine: 'Artifact', oracleText: 'You may play lands from your graveyard.' });
const shieldCounters = mk({ name: 'Shielded Bear', manaCost: '{2}{W}', typeLine: 'Creature — Bear', power: 1, toughness: 1, colors: ['W'], oracleText: 'Shielded Bear enters with three +1/+1 counters on it.\nIf damage would be dealt to Shielded Bear, prevent that damage. Remove a +1/+1 counter from Shielded Bear.' });
const yourTurnStatic = mk({ name: 'Hasty Den', manaCost: '{1}{R}', typeLine: 'Enchantment', colors: ['R'], oracleText: 'During your turn, creatures you control have haste.' });
const unblockedAssign = mk({ name: 'Slippery Bear', manaCost: '{1}{U}', typeLine: 'Creature — Bear', power: 2, toughness: 2, colors: ['U'], oracleText: 'You may have Slippery Bear assign its combat damage as though it weren\'t blocked.' });
const oneSpell = mk({ name: 'Bear Rule', manaCost: '{1}{W}', typeLine: 'Enchantment', colors: ['W'], oracleText: 'Each player can\'t cast more than one spell each turn.' });

// ---- gatilhos e efeitos novos
const untapTrigger = mk({ name: 'Waking Bear', manaCost: '{1}{G}', typeLine: 'Creature — Bear', power: 2, toughness: 2, colors: ['G'], oracleText: 'Whenever Waking Bear becomes untapped, you gain 1 life.' });
const cycleTrigger = mk({ name: 'Cycling Bear', manaCost: '{3}{G}', typeLine: 'Creature — Bear', power: 3, toughness: 3, colors: ['G'], oracleText: 'Cycling {2}\nWhen you cycle Cycling Bear, you gain 2 life.' });
const exileIfDies = mk({ name: 'Bear Flame', manaCost: '{1}{R}', typeLine: 'Instant', colors: ['R'], oracleText: 'Bear Flame deals 3 damage to target creature. If that creature would die this turn, exile it instead.' });
const bounceLand = mk({ name: 'Bounce Bear', manaCost: '{G}', typeLine: 'Creature — Bear', power: 1, toughness: 1, colors: ['G'], oracleText: 'When Bounce Bear enters, return a land you control to its owner\'s hand.' });
const damagedDies = mk({ name: 'Hunter Bear', manaCost: '{2}{G}', typeLine: 'Creature — Bear', power: 3, toughness: 3, colors: ['G'], oracleText: 'Whenever a creature dealt damage by Hunter Bear this turn dies, put a +1/+1 counter on Hunter Bear.' });
const gyExileSpell = mk({ name: 'Bear Purge', manaCost: '{B}', typeLine: 'Instant', colors: ['B'], oracleText: 'Exile target player\'s graveyard.' });
const returnGy = mk({ name: 'Bear Regrowth', manaCost: '{1}{G}', typeLine: 'Sorcery', colors: ['G'], oracleText: 'Return up to two target creature cards from your graveyard to your hand.' });
const entersOrDies = mk({ name: 'Cycle Bear', manaCost: '{1}{B}', typeLine: 'Creature — Bear', power: 2, toughness: 2, colors: ['B'], oracleText: 'When Cycle Bear enters or dies, draw a card.' });
const attacksAlone = mk({ name: 'Solo Bear', manaCost: '{1}{R}', typeLine: 'Creature — Bear', power: 2, toughness: 2, colors: ['R'], oracleText: 'Whenever Solo Bear attacks alone, it gets +2/+0 until end of turn.' });
const constellation = mk({ name: 'Star Bear', manaCost: '{1}{W}', typeLine: 'Enchantment Creature — Bear', power: 2, toughness: 2, colors: ['W'], oracleText: 'Constellation — Whenever Star Bear or another enchantment you control enters, you gain 1 life.' });
const genericSearch = mk({ name: 'Bear Recruiter', manaCost: '{1}{W}', typeLine: 'Creature — Bear', power: 1, toughness: 1, colors: ['W'], oracleText: '{T}: Search your library for a Bear permanent card with mana value 2 or less, put it onto the battlefield, then shuffle.' });
const lookTop = mk({ name: 'Seer Bear', manaCost: '{1}{U}', typeLine: 'Creature — Bear', power: 1, toughness: 1, colors: ['U'], oracleText: 'When Seer Bear enters, look at the top four cards of your library, then put them back in any order.' });
const delayedDraw = mk({ name: 'Patient Bear', manaCost: '{1}{U}', typeLine: 'Creature — Bear', power: 1, toughness: 1, colors: ['U'], oracleText: 'When Patient Bear enters, draw a card at the beginning of the next turn\'s upkeep.' });
const mustBlock = mk({ name: 'Bear Taunt', manaCost: '{R}', typeLine: 'Instant', colors: ['R'], oracleText: 'Target creature blocks Bear Taunt this turn if able.' });
const learnSpell = mk({ name: 'Bear Lesson', manaCost: '{U}', typeLine: 'Instant', colors: ['U'], oracleText: 'Draw a card. Learn.' });
const multicolorTrig = mk({ name: 'Prism Bear', manaCost: '{1}{G}', typeLine: 'Creature — Bear', power: 2, toughness: 2, colors: ['G'], oracleText: 'Whenever you cast a multicolored spell, you gain 1 life.' });
const tapAndFreeze = mk({ name: 'Frost Bear', manaCost: '{2}{U}', typeLine: 'Creature — Bear', power: 2, toughness: 2, colors: ['U'], oracleText: 'Whenever Frost Bear deals combat damage to a creature, tap that creature and it doesn\'t untap during its controller\'s next untap step.' });

const ALL = [discardCost, lifeCost, gyExileCost, sacArtOrCreature, spree, enchantArtOrCreature, oblivion, sporeBear, gyReturn, gyExileAct, manaOptions, tapCreatureMana, tappedUnless, lonelyBear, prowessish, topCaster, gyLands, shieldCounters, yourTurnStatic, unblockedAssign, oneSpell, untapTrigger, cycleTrigger, exileIfDies, bounceLand, damagedDies, gyExileSpell, returnGy, entersOrDies, attacksAlone, constellation, genericSearch, lookTop, delayedDraw, mustBlock, learnSpell, multicolorTrig, tapAndFreeze];

describe('M19 · compilação', () => {
  it('tudo compila como full', () => {
    for (const c of ALL) expect(c.automation, `${c.name}: ${c.automationNotes?.join(' | ')}`).toBe('full');
  });
  it('estruturas esperadas', () => {
    expect(discardCost.additionalCost).toEqual({ discard: 1 });
    expect(lifeCost.additionalCost).toEqual({ payLife: 2 });
    expect(gyExileCost.additionalCost).toMatchObject({ exileFromGraveyard: { filter: { what: 'creature' }, count: 1 } });
    expect(sacArtOrCreature.additionalCost).toMatchObject({ sacrifice: { what: 'permanent', typeAnyOf: ['Artifact', 'Creature'] }, count: 1 });
    expect(spree.spellModeChoice).toEqual({ min: 1, max: 99 });
    expect(spree.spellModes?.map((m) => m.cost)).toEqual(['{1}', '{2}']);
    expect(enchantArtOrCreature.enchant).toMatchObject({ what: 'permanent', typeAnyOf: ['Artifact', 'Creature'] });
    expect(oblivion.abilities?.[1].effect[0]).toEqual({ op: 'returnExiledBy', to: 'battlefield' });
    expect(sporeBear.abilities?.[0]).toMatchObject({ kind: 'activated', cost: { removeCounters: { counter: 'spore', count: 3 } } });
    expect(gyReturn.abilities?.[0]).toMatchObject({ kind: 'activated', zone: 'graveyard', cost: { mana: '{1}{B}' }, effect: [{ op: 'returnToHand', what: 'self' }] });
    expect(gyExileAct.abilities?.[0]).toMatchObject({ cost: { tap: true, exileFromGraveyard: { filter: { what: 'creature' }, count: 1 } } });
    expect(manaOptions.abilities?.[0]).toMatchObject({ isManaAbility: true, effect: [{ op: 'addManaOptions', options: ['C'], chosenColor: true }] });
    expect(tapCreatureMana.abilities?.[0]).toMatchObject({ isManaAbility: true, cost: { mana: '{1}', tapCreature: true }, effect: [{ op: 'addManaChoice' }] });
    expect(tappedUnless.entersTappedUnlessCond).toMatchObject({ kind: 'controlsAtLeast', count: 2, filter: { what: 'land', basic: true } });
    expect(lonelyBear.cantAttackAlone).toBe(true);
    expect(prowessish.abilities?.[0]).toMatchObject({ kind: 'static', condition: { kind: 'castNoncreatureThisTurn' }, power: 1 });
    expect(topCaster.castFromLibraryTop).toEqual({ what: 'creature' });
    expect(gyLands.playLandsFromGraveyard).toBe(true);
    expect(shieldCounters.preventDamageRemoveCounter).toBe('+1/+1');
    expect(yourTurnStatic.abilities?.[0]).toMatchObject({ kind: 'static', condition: { kind: 'yourTurn' }, keywords: ['haste'] });
    expect(unblockedAssign.assignAsUnblocked).toBe(true);
    expect(oneSpell.oneSpellPerTurn).toBe(true);
    expect(untapTrigger.abilities?.[0]).toMatchObject({ trigger: { on: 'becomesUntapped', self: true } });
    expect(cycleTrigger.cyclingTrigger).toEqual([{ op: 'gainLife', who: 'controller', amount: 2 }]);
    expect(exileIfDies.spellEffect?.[0]).toMatchObject({ op: 'damage', amount: 3, exileIfDies: true });
    expect(bounceLand.abilities?.[0].effect[0]).toMatchObject({ op: 'bounceOwn', filter: { what: 'land', controlledBy: 'you' } });
    expect(damagedDies.abilities?.[0]).toMatchObject({ trigger: { on: 'damagedCreatureDies', self: true } });
    expect(gyExileSpell.spellTargets).toEqual([{ what: 'player' }]);
    expect(gyExileSpell.spellEffect?.[0]).toEqual({ op: 'exileGraveyard', who: 'target:0' });
    expect(returnGy.spellTargets).toHaveLength(2);
    expect(returnGy.spellTargets?.[0]).toMatchObject({ what: 'creature', zone: 'graveyard', ownedBy: 'you', optional: true });
    expect(entersOrDies.abilities?.map((a) => (a.kind === 'triggered' ? a.trigger.on : ''))).toEqual(['etb', 'dies']);
    expect(attacksAlone.abilities?.[0]).toMatchObject({ condition: { kind: 'attackedAlone' } });
    expect(constellation.abilities?.[0]).toMatchObject({ trigger: { on: 'etb', what: { what: 'enchantment', controlledBy: 'you', other: true } } });
    expect(genericSearch.abilities?.[0].effect[0]).toMatchObject({ op: 'search', filter: { what: 'permanent', subtype: 'Bear', cmcAtMost: 2 }, to: 'battlefield' });
    expect(lookTop.abilities?.[0].effect[0]).toEqual({ op: 'reorderTop', count: 4 });
    expect(delayedDraw.abilities?.[0].effect[0]).toMatchObject({ op: 'delayedEffect', at: 'nextUpkeep' });
    expect(mustBlock.spellEffect?.[0]).toEqual({ op: 'mustBlockSource', what: 'target:0' });
    expect(learnSpell.spellEffect?.[1]).toEqual({ op: 'learn' });
    expect(multicolorTrig.abilities?.[0]).toMatchObject({ trigger: { on: 'youCastSpellOf', filter: { multicolored: true } } });
    expect(tapAndFreeze.abilities?.[0].effect).toHaveLength(2);
  });
  it('"Enchant player" continua fora do escopo', () => {
    expect(compileOracleCard({ name: 'Curse of Bears', manaCost: '{B}', typeLine: 'Enchantment — Aura Curse', colors: ['B'], oracleText: 'Enchant player\nEnchanted player loses 1 life at the beginning of their upkeep.' })).toBeNull();
  });
});

describe('M19 · custos adicionais e Spree', () => {
  it('descarte como custo adicional: sem descarte falha; com descarte compra 2', () => {
    const game = makeGame([...FILLER, discardCost], FILLER, { topP1: [discardCost.id] });
    goToMain1(game);
    put(game, 'p1', 'island');
    const spell = findIn(game, 'p1', 'hand', discardCost.id);
    const other = game.state.players.p1.zones.hand.find((id) => id !== spell)!;
    expect(cast(game, 'p1', spell).ok).toBe(false);
    const before = game.state.players.p1.zones.hand.length;
    expect(cast(game, 'p1', spell, { discards: [other] }).ok).toBe(true);
    settle(game);
    expect(game.state.objects[other].zone).toBe('graveyard');
    expect(game.state.players.p1.zones.hand.length).toBe(before - 2 + 2);
  });

  it('pagar vida como custo adicional', () => {
    const game = makeGame([...FILLER, lifeCost], FILLER, { topP1: [lifeCost.id] });
    goToMain1(game);
    put(game, 'p1', 'swamp');
    expect(cast(game, 'p1', findIn(game, 'p1', 'hand', lifeCost.id)).ok).toBe(true);
    settle(game);
    expect(game.state.players.p1.life).toBe(18);
  });

  it('exilar carta de criatura do cemitério como custo adicional (escolha automática)', () => {
    const game = makeGame([...FILLER, gyExileCost, grizzlyBears], FILLER, { topP1: [gyExileCost.id, 'grizzly-bears'] });
    goToMain1(game);
    put(game, 'p1', 'forest');
    const spell = findIn(game, 'p1', 'hand', gyExileCost.id);
    expect(cast(game, 'p1', spell).ok).toBe(false); // cemitério vazio
    const bears = put(game, 'p1', 'grizzly-bears', 'graveyard');
    expect(cast(game, 'p1', spell).ok).toBe(true);
    settle(game);
    expect(game.state.objects[bears].zone).toBe('exile');
  });

  it('Spree: cada modo soma o próprio custo', () => {
    const game = makeGame([...FILLER, spree], FILLER, { topP1: [spree.id] });
    goToMain1(game);
    put(game, 'p1', 'mountain'); put(game, 'p1', 'mountain');
    const spell = findIn(game, 'p1', 'hand', spree.id);
    expect(cast(game, 'p1', spell, { modes: [0, 1] }).ok).toBe(false); // {R}+{1}+{2} = 4 mana, só há 2
    const before = game.state.players.p1.zones.hand.length;
    expect(cast(game, 'p1', spell, { modes: [0] }).ok).toBe(true);
    settle(game);
    expect(game.state.players.p1.zones.hand.length).toBe(before);
    expect(game.state.players.p1.life).toBe(20);
  });
});

describe('M19 · Enchant generalizado e cartas exiladas', () => {
  it('Aura "Enchant artifact or creature" anexa a um artefato', () => {
    const game = makeGame([...FILLER, enchantArtOrCreature, bonesplitter], FILLER, { topP1: [enchantArtOrCreature.id, 'bonesplitter'] });
    goToMain1(game);
    const art = put(game, 'p1', 'bonesplitter');
    put(game, 'p1', 'plains');
    const aura = findIn(game, 'p1', 'hand', enchantArtOrCreature.id);
    expect(cast(game, 'p1', aura, { targets: [{ kind: 'object', id: art }] }).ok).toBe(true);
    settle(game);
    expect(game.state.objects[aura].zone).toBe('battlefield');
    expect(game.state.objects[aura].attachedTo).toBe(art);
  });

  it('exila ao entrar; ao sair, a carta exilada volta', () => {
    const game = makeGame([...FILLER, oblivion, disenchant], [...FILLER, grizzlyBears], { topP1: [oblivion.id, disenchant.id], topP2: ['grizzly-bears'] });
    goToMain1(game);
    const bears = put(game, 'p2', 'grizzly-bears');
    for (let i = 0; i < 5; i++) put(game, 'p1', 'plains');
    const ring = findIn(game, 'p1', 'hand', oblivion.id);
    expect(cast(game, 'p1', ring).ok).toBe(true);
    passUntil(game, (s) => s.pendingDecision?.type === 'chooseTargets' || (s.stack.length === 0 && s.triggerQueue.length === 0 && s.pendingDecision === null));
    if (game.state.pendingDecision?.type === 'chooseTargets') expect(game.apply('p1', { type: 'chooseTargets', targets: [{ kind: 'object', id: bears }] }).ok).toBe(true);
    settle(game);
    expect(game.state.objects[bears].zone).toBe('exile');
    expect(cast(game, 'p1', findIn(game, 'p1', 'hand', disenchant.id), { targets: [{ kind: 'object', id: ring }] }).ok).toBe(true);
    settle(game);
    expect(game.state.objects[ring].zone).toBe('graveyard');
    expect(game.state.objects[bears].zone).toBe('battlefield');
  });
});

describe('M19 · custos de ativação e cemitério', () => {
  it('remover marcadores como custo', () => {
    const game = makeGame([...FILLER, sporeBear], FILLER, { topP1: [sporeBear.id] });
    goToMain1(game);
    put(game, 'p1', 'forest'); put(game, 'p1', 'forest');
    const id = findIn(game, 'p1', 'hand', sporeBear.id);
    expect(cast(game, 'p1', id).ok).toBe(true);
    settle(game);
    expect(game.state.objects[id].counters['spore']).toBe(3);
    expect(game.apply('p1', { type: 'activateAbility', objectId: id, abilityIndex: 0 }).ok).toBe(true);
    settle(game);
    expect(game.state.objects[id].counters['spore']).toBe(0);
    expect(game.state.players.p1.zones.battlefield.some((o) => game.state.objects[o].card.name === 'Saproling')).toBe(true);
    expect(game.apply('p1', { type: 'activateAbility', objectId: id, abilityIndex: 0 }).ok).toBe(false);
  });

  it('"Return this card from your graveyard to your hand"', () => {
    const game = makeGame([...FILLER, gyReturn], FILLER, { topP1: [gyReturn.id] });
    goToMain1(game);
    put(game, 'p1', 'swamp'); put(game, 'p1', 'swamp');
    const id = put(game, 'p1', gyReturn.id, 'graveyard');
    expect(game.apply('p1', { type: 'activateAbility', objectId: id, abilityIndex: 0 }).ok).toBe(true);
    settle(game);
    expect(game.state.objects[id].zone).toBe('hand');
  });

  it('exilar do cemitério como custo de ativação', () => {
    const game = makeGame([...FILLER, gyExileAct, grizzlyBears], FILLER, { topP1: [gyExileAct.id, 'grizzly-bears'] });
    goToMain1(game);
    const art = put(game, 'p1', gyExileAct.id);
    expect(game.apply('p1', { type: 'activateAbility', objectId: art, abilityIndex: 0 }).ok).toBe(false);
    const bears = put(game, 'p1', 'grizzly-bears', 'graveyard');
    const before = game.state.players.p1.zones.hand.length;
    expect(game.apply('p1', { type: 'activateAbility', objectId: art, abilityIndex: 0 }).ok).toBe(true);
    settle(game);
    expect(game.state.objects[bears].zone).toBe('exile');
    expect(game.state.players.p1.zones.hand.length).toBe(before + 1);
  });

  it('"Add {C} or one mana of the chosen color"', () => {
    const game = makeGame([...FILLER, manaOptions], FILLER, { topP1: [manaOptions.id] });
    goToMain1(game);
    const id = put(game, 'p1', manaOptions.id);
    game.state.objects[id].chosenColor = 'G';
    expect(game.apply('p1', { type: 'activateAbility', objectId: id, abilityIndex: 0, manaColor: 'R' }).ok).toBe(false);
    expect(game.apply('p1', { type: 'activateAbility', objectId: id, abilityIndex: 0, manaColor: 'C' }).ok).toBe(true);
    expect(game.state.players.p1.manaPool.C).toBe(1);
    game.apply('p1', { type: 'manualTap', objectId: id, tapped: false });
    expect(game.apply('p1', { type: 'activateAbility', objectId: id, abilityIndex: 0, manaColor: 'G' }).ok).toBe(true);
    expect(game.state.players.p1.manaPool.G).toBe(1);
  });
});

describe('M19 · estáticas e substituições', () => {
  it('entra virado a menos que controle dois terrenos básicos', () => {
    const game = makeGame([...FILLER, tappedUnless, tappedUnless], FILLER, { topP1: [tappedUnless.id, tappedUnless.id] });
    goToMain1(game);
    const a = findIn(game, 'p1', 'hand', tappedUnless.id);
    expect(game.apply('p1', { type: 'playLand', objectId: a }).ok).toBe(true);
    expect(game.state.objects[a].tapped).toBe(true);
    put(game, 'p1', 'forest'); put(game, 'p1', 'forest');
    toMain1Turn(game, 3);
    const b = findIn(game, 'p1', 'hand', tappedUnless.id);
    expect(game.apply('p1', { type: 'playLand', objectId: b }).ok).toBe(true);
    expect(game.state.objects[b].tapped).toBe(false);
  });

  it('não pode atacar sozinha', () => {
    const game = makeGame([...FILLER, lonelyBear, grizzlyBears], FILLER, { topP1: [lonelyBear.id, 'grizzly-bears'] });
    goToMain1(game);
    const lonely = put(game, 'p1', lonelyBear.id);
    const bears = put(game, 'p1', 'grizzly-bears');
    toMain1Turn(game, 3);
    game.apply('p1', { type: 'passPriority' });
    passUntil(game, (s) => s.combatAwaiting === 'attackers');
    expect(game.apply('p1', { type: 'declareAttackers', attackers: [lonely] }).ok).toBe(false);
    expect(game.apply('p1', { type: 'declareAttackers', attackers: [lonely, bears] }).ok).toBe(true);
  });

  it('+1/+1 enquanto você conjurou uma mágica que não é criatura neste turno', () => {
    const game = makeGame([...FILLER, prowessish, lightningBolt], FILLER, { topP1: [prowessish.id, 'lightning-bolt'] });
    goToMain1(game);
    const id = put(game, 'p1', prowessish.id);
    put(game, 'p1', 'mountain');
    expect(effectivePower(game.state, game.state.objects[id])).toBe(2);
    expect(cast(game, 'p1', findIn(game, 'p1', 'hand', 'lightning-bolt'), { targets: [{ kind: 'player', player: 'p2' }] }).ok).toBe(true);
    settle(game);
    expect(effectivePower(game.state, game.state.objects[id])).toBe(3);
    toMain1Turn(game, 3);
    expect(effectivePower(game.state, game.state.objects[id])).toBe(2);
  });

  it('conjurar criaturas do topo da biblioteca', () => {
    const game = makeGame([...FILLER, topCaster, grizzlyBears], FILLER, { topP1: [topCaster.id, 'grizzly-bears'] });
    goToMain1(game);
    put(game, 'p1', topCaster.id);
    put(game, 'p1', 'forest'); put(game, 'p1', 'forest');
    // Após a compra do turno 1 os Ursos já estão na mão; devolve ao topo da biblioteca.
    const bears = findIn(game, 'p1', 'hand', 'grizzly-bears');
    game.apply('p1', { type: 'manualMove', objectId: bears, to: 'library', position: 'top' });
    expect(game.state.players.p1.zones.library[0]).toBe(bears);
    expect(cast(game, 'p1', bears).ok).toBe(true);
    settle(game);
    expect(game.state.objects[bears].zone).toBe('battlefield');
  });

  it('jogar terrenos do cemitério', () => {
    const game = makeGame([...FILLER, gyLands], FILLER, { topP1: [gyLands.id] });
    goToMain1(game);
    put(game, 'p1', gyLands.id);
    const land = put(game, 'p1', 'mountain', 'graveyard');
    expect(game.apply('p1', { type: 'playLand', objectId: land }).ok).toBe(true);
    expect(game.state.objects[land].zone).toBe('battlefield');
  });

  it('prevenir dano removendo um marcador', () => {
    const game = makeGame([...FILLER, shieldCounters, lightningBolt], FILLER, { topP1: [shieldCounters.id, 'lightning-bolt'] });
    goToMain1(game);
    put(game, 'p1', 'plains'); put(game, 'p1', 'plains'); put(game, 'p1', 'plains'); put(game, 'p1', 'mountain');
    const id = findIn(game, 'p1', 'hand', shieldCounters.id);
    expect(cast(game, 'p1', id).ok).toBe(true);
    settle(game);
    expect(game.state.objects[id].counters['+1/+1']).toBe(3);
    expect(cast(game, 'p1', findIn(game, 'p1', 'hand', 'lightning-bolt'), { targets: [{ kind: 'object', id }] }).ok).toBe(true);
    settle(game);
    expect(game.state.objects[id].zone).toBe('battlefield');
    expect(game.state.objects[id].damage).toBe(0);
    expect(game.state.objects[id].counters['+1/+1']).toBe(2);
  });
});

describe('M19 · gatilhos e efeitos novos', () => {
  it('"whenever ~ becomes untapped" dispara no desvirar', () => {
    const game = makeGame([...FILLER, untapTrigger], FILLER, { topP1: [untapTrigger.id] });
    goToMain1(game);
    const id = put(game, 'p1', untapTrigger.id);
    game.apply('p1', { type: 'manualTap', objectId: id, tapped: true });
    toMain1Turn(game, 3);
    expect(game.state.players.p1.life).toBe(21);
  });

  it('"when you cycle ~"', () => {
    const game = makeGame([...FILLER, cycleTrigger], FILLER, { topP1: [cycleTrigger.id] });
    goToMain1(game);
    put(game, 'p1', 'forest'); put(game, 'p1', 'forest');
    expect(game.apply('p1', { type: 'cycle', objectId: findIn(game, 'p1', 'hand', cycleTrigger.id) }).ok).toBe(true);
    settle(game);
    expect(game.state.players.p1.life).toBe(22);
  });

  it('"if that creature would die this turn, exile it instead"', () => {
    const game = makeGame([...FILLER, exileIfDies], [...FILLER, grizzlyBears], { topP1: [exileIfDies.id], topP2: ['grizzly-bears'] });
    goToMain1(game);
    const bears = put(game, 'p2', 'grizzly-bears');
    put(game, 'p1', 'mountain'); put(game, 'p1', 'mountain');
    expect(cast(game, 'p1', findIn(game, 'p1', 'hand', exileIfDies.id), { targets: [{ kind: 'object', id: bears }] }).ok).toBe(true);
    settle(game);
    expect(game.state.objects[bears].zone).toBe('exile');
  });

  it('devolver um terreno seu para a mão ao entrar', () => {
    const game = makeGame([...FILLER, bounceLand], FILLER, { topP1: [bounceLand.id] });
    goToMain1(game);
    const land = put(game, 'p1', 'forest');
    expect(cast(game, 'p1', findIn(game, 'p1', 'hand', bounceLand.id)).ok).toBe(true);
    settle(game);
    if (game.state.pendingDecision?.type === 'effectChoice') { game.apply('p1', { type: 'effectChoice', picks: [land] }); settle(game); }
    expect(game.state.objects[land].zone).toBe('hand');
  });

  it('"whenever a creature dealt damage by ~ this turn dies"', () => {
    const game = makeGame([...FILLER, damagedDies], [...FILLER, grizzlyBears], { topP1: [damagedDies.id], topP2: ['grizzly-bears'] });
    goToMain1(game);
    const hunter = put(game, 'p1', damagedDies.id);
    const bears = put(game, 'p2', 'grizzly-bears');
    toMain1Turn(game, 3);
    game.apply('p1', { type: 'passPriority' });
    passUntil(game, (s) => s.combatAwaiting === 'attackers');
    expect(game.apply('p1', { type: 'declareAttackers', attackers: [hunter] }).ok).toBe(true);
    passUntil(game, (s) => s.combatAwaiting === 'blockers');
    expect(game.apply('p2', { type: 'declareBlockers', blocks: [{ blocker: bears, attacker: hunter }] }).ok).toBe(true);
    passUntil(game, (s) => s.step === 'main2');
    expect(game.state.objects[bears].zone).toBe('graveyard');
    expect(game.state.objects[hunter].counters['+1/+1']).toBe(1);
  });

  it('exilar o cemitério de um jogador-alvo', () => {
    const game = makeGame([...FILLER, gyExileSpell], [...FILLER, grizzlyBears], { topP1: [gyExileSpell.id], topP2: ['grizzly-bears'] });
    goToMain1(game);
    const bears = put(game, 'p2', 'grizzly-bears', 'graveyard');
    put(game, 'p1', 'swamp');
    expect(cast(game, 'p1', findIn(game, 'p1', 'hand', gyExileSpell.id), { targets: [{ kind: 'player', player: 'p2' }] }).ok).toBe(true);
    settle(game);
    expect(game.state.objects[bears].zone).toBe('exile');
  });

  it('"return up to two target creature cards from your graveyard to your hand"', () => {
    const game = makeGame([...FILLER, returnGy, grizzlyBears, grizzlyBears], FILLER, { topP1: [returnGy.id, 'grizzly-bears', 'grizzly-bears'] });
    goToMain1(game);
    const a = put(game, 'p1', 'grizzly-bears', 'graveyard');
    const b = put(game, 'p1', 'grizzly-bears', 'graveyard');
    put(game, 'p1', 'forest'); put(game, 'p1', 'forest');
    expect(cast(game, 'p1', findIn(game, 'p1', 'hand', returnGy.id), { targets: [{ kind: 'object', id: a }, { kind: 'object', id: b }] }).ok).toBe(true);
    settle(game);
    expect(game.state.objects[a].zone).toBe('hand');
    expect(game.state.objects[b].zone).toBe('hand');
  });

  it('"attacks alone": bônus só quando ataca sozinha', () => {
    const game = makeGame([...FILLER, attacksAlone], FILLER, { topP1: [attacksAlone.id] });
    goToMain1(game);
    const id = put(game, 'p1', attacksAlone.id);
    toMain1Turn(game, 3);
    game.apply('p1', { type: 'passPriority' });
    passUntil(game, (s) => s.combatAwaiting === 'attackers');
    expect(game.apply('p1', { type: 'declareAttackers', attackers: [id] }).ok).toBe(true);
    passUntil(game, (s) => s.combatAwaiting === 'blockers');
    game.apply('p2', { type: 'declareBlockers', blocks: [] });
    passUntil(game, (s) => s.step === 'main2');
    expect(game.state.players.p2.life).toBe(16);
  });

  it('"tap that creature and it doesn\'t untap": alvo do gatilho é a criatura atingida', () => {
    const game = makeGame([...FILLER, tapAndFreeze], [...FILLER, grizzlyBears], { topP1: [tapAndFreeze.id], topP2: ['grizzly-bears'] });
    goToMain1(game);
    const frost = put(game, 'p1', tapAndFreeze.id);
    const bears = put(game, 'p2', 'grizzly-bears');
    game.state.objects[bears].counters['+1/+1'] = 2; // 4/4: sobrevive ao combate
    toMain1Turn(game, 3);
    game.apply('p1', { type: 'passPriority' });
    passUntil(game, (s) => s.combatAwaiting === 'attackers');
    expect(game.apply('p1', { type: 'declareAttackers', attackers: [frost] }).ok).toBe(true);
    passUntil(game, (s) => s.combatAwaiting === 'blockers');
    expect(game.apply('p2', { type: 'declareBlockers', blocks: [{ blocker: bears, attacker: frost }] }).ok).toBe(true);
    passUntil(game, (s) => s.step === 'main2' || s.status !== 'playing');
    expect(game.state.objects[bears].zone).toBe('battlefield');
    expect(game.state.objects[bears].tapped).toBe(true);
  });
});
