/**
 * Pure model for the two-layer health bar (no React, no DOM) so its hold/drain
 * behaviour can be driven and measured directly in a fast unit test.
 *
 * The colored `main` fill is the live value; the pale `trail` lags behind on
 * damage to show the recoverable/lost chunk. The component owns a BarState and
 * calls stepHealthBar on the shared rAF, then writes the two widths — zero React
 * re-renders while the bar drains.
 */
import type { FightEvent, HitLevel } from '../fight/types'

// Exponential-smoothing time constants (ms). The front bar snaps down with a
// little weight; the trail holds, then drains slowly behind it — the readable
// "you just lost this much" chunk every modern fighter shows.
//
// The hold is the single tuning value that decides how long the lost chunk
// lingers. It was 150ms (~9 frames) — barely a flicker; SF6/Tekken/Strive hold
// the recoverable/lost chunk for roughly a second (classic delay 60–90f) before
// bleeding it off. 800ms (~48f) puts us in that band: long enough that the
// player actually reads the hit they took, short enough that it has drained well
// before the next exchange. TAU_TRAIL is slowed a touch (260→320) so the bleed
// that follows the hold reads as a deliberate slow drain rather than a snap.
//
// Fast-combo behaviour is the case that matters, and it falls out of holdMs
// only resetting on a heal (never per-hit): every hit in a combo keeps target
// below the held trail, so the timer keeps running from the FIRST hit and the
// trail stays pinned at the pre-combo value for the whole string — then drains
// the entire combo's damage as one cumulative chunk instead of stuttering per
// hit. See stepHealthBar and healthTrail.test.ts.
export const TAU_MAIN = 55
export const TAU_TRAIL = 320
export const TRAIL_HOLD_MS = 800
// A round reset (or heal) pushes health up; anything above this much gain snaps
// the whole bar up instantly instead of animating a rising trail.
export const SNAP_UP_EPS = 0.02
// Recoil is a fast one-shot kick (ms). ~85ms ≈ 5 frames: long enough to read as
// a punch, short enough that it never becomes a wobble.
export const RECOIL_TAU = 85

/** Mutable display state for one bar: the live `main` fill, the lagging `trail`,
 *  and how long the trail has been held since damage.
 *
 *  The remaining fields are the per-hit *weight latch*. They are optional and
 *  default (via `??`) to the shared constants above, so a bar that is only ever
 *  stepped toward a target — never told which hit caused the drop — behaves
 *  exactly as it did before weight expression existed. `applyHit` sets them. */
export interface BarState {
  main: number
  trail: number
  holdMs: number
  /** One-shot contact jolt, 0..1, decays each step (RECOIL_TAU). */
  recoil?: number
  /** Latched front-fill ease for the current hit (defaults to TAU_MAIN). */
  mainTau?: number
  /** Latched trail bleed for the current hit (defaults to TAU_TRAIL). */
  trailTau?: number
  /** Latched hold window for the current hit (defaults to TRAIL_HOLD_MS). */
  holdTargetMs?: number
}

/** A pristine bar: full health, no lag, no kick, no latch. */
export function freshBar(): BarState {
  return { main: 1, trail: 1, holdMs: 0, recoil: 0 }
}

/**
 * How a single weight class moves the bar. Four independent axes, so the classes
 * are genuinely different *behaviours* rather than one behaviour scaled by a
 * single knob — the same bar the audio flavours had to clear.
 *
 *   - mainTau   how heavily the front fill snaps down (higher = more deliberate)
 *   - holdMs    how long the lost chunk hangs before it bleeds
 *   - trailTau  how lazily the lost chunk then drains (higher = slower bleed)
 *   - recoil    the one-shot jolt at the moment of contact (0..1)
 *
 * The axes deliberately do NOT co-rank. A launcher pops the front fill fast and
 * its lost chunk clears QUICKLY (you're airborne, it's gone); a sweep of nearly
 * the same freeze weight does the opposite — the SLOWEST bleed of all, the lazy
 * "taken off your feet" drain. That sweep-slowest / launcher-fastest inversion
 * at similar recoil is the visual echo of the audio sweep-darkest /
 * launcher-brightest signatures, and it is what makes this a vocabulary instead
 * of a volume knob. `recoil` tracks the sim's own hitstop ladder (light 10 →
 * crumple 19 frames); the other three axes carry the identity.
 */
export interface BarResponse {
  mainTau: number
  holdMs: number
  trailTau: number
  recoil: number
}

