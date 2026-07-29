import { describe, it, expect } from 'vitest'
import type { QualityTier } from '../../types'
import { qualityRank } from '../../types'
import {
  QualityAdaptor,
  affordablePixelRatio,
  DEFAULT_ADAPT,
  TARGET_RENDER_PIXELS,
} from '../QualityAdaptor'

// ────────────────────────────────────────────────────────────────────────────
// Deterministic gate for the runtime quality policy.
//
// PROXY UNDER TEST: "given a synthetic frame-time series, does the controller
// demote the right amount within a bounded WALL-CLOCK time?" This is a pure
// function of its input arrays — no GPU, no Engine, no wall clock, no box load —
// so it is load-invariant where a measured-fps gate is not. (This project has
// already killed one "performance gate cosplaying as a hang-guard"; a gate whose
// verdict moves with co-tenant CPU is worthless.)
//
// WHY THE FAILURE MODE CANNOT SATISFY IT:
//  • The bug being fixed is a FRAME-COUNT warmup (90 frames), whose reaction
//    time balloons as fps falls — 90 frames is ~15s at 6fps. `reactsInBoundedTime`
//    asserts the FIRST demotion lands in wall-clock ms regardless of fps, so the
//    old logic (≥9000ms at 6fps even with the 100ms clamp) fails it. A gate that
//    only asserted "eventually demotes" would pass the buggy code — this one can't.
//  • Anti-vacuity: `neverDemotesHealthy` proves the controller is capable of
//    NOT demoting, so a mutant that just always-demotes is caught, not rewarded.
//    Without it, every "does it demote?" assertion is satisfiable by demote-always.
//
// Mutation-proved in the commit message: windowMs→90_000 reddens the reaction
// bound; catastrophicMs→Infinity reddens the jump-to-floor; dropping the sqrt in
// affordablePixelRatio reddens the Retina cap. Each restored byte-identical.
// ────────────────────────────────────────────────────────────────────────────

interface Action { t: number; from: QualityTier; to: QualityTier; reason: string; reactionMs: number }

/**
 * Drive a fresh series of `fps` frames for `durationMs` of simulated time,
 * applying each demotion to the running tier. `frameMs` is clamped to 100ms to
 * mirror the Engine's tab-restore guard (`rawDt = min(0.1, …)`), so a 6fps
 * series feeds 100ms frames — exactly what the real adaptor sees.
 */
function simulate(adaptor: QualityAdaptor, fps: number, durationMs: number, startTier: QualityTier) {
  const frameMs = Math.min(100, 1000 / fps)
  let tier = startTier
  const actions: Action[] = []
  for (let t = 0; t <= durationMs + 1e-6; t += frameMs) {
    const a = adaptor.sample(t, frameMs, tier)
    if (a.kind === 'demote') {
      actions.push({ t: +t.toFixed(1), from: a.from, to: a.to, reason: a.reason, reactionMs: +a.reactionMs.toFixed(1) })
      tier = a.to
    }
  }
  return { tier, actions }
}

