import { describe, it, expect } from 'vitest'
import {
  beamCrackleRow,
  beamCrackleScroll,
  BEAM_CRACKLE_PERIOD,
  BEAM_CRACKLE_SCROLL,
} from '../ProjectileFx'

/**
 * GATE — the Ion Storm super beam must CRACKLE, not read as a smooth shaft.
 *
 * THE DEFECT (measured, critic: "no crackle, a smooth shaft"). beamColumnTexture's
 * colour is a function of the across-axis only (constant along the length) and its
 * along-length alpha is one monotonic feather→plateau→taper envelope: 0 interior
 * local maxima. The only motion the beam had came from two SPATIALLY-UNIFORM global
 * oscillators in ProjectileLayer.place() (opacity flicker 16.2 Hz ±12%, thickness
 * wobble 8.7 Hz ±7%) — they brighten/thin the WHOLE bar together, so they read as a
 * breathing bar, never as crackle. Live electrical discharge needs high-frequency
 * SPATIAL structure that TRAVELS along the shaft.
 *
 * THE FIX beamCrackleRow supplies: a period-1-tileable strip with ~10 local maxima
 * (the "nodes"), scrolled muzzle→head via beamCrackleScroll and applied as an
 * alphaMap that only MULTIPLIES the beam's alpha DOWN — so it carves moving dark
 * gaps WITHOUT adding energy (it cannot regress the white-clip that beamClip gates)
 * and its peaks stay at 1.0 (the beam stays hot). This gate asserts the three
 * load-bearing properties: the row carries along-length structure (vs the smooth
 * column ≈ 0), the values are clip-safe (in (0,1], peak ≤ 1, never fully off), and
 * the scroll actually moves. A future edit that flattens the generator or freezes
 * the scroll reds here.
 *
 * Pure functions only (no GL/canvas) so this runs in vitest-node; the wiring —
 * beamCrackleTexture() → beamMat.alphaMap at spawn, repeat/offset in place() — is
 * proven by the ProjectileLayer consumption chain, not here.
 */

// Count strict interior local maxima — the physical meaning of "high-frequency
// structure along the length". A smooth monotonic envelope has 0; crackle has many.
function localMaxima(a: ArrayLike<number>): number {
  let n = 0
  for (let i = 1; i < a.length - 1; i++) {
    if (a[i] > a[i - 1] && a[i] > a[i + 1]) n++
  }
  return n
}

// Total variation per sample — flat ⇒ 0, a smooth 0→1 ramp ⇒ ~1/W, crackle ⇒ many×.
function roughness(a: ArrayLike<number>): number {
  let s = 0
  for (let i = 1; i < a.length; i++) s += Math.abs(a[i] - a[i - 1])
  return s / a.length
}

// Mirrors beamColumnTexture's along-u alpha envelope (smooth, monotonic) — the
// "before" the crackle has to beat. Kept local so a column edit can't silently
// weaken the contrast this gate relies on.
function columnAlphaAlongU(W: number): Float32Array {
  const smooth = (a: number, b: number, x: number) => {
    const t = Math.max(0, Math.min(1, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)
  }
  const out = new Float32Array(W)
  for (let x = 0; x < W; x++) {
    const u = (x + 0.5) / W
    out[x] = smooth(0, 0.12, u) * (1 - 0.3 * smooth(0.92, 1, u))
  }
  return out
}

describe('beam crackle — spatial content along the shaft', () => {
  const W = 256
  const row = beamCrackleRow(W)

  it('carries many along-length nodes where the smooth column carries none', () => {
    const crackleMax = localMaxima(row)
    const columnMax = localMaxima(columnAlphaAlongU(W))
    // Measured: crackle ≈ 10 maxima/tile, column 0. Floor at 6 leaves headroom
    // while still catching any collapse toward a smooth bar.
    expect(crackleMax).toBeGreaterThanOrEqual(6)
    expect(columnMax).toBeLessThanOrEqual(1)
    expect(crackleMax).toBeGreaterThan(columnMax + 4)
  })

  it('has real high-frequency energy the smooth column lacks', () => {
    const crackleRough = roughness(row)
    const columnRough = roughness(columnAlphaAlongU(W))
    // Measured crackle ≈ 0.017/sample vs the monotone column ≈ 0.004.
    expect(crackleRough).toBeGreaterThan(0.01)
    expect(crackleRough).toBeGreaterThan(columnRough * 2.5)
  })

  it('SELF-CHECK: the metrics go to zero on a flat strip (not a lying harness)', () => {
    const flat = new Float32Array(W).fill(1)
    expect(localMaxima(flat)).toBe(0)
    expect(roughness(flat)).toBe(0)
  })
})

describe('beam crackle — clip-safe range (cannot re-blow the highlight)', () => {
  const row = beamCrackleRow(256)

  it('never adds energy: every value is in (0, 1] with peaks at 1.0', () => {
    let min = Infinity
    let max = -Infinity
    for (const v of row) {
      min = Math.min(min, v)
      max = Math.max(max, v)
    }
    // Peak ≤ 1 is the clip-safety invariant: as an alphaMap multiplier it only ever
    // scales the beam's alpha DOWN, so it can never push a channel toward white.
    expect(max).toBeLessThanOrEqual(1.0)
    expect(max).toBeGreaterThan(0.95) // but peaks DO reach ~1 → nodes stay hot
    // Floor > 0 so the beam stays a continuous lance (gaps darken, never fully cut).
    expect(min).toBeGreaterThan(0.3)
  })

  it('respects the lo floor argument', () => {
    const lofted = beamCrackleRow(256, 0.7)
    let min = Infinity
    for (const v of lofted) min = Math.min(min, v)
    expect(min).toBeGreaterThanOrEqual(0.7 - 1e-6)
  })
})

describe('beam crackle — it moves (travelling discharge, not a static mask)', () => {
  it('scroll is strictly monotonic in the clip clock', () => {
    let prev = beamCrackleScroll(0)
    for (let f = 1; f <= 120; f++) {
      const cur = beamCrackleScroll(f)
      expect(cur).toBeLessThan(prev) // negative → flows muzzle→head, always advancing
      prev = cur
    }
  })

  it('advances at least one full tile per second (readable flow, not imperceptible)', () => {
    const perSecond = Math.abs(beamCrackleScroll(60) - beamCrackleScroll(0))
    // One tile of U == 1.0; measured ≈ 3 tiles/s. A frozen or near-zero scroll reds.
    expect(perSecond).toBeGreaterThanOrEqual(1.0)
    expect(BEAM_CRACKLE_SCROLL).toBeGreaterThan(0)
  })

  it('tiles seamlessly so the scroll has no visible seam', () => {
    // period-1 by construction (integer frequencies): u=0 and u→1 share a phase.
    const W = 4096
    const row = beamCrackleRow(W)
    expect(Math.abs(row[0] - row[W - 1])).toBeLessThan(0.02)
    expect(BEAM_CRACKLE_PERIOD).toBeGreaterThan(0)
  })
})
