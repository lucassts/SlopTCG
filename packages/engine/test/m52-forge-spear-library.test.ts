/** M52 (Leva 24): Mystic Forge (filtro anyOf + exilar o topo pagando vida), Shadowspear (perde hexproof/indestrutível até o fim do turno), Sylvan Library (gatilho da etapa de compra em duas escolhas). */
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
const activate = (game: Game, p: PlayerId, id: number, abilityIndex: number) => game.apply(p, { type: 'activateAbility', objectId: id, abilityIndex, targets: [] } as never);
const untilDecision = (game: Game) => passUntil(game, (s) => s.status === 'finished' || s.pendingDecision?.type === 'effectChoice' || (s.stack.length === 0 && s.triggerQueue.length === 0 && s.pendingDecision === null));
const answer = (game: Game, p: PlayerId, picks: number[], text?: string) => game.apply(p, { type: 'effectChoice', picks, text });
const choice = (game: Game) => { const pd = game.state.pendingDecision; if (pd?.type !== 'effectChoice') throw new Error(`esperava effectChoice, veio ${pd?.type ?? 'nada'}`); return pd; };
/** Põe a carta (da biblioteca) no topo da biblioteca. */
const toTop = (game: Game, p: PlayerId, cardId: string): number => {
  const zones = game.state.players[p].zones;
  for (const z of ['hand', 'library'] as const) {
    const i = zones[z].findIndex((oid) => game.state.objects[oid].card.id === cardId);
    if (i < 0) continue;
    const [id] = zones[z].splice(i, 1);
    game.state.objects[id].zone = 'library';
    zones.library.unshift(id);
    return id;
  }
  throw new Error(`não achei ${cardId} na mão nem na biblioteca`);
};

const forge = mk({ name: 'Mystic Forge', manaCost: '{4}', typeLine: 'Artifact', colors: [], oracleText: 'You may look at the top card of your library any time.\nYou may cast artifact spells and colorless spells from the top of your library.\n{T}, Pay 1 life: Exile the top card of your library.' });
const spear = mk({ name: 'Shadowspear', manaCost: '{1}', typeLine: 'Legendary Artifact — Equipment', colors: [], oracleText: 'Equipped creature gets +1/+1 and has trample and lifelink.\n{1}: Permanents your opponents control lose hexproof and indestructible until end of turn.\nEquip {2}' });
const sylvan = mk({ name: 'Sylvan Library', manaCost: '{1}{G}', typeLine: 'Enchantment', colors: ['G'], oracleText: 'At the beginning of your draw step, you may draw two additional cards. If you do, choose two cards in your hand drawn this turn. For each of those cards, pay 4 life or put the card on top of your library.' });
const rock = mk({ name: 'Audit Rock', manaCost: '{2}', typeLine: 'Artifact', colors: [] });
const eldrazi = mk({ name: 'Colorless Drone', manaCost: '{3}', typeLine: 'Creature — Eldrazi Drone', power: 3, toughness: 2, colors: [] });
const hexBear = mk({ name: 'Hex Bear', manaCost: '{1}{G}', typeLine: 'Creature — Bear', power: 2, toughness: 2, colors: ['G'], oracleText: 'Hexproof, indestructible' });

describe('M52 · compilação', () => {
  it('as três cartas compilam full com o formato esperado', () => {
    expect(forge.automation).toBe('full');
    expect(forge.castFromLibraryTop).toEqual({ anyOf: [{ what: 'artifact' }, { colorless: true }] });
    expect(forge.abilities?.[0]).toMatchObject({ kind: 'activated', cost: { tap: true, payLife: 1 }, effect: [{ op: 'exileTop', who: 'controller', count: 1 }] });
    expect(spear.automation).toBe('full');
    expect(spear.abilities?.[0]).toMatchObject({ kind: 'activated', cost: { mana: '{1}' }, effect: [{ op: 'loseKeywordsUntilEot', filter: { what: 'permanent', controlledBy: 'opponent' }, keywords: ['hexproof', 'indestructible'] }] });
    expect(sylvan.automation).toBe('full');
    expect(sylvan.abilities?.[0]).toMatchObject({ kind: 'triggered', trigger: { on: 'drawStep', whose: 'controller' }, effect: [{ op: 'mayDo', effect: [{ op: 'draw', count: 2 }, { op: 'sylvanChoose' }, { op: 'sylvanPay', life: 4 }] }] });
  });
});

describe('M52 · Mystic Forge', () => {
  it('conjura artefato e criatura incolor do topo; verde do topo não; {T}, 1 de vida exila o topo', () => {
    const game = makeGame([...FILLER, forge, rock, eldrazi, grizzlyBears], FILLER, { topP1: [forge.id, rock.id, eldrazi.id, 'grizzly-bears'] });
    goToMain1(game);
    put(game, 'p1', forge.id);
    for (const l of ['forest', 'forest', 'forest', 'mountain', 'mountain']) put(game, 'p1', l);
    const r = toTop(game, 'p1', rock.id);
    expect(cast(game, 'p1', r).ok).toBe(true);
    settle(game);
    expect(game.state.objects[r].zone).toBe('battlefield');
    const d = toTop(game, 'p1', eldrazi.id);
    expect(cast(game, 'p1', d).ok).toBe(true);
    settle(game);
    expect(game.state.objects[d].zone).toBe('battlefield');
    const b = toTop(game, 'p1', 'grizzly-bears');
    expect(cast(game, 'p1', b).ok).toBe(false); // verde e não-artefato: não pode
    expect(game.state.objects[b].zone).toBe('library');
    const f = findIn(game, 'p1', 'battlefield', forge.id);
    expect(activate(game, 'p1', f, 0).ok).toBe(true);
    settle(game);
    expect(game.state.players.p1.life).toBe(19);
    expect(game.state.objects[b].zone).toBe('exile');
    expect(game.state.objects[f].tapped).toBe(true);
  });
});

