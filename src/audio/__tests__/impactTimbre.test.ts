import { describe, it, expect } from 'vitest'
import { flavorFingerprint, type Flavor, type FlavorFingerprint } from '../impacts'

/**
 * WEIGHT-CLASS TIMBRE IDENTITY (design gate).
 *
 * The shipped defect: `flavorForHit` voiced medium/heavy/sweep/launcher on ONE
 * `heavy` synth at rising volume, so four of six weight classes were the same
 * sound at different loudness. This suite proves the AUTHORED specs are now
 * timbrally DISTINCT and hold their design invariants.
 *
 * This is a DESIGN proxy computed from each spec's layers — the vitest
 * environment has no `OfflineAudioContext`, so it cannot render PCM. The RENDER
 * itself is proved distinct (noise-averaged, at matched loudness) by
 * tools/measure-impact-timbre.mjs --assert, which is the outcome gate. The two
 * agree on the load-bearing invariants (sweep darkest, launcher brightest,
 * medium shortest tail, launcher's rising body).
 */

// Fixed physical scales so a distance is comparable across the four descriptors.
const SCALE = { centroid: 2000, low: 1, atk: 1, tail: 0.3 }

function fpDist(a: FlavorFingerprint, b: FlavorFingerprint): number {
  const dc = (a.centroid - b.centroid) / SCALE.centroid
  const dl = (a.low - b.low) / SCALE.low
  const da = (a.atk - b.atk) / SCALE.atk
  const dt = (a.tail - b.tail) / SCALE.tail
  return Math.hypot(dc, dl, da, dt)
}

// The four heavy-family weight classes that used to collapse onto `heavy`.
const FAMILY: Flavor[] = ['medium', 'heavy', 'sweep', 'launcher']
const fp = Object.fromEntries(FAMILY.map((f) => [f, flavorFingerprint(f)])) as Record<Flavor, FlavorFingerprint>

// Minimum separation a genuinely distinct pair must clear. The tightest real
// pair (heavy/sweep) sits at ~0.22; the collapsed defect sits at 0. The bar is
// set below the real minimum and well above 0 so a re-collapse reddens.
const MIN_SEP = 0.12

describe('weight-class timbre identity — design fingerprints', () => {
  it('is deterministic (non-vacuity: identical flavour → identical fingerprint, distance 0)', () => {
    expect(fpDist(flavorFingerprint('heavy'), flavorFingerprint('heavy'))).toBe(0)
    expect(fpDist(flavorFingerprint('sweep'), flavorFingerprint('sweep'))).toBe(0)
  })

  it('responds to a known-distinct pair (light vs heavy are far apart)', () => {
    expect(fpDist(flavorFingerprint('light'), fp.heavy)).toBeGreaterThan(MIN_SEP)
  })

  it('gives every weight class a distinct timbre — all six family pairs separated', () => {
    const pairs: Array<[Flavor, Flavor]> = [
      ['medium', 'heavy'], ['medium', 'sweep'], ['medium', 'launcher'],
      ['heavy', 'sweep'], ['heavy', 'launcher'], ['sweep', 'launcher'],
    ]
    for (const [a, b] of pairs) {
      expect(fpDist(fp[a], fp[b]), `${a} vs ${b} must be timbrally distinct`).toBeGreaterThan(MIN_SEP)
    }
  })

  it('holds the design invariants: sweep darkest, launcher brightest, medium tightest tail', () => {
    const centroids = FAMILY.map((f) => fp[f].centroid)
    expect(fp.sweep.centroid).toBe(Math.min(...centroids)) // dark low scythe
    expect(fp.launcher.centroid).toBe(Math.max(...centroids)) // bright airy lift
    const tails = FAMILY.map((f) => fp[f].tail)
    expect(fp.medium.tail).toBe(Math.min(...tails)) // tight immediate snap
  })

  it("gives the launcher its signature RISING body (f0 < f1) — unique in the family", () => {
    expect(fp.launcher.bodyRising).toBe(true)
    expect(fp.medium.bodyRising).toBe(false)
    expect(fp.heavy.bodyRising).toBe(false)
    expect(fp.sweep.bodyRising).toBe(false)
  })

  it('rejects a composite flavour (no single spec to fingerprint)', () => {
    expect(() => flavorFingerprint('ko')).toThrow()
    expect(() => flavorFingerprint('combo')).toThrow()
  })
})
