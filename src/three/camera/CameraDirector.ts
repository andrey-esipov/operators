import * as THREE from 'three'
import {
  WORLD,
  type EngineContext,
  type FightEvent,
  type FightRenderState,
  type HitFlavor,
  type Subsystem,
} from '../types'
import type { Side } from '../../types'
import {
  Spring1,
  Spring3,
  clamp,
  clamp01,
  decayTo,
  easeInOut,
  easeInCubic,
  easeOutCubic,
  easeOutBack,
  fbm1,
  lerp,
} from './CameraMath'

/**
 * The camera director / virtual cinematographer.
 *
 * A AAA fighting-game camera is an authored performer. It breathes in neutral,
 * recoils on contact with per-hit character, and treats every super and K.O.
 * as a scripted, multi-beat cutscene. This director drives four channels —
 * eye position, look-target, focal length (fov) and roll — through spring
 * dampers so the camera carries momentum and settles with weight instead of
 * snapping on a lerp.
 *
 * Layers, from the bottom up:
 *   1. A shot goal (composition) computed each frame from live fighter anchors.
 *   2. Spring integrators that chase the goal with mass and overshoot.
 *   3. A trauma shake + directional recoil impulse for impact language.
 *   4. Subtle fractal handheld drift so nothing is ever mechanically still.
 */

type Mode = 'neutral' | 'closeup' | 'super' | 'shatter' | 'ko' | 'intro'

/** How authoritative a mode is — a lower-priority event can't steal the camera. */
const MODE_PRIORITY: Record<Mode, number> = {
  neutral: 0,
  closeup: 1,
  shatter: 2,
  super: 3,
  ko: 4,
  intro: 4,
}

interface Pose {
  px: number
  py: number
  pz: number
  tx: number
  ty: number
  tz: number
  fov: number
  roll: number
}

interface Keyframe {
  t: number
  build: () => Pose
  ease?: (t: number) => number
}

/** Per-flavour impact character. Tuned so light taps buzz and heavies thud. */
interface ImpactProfile {
  trauma: number
  /** Shake frequency (Hz-ish). Heavies are lower/slower, lights higher/buzzier. */
  freq: number
  /** Trauma decay rate. */
  decay: number
  /** Recoil impulse magnitude along the knock direction. */
  push: number
  /** Roll kick magnitude. */
  roll: number
  /** Instantaneous focal-length punch-in (degrees). */
  fovPunch: number
}

const IMPACT: Record<HitFlavor, ImpactProfile> = {
  light: { trauma: 0.26, freq: 33, decay: 12, push: 0.1, roll: 0.006, fovPunch: 0.8 },
  combo: { trauma: 0.42, freq: 28, decay: 8.5, push: 0.2, roll: 0.011, fovPunch: 1.4 },
  ex: { trauma: 0.5, freq: 25, decay: 7.5, push: 0.26, roll: 0.014, fovPunch: 1.9 },
  heavy: { trauma: 0.52, freq: 22, decay: 6.5, push: 0.3, roll: 0.016, fovPunch: 2.1 },
  crit: { trauma: 0.78, freq: 19, decay: 5.2, push: 0.46, roll: 0.026, fovPunch: 3.6 },
  ult: { trauma: 0.9, freq: 17, decay: 4.4, push: 0.5, roll: 0.03, fovPunch: 3.2 },
  signature: { trauma: 1, freq: 15, decay: 3.8, push: 0.58, roll: 0.034, fovPunch: 3.4 },
}

export class CameraDirector implements Subsystem {
  readonly name = 'camera'

  private ctx!: EngineContext
  private camera!: THREE.PerspectiveCamera

  // Live channels driven by springs.
  private posSpring = new Spring3(...WORLD.CAMERA.position)
  private tgtSpring = new Spring3(...WORLD.CAMERA.target)
  private fovSpring = new Spring1(WORLD.CAMERA.fov)
  private rollSpring = new Spring1(0)

  // Impact channels (spring back to zero for momentum + overshoot).
  private recoil = new Spring3(0, 0, 0)
  private rollKick = new Spring1(0)
  private fovKick = 0

