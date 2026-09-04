/** M28 (Leva 6a, Legacy parte 6): Gaea's Will, Mindbreak Trap, Prismatic Ending, Emrakul, Fable of the Mirror-Breaker, Wight of the Reliquary, Phlage, Lazotep Quarry, Red Elemental Blast, Sewer-veillance Cam, Broadside Bombardiers. */
import { describe, expect, it } from 'vitest';
import { compileOracleCard, type OracleInput } from '../src/cards/oracle-parser.js';
import { forest, grizzlyBears, island, lightningBolt, mountain, plains, swamp } from '../src/cards/demo-set.js';
import type { CardDefinition } from '../src/cards/types.js';
import type { Game } from '../src/game.js';
import type { PlayerId } from '../src/types.js';
import { effectivePower, hasKeyword } from '../src/state.js';
import { findIn, goToMain1, makeGame, passUntil } from './helpers.js';

const mk = (input: OracleInput): CardDefinition => {
  const def = compileOracleCard(input);
  if (!def) throw new Error(`não compilou: ${input.name}`);
  return def;
};
const copies = (card: CardDefinition, n: number) => Array.from({ length: n }, () => card);
function put(game: Game, player: PlayerId, cardId: string, zone: 'battlefield' | 'graveyard' | 'hand' = 'battlefield'): number {
  let id: number;
  try { id = findIn(game, player, 'library', cardId); } catch { id = findIn(game, player, 'hand', cardId); }
  const r = game.apply(player, { type: 'manualMove', objectId: id, to: zone });
  if (!r.ok) throw new Error(`setup falhou: ${cardId} → ${zone}`);
  return id;
}
const FILLER = [...copies(mountain, 6), ...copies(forest, 6), ...copies(island, 6), ...copies(plains, 6), ...copies(swamp, 4)];
const settle = (game: Game) => passUntil(game, (s) => s.stack.length === 0 && s.triggerQueue.length === 0 && s.pendingDecision === null);
const cast = (game: Game, p: PlayerId, id: number, extra: Record<string, unknown> = {}) => game.apply(p, { type: 'castSpell', objectId: id, ...extra } as never);
const untilChoice = (game: Game) => passUntil(game, (s) => s.pendingDecision?.type === 'effectChoice' || (s.stack.length === 0 && s.triggerQueue.length === 0 && s.pendingDecision === null));
const untilDecision = (game: Game) => passUntil(game, (s) => s.pendingDecision !== null || (s.stack.length === 0 && s.triggerQueue.length === 0), 200);
const answer = (game: Game, p: PlayerId, picks: number[], text?: string) => game.apply(p, { type: 'effectChoice', picks, text });
const tokens = (game: Game, p: PlayerId) => game.state.players[p].zones.battlefield.map((id) => game.state.objects[id]).filter((o) => o.isToken);
const untapAll = (game: Game, p: PlayerId) => { for (const id of game.state.players[p].zones.battlefield) game.state.objects[id].tapped = false; };

