/** M43: as 30 mais pesadas do Legacy (pedido do Lucas) + Karn × Mycosynth Lattice. */
import { describe, expect, it } from 'vitest';
import { compileOracleCard, type OracleInput } from '../src/cards/oracle-parser.js';
import { forest, grizzlyBears, island, lightningBolt, mountain, plains, swamp } from '../src/cards/demo-set.js';
import type { CardDefinition } from '../src/cards/types.js';
import type { Game } from '../src/game.js';
import type { PlayerId } from '../src/types.js';
import { effectivePower, effectiveToughness, hasKeyword } from '../src/state.js';
import { checkStateBasedActions } from '../src/sba.js';
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
const sba = (game: Game) => { checkStateBasedActions(game.state, () => undefined); };

const C = (name: string, extra: Partial<OracleInput> & { oracleText: string; typeLine: string }) => mk({ name, colors: [], ...extra });
const lattice = C('Mycosynth Lattice', { manaCost: '{6}', typeLine: 'Artifact', oracleText: "All permanents are artifacts in addition to their other types.\nAll cards that aren't on the battlefield, spells, and permanents are colorless.\nPlayers may spend mana as though it were mana of any color." });
const karn = C('Karn, the Great Creator', { manaCost: '{4}', typeLine: 'Legendary Planeswalker — Karn', loyalty: 5, oracleText: "Activated abilities of artifacts your opponents control can't be activated.\n+1: Until your next turn, up to one target noncreature artifact becomes an artifact creature with power and toughness each equal to its mana value.\n−2: You may reveal an artifact card you own from outside the game or choose a face-up artifact card you own in exile. Put that card into your hand." });
const cloak = C('Cloak and Dagger, Entwined', { manaCost: '{1}{W}{B}', typeLine: 'Legendary Creature — Human Hero', power: 2, toughness: 2, colors: ['W', 'B'], oracleText: 'Deathtouch, lifelink\nWhen Cloak and Dagger enter, choose target opponent and up to one target creature they control. They reveal their hand. You may exile a nonland card from their hand or the chosen creature until Cloak and Dagger leave the battlefield.' });
const sub = C('Invasion Submersible', { manaCost: '{2}{U}', typeLine: 'Artifact — Vehicle', power: 0, toughness: 0, colors: ['U'], oracleText: 'When this Vehicle enters, return up to one other target nonland permanent to its owner\'s hand.\nExhaust — Waterbend {3}: This Vehicle becomes an artifact creature. Put three +1/+1 counters on it.' });
const tezz = C('Tezzeret, Cruel Captain', { manaCost: '{3}', typeLine: 'Legendary Planeswalker — Tezzeret', loyalty: 4, oracleText: "Whenever an artifact you control enters, put a loyalty counter on Tezzeret.\n0: Untap target artifact or creature. If it's an artifact creature, put a +1/+1 counter on it.\n−3: Search your library for an artifact card with mana value 1 or less, reveal it, put it into your hand, then shuffle.\n−7: You get an emblem with \"At the beginning of combat on your turn, put three +1/+1 counters on target artifact you control. If it's not a creature, it becomes a 0/0 Robot artifact creature.\"" });
const kaito = C('Kaito, Bane of Nightmares', { manaCost: '{2}{U}{B}', typeLine: 'Legendary Planeswalker — Kaito', loyalty: 4, colors: ['U', 'B'], oracleText: "Ninjutsu {1}{U}{B}\nDuring your turn, as long as Kaito has one or more loyalty counters on him, he's a 3/4 Ninja creature and has hexproof.\n+1: You get an emblem with \"Ninjas you control get +1/+1.\"\n0: Surveil 2. Then draw a card for each opponent who lost life this turn.\n−2: Tap target creature. Put two stun counters on it." });
const grist = C('Grist, the Hunger Tide', { manaCost: '{1}{B}{G}', typeLine: 'Legendary Planeswalker — Grist', loyalty: 3, colors: ['B', 'G'], oracleText: "As long as Grist isn't on the battlefield, it's a 1/1 Insect creature in addition to its other types.\n+1: Create a 1/1 black and green Insect creature token, then mill a card. If an Insect card was milled this way, put a loyalty counter on Grist and repeat this process.\n−2: You may sacrifice a creature. When you do, destroy target creature or planeswalker.\n−5: Each opponent loses life equal to the number of creature cards in your graveyard." });
const pact = C('Pact of Negation', { manaCost: '{0}', typeLine: 'Instant', colors: ['U'], oracleText: "Counter target spell.\nAt the beginning of your next upkeep, pay {3}{U}{U}. If you don't, you lose the game." });
const nomads = C('Nomads en-Kor', { manaCost: '{W}', typeLine: 'Creature — Kor Nomad Soldier', power: 1, toughness: 1, colors: ['W'], oracleText: '{0}: The next 1 damage that would be dealt to this creature this turn is dealt to target creature you control instead.' });
const shepherd = C('Allosaurus Shepherd', { manaCost: '{G}', typeLine: 'Creature — Elf Shaman', power: 1, toughness: 1, colors: ['G'], oracleText: "This spell can't be countered.\nGreen spells you control can't be countered.\n{4}{G}{G}: Until end of turn, each Elf creature you control has base power and toughness 5/5 and becomes a Dinosaur in addition to its other creature types." });
const goryo = C("Goryo's Vengeance", { manaCost: '{1}{B}', typeLine: 'Instant — Arcane', colors: ['B'], oracleText: 'Return target legendary creature card from your graveyard to the battlefield. That creature gains haste. Exile it at the beginning of the next end step.\nSplice onto Arcane {2}{B}' });
const imp = C('Putrid Imp', { manaCost: '{B}', typeLine: 'Creature — Zombie Imp', power: 1, toughness: 1, colors: ['B'], oracleText: "Discard a card: This creature gains flying until end of turn.\nThreshold — As long as there are seven or more cards in your graveyard, this creature gets +1/+1 and can't block." });
const arena = C('Arena of Glory', { typeLine: 'Land', oracleText: 'This land enters tapped unless you control a Mountain.\n{T}: Add {R}.\n{R}, {T}, Exert this land: Add {R}{R}. If that mana is spent on a creature spell, it gains haste until end of turn.' });
const engine = C('Phyrexian Dragon Engine', { manaCost: '{3}', typeLine: 'Artifact Creature — Phyrexian Dragon', power: 2, toughness: 2, oracleText: 'Double strike\nWhen this creature enters from your graveyard, you may discard your hand. If you do, draw three cards.\nUnearth {3}{R}{R}' });
const cauldron = C("Agatha's Soul Cauldron", { manaCost: '{2}', typeLine: 'Legendary Artifact', oracleText: "You may spend mana as though it were mana of any color to activate abilities of creatures you control.\nCreatures you control with +1/+1 counters on them have all activated abilities of all creature cards exiled with Agatha's Soul Cauldron.\n{T}: Exile target card from a graveyard. When a creature card is exiled this way, put a +1/+1 counter on target creature you control." });
const boomerang = C('Boomerang Basics', { manaCost: '{U}', typeLine: 'Sorcery — Lesson', colors: ['U'], oracleText: "Return target nonland permanent to its owner's hand. If you controlled that permanent, draw a card." });
const charm = C('Prismari Charm', { manaCost: '{U}{R}', typeLine: 'Instant', colors: ['U', 'R'], oracleText: "Choose one —\n• Surveil 2, then draw a card.\n• Prismari Charm deals 1 damage to each of one or two targets.\n• Return target nonland permanent to its owner's hand." });
const herald = C('It That Heralds the End', { manaCost: '{1}{C}', typeLine: 'Creature — Eldrazi Drone', power: 2, toughness: 2, oracleText: 'Colorless spells you cast with mana value 7 or greater cost {1} less to cast.\nOther colorless creatures you control get +1/+1.' });
const village = C('Mistrise Village', { typeLine: 'Land', oracleText: "This land enters tapped unless you control a Mountain or a Forest.\n{T}: Add {U}.\n{U}, {T}: The next spell you cast this turn can't be countered." });
const trickery = C("Tibalt's Trickery", { manaCost: '{1}{R}', typeLine: 'Instant', colors: ['R'], oracleText: 'Counter target spell. Choose 1, 2, or 3 at random. Its controller mills that many cards, then exiles cards from the top of their library until they exile a nonland card with a different name than that spell. They may cast that card without paying its mana cost. Then they put the exiled cards on the bottom of their library in a random order.' });
const basics = C('Back to Basics', { manaCost: '{2}{U}', typeLine: 'Enchantment', colors: ['U'], oracleText: "Nonbasic lands don't untap during their controllers' untap steps." });
const teferi = C('Teferi, Time Raveler', { manaCost: '{1}{W}{U}', typeLine: 'Legendary Planeswalker — Teferi', loyalty: 4, colors: ['W', 'U'], oracleText: "Each opponent can cast spells only any time they could cast a sorcery.\n+1: Until your next turn, you may cast sorcery spells as though they had flash.\n−3: Return up to one target artifact, creature, or enchantment to its owner's hand. Draw a card." });
const dressDown = C('Dress Down', { manaCost: '{1}{U}', typeLine: 'Enchantment', colors: ['U'], oracleText: 'Flash\nWhen this enchantment enters, draw a card.\nCreatures lose all abilities.\nAt the beginning of the end step, sacrifice this enchantment.' });
const wither = C('Witherbloom Command', { manaCost: '{B}{G}', typeLine: 'Sorcery', colors: ['B', 'G'], oracleText: 'Choose two —\n• Target player mills three cards, then you return a land card from your graveyard to your hand.\n• Destroy target noncreature, nonland permanent with mana value 2 or less.\n• Target creature gets -3/-1 until end of turn.\n• Target opponent loses 2 life and you gain 2 life.' });
const brotherhood = C("Brotherhood's End", { manaCost: '{1}{R}{R}', typeLine: 'Sorcery', colors: ['R'], oracleText: "Choose one —\n• Brotherhood's End deals 3 damage to each creature and each planeswalker.\n• Destroy all artifacts with mana value 3 or less." });
const cling = C('Cling to Dust', { manaCost: '{B}', typeLine: 'Instant', colors: ['B'], oracleText: 'Exile target card from a graveyard. If it was a creature card, you gain 3 life. Otherwise, you draw a card.\nEscape—{3}{B}, Exile five other cards from your graveyard.' });
const breakthrough = C('Breakthrough', { manaCost: '{X}{U}', typeLine: 'Sorcery', colors: ['U'], oracleText: 'Draw four cards, then choose X cards in your hand and discard the rest.' });
const snapcaster = C('Snapcaster Mage', { manaCost: '{1}{U}', typeLine: 'Creature — Human Wizard', power: 2, toughness: 1, colors: ['U'], oracleText: 'Flash\nWhen this creature enters, target instant or sorcery card in your graveyard gains flashback until end of turn. The flashback cost is equal to its mana cost.' });
const sheoldred = C('Sheoldred, the Apocalypse', { manaCost: '{2}{B}{B}', typeLine: 'Legendary Creature — Phyrexian Praetor', power: 4, toughness: 5, colors: ['B'], oracleText: 'Deathtouch\nWhenever you draw a card, you gain 2 life.\nWhenever an opponent draws a card, they lose 2 life.' });
const flyer = C('Flying Bear', { manaCost: '{1}{G}', typeLine: 'Creature — Bear Elf', power: 2, toughness: 2, colors: ['G'], oracleText: 'Flying' });
const legend = C('Legendary Bear', { manaCost: '{1}{G}', typeLine: 'Legendary Creature — Bear', power: 2, toughness: 2, colors: ['G'], oracleText: '' });
const idol = C('Bear Idol', { manaCost: '{2}', typeLine: 'Artifact', oracleText: '{T}: Add {C}.' });
const bigColorless = C('Big Drone', { manaCost: '{7}', typeLine: 'Creature — Eldrazi', power: 5, toughness: 5, oracleText: '' });
const counterspell = C('Counterspell', { manaCost: '{U}{U}', typeLine: 'Instant', colors: ['U'], oracleText: 'Counter target spell.' });
const pinger = C('Prodigal Pyromancer', { manaCost: '{2}{R}', typeLine: 'Creature — Human Wizard', power: 1, toughness: 1, colors: ['R'], oracleText: '{T}: This creature deals 1 damage to any target.' });
const nonbasic = C('Ancient Grove', { typeLine: 'Land', oracleText: '{T}: Add {G}.' });

