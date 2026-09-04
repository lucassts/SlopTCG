/** M25 (Leva 6a, Legacy parte 3): Quantum Riddler, Murktide, Barrowgoyf, Ugin, Sink into Stupor, Amped Raptor, Guide of Souls, Ajani, Ocelot Pride, Disruptor Flute, Eldrazi Confluence, Veil of Summer, Boseiju, Omniscience, Aluren. */
import { describe, expect, it } from 'vitest';
import { compileOracleCard, type OracleInput } from '../src/cards/oracle-parser.js';
import { forest, grizzlyBears, island, lightningBolt, mountain, plains, swamp } from '../src/cards/demo-set.js';
import type { CardDefinition } from '../src/cards/types.js';
import type { Game } from '../src/game.js';
import type { PlayerId } from '../src/types.js';
import { effectivePower, hasKeyword } from '../src/state.js';
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
const answer = (game: Game, p: PlayerId, picks: number[], text?: string) => game.apply(p, { type: 'effectChoice', picks, text });

const riddler = mk({ name: 'Quantum Riddler', manaCost: '{3}{U}{U}', typeLine: 'Creature — Sphinx', power: 4, toughness: 6, colors: ['U'], oracleText: 'Flying\nWhen this creature enters, draw a card.\nAs long as you have one or fewer cards in hand, if you would draw one or more cards, you draw that many cards plus one instead.\nWarp {1}{U}' });
const murktide = mk({ name: 'Murktide Regent', manaCost: '{5}{U}{U}', typeLine: 'Creature — Dragon', power: 3, toughness: 3, colors: ['U'], oracleText: 'Delve\nFlying\nThis creature enters with a +1/+1 counter on it for each instant and sorcery card exiled with it.\nWhenever an instant or sorcery card leaves your graveyard, put a +1/+1 counter on this creature.' });
const barrowgoyf = mk({ name: 'Barrowgoyf', manaCost: '{2}{B}', typeLine: 'Creature — Lhurgoyf', colors: ['B'], oracleText: "Deathtouch, lifelink\nBarrowgoyf's power is equal to the number of card types among cards in all graveyards and its toughness is equal to that number plus 1.\nWhenever this creature deals combat damage to a player, you may mill that many cards. If you do, you may put a creature card from among them into your hand." });
const ugin = mk({ name: 'Ugin, Eye of the Storms', manaCost: '{7}', typeLine: 'Legendary Planeswalker — Ugin', loyalty: 7, colors: [], oracleText: "When you cast this spell, exile up to one target permanent that's one or more colors.\nWhenever you cast a colorless spell, exile up to one target permanent that's one or more colors.\n+2: You gain 3 life and draw a card.\n0: Add {C}{C}{C}.\n−11: Search your library for any number of colorless nonland cards, exile them, then shuffle. Until end of turn, you may cast those cards without paying their mana costs." });
const sink = mk({ name: 'Sink into Stupor', manaCost: '{1}{U}{U}', typeLine: 'Instant', colors: ['U'], layout: 'modal_dfc', oracleText: "Return target spell or nonland permanent an opponent controls to its owner's hand.", backFace: { name: 'Soporific Springs', typeLine: 'Land', oracleText: "As this land enters, you may pay 3 life. If you don't, it enters tapped.\n{T}: Add {U}." } });
const raptor = mk({ name: 'Amped Raptor', manaCost: '{1}{R}', typeLine: 'Creature — Dinosaur', power: 2, toughness: 1, colors: ['R'], oracleText: 'First strike\nWhen this creature enters, you get {E}{E} (two energy counters). Then if you cast it from your hand, exile cards from the top of your library until you exile a nonland card. You may cast that card by paying an amount of {E} equal to its mana value rather than paying its mana cost.' });
const guide = mk({ name: 'Guide of Souls', manaCost: '{W}', typeLine: 'Creature — Human Cleric', power: 1, toughness: 2, colors: ['W'], oracleText: 'Whenever another creature you control enters, you gain 1 life and get {E} (an energy counter).\nWhenever you attack, you may pay {E}{E}{E}. When you do, put two +1/+1 counters and a flying counter on target attacking creature. It becomes an Angel in addition to its other types.' });
const ajani = mk({ name: 'Ajani, Nacatl Pariah', manaCost: '{1}{W}', typeLine: 'Legendary Creature — Cat Warrior', power: 1, toughness: 2, colors: ['W'], layout: 'transform', oracleText: "When Ajani enters, create a 2/1 white Cat Warrior creature token.\nWhenever one or more other Cats you control die, you may exile Ajani, then return him to the battlefield transformed under his owner's control.", backFace: { name: 'Ajani, Nacatl Avenger', typeLine: 'Legendary Planeswalker — Ajani', loyalty: 3, colors: ['R', 'W'], oracleText: '+2: Put a +1/+1 counter on each Cat you control.\n0: Create a 2/1 white Cat Warrior creature token. When you do, if you control a red permanent other than Ajani, he deals damage equal to the number of creatures you control to any target.\n−4: Each opponent chooses an artifact, a creature, an enchantment, and a planeswalker from among the nonland permanents they control, then sacrifices the rest.' } });
const ocelot = mk({ name: 'Ocelot Pride', manaCost: '{W}', typeLine: 'Creature — Cat', power: 1, toughness: 1, colors: ['W'], oracleText: "First strike, lifelink\nAscend (If you control ten or more permanents, you get the city's blessing for the rest of the game.)\nAt the beginning of your end step, if you gained life this turn, create a 1/1 white Cat creature token. Then if you have the city's blessing, for each token you control that entered this turn, create a token that's a copy of it." });
const flute = mk({ name: 'Disruptor Flute', manaCost: '{2}', typeLine: 'Artifact', colors: [], oracleText: "Flash\nAs this artifact enters, choose a card name.\nSpells with the chosen name cost {3} more to cast.\nActivated abilities of sources with the chosen name can't be activated unless they're mana abilities." });
const confluence = mk({ name: 'Eldrazi Confluence', manaCost: '{2}{C}{C}', typeLine: 'Instant', colors: [], oracleText: 'Choose three. You may choose the same mode more than once.\n• Target creature gets +3/-3 until end of turn.\n• Exile target nonland permanent, then return it to the battlefield tapped under its owner\'s control.\n• Create a 1/1 colorless Eldrazi Scion creature token with "Sacrifice this token: Add {C}."' });
const veil = mk({ name: 'Veil of Summer', manaCost: '{G}', typeLine: 'Instant', colors: ['G'], oracleText: "Draw a card if an opponent has cast a blue or black spell this turn. Spells you control can't be countered this turn. You and permanents you control gain hexproof from blue and from black until end of turn. (You and they can't be the targets of blue or black spells or abilities your opponents control.)" });
const boseiju = mk({ name: 'Boseiju, Who Endures', typeLine: 'Legendary Land', oracleText: "{T}: Add {G}.\nChannel — {1}{G}, Discard this card: Destroy target artifact, enchantment, or nonbasic land an opponent controls. That player may search their library for a land card with a basic land type, put it onto the battlefield, then shuffle. This ability costs {1} less to activate for each legendary creature you control." });
const omniscience = mk({ name: 'Omniscience', manaCost: '{7}{U}{U}{U}', typeLine: 'Enchantment', colors: ['U'], oracleText: 'You may cast spells from your hand without paying their mana costs.' });
const aluren = mk({ name: 'Aluren', manaCost: '{2}{G}{G}', typeLine: 'Enchantment', colors: ['G'], oracleText: 'Any player may cast creature spells with mana value 3 or less without paying their mana costs and as though they had flash.' });
const tower = mk({ name: "Urza's Tower", typeLine: "Land — Urza's Tower", oracleText: "{T}: Add {C}. If you control an Urza's Mine and an Urza's Power-Plant, add {C}{C}{C} instead." });

