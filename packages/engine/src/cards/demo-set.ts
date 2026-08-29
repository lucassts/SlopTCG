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

// ----------------------------------------------------- M2: mass effects
export const pyroclasm = def({
  id: 'pyroclasm',
  name: 'Pyroclasm',
  manaCost: '{1}{R}',
  types: ['Sorcery'],
  subtypes: [],
  colors: ['R'],
  text: 'Pyroclasm deals 2 damage to each creature.',
  spellEffect: [{ op: 'damageEach', filter: { what: 'creature', controlledBy: 'any' }, amount: 2 }],
  automation: 'full',
});

export const dayOfJudgment = def({
  id: 'day-of-judgment',
  name: 'Day of Judgment',
  manaCost: '{2}{W}{W}',
  types: ['Sorcery'],
  subtypes: [],
  colors: ['W'],
  text: 'Destroy all creatures.',
  spellEffect: [{ op: 'destroyEach', filter: { what: 'creature', controlledBy: 'any' } }],
  automation: 'full',
});

export const overrun = def({
  id: 'overrun',
  name: 'Overrun',
  manaCost: '{2}{G}{G}{G}',
  types: ['Sorcery'],
  subtypes: [],
  colors: ['G'],
  text: 'Creatures you control get +3/+3 and gain trample until end of turn.',
  spellEffect: [
    { op: 'pumpEach', filter: { what: 'creature', controlledBy: 'you' }, power: 3, toughness: 3, keywords: ['trample'] },
  ],
  automation: 'full',
});

// -------------------------------------------------- M2: choices (pausas)
export const mindRot = def({
  id: 'mind-rot',
  name: 'Mind Rot',
  manaCost: '{2}{B}',
  types: ['Sorcery'],
  subtypes: [],
  colors: ['B'],
  text: 'Target player discards two cards.',
  spellTargets: [{ what: 'player' }],
  spellEffect: [{ op: 'discard', who: 'target:0', count: 2 }],
  automation: 'full',
});

export const diabolicEdict = def({
  id: 'diabolic-edict',
  name: 'Diabolic Edict',
  manaCost: '{1}{B}',
  types: ['Instant'],
  subtypes: [],
  colors: ['B'],
  text: 'Target player sacrifices a creature.',
  spellTargets: [{ what: 'player' }],
  spellEffect: [{ op: 'sacrifice', who: 'target:0', filter: { what: 'creature' }, count: 1 }],
  automation: 'full',
});

export const opt = def({
  id: 'opt',
  name: 'Opt',
  manaCost: '{U}',
  types: ['Instant'],
  subtypes: [],
  colors: ['U'],
  text: 'Scry 1. Draw a card.',
  spellEffect: [
    { op: 'scry', count: 1 },
    { op: 'draw', who: 'controller', count: 1 },
  ],
  automation: 'full',
});

export const preordain = def({
  id: 'preordain',
  name: 'Preordain',
  manaCost: '{U}',
  types: ['Sorcery'],
  subtypes: [],
  colors: ['U'],
  text: 'Scry 2, then draw a card.',
  spellEffect: [
    { op: 'scry', count: 2 },
    { op: 'draw', who: 'controller', count: 1 },
  ],
  automation: 'full',
});

export const rampantGrowth = def({
  id: 'rampant-growth',
  name: 'Rampant Growth',
  manaCost: '{1}{G}',
  types: ['Sorcery'],
  subtypes: [],
  colors: ['G'],
  text: 'Search your library for a basic land card, put that card onto the battlefield tapped, then shuffle.',
  spellEffect: [{ op: 'search', filter: { what: 'land', basic: true }, count: 1, to: 'battlefield', tapped: true }],
  automation: 'full',
});

export const diabolicTutor = def({
  id: 'diabolic-tutor',
  name: 'Diabolic Tutor',
  manaCost: '{2}{B}{B}',
  types: ['Sorcery'],
  subtypes: [],
  colors: ['B'],
  text: 'Search your library for a card, put that card into your hand, then shuffle.',
  spellEffect: [{ op: 'search', count: 1, to: 'hand' }],
  automation: 'full',
});