const RESPONSE: Record<HitLevel, BarResponse> = {
  light: { mainTau: 42, holdMs: 300, trailTau: 190, recoil: 0.1 },
  medium: { mainTau: 55, holdMs: 560, trailTau: 300, recoil: 0.3 },
  heavy: { mainTau: 80, holdMs: 900, trailTau: 430, recoil: 0.62 },
  launcher: { mainTau: 46, holdMs: 640, trailTau: 210, recoil: 0.55 },
  sweep: { mainTau: 66, holdMs: 820, trailTau: 640, recoil: 0.58 },
  crumple: { mainTau: 110, holdMs: 1150, trailTau: 540, recoil: 1.0 },
}

/** The bar's easing/jolt profile for a weight class. */
export function barResponse(level: HitLevel): BarResponse {
  return RESPONSE[level]
}

/**
 * Latch a hit's weight profile onto the bar. The last hit in a combo wins the
 * easing profile (a light poke into a crumple should drain like a crumple), but
 * `holdMs` is deliberately untouched so a multi-hit string still reads as ONE
 * cumulative chunk timed from the first hit (see stepHealthBar). Recoil
 * saturates rather than sums, so a long string kicks once at its heaviest
 * instead of lurching further with every hit.
 */
export function applyHit(s: BarState, level: HitLevel): void {
  const r = barResponse(level)
  s.mainTau = r.mainTau
  s.trailTau = r.trailTau
  s.holdTargetMs = r.holdMs
  s.recoil = Math.max(s.recoil ?? 0, r.recoil)
}

/**
 * Drive both bars from a frame's events, losslessly. Called on the synchronous
 * event path (FightHud.applyFrame), NOT the rAF tick, so every hit in a fast
 * string lands its weight profile even when several arrive inside one animation
 * frame.
 *
 * `hit` and `throw` both damage the defender (1 - attacker) and carry the
 * authored HitLevel (a command grab is authored `heavy`). `counter-hit` is
 * deliberately skipped: the sim fires it ALONGSIDE the `hit` for the same
 * strike, so consuming both would double-apply the jolt.
 */
export function applyHitEvents(bars: [BarState, BarState], events: readonly FightEvent[]): void {
  for (const e of events) {
    if (e.type === 'hit' || e.type === 'throw') {
      const defender = (1 - e.attacker) as 0 | 1
      applyHit(bars[defender], e.level)
    }
  }
}

/** Smoothing factor for a given time constant and frame delta. */
export function alpha(dtMs: number, tau: number): number {
  return 1 - Math.exp(-dtMs / tau)
}

/**
 * Advance one health bar toward `target` over `dt` ms, in place.
 *
 * - Heal / round reset (target rises past SNAP_UP_EPS): snap both layers up.
 * - Damage: `main` eases down fast (TAU_MAIN); `trail` sits still until it has
 *   been held for TRAIL_HOLD_MS, then eases down slowly (TAU_TRAIL) behind it.
 * - `holdMs` only resets on a heal, so a multi-hit combo reads as one held
 *   chunk (it keeps counting from the first hit, never restarts per hit).
 */
export function stepHealthBar(s: BarState, target: number, dt: number): void {
  const mainTau = s.mainTau ?? TAU_MAIN
  const holdTarget = s.holdTargetMs ?? TRAIL_HOLD_MS
  const trailTau = s.trailTau ?? TAU_TRAIL
  if (target > s.main + SNAP_UP_EPS) {
    s.main = target
    s.trail = target
    s.holdMs = 0
    // Heal / round reset clears the weight latch so the next hit eases from the
    // shared defaults, never a stale class's profile.
    s.recoil = 0
    s.mainTau = undefined
    s.trailTau = undefined
    s.holdTargetMs = undefined
  } else {
    s.main += (target - s.main) * alpha(dt, mainTau)
    if (target < s.trail) {
      if (s.holdMs < holdTarget) s.holdMs += dt
      else s.trail += (target - s.trail) * alpha(dt, trailTau)
    } else {
      s.trail = target
    }
  }
  // Trail can never sit in front of the main fill.
  if (s.trail < s.main) s.trail = s.main
  // Recoil is a one-shot impulse from applyHit; decay it fast so the kick reads
  // as a hit, not a wobble. Absent (undefined/0) on a bar that never took a
  // classified hit, so this is a no-op on the pure drain path.
  if (s.recoil) {
    s.recoil *= Math.exp(-dt / RECOIL_TAU)
    if (s.recoil < 1e-3) s.recoil = 0
  }
}
