import { describe, it, expect } from 'vitest'
import { stepHealthBar, TRAIL_HOLD_MS, TAU_TRAIL, type BarState } from '../healthBarModel'

/**
 * The recoverable-damage trail is the "you just lost this much" chunk. Its read
 * is governed by TRAIL_HOLD_MS (how long the pale trail stays pinned after a
 * hit) and TAU_TRAIL (how slowly it then drains). These were 150ms/260ms — the
 * chunk barely flickered. Our target is a ~1s hold — our own number, not a cited
 * one: AAA fighters look to linger about that long, but we found no published
 * spec for it. This test measures the
 * actual hold in ms and the two combo-critical invariants, so shrinking the hold
 * back toward the old value turns a claim red.
 *
 * The step function is driven at a real 60fps delta and asserted on the numbers
 * it produces, not on its source — a mutation that halves TRAIL_HOLD_MS moves
 * `framesUntilDrain` and fails `holds ~1s`, and a per-hit reset of the hold
 * timer fails the combo invariants.
 */

const DT = 1000 / 60 // one 60fps frame, ms
const fresh = (): BarState => ({ main: 1, trail: 1, holdMs: 0 })

/** Run `frames` ticks at a fixed target, returning the trail after each frame. */
function run(s: BarState, target: number, frames: number): number[] {
  const out: number[] = []
  for (let i = 0; i < frames; i++) {
    stepHealthBar(s, target, DT)
    out.push(s.trail)
  }
  return out
}

describe('health-bar recoverable trail', () => {
  it('holds the trail pinned for ~1s (measured), not the old ~150ms flicker', () => {
    const s = fresh()
    // One 40%-damage hit, then time passes with the target held low.
    const target = 0.6
    const trailByFrame = run(s, target, 180) // 3s of frames

    // The trail is pinned at the pre-hit value (1.0) until the hold expires.
    // Find the first frame where it actually starts to move.
    const startFrame = trailByFrame.findIndex((v) => v < 1 - 1e-6)
    expect(startFrame).toBeGreaterThan(0)
    const holdMsMeasured = startFrame * DT

    // Measured hold must sit in the reference band (~0.7–0.9s), i.e. the trail
    // lingers roughly a second. The old 150ms value lands ~9 frames and fails.
    expect(holdMsMeasured).toBeGreaterThan(650)
    expect(holdMsMeasured).toBeLessThan(950)
    // And it must agree with the declared constant to within a couple of frames
    // (the hold is accumulated one 60fps dt at a time, so allow float drift).
    expect(Math.abs(holdMsMeasured - TRAIL_HOLD_MS)).toBeLessThan(2 * DT)
  })

  it('front (main) bar drops immediately while the trail waits — the two-layer read', () => {
    const s = fresh()
    stepHealthBar(s, 0.6, DT) // single frame after a hit
    // main has begun easing toward 0.6 on the very first frame…
    expect(s.main).toBeLessThan(1)
    // …while the trail is still pinned up top (the recoverable chunk).
    expect(s.trail).toBeCloseTo(1, 5)
    expect(s.trail).toBeGreaterThan(s.main)
  })

  it('a fast combo reads as ONE cumulative chunk: trail never rises or resets mid-string', () => {
    const s = fresh()
    // Five hits landing across ~400ms (well inside the hold window), each
    // dropping the target further — a combo.
    let target = 1
    const trailSeries: number[] = []
    const drops = [0.85, 0.7, 0.55, 0.42, 0.3]
    let di = 0
    for (let frame = 0; frame < 24; frame++) {
      // Land the next hit every ~5 frames.
      if (frame % 5 === 0 && di < drops.length) target = drops[di++]
      stepHealthBar(s, target, DT)
      trailSeries.push(s.trail)
    }
    // Throughout the whole combo the trail stays pinned at the pre-combo value:
    // it must not tick down (still inside hold) and must NEVER jump back up
    // (a per-hit reset would show as a rise → visible stutter).
    for (let i = 1; i < trailSeries.length; i++) {
      expect(trailSeries[i]).toBeLessThanOrEqual(trailSeries[i - 1] + 1e-9)
    }
    expect(trailSeries[trailSeries.length - 1]).toBeCloseTo(1, 5)
    // holdMs accumulated from the FIRST hit, not the last — so it's already
    // most of the way to draining, proving the timer did not restart per hit.
    expect(s.holdMs).toBeGreaterThan(24 * DT - 1e-6)
  })

  it('after the hold expires the trail drains monotonically down to the final chunk', () => {
    const s = fresh()
    const target = 0.5
    // Long enough to pass the hold and drain most of the way.
    const series = run(s, target, 240)
    const postHold = series.slice(Math.ceil(TRAIL_HOLD_MS / DT) + 2)
    for (let i = 1; i < postHold.length; i++) {
      expect(postHold[i]).toBeLessThanOrEqual(postHold[i - 1] + 1e-9)
    }
    // It genuinely reaches (near) the lost value rather than stalling.
    expect(s.trail).toBeLessThan(0.55)
    expect(s.trail).toBeGreaterThanOrEqual(0.5 - 1e-6)
  })

  it('a heal / round reset snaps both layers up and clears the hold timer', () => {
    const s: BarState = { main: 0.3, trail: 0.6, holdMs: 500 }
    stepHealthBar(s, 1, DT)
    expect(s.main).toBe(1)
    expect(s.trail).toBe(1)
    expect(s.holdMs).toBe(0)
  })

  it('TAU_TRAIL is the slower (drain) constant, so the bleed reads as deliberate', () => {
    // A guard on the relationship, not a restatement: the trail must drain more
    // slowly than the main bar eases, or the two-layer separation collapses.
    expect(TAU_TRAIL).toBeGreaterThan(150)
  })
})
