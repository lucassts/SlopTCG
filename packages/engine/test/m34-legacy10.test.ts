/** M34 (Legacy parte 9): Hexing Squelcher, Goblin Welder, Goblin Engineer, Thundertrap Trainer, Magus of the Moon, Pinnacle Emissary, Eye of Ugin, Eldrazi Linebreaker, Thought-Knot Seer, Fury, Price of Progress, Portent of Calamity, Triumph of Saint Katherine, Seasoned Dungeoneer, Sundering Eruption, Grafdigger's Cage, Narcomoeba, Dread Return. */
import { describe, expect, it } from 'vitest';
import { compileOracleCard, type OracleInput } from '../src/cards/oracle-parser.js';
import { forest, grizzlyBears, island, lightningBolt, mountain, plains, swamp } from '../src/cards/demo-set.js';
import type { CardDefinition } from '../src/cards/types.js';
import type { Game } from '../src/game.js';
import type { PlayerId } from '../src/types.js';
import { hasKeyword } from '../src/state.js';
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
const lands = (game: Game, p: PlayerId, ...ids: string[]) => { for (const id of ids) put(game, p, id); };

const squelcher = mk({ name: 'Hexing Squelcher', manaCost: '{1}{R}', typeLine: 'Creature — Goblin Sorcerer', power: 2, toughness: 2, colors: ['R'], oracleText: 'This spell can\'t be countered.\nWard—Pay 2 life.\nSpells you control can\'t be countered.\nOther creatures you control have "Ward—Pay 2 life."' });
const welder = mk({ name: 'Goblin Welder', manaCost: '{R}', typeLine: 'Creature — Goblin Artificer', power: 1, toughness: 1, colors: ['R'], oracleText: "{T}: Choose target artifact a player controls and target artifact card in that player's graveyard. If both targets are still legal as this ability resolves, that player simultaneously sacrifices the artifact and returns the artifact card to the battlefield." });
const engineer = mk({ name: 'Goblin Engineer', manaCost: '{1}{R}', typeLine: 'Creature — Goblin Artificer', power: 1, toughness: 2, colors: ['R'], oracleText: 'When this creature enters, you may search your library for an artifact card, put it into your graveyard, then shuffle.\n{R}, {T}, Sacrifice an artifact: Return target artifact card with mana value 3 or less from your graveyard to the battlefield.' });
const trainer = mk({ name: 'Thundertrap Trainer', manaCost: '{1}{U}', typeLine: 'Creature — Otter Wizard', power: 1, toughness: 3, colors: ['U'], oracleText: 'Offspring {4}\nWhen this creature enters, look at the top four cards of your library. You may reveal a noncreature, nonland card from among them and put it into your hand. Put the rest on the bottom of your library in a random order.' });
const magus = mk({ name: 'Magus of the Moon', manaCost: '{2}{R}', typeLine: 'Creature — Human Wizard', power: 2, toughness: 2, colors: ['R'], oracleText: 'Nonbasic lands are Mountains.' });
const pinnacle = mk({ name: 'Pinnacle Emissary', manaCost: '{1}{U}{R}', typeLine: 'Artifact Creature — Robot', power: 2, toughness: 3, colors: ['U', 'R'], oracleText: 'Whenever you cast an artifact spell, create a 1/1 colorless Drone artifact creature token with flying and "This token can block only creatures with flying."\nWarp {U/R}' });
const eye = mk({ name: 'Eye of Ugin', typeLine: 'Legendary Land', colors: [], oracleText: 'Colorless Eldrazi spells you cast cost {2} less to cast.\n{7}, {T}: Search your library for a colorless creature card, reveal it, put it into your hand, then shuffle.' });
const linebreaker = mk({ name: 'Eldrazi Linebreaker', manaCost: '{1}{C}{R}', typeLine: 'Creature — Eldrazi', power: 3, toughness: 2, colors: [], oracleText: 'Devoid\nTrample\nAt the beginning of combat on your turn, target creature you control gains haste and gets +X/+0 until end of turn, where X is the number of Eldrazi you control.' });
const seer = mk({ name: 'Thought-Knot Seer', manaCost: '{3}{C}', typeLine: 'Creature — Eldrazi', power: 4, toughness: 4, colors: [], oracleText: 'When this creature enters, target opponent reveals their hand. You choose a nonland card from it and exile that card.\nWhen this creature leaves the battlefield, target opponent draws a card.' });
const fury = mk({ name: 'Fury', manaCost: '{3}{R}{R}', typeLine: 'Creature — Elemental Incarnation', power: 3, toughness: 3, colors: ['R'], oracleText: 'Double strike\nWhen this creature enters, it deals 4 damage divided as you choose among any number of target creatures and/or planeswalkers.\nEvoke—Exile a red card from your hand.' });
const price = mk({ name: 'Price of Progress', manaCost: '{1}{R}', typeLine: 'Instant', colors: ['R'], oracleText: 'Price of Progress deals damage to each player equal to twice the number of nonbasic lands that player controls.' });
const portent = mk({ name: 'Portent of Calamity', manaCost: '{X}{U}', typeLine: 'Sorcery', colors: ['U'], oracleText: 'Reveal the top X cards of your library. For each card type, you may exile a card of that type from among them. Put the rest into your graveyard. You may cast a spell from among the exiled cards without paying its mana cost if you exiled four or more cards this way. Then put the rest of the exiled cards into your hand.' });
const triumph = mk({ name: 'Triumph of Saint Katherine', manaCost: '{4}{W}', typeLine: 'Creature — Human Warrior', power: 6, toughness: 6, colors: ['W'], oracleText: 'Lifelink\nPraesidium Protectiva — When this creature is put into your graveyard from the battlefield, exile it and the top six cards of your library in a face-down pile. If you do, shuffle that pile and put it back on top of your library.\nMiracle {1}{W}' });
const dungeoneer = mk({ name: 'Seasoned Dungeoneer', manaCost: '{3}{W}', typeLine: 'Creature — Human Warrior', power: 3, toughness: 4, colors: ['W'], oracleText: 'When this creature enters, you take the initiative.\nWhenever you attack, target attacking Cleric, Rogue, Warrior, or Wizard gains protection from creatures until end of turn. It explores.' });
const eruption = mk({ name: 'Sundering Eruption', manaCost: '{2}{R}', typeLine: 'Sorcery', colors: ['R'], layout: 'modal_dfc', oracleText: "Destroy target land. Its controller may search their library for a basic land card, put it onto the battlefield tapped, then shuffle. Creatures without flying can't block this turn.", backFace: { name: 'Volcanic Fissure', typeLine: 'Land', colors: [], oracleText: "As this land enters, you may pay 3 life. If you don't, it enters tapped.\n{T}: Add {R}." } });
const cage = mk({ name: "Grafdigger's Cage", manaCost: '{1}', typeLine: 'Artifact', colors: [], oracleText: "Creature cards in graveyards and libraries can't enter the battlefield.\nPlayers can't cast spells from graveyards or libraries." });
const narcomoeba = mk({ name: 'Narcomoeba', manaCost: '{1}{U}', typeLine: 'Creature — Illusion', power: 1, toughness: 1, colors: ['U'], oracleText: 'Flying\nWhen this card is put into your graveyard from your library, you may put it onto the battlefield.' });
const dreadReturn = mk({ name: 'Dread Return', manaCost: '{2}{B}{B}', typeLine: 'Sorcery', colors: ['B'], oracleText: 'Return target creature card from your graveyard to the battlefield.\nFlashback—Sacrifice three creatures.' });
const idol = mk({ name: 'Bear Idol', manaCost: '{2}', typeLine: 'Artifact', colors: [], oracleText: '{T}: Add {C}.' });
const counter = mk({ name: 'Cancel', manaCost: '{1}{U}{U}', typeLine: 'Instant', colors: ['U'], oracleText: 'Counter target spell.' });
const tomb = mk({ name: 'Ancient Tomb', typeLine: 'Land', colors: [], oracleText: '{T}: Add {C}{C}. This land deals 2 damage to you.' });
const eldrazi = mk({ name: 'Eldrazi Guy', manaCost: '{4}', typeLine: 'Creature — Eldrazi', power: 3, toughness: 3, colors: [], oracleText: '' });
const mill = mk({ name: 'Mill Three', manaCost: '{U}', typeLine: 'Sorcery', colors: ['U'], oracleText: 'Mill three cards.' });

