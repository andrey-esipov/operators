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
import { MAX_METER, INTRO_FRAMES } from '../../fight/constants'
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

/**
 * Hard ceiling on how many frames a bout may be pre-rolled before it is shown
 * (see `prerollToAction`). Against `hard` AI with primed meter the first strike
 * lands in well under a second, so this ~3s cap is effectively never reached; it
 * exists only to guarantee termination on a freak all-footsie opening.
 */
const PREROLL_CAP_FRAMES = 60 * 3

/**
 * Frames of the opening stand-off to hold on an *establishing* bout before the
 * fight is joined. The intro is a static, full-body, max-separation idle stand-
 * off (both fighters unoccluded, facing off) — the one moment in the whole reel
 * where a scroller can read *who* the two fighters are from silhouette alone,
 * which a pure-action reel never offers and is a named weakness on a six-
 * character roster. `prerollToAction` cuts straight past the whole ~90-frame
 * (`INTRO_FRAMES`) intro on most bouts; on establishing bouts it instead leaves
 * this many intro frames visible — ~0.6s, a deliberate character beat, well
 * under the full 1.5s intro that read as dead air when shown on *every* bout.
 * Held on a minority (opener + every third bout) so the reel varies establish-
 * then-action against straight-to-action rather than entering every bout the
 * same way — "material 7, edit 3" wants variation, not one uniform faster cut.
 */
export const ESTABLISH_HOLD_FRAMES = 36

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
    this.prerollToAction(this.establishHoldFor(this._matchesShown))
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

  /**
   * How many intro frames to hold as an establishing stand-off for a given bout
   * (0 = cut straight to action). The opener and every third bout thereafter
   * (1-in-3) establish; the rest enter on the first exchange. Keyed off the bout
   * counter, NOT the rng, so introducing the beat leaves the matchup draw — and
   * therefore the archetype distribution and the cost-constrained opener — byte-
   * identical to a reel without it.
   */
  private establishHoldFor(bout: number): number {
    return (bout - 1) % 3 === 0 ? ESTABLISH_HOLD_FRAMES : 0
  }

  /**
   * Position a freshly built bout at the frame the renderer should first paint —
   * before it ever reads one — in one of two modes:
   *
   *  • Straight-to-action (default, `establishHold === 0`): fast-forward past the
   *    entire intro and the opening footsie to the first joined exchange. Every
   *    bout's sim opens with a fixed ~90-frame intro (`INTRO_FRAMES`) — both
   *    fighters stand idle at full separation, a static stand-off — then a
   *    variable stall before the first blow. `visual-critic`'s money-shot census
   *    measured the cost: median time-to-first-marquee 2.8s with a slow tail,
   *    nearly all of it that front-loaded stand-off and footsie. A trailer cuts
   *    past it to the action; a match broadcast plays it. This makes the reel a
   *    trailer.
   *
   *  • Establishing (`establishHold > 0`): KEEP a short slice of that stand-off.
   *    The intro is the one moment in the reel where a scroller gets a clean,
   *    full-body, non-overlapping read of *who* the two fighters are — silhouette
   *    legibility a pure-action reel never offers, and a named weakness on a six-
   *    character roster. The whole 1.5s intro on every bout was dead air; a ~0.6s
   *    stand-off on a minority of bouts (see `establishHoldFor`) is a deliberate
   *    character beat instead. Because the intro is static (idle, max separation,
   *    every frame identical), skipping all but the last `establishHold` frames
   *    shows a clean stand-off of exactly that length, then lets the sim flow
   *    naturally intro→fight→first exchange (the AI closes and strikes within a
   *    few frames of the intro ending).
   *
   * HOW IT STAYS HONEST: it advances the *sim* directly, never `step()`, so the
   * skipped frames are simulated but never shown and never counted by the vacuity
   * meters the gate reads (`stepsTaken`, `kos`, `segmentFrames`). `initialState`
   * and `current` both return the live sim state, so the renderer seeds its first
   * paint from the resulting frame with no flash. The straight-to-action path is
   * bounded by `PREROLL_CAP_FRAMES` and stops at a round boundary so a
   * pathological all-footsie opening can never fast-forward a whole bout or roll
   * into the next round's dead air.
   */
  private prerollToAction(establishHold = 0): void {
    if (establishHold > 0) {
      // Hold the opening stand-off: skip all but the last `establishHold` intro
      // frames, then return so the renderer paints them and the sim flows on into
      // the fight on its own. The round-start event fires on frame 0 and is
      // consumed here with the skipped frames, exactly as the straight-to-action
      // path below consumes it.
      const target = Math.max(0, INTRO_FRAMES - establishHold)
      for (let f = 0; f < target && this.sim.current.phase === 'intro'; f++) {
        this.sim.step()
      }
      this._prevPhase = this.sim.current.phase
      return
    }
    for (let f = 0; f < PREROLL_CAP_FRAMES; f++) {
      const { state, events } = this.sim.step()
      // Never cross a round boundary (a freak instant KO): entering on the next
      // round's intro would reintroduce the very dead air we are skipping.
      if (state.phase === 'ko' || state.phase === 'round-end' || state.phase === 'match-end') break
      if (state.phase === 'intro') continue
      // The exchange is joined the moment a strike is out (attack stance) or one
      // has connected — landed, blocked, thrown, or a super flash. That is the
      // first frame a scroller would stop on; enter here.
      const striking = state.fighters.some(
        (fr) => fr.stance === 'attack' || fr.stance === 'hitstun' || fr.stance === 'blockstun',
      )
      const contact = events.some(
        (e) =>
          e.type === 'hit' ||
          e.type === 'counter-hit' ||
          e.type === 'block' ||
          e.type === 'throw' ||
          e.type === 'parry' ||
          e.type === 'super-flash',
      )
      if (striking || contact) break
    }
    // Keep KO detection honest: `step()` compares the next rendered phase against
    // this, and preroll has advanced us out of 'intro' into the live exchange.
    this._prevPhase = this.sim.current.phase
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
    this.prerollToAction(this.establishHoldFor(this._matchesShown))
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
