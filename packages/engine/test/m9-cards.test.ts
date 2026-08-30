/**
 * M9: habilidades de mana com custo/condição/cor à escolha, custo
 * alternativo (Force of Will), nomear carta (Cabal Therapy), flashback por
 * sacrifício e automação parcial de permanentes.
 */
import { describe, expect, it } from 'vitest';
import { compileOracleCard } from '../src/cards/oracle-parser.js';
import { forest, grizzlyBears, lightningBolt, mountain, ragingGoblin, swamp } from '../src/cards/demo-set.js';
import type { CardDefinition } from '../src/cards/types.js';
import type { Game } from '../src/game.js';
import type { PlayerId } from '../src/types.js';
import { findIn, goToMain1, makeGame, passUntil } from './helpers.js';

// Fixtures com o texto oracle real (sem rede nos testes).
const lotusPetal = compileOracleCard({
  name: 'Lotus Petal',
  manaCost: '{0}',
  typeLine: 'Artifact',
  oracleText: '{T}, Sacrifice this artifact: Add one mana of any color.',
})!;
const vaultOfWhispers = compileOracleCard({
  name: 'Vault of Whispers',
  typeLine: 'Artifact Land',
  oracleText: '{T}: Add {B}.',
})!;
const spireOfIndustry = compileOracleCard({
  name: 'Spire of Industry',
  typeLine: 'Land',
  oracleText: '{T}: Add {C}.\n{T}, Pay 1 life: Add one mana of any color. Activate only if you control an artifact.',
})!;
const moxOpal = compileOracleCard({
  name: 'Mox Opal',
  manaCost: '{0}',
  typeLine: 'Legendary Artifact',
  oracleText: 'Metalcraft — {T}: Add one mana of any color. Activate only if you control three or more artifacts.',
})!;
const cabalTherapy = compileOracleCard({
  name: 'Cabal Therapy',
  manaCost: '{B}',
  typeLine: 'Sorcery',
  colors: ['B'],
  oracleText:
    'Choose a nonland card name. Target player reveals their hand and discards all cards with that name.\nFlashback—Sacrifice a creature. (You may cast this card from your graveyard for its flashback cost. Then exile it.)',
})!;
const forceOfWill = compileOracleCard({
  name: 'Force of Will',
  manaCost: '{3}{U}{U}',
  typeLine: 'Instant',
  colors: ['U'],
  oracleText:
    "You may pay 1 life and exile a blue card from your hand rather than pay this spell's mana cost.\nCounter target spell.",
})!;
const solRing = compileOracleCard({
  name: 'Sol Ring',
  manaCost: '{1}',
  typeLine: 'Artifact',
  oracleText: '{T}: Add {C}{C}.',
})!;

function copies(card: CardDefinition, n: number): CardDefinition[] {
  return Array.from({ length: n }, () => card);
}

function put(game: Game, player: PlayerId, cardId: string, zone: 'battlefield' | 'graveyard' | 'hand' = 'battlefield'): number {
  let id: number;
  try {
    id = findIn(game, player, 'library', cardId);
  } catch {
    id = findIn(game, player, 'hand', cardId);
  }
  const r = game.apply(player, { type: 'manualMove', objectId: id, to: zone });
  if (!r.ok) throw new Error(`setup falhou: ${cardId} → ${zone}`);
  return id;
}

const FILLER = [...copies(mountain, 8), ...copies(forest, 8)];

describe('M9 · compilador', () => {
  it('compila as seis cartas reportadas como totalmente automatizadas', () => {
    for (const c of [lotusPetal, vaultOfWhispers, spireOfIndustry, moxOpal, cabalTherapy, forceOfWill, solRing])
      expect(c.automation).toBe('full');
    expect(moxOpal.abilities?.[0]).toMatchObject({
      kind: 'activated',
      condition: { controlsAtLeast: { count: 3, filter: { what: 'artifact' } } },
    });
    expect(forceOfWill.altCost).toMatchObject({ payLife: 1, exileFromHand: { count: 1, filter: { color: 'U' } } });
    expect(cabalTherapy.flashback).toMatchObject({ sacrifice: { what: 'creature' } });
  });

  it('permanente com linha desconhecida vira automação parcial (jogável)', () => {
    const partial = compileOracleCard({
      name: 'Weird Golem',
      manaCost: '{3}',
      typeLine: 'Artifact Creature — Golem',
      power: 3,
      toughness: 3,
      oracleText: 'Flying\nWeird Golem does something the parser cannot understand.',
    })!;
    expect(partial.automation).toBe('partial');
    expect(partial.automationNotes?.[0]).toContain('cannot understand');
    expect(partial.keywords).toContain('flying');
  });

  it('mágica com linha desconhecida continua manual (tudo ou nada)', () => {
    expect(
      compileOracleCard({
        name: 'Weird Bolt',
        manaCost: '{R}',
        typeLine: 'Instant',
        oracleText: 'Does something the parser cannot understand.',
      }),
    ).toBeNull();
  });
});

