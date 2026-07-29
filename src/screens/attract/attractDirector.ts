/**
 * Attract-mode director — the pure brain behind the title-screen demo fight.
 *
 * Every arcade fighter since 1987 opens with a CPU-vs-CPU demo match, and it is
 * the one surface whose entire job is to sell the game. This module owns the
 * *logic* of that reel — which matchup, on which stage, when a bout is over,
 * when to cut to the next one, and when the viewer has asked to leave — with no
 * React and no Three.js in it, so it can be driven frame-for-frame in a plain
 * node test. The React shell (`AttractMode.tsx`) is a thin adapter that mounts a
 * real `FightRenderer`, points its rAF at `step()`, and rebuilds itself against
 * a fresh matchup when `wantsRotate` flips.
 *
 * Two deliberate choices worth naming, because both are load-bearing:
 *
 *  1. It is the *real* engine. `step()` wraps `MatchSim.step()` — the exact sim
 *     a human fights in single-player — not a scripted animation or a video.
 *     What the reel shows is what the game plays.
 *
 *  2. It cuts to the good part. Both sides run on the `hard` tier so the whole
 *     moveset shows up (heavies, sweeps, supers — not a jab loop), and each
 *     fighter enters with meter already built so a super can cash out the first
 *     real exchange instead of the reel waiting a full bar for one to appear.
 */

import { MatchSim } from '../../play/MatchSim'
import { makeRng, type Rng } from '../../fight/rng'
import { MAX_METER } from '../../fight/constants'
import { ROSTER, type RosterEntry } from '../../fighthud/select/roster'
import { STAGE_ORDER } from '../../three/stage/StageRegistry'
import { isAllowedFirstBout } from './attractLoadCost'
import type { ScenarioId } from '../../types'
import type { FightState, StepResult } from '../../fight/types'

export interface AttractMatchup {
  /** Left fighter: skin (atlas) + archetype (moveset). */
  a: RosterEntry
  /** Right fighter. Always a distinct skin from `a` — the reel never mirrors. */
  b: RosterEntry
  stage: ScenarioId
  /** Seed for both CPU drivers, so a bout is a pure function of the matchup. */
  seed: number
}

/**
 * Frames to hold on the victory pose after a match ends before cutting to the
 * next bout. ~2.3s at 60fps — long enough to read who won, short enough to keep
 * the reel moving.
 */
export const KO_HOLD_FRAMES = 140

/**
 * Pace cap on a single bout, ~40s at 60fps. A round can legally run to a 99s
 * time-over, which is far too long to hold a marquee, and most hard-vs-hard
 * rounds KO well inside this — so past this point we cut regardless of whether a
 * KO has landed. Acts as both a "don't linger" pace limit and a stalemate net.
 */
export const MAX_SEGMENT_FRAMES = 60 * 40

/** Both fighters enter each bout with a full gauge so supers fire early. */
const SUPER_PRIME = MAX_METER

export interface AttractDirectorOptions {
  /** Omit for a fresh random reel each load; pass a seed to make it replayable
   *  (the gate does). */
  seed?: number
}

export class AttractDirector {
  private readonly rng: Rng
  private sim: MatchSim
  private _matchup: AttractMatchup
  private _stepsTaken = 0
  private _matchesShown = 1
  private _kos = 0
  private _segmentFrames = 0
  private _koHold = 0
  private _wantsRotate = false
  private _exitPending = false
  private _prevPhase: FightState['phase'] = 'intro'
  private _disposed = false

  constructor(opts: AttractDirectorOptions = {}) {
    this.rng = makeRng((opts.seed ?? (Date.now() & 0xffffffff)) >>> 0)
    // The opener is cost-constrained so a cold first visit never waits on the
    // heaviest atlas pairing; every subsequent bout is unconstrained.
    this._matchup = this.pickMatchup(true)
    this.sim = this.buildSim(this._matchup)
  }

  // ── matchup selection ──────────────────────────────────────────────────────

  private pickMatchup(firstBout = false): AttractMatchup {
    // The cost constraint applies to the opener only: bout 1 rejection-samples,
    // re-rolling the pair (never the stage/seed) until it is within the first-
    // bout download ceiling, so the shop window's very first load stays off the
    // ~10.9 MB worst-case pairing; bouts 2+ skip that cost check. The archetype
    // guard below, by contrast, applies to *every* bout. A hard attempt cap
    // guarantees termination and, with ~4 of 5 pairings eligible, is effectively
    // never reached.
    const MAX_ATTEMPTS = 40
    for (let attempt = 0; ; attempt++) {
      const i = this.rng.int(ROSTER.length)
      // Distinct opponent: draw in [0, n-1) and skip past `i`, so the two sides
      // are never the identical skin (a mirror reads as a bug on a marquee).
      let j = this.rng.int(ROSTER.length - 1)
      if (j >= i) j++
      const a = ROSTER[i]
      const b = ROSTER[j]
      // …but a distinct *skin* is not a distinct *fight*. The roster carries two
      // skins per archetype (chesky/lenny are both `operator`, spiegel/madhavan
      // `vanguard`, doshi/turley `warden`), so the skip above still let a moveset
      // mirror through on ~1 in 5 bouts — two fighters throwing the identical
      // moveset in different costumes, which is the mirror that actually reads as
      // repetitive on a marquee (and made 6 characters look like 3). Hard-reject
      // it on *every* bout, unbounded by MAX_ATTEMPTS: unlike the cost ceiling
      // below — a soft preference we knowingly relax to guarantee termination — a
      // moveset mirror is never something we choose to show. 4 of every 5 draws
      // clear it, so this terminates as fast as the skin skip it extends.
      if (a.archetype === b.archetype) continue
      if (firstBout && attempt < MAX_ATTEMPTS && !isAllowedFirstBout(a.skin, b.skin)) {
        continue
      }
      const stage = STAGE_ORDER[this.rng.int(STAGE_ORDER.length)]
      const seed = this.rng.int(0x7fffffff)
      return { a, b, stage, seed }
    }
  }