const will = mk({ name: "Gaea's Will", typeLine: 'Sorcery', colors: ['G'], oracleText: "Suspend 4—{G}\nUntil end of turn, you may play lands and cast spells from your graveyard.\nIf a card would be put into your graveyard from anywhere this turn, exile that card instead." });
const trap = mk({ name: 'Mindbreak Trap', manaCost: '{2}{U}{U}', typeLine: 'Instant — Trap', colors: ['U'], oracleText: "If an opponent cast three or more spells this turn, you may pay {0} rather than pay this spell's mana cost.\nExile any number of target spells." });
const ending = mk({ name: 'Prismatic Ending', manaCost: '{X}{W}', typeLine: 'Sorcery', colors: ['W'], oracleText: 'Converge — Exile target nonland permanent if its mana value is less than or equal to the number of colors of mana spent to cast this spell.' });
const emrakul = mk({ name: 'Emrakul, the Aeons Torn', manaCost: '{15}', typeLine: 'Legendary Creature — Eldrazi', power: 15, toughness: 15, colors: [], oracleText: "This spell can't be countered.\nWhen you cast this spell, take an extra turn after this one.\nFlying, protection from spells that are one or more colors, annihilator 6\nWhen Emrakul is put into a graveyard from anywhere, its owner shuffles their graveyard into their library." });
const fable = mk({ name: 'Fable of the Mirror-Breaker', manaCost: '{2}{R}', typeLine: 'Enchantment — Saga', colors: ['R'], layout: 'transform', oracleText: '(As this Saga enters and after your draw step, add a lore counter.)\nI — Create a 2/2 red Goblin Shaman creature token with "Whenever this token attacks, create a Treasure token."\nII — You may discard up to two cards. If you do, draw that many cards.\nIII — Exile this Saga, then return it to the battlefield transformed under your control.', backFace: { name: 'Reflection of Kiki-Jiki', typeLine: 'Enchantment Creature — Goblin Shaman', power: 2, toughness: 2, colors: ['R'], oracleText: "{1}, {T}: Create a token that's a copy of another target nonlegendary creature you control, except it has haste. Sacrifice it at the beginning of the next end step." } });
const wight = mk({ name: 'Wight of the Reliquary', manaCost: '{B}{G}', typeLine: 'Creature — Zombie Knight', power: 2, toughness: 2, colors: ['B', 'G'], oracleText: 'Vigilance\nThis creature gets +1/+1 for each creature card in your graveyard.\n{T}, Sacrifice another creature: Search your library for a land card, put it onto the battlefield tapped, then shuffle.' });
const phlage = mk({ name: "Phlage, Titan of Fire's Fury", manaCost: '{1}{R}{W}', typeLine: 'Legendary Creature — Elder Giant', power: 6, toughness: 6, colors: ['R', 'W'], oracleText: 'When Phlage enters, sacrifice it unless it escaped.\nWhenever Phlage enters or attacks, it deals 3 damage to any target and you gain 3 life.\nEscape—{R}{R}{W}{W}, Exile five other cards from your graveyard. (You may cast this card from your graveyard for its escape cost.)' });
const quarry = mk({ name: 'Lazotep Quarry', typeLine: 'Land — Desert', oracleText: "{T}: Add {C}.\n{T}, Sacrifice a creature: Add one mana of any color.\n{X}{2}, {T}, Sacrifice a Desert: Exile target creature card with mana value X from your graveyard. Create a token that's a copy of it, except it's a 4/4 black Zombie. Activate only as a sorcery." });
const reb = mk({ name: 'Red Elemental Blast', manaCost: '{R}', typeLine: 'Instant', colors: ['R'], oracleText: 'Choose one —\n• Counter target blue spell.\n• Destroy target blue permanent.' });
const cam = mk({ name: 'Sewer-veillance Cam', manaCost: '{U}', typeLine: 'Artifact', colors: ['U'], oracleText: 'Flash\nWhen this artifact enters or leaves the battlefield, you may tap or untap target creature.\n{3}{U}, Sacrifice this artifact: Draw two cards.' });
const bombardiers = mk({ name: 'Broadside Bombardiers', manaCost: '{2}{R}', typeLine: 'Creature — Goblin Pirate', power: 2, toughness: 2, colors: ['R'], oracleText: "Menace, haste\nBoast — Sacrifice another creature or artifact: This creature deals damage equal to 2 plus the sacrificed permanent's mana value to any target. (Activate only if this creature attacked this turn and only once each turn.)" });
const idol = mk({ name: 'Bear Idol', manaCost: '{2}', typeLine: 'Artifact', colors: [], oracleText: '{T}: Add {C}.' });
const desert = mk({ name: 'Desert of the Glorified', typeLine: 'Land — Desert', oracleText: '{T}: Add {B}.' });
const blueBear = mk({ name: 'Blue Bear', manaCost: '{1}{U}', typeLine: 'Creature — Bear', power: 2, toughness: 2, colors: ['U'], oracleText: '' });
const blueBolt = mk({ name: 'Blue Bolt', manaCost: '{U}', typeLine: 'Instant', colors: ['U'], oracleText: 'Blue Bolt deals 3 damage to any target.' });

const ALL = [will, trap, ending, emrakul, fable, wight, phlage, quarry, reb, cam, bombardiers];

