/** M30 (Legacy parte 7): Ponder (ordem), derrota por compra com biblioteca vazia (SBA), Laboratory Maniac, Ad Nauseam, Infernal Tutor, Wishclaw Talisman, Street Wraith, Thassa's Oracle, Beseech the Mirror → Beseech the Mirror com barganha. */
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
const untilChoice = (game: Game) => passUntil(game, (s) => s.status === 'finished' || s.pendingDecision !== null || (s.stack.length === 0 && s.triggerQueue.length === 0));
const answer = (game: Game, p: PlayerId, picks: number[], text?: string) => game.apply(p, { type: 'effectChoice', picks, text });
const choice = (game: Game) => { const pd = game.state.pendingDecision; if (pd?.type !== 'effectChoice') throw new Error(`esperava effectChoice, veio ${pd?.type ?? 'nada'}`); return pd; };
/** Leaves exactly `keep` cards in the library (the rest goes to exile). */
const trimLibrary = (game: Game, p: PlayerId, keep: number) => {
  while (game.state.players[p].zones.library.length > keep) {
    const id = game.state.players[p].zones.library[game.state.players[p].zones.library.length - 1];
    game.apply(p, { type: 'manualMove', objectId: id, to: 'exile' });
  }
};
const emptyHand = (game: Game, p: PlayerId, except: number[] = []) => {
  for (const id of [...game.state.players[p].zones.hand]) if (!except.includes(id)) game.apply(p, { type: 'manualMove', objectId: id, to: 'library', position: 'bottom' });
};

const ponder = mk({ name: 'Ponder', manaCost: '{U}', typeLine: 'Sorcery', colors: ['U'], oracleText: 'Look at the top three cards of your library, then put them back in any order. You may shuffle.\nDraw a card.' });
const adNauseam = mk({ name: 'Ad Nauseam', manaCost: '{3}{B}{B}', typeLine: 'Instant', colors: ['B'], oracleText: 'Reveal the top card of your library and put that card into your hand. You lose life equal to its mana value. You may repeat this process any number of times.' });
const tutor = mk({ name: 'Infernal Tutor', manaCost: '{1}{B}', typeLine: 'Sorcery', colors: ['B'], oracleText: 'Reveal a card from your hand. Search your library for a card with the same name as that card, reveal it, put it into your hand, then shuffle.\nHellbent — If you have no cards in hand, instead search your library for a card, put it into your hand, then shuffle.' });
const wishclaw = mk({ name: 'Wishclaw Talisman', manaCost: '{1}{B}', typeLine: 'Artifact', colors: [], oracleText: 'This artifact enters with three wish counters on it.\n{1}, {T}, Remove a wish counter from this artifact: Search your library for a card, put it into your hand, then shuffle. An opponent gains control of this artifact. Activate only during your turn.' });
const wraith = mk({ name: 'Street Wraith', manaCost: '{3}{B}{B}', typeLine: 'Creature — Wraith', power: 3, toughness: 4, colors: ['B'], oracleText: "Swampwalk (This creature can't be blocked as long as defending player controls a Swamp.)\nCycling—Pay 2 life. (Pay 2 life, Discard this card: Draw a card.)" });
const oracle = mk({ name: "Thassa's Oracle", manaCost: '{U}{U}', typeLine: 'Creature — Merfolk Wizard', power: 1, toughness: 3, colors: ['U'], oracleText: 'When this creature enters, look at the top X cards of your library, where X is your devotion to blue. Put up to one of them on top of your library and the rest on the bottom of your library in a random order. If X is greater than or equal to the number of cards in your library, you win the game. (Each {U} in the mana costs of permanents you control counts toward your devotion to blue.)' });
const labman = mk({ name: 'Laboratory Maniac', manaCost: '{2}{U}', typeLine: 'Creature — Human Wizard', power: 2, toughness: 2, colors: ['U'], oracleText: 'If you would draw a card while your library has no cards in it, you win the game instead.' });
const beseech = mk({ name: 'Beseech the Mirror', manaCost: '{1}{B}{B}{B}', typeLine: 'Sorcery', colors: ['B'], oracleText: "Bargain (You may sacrifice an artifact, enchantment, or token as you cast this spell.)\nSearch your library for a card, exile it face down, then shuffle. If this spell was bargained, you may cast the exiled card without paying its mana cost if that spell's mana value is 4 or less. Put the exiled card into your hand if it wasn't cast this way." });
const idol = mk({ name: 'Bear Idol', manaCost: '{2}', typeLine: 'Artifact', colors: [], oracleText: '{T}: Add {C}.' });
const edge = mk({ name: 'Edge of Autumn', manaCost: '{1}{G}', typeLine: 'Sorcery', colors: ['G'], oracleText: 'If you control four or fewer lands, search your library for a basic land card, put it onto the battlefield tapped, then shuffle.\nCycling—Sacrifice a land. (Sacrifice a land, Discard this card: Draw a card.)' });
const peer = mk({ name: 'Peer into the Abyss', manaCost: '{4}{B}{B}{B}', typeLine: 'Sorcery', colors: ['B'], oracleText: 'Target player draws cards equal to half the number of cards in their library and loses half their life. Round up each time.' });

