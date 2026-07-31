import { describe, it, expect } from 'vitest'
import type { FightEvent } from '../../fight/types'
import {
  freshBar,
  applyHit,
  applyHitEvents,
  stepHealthBar,
  barResponse,
  TAU_MAIN,
  TAU_TRAIL,
  TRAIL_HOLD_MS,
  type BarState,
  type BarResponse,
} from '../healthBarModel'
import type { HitLevel } from '../../fight/types'

/**
 * HEALTH-BAR WEIGHT IDENTITY (design gate).
 *
 * The shipped defect: `stepHealthBar` saw only a target, so a 10-damage chip and
 * a 120-damage super drained the single most-watched element on the IDENTICAL
 * 55ms ease — the bar's response was one behaviour, scaled only by how much
 * health moved. This is the visual mirror of the audio weight work
 * (impactTimbre.test.ts): it proves the six weight classes now move the bar as
 * genuinely DIFFERENT behaviours, and that the difference is a function of the
 * WEIGHT CLASS, not of the damage.
 *
 * The metric is a design proxy: four MAGNITUDE-INVARIANT shape descriptors of
 * the realized trajectory of the SHIPPED model (applyHit + stepHealthBar). The
 * outcome instrument tools/measure-hud-weight.mjs --assert drives the identical
 * functions and agrees on every load-bearing invariant. What this proxy CANNOT
 * see is the on-screen DOM (the vitest env is node — no layout, no rAF); that
 * the component consumes this model is proved structurally (HealthBar keeps no
 * private BarState; it reads the root's shared ref) and by the reducer test at
 * the foot of this file, not by a rendered assertion.
 */

const DT = 1000 / 60
const FRAMES = 420
const MATCH_DMG = 0.4
const LEVELS: HitLevel[] = ['light', 'medium', 'heavy', 'launcher', 'sweep', 'crumple']

// Fixed physical scales (the spread of each axis) so the distance is stable
// across runs and cannot drift with the set — not z-scored.
const SCALE = { recoilPeak: 0.5, mainHalfFrames: 6, holdFrames: 24, bleedHalfFrames: 14 }

interface Fingerprint {
  recoilPeak: number
  mainHalfFrames: number
  holdFrames: number
  bleedHalfFrames: number
  endValue: number
}

/** Drive the shipped model through one hit, latch profile via a mutator so the
 *  same harness can measure the real `applyHit` OR a collapsed control. */
function trajectory(mutate: (s: BarState) => void, dmg: number): Fingerprint {
  const bar = freshBar()
  const target = 1 - dmg
  mutate(bar)
  const recoil = [bar.recoil ?? 0]
  const main = [bar.main]
  const trail = [bar.trail]
  for (let i = 0; i < FRAMES; i++) {
    stepHealthBar(bar, target, DT)
    main.push(bar.main)
    trail.push(bar.trail)
    recoil.push(bar.recoil ?? 0)
  }
  const half = target + 0.5 * (1 - target)
  const firstAtOrBelow = (arr: number[], v: number) => {
    for (let i = 0; i < arr.length; i++) if (arr[i] <= v) return i
    return arr.length
  }
  const firstBelow = (arr: number[], v: number) => {
    for (let i = 0; i < arr.length; i++) if (arr[i] < v) return i
    return arr.length
  }
  const holdFrames = firstBelow(trail, 1 - 1e-6)
  return {
    recoilPeak: Math.max(...recoil),
    mainHalfFrames: firstAtOrBelow(main, half),
    holdFrames,
    bleedHalfFrames: Math.max(0, firstAtOrBelow(trail, half) - holdFrames),
    endValue: main[main.length - 1],
  }
}

const fingerprint = (level: HitLevel, dmg = MATCH_DMG) => trajectory((s) => applyHit(s, level), dmg)
/** A level-blind bar: every class latched to one fixed response — the "one
 *  behaviour scaled" defect this whole gate exists to forbid. */
const collapsed = (resp: BarResponse, dmg = MATCH_DMG) =>
  trajectory((s) => {
    s.mainTau = resp.mainTau
    s.trailTau = resp.trailTau
    s.holdTargetMs = resp.holdMs
    s.recoil = resp.recoil
  }, dmg)

function fpDist(a: Fingerprint, b: Fingerprint): number {
  let s = 0
  for (const k of Object.keys(SCALE) as (keyof typeof SCALE)[]) {
    const d = (a[k] - b[k]) / SCALE[k]
    s += d * d
  }
  return Math.sqrt(s)
}