  // Trauma-based shake (Squirrel Eiserloh's model): displacement is trauma²,
  // so small hits barely register and big hits slam the frame.
  private trauma = 0
  private traumaDecay = 6
  private shakeFreq = 24

  // Shot / cinematic state machine.
  private mode: Mode = 'neutral'
  private modeTime = 0
  private modeDur = 0
  private focus: Side = 'b'
  private attacker: Side = 'a'
  private loser: Side = 'b'
  private winner: Side = 'a'

  private time = 0
  private seed = 0

  // Deterministic beat preview for the screenshot harness only. Freezes a
  // cinematic at a normalised timeline position so authored compositions can be
  // judged without fighting the real-time hitstop/framerate coupling (early
  // super frames advance slowly under hitstop, so wall-clock settle does not map
  // linearly onto super-time). Never set during real play.
  private debugHold: { mode: Mode; t: number } | null = null
  private readonly MODE_DUR: Record<Mode, number> = {
    neutral: 0,
    closeup: 0.8,
    shatter: 1.5,
    super: 2.6,
    ko: 4.0,
    intro: 3.0,
  }

  // Reusable scratch so the hot path allocates nothing.
  private _a = new THREE.Vector3()
  private _b = new THREE.Vector3()
  private _p = new THREE.Vector3()
  private _t = new THREE.Vector3()
  private _v = new THREE.Vector3()
  private goalPos = new THREE.Vector3()
  private goalTgt = new THREE.Vector3()

  private baseFov = WORLD.CAMERA.fov

  init(ctx: EngineContext) {
    this.ctx = ctx
    this.camera = ctx.camera
    this.baseFov = WORLD.CAMERA.fov
    this.seed = ctx.rng() * 1000
    this.posSpring.set(new THREE.Vector3(...WORLD.CAMERA.position))
    this.tgtSpring.set(new THREE.Vector3(...WORLD.CAMERA.target))
    this.fovSpring.set(WORLD.CAMERA.fov)
    // Open on the establishing shot so the very first frames sell the arena.
    this.startMode('intro', 3.0)
    // Debug handle so the screenshot harness can drive intro/victory beats
    // that aren't otherwise reachable through the lab's event surface.
    if (typeof window !== 'undefined') {
      ;(window as unknown as { __opsCamera?: CameraDirector }).__opsCamera = this
    }
    this.applyToCamera(0)
  }

  /**
   * @internal QA-only. Freeze a cinematic at a normalised timeline position and
   * let the springs settle to the authored pose. Lets the screenshot harness
   * capture deterministic beat compositions regardless of framerate/hitstop.
   */
  __debugBeat(mode: Mode, t: number, sides?: { attacker?: Side; loser?: Side; winner?: Side; focus?: Side }) {
    if (sides?.attacker) {
      this.attacker = sides.attacker
      this.focus = sides.attacker
    }
    if (sides?.focus) this.focus = sides.focus
    if (sides?.loser) {
      this.loser = sides.loser
      this.focus = sides.loser
    }
    if (sides?.winner) this.winner = sides.winner
    this.mode = mode
    this.modeDur = this.MODE_DUR[mode] || 2.6
    this.modeTime = clamp01(t) * this.modeDur
    this.debugHold = { mode, t: clamp01(t) }
  }

  /** @internal QA-only. Release a held beat back to live behaviour. */
  __debugClear() {
    this.debugHold = null
    this.mode = 'neutral'
    this.modeTime = this.modeDur
  }

  // ---------------------------------------------------------------- events ---