const bearRecall = mk({ name: 'Bear Recall', manaCost: '{1}{U}', typeLine: 'Sorcery', colors: ['U'], oracleText: 'Return target instant or sorcery card from your graveyard to your hand.' });

const ALL = [riddler, murktide, barrowgoyf, ugin, sink, raptor, guide, ajani, ocelot, flute, confluence, veil, boseiju, omniscience, aluren];

describe('M25 · compilação', () => {
  it('as 15 cartas compilam como full', () => {
    for (const c of ALL) expect(c.automation, `${c.name}: ${c.automationNotes?.join(' | ')}`).toBe('full');
    expect(ajani.backFace?.automation, ajani.backFace?.automationNotes?.join(' | ')).toBe('full');
    expect(sink.backFace?.automation).toBe('full');
    expect(riddler.drawPlusOneWhenHandSmall).toBe(true);
    expect(murktide.abilities?.find((a) => a.kind === 'triggered')).toMatchObject({ trigger: { on: 'cardLeavesYourGraveyard', filter: { typeAnyOf: ['Instant', 'Sorcery'] } } });
    expect(barrowgoyf.cdaPower).toEqual({ cardTypesInGraveyard: 'each' });
    expect(ugin.abilities?.[0]).toMatchObject({ trigger: { on: 'youCastThis' }, targets: [{ what: 'permanent', colored: true, optional: true }] });
    expect(ugin.abilities?.[1]).toMatchObject({ trigger: { on: 'youCastSpellOf', filter: { colorless: true } } });
    expect(sink.spellTargets).toEqual([{ what: 'permanent', controlledBy: 'opponent', typeAnyOf: ['Creature', 'Artifact', 'Enchantment', 'Planeswalker'], orSpell: true }]);
    expect(raptor.abilities?.[0].effect[1]).toMatchObject({ op: 'if', cond: { kind: 'castFromHand' }, then: [{ op: 'exileUntilNonlandFree', payEnergy: true }] });
    expect(guide.abilities?.[1].effect[0]).toMatchObject({ op: 'payOrElse', energy: 3, then: [{ op: 'putCounters', counter: '+1/+1', count: 2 }, { op: 'putCounters', counter: 'flying', count: 1 }, { op: 'becomesSubtype', subtype: 'Angel' }] });
    expect(ajani.abilities?.[1]).toMatchObject({ trigger: { on: 'dies', what: { subtype: 'Cat', controlledBy: 'you', other: true }, oncePerBatch: true } });
    expect(ocelot.ascend).toBe(true);
    expect(flute.costModifiers?.[0]).toMatchObject({ amount: 3, chosenName: true });
    expect(confluence.spellModeChoice).toEqual({ min: 3, max: 3, repeat: true });
    expect(veil.spellEffect?.[0]).toMatchObject({ op: 'if', cond: { kind: 'opponentCastColorThisTurn', colors: ['U', 'B'] } });
    expect(boseiju.abilities?.[1]).toMatchObject({ zone: 'hand', costLessPer: { what: 'creature', legendary: true, controlledBy: 'you' }, targets: [{ what: 'permanent', typeAnyOf: ['Artifact', 'Enchantment', 'Land'], nonbasic: true, controlledBy: 'opponent' }] });
    expect(omniscience.freeSpellsFromHand).toBe(true);
    expect(aluren.aluren).toBe(true);
  });
});

