/** M24: sideboard como zona "fora do jogo" — Burning Wish, Cunning Wish, Living Wish, Death Wish, Glittering Wish e Karn −2 (sideboard ou exílio). */
import { describe, expect, it } from 'vitest';
import { compileOracleCard, type OracleInput } from '../src/cards/oracle-parser.js';
import { forest, grizzlyBears, island, lightningBolt, mountain, plains, swamp } from '../src/cards/demo-set.js';
import type { CardDefinition } from '../src/cards/types.js';
import { Game } from '../src/game.js';
import type { PlayerId } from '../src/types.js';
import { findIn, passUntil } from './helpers.js';

const mk = (input: OracleInput): CardDefinition => {
  const def = compileOracleCard(input);
  if (!def) throw new Error(`não compilou: ${input.name}`);
  return def;
};
const copies = (card: CardDefinition, n: number) => Array.from({ length: n }, () => card);
const FILLER = [...copies(mountain, 6), ...copies(forest, 6), ...copies(island, 6), ...copies(plains, 6), ...copies(swamp, 4)];
const settle = (game: Game) => passUntil(game, (s) => s.stack.length === 0 && s.triggerQueue.length === 0 && s.pendingDecision === null);
const untilChoice = (game: Game) => passUntil(game, (s) => s.pendingDecision?.type === 'effectChoice' || (s.stack.length === 0 && s.triggerQueue.length === 0 && s.pendingDecision === null));
const cast = (game: Game, p: PlayerId, id: number, extra: Record<string, unknown> = {}) => game.apply(p, { type: 'castSpell', objectId: id, ...extra } as never);
function put(game: Game, player: PlayerId, cardId: string, zone: 'battlefield' | 'graveyard' | 'hand' = 'battlefield'): number {
  let id: number;
  try { id = findIn(game, player, 'library', cardId); } catch { id = findIn(game, player, 'hand', cardId); }
  const r = game.apply(player, { type: 'manualMove', objectId: id, to: zone });
  if (!r.ok) throw new Error(`setup falhou: ${cardId} → ${zone}`);
  return id;
}
/** makeGame com sideboard para o p1. */
function gameWithSideboard(p1Main: CardDefinition[], p1Side: CardDefinition[], topP1: string[]): Game {
  const game = new Game(
    [
      { id: 'p1', name: 'Alice', deck: { cards: p1Main, sideboard: p1Side } },
      { id: 'p2', name: 'Bob', deck: { cards: FILLER } },
    ],
    42,
    { firstPlayer: 'p1' },
  );
  const lib = game.state.players.p1.zones.library;
  const pool = [...lib];
  const ordered: number[] = [];
  for (const cardId of topP1) {
    const idx = pool.findIndex((oid) => game.state.objects[oid].card.id === cardId);
    if (idx < 0) throw new Error(`não está na biblioteca: ${cardId}`);
    ordered.push(pool[idx]);
    pool.splice(idx, 1);
  }
  game.state.players.p1.zones.library = [...ordered, ...pool];
  game.start();
  game.apply('p1', { type: 'keepHand', bottom: [] });
  game.apply('p2', { type: 'keepHand', bottom: [] });
  passUntil(game, (s) => s.step === 'main1' && s.priority === s.activePlayer && s.stack.length === 0);
  return game;
}

const burningWish = mk({ name: 'Burning Wish', manaCost: '{1}{R}', typeLine: 'Sorcery', colors: ['R'], oracleText: 'You may reveal a sorcery card you own from outside the game and put it into your hand. Exile Burning Wish.' });
const cunningWish = mk({ name: 'Cunning Wish', manaCost: '{2}{U}', typeLine: 'Instant', colors: ['U'], oracleText: 'You may reveal an instant card you own from outside the game and put it into your hand. Exile Cunning Wish.' });
const livingWish = mk({ name: 'Living Wish', manaCost: '{1}{G}', typeLine: 'Sorcery', colors: ['G'], oracleText: 'You may reveal a creature or land card you own from outside the game and put it into your hand. Exile Living Wish.' });
const deathWish = mk({ name: 'Death Wish', manaCost: '{1}{B}{B}', typeLine: 'Sorcery', colors: ['B'], oracleText: 'You may put a card you own from outside the game into your hand. You lose half your life, rounded up. Exile Death Wish.' });
const glitteringWish = mk({ name: 'Glittering Wish', manaCost: '{G}{W}', typeLine: 'Sorcery', colors: ['G', 'W'], oracleText: 'You may reveal a multicolored card you own from outside the game and put it into your hand. Exile Glittering Wish.' });
const karn = mk({ name: 'Karn, the Great Creator', manaCost: '{4}', typeLine: 'Legendary Planeswalker — Karn', loyalty: 5, colors: [], oracleText: "Activated abilities of artifacts your opponents control can't be activated.\n+1: Until your next turn, up to one target noncreature artifact becomes an artifact creature with power and toughness each equal to its mana value.\n−2: You may reveal an artifact card you own from outside the game or choose a face-up artifact card you own in exile. Put that card into your hand." });
const sorceryX = mk({ name: 'Bear Sorcery', manaCost: '{B}', typeLine: 'Sorcery', colors: ['B'], oracleText: 'You gain 2 life.' });
const artifactX = mk({ name: 'Bear Idol', manaCost: '{2}', typeLine: 'Artifact', colors: [], oracleText: '{T}: Add {C}.' });

