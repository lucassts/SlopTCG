/** M44: Manamorphose, Borne Upon a Wind, Undermountain Adventurer, Lavinia, Void Mirror. */
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
const toMain1 = (game: Game, turn: number, p: PlayerId) => passUntil(game, (s) => s.turn === turn && s.step === 'main1' && s.priority === p && s.stack.length === 0, 600);

const C = (name: string, extra: Partial<OracleInput> & { oracleText: string; typeLine: string }) => mk({ name, colors: [], ...extra });
const manamorphose = C('Manamorphose', { manaCost: '{1}{R/G}', typeLine: 'Instant', colors: ['R', 'G'], oracleText: 'Add two mana in any combination of colors.\nDraw a card.' });
const borne = C('Borne Upon a Wind', { manaCost: '{1}{U}', typeLine: 'Instant', colors: ['U'], oracleText: 'You may cast spells this turn as though they had flash.\nDraw a card.' });
const adventurer = C('Undermountain Adventurer', { manaCost: '{3}{G}', typeLine: 'Creature — Giant Warrior', power: 4, toughness: 4, colors: ['G'], oracleText: "Vigilance\nWhen this creature enters, you take the initiative.\n{T}: Add {G}{G}. If you've completed a dungeon, add six {G} instead." });
const lavinia = C('Lavinia, Azorius Renegade', { manaCost: '{W}{U}', typeLine: 'Legendary Creature — Human Soldier', power: 2, toughness: 2, colors: ['W', 'U'], oracleText: "Each opponent can't cast noncreature spells with mana value greater than the number of lands that player controls.\nWhenever an opponent casts a spell, if no mana was spent to cast it, counter that spell." });
const mirror = C('Void Mirror', { manaCost: '{2}', typeLine: 'Artifact', oracleText: 'Whenever a player casts a spell, if no colored mana was spent to cast it, counter that spell.' });
const idol = C('Bear Idol', { manaCost: '{2}', typeLine: 'Artifact', oracleText: '{T}: Add {C}.' });
const genericTwo = C('Generic Two', { manaCost: '{2}', typeLine: 'Instant', oracleText: 'Draw a card.' });
const freebie = C('Free Bird', { manaCost: '{0}', typeLine: 'Instant', colors: ['U'], oracleText: 'Draw a card.' });

