import { describe, it, expect, afterEach } from 'vitest'
import { forcedQuality, applyCaptureQuality, openCaptureSession, installLabProbe, removeLabProbe, type AdaptiveEngine, type LabProbe } from '../captureQuality'
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

// captureRoute is the resolution to "a knob whose safe state is opt-in IS the
// bug": the two routes that exist SOLELY for capture (?fight=1, ?attract=1) pass
// { captureRoute: true } and freeze WITHOUT a ?quality= pin, so the ~89 tools
// that never pass a pin still measure a still tier. ?play=1 (buyer-shared)
// passes nothing and stays pin-only. These assert the DIRECTION of the default
// per route, not merely that a freeze can happen — the separation-vs-loudness
// lesson: "they differ" is weaker than "they differ the way I intended".
describe('captureQuality.captureRoute (freeze-by-default on capture-only routes)', () => {
  it('freezes with NO pin when captureRoute is set (the ?fight=1 / ?attract=1 default)', () => {
    const e = new SpyEngine()
    const frozenAt = applyCaptureQuality(e, '?stage=crisis', { captureRoute: true })
    expect(e.adaptEnabled).toBe(false) // froze despite no ?quality=
    expect(frozenAt).toBe('ultra') // reports the detected tier it pinned (spy default)
  })

  it('does NOT freeze with no pin when captureRoute is absent (the ?play=1 buyer default)', () => {
    // The anti-vacuity twin of the test above: if captureRoute silently defaulted
    // to freezing, a real player on ?play=1 would lose adaptive recovery. This is
    // the asymmetry the coordinator named — the direction you cannot trust (a
    // buyer frozen) must fail CLOSED: stay adaptive unless asked otherwise.
    const e = new SpyEngine()
    expect(applyCaptureQuality(e, '?stage=crisis')).toBeNull()
    expect(applyCaptureQuality(e, '?stage=crisis', {})).toBeNull()
    expect(e.adaptEnabled).toBe(true)
    expect(e.calls).toBe(0)
  })

  it('a pin still selects the TIER on a capture route (pin wins the tier, route wins the freeze)', () => {
    const e = new SpyEngine()
    expect(applyCaptureQuality(e, '?quality=low', { captureRoute: true })).toBe('low')
    expect(e.adaptEnabled).toBe(false)
  })

  it('a bogus pin on a capture route still freezes at the detected tier (route forces it, bad pin ignored)', () => {
    const e = new SpyEngine()
    e.quality = 'high'
    expect(applyCaptureQuality(e, '?quality=banana', { captureRoute: true })).toBe('high')
    expect(e.adaptEnabled).toBe(false)
  })

  it('openCaptureSession forwards captureRoute (the exact wiring FightHarness runs)', () => {
    // FightHarness calls openCaptureSession(engine, search, { captureRoute: true }).
    // Prove the option reaches the freeze through the FUSED entry point, not only
    // via bare applyCaptureQuality, and that the ?play=1 path is unaffected.
    const frozen = new SpyEngine()
    openCaptureSession(frozen, '?stage=crisis', { captureRoute: true })
    expect(frozen.adaptEnabled).toBe(false)

    const adaptive = new SpyEngine()
    openCaptureSession(adaptive, '?stage=crisis')
    expect(adaptive.adaptEnabled).toBe(true)
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

// installLabProbe is the SAME call the `?lab=1` sandbox (ThreeLab → FightScene3D)
// runs on mount. It fuses the freeze with the __LAB__ tier probe via
// openCaptureSession, and — because FightScene3D is ALSO the shipped 3D renderer
// (CombatScreen → FightStage, the default on any WebGL2 machine) — it is gated
// behind the `capture` prop so it never runs on a buyer. Exercising it with a spy
// proves the default freeze + the live getter + teardown without a GPU. The
// residual it cannot reach — that the effect calls it under `capture` and NOT on
// the shipped path — is gated structurally in captureCoverage.node.test.ts and
// confirmed at runtime via window.__LAB__.quality() holding steady.
describe('captureQuality.installLabProbe (the ?lab=1 capture handle)', () => {
  const lab = () => (globalThis as unknown as { __LAB__?: LabProbe }).__LAB__
  afterEach(() => removeLabProbe())

  it('publishes nothing until installed (anti-vacuity control)', () => {
    removeLabProbe()
    expect(lab()).toBeUndefined()
  })

  it('freezes the tier by DEFAULT with no pin — the sandbox has no buyer to protect', () => {
    const e = new SpyEngine()
    installLabProbe(e, '?stage=hypergrowth') // no ?quality=
    expect(e.adaptEnabled).toBe(false)
    expect(lab()).toBeDefined()
  })

  it('__LAB__.quality() reads the LIVE tier, never a snapshot (the whole point of the probe)', () => {
    const e = new SpyEngine()
    installLabProbe(e, '')
    e.quality = 'high'
    expect(lab()!.quality()).toBe('high')
    e.quality = 'low' // tier drifts underfoot
    expect(lab()!.quality()).toBe('low') // reflects it — a captured value would report 'high' forever
  })

  it('gates the deviation: frozen by default, __LAB__.freezeQuality(false) opts back into adaptation', () => {
    const e = new SpyEngine()
    installLabProbe(e, '')
    expect(e.adaptEnabled).toBe(false)
    lab()!.freezeQuality(false)
    expect(e.adaptEnabled).toBe(true)
  })

  it('removeLabProbe tears the handle down (route unmount leaves no global behind)', () => {
    installLabProbe(new SpyEngine(), '')
    expect(lab()).toBeDefined()
    removeLabProbe()
    expect(lab()).toBeUndefined()
  })
})