describe('M24 · compilação', () => {
  it('Wishes e Karn compilam como full', () => {
    for (const c of [burningWish, cunningWish, livingWish, deathWish, glitteringWish, karn]) expect(c.automation, `${c.name}: ${c.automationNotes?.join(' | ')}`).toBe('full');
    expect(burningWish.spellEffect).toEqual([{ op: 'wish', filter: { what: 'sorcery' } }]);
    expect(burningWish.exileOnResolve).toBe(true);
    expect(livingWish.spellEffect?.[0]).toMatchObject({ op: 'wish', filter: { what: 'permanent', typeAnyOf: ['Creature', 'Land'] } });
    expect(deathWish.spellEffect).toEqual([{ op: 'wish' }, { op: 'loseLife', who: 'controller', amount: { halfLifeOf: 'controller', round: 'up' } }]);
    expect(glitteringWish.spellEffect?.[0]).toMatchObject({ op: 'wish', filter: { multicolored: true } });
    expect(karn.abilities?.[1].effect[0]).toEqual({ op: 'wish', filter: { what: 'artifact' }, fromExile: true });
  });
});

describe('M24 · jogo', () => {
  it('o sideboard começa fora do jogo e aparece só para o dono', () => {
    const game = gameWithSideboard([...FILLER, burningWish], [sorceryX, artifactX], [burningWish.id]);
    expect(game.state.players.p1.zones.sideboard.length).toBe(2);
    expect(game.state.players.p2.zones.sideboard.length).toBe(0);
    for (const id of game.state.players.p1.zones.sideboard) expect(game.state.objects[id].zone).toBe('sideboard');
  });

  it('Burning Wish traz um feitiço do sideboard e é exilada', () => {
    const game = gameWithSideboard([...FILLER, burningWish], [sorceryX, artifactX], [burningWish.id]);
    put(game, 'p1', 'mountain'); put(game, 'p1', 'mountain');
    const wish = findIn(game, 'p1', 'hand', burningWish.id);
    expect(cast(game, 'p1', wish).ok).toBe(true);
    untilChoice(game);
    const pd = game.state.pendingDecision;
    expect(pd?.type).toBe('effectChoice');
    if (pd?.type !== 'effectChoice') return;
    const sorc = game.state.players.p1.zones.sideboard.find((id) => game.state.objects[id].card.id === sorceryX.id)!;
    expect(pd.options).toEqual([sorc]); // só o feitiço; o artefato não serve
    expect(game.apply('p1', { type: 'effectChoice', picks: [sorc] }).ok).toBe(true);
    settle(game);
    expect(game.state.objects[sorc].zone).toBe('hand');
    expect(game.state.objects[wish].zone).toBe('exile');
    expect(game.state.players.p1.zones.sideboard.length).toBe(1);
  });

  it('Death Wish traz qualquer carta e custa metade da vida', () => {
    const game = gameWithSideboard([...FILLER, deathWish], [artifactX], [deathWish.id]);
    put(game, 'p1', 'swamp'); put(game, 'p1', 'swamp'); put(game, 'p1', 'swamp');
    expect(cast(game, 'p1', findIn(game, 'p1', 'hand', deathWish.id)).ok).toBe(true);
    untilChoice(game);
    const art = game.state.players.p1.zones.sideboard[0];
    game.apply('p1', { type: 'effectChoice', picks: [art] });
    settle(game);
    expect(game.state.objects[art].zone).toBe('hand');
    expect(game.state.players.p1.life).toBe(10);
  });

  it('Karn −2 oferece artefatos do sideboard e do exílio', () => {
    const game = gameWithSideboard([...FILLER, karn, artifactX], [artifactX, sorceryX], [karn.id, artifactX.id]);
    const exiled = put(game, 'p1', artifactX.id, 'graveyard');
    game.apply('p1', { type: 'manualMove', objectId: exiled, to: 'exile' });
    for (let i = 0; i < 4; i++) put(game, 'p1', 'plains');
    const k = findIn(game, 'p1', 'hand', karn.id);
    expect(cast(game, 'p1', k).ok).toBe(true);
    settle(game);
    expect(game.apply('p1', { type: 'activateAbility', objectId: k, abilityIndex: 1 }).ok).toBe(true);
    untilChoice(game);
    const pd = game.state.pendingDecision;
    expect(pd?.type).toBe('effectChoice');
    if (pd?.type !== 'effectChoice') return;
    const sideArt = game.state.players.p1.zones.sideboard.find((id) => game.state.objects[id].card.id === artifactX.id)!;
    expect(pd.options.sort()).toEqual([sideArt, exiled].sort());
    game.apply('p1', { type: 'effectChoice', picks: [exiled] });
    settle(game);
    expect(game.state.objects[exiled].zone).toBe('hand');
  });

  it('sem sideboard, o Wish resolve sem escolha', () => {
    const game = gameWithSideboard([...FILLER, cunningWish, lightningBolt, grizzlyBears, island], [], [cunningWish.id]);
    put(game, 'p1', 'island'); put(game, 'p1', 'island'); put(game, 'p1', 'island');
    const w = findIn(game, 'p1', 'hand', cunningWish.id);
    expect(cast(game, 'p1', w).ok).toBe(true);
    settle(game);
    expect(game.state.pendingDecision).toBeNull();
    expect(game.state.objects[w].zone).toBe('exile');
  });
});
