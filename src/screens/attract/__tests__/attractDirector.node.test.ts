import { describe, it, expect } from 'vitest'
import { AttractDirector, ESTABLISH_HOLD_FRAMES, COVERAGE_BOUND } from '../attractDirector'
import { ROSTER } from '../../../fighthud/select/roster'
import { INTRO_FRAMES } from '../../../fight/constants'

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
    // a phase-gated (buggy) dismiss would defer until the next KO boundary. The
    // opener is an *establishing* bout, so a fresh director opens on the short
    // intro stand-off; step *director* frames until it flows into FIGHT (it stops
    // before any KO) so the vacuity guard below proves the director advanced the
    // sim — the preroll steps the sim directly and is deliberately not counted.
    let guard = 0
    while (dir.current.phase !== 'fight' && guard < 1200) {
      dir.step()
      guard++
    }
    for (let i = 0; i < 30 && dir.current.phase === 'fight'; i++) dir.step()

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

/**
 * Sample the *actual* matchup draw distribution the director produces: the
 * opener (the cost-constrained bout-1 draw) across many seeds, plus several
 * rotations per seed (the unconstrained bout-2+ draw). Returns every matchup
 * seen, so the gate below asserts over the real distribution rather than a
 * re-implementation of the picker.
 */
function sampleDraws(seedCount: number, rotationsPerSeed: number) {
  const draws: { a: string; b: string; aArch: string; bArch: string }[] = []
  for (let s = 0; s < seedCount; s++) {
    const dir = new AttractDirector({ seed: (0x1234 + s * 0x9e3779b1) >>> 0 })
    const record = () =>
      draws.push({
        a: dir.matchup.a.skin,
        b: dir.matchup.b.skin,
        aArch: dir.matchup.a.archetype,
        bArch: dir.matchup.b.archetype,
      })
    record() // opener — the firstBout (cost-constrained) path
    for (let r = 0; r < rotationsPerSeed; r++) {
      dir.rotate() // bouts 2+ — the unconstrained path
      record()
    }
    dir.dispose()
  }
  return draws
}

describe('attract director — never a moveset (archetype) mirror', () => {
  // The picker guarantees a distinct *skin* (`j !== i`), but the roster fields
  // two skins per archetype, so a distinct skin can still be the identical
  // moveset — a mirror that reads as repetitive on a marquee and made the 6-
  // character roster look like 3. `visual-critic` measured it at ~1 in 5 bouts
  // (its whole dead-opener tail was turley↔doshi, both `warden`). This is the
  // gate for the fix that extends the guard from distinct skin to distinct
  // archetype.
  it('draws distinct archetypes on every bout, not merely distinct skins', () => {
    const draws = sampleDraws(200, 6) // 200 openers + 1200 rotations = 1400 bouts

    // Vacuity 1 — the sample is large and genuinely varied, not one safe pairing
    // on repeat (a gate that only ever saw a single matchup would pass blind).
    expect(draws.length).toBeGreaterThanOrEqual(1200)
    const distinctPairs = new Set(draws.map((d) => `${d.a}>${d.b}`))
    expect(distinctPairs.size).toBeGreaterThanOrEqual(12)

    // Vacuity 2 — every archetype actually appears in the draw, so "no shared
    // archetype" can't be trivially true from the reel only ever fielding one.
    const archsSeen = new Set(draws.flatMap((d) => [d.aArch, d.bArch]))
    expect([...archsSeen].sort()).toEqual(['operator', 'vanguard', 'warden'])

    // Vacuity 3 — the roster genuinely CAN form a moveset mirror (some archetype
    // is worn by ≥2 skins), so the guard is rejecting a real case, not an
    // impossible one. Without this the claim below could be a tautology.
    const perArch = new Map<string, number>()
    for (const e of ROSTER) perArch.set(e.archetype, (perArch.get(e.archetype) ?? 0) + 1)
    expect([...perArch.values()].some((n) => n >= 2)).toBe(true)

    // The claim: across the whole sampled distribution, not one bout pairs two of
    // the same archetype. Removing the `a.archetype === b.archetype` reject in
    // pickMatchup turns ~1 in 5 of these draws into a mirror — the mutation proof.
    const mirrors = draws.filter((d) => d.aArch === d.bArch)
    expect(mirrors.map((m) => `${m.a}/${m.b}:${m.aArch}`)).toEqual([])
    // 1400 live directors, each pre-rolling ~55–120 sim frames (establishing
    // bouts hold a short intro stand-off; the rest fast-forward to the first
    // exchange — see the entry gate below): a heavy distributional draw, so it
    // gets headroom past vitest's 5s default on a saturated box.
  }, 30_000)
})

