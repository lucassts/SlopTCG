/** M27 (Leva 6a, Legacy parte 5): Sneak Attack, Dark Depths, Thespian's Stage, Glaring Fleshraker, Yavimaya, Stronghold Gambit, Carpet of Flowers, Raph & Mikey, Emry, Endurance. */
import { describe, expect, it } from 'vitest';
import { compileOracleCard, type OracleInput } from '../src/cards/oracle-parser.js';
import { forest, grizzlyBears, island, lightningBolt, mountain, plains, swamp } from '../src/cards/demo-set.js';
import type { CardDefinition } from '../src/cards/types.js';
import type { Game } from '../src/game.js';
import type { PlayerId } from '../src/types.js';
import { hasKeyword } from '../src/state.js';
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
const untilDecision = (game: Game) => passUntil(game, (s) => s.pendingDecision !== null || (s.stack.length === 0 && s.triggerQueue.length === 0), 200);
const answer = (game: Game, p: PlayerId, picks: number[], text?: string) => game.apply(p, { type: 'effectChoice', picks, text });
const tokens = (game: Game, p: PlayerId) => game.state.players[p].zones.battlefield.map((id) => game.state.objects[id]).filter((o) => o.isToken);

const sneak = mk({ name: 'Sneak Attack', manaCost: '{3}{R}', typeLine: 'Enchantment', colors: ['R'], oracleText: '{R}: You may put a creature card from your hand onto the battlefield. That creature gains haste. Sacrifice the creature at the beginning of the next end step.' });
const depths = mk({ name: 'Dark Depths', typeLine: 'Legendary Snow Land', oracleText: 'Dark Depths enters with ten ice counters on it.\n{3}: Remove an ice counter from Dark Depths.\nWhen Dark Depths has no ice counters on it, sacrifice it. If you do, create Marit Lage, a legendary 20/20 black Avatar creature token with flying and indestructible.' });
const stage = mk({ name: "Thespian's Stage", typeLine: 'Land', oracleText: '{T}: Add {C}.\n{2}, {T}: This land becomes a copy of target land, except it has this ability.' });
const fleshraker = mk({ name: 'Glaring Fleshraker', manaCost: '{2}{C}', typeLine: 'Creature — Eldrazi Drone', power: 2, toughness: 2, colors: [], oracleText: 'Whenever you cast a colorless spell, create a 0/1 colorless Eldrazi Spawn creature token with "Sacrifice this token: Add {C}."\nWhenever another colorless creature you control enters, this creature deals 1 damage to each opponent.' });
const yavimaya = mk({ name: 'Yavimaya, Cradle of Growth', typeLine: 'Legendary Land', oracleText: 'Each land is a Forest in addition to its other land types.' });
const gambit = mk({ name: 'Stronghold Gambit', manaCost: '{1}{R}', typeLine: 'Sorcery', colors: ['R'], oracleText: 'Each player chooses a card in their hand. Then each player reveals their chosen card. The owner of each creature card revealed this way with the lowest mana value puts it onto the battlefield.' });
const carpet = mk({ name: 'Carpet of Flowers', manaCost: '{G}', typeLine: 'Enchantment', colors: ['G'], oracleText: "At the beginning of each of your main phases, if you haven't added mana with this ability this turn, you may add X mana of any one color, where X is the number of Islands target opponent controls." });
const turtles = mk({ name: 'Raph & Mikey, Troublemakers', manaCost: '{5}{R/G}{R/G}', typeLine: 'Legendary Creature — Mutant Ninja Turtle', power: 7, toughness: 7, colors: ['G', 'R'], oracleText: 'Trample, haste\nWhenever Raph & Mikey attack, reveal cards from the top of your library until you reveal a creature card. Put that card onto the battlefield tapped and attacking and the rest on the bottom of your library in a random order.' });
const emry = mk({ name: 'Emry, Lurker of the Loch', manaCost: '{2}{U}', typeLine: 'Legendary Creature — Merfolk Wizard', power: 1, toughness: 2, colors: ['U'], oracleText: 'Affinity for artifacts (This spell costs {1} less to cast for each artifact you control.)\nWhen Emry enters, mill four cards.\n{T}: Choose target artifact card in your graveyard. You may cast that card this turn. (You still pay its costs. Timing rules still apply.)' });
const endurance = mk({ name: 'Endurance', manaCost: '{1}{G}{G}', typeLine: 'Creature — Elemental Incarnation', power: 3, toughness: 4, colors: ['G'], oracleText: 'Flash\nReach\nWhen this creature enters, up to one target player puts all the cards from their graveyard on the bottom of their library in a random order.\nEvoke—Exile a green card from your hand.' });
const idol = mk({ name: 'Bear Idol', manaCost: '{2}', typeLine: 'Artifact', colors: [], oracleText: '{T}: Add {C}.' });
const colossus = mk({ name: 'Bear Colossus', manaCost: '{4}{G}', typeLine: 'Creature — Bear', power: 5, toughness: 5, colors: ['G'], oracleText: '' });