  onEvent(e: FightEvent) {
    switch (e.kind) {
      case 'hit': {
        const prof = IMPACT[e.flavor]
        const power = clamp01(e.power)
        this.applyImpact(prof, power, e.target)
        // Supers own the camera via their `cast`; a plain crit gets a punchy
        // reaction cut only when nothing more important is running.
        if ((e.flavor === 'crit' || e.shattered) && this.mode === 'neutral') {
          this.focus = e.target
          this.startMode('closeup', e.flavor === 'crit' ? 0.8 : 0.6)
        }
        break
      }
      case 'cast':
        if (e.flavor === 'ult' || e.flavor === 'signature') {
          this.attacker = e.attacker
          this.focus = e.attacker
          this.startMode('super', e.flavor === 'signature' ? 3.1 : 2.6)
        }
        break
      case 'signature':
        this.attacker = e.attacker
        this.focus = e.attacker
        this.startMode('super', 3.1)
        break
      case 'shatter':
        this.focus = e.side
        this.applyImpact(IMPACT.heavy, 1, e.side)
        this.startMode('shatter', 1.5)
        break
      case 'ko':
        this.loser = e.loser
        this.winner = e.winner
        this.focus = e.loser
        this.applyImpact(IMPACT.crit, 1, e.loser)
        this.startMode('ko', 4.0)
        break
      case 'round-start':
      case 'intro':
        this.startMode('intro', 3.0)
        break
      case 'round-end':
        // Victory push-in on the winner (round-end carries the survivor).
        if (e.winner !== 'time') {
          this.winner = e.winner
          this.focus = e.winner
          this.startMode('ko', 3.2)
        }
        break
    }
  }

  private startMode(mode: Mode, dur: number) {
    // Respect priority so a light hit can't interrupt a K.O. cinematic.
    if (mode !== 'neutral' && MODE_PRIORITY[mode] < MODE_PRIORITY[this.mode] && this.modeTime < this.modeDur) {
      return
    }
    this.mode = mode
    this.modeTime = 0
    this.modeDur = dur
  }

  private applyImpact(prof: ImpactProfile, power: number, target: Side) {
    this.addTrauma(prof.trauma * (0.55 + power * 0.65))
    this.traumaDecay = prof.decay
    this.shakeFreq = prof.freq
    // Victim is knocked away from the attacker; the frame recoils with them,
    // then springs back — a whip on the +x/−x axis plus a punch toward the
    // action on z.
    const dir = target === 'a' ? -1 : 1
    const mag = prof.push * (0.6 + power * 0.7)
    this._v.set(dir * mag * 3.4, mag * 0.9, -mag * 2.6)
    this.recoil.kick(this._v)
    this.rollKick.kick(dir * prof.roll * (0.7 + power) * 9)
    this.fovKick = Math.min(this.fovKick + prof.fovPunch * (0.6 + power * 0.6), 7)
  }

  addTrauma(v: number) {
    this.trauma = clamp01(this.trauma + v)
  }

  // ----------------------------------------------------------------- frame ---

  update(dt: number, state: FightRenderState) {
    this.time += dt
    if (this.debugHold) {
      // QA freeze: hold the authored beat so the spring settles to it.
      this.mode = this.debugHold.mode
      this.modeDur = this.MODE_DUR[this.debugHold.mode] || 2.6
      this.modeTime = this.debugHold.t * this.modeDur
    } else {
      this.modeTime += dt
      if (this.mode !== 'neutral' && this.modeTime >= this.modeDur) {
        this.mode = 'neutral'
      }
    }

    const goal = this.computeGoal(state)

    this.goalPos.set(goal.px, goal.py, goal.pz)
    this.goalTgt.set(goal.tx, goal.ty, goal.tz)

    // Spring stiffness/damping per mode: neutral is soft and floaty, cuts are
    // snappy with a touch of overshoot for kinetic energy.
    const s = this.springProfile()
    this.posSpring.step(this.goalPos, s.posOmega, s.posZeta, dt)
    this.tgtSpring.step(this.goalTgt, s.aimOmega, s.aimZeta, dt)
    this.fovSpring.step(goal.fov, s.fovOmega, 1.0, dt)
    this.rollSpring.step(goal.roll, s.rollOmega, s.rollZeta, dt)

    // Impact springs relax back to rest.
    this.recoil.step(this._p.set(0, 0, 0), 26, 0.55, dt)
    this.rollKick.step(0, 30, 0.5, dt)
    this.fovKick = decayTo(this.fovKick, 9, dt)

    // Trauma shake.
    this.trauma = Math.max(0, this.trauma - this.traumaDecay * dt)
    const shake = this.trauma * this.trauma

    this.applyToCamera(shake)
  }