const fp = Object.fromEntries(LEVELS.map((l) => [l, fingerprint(l)])) as Record<HitLevel, Fingerprint>

// Real tightest pair (medium/launcher) sits at ~0.635; a level-blind bar sits at
// 0. The floor is set below the real minimum and well above 0 so a re-collapse
// reddens. Identical to the instrument's --assert threshold.
const MIN_SEP = 0.45

describe('health-bar weight identity — realized-trajectory fingerprints', () => {
  it('is deterministic (non-vacuity: same class → same trajectory, distance 0)', () => {
    expect(fpDist(fingerprint('heavy'), fingerprint('heavy'))).toBe(0)
    expect(fpDist(fingerprint('sweep'), fingerprint('sweep'))).toBe(0)
  })

  it('responds to a known-distinct pair (light vs crumple far apart)', () => {
    expect(fpDist(fp.light, fp.crumple)).toBeGreaterThan(2.0)
  })

  it('gives every weight class a distinct bar behaviour — all 15 pairs separated', () => {
    for (let i = 0; i < LEVELS.length; i++) {
      for (let j = i + 1; j < LEVELS.length; j++) {
        const a = LEVELS[i]
        const b = LEVELS[j]
        expect(fpDist(fp[a], fp[b]), `${a} vs ${b} must move the bar differently`).toBeGreaterThan(MIN_SEP)
      }
    }
  })

  it('holds the design invariants: crumple hardest / light softest recoil, sweep slowest bleed, launcher a fast pop, crumple lingers longest', () => {
    const recoils = LEVELS.map((l) => fp[l].recoilPeak)
    expect(fp.crumple.recoilPeak).toBe(Math.max(...recoils)) // match-ender jolt
    expect(fp.light.recoilPeak).toBe(Math.min(...recoils)) // flick
    const bleeds = LEVELS.map((l) => fp[l].bleedHalfFrames)
    expect(fp.sweep.bleedHalfFrames).toBe(Math.max(...bleeds)) // lazy "off your feet" drain
    // launcher: nearly the same freeze weight as sweep, opposite drain — the
    // visual echo of sweep-darkest / launcher-brightest in the audio work.
    expect(fp.launcher.bleedHalfFrames).toBeLessThan(fp.sweep.bleedHalfFrames)
    expect(fp.launcher.mainHalfFrames).toBeLessThan(fp.heavy.mainHalfFrames) // front pops fast
    const holds = LEVELS.map((l) => fp[l].holdFrames)
    expect(fp.crumple.holdFrames).toBe(Math.max(...holds)) // chunk hangs longest
  })

  it('splits SIZE from WEIGHT: damage moves the settled value, not the behaviour', () => {
    const sizes = [0.15, 0.4, 0.7].map((d) => fingerprint('heavy', d))
    const endSpread = Math.max(...sizes.map((s) => s.endValue)) - Math.min(...sizes.map((s) => s.endValue))
    expect(endSpread, 'metric must SEE damage (positive control on the size axis)').toBeGreaterThan(0.3)
    // ...while the shape fingerprint barely moves: behaviour is weight, not size.
    for (let i = 0; i < sizes.length; i++)
      for (let j = i + 1; j < sizes.length; j++)
        expect(fpDist(sizes[i], sizes[j]), 'damage must NOT leak into behaviour').toBeLessThan(0.05)
  })

  it('MUTATION CONTROL: a level-blind bar (one response for all) collapses separation below the floor', () => {
    // This is the defect the gate forbids, run in-process: latch every class to
    // ONE response and the tightest — indeed ALL — cross-class gaps go to 0.
    const one = barResponse('heavy')
    const blind = Object.fromEntries(LEVELS.map((l) => [l, collapsed(one)])) as Record<HitLevel, Fingerprint>
    let maxGap = 0
    for (let i = 0; i < LEVELS.length; i++)
      for (let j = i + 1; j < LEVELS.length; j++) maxGap = Math.max(maxGap, fpDist(blind[LEVELS[i]], blind[LEVELS[j]]))
    expect(maxGap).toBe(0) // every class identical
    expect(maxGap).toBeLessThan(MIN_SEP) // so the separation assertion above WOULD fail — it is not vacuous
  })
})

