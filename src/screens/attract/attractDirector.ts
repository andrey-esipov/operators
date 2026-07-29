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

/**
 * The reel's roster-coverage guarantee: **every skin on the roster appears at
 * least once within any window of this many consecutive bouts** (and all six
 * appear within the first this-many bouts).
 *
 * WHY IT EXISTS. `pickMatchup` used to draw each bout independently with no
 * memory of who had already been shown, so a single 60s reel starved fighters —
 * `visual-critic` measured only 3–5 of the 6 skins appearing per reel, and
 * *nothing* guaranteed otherwise (a regression collapsing the draw to two
 * fighters would not have reddened any gate). On a six-character roster a buyer
 * already reads as thin, showing them four is a self-inflicted wound.
 *
 * HOW IT'S MET. From bout 2 on the picker is least-recently-shown greedy: slot A
 * is always the globally stalest skin (unseen longest), slot B the stalest of a
 * *different* archetype (so the pick is never a moveset mirror). Because a
 * never-shown skin is maximally stale, slot A serves an unseen skin every bout
 * until all six have appeared — the strongest possible anti-starvation rule.
 *
 * THE NUMBER. Measured over 36,000 bouts (1,000 seeds × 36) the worst
 * first-appearance-of-all-six is 4 bouts and the worst gap between a skin's
 * appearances is 4; the overwhelming steady state is 3. That 4 is also a proven
 * ceiling on first coverage: the opener shows two distinct-archetype skins; at
 * bout 2 three unseen skins spanning ≥2 archetypes remain, so *neither* slot can
 * be forced onto a repeat and both are unseen, leaving at most two unseen, which
 * slot A (always the stalest = an unseen skin) clears within two more bouts. We
 * publish 5 — one bout of margin over the measured worst — so the guarantee is
 * robust to a tie-break edge without weakening the gate: the failure mode this
 * exists to catch (memoryless starvation) produces gaps of 6–12, far outside
 * this bound, so the behavioural gate still reddens hard on any real regression.
 *
 * The opener (bout 1) is exempt: it stays within the first-bout download budget
 * (see `isAllowedFirstBout`), which on a constrained connection keeps the
 * heaviest atlas — our hero art — *off* the very first bout; coverage then
 * *guarantees that hero skin appears* within this bound rather than leaving it to
 * chance. The opener budget constrains bout 1; coverage owns
 * bouts 2+; the two never contend because they act on disjoint bouts. Asserted
 * behaviourally over full reels across many seeds and stages in the gate.
 */