  private springProfile() {
    switch (this.mode) {
      case 'neutral':
        return { posOmega: 5.5, posZeta: 1.0, aimOmega: 6.5, aimZeta: 1.0, fovOmega: 4, rollOmega: 6, rollZeta: 1 }
      case 'closeup':
        return { posOmega: 15, posZeta: 0.78, aimOmega: 18, aimZeta: 0.85, fovOmega: 14, rollOmega: 16, rollZeta: 0.8 }
      case 'shatter':
        return { posOmega: 17, posZeta: 0.72, aimOmega: 20, aimZeta: 0.85, fovOmega: 16, rollOmega: 18, rollZeta: 0.75 }
      case 'super':
        return { posOmega: 11, posZeta: 0.9, aimOmega: 14, aimZeta: 0.95, fovOmega: 10, rollOmega: 12, rollZeta: 0.9 }
      case 'ko':
        return { posOmega: 8, posZeta: 0.95, aimOmega: 11, aimZeta: 1.0, fovOmega: 8, rollOmega: 10, rollZeta: 0.95 }
      case 'intro':
        return { posOmega: 9, posZeta: 1.0, aimOmega: 11, aimZeta: 1.0, fovOmega: 9, rollOmega: 10, rollZeta: 1 }
    }
  }

  // ------------------------------------------------------------ composition ---

  private computeGoal(state: FightRenderState): Pose {
    switch (this.mode) {
      case 'neutral':
        return this.neutralPose(state)
      case 'closeup':
        return this.timeline(this.closeupKeys(), this.modeTime / this.modeDur)
      case 'shatter':
        return this.timeline(this.shatterKeys(), this.modeTime / this.modeDur)
      case 'super':
        return this.timeline(this.superKeys(), this.modeTime / this.modeDur)
      case 'ko':
        return this.timeline(this.koKeys(), this.modeTime / this.modeDur)
      case 'intro':
        return this.timeline(this.introKeys(state), this.modeTime / this.modeDur)
    }
  }

  /** Dynamic two-shot that breathes with the fighters and keeps lead room. */
  private neutralPose(state: FightRenderState): Pose {
    const a = this.ctx.anchors.fighter('a')
    const b = this.ctx.anchors.fighter('b')
    const midX = (a.x + b.x) * 0.5
    const spread = Math.abs(a.x - b.x)

    // Fit distance from the horizontal field of view so both fighters sit with
    // consistent lead room regardless of spacing.
    const tension = 1 - Math.min(state.a.hp01, state.b.hp01)
    const fov = this.baseFov - tension * 1.6
    const vHalfTan = Math.tan(THREE.MathUtils.degToRad(fov) * 0.5)
    const hHalfTan = vHalfTan * this.camera.aspect
    const halfWidthNeeded = spread * 0.5 + 2.15
    let dist = halfWidthNeeded / hHalfTan
    dist = clamp(dist, 8.4, 12.5) - tension * 0.7

    // Very slow breathing dolly so the neutral hold is alive.
    const breathe = Math.sin(this.time * 0.5 + this.seed) * 0.08

    // Slight lateral bias by momentum so the hold isn't dead-centre symmetric —
    // the frame leans a hair toward whoever is further from origin.
    const lean = clamp(midX * 0.16, -0.4, 0.4)

    return {
      px: midX * 0.22 + lean * 0.3,
      py: 2.26,
      pz: dist + breathe,
      tx: midX * 0.3 + lean,
      ty: 1.54,
      tz: 0,
      fov,
      roll: 0,
    }
  }

  // A tiny pose builder that reads live anchors for a given side.
  private chest(side: Side) {
    return this.ctx.anchors.fighter(side)
  }
  private head(side: Side): THREE.Vector3 {
    return this.ctx.anchors.get(`fighter:${side}:head`) ?? this._a.copy(this.chest(side)).setY(this.chest(side).y + 1.3)
  }
  private feet(side: Side): THREE.Vector3 {
    return this.ctx.anchors.get(`fighter:${side}:feet`) ?? this._b.copy(this.chest(side)).setY(0)
  }
  /** Facing direction along x (fighters face each other). */
  private facing(side: Side): number {
    return side === 'a' ? 1 : -1
  }

