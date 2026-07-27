import type { FightState, FighterState, FightEvent, StepResult, Vec2, Stance, HitLevel } from '../../fight/types'

/**
 * HARNESS-ONLY scripted simulation. This is emphatically NOT the real fight
 * sim (that lands via `src/fight/**`). It exists so the renderer can be driven,
 * screenshotted and judged against the frozen contract before the real sim is
 * ready. It choreographs a looping exhibition — footsies, a dash punch, a
 * jump-in that gets blocked, a counter combo, a super, and a KO — emitting the
 * same `FightEvent`s at the same contact points the real sim will, so every
 * effect, camera push and hitstop is exercised.
 */

const FLOOR = 0
const START = 138 // cm, ~world 2.6 each side
// Stage walls in cm. DEFAULT_BOUNDS is ±8.2 world units and CM_TO_WORLD is
// 3.4/180, so the wall sits at 8.2 * 180/3.4 ≈ 434cm. Held slightly inside
// that so a cornered fighter still reads as on-stage rather than clipped
// into the boundary.
export const STAGE_MAX_X = 420
export const STAGE_MIN_X = -420

/**
 * Movement speeds in centimetres per 60Hz frame.
 *
 * These were originally authored an order of magnitude too fast — a 26cm/frame
 * walk is 15.6 m/s, faster than a world-record sprint — which sent both
 * fighters into opposite walls within the first beat. Real fighters walk around
 * 1.5 m/s and dash around 5 m/s; the values below are those, converted.
 */
const SPEED = {
  walkFwd: 2.6,
  walkBack: 2.2,
  dash: 9,
  /** Small step the attacker takes into a strike. */
  lunge: 1.2,
  /** Peak pushback when hitstun starts; decays to zero over the beat. */
  hitstun: 3.1,
  /** Pushback on a blocked hit. */
  block: 3,
}

interface Kin {
  pos: Vec2
  vel: Vec2
  facing: 1 | -1
  stance: Stance
  move?: { id: string; frame: number }
  grounded: boolean
  health: number
}

type Emit = (e: FightEvent) => void

interface Beat {
  dur: number
  /** Called once when the beat starts. */
  enter?: (s: MockSim, emit: Emit) => void
  /** Per-frame, t = 0..dur-1. */
  tick?: (s: MockSim, t: number, emit: Emit) => void
}

function contact(attacker: Kin, defender: Kin): Vec2 {
  void attacker
  return { x: defender.pos.x - defender.facing * 16, y: 108 }
}

export class MockSim {
  frame = 0
  private beats: Beat[] = []
  private cursor = 0
  private local = 0
  private phaseName = ''
  k: [Kin, Kin]
  private maxHp = 1000

  constructor() {
    this.k = [
      { pos: { x: -START, y: FLOOR }, vel: { x: 0, y: 0 }, facing: 1, stance: 'idle', grounded: true, health: this.maxHp },
      { pos: { x: START, y: FLOOR }, vel: { x: 0, y: 0 }, facing: -1, stance: 'idle', grounded: true, health: this.maxHp },
    ]
    this.build()
  }

  private faceOff() {
    this.k[0].facing = this.k[0].pos.x <= this.k[1].pos.x ? 1 : -1
    this.k[1].facing = this.k[1].pos.x < this.k[0].pos.x ? 1 : -1
  }

