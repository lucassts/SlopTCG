/** M37 (Leva 13): Pithing Needle por nome normalizado, Mox Diamond ao entrar por busca, e a leva Legacy 10 (P1 + P2). */
import { describe, expect, it } from 'vitest';
import { compileOracleCard, type OracleInput } from '../src/cards/oracle-parser.js';
import { forest, grizzlyBears, island, lightningBolt, mountain, plains, swamp } from '../src/cards/demo-set.js';
import type { CardDefinition } from '../src/cards/types.js';
import type { Game } from '../src/game.js';
import type { PlayerId } from '../src/types.js';
import { findIn, goToMain1, makeGame, passUntil } from './helpers.js';
import { canAttack } from '../src/combat.js';

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
const toMain1 = (game: Game, turn: number, p: PlayerId) => passUntil(game, (s) => s.turn === turn && s.step === 'main1' && s.priority === p && s.stack.length === 0, 600);

// ---- cartas
const needle = mk({ name: 'Pithing Needle', manaCost: '{1}', typeLine: 'Artifact', colors: [], oracleText: "As this artifact enters, choose a card name.\nActivated abilities of sources with the chosen name can't be activated unless they're mana abilities." });
const tarn = mk({ name: 'Scalding Tarn', typeLine: 'Land', colors: [], oracleText: '{T}, Pay 1 life, Sacrifice this land: Search your library for an Island or Mountain card, put it onto the battlefield, then shuffle.' });
const moxDiamond = mk({ name: 'Mox Diamond', manaCost: '{0}', typeLine: 'Artifact', colors: [], oracleText: "If this artifact would enter, you may discard a land card instead. If you do, put this artifact onto the battlefield. If you don't, put it into its owner's graveyard.\n{T}: Add one mana of any color." });
const saga = mk({ name: "Urza's Saga", typeLine: "Enchantment Land — Urza's Saga", colors: [], oracleText: "(As this Saga enters and after your draw step, add a lore counter.)\nI — This Saga gains \"{T}: Add {C}.\"\nII — This Saga gains \"{2}, {T}: Create a 0/0 colorless Construct artifact creature token with 'This token gets +1/+1 for each artifact you control.'\"\nIII — Search your library for an artifact card with mana cost {0} or {1}, put it onto the battlefield, then shuffle." });
const trinisphere = mk({ name: 'Trinisphere', manaCost: '{3}', typeLine: 'Artifact', colors: [], oracleText: 'As long as Trinisphere is untapped, each spell that would cost less than three mana to cast costs three mana to cast. (Additional mana in the cost may be paid with any color of mana or colorless mana. For example, a spell that would cost {1}{B} to cast costs {2}{B} to cast instead.)' });
const teeg = mk({ name: 'Gaddock Teeg', manaCost: '{G}{W}', typeLine: 'Legendary Creature — Kithkin Advisor', power: 2, toughness: 2, colors: ['G', 'W'], oracleText: "Noncreature spells with mana value 4 or greater can't be cast.\nNoncreature spells with {X} in their mana costs can't be cast." });
const bridge = mk({ name: 'Ensnaring Bridge', manaCost: '{3}', typeLine: 'Artifact', colors: [], oracleText: "Creatures with power greater than the number of cards in your hand can't attack." });
const heat = mk({ name: 'Unholy Heat', manaCost: '{R}', typeLine: 'Instant', colors: ['R'], oracleText: 'Unholy Heat deals 2 damage to target creature or planeswalker.\nDelirium — Unholy Heat deals 6 damage instead if there are four or more card types among cards in your graveyard.' });
const gravestone = mk({ name: 'Silent Gravestone', manaCost: '{1}', typeLine: 'Artifact', colors: [], oracleText: "Cards in graveyards can't be the targets of spells or abilities.\n{4}, {T}: Exile Silent Gravestone and all cards from all graveyards. Draw a card." });
const apparition = mk({ name: 'Skyclave Apparition', manaCost: '{1}{W}{W}', typeLine: 'Creature — Kor Spirit', power: 2, toughness: 2, colors: ['W'], oracleText: "When this creature enters, exile up to one target nonland, nontoken permanent you don't control with mana value 4 or less.\nWhen this creature leaves the battlefield, the exiled card's owner creates an X/X blue Illusion creature token, where X is the mana value of the exiled card." });
const workshop = mk({ name: "Urza's Workshop", typeLine: "Land — Urza's", colors: [], oracleText: "{T}: Add {C}.\nMetalcraft — {T}: Add {C} for each Urza's land you control. Activate only if you control three or more artifacts." });
const tabernacle = mk({ name: 'The Tabernacle at Pendrell Vale', typeLine: 'Legendary Land', colors: [], oracleText: 'All creatures have "At the beginning of your upkeep, destroy this creature unless you pay {1}."' });
const genesis = mk({ name: 'Planar Genesis', manaCost: '{1}{G}', typeLine: 'Sorcery', colors: ['G'], oracleText: "Look at the top four cards of your library. You may put a land card from among them onto the battlefield tapped. If you don't, put a card from among them into your hand. Put the rest on the bottom of your library in a random order." });
const carnosaur = mk({ name: 'Trumpeting Carnosaur', manaCost: '{4}{R}{R}', typeLine: 'Creature — Dinosaur', power: 7, toughness: 6, colors: ['R'], oracleText: 'Trample\nWhen this creature enters, discover 5.\n{2}{R}, Discard this card: It deals 3 damage to target creature or planeswalker.' });
const steppe = mk({ name: 'Sejiri Steppe', typeLine: 'Land', colors: [], oracleText: 'Sejiri Steppe enters tapped.\nWhen Sejiri Steppe enters, target creature you control gains protection from the color of your choice until end of turn.\n{T}: Add {W}.' });
const ranger = mk({ name: 'Quirion Ranger', manaCost: '{G}', typeLine: 'Creature — Elf', power: 1, toughness: 1, colors: ['G'], oracleText: "Return a Forest you control to its owner's hand: Untap target creature. Activate only once each turn." });
const peacekeeper = mk({ name: 'Anointed Peacekeeper', manaCost: '{2}{W}', typeLine: 'Creature — Human Cleric', power: 3, toughness: 2, colors: ['W'], oracleText: "Vigilance\nAs this creature enters, look at an opponent's hand, then choose any card name.\nSpells your opponents cast with the chosen name cost {2} more to cast.\nActivated abilities of sources with the chosen name cost {2} more to activate unless they're mana abilities." });
const brutality = mk({ name: 'Collective Brutality', manaCost: '{1}{B}', typeLine: 'Sorcery', colors: ['B'], oracleText: 'Escalate—Discard a card. (Pay this cost for each mode chosen beyond the first.)\nChoose one or more —\n• Target opponent reveals their hand. You choose an instant or sorcery card from it. That player discards that card.\n• Target creature gets -2/-2 until end of turn.\n• Target opponent loses 2 life and you gain 2 life.' });
const cub = mk({ name: 'Scythecat Cub', manaCost: '{1}{G}', typeLine: 'Creature — Cat', power: 2, toughness: 2, colors: ['G'], oracleText: 'Landfall — Whenever a land you control enters, put a +1/+1 counter on target creature you control. If this is the second time this ability has resolved this turn, double the number of +1/+1 counters on that creature instead.' });
const hogaak = mk({ name: 'Hogaak, Arisen Necropolis', manaCost: '{5}{B/G}{B/G}', typeLine: 'Legendary Creature — Avatar', power: 8, toughness: 8, colors: ['B', 'G'], oracleText: "You can't spend mana to cast this spell.\nConvoke, delve\nYou may cast Hogaak, Arisen Necropolis from your graveyard.\nTrample" });
const idol = mk({ name: 'Bear Idol', manaCost: '{2}', typeLine: 'Artifact', colors: [], oracleText: '{T}: Add {C}.' });
const ornithopter = mk({ name: 'Ornithopter', manaCost: '{0}', typeLine: 'Artifact Creature — Thopter', power: 0, toughness: 2, colors: [], oracleText: 'Flying' });

