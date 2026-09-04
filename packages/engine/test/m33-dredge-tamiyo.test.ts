/** M33: dragar como substituição de compra (etapa de compra e compras de efeitos, uma a uma) e Tamiyo com Brainstorm (o número da compra é o do momento da compra). */
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
const FILLER = [...copies(mountain, 6), ...copies(forest, 6), ...copies(island, 6), ...copies(plains, 6), ...copies(swamp, 4)];
const settle = (game: Game) => passUntil(game, (s) => s.status === 'finished' || (s.stack.length === 0 && s.triggerQueue.length === 0 && s.pendingDecision === null));
const cast = (game: Game, p: PlayerId, id: number, extra: Record<string, unknown> = {}) => game.apply(p, { type: 'castSpell', objectId: id, ...extra } as never);
const untilDecision = (game: Game) => passUntil(game, (s) => s.status === 'finished' || s.pendingDecision !== null || (s.stack.length === 0 && s.triggerQueue.length === 0));
const answer = (game: Game, p: PlayerId, picks: number[], text?: string) => game.apply(p, { type: 'effectChoice', picks, text });
const choice = (game: Game) => { const pd = game.state.pendingDecision; if (pd?.type !== 'effectChoice') throw new Error(`esperava effectChoice, veio ${pd?.type ?? 'nada'}`); return pd; };

const imp = mk({ name: 'Stinkweed Imp', manaCost: '{2}{B}', typeLine: 'Creature — Imp', power: 1, toughness: 2, colors: ['B'], oracleText: 'Flying\nWhenever this creature deals combat damage to a creature, destroy that creature.\nDredge 5' });
const golgariGrave = mk({ name: 'Golgari Grave-Troll', manaCost: '{4}{G}', typeLine: 'Creature — Skeleton Troll', power: 0, toughness: 0, colors: ['G'], oracleText: 'This creature enters with a +1/+1 counter on it for each creature card in your graveyard.\nDredge 6' });
const brainstorm = mk({ name: 'Brainstorm', manaCost: '{U}', typeLine: 'Instant', colors: ['U'], oracleText: 'Draw three cards, then put two cards from your hand on top of your library in any order.' });
const tamiyo = mk({ name: 'Tamiyo, Inquisitive Student', manaCost: '{U}', typeLine: 'Legendary Creature — Moonfolk Wizard', power: 0, toughness: 3, colors: ['U'], layout: 'transform', oracleText: 'Flying\nWhenever Tamiyo attacks, investigate.\nWhen you draw your third card in a turn, exile Tamiyo, then return her to the battlefield transformed under her owner\'s control.', backFace: { name: 'Tamiyo, Seasoned Scholar', typeLine: 'Legendary Planeswalker — Tamiyo', colors: ['G', 'U'], loyalty: 2, oracleText: '+2: Until your next turn, whenever a creature attacks you or a planeswalker you control, it gets -1/-0 until end of turn.\n−3: Return target instant or sorcery card from your graveyard to your hand. If it\'s a green card, add one mana of any color.\n−7: Draw cards equal to half the number of cards in your library, rounded up. You get an emblem with "You have no maximum hand size."' } });