describe('M52 · Shadowspear', () => {
  it('{1}: a criatura do oponente com hexproof e indestrutível vira alvo e morre com o Bolt; no turno seguinte volta a ter as duas', () => {
    const game = makeGame([...FILLER, spear, lightningBolt, lightningBolt], [...FILLER, hexBear, hexBear], { topP1: [spear.id, lightningBolt.id, lightningBolt.id], topP2: [hexBear.id, hexBear.id] });
    goToMain1(game);
    put(game, 'p1', spear.id);
    for (const l of ['mountain', 'mountain', 'mountain']) put(game, 'p1', l);
    const bear = put(game, 'p2', hexBear.id);
    const bolt1 = put(game, 'p1', lightningBolt.id, 'hand');
    expect(cast(game, 'p1', bolt1, { targets: [{ kind: 'object', id: bear }] }).ok).toBe(false); // hexproof
    const sp = findIn(game, 'p1', 'battlefield', spear.id);
    expect(activate(game, 'p1', sp, 0).ok).toBe(true);
    settle(game);
    expect(cast(game, 'p1', bolt1, { targets: [{ kind: 'object', id: bear }] }).ok).toBe(true);
    settle(game);
    expect(game.state.objects[bear].zone).toBe('graveyard'); // sem indestrutível, 3 de dano mata
    // Outra criatura igual no turno seguinte: as keywords voltam (a perda era só até o fim do turno).
    const bear2 = put(game, 'p2', hexBear.id);
    expect(game.state.objects[bear2].lostKeywordsUntilEot).toBeUndefined();
    passUntil(game, (s) => s.turn === 2);
    const bolt2 = put(game, 'p1', lightningBolt.id, 'hand');
    passUntil(game, (s) => s.turn === 3 && s.step === 'main1');
    expect(cast(game, 'p1', bolt2, { targets: [{ kind: 'object', id: bear2 }] }).ok).toBe(false);
  });
});

describe('M52 · Sylvan Library', () => {
  it('na etapa de compra: pode comprar duas a mais, escolhe duas compradas neste turno, paga 4 por uma e devolve a outra ao topo', () => {
    const game = makeGame([...FILLER, sylvan], FILLER, { topP1: [sylvan.id] });
    goToMain1(game);
    put(game, 'p1', sylvan.id);
    passUntil(game, (s) => (s.turn === 3 && s.step === 'draw') || s.pendingDecision?.type === 'effectChoice');
    untilDecision(game);
    const hand0 = game.state.players.p1.zones.hand.length;
    const may = choice(game);
    expect(may.mode).toBe('confirm');
    expect(answer(game, 'p1', [], 'yes').ok).toBe(true);
    untilDecision(game);
    const pick = choice(game);
    expect(pick.mode).toBe('cards');
    expect(pick.options).toHaveLength(3); // a compra normal + as duas a mais
    expect(pick.min).toBe(2);
    expect(game.state.players.p1.zones.hand.length).toBe(hand0 + 2);
    const [a, b] = pick.options;
    expect(answer(game, 'p1', [a, b]).ok).toBe(true);
    untilDecision(game);
    const pay = choice(game);
    expect(pay.options).toEqual([a, b]);
    expect(pay.max).toBe(2);
    expect(answer(game, 'p1', [a]).ok).toBe(true); // paga 4 pela primeira, devolve a segunda
    settle(game);
    expect(game.state.players.p1.life).toBe(16);
    expect(game.state.objects[a].zone).toBe('hand');
    expect(game.state.objects[b].zone).toBe('library');
    expect(game.state.players.p1.zones.library[0]).toBe(b);
    expect(game.state.players.p1.zones.hand.length).toBe(hand0 + 1);
  });

  it('recusar a compra extra não abre escolha nenhuma', () => {
    const game = makeGame([...FILLER, sylvan], FILLER, { topP1: [sylvan.id] });
    goToMain1(game);
    put(game, 'p1', sylvan.id);
    passUntil(game, (s) => (s.turn === 3 && s.step === 'draw') || s.pendingDecision?.type === 'effectChoice');
    untilDecision(game);
    const hand0 = game.state.players.p1.zones.hand.length;
    expect(choice(game).mode).toBe('confirm');
    expect(answer(game, 'p1', [], 'no').ok).toBe(true);
    settle(game);
    expect(game.state.pendingDecision).toBeNull();
    expect(game.state.players.p1.zones.hand.length).toBe(hand0);
    expect(game.state.players.p1.life).toBe(20);
  });
});
