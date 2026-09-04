/** M36: cartas das duas listas do MTGGoldfish (Jund/Goyf e Lands) que não estavam full. */
import { describe, expect, it } from 'vitest';
import { compileOracleCard, type OracleInput } from '../src/cards/oracle-parser.js';
import { forest, grizzlyBears, island, lightningBolt, mountain, plains, swamp } from '../src/cards/demo-set.js';
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
const FILLER = [...copies(mountain, 6), ...copies(forest, 6), ...copies(island, 6), ...copies(plains, 6), ...copies(swamp, 4)];
const settle = (game: Game) => passUntil(game, (s) => s.status === 'finished' || (s.stack.length === 0 && s.triggerQueue.length === 0 && s.pendingDecision === null));
const cast = (game: Game, p: PlayerId, id: number, extra: Record<string, unknown> = {}) => game.apply(p, { type: 'castSpell', objectId: id, ...extra } as never);
const untilDecision = (game: Game) => passUntil(game, (s) => s.status === 'finished' || s.pendingDecision !== null || (s.stack.length === 0 && s.triggerQueue.length === 0));
const answer = (game: Game, p: PlayerId, picks: number[], text?: string) => game.apply(p, { type: 'effectChoice', picks, text });
const choice = (game: Game) => { const pd = game.state.pendingDecision; if (pd?.type !== 'effectChoice') throw new Error(`esperava effectChoice, veio ${pd?.type ?? 'nada'}`); return pd; };
const lands = (game: Game, p: PlayerId, ...ids: string[]) => { for (const id of ids) put(game, p, id); };
const untapAll = (game: Game, p: PlayerId) => { for (const id of game.state.players[p].zones.battlefield) game.state.objects[id].tapped = false; };