describe('M25 · jogo', () => {
  it('Quantum Riddler: com mão pequena, compra uma a mais', () => {
    const game = makeGame([...FILLER, riddler], FILLER, { topP1: [riddler.id] });
    goToMain1(game);
    const r = put(game, 'p1', riddler.id);
    void r;
    for (const id of [...game.state.players.p1.zones.hand]) game.apply('p1', { type: 'manualMove', objectId: id, to: 'library', position: 'bottom' });
    expect(game.state.players.p1.zones.hand.length).toBe(0);
    toMain1Turn(game, 3);
    expect(game.state.players.p1.zones.hand.length).toBe(2); // passo de compra: 1 + 1
  });

  it('Murktide entra com marcadores por delve e cresce quando um instantâneo sai do cemitério', () => {
    const game = makeGame([...FILLER, murktide, lightningBolt, lightningBolt, lightningBolt, bearRecall], FILLER, { topP1: [murktide.id, 'lightning-bolt', 'lightning-bolt', 'lightning-bolt', bearRecall.id] });
    goToMain1(game);
    const b1 = put(game, 'p1', 'lightning-bolt', 'graveyard');
    const b2 = put(game, 'p1', 'lightning-bolt', 'graveyard');
    for (let i = 0; i < 5; i++) put(game, 'p1', 'island');
    const m = findIn(game, 'p1', 'hand', murktide.id);
    expect(cast(game, 'p1', m).ok).toBe(true); // {5}{U}{U} com 5 ilhas + delve de 2 bolts
    settle(game);
    expect(game.state.objects[m].zone).toBe('battlefield');
    expect(game.state.objects[m].counters['+1/+1']).toBe(2);
    expect(game.state.objects[b1].zone).toBe('exile');
    void b2;
    // Um instantâneo saindo do cemitério (voltando para a mão) dá mais um marcador.
    for (const id of game.state.players.p1.zones.battlefield) game.state.objects[id].tapped = false;
    const b3 = put(game, 'p1', 'lightning-bolt', 'graveyard');
    const recall = findIn(game, 'p1', 'hand', bearRecall.id);
    expect(cast(game, 'p1', recall, { targets: [{ kind: 'object', id: b3 }] }).ok).toBe(true);
    settle(game);
    expect(game.state.objects[b3].zone).toBe('hand');
    expect(game.state.objects[m].counters['+1/+1']).toBe(3);
  });

  it('Sink into Stupor devolve uma mágica da pilha ou uma permanente', () => {
    const game = makeGame([...FILLER, sink], [...FILLER, grizzlyBears], { topP1: [sink.id], topP2: ['grizzly-bears'] });
    goToMain1(game);
    const bears = put(game, 'p2', 'grizzly-bears');
    for (let i = 0; i < 3; i++) put(game, 'p1', 'island');
    expect(cast(game, 'p1', findIn(game, 'p1', 'hand', sink.id), { targets: [{ kind: 'object', id: bears }] }).ok).toBe(true);
    settle(game);
    expect(game.state.objects[bears].zone).toBe('hand');
  });

  it('Amped Raptor: energia e carta do topo conjurável pagando energia', () => {
    const game = makeGame([...FILLER, raptor, grizzlyBears], FILLER, { topP1: [raptor.id, 'grizzly-bears'] });
    goToMain1(game);
    const bears = findIn(game, 'p1', 'hand', 'grizzly-bears');
    game.apply('p1', { type: 'manualMove', objectId: bears, to: 'library', position: 'top' });
    put(game, 'p1', 'mountain'); put(game, 'p1', 'mountain');
    const r = findIn(game, 'p1', 'hand', raptor.id);
    expect(cast(game, 'p1', r).ok).toBe(true);
    settle(game);
    expect(game.state.players.p1.energy).toBe(2);
    expect(game.state.objects[bears].zone).toBe('exile');
    expect(cast(game, 'p1', bears).ok).toBe(true); // paga {E}{E} (valor de mana 2), sem mana
    settle(game);
    expect(game.state.objects[bears].zone).toBe('battlefield');
    expect(game.state.players.p1.energy).toBe(0);
  });

  it('Guide of Souls: energia ao entrar outra criatura; ao atacar, paga 3 de energia e o atacante vira um Anjo voador', () => {
    const game = makeGame([...FILLER, guide, grizzlyBears], FILLER, { topP1: [guide.id, 'grizzly-bears'] });
    goToMain1(game);
    put(game, 'p1', guide.id);
    put(game, 'p1', 'forest'); put(game, 'p1', 'forest');
    const bears = findIn(game, 'p1', 'hand', 'grizzly-bears');
    expect(cast(game, 'p1', bears).ok).toBe(true);
    settle(game);
    expect(game.state.players.p1.life).toBe(21);
    expect(game.state.players.p1.energy).toBe(1);
    game.state.players.p1.energy = 3;
    toMain1Turn(game, 3);
    game.apply('p1', { type: 'passPriority' });
    passUntil(game, (s) => s.combatAwaiting === 'attackers');
    expect(game.apply('p1', { type: 'declareAttackers', attackers: [bears] }).ok).toBe(true);
    passUntil(game, (s) => s.pendingDecision !== null || s.combatAwaiting === 'blockers', 200);
    if (game.state.pendingDecision?.type === 'chooseTargets') { game.apply('p1', { type: 'chooseTargets', targets: [{ kind: 'object', id: bears }] }); passUntil(game, (s) => s.pendingDecision?.type === 'effectChoice' || s.combatAwaiting === 'blockers', 200); }
    if (game.state.pendingDecision?.type === 'effectChoice') answer(game, 'p1', [], 'yes');
    passUntil(game, (s) => s.combatAwaiting === 'blockers', 200);
    expect(game.state.objects[bears].counters['+1/+1']).toBe(2);
    expect(hasKeyword(game.state, game.state.objects[bears], 'flying')).toBe(true);
    expect(game.state.objects[bears].extraSubtypes).toEqual(['Angel']);
    expect(game.state.players.p1.energy).toBe(0);
  });

  it('Ajani: cria o Gato; quando outro Gato morre, transforma em planeswalker; −4 deixa um de cada tipo', () => {
    const game = makeGame([...FILLER, ajani, lightningBolt], [...FILLER, grizzlyBears, grizzlyBears], { topP1: [ajani.id, 'lightning-bolt'], topP2: ['grizzly-bears', 'grizzly-bears'] });
    goToMain1(game);
    put(game, 'p1', 'plains'); put(game, 'p1', 'plains'); put(game, 'p1', 'mountain'); put(game, 'p1', 'mountain');
    const a = findIn(game, 'p1', 'hand', ajani.id);
    expect(cast(game, 'p1', a).ok).toBe(true);
    settle(game);
    const cat = game.state.players.p1.zones.battlefield.map((id) => game.state.objects[id]).find((o) => o.isToken)!;
    expect(cat.card.subtypes).toContain('Cat');
    expect(cast(game, 'p1', findIn(game, 'p1', 'hand', 'lightning-bolt'), { targets: [{ kind: 'object', id: cat.id }] }).ok).toBe(true);
    passUntil(game, (s) => s.pendingDecision?.type === 'effectChoice' || (s.stack.length === 0 && s.triggerQueue.length === 0 && s.pendingDecision === null), 200);
    expect(game.state.pendingDecision?.type).toBe('effectChoice');
    answer(game, 'p1', [], 'yes');
    settle(game);
    const o = game.state.objects[a];
    expect(o.card.name).toBe('Ajani, Nacatl Avenger');
    expect(o.counters['loyalty']).toBe(3);
    // −4 (com lealdade forçada): o oponente fica com uma criatura e sacrifica o resto (ele só tem criaturas).
    o.counters['loyalty'] = 5;
    const bears = put(game, 'p2', 'grizzly-bears');
    put(game, 'p2', 'grizzly-bears');
    expect(game.apply('p1', { type: 'activateAbility', objectId: a, abilityIndex: 2 }).ok).toBe(true);
    untilChoice(game);
    expect(game.state.pendingDecision?.type === 'effectChoice' && game.state.pendingDecision.player).toBe('p2');
    answer(game, 'p2', [bears]);
    settle(game);
    expect(game.state.objects[bears].zone).toBe('battlefield');
    expect(game.state.players.p2.zones.battlefield.filter((id) => !game.state.objects[id].card.types.includes('Land')).length).toBe(1);
  });

  it('Ocelot Pride: ficha no fim do turno se ganhou vida; com a bênção da cidade, copia as fichas do turno', () => {
    const game = makeGame([...FILLER, ocelot, grizzlyBears], FILLER, { topP1: [ocelot.id, 'grizzly-bears'] });
    goToMain1(game);
    const o = put(game, 'p1', ocelot.id);
    void o;
    for (let i = 0; i < 9; i++) put(game, 'p1', i < 6 ? 'forest' : 'plains'); // 10 permanentes → bênção
    game.apply('p1', { type: 'passPriority' });
    expect(game.state.players.p1.cityBlessing).toBe(true);
    game.apply('p1', { type: 'manualLife', player: 'p1', delta: 1 });
    game.state.players.p1.lifeGainedThisTurn = 1;
    passUntil(game, (s) => s.turn === 2 && s.step === 'upkeep');
    const tokens = game.state.players.p1.zones.battlefield.filter((id) => game.state.objects[id].isToken);
    expect(tokens.length).toBe(2); // o Gato e a cópia dele
  });

  it('Disruptor Flute: a mágica nomeada custa {3} a mais', () => {
    const game = makeGame([...FILLER, flute], [...FILLER, lightningBolt], { topP1: [flute.id], topP2: ['lightning-bolt'] });
    goToMain1(game);
    put(game, 'p1', 'plains'); put(game, 'p1', 'plains');
    const f = findIn(game, 'p1', 'hand', flute.id);
    expect(cast(game, 'p1', f).ok).toBe(true);
    untilChoice(game);
    answer(game, 'p1', [], 'Lightning Bolt');
    settle(game);
    toMain1Turn(game, 2, 'p2');
    put(game, 'p2', 'mountain');
    expect(cast(game, 'p2', findIn(game, 'p2', 'hand', 'lightning-bolt'), { targets: [{ kind: 'player', player: 'p1' }] }).ok).toBe(false); // 1 terra não paga {R}+{3}
    for (let i = 0; i < 3; i++) put(game, 'p2', 'mountain');
    expect(cast(game, 'p2', findIn(game, 'p2', 'hand', 'lightning-bolt'), { targets: [{ kind: 'player', player: 'p1' }] }).ok).toBe(true);
  });

  it('Veil of Summer: compra se o oponente conjurou azul/preto, mágicas não podem ser anuladas e o jogador tem resistência a magia contra azul', () => {
    const counter = mk({ name: 'Bear Counter', manaCost: '{U}', typeLine: 'Instant', colors: ['U'], oracleText: 'Counter target spell.' });
    const blueBolt = mk({ name: 'Blue Bolt', manaCost: '{U}', typeLine: 'Instant', colors: ['U'], oracleText: 'Blue Bolt deals 3 damage to any target.' });
    const game = makeGame([...FILLER, veil, grizzlyBears], [...FILLER, counter, blueBolt], { topP1: [veil.id, 'grizzly-bears'], topP2: [counter.id, blueBolt.id] });
    goToMain1(game);
    put(game, 'p1', 'forest'); put(game, 'p1', 'forest'); put(game, 'p1', 'forest');
    put(game, 'p2', 'island'); put(game, 'p2', 'island');
    const before = game.state.players.p1.zones.hand.length;
    expect(cast(game, 'p1', findIn(game, 'p1', 'hand', veil.id)).ok).toBe(true);
    settle(game);
    expect(game.state.players.p1.zones.hand.length).toBe(before - 1); // sem azul/preto conjurado: não compra
    const bears = findIn(game, 'p1', 'hand', 'grizzly-bears');
    expect(cast(game, 'p1', bears).ok).toBe(true);
    game.apply('p1', { type: 'passPriority' });
    expect(cast(game, 'p2', findIn(game, 'p2', 'hand', counter.id), { targets: [{ kind: 'object', id: bears }] }).ok).toBe(true);
    settle(game);
    expect(game.state.objects[bears].zone).toBe('battlefield'); // não pôde ser anulada
    expect(cast(game, 'p2', findIn(game, 'p2', 'hand', blueBolt.id), { targets: [{ kind: 'player', player: 'p1' }] }).ok).toBe(false); // resistência a magia contra azul
  });

  it('Omniscience e Aluren: conjuração de graça', () => {
    const game = makeGame([...FILLER, omniscience, murktide, grizzlyBears], [...FILLER, aluren, grizzlyBears], { topP1: [omniscience.id, murktide.id, 'grizzly-bears'], topP2: [aluren.id, 'grizzly-bears'] });
    goToMain1(game);
    put(game, 'p1', omniscience.id);
    const bears = findIn(game, 'p1', 'hand', 'grizzly-bears');
    expect(cast(game, 'p1', bears).ok).toBe(true); // sem terrenos
    settle(game);
    expect(game.state.objects[bears].zone).toBe('battlefield');
    put(game, 'p2', aluren.id);
    // Aluren: o oponente conjura Ursos de graça no turno do p1 (como se tivesse lampejo).
    const oppBears = findIn(game, 'p2', 'hand', 'grizzly-bears');
    game.apply('p1', { type: 'passPriority' });
    expect(cast(game, 'p2', oppBears).ok).toBe(true);
    settle(game);
    expect(game.state.objects[oppBears].zone).toBe('battlefield');
  });

  it('Boseiju: canal destrói terreno não básico do oponente com desconto por lendária', () => {
    const game = makeGame([...FILLER, boseiju], [...FILLER, tower], { topP1: [boseiju.id], topP2: [tower.id] });
    goToMain1(game);
    const t = put(game, 'p2', tower.id);
    put(game, 'p1', 'forest'); put(game, 'p1', 'forest');
    const b = findIn(game, 'p1', 'hand', boseiju.id);
    expect(game.apply('p1', { type: 'activateAbility', objectId: b, abilityIndex: 1, targets: [{ kind: 'object', id: t }] }).ok).toBe(true);
    untilChoice(game);
    if (game.state.pendingDecision?.type === 'effectChoice') answer(game, game.state.pendingDecision.player, [], 'no');
    settle(game);
    expect(game.state.objects[t].zone).toBe('graveyard');
    expect(game.state.objects[b].zone).toBe('graveyard');
  });
});