/**
 * The exact sequence of skin pairings a reel produces over `bouts` bouts, one
 * `[skinA, skinB]` per bout. Matchup *selection* is independent of how each bout
 * is fought — the sim gets its own `m.seed`-derived rng, so the director's rng
 * only advances inside `pickMatchup` — so rotating directly yields the identical
 * sequence a viewer would see, without paying to step ~15k frames per reel.
 */
function reelSkins(seed: number, bouts: number): string[][] {
  const dir = new AttractDirector({ seed })
  const seq: string[][] = [[dir.matchup.a.skin, dir.matchup.b.skin]]
  for (let bout = 2; bout <= bouts; bout++) {
    dir.rotate()
    seq.push([dir.matchup.a.skin, dir.matchup.b.skin])
  }
  dir.dispose()
  return seq
}

describe('attract director — guarantees roster coverage', () => {
  // Coverage is a property of *which skins* the picker selects. The stage is a
  // separate, independent rng draw that never feeds skin selection, so one sweep
  // of seeds exercises the coverage greedy fully (each seed also rolls its own
  // stage sequence in passing). A dozen seeds so the greedy's rng tie-breaks —
  // it picks *among* equally-stale skins — are exercised across many orderings,
  // not one. Reads the matchup sequence directly, since coverage lives in the
  // selection, not the fight.
  const SEEDS = Array.from({ length: 12 }, (_, k) => (0x1234 + k * 0x9e3779b1) >>> 0)
  const BOUTS = 18

  it(`shows all six skins in every ${COVERAGE_BOUND}-bout window — none starved at the start, middle or end of a reel`, () => {
    const rosterSkins = ROSTER.map((e) => e.skin)

    // Vacuity 0 — the roster really is six distinct skins, so "all six per
    // window" is a non-trivial ask (a 2-skin roster would pass this blind).
    expect(new Set(rosterSkins).size).toBe(6)
    // …and the reel is long enough to hold several disjoint windows, so the
    // sweep below is not just re-checking the opening bouts.
    expect(BOUTS).toBeGreaterThan(COVERAGE_BOUND * 2)

    let reelsChecked = 0
    let windowsChecked = 0
    for (const seed of SEEDS) {
      const seq = reelSkins(seed, BOUTS)

      // Vacuity 1 — this reel genuinely ran all BOUTS bouts (a director that
      // stopped rotating would shrink this and make the window sweep vacuous).
      expect(seq.length).toBe(BOUTS)
      // Vacuity 2 — every pairing is two *distinct* skins (a degenerate picker
      // returning one skin twice must not be able to "cover" by accident).
      for (const [a, b] of seq) expect(a).not.toBe(b)

      // The claim: slide a COVERAGE_BOUND-wide window across the whole reel; every
      // window contains all six skins. This is exactly the guarantee documented on
      // COVERAGE_BOUND, and checking *every* window — not just the first — closes
      // the start, middle and end uniformly: a skin shown once and then starved at
      // the tail fails a late window, which a "first appearance" check would miss.
      // The memoryless draw this replaced leaves ≥1 skin out of some window on
      // essentially every reel (the mutation proof), gaps of 6–12 bouts.
      for (let start = 0; start + COVERAGE_BOUND <= seq.length; start++) {
        const window = new Set(seq.slice(start, start + COVERAGE_BOUND).flat())
        const missing = rosterSkins.filter((k) => !window.has(k))
        expect(
          missing,
          `seed 0x${seed.toString(16)} bouts ${start + 1}–${start + COVERAGE_BOUND} missing [${missing.join(', ')}]`,
        ).toEqual([])
        windowsChecked++
      }
      reelsChecked++
    }

    // Vacuity 3 — we actually swept the expected number of windows across every
    // seed, so a silently-empty loop can't green this.
    expect(reelsChecked).toBe(SEEDS.length)
    expect(windowsChecked).toBe(SEEDS.length * (BOUTS - COVERAGE_BOUND + 1))
    // 12 directors rotated through 18 bouts each with no sim stepping: cheap, but
    // still constructs ~216 MatchSims, so it gets headroom past the 5s default.
  }, 30_000)
})

/**
 * Drive one director through several bouts the way the shell does — advance the
 * live sim, cut to a fresh matchup when it asks — capturing the *entry* frame of
 * each bout (what `renderer.setInitialState(dir.initialState)` seeds the first
 * paint from) before that bout is stepped. Scalars only, so later stepping can't
 * mutate a captured record.
 */
function boutEntries(seed: number, bouts: number) {
  const dir = new AttractDirector({ seed })
  const out: { bout: number; phase: string; frame: number; stances: string[]; sep: number }[] = []
  const capture = (bout: number) => {
    const s = dir.initialState
    const [a, b] = s.fighters
    out.push({
      bout,
      phase: s.phase,
      frame: s.frame,
      stances: [a.stance, b.stance],
      sep: Math.abs(a.pos.x - b.pos.x),
    })
  }
  capture(1)
  for (let bout = 2; bout <= bouts; bout++) {
    let guard = 0
    while (!dir.wantsRotate && guard < 60 * 60) {
      dir.step()
      guard++
    }
    dir.rotate()
    capture(bout)
  }
  dir.dispose()
  return out
}

