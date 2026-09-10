/** M41: relatos — Barrowgoyf (resistência vem da CDA mesmo com "1+*" importado como 1), aventura do Questing Druid cobra só {1}{R}, revelações viram evento para o oponente. */
import { describe, expect, it } from 'vitest';
import { compileOracleCard, type OracleInput } from '../src/cards/oracle-parser.js';
import { forest, grizzlyBears, island, lightningBolt, mountain, plains, swamp } from '../src/cards/demo-set.js';
import type { CardDefinition } from '../src/cards/types.js';
import { Game } from '../src/game.js';
import type { PlayerId } from '../src/types.js';
import { effectivePower, effectiveToughness } from '../src/state.js';
import { redactEvent } from '../src/events.js';
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
const lands = (game: Game, p: PlayerId, ...ids: string[]) => { for (const id of ids) put(game, p, id); };

// Como o importador entrega: "*" vira NaN→undefined, "1+*" vira 1.
const barrowgoyf = mk({ name: 'Barrowgoyf', manaCost: '{2}{B}', typeLine: 'Creature — Lhurgoyf', power: undefined, toughness: 1, colors: ['B'], oracleText: "Deathtouch, lifelink\nBarrowgoyf's power is equal to the number of card types among cards in all graveyards and its toughness is equal to that number plus 1.\nWhenever this creature deals combat damage to a player, you may mill that many cards. If you do, you may put a creature card from among them into your hand." });
const druid = mk({ name: 'Questing Druid', manaCost: '{1}{G}', typeLine: 'Creature — Elf Druid', power: 1, toughness: 1, colors: ['G'], layout: 'adventure', oracleText: "Whenever you cast a spell that's white, blue, black, or red, put a +1/+1 counter on this creature.", backFace: { name: 'Seek the Beast', manaCost: '{1}{R}', typeLine: 'Instant — Adventure', colors: ['R'], oracleText: 'Exile the top two cards of your library. Until your next end step, you may play those cards.' } });
const adNauseam = mk({ name: 'Ad Nauseam', manaCost: '{3}{B}{B}', typeLine: 'Instant', colors: ['B'], oracleText: 'Reveal the top card of your library and put that card into your hand. You lose life equal to its mana value. You may repeat this process any number of times.' });
const idol = mk({ name: 'Bear Idol', manaCost: '{2}', typeLine: 'Artifact', colors: [], oracleText: '{T}: Add {C}.' });
const bauble = mk({ name: "Urza's Bauble", manaCost: '{0}', typeLine: 'Artifact', colors: [], oracleText: "{T}, Sacrifice this artifact: Look at a card at random in target player's hand. You draw a card at the beginning of the next turn's upkeep." });
const peek = mk({ name: 'Peek', manaCost: '{U}', typeLine: 'Instant', colors: ['U'], oracleText: "Look at target player's hand.\nDraw a card." });
const gaze = mk({ name: 'Otherworldly Gaze', manaCost: '{U}', typeLine: 'Instant', colors: ['U'], oracleText: 'Surveil 3.' });
const preordain = mk({ name: 'Preordain', manaCost: '{U}', typeLine: 'Sorcery', colors: ['U'], oracleText: 'Scry 2, then draw a card.' });