  // ---- Closeup: quick reaction cut on the struck fighter -------------------
  private closeupKeys(): Keyframe[] {
    const side = this.focus
    const build = (dist: number, fov: number, lead: number, roll: number, yLift: number): Pose => {
      const c = this.chest(side)
      const h = this.head(side)
      const f = this.feet(side)
      const centerY = lerp(f.y, h.y, 0.56)
      const toCenter = side === 'a' ? 1 : -1
      return {
        px: c.x * 0.55,
        py: centerY + yLift,
        pz: dist,
        tx: c.x + toCenter * lead,
        ty: centerY,
        tz: 0,
        fov,
        roll,
      }
    }
    const rollDir = side === 'a' ? -1 : 1
    return [
      { t: 0.0, build: () => build(5.4, 25, 1.05, rollDir * 0.065, 0.08), ease: easeOutCubic },
      { t: 0.55, build: () => build(5.7, 26, 0.95, rollDir * 0.045, 0.1) },
      { t: 1.0, build: () => build(6.8, 29, 0.78, rollDir * 0.014, 0.12), ease: easeInOut },
    ]
  }

  // ---- Shatter: armour-break punch-in with a hard dutch ---------------------
  private shatterKeys(): Keyframe[] {
    const side = this.focus
    const rollDir = side === 'a' ? 1 : -1
    const build = (dist: number, fov: number, roll: number): Pose => {
      const c = this.chest(side)
      const h = this.head(side)
      const f = this.feet(side)
      const centerY = lerp(f.y, h.y, 0.6)
      const toCenter = side === 'a' ? 1 : -1
      return {
        px: c.x * 0.6,
        py: centerY + 0.05,
        pz: dist,
        tx: c.x + toCenter * 0.85,
        ty: centerY,
        tz: 0,
        fov,
        roll,
      }
    }
    return [
      { t: 0.0, build: () => build(5.7, 27, rollDir * 0.15), ease: easeOutBack },
      { t: 0.6, build: () => build(6.1, 28, rollDir * 0.10) },
      { t: 1.0, build: () => build(7.0, 30, rollDir * 0.04), ease: easeInOut },
    ]
  }

  // ---- Super / ult: a whip-in, low hero orbit, charge and slam-out ----------
  private superKeys(): Keyframe[] {
    const side = this.attacker
    const f = this.facing(side)
    const rollDir = f

    // dist = Z distance; fwd = camera offset along the fighter's facing on X
    // (large = raking side profile, small = dead front); y = camera height;
    // lookY = aim offset above the chest; lookFwd = aim lead along facing.
    const hero = (dist: number, fwd: number, y: number, fov: number, roll: number, lookY: number, lookFwd: number): Pose => {
      const c = this.chest(side)
      return {
        px: c.x + f * fwd,
        py: y,
        pz: dist,
        tx: c.x + f * lookFwd,
        ty: c.y + lookY,
        tz: 0,
        fov,
        roll: rollDir * roll,
      }
    }

    return [
      // 1. Whip-in: hard low side profile, hardest dutch, wide lens collapsing.
      { t: 0.0, build: () => hero(5.8, 3.4, 0.9, 42, 0.17, 0.7, 0.5), ease: easeOutCubic },
      // 2. Camera lifts HIGH and looks down as the fighter starts to rise — the one
      //    down-angle in the piece, a counterpoint that the following floor beats
      //    pay off. Harder cant so the tilt commits.
      { t: 0.14, build: () => hero(4.5, 1.4, 2.5, 30, 0.13, 0.5, 0.28), ease: easeInOut },
      // 3. THE hero closeup — low up-angle, tight lens, and we cant HARD the OTHER
      //    way (a real counter-roll, steep enough that the reversal reads). Held one
      //    notch wider than the beat-5 charge so the two closeups differ in scale.
      { t: 0.32, build: () => hero(4.4, 0.9, 1.45, 28, -0.17, 0.6, 0.14), ease: easeInOut },
      // 4. Midpoint ESCALATION: drop the camera to the floor and punch a hard
      //    towering up-angle medium, dutch snapping back positive — a torque swing
      //    and a genuine new idea, never a reset to the opening wide.
      { t: 0.5, build: () => hero(4.5, 1.5, 0.12, 33, 0.16, 0.12, 0.28), ease: easeInOut },
      // 5. Charge: whip into the tightest face closeup, dutch at its steepest as
      //    the strike winds up.
      { t: 0.72, build: () => hero(3.8, 0.5, 1.55, 23, 0.13, 0.78, 0.08), ease: easeInCubic },
      // 6. SLAM: throw the camera to the FLOOR and go ULTRA-wide for the finisher
      //    — a hard low up-angle towering over the caster (much lower than the
      //    eye-level opening wide), bold dutch, feet grounded by the wide lens.
      { t: 0.84, build: () => hero(4.3, 0.95, 0.42, 52, 0.12, 0.12, 0.2), ease: easeOutCubic },
      // 7. Land the button LOW and wide — drop the camera near the deck and open
      //    the lens so the finisher settles on a grounded low-hero full figure
      //    (not a medium re-cant); the spring-back to neutral is the resolution.
      { t: 1.0, build: () => hero(4.6, 1.15, 0.4, 40, 0.07, 0.2, 0.18), ease: easeOutCubic },
    ]
  }

