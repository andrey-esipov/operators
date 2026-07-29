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
 * The slice of `Engine` a capture session touches. Narrowed so the whole thing
 * can be exercised with a spy — constructing a real `Engine` needs a WebGL
 * context the node test lane does not have. `setAdaptiveQuality` mirrors the
 * setter that flips `Engine.adaptEnabled`; `quality` mirrors `Engine.quality`.
 */
export interface AdaptiveEngine {
  setAdaptiveQuality(on: boolean): void
  readonly quality: QualityTier
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

/** The two capture-only probes a run installs on `window.__PLAY__`. */
export interface CaptureHooks {
  /** Hold the tier still, or — with false — opt this one run back into the
   *  adaptive loop. The safe state (frozen) is the default; deviating from it
   *  is the thing you must ask for. */
  freezeQuality: (frozen?: boolean) => void
  /** The live tier, read straight off the engine, so a capture can assert it
   *  did not move underfoot between window start and end. */
  quality: () => QualityTier
}

/**
 * Enter a capture session: auto-freeze the tier iff the URL pins a valid one,
 * and return the probes a capture reads to prove the freeze held.
 *
 * The freeze and the probes are produced by the SAME call on purpose. The
 * freeze is the easy thing to forget — that is its entire history, a knob 99
 * tools skipped. The probes are the thing a capture cannot run without. Fusing
 * them means the auto-freeze cannot silently rot while captures keep working:
 * deleting this call also deletes `__PLAY__.freezeQuality`/`quality`, so the
 * failure is loud, not a slow drift back to an uncontrolled tier. Reachability
 * by coupling, not by a source grep. `openCaptureSession(spy, …)` is exactly
 * what the node gate exercises, so "capture mode ⇒ adaptEnabled === false" is
 * asserted on the real wiring the route runs, without a GPU.
 */
export function openCaptureSession(engine: AdaptiveEngine, search: string): CaptureHooks {
  applyCaptureQuality(engine, search)
  return {
    freezeQuality: (frozen = true) => engine.setAdaptiveQuality(!frozen),
    quality: () => engine.quality,
  }
}
