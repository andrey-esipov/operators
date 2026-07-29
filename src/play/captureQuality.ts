// Capture-time quality pinning.
//
// The engine ships an adaptive-quality loop (`Engine.maybeAdapt`): when p90
// frame time crosses ~22.2 ms it demotes the tier, which moves pixelRatio, DOF,
// bloom and more. That is correct for a real player on a weak GPU — but it is
// poison for a *capture*, because a screenshot graded through a silently moving
// tier is not reproducible: its quality becomes a function of how long the
// harness had been running and how loaded the box was.
//
// `Engine.setAdaptiveQuality(false)` was built to hold the tier still "while
// capturing reference screenshots" — but of ~100 tools, only the card-battler
// bench called it; not one screenshot tool did. A knob that must be remembered
// was forgotten 99 times out of 100. So instead of adding a 100th opt-in knob,
// this makes the pin itself the intent: a URL that forces `?quality=` is asking
// to measure THAT tier, so we freeze it. Normal play (no `?quality=`) is
// untouched and keeps adaptive recovery.

import type { QualityTier } from '../three/types'
import { QUALITY_ORDER } from '../three/types'

/**
 * The *valid* forced quality tier in a URL query string, or null.
 *
 * A bogus value (`?quality=banana`) is deliberately null: `detectQuality`
 * ignores it and auto-detects, so treating it as a force here would freeze
 * whatever tier got auto-detected and silently pin the wrong thing. "Forced"
 * must mean exactly what `detectQuality` treats as forced.
 */
export function forcedQuality(search: string): QualityTier | null {
  const v = new URLSearchParams(search).get('quality')
  return v !== null && (QUALITY_ORDER as string[]).includes(v) ? (v as QualityTier) : null
}

/**
 * The slice of `Engine` this needs. Narrowed to one method so the decision can
 * be unit-tested with a spy — constructing a real `Engine` needs a WebGL
 * context, which the node test lane does not have.
 */
export interface AdaptiveEngine {
  setAdaptiveQuality(on: boolean): void
}

/**
 * Freeze the adaptive-quality loop when — and only when — the URL pins a valid
 * tier. Returns the pinned tier (freeze applied) or null (left adaptive).
 *
 * Called once at route init. Idempotent and side-effect-free unless a tier is
 * pinned, so a normal player's session behaves exactly as before.
 */
export function applyCaptureQuality(engine: AdaptiveEngine, search: string): QualityTier | null {
  const pinned = forcedQuality(search)
  if (pinned) engine.setAdaptiveQuality(false)
  return pinned
}