  private buildSim(m: AttractMatchup): MatchSim {
    const sim = new MatchSim({
      p1: m.a.archetype,
      p2: m.b.archetype,
      controllers: [
        { kind: 'cpu', difficulty: 'hard', seed: m.seed },
        { kind: 'cpu', difficulty: 'hard', seed: (m.seed ^ 0x9e3779b9) >>> 0 },
      ],
      seed: m.seed,
    })
    // Prime meter on the live state the renderer will read. Done before the
    // first step, so the opening exchange already has a super available.
    sim.current.fighters[0].meter = SUPER_PRIME
    sim.current.fighters[1].meter = SUPER_PRIME
    return sim
  }

  // ── accessors the shell renders from ───────────────────────────────────────

  get matchup(): AttractMatchup {
    return this._matchup
  }
  get initialState(): FightState {
    return this.sim.initialState
  }
  get current(): FightState {
    return this.sim.current
  }
  /** Total simulated frames advanced across every bout — the vacuity guard the
   *  gate reads to prove the reel actually stepped a sim rather than mounting a
   *  frozen one. */
  get stepsTaken(): number {
    return this._stepsTaken
  }
  /** How many distinct bouts have been started (>=1 from construction). */
  get matchesShown(): number {
    return this._matchesShown
  }
  get kos(): number {
    return this._kos
  }
  /** Set once a bout's victory hold has elapsed (or the safety cap is hit): the
   *  shell should cut to a new matchup. */
  get wantsRotate(): boolean {
    return this._wantsRotate
  }
  get exitPending(): boolean {
    return this._exitPending
  }

  /**
   * Advance the live sim one frame. The renderer's own rAF calls this through
   * `setStep`, so every rendered frame is a real simulated frame — there is no
   * separate scripted timeline. Returns the `StepResult` the renderer draws.
   */
  step(): StepResult {
    // A disposed director is inert. The shell tears the reel down at a seam by
    // disposing the director *and* stopping its renderer's rAF, but a browser
    // fires one or more already-scheduled rAF callbacks during that same frame,
    // and React StrictMode's mount→unmount→remount disposes a ref-held director
    // between renders. Either way a live rAF can call `step()` on a director
    // whose sim has already had its CPU drivers disposed. Advancing here would
    // step a disposed sim (and increment the vacuity counter the gate reads),
    // so a disposed director returns its last state with no events and does not
    // advance — the reel is provably frozen, not churning torn-down resources.
    if (this._disposed) return { state: this.sim.current, events: [] }
    const res = this.sim.step()
    this._stepsTaken++
    this._segmentFrames++
    for (const e of res.events) if (e.type === 'ko') this._kos++

    const phase = res.state.phase
    // A round just concluded — a KO (fight→ko) or, rarely, a time-over
    // (fight→round-end). Either way the fighting stopped: hold on the result,
    // then cut to a fresh matchup. Cutting *per round* rather than per
    // best-of-three is deliberate: a round is 99 seconds and a full match up to
    // three of them, which is an eternity on a marquee. Cutting on the KO keeps
    // the reel dense with finishes and matchup variety — the good part, on a
    // loop — instead of lingering on one pair through a slow decider.
    const decisive = phase === 'ko' || phase === 'round-end' || phase === 'match-end'
    if (decisive && this._prevPhase === 'fight') {
      this._koHold = KO_HOLD_FRAMES
    }
    if (this._koHold > 0) {
      this._koHold--
      if (this._koHold === 0) this._wantsRotate = true
    }
    // Safety net for a round that somehow never resolves (both sides turtle to
    // the 99s clock): cut anyway so the reel never strands on one matchup.
    if (this._segmentFrames >= MAX_SEGMENT_FRAMES) this._wantsRotate = true

    this._prevPhase = phase
    return res
  }

  /**
   * Cut to a fresh matchup. The shell calls this when `wantsRotate` is set, then
   * rebuilds its renderer against the new matchup on a *fresh canvas* — so the
   * previous bout's GPU atlases are freed with its WebGL context rather than
   * leaked by an in-place asset swap (Fighter.setAssets does not dispose the
   * textures it replaces).
   */
  rotate(): AttractMatchup {
    this.sim.dispose()
    this._matchup = this.pickMatchup()
    this.sim = this.buildSim(this._matchup)
    this._matchesShown++
    this._segmentFrames = 0
    this._koHold = 0
    this._wantsRotate = false
    this._prevPhase = 'intro'
    return this._matchup
  }

  /**
   * Any user input dismisses the reel. The flag is raised *immediately* and is
   * NOT gated on fight phase — a demo you have to sit through to the next KO
   * before it releases the screen is worse than no demo. The shell reads this
   * the same tick it receives the input and calls its `onExit`.
   */
  requestExit(): void {
    this._exitPending = true
  }

  dispose(): void {
    if (this._disposed) return
    this._disposed = true
    this.sim.dispose()
  }
}