export const raiseDead = def({
  id: 'raise-dead',
  name: 'Raise Dead',
  manaCost: '{B}',
  types: ['Sorcery'],
  subtypes: [],
  colors: ['B'],
  text: 'Return target creature card from your graveyard to your hand.',
  spellTargets: [{ what: 'creature', zone: 'graveyard', ownedBy: 'you' }],
  spellEffect: [{ op: 'returnToHand', what: 'target:0' }],
  automation: 'full',
});

export const preyUpon = def({
  id: 'prey-upon',
  name: 'Prey Upon',
  manaCost: '{G}',
  types: ['Sorcery'],
  subtypes: [],
  colors: ['G'],
  text: "Target creature you control fights target creature you don't control.",
  spellTargets: [
    { what: 'creature', controlledBy: 'you' },
    { what: 'creature', controlledBy: 'opponent' },
  ],
  spellEffect: [{ op: 'fight', a: 'target:0', b: 'target:1' }],
  automation: 'full',
});

// ------------------------------------------------ M2: gatilhos globais
export const zulaportCutthroat = def({
  id: 'zulaport-cutthroat',
  name: 'Zulaport Cutthroat',
  manaCost: '{1}{B}',
  types: ['Creature'],
  subtypes: ['Human', 'Rogue', 'Ally'],
  colors: ['B'],
  power: 1,
  toughness: 1,
  text: 'Whenever Zulaport Cutthroat or another creature you control dies, each opponent loses 1 life and you gain 1 life.',
  abilities: [
    {
      kind: 'triggered',
      trigger: { on: 'dies', what: { what: 'creature', controlledBy: 'you' } },
      effect: [
        { op: 'loseLife', who: 'opponent', amount: 1 },
        { op: 'gainLife', who: 'controller', amount: 1 },
      ],
      text: 'Quando uma criatura sua morre, o oponente perde 1 e você ganha 1 ponto de vida',
    },
  ],
  automation: 'full',
});

export const soulWarden = def({
  id: 'soul-warden',
  name: 'Soul Warden',
  manaCost: '{W}',
  types: ['Creature'],
  subtypes: ['Human', 'Cleric'],
  colors: ['W'],
  power: 1,
  toughness: 1,
  text: 'Whenever another creature enters the battlefield, you gain 1 life.',
  abilities: [
    {
      kind: 'triggered',
      trigger: { on: 'etb', what: { what: 'creature', controlledBy: 'any', other: true } },
      effect: [{ op: 'gainLife', who: 'controller', amount: 1 }],
      text: 'Quando outra criatura entra no campo de batalha, você ganha 1 ponto de vida',
    },
  ],
  automation: 'full',
});

export const monasterySwiftspear = def({
  id: 'monastery-swiftspear',
  name: 'Monastery Swiftspear',
  manaCost: '{R}',
  types: ['Creature'],
  subtypes: ['Human', 'Monk'],
  colors: ['R'],
  power: 1,
  toughness: 2,
  keywords: ['haste'],
  text: 'Haste. Prowess (Whenever you cast a noncreature spell, this creature gets +1/+1 until end of turn.)',
  abilities: [
    {
      kind: 'triggered',
      trigger: { on: 'youCastSpell', noncreatureOnly: true },
      effect: [{ op: 'pump', what: 'self', power: 1, toughness: 1 }],
      text: 'Destreza: +1/+1 até o fim do turno',
    },
  ],
  automation: 'full',
});

// --------------------------------------------------- M2: estáticas (lords)
export const gloriousAnthem = def({
  id: 'glorious-anthem',
  name: 'Glorious Anthem',
  manaCost: '{1}{W}{W}',
  types: ['Enchantment'],
  subtypes: [],
  colors: ['W'],
  text: 'Creatures you control get +1/+1.',
  abilities: [
    {
      kind: 'static',
      filter: { what: 'creature', controlledBy: 'you' },
      power: 1,
      toughness: 1,
      text: 'Criaturas que você controla recebem +1/+1',
    },
  ],
  automation: 'full',
});

