/**
 * Demo set: real Magic cards fully automated via the Tier 1 DSL.
 * This is the reference for contributors — every primitive appears at least
 * once. Card names/text © Wizards of the Coast, used under the Fan Content
 * Policy; images and oracle data come from Scryfall at runtime.
 */
import type { CardDefinition, DeckList } from './types.js';
import type { Color } from '../types.js';

function basicLand(name: string, ptName: string, color: Color): CardDefinition {
  return {
    id: name.toLowerCase(),
    name,
    types: ['Land'],
    subtypes: [ptName],
    supertypes: ['Basic'],
    colors: [],
    text: `{T}: Add {${color}}.`,
    abilities: [
      {
        kind: 'activated',
        cost: { tap: true },
        effect: [{ op: 'addMana', who: 'controller', mana: [color] }],
        text: `Adicionar {${color}}`,
        isManaAbility: true,
      },
    ],
    automation: 'full',
  };
}

export const DEMO_CARDS: Record<string, CardDefinition> = {};

function def(card: CardDefinition): CardDefinition {
  DEMO_CARDS[card.id] = card;
  return card;
}

// ------------------------------------------------------------------ lands
export const plains = def(basicLand('Plains', 'Plains', 'W'));
export const island = def(basicLand('Island', 'Island', 'U'));
export const swamp = def(basicLand('Swamp', 'Swamp', 'B'));
export const mountain = def(basicLand('Mountain', 'Mountain', 'R'));
export const forest = def(basicLand('Forest', 'Forest', 'G'));

// -------------------------------------------------------------- creatures
export const ragingGoblin = def({
  id: 'raging-goblin',
  name: 'Raging Goblin',
  manaCost: '{R}',
  types: ['Creature'],
  subtypes: ['Goblin', 'Berserker'],
  colors: ['R'],
  power: 1,
  toughness: 1,
  keywords: ['haste'],
  text: 'Haste',
  automation: 'full',
});

export const grizzlyBears = def({
  id: 'grizzly-bears',
  name: 'Grizzly Bears',
  manaCost: '{1}{G}',
  types: ['Creature'],
  subtypes: ['Bear'],
  colors: ['G'],
  power: 2,
  toughness: 2,
  automation: 'full',
});

export const stormCrow = def({
  id: 'storm-crow',
  name: 'Storm Crow',
  manaCost: '{1}{U}',
  types: ['Creature'],
  subtypes: ['Bird'],
  colors: ['U'],
  power: 1,
  toughness: 2,
  keywords: ['flying'],
  text: 'Flying',
  automation: 'full',
});

export const giantSpider = def({
  id: 'giant-spider',
  name: 'Giant Spider',
  manaCost: '{3}{G}',
  types: ['Creature'],
  subtypes: ['Spider'],
  colors: ['G'],
  power: 2,
  toughness: 4,
  keywords: ['reach'],
  text: 'Reach',
  automation: 'full',
});

export const elvishVisionary = def({
  id: 'elvish-visionary',
  name: 'Elvish Visionary',
  manaCost: '{1}{G}',
  types: ['Creature'],
  subtypes: ['Elf', 'Shaman'],
  colors: ['G'],
  power: 1,
  toughness: 1,
  text: 'When Elvish Visionary enters the battlefield, draw a card.',
  abilities: [
    {
      kind: 'triggered',
      trigger: { on: 'etb', self: true },
      effect: [{ op: 'draw', who: 'controller', count: 1 }],
      text: 'Quando entra no campo de batalha, compre uma carta',
    },
  ],
  automation: 'full',
});

export const doomedTraveler = def({
  id: 'doomed-traveler',
  name: 'Doomed Traveler',
  manaCost: '{W}',
  types: ['Creature'],
  subtypes: ['Human', 'Soldier'],
  colors: ['W'],
  power: 1,
  toughness: 1,
  text: 'When Doomed Traveler dies, create a 1/1 white Spirit creature token with flying.',
  abilities: [
    {
      kind: 'triggered',
      trigger: { on: 'dies', self: true },
      effect: [
        { op: 'token', who: 'controller', count: 1, name: 'Spirit', power: 1, toughness: 1, colors: ['W'], subtypes: ['Spirit'], keywords: ['flying'] },
      ],
      text: 'Quando morre, crie uma ficha de Espírito 1/1 com voar',
    },
  ],
  automation: 'full',
});

export const vampireNighthawk = def({
  id: 'vampire-nighthawk',
  name: 'Vampire Nighthawk',
  manaCost: '{1}{B}{B}',
  types: ['Creature'],
  subtypes: ['Vampire', 'Shaman'],
  colors: ['B'],
  power: 2,
  toughness: 3,
  keywords: ['flying', 'deathtouch', 'lifelink'],
  text: 'Flying, deathtouch, lifelink',
  automation: 'full',
});

