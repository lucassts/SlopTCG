/**
 * Mana cost parsing and automatic payment (Arena-style auto-tap).
 *
 * MVP scope: generic + single colored symbols ({2}{U}{U}). Hybrid/phyrexian
 * come later. Payment uses floating mana first, then auto-taps untapped
 * lands with an intrinsic mana ability, colored requirements first.
 */
import type { GameObject, GameState, PlayerState } from './state.js';
import type { Color, ManaSymbol, PlayerId } from './types.js';
import { poolTotal } from './types.js';

export interface ParsedCost {
  generic: number;
  colored: Color[]; // one entry per colored symbol
  colorless: number; // {C} symbols
  /** Hybrid symbols: each entry is the set of colors that satisfy it ({W/U}). */
  hybrid: Color[][];
  /** Phyrexian symbols: the color, or 2 life instead ({W/P}). */
  phyrexian: Color[];
  /** Number of {X} symbols; the chosen X multiplies into generic at cast. */
  xCount: number;
}

const COLORS = ['W', 'U', 'B', 'R', 'G'] as const;
const isColor = (s: string): s is Color => (COLORS as readonly string[]).includes(s);

export function parseCost(cost: string | undefined): ParsedCost {
  const parsed: ParsedCost = { generic: 0, colored: [], colorless: 0, hybrid: [], phyrexian: [], xCount: 0 };
  if (!cost) return parsed;
  const symbols = cost.match(/\{([^}]+)\}/g) ?? [];
  for (const raw of symbols) {
    const sym = raw.slice(1, -1);
    if (/^\d+$/.test(sym)) parsed.generic += parseInt(sym, 10);
    else if (sym === 'X') parsed.xCount += 1;
    else if (sym === 'C') parsed.colorless += 1;
    else if (isColor(sym)) parsed.colored.push(sym);
    else if (/^[WUBRG]\/P$/.test(sym)) parsed.phyrexian.push(sym[0] as Color);
    else if (/^[WUBRG]\/[WUBRG]$/.test(sym)) parsed.hybrid.push([sym[0] as Color, sym[2] as Color]);
    else if (/^2\/[WUBRG]$/.test(sym)) parsed.hybrid.push([sym[2] as Color]); // {2/W}: tratado como a cor (o "2" fica para depois)
    else if (sym === 'S') parsed.generic += 1; // neve: sem distinção de fonte por enquanto
    else parsed.generic += 1; // unknown symbol: treat as generic
  }
  return parsed;
}

export function costCmc(cost: ParsedCost): number {
  return cost.generic + cost.colored.length + cost.colorless + cost.hybrid.length + cost.phyrexian.length;
}

/**
 * What a permanent can produce by tapping its intrinsic mana ability, if
 * any. Covers fixed mana ({T}: Add {G}) and free color choices (duals,
 * "any color") — but not abilities with extra costs or conditions, which
 * the player must activate deliberately.
 */
export interface ManaProduction {
  symbols: ManaSymbol[];
  /** true → all symbols at once (Sol Ring); false → pick one (duals, any color). */
  all: boolean;
}

export function manaProduction(obj: GameObject): ManaProduction | null {
  for (const a of obj.card.abilities ?? []) {
    if (a.kind !== 'activated' || !a.isManaAbility || !a.cost.tap) continue;
    if (a.cost.sacrificeSelf || a.cost.sacrifice || a.cost.payLife || a.cost.mana || a.condition) continue;
    const fixed = a.effect.find((e) => e.op === 'addMana');
    if (fixed && fixed.op === 'addMana') return { symbols: fixed.mana, all: true };
    const choice = a.effect.find((e) => e.op === 'addManaChoice');
    if (choice && choice.op === 'addManaChoice') return { symbols: choice.colors ?? [...COLORS], all: false };
  }
  return null;
}

export interface PaymentPlan {
  /** Objects to tap, each with every symbol it produces (added to the pool first). */
  taps: { objectId: number; symbol: ManaSymbol; produce: ManaSymbol[] }[];
  /** Every symbol consumed from the pool (floating + just produced). */
  fromPool: ManaSymbol[];
  /** Life paid for phyrexian symbols without a matching source. */
  lifePaid: number;
}