const purge = mk({ name: 'Celestial Purge', manaCost: '{1}{W}', typeLine: 'Instant', colors: ['W'], oracleText: 'Exile target black or red permanent.' });
const choke = mk({ name: 'Choke', manaCost: '{2}{G}', typeLine: 'Enchantment', colors: ['G'], oracleText: "Islands don't untap during their controllers' untap steps." });
const bob = mk({ name: 'Dark Confidant', manaCost: '{1}{B}', typeLine: 'Creature — Human Wizard', power: 2, toughness: 1, colors: ['B'], oracleText: 'At the beginning of your upkeep, reveal the top card of your library and put that card into your hand. You lose life equal to its mana value.' });
const inquisition = mk({ name: 'Inquisition of Kozilek', manaCost: '{B}', typeLine: 'Sorcery', colors: ['B'], oracleText: 'Target player reveals their hand. You choose a nonland card from it with mana value 3 or less. That player discards that card.' });
const liliana = mk({ name: 'Liliana of the Veil', manaCost: '{1}{B}{B}', typeLine: 'Legendary Planeswalker — Liliana', colors: ['B'], loyalty: 3, oracleText: '+1: Each player discards a card.\n−2: Target player sacrifices a creature.\n−6: Separate all permanents target player controls into two piles. That player sacrifices all permanents in the pile of their choice.' });
const mawloc = mk({ name: 'Mawloc', manaCost: '{X}{R}{G}', typeLine: 'Creature — Tyranid', power: 2, toughness: 2, colors: ['R', 'G'], oracleText: 'Ravenous\nTerror from the Deep — When this creature enters, it fights up to one target creature an opponent controls. If that creature would die this turn, exile it instead.' });
const maze = mk({ name: 'Maze of Ith', typeLine: 'Land', colors: [], oracleText: '{T}: Untap target attacking creature. Prevent all combat damage that would be dealt to and dealt by that creature this turn.' });
const minsc = mk({ name: 'Minsc & Boo, Timeless Heroes', manaCost: '{R}{G}', typeLine: 'Legendary Planeswalker — Minsc', colors: ['R', 'G'], loyalty: 3, oracleText: "When Minsc & Boo enters and at the beginning of your upkeep, you may create Boo, a legendary 1/1 red Hamster creature token with trample and haste.\n+1: Put three +1/+1 counters on up to one target creature with trample or haste.\n−2: Sacrifice a creature. When you do, Minsc & Boo deals X damage to any target, where X is that creature's power. If the sacrificed creature was a Hamster, draw X cards.\nMinsc & Boo, Timeless Heroes can be your commander." });
const molten = mk({ name: 'Molten Collapse', manaCost: '{B}{R}', typeLine: 'Sorcery', colors: ['B', 'R'], oracleText: 'Choose one. If you descended this turn, you may choose both instead.\n• Destroy target creature or planeswalker.\n• Destroy target noncreature, nonland permanent with mana value 1 or less.' });
const deed = mk({ name: 'Pernicious Deed', manaCost: '{1}{B}{G}', typeLine: 'Enchantment', colors: ['B', 'G'], oracleText: '{X}, Sacrifice this enchantment: Destroy each artifact, creature, and enchantment with mana value X or less.' });
const druid = mk({ name: 'Questing Druid', manaCost: '{1}{G}', typeLine: 'Creature — Elf Druid', power: 1, toughness: 1, colors: ['G'], layout: 'adventure', oracleText: 'Whenever you cast a spell that\'s white, blue, black, or red, put a +1/+1 counter on this creature.', backFace: { name: 'Seek the Beast', manaCost: '{1}{R}', typeLine: 'Instant — Adventure', colors: ['R'], oracleText: 'Exile the top two cards of your library. Until your next end step, you may play those cards.' } });
const riftstone = mk({ name: 'Riftstone Portal', typeLine: 'Land', colors: [], oracleText: '{T}: Add {C}.\nAs long as this card is in your graveyard, lands you control have "{T}: Add {G} or {W}."' });
const edict = mk({ name: "Sheoldred's Edict", manaCost: '{1}{B}', typeLine: 'Instant', colors: ['B'], oracleText: 'Choose one —\n• Each opponent sacrifices a nontoken creature of their choice.\n• Each opponent sacrifices a creature token of their choice.\n• Each opponent sacrifices a planeswalker of their choice.' });
const uro = mk({ name: "Uro, Titan of Nature's Wrath", manaCost: '{1}{G}{U}', typeLine: 'Legendary Creature — Elder Giant', power: 6, toughness: 6, colors: ['G', 'U'], oracleText: "When Uro enters, sacrifice it unless it escaped.\nWhenever Uro enters or attacks, you gain 3 life and draw a card, then you may put a land card from your hand onto the battlefield.\nEscape—{G}{G}{U}{U}, Exile five other cards from your graveyard." });
const idol = mk({ name: 'Bear Idol', manaCost: '{2}', typeLine: 'Artifact', colors: [], oracleText: '{T}: Add {C}.' });
const redBear = mk({ name: 'Red Bear', manaCost: '{1}{R}', typeLine: 'Creature — Bear', power: 2, toughness: 2, colors: ['R'], oracleText: '' });
const cheapIdol = mk({ name: 'Cheap Idol', manaCost: '{1}', typeLine: 'Artifact', colors: [], oracleText: '{T}: Add {C}.' });
const drain = (game: Game, pred: (s: Game['state']) => boolean, max = 400) => { for (let i = 0; i < max && !pred(game.state); i++) { const pd = game.state.pendingDecision; if (pd?.type === 'effectChoice') { answer(game, pd.player, pd.options.slice(0, pd.min), pd.mode === 'confirm' ? 'no' : undefined); continue; } if (pd?.type === 'discardToHandSize') { game.apply(pd.player, { type: 'chooseDiscard', objectIds: game.state.players[pd.player].zones.hand.slice(0, pd.count) }); continue; } const p = game.state.priority; if (!p) throw new Error('sem prioridade'); if (!game.apply(p, { type: 'passPriority' }).ok) throw new Error('passe falhou'); } };

