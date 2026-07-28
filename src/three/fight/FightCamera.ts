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
  //
  // Vertical composition is the whole game here. A grounded fighter must sit at
  // ~55-65% of frame height with REAL air above the head — the genre norm
  // (SF6/3S standing characters occupy ~50-60%), and, more importantly, the
  // room where jumps, launchers, air combos and supers actually happen. The old
  // tuning framed a grounded fighter at ~86% (head under the HUD, launched
  // fighters cropped above the knee) because its head/foot margins were a
  // rounding error next to a 3.4-tall fighter.
  //
  // The frame is sized to contain the band [feet - footBot, highestHead +
  // headTop] and its dolly distance (z) is solved DIRECTLY from that band (see
  // update()), so the fighter's on-screen size falls out of the geometry rather
  // than a magic number. headTopBase is deliberately large: it is the standing
  // headroom, and with FIGHTER_HEIGHT ≈ 3.4 and fov 32 it lands a grounded
  // fighter at ~60% while leaving ~2 world units of sky for a launch to climb
  // into before the containment even has to widen.
  private readonly headTopBase = 2.05
  private readonly footBot = 0.2
  // The camera sits a touch above the aim so the lens tilts down a few degrees:
  // enough to ride the near floor up into the lower frame (grounding the
  // fighters, hiding the floor's front edge) without going top-down.
  private readonly camLift = 0.45
  // z range. minZ never binds at grounded range (the vertical solve is larger);
  // it only guards a degenerate close-and-low frame. maxZ is the hard pull-out
  // limit for a big launch/juggle — generous so a full air combo stays whole.
  private readonly minZ = 7.5
  private readonly maxZ = 18.0
  // Horizontal breathing room (world units) added beyond the fighters' spread
  // before the camera has to dolly back further than the vertical solve already
  // asks for. At the new, more pulled-back framing the vertical axis dominates
  // at normal range, so this mostly matters at wide intro/neutral spacing.
  private readonly marginX = 1.45
  // Rate-limited dolly distance (world units), kept as state so the zoom can be
  // velocity-clamped frame to frame: it may WIDEN quickly (to catch a launch
  // before it crops) but RECOVERS slowly, so the frame can never oscillate
  // medium -> extreme -> tiny the way an unclamped spring chasing a jumpy target
  // does. This clamp is the actual fix for the zoom-oscillation tell. Seeded to
  // the grounded resting solve in the constructor.
  private zFramed = 9.85

  constructor(cam: THREE.PerspectiveCamera, bounds: StageBounds) {
    this.cam = cam
    this.bounds = bounds
    const tanV = Math.tan(THREE.MathUtils.degToRad(cam.fov) * 0.5)
    const restZ =
      (WORLD.FIGHTER_HEIGHT + this.headTopBase + this.footBot) / (2 * Math.max(1e-4, tanV))
    const restLook = (WORLD.FIGHTER_HEIGHT + this.headTopBase - this.footBot) * 0.5
    this.zFramed = restZ
    this.pos.set(new THREE.Vector3(0, restLook + this.camLift, restZ))
    this.look.set(new THREE.Vector3(0, restLook, 0))
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

    // --- Vertical containment -------------------------------------------
    // Size the frame so both fighters sit between footBot (below the grounded
    // feet, world y ~0) and headTop (above the highest head, world y = topY).
    // Showing the launched head AND the grounded feet needs a vertical half-span
    // of (topY + headTop + footBot)/2, which converts to a dolly distance zForY.
    // A launch raises topY -> zForY grows -> the camera pulls OUT to contain it,
    // instead of the fighter riding off the top edge.
    const vfov = THREE.MathUtils.degToRad(this.cam.fov)
    const tanV = Math.tan(vfov * 0.5)
    const tanH = tanV * this.cam.aspect
    // Dynamic headroom: topY is fed as feet + a FIXED fighter height, but wild
    // airborne poses (a juggle arch, a knockdown tumble) paint noticeably taller
    // than a standing fighter at the same feet height — a fixed headroom left the
    // juggle head kissing the top edge (maxY 0.994) even when the standing pose
    // one frame earlier had room. So reserve extra headroom in proportion to how
    // far off the floor the higher fighter is (rise = topY - grounded head): none
    // when grounded (footsies framing untouched), growing as a launch lifts a
    // fighter into the poses that need it.
    const rise = Math.max(0, f.topY - WORLD.FIGHTER_HEIGHT)
    const headTop = this.headTopBase + rise * 0.6
    const zForY = (f.topY + headTop + this.footBot) / (2 * Math.max(0.0001, tanV))

    // --- Horizontal containment -----------------------------------------
    const halfSpanX = sep * 0.5 + this.marginX
    const zForX = halfSpanX / Math.max(0.0001, tanH)

    // Desired dolly distance: whichever axis needs more room, fenced to range.
    const zDesired = clamp(Math.max(zForX, zForY), this.minZ, this.maxZ)

    // --- Zoom velocity clamp (the fix for the oscillation tell) ----------
    // The frame may traverse its full range no faster than ~0.3s when WIDENING
    // (fast enough to catch a launch before it crops) and ~1.0s when RECOVERING
    // (slow enough it never reads as a lurch). This turns the old undamped
    // medium -> extreme -> tiny swing into a controlled pull-out-and-settle.
    const range = this.maxZ - this.minZ
    const widening = zDesired > this.zFramed
    const maxStep = (range / (widening ? 0.3 : 1.0)) * dt
    this.zFramed += clamp(zDesired - this.zFramed, -maxStep, maxStep)
    const z = this.zFramed

    // Horizontal follow, fenced so the frustum edge never passes the stage wall.
    const halfViewX = z * tanH
    const lo = this.bounds.minX + halfViewX
    const hi = this.bounds.maxX - halfViewX
    const camX = lo <= hi ? clamp(midX, lo, hi) : midX

    // --- Vertical composition -------------------------------------------
    // Centre the frame on the band we sized z for, so the grounded feet sit
    // ~footBot above the bottom edge and the highest head ~headTop below the top
    // edge. `balancedCenter` is the midpoint of that band; when a big launch
    // needs more distance than maxZ can give, the frame can't hold the whole
    // band, so bias the centre UP (`headPriority`) to keep the airborne head's
    // headroom and let the near floor slide out the bottom instead. Losing a
    // sliver of floor reads far better than amputating the launched fighter —
    // which is the entire defect this framing exists to kill. When z is NOT
    // clamped the two expressions are equal, so this is a no-op at normal range.
    const halfV = z * tanV
    const balancedCenter = (f.topY + headTop - this.footBot) * 0.5
    const headPriority = f.topY + headTop - halfV
    const lookY = Math.max(balancedCenter, headPriority)
    const camY = lookY + this.camLift

    // A small, snappy motivated punch-in on impact (~3% of z). Deliberately
    // tiny: a sustained punch-in fights the launch framing and reintroduces the
    // medium -> extreme -> tiny swing.
    const punch = f.pushIn * 0.4

    // The spring gives the operator horizontal/vertical mass (x/y lead the action
    // with a little lag, so a launch cranes up smoothly rather than snapping).
    // The DOLLY (z) is deliberately NOT spring-smoothed here: it is already
    // velocity-clamped by the rate limiter above, and stacking a ~0.4s spring on
    // top lagged the zoom so far behind a short launch that the frame never
    // opened in time and the head still cropped. Feeding the rate-limited zFramed
    // straight to z keeps the zoom both damped (by the clamp) AND responsive
    // enough to contain a brief pop, while a fast, snappy punch-in rides on top.
    const targetPos = this.tmpPos.set(camX, camY, z)
    const targetLook = this.tmpLook.set(camX, lookY, 0)
    this.pos.step(targetPos, 9.0, 1.0, dt)
    this.look.step(targetLook, 12.0, 1.0, dt)
    // Ease the dolly impulse back to rest.
    this.dolly.step(0, 11.0, 0.85, dt)
    const camZ = z - punch + this.dolly.value

    // Handheld micro-drift + impact shake, additive on top of the spring value.
    this.shake = Math.max(0, this.shake - dt * 2.2)
    const drift = 0.02
    const dx = fbm1(this.t * 1.3, 11) * drift + this.shakeDir.x * this.shake * 0.6 * Math.sin(this.t * 90)
    const dy = fbm1(this.t * 1.1, 37) * drift + this.shakeDir.y * this.shake * 0.6 * Math.sin(this.t * 84)

    this.cam.position.set(this.pos.value.x + dx, this.pos.value.y + dy, camZ)
    this.cam.lookAt(this.look.value.x + dx * 0.4, this.look.value.y + dy * 0.4, this.look.value.z)
    this.cam.updateProjectionMatrix()
  }
}
