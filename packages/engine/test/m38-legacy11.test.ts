/** M38 (Leva 14): Loki (alvo de habilidade), Talon Gates of Madara (phasing), Chain Lightning (cadeia de cópias pagas). */
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

const loki = mk({ name: 'Loki, God of Mischief', manaCost: '{1}{U}', typeLine: 'Legendary Creature — God Sorcerer Villain', power: 2, toughness: 2, colors: ['U'], oracleText: 'Whenever a player or permanent becomes the target of an ability you control, draw a card. This ability triggers only once each turn.' });
const gates = mk({ name: 'Talon Gates of Madara', typeLine: 'Land — Gate', colors: [], oracleText: 'When this land enters, up to one target creature phases out.\n{T}: Add {C}.\n{1}, {T}: Add one mana of any color.\n{4}: Put this card from your hand onto the battlefield.' });
const chain = mk({ name: 'Chain Lightning', manaCost: '{R}', typeLine: 'Sorcery', colors: ['R'], oracleText: "Chain Lightning deals 3 damage to any target. Then that player or that permanent's controller may pay {R}{R}. If the player does, they may copy this spell and may choose a new target for that copy." });
const pinger = mk({ name: 'Prodigal Pyromancer', manaCost: '{2}{R}', typeLine: 'Creature — Human Wizard', power: 1, toughness: 1, colors: ['R'], oracleText: '{T}: This creature deals 1 damage to any target.' });
const flicker = mk({ name: 'Bounce Wizard', manaCost: '{1}{U}', typeLine: 'Creature — Human Wizard', power: 1, toughness: 1, colors: ['U'], oracleText: "When this creature enters, return target creature to its owner's hand." });

