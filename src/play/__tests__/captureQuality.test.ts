import { describe, it, expect } from 'vitest'
import { forcedQuality, applyCaptureQuality, type AdaptiveEngine } from '../captureQuality'
import { QUALITY_ORDER } from '../../three/types'

// A spy Engine that records every setAdaptiveQuality(on) call, so the decision
// -> side-effect link is provable without a real WebGL context.
function spyEngine() {
  const calls: boolean[] = []
  const engine: AdaptiveEngine = { setAdaptiveQuality: (on: boolean) => void calls.push(on) }
  return { engine, calls }
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

describe('captureQuality.applyCaptureQuality', () => {
  it('freezes adaptation exactly once when a tier is pinned (the real assertion)', () => {
    const { engine, calls } = spyEngine()
    const pinned = applyCaptureQuality(engine, '?quality=ultra&stage=pre-pmf')
    expect(pinned).toBe('ultra')
    expect(calls).toEqual([false]) // setAdaptiveQuality(false) => demotion off
  })

  it('leaves adaptation untouched when no tier is pinned (anti-vacuity control)', () => {
    // A real player passes no ?quality=. If applyCaptureQuality froze
    // unconditionally, this fails — that is the mutation this control kills.
    const { engine, calls } = spyEngine()
    const pinned = applyCaptureQuality(engine, '?stage=crisis')
    expect(pinned).toBeNull()
    expect(calls).toEqual([]) // never called => adaptive recovery preserved
  })

  it('does not freeze on a bogus tier', () => {
    const { engine, calls } = spyEngine()
    expect(applyCaptureQuality(engine, '?quality=banana')).toBeNull()
    expect(calls).toEqual([])
  })
})
