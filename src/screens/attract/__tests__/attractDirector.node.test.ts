import { describe, it, expect } from 'vitest'
import { AttractDirector } from '../attractDirector'

/**
 * Gate for the title-screen attract reel (`AttractMode.tsx`).
 *
 * The React shell mounts a real `FightRenderer` and can't run under this suite
 * (no DOM/WebGL in the node env), so the *behaviour that matters* lives in the
 * pure `AttractDirector` and is asserted here: it steps a real live sim, it cuts
 * between distinct matchups, and it releases the screen the instant the viewer
 * touches a control. The shell is a thin adapter over exactly these signals.
 *
 * Every assertion below is mutation-proved in the task report: break the thing
 * it measures, watch this go red, restore, watch it go green.
 */

/** A fixed seed so the reel is replayable frame-for-frame. */
const SEED = 0xa77ac7

/**
 * Drive the director the way the shell does: advance the live sim, and cut to a
 * fresh matchup whenever it asks. Returns the director plus what we saw.
 */
function runReel(seed: number, budget: number) {
  const dir = new AttractDirector({ seed })
  const matchupKeys = new Set<string>()
  const key = () => `${dir.matchup.a.skin}>${dir.matchup.b.skin}@${dir.matchup.stage}`
  matchupKeys.add(key())
  for (let i = 0; i < budget; i++) {
    dir.step()
    if (dir.wantsRotate) {
      dir.rotate()
      matchupKeys.add(key())
    }
  }
  return { dir, matchupKeys }
}

describe('attract director — the title-screen demo fight', () => {
  // ~15k frames ≈ 4 min of reel at 60fps: several full best-of-3 bouts.
  const BUDGET = 15000

  it('steps a real live sim and cuts between distinct matchups (not a frozen mount)', () => {
    const { dir, matchupKeys } = runReel(SEED, BUDGET)

    // Vacuity guard: the reel actually advanced a sim. A shell that only mounted
    // the renderer without wiring `step` — or a director that no-oped — would
    // leave this at 0. Asserting a non-zero step count is the guard the task
    // brief calls for.
    expect(dir.stepsTaken).toBeGreaterThan(0)
    expect(dir.stepsTaken).toBe(BUDGET)
    // The sim genuinely advanced rather than sitting frozen on frame 0.
    expect(dir.current.frame).toBeGreaterThan(0)
    // Real combat happened. The `hard` tier lands KOs (the AI census measured
    // this tier throwing heavies, sweeps and supers), so a live reel reaches at
    // least one. Zero KOs across ~15k frames would mean nobody is fighting.
    expect(dir.kos).toBeGreaterThanOrEqual(1)
    // The reel cut to new bouts instead of looping the same twenty seconds —
    // the point of random-ish matchup rotation.
    expect(dir.matchesShown).toBeGreaterThanOrEqual(2)
    expect(matchupKeys.size).toBeGreaterThanOrEqual(2)
  })

  it('is replayable: a fixed seed yields the same reel', () => {
    const a = runReel(SEED, 6000)
    const b = runReel(SEED, 6000)
    expect(a.dir.stepsTaken).toBe(b.dir.stepsTaken)
    expect(a.dir.matchesShown).toBe(b.dir.matchesShown)
    expect(a.dir.kos).toBe(b.dir.kos)
    expect([...a.matchupKeys]).toEqual([...b.matchupKeys])
  })

  it('dismisses on input within a zero-frame window, mid-fight — not merely eventually', () => {
    const dir = new AttractDirector({ seed: SEED })

    // Advance into the FIGHT phase so the request lands mid-bout — exactly where
    // a phase-gated (buggy) dismiss would defer until the next KO boundary.
    let guard = 0
    while (dir.current.phase !== 'fight' && guard < 1200) {
      dir.step()
      guard++
    }

    // Vacuity: we really are mid-fight with a sim that has been stepping, so the
    // test can't be satisfied by requesting exit on an idle or ended director.
    expect(dir.current.phase).toBe('fight')
    expect(dir.stepsTaken).toBeGreaterThan(0)
    expect(dir.exitPending).toBe(false)

    const before = dir.stepsTaken
    dir.requestExit()

    // Dismissed immediately: the flag is up with zero further sim steps. A
    // dismiss that only took hold at the next KO/round boundary — the project's
    // documented "dismissed, just 2.8s later" failure — would leave this false
    // here and only flip much later.
    expect(dir.exitPending).toBe(true)
    expect(dir.stepsTaken).toBe(before)
  })

  // ── teardown safety ─────────────────────────────────────────────────────────
  // The shell tears the reel down at a seam by disposing the director and
  // stopping its renderer's rAF. But a browser can fire an already-scheduled rAF
  // during that same frame, and React StrictMode (dev) disposes a ref-held
  // director on its simulated unmount then remounts. Both can call `step()` on a
  // director whose sim has had its CPU drivers disposed. `visual-critic` filed a
  // "15× dir.step() teardown error storm on every attract→select exit, rAF firing
  // post-dispose" against exactly this. A disposed director must therefore be
  // inert: not throw, not advance, not touch the disposed sim.
  describe('is inert after dispose (the teardown-storm guard)', () => {
    it('step() after dispose() does not throw, advance, or emit events', () => {
      const dir = new AttractDirector({ seed: SEED })
      // Vacuity: it was genuinely live and stepping before we disposed it, so
      // "inert after dispose" is a real transition and not a director that never
      // ran. A no-op mount would leave stepsTaken at 0 and make the assertion
      // below vacuously true.
      for (let i = 0; i < 300; i++) dir.step()
      const steps = dir.stepsTaken
      expect(steps).toBeGreaterThan(0)

      dir.dispose()

      // The load-bearing assertion. Without the disposed-guard in `step()`, this
      // call advances the counter and steps a sim whose drivers are disposed —
      // the exact post-dispose churn the critic caught. With the guard it is a
      // no-op that returns the last state with no events.
      const res = expectNoThrow(() => dir.step())
      expect(dir.stepsTaken).toBe(steps)
      expect(res.events).toEqual([])
      expect(res.state).toBe(dir.current)

      // Still inert after many further post-dispose ticks (a browser can fire
      // more than one stale rAF): the counter never moves again.
      for (let i = 0; i < 50; i++) dir.step()
      expect(dir.stepsTaken).toBe(steps)
    })

    it('dispose() is idempotent — a double teardown is harmless', () => {
      const dir = new AttractDirector({ seed: SEED })
      for (let i = 0; i < 60; i++) dir.step()
      expectNoThrow(() => dir.dispose())
      // A second dispose (StrictMode unmount + a real unmount, or two seams
      // racing) must not double-dispose the underlying sim/drivers.
      expectNoThrow(() => dir.dispose())
    })
  })
})

/** Run a fn, failing the test with its error rather than letting it throw out of
 *  the assertion so the message names what threw. Returns the fn's result. */
function expectNoThrow<T>(fn: () => T): T {
  try {
    return fn()
  } catch (e) {
    expect.fail(`expected no throw, got: ${e instanceof Error ? e.message : String(e)}`)
  }
}
