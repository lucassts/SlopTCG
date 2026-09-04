/** M35: cartas das listas do Lucas (Turbo Doomsday, Black Saga Storm, Blue Dredge) que não estavam full. */
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

const boneShards = mk({ name: 'Bone Shards', manaCost: '{B}', typeLine: 'Sorcery', colors: ['B'], oracleText: 'As an additional cost to cast this spell, sacrifice a creature or discard a card.\nDestroy target creature or planeswalker.' });
const bridge = mk({ name: 'Bridge from Below', manaCost: '{B}{B}{B}', typeLine: 'Enchantment', colors: ['B'], oracleText: "Whenever a nontoken creature is put into your graveyard from the battlefield, if this card is in your graveyard, create a 2/2 black Zombie creature token.\nWhen a creature is put into an opponent's graveyard from the battlefield, if this card is in your graveyard, exile this card." });
const commandeer = mk({ name: 'Commandeer', manaCost: '{5}{U}{U}', typeLine: 'Instant', colors: ['U'], oracleText: "You may exile two blue cards from your hand rather than pay this spell's mana cost.\nGain control of target noncreature spell. You may choose new targets for it." });
const deepAnalysis = mk({ name: 'Deep Analysis', manaCost: '{3}{U}', typeLine: 'Sorcery', colors: ['U'], oracleText: 'Target player draws two cards.\nFlashback—{1}{U}, Pay 3 life.' });
const tidecaller = mk({ name: 'Exhibition Tidecaller', manaCost: '{1}{U}', typeLine: 'Creature — Merfolk Wizard', power: 1, toughness: 3, colors: ['U'], oracleText: 'Opus — Whenever you cast an instant or sorcery spell, target player mills three cards. If five or more mana was spent to cast that spell, that player mills ten cards instead.' });
const troll = mk({ name: 'Golgari Grave-Troll', manaCost: '{4}{G}', typeLine: 'Creature — Skeleton Troll', power: 0, toughness: 0, colors: ['G'], oracleText: 'This creature enters with a +1/+1 counter on it for each creature card in your graveyard.\n{1}, Remove a +1/+1 counter from this creature: Regenerate this creature.\nDredge 6' });
const helm = mk({ name: 'Helm of Obedience', manaCost: '{4}', typeLine: 'Artifact', colors: [], oracleText: "{X}, {T}: Target opponent mills a card, then repeats this process until a creature card or X cards have been put into their graveyard this way, whichever comes first. If one or more creature cards were put into that graveyard this way, sacrifice this artifact and put one of them onto the battlefield under your control. X can't be 0." });
const jace = mk({ name: 'Jace, Wielder of Mysteries', manaCost: '{1}{U}{U}{U}', typeLine: 'Legendary Planeswalker — Jace', colors: ['U'], loyalty: 4, oracleText: 'If you would draw a card while your library has no cards in it, you win the game instead.\n+1: Target player mills two cards. Draw a card.\n−8: Draw seven cards. Then if your library has no cards in it, you win the game.' });
const kiora = mk({ name: "Kiora's Dismissal", manaCost: '{U}', typeLine: 'Instant', colors: ['U'], oracleText: "Strive — This spell costs {U} more to cast for each target beyond the first.\nReturn any number of target enchantments to their owners' hands." });
const necro = mk({ name: 'Necrodominance', manaCost: '{B}{B}{B}', typeLine: 'Legendary Enchantment', colors: ['B'], oracleText: 'Skip your draw step.\nAt the beginning of your end step, you may pay any amount of life. If you do, draw that many cards.\nYour maximum hand size is five.\nIf a card or token would be put into your graveyard from anywhere, exile it instead.' });
const tutor = mk({ name: 'Personal Tutor', manaCost: '{U}', typeLine: 'Sorcery', colors: ['U'], oracleText: 'Search your library for a sorcery card, reveal it, then shuffle and put that card on top.' });
const pox = mk({ name: 'Poxwalkers', manaCost: '{1}{B}', typeLine: 'Creature — Zombie', power: 2, toughness: 1, colors: ['B'], oracleText: 'Deathtouch\nCurse of the Walking Pox — Whenever you cast a spell from anywhere other than your hand, return this card from your graveyard to the battlefield tapped.' });
const idol = mk({ name: 'Bear Idol', manaCost: '{2}', typeLine: 'Artifact', colors: [], oracleText: '{T}: Add {C}.' });
const glow = mk({ name: 'Glow Aura', manaCost: '{G}', typeLine: 'Enchantment', colors: ['G'], oracleText: '' });
const flashbolt = mk({ name: 'Flash Bolt', manaCost: '{R}', typeLine: 'Instant', colors: ['R'], oracleText: 'Flash Bolt deals 3 damage to any target.\nFlashback {R}' });

