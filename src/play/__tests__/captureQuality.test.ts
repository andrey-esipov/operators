import { describe, it, expect } from 'vitest'
import { forcedQuality, applyCaptureQuality, openCaptureSession, type AdaptiveEngine } from '../captureQuality'
import { QUALITY_ORDER, type QualityTier } from '../../three/types'

// A stand-in for Engine that mirrors the two behaviours the capture path uses:
// setAdaptiveQuality(on) flips `adaptEnabled` (exactly what Engine.ts does), and
// `quality` is a live field. Modelling adaptEnabled as STATE — not as a count of
// calls — is deliberate. The proxy this gate asserts on is the engine's
// observable adaptation state, because that is the thing a loaded box cannot
// move: it is model math, no pixel is rendered, no frame is timed. A
// call-counter would wave through a mutation that calls setAdaptiveQuality(TRUE)
// in capture mode; the state assertion below kills it.
class SpyEngine implements AdaptiveEngine {
  adaptEnabled = true
  quality: QualityTier = 'ultra'
  calls = 0
  setAdaptiveQuality(on: boolean) {
    this.calls++
    this.adaptEnabled = on
  }
}

describe('captureQuality.forcedQuality', () => {
  it('returns each valid tier when it is pinned in the URL (positive control)', () => {
    for (const tier of QUALITY_ORDER) {
      expect(forcedQuality(`?quality=${tier}`)).toBe(tier)
    }
  })

  it('returns null when no tier is pinned (anti-vacuity: normal play is not a force)', () => {
    // If forcedQuality were hardcoded to return a tier, THIS fails. Pairs with
    // the positive control above so neither a constant-tier nor a constant-null
    // stub can pass both.
    expect(forcedQuality('')).toBeNull()
    expect(forcedQuality('?stage=crisis&cpu=dummy')).toBeNull()
  })

  it('rejects a bogus quality value (must match what detectQuality treats as forced)', () => {
    // ?quality=banana is NOT a force — detectQuality ignores it and auto-detects,
    // so freezing on it would pin the wrong (auto-detected) tier.
    expect(forcedQuality('?quality=banana')).toBeNull()
    expect(forcedQuality('?quality=')).toBeNull()
    expect(forcedQuality('?quality=ULTRA')).toBeNull() // case-sensitive, matches the tier literals
  })
})

describe('captureQuality.applyCaptureQuality (decision contract)', () => {
  it('returns the pinned tier when one is forced, null otherwise', () => {
    expect(applyCaptureQuality(new SpyEngine(), '?quality=medium&stage=pre-pmf')).toBe('medium')
    expect(applyCaptureQuality(new SpyEngine(), '?stage=crisis')).toBeNull()
    expect(applyCaptureQuality(new SpyEngine(), '?quality=banana')).toBeNull()
  })
})

// The reachability gate. openCaptureSession is the SAME call the shipped route
// runs (PlayableMatch.tsx): it both auto-freezes and produces the __PLAY__
// freezeQuality/quality probes. Exercising it here proves "capture mode =>
// adaptEnabled === false" on the real wiring, deterministically and without a
// GPU. The residual it cannot reach — that the React effect actually invokes
// openCaptureSession — is a single unconditional statement whose removal would
// also strip __PLAY__.freezeQuality/quality and break every capture tool; that
// last edge is confirmed at runtime in the GPU window via __PLAY__.quality()
// holding steady, never by a source grep.
describe('captureQuality.openCaptureSession (reachability spy)', () => {
  it('freezes the tier — adaptEnabled === false — for EVERY pinned tier (capture mode ⇒ frozen)', () => {
    // THE load-invariant assertion. Asserts the engine's state, not a call.
    for (const tier of QUALITY_ORDER) {
      const e = new SpyEngine()
      openCaptureSession(e, `?quality=${tier}&stage=pre-pmf`)
      expect(e.adaptEnabled).toBe(false)
    }
  })

  it('leaves adaptation ON when nothing is pinned (anti-vacuity control)', () => {
    // A real player passes no ?quality=. If openCaptureSession froze
    // unconditionally, this fails — the mutation this control kills. Paired with
    // the freeze-every-tier test above, no constant-side-effect stub passes both.
    const e = new SpyEngine()
    openCaptureSession(e, '?stage=crisis')
    expect(e.adaptEnabled).toBe(true)
    expect(e.calls).toBe(0)
  })

  it('does not freeze on a bogus tier (a wrong pin must not silently freeze the wrong tier)', () => {
    const e = new SpyEngine()
    openCaptureSession(e, '?quality=banana')
    expect(e.adaptEnabled).toBe(true)
  })

  it('gates the deviation: the safe state is frozen, freezeQuality(false) opts back into adaptation', () => {
    const e = new SpyEngine()
    const hooks = openCaptureSession(e, '?quality=low')
    expect(e.adaptEnabled).toBe(false) // default is the safe state
    hooks.freezeQuality(false) // explicit deviation
    expect(e.adaptEnabled).toBe(true)
    hooks.freezeQuality(true)
    expect(e.adaptEnabled).toBe(false)
    hooks.freezeQuality() // default arg re-freezes
    expect(e.adaptEnabled).toBe(false)
  })

  it('quality() reads the LIVE tier, so a capture can prove the tier did not move', () => {
    const e = new SpyEngine()
    const hooks = openCaptureSession(e, '')
    e.quality = 'high'
    expect(hooks.quality()).toBe('high')
    e.quality = 'low' // tier moves underfoot
    expect(hooks.quality()).toBe('low') // reader reflects it — a snapshot would not
  })
})