describe('M41 · relatos', () => {
  it('Barrowgoyf: poder = tipos nos cemitérios, resistência = tipos + 1, mesmo com "1+*" importado como 1', () => {
    const game = makeGame([...FILLER, barrowgoyf, grizzlyBears, lightningBolt, idol], FILLER, { topP1: [barrowgoyf.id, 'grizzly-bears', 'lightning-bolt', idol.id] });
    goToMain1(game);
    const g = put(game, 'p1', barrowgoyf.id);
    const o = game.state.objects[g];
    expect(effectivePower(game.state, o)).toBe(0);
    expect(effectiveToughness(game.state, o)).toBe(1);
    put(game, 'p1', 'grizzly-bears', 'graveyard'); // criatura
    put(game, 'p1', 'lightning-bolt', 'graveyard'); // instantâneo
    put(game, 'p2', 'forest', 'graveyard'); // terreno (cemitério do oponente conta)
    expect(effectivePower(game.state, o)).toBe(3);
    expect(effectiveToughness(game.state, o)).toBe(4);
    put(game, 'p1', idol.id, 'graveyard'); // artefato
    expect(effectivePower(game.state, o)).toBe(4);
    expect(effectiveToughness(game.state, o)).toBe(5);
  });

  it('Questing Druid: a aventura (Seek the Beast) custa só {1}{R}', () => {
    const game = makeGame([...FILLER, druid], FILLER, { topP1: [druid.id] });
    goToMain1(game);
    const m1 = put(game, 'p1', 'mountain'); const f1 = put(game, 'p1', 'forest');
    const dr = findIn(game, 'p1', 'hand', druid.id);
    // duas fontes bastam: {1}{R}
    expect(cast(game, 'p1', dr, { face: 'back' }).ok).toBe(true);
    expect(game.state.objects[m1].tapped).toBe(true);
    expect(game.state.objects[f1].tapped).toBe(true);
    expect(Object.values(game.state.players.p1.manaPool).reduce((a, b) => a + b, 0)).toBe(0);
    settle(game);
    expect(game.state.objects[dr].zone).toBe('exile');
    // com quatro terrenos, só dois viram
    const game2 = makeGame([...FILLER, druid], FILLER, { topP1: [druid.id] });
    goToMain1(game2);
    lands(game2, 'p1', 'mountain', 'mountain', 'forest', 'forest');
    expect(cast(game2, 'p1', findIn(game2, 'p1', 'hand', druid.id), { face: 'back' }).ok).toBe(true);
    expect(game2.state.players.p1.zones.battlefield.filter((id) => game2.state.objects[id].tapped).length).toBe(2);
  });

  it('Questing Druid com mana manual: a aventura pede {1}{R} e sai com duas fontes', () => {
    const game = new Game([{ id: 'p1', name: 'Alice', deck: { cards: [...FILLER, druid] } }, { id: 'p2', name: 'Bob', deck: { cards: FILLER } }], 7, { firstPlayer: 'p1', manualMana: true });
    const lib = game.state.players.p1.zones.library;
    const w = lib.find((id) => game.state.objects[id].card.id === druid.id)!;
    game.state.players.p1.zones.library = [w, ...lib.filter((id) => id !== w)];
    game.start();
    game.apply('p1', { type: 'keepHand', bottom: [] });
    game.apply('p2', { type: 'keepHand', bottom: [] });
    passUntil(game, (s) => s.step === 'main1' && s.priority === 'p1' && s.stack.length === 0);
    const m1 = put(game, 'p1', 'mountain'); const f1 = put(game, 'p1', 'forest'); const m2 = put(game, 'p1', 'mountain');
    const dr = findIn(game, 'p1', 'hand', druid.id);
    const r = cast(game, 'p1', dr, { face: 'back' });
    expect(r.ok, JSON.stringify(r.events.filter((e) => e.type === 'error'))).toBe(true);
    expect(game.state.pendingDecision).toMatchObject({ type: 'payMana', cost: '{1}{R}' });
    expect(game.apply('p1', { type: 'activateAbility', objectId: m1, abilityIndex: 0 }).ok).toBe(true);
    expect(game.apply('p1', { type: 'activateAbility', objectId: f1, abilityIndex: 0 }).ok).toBe(true);
    expect(game.state.pendingPayment).toBeUndefined();
    expect(game.state.objects[dr].zone).toBe('stack');
    expect(game.state.objects[dr].card.name).toBe('Seek the Beast');
    expect(game.state.objects[m2].tapped).toBe(false);
    expect(Object.values(game.state.players.p1.manaPool).reduce((a, b) => a + b, 0)).toBe(0);
  });

  it('Ad Nauseam: cada carta revelada gera um evento cardsRevealed para o oponente ver', () => {
    const game = makeGame([...FILLER, adNauseam, grizzlyBears], FILLER, { topP1: [adNauseam.id, 'grizzly-bears'] });
    goToMain1(game);
    lands(game, 'p1', 'swamp', 'swamp', 'swamp', 'swamp', 'island');
    const bears = findIn(game, 'p1', 'hand', 'grizzly-bears');
    game.apply('p1', { type: 'manualMove', objectId: bears, to: 'library', position: 'top' });
    expect(cast(game, 'p1', findIn(game, 'p1', 'hand', adNauseam.id)).ok).toBe(true);
    untilDecision(game);
    const r = game.apply('p1', { type: 'effectChoice', picks: [], text: 'yes' });
    const ev = r.events.find((e) => e.type === 'cardsRevealed');
    expect(ev).toBeDefined();
    if (ev?.type === 'cardsRevealed') { expect(ev.player).toBe('p1'); expect(ev.cards).toEqual(['Grizzly Bears']); expect(ev.source).toBe('Ad Nauseam'); }
    expect(game.state.objects[bears].zone).toBe('hand');
    expect(game.state.players.p1.life).toBe(18);
  });

  it("Urza's Bauble e Peek: olhar é privado — evento cardsLooked só com as cartas para quem olhou", () => {
    const game = makeGame([...FILLER, bauble, peek], [...FILLER, grizzlyBears], { topP1: [bauble.id, peek.id], topP2: ['grizzly-bears'] });
    goToMain1(game);
    const b = put(game, 'p1', bauble.id);
    put(game, 'p1', 'island');
    expect(game.apply('p1', { type: 'activateAbility', objectId: b, abilityIndex: 0, targets: [{ kind: 'player', player: 'p2' }] }).ok).toBe(true);
    const evs = [...game.apply('p1', { type: 'passPriority' }).events, ...game.apply('p2', { type: 'passPriority' }).events];
    const looked = evs.find((e) => e.type === 'cardsLooked');
    expect(looked).toBeDefined();
    if (looked?.type === 'cardsLooked') {
      expect(looked.viewer).toBe('p1');
      expect(looked.player).toBe('p2');
      expect(looked.zone).toBe('hand');
      expect(looked.cards.length).toBe(1);
      expect(game.state.players.p2.zones.hand.map((id) => game.state.objects[id].card.name)).toContain(looked.cards[0]);
      // para o oponente, o evento chega sem as cartas
      const redacted = redactEvent(looked, 'p2');
      expect(redacted.type === 'cardsLooked' && redacted.cards.length).toBe(0);
      expect(redactEvent(looked, 'p1')).toBe(looked);
    }
    settle(game);
    expect(cast(game, 'p1', findIn(game, 'p1', 'hand', peek.id), { targets: [{ kind: 'player', player: 'p2' }] }).ok).toBe(true);
    const evs2 = [...game.apply('p1', { type: 'passPriority' }).events, ...game.apply('p2', { type: 'passPriority' }).events];
    const full = evs2.find((e) => e.type === 'cardsLooked');
    expect(full && full.type === 'cardsLooked' && full.cards.length).toBe(game.state.players.p2.zones.hand.length);
    expect(evs2.some((e) => e.type === 'handRevealed')).toBe(false);
  });

  it('Vigiar 3: escolhe o que vai para o cemitério e depois a ordem das duas que ficam no topo', () => {
    const game = makeGame([...FILLER, gaze, grizzlyBears, lightningBolt, idol], FILLER, { topP1: [gaze.id, 'grizzly-bears', 'lightning-bolt', idol.id] });
    goToMain1(game);
    put(game, 'p1', 'island');
    const bears = findIn(game, 'p1', 'hand', 'grizzly-bears'); const bolt = findIn(game, 'p1', 'hand', 'lightning-bolt'); const id = findIn(game, 'p1', 'hand', idol.id);
    for (const c of [id, bolt, bears]) game.apply('p1', { type: 'manualMove', objectId: c, to: 'library', position: 'top' }); // topo: bears, bolt, idol
    expect(cast(game, 'p1', findIn(game, 'p1', 'hand', gaze.id)).ok).toBe(true);
    untilDecision(game);
    let pd = game.state.pendingDecision;
    expect(pd?.type === 'effectChoice' && pd.mode).toBe('surveil');
    game.apply('p1', { type: 'effectChoice', picks: [id] }); // Idol para o cemitério
    passUntil(game, (s) => s.pendingDecision?.type === 'effectChoice', 10);
    pd = game.state.pendingDecision;
    expect(pd?.type === 'effectChoice' && pd.mode).toBe('order');
    expect(pd?.type === 'effectChoice' && pd.options.length).toBe(2);
    game.apply('p1', { type: 'effectChoice', picks: [bolt, bears] }); // Bolt fica no topo
    settle(game);
    expect(game.state.objects[id].zone).toBe('graveyard');
    expect(game.state.players.p1.zones.library.slice(0, 2)).toEqual([bolt, bears]);
  });

  it('Vidência 2: depois de mandar zero para o fundo, escolhe a ordem das duas do topo; com uma só, não pergunta', () => {
    const game = makeGame([...FILLER, preordain, grizzlyBears, lightningBolt], FILLER, { topP1: [preordain.id, 'grizzly-bears', 'lightning-bolt'] });
    goToMain1(game);
    put(game, 'p1', 'island');
    const bears = findIn(game, 'p1', 'hand', 'grizzly-bears'); const bolt = findIn(game, 'p1', 'hand', 'lightning-bolt');
    for (const c of [bolt, bears]) game.apply('p1', { type: 'manualMove', objectId: c, to: 'library', position: 'top' }); // topo: bears, bolt
    expect(cast(game, 'p1', findIn(game, 'p1', 'hand', preordain.id)).ok).toBe(true);
    untilDecision(game);
    expect(game.state.pendingDecision?.type === 'effectChoice' && game.state.pendingDecision.mode).toBe('scry');
    game.apply('p1', { type: 'effectChoice', picks: [] });
    passUntil(game, (s) => s.pendingDecision?.type === 'effectChoice', 10);
    const pd = game.state.pendingDecision;
    expect(pd?.type === 'effectChoice' && pd.mode).toBe('order');
    game.apply('p1', { type: 'effectChoice', picks: [bolt, bears] });
    settle(game);
    expect(game.state.players.p1.zones.hand).toContain(bolt); // comprou o Bolt, que ficou no topo
    expect(game.state.players.p1.zones.library[0]).toBe(bears);
  });
});
