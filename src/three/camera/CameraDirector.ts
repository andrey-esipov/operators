import * as THREE from 'three'
import {
  WORLD,
  type EngineContext,
  type FightEvent,
  type FightRenderState,
  type Subsystem,
} from '../types'
import type { Side } from '../../types'

/**
 * The camera director.
 *
 * A fighting game camera is never static — it breathes, it snaps to impacts,
 * it pushes in on supers and it hangs on the K.O. This runs a small state
 * machine of camera "shots" plus a physically-damped shake so hits have
 * kinetic follow-through instead of a CSS jitter.
 */

type ShotName = 'neutral' | 'closeup' | 'super' | 'ko' | 'intro' | 'shatter'

interface Shot {
  position: THREE.Vector3
  target: THREE.Vector3
  fov: number
  /** How fast the camera eases toward this shot (higher = snappier). */
  speed: number
  roll: number
}

export class CameraDirector implements Subsystem {
  readonly name = 'camera'

  private ctx!: EngineContext
  private camera!: THREE.PerspectiveCamera

  private pos = new THREE.Vector3()
  private target = new THREE.Vector3()
  private fov = WORLD.CAMERA.fov
  private roll = 0

  private desired: Shot = {
    position: new THREE.Vector3(...WORLD.CAMERA.position),
    target: new THREE.Vector3(...WORLD.CAMERA.target),
    fov: WORLD.CAMERA.fov,
    speed: 3.2,
    roll: 0,
  }

  private shot: ShotName = 'neutral'
  private shotTimer = 0
  private time = 0

  // Shake state: trauma-based (Squirrel Eiserloh's model) — trauma decays,
  // displacement is trauma², so small hits barely register and big hits slam.
  private trauma = 0
  private traumaDecay = 1.5
  private shakeOffset = new THREE.Vector3()
  private shakeRoll = 0

  // Impulse: a one-frame positional kick along the hit direction.
  private impulse = new THREE.Vector3()
  private impulseVel = new THREE.Vector3()

  private handheldSeed = Math.random() * 100

  init(ctx: EngineContext) {
    this.ctx = ctx
    this.camera = ctx.camera
    this.pos.set(...WORLD.CAMERA.position)
    this.target.set(...WORLD.CAMERA.target)
    this.applyToCamera()
  }

  private setShot(name: ShotName, duration: number) {
    this.shot = name
    this.shotTimer = duration
  }

  onEvent(e: FightEvent) {
    switch (e.kind) {
      case 'hit': {
        const t =
          e.flavor === 'signature' ? 0.95 :
          e.flavor === 'ult' ? 0.8 :
          e.flavor === 'crit' ? 0.6 :
          e.flavor === 'combo' ? 0.48 :
          e.flavor === 'ex' ? 0.5 :
          e.flavor === 'heavy' ? 0.36 : 0.18
        this.addTrauma(t * (0.6 + e.power * 0.7))
        // Kick the camera away from the impact so the frame recoils.
        const dir = e.target === 'a' ? -1 : 1
        this.impulseVel.x += dir * (0.35 + e.power * 0.7)
        this.impulseVel.z += 0.22 + e.power * 0.55
        if (e.flavor === 'ult' || e.flavor === 'crit' || e.flavor === 'signature') {
          this.setShot('closeup', e.flavor === 'signature' ? 1.5 : 0.85)
          this.focusSide(e.target)
        }
        break
      }
      case 'cast':
        if (e.flavor === 'ult' || e.flavor === 'signature') {
          this.setShot('super', 1.1)
          this.focusSide(e.attacker)
        }
        break
      case 'shatter':
        this.setShot('shatter', 1.6)
        this.focusSide(e.side)
        this.addTrauma(0.75)
        break
      case 'ko':
        this.setShot('ko', 3.2)
        this.focusSide(e.loser)
        this.addTrauma(1)
        break
      case 'round-start':
        this.setShot('intro', 2.2)
        break
    }
  }

  private focusSide(side: Side) {
    this.focused = side
  }
  private focused: Side = 'a'

  addTrauma(v: number) {
    this.trauma = Math.min(1, this.trauma + v)
  }