const ALL = [sneak, depths, stage, fleshraker, yavimaya, gambit, carpet, turtles, emry, endurance];

describe('M27 · compilação', () => {
  it('as 10 cartas compilam como full', () => {
    for (const c of ALL) expect(c.automation, `${c.name}: ${c.automationNotes?.join(' | ')}`).toBe('full');
    expect(sneak.abilities?.[0]).toMatchObject({ kind: 'activated', cost: { mana: '{R}' }, effect: [{ op: 'putFromHand', filter: { what: 'creature' }, haste: true, sacrificeAtEnd: true }] });
    expect(depths.entersWithCounters).toEqual({ counter: 'ice', count: 10 });
    expect(depths.abilities?.[1]).toMatchObject({ trigger: { on: 'noCounters', counter: 'ice' }, effect: [{ op: 'sacrificeSelf' }, { op: 'token', name: 'Marit Lage', power: 20, toughness: 20, legendary: true, keywords: ['flying', 'indestructible'] }] });
    expect(stage.abilities?.[1]).toMatchObject({ cost: { mana: '{2}', tap: true }, targets: [{ what: 'land' }], effect: [{ op: 'becomeCopy', what: 'target:0' }] });
    expect(fleshraker.abilities?.[0]).toMatchObject({ trigger: { on: 'youCastSpellOf', filter: { colorless: true } }, effect: [{ op: 'token', name: 'Eldrazi Spawn', abilities: [{ kind: 'activated', cost: { sacrificeSelf: true }, isManaAbility: true }] }] });
    expect(yavimaya.allLandsAreType).toBe('Forest');
    expect(gambit.spellEffect).toEqual([{ op: 'gambitPick', who: 'controller' }, { op: 'gambitPick', who: 'opponent' }, { op: 'gambitResolve' }]);
    expect(carpet.abilities?.map((a) => a.kind === 'triggered' && a.trigger.on)).toEqual(['main1', 'main2']);
    expect(carpet.abilities?.[0]).toMatchObject({ condition: { kind: 'notUsedThisTurn' }, targets: [{ what: 'player', controlledBy: 'opponent' }], effect: [{ op: 'mayDo', effect: [{ op: 'addManaChoice', count: { per: { what: 'land', subtype: 'Island', controlledBy: 'opponent' } }, markUsed: true }] }] });
    expect(turtles.abilities?.[0]).toMatchObject({ trigger: { on: 'attacks', self: true }, effect: [{ op: 'revealUntil', filter: { what: 'creature' }, tapped: true, attacking: true }] });
    expect(emry.abilities?.[1]).toMatchObject({ cost: { tap: true }, targets: [{ what: 'artifact', zone: 'graveyard', ownedBy: 'you' }], effect: [{ op: 'castableFromGraveyardThisTurn', what: 'target:0' }] });
    expect(endurance.abilities?.[0]).toMatchObject({ targets: [{ what: 'player', optional: true }], effect: [{ op: 'graveyardToLibraryBottom', who: 'target:0' }] });
    expect(endurance.castMethods?.[0]).toMatchObject({ kind: 'evoke', exileFromHand: { color: 'G' } });
  });
});

