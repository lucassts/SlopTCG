/** Compilador oracle → DSL: automatiza o que reconhece, recusa o resto. */
import { describe, expect, it } from 'vitest';
import { compileOracleCard } from '../src/cards/oracle-parser.js';

describe('oracle parser · aceita', () => {
  it('vanilla: criatura sem texto', () => {
    const def = compileOracleCard({
      name: 'Grizzly Bears',
      manaCost: '{1}{G}',
      typeLine: 'Creature — Bear',
      power: 2,
      toughness: 2,
      colors: ['G'],
    });
    expect(def).not.toBeNull();
    expect(def!.automation).toBe('full');
    expect(def!.subtypes).toEqual(['Bear']);
  });

  it('french vanilla: linha de keywords + proteção', () => {
    const def = compileOracleCard({
      name: 'Segovian Angel',
      manaCost: '{W}',
      typeLine: 'Creature — Angel',
      oracleText: 'Flying, vigilance',
      power: 1,
      toughness: 1,
      colors: ['W'],
    });
    expect(def!.keywords).toEqual(['flying', 'vigilance']);

    const knight = compileOracleCard({
      name: 'Black Knight',
      manaCost: '{B}{B}',
      typeLine: 'Creature — Human Knight',
      oracleText: 'First strike\nProtection from white',
      power: 2,
      toughness: 2,
      colors: ['B'],
    });
    expect(knight!.keywords).toEqual(['firstStrike']);
    expect(knight!.protectionFrom).toEqual(['W']);
  });

  it('mágica de dano: Shock', () => {
    const def = compileOracleCard({
      name: 'Shock',
      manaCost: '{R}',
      typeLine: 'Instant',
      oracleText: 'Shock deals 2 damage to any target.',
      colors: ['R'],
    });
    expect(def!.spellTargets).toEqual([{ what: 'any' }]);
    expect(def!.spellEffect).toEqual([{ op: 'damage', to: 'target:0', amount: 2 }]);
  });

  it('card advantage: Concentrate ("Draw three cards.")', () => {
    const def = compileOracleCard({
      name: 'Concentrate',
      manaCost: '{2}{U}{U}',
      typeLine: 'Sorcery',
      oracleText: 'Draw three cards.',
      colors: ['U'],
    });
    expect(def!.spellEffect).toEqual([{ op: 'draw', who: 'controller', count: 3 }]);
  });

  it('remoção: Doom Blade-like ("Destroy target creature.")', () => {
    const def = compileOracleCard({
      name: 'Murder',
      manaCost: '{1}{B}{B}',
      typeLine: 'Instant',
      oracleText: 'Destroy target creature.',
      colors: ['B'],
    });
    expect(def!.spellTargets).toEqual([{ what: 'creature' }]);
    expect(def!.spellEffect).toEqual([{ op: 'destroy', what: 'target:0' }]);
  });

  it('gatilho de entrada simples com nome no texto', () => {
    const def = compileOracleCard({
      name: 'Elvish Visionary',
      manaCost: '{1}{G}',
      typeLine: 'Creature — Elf Shaman',
      oracleText: 'When Elvish Visionary enters the battlefield, draw a card.',
      power: 1,
      toughness: 1,
      colors: ['G'],
    });
    expect(def!.abilities).toHaveLength(1);
    const ability = def!.abilities![0];
    expect(ability.kind).toBe('triggered');
  });

  it('aura de buff: Hero\'s Resolve', () => {
    const def = compileOracleCard({
      name: "Hero's Resolve",
      manaCost: '{1}{W}',
      typeLine: 'Enchantment — Aura',
      oracleText: 'Enchant creature\nEnchanted creature gets +1/+5.',
      colors: ['W'],
    });
    expect(def!.enchant).toEqual({ what: 'creature' });
    expect(def!.attachEffect).toEqual({ power: 1, toughness: 5 });
  });

  it('equipamento: Short Sword', () => {
    const def = compileOracleCard({
      name: 'Short Sword',
      manaCost: '{1}',
      typeLine: 'Artifact — Equipment',
      oracleText: 'Equipped creature gets +1/+1.\nEquip {1}',
      colors: [],
    });
    expect(def!.attachEffect).toEqual({ power: 1, toughness: 1 });
    const equip = def!.abilities!.find((a) => a.kind === 'activated');
    expect(equip).toBeDefined();
  });

  it('fichas: Raise the Alarm', () => {
    const def = compileOracleCard({
      name: 'Raise the Alarm',
      manaCost: '{1}{W}',
      typeLine: 'Instant',
      oracleText: 'Create two 1/1 white Soldier creature tokens.',
      colors: ['W'],
    });
    expect(def!.spellEffect).toEqual([
      {
        op: 'token',
        who: 'controller',
        count: 2,
        name: 'Soldier',
        power: 1,
        toughness: 1,
        colors: ['W'],
        subtypes: ['Soldier'],
        keywords: undefined,
      },
    ]);
  });

  it('terreno com mana e cycling: Tranquil Thicket', () => {
    const def = compileOracleCard({
      name: 'Tranquil Thicket',
      typeLine: 'Land',
      oracleText: 'Tranquil Thicket enters the battlefield tapped.\n{T}: Add {G}.\nCycling {G} ({G}, Discard this card: Draw a card.)',
      colors: [],
    });
    expect(def!.entersTapped).toBe(true);
    expect(def!.cycling).toEqual({ mana: '{G}' });
    expect(def!.abilities!.some((a) => a.kind === 'activated' && a.isManaAbility)).toBe(true);
  });

  it('pump com keyword: "Target creature gains flying until end of turn."', () => {
    const def = compileOracleCard({
      name: 'Jump',
      manaCost: '{U}',
      typeLine: 'Instant',
      oracleText: 'Target creature gains flying until end of turn.',
      colors: ['U'],
    });
    expect(def!.spellEffect).toEqual([{ op: 'pump', what: 'target:0', power: 0, toughness: 0, keywords: ['flying'] }]);
  });
});

describe('oracle parser · recusa (conservador)', () => {
  it('linha não reconhecida → null (fica manual)', () => {
    expect(
      compileOracleCard({
        name: 'Guttersnipe',
        manaCost: '{2}{R}',
        typeLine: 'Creature — Goblin Shaman',
        oracleText: 'Whenever you cast an instant or sorcery spell, Guttersnipe deals 2 damage to each opponent.',
        power: 2,
        toughness: 2,
        colors: ['R'],
      }),
    ).toBeNull();
  });

  it('mana dupla ("Add {W} or {U}") → null', () => {
    expect(
      compileOracleCard({
        name: 'Tranquil Cove',
        typeLine: 'Land',
        oracleText: 'Tranquil Cove enters the battlefield tapped.\nWhen Tranquil Cove enters the battlefield, you gain 1 life.\n{T}: Add {W} or {U}.',
        colors: [],
      }),
    ).toBeNull();
  });

  it('mais de um alvo → null', () => {
    expect(
      compileOracleCard({
        name: 'Fake Two Targets',
        manaCost: '{1}{R}',
        typeLine: 'Sorcery',
        oracleText: 'Destroy target creature. Destroy target artifact.',
        colors: ['R'],
      }),
    ).toBeNull();
  });

  it('planeswalker → null', () => {
    expect(
      compileOracleCard({
        name: 'Jace Beleren',
        manaCost: '{1}{U}{U}',
        typeLine: 'Legendary Planeswalker — Jace',
        oracleText: '+2: Each player draws a card.',
        colors: ['U'],
      }),
    ).toBeNull();
  });
});