  update(dt: number, state: FightRenderState) {
    this.time += dt
    if (this.shotTimer > 0) {
      this.shotTimer -= dt
      if (this.shotTimer <= 0) this.shot = 'neutral'
    }

    this.computeDesiredShot(state)

    // Ease position/target/fov toward the shot.
    const k = 1 - Math.exp(-this.desired.speed * dt)
    this.pos.lerp(this.desired.position, k)
    this.target.lerp(this.desired.target, k)
    this.fov += (this.desired.fov - this.fov) * k
    this.roll += (this.desired.roll - this.roll) * k

    // Impulse spring.
    this.impulseVel.multiplyScalar(Math.exp(-dt * 6))
    this.impulse.addScaledVector(this.impulseVel, dt)
    this.impulse.multiplyScalar(Math.exp(-dt * 7.5))

    // Trauma shake.
    this.trauma = Math.max(0, this.trauma - this.traumaDecay * dt)
    const s = this.trauma * this.trauma
    const t = this.time * 34
    this.shakeOffset.set(
      (noise1(t + 11.3) * 2 - 1) * s * 0.5,
      (noise1(t + 47.1) * 2 - 1) * s * 0.36,
      (noise1(t + 91.7) * 2 - 1) * s * 0.22,
    )
    this.shakeRoll = (noise1(t + 5.9) * 2 - 1) * s * 0.055

    // Subtle handheld drift so the neutral shot is never mechanically still.
    const hh = this.handheldSeed
    const drift = new THREE.Vector3(
      Math.sin(this.time * 0.37 + hh) * 0.035 + Math.sin(this.time * 0.91 + hh * 2) * 0.014,
      Math.sin(this.time * 0.29 + hh * 1.4) * 0.026,
      Math.sin(this.time * 0.23 + hh * 0.8) * 0.02,
    )

    this.applyToCamera(drift)
  }

  private computeDesiredShot(state: FightRenderState) {
    const d = this.desired
    const a = this.ctx.anchors.fighter('a')
    const b = this.ctx.anchors.fighter('b')
    const mid = a.clone().add(b).multiplyScalar(0.5)
    const spread = Math.abs(a.x - b.x)

    switch (this.shot) {
      case 'neutral': {
        // Frame both fighters; pull back as they separate.
        const dist = 8.1 + spread * 0.28
        d.position.set(mid.x * 0.35, WORLD.CAMERA.position[1], dist)
        d.target.set(mid.x * 0.4, 1.62, 0)
        // Low-HP tension: creep in a touch when someone is nearly out.
        const tension = 1 - Math.min(state.a.hp01, state.b.hp01)
        d.fov = WORLD.CAMERA.fov - tension * 2.4
        d.speed = 2.6
        d.roll = 0
        break
      }
      case 'closeup': {
        const f = this.ctx.anchors.fighter(this.focused)
        d.position.set(f.x * 0.62, f.y + 0.35, 5.4)
        d.target.set(f.x * 0.72, f.y, 0)
        d.fov = WORLD.CAMERA.fov - 5
        d.speed = 8
        d.roll = this.focused === 'a' ? -0.028 : 0.028
        break
      }
      case 'super': {
        const f = this.ctx.anchors.fighter(this.focused)
        d.position.set(f.x * 0.5 + (this.focused === 'a' ? 1.1 : -1.1), f.y + 0.55, 4.5)
        d.target.set(f.x * 0.7, f.y + 0.1, 0)
        d.fov = WORLD.CAMERA.fov - 7
        d.speed = 9
        d.roll = this.focused === 'a' ? 0.05 : -0.05
        break
      }
      case 'shatter': {
        const f = this.ctx.anchors.fighter(this.focused)
        d.position.set(f.x * 0.7, f.y + 0.2, 4.9)
        d.target.set(f.x * 0.8, f.y, 0)
        d.fov = WORLD.CAMERA.fov - 8
        d.speed = 7
        d.roll = this.focused === 'a' ? 0.075 : -0.075
        break
      }
      case 'ko': {
        const f = this.ctx.anchors.fighter(this.focused)
        // Slow push-in with a slight orbit.
        const orbit = Math.sin(this.time * 0.5) * 0.8
        d.position.set(f.x * 0.55 + orbit, f.y + 0.7, 5.6)
        d.target.set(f.x * 0.7, f.y - 0.2, 0)
        d.fov = WORLD.CAMERA.fov - 6
        d.speed = 1.9
        d.roll = 0.035
        break
      }
      case 'intro': {
        // Wide establishing dolly that settles into neutral.
        const t = Math.max(0, this.shotTimer / 2.2)
        d.position.set(0, 2.0 + t * 1.6, 8.4 + t * 4.5)
        d.target.set(0, 1.6, 0)
        d.fov = WORLD.CAMERA.fov + t * 6
        d.speed = 3.4
        d.roll = 0
        break
      }
    }
  }

  private applyToCamera(drift?: THREE.Vector3) {
    const p = this.pos.clone().add(this.shakeOffset).add(this.impulse)
    if (drift) p.add(drift)
    this.camera.position.copy(p)
    this.camera.lookAt(this.target)
    this.camera.rotateZ(this.roll + this.shakeRoll)
    if (Math.abs(this.camera.fov - this.fov) > 0.001) {
      this.camera.fov = this.fov
      this.camera.updateProjectionMatrix()
    }
  }

  dispose() {
    /* camera is owned by the engine */
  }
}

/** Deterministic-ish 1D value noise for shake. */
function noise1(x: number): number {
  const i = Math.floor(x)
  const f = x - i
  const u = f * f * (3 - 2 * f)
  const a = fract(Math.sin(i * 127.1) * 43758.5453)
  const b = fract(Math.sin((i + 1) * 127.1) * 43758.5453)
  return a + (b - a) * u
}
function fract(x: number) {
  return x - Math.floor(x)
}
