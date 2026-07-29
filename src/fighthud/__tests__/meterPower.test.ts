import { describe, expect, it } from 'vitest'
import { MAX_METER } from '../../fight/constants'
import {
  SUPER_COST,
  MAX_SUPERS,
  EX_COST_MIN,
  EX_COST_MAX,
  affordableSupers,
  powerTier,
  affordableEx,
  type PowerTier,
} from '../meterModel'

/**
 * Gate for finding #4 — the HUD signalled DANGER but never POWER. The super
 * gauge lit one binary "charged" state and read "READY" identically whether you
 * could afford ONE super or TWO, hiding a distinction the sim honours today.
 *
 * The proxy this gate asserts on is the shipped meter model (affordableSupers +
 * powerTier — the exact functions SuperGauge runs). Presence is not reachability:
 * a correct model that no component reads would still be a withheld readout, so
 * meterPower.node.test.ts additionally scans SuperGauge.tsx / hud.css to prove
 * the component and its CSS actually consume this model (and that EX stays
 * unwired). This file is the pure-logic half; it needs no node globals.
 */
const RANGE = Array.from({ length: 26 }, (_, i) => Math.round((i / 25) * (MAX_METER + 400)))

describe('meterModel — graded POWER read (finding #4)', () => {
  it('is not vacuous: the read responds to meter across the range (>=3 distinct tiers)', () => {
    const tiers = new Set<PowerTier>(RANGE.map(powerTier))
    // A dead model (one tier forever) or a binary one (two) cannot pass a
    // three-state power ladder — this is the control that catches a stuck read.
    expect(tiers.size).toBeGreaterThanOrEqual(3)
    const supers = new Set(RANGE.map(affordableSupers))
    expect(supers.size).toBeGreaterThanOrEqual(3)
  })

  it('positive control: an empty meter and a maxed meter read as different tiers', () => {
    expect(powerTier(0)).toBe('charging')
    expect(powerTier(MAX_METER)).toBe('max')
    expect(powerTier(0)).not.toBe(powerTier(MAX_METER))
  })

  it('the affordability ladder is boundary-exact against the sim spend gate', () => {
    // sim.ts gate is `f.meter < move.cost` ⇒ cannot spend, so 999 buys nothing
    // and exactly 1000 buys one. All three supers declare cost: 1000.
    expect(affordableSupers(0)).toBe(0)
    expect(affordableSupers(SUPER_COST - 1)).toBe(0)
    expect(affordableSupers(SUPER_COST)).toBe(1)
    expect(affordableSupers(2 * SUPER_COST - 1)).toBe(1)
    expect(affordableSupers(2 * SUPER_COST)).toBe(2)
  })

  it('clamps at MAX_SUPERS and never over-reports (meter caps at 2000)', () => {
    expect(MAX_SUPERS).toBe(2)
    expect(affordableSupers(MAX_METER)).toBe(MAX_SUPERS)
    expect(affordableSupers(MAX_METER + 100_000)).toBe(MAX_SUPERS)
    // Defensive: junk input floors to 0, never NaN/negative.
    expect(affordableSupers(-500)).toBe(0)
    expect(affordableSupers(Number.NaN)).toBe(0)
  })

  it('is monotone non-decreasing in meter (more meter is never less power)', () => {
    for (let i = 1; i < RANGE.length; i++) {
      expect(affordableSupers(RANGE[i])).toBeGreaterThanOrEqual(affordableSupers(RANGE[i - 1]))
    }
  })

  it('holds the design DIRECTION: tiers escalate charging < ready < max with meter', () => {
    // Separation says "they differ"; this says they differ in the intended
    // direction — 'max' must require strictly more meter than 'ready', which
    // must require strictly more than 'charging'.
    const firstReady = RANGE.find((m) => powerTier(m) === 'ready')
    const firstMax = RANGE.find((m) => powerTier(m) === 'max')
    expect(firstReady).toBeDefined()
    expect(firstMax).toBeDefined()
    expect(firstMax as number).toBeGreaterThan(firstReady as number)
    expect(powerTier(SUPER_COST - 1)).toBe('charging')
    expect(powerTier(SUPER_COST)).toBe('ready')
    expect(powerTier(2 * SUPER_COST)).toBe('max')
  })

  it('mutation control: a level-blind affordable() would violate the ladder', () => {
    // The exact assertion above, applied to a collapsed model, MUST fail —
    // proving the ladder test is load-bearing, not decorative.
    const brokenConst = (_meter: number): number => 1
    const brokenBlind = () => brokenConst(0)
    // A constant "always 1 super" gets the empty-meter boundary wrong…
    expect(brokenConst(0)).not.toBe(0)
    // …and collapses the three-state ladder to one value (non-vacuity fails).
    expect(new Set(RANGE.map(brokenBlind)).size).toBe(1)
  })

  describe('EX specials — FORWARD SPEC, deliberately not surfaced', () => {
    it('pins the ruled cost band and keeps it strictly below one super', () => {
      expect(EX_COST_MIN).toBe(250)
      expect(EX_COST_MAX).toBe(500)
      expect(EX_COST_MIN).toBeLessThan(EX_COST_MAX)
      expect(EX_COST_MAX).toBeLessThan(SUPER_COST)
    })

    it('affordableEx is correct in and out of the band (consumed only by this gate)', () => {
      expect(affordableEx(EX_COST_MIN, EX_COST_MIN)).toBe(true)
      expect(affordableEx(EX_COST_MAX, EX_COST_MAX)).toBe(true)
      expect(affordableEx(MAX_METER, EX_COST_MAX)).toBe(true)
      // too poor
      expect(affordableEx(EX_COST_MIN - 1, EX_COST_MIN)).toBe(false)
      // cost outside the ruled band is rejected (it is not an EX move)
      expect(affordableEx(MAX_METER, EX_COST_MIN - 1)).toBe(false)
      expect(affordableEx(MAX_METER, EX_COST_MAX + 1)).toBe(false)
      expect(affordableEx(MAX_METER, SUPER_COST)).toBe(false)
    })
  })
})