describe('M34 · Legacy parte 9', () => {
  it('compila tudo como full', () => {
    for (const c of [squelcher, welder, engineer, trainer, magus, pinnacle, eye, linebreaker, seer, fury, price, portent, triumph, dungeoneer, eruption, cage, narcomoeba, dreadReturn])
      expect(c.automation, `${c.name}: ${c.automationNotes?.join(' | ')}`).toBe('full');
    expect(eye.costModifiers?.[0]).toMatchObject({ amount: -2, filter: { subtype: 'Eldrazi', colorless: true } });
    expect(dreadReturn.flashback).toMatchObject({ sacrificeCount: 3 });
    expect(cage.cageNoEnterFromGraveyardLibrary).toBe(true);
    expect(magus.nonbasicLandsAreMountains).toBe(true);
  });

  it('Hexing Squelcher: mágicas suas não podem ser anuladas; outras criaturas suas ganham ward (2 de vida)', () => {
    const game = makeGame([...FILLER, squelcher, grizzlyBears, grizzlyBears], [...FILLER, counter, lightningBolt], { topP1: [squelcher.id, 'grizzly-bears'], topP2: [counter.id, 'lightning-bolt'] });
    goToMain1(game);
    put(game, 'p1', squelcher.id);
    const bears = put(game, 'p1', 'grizzly-bears');
    lands(game, 'p2', 'island', 'island', 'island', 'mountain');
    lands(game, 'p1', 'forest', 'forest');
    // Ward nas outras criaturas: p2 precisa pagar 2 de vida para mirar o urso.
    put(game, 'p2', 'lightning-bolt', 'hand');
    game.state.players.p2.life = 1;
    const bolt = findIn(game, 'p2', 'hand', 'lightning-bolt');
    passUntil(game, (s) => s.priority === 'p2' && s.turn === 1, 10);
    expect(cast(game, 'p2', bolt, { targets: [{ kind: 'object', id: bears }] }).ok).toBe(false); // ward: sem vida para pagar
    game.state.players.p2.life = 20;
    expect(cast(game, 'p2', bolt, { targets: [{ kind: 'object', id: bears }] }).ok).toBe(true);
    expect(game.state.players.p2.life).toBe(18);
    settle(game);
    // Spells you control can't be countered.
    passUntil(game, (s) => s.turn === 3 && s.step === 'main1' && s.priority === 'p1' && s.stack.length === 0, 400);
    untapAll(game, 'p1'); untapAll(game, 'p2');
    const b2 = put(game, 'p1', 'grizzly-bears', 'hand');
    expect(cast(game, 'p1', b2).ok).toBe(true);
    const cc = put(game, 'p2', counter.id, 'hand');
    expect(game.apply('p1', { type: 'passPriority' }).ok).toBe(true);
    expect(cast(game, 'p2', cc, { targets: [{ kind: 'object', id: b2 }] }).ok).toBe(true);
    settle(game);
    expect(game.state.objects[b2].zone).toBe('battlefield'); // não anulado
  });

  it('Goblin Welder: troca um artefato no campo por um artefato do cemitério do mesmo jogador', () => {
    const game = makeGame([...FILLER, welder, idol, idol], FILLER, { topP1: [welder.id, idol.id, idol.id] });
    goToMain1(game);
    const w = put(game, 'p1', welder.id);
    game.state.objects[w].summoningSick = false;
    const a = put(game, 'p1', idol.id);
    const g = put(game, 'p1', idol.id, 'graveyard');
    expect(game.apply('p1', { type: 'activateAbility', objectId: w, abilityIndex: 0, targets: [{ kind: 'object', id: a }, { kind: 'object', id: g }] }).ok).toBe(true);
    settle(game);
    expect(game.state.objects[a].zone).toBe('graveyard');
    expect(game.state.objects[g].zone).toBe('battlefield');
  });

  it('Goblin Engineer: ao entrar, busca um artefato para o cemitério', () => {
    const game = makeGame([...FILLER, engineer, idol], FILLER, { topP1: [engineer.id] });
    goToMain1(game);
    lands(game, 'p1', 'mountain', 'mountain');
    const e = findIn(game, 'p1', 'hand', engineer.id);
    expect(cast(game, 'p1', e).ok).toBe(true);
    untilDecision(game);
    let pd = choice(game);
    expect(pd.mode).toBe('confirm');
    answer(game, 'p1', [], 'yes');
    pd = choice(game);
    const i = findIn(game, 'p1', 'library', idol.id);
    expect(pd.options).toContain(i);
    answer(game, 'p1', [i]);
    settle(game);
    expect(game.state.objects[i].zone).toBe('graveyard');
  });

  it('Thought-Knot Seer: ao entrar, exila uma carta não-terreno da mão do oponente', () => {
    const game = makeGame([...FILLER, seer, idol], [...FILLER, lightningBolt], { topP1: [seer.id], topP2: ['lightning-bolt'] });
    goToMain1(game);
    put(game, 'p1', idol.id); lands(game, 'p1', 'mountain', 'mountain', 'mountain');
    const s = findIn(game, 'p1', 'hand', seer.id);
    const bolt = findIn(game, 'p2', 'hand', 'lightning-bolt');
    expect(cast(game, 'p1', s).ok).toBe(true);
    passUntil(game, (game2) => game2.pendingDecision?.type === 'chooseTargets', 30);
    expect(game.apply('p1', { type: 'chooseTargets', targets: [{ kind: 'player', player: 'p2' }] }).ok).toBe(true);
    // Só uma carta não-terreno na mão do oponente: a escolha é forçada e resolve sozinha.
    settle(game);
    expect(game.state.objects[bolt].zone).toBe('exile');
    expect(game.state.players.p2.zones.hand.every((id) => game.state.objects[id].card.types.includes('Land'))).toBe(true);
  });

  it('Price of Progress: 2 de dano por terreno não básico de cada jogador', () => {
    const game = makeGame([...FILLER, price, tomb], [...FILLER, tomb, tomb], { topP1: [price.id, tomb.id], topP2: [tomb.id, tomb.id] });
    goToMain1(game);
    put(game, 'p1', tomb.id); put(game, 'p2', tomb.id); put(game, 'p2', tomb.id);
    lands(game, 'p1', 'mountain', 'mountain');
    const p = findIn(game, 'p1', 'hand', price.id);
    expect(cast(game, 'p1', p).ok).toBe(true);
    settle(game);
    expect(game.state.players.p1.life).toBe(18);
    expect(game.state.players.p2.life).toBe(16);
  });

  it('Dread Return: flashback sacrificando três criaturas devolve a criatura do cemitério', () => {
    const game = makeGame([...FILLER, dreadReturn, grizzlyBears, grizzlyBears, grizzlyBears, grizzlyBears], FILLER, { topP1: [dreadReturn.id, 'grizzly-bears', 'grizzly-bears', 'grizzly-bears', 'grizzly-bears'] });
    goToMain1(game);
    const dr = put(game, 'p1', dreadReturn.id, 'graveyard');
    const dead = put(game, 'p1', 'grizzly-bears', 'graveyard');
    const b1 = put(game, 'p1', 'grizzly-bears'); const b2 = put(game, 'p1', 'grizzly-bears'); const b3 = put(game, 'p1', 'grizzly-bears');
    expect(cast(game, 'p1', dr, { sacrifices: [b1, b2], targets: [{ kind: 'object', id: dead }] }).ok).toBe(false); // faltam sacrifícios
    expect(cast(game, 'p1', dr, { sacrifices: [b1, b2, b3], targets: [{ kind: 'object', id: dead }] }).ok).toBe(true);
    settle(game);
    expect(game.state.objects[dead].zone).toBe('battlefield');
    expect(game.state.objects[b1].zone).toBe('graveyard');
    expect(game.state.objects[dr].zone).toBe('exile');
  });

  it("Grafdigger's Cage: bloqueia reanimação e conjuração do cemitério", () => {
    const game = makeGame([...FILLER, dreadReturn, dreadReturn, grizzlyBears, grizzlyBears, grizzlyBears, grizzlyBears], [...FILLER, cage], { topP1: [dreadReturn.id, 'grizzly-bears', 'grizzly-bears', 'grizzly-bears', 'grizzly-bears'], topP2: [cage.id] });
    goToMain1(game);
    put(game, 'p2', cage.id);
    const dr = put(game, 'p1', dreadReturn.id, 'graveyard');
    const dead = put(game, 'p1', 'grizzly-bears', 'graveyard');
    const b1 = put(game, 'p1', 'grizzly-bears'); const b2 = put(game, 'p1', 'grizzly-bears'); const b3 = put(game, 'p1', 'grizzly-bears');
    expect(cast(game, 'p1', dr, { sacrifices: [b1, b2, b3], targets: [{ kind: 'object', id: dead }] }).ok).toBe(false); // não conjura do cemitério
    // Da mão, com mana: a mágica resolve mas a criatura não entra.
    const dr2 = put(game, 'p1', dreadReturn.id, 'hand');
    lands(game, 'p1', 'swamp', 'swamp', 'swamp', 'swamp');
    expect(cast(game, 'p1', dr2, { targets: [{ kind: 'object', id: dead }] }).ok).toBe(true);
    settle(game);
    expect(game.state.objects[dead].zone).toBe('graveyard');
  });

  it('Magus of the Moon: terrenos não básicos viram Mountains ({T}: {R}) e voltam quando ele sai', () => {
    const game = makeGame([...FILLER, magus], [...FILLER, tomb], { topP1: [magus.id], topP2: [tomb.id] });
    goToMain1(game);
    const t = put(game, 'p2', tomb.id);
    expect(game.state.objects[t].card.subtypes).toEqual([]);
    const m = put(game, 'p1', magus.id);
    game.apply('p1', { type: 'passPriority' }); // SBA roda depois da ação
    expect(game.state.objects[t].card.subtypes).toEqual(['Mountain']);
    expect(game.state.objects[t].card.abilities?.[0]?.text).toMatch(/Blood Moon/);
    passUntil(game, (s) => s.priority === 'p2', 10);
    expect(game.apply('p2', { type: 'activateAbility', objectId: t, abilityIndex: 0 }).ok).toBe(true);
    expect(game.state.players.p2.manaPool.R).toBe(1);
    expect(game.state.players.p2.manaPool.C).toBe(0);
    game.apply('p1', { type: 'manualMove', objectId: m, to: 'graveyard' });
    game.apply('p2', { type: 'passPriority' });
    expect(game.state.objects[t].card.subtypes).toEqual([]);
    expect(game.state.objects[t].card.name).toBe('Ancient Tomb');
  });

  it('Fury: 4 de dano dividido entre os alvos (3 no primeiro, o resto no último)', () => {
    const game = makeGame([...FILLER, fury], [...FILLER, grizzlyBears, grizzlyBears], { topP1: [fury.id], topP2: ['grizzly-bears', 'grizzly-bears'] });
    goToMain1(game);
    const b1 = put(game, 'p2', 'grizzly-bears'); const b2 = put(game, 'p2', 'grizzly-bears');
    lands(game, 'p1', 'mountain', 'mountain', 'mountain', 'mountain', 'mountain');
    const f = findIn(game, 'p1', 'hand', fury.id);
    expect(cast(game, 'p1', f).ok).toBe(true);
    passUntil(game, (s) => s.pendingDecision?.type === 'chooseTargets', 30);
    expect(game.apply('p1', { type: 'chooseTargets', targets: [{ kind: 'object', id: b1 }, { kind: 'object', id: b2 }] }).ok).toBe(true);
    untilDecision(game);
    const pd = choice(game);
    expect(pd.mode).toBe('number');
    expect(pd.prompt).toMatch(/restam 4/);
    answer(game, 'p1', [], '3');
    settle(game);
    expect(game.state.objects[b1].zone).toBe('graveyard'); // 3 de dano num 2/2
    expect(game.state.objects[b2].zone).toBe('battlefield');
    expect(game.state.objects[b2].damage).toBe(1);
  });

  it('Narcomoeba: moída da biblioteca, pode ir para o campo de batalha', () => {
    const game = makeGame([...FILLER, mill, narcomoeba], FILLER, { topP1: [mill.id, narcomoeba.id] });
    goToMain1(game);
    put(game, 'p1', 'island');
    const m = findIn(game, 'p1', 'hand', mill.id);
    const n = findIn(game, 'p1', 'hand', narcomoeba.id);
    expect(game.apply('p1', { type: 'manualMove', objectId: n, to: 'library', position: 'top' }).ok).toBe(true);
    expect(cast(game, 'p1', m).ok).toBe(true);
    untilDecision(game);
    const pd = choice(game);
    expect(pd.mode).toBe('confirm');
    answer(game, 'p1', [], 'yes');
    settle(game);
    expect(game.state.objects[n].zone).toBe('battlefield');
  });

  it('Seasoned Dungeoneer: o atacante alvo ganha proteção contra criaturas (não pode ser bloqueado) e explora', () => {
    const game = makeGame([...FILLER, dungeoneer, dungeoneer], [...FILLER, grizzlyBears], { topP1: [dungeoneer.id, dungeoneer.id], topP2: ['grizzly-bears'] });
    goToMain1(game);
    const d1 = put(game, 'p1', dungeoneer.id); const d2 = put(game, 'p1', dungeoneer.id);
    for (const id of [d1, d2]) game.state.objects[id].summoningSick = false;
    const bears = put(game, 'p2', 'grizzly-bears');
    passUntil(game, (s) => s.combatAwaiting === 'attackers', 30);
    expect(game.apply('p1', { type: 'declareAttackers', attackers: [d1] }).ok).toBe(true);
    if (game.state.pendingDecision?.type !== 'chooseTargets') passUntil(game, (s) => s.pendingDecision?.type === 'chooseTargets', 30);
    expect(game.apply('p1', { type: 'chooseTargets', targets: [{ kind: 'object', id: d1 }] }).ok).toBe(true);
    for (let i = 0; i < 20 && game.state.combatAwaiting !== 'blockers'; i++) {
      const pd = game.state.pendingDecision;
      if (pd?.type === 'effectChoice') { answer(game, pd.player, pd.options.slice(0, pd.min), pd.mode === 'confirm' ? 'yes' : undefined); continue; }
      if (pd?.type === 'chooseTargets') { expect(game.apply('p1', { type: 'chooseTargets', targets: [{ kind: 'object', id: d1 }] }).ok).toBe(true); continue; } // o segundo Dungeoneer também dispara
      if (pd) throw new Error(`decisão inesperada: ${pd.type}`);
      const pr = game.state.priority; if (!pr) throw new Error('sem prioridade');
      expect(game.apply(pr, { type: 'passPriority' }).ok).toBe(true);
    }
    expect(game.state.combatAwaiting).toBe('blockers');
    expect(hasKeyword(game.state, game.state.objects[d1], 'protectionFromCreatures')).toBe(true);
    expect(game.apply('p2', { type: 'declareBlockers', blocks: [{ blocker: bears, attacker: d1 }] }).ok).toBe(false);
  });

  it('Triumph of Saint Katherine: ao morrer, some do cemitério e volta embaralhada com as seis do topo', () => {
    const game = makeGame([...FILLER, triumph], FILLER, { topP1: [triumph.id] });
    goToMain1(game);
    const t = put(game, 'p1', triumph.id);
    const lib = game.state.players.p1.zones.library.length;
    game.state.objects[t].damage = 6;
    game.apply('p1', { type: 'passPriority' }); // SBA: morre
    settle(game);
    expect(game.state.objects[t].zone).toBe('library');
    expect(game.state.players.p1.zones.library).toHaveLength(lib + 1);
    expect(game.state.players.p1.zones.library.slice(0, 7)).toContain(t);
  });

  it('Pinnacle Emissary: conjurar um artefato cria um Drone 1/1 voador que só bloqueia voadores', () => {
    const game = makeGame([...FILLER, pinnacle, idol], FILLER, { topP1: [pinnacle.id, idol.id] });
    goToMain1(game);
    put(game, 'p1', pinnacle.id);
    lands(game, 'p1', 'island', 'island');
    const i = findIn(game, 'p1', 'hand', idol.id);
    expect(cast(game, 'p1', i).ok).toBe(true);
    settle(game);
    const drone = game.state.players.p1.zones.battlefield.map((id) => game.state.objects[id]).find((o) => o.card.name === 'Drone');
    expect(drone).toBeDefined();
    expect(hasKeyword(game.state, drone!, 'flying')).toBe(true);
    expect(hasKeyword(game.state, drone!, 'blockOnlyFlying')).toBe(true);
  });

  it('Eye of Ugin: Eldrazi incolor custa {2} a menos', () => {
    const game = makeGame([...FILLER, eye, eldrazi], FILLER, { topP1: [eye.id, eldrazi.id] });
    goToMain1(game);
    put(game, 'p1', eye.id);
    lands(game, 'p1', 'mountain', 'mountain');
    const e = findIn(game, 'p1', 'hand', eldrazi.id);
    expect(cast(game, 'p1', e).ok).toBe(true); // {4} − 2 = duas Mountains
    settle(game);
    expect(game.state.objects[e].zone).toBe('battlefield');
  });

  it('Portent of Calamity (X=4): exila até uma carta de cada tipo, o resto para o cemitério; com 4 exiladas conjura uma de graça e o resto vai para a mão', () => {
    const game = makeGame([...FILLER, portent, lightningBolt, grizzlyBears, idol, counter], FILLER, { topP1: [portent.id, 'lightning-bolt', 'grizzly-bears', idol.id, counter.id] });
    goToMain1(game);
    lands(game, 'p1', 'island', 'island', 'island', 'island', 'island');
    const p = findIn(game, 'p1', 'hand', portent.id);
    // Topo (X=5): Bolt (instant), Bears (creature), Idol (artifact), Cancel (instant), Swamp (land).
    const grab = (id: string) => { let o: number; try { o = findIn(game, 'p1', 'hand', id); } catch { o = findIn(game, 'p1', 'library', id); } return o; };
    const bolt = grab('lightning-bolt'); const bears = grab('grizzly-bears'); const id2 = grab(idol.id); const cc = grab(counter.id); const sw = grab('swamp');
    for (const x of [sw, cc, id2, bears, bolt]) expect(game.apply('p1', { type: 'manualMove', objectId: x, to: 'library', position: 'top' }).ok).toBe(true);
    put(game, 'p1', 'island');
    expect(cast(game, 'p1', p, { x: 5 }).ok).toBe(true);
    untilDecision(game);
    let pd = choice(game);
    expect(pd.max).toBe(4); // tipos: Instant, Creature, Artifact, Land
    expect(answer(game, 'p1', [bolt, bears, id2, cc, sw]).ok).toBe(false); // 5 > 4
    answer(game, 'p1', [bolt, bears, id2, sw]);
    expect(game.state.objects[cc].zone).toBe('graveyard'); // o resto vai para o cemitério
    expect(game.state.objects[bolt].zone).toBe('exile');
    // 4 exiladas: pode conjurar uma de graça — o Bolt, com alvo; o resto vai para a mão.
    pd = choice(game);
    expect(pd.options).toEqual(expect.arrayContaining([bolt, bears, id2]));
    expect(pd.options).not.toContain(sw);
    answer(game, 'p1', [bolt]);
    expect(game.state.pendingDecision?.type).toBe('chooseTargets');
    expect(game.apply('p1', { type: 'chooseTargets', targets: [{ kind: 'player', player: 'p2' }] }).ok).toBe(true);
    settle(game);
    expect(game.state.players.p2.life).toBe(17);
    for (const x of [bears, id2, sw]) expect(game.state.objects[x].zone).toBe('hand');
    expect(game.state.objects[bolt].zone).toBe('graveyard');
  });
});