describe('M28 · compilação', () => {
  it('as 11 cartas compilam como full', () => {
    for (const c of ALL) expect(c.automation, `${c.name}: ${c.automationNotes?.join(' | ')}`).toBe('full');
    expect(fable.backFace?.automation, fable.backFace?.automationNotes?.join(' | ')).toBe('full');
    expect(will.suspend).toEqual({ count: 4, cost: '{G}' });
    expect(will.spellEffect).toEqual([{ op: 'graveyardPlayThisTurn' }, { op: 'exileInsteadOfGraveyardThisTurn' }]);
    expect(trap.altCost).toMatchObject({ free: true, condition: { kind: 'opponentCastSpellsAtLeast', count: 3 } });
    expect(trap.spellTargets?.length).toBe(6);
    expect(ending.spellEffect).toEqual([{ op: 'if', cond: { kind: 'targetCmcAtMostColorsSpent' }, then: [{ op: 'exile', what: 'target:0' }] }]);
    expect(emrakul.protectionFromColored).toBe(true);
    expect(emrakul.annihilator).toBe(6);
    expect(emrakul.abilities?.[1]).toMatchObject({ trigger: { on: 'toGraveyardFromAnywhere', self: true }, effect: [{ op: 'shuffleGraveyardIntoLibrary', who: 'controller' }] });
    expect(fable.abilities?.[1].effect).toEqual([{ op: 'discardUpToThenDraw', max: 2 }]);
    expect(fable.backFace?.abilities?.[0]).toMatchObject({ targets: [{ what: 'creature', controlledBy: 'you', nonlegendary: true, other: true }], effect: [{ op: 'tokenCopy', what: 'target:0', keywords: ['haste'], sacrificeAtEnd: true }] });
    expect(wight.abilities?.[0]).toMatchObject({ kind: 'static', powerPerGraveyard: { what: 'creature' }, toughnessPerGraveyard: { what: 'creature' } });
    expect(phlage.abilities?.[0].effect).toEqual([{ op: 'if', cond: { kind: 'escaped' }, then: [], else: [{ op: 'sacrificeSelf' }] }]);
    expect(quarry.abilities?.[2]).toMatchObject({ cost: { mana: '{X}{2}', tap: true, sacrifice: { subtype: 'Desert' } }, targets: [{ what: 'creature', zone: 'graveyard', cmcEqualsX: true }], effect: [{ op: 'tokenCopy', power: 4, toughness: 4, colors: ['B'], replaceSubtypes: ['Zombie'] }, { op: 'exile', what: 'target:0' }], sorceryOnly: true });
    expect(reb.spellModes?.map((m) => m.targets)).toEqual([[{ what: 'spell', color: 'U' }], [{ what: 'permanent', color: 'U' }]]);
    expect(cam.abilities?.map((a) => a.kind === 'triggered' && a.trigger.on)).toEqual(['etb', 'leaves', false]);
    expect(bombardiers.abilities?.[0]).toMatchObject({ maxPerTurn: 1, condition: { cond: { kind: 'sourceAttackedThisTurn' } }, effect: [{ op: 'damage', amount: { sacrificedManaValuePlus: 2 } }] });
  });
});

