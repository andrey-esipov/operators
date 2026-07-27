import * as THREE from 'three'
import { Spring3, Spring1, fbm1, clamp } from '../camera/CameraMath'
import { WORLD } from '../types'

/**
 * The fighting-game camera.
 *
 * It behaves like a camera operator with mass: it tracks the midpoint of the
 * two fighters, dollies to keep both framed with a margin, punches in on impact
 * and eases back, and is fenced by the stage bounds so it never reveals the
 * void past the arena or lets a fighter walk out of frame. Every channel runs
 * through a critically-damped spring (from CameraMath) so it settles smoothly
 * instead of either snapping (jitter) or dragging (lag).
 */

export interface StageBounds {
  minX: number
  maxX: number
}

export interface CameraFraming {
  /** World-space feet/chest points of both fighters this frame. */
  ax: number
  bx: number
  /** Highest point either fighter reaches (world y), to keep jumps in frame. */
  topY: number
  /** How much the action wants the camera pushed in, 0..1 (supers, big hits). */
  pushIn: number
}

export class FightCamera {
  private cam: THREE.PerspectiveCamera
  private pos = new Spring3()
  private look = new Spring3()
  private dolly = new Spring1(0) // extra push-in, world units (negative = closer)
  private shake = 0
  private shakeDir = new THREE.Vector3()
  private t = 0
  private bounds: StageBounds
  private tmpPos = new THREE.Vector3()
  private tmpLook = new THREE.Vector3()

  // Framing tuning (world units).
  private readonly baseY = WORLD.CAMERA.target[1]
  private readonly minZ = 7.5
  private readonly maxZ = 15.5
  private readonly marginX = 2.6
  private readonly marginY = 2.4

  constructor(cam: THREE.PerspectiveCamera, bounds: StageBounds) {
    this.cam = cam
    this.bounds = bounds
    this.pos.set(new THREE.Vector3(0, this.baseY + 0.7, 11.4))
    this.look.set(new THREE.Vector3(0, this.baseY, 0))
  }

  setBounds(b: StageBounds) {
    this.bounds = b
  }

  /** Kick a directional shake — VFX calls this on impacts. */
  addShake(amount: number, dir?: THREE.Vector3) {
    this.shake = Math.min(0.6, this.shake + amount)
    if (dir) this.shakeDir.copy(dir).normalize()
    else this.shakeDir.set((Math.random() - 0.5), (Math.random() - 0.5), 0).normalize()
  }

  /** Momentary dolly-in impulse (super freeze, heavy hit). */
  punchIn(amount: number) {
    this.dolly.kick(-Math.abs(amount))
  }

  update(dt: number, f: CameraFraming) {
    this.t += dt
    const midX = (f.ax + f.bx) * 0.5
    const sep = Math.abs(f.ax - f.bx)

    // Distance needed to fit both fighters horizontally, and the jump apex
    // vertically, at the current fov/aspect. Take whichever needs more room.
    const vfov = THREE.MathUtils.degToRad(this.cam.fov)
    const halfSpanX = sep * 0.5 + this.marginX
    const halfSpanY = Math.max(this.marginY, (f.topY - this.baseY) * 0.5 + this.marginY)
    const tanV = Math.tan(vfov * 0.5)
    const tanH = tanV * this.cam.aspect
    const zForX = halfSpanX / Math.max(0.0001, tanH)
    const zForY = halfSpanY / Math.max(0.0001, tanV)
    let z = clamp(Math.max(zForX, zForY), this.minZ, this.maxZ)
    // Sustained push from the action (supers/big hits) tightens the frame.
    z -= f.pushIn * 1.6

    // Horizontal follow, fenced so the frustum edge never passes the stage wall.
    const halfViewX = z * tanH
    const lo = this.bounds.minX + halfViewX
    const hi = this.bounds.maxX - halfViewX
    const camX = lo <= hi ? clamp(midX, lo, hi) : midX

    // Rise toward the action when it goes airborne, but keep feet visible.
    const lookY = this.baseY + Math.max(0, f.topY - this.baseY) * 0.32
    const camY = this.baseY + 0.7 + Math.max(0, f.topY - this.baseY) * 0.22

    // Springs give the operator mass — snappy but never jittery.
    const targetPos = this.tmpPos.set(camX, camY, z + this.dolly.value)
    const targetLook = this.tmpLook.set(camX, lookY, 0)
    // Position is a touch looser than the look target so the frame leads slightly.
    this.pos.step(targetPos, 9.0, 1.0, dt)
    this.look.step(targetLook, 12.0, 1.0, dt)
    // Ease the dolly impulse back to rest.
    this.dolly.step(0, 11.0, 0.85, dt)

    // Handheld micro-drift + impact shake, additive on top of the spring value.
    this.shake = Math.max(0, this.shake - dt * 2.2)
    const drift = 0.02
    const dx = fbm1(this.t * 1.3, 11) * drift + this.shakeDir.x * this.shake * 0.6 * Math.sin(this.t * 90)
    const dy = fbm1(this.t * 1.1, 37) * drift + this.shakeDir.y * this.shake * 0.6 * Math.sin(this.t * 84)

    this.cam.position.set(this.pos.value.x + dx, this.pos.value.y + dy, this.pos.value.z)
    this.cam.lookAt(this.look.value.x + dx * 0.4, this.look.value.y + dy * 0.4, this.look.value.z)
    this.cam.updateProjectionMatrix()
  }
}