describe('QualityAdaptor — demotion policy', () => {
  it('anti-vacuity: a healthy 60fps series NEVER demotes (from ultra or high)', () => {
    for (const start of ['ultra', 'high'] as QualityTier[]) {
      const { tier, actions } = simulate(new QualityAdaptor(), 60, 6000, start)
      expect(actions).toEqual([])
      expect(tier).toBe(start)
    }
  })

  it('anti-vacuity: 55fps (just under the 60 cap, above the 45 floor) does NOT demote', () => {
    // 55fps ≈ 18.2ms < demoteAboveMs (22.2). A gate that demoted here would be
    // punishing an essentially-fine frame rate.
    const { actions } = simulate(new QualityAdaptor(), 55, 6000, 'ultra')
    expect(actions).toEqual([])
  })

  it('sustained 30fps demotes exactly ONE tier per step (a walk, not a leap)', () => {
    // 33.3ms is below 45fps but not catastrophic, so we step down conservatively
    // rather than dumping straight to the floor.
    const adaptor = new QualityAdaptor()
    const { actions } = simulate(adaptor, 30, DEFAULT_ADAPT.windowMs * 1.5 + 5, 'ultra')
    expect(actions.length).toBeGreaterThanOrEqual(1)
    expect(actions[0]).toMatchObject({ from: 'ultra', to: 'high', reason: 'slow' })
    // exactly one tier of movement in the first window
    expect(qualityRank(actions[0].from) - qualityRank(actions[0].to)).toBe(1)
  })

  it('30fps eventually walks ultra→…→low, one tier at a time', () => {
    const { tier, actions } = simulate(new QualityAdaptor(), 30, DEFAULT_ADAPT.windowMs * 5, 'ultra')
    expect(tier).toBe('low')
    // Every hop is a single tier — never a multi-tier jump on a merely-slow read.
    for (const a of actions) expect(qualityRank(a.from) - qualityRank(a.to)).toBe(1)
    expect(actions.every((a) => a.reason === 'slow')).toBe(true)
  })

  it('a catastrophic 6fps series JUMPS straight to the floor in a single action', () => {
    const adaptor = new QualityAdaptor()
    const { tier, actions } = simulate(adaptor, 6, 4000, 'ultra')
    expect(actions[0]).toMatchObject({ from: 'ultra', to: 'low', reason: 'catastrophic' })
    expect(tier).toBe('low')
    // ONE action reaches the floor — not the three a per-tier walk would need.
    expect(actions.filter((a) => a.to === 'low').length).toBe(1)
    expect(actions.length).toBe(1)
  })

  it('REGRESSION GUARD: reaction time is wall-clock-bounded, NOT frame-count-bounded', () => {
    // The whole point of the fix. At 6fps the old 90-frame warmup could not
    // react before 90×100ms = 9000ms (and 14940ms without the clamp). Assert the
    // first demotion lands inside ~1 window (<2000ms) at BOTH 6fps and 60fps-worth
    // of severity, so reaction time no longer degrades with how bad the drop is.
    for (const fps of [6, 10, 20]) {
      const { actions } = simulate(new QualityAdaptor(), fps, 3000, 'ultra')
      expect(actions.length).toBeGreaterThanOrEqual(1)
      expect(actions[0].t).toBeLessThan(2000)
      expect(actions[0].reactionMs).toBeLessThan(2000)
    }
  })

  it('respects a time-based warmup: no demotion before one window of data', () => {
    // Feed a catastrophic rate but stop just short of windowMs — a transient sub-
    // window spike must not trigger a demotion.
    const adaptor = new QualityAdaptor()
    const { actions } = simulate(adaptor, 6, DEFAULT_ADAPT.windowMs - 150, 'ultra')
    expect(actions).toEqual([])
  })

  it('the floor is terminal: at low, a catastrophic series emits no demotion', () => {
    const adaptor = new QualityAdaptor()
    const { tier, actions } = simulate(adaptor, 6, 5000, 'low')
    expect(tier).toBe('low')
    expect(actions).toEqual([])
  })

  it('enforces a cooldown: successive demotions are ≥ windowMs apart', () => {
    const { actions } = simulate(new QualityAdaptor(), 30, DEFAULT_ADAPT.windowMs * 5, 'ultra')
    for (let i = 1; i < actions.length; i++) {
      expect(actions[i].t - actions[i - 1].t).toBeGreaterThanOrEqual(DEFAULT_ADAPT.windowMs - 1e-3)
    }
  })
})

describe('affordablePixelRatio — fill-aware cap', () => {
  it('defuses the 1080p Retina catastrophe: caps well under 2.0 (near 1.0)', () => {
    const pr = affordablePixelRatio(1920, 1080, 2, 1.5)
    expect(pr).toBeLessThan(1.1)
    expect(pr).toBeGreaterThanOrEqual(1.0)
    // and the whole point — the rendered pixel count lands at/under the budget.
    expect(1920 * 1080 * pr * pr).toBeLessThanOrEqual(TARGET_RENDER_PIXELS * 1.02)
  })

  it('is a no-op on a non-Retina panel (deviceDpr 1 ⇒ exactly 1.0)', () => {
    expect(affordablePixelRatio(1920, 1080, 1, 1.5)).toBe(1)
    expect(affordablePixelRatio(2560, 1440, 1, 1.5)).toBe(1)
  })

  it('lets a SMALL high-DPI viewport spend more (few CSS px ⇒ ratio up to the tier cap)', () => {
    const pr = affordablePixelRatio(800, 600, 2, 1.5)
    expect(pr).toBeGreaterThan(1.0)
    expect(pr).toBeLessThanOrEqual(1.5) // tier cap binds, never exceeded
  })

  it('never renders below native: a huge viewport floors at 1.0, not below', () => {
    expect(affordablePixelRatio(3840, 2160, 2, 1.5)).toBe(1)
    expect(affordablePixelRatio(5120, 2880, 2, 1.5)).toBe(1)
  })

  it('is monotonic: a larger viewport never gets a larger ratio', () => {
    const sizes: [number, number][] = [[800, 600], [1280, 720], [1920, 1080], [2560, 1440], [3840, 2160]]
    let prev = Infinity
    for (const [w, h] of sizes) {
      const pr = affordablePixelRatio(w, h, 2, 1.5)
      expect(pr).toBeLessThanOrEqual(prev + 1e-9)
      prev = pr
    }
  })

  it('never exceeds the tier cap even when the budget would allow it', () => {
    // Tiny viewport, generous budget — the tier cap (1.0 for low) must still bind.
    expect(affordablePixelRatio(320, 240, 2, 1.0)).toBe(1)
  })
})
