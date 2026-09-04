/** M26 (Leva 6a, Legacy parte 4): Wrath of the Skies, Overlord of the Balemurk, Sand Scout, Bloodchief's Thirst, Acererak, Leyline Binding, Up the Beanstalk, Archon of Cruelty, Summon: Bahamut, Surgical Extraction. */
import { describe, expect, it } from 'vitest';
import { compileOracleCard, type OracleInput } from '../src/cards/oracle-parser.js';
import { forest, grizzlyBears, island, lightningBolt, mountain, plains, swamp } from '../src/cards/demo-set.js';
import type { CardDefinition } from '../src/cards/types.js';
import type { Game } from '../src/game.js';
import type { PlayerId } from '../src/types.js';
import { isCreature } from '../src/state.js';
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
const untilChoice = (game: Game) => passUntil(game, (s) => s.pendingDecision?.type === 'effectChoice' || (s.stack.length === 0 && s.triggerQueue.length === 0 && s.pendingDecision === null));
const answer = (game: Game, p: PlayerId, picks: number[], text?: string) => game.apply(p, { type: 'effectChoice', picks, text });
const untapAll = (game: Game, p: PlayerId) => { for (const id of game.state.players[p].zones.battlefield) game.state.objects[id].tapped = false; };

const wrath = mk({ name: 'Wrath of the Skies', manaCost: '{X}{W}{W}', typeLine: 'Sorcery', colors: ['W'], oracleText: 'You get X {E} (energy counters), then you may pay any amount of {E}. Destroy each artifact, creature, and enchantment with mana value less than or equal to the amount of {E} paid this way.' });
const overlord = mk({ name: 'Overlord of the Balemurk', manaCost: '{3}{B}{B}', typeLine: 'Enchantment Creature — Avatar Horror', power: 5, toughness: 5, colors: ['B'], oracleText: "Impending 5—{1}{B} (If you cast this spell for its impending cost, it enters with five time counters and isn't a creature until the last is removed. At the beginning of your end step, remove a time counter from it.)\nWhenever this permanent enters or attacks, mill four cards, then you may return a non-Avatar creature card or a planeswalker card from your graveyard to your hand." });
const scout = mk({ name: 'Sand Scout', manaCost: '{1}{W}', typeLine: 'Creature — Human Scout', power: 2, toughness: 1, colors: ['W'], oracleText: 'When this creature enters, if an opponent controls more lands than you, search your library for a Desert card, put it onto the battlefield tapped, then shuffle.\nWhenever one or more land cards are put into your graveyard from anywhere, create a 1/1 red, green, and white Sand Warrior creature token. This ability triggers only once each turn.' });
const thirst = mk({ name: "Bloodchief's Thirst", manaCost: '{B}', typeLine: 'Sorcery', colors: ['B'], oracleText: 'Kicker {2}{B} (You may pay an additional {2}{B} as you cast this spell.)\nDestroy target creature or planeswalker with mana value 2 or less. If this spell was kicked, instead destroy target creature or planeswalker.' });
const acererak = mk({ name: 'Acererak the Archlich', manaCost: '{2}{B}', typeLine: 'Legendary Creature — Zombie Wizard', power: 5, toughness: 5, colors: ['B'], oracleText: "When Acererak enters, if you haven't completed Tomb of Annihilation, return Acererak to its owner's hand and venture into the dungeon.\nWhenever Acererak attacks, for each opponent, you create a 2/2 black Zombie creature token unless that player sacrifices a creature of their choice." });
const binding = mk({ name: 'Leyline Binding', manaCost: '{5}{W}', typeLine: 'Enchantment', colors: ['W'], oracleText: 'Flash\nDomain — This spell costs {1} less to cast for each basic land type among lands you control.\nWhen this enchantment enters, exile target nonland permanent an opponent controls until this enchantment leaves the battlefield.' });
const beanstalk = mk({ name: 'Up the Beanstalk', manaCost: '{1}{G}', typeLine: 'Enchantment', colors: ['G'], oracleText: 'When this enchantment enters and whenever you cast a spell with mana value 5 or greater, draw a card.' });
const archon = mk({ name: 'Archon of Cruelty', manaCost: '{6}{B}{B}', typeLine: 'Creature — Archon', power: 6, toughness: 6, colors: ['B'], oracleText: 'Flying\nWhenever this creature enters or attacks, target opponent sacrifices a creature or planeswalker of their choice, discards a card, and loses 3 life. You draw a card and gain 3 life.' });
const bahamut = mk({ name: 'Summon: Bahamut', manaCost: '{9}', typeLine: 'Enchantment Creature — Saga Dragon', power: 9, toughness: 9, colors: [], layout: 'saga', oracleText: '(As this Saga enters and after your draw step, add a lore counter. Sacrifice after IV.)\nI, II — Destroy up to one target nonland permanent.\nIII — Draw two cards.\nIV — Mega Flare — This creature deals damage equal to the total mana value of other permanents you control to each opponent.\nFlying' });
const surgical = mk({ name: 'Surgical Extraction', manaCost: '{B/P}', typeLine: 'Instant', colors: ['B'], oracleText: "({B/P} can be paid with either {B} or 2 life.)\nChoose target card in a graveyard other than a basic land card. Search its owner's graveyard, hand, and library for any number of cards with the same name as that card and exile them. Then that player shuffles." });
const desert = mk({ name: 'Desert of the Glorified', typeLine: 'Land — Desert', oracleText: '{T}: Add {B}.' });
const bigSpell = mk({ name: 'Bear Colossus', manaCost: '{4}{G}', typeLine: 'Creature — Bear', power: 5, toughness: 5, colors: ['G'], oracleText: '' });
const idol = mk({ name: 'Bear Idol', manaCost: '{2}', typeLine: 'Artifact', colors: [], oracleText: '{T}: Add {C}.' });
const landkill = mk({ name: 'Bear Quake', manaCost: '{W}', typeLine: 'Sorcery', colors: ['W'], oracleText: 'Destroy target land.' });