export const goblinChieftain = def({
  id: 'goblin-chieftain',
  name: 'Goblin Chieftain',
  manaCost: '{1}{R}{R}',
  types: ['Creature'],
  subtypes: ['Goblin'],
  colors: ['R'],
  power: 2,
  toughness: 2,
  keywords: ['haste'],
  text: 'Haste. Other Goblins you control get +1/+1 and have haste.',
  abilities: [
    {
      kind: 'static',
      filter: { what: 'creature', subtype: 'Goblin', controlledBy: 'you', other: true },
      power: 1,
      toughness: 1,
      keywords: ['haste'],
      text: 'Outros Goblins que você controla recebem +1/+1 e têm ímpeto',
    },
  ],
  automation: 'full',
});

// ------------------------------------------------------------- M2: X e afins
export const blaze = def({
  id: 'blaze',
  name: 'Blaze',
  manaCost: '{X}{R}',
  types: ['Sorcery'],
  subtypes: [],
  colors: ['R'],
  text: 'Blaze deals X damage to any target.',
  spellTargets: [{ what: 'any' }],
  spellEffect: [{ op: 'damage', to: 'target:0', amount: 'X' }],
  automation: 'full',
});

export const endlessOne = def({
  id: 'endless-one',
  name: 'Endless One',
  manaCost: '{X}',
  types: ['Creature'],
  subtypes: ['Eldrazi'],
  colors: [],
  power: 0,
  toughness: 0,
  text: 'Endless One enters the battlefield with X +1/+1 counters on it.',
  entersWithCounters: { counter: '+1/+1', count: 'X' },
  automation: 'full',
});

export const battlegrowth = def({
  id: 'battlegrowth',
  name: 'Battlegrowth',
  manaCost: '{G}',
  types: ['Instant'],
  subtypes: [],
  colors: ['G'],
  text: 'Put a +1/+1 counter on target creature.',
  spellTargets: [{ what: 'creature' }],
  spellEffect: [{ op: 'putCounters', what: 'target:0', counter: '+1/+1', count: 1 }],
  automation: 'full',
});

// -------------------------------------------------------------- M2: modal
export const grixisCharm = def({
  id: 'grixis-charm',
  name: 'Grixis Charm',
  manaCost: '{U}{B}{R}',
  types: ['Instant'],
  subtypes: [],
  colors: ['U', 'B', 'R'],
  text: "Choose one — Return target permanent to its owner's hand; or target creature gets -4/-4 until end of turn; or creatures you control get +2/+0 until end of turn.",
  spellModes: [
    {
      label: 'Devolver permanente alvo para a mão do dono',
      targets: [{ what: 'permanent' }],
      effect: [{ op: 'returnToHand', what: 'target:0' }],
    },
    {
      label: 'Criatura alvo recebe -4/-4 até o fim do turno',
      targets: [{ what: 'creature' }],
      effect: [{ op: 'pump', what: 'target:0', power: -4, toughness: -4 }],
    },
    {
      label: 'Criaturas que você controla recebem +2/+0 até o fim do turno',
      effect: [{ op: 'pumpEach', filter: { what: 'creature', controlledBy: 'you' }, power: 2, toughness: 0 }],
    },
  ],
  automation: 'full',
});

// ------------------------------------------------------------- M3: storm
export const grapeshot = def({
  id: 'grapeshot',
  name: 'Grapeshot',
  manaCost: '{1}{R}',
  types: ['Sorcery'],
  subtypes: [],
  colors: ['R'],
  text: 'Grapeshot deals 1 damage to any target. Storm',
  storm: true,
  spellTargets: [{ what: 'any' }],
  spellEffect: [{ op: 'damage', to: 'target:0', amount: 1 }],
  automation: 'full',
});

export const emptyTheWarrens = def({
  id: 'empty-the-warrens',
  name: 'Empty the Warrens',
  manaCost: '{3}{R}',
  types: ['Sorcery'],
  subtypes: [],
  colors: ['R'],
  text: 'Create two 1/1 red Goblin creature tokens. Storm',
  storm: true,
  spellEffect: [
    { op: 'token', who: 'controller', count: 2, name: 'Goblin', power: 1, toughness: 1, colors: ['R'], subtypes: ['Goblin'] },
  ],
  automation: 'full',
});

