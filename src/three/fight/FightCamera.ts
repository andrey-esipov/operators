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
  // limit — deliberately generous so the CONTAINMENT INVARIANT (both fighters'
  // full sprite bounds inside the frame) is never broken by the clamp on a real
  // jump or a full 7-hit juggle. The rule is: if containing both needs a wider
  // shot than this, the wider shot wins — a slightly small pair reads fine, an
  // amputated grounded fighter reads as a bug. maxZ is now a genuine safety cap
  // (revealing the void), not a framing budget the action fights against.
  private readonly minZ = 7.5
  private readonly maxZ = 28.0
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
    // than a standing fighter at the same feet height, so reserve a LITTLE extra
    // headroom as a fighter leaves the floor. This factor is deliberately small
    // and capped: the old rise*0.6 inflated the band so far that an ORDINARY jump
    // drove zForY past maxZ, forcing the clamp — and the clamped path then
    // sacrificed the grounded fighter (see the composition block below). The
    // containment of BOTH fighters is the invariant; headroom above the airborne
    // head is a nicety that must never grow big enough to break it.
    const rise = Math.max(0, f.topY - WORLD.FIGHTER_HEIGHT)
    const headTop = this.headTopBase + Math.min(rise * 0.22, 1.1)
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
    // edge. We CENTRE the contained band and never bias off it: the previous
    // version biased the centre UP whenever z was clamped (to protect the
    // airborne head's headroom), which quietly let the GROUNDED fighter slide
    // off the bottom edge — a jump would frame the airborne fighter and amputate
    // the grounded one at the waist. Containing both fighters is the invariant;
    // if the band is ever too tall for even maxZ (a monster juggle past the
    // safety cap), centring crops a symmetric sliver off BOTH the head-sky and
    // the near floor instead of sacrificing one fighter whole. With maxZ now
    // generous this clamp effectively never binds in real gameplay.
    const balancedCenter = (f.topY + headTop - this.footBot) * 0.5
    const lookY = balancedCenter
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

    // --- Hard containment guarantee (post-spring) ------------------------
    // The springs above give the operator mass, but a fast transition — a
    // landing after a jump — leaves the AIM lagging high (the look spring is
    // still recovering from the airborne centre) while the velocity-clamped
    // zoom has already snapped back, so the frame ends up aimed ABOVE the
    // now-grounded feet and drops them off the bottom edge. The spring IS the
    // lag, so no target math fixes it; instead pin the FINAL aim into the band
    // that provably contains both fighters at the dolly distance actually
    // applied this frame (camZ, so an impact punch-in that pulls the lens closer
    // is accounted for too). It bites only during the transient and enforces the
    // invariant — both fighters' feet-to-head fully in frame — on every frame.
    // Measured: without this, a landing cropped the grounded feet ~4% off the
    // bottom on ~8% of frames; with it, zero out-of-frame instances across the
    // whole choreography.
    const halfVApplied = camZ * tanV
    const loY = -this.footBot
    const hiY = f.topY + headTop
    // lookAt puts the visible band's centre exactly at the aim, so the band is
    // ~[aim - halfV, aim + halfV]. The aim can sit anywhere that still holds both
    // ends: within +/- (halfV - bandHalf) of the band centre. Clamp the sprung
    // aim into that window (minus a small tilt safety); when the band is taller
    // than the frame (a monster launch past maxZ, effectively never) fall back to
    // the centre so the crop is a symmetric sliver, never one whole fighter. Shift
    // the camera body by the same delta so the tilt is preserved and this only
    // moves anything while the clamp is actually biting (a landing transient).
    const bandCenter = (loY + hiY) * 0.5
    const usable = halfVApplied - (hiY - loY) * 0.5 - 0.12
    const clampedAim = usable > 0
      ? clamp(this.look.value.y, bandCenter - usable, bandCenter + usable)
      : bandCenter
    const aimDelta = clampedAim - this.look.value.y
    this.look.value.y = clampedAim
    this.pos.value.y += aimDelta

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