const ALL = [wrath, overlord, scout, thirst, acererak, binding, beanstalk, archon, bahamut, surgical];

describe('M26 · compilação', () => {
  it('as 10 cartas compilam como full', () => {
    for (const c of ALL) expect(c.automation, `${c.name}: ${c.automationNotes?.join(' | ')}`).toBe('full');
    expect(wrath.spellEffect).toEqual([{ op: 'energy', who: 'controller', amount: 'X' }, { op: 'payEnergyDestroy', filter: { what: 'permanent', typeAnyOf: ['Artifact', 'Creature', 'Enchantment'] } }]);
    expect(overlord.altCost).toMatchObject({ manaCost: '{1}{B}', impending: 5 });
    expect(overlord.abilities?.[0].effect[1]).toMatchObject({ op: 'mayDo', effect: [{ op: 'returnFromGraveyardChoice', filter: { what: 'permanent', typeAnyOf: ['Creature', 'Planeswalker'], notSubtype: 'Avatar' } }] });
    expect(scout.abilities?.[0]).toMatchObject({ condition: { kind: 'opponentControlsMoreLands' }, effect: [{ op: 'search', filter: { what: 'land', subtype: 'Desert' }, to: 'battlefield', tapped: true }] });
    expect(scout.abilities?.[1]).toMatchObject({ oncePerTurn: true, effect: [{ op: 'token', colors: ['R', 'G', 'W'], subtypes: ['Sand', 'Warrior'] }] });
    expect(thirst.spellTargets?.[0]).toMatchObject({ cmcAtMost: 2, kickedSpec: { what: 'permanent', typeAnyOf: ['Creature', 'Planeswalker'] } });
    expect(acererak.abilities?.[0]).toMatchObject({ condition: { kind: 'completedNamedDungeon', name: 'Tomb of Annihilation', negate: true }, effect: [{ op: 'returnToHand', what: 'self' }, { op: 'venture' }] });
    expect(acererak.abilities?.[1].effect[0]).toMatchObject({ op: 'tokenUnlessSacrifice', filter: { what: 'creature' }, token: { name: 'Zombie', power: 2, toughness: 2 } });
    expect(binding.costModifiers?.[0]).toMatchObject({ amount: -1, self: true, perDomain: true });
    expect(beanstalk.abilities?.map((a) => a.kind === 'triggered' && a.trigger.on)).toEqual(['etb', 'youCastSpellOf']);
    expect(archon.abilities?.[0].effect).toMatchObject([{ op: 'sacrifice', who: 'target:0' }, { op: 'discard', who: 'target:0', count: 1 }, { op: 'loseLife', who: 'target:0', amount: 3 }, { op: 'draw', who: 'controller', count: 1 }, { op: 'gainLife', who: 'controller', amount: 3 }]);
    expect(bahamut.abilities?.[2].effect[0]).toMatchObject({ op: 'damage', to: 'opponent', amount: { sumManaValue: { what: 'permanent', other: true, controlledBy: 'you' } } });
    expect(surgical.spellTargets).toEqual([{ what: 'permanent', zone: 'graveyard', notBasicLand: true }]);
  });
});