/**
 * Compute an automatic payment for `cost`, or null if unaffordable.
 * Greedy: colored requirements claim matching sources first, then generic
 * consumes whatever is left. Correct for single-color producers (MVP).
 */
export function planPayment(state: GameState, playerId: PlayerId, cost: ParsedCost): PaymentPlan | null {
  const player = state.players[playerId];
  const pool: Record<ManaSymbol, number> = { ...player.manaPool };
  const taps: PaymentPlan['taps'] = [];
  const fromPool: ManaSymbol[] = [];
  let lifePaid = 0;

  const sources = player.zones.battlefield
    .map((id) => state.objects[id])
    .filter((o) => !o.tapped)
    .map((o) => ({ obj: o, produces: manaProduction(o) }))
    .filter((s): s is { obj: GameObject; produces: ManaProduction } => s.produces !== null);
  const used = new Set<number>();

  const claimSource = (want: (syms: ManaSymbol[]) => ManaSymbol | null): boolean => {
    // Prefer the most constrained source (fewest options) that satisfies;
    // fixed multi-mana sources (Sol Ring) come first so nothing is wasted.
    const candidates = sources
      .filter((s) => !used.has(s.obj.id) && want(s.produces.symbols) !== null)
      .sort((a, b) => {
        const optA = a.produces.all ? 1 : a.produces.symbols.length;
        const optB = b.produces.all ? 1 : b.produces.symbols.length;
        return optA - optB;
      });
    const pick = candidates[0];
    if (!pick) return false;
    used.add(pick.obj.id);
    const sym = want(pick.produces.symbols)!;
    // Tudo que a fonte produz entra no pool; o símbolo pedido sai dele já.
    const produce = pick.produces.all ? [...pick.produces.symbols] : [sym];
    for (const p of produce) pool[p] += 1;
    pool[sym] -= 1;
    fromPool.push(sym);
    taps.push({ objectId: pick.obj.id, symbol: sym, produce });
    return true;
  };

  // Ordem: cores fixas → híbridos (qualquer das cores) → phyrexianos
  // (cor, senão 2 de vida) → {C} → genérico. Do mais restrito ao mais livre.
  const requirements: (ManaSymbol | Color[] | { phyrexian: Color } | 'generic')[] = [
    ...cost.colored,
    ...cost.hybrid,
    ...cost.phyrexian.map((c) => ({ phyrexian: c })),
    ...Array<ManaSymbol>(cost.colorless).fill('C'),
    ...Array<'generic'>(cost.generic).fill('generic'),
  ];

  for (const req of requirements) {
    if (Array.isArray(req)) {
      const fromPoolSym = req.find((c) => pool[c] > 0);
      if (fromPoolSym) {
        pool[fromPoolSym] -= 1;
        fromPool.push(fromPoolSym);
        continue;
      }
      if (claimSource((syms) => req.find((c) => syms.includes(c)) ?? null)) continue;
      return null;
    }
    if (typeof req === 'object') {
      const c = req.phyrexian;
      if (pool[c] > 0) {
        pool[c] -= 1;
        fromPool.push(c);
        continue;
      }
      if (claimSource((syms) => (syms.includes(c) ? c : null))) continue;
      if (player.life - lifePaid >= 2) {
        lifePaid += 2; // sem a cor: paga 2 de vida (phyrexiano)
        continue;
      }
      return null;
    }
    if (req !== 'generic') {
      if (pool[req] > 0) {
        pool[req] -= 1;
        fromPool.push(req);
        continue;
      }
      if (claimSource((syms) => (syms.includes(req) ? req : null))) continue;
      return null;
    }
    // generic: floating mana of any type first, then any untapped source
    const anyPool = (Object.keys(pool) as ManaSymbol[]).find((s) => pool[s] > 0);
    if (anyPool) {
      pool[anyPool] -= 1;
      fromPool.push(anyPool);
      continue;
    }
    if (claimSource((syms) => syms[0] ?? null)) continue;
    return null;
  }
  return { taps, fromPool, lifePaid };
}

export function canPay(state: GameState, playerId: PlayerId, cost: ParsedCost): boolean {
  return planPayment(state, playerId, cost) !== null;
}

export function emptyPool(player: PlayerState): boolean {
  if (poolTotal(player.manaPool) === 0) return false;
  player.manaPool = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
  return true;
}