export const alleyStrangler = def({
  id: 'alley-strangler',
  name: 'Alley Strangler',
  manaCost: '{2}{B}',
  types: ['Creature'],
  subtypes: ['Aetherborn', 'Rogue'],
  colors: ['B'],
  power: 2,
  toughness: 3,
  keywords: ['menace'],
  text: 'Menace',
  automation: 'full',
});

export const serraAngel = def({
  id: 'serra-angel',
  name: 'Serra Angel',
  manaCost: '{3}{W}{W}',
  types: ['Creature'],
  subtypes: ['Angel'],
  colors: ['W'],
  power: 4,
  toughness: 4,
  keywords: ['flying', 'vigilance'],
  text: 'Flying, vigilance',
  automation: 'full',
});

export const colossalDreadmaw = def({
  id: 'colossal-dreadmaw',
  name: 'Colossal Dreadmaw',
  manaCost: '{4}{G}{G}',
  types: ['Creature'],
  subtypes: ['Dinosaur'],
  colors: ['G'],
  power: 6,
  toughness: 6,
  keywords: ['trample'],
  text: 'Trample',
  automation: 'full',
});

export const prodigalPyromancer = def({
  id: 'prodigal-pyromancer',
  name: 'Prodigal Pyromancer',
  manaCost: '{2}{R}',
  types: ['Creature'],
  subtypes: ['Human', 'Wizard'],
  colors: ['R'],
  power: 1,
  toughness: 1,
  text: '{T}: Prodigal Pyromancer deals 1 damage to any target.',
  abilities: [
    {
      kind: 'activated',
      cost: { tap: true },
      targets: [{ what: 'any' }],
      effect: [{ op: 'damage', to: 'target:0', amount: 1 }],
      text: 'Causa 1 de dano a qualquer alvo',
    },
  ],
  automation: 'full',
});

export const youthfulKnight = def({
  id: 'youthful-knight',
  name: 'Youthful Knight',
  manaCost: '{1}{W}',
  types: ['Creature'],
  subtypes: ['Human', 'Knight'],
  colors: ['W'],
  power: 2,
  toughness: 1,
  keywords: ['firstStrike'],
  text: 'First strike',
  automation: 'full',
});

export const fencingAce = def({
  id: 'fencing-ace',
  name: 'Fencing Ace',
  manaCost: '{1}{W}',
  types: ['Creature'],
  subtypes: ['Human', 'Soldier'],
  colors: ['W'],
  power: 1,
  toughness: 1,
  keywords: ['doubleStrike'],
  text: 'Double strike',
  automation: 'full',
});

// --------------------------------------------------------------- auras
export const pacifism = def({
  id: 'pacifism',
  name: 'Pacifism',
  manaCost: '{1}{W}',
  types: ['Enchantment'],
  subtypes: ['Aura'],
  colors: ['W'],
  text: "Enchant creature. Enchanted creature can't attack or block.",
  enchant: { what: 'creature' },
  attachEffect: { cantAttack: true, cantBlock: true },
  automation: 'full',
});

// ------------------------------------------------------------- artifacts
export const bonesplitter = def({
  id: 'bonesplitter',
  name: 'Bonesplitter',
  manaCost: '{1}',
  types: ['Artifact'],
  subtypes: ['Equipment'],
  colors: [],
  text: 'Equipped creature gets +2/+0. Equip {1}',
  attachEffect: { power: 2, toughness: 0 },
  abilities: [
    {
      kind: 'activated',
      cost: { mana: '{1}' },
      targets: [{ what: 'creature', controlledBy: 'you' }],
      effect: [{ op: 'attach' }],
      text: 'Equipar criatura que você controla (+2/+0)',
      sorceryOnly: true,
    },
  ],
  automation: 'full',
});

export const fountainOfRenewal = def({
  id: 'fountain-of-renewal',
  name: 'Fountain of Renewal',
  manaCost: '{1}',
  types: ['Artifact'],
  subtypes: [],
  colors: [],
  text: 'At the beginning of your upkeep, you gain 1 life.',
  abilities: [
    {
      kind: 'triggered',
      trigger: { on: 'upkeep', whose: 'controller' },
      effect: [{ op: 'gainLife', who: 'controller', amount: 1 }],
      text: 'No início da sua manutenção, você ganha 1 ponto de vida',
    },
  ],
  automation: 'full',
});

// ----------------------------------------------------------------- spells
export const lightningBolt = def({
  id: 'lightning-bolt',
  name: 'Lightning Bolt',
  manaCost: '{R}',
  types: ['Instant'],
  subtypes: [],
  colors: ['R'],
  text: 'Lightning Bolt deals 3 damage to any target.',
  spellTargets: [{ what: 'any' }],
  spellEffect: [{ op: 'damage', to: 'target:0', amount: 3 }],
  automation: 'full',
});

export const shock = def({
  id: 'shock',
  name: 'Shock',
  manaCost: '{R}',
  types: ['Instant'],
  subtypes: [],
  colors: ['R'],
  text: 'Shock deals 2 damage to any target.',
  spellTargets: [{ what: 'any' }],
  spellEffect: [{ op: 'damage', to: 'target:0', amount: 2 }],
  automation: 'full',
});

