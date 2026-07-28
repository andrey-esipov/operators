/**
 * Pure model for the two-layer health bar (no React, no DOM) so its hold/drain
 * behaviour can be driven and measured directly in a fast unit test.
 *
 * The colored `main` fill is the live value; the pale `trail` lags behind on
 * damage to show the recoverable/lost chunk. The component owns a BarState and
 * calls stepHealthBar on the shared rAF, then writes the two widths — zero React
 * re-renders while the bar drains.
 */

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

/** Mutable display state for one bar: the live `main` fill, the lagging `trail`,
 *  and how long the trail has been held since damage. */
export interface BarState {
  main: number
  trail: number
  holdMs: number
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
  if (target > s.main + SNAP_UP_EPS) {
    s.main = target
    s.trail = target
    s.holdMs = 0
  } else {
    s.main += (target - s.main) * alpha(dt, TAU_MAIN)
    if (target < s.trail) {
      if (s.holdMs < TRAIL_HOLD_MS) s.holdMs += dt
      else s.trail += (target - s.trail) * alpha(dt, TAU_TRAIL)
    } else {
      s.trail = target
    }
  }
  // Trail can never sit in front of the main fill.
  if (s.trail < s.main) s.trail = s.main
}