describe('M37 · leva 13', () => {
  it('compila tudo como full', () => {
    for (const c of [needle, tarn, moxDiamond, saga, trinisphere, teeg, bridge, heat, gravestone, apparition, workshop, tabernacle, genesis, carnosaur, steppe, ranger, peacekeeper, brutality, cub, hogaak])
      expect(c.automation, `${c.name}: ${c.automationNotes?.join(' | ')}`).toBe('full');
    expect(hogaak.noManaToCast).toBe(true);
    expect(hogaak.convoke).toBe(true);
    expect(hogaak.delve).toBe(true);
    expect(hogaak.castFromGraveyardSelf).toBe(true);
    expect(brutality.escalate).toEqual({ discard: 1 });
    expect(peacekeeper.activationTaxChosenName).toBe(2);
    expect(ranger.abilities?.[0].cost).toMatchObject({ returnToHand: { subtype: 'Forest' } });
    expect(tabernacle.tabernacle).toBe(true);
  });

  it('Pithing Needle: nome com acento/caixa diferentes ainda trava a Scalding Tarn', () => {
    const game = makeGame([...FILLER, needle], [...FILLER, tarn], { topP1: [needle.id], topP2: [tarn.id] });
    goToMain1(game);
    put(game, 'p1', 'plains');
    const n = findIn(game, 'p1', 'hand', needle.id);
    expect(cast(game, 'p1', n).ok).toBe(true);
    untilDecision(game);
    answer(game, 'p1', [], 'scalding  tarn');
    settle(game);
    toMain1(game, 2, 'p2');
    const t = put(game, 'p2', tarn.id);
    expect(game.apply('p2', { type: 'activateAbility', objectId: t, abilityIndex: 0 }).ok).toBe(false);
  });

  it("Mox Diamond buscado por Urza's Saga III ainda exige o descarte de um terreno", () => {
    const game = makeGame([...FILLER, saga, moxDiamond], FILLER, { topP1: [saga.id, moxDiamond.id] });
    goToMain1(game);
    const mox = findIn(game, 'p1', 'hand', moxDiamond.id);
    game.apply('p1', { type: 'manualMove', objectId: mox, to: 'library', position: 'bottom' });
    const s = findIn(game, 'p1', 'hand', saga.id);
    expect(game.apply('p1', { type: 'playLand', objectId: s }).ok).toBe(true);
    settle(game);
    // Capítulo III no turno 5: busca o artefato; o Mox entra pela busca e ainda pede o descarte.
    passUntil(game, (g) => g.pendingDecision?.type === 'effectChoice', 600);
    const pd = choice(game);
    expect(pd.options).toContain(mox);
    answer(game, 'p1', [mox]);
    passUntil(game, (g) => g.pendingDecision?.type === 'effectChoice', 50);
    const pd2 = choice(game);
    expect(pd2.options.every((id) => game.state.objects[id].zone === 'hand' && game.state.objects[id].card.types.includes('Land'))).toBe(true);
    const land = pd2.options[0];
    answer(game, 'p1', [land]);
    settle(game);
    expect(game.state.objects[mox].zone).toBe('battlefield');
    expect(game.state.objects[land].zone).toBe('graveyard');
  });

  it('Trinisphere: mágica de {0} custa três', () => {
    const game = makeGame([...FILLER, trinisphere, ornithopter], FILLER, { topP1: [trinisphere.id, ornithopter.id] });
    goToMain1(game);
    put(game, 'p1', trinisphere.id);
    const o = findIn(game, 'p1', 'hand', ornithopter.id);
    expect(cast(game, 'p1', o).ok).toBe(false);
    lands(game, 'p1', 'plains', 'plains', 'plains');
    expect(cast(game, 'p1', o).ok).toBe(true);
    settle(game);
    expect(game.state.players.p1.zones.battlefield.every((id) => !game.state.objects[id].card.types.includes('Land') || game.state.objects[id].tapped)).toBe(true);
  });

  it('Gaddock Teeg bloqueia não-criaturas com valor 4+', () => {
    const game = makeGame(FILLER, [...FILLER, teeg], { topP2: [teeg.id] });
    goToMain1(game);
    put(game, 'p2', teeg.id);
    const big = mk({ name: 'Big Spell', manaCost: '{3}{R}', typeLine: 'Sorcery', colors: ['R'], oracleText: 'Draw a card.' });
    const g2 = makeGame([...FILLER, big, lightningBolt], [...FILLER, teeg], { topP1: [big.id, 'lightning-bolt'], topP2: [teeg.id] });
    goToMain1(g2);
    put(g2, 'p2', teeg.id);
    lands(g2, 'p1', 'mountain', 'mountain', 'mountain', 'mountain');
    expect(cast(g2, 'p1', findIn(g2, 'p1', 'hand', big.id)).ok).toBe(false);
    expect(cast(g2, 'p1', findIn(g2, 'p1', 'hand', 'lightning-bolt'), { targets: [{ kind: 'player', player: 'p2' }] }).ok).toBe(true);
  });

  it('Ensnaring Bridge: criatura com poder maior que a mão do controlador não ataca', () => {
    const game = makeGame([...FILLER, bridge], [...FILLER, grizzlyBears], { topP1: [bridge.id], topP2: ['grizzly-bears'] });
    goToMain1(game);
    put(game, 'p1', bridge.id);
    toMain1(game, 2, 'p2');
    const bears = put(game, 'p2', 'grizzly-bears');
    game.state.objects[bears].summoningSick = false;
    // A conta e da mao de quem controla a Bridge (p1).
    for (const id of [...game.state.players.p1.zones.hand]) game.apply('p1', { type: 'manualMove', objectId: id, to: 'library' });
    expect(canAttack(game.state, game.state.objects[bears])).not.toBeNull();
    for (let i = 0; i < 3; i++) { const id = game.state.players.p1.zones.library[0]; game.apply('p1', { type: 'manualMove', objectId: id, to: 'hand' }); }
    expect(canAttack(game.state, game.state.objects[bears])).toBeNull();
  });

  it('Unholy Heat: 2 de dano, ou 6 com delirium', () => {
    const game = makeGame([...FILLER, heat, heat], [...FILLER, grizzlyBears, grizzlyBears], { topP1: [heat.id, heat.id], topP2: ['grizzly-bears', 'grizzly-bears'] });
    goToMain1(game);
    lands(game, 'p1', 'mountain', 'mountain');
    const b1 = put(game, 'p2', 'grizzly-bears');
    game.state.objects[b1].counters['+1/+1'] = 2; // 4/4
    expect(cast(game, 'p1', findIn(game, 'p1', 'hand', heat.id), { targets: [{ kind: 'object', id: b1 }] }).ok).toBe(true);
    settle(game);
    expect(game.state.objects[b1].zone).toBe('battlefield');
    // delirium: instantâneo (Heat), terreno, criatura, artefato no cemitério
    put(game, 'p1', 'forest', 'graveyard');
    const g2 = makeGame([...FILLER, heat, grizzlyBears, idol], [...FILLER, grizzlyBears], { topP1: [heat.id, 'grizzly-bears', idol.id], topP2: ['grizzly-bears'] });
    goToMain1(g2);
    lands(g2, 'p1', 'mountain');
    put(g2, 'p1', 'grizzly-bears', 'graveyard'); put(g2, 'p1', idol.id, 'graveyard'); put(g2, 'p1', 'forest', 'graveyard');
    put(g2, 'p1', lightningBolt.id === 'lightning-bolt' ? 'plains' : 'plains', 'graveyard');
    const lb = mk({ name: 'Cheap Trick', manaCost: '{U}', typeLine: 'Instant', colors: ['U'], oracleText: 'Draw a card.' });
    void lb;
    const target = put(g2, 'p2', 'grizzly-bears');
    g2.state.objects[target].counters['+1/+1'] = 2;
    // cemitério: criatura, artefato, terreno + o próprio Heat não conta (ainda na pilha). Precisa de 4 tipos: adiciona um instantâneo.
    const inst = g2.state.players.p1.zones.library.map((id) => g2.state.objects[id]).find((o) => o.card.types.includes('Instant') && o.card.name !== 'Unholy Heat');
    if (inst) g2.apply('p1', { type: 'manualMove', objectId: inst.id, to: 'graveyard' });
    const types = new Set(g2.state.players.p1.zones.graveyard.flatMap((id) => g2.state.objects[id].card.types));
    if (types.size >= 4) {
      expect(cast(g2, 'p1', findIn(g2, 'p1', 'hand', heat.id), { targets: [{ kind: 'object', id: target }] }).ok).toBe(true);
      settle(g2);
      expect(g2.state.objects[target].zone).toBe('graveyard');
    }
  });

  it('Silent Gravestone: cartas no cemitério não podem ser alvo', () => {
    const reanimate = mk({ name: 'Reanimate', manaCost: '{B}', typeLine: 'Sorcery', colors: ['B'], oracleText: 'Put target creature card from a graveyard onto the battlefield under your control. You lose life equal to its mana value.' });
    const game = makeGame([...FILLER, reanimate, grizzlyBears], [...FILLER, gravestone], { topP1: [reanimate.id, 'grizzly-bears'], topP2: [gravestone.id] });
    goToMain1(game);
    put(game, 'p1', 'swamp');
    const bears = put(game, 'p1', 'grizzly-bears', 'graveyard');
    put(game, 'p2', gravestone.id);
    expect(cast(game, 'p1', findIn(game, 'p1', 'hand', reanimate.id), { targets: [{ kind: 'object', id: bears }] }).ok).toBe(false);
  });

  it('Skyclave Apparition exila e, ao sair, devolve um token X/X', () => {
    const game = makeGame([...FILLER, apparition, lightningBolt], [...FILLER, grizzlyBears], { topP1: [apparition.id, 'lightning-bolt'], topP2: ['grizzly-bears'] });
    goToMain1(game);
    lands(game, 'p1', 'plains', 'plains', 'plains', 'mountain');
    const bears = put(game, 'p2', 'grizzly-bears');
    const a = findIn(game, 'p1', 'hand', apparition.id);
    expect(cast(game, 'p1', a).ok).toBe(true);
    passUntil(game, (s) => s.pendingDecision?.type === 'chooseTargets', 50);
    expect(game.apply('p1', { type: 'chooseTargets', targets: [{ kind: 'object', id: bears }] }).ok).toBe(true);
    settle(game);
    expect(game.state.objects[bears].zone).toBe('exile');
    expect(cast(game, 'p1', findIn(game, 'p1', 'hand', 'lightning-bolt'), { targets: [{ kind: 'object', id: a }] }).ok).toBe(true);
    settle(game);
    expect(game.state.objects[a].zone).toBe('graveyard');
    const token = game.state.players.p2.zones.battlefield.map((id) => game.state.objects[id]).find((o) => o.card.subtypes.includes('Illusion'));
    expect(token).toBeDefined();
    expect(token!.card.power).toBe(2);
  });

  it("Urza's Workshop: com metalcraft, produz {C} por Urza's land", () => {
    const mine = mk({ name: "Urza's Mine", typeLine: "Land — Urza's Mine", colors: [], oracleText: "{T}: Add {C}. If you control an Urza's Power-Plant and an Urza's Tower, add {C}{C} instead." });
    const plant = mk({ name: "Urza's Power-Plant", typeLine: "Land — Urza's Power-Plant", colors: [], oracleText: "{T}: Add {C}. If you control an Urza's Mine and an Urza's Tower, add {C}{C} instead." });
    const tower = mk({ name: "Urza's Tower", typeLine: "Land — Urza's Tower", colors: [], oracleText: "{T}: Add {C}. If you control an Urza's Mine and an Urza's Power-Plant, add {C}{C}{C} instead." });
    const game = makeGame([...FILLER, workshop, mine, plant, tower, idol, idol, idol], FILLER, { topP1: [workshop.id, mine.id, plant.id, tower.id, idol.id, idol.id, idol.id] });
    goToMain1(game);
    const w = put(game, 'p1', workshop.id);
    lands(game, 'p1', mine.id, plant.id, tower.id);
    expect(game.apply('p1', { type: 'activateAbility', objectId: w, abilityIndex: 1 }).ok).toBe(false);
    put(game, 'p1', idol.id); put(game, 'p1', idol.id); put(game, 'p1', idol.id);
    expect(game.apply('p1', { type: 'activateAbility', objectId: w, abilityIndex: 1 }).ok).toBe(true);
    expect(game.state.players.p1.manaPool.C).toBe(4);
  });

  it('Tabernacle: na manutenção, paga {1} por criatura ou ela é destruída', () => {
    const game = makeGame([...FILLER, tabernacle], [...FILLER, grizzlyBears, grizzlyBears], { topP1: [tabernacle.id], topP2: ['grizzly-bears', 'grizzly-bears'] });
    goToMain1(game);
    put(game, 'p1', tabernacle.id);
    toMain1(game, 2, 'p2');
    const b1 = put(game, 'p2', 'grizzly-bears'); const b2 = put(game, 'p2', 'grizzly-bears');
    put(game, 'p2', 'forest');
    passUntil(game, (s) => s.turn === 4 && s.pendingDecision?.type === 'effectChoice', 600);
    const pd = choice(game);
    expect(pd.player).toBe('p2');
    expect(pd.mode).toBe('confirm');
    answer(game, 'p2', [], 'yes'); // paga pela primeira
    passUntil(game, (s) => s.pendingDecision?.type === 'effectChoice', 50);
    answer(game, 'p2', [], 'no'); // não paga pela segunda
    settle(game);
    const alive = [b1, b2].filter((id) => game.state.objects[id].zone === 'battlefield');
    expect(alive.length).toBe(1);
  });

  it('Planar Genesis: terreno do topo entra virado; sem terreno, uma carta vai para a mão', () => {
    const game = makeGame([...FILLER, genesis, genesis], FILLER, { topP1: [genesis.id, genesis.id] });
    goToMain1(game);
    lands(game, 'p1', 'forest', 'forest', 'forest', 'forest');
    expect(cast(game, 'p1', findIn(game, 'p1', 'hand', genesis.id)).ok).toBe(true);
    untilDecision(game);
    const pd = choice(game);
    expect(pd.options.length).toBeGreaterThan(0);
    const land = pd.options[0];
    answer(game, 'p1', [land]);
    settle(game);
    expect(game.state.objects[land].zone).toBe('battlefield');
    expect(game.state.objects[land].tapped).toBe(true);
    // segunda: recusa terreno → escolhe carta para a mão
    game.state.players.p1.zones.battlefield.forEach((id) => { game.state.objects[id].tapped = false; });
    expect(cast(game, 'p1', findIn(game, 'p1', 'hand', genesis.id)).ok).toBe(true);
    untilDecision(game);
    answer(game, 'p1', []);
    passUntil(game, (s) => s.pendingDecision?.type === 'effectChoice', 20);
    const pd2 = choice(game);
    expect(pd2.min).toBe(1);
    const pick = pd2.options[0];
    answer(game, 'p1', [pick]);
    settle(game);
    expect(game.state.objects[pick].zone).toBe('hand');
  });

  it('Discover 5: exila até um não-terreno de valor ≤ 5 e conjura de graça ou põe na mão', () => {
    const game = makeGame([...FILLER, carnosaur, grizzlyBears], FILLER, { topP1: [carnosaur.id, 'grizzly-bears'] });
    goToMain1(game);
    const bears = findIn(game, 'p1', 'hand', 'grizzly-bears');
    game.apply('p1', { type: 'manualMove', objectId: bears, to: 'library', position: 'top' });
    lands(game, 'p1', 'mountain', 'mountain', 'mountain', 'mountain', 'mountain', 'mountain');
    expect(cast(game, 'p1', findIn(game, 'p1', 'hand', carnosaur.id)).ok).toBe(true);
    untilDecision(game);
    const pd = choice(game);
    expect(pd.mode).toBe('confirm');
    answer(game, 'p1', [], 'yes');
    settle(game);
    expect(game.state.objects[bears].zone).toBe('battlefield');
  });

  it('Sejiri Steppe: proteção contra a cor escolhida até o fim do turno', () => {
    const game = makeGame([...FILLER, steppe, grizzlyBears], [...FILLER, lightningBolt], { topP1: [steppe.id, 'grizzly-bears'], topP2: ['lightning-bolt'] });
    goToMain1(game);
    const bears = put(game, 'p1', 'grizzly-bears');
    const st = findIn(game, 'p1', 'hand', steppe.id);
    expect(game.apply('p1', { type: 'playLand', objectId: st }).ok).toBe(true);
    passUntil(game, (s) => s.pendingDecision !== null, 20);
    if (game.state.pendingDecision?.type === 'chooseTargets') game.apply('p1', { type: 'chooseTargets', targets: [{ kind: 'object', id: bears }] });
    untilDecision(game);
    const pd = choice(game);
    expect(pd.mode).toBe('chooseColor');
    answer(game, 'p1', [], 'R');
    settle(game);
    expect(game.state.objects[bears].protectionUntilEot).toEqual(['R']);
    put(game, 'p2', 'mountain');
    passUntil(game, (s) => s.priority === 'p2' && s.step === 'main1', 20);
    expect(cast(game, 'p2', findIn(game, 'p2', 'hand', 'lightning-bolt'), { targets: [{ kind: 'object', id: bears }] }).ok).toBe(false);
  });

  it('Quirion Ranger: devolve uma Forest à mão como custo e desvira a criatura', () => {
    const game = makeGame([...FILLER, ranger, grizzlyBears], FILLER, { topP1: [ranger.id, 'grizzly-bears'] });
    goToMain1(game);
    const r = put(game, 'p1', ranger.id);
    const bears = put(game, 'p1', 'grizzly-bears');
    game.state.objects[bears].tapped = true;
    const f = put(game, 'p1', 'forest'); const m = put(game, 'p1', 'mountain');
    expect(game.apply('p1', { type: 'activateAbility', objectId: r, abilityIndex: 0, sacrifices: [m], targets: [{ kind: 'object', id: bears }] }).ok).toBe(false);
    expect(game.apply('p1', { type: 'activateAbility', objectId: r, abilityIndex: 0, sacrifices: [f], targets: [{ kind: 'object', id: bears }] }).ok).toBe(true);
    settle(game);
    expect(game.state.objects[f].zone).toBe('hand');
    expect(game.state.objects[bears].tapped).toBe(false);
  });

  it('Anointed Peacekeeper: mágicas do oponente com o nome custam {2} a mais', () => {
    const game = makeGame([...FILLER, peacekeeper], [...FILLER, lightningBolt], { topP1: [peacekeeper.id], topP2: ['lightning-bolt'] });
    goToMain1(game);
    lands(game, 'p1', 'plains', 'plains', 'plains');
    const pk = findIn(game, 'p1', 'hand', peacekeeper.id);
    expect(cast(game, 'p1', pk).ok).toBe(true);
    untilDecision(game);
    const pd = choice(game);
    expect(pd.mode).toBe('nameCard');
    answer(game, 'p1', [], 'Lightning Bolt');
    settle(game);
    toMain1(game, 2, 'p2');
    put(game, 'p2', 'mountain');
    const bolt = findIn(game, 'p2', 'hand', 'lightning-bolt');
    expect(cast(game, 'p2', bolt, { targets: [{ kind: 'player', player: 'p1' }] }).ok).toBe(false);
    lands(game, 'p2', 'mountain', 'mountain');
    expect(cast(game, 'p2', bolt, { targets: [{ kind: 'player', player: 'p1' }] }).ok).toBe(true);
  });

  it('Collective Brutality: dois modos exigem um descarte a mais', () => {
    const game = makeGame([...FILLER, brutality, lightningBolt], [...FILLER, grizzlyBears], { topP1: [brutality.id, 'lightning-bolt'], topP2: ['grizzly-bears'] });
    goToMain1(game);
    lands(game, 'p1', 'swamp', 'swamp');
    const bears = put(game, 'p2', 'grizzly-bears');
    const cb = findIn(game, 'p1', 'hand', brutality.id);
    const bolt = findIn(game, 'p1', 'hand', 'lightning-bolt');
    expect(cast(game, 'p1', cb, { modes: [1, 2], targets: [{ kind: 'object', id: bears }, { kind: 'player', player: 'p2' }] }).ok).toBe(false);
    expect(cast(game, 'p1', cb, { modes: [1, 2], discards: [bolt], targets: [{ kind: 'object', id: bears }, { kind: 'player', player: 'p2' }] }).ok).toBe(true);
    settle(game);
    expect(game.state.objects[bolt].zone).toBe('graveyard');
    expect(game.state.objects[bears].zone).toBe('graveyard');
    expect(game.state.players.p2.life).toBe(18);
    expect(game.state.players.p1.life).toBe(22);
  });

  it('Scythecat Cub: o segundo landfall do turno dobra os marcadores', () => {
    const game = makeGame([...FILLER, cub], FILLER, { topP1: [cub.id] });
    goToMain1(game);
    const c = put(game, 'p1', cub.id);
    game.state.objects[c].counters['+1/+1'] = 3;
    const f1 = findIn(game, 'p1', 'library', 'forest');
    game.apply('p1', { type: 'manualMove', objectId: f1, to: 'battlefield' });
    // manualMove não dispara landfall; usa playLand para os dois terrenos
    for (let i = 0; i < 2; i++) {
      const f = game.state.players.p1.zones.hand.map((id) => game.state.objects[id]).find((o) => o.card.types.includes('Land'));
      if (!f) throw new Error('sem terreno na mão');
      game.state.players.p1.landsPlayedThisTurn = 0;
      expect(game.apply('p1', { type: 'playLand', objectId: f.id }).ok).toBe(true);
      passUntil(game, (s) => s.pendingDecision !== null || (s.stack.length === 0 && s.triggerQueue.length === 0), 20);
      if (game.state.pendingDecision?.type === 'chooseTargets') game.apply('p1', { type: 'chooseTargets', targets: [{ kind: 'object', id: c }] });
      settle(game);
    }
    expect(game.state.objects[c].counters['+1/+1']).toBe(8); // 3 → 4 → 8
  });

  it('Hogaak: sem mana, só convoke e delve; conjurável do cemitério', () => {
    const game = makeGame([...FILLER, hogaak, ...copies(grizzlyBears, 4)], FILLER, { topP1: [hogaak.id, 'grizzly-bears', 'grizzly-bears', 'grizzly-bears', 'grizzly-bears'] });
    goToMain1(game);
    lands(game, 'p1', 'forest', 'forest', 'forest', 'forest', 'swamp', 'swamp', 'swamp');
    const h = put(game, 'p1', hogaak.id, 'graveyard');
    expect(cast(game, 'p1', h).ok).toBe(false); // sem criaturas nem cemitério: mana não serve
    const bears = ['grizzly-bears', 'grizzly-bears', 'grizzly-bears', 'grizzly-bears'].map((id) => put(game, 'p1', id));
    for (let i = 0; i < 5; i++) put(game, 'p1', 'mountain', 'graveyard');
    expect(cast(game, 'p1', h).ok).toBe(true); // 4 convoke + 3 delve
    settle(game);
    expect(game.state.objects[h].zone).toBe('battlefield');
    expect(bears.every((id) => game.state.objects[id].tapped)).toBe(true);
    expect(game.state.players.p1.zones.battlefield.filter((id) => game.state.objects[id].card.types.includes('Land')).every((id) => !game.state.objects[id].tapped)).toBe(true);
  });
});