// ------------------------------------------- M3: gatilhos com alvo (ETB)
export const flametongueKavu = def({
  id: 'flametongue-kavu',
  name: 'Flametongue Kavu',
  manaCost: '{3}{R}',
  types: ['Creature'],
  subtypes: ['Kavu'],
  colors: ['R'],
  power: 4,
  toughness: 2,
  text: 'When Flametongue Kavu enters the battlefield, it deals 4 damage to target creature.',
  abilities: [
    {
      kind: 'triggered',
      trigger: { on: 'etb', self: true },
      targets: [{ what: 'creature' }],
      effect: [{ op: 'damage', to: 'target:0', amount: 4 }],
      text: 'Quando entra no campo de batalha, causa 4 de dano à criatura alvo',
    },
  ],
  automation: 'full',
});

export const ravenousChupacabra = def({
  id: 'ravenous-chupacabra',
  name: 'Ravenous Chupacabra',
  manaCost: '{2}{B}{B}',
  types: ['Creature'],
  subtypes: ['Beast', 'Horror'],
  colors: ['B'],
  power: 2,
  toughness: 2,
  text: 'When Ravenous Chupacabra enters the battlefield, destroy target creature an opponent controls.',
  abilities: [
    {
      kind: 'triggered',
      trigger: { on: 'etb', self: true },
      targets: [{ what: 'creature', controlledBy: 'opponent' }],
      effect: [{ op: 'destroy', what: 'target:0' }],
      text: 'Quando entra no campo de batalha, destrua a criatura alvo de um oponente',
    },
  ],
  automation: 'full',
});

// ------------------------------------------------- M3: custos adicionais
export const fling = def({
  id: 'fling',
  name: 'Fling',
  manaCost: '{1}{R}',
  types: ['Instant'],
  subtypes: [],
  colors: ['R'],
  text: 'As an additional cost to cast this spell, sacrifice a creature. Fling deals damage equal to the sacrificed creature\'s power to any target.',
  additionalCost: { sacrifice: { what: 'creature' } },
  spellTargets: [{ what: 'any' }],
  spellEffect: [{ op: 'damage', to: 'target:0', amount: 'sacrificedPower' }],
  automation: 'full',
});

// ------------------------------------- M3: proteções e prevenção de dano
export const darksteelMyr = def({
  id: 'darksteel-myr',
  name: 'Darksteel Myr',
  manaCost: '{3}',
  types: ['Artifact', 'Creature'],
  subtypes: ['Myr'],
  colors: [],
  power: 0,
  toughness: 3,
  keywords: ['indestructible'],
  text: 'Indestructible',
  automation: 'full',
});

export const gladecoverScout = def({
  id: 'gladecover-scout',
  name: 'Gladecover Scout',
  manaCost: '{G}',
  types: ['Creature'],
  subtypes: ['Elf', 'Scout'],
  colors: ['G'],
  power: 1,
  toughness: 1,
  keywords: ['hexproof'],
  text: 'Hexproof',
  automation: 'full',
});

export const fog = def({
  id: 'fog',
  name: 'Fog',
  manaCost: '{G}',
  types: ['Instant'],
  subtypes: [],
  colors: ['G'],
  text: 'Prevent all combat damage that would be dealt this turn.',
  spellEffect: [{ op: 'preventCombatDamage' }],
  automation: 'full',
});

// ------------------------------------------------ M3: controle e cópias
export const actOfTreason = def({
  id: 'act-of-treason',
  name: 'Act of Treason',
  manaCost: '{2}{R}',
  types: ['Sorcery'],
  subtypes: [],
  colors: ['R'],
  text: 'Gain control of target creature until end of turn. Untap it. It gains haste until end of turn.',
  spellTargets: [{ what: 'creature' }],
  spellEffect: [
    { op: 'gainControl', what: 'target:0', untilEndOfTurn: true },
    { op: 'untap', what: 'target:0' },
    { op: 'pump', what: 'target:0', power: 0, toughness: 0, keywords: ['haste'] },
  ],
  automation: 'full',
});

export const twincast = def({
  id: 'twincast',
  name: 'Twincast',
  manaCost: '{U}{U}',
  types: ['Instant'],
  subtypes: [],
  colors: ['U'],
  text: 'Copy target instant or sorcery spell. You may choose new targets for the copy.',
  spellTargets: [{ what: 'spell' }],
  spellEffect: [{ op: 'copySpell', what: 'target:0' }],
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