export const COVERAGE_BOUND = 5

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

  /** Bout ordinal of this pick (1 = opener), and the ordinal each skin was last
   *  shown at (absent = never). Together these drive the least-recently-shown
   *  coverage greedy in `pickCoveragePair`. Kept off the rng so the coverage
   *  decision is a pure function of who has been shown, reproducible per seed. */
  private _boutOrdinal = 0
  private readonly _lastSeen = new Map<string, number>()

  constructor(opts: AttractDirectorOptions = {}) {
    this.rng = makeRng((opts.seed ?? (Date.now() & 0xffffffff)) >>> 0)
    // The opener is held within the first-bout download budget (see
    // `isAllowedFirstBout`) so a cold first visit on a constrained link isn't
    // served the heaviest atlas pairing; every subsequent bout is unconstrained.
    this._matchup = this.pickMatchup(true)
    this.sim = this.buildSim(this._matchup)
    this.prerollToAction(this.establishHoldFor(this._matchesShown))
  }

  // ── matchup selection ──────────────────────────────────────────────────────

  private pickMatchup(firstBout = false): AttractMatchup {
    this._boutOrdinal++
    const [a, b] = firstBout ? this.pickOpenerPair() : this.pickCoveragePair()
    const stage = STAGE_ORDER[this.rng.int(STAGE_ORDER.length)]
    const seed = this.rng.int(0x7fffffff)
    // Record coverage *after* drawing stage/seed so the rng order for the opener
    // stays byte-identical to the pre-coverage picker (i, j, stage, seed).
    this._lastSeen.set(a.skin, this._boutOrdinal)
    this._lastSeen.set(b.skin, this._boutOrdinal)
    return { a, b, stage, seed }
  }

  /**
   * The opener (bout 1). Budget-aware rejection sample, unchanged from the
   * pre-coverage picker so the first-bout download budget and the opener
   * distribution are preserved exactly: draw a distinct-skin, distinct-archetype
   * pair and re-roll it (never the stage/seed) until the pair fits the viewer's
   * first-bout download budget (see {@link isAllowedFirstBout}) — on a fast or
   * unknown connection, including node/SSR with no `navigator`, that budget is
   * effectively uncapped and any pairing may headline; a constrained link keeps
   * the shop window's very first load off the heaviest pairing. The archetype
   * guard applies here too. A hard attempt cap guarantees termination — the
   * budget re-roll is a soft preference we knowingly relax so a cold visit never
   * hangs. Coverage does not steer the opener: nothing has been shown yet, so
   * there is no debt to service, which is exactly why the opener budget (bout 1
   * only) and coverage (bouts 2+) never contend.
   */
  private pickOpenerPair(): [RosterEntry, RosterEntry] {
    const MAX_ATTEMPTS = 40
    for (let attempt = 0; ; attempt++) {
      const i = this.rng.int(ROSTER.length)
      // Distinct opponent: draw in [0, n-1) and skip past `i`, so the two sides
      // are never the identical skin (a mirror reads as a bug on a marquee).
      let j = this.rng.int(ROSTER.length - 1)
      if (j >= i) j++
      const a = ROSTER[i]
      const b = ROSTER[j]
      // …but a distinct *skin* is not a distinct *fight*. Two skins per archetype
      // (chesky/lenny `operator`, spiegel/madhavan `vanguard`, doshi/turley
      // `warden`), so the skip above still let a moveset mirror through on ~1 in 5
      // bouts — the mirror that actually reads as repetitive and made 6 characters
      // look like 3. Hard-reject it, unbounded by MAX_ATTEMPTS.
      if (a.archetype === b.archetype) continue
      if (attempt < MAX_ATTEMPTS && !isAllowedFirstBout(a.skin, b.skin)) continue
      return [a, b]
    }
  }

  /**
   * Bouts 2+: least-recently-shown greedy that guarantees roster coverage (see
   * {@link COVERAGE_BOUND}). One side is the globally stalest skin — the one
   * unseen for the most bouts — and the other is the stalest skin of a *different*
   * archetype, so the pick is never a moveset mirror and always advances the two
   * most-overdue coverable skins. Ties (common early, when several skins are
   * equally unseen) break on the rng, which is what keeps the reel varied rather
   * than a fixed rotation; the stage and seed are drawn by the caller as before.
   * No budget check — the first-bout download budget is a cold-load concern and
   * applies to bout 1 only.
   */
  private pickCoveragePair(): [RosterEntry, RosterEntry] {
    const a = this.stalest(ROSTER)
    const b = this.stalest(ROSTER.filter((e) => e.archetype !== a.archetype))
    return [a, b]
  }

  /** The entry in `pool` shown least recently (never-shown counts as maximally
   *  stale), ties broken on the rng so coverage does not flatten into a fixed
   *  order. `pool` is always non-empty at the call sites. */
  private stalest(pool: RosterEntry[]): RosterEntry {
    const staleness = (e: RosterEntry) => this._boutOrdinal - (this._lastSeen.get(e.skin) ?? 0)
    let max = -Infinity
    for (const e of pool) max = Math.max(max, staleness(e))
    const top = pool.filter((e) => staleness(e) === max)
    return top.length === 1 ? top[0] : top[this.rng.int(top.length)]
  }

  private buildSim(m: AttractMatchup): MatchSim {
    const sim = new MatchSim({
      p1: { skin: m.a.skin, base: m.a.archetype },
      p2: { skin: m.b.skin, base: m.b.archetype },
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
   * therefore the archetype distribution and the budget-constrained opener — byte-
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