describe('M35 · cartas das listas (Doomsday, Storm, Dredge)', () => {
  it('compila tudo como full', () => {
    for (const c of [boneShards, bridge, commandeer, deepAnalysis, tidecaller, troll, helm, jace, kiora, necro, tutor, pox])
      expect(c.automation, `${c.name}: ${c.automationNotes?.join(' | ')}`).toBe('full');
    expect(boneShards.additionalCost).toMatchObject({ either: true, discard: 1 });
    expect(deepAnalysis.flashback).toMatchObject({ cost: '{1}{U}', payLife: 3 });
    expect(kiora.strive).toBe('{U}');
    expect(necro.maxHandSize).toBe(5);
    expect(commandeer.altCost?.exileFromHand?.count).toBe(2);
    expect(bridge.abilities?.every((a) => a.kind === 'triggered' && a.zone === 'graveyard')).toBe(true);
  });

  it('Bone Shards: conjura sacrificando uma criatura OU descartando uma carta', () => {
    const game = makeGame([...FILLER, boneShards, boneShards, grizzlyBears], [...FILLER, grizzlyBears, grizzlyBears], { topP1: [boneShards.id, boneShards.id, 'grizzly-bears'], topP2: ['grizzly-bears', 'grizzly-bears'] });
    goToMain1(game);
    lands(game, 'p1', 'swamp', 'swamp');
    const enemy = put(game, 'p2', 'grizzly-bears');
    const mine = put(game, 'p1', 'grizzly-bears');
    const b1 = findIn(game, 'p1', 'hand', boneShards.id);
    expect(cast(game, 'p1', b1, { targets: [{ kind: 'object', id: enemy }] }).ok).toBe(false); // sem custo adicional
    const discard = game.state.players.p1.zones.hand.find((id) => game.state.objects[id].card.id !== boneShards.id)!;
    expect(cast(game, 'p1', b1, { targets: [{ kind: 'object', id: enemy }], discards: [discard] }).ok).toBe(true); // descartando
    settle(game);
    expect(game.state.objects[enemy].zone).toBe('graveyard');
    expect(game.state.objects[discard].zone).toBe('graveyard');
    expect(game.state.objects[mine].zone).toBe('battlefield');
    const enemy2 = put(game, 'p2', 'grizzly-bears', 'hand'); game.apply('p2', { type: 'manualMove', objectId: enemy2, to: 'battlefield' });
    const b2 = findIn(game, 'p1', 'hand', boneShards.id);
    untapAll(game, 'p1');
    expect(cast(game, 'p1', b2, { targets: [{ kind: 'object', id: enemy2 }], sacrifices: [mine] }).ok).toBe(true); // sacrificando
    settle(game);
    expect(game.state.objects[mine].zone).toBe('graveyard');
    expect(game.state.objects[enemy2].zone).toBe('graveyard');
  });

  it('Bridge from Below: do cemitério, cria Zumbi quando sua criatura morre; some quando uma do oponente morre', () => {
    const game = makeGame([...FILLER, bridge, grizzlyBears, lightningBolt, lightningBolt], [...FILLER, grizzlyBears], { topP1: [bridge.id, 'grizzly-bears', 'lightning-bolt', 'lightning-bolt'], topP2: ['grizzly-bears'] });
    goToMain1(game);
    const br = put(game, 'p1', bridge.id, 'graveyard');
    const mine = put(game, 'p1', 'grizzly-bears');
    lands(game, 'p1', 'mountain', 'mountain');
    const bolt1 = findIn(game, 'p1', 'hand', 'lightning-bolt');
    expect(cast(game, 'p1', bolt1, { targets: [{ kind: 'object', id: mine }] }).ok).toBe(true);
    settle(game);
    const zombies = game.state.players.p1.zones.battlefield.map((id) => game.state.objects[id]).filter((o) => o.card.name === 'Zombie');
    expect(zombies).toHaveLength(1);
    expect(game.state.objects[br].zone).toBe('graveyard');
    const enemy = put(game, 'p2', 'grizzly-bears');
    const bolt2 = findIn(game, 'p1', 'hand', 'lightning-bolt');
    expect(cast(game, 'p1', bolt2, { targets: [{ kind: 'object', id: enemy }] }).ok).toBe(true);
    settle(game);
    expect(game.state.objects[br].zone).toBe('exile');
  });

  it('Poxwalkers: volta do cemitério virado quando você conjura uma mágica de fora da mão (flashback)', () => {
    const game = makeGame([...FILLER, pox, flashbolt], [...FILLER, grizzlyBears], { topP1: [pox.id, flashbolt.id], topP2: ['grizzly-bears'] });
    goToMain1(game);
    const px = put(game, 'p1', pox.id, 'graveyard');
    const fb = put(game, 'p1', flashbolt.id, 'graveyard');
    lands(game, 'p1', 'mountain', 'mountain');
    const enemy = put(game, 'p2', 'grizzly-bears');
    expect(cast(game, 'p1', fb, { targets: [{ kind: 'object', id: enemy }] }).ok).toBe(true); // flashback: de fora da mão
    settle(game);
    expect(game.state.objects[px].zone).toBe('battlefield');
    expect(game.state.objects[px].tapped).toBe(true);
  });

  it('Golgari Grave-Troll entra com um marcador por carta de criatura no cemitério', () => {
    const game = makeGame([...FILLER, troll, grizzlyBears, grizzlyBears], FILLER, { topP1: [troll.id, 'grizzly-bears', 'grizzly-bears'] });
    goToMain1(game);
    put(game, 'p1', 'grizzly-bears', 'graveyard'); put(game, 'p1', 'grizzly-bears', 'graveyard');
    lands(game, 'p1', 'forest', 'forest', 'forest', 'forest', 'forest');
    const t = findIn(game, 'p1', 'hand', troll.id);
    expect(cast(game, 'p1', t).ok).toBe(true);
    settle(game);
    expect(game.state.objects[t].zone).toBe('battlefield');
    expect(game.state.objects[t].counters['+1/+1']).toBe(2);
  });

  it('Deep Analysis: flashback custa {1}{U} e 3 de vida', () => {
    const game = makeGame([...FILLER, deepAnalysis], FILLER, { topP1: [deepAnalysis.id] });
    goToMain1(game);
    const d = put(game, 'p1', deepAnalysis.id, 'graveyard');
    lands(game, 'p1', 'island', 'island');
    game.state.players.p1.life = 2;
    expect(cast(game, 'p1', d, { targets: [{ kind: 'player', player: 'p1' }] }).ok).toBe(false); // sem vida
    game.state.players.p1.life = 20;
    const hand = game.state.players.p1.zones.hand.length;
    expect(cast(game, 'p1', d, { targets: [{ kind: 'player', player: 'p1' }] }).ok).toBe(true);
    expect(game.state.players.p1.life).toBe(17);
    settle(game);
    expect(game.state.players.p1.zones.hand.length).toBe(hand + 2);
    expect(game.state.objects[d].zone).toBe('exile');
  });

  it('Personal Tutor: busca uma feitiçaria para o topo da biblioteca', () => {
    const game = makeGame([...FILLER, tutor, deepAnalysis], FILLER, { topP1: [tutor.id] });
    goToMain1(game);
    put(game, 'p1', 'island');
    const t = findIn(game, 'p1', 'hand', tutor.id);
    expect(cast(game, 'p1', t).ok).toBe(true);
    untilDecision(game);
    const pd = choice(game);
    const da = findIn(game, 'p1', 'library', deepAnalysis.id);
    expect(pd.options).toContain(da);
    answer(game, 'p1', [da]);
    settle(game);
    expect(game.state.players.p1.zones.library[0]).toBe(da);
  });

  it("Kiora's Dismissal: strive — cada alvo além do primeiro custa {U} a mais", () => {
    const game = makeGame([...FILLER, kiora, kiora], [...FILLER, glow, glow], { topP1: [kiora.id, kiora.id], topP2: [glow.id, glow.id] });
    goToMain1(game);
    const g1 = put(game, 'p2', glow.id); const g2 = put(game, 'p2', glow.id);
    put(game, 'p1', 'island');
    const k = findIn(game, 'p1', 'hand', kiora.id);
    expect(cast(game, 'p1', k, { targets: [{ kind: 'object', id: g1 }, { kind: 'object', id: g2 }] }).ok).toBe(false); // {U}{U} com uma Island
    put(game, 'p1', 'island');
    expect(cast(game, 'p1', k, { targets: [{ kind: 'object', id: g1 }, { kind: 'object', id: g2 }] }).ok).toBe(true);
    settle(game);
    expect(game.state.objects[g1].zone).toBe('hand');
    expect(game.state.objects[g2].zone).toBe('hand');
  });

  it('Exhibition Tidecaller: mói 3, ou 10 se a mágica custou 5 ou mais', () => {
    const game = makeGame([...FILLER, tidecaller, lightningBolt, deepAnalysis], FILLER, { topP1: [tidecaller.id, 'lightning-bolt', deepAnalysis.id] });
    goToMain1(game);
    put(game, 'p1', tidecaller.id);
    lands(game, 'p1', 'mountain', 'island', 'island', 'island', 'island');
    const lib = game.state.players.p2.zones.library.length;
    const bolt = findIn(game, 'p1', 'hand', 'lightning-bolt');
    expect(cast(game, 'p1', bolt, { targets: [{ kind: 'player', player: 'p2' }] }).ok).toBe(true);
    passUntil(game, (s) => s.pendingDecision?.type === 'chooseTargets', 20);
    expect(game.apply('p1', { type: 'chooseTargets', targets: [{ kind: 'player', player: 'p2' }] }).ok).toBe(true);
    settle(game);
    expect(game.state.players.p2.zones.library.length).toBe(lib - 3);
    const da = findIn(game, 'p1', 'hand', deepAnalysis.id);
    expect(cast(game, 'p1', da, { targets: [{ kind: 'player', player: 'p1' }] }).ok).toBe(true); // {3}{U} = 4 de mana: ainda 3
    passUntil(game, (s) => s.pendingDecision?.type === 'chooseTargets', 20);
    expect(game.apply('p1', { type: 'chooseTargets', targets: [{ kind: 'player', player: 'p2' }] }).ok).toBe(true);
    settle(game);
    expect(game.state.players.p2.zones.library.length).toBe(lib - 6);
  });

  it('Helm of Obedience: mói até uma criatura ou X cartas; a criatura entra sob seu controle e o Helm é sacrificado', () => {
    const game = makeGame([...FILLER, helm, idol, idol, idol], [...FILLER, grizzlyBears], { topP1: [helm.id, idol.id, idol.id, idol.id], topP2: ['grizzly-bears'] });
    goToMain1(game);
    const h = put(game, 'p1', helm.id);
    put(game, 'p1', idol.id); put(game, 'p1', idol.id); put(game, 'p1', idol.id);
    const bears = findIn(game, 'p2', 'hand', 'grizzly-bears');
    game.apply('p2', { type: 'manualMove', objectId: bears, to: 'library', position: 'top' });
    const L = game.state.players.p2.zones.library;
    // Bears na 2ª posição: mói uma não-criatura, depois o urso e para.
    L.splice(L.indexOf(bears), 1); L.splice(1, 0, bears);
    expect(game.apply('p1', { type: 'activateAbility', objectId: h, abilityIndex: 0, x: 3, targets: [{ kind: 'player', player: 'p2' }] }).ok).toBe(true);
    settle(game);
    expect(game.state.objects[bears].zone).toBe('battlefield');
    expect(game.state.objects[bears].controller).toBe('p1');
    expect(game.state.objects[h].zone).toBe('graveyard');
    expect(game.state.players.p2.zones.graveyard).toHaveLength(1);
  });

  it('Necrodominance: mão máxima 5, cartas suas vão para o exílio, no fim do turno paga vida e compra', () => {
    const game = makeGame([...FILLER, necro, grizzlyBears], FILLER, { topP1: [necro.id, 'grizzly-bears'] });
    goToMain1(game);
    put(game, 'p1', necro.id);
    const mine = put(game, 'p1', 'grizzly-bears');
    game.apply('p1', { type: 'manualMove', objectId: mine, to: 'graveyard' });
    expect(game.state.objects[mine].zone).toBe('exile');
    // Fim do turno: pergunta quanto de vida pagar; paga 3 → compra 3; depois descarta até 5.
    passUntil(game, (s) => s.pendingDecision?.type === 'effectChoice', 60);
    let pd = choice(game);
    expect(pd.mode).toBe('number');
    const hand = game.state.players.p1.zones.hand.length;
    answer(game, 'p1', [], '3');
    expect(game.state.players.p1.life).toBe(17);
    expect(game.state.players.p1.zones.hand.length).toBe(hand + 3);
    passUntil(game, (s) => s.pendingDecision?.type === 'discardToHandSize', 60);
    const dd = game.state.pendingDecision;
    expect(dd?.type === 'discardToHandSize' && dd.count).toBe(game.state.players.p1.zones.hand.length - 5);
  });

  it('Jace −8: compra sete e, com a biblioteca vazia, vence', () => {
    const game = makeGame([...FILLER, jace], FILLER, { topP1: [jace.id] });
    goToMain1(game);
    const j = put(game, 'p1', jace.id);
    game.state.objects[j].counters['loyalty'] = 8;
    game.state.players.p1.zones.library.splice(7); // exatamente 7 cartas
    const minus8 = (jace.abilities ?? []).findIndex((a) => a.kind === 'loyalty' && /−8|-8/.test(a.text));
    expect(minus8).toBeGreaterThanOrEqual(0);
    expect(game.apply('p1', { type: 'activateAbility', objectId: j, abilityIndex: minus8 }).ok).toBe(true);
    settle(game);
    expect(game.state.status).toBe('finished');
    expect(game.state.winner).toBe('p1');
  });

  it('Commandeer: exilando duas cartas azuis da mão, rouba a mágica não-criatura do oponente', () => {
    const game = makeGame([...FILLER, commandeer, kiora, kiora], [...FILLER, idol], { topP1: [commandeer.id, kiora.id, kiora.id], topP2: [idol.id] });
    goToMain1(game);
    lands(game, 'p2', 'mountain', 'mountain');
    passUntil(game, (s) => s.turn === 2 && s.step === 'main1' && s.priority === 'p2' && s.stack.length === 0, 400);
    untapAll(game, 'p2');
    const i = findIn(game, 'p2', 'hand', idol.id);
    expect(cast(game, 'p2', i).ok).toBe(true);
    expect(game.apply('p2', { type: 'passPriority' }).ok).toBe(true);
    const c = findIn(game, 'p1', 'hand', commandeer.id);
    const blues = game.state.players.p1.zones.hand.filter((id) => id !== c && game.state.objects[id].card.colors.includes('U')).slice(0, 2);
    expect(blues).toHaveLength(2);
    expect(cast(game, 'p1', c, { useAltCost: true, altExile: blues, targets: [{ kind: 'object', id: i }] }).ok).toBe(true);
    settle(game);
    expect(game.state.objects[i].zone).toBe('battlefield');
    expect(game.state.objects[i].controller).toBe('p1');
  });
});