describe('M9 · Lotus Petal', () => {
  it('conjura por zero, sacrifica por mana da cor escolhida', () => {
    const game = makeGame([...FILLER, lotusPetal], FILLER, { topP1: [lotusPetal.id] });
    goToMain1(game);
    const petal = findIn(game, 'p1', 'hand', lotusPetal.id);
    expect(game.apply('p1', { type: 'castSpell', objectId: petal }).ok).toBe(true);
    passUntil(game, (s) => s.stack.length === 0);
    expect(game.state.objects[petal].zone).toBe('battlefield');

    // sem cor → erro; com cor → mana no pool e Petal no cemitério
    expect(game.apply('p1', { type: 'activateAbility', objectId: petal, abilityIndex: 0 }).ok).toBe(false);
    expect(game.apply('p1', { type: 'activateAbility', objectId: petal, abilityIndex: 0, manaColor: 'B' }).ok).toBe(true);
    expect(game.state.players.p1.manaPool.B).toBe(1);
    expect(game.state.objects[petal].zone).toBe('graveyard');
    // sacrifício não pode ser desfeito
    expect(game.state.reversibleTaps).toHaveLength(0);
  });
});

describe('M9 · condições de ativação', () => {
  it('Mox Opal exige metalcraft (3 artefatos)', () => {
    const game = makeGame([...FILLER, moxOpal, solRing, lotusPetal], FILLER, {
      topP1: [moxOpal.id, solRing.id, lotusPetal.id],
    });
    goToMain1(game);
    const opal = put(game, 'p1', moxOpal.id);
    put(game, 'p1', solRing.id);
    const r1 = game.apply('p1', { type: 'activateAbility', objectId: opal, abilityIndex: 0, manaColor: 'R' });
    expect(r1.ok).toBe(false); // só 2 artefatos
    put(game, 'p1', lotusPetal.id);
    const r2 = game.apply('p1', { type: 'activateAbility', objectId: opal, abilityIndex: 0, manaColor: 'R' });
    expect(r2.ok).toBe(true);
    expect(game.state.players.p1.manaPool.R).toBe(1);
  });

  it('Spire of Industry: paga 1 vida, exige um artefato', () => {
    const game = makeGame([...FILLER, spireOfIndustry, solRing], FILLER, {
      topP1: [spireOfIndustry.id, solRing.id],
    });
    goToMain1(game);
    const spire = put(game, 'p1', spireOfIndustry.id);
    expect(
      game.apply('p1', { type: 'activateAbility', objectId: spire, abilityIndex: 1, manaColor: 'G' }).ok,
    ).toBe(false); // sem artefato
    put(game, 'p1', solRing.id);
    expect(
      game.apply('p1', { type: 'activateAbility', objectId: spire, abilityIndex: 1, manaColor: 'G' }).ok,
    ).toBe(true);
    expect(game.state.players.p1.manaPool.G).toBe(1);
    expect(game.state.players.p1.life).toBe(19);
  });
});