describe('M28 · jogo', () => {
  it("Gaea's Will: joga terreno e conjura do cemitério; o que iria para o cemitério é exilado", () => {
    const game = makeGame([...FILLER, will, lightningBolt], FILLER, { topP1: [will.id, 'lightning-bolt'] });
    goToMain1(game);
    const w = findIn(game, 'p1', 'hand', will.id);
    const bolt = put(game, 'p1', 'lightning-bolt', 'graveyard');
    const gyLand = put(game, 'p1', 'mountain', 'graveyard');
    put(game, 'p1', 'forest'); put(game, 'p1', 'mountain');
    // Sem custo de mana, não é conjurável da mão; suspende por {G}. Com um marcador só, sai na próxima manutenção do p1 (turno 3).
    expect(cast(game, 'p1', w).ok).toBe(false);
    expect(cast(game, 'p1', w, { method: 'suspend' }).ok).toBe(true);
    expect(game.state.objects[w].zone).toBe('exile');
    game.state.objects[w].counters['time'] = 1;
    passUntil(game, (s) => s.turn === 3 && s.step === 'main1' && s.priority === 'p1' && s.stack.length === 0 && s.pendingDecision === null, 400);
    expect(game.state.objects[w].zone).toBe('exile'); // a própria Gaea's Will iria para o cemitério: exilada
    expect(game.apply('p1', { type: 'playLand', objectId: gyLand }).ok).toBe(true);
    expect(game.state.objects[gyLand].zone).toBe('battlefield');
    untapAll(game, 'p1');
    expect(cast(game, 'p1', bolt, { targets: [{ kind: 'player', player: 'p2' }] }).ok).toBe(true);
    settle(game);
    expect(game.state.players.p2.life).toBe(17);
    expect(game.state.objects[bolt].zone).toBe('exile'); // iria para o cemitério: exilada
  });

  it('Mindbreak Trap: de graça se o oponente conjurou 3+ mágicas; exila as mágicas-alvo', () => {
    const game = makeGame([...FILLER, trap], [...FILLER, lightningBolt, lightningBolt, lightningBolt, grizzlyBears], { topP1: [trap.id], topP2: ['lightning-bolt', 'lightning-bolt', 'lightning-bolt', 'grizzly-bears'] });
    goToMain1(game);
    const t = findIn(game, 'p1', 'hand', trap.id);
    expect(cast(game, 'p1', t, { useAltCost: true }).ok).toBe(false); // ainda não vale
    passUntil(game, (s) => s.turn === 2 && s.step === 'main1' && s.priority === 'p2' && s.stack.length === 0);
    for (let i = 0; i < 4; i++) put(game, 'p2', 'mountain');
    put(game, 'p2', 'forest');
    for (let i = 0; i < 3; i++) {
      expect(cast(game, 'p2', findIn(game, 'p2', 'hand', 'lightning-bolt'), { targets: [{ kind: 'player', player: 'p1' }] }).ok).toBe(true);
      settle(game);
    }
    expect(game.state.players.p1.life).toBe(11);
    const bears = findIn(game, 'p2', 'hand', 'grizzly-bears');
    expect(cast(game, 'p2', bears).ok).toBe(true);
    game.apply('p2', { type: 'passPriority' });
    expect(cast(game, 'p1', t, { useAltCost: true, targets: [{ kind: 'object', id: bears }] }).ok).toBe(true);
    settle(game);
    expect(game.state.objects[bears].zone).toBe('exile');
  });

  it('Prismatic Ending: exila se o valor de mana couber nas cores gastas', () => {
    const game = makeGame([...FILLER, ending, ending], [...FILLER, grizzlyBears, blueBear], { topP1: [ending.id, ending.id], topP2: ['grizzly-bears', blueBear.id] });
    goToMain1(game);
    const bears = put(game, 'p2', 'grizzly-bears');
    put(game, 'p1', 'plains'); put(game, 'p1', 'island'); put(game, 'p1', 'plains');
    // X=1 pago com Plains + Plains: uma cor só → valor 2 não cabe.
    const e1 = findIn(game, 'p1', 'hand', ending.id);
    for (const id of game.state.players.p1.zones.battlefield) if (game.state.objects[id].card.name === 'Island') game.state.objects[id].tapped = true;
    expect(cast(game, 'p1', e1, { x: 1, targets: [{ kind: 'object', id: bears }] }).ok).toBe(true);
    settle(game);
    expect(game.state.objects[bears].zone).toBe('battlefield');
    // X=1 pago com Plains + Island: duas cores → valor 2 cabe.
    untapAll(game, 'p1');
    for (const id of game.state.players.p1.zones.battlefield) if (game.state.objects[id].card.name === 'Plains' && !game.state.objects[id].tapped) { game.state.objects[id].tapped = true; break; }
    const e2 = findIn(game, 'p1', 'hand', ending.id);
    expect(cast(game, 'p1', e2, { x: 1, targets: [{ kind: 'object', id: bears }] }).ok).toBe(true);
    settle(game);
    expect(game.state.objects[bears].zone).toBe('exile');
  });

  it('Emrakul: proteção contra mágicas coloridas e embaralha o cemitério ao ir para lá', () => {
    const game = makeGame([...FILLER, emrakul], [...FILLER, lightningBolt], { topP1: [emrakul.id], topP2: ['lightning-bolt'] });
    goToMain1(game);
    const e = put(game, 'p1', emrakul.id);
    put(game, 'p1', 'mountain', 'graveyard'); put(game, 'p1', 'forest', 'graveyard');
    passUntil(game, (s) => s.turn === 2 && s.step === 'main1' && s.priority === 'p2' && s.stack.length === 0);
    put(game, 'p2', 'mountain');
    expect(cast(game, 'p2', findIn(game, 'p2', 'hand', 'lightning-bolt'), { targets: [{ kind: 'object', id: e }] }).ok).toBe(false);
    const gyBefore = game.state.players.p1.zones.graveyard.length;
    expect(gyBefore).toBe(2);
    game.apply('p1', { type: 'manualMove', objectId: e, to: 'graveyard' });
    // manualMove não dispara gatilhos: usa o caminho real destruindo com um efeito.
    game.apply('p1', { type: 'manualMove', objectId: e, to: 'battlefield' });
    const kill = mk({ name: 'Bear Doom', manaCost: '{B}', typeLine: 'Instant', colors: [], oracleText: 'Destroy target creature.' });
    void kill;
    game.state.players.p1.zones.graveyard.length;
    // Destruição direta via SBA: dano letal sem cor (fonte incolor não é barrada pela proteção).
    game.state.objects[e].damage = 15;
    game.apply(game.state.priority!, { type: 'passPriority' });
    settle(game);
    expect(game.state.objects[e].zone).toBe('library');
    expect(game.state.players.p1.zones.graveyard.length).toBe(0);
  });

  it('Fable: II descarta até dois e compra; verso copia criatura com ímpeto e sacrifica no fim do turno', () => {
    const game = makeGame([...FILLER, fable, grizzlyBears], FILLER, { topP1: [fable.id, 'grizzly-bears'] });
    goToMain1(game);
    const f = put(game, 'p1', fable.id);
    game.state.objects[f].counters['lore'] = 1;
    const bears = put(game, 'p1', 'grizzly-bears');
    put(game, 'p1', 'mountain'); put(game, 'p1', 'mountain');
    // Capítulo II no passo de compra do turno 3.
    passUntil(game, (s) => s.turn === 3 && s.pendingDecision?.type === 'effectChoice', 400);
    const pd = game.state.pendingDecision;
    expect(pd?.type).toBe('effectChoice');
    if (pd?.type !== 'effectChoice') return;
    const hand = game.state.players.p1.zones.hand.length;
    answer(game, 'p1', pd.options.slice(0, 2));
    settle(game);
    expect(game.state.players.p1.zones.hand.length).toBe(hand); // -2 +2
    // Capítulo III: transforma.
    passUntil(game, (s) => s.turn === 5 && s.step === 'main1' && s.priority === 'p1' && s.stack.length === 0 && s.pendingDecision === null, 600);
    expect(game.state.objects[f].card.name).toBe('Reflection of Kiki-Jiki');
    game.state.objects[f].summoningSick = false;
    untapAll(game, 'p1');
    expect(game.apply('p1', { type: 'activateAbility', objectId: f, abilityIndex: 0, targets: [{ kind: 'object', id: bears }] }).ok).toBe(true);
    settle(game);
    const copy = tokens(game, 'p1').find((o) => o.card.name === 'Grizzly Bears')!;
    expect(copy).toBeDefined();
    expect(hasKeyword(game.state, copy, 'haste')).toBe(true);
    passUntil(game, (s) => s.turn === 6 && s.step === 'upkeep', 200);
    expect(game.state.objects[copy.id]).toBeUndefined();
  });

  it('Wight of the Reliquary cresce com criaturas no cemitério', () => {
    const game = makeGame([...FILLER, wight, grizzlyBears, grizzlyBears], FILLER, { topP1: [wight.id, 'grizzly-bears', 'grizzly-bears'] });
    goToMain1(game);
    const w = put(game, 'p1', wight.id);
    expect(effectivePower(game.state, game.state.objects[w])).toBe(2);
    put(game, 'p1', 'grizzly-bears', 'graveyard'); put(game, 'p1', 'grizzly-bears', 'graveyard'); put(game, 'p1', 'mountain', 'graveyard');
    expect(effectivePower(game.state, game.state.objects[w])).toBe(4);
  });

  it('Phlage: conjurada normalmente entra, causa 3 e é sacrificada; com escape fica', () => {
    const game = makeGame([...FILLER, phlage, lightningBolt], FILLER, { topP1: [phlage.id, 'lightning-bolt'] });
    goToMain1(game);
    const p = findIn(game, 'p1', 'hand', phlage.id);
    put(game, 'p1', 'mountain'); put(game, 'p1', 'plains'); put(game, 'p1', 'plains');
    const r1 = cast(game, 'p1', p);
    expect(r1.ok, JSON.stringify(r1.events)).toBe(true);
    passUntil(game, (s) => s.pendingDecision?.type === 'chooseTargets' || (s.stack.length === 0 && s.triggerQueue.length === 0 && s.pendingDecision === null), 200);
    if (game.state.pendingDecision?.type === 'chooseTargets') game.apply('p1', { type: 'chooseTargets', targets: [{ kind: 'player', player: 'p2' }] });
    settle(game);
    expect(game.state.objects[p].zone).toBe('graveyard');
    expect(game.state.players.p2.life).toBe(17);
    // Escape: 5 outras cartas no cemitério + {R}{R}{W}{W}.
    const fodder: number[] = [];
    for (let i = 0; i < 5; i++) fodder.push(put(game, 'p1', i < 3 ? 'island' : 'swamp', 'graveyard'));
    put(game, 'p1', 'mountain'); put(game, 'p1', 'plains');
    untapAll(game, 'p1');
    const r2 = cast(game, 'p1', p, { method: 'escape', escapeExile: fodder });
    expect(r2.ok, JSON.stringify(r2.events)).toBe(true);
    passUntil(game, (s) => s.pendingDecision?.type === 'chooseTargets' || (s.stack.length === 0 && s.triggerQueue.length === 0 && s.pendingDecision === null), 200);
    if (game.state.pendingDecision?.type === 'chooseTargets') game.apply('p1', { type: 'chooseTargets', targets: [{ kind: 'player', player: 'p2' }] });
    settle(game);
    expect(game.state.objects[p].zone).toBe('battlefield');
    expect(game.state.players.p2.life).toBe(14);
  });

  it('Lazotep Quarry: X, sacrifica um Deserto, exila a criatura do cemitério e cria a cópia 4/4 Zumbi preta', () => {
    const game = makeGame([...FILLER, quarry, desert, grizzlyBears], FILLER, { topP1: [quarry.id, desert.id, 'grizzly-bears'] });
    goToMain1(game);
    const q = put(game, 'p1', quarry.id);
    const d = put(game, 'p1', desert.id);
    const bears = put(game, 'p1', 'grizzly-bears', 'graveyard');
    for (let i = 0; i < 4; i++) put(game, 'p1', 'forest');
    expect(game.apply('p1', { type: 'activateAbility', objectId: q, abilityIndex: 2, x: 2, sacrifices: [d], targets: [{ kind: 'object', id: bears }] }).ok).toBe(true);
    settle(game);
    expect(game.state.objects[d].zone).toBe('graveyard');
    expect(game.state.objects[bears].zone).toBe('exile');
    const z = tokens(game, 'p1')[0];
    expect(z?.card.name).toBe('Grizzly Bears');
    expect(z.card.power).toBe(4);
    expect(z.card.colors).toEqual(['B']);
    expect(z.card.subtypes).toEqual(['Zombie']);
  });

  it('Red Elemental Blast: anula mágica azul; não mira permanente vermelha', () => {
    const game = makeGame([...FILLER, reb, reb], [...FILLER, blueBear, grizzlyBears], { topP1: [reb.id, reb.id], topP2: [blueBear.id, 'grizzly-bears'] });
    goToMain1(game);
    put(game, 'p1', 'mountain'); put(game, 'p1', 'mountain');
    const bearsRed = put(game, 'p2', 'grizzly-bears');
    expect(cast(game, 'p1', findIn(game, 'p1', 'hand', reb.id), { mode: 1, targets: [{ kind: 'object', id: bearsRed }] }).ok).toBe(false);
    passUntil(game, (s) => s.turn === 2 && s.step === 'main1' && s.priority === 'p2' && s.stack.length === 0);
    put(game, 'p2', 'island'); put(game, 'p2', 'island');
    const bb = findIn(game, 'p2', 'hand', blueBear.id);
    expect(cast(game, 'p2', bb).ok).toBe(true);
    game.apply('p2', { type: 'passPriority' });
    expect(cast(game, 'p1', findIn(game, 'p1', 'hand', reb.id), { mode: 0, targets: [{ kind: 'object', id: bb }] }).ok).toBe(true);
    settle(game);
    expect(game.state.objects[bb].zone).toBe('graveyard');
  });

  it('Sewer-veillance Cam: ao entrar pode virar/desvirar criatura-alvo; sacrifício compra duas', () => {
    const game = makeGame([...FILLER, cam], [...FILLER, grizzlyBears], { topP1: [cam.id], topP2: ['grizzly-bears'] });
    goToMain1(game);
    const bears = put(game, 'p2', 'grizzly-bears');
    for (let i = 0; i < 5; i++) put(game, 'p1', 'island');
    const c = findIn(game, 'p1', 'hand', cam.id);
    expect(cast(game, 'p1', c).ok).toBe(true);
    untilDecision(game);
    if (game.state.pendingDecision?.type === 'chooseTargets') game.apply('p1', { type: 'chooseTargets', targets: [{ kind: 'object', id: bears }] });
    untilChoice(game);
    expect(game.state.pendingDecision?.type).toBe('effectChoice');
    answer(game, 'p1', [], 'yes');
    settle(game);
    expect(game.state.objects[bears].tapped).toBe(true);
    const hand = game.state.players.p1.zones.hand.length;
    expect(game.apply('p1', { type: 'activateAbility', objectId: c, abilityIndex: 2 }).ok).toBe(true);
    untilDecision(game);
    if (game.state.pendingDecision?.type === 'chooseTargets') game.apply('p1', { type: 'chooseTargets', targets: [{ kind: 'object', id: bears }] });
    untilChoice(game);
    if (game.state.pendingDecision?.type === 'effectChoice') answer(game, 'p1', [], 'no');
    settle(game);
    expect(game.state.players.p1.zones.hand.length).toBe(hand + 2);
  });

  it('Broadside Bombardiers: só depois de atacar; dano = 2 + valor de mana do sacrificado', () => {
    const game = makeGame([...FILLER, bombardiers, idol], FILLER, { topP1: [bombardiers.id, idol.id] });
    goToMain1(game);
    const b = put(game, 'p1', bombardiers.id);
    const art = put(game, 'p1', idol.id);
    expect(game.apply('p1', { type: 'activateAbility', objectId: b, abilityIndex: 0, sacrifices: [art], targets: [{ kind: 'player', player: 'p2' }] }).ok).toBe(false);
    game.apply('p1', { type: 'passPriority' });
    passUntil(game, (s) => s.combatAwaiting === 'attackers');
    expect(game.apply('p1', { type: 'declareAttackers', attackers: [b] }).ok).toBe(true);
    passUntil(game, (s) => s.combatAwaiting === 'blockers' || s.pendingDecision !== null, 200);
    expect(game.apply('p2', { type: 'declareBlockers', blocks: [] }).ok).toBe(true);
    passUntil(game, (s) => s.priority === 'p1' && s.pendingDecision === null, 50);
    expect(game.apply('p1', { type: 'activateAbility', objectId: b, abilityIndex: 0, sacrifices: [art], targets: [{ kind: 'player', player: 'p2' }] }).ok).toBe(true);
    settle(game);
    expect(game.state.players.p2.life).toBe(16); // 2 + 2
  });
});
