/**
 * Deterministic PRNG. The sim must be replayable frame-for-frame, so nothing
 * may reach for Math.random() or the clock. Any randomness (currently only the
 * AI's decision jitter) draws from a mulberry32 generator seeded from state, so
 * the same seed always yields the same stream.
 */

export interface Rng {
  /** Next float in [0, 1). */
  next(): number
  /** Integer in [0, n). */
  int(n: number): number
  /** Current internal state — lets callers persist/restore for replays. */
  state(): number
}

/**
 * mulberry32 — a small, fast, well-distributed 32-bit generator. Chosen over
 * the platform RNG precisely because its output is a pure function of its seed.
 */
export function makeRng(seed: number): Rng {
  let s = seed >>> 0
  const next = (): number => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return {
    next,
    int: (n: number) => Math.floor(next() * n),
    state: () => s >>> 0,
  }
}