describe('M9 · Force of Will (custo alternativo)', () => {
  it('paga 1 vida + exila carta azul em vez da mana e anula a mágica', () => {
    const game = makeGame(
      [...FILLER, forceOfWill, forceOfWill],
      [...FILLER, lightningBolt, mountain],
      { topP1: [forceOfWill.id, forceOfWill.id], topP2: [lightningBolt.id, 'mountain'] },
    );
    goToMain1(game);
    put(game, 'p2', 'mountain');
    // p1 passa; p2 conjura Bolt na main do p1 (instantânea)
    game.apply('p1', { type: 'passPriority' });
    const bolt = findIn(game, 'p2', 'hand', 'lightning-bolt');
    expect(
      game.apply('p2', { type: 'castSpell', objectId: bolt, targets: [{ kind: 'player', player: 'p1' }] }).ok,
    ).toBe(true);
    // p2 segura prioridade → passa; p1 responde com FoW via custo alternativo
    game.apply('p2', { type: 'passPriority' });
    const [fow1, fow2] = game.state.players.p1.zones.hand.filter(
      (id) => game.state.objects[id].card.id === forceOfWill.id,
    );
    const r = game.apply('p1', {
      type: 'castSpell',
      objectId: fow1,
      targets: [{ kind: 'object', id: bolt }],
      useAltCost: true,
      altExile: [fow2],
    });
    expect(r.ok).toBe(true);
    expect(game.state.players.p1.life).toBe(19);
    expect(game.state.objects[fow2].zone).toBe('exile');
    passUntil(game, (s) => s.stack.length === 0);
    expect(game.state.objects[bolt].zone).toBe('graveyard'); // anulada
    expect(game.state.players.p1.life).toBe(19); // Bolt não resolveu
  });

  it('exilar carta que não é azul falha', () => {
    const game = makeGame([...FILLER, forceOfWill], FILLER, { topP1: [forceOfWill.id] });
    goToMain1(game);
    game.apply('p1', { type: 'passPriority' });
    goToMain1(game);
    const fow = findIn(game, 'p1', 'hand', forceOfWill.id);
    const redCard = game.state.players.p1.zones.hand.find(
      (id) => game.state.objects[id].card.id === 'mountain',
    );
    if (redCard === undefined) return; // mão sem terreno: nada a testar
    const r = game.apply('p1', {
      type: 'castSpell',
      objectId: fow,
      targets: [],
      useAltCost: true,
      altExile: [redCard],
    });
    expect(r.ok).toBe(false);
  });
});

describe('M9 · Cabal Therapy', () => {
  it('nomeia uma carta; o alvo revela a mão e descarta todas as cópias', () => {
    const game = makeGame(
      [...FILLER, cabalTherapy, swamp],
      [...copies(grizzlyBears, 3), ...FILLER],
      { topP1: [cabalTherapy.id, 'swamp'], topP2: ['grizzly-bears', 'grizzly-bears', 'mountain'] },
    );
    goToMain1(game);
    put(game, 'p1', 'swamp');
    const therapy = findIn(game, 'p1', 'hand', cabalTherapy.id);
    expect(
      game.apply('p1', { type: 'castSpell', objectId: therapy, targets: [{ kind: 'player', player: 'p2' }] }).ok,
    ).toBe(true);
    passUntil(game, (s) => s.pendingDecision !== null);
    expect(game.state.pendingDecision).toMatchObject({ type: 'effectChoice', mode: 'nameCard', player: 'p1' });

    const bearsBefore = game.state.players.p2.zones.hand.filter(
      (id) => game.state.objects[id].card.id === 'grizzly-bears',
    ).length;
    expect(bearsBefore).toBe(2);
    const r = game.apply('p1', { type: 'effectChoice', picks: [], text: 'Grizzly Bears' });
    expect(r.ok).toBe(true);
    const bearsAfter = game.state.players.p2.zones.hand.filter(
      (id) => game.state.objects[id].card.id === 'grizzly-bears',
    ).length;
    expect(bearsAfter).toBe(0);
    expect(r.events.some((e) => e.type === 'handRevealed')).toBe(true);
    expect(game.state.objects[therapy].zone).toBe('graveyard');
  });

  it('flashback sacrificando uma criatura, e exila ao resolver', () => {
    const game = makeGame(
      [...FILLER, cabalTherapy, ragingGoblin],
      FILLER,
      { topP1: [cabalTherapy.id, 'raging-goblin'] },
    );
    goToMain1(game);
    const therapy = put(game, 'p1', cabalTherapy.id, 'graveyard');
    const goblin = put(game, 'p1', 'raging-goblin');

    // sem sacrifício → erro; com goblin → vai para a pilha
    expect(
      game.apply('p1', { type: 'castSpell', objectId: therapy, targets: [{ kind: 'player', player: 'p2' }] }).ok,
    ).toBe(false);
    expect(
      game.apply('p1', {
        type: 'castSpell',
        objectId: therapy,
        targets: [{ kind: 'player', player: 'p2' }],
        sacrifices: [goblin],
      }).ok,
    ).toBe(true);
    expect(game.state.objects[goblin].zone).toBe('graveyard');
    passUntil(game, (s) => s.pendingDecision !== null);
    game.apply('p1', { type: 'effectChoice', picks: [], text: 'Mountain' });
    expect(game.state.objects[therapy].zone).toBe('exile'); // flashback exila
  });
});