describe('M27 · jogo', () => {
  it('Sneak Attack: criatura da mão entra com ímpeto e é sacrificada no fim do turno', () => {
    const game = makeGame([...FILLER, sneak, grizzlyBears], FILLER, { topP1: [sneak.id, 'grizzly-bears'] });
    goToMain1(game);
    const sa = put(game, 'p1', sneak.id);
    put(game, 'p1', 'mountain');
    const bears = findIn(game, 'p1', 'hand', 'grizzly-bears');
    expect(game.apply('p1', { type: 'activateAbility', objectId: sa, abilityIndex: 0 }).ok).toBe(true);
    untilChoice(game);
    expect(game.state.pendingDecision?.type).toBe('effectChoice');
    answer(game, 'p1', [bears]);
    settle(game);
    expect(game.state.objects[bears].zone).toBe('battlefield');
    expect(hasKeyword(game.state, game.state.objects[bears], 'haste')).toBe(true);
    passUntil(game, (s) => s.turn === 2 && s.step === 'upkeep');
    expect(game.state.objects[bears].zone).toBe('graveyard');
  });

  it('Dark Depths: sem marcadores de gelo, é sacrificada e cria Marit Lage', () => {
    const game = makeGame([...FILLER, depths], FILLER, { topP1: [depths.id] });
    goToMain1(game);
    const d = put(game, 'p1', depths.id);
    game.state.objects[d].counters['ice'] = 1;
    for (let i = 0; i < 3; i++) put(game, 'p1', 'plains');
    expect(game.apply('p1', { type: 'activateAbility', objectId: d, abilityIndex: 0 }).ok).toBe(true);
    settle(game);
    expect(game.state.objects[d].zone).toBe('graveyard');
    const lage = tokens(game, 'p1')[0];
    expect(lage?.card.name).toBe('Marit Lage');
    expect(lage.card.supertypes).toContain('Legendary');
    expect(hasKeyword(game.state, lage, 'indestructible')).toBe(true);
  });

  it("Thespian's Stage copia Dark Depths sem marcadores e vira Marit Lage", () => {
    const game = makeGame([...FILLER, stage, depths], FILLER, { topP1: [stage.id, depths.id] });
    goToMain1(game);
    const st = put(game, 'p1', stage.id);
    const d = put(game, 'p1', depths.id);
    game.state.objects[d].counters['ice'] = 10;
    put(game, 'p1', 'plains'); put(game, 'p1', 'plains');
    expect(game.apply('p1', { type: 'activateAbility', objectId: st, abilityIndex: 1, targets: [{ kind: 'object', id: d }] }).ok).toBe(true);
    // Regra das lendárias: dois "Dark Depths" — fica com a cópia (sem gelo); a original vai para o cemitério.
    passUntil(game, (s) => s.pendingDecision?.type === 'effectChoice' && /lendárias/.test(s.pendingDecision.prompt), 50);
    const pd = game.state.pendingDecision;
    expect(pd?.type === 'effectChoice' && pd.options.sort()).toEqual([st, d].sort());
    expect(game.apply('p1', { type: 'effectChoice', picks: [st] }).ok).toBe(true);
    expect(game.state.objects[d].zone).toBe('graveyard');
    settle(game);
    expect(game.state.objects[st].zone).toBe('graveyard'); // a cópia sem gelo se sacrifica
    expect(tokens(game, 'p1')[0]?.card.name).toBe('Marit Lage');
  });

  it('Glaring Fleshraker: mágica incolor cria Eldrazi Spawn, que ao entrar causa 1 de dano', () => {
    const game = makeGame([...FILLER, fleshraker, idol], FILLER, { topP1: [fleshraker.id, idol.id] });
    goToMain1(game);
    put(game, 'p1', fleshraker.id);
    put(game, 'p1', 'plains'); put(game, 'p1', 'plains');
    expect(cast(game, 'p1', findIn(game, 'p1', 'hand', idol.id)).ok).toBe(true);
    settle(game);
    const spawn = tokens(game, 'p1')[0];
    expect(spawn?.card.name).toBe('Eldrazi Spawn');
    expect(spawn.card.abilities?.[0]).toMatchObject({ isManaAbility: true, cost: { sacrificeSelf: true } });
    expect(game.state.players.p2.life).toBe(19);
  });

  it('Yavimaya: todo terreno é Floresta e paga {G}; a concessão some quando ela sai', () => {
    const game = makeGame([...FILLER, yavimaya, grizzlyBears], FILLER, { topP1: [yavimaya.id, 'grizzly-bears'] });
    goToMain1(game);
    const y = put(game, 'p1', yavimaya.id);
    const m1 = put(game, 'p1', 'mountain'); put(game, 'p1', 'mountain');
    passUntil(game, (s) => s.turn === 3 && s.step === 'main1' && s.priority === 'p1' && s.stack.length === 0, 400);
    expect(game.state.objects[m1].card.subtypes).toContain('Forest');
    expect(cast(game, 'p1', findIn(game, 'p1', 'hand', 'grizzly-bears')).ok).toBe(true); // {1}{G} só com Montanhas
    settle(game);
    game.apply('p1', { type: 'manualMove', objectId: y, to: 'graveyard' });
    game.apply('p1', { type: 'passPriority' });
    expect(game.state.objects[m1].card.subtypes).not.toContain('Forest');
  });

  it('Stronghold Gambit: cada jogador escolhe; a criatura de menor valor de mana entra', () => {
    const game = makeGame([...FILLER, gambit, grizzlyBears], [...FILLER, colossus], { topP1: [gambit.id, 'grizzly-bears'], topP2: [colossus.id] });
    goToMain1(game);
    put(game, 'p1', 'mountain'); put(game, 'p1', 'mountain');
    const bears = findIn(game, 'p1', 'hand', 'grizzly-bears');
    const big = findIn(game, 'p2', 'hand', colossus.id);
    expect(cast(game, 'p1', findIn(game, 'p1', 'hand', gambit.id)).ok).toBe(true);
    untilChoice(game);
    expect(game.state.pendingDecision?.type === 'effectChoice' && game.state.pendingDecision.player).toBe('p1');
    answer(game, 'p1', [bears]);
    untilChoice(game);
    expect(game.state.pendingDecision?.type === 'effectChoice' && game.state.pendingDecision.player).toBe('p2');
    answer(game, 'p2', [big]);
    settle(game);
    expect(game.state.objects[bears].zone).toBe('battlefield');
    expect(game.state.objects[big].zone).toBe('hand');
  });

  it('Carpet of Flowers: na fase principal, X mana da cor escolhida (X = Ilhas do oponente), uma vez por turno', () => {
    const game = makeGame([...FILLER, carpet], FILLER, { topP1: [carpet.id] });
    goToMain1(game);
    put(game, 'p1', carpet.id);
    put(game, 'p2', 'island'); put(game, 'p2', 'island');
    // Até o turno 3: recusa as ofertas (turno 1, segunda fase principal).
    for (let i = 0; i < 400 && !(game.state.turn === 3 && game.state.step === 'main1' && game.state.pendingDecision?.type === 'chooseTargets'); i++) {
      const pd = game.state.pendingDecision;
      if (pd?.type === 'chooseTargets') game.apply(pd.player, { type: 'chooseTargets', targets: [{ kind: 'player', player: 'p2' }] });
      else if (pd?.type === 'effectChoice') answer(game, pd.player, [], 'no');
      else if (pd?.type === 'discardToHandSize') game.apply(pd.player, { type: 'chooseDiscard', objectIds: game.state.players[pd.player].zones.hand.slice(0, pd.count) });
      else if (game.state.priority) game.apply(game.state.priority, { type: 'passPriority' });
      else break;
    }
    expect(game.state.turn).toBe(3);
    game.apply('p1', { type: 'chooseTargets', targets: [{ kind: 'player', player: 'p2' }] });
    untilChoice(game);
    expect(game.state.pendingDecision?.type).toBe('effectChoice');
    answer(game, 'p1', [], 'yes');
    untilChoice(game);
    expect(game.state.pendingDecision?.type === 'effectChoice' && game.state.pendingDecision.mode).toBe('chooseColor');
    answer(game, 'p1', [], 'G');
    passUntil(game, (s) => s.stack.length === 0 && s.pendingDecision === null && s.priority === 'p1', 50);
    expect(game.state.players.p1.manaPool.G).toBe(2);
    // Segunda fase principal do mesmo turno: nada (já usou).
    for (let i = 0; i < 100 && !(game.state.turn === 3 && game.state.step === 'main2' && game.state.priority === 'p1' && game.state.stack.length === 0); i++) {
      if (game.state.pendingDecision) break;
      game.apply(game.state.priority!, { type: 'passPriority' });
    }
    expect(game.state.step).toBe('main2');
    expect(game.state.pendingDecision).toBeNull();
  });

  it('Raph & Mikey: ao atacar, revela até uma criatura, que entra virada e atacando; o resto vai para o fundo', () => {
    const game = makeGame([...FILLER, turtles, grizzlyBears], FILLER, { topP1: [turtles.id] });
    goToMain1(game);
    const t = put(game, 'p1', turtles.id);
    const bears = findIn(game, 'p1', 'library', 'grizzly-bears');
    // Topo: Montanha, Montanha, Ursos.
    game.apply('p1', { type: 'manualMove', objectId: bears, to: 'library', position: 'top' });
    const m1 = findIn(game, 'p1', 'library', 'mountain');
    game.apply('p1', { type: 'manualMove', objectId: m1, to: 'library', position: 'top' });
    game.apply('p1', { type: 'passPriority' });
    passUntil(game, (s) => s.combatAwaiting === 'attackers');
    expect(game.apply('p1', { type: 'declareAttackers', attackers: [t] }).ok).toBe(true);
    passUntil(game, (s) => s.combatAwaiting === 'blockers' || s.pendingDecision !== null, 200);
    expect(game.state.objects[bears].zone).toBe('battlefield');
    expect(game.state.objects[bears].tapped).toBe(true);
    expect(game.state.objects[bears].attacking).toBe(true);
    const lib = game.state.players.p1.zones.library;
    expect(lib[lib.length - 1]).toBe(m1);
  });

  it('Emry: alvo no cemitério pode ser conjurado neste turno', () => {
    const game = makeGame([...FILLER, emry, idol], FILLER, { topP1: [emry.id, idol.id] });
    goToMain1(game);
    const e = put(game, 'p1', emry.id);
    game.state.objects[e].summoningSick = false;
    const art = put(game, 'p1', idol.id, 'graveyard');
    put(game, 'p1', 'island'); put(game, 'p1', 'island');
    expect(cast(game, 'p1', art).ok).toBe(false);
    expect(game.apply('p1', { type: 'activateAbility', objectId: e, abilityIndex: 1, targets: [{ kind: 'object', id: art }] }).ok).toBe(true);
    settle(game);
    expect(cast(game, 'p1', art).ok).toBe(true);
    settle(game);
    expect(game.state.objects[art].zone).toBe('battlefield');
  });

  it('Endurance: o cemitério do jogador-alvo vai para o fundo da biblioteca', () => {
    const game = makeGame([...FILLER, endurance], [...FILLER, lightningBolt, lightningBolt], { topP1: [endurance.id], topP2: ['lightning-bolt', 'lightning-bolt'] });
    goToMain1(game);
    const b1 = put(game, 'p2', 'lightning-bolt', 'graveyard');
    const b2 = put(game, 'p2', 'lightning-bolt', 'graveyard');
    for (let i = 0; i < 3; i++) put(game, 'p1', 'forest');
    expect(cast(game, 'p1', findIn(game, 'p1', 'hand', endurance.id)).ok).toBe(true);
    untilDecision(game);
    if (game.state.pendingDecision?.type === 'chooseTargets') game.apply('p1', { type: 'chooseTargets', targets: [{ kind: 'player', player: 'p2' }] });
    settle(game);
    expect(game.state.players.p2.zones.graveyard.length).toBe(0);
    expect(game.state.objects[b1].zone).toBe('library');
    expect(game.state.objects[b2].zone).toBe('library');
    const lib = game.state.players.p2.zones.library;
    expect(lib.slice(-2).sort()).toEqual([b1, b2].sort());
  });
});