describe('attract director — varies entry: establishing stand-off vs. straight-to-action', () => {
  // The reel used to open EVERY bout identically — first a fixed ~90-frame intro
  // then a footsie stall (median time-to-first-marquee 2.8s), later the trailer
  // cut that skipped straight to the first exchange on every bout. Faster, but
  // still uniform, and it deleted the reel's one clean roster-legibility beat: the
  // intro is a *static* idle stand-off at max separation (both fighters full-body,
  // unoccluded, facing off — measured x=±150, sep 300, idle for all 90 frames),
  // the one moment a scroller can read *who* the fighters are. A trailer's power
  // is variation — establish, then action — so the director now HOLDS a short
  // establishing stand-off on a minority of bouts (opener + every third) and cuts
  // straight to action on the rest.
  //
  // `visual-critic`'s census scores a clean stand-off as NEUTRAL/dead-air, so it
  // will under-report these deliberate frames until it grows an ESTABLISH category
  // (spec handed off). That is exactly why the beat is gated *here*, at the
  // director, where it is load-bearing regardless of what the census can see.
  it('opener + every third bout open on a short readable stand-off; the rest enter on action', () => {
    // Several seeds → several matchups AND stages (framing is stage-dependent, so
    // a one-stage gate is presumed blind).
    const SEEDS = [
      0xa77ac7, 0x1234, 0xbeef, 0x55aa, 0x9999, 0xc0ffee, 0x011235, 0xfeed, 0x0a0a, 0x7f7f,
    ]
    const BOUTS = 7 // → establishing at 1,4,7; straight-to-action at 2,3,5,6

    // The beat is short by construction: well under half the intro that read as
    // dead air on every bout. A regression that widened it back toward the full
    // intro would trip this.
    expect(ESTABLISH_HOLD_FRAMES).toBeLessThan(INTRO_FRAMES / 2)

    let establishSeen = 0
    let defaultSeen = 0
    let defaultEngaged = 0
    const establishPhases = new Set<string>()
    const defaultPhases = new Set<string>()

    for (const seed of SEEDS) {
      const entries = boutEntries(seed, BOUTS)
      // Vacuity: the reel really rotated through every bout, so the per-bout
      // assertions below aren't passing on a truncated sample.
      expect(entries.map((e) => e.bout)).toEqual([1, 2, 3, 4, 5, 6, 7])

      for (const e of entries) {
        const isEstablishing = (e.bout - 1) % 3 === 0
        if (isEstablishing) {
          establishSeen++
          establishPhases.add(e.phase)
          // Enters ON the intro stand-off — the clean roster read. Neutering
          // `establishHoldFor` to 0 makes these bouts cut straight to action,
          // reddening every assertion in this branch (mutation proof, direction 1).
          expect(e.phase).toBe('intro')
          // Both fighters idle and full-body separated: readable, non-overlapping
          // silhouettes, not mid-punch and not overlapping.
          expect(e.stances).toEqual(['idle', 'idle'])
          expect(e.sep).toBeGreaterThanOrEqual(250)
          // Exactly ESTABLISH_HOLD_FRAMES of intro remain to be shown — a bounded,
          // deliberate beat, not the whole 1.5s intro back again.
          expect(INTRO_FRAMES - e.frame).toBe(ESTABLISH_HOLD_FRAMES)
        } else {
          defaultSeen++
          defaultPhases.add(e.phase)
          // Straight to action: past the WHOLE intro, on a live exchange. No-oping
          // the straight-to-action preroll leaves these at frame-0 'intro' and
          // reddens here (mutation proof, direction 2).
          expect(e.phase).not.toBe('intro')
          expect(e.frame).toBeGreaterThanOrEqual(INTRO_FRAMES)
          const engaged = e.stances.some(
            (st) => st === 'attack' || st === 'hitstun' || st === 'blockstun' || st === 'juggle',
          )
          if (engaged) defaultEngaged++
        }
      }
    }

    // Vacuity: we really sampled both kinds of bout across the seeds.
    expect(establishSeen).toBe(SEEDS.length * 3) // bouts 1,4,7
    expect(defaultSeen).toBe(SEEDS.length * 4) // bouts 2,3,5,6

    // Every establishing bout entered on the intro and ONLY the intro (not a bout
    // that instantly ended); every default bout entered on FIGHT and ONLY FIGHT.
    expect([...establishPhases]).toEqual(['intro'])
    expect([...defaultPhases]).toEqual(['fight'])

    // Every default bout entered mid-action, not merely past the intro in neutral
    // (a preroll that skipped the intro but not the footsie stall would drop this).
    expect(defaultEngaged).toBe(defaultSeen)
  }, 30_000)
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