export const giantGrowth = def({
  id: 'giant-growth',
  name: 'Giant Growth',
  manaCost: '{G}',
  types: ['Instant'],
  subtypes: [],
  colors: ['G'],
  text: 'Target creature gets +3/+3 until end of turn.',
  spellTargets: [{ what: 'creature' }],
  spellEffect: [{ op: 'pump', what: 'target:0', power: 3, toughness: 3 }],
  automation: 'full',
});

export const murder = def({
  id: 'murder',
  name: 'Murder',
  manaCost: '{1}{B}{B}',
  types: ['Instant'],
  subtypes: [],
  colors: ['B'],
  text: 'Destroy target creature.',
  spellTargets: [{ what: 'creature' }],
  spellEffect: [{ op: 'destroy', what: 'target:0' }],
  automation: 'full',
});

export const cancel = def({
  id: 'cancel',
  name: 'Cancel',
  manaCost: '{1}{U}{U}',
  types: ['Instant'],
  subtypes: [],
  colors: ['U'],
  text: 'Counter target spell.',
  spellTargets: [{ what: 'spell' }],
  spellEffect: [{ op: 'counterSpell', what: 'target:0' }],
  automation: 'full',
});

export const unsummon = def({
  id: 'unsummon',
  name: 'Unsummon',
  manaCost: '{U}',
  types: ['Instant'],
  subtypes: [],
  colors: ['U'],
  text: 'Return target creature to its owner\'s hand.',
  spellTargets: [{ what: 'creature' }],
  spellEffect: [{ op: 'returnToHand', what: 'target:0' }],
  automation: 'full',
});

export const divination = def({
  id: 'divination',
  name: 'Divination',
  manaCost: '{2}{U}',
  types: ['Sorcery'],
  subtypes: [],
  colors: ['U'],
  text: 'Draw two cards.',
  spellEffect: [{ op: 'draw', who: 'controller', count: 2 }],
  automation: 'full',
});

export const revitalize = def({
  id: 'revitalize',
  name: 'Revitalize',
  manaCost: '{1}{W}',
  types: ['Instant'],
  subtypes: [],
  colors: ['W'],
  text: 'You gain 3 life. Draw a card.',
  spellEffect: [
    { op: 'gainLife', who: 'controller', amount: 3 },
    { op: 'draw', who: 'controller', count: 1 },
  ],
  automation: 'full',
});

export const raiseTheAlarm = def({
  id: 'raise-the-alarm',
  name: 'Raise the Alarm',
  manaCost: '{1}{W}',
  types: ['Instant'],
  subtypes: [],
  colors: ['W'],
  text: 'Create two 1/1 white Soldier creature tokens.',
  spellEffect: [
    { op: 'token', who: 'controller', count: 2, name: 'Soldier', power: 1, toughness: 1, colors: ['W'], subtypes: ['Soldier'] },
  ],
  automation: 'full',
});

export const krenkosCommand = def({
  id: 'krenkos-command',
  name: "Krenko's Command",
  manaCost: '{1}{R}',
  types: ['Sorcery'],
  subtypes: [],
  colors: ['R'],
  text: 'Create two 1/1 red Goblin creature tokens.',
  spellEffect: [
    { op: 'token', who: 'controller', count: 2, name: 'Goblin', power: 1, toughness: 1, colors: ['R'], subtypes: ['Goblin'] },
  ],
  automation: 'full',
});

// ------------------------------------------------------------ demo decks
function copies(card: CardDefinition, n: number): CardDefinition[] {
  return Array.from({ length: n }, () => card);
}

/** "Gruul Smash" — aggressive red/green demo deck (40 cards). */
export function demoDeckGruul(): DeckList {
  return {
    cards: [
      ...copies(mountain, 9),
      ...copies(forest, 8),
      ...copies(ragingGoblin, 4),
      ...copies(grizzlyBears, 4),
      ...copies(giantSpider, 3),
      ...copies(colossalDreadmaw, 2),
      ...copies(lightningBolt, 4),
      ...copies(giantGrowth, 3),
      ...copies(krenkosCommand, 1),
      ...copies(bonesplitter, 2),
    ],
  };
}

/** "Azorius Wings" — white/blue tempo demo deck (40 cards). */
export function demoDeckAzorius(): DeckList {
  return {
    cards: [
      ...copies(plains, 8),
      ...copies(island, 8),
      ...copies(stormCrow, 4),
      ...copies(youthfulKnight, 2),
      ...copies(serraAngel, 2),
      ...copies(raiseTheAlarm, 3),
      ...copies(unsummon, 3),
      ...copies(cancel, 3),
      ...copies(divination, 2),
      ...copies(pacifism, 2),
      ...copies(revitalize, 2),
      ...copies(fountainOfRenewal, 1),
    ],
  };
}
