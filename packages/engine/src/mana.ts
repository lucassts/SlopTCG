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
  /** Number of {X} symbols; the chosen X multiplies into generic at cast. */
  xCount: number;
}

export function parseCost(cost: string | undefined): ParsedCost {
  const parsed: ParsedCost = { generic: 0, colored: [], colorless: 0, xCount: 0 };
  if (!cost) return parsed;
  const symbols = cost.match(/\{([^}]+)\}/g) ?? [];
  for (const raw of symbols) {
    const sym = raw.slice(1, -1);
    if (/^\d+$/.test(sym)) parsed.generic += parseInt(sym, 10);
    else if (sym === 'X') parsed.xCount += 1;
    else if (sym === 'C') parsed.colorless += 1;
    else if (['W', 'U', 'B', 'R', 'G'].includes(sym)) parsed.colored.push(sym as Color);
    else parsed.generic += 1; // unknown symbol: treat as generic
  }
  return parsed;
}

export function costCmc(cost: ParsedCost): number {
  return cost.generic + cost.colored.length + cost.colorless;
}

/** What a permanent can produce by tapping its intrinsic mana ability, if any. */
export function manaProduction(obj: GameObject): ManaSymbol[] | null {
  const ability = obj.card.abilities?.find(
    (a) => a.kind === 'activated' && a.isManaAbility && a.cost.tap,
  );
  if (!ability || ability.kind !== 'activated') return null;
  const step = ability.effect.find((e) => e.op === 'addMana');
  return step && step.op === 'addMana' ? step.mana : null;
}

export interface PaymentPlan {
  /** Object ids to tap, each with the symbol it will contribute. */
  taps: { objectId: number; symbol: ManaSymbol }[];
  /** Symbols consumed from the floating pool. */
  fromPool: ManaSymbol[];
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

  const sources = player.zones.battlefield
    .map((id) => state.objects[id])
    .filter((o) => !o.tapped)
    .map((o) => ({ obj: o, produces: manaProduction(o) }))
    .filter((s): s is { obj: GameObject; produces: ManaSymbol[] } => s.produces !== null);
  const used = new Set<number>();

  const claimSource = (want: (syms: ManaSymbol[]) => ManaSymbol | null): boolean => {
    // Prefer the most constrained source (fewest options) that satisfies.
    const candidates = sources
      .filter((s) => !used.has(s.obj.id) && want(s.produces) !== null)
      .sort((a, b) => a.produces.length - b.produces.length);
    const pick = candidates[0];
    if (!pick) return false;
    used.add(pick.obj.id);
    taps.push({ objectId: pick.obj.id, symbol: want(pick.produces)! });
    return true;
  };

  const requirements: (ManaSymbol | 'generic')[] = [
    ...cost.colored,
    ...Array<ManaSymbol>(cost.colorless).fill('C'),
    ...Array<'generic'>(cost.generic).fill('generic'),
  ];

  for (const req of requirements) {
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
  return { taps, fromPool };
}

export function canPay(state: GameState, playerId: PlayerId, cost: ParsedCost): boolean {
  return planPayment(state, playerId, cost) !== null;
}

export function emptyPool(player: PlayerState): boolean {
  if (poolTotal(player.manaPool) === 0) return false;
  player.manaPool = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
  return true;
}
