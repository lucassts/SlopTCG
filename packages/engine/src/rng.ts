/**
 * Deterministic PRNG (mulberry32). Same seed → same shuffles → replayable
 * games. State lives in GameState so serialization keeps determinism.
 */
export function nextRandom(state: number): { value: number; state: number } {
  let a = (state + 0x6d2b79f5) | 0;
  let t = a;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return { value, state: a };
}

/** Fisher–Yates shuffle returning the new RNG state. */
export function shuffle<T>(items: T[], rngState: number): { items: T[]; state: number } {
  const arr = items.slice();
  let state = rngState;
  for (let i = arr.length - 1; i > 0; i--) {
    const r = nextRandom(state);
    state = r.state;
    const j = Math.floor(r.value * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return { items: arr, state };
}