describe('M36 · listas do MTGGoldfish', () => {
  it('compila tudo como full', () => {
    for (const c of [purge, choke, bob, inquisition, liliana, mawloc, maze, minsc, molten, deed, druid, riftstone, edict, uro])
      expect(c.automation, `${c.name}: ${c.automationNotes?.join(' | ')}`).toBe('full');
    expect(purge.spellTargets?.[0]).toMatchObject({ colorAnyOf: ['B', 'R'] });
    expect(choke.noUntapLandType).toBe('Island');
    expect(riftstone.riftstoneGrant).toEqual(['G', 'W']);
    expect(molten.spellModeChoiceIf).toMatchObject({ cond: { kind: 'descended' }, max: 2 });
  });

  it('Celestial Purge exila só permanentes pretas ou vermelhas', () => {
    const game = makeGame([...FILLER, purge, purge], [...FILLER, redBear, grizzlyBears], { topP1: [purge.id, purge.id], topP2: [redBear.id, 'grizzly-bears'] });
    goToMain1(game);
    const red = put(game, 'p2', redBear.id); const green = put(game, 'p2', 'grizzly-bears');
    lands(game, 'p1', 'plains', 'plains');
    const p1 = findIn(game, 'p1', 'hand', purge.id);
    expect(cast(game, 'p1', p1, { targets: [{ kind: 'object', id: green }] }).ok).toBe(false);
    expect(cast(game, 'p1', p1, { targets: [{ kind: 'object', id: red }] }).ok).toBe(true);
    settle(game);
    expect(game.state.objects[red].zone).toBe('exile');
  });

  it('Choke: Islands não desviram; outros terrenos sim', () => {
    const game = makeGame([...FILLER, choke], FILLER, { topP1: [choke.id] });
    goToMain1(game);
    put(game, 'p1', choke.id);
    const isl = put(game, 'p2', 'island'); const mtn = put(game, 'p2', 'mountain');
    game.state.objects[isl].tapped = true; game.state.objects[mtn].tapped = true;
    passUntil(game, (s) => s.turn === 2 && s.step === 'main1', 200);
    expect(game.state.objects[isl].tapped).toBe(true);
    expect(game.state.objects[mtn].tapped).toBe(false);
  });

  it('Dark Confidant: na manutenção revela o topo, põe na mão e perde vida igual ao valor de mana', () => {
    const game = makeGame([...FILLER, bob, grizzlyBears], FILLER, { topP1: [bob.id, 'grizzly-bears'] });
    goToMain1(game);
    put(game, 'p1', bob.id);
    const bears = findIn(game, 'p1', 'hand', 'grizzly-bears');
    game.apply('p1', { type: 'manualMove', objectId: bears, to: 'library', position: 'top' });
    passUntil(game, (s) => s.turn === 3 && s.step === 'main1' && s.priority === 'p1' && s.stack.length === 0, 400);
    expect(game.state.objects[bears].zone).toBe('hand');
    expect(game.state.players.p1.life).toBe(18);
  });

  it('Inquisition of Kozilek: só cartas não-terreno com valor de mana 3 ou menos', () => {
    const game = makeGame([...FILLER, inquisition], [...FILLER, lightningBolt, uro], { topP1: [inquisition.id], topP2: ['lightning-bolt', uro.id] });
    goToMain1(game);
    put(game, 'p1', 'swamp');
    const bolt = findIn(game, 'p2', 'hand', 'lightning-bolt'); const u = findIn(game, 'p2', 'hand', uro.id);
    const iq = findIn(game, 'p1', 'hand', inquisition.id);
    expect(cast(game, 'p1', iq, { targets: [{ kind: 'player', player: 'p2' }] }).ok).toBe(true);
    untilDecision(game);
    const pd = choice(game);
    expect(pd.options).toContain(bolt);
    expect(pd.options).toContain(u); // Uro custa 3
    expect(pd.options.every((id) => !game.state.objects[id].card.types.includes('Land'))).toBe(true);
    answer(game, 'p1', [bolt]);
    settle(game);
    expect(game.state.objects[bolt].zone).toBe('graveyard');
  });

  it('Liliana −6: separa em duas pilhas; o alvo sacrifica a pilha que escolher', () => {
    const game = makeGame([...FILLER, liliana], [...FILLER, grizzlyBears, idol], { topP1: [liliana.id], topP2: ['grizzly-bears', idol.id] });
    goToMain1(game);
    const l = put(game, 'p1', liliana.id);
    game.state.objects[l].counters['loyalty'] = 6;
    const bears = put(game, 'p2', 'grizzly-bears'); const art = put(game, 'p2', idol.id); const mtn = put(game, 'p2', 'mountain');
    const minus6 = (liliana.abilities ?? []).findIndex((a) => a.kind === 'loyalty' && /−6|-6/.test(a.text));
    expect(game.apply('p1', { type: 'activateAbility', objectId: l, abilityIndex: minus6, targets: [{ kind: 'player', player: 'p2' }] }).ok).toBe(true);
    untilDecision(game);
    let pd = choice(game);
    expect(pd.player).toBe('p1');
    answer(game, 'p1', [bears, art]); // pilha A: urso + ídolo; pilha B: Mountain
    pd = choice(game);
    expect(pd.player).toBe('p2');
    expect(pd.mode).toBe('confirm');
    answer(game, 'p2', [], 'no'); // sacrifica a pilha B
    settle(game);
    expect(game.state.objects[mtn].zone).toBe('graveyard');
    expect(game.state.objects[bears].zone).toBe('battlefield');
    expect(game.state.objects[art].zone).toBe('battlefield');
  });

  it('Mawloc: luta com a criatura alvo e, se ela morrer neste turno, é exilada', () => {
    const game = makeGame([...FILLER, mawloc], [...FILLER, grizzlyBears], { topP1: [mawloc.id], topP2: ['grizzly-bears'] });
    goToMain1(game);
    const bears = put(game, 'p2', 'grizzly-bears');
    lands(game, 'p1', 'mountain', 'forest', 'forest', 'forest');
    const m = findIn(game, 'p1', 'hand', mawloc.id);
    expect(cast(game, 'p1', m, { x: 2 }).ok).toBe(true); // 4/4 com dois marcadores
    passUntil(game, (s) => s.pendingDecision?.type === 'chooseTargets', 30);
    expect(game.apply('p1', { type: 'chooseTargets', targets: [{ kind: 'object', id: bears }] }).ok).toBe(true);
    settle(game);
    expect(game.state.objects[bears].zone).toBe('exile');
    expect(game.state.objects[m].zone).toBe('battlefield');
  });

  it('Maze of Ith: desvira o atacante e nenhum dano de combate é causado a ou por ele', () => {
    const game = makeGame([...FILLER, maze], [...FILLER, grizzlyBears], { topP1: [maze.id], topP2: ['grizzly-bears'] });
    goToMain1(game);
    const mz = put(game, 'p1', maze.id);
    const bears = put(game, 'p2', 'grizzly-bears');
    game.state.objects[bears].summoningSick = false;
    passUntil(game, (s) => s.turn === 2 && s.combatAwaiting === 'attackers', 300);
    expect(game.apply('p2', { type: 'declareAttackers', attackers: [bears] }).ok).toBe(true);
    passUntil(game, (s) => s.priority === 'p1' && s.step === 'declareAttackers', 20);
    expect(game.apply('p1', { type: 'activateAbility', objectId: mz, abilityIndex: 0, targets: [{ kind: 'object', id: bears }] }).ok).toBe(true);
    settle(game);
    expect(game.state.objects[bears].tapped).toBe(false);
    passUntil(game, (s) => s.turn === 2 && s.step === 'main2', 60);
    expect(game.state.players.p1.life).toBe(20);
  });

  it('Minsc & Boo: cria Boo ao entrar; +1 põe três marcadores numa criatura com ímpeto; −2 sacrifica o Hamster, causa dano e compra', () => {
    const game = makeGame([...FILLER, minsc], FILLER, { topP1: [minsc.id] });
    goToMain1(game);
    lands(game, 'p1', 'mountain', 'forest');
    const mb = findIn(game, 'p1', 'hand', minsc.id);
    expect(cast(game, 'p1', mb).ok).toBe(true);
    untilDecision(game);
    let pd = choice(game);
    expect(pd.mode).toBe('confirm');
    answer(game, 'p1', [], 'yes');
    settle(game);
    const boo = game.state.players.p1.zones.battlefield.map((id) => game.state.objects[id]).find((o) => o.card.name === 'Boo');
    expect(boo).toBeDefined();
    expect(boo!.card.subtypes).toContain('Hamster');
    const plus1 = (minsc.abilities ?? []).findIndex((a) => a.kind === 'loyalty' && /\+1/.test(a.text));
    expect(game.apply('p1', { type: 'activateAbility', objectId: mb, abilityIndex: plus1, targets: [{ kind: 'object', id: boo!.id }] }).ok).toBe(true);
    settle(game);
    expect(boo!.counters['+1/+1']).toBe(3); // Boo 4/4
    // Próximo turno da Alice: −2 sacrificando o Boo → 4 de dano no oponente e compra 4.
    drain(game, (s) => s.turn === 3 && s.step === 'main1' && s.priority === 'p1' && s.stack.length === 0 && s.pendingDecision === null);
    const minus2 = (minsc.abilities ?? []).findIndex((a) => a.kind === 'loyalty' && /−2|-2/.test(a.text));
    const hand = game.state.players.p1.zones.hand.length;
    expect(game.apply('p1', { type: 'activateAbility', objectId: mb, abilityIndex: minus2, targets: [{ kind: 'player', player: 'p2' }] }).ok).toBe(true);
    // Só uma criatura (o Boo): o sacrifício é forçado e resolve sozinho.
    drain(game, (s) => s.stack.length === 0 && s.triggerQueue.length === 0 && s.pendingDecision === null);
    expect(game.state.players.p1.zones.battlefield).not.toContain(boo!.id); // ficha sacrificada some
    expect(game.state.players.p2.life).toBe(16);
    expect(game.state.players.p1.zones.hand.length).toBe(hand + 4);
  });

  it('Molten Collapse: um modo; com um card de permanente no cemitério neste turno, os dois', () => {
    const game = makeGame([...FILLER, molten, molten, grizzlyBears], [...FILLER, grizzlyBears, cheapIdol], { topP1: [molten.id, molten.id, 'grizzly-bears'], topP2: ['grizzly-bears', cheapIdol.id] });
    goToMain1(game);
    lands(game, 'p1', 'swamp', 'mountain', 'swamp', 'mountain');
    const bears = put(game, 'p2', 'grizzly-bears'); const art = put(game, 'p2', cheapIdol.id);
    const m1 = findIn(game, 'p1', 'hand', molten.id);
    expect(cast(game, 'p1', m1, { modes: [0, 1], targets: [{ kind: 'object', id: bears }, { kind: 'object', id: art }] }).ok).toBe(false); // não desceu
    // Descer: uma criatura sua vai para o cemitério.
    const mine = put(game, 'p1', 'grizzly-bears');
    game.apply('p1', { type: 'manualMove', objectId: mine, to: 'graveyard' });
    expect(cast(game, 'p1', m1, { modes: [0, 1], targets: [{ kind: 'object', id: bears }, { kind: 'object', id: art }] }).ok).toBe(true);
    settle(game);
    expect(game.state.objects[bears].zone).toBe('graveyard');
    expect(game.state.objects[art].zone).toBe('graveyard');
  });

  it('Pernicious Deed: X=2 destrói artefatos, criaturas e encantamentos com valor de mana 2 ou menos', () => {
    const game = makeGame([...FILLER, deed], [...FILLER, grizzlyBears, uro], { topP1: [deed.id], topP2: ['grizzly-bears', uro.id] });
    goToMain1(game);
    const d = put(game, 'p1', deed.id);
    const bears = put(game, 'p2', 'grizzly-bears'); const u = put(game, 'p2', uro.id); const mtn = put(game, 'p2', 'mountain');
    lands(game, 'p1', 'swamp', 'forest');
    expect(game.apply('p1', { type: 'activateAbility', objectId: d, abilityIndex: 0, x: 2 }).ok).toBe(true);
    settle(game);
    expect(game.state.objects[bears].zone).toBe('graveyard');
    expect(game.state.objects[u].zone).toBe('battlefield'); // custa 3
    expect(game.state.objects[mtn].zone).toBe('battlefield'); // terreno não conta
    expect(game.state.objects[d].zone).toBe('graveyard');
  });

  it('Questing Druid: mágica vermelha põe marcador; a aventura exila duas cartas jogáveis até o seu próximo end step', () => {
    const game = makeGame([...FILLER, druid, lightningBolt], FILLER, { topP1: [druid.id, 'lightning-bolt'] });
    goToMain1(game);
    lands(game, 'p1', 'forest', 'mountain', 'mountain');
    const dr = findIn(game, 'p1', 'hand', druid.id);
    expect(cast(game, 'p1', dr).ok).toBe(true);
    settle(game);
    const bolt = findIn(game, 'p1', 'hand', 'lightning-bolt');
    expect(cast(game, 'p1', bolt, { targets: [{ kind: 'player', player: 'p2' }] }).ok).toBe(true);
    settle(game);
    expect(game.state.objects[dr].counters['+1/+1']).toBe(1);
  });

  it("Riftstone Portal: no cemitério, seus terrenos ganham {T}: {G} ou {W}; some quando ele sai", () => {
    const game = makeGame([...FILLER, riftstone], FILLER, { topP1: [riftstone.id] });
    goToMain1(game);
    const mtn = put(game, 'p1', 'mountain');
    const rp = put(game, 'p1', riftstone.id, 'graveyard');
    game.apply('p1', { type: 'passPriority' }); // SBA
    expect(game.state.objects[mtn].card.abilities?.some((a) => /Riftstone/.test(a.text))).toBe(true);
    passUntil(game, (s) => s.priority === 'p1', 10);
    const idx = game.state.objects[mtn].card.abilities!.findIndex((a) => /Riftstone/.test(a.text));
    expect(game.apply('p1', { type: 'activateAbility', objectId: mtn, abilityIndex: idx, manaColor: 'W' }).ok).toBe(true);
    expect(game.state.players.p1.manaPool.W).toBe(1);
    game.apply('p1', { type: 'manualMove', objectId: rp, to: 'exile' });
    game.apply('p1', { type: 'passPriority' });
    expect(game.state.objects[mtn].card.abilities?.some((a) => /Riftstone/.test(a.text))).toBe(false);
  });

  it("Sheoldred's Edict: modo do planeswalker", () => {
    const game = makeGame([...FILLER, edict], [...FILLER, liliana], { topP1: [edict.id], topP2: [liliana.id] });
    goToMain1(game);
    const l = put(game, 'p2', liliana.id);
    lands(game, 'p1', 'swamp', 'swamp');
    const e = findIn(game, 'p1', 'hand', edict.id);
    expect(cast(game, 'p1', e, { mode: 2 }).ok).toBe(true);
    settle(game);
    expect(game.state.objects[l].zone).toBe('graveyard');
  });

  it('Uro: ao entrar ganha 3, compra e pode pôr um terreno da mão; sem escapar, é sacrificado', () => {
    const game = makeGame([...FILLER, uro], FILLER, { topP1: [uro.id] });
    goToMain1(game);
    lands(game, 'p1', 'forest', 'island', 'forest');
    const u = findIn(game, 'p1', 'hand', uro.id);
    const landInHand = game.state.players.p1.zones.hand.find((id) => game.state.objects[id].card.types.includes('Land'))!;
    expect(cast(game, 'p1', u).ok).toBe(true);
    untilDecision(game);
    let pd = choice(game);
    // Dois gatilhos: sacrificar (sem escapar) e ganhar/comprar/terreno — a ordem pode variar; responde ao "you may put a land".
    for (let i = 0; i < 4 && game.state.pendingDecision; i++) {
      pd = choice(game);
      if (pd.mode === 'confirm') answer(game, 'p1', [], 'yes');
      else answer(game, 'p1', pd.options.includes(landInHand) ? [landInHand] : pd.options.slice(0, pd.min));
      untilDecision(game);
    }
    settle(game);
    expect(game.state.players.p1.life).toBe(23);
    expect(game.state.objects[landInHand].zone).toBe('battlefield');
    expect(game.state.objects[u].zone).toBe('graveyard');
  });
});