describe('M30 · Legacy parte 7', () => {
  it('compila tudo como full', () => {
    for (const c of [ponder, adNauseam, tutor, wishclaw, wraith, oracle, labman, beseech]) expect(c.automation, `${c.name}: ${c.automationNotes?.join(' | ')}`).toBe('full');
    expect(ponder.spellEffect?.[0]).toMatchObject({ op: 'reorderTop', count: 3 });
    expect(wraith.cycling).toMatchObject({ life: 2 });
    expect(wishclaw.entersWithCounters).toMatchObject({ counter: 'wish', count: 3 });
  });

  it('Ponder: reordena as três do topo na ordem clicada (não é vidência) e compra a primeira', () => {
    const game = makeGame([...FILLER, ponder], FILLER, { topP1: [ponder.id] });
    goToMain1(game);
    put(game, 'p1', 'island');
    const p = findIn(game, 'p1', 'hand', ponder.id);
    expect(cast(game, 'p1', p).ok).toBe(true);
    untilChoice(game);
    let pd = choice(game);
    expect(pd.mode).toBe('order');
    expect(pd.options).toHaveLength(3);
    expect(pd.min).toBe(3);
    const [a, b, c] = pd.options;
    answer(game, 'p1', [c, a, b]);
    untilChoice(game);
    pd = choice(game);
    expect(pd.mode).toBe('confirm'); // "You may shuffle."
    answer(game, 'p1', [], 'no');
    settle(game);
    expect(game.state.objects[c].zone).toBe('hand'); // comprou a que ficou no topo
    expect(game.state.players.p1.zones.library.slice(0, 2)).toEqual([a, b]);
  });

  it('comprar com a biblioteca vazia: perde na próxima verificação de estado', () => {
    const game = makeGame([...FILLER, grizzlyBears], FILLER);
    goToMain1(game);
    trimLibrary(game, 'p1', 0);
    expect(game.state.status).toBe('playing');
    passUntil(game, (s) => s.status === 'finished', 120); // turno do Bob, depois a etapa de compra da Alice
    expect(game.state.winner).toBe('p2');
  });

  it('Laboratory Maniac: comprar com a biblioteca vazia vence em vez de perder', () => {
    const game = makeGame([...FILLER, labman], FILLER, { topP1: [labman.id] });
    goToMain1(game);
    put(game, 'p1', labman.id);
    trimLibrary(game, 'p1', 0);
    passUntil(game, (s) => s.status === 'finished', 120);
    expect(game.state.winner).toBe('p1');
  });

  it('Ad Nauseam: revela, põe na mão e perde vida igual ao valor de mana, quantas vezes quiser', () => {
    const game = makeGame([...FILLER, adNauseam, grizzlyBears, lightningBolt], FILLER, { topP1: [adNauseam.id, 'grizzly-bears', 'lightning-bolt'] });
    goToMain1(game);
    const an = findIn(game, 'p1', 'hand', adNauseam.id);
    // topo da biblioteca: Grizzly Bears (2), Lightning Bolt (1), depois terrenos (0)
    const bears = put(game, 'p1', 'grizzly-bears', 'hand'); const bolt = put(game, 'p1', 'lightning-bolt', 'hand');
    game.apply('p1', { type: 'manualMove', objectId: bolt, to: 'library', position: 'top' });
    game.apply('p1', { type: 'manualMove', objectId: bears, to: 'library', position: 'top' });
    put(game, 'p1', 'swamp'); put(game, 'p1', 'swamp'); put(game, 'p1', 'mountain'); put(game, 'p1', 'mountain'); put(game, 'p1', 'mountain');
    expect(cast(game, 'p1', an).ok).toBe(true);
    untilChoice(game);
    expect(choice(game).mode).toBe('confirm');
    answer(game, 'p1', [], 'yes'); // Bears: -2
    expect(choice(game).mode).toBe('confirm');
    answer(game, 'p1', [], 'yes'); // Bolt: -1
    expect(choice(game).mode).toBe('confirm');
    answer(game, 'p1', [], 'yes'); // terreno: -0
    answer(game, 'p1', [], 'no');
    settle(game);
    expect(game.state.players.p1.life).toBe(17);
    expect(game.state.objects[bears].zone).toBe('hand');
    expect(game.state.objects[bolt].zone).toBe('hand');
    expect(game.state.objects[an].zone).toBe('graveyard');
  });

  it('Infernal Tutor: revela uma carta da mão e busca outra com o mesmo nome; hellbent busca qualquer carta', () => {
    const game = makeGame([...FILLER, tutor, tutor], FILLER, { topP1: [tutor.id] });
    goToMain1(game);
    put(game, 'p1', 'swamp'); put(game, 'p1', 'swamp');
    const t1 = findIn(game, 'p1', 'hand', tutor.id);
    const inHand = put(game, 'p1', 'island', 'hand');
    emptyHand(game, 'p1', [t1, inHand]);
    expect(cast(game, 'p1', t1).ok).toBe(true);
    untilChoice(game);
    // Só uma carta na mão: a revelação é forçada e resolve sozinha; a busca já vem filtrada pelo nome.
    let pd = choice(game);
    expect(pd.mode).toBe('cards');
    expect(pd.options).toHaveLength(5); // as cinco Islands restantes na biblioteca
    expect(pd.options.every((id) => game.state.objects[id].card.id === 'island')).toBe(true); // só Islands
    expect(game.state.lastRevealedName).toBe('Island');
    const found = pd.options[0];
    answer(game, 'p1', [found]);
    settle(game);
    expect(game.state.objects[found].zone).toBe('hand');
    // Hellbent: sem cartas na mão, busca qualquer carta.
    const g2 = makeGame([...FILLER, tutor], FILLER, { topP1: [tutor.id] });
    goToMain1(g2);
    put(g2, 'p1', 'swamp'); put(g2, 'p1', 'swamp');
    const t2 = findIn(g2, 'p1', 'hand', tutor.id);
    emptyHand(g2, 'p1', [t2]);
    expect(cast(g2, 'p1', t2).ok).toBe(true);
    untilChoice(g2);
    pd = choice(g2);
    expect(pd.options).toHaveLength(g2.state.players.p1.zones.library.length); // qualquer carta
    const m = pd.options.find((id) => g2.state.objects[id].card.id === 'mountain')!;
    answer(g2, 'p1', [m]);
    settle(g2);
    expect(g2.state.objects[m].zone).toBe('hand');
  });

  it('Wishclaw Talisman: entra com três marcadores; ativar busca uma carta e passa o artefato ao oponente', () => {
    const game = makeGame([...FILLER, wishclaw], FILLER, { topP1: [wishclaw.id] });
    goToMain1(game);
    put(game, 'p1', 'swamp'); put(game, 'p1', 'swamp'); put(game, 'p1', 'swamp');
    const w = findIn(game, 'p1', 'hand', wishclaw.id);
    expect(cast(game, 'p1', w).ok).toBe(true);
    settle(game);
    expect(game.state.objects[w].zone).toBe('battlefield');
    expect(game.state.objects[w].counters['wish']).toBe(3);
    const r = game.apply('p1', { type: 'activateAbility', objectId: w, abilityIndex: 0 });
    expect(r.ok, JSON.stringify(r.events.filter((e) => e.type === 'error'))).toBe(true);
    untilChoice(game);
    const pd = choice(game);
    const pick = pd.options.find((id) => game.state.objects[id].card.id === 'plains')!;
    answer(game, 'p1', [pick]);
    settle(game);
    expect(game.state.objects[pick].zone).toBe('hand');
    expect(game.state.objects[w].controller).toBe('p2');
    expect(game.state.players.p2.zones.battlefield).toContain(w);
    expect(game.state.objects[w].counters['wish']).toBe(2);
  });

  it('Street Wraith: reciclar pagando 2 de vida compra uma carta', () => {
    const game = makeGame([...FILLER, wraith], FILLER, { topP1: [wraith.id] });
    goToMain1(game);
    const sw = findIn(game, 'p1', 'hand', wraith.id);
    const hand = game.state.players.p1.zones.hand.length;
    const r = game.apply('p1', { type: 'cycle', objectId: sw });
    expect(r.ok, JSON.stringify(r.events.filter((e) => e.type === 'error'))).toBe(true);
    settle(game);
    expect(game.state.players.p1.life).toBe(18);
    expect(game.state.objects[sw].zone).toBe('graveyard');
    expect(game.state.players.p1.zones.hand.length).toBe(hand); // -1 (Wraith) +1 (compra)
  });

  it("Thassa's Oracle: devoção ≥ biblioteca vence o jogo; com biblioteca maior, só reorganiza o topo", () => {
    const game = makeGame([...FILLER, oracle], FILLER, { topP1: [oracle.id] });
    goToMain1(game);
    put(game, 'p1', 'island'); put(game, 'p1', 'island');
    const o = findIn(game, 'p1', 'hand', oracle.id);
    trimLibrary(game, 'p1', 5); // devoção 2 < 5: não vence
    expect(cast(game, 'p1', o).ok).toBe(true);
    untilChoice(game);
    let pd = choice(game);
    expect(pd.options).toHaveLength(2); // X = 2 (o próprio Oracle)
    const keep = pd.options[0];
    answer(game, 'p1', [keep]);
    settle(game);
    expect(game.state.status).toBe('playing');
    expect(game.state.players.p1.zones.library[0]).toBe(keep);
    expect(game.state.players.p1.zones.library).toHaveLength(5);
    // Segundo Oracle com a biblioteca em 2 cartas: devoção 4 ≥ 2 → vitória.
    const g2 = makeGame([...FILLER, oracle], FILLER, { topP1: [oracle.id] });
    goToMain1(g2);
    put(g2, 'p1', 'island'); put(g2, 'p1', 'island');
    const o2 = findIn(g2, 'p1', 'hand', oracle.id);
    trimLibrary(g2, 'p1', 1);
    expect(cast(g2, 'p1', o2).ok).toBe(true);
    untilChoice(g2);
    pd = choice(g2);
    answer(g2, 'p1', []);
    settle(g2);
    expect(g2.state.status).toBe('finished');
    expect(g2.state.winner).toBe('p1');
  });

  it('Beseech the Mirror barganhado busca outro Beseech, que pode barganhar de novo ao ser conjurado de graça', () => {
    const game = makeGame([...FILLER, beseech, beseech, idol, idol, lightningBolt], FILLER, { topP1: [beseech.id, idol.id, idol.id] });
    goToMain1(game);
    const art1 = put(game, 'p1', idol.id); const art2 = put(game, 'p1', idol.id);
    for (let i = 0; i < 4; i++) put(game, 'p1', 'swamp');
    const b1 = findIn(game, 'p1', 'hand', beseech.id);
    emptyHand(game, 'p1', [b1]);
    const b2 = findIn(game, 'p1', 'library', beseech.id);
    const bolt = findIn(game, 'p1', 'library', 'lightning-bolt');
    expect(cast(game, 'p1', b1, { kicked: true, sacrifices: [art1] }).ok).toBe(true);
    untilChoice(game);
    answer(game, 'p1', [b2]); // busca o segundo Beseech
    expect(choice(game).mode).toBe('confirm');
    answer(game, 'p1', [], 'yes'); // conjura de graça
    let pd = choice(game); // decisão de barganha do segundo Beseech
    expect(pd.mode).toBe('cards');
    expect(pd.options).toEqual([art2]);
    expect(pd.prompt).toMatch(/barganhar/i);
    answer(game, 'p1', [art2]);
    expect(game.state.objects[art2].zone).toBe('graveyard');
    expect(game.state.objects[b2].zone).toBe('stack');
    expect(game.state.objects[b2].kicked).toBe(true);
    expect(game.state.objects[b1].zone).toBe('graveyard'); // o primeiro terminou de resolver
    untilChoice(game);
    answer(game, 'p1', [bolt]); // segundo Beseech busca o Bolt
    pd = choice(game);
    expect(pd.mode).toBe('confirm'); // barganhado: pode conjurar de graça
    answer(game, 'p1', [], 'yes');
    expect(game.state.pendingDecision?.type).toBe('chooseTargets');
    expect(game.apply('p1', { type: 'chooseTargets', targets: [{ kind: 'player', player: 'p2' }] }).ok).toBe(true);
    settle(game);
    expect(game.state.players.p2.life).toBe(17);
    expect(game.state.objects[b2].zone).toBe('graveyard');
  });

  it('Beseech de graça sem barganha (nenhum sacrifício escolhido) só põe a carta buscada na mão', () => {
    const game = makeGame([...FILLER, beseech, beseech, idol, idol, lightningBolt], FILLER, { topP1: [beseech.id, idol.id, idol.id] });
    goToMain1(game);
    const art1 = put(game, 'p1', idol.id); put(game, 'p1', idol.id);
    for (let i = 0; i < 4; i++) put(game, 'p1', 'swamp');
    const b1 = findIn(game, 'p1', 'hand', beseech.id);
    emptyHand(game, 'p1', [b1]);
    const b2 = findIn(game, 'p1', 'library', beseech.id);
    const bolt = findIn(game, 'p1', 'library', 'lightning-bolt');
    expect(cast(game, 'p1', b1, { kicked: true, sacrifices: [art1] }).ok).toBe(true);
    untilChoice(game);
    answer(game, 'p1', [b2]);
    answer(game, 'p1', [], 'yes');
    expect(choice(game).prompt).toMatch(/barganhar/i);
    answer(game, 'p1', []); // sem barganha
    expect(game.state.objects[b2].zone).toBe('stack');
    expect(game.state.objects[b2].kicked ?? false).toBe(false);
    untilChoice(game);
    answer(game, 'p1', [bolt]);
    settle(game);
    expect(game.state.objects[bolt].zone).toBe('hand'); // não barganhado: vai para a mão
    expect(game.state.players.p2.life).toBe(20);
  });

  it('Edge of Autumn: com quatro terrenos ou menos busca um básico virado; com cinco não busca; reciclar sacrifica um terreno e compra', () => {
    expect(edge.automation, edge.automationNotes?.join(' | ')).toBe('full');
    expect(edge.cycling).toMatchObject({ sacrifice: { what: 'land' } });
    const game = makeGame([...FILLER, edge, edge], FILLER, { topP1: [edge.id, edge.id] });
    goToMain1(game);
    put(game, 'p1', 'forest'); put(game, 'p1', 'forest');
    const e1 = findIn(game, 'p1', 'hand', edge.id);
    expect(cast(game, 'p1', e1).ok).toBe(true);
    untilChoice(game);
    let pd = choice(game);
    expect(pd.options.every((id) => game.state.objects[id].card.types.includes('Land'))).toBe(true);
    const found = pd.options[0];
    answer(game, 'p1', [found]);
    settle(game);
    expect(game.state.objects[found].zone).toBe('battlefield');
    expect(game.state.objects[found].tapped).toBe(true);
    // Cinco terrenos: a segunda cópia não busca nada.
    put(game, 'p1', 'forest'); put(game, 'p1', 'forest');
    expect(game.state.players.p1.zones.battlefield.filter((id) => game.state.objects[id].card.types.includes('Land'))).toHaveLength(5);
    const e2 = findIn(game, 'p1', 'hand', edge.id);
    const libN = game.state.players.p1.zones.library.length;
    for (const id of game.state.players.p1.zones.battlefield) game.state.objects[id].tapped = false;
    expect(cast(game, 'p1', e2).ok).toBe(true);
    settle(game);
    expect(game.state.pendingDecision).toBeNull();
    expect(game.state.players.p1.zones.library).toHaveLength(libN);
    expect(game.state.objects[e2].zone).toBe('graveyard');
    // Reciclar: precisa sacrificar um terreno.
    const g2 = makeGame([...FILLER, edge], FILLER, { topP1: [edge.id] });
    goToMain1(g2);
    const land = put(g2, 'p1', 'forest');
    const e3 = findIn(g2, 'p1', 'hand', edge.id);
    expect(g2.apply('p1', { type: 'cycle', objectId: e3 }).ok).toBe(false); // sem sacrifício
    const hand = g2.state.players.p1.zones.hand.length;
    expect(g2.apply('p1', { type: 'cycle', objectId: e3, sacrifice: land }).ok).toBe(true);
    expect(g2.state.objects[land].zone).toBe('graveyard');
    expect(g2.state.objects[e3].zone).toBe('graveyard');
    expect(g2.state.players.p1.zones.hand.length).toBe(hand); // -1 (Edge) +1 (compra)
  });

  it('Peer into the Abyss: o jogador alvo compra metade da biblioteca e perde metade da vida, arredondando para cima', () => {
    expect(peer.automation, peer.automationNotes?.join(' | ')).toBe('full');
    const game = makeGame([...FILLER, peer], FILLER, { topP1: [peer.id] });
    goToMain1(game);
    for (let i = 0; i < 4; i++) put(game, 'p1', 'swamp');
    put(game, 'p1', 'mountain'); put(game, 'p1', 'mountain'); put(game, 'p1', 'mountain');
    const p = findIn(game, 'p1', 'hand', peer.id);
    trimLibrary(game, 'p2', 7); // 7 cartas → compra 4
    game.state.players.p2.life = 19; // → perde 10
    const hand = game.state.players.p2.zones.hand.length;
    expect(cast(game, 'p1', p, { targets: [{ kind: 'player', player: 'p2' }] }).ok).toBe(true);
    settle(game);
    expect(game.state.players.p2.zones.hand.length).toBe(hand + 4);
    expect(game.state.players.p2.zones.library).toHaveLength(3);
    expect(game.state.players.p2.life).toBe(9);
    expect(game.state.players.p1.life).toBe(20);
  });
});