  // ---- K.O.: slow arc around the loser, drop low, settle on the winner ------
  private koKeys(): Keyframe[] {
    const loser = this.loser
    const winner = this.winner
    const lf = this.facing(loser)

    const onLoser = (dist: number, sideOff: number, y: number, fov: number, roll: number, lookBias: number): Pose => {
      const c = this.chest(loser)
      const h = this.head(loser)
      const f = this.feet(loser)
      // Look toward the upper torso/head so the loser's reaction always reads
      // with headroom, whatever the angle.
      const ty = lerp(f.y, h.y, lookBias)
      return {
        px: c.x + sideOff,
        py: y,
        pz: dist,
        tx: c.x - lf * 0.35,
        ty,
        tz: 0,
        fov,
        roll,
      }
    }

    const onWinner = (dist: number, y: number, fov: number, roll: number): Pose => {
      const c = this.chest(winner)
      const wf = this.facing(winner)
      return {
        px: c.x + wf * 1.6,
        py: y,
        pz: dist,
        tx: c.x + wf * 0.2,
        ty: c.y + 0.42,
        tz: 0,
        fov,
        roll,
      }
    }

    return [
      // impact snap on the loser — a shade high, looking down on the fall
      { t: 0.0, build: () => onLoser(6.6, lf * 1.5, 2.7, 30, lf * 0.09, 0.62), ease: easeOutCubic },
      // slow orbit across the front as they crumple
      { t: 0.3, build: () => onLoser(6.8, -lf * 0.2, 2.35, 30, lf * 0.05, 0.62), ease: easeInOut },
      // drop to a low hero angle looking up, canted the other way
      { t: 0.52, build: () => onLoser(6.4, -lf * 1.5, 1.15, 31, -lf * 0.085, 0.72), ease: easeInOut },
      // sweep across to the winner, rising into a triumphant low angle
      { t: 0.74, build: () => onWinner(6.8, 1.2, 30, 0.055), ease: easeInOut },
      { t: 1.0, build: () => onWinner(6.2, 1.7, 29, 0.025), ease: easeOutCubic },
    ]
  }

