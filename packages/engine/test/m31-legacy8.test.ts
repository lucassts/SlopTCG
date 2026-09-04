/** M31 (Legacy parte 8): regra das lendárias com escolha, terrenos que entram virados por efeito (fetch → surveil/shock land), Debt to the Deathless, Damping Sphere, Force of Vigor, Badgermole Cub (earthbend). */
import { describe, expect, it } from 'vitest';
import { compileOracleCard, type OracleInput } from '../src/cards/oracle-parser.js';
import { forest, grizzlyBears, island, lightningBolt, mountain, plains, swamp } from '../src/cards/demo-set.js';
import type { CardDefinition } from '../src/cards/types.js';
import type { Game } from '../src/game.js';
import type { PlayerId } from '../src/types.js';
import { hasKeyword, isCreature } from '../src/state.js';
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
const untapAll = (game: Game, p: PlayerId) => { for (const id of game.state.players[p].zones.battlefield) game.state.objects[id].tapped = false; };

const legendBear = mk({ name: 'Legend Bear', manaCost: '{1}{G}', typeLine: 'Legendary Creature — Bear', power: 2, toughness: 2, colors: ['G'], oracleText: '' });
const fetch = mk({ name: 'Mire Finder', typeLine: 'Land', oracleText: '{T}, Sacrifice this land: Search your library for an Island or Swamp card, put it onto the battlefield, then shuffle.' });
const sewers = mk({ name: 'Undercity Sewers', typeLine: 'Land — Island Swamp', oracleText: '({T}: Add {U} or {B}.)\nThis land enters tapped.\nWhen this land enters, surveil 1.' });
const grave = mk({ name: 'Watery Grave', typeLine: 'Land — Island Swamp', oracleText: "({T}: Add {U} or {B}.)\nAs this land enters, you may pay 2 life. If you don't, it enters tapped." });
const debt = mk({ name: 'Debt to the Deathless', manaCost: '{X}{W}{W}{B}{B}', typeLine: 'Sorcery', colors: ['W', 'B'], oracleText: 'Each opponent loses two times X life. You gain life equal to the life lost this way.' });
const sphere = mk({ name: 'Damping Sphere', manaCost: '{2}', typeLine: 'Artifact', colors: [], oracleText: 'If a land is tapped for two or more mana, it produces {C} instead of any other type and amount.\nEach spell a player casts costs {1} more to cast for each other spell that player has cast this turn.' });
const twinGrove = mk({ name: 'Twin Grove', typeLine: 'Land', oracleText: '{T}: Add {G}{G}.' });
const vigor = mk({ name: 'Force of Vigor', manaCost: '{2}{G}{G}', typeLine: 'Instant', colors: ['G'], oracleText: "If it's not your turn, you may exile a green card from your hand rather than pay this spell's mana cost.\nDestroy up to two target artifacts and/or enchantments." });
const cub = mk({ name: 'Badgermole Cub', manaCost: '{1}{G}', typeLine: 'Creature — Badger Mole', power: 2, toughness: 2, colors: ['G'], oracleText: "When this creature enters, earthbend 1. (Target land you control becomes a 0/0 creature with haste that's still a land. Put a +1/+1 counter on it. When it dies or is exiled, return it to the battlefield tapped.)\nWhenever you tap a creature for mana, add an additional {G}." });
const idol = mk({ name: 'Bear Idol', manaCost: '{2}', typeLine: 'Artifact', colors: [], oracleText: '{T}: Add {C}.' });