describe('M43 · top 30', () => {
  it('compila tudo como full', () => {
    for (const c of [cloak, sub, tezz, kaito, grist, pact, nomads, shepherd, goryo, imp, arena, engine, cauldron, boomerang, charm, herald, village, trickery, basics, teferi, dressDown, wither, brotherhood, cling, breakthrough, snapcaster, sheoldred])
      expect(c.automation, `${c.name}: ${c.automationNotes?.join(' | ')}`).toBe('full');
  });

  it('Karn + Mycosynth Lattice: terrenos do oponente não geram mana (nem no pagamento automático)', () => {
    const game = makeGame([...FILLER, lattice, karn], [...FILLER, grizzlyBears], { topP1: [lattice.id, karn.id], topP2: ['grizzly-bears'] });
    goToMain1(game);
    put(game, 'p1', lattice.id); put(game, 'p1', karn.id);
    toMain1(game, 2, 'p2');
    const f1 = put(game, 'p2', 'forest'); const f2 = put(game, 'p2', 'forest'); // movimento manual já sincroniza a Lattice
    expect(game.state.objects[f1].card.types).toContain('Artifact');
    expect(game.apply('p2', { type: 'activateAbility', objectId: f1, abilityIndex: 0 }).ok).toBe(false);
    expect(cast(game, 'p2', findIn(game, 'p2', 'hand', 'grizzly-bears')).ok).toBe(false);
    expect(game.state.objects[f2].tapped).toBe(false);
  });

  it('Cloak and Dagger: revela a mão do oponente e exila uma carta não-terreno até sair', () => {
    const game = makeGame([...FILLER, cloak, lightningBolt], [...FILLER, grizzlyBears, lightningBolt], { topP1: [cloak.id, 'lightning-bolt'], topP2: ['grizzly-bears', 'lightning-bolt'] });
    goToMain1(game);
    lands(game, 'p1', 'plains', 'plains', 'swamp', 'mountain');
    const bears = put(game, 'p2', 'grizzly-bears');
    const bolt2 = findIn(game, 'p2', 'hand', 'lightning-bolt');
    const ck = findIn(game, 'p1', 'hand', cloak.id);
    expect(cast(game, 'p1', ck).ok).toBe(true);
    passUntil(game, (s) => s.pendingDecision?.type === 'chooseTargets', 50);
    expect(game.apply('p1', { type: 'chooseTargets', targets: [{ kind: 'player', player: 'p2' }, { kind: 'object', id: bears }] }).ok).toBe(true);
    untilDecision(game);
    const pd = choice(game);
    expect(pd.options).toContain(bolt2);
    expect(pd.options).toContain(bears);
    answer(game, 'p1', [bolt2]);
    settle(game);
    expect(game.state.objects[bolt2].zone).toBe('exile');
    expect(cast(game, 'p1', findIn(game, 'p1', 'hand', 'lightning-bolt'), { targets: [{ kind: 'object', id: ck }] }).ok).toBe(true);
    settle(game);
    expect(game.state.objects[bolt2].zone).toBe('hand'); // Cloak morreu: a carta volta
  });

  it('Invasion Submersible: curvar água vira artefatos/criaturas para pagar; exaurir só uma vez', () => {
    const game = makeGame([...FILLER, sub, idol, idol, idol], FILLER, { topP1: [sub.id, idol.id, idol.id, idol.id] });
    goToMain1(game);
    const v = put(game, 'p1', sub.id);
    put(game, 'p1', idol.id); put(game, 'p1', idol.id); put(game, 'p1', idol.id);
    const idx = sub.abilities!.findIndex((a) => a.kind === 'activated' && a.oncePerGame);
    expect(game.apply('p1', { type: 'activateAbility', objectId: v, abilityIndex: idx }).ok).toBe(true);
    settle(game);
    expect(game.state.objects[v].card.types).toContain('Creature');
    expect(effectivePower(game.state, game.state.objects[v])).toBe(3);
    untapAll(game, 'p1');
    expect(game.apply('p1', { type: 'activateAbility', objectId: v, abilityIndex: idx }).ok).toBe(false); // exaurida
  });

  it('Tezzeret −7: o emblema põe três marcadores num artefato no início do combate e o vira Robô 0/0', () => {
    const game = makeGame([...FILLER, tezz, idol], FILLER, { topP1: [tezz.id, idol.id] });
    goToMain1(game);
    const t = put(game, 'p1', tezz.id);
    game.state.objects[t].counters['loyalty'] = 7;
    const art = put(game, 'p1', idol.id);
    const idx = tezz.abilities!.findIndex((a) => a.kind === 'loyalty' && a.cost === -7);
    expect(game.apply('p1', { type: 'activateAbility', objectId: t, abilityIndex: idx }).ok).toBe(true);
    settle(game);
    expect(game.state.players.p1.emblems).toContain('tezzeret');
    passUntil(game, (s) => s.pendingDecision?.type === 'chooseTargets', 50);
    expect(game.apply('p1', { type: 'chooseTargets', targets: [{ kind: 'object', id: art }] }).ok).toBe(true);
    settle(game);
    const o = game.state.objects[art];
    expect(o.card.types).toContain('Creature');
    expect(o.card.subtypes).toContain('Robot');
    expect(effectivePower(game.state, o)).toBe(3);
  });

  it('Kaito: criatura 3/4 Ninja com hexproof só no seu turno; o emblema dá +1/+1 aos Ninjas', () => {
    const game = makeGame([...FILLER, kaito], FILLER, { topP1: [kaito.id] });
    goToMain1(game);
    const k = put(game, 'p1', kaito.id);
    game.state.objects[k].counters['loyalty'] = 4;
    sba(game);
    expect(game.state.objects[k].card.types).toContain('Creature');
    expect(hasKeyword(game.state, game.state.objects[k], 'hexproof')).toBe(true);
    const idx = kaito.abilities!.findIndex((a) => a.kind === 'loyalty' && a.cost === 1);
    expect(game.apply('p1', { type: 'activateAbility', objectId: k, abilityIndex: idx }).ok).toBe(true);
    settle(game);
    expect(effectivePower(game.state, game.state.objects[k])).toBe(4); // 3 + emblema
    toMain1(game, 2, 'p2');
    expect(game.state.objects[k].card.types).not.toContain('Creature');
  });

  it('Grist +1: cria Insetos e mói enquanto moer Insetos; conta como criatura fora do campo', () => {
    const insect = C('Bug', { manaCost: '{G}', typeLine: 'Creature — Insect', power: 1, toughness: 1, colors: ['G'], oracleText: '' });
    const game = makeGame([...FILLER, grist, insect, grizzlyBears], FILLER, { topP1: [grist.id, insect.id, 'grizzly-bears'] });
    goToMain1(game);
    const g = put(game, 'p1', grist.id);
    const bug = findIn(game, 'p1', 'hand', insect.id); const bears = findIn(game, 'p1', 'hand', 'grizzly-bears');
    game.apply('p1', { type: 'manualMove', objectId: bears, to: 'library', position: 'top' });
    game.apply('p1', { type: 'manualMove', objectId: bug, to: 'library', position: 'top' }); // topo: Bug, Bears
    const idx = grist.abilities!.findIndex((a) => a.kind === 'loyalty' && a.cost === 1);
    expect(game.apply('p1', { type: 'activateAbility', objectId: g, abilityIndex: idx }).ok).toBe(true);
    settle(game);
    expect(game.state.players.p1.zones.battlefield.filter((id) => game.state.objects[id].card.name === 'Insect').length).toBe(2);
    expect(game.state.objects[g].counters['loyalty']).toBe(5); // +1 da ativação, +1 do Inseto moído
    expect(game.state.objects[bears].zone).toBe('graveyard');
    expect(grist.creatureOffBattlefield).toEqual({ power: 1, toughness: 1, subtype: 'Insect' });
  });

  it('Pact of Negation: anula de graça; na próxima manutenção paga {3}{U}{U} ou perde', () => {
    const game = makeGame([...FILLER, pact], [...FILLER, grizzlyBears], { topP1: [pact.id], topP2: ['grizzly-bears'] });
    goToMain1(game);
    toMain1(game, 2, 'p2');
    lands(game, 'p2', 'forest', 'forest');
    const bears = findIn(game, 'p2', 'hand', 'grizzly-bears');
    expect(cast(game, 'p2', bears).ok).toBe(true);
    passUntil(game, (s) => s.priority === 'p1', 10);
    expect(cast(game, 'p1', findIn(game, 'p1', 'hand', pact.id), { targets: [{ kind: 'object', id: bears }] }).ok).toBe(true);
    settle(game);
    expect(game.state.objects[bears].zone).toBe('graveyard');
    // turno 3 (p1), sem mana: perde
    passUntil(game, (s) => s.status === 'finished' || (s.turn === 3 && s.step === 'main1'), 400);
    expect(game.state.status).toBe('finished');
    expect(game.state.winner).toBe('p2');
  });

  it('Nomads en-Kor: redireciona o próximo 1 de dano para outra criatura sua', () => {
    const game = makeGame([...FILLER, nomads, grizzlyBears, pinger], FILLER, { topP1: [nomads.id, 'grizzly-bears', pinger.id] });
    goToMain1(game);
    const n = put(game, 'p1', nomads.id); const bears = put(game, 'p1', 'grizzly-bears');
    const p = put(game, 'p1', pinger.id); game.state.objects[p].summoningSick = false;
    expect(game.apply('p1', { type: 'activateAbility', objectId: n, abilityIndex: 0, targets: [{ kind: 'object', id: bears }] }).ok).toBe(true);
    settle(game);
    expect(game.apply('p1', { type: 'activateAbility', objectId: p, abilityIndex: 0, targets: [{ kind: 'object', id: n }] }).ok).toBe(true);
    settle(game);
    expect(game.state.objects[n].zone).toBe('battlefield');
    expect(game.state.objects[bears].damage).toBe(1);
  });

  it('Allosaurus Shepherd: mágicas verdes não podem ser anuladas; Elfos viram 5/5 até o fim do turno', () => {
    const game = makeGame([...FILLER, shepherd, flyer], [...FILLER, counterspell], { topP1: [shepherd.id, flyer.id], topP2: [counterspell.id] });
    goToMain1(game);
    lands(game, 'p1', 'forest', 'forest', 'forest', 'forest', 'forest', 'forest');
    const sh = put(game, 'p1', shepherd.id);
    lands(game, 'p2', 'island', 'island');
    const elf = findIn(game, 'p1', 'hand', flyer.id);
    expect(cast(game, 'p1', elf).ok).toBe(true);
    passUntil(game, (s) => s.priority === 'p2', 10);
    expect(cast(game, 'p2', findIn(game, 'p2', 'hand', counterspell.id), { targets: [{ kind: 'object', id: elf }] }).ok).toBe(true);
    settle(game);
    expect(game.state.objects[elf].zone).toBe('battlefield');
    untapAll(game, 'p1');
    expect(game.apply('p1', { type: 'activateAbility', objectId: sh, abilityIndex: 0 }).ok).toBe(true);
    settle(game);
    expect(effectivePower(game.state, game.state.objects[elf])).toBe(5);
    expect(effectiveToughness(game.state, game.state.objects[sh])).toBe(5);
  });

  it("Goryo's Vengeance: devolve lendária com ímpeto e a exila no fim do turno", () => {
    const game = makeGame([...FILLER, goryo, legend], FILLER, { topP1: [goryo.id, legend.id] });
    goToMain1(game);
    lands(game, 'p1', 'swamp', 'swamp');
    const lg = put(game, 'p1', legend.id, 'graveyard');
    expect(cast(game, 'p1', findIn(game, 'p1', 'hand', goryo.id), { targets: [{ kind: 'object', id: lg }] }).ok).toBe(true);
    settle(game);
    expect(game.state.objects[lg].zone).toBe('battlefield');
    expect(hasKeyword(game.state, game.state.objects[lg], 'haste')).toBe(true);
    passUntil(game, (s) => s.turn === 2 && s.step === 'upkeep', 300);
    expect(game.state.objects[lg].zone).toBe('exile');
  });

  it('Putrid Imp: com threshold fica 2/2 e não pode bloquear', () => {
    const game = makeGame([...FILLER, imp], FILLER, { topP1: [imp.id] });
    goToMain1(game);
    const i = put(game, 'p1', imp.id);
    expect(effectivePower(game.state, game.state.objects[i])).toBe(1);
    for (const l of ['mountain', 'mountain', 'mountain', 'mountain', 'mountain', 'plains', 'plains']) put(game, 'p1', l, 'graveyard');
    expect(effectivePower(game.state, game.state.objects[i])).toBe(2);
    expect(hasKeyword(game.state, game.state.objects[i], 'cantBlock')).toBe(true);
  });

  it('Arena of Glory: exaurir dá {R}{R}; a criatura conjurada com essa mana ganha ímpeto', () => {
    const game = makeGame([...FILLER, arena, grizzlyBears], FILLER, { topP1: [arena.id, 'grizzly-bears'] });
    goToMain1(game);
    const a = put(game, 'p1', arena.id); put(game, 'p1', 'mountain'); put(game, 'p1', 'forest');
    const idx = arena.abilities!.findIndex((ab) => ab.kind === 'activated' && ab.cost.exertSelf);
    expect(game.apply('p1', { type: 'activateAbility', objectId: a, abilityIndex: idx }).ok).toBe(true);
    expect(game.state.players.p1.manaPool.R).toBe(2);
    expect(game.state.objects[a].exertedUntilTurn).toBe(game.state.turn + 2);
    const bears = findIn(game, 'p1', 'hand', 'grizzly-bears');
    expect(cast(game, 'p1', bears).ok).toBe(true);
    settle(game);
    expect(hasKeyword(game.state, game.state.objects[bears], 'haste')).toBe(true);
  });

  it('Phyrexian Dragon Engine: o gatilho só dispara quando entra do cemitério', () => {
    const game = makeGame([...FILLER, engine], FILLER, { topP1: [engine.id] });
    goToMain1(game);
    lands(game, 'p1', 'mountain', 'mountain', 'mountain', 'mountain', 'mountain');
    const e = findIn(game, 'p1', 'hand', engine.id);
    expect(cast(game, 'p1', e).ok).toBe(true);
    settle(game);
    expect(game.state.pendingDecision).toBeNull(); // da mão: sem gatilho
    game.apply('p1', { type: 'manualMove', objectId: e, to: 'graveyard' });
    untapAll(game, 'p1');
    const unearth = engine.abilities!.findIndex((ab) => ab.kind === 'activated' && ab.zone === 'graveyard');
    expect(game.apply('p1', { type: 'activateAbility', objectId: e, abilityIndex: unearth }).ok).toBe(true);
    untilDecision(game);
    const pd = choice(game);
    expect(pd.mode).toBe('confirm'); // "you may discard your hand"
    const before = game.state.players.p1.zones.hand.length;
    answer(game, 'p1', [], 'yes');
    settle(game);
    expect(game.state.players.p1.zones.hand.length).toBe(3);
    expect(before).toBeGreaterThan(0);
  });

  it("Agatha's Soul Cauldron: exila criatura do cemitério com marcador reflexivo; criatura com marcador ganha a habilidade", () => {
    const game = makeGame([...FILLER, cauldron, grizzlyBears, pinger], FILLER, { topP1: [cauldron.id, 'grizzly-bears', pinger.id] });
    goToMain1(game);
    const c = put(game, 'p1', cauldron.id);
    const bears = put(game, 'p1', 'grizzly-bears');
    const py = put(game, 'p1', pinger.id, 'graveyard');
    expect(game.apply('p1', { type: 'activateAbility', objectId: c, abilityIndex: 0, targets: [{ kind: 'object', id: py }] }).ok).toBe(true);
    passUntil(game, (s) => s.pendingDecision?.type === 'chooseTargets', 50);
    expect(game.apply('p1', { type: 'chooseTargets', targets: [{ kind: 'object', id: bears }] }).ok).toBe(true);
    settle(game);
    expect(game.state.objects[py].zone).toBe('exile');
    expect(game.state.objects[bears].counters['+1/+1']).toBe(1);
    sba(game);
    const granted = game.state.objects[bears].card.abilities?.find((ab) => ab.kind === 'activated' && /Cauldron/.test(ab.text));
    expect(granted).toBeDefined();
    game.state.objects[bears].summoningSick = false;
    const gi = game.state.objects[bears].card.abilities!.indexOf(granted!);
    expect(game.apply('p1', { type: 'activateAbility', objectId: bears, abilityIndex: gi, targets: [{ kind: 'player', player: 'p2' }] }).ok).toBe(true);
    settle(game);
    expect(game.state.players.p2.life).toBe(19);
  });

  it('Boomerang Basics: compra só se a permanente devolvida era sua', () => {
    const game = makeGame([...FILLER, boomerang, boomerang, grizzlyBears], [...FILLER, grizzlyBears], { topP1: [boomerang.id, boomerang.id, 'grizzly-bears'], topP2: ['grizzly-bears'] });
    goToMain1(game);
    lands(game, 'p1', 'island', 'island');
    const mine = put(game, 'p1', 'grizzly-bears'); const theirs = put(game, 'p2', 'grizzly-bears');
    const h0 = game.state.players.p1.zones.hand.length;
    expect(cast(game, 'p1', findIn(game, 'p1', 'hand', boomerang.id), { targets: [{ kind: 'object', id: theirs }] }).ok).toBe(true);
    settle(game);
    expect(game.state.players.p1.zones.hand.length).toBe(h0 - 1);
    expect(cast(game, 'p1', findIn(game, 'p1', 'hand', boomerang.id), { targets: [{ kind: 'object', id: mine }] }).ok).toBe(true);
    settle(game);
    expect(game.state.players.p1.zones.hand.length).toBe(h0); // −2 conjuradas, +1 Bears de volta, +1 compra
    expect(game.state.objects[mine].zone).toBe('hand');
  });

  it('Prismari Charm: 1 de dano a um ou dois alvos', () => {
    const game = makeGame([...FILLER, charm], [...FILLER, grizzlyBears], { topP1: [charm.id], topP2: ['grizzly-bears'] });
    goToMain1(game);
    lands(game, 'p1', 'island', 'mountain');
    const bears = put(game, 'p2', 'grizzly-bears');
    expect(cast(game, 'p1', findIn(game, 'p1', 'hand', charm.id), { modes: [1], targets: [{ kind: 'object', id: bears }, { kind: 'player', player: 'p2' }] }).ok).toBe(true);
    settle(game);
    expect(game.state.objects[bears].damage).toBe(1);
    expect(game.state.players.p2.life).toBe(19);
  });

  it('It That Heralds the End: incolor de valor 7+ custa {1} a menos', () => {
    const game = makeGame([...FILLER, herald, bigColorless], FILLER, { topP1: [herald.id, bigColorless.id] });
    goToMain1(game);
    put(game, 'p1', herald.id);
    lands(game, 'p1', 'mountain', 'mountain', 'mountain', 'mountain', 'mountain', 'mountain');
    expect(cast(game, 'p1', findIn(game, 'p1', 'hand', bigColorless.id)).ok).toBe(true); // {7} com 6 terrenos
  });

  it('Mistrise Village: a próxima mágica do turno não pode ser anulada', () => {
    const game = makeGame([...FILLER, village, grizzlyBears], [...FILLER, counterspell], { topP1: [village.id, 'grizzly-bears'], topP2: [counterspell.id] });
    goToMain1(game);
    const v = put(game, 'p1', village.id); lands(game, 'p1', 'island', 'forest', 'forest');
    lands(game, 'p2', 'island', 'island');
    const idx = village.abilities!.findIndex((ab) => ab.kind === 'activated' && !ab.isManaAbility);
    expect(game.apply('p1', { type: 'activateAbility', objectId: v, abilityIndex: idx }).ok).toBe(true);
    settle(game);
    const bears = findIn(game, 'p1', 'hand', 'grizzly-bears');
    expect(cast(game, 'p1', bears).ok).toBe(true);
    passUntil(game, (s) => s.priority === 'p2', 10);
    expect(cast(game, 'p2', findIn(game, 'p2', 'hand', counterspell.id), { targets: [{ kind: 'object', id: bears }] }).ok).toBe(true);
    settle(game);
    expect(game.state.objects[bears].zone).toBe('battlefield');
  });

  it("Tibalt's Trickery: anula, mói ao acaso e o controlador pode conjurar de graça o que exilou", () => {
    const game = makeGame([...FILLER, trickery], [...FILLER, grizzlyBears, bigColorless], { topP1: [trickery.id], topP2: ['grizzly-bears', bigColorless.id] });
    goToMain1(game);
    lands(game, 'p1', 'mountain', 'mountain');
    toMain1(game, 2, 'p2');
    lands(game, 'p2', 'forest', 'forest');
    const big = findIn(game, 'p2', 'hand', bigColorless.id);
    game.apply('p2', { type: 'manualMove', objectId: big, to: 'library', position: 'bottom' });
    const bears = findIn(game, 'p2', 'hand', 'grizzly-bears');
    expect(cast(game, 'p2', bears).ok).toBe(true);
    passUntil(game, (s) => s.priority === 'p1', 10);
    expect(cast(game, 'p1', findIn(game, 'p1', 'hand', trickery.id), { targets: [{ kind: 'object', id: bears }] }).ok).toBe(true);
    untilDecision(game);
    const pd = choice(game);
    expect(pd.player).toBe('p2');
    expect(pd.mode).toBe('confirm');
    answer(game, 'p2', [], 'yes');
    settle(game);
    expect(game.state.objects[bears].zone).toBe('graveyard');
    expect(game.state.objects[big].zone).toBe('battlefield'); // único não-terreno na biblioteca do p2
  });

  it('Back to Basics: terrenos não básicos não desviram', () => {
    const game = makeGame([...FILLER, basics], [...FILLER, nonbasic], { topP1: [basics.id], topP2: [nonbasic.id] });
    goToMain1(game);
    put(game, 'p1', basics.id);
    const nb = put(game, 'p2', nonbasic.id); const f = put(game, 'p2', 'forest');
    game.state.objects[nb].tapped = true; game.state.objects[f].tapped = true;
    toMain1(game, 2, 'p2');
    expect(game.state.objects[nb].tapped).toBe(true);
    expect(game.state.objects[f].tapped).toBe(false);
  });

  it('Teferi: o oponente não conjura instantâneo no meu turno; +1 deixa eu conjurar feitiço com lampejo', () => {
    const game = makeGame([...FILLER, teferi, boomerang], [...FILLER, lightningBolt], { topP1: [teferi.id, boomerang.id], topP2: ['lightning-bolt'] });
    goToMain1(game);
    const t = put(game, 'p1', teferi.id); lands(game, 'p1', 'island');
    put(game, 'p2', 'mountain');
    const idx = teferi.abilities!.findIndex((ab) => ab.kind === 'loyalty' && ab.cost === 1);
    expect(game.apply('p1', { type: 'activateAbility', objectId: t, abilityIndex: idx }).ok).toBe(true);
    passUntil(game, (s) => s.priority === 'p2', 10);
    expect(cast(game, 'p2', findIn(game, 'p2', 'hand', 'lightning-bolt'), { targets: [{ kind: 'player', player: 'p1' }] }).ok).toBe(false); // Teferi
    settle(game);
    toMain1(game, 2, 'p2');
    put(game, 'p2', 'mountain');
    expect(cast(game, 'p2', findIn(game, 'p2', 'hand', 'lightning-bolt'), { targets: [{ kind: 'player', player: 'p1' }] }).ok).toBe(true); // no turno dele, fase principal
    passUntil(game, (s) => s.priority === 'p1', 10);
    const bm = findIn(game, 'p1', 'hand', boomerang.id);
    const target = game.state.players.p2.zones.battlefield[0];
    void target;
    expect(cast(game, 'p1', bm, { targets: [{ kind: 'object', id: t }] }).ok).toBe(true); // feitiço com lampejo no turno do oponente
  });

  it('Dress Down: criaturas perdem todas as habilidades; some no fim do turno', () => {
    const game = makeGame([...FILLER, dressDown], [...FILLER, flyer, pinger], { topP1: [dressDown.id], topP2: [flyer.id, pinger.id] });
    goToMain1(game);
    lands(game, 'p1', 'island', 'island');
    const fl = put(game, 'p2', flyer.id); const py = put(game, 'p2', pinger.id); game.state.objects[py].summoningSick = false;
    expect(hasKeyword(game.state, game.state.objects[fl], 'flying')).toBe(true);
    const dd = findIn(game, 'p1', 'hand', dressDown.id);
    expect(cast(game, 'p1', dd).ok).toBe(true);
    settle(game);
    expect(hasKeyword(game.state, game.state.objects[fl], 'flying')).toBe(false);
    passUntil(game, (s) => s.priority === 'p2', 10);
    expect(game.apply('p2', { type: 'activateAbility', objectId: py, abilityIndex: 0, targets: [{ kind: 'player', player: 'p1' }] }).ok).toBe(false);
    passUntil(game, (s) => s.turn === 2 && s.step === 'upkeep', 300);
    expect(game.state.objects[dd].zone).toBe('graveyard');
    expect(hasKeyword(game.state, game.state.objects[fl], 'flying')).toBe(true);
  });

  it('Witherbloom Command: mói três e devolve um terreno do cemitério; segundo modo drena 2', () => {
    const game = makeGame([...FILLER, wither], FILLER, { topP1: [wither.id] });
    goToMain1(game);
    lands(game, 'p1', 'swamp', 'forest');
    const land = put(game, 'p1', 'mountain', 'graveyard');
    expect(cast(game, 'p1', findIn(game, 'p1', 'hand', wither.id), { modes: [0, 3], targets: [{ kind: 'player', player: 'p2' }, { kind: 'player', player: 'p2' }] }).ok).toBe(true);
    untilDecision(game);
    const pd = choice(game);
    expect(pd.options).toContain(land);
    answer(game, 'p1', [land]);
    settle(game);
    expect(game.state.objects[land].zone).toBe('hand');
    expect(game.state.players.p2.zones.graveyard.length).toBe(3);
    expect(game.state.players.p2.life).toBe(18);
    expect(game.state.players.p1.life).toBe(22);
  });

  it("Brotherhood's End: 3 de dano a cada criatura e planeswalker", () => {
    const game = makeGame([...FILLER, brotherhood, grizzlyBears], [...FILLER, teferi], { topP1: [brotherhood.id, 'grizzly-bears'], topP2: [teferi.id] });
    goToMain1(game);
    lands(game, 'p1', 'mountain', 'mountain', 'mountain');
    const bears = put(game, 'p1', 'grizzly-bears'); const t = put(game, 'p2', teferi.id);
    expect(cast(game, 'p1', findIn(game, 'p1', 'hand', brotherhood.id), { modes: [0] }).ok).toBe(true);
    settle(game);
    expect(game.state.objects[bears].zone).toBe('graveyard');
    expect(game.state.objects[t].zone).toBe('battlefield');
    expect(game.state.objects[t].counters['loyalty']).toBe(1); // 4 − 3
  });

  it('Cling to Dust: criatura → 3 de vida; outra carta → compra', () => {
    const game = makeGame([...FILLER, cling, cling], [...FILLER, grizzlyBears, lightningBolt], { topP1: [cling.id, cling.id], topP2: ['grizzly-bears', 'lightning-bolt'] });
    goToMain1(game);
    lands(game, 'p1', 'swamp', 'swamp');
    const bears = put(game, 'p2', 'grizzly-bears', 'graveyard'); const bolt = put(game, 'p2', 'lightning-bolt', 'graveyard');
    expect(cast(game, 'p1', findIn(game, 'p1', 'hand', cling.id), { targets: [{ kind: 'object', id: bears }] }).ok).toBe(true);
    settle(game);
    expect(game.state.players.p1.life).toBe(23);
    const h = game.state.players.p1.zones.hand.length;
    expect(cast(game, 'p1', findIn(game, 'p1', 'hand', cling.id), { targets: [{ kind: 'object', id: bolt }] }).ok).toBe(true);
    settle(game);
    expect(game.state.players.p1.zones.hand.length).toBe(h); // −1 conjurada +1 compra
    expect(game.state.objects[bolt].zone).toBe('exile');
  });

  it('Breakthrough X=1: compra quatro, fica com uma', () => {
    const game = makeGame([...FILLER, breakthrough], FILLER, { topP1: [breakthrough.id] });
    goToMain1(game);
    lands(game, 'p1', 'island', 'island');
    expect(cast(game, 'p1', findIn(game, 'p1', 'hand', breakthrough.id), { x: 1 }).ok).toBe(true);
    untilDecision(game);
    const pd = choice(game);
    expect(pd.min).toBe(1);
    answer(game, 'p1', [pd.options[0]]);
    settle(game);
    expect(game.state.players.p1.zones.hand.length).toBe(1);
  });

  it('Snapcaster Mage: instantâneo no cemitério ganha flashback pelo custo de mana até o fim do turno', () => {
    const game = makeGame([...FILLER, snapcaster, lightningBolt], FILLER, { topP1: [snapcaster.id, 'lightning-bolt'] });
    goToMain1(game);
    lands(game, 'p1', 'island', 'island', 'mountain');
    const bolt = put(game, 'p1', 'lightning-bolt', 'graveyard');
    expect(cast(game, 'p1', findIn(game, 'p1', 'hand', snapcaster.id)).ok).toBe(true);
    passUntil(game, (s) => s.pendingDecision?.type === 'chooseTargets', 50);
    expect(game.apply('p1', { type: 'chooseTargets', targets: [{ kind: 'object', id: bolt }] }).ok).toBe(true);
    settle(game);
    expect(cast(game, 'p1', bolt, { targets: [{ kind: 'player', player: 'p2' }] }).ok).toBe(true);
    settle(game);
    expect(game.state.players.p2.life).toBe(17);
    expect(game.state.objects[bolt].zone).toBe('exile');
  });

  it('Sheoldred: eu ganho 2 ao comprar; o oponente perde 2 ao comprar', () => {
    const game = makeGame([...FILLER, sheoldred], FILLER, { topP1: [sheoldred.id] });
    goToMain1(game);
    put(game, 'p1', sheoldred.id);
    passUntil(game, (s) => s.turn === 2 && s.step === 'main1' && s.priority === 'p2', 400);
    expect(game.state.players.p2.life).toBe(18);
    passUntil(game, (s) => s.turn === 3 && s.step === 'main1' && s.priority === 'p1', 400);
    expect(game.state.players.p1.life).toBe(22);
  });
});