describe('M33 · dragar como escolha de compra; Tamiyo com Brainstorm', () => {
  it('etapa de compra: com carta de dragar no cemitério, pergunta; dragar mói N e devolve a carta; comprar normalmente compra', () => {
    expect(imp.dredge).toBe(5);
    const game = makeGame([...FILLER, imp], FILLER, { topP1: [imp.id] });
    goToMain1(game);
    const i = put(game, 'p1', imp.id, 'graveyard');
    // Turno 3 (p1): a etapa de compra para na pergunta.
    passUntil(game, (s) => s.turn === 3 && s.step === 'draw' && s.pendingDecision !== null, 400);
    let pd = choice(game);
    expect(pd.player).toBe('p1');
    expect(pd.options).toEqual([i]);
    expect(pd.skipLabel).toBe('Comprar a carta');
    const lib = game.state.players.p1.zones.library.length;
    const hand = game.state.players.p1.zones.hand.length;
    answer(game, 'p1', [i]); // dragar
    expect(game.state.objects[i].zone).toBe('hand');
    expect(game.state.players.p1.zones.library.length).toBe(lib - 5);
    expect(game.state.players.p1.zones.graveyard.length).toBe(5);
    expect(game.state.players.p1.zones.hand.length).toBe(hand + 1);
    // Sem dragar: compra normal (a carta voltou para o cemitério? não — está na mão; põe de novo).
    put(game, 'p1', imp.id, 'graveyard');
    passUntil(game, (s) => s.turn === 5 && s.step === 'draw' && s.pendingDecision !== null, 600);
    pd = choice(game);
    const lib2 = game.state.players.p1.zones.library.length;
    answer(game, 'p1', []); // comprar
    expect(game.state.players.p1.zones.library.length).toBe(lib2 - 1);
    expect(game.state.objects[i].zone).toBe('graveyard');
  });

  it('sem carta de dragar (ou biblioteca curta demais), a etapa de compra não pergunta', () => {
    const game = makeGame([...FILLER, golgariGrave], FILLER, { topP1: [golgariGrave.id] });
    goToMain1(game);
    const g = put(game, 'p1', golgariGrave.id, 'graveyard');
    game.state.players.p1.zones.library.splice(5); // 5 cartas: dragar 6 não dá
    passUntil(game, (s) => s.turn === 3 && s.step === 'main1' && s.priority === 'p1', 400);
    expect(game.state.pendingDecision).toBeNull();
    expect(game.state.objects[g].zone).toBe('graveyard');
    expect(game.state.players.p1.zones.library).toHaveLength(4);
  });

  it('Brainstorm com carta de dragar: pergunta a cada uma das três compras; Tamiyo transforma na terceira compra do turno', () => {
    const game = makeGame([...FILLER, brainstorm, imp, tamiyo], FILLER, { topP1: [brainstorm.id, imp.id, tamiyo.id] });
    goToMain1(game);
    put(game, 'p1', 'island'); put(game, 'p1', 'island');
    const t = findIn(game, 'p1', 'hand', tamiyo.id);
    expect(cast(game, 'p1', t).ok).toBe(true);
    settle(game);
    put(game, 'p1', imp.id, 'graveyard');
    passUntil(game, (s) => s.turn === 3 && s.step === 'draw' && s.pendingDecision !== null, 400);
    answer(game, 'p1', []); // compra da etapa: normal (1ª compra do turno)
    passUntil(game, (s) => s.turn === 3 && s.step === 'main1' && s.priority === 'p1' && s.stack.length === 0, 50);
    for (const id of game.state.players.p1.zones.battlefield) game.state.objects[id].tapped = false;
    const b = findIn(game, 'p1', 'hand', brainstorm.id);
    expect(cast(game, 'p1', b).ok).toBe(true);
    untilDecision(game);
    let pd = choice(game);
    expect(pd.prompt).toMatch(/compra 1 de 3/);
    const i = findIn(game, 'p1', 'graveyard', imp.id);
    answer(game, 'p1', [i]); // 1ª "compra" do Brainstorm: dragar (não conta como compra)
    expect(game.state.objects[i].zone).toBe('hand');
    // Sem mais cartas de dragar no cemitério, as duas compras restantes acontecem direto (2ª e 3ª do turno → Tamiyo).
    expect(game.state.players.p1.drawsThisTurn).toBe(3);
    pd = choice(game);
    expect(pd.prompt).toMatch(/topo da biblioteca/);
    answer(game, 'p1', pd.options.slice(0, 2));
    settle(game);
    const tam = game.state.objects[t];
    expect(tam.transformed).toBe(true);
    expect(tam.card.name).toBe('Tamiyo, Seasoned Scholar');
  });
});