describe('M31 · Legacy parte 8', () => {
  it('compila tudo como full', () => {
    for (const c of [debt, sphere, vigor, cub, sewers, grave, fetch]) expect(c.automation, `${c.name}: ${c.automationNotes?.join(' | ')}`).toBe('full');
    expect(vigor.spellTargets).toHaveLength(2);
    expect(vigor.altCost?.condition).toEqual({ kind: 'not', cond: { kind: 'yourTurn' } });
    expect(sphere.landsMultiManaColorless).toBe(true);
    expect(sphere.costModifiers?.[0]).toMatchObject({ amount: 1, perSpellsCastThisTurn: true });
    expect(cub.extraManaOnCreatureTap).toBe('G');
  });

  it('regra das lendárias: o controlador escolhe qual fica; a outra vai para o cemitério', () => {
    const game = makeGame([...FILLER, legendBear, legendBear], FILLER, { topP1: [legendBear.id, legendBear.id] });
    goToMain1(game);
    put(game, 'p1', 'forest'); put(game, 'p1', 'forest'); put(game, 'p1', 'forest'); put(game, 'p1', 'forest');
    const b1 = findIn(game, 'p1', 'hand', legendBear.id);
    expect(cast(game, 'p1', b1).ok).toBe(true);
    settle(game);
    expect(game.state.objects[b1].zone).toBe('battlefield');
    expect(game.state.pendingDecision).toBeNull(); // uma só: nada a decidir
    const b2 = findIn(game, 'p1', 'hand', legendBear.id);
    expect(cast(game, 'p1', b2).ok).toBe(true);
    untilDecision(game);
    const pd = choice(game);
    expect(pd.player).toBe('p1');
    expect(pd.prompt).toMatch(/lendárias/);
    expect([...pd.options].sort()).toEqual([b1, b2].sort());
    expect(game.apply('p1', { type: 'passPriority' }).ok).toBe(false); // não passa sem decidir
    answer(game, 'p1', [b2]); // fica com a nova
    expect(game.state.objects[b1].zone).toBe('graveyard');
    expect(game.state.objects[b2].zone).toBe('battlefield');
    settle(game);
    expect(game.state.pendingDecision).toBeNull();
  });

  it('terreno buscado por efeito entra virado (surveil land) e a shock land pergunta pelos 2 de vida', () => {
    const game = makeGame([...FILLER, fetch, fetch, sewers, grave], FILLER, { topP1: [fetch.id, fetch.id] });
    goToMain1(game);
    const f1 = put(game, 'p1', fetch.id);
    const sw = findIn(game, 'p1', 'library', sewers.id);
    const wg = findIn(game, 'p1', 'library', grave.id);
    expect(game.apply('p1', { type: 'activateAbility', objectId: f1, abilityIndex: 0 }).ok).toBe(true);
    untilDecision(game);
    let pd = choice(game);
    expect(pd.options).toContain(sw);
    answer(game, 'p1', [sw]);
    expect(game.state.objects[sw].zone).toBe('battlefield');
    expect(game.state.objects[sw].tapped).toBe(true); // entra virado mesmo vindo de uma busca
    untilDecision(game);
    if (game.state.pendingDecision?.type === 'effectChoice') answer(game, 'p1', []); // surveil 1: nada para o cemitério
    settle(game);
    // Shock land pela segunda fetch: sem pagar, entra virada; pagando, entra desvirada e custa 2 de vida.
    const f2 = put(game, 'p1', fetch.id);
    expect(game.apply('p1', { type: 'activateAbility', objectId: f2, abilityIndex: 0 }).ok).toBe(true);
    untilDecision(game);
    pd = choice(game);
    answer(game, 'p1', [wg]);
    pd = choice(game);
    expect(pd.mode).toBe('confirm');
    expect(pd.prompt).toMatch(/2 de vida/);
    answer(game, 'p1', [], 'no');
    expect(game.state.objects[wg].tapped).toBe(true);
    expect(game.state.players.p1.life).toBe(20);
    settle(game);
  });

  it('Debt to the Deathless: cada oponente perde 2×X e você ganha o total perdido', () => {
    const game = makeGame([...FILLER, debt], FILLER, { topP1: [debt.id] });
    goToMain1(game);
    put(game, 'p1', 'plains'); put(game, 'p1', 'plains'); put(game, 'p1', 'swamp'); put(game, 'p1', 'swamp'); put(game, 'p1', 'mountain'); put(game, 'p1', 'mountain');
    const d = findIn(game, 'p1', 'hand', debt.id);
    expect(cast(game, 'p1', d, { x: 2 }).ok).toBe(true);
    settle(game);
    expect(game.state.players.p2.life).toBe(16);
    expect(game.state.players.p1.life).toBe(24);
  });

  it('Damping Sphere: a segunda mágica do turno custa {1} a mais; terreno de duas manas produz {C}{C}', () => {
    const game = makeGame([...FILLER, sphere, lightningBolt, lightningBolt, twinGrove], FILLER, { topP1: [sphere.id, 'lightning-bolt', 'lightning-bolt', twinGrove.id] });
    goToMain1(game);
    put(game, 'p1', sphere.id);
    put(game, 'p1', 'mountain'); put(game, 'p1', 'mountain');
    const b1 = findIn(game, 'p1', 'hand', 'lightning-bolt');
    expect(cast(game, 'p1', b1, { targets: [{ kind: 'player', player: 'p2' }] }).ok).toBe(true);
    settle(game);
    expect(game.state.players.p1.zones.battlefield.filter((id) => game.state.objects[id].tapped)).toHaveLength(1);
    const b2 = findIn(game, 'p1', 'hand', 'lightning-bolt');
    expect(cast(game, 'p1', b2, { targets: [{ kind: 'player', player: 'p2' }] }).ok).toBe(false); // {R} + {1}: só uma Mountain sobrou
    put(game, 'p1', 'mountain');
    expect(cast(game, 'p1', b2, { targets: [{ kind: 'player', player: 'p2' }] }).ok).toBe(true);
    settle(game);
    expect(game.state.players.p2.life).toBe(14);
    const grove = put(game, 'p1', twinGrove.id);
    expect(game.apply('p1', { type: 'activateAbility', objectId: grove, abilityIndex: 0 }).ok).toBe(true);
    expect(game.state.players.p1.manaPool.C).toBe(2);
    expect(game.state.players.p1.manaPool.G).toBe(0);
  });

  it('Force of Vigor: destrói até dois artefatos ou encantamentos', () => {
    const game = makeGame([...FILLER, vigor], [...FILLER, idol, idol], { topP1: [vigor.id], topP2: [idol.id, idol.id] });
    goToMain1(game);
    const a1 = put(game, 'p2', idol.id); const a2 = put(game, 'p2', idol.id);
    put(game, 'p1', 'forest'); put(game, 'p1', 'forest'); put(game, 'p1', 'forest'); put(game, 'p1', 'forest');
    const v = findIn(game, 'p1', 'hand', vigor.id);
    expect(cast(game, 'p1', v, { targets: [{ kind: 'object', id: a1 }, { kind: 'object', id: a2 }] }).ok).toBe(true);
    settle(game);
    expect(game.state.objects[a1].zone).toBe('graveyard');
    expect(game.state.objects[a2].zone).toBe('graveyard');
  });

  it('Badgermole Cub: earthbend anima um terreno (0/0 com ímpeto e um marcador) que volta virado se morrer; virar criatura para mana dá {G} extra', () => {
    const game = makeGame([...FILLER, cub], FILLER, { topP1: [cub.id] });
    goToMain1(game);
    const f1 = put(game, 'p1', 'forest'); put(game, 'p1', 'forest'); const f3 = put(game, 'p1', 'forest');
    const c = findIn(game, 'p1', 'hand', cub.id);
    expect(cast(game, 'p1', c).ok).toBe(true);
    passUntil(game, (s) => s.pendingDecision?.type === 'chooseTargets', 50);
    expect(game.apply('p1', { type: 'chooseTargets', targets: [{ kind: 'object', id: f3 }] }).ok).toBe(true);
    settle(game);
    const land = game.state.objects[f3];
    expect(isCreature(land)).toBe(true);
    expect(land.card.types).toContain('Land');
    expect(hasKeyword(game.state, land, 'haste')).toBe(true);
    expect(land.counters['+1/+1']).toBe(1);
    // Virar a criatura-terreno para mana: {G} dela + {G} do Cub.
    untapAll(game, 'p1');
    expect(game.apply('p1', { type: 'activateAbility', objectId: f3, abilityIndex: 0 }).ok).toBe(true);
    expect(game.state.players.p1.manaPool.G).toBe(2);
    // Um terreno comum não ganha o extra.
    expect(game.apply('p1', { type: 'activateAbility', objectId: f1, abilityIndex: 0 }).ok).toBe(true);
    expect(game.state.players.p1.manaPool.G).toBe(3);
    // Morre → volta virada, de novo só terreno.
    game.apply('p1', { type: 'manualMove', objectId: f3, to: 'graveyard' });
    expect(game.state.objects[f3].zone).toBe('battlefield');
    expect(game.state.objects[f3].tapped).toBe(true);
    expect(isCreature(game.state.objects[f3])).toBe(false);
  });
});