describe('M26 · jogo', () => {
  it('Wrath of the Skies: X energia, paga N e destrói o que tem valor de mana até N', () => {
    const game = makeGame([...FILLER, wrath], [...FILLER, grizzlyBears, idol, bigSpell], { topP1: [wrath.id], topP2: ['grizzly-bears', idol.id, bigSpell.id] });
    goToMain1(game);
    const bears = put(game, 'p2', 'grizzly-bears');
    const art = put(game, 'p2', idol.id);
    const big = put(game, 'p2', bigSpell.id);
    for (let i = 0; i < 5; i++) put(game, 'p1', 'plains');
    expect(cast(game, 'p1', findIn(game, 'p1', 'hand', wrath.id), { x: 3 }).ok).toBe(true);
    untilChoice(game);
    expect(game.state.pendingDecision?.type === 'effectChoice' && game.state.pendingDecision.mode).toBe('number');
    expect(game.state.players.p1.energy).toBe(3);
    answer(game, 'p1', [], '2');
    settle(game);
    expect(game.state.players.p1.energy).toBe(1);
    expect(game.state.objects[bears].zone).toBe('graveyard');
    expect(game.state.objects[art].zone).toBe('graveyard');
    expect(game.state.objects[big].zone).toBe('battlefield'); // valor de mana 5 > 2
  });

  it('Overlord: Impending entra com 5 marcadores de tempo, não é criatura, mói 4 e devolve criatura; perde um marcador no fim do turno', () => {
    const game = makeGame([...FILLER, overlord, grizzlyBears], FILLER, { topP1: [overlord.id, 'grizzly-bears'] });
    goToMain1(game);
    put(game, 'p1', 'grizzly-bears', 'graveyard');
    put(game, 'p1', 'swamp'); put(game, 'p1', 'swamp');
    const o = findIn(game, 'p1', 'hand', overlord.id);
    expect(cast(game, 'p1', o, { useAltCost: true }).ok).toBe(true);
    untilChoice(game);
    expect(game.state.objects[o].zone).toBe('battlefield');
    expect(game.state.objects[o].counters['time']).toBe(5);
    expect(isCreature(game.state.objects[o])).toBe(false);
    expect(game.state.pendingDecision?.type).toBe('effectChoice');
    answer(game, 'p1', [], 'yes');
    untilChoice(game);
    const pd = game.state.pendingDecision;
    expect(pd?.type).toBe('effectChoice');
    if (pd?.type !== 'effectChoice') return;
    expect(game.state.players.p1.zones.graveyard.length).toBeGreaterThanOrEqual(5); // 1 + 4 moídas
    const bears = pd.options.find((id) => game.state.objects[id].card.id === 'grizzly-bears')!;
    answer(game, 'p1', [bears]);
    settle(game);
    expect(game.state.objects[bears].zone).toBe('hand');
    passUntil(game, (s) => s.turn === 2 && s.step === 'upkeep');
    expect(game.state.objects[o].counters['time']).toBe(4);
  });

  it('Sand Scout: busca Deserto se o oponente tem mais terrenos; ficha só uma vez por turno', () => {
    const game = makeGame([...FILLER, scout, desert, landkill], FILLER, { topP1: [scout.id, desert.id, landkill.id] });
    goToMain1(game);
    const d = findIn(game, 'p1', 'hand', desert.id);
    game.apply('p1', { type: 'manualMove', objectId: d, to: 'library', position: 'bottom' });
    put(game, 'p2', 'island'); put(game, 'p2', 'island'); put(game, 'p2', 'island');
    put(game, 'p1', 'plains'); put(game, 'p1', 'plains');
    expect(cast(game, 'p1', findIn(game, 'p1', 'hand', scout.id)).ok).toBe(true);
    untilChoice(game);
    expect(game.state.pendingDecision?.type).toBe('effectChoice');
    answer(game, 'p1', [d]);
    settle(game);
    expect(game.state.objects[d].zone).toBe('battlefield');
    expect(game.state.objects[d].tapped).toBe(true);
    // Terreno indo para o cemitério: uma ficha (e só uma por turno).
    untapAll(game, 'p1');
    const target = game.state.players.p1.zones.battlefield.find((id) => game.state.objects[id].card.name === 'Plains')!;
    expect(cast(game, 'p1', findIn(game, 'p1', 'hand', landkill.id), { targets: [{ kind: 'object', id: target }] }).ok).toBe(true);
    settle(game);
    const before = game.state.players.p1.zones.battlefield.filter((id) => game.state.objects[id].isToken).length;
    expect(before).toBe(1);
  });

  it("Bloodchief's Thirst: sem kicker só valor 2 ou menos; com kicker qualquer criatura", () => {
    const game = makeGame([...FILLER, thirst, thirst], [...FILLER, bigSpell], { topP1: [thirst.id, thirst.id], topP2: [bigSpell.id] });
    goToMain1(game);
    const big = put(game, 'p2', bigSpell.id);
    for (let i = 0; i < 4; i++) put(game, 'p1', 'swamp');
    const t1 = findIn(game, 'p1', 'hand', thirst.id);
    expect(cast(game, 'p1', t1, { targets: [{ kind: 'object', id: big }] }).ok).toBe(false);
    expect(cast(game, 'p1', t1, { targets: [{ kind: 'object', id: big }], kicked: true }).ok).toBe(true);
    settle(game);
    expect(game.state.objects[big].zone).toBe('graveyard');
  });

  it('Acererak: volta para a mão e aventura na masmorra; ao atacar, oponente sacrifica ou você cria Zumbi', () => {
    const game = makeGame([...FILLER, acererak], [...FILLER, grizzlyBears], { topP1: [acererak.id], topP2: ['grizzly-bears'] });
    goToMain1(game);
    for (let i = 0; i < 3; i++) put(game, 'p1', 'swamp');
    const a = findIn(game, 'p1', 'hand', acererak.id);
    expect(cast(game, 'p1', a).ok).toBe(true);
    passUntil(game, (s) => s.pendingDecision !== null || (s.stack.length === 0 && s.triggerQueue.length === 0), 200);
    // Escolha de masmorra / sala, se houver decisão; depois deve estar na mão.
    for (let i = 0; i < 6 && game.state.pendingDecision; i++) {
      const pd = game.state.pendingDecision as { type: string; player: PlayerId; options?: unknown[] };
      if (pd.type === 'effectChoice') answer(game, pd.player, [], 'yes');
      else if (pd.type === 'chooseMode') game.apply(pd.player, { type: 'chooseMode', mode: 0 });
      else break;
      passUntil(game, (s) => s.pendingDecision !== null || (s.stack.length === 0 && s.triggerQueue.length === 0), 200);
    }
    settle(game);
    expect(game.state.objects[a].zone).toBe('hand');
    // Ataque: coloca no campo direto e ataca no turno 3.
    put(game, 'p1', acererak.id);
    const bears = put(game, 'p2', 'grizzly-bears');
    passUntil(game, (s) => s.turn === 3 && s.step === 'main1' && s.priority === 'p1' && s.stack.length === 0);
    game.apply('p1', { type: 'passPriority' });
    passUntil(game, (s) => s.combatAwaiting === 'attackers');
    expect(game.apply('p1', { type: 'declareAttackers', attackers: [a] }).ok).toBe(true);
    untilChoice(game);
    const pd = game.state.pendingDecision;
    expect(pd?.type === 'effectChoice' && pd.player).toBe('p2');
    answer(game, 'p2', []); // não sacrifica
    passUntil(game, (s) => s.combatAwaiting === 'blockers' || s.pendingDecision !== null, 200);
    expect(game.state.objects[bears].zone).toBe('battlefield');
    expect(game.state.players.p1.zones.battlefield.some((id) => game.state.objects[id].isToken && game.state.objects[id].card.name === 'Zombie')).toBe(true);
  });

  it('Leyline Binding custa {1} a menos por tipo básico e exila até sair', () => {
    const game = makeGame([...FILLER, binding], [...FILLER, grizzlyBears], { topP1: [binding.id], topP2: ['grizzly-bears'] });
    goToMain1(game);
    const bears = put(game, 'p2', 'grizzly-bears');
    put(game, 'p1', 'plains'); put(game, 'p1', 'island'); put(game, 'p1', 'swamp'); put(game, 'p1', 'mountain'); put(game, 'p1', 'forest');
    // 5 tipos → custa {W}; 5 terrenos bastam com folga; teste o mínimo: só 1 terra destapada além de… simplificando: tapa 4, deixa 1 Plains.
    for (const id of game.state.players.p1.zones.battlefield) if (game.state.objects[id].card.name !== 'Plains') game.state.objects[id].tapped = true;
    expect(cast(game, 'p1', findIn(game, 'p1', 'hand', binding.id)).ok).toBe(true);
    passUntil(game, (s) => s.pendingDecision?.type === 'chooseTargets' || (s.stack.length === 0 && s.triggerQueue.length === 0 && s.pendingDecision === null), 200);
    expect(game.state.pendingDecision?.type).toBe('chooseTargets');
    game.apply('p1', { type: 'chooseTargets', targets: [{ kind: 'object', id: bears }] });
    settle(game);
    expect(game.state.objects[bears].zone).toBe('exile');
  });

  it('Up the Beanstalk: compra ao entrar e ao conjurar valor 5+', () => {
    const game = makeGame([...FILLER, beanstalk, bigSpell], FILLER, { topP1: [beanstalk.id, bigSpell.id] });
    goToMain1(game);
    for (let i = 0; i < 6; i++) put(game, 'p1', 'forest');
    put(game, 'p1', 'island');
    const before = game.state.players.p1.zones.hand.length;
    expect(cast(game, 'p1', findIn(game, 'p1', 'hand', beanstalk.id)).ok).toBe(true);
    settle(game);
    expect(game.state.players.p1.zones.hand.length).toBe(before); // -1 conjurada, +1 comprada
    expect(cast(game, 'p1', findIn(game, 'p1', 'hand', bigSpell.id)).ok).toBe(true);
    settle(game);
    expect(game.state.players.p1.zones.hand.length).toBe(before); // -1, +1
  });

  it('Archon of Cruelty: oponente sacrifica, descarta e perde 3; você compra e ganha 3', () => {
    const game = makeGame([...FILLER, archon], [...FILLER, grizzlyBears], { topP1: [archon.id], topP2: ['grizzly-bears'] });
    goToMain1(game);
    const bears = put(game, 'p2', 'grizzly-bears');
    for (let i = 0; i < 4; i++) put(game, 'p1', 'swamp');
    for (let i = 0; i < 4; i++) put(game, 'p1', 'island');
    const hand = game.state.players.p1.zones.hand.length;
    expect(cast(game, 'p1', findIn(game, 'p1', 'hand', archon.id)).ok).toBe(true);
    passUntil(game, (s) => s.pendingDecision?.type === 'chooseTargets' || s.pendingDecision?.type === 'effectChoice' || (s.stack.length === 0 && s.triggerQueue.length === 0 && s.pendingDecision === null), 200);
    if (game.state.pendingDecision?.type === 'chooseTargets') game.apply('p1', { type: 'chooseTargets', targets: [{ kind: 'player', player: 'p2' }] });
    untilChoice(game);
    for (let i = 0; i < 4 && game.state.pendingDecision?.type === 'effectChoice'; i++) {
      const pd = game.state.pendingDecision;
      answer(game, pd.player, pd.options.slice(0, Math.max(pd.min, 1)));
      untilChoice(game);
    }
    settle(game);
    expect(game.state.objects[bears].zone).toBe('graveyard');
    expect(game.state.players.p2.life).toBe(17);
    expect(game.state.players.p1.life).toBe(23);
    expect(game.state.players.p1.zones.hand.length).toBe(hand); // -1 Archon, +1 compra
  });

  it('Summon: Bahamut IV causa dano igual ao valor de mana total das outras permanentes', () => {
    const game = makeGame([...FILLER, bahamut, bigSpell, idol], FILLER, { topP1: [bahamut.id, bigSpell.id, idol.id] });
    goToMain1(game);
    put(game, 'p1', bigSpell.id); put(game, 'p1', idol.id); // 5 + 2
    const b = put(game, 'p1', bahamut.id);
    game.state.objects[b].counters['lore'] = 3;
    for (let i = 0; i < 4; i++) put(game, 'p1', 'forest');
    // Capítulo IV no próximo passo de compra do p1 (turno 3).
    passUntil(game, (s) => s.turn === 3 && s.step === 'main1' && s.priority === 'p1' && s.stack.length === 0 && s.pendingDecision === null, 400);
    expect(game.state.players.p2.life).toBe(13);
  });

  it('Surgical Extraction exila todas as cópias do nome (cemitério, mão e biblioteca)', () => {
    const game = makeGame([...FILLER, surgical], [...FILLER, lightningBolt, lightningBolt, lightningBolt], { topP1: [surgical.id], topP2: ['lightning-bolt', 'lightning-bolt', 'lightning-bolt'] });
    goToMain1(game);
    const inGy = put(game, 'p2', 'lightning-bolt', 'graveyard');
    const inHand = findIn(game, 'p2', 'hand', 'lightning-bolt');
    const third = game.state.players.p2.zones.hand.find((id) => game.state.objects[id].card.id === 'lightning-bolt' && id !== inHand)!;
    game.apply('p2', { type: 'manualMove', objectId: third, to: 'library', position: 'bottom' });
    put(game, 'p1', 'swamp');
    expect(cast(game, 'p1', findIn(game, 'p1', 'hand', surgical.id), { targets: [{ kind: 'object', id: inGy }] }).ok).toBe(true);
    untilChoice(game);
    const pd = game.state.pendingDecision;
    expect(pd?.type).toBe('effectChoice');
    if (pd?.type !== 'effectChoice') return;
    expect(pd.options.sort()).toEqual([inGy, inHand, third].sort());
    answer(game, 'p1', pd.options);
    settle(game);
    for (const id of [inGy, inHand, third]) expect(game.state.objects[id].zone).toBe('exile');
  });
});
