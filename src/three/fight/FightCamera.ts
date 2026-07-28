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
  // Impact kick — a directional camera SHOVE on contact, the thing that makes a
  // hit read as weight rather than two sprites overlapping. Modelled as a spring
  // impulse (kick the velocity, let it snap back) rather than the old decaying
  // sinusoid: a sine wobble reads as floaty hand-shake, a sprung impulse reads as
  // a punch. `kick` is the scalar displacement along `kickDir`, in world units.
  private kick = new Spring1(0)
  private kickDir = new THREE.Vector3(1, 0, 0)
  private t = 0
  private bounds: StageBounds
  private tmpPos = new THREE.Vector3()
  private tmpLook = new THREE.Vector3()

  // Impact-kick tuning.
  //   OMEGA/ZETA: a stiff, only-slightly-underdamped spring so the shove punches
  //   out in ~40ms and settles in ~0.25s with a single small counter-swing — a
  //   snappy kick with weight, never a lingering wobble.
  //   SCALE: maps an event's weight knob (the `amount` VFX passes, ~0.07..0.5)
  //   to a peak on-screen displacement. Tuned so a jab barely ticks (~4-6px) and
  //   a KO rocks the frame (~30px), i.e. the kick SCALES WITH WEIGHT.
  //   VMAX: caps accumulated impulse so a fast combo can't integrate the camera
  //   off into the void.
  //   MAX: hard ceiling on the kick DISPLACEMENT (world units). VMAX bounds a
  //   single impulse, but a barrage that re-kicks every frame keeps velocity
  //   pinned high and would still walk the camera out; this caps the excursion
  //   itself, sized just above the largest single-frame kick (a crumple on
  //   counter ≈ 0.16u) so no ordinary hit is clipped but a rapid string can't
  //   stack past roughly one big hit.
  private readonly KICK_OMEGA = 30
  private readonly KICK_ZETA = 0.7
  private readonly KICK_SCALE = 26
  private readonly KICK_VMAX = 18
  private readonly KICK_MAX = 0.18

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

  /**
   * Kick a directional camera shove — VFX calls this on impacts, scaling
   * `amount` with the hit's weight (light < medium < heavy < counter < super).
   *
   * The shove is a velocity impulse into a snap-back spring, so it reads as a
   * punch that recovers, not a sustained shake. Crucially the spring is advanced
   * on GAME time in update() (not wall time), so the kick is HELD through the
   * impact freeze and punches out as the world resumes — a hit whose shake is
   * spent invisibly inside the hitstop reads as no kick at all, which is exactly
   * the "0px on contact" defect this replaces.
   */
  addShake(amount: number, dir?: THREE.Vector3) {
    if (amount <= 0) return
    // DEV mutation hook: silence the impact kick so a probe can prove the
    // measured camera shift comes from THIS code, not the instrument (kick off
    // must read ~0px, kick on > 0px). Stripped from production builds.
    if (import.meta.env.DEV && (globalThis as Record<string, unknown>).__MUT_NO_KICK__) return
    if (dir) {
      this.kickDir.copy(dir).setZ(0)
      if (this.kickDir.lengthSq() < 1e-6) this.kickDir.set(1, 0, 0)
      this.kickDir.normalize()
    } else {
      // Mostly-horizontal random shove: a sideways jolt reads as a hit, while a
      // large vertical component fights the careful feet/head composition.
      this.kickDir.set((Math.random() - 0.5) * 2, (Math.random() - 0.5) * 0.7, 0)
      if (this.kickDir.lengthSq() < 1e-6) this.kickDir.set(1, 0, 0)
      this.kickDir.normalize()
    }
    this.kick.kick(Math.min(0.6, amount) * this.KICK_SCALE)
    this.kick.vel = clamp(this.kick.vel, -this.KICK_VMAX, this.KICK_VMAX)
  }

  /** Momentary dolly-in impulse (super freeze, heavy hit). */
  punchIn(amount: number) {
    if (import.meta.env.DEV && (globalThis as Record<string, unknown>).__MUT_NO_KICK__) return
    this.dolly.kick(-Math.abs(amount))
  }

  /**
   * @param dt      real (unscaled) frame delta — drives the framing springs,
   *                handheld drift and containment, which must stay alive and
   *                smooth even while the world is frozen for impact.
   * @param kickDt  SIM-FRAME delta (DT per genuine sim advance, 0 in a frozen
   *                gap) — drives ONLY the impact kick. Tying the shove to sim
   *                frames rather than wall time makes it hold through the
   *                hitstop freeze AND survive a frame-stepped capture: it
   *                advances by exactly one frame per __PLAY__.step and holds
   *                still in the wall-clock gaps between a capture tool's frames.
   */
  update(dt: number, kickDt: number, f: CameraFraming) {
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

    // Handheld micro-drift (tiny, continuous) + the impact kick, additive on top
    // of the sprung + contained camera.
    //
    // The kick advances on SIM-FRAME time (kickDt), never wall time. During the
    // hitstop freeze no sim frames advance, so the shove is HELD; it then plays
    // out one frame at a time as the sim resumes. This is the fix for "0px kick
    // on contact": the old sinusoid decayed on wall time and was entirely spent
    // inside the freeze plus the capture tool's between-frame gaps, so by the
    // time a frozen frame was read there was nothing left to see. Riding genuine
    // sim frames also makes the kick frame-steppable, so impact-frames can film
    // it one envelope sample per step instead of catching a dead camera.
    this.kick.step(0, this.KICK_OMEGA, this.KICK_ZETA, Math.max(0, kickDt))
    // Hard ceiling on the excursion so a rapid multi-hit string can't walk the
    // camera out (anti-windup: pin velocity too, or it re-drives the value
    // straight back to the cap next frame).
    if (this.kick.value > this.KICK_MAX) { this.kick.value = this.KICK_MAX; if (this.kick.vel > 0) this.kick.vel = 0 }
    else if (this.kick.value < -this.KICK_MAX) { this.kick.value = -this.KICK_MAX; if (this.kick.vel < 0) this.kick.vel = 0 }
    const drift = 0.02
    const driftX = fbm1(this.t * 1.3, 11) * drift
    const driftY = fbm1(this.t * 1.1, 37) * drift
    // The kick is a pure PAN (added equally to eye and aim) so the visible band's
    // centre moves by exactly the kick — which lets the containment clamp below
    // reason about it exactly.
    let kickX = this.kickDir.x * this.kick.value
    let kickY = this.kickDir.y * this.kick.value

    // --- Kick containment: the shove must never break the invariant the clamp
    // above just guaranteed. Vertically, keep the final aim inside the same
    // [bandCenter ± usable] window; horizontally, keep the frustum edge inside
    // the stage walls. The drift is left uncontained — at 0.02 it is a sub-pixel
    // frame-to-frame nudge — but the kick can reach ~0.2 world units on a KO and
    // is bounded here so a big hit near a frame edge can't amputate a fighter.
    const aimBaseY = this.look.value.y + driftY * 0.4
    if (usable > 0) {
      kickY = clamp(aimBaseY + kickY, bandCenter - usable, bandCenter + usable) - aimBaseY
    } else {
      kickY = 0
    }
    const halfViewXApplied = camZ * tanH
    const loX = this.bounds.minX + halfViewXApplied
    const hiX = this.bounds.maxX - halfViewXApplied
    if (loX <= hiX) {
      const aimBaseX = this.look.value.x + driftX * 0.4
      kickX = clamp(aimBaseX + kickX, loX, hiX) - aimBaseX
    }

    this.cam.position.set(this.pos.value.x + driftX + kickX, this.pos.value.y + driftY + kickY, camZ)
    this.cam.lookAt(
      this.look.value.x + driftX * 0.4 + kickX,
      this.look.value.y + driftY * 0.4 + kickY,
      this.look.value.z,
    )
    this.cam.updateProjectionMatrix()
  }
}