  // ---- Intro: wide establishing crane that settles into neutral -------------
  private introKeys(state: FightRenderState): Keyframe[] {
    const n = this.neutralPose(state)
    // Kept near fighter height so the bright arena backdrop fills the frame
    // behind the fighters — a high downward angle would just show dark floor.
    const establish = (): Pose => ({
      px: -2.4,
      py: 3.05,
      pz: n.pz + 5.4,
      tx: 0.2,
      ty: 1.68,
      tz: 0,
      fov: 44,
      roll: 0.035,
    })
    const sweep = (): Pose => ({
      px: -1.0,
      py: 2.72,
      pz: n.pz + 2.3,
      tx: 0.1,
      ty: 1.6,
      tz: 0,
      fov: 38,
      roll: 0.018,
    })
    const settle = (): Pose => ({ ...n, roll: 0 })
    return [
      { t: 0.0, build: establish, ease: easeInOut },
      { t: 0.5, build: sweep, ease: easeInOut },
      { t: 1.0, build: settle, ease: easeOutCubic },
    ]
  }

  /** Evaluate a keyframe timeline at normalised progress p∈[0,1]. */
  private timeline(keys: Keyframe[], p: number): Pose {
    p = clamp01(p)
    if (p <= keys[0].t) return keys[0].build()
    const last = keys[keys.length - 1]
    if (p >= last.t) return last.build()
    let i = 0
    while (i < keys.length - 1 && keys[i + 1].t <= p) i++
    const k0 = keys[i]
    const k1 = keys[i + 1]
    const span = Math.max(1e-4, k1.t - k0.t)
    const local = (p - k0.t) / span
    const e = (k1.ease ?? easeInOut)(local)
    const A = k0.build()
    const B = k1.build()
    return {
      px: lerp(A.px, B.px, e),
      py: lerp(A.py, B.py, e),
      pz: lerp(A.pz, B.pz, e),
      tx: lerp(A.tx, B.tx, e),
      ty: lerp(A.ty, B.ty, e),
      tz: lerp(A.tz, B.tz, e),
      fov: lerp(A.fov, B.fov, e),
      roll: lerp(A.roll, B.roll, e),
    }
  }

  // -------------------------------------------------------------- transform ---

  private applyToCamera(shake: number) {
    // Handheld operator drift — fractal, low amplitude, scaled down under
    // authored cinematics so scripted moves stay clean.
    const gain =
      this.mode === 'neutral' ? 1 : this.mode === 'ko' ? 0.5 : this.mode === 'intro' ? 0.6 : 0.35
    const tt = this.time
    const driftX = fbm1(tt * 0.9, this.seed) * 0.05 * gain
    const driftY = fbm1(tt * 0.75, this.seed + 4) * 0.04 * gain
    const driftZ = fbm1(tt * 0.6, this.seed + 9) * 0.035 * gain
    const driftRoll = fbm1(tt * 0.7, this.seed + 13) * 0.004 * gain

    // Trauma shake — per-axis, frequency set by the last impact so heavies feel
    // slower and lights buzz. Displacement scales with trauma².
    const st = this.time * this.shakeFreq
    const shX = fbm1(st, this.seed + 21) * shake * 0.62
    const shY = fbm1(st, this.seed + 37) * shake * 0.5
    const shZ = fbm1(st * 0.7, this.seed + 53) * shake * 0.34
    const shRoll = fbm1(st, this.seed + 71) * shake * 0.07

    this._p
      .copy(this.posSpring.value)
      .add(this.recoil.value)
    this._p.x += driftX + shX
    this._p.y += driftY + shY
    this._p.z += driftZ + shZ

    this._t.copy(this.tgtSpring.value)
    // The target drifts a fraction of the eye so we get natural parallax, not a
    // rigid pan-and-scan.
    this._t.x += driftX * 0.35 + shX * 0.4
    this._t.y += driftY * 0.35 + shY * 0.4

    this.camera.position.copy(this._p)
    this.camera.up.set(0, 1, 0)
    this.camera.lookAt(this._t)
    this.camera.rotateZ(this.rollSpring.value + this.rollKick.value + driftRoll + shRoll)

    const fov = clamp(this.fovSpring.value - this.fovKick, 14, 55)
    if (Math.abs(this.camera.fov - fov) > 1e-3) {
      this.camera.fov = fov
      this.camera.updateProjectionMatrix()
    }
  }

  dispose() {
    if (typeof window !== 'undefined') {
      delete (window as unknown as { __opsCamera?: CameraDirector }).__opsCamera
    }
  }
}