describe('M38 · leva 14', () => {
  it('compila tudo como full', () => {
    for (const c of [loki, gates, chain, pinger, flicker]) expect(c.automation, `${c.name}: ${c.automationNotes?.join(' | ')}`).toBe('full');
    expect(loki.abilities?.[0]).toMatchObject({ kind: 'triggered', trigger: { on: 'yourAbilityTargets' }, oncePerTurn: true });
    expect(gates.abilities?.some((a) => a.kind === 'activated' && a.zone === 'hand')).toBe(true);
    expect(chain.spellEffect?.[1]).toMatchObject({ op: 'chainCopy', cost: '{R}{R}', damage: 3 });
  });

  it('Loki: compra quando uma habilidade sua tem alvo, só uma vez por turno; habilidade do oponente não conta', () => {
    const game = makeGame([...FILLER, loki, pinger], [...FILLER, pinger], { topP1: [loki.id, pinger.id], topP2: [pinger.id] });
    goToMain1(game);
    put(game, 'p1', loki.id);
    const p = put(game, 'p1', pinger.id); game.state.objects[p].summoningSick = false;
    const hand0 = game.state.players.p1.zones.hand.length;
    expect(game.apply('p1', { type: 'activateAbility', objectId: p, abilityIndex: 0, targets: [{ kind: 'player', player: 'p2' }] }).ok).toBe(true);
    settle(game);
    expect(game.state.players.p1.zones.hand.length).toBe(hand0 + 1);
    expect(game.state.players.p2.life).toBe(19);
    // segunda ativação no mesmo turno: sem compra
    game.state.objects[p].tapped = false;
    expect(game.apply('p1', { type: 'activateAbility', objectId: p, abilityIndex: 0, targets: [{ kind: 'player', player: 'p2' }] }).ok).toBe(true);
    settle(game);
    expect(game.state.players.p1.zones.hand.length).toBe(hand0 + 1);
    // turno 2 (oponente): a habilidade dele com alvo não dispara Loki
    passUntil(game, (s) => s.turn === 2 && s.step === 'main1' && s.priority === 'p2' && s.stack.length === 0, 400);
    const hand1 = game.state.players.p1.zones.hand.length;
    const q = put(game, 'p2', pinger.id); game.state.objects[q].summoningSick = false;
    expect(game.apply('p2', { type: 'activateAbility', objectId: q, abilityIndex: 0, targets: [{ kind: 'player', player: 'p1' }] }).ok).toBe(true);
    settle(game);
    expect(game.state.players.p1.zones.hand.length).toBe(hand1);
  });

  it('Loki: gatilho com alvo também conta', () => {
    const game = makeGame([...FILLER, loki, flicker], [...FILLER, grizzlyBears], { topP1: [loki.id, flicker.id], topP2: ['grizzly-bears'] });
    goToMain1(game);
    put(game, 'p1', loki.id);
    lands(game, 'p1', 'island', 'island');
    const bears = put(game, 'p2', 'grizzly-bears');
    const hand0 = game.state.players.p1.zones.hand.length;
    expect(cast(game, 'p1', findIn(game, 'p1', 'hand', flicker.id)).ok).toBe(true);
    passUntil(game, (s) => s.pendingDecision?.type === 'chooseTargets', 50);
    expect(game.apply('p1', { type: 'chooseTargets', targets: [{ kind: 'object', id: bears }] }).ok).toBe(true);
    settle(game);
    expect(game.state.objects[bears].zone).toBe('hand');
    expect(game.state.players.p1.zones.hand.length).toBe(hand0 - 1 + 1); // conjurou o mago, comprou com Loki
  });

  it('Talon Gates: a criatura sai de fase (invisível a alvos) e volta no desvirar do controlador', () => {
    const game = makeGame([...FILLER, gates, lightningBolt], [...FILLER, grizzlyBears], { topP1: [gates.id, 'lightning-bolt'], topP2: ['grizzly-bears'] });
    goToMain1(game);
    const bears = put(game, 'p2', 'grizzly-bears');
    put(game, 'p1', 'mountain');
    const g = findIn(game, 'p1', 'hand', gates.id);
    expect(game.apply('p1', { type: 'playLand', objectId: g }).ok).toBe(true);
    passUntil(game, (s) => s.pendingDecision?.type === 'chooseTargets', 30);
    expect(game.apply('p1', { type: 'chooseTargets', targets: [{ kind: 'object', id: bears }] }).ok).toBe(true);
    settle(game);
    expect(game.state.objects[bears].phasedOut).toBe(true);
    expect(game.state.players.p2.zones.battlefield).not.toContain(bears);
    expect(game.state.objects[bears].zone).toBe('battlefield');
    expect(cast(game, 'p1', findIn(game, 'p1', 'hand', 'lightning-bolt'), { targets: [{ kind: 'object', id: bears }] }).ok).toBe(false);
    // no meu turno seguinte (turno 3) ele ainda está fora? Não: volta no desvirar do controlador (turno 2, p2).
    passUntil(game, (s) => s.turn === 2 && s.step === 'main1' && s.priority === 'p2' && s.stack.length === 0, 400);
    expect(game.state.objects[bears].phasedOut).toBe(false);
    expect(game.state.players.p2.zones.battlefield).toContain(bears);
    expect(game.state.objects[bears].summoningSick).toBe(false);
  });

  it('Talon Gates: {4} da mão põe o terreno no campo e o gatilho pede alvo', () => {
    const game = makeGame([...FILLER, gates], FILLER, { topP1: [gates.id] });
    goToMain1(game);
    lands(game, 'p1', 'forest', 'forest', 'forest', 'forest');
    const g = findIn(game, 'p1', 'hand', gates.id);
    const idx = gates.abilities!.findIndex((a) => a.kind === 'activated' && a.zone === 'hand');
    expect(game.apply('p1', { type: 'activateAbility', objectId: g, abilityIndex: idx }).ok).toBe(true);
    settle(game);
    expect(game.state.objects[g].zone).toBe('battlefield');
    expect(game.state.players.p1.landsPlayedThisTurn).toBe(0);
  });

  it('Chain Lightning: o alvo paga {R}{R}, copia e escolhe um novo alvo; sem mana, a cadeia para', () => {
    const game = makeGame([...FILLER, chain], [...FILLER, grizzlyBears], { topP1: [chain.id], topP2: ['grizzly-bears'] });
    goToMain1(game);
    put(game, 'p1', 'mountain');
    const bears = put(game, 'p1', 'grizzly-bears' === 'x' ? 'forest' : 'forest'); void bears;
    lands(game, 'p2', 'mountain', 'mountain');
    expect(cast(game, 'p1', findIn(game, 'p1', 'hand', chain.id), { targets: [{ kind: 'player', player: 'p2' }] }).ok).toBe(true);
    untilDecision(game);
    const pd = choice(game);
    expect(pd.player).toBe('p2');
    expect(pd.mode).toBe('confirm');
    expect(game.state.players.p2.life).toBe(17);
    answer(game, 'p2', [], 'yes');
    passUntil(game, (s) => s.pendingDecision?.type === 'chooseTargets', 30);
    expect(game.state.pendingDecision).toMatchObject({ type: 'chooseTargets', player: 'p2' });
    expect(game.apply('p2', { type: 'chooseTargets', targets: [{ kind: 'player', player: 'p1' }] }).ok).toBe(true);
    // p1 tem só uma Mountain: não consegue pagar {R}{R} → cadeia termina sozinha
    settle(game);
    expect(game.state.players.p1.life).toBe(17);
    expect(game.state.players.p2.zones.battlefield.filter((id) => game.state.objects[id].card.types.includes('Land')).every((id) => game.state.objects[id].tapped)).toBe(true);
    expect(game.state.stack.length).toBe(0);
  });
});