describe('health-bar weight wiring — the reducer that reaches the shipped bar', () => {
  const at = { x: 0, y: 0 }

  it('routes a hit to the DEFENDER (1 - attacker), at the hit’s authored level', () => {
    const bars: [BarState, BarState] = [freshBar(), freshBar()]
    const evs: FightEvent[] = [{ type: 'hit', at, attacker: 0, level: 'crumple', damage: 120 }]
    applyHitEvents(bars, evs)
    // attacker 0 → defender 1 takes the jolt; attacker's own bar untouched.
    expect(bars[1].recoil).toBe(barResponse('crumple').recoil)
    expect(bars[1].holdTargetMs).toBe(barResponse('crumple').holdMs)
    expect(bars[0].recoil ?? 0).toBe(0)
  })

  it('applies a throw (a command grab is authored heavy) but SKIPS counter-hit (fired alongside hit → would double-apply)', () => {
    const thrown: [BarState, BarState] = [freshBar(), freshBar()]
    applyHitEvents(thrown, [{ type: 'throw', at, attacker: 1, level: 'heavy', damage: 140 }])
    expect(thrown[0].recoil).toBe(barResponse('heavy').recoil) // attacker 1 → defender 0

    const counter: [BarState, BarState] = [freshBar(), freshBar()]
    applyHitEvents(counter, [{ type: 'counter-hit', at, attacker: 0, level: 'heavy', damage: 90 }])
    expect(counter[1].recoil ?? 0).toBe(0) // not consumed here
  })

  it('ignores non-damaging events (a block must not jolt the bar)', () => {
    const bars: [BarState, BarState] = [freshBar(), freshBar()]
    applyHitEvents(bars, [{ type: 'block', at, attacker: 0, chip: 0 }])
    expect(bars[1].recoil ?? 0).toBe(0)
  })

  it('latches DIFFERENT behaviour per level onto the target bar (light ≠ crumple)', () => {
    const a: [BarState, BarState] = [freshBar(), freshBar()]
    const b: [BarState, BarState] = [freshBar(), freshBar()]
    applyHitEvents(a, [{ type: 'hit', at, attacker: 0, level: 'light', damage: 20 }])
    applyHitEvents(b, [{ type: 'hit', at, attacker: 0, level: 'crumple', damage: 120 }])
    expect(a[1].mainTau).not.toBe(b[1].mainTau)
    expect(a[1].recoil).not.toBe(b[1].recoil)
  })
})

describe('health-bar weight — combo still reads as ONE cumulative chunk (Task-2 invariant under weight latching)', () => {
  // healthTrail.test.ts proves this on the pure-drain path (no applyHit). This
  // proves it SURVIVES the new per-hit weight latch: several hits inside the
  // hold window must not reset the hold or let the trail rise.
  it('holds the trail from the FIRST hit across a fast multi-weight string', () => {
    const bars: [BarState, BarState] = [freshBar(), freshBar()]
    const combo: HitLevel[] = ['light', 'medium', 'heavy', 'launcher']
    let health = 1
    const trail: number[] = []
    for (let k = 0; k < combo.length; k++) {
      health -= 0.12
      applyHitEvents(bars, [{ type: 'hit', at: { x: 0, y: 0 }, attacker: 0, level: combo[k], damage: 90 }])
      // ~5 frames between hits — well inside every class's hold window.
      for (let f = 0; f < 5; f++) {
        stepHealthBar(bars[1], health, DT)
        trail.push(bars[1].trail)
      }
    }
    // Trail never rises (monotonic non-increasing) — one chunk, not a stutter.
    for (let i = 1; i < trail.length; i++) expect(trail[i]).toBeLessThanOrEqual(trail[i - 1] + 1e-9)
    // And it is still pinned near full (the hold has NOT started bleeding yet):
    // the combo lands inside the window, so the chunk is shown whole.
    expect(trail[trail.length - 1]).toBeGreaterThan(0.95)
  })
})

describe('health-bar weight — the pure-drain path is unchanged (defaults = the shared constants)', () => {
  it('a bar never told a level eases on the original TAU_MAIN / TAU_TRAIL / hold', () => {
    // Guards the byte-identical claim healthTrail.test.ts depends on: with no
    // applyHit, the latched fields are undefined and step falls back to defaults.
    const s = freshBar()
    delete s.recoil // truly pristine, as the old {main,trail,holdMs} literal was
    stepHealthBar(s, 0.5, DT)
    const expected = 1 + (0.5 - 1) * (1 - Math.exp(-DT / TAU_MAIN))
    expect(s.main).toBeCloseTo(expected, 10)
    expect(TAU_TRAIL).toBe(320)
    expect(TRAIL_HOLD_MS).toBe(800)
  })
})
