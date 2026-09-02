/**
 * The four dungeons (AFR + CLB's Undercity). Each room is an effect script
 * run when the player enters it; `next` lists the rooms reachable from it.
 * A few rooms are approximated where the DSL has no exact primitive; the
 * approximation is noted on the room.
 */
import type { EffectScript, TargetSpec } from './cards/types.js';

export interface DungeonRoom {
  name: string;
  targets?: TargetSpec[];
  effect: EffectScript;
  next: number[];
  /** Simplification applied (shown in the log). */
  note?: string;
}

export interface Dungeon {
  name: string;
  rooms: DungeonRoom[];
}

const treasure: EffectScript = [{ op: 'namedToken', who: 'controller', kind: 'Treasure', count: 1 }];
const lose2UnlessDiscard = (who: 'controller' | 'opponent'): EffectScript => [
  { op: 'mayDo', who: who === 'opponent' ? 'opponent' : undefined, prompt: 'descartar uma carta em vez de perder 2 pontos de vida?', effect: [{ op: 'discard', who, count: 1 }], else: [{ op: 'loseLife', who, amount: 2 }] },
];
const lose2UnlessSac = (who: 'controller' | 'opponent'): EffectScript => [
  { op: 'mayDo', who: who === 'opponent' ? 'opponent' : undefined, prompt: 'sacrificar um artefato, criatura ou terreno em vez de perder 2 pontos de vida?', effect: [{ op: 'sacrifice', who, filter: { typeAnyOf: ['Artifact', 'Creature', 'Land'] }, count: 1 }], else: [{ op: 'loseLife', who, amount: 2 }] },
];

export const DUNGEONS: Dungeon[] = [
  {
    name: 'Lost Mine of Phandelver',
    rooms: [
      { name: 'Cave Entrance', effect: [{ op: 'scry', count: 1 }], next: [1, 2] },
      { name: 'Goblin Lair', effect: [{ op: 'token', who: 'controller', count: 1, name: 'Goblin', power: 1, toughness: 1, colors: ['R'], subtypes: ['Goblin'] }], next: [3, 4] },
      { name: 'Mine Tunnels', effect: treasure, next: [3, 4] },
      { name: 'Storeroom', targets: [{ what: 'creature' }], effect: [{ op: 'putCounters', what: 'target:0', counter: '+1/+1', count: 1 }], next: [5, 6] },
      { name: 'Dark Pool', effect: [{ op: 'loseLife', who: 'opponent', amount: 1 }, { op: 'gainLife', who: 'controller', amount: 1 }], next: [5, 6] },
      { name: 'Fungi Cavern', targets: [{ what: 'creature' }], effect: [{ op: 'pump', what: 'target:0', power: -4, toughness: 0 }], next: [], note: '-4/-0 até o fim do turno (em vez de até o seu próximo turno)' },
      { name: 'Temple of Dumathoin', effect: [{ op: 'draw', who: 'controller', count: 1 }], next: [] },
    ],
  },
  {
    name: 'Tomb of Annihilation',
    rooms: [
      { name: 'Trapped Entrance', effect: [{ op: 'loseLife', who: 'each', amount: 1 }], next: [1, 2] },
      { name: 'Veils of Fear', effect: [...lose2UnlessDiscard('controller'), ...lose2UnlessDiscard('opponent')], next: [3] },
      { name: 'Oubliette', effect: [{ op: 'discard', who: 'controller', count: 1 }, { op: 'sacrifice', who: 'controller', filter: { what: 'artifact' }, count: 1 }, { op: 'sacrifice', who: 'controller', filter: { what: 'creature' }, count: 1 }, { op: 'sacrifice', who: 'controller', filter: { what: 'land' }, count: 1 }], next: [4] },
      { name: 'Sandfall Cell', effect: [...lose2UnlessSac('controller'), ...lose2UnlessSac('opponent')], next: [] },
      { name: 'Cradle of the Death God', effect: [{ op: 'token', who: 'controller', count: 1, name: 'The Atropal', power: 4, toughness: 4, colors: ['B'], subtypes: ['God', 'Horror'], keywords: ['deathtouch'] }], next: [] },
    ],
  },
  {
    name: 'Dungeon of the Mad Mage',
    rooms: [
      { name: 'Yawning Portal', effect: [{ op: 'gainLife', who: 'controller', amount: 1 }], next: [1] },
      { name: 'Dungeon Level 1', effect: [{ op: 'scry', count: 1 }], next: [2, 3] },
      { name: 'Goblin Bazaar', effect: treasure, next: [4] },
      { name: 'Twisted Caverns', targets: [{ what: 'creature' }], effect: [{ op: 'goad', what: 'target:0' }], next: [4], note: 'a criatura fica marcada como "não pode atacar até o seu próximo turno"' },
      { name: 'Lost Level', effect: [{ op: 'scry', count: 2 }], next: [5, 6] },
      { name: 'Runestone Caverns', effect: [{ op: 'impulse', count: 2 }], next: [7] },
      { name: "Muiral's Graveyard", effect: [{ op: 'token', who: 'controller', count: 2, name: 'Skeleton', power: 1, toughness: 1, colors: ['B'], subtypes: ['Skeleton'], keywords: ['menace'] }], next: [7] },
      { name: 'Deep Mines', effect: [{ op: 'scry', count: 3 }], next: [8] },
      { name: "Mad Wizard's Lair", effect: [{ op: 'draw', who: 'controller', count: 3 }], next: [], note: 'compra três (a conjuração grátis de uma delas fica por sua conta)' },
    ],
  },
  {
    name: 'Undercity',
    rooms: [
      { name: 'Secret Entrance', effect: [{ op: 'search', filter: { what: 'land', basic: true }, count: 1, to: 'hand' }], next: [1, 2] },
      { name: 'Forge', targets: [{ what: 'creature' }], effect: [{ op: 'putCounters', what: 'target:0', counter: '+1/+1', count: 2 }], next: [3, 4] },
      { name: 'Lost Well', effect: [{ op: 'scry', count: 2 }], next: [4, 5] },
      { name: 'Trap!', targets: [{ what: 'player' }], effect: [{ op: 'loseLife', who: 'target:0', amount: 5 }], next: [6] },
      { name: 'Arena', targets: [{ what: 'creature' }], effect: [{ op: 'goad', what: 'target:0' }], next: [6, 7] },
      { name: 'Stash', effect: treasure, next: [7] },
      { name: 'Archives', effect: [{ op: 'draw', who: 'controller', count: 1 }], next: [8] },
      { name: 'Catacombs', effect: [{ op: 'token', who: 'controller', count: 1, name: 'Skeleton', power: 4, toughness: 1, colors: ['B'], subtypes: ['Skeleton'], keywords: ['menace'] }], next: [8] },
      { name: 'Throne of the Dead Three', effect: [{ op: 'search', filter: { what: 'creature' }, count: 1, to: 'battlefield', withCounters: { counter: '+1/+1', count: 3 } }, { op: 'shuffle', who: 'controller' }], next: [], note: 'busca na biblioteca inteira (não só nas dez do topo); sem o hexproof temporário' },
    ],
  },
];

/** The Twisted Caverns room goads instead of "can't attack": both are handled by the goad op, which sets the flag. */
export const UNDERCITY = DUNGEONS[3];