  private build() {
    const b: Beat[] = []
    const idle = (dur: number): Beat => ({
      dur,
      enter: (s) => { s.setStance(0, 'idle'); s.setStance(1, 'idle'); s.k[0].vel.x = 0; s.k[1].vel.x = 0 },
    })

    // ---- Neutral -----------------------------------------------------------
    b.push({ dur: 70, enter: (s) => { s.phaseName = 'neutral' }, tick: (s) => s.faceOff() })

    // ---- Footsies: both inch forward, back off -----------------------------
    b.push({
      dur: 80,
      enter: (s) => { s.phaseName = 'footsies'; s.setStance(0, 'walk-fwd'); s.setStance(1, 'walk-fwd') },
      tick: (s, t) => {
        const dir = t < 50 ? 1 : -1
        s.walk(0, SPEED.walkFwd * dir)
        s.walk(1, SPEED.walkBack * -dir)
        s.setStance(0, dir > 0 ? 'walk-fwd' : 'walk-back')
        s.setStance(1, dir > 0 ? 'walk-fwd' : 'walk-back')
      },
    })

    // ---- A dashes in -------------------------------------------------------
    b.push({
      dur: 16,
      enter: (s) => { s.phaseName = 'dash-in'; s.setStance(0, 'dash') },
      tick: (s) => s.walk(0, SPEED.dash * s.k[0].facing),
    })

    // ---- A heavy punch, connects -------------------------------------------
    b.push(this.attackBeat(0, 1, 'heavy', 120, 26, 8, { knockCm: 70, up: 0 }))

    // ---- B staggers back in hitstun ----------------------------------------
    b.push({
      dur: 26,
      enter: (s) => { s.phaseName = 'hitstun'; s.setStance(0, 'idle'); s.setStance(1, 'hitstun') },
      tick: (s, t) => {
        // Pushback away from the attacker, easing out across the beat.
        s.walk(1, SPEED.hitstun * (1 - t / 26) * -s.k[1].facing)
      },
    })

    b.push(idle(30))
    b.push({ dur: 40, enter: (s) => { s.setStance(1, 'walk-back') }, tick: (s) => { s.walk(1, SPEED.walkBack * -s.k[1].facing); s.faceOff() } })

    // ---- B jumps in, A blocks ----------------------------------------------
    b.push(this.jumpBeat(1, -70, 150, 34))
    b.push(this.attackBeat(1, 0, 'medium', 60, 18, 6, { block: true }))

    // ---- A counter combo: two hits then a launcher -------------------------
    b.push({ dur: 10, enter: (s) => { s.phaseName = 'counter'; s.setStance(0, 'idle') } })
    b.push(this.attackBeat(0, 1, 'light', 40, 12, 4, { knockCm: 14 }))
    b.push(this.attackBeat(0, 1, 'medium', 60, 14, 5, { knockCm: 20 }))
    b.push(this.attackBeat(0, 1, 'launcher', 90, 16, 6, { knockCm: 24, up: 190 }))

    // ---- B juggled airborne ------------------------------------------------
    b.push({
      dur: 34,
      enter: (s) => { s.phaseName = 'juggle'; s.setStance(1, 'juggle'); s.k[1].grounded = false; s.k[1].vel.y = 0 },
      tick: (s) => { s.gravity(1); s.setStance(1, s.k[1].vel.y >= 0 ? 'juggle' : 'juggle') },
    })

    // ---- A super flash + big finish ---------------------------------------
    b.push({
      dur: 40,
      enter: (s) => { s.phaseName = 'super'; s.setStance(0, 'attack'); s.k[0].move = { id: 'super', frame: 0 } },
      tick: (s, t, emit) => {
        if (t === 2) emit({ type: 'super-flash', who: 0, moveId: 'super' })
        if (s.k[0].move) s.k[0].move.frame = t
        s.gravity(1)
      },
    })
    b.push(this.attackBeat(0, 1, 'crumple', 220, 20, 10, { knockCm: 120, up: 60, ko: true }))

    // ---- KO + reset --------------------------------------------------------
    b.push({
      dur: 70,
      enter: (s) => { s.phaseName = 'ko'; s.setStance(1, 'ko'); s.k[1].grounded = false },
      tick: (s, t, emit) => {
        s.gravity(1)
        if (s.k[1].pos.y <= 0 && t < 6) { s.k[1].pos.y = 0; s.k[1].grounded = true }
        if (t === 30) emit({ type: 'round-end', winner: 0 })
      },
    })
    b.push({
      dur: 40,
      enter: (s, emit) => {
        s.phaseName = 'reset'
        s.k[0].pos = { x: -START, y: 0 }; s.k[1].pos = { x: START, y: 0 }
        s.k[0].vel = { x: 0, y: 0 }; s.k[1].vel = { x: 0, y: 0 }
        s.k[0].grounded = true; s.k[1].grounded = true
        s.k[0].health = s.maxHp; s.k[1].health = s.maxHp
        s.k[0].move = undefined; s.k[1].move = undefined
        s.setStance(0, 'idle'); s.setStance(1, 'idle')
        s.faceOff()
        emit({ type: 'round-start', round: 1 })
      },
    })

    this.beats = b
  }

  // ---- Beat factories ------------------------------------------------------

  private attackBeat(
    atk: 0 | 1,
    def: 0 | 1,
    level: HitLevel,
    damage: number,
    dur: number,
    activeFrame: number,
    opt: { knockCm?: number; up?: number; block?: boolean; ko?: boolean } = {},
  ): Beat {
    return {
      dur,
      enter: (s) => {
        s.phaseName = opt.block ? 'blocked' : 'attack'
        s.faceOff()
        s.setStance(atk, 'attack')
        s.k[atk].move = { id: level, frame: 0 }
        if (opt.block) s.setStance(def, 'blockstun')
      },
      tick: (s, t, emit) => {
        if (s.k[atk].move) s.k[atk].move.frame = t
        // small lunge into the strike
        if (t < activeFrame) s.walk(atk, SPEED.lunge * s.k[atk].facing)
        if (t === activeFrame) {
          const at = contact(s.k[atk], s.k[def])
          if (opt.block) {
            emit({ type: 'block', at, attacker: atk })
            s.k[def].vel.x = -s.k[def].facing * SPEED.block
          } else {
            emit({ type: 'hit', at, attacker: atk, level, damage })
            s.k[def].health = Math.max(0, s.k[def].health - damage)
            if (opt.up) {
              emit({ type: 'launch', at, attacker: atk })
              s.k[def].grounded = false
              s.k[def].vel.y = opt.up * 0.04
            }
            const kb = (opt.knockCm ?? 30)
            s.k[def].vel.x = -s.k[def].facing * kb * 0.05
            if (!opt.up) s.setStance(def, 'hitstun')
            s.k[def].move = undefined
            if (opt.ko) emit({ type: 'ko', who: def })
          }
        }
        s.slideDecay(def)
        s.gravity(def)
      },
    }
  }

