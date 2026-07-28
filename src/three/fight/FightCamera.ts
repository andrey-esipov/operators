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
  // Where the lens actually aims at rest. Aiming near mid-torso (a touch below
  // the chest) with the camera only slightly above it keeps the lens close to
  // level, which drops the fighters' feet into the lower ~15% of the frame and
  // rides the near floor up over the foreground — hiding the stage floor's
  // front edge instead of leaving a dead black bar under the action, while
  // still leaving a little headroom above the head.
  private readonly aimY = 1.62
  private readonly camBaseY = 2.12
  private readonly minZ = 6.5
  private readonly maxZ = 15.5
  // Horizontal breathing room (world units) added beyond the fighters' spread
  // before the camera has to dolly back. Kept fairly tight so widely-spaced
  // neutral/intro beats still fill the frame instead of pulling back into a
  // small-fighters-with-a-dead-floor-band composition — SF6/3S keep the pair
  // large in frame even at range.
  private readonly marginX = 1.45
  private readonly marginY = 1.9
  // Vertical follow (jumps / juggles). The camera must always keep the grounded
  // fighter — the one actually acting — readable, so a launched opponent is
  // followed only so far before it is allowed to ride toward the top edge
  // rather than dollying the whole scene out until both fighters are specks.
  //   maxRiseFit  caps how much airborne height feeds the framing, in world
  //               units above rest (~3.5 ≈ a tall jump). Beyond it the fighter
  //               rises in frame instead of shrinking everyone.
  //   vFollow     how fast the frame dollies out per unit of (capped) rise.
  //   vLookFollow how fast the aim pans up. Kept below vFollow so the growing
  //               frustum always outruns the pan and the grounded feet never
  //               fall off the bottom edge.
  //   vCamFollow  how fast the camera itself lifts (a touch under the aim pan).
  //
  // These are deliberately gentle. A jump raises topY, which raises halfSpanY
  // and dollies the camera out — but if that term is too strong the whole scene
  // shrinks every time anyone leaves the ground (measured: a mid jump zoomed the
  // pair out ~26% on the mock, and worse in real matches where a launch stacks
  // on horizontal separation, reading as a lurch). A fighting-game camera keeps
  // the scale far more stable through a jump and lets the airborne fighter ride
  // up in frame instead. So the vertical dolly-out per unit of rise is kept low;
  // the invariant vCamFollow < vLookFollow < vFollow is preserved so the growing
  // frustum still outruns the aim pan and the grounded fighter's feet never fall
  // off the bottom edge. NOTE: for a grounded pair vRise is 0, so every term
  // below multiplies to nothing — this tuning is provably a no-op on all
  // grounded frames and only softens the airborne zoom-out.
  private readonly maxRiseFit = 3.5
  private readonly vFollow = 0.24
  private readonly vLookFollow = 0.2
  private readonly vCamFollow = 0.16

  constructor(cam: THREE.PerspectiveCamera, bounds: StageBounds) {
    this.cam = cam
    this.bounds = bounds
    this.pos.set(new THREE.Vector3(0, this.camBaseY, 9.6))
    this.look.set(new THREE.Vector3(0, this.aimY, 0))
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

    // Distance needed to fit both fighters horizontally, and to follow vertical
    // action, at the current fov/aspect. Take whichever needs more room.
    const vfov = THREE.MathUtils.degToRad(this.cam.fov)
    const halfSpanX = sep * 0.5 + this.marginX
    // Capped vertical follow: rise is how far the higher fighter is above rest;
    // vRise clamps it so a big launch stops pulling the dolly out and instead
    // lets that fighter ride toward the top of frame (see field notes).
    const rise = Math.max(0, f.topY - this.baseY)
    const vRise = Math.min(rise, this.maxRiseFit)
    const halfSpanY = this.marginY + vRise * this.vFollow
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

    // Follow the vertical action with the capped rise so the aim and camera pan
    // up in lockstep with the (bounded) dolly — never far enough to push the
    // grounded fighter's feet off the bottom edge.
    const lookY = this.aimY + vRise * this.vLookFollow
    const camY = this.camBaseY + vRise * this.vCamFollow

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