describe('M44 · Manamorphose, Borne Upon a Wind, Undermountain Adventurer, Lavinia, Void Mirror', () => {
  it('compila tudo como full', () => {
    for (const c of [manamorphose, borne, adventurer, lavinia, mirror]) expect(c.automation, `${c.name}: ${c.automationNotes?.join(' | ')}`).toBe('full');
  });

  it('Manamorphose: duas escolhas de cor independentes e compra uma carta', () => {
    const game = makeGame([...FILLER, manamorphose], FILLER, { topP1: [manamorphose.id] });
    goToMain1(game);
    lands(game, 'p1', 'mountain', 'forest');
    const h = game.state.players.p1.zones.hand.length;
    expect(cast(game, 'p1', findIn(game, 'p1', 'hand', manamorphose.id)).ok).toBe(true);
    untilDecision(game);
    expect(choice(game).mode).toBe('chooseColor');
    answer(game, 'p1', [], 'U');
    untilDecision(game);
    expect(choice(game).mode).toBe('chooseColor');
    answer(game, 'p1', [], 'B');
    settle(game);
    expect(game.state.players.p1.manaPool.U).toBe(1);
    expect(game.state.players.p1.manaPool.B).toBe(1);
    expect(game.state.players.p1.zones.hand.length).toBe(h); // −1 conjurada, +1 compra
  });

  it('Borne Upon a Wind: neste turno, criatura pode ser conjurada fora da fase principal', () => {
    const game = makeGame([...FILLER, borne, grizzlyBears], FILLER, { topP1: [borne.id, 'grizzly-bears'] });
    goToMain1(game);
    lands(game, 'p1', 'island', 'island', 'forest', 'forest');
    const bears = findIn(game, 'p1', 'hand', 'grizzly-bears');
    expect(cast(game, 'p1', findIn(game, 'p1', 'hand', borne.id)).ok).toBe(true);
    settle(game);
    passUntil(game, (s) => s.step === 'combatBegin' && s.priority === 'p1', 20);
    expect(cast(game, 'p1', bears).ok).toBe(true);
    settle(game);
    expect(game.state.objects[bears].zone).toBe('battlefield');
    // sem a permissão, no combate não pode
    const game2 = makeGame([...FILLER, grizzlyBears], FILLER, { topP1: ['grizzly-bears'] });
    goToMain1(game2);
    lands(game2, 'p1', 'forest', 'forest');
    passUntil(game2, (s) => s.step === 'combatBegin' && s.priority === 'p1', 20);
    expect(cast(game2, 'p1', findIn(game2, 'p1', 'hand', 'grizzly-bears')).ok).toBe(false);
  });

  it('Undermountain Adventurer: {G}{G}; seis {G} depois de completar uma masmorra', () => {
    const game = makeGame([...FILLER, adventurer], FILLER, { topP1: [adventurer.id] });
    goToMain1(game);
    const a = put(game, 'p1', adventurer.id); game.state.objects[a].summoningSick = false;
    const idx = adventurer.abilities!.findIndex((ab) => ab.kind === 'activated' && ab.isManaAbility);
    expect(game.apply('p1', { type: 'activateAbility', objectId: a, abilityIndex: idx }).ok).toBe(true);
    expect(game.state.players.p1.manaPool.G).toBe(2);
    game.state.objects[a].tapped = false;
    game.state.players.p1.completedDungeons = 1;
    expect(game.apply('p1', { type: 'activateAbility', objectId: a, abilityIndex: idx }).ok).toBe(true);
    expect(game.state.players.p1.manaPool.G).toBe(8);
  });

  it('Lavinia: com um terreno só, {2} é bloqueado; com dois passa; criatura ignora o limite', () => {
    const game = makeGame([...FILLER, lavinia], [...FILLER, genericTwo, grizzlyBears, idol, idol], { topP1: [lavinia.id], topP2: [genericTwo.id, 'grizzly-bears', idol.id, idol.id] });
    goToMain1(game);
    put(game, 'p1', lavinia.id);
    toMain1(game, 2, 'p2');
    put(game, 'p2', idol.id); put(game, 'p2', idol.id); put(game, 'p2', 'forest');
    const two = findIn(game, 'p2', 'hand', genericTwo.id);
    expect(cast(game, 'p2', two).ok).toBe(false);
    const bears = findIn(game, 'p2', 'hand', 'grizzly-bears');
    expect(cast(game, 'p2', bears).ok).toBe(true); // {1}{G} com Idol + Forest — criatura não é limitada
    settle(game);
    expect(game.state.objects[bears].zone).toBe('battlefield');
    untapAll(game, 'p2');
    put(game, 'p2', 'forest');
    expect(cast(game, 'p2', two).ok).toBe(true); // dois terrenos agora
    settle(game);
    expect(game.state.objects[two].zone).toBe('graveyard');
  });

  it('Lavinia: mágica conjurada sem gastar mana é anulada; com mana, resolve', () => {
    const game = makeGame([...FILLER, lavinia], [...FILLER, freebie, lightningBolt], { topP1: [lavinia.id], topP2: [freebie.id, 'lightning-bolt'] });
    goToMain1(game);
    put(game, 'p1', lavinia.id);
    toMain1(game, 2, 'p2');
    put(game, 'p2', 'mountain');
    const h = game.state.players.p2.zones.hand.length;
    const free = findIn(game, 'p2', 'hand', freebie.id);
    expect(cast(game, 'p2', free).ok).toBe(true);
    settle(game);
    expect(game.state.objects[free].zone).toBe('graveyard');
    expect(game.state.players.p2.zones.hand.length).toBe(h - 1); // anulada: não comprou
    expect(cast(game, 'p2', findIn(game, 'p2', 'hand', 'lightning-bolt'), { targets: [{ kind: 'player', player: 'p1' }] }).ok).toBe(true);
    settle(game);
    expect(game.state.players.p1.life).toBe(17);
  });

  it('Void Mirror: paga só com incolor é anulada; com mana colorida resolve; de graça é anulada', () => {
    const game = makeGame([...FILLER, mirror, idol, idol, genericTwo, genericTwo, freebie], FILLER, { topP1: [mirror.id, idol.id, idol.id, genericTwo.id, genericTwo.id, freebie.id] });
    goToMain1(game);
    put(game, 'p1', mirror.id); put(game, 'p1', idol.id); put(game, 'p1', idol.id);
    const h0 = game.state.players.p1.zones.hand.length;
    const a = findIn(game, 'p1', 'hand', genericTwo.id);
    expect(cast(game, 'p1', a).ok).toBe(true); // paga com os dois Idols ({C}{C})
    settle(game);
    expect(game.state.players.p1.zones.hand.length).toBe(h0 - 1); // anulada
    lands(game, 'p1', 'forest', 'forest');
    const b = findIn(game, 'p1', 'hand', genericTwo.id);
    expect(cast(game, 'p1', b).ok).toBe(true); // Idols virados: paga com Forests
    settle(game);
    expect(game.state.players.p1.zones.hand.length).toBe(h0 - 1); // −1 conjurada +1 compra
    const free = findIn(game, 'p1', 'hand', freebie.id);
    expect(cast(game, 'p1', free).ok).toBe(true);
    settle(game);
    expect(game.state.players.p1.zones.hand.length).toBe(h0 - 2); // anulada
  });
});