  private jumpBeat(f: 0 | 1, dxCm: number, apexCm: number, dur: number): Beat {
    return {
      dur,
      enter: (s) => {
        s.phaseName = 'jump'
        s.k[f].grounded = false
        s.k[f].vel.y = apexCm * 0.045
        s.setStance(f, 'jump-rise')
      },
      tick: (s, t) => {
        s.walk(f, dxCm / dur)
        s.gravity(f)
        s.setStance(f, s.k[f].vel.y >= 0 ? 'jump-rise' : 'jump-fall')
        if (s.k[f].pos.y <= 0) { s.k[f].pos.y = 0; s.k[f].grounded = true }
      },
    }
  }

  // ---- Kinematic helpers ---------------------------------------------------

  setStance(f: 0 | 1, st: Stance) { this.k[f].stance = st }

  /** Set by any helper that has already moved a fighter in x this frame. */
  private movedX: [boolean, boolean] = [false, false]

  /**
   * Apply horizontal velocity exactly once per fighter per frame.
   *
   * walk(), slideDecay() and gravity() are all called together by various
   * beats, and each used to add vel.x to pos.x. A single airborne knockback
   * frame therefore integrated the same velocity three times. Compounded over
   * a loop it launched both fighters into the right wall, where the camera
   * (which correctly refuses to pan past the stage bound) framed them jammed
   * against the edge. Routing every x move through here keeps it to one.
   */
  private integrateX(f: 0 | 1, dx: number) {
    if (this.movedX[f]) return
    this.k[f].pos.x += dx
    this.movedX[f] = true
  }

  walk(f: 0 | 1, dxCm: number) {
    this.integrateX(f, dxCm)
    this.k[f].vel.x = dxCm
  }

  slideDecay(f: 0 | 1) {
    this.integrateX(f, this.k[f].vel.x)
    this.k[f].vel.x *= 0.86
  }

  gravity(f: 0 | 1) {
    if (this.k[f].grounded) return
    this.k[f].pos.y += this.k[f].vel.y
    this.integrateX(f, this.k[f].vel.x)
    this.k[f].vel.y -= 0.9 // cm/frame^2, tuned for a ~0.5s hop
    this.k[f].vel.x *= 0.98
    if (this.k[f].pos.y <= 0) { this.k[f].pos.y = 0; this.k[f].grounded = true; this.k[f].vel.y = 0 }
  }

  get phase(): string { return this.phaseName }

  step(): StepResult {
    const events: FightEvent[] = []
    const emit: Emit = (e) => events.push(e)

    this.movedX[0] = false
    this.movedX[1] = false

    let beat = this.beats[this.cursor]
    if (this.local === 0 && beat.enter) beat.enter(this, emit)
    beat.tick?.(this, this.local, emit)
    this.local++
    if (this.local >= beat.dur) {
      this.local = 0
      this.cursor = (this.cursor + 1) % this.beats.length
    }
    // Keep both feet on solid mirrored facing during grounded neutral.
    void beat

    this.frame++
    this.clampToStage()
    return { state: this.snapshot(), events }
  }

  /**
   * Keep both fighters inside the playable stage.
   *
   * The scripted beats apply knockback and walk deltas without ever checking
   * where the wall is, so pushback accumulated across a loop and both fighters
   * eventually wandered hundreds of centimetres past the stage edge — far
   * enough that the camera framed empty scenery. Clamping here also kills the
   * residual velocity, otherwise a fighter pinned to the wall keeps its stored
   * speed and rockets away the moment the next beat reads it.
   */
  private clampToStage() {
    for (const k of this.k) {
      if (k.pos.x < STAGE_MIN_X) { k.pos.x = STAGE_MIN_X; k.vel.x = 0 }
      else if (k.pos.x > STAGE_MAX_X) { k.pos.x = STAGE_MAX_X; k.vel.x = 0 }
    }
  }

  private snapshot(): FightState {
    const mk = (k: Kin, id: string): FighterState => ({
      id,
      pos: { x: k.pos.x, y: k.pos.y },
      vel: { x: k.vel.x, y: k.vel.y },
      facing: k.facing,
      stance: k.stance,
      health: k.health,
      maxHealth: this.maxHp,
      meter: 500,
      stunRemaining: 0,
      move: k.move ? { id: k.move.id, frame: k.move.frame } : undefined,
      comboCount: 0,
      juggleLeft: 3,
      grounded: k.grounded,
    })
    const a = mk(this.k[0], 'a')
    const b = mk(this.k[1], 'b')
    const focus: Vec2 = { x: (a.pos.x + b.pos.x) / 2, y: 80 }
    return {
      frame: this.frame,
      fighters: [a, b],
      timer: 99 * 60,
      round: 1,
      wins: [0, 0],
      phase: 'fight',
      hitstop: 0,
      cameraFocus: focus,
      cameraZoom: 1,
    }
  }
}

/** Convenience: initial state for FightRenderer.setInitialState before stepping. */
export function mockInitialState(sim: MockSim): FightState {
  return sim.step().state
}
