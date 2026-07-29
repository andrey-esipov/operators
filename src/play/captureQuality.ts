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
//
// Two intents freeze the tier, chosen so the safe state never has to be
// remembered by a tool author:
//   1. A `?quality=` pin — "measure THIS tier" — freezes on ANY route, incl.
//      the buyer-shared `?play=1`, because a pin is an explicit capture intent.
//   2. A capture-ONLY route (`?fight=1`, `?attract=1`) freezes by DEFAULT, via
//      the `captureRoute` option. These routes are dev/perf harnesses — App.tsx
//      calls `?fight=1` "dev-only" and AttractMode calls itself a "Dev-only
//      probe surface" — so no real buyer is ever on them and a still tier is
//      simply the correct default.
//
// (2) is the resolution to "a knob whose safe state is opt-in IS the bug".
// Only ~11 of ~100 tools pass `?quality=`, so 89 captured through a drifting
// tier; asking each of them to remember a pin is the same forgotten-knob design
// that failed 99/100. Instead, the two routes that exist SOLELY for capture make
// freezing the default and gate the DEVIATION (`freezeQuality(false)`). Nothing
// new to remember, no orphan flag, and `?play=1` stays pin-only so a real player
// keeps adaptive recovery.

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
 * Options that widen the condition under which a capture session freezes.
 */
export interface CaptureOpts {
  /**
   * Freeze even without a `?quality=` pin. Set true ONLY by routes that exist
   * solely for a capture or dev harness — `?fight=1`, `?attract=1` — where no
   * real buyer is ever present, so a still tier is the correct default and needs
   * no per-tool opt-in. The buyer-shared route (`?play=1`) leaves this false and
   * freezes only on an explicit pin, so a real player keeps adaptive recovery.
   * This is the "make the safe state the default, gate the deviation" inversion
   * applied per route: on a capture-only route, frozen IS the default and the
   * deviation (`freezeQuality(false)`) is the thing a dev must ask for.
   */
  captureRoute?: boolean
}

/**
 * Freeze the adaptive-quality loop and return the tier now held frozen, or null
 * if the session was left adaptive.
 *
 * Freezes when EITHER the URL pins a valid tier (`?quality=`, "measure this
 * one") OR `opts.captureRoute` is set (a route that only ever hosts a capture).
 * A pin also selects the tier; a bare capture route freezes at whatever
 * `detectQuality` already picked. With neither, nothing happens and a normal
 * player's session is byte-for-byte unchanged.
 *
 * Called once at route init. The return value is null iff the loop was left
 * adaptive, which is exactly the buyer path.
 */
export function applyCaptureQuality(
  engine: AdaptiveEngine,
  search: string,
  opts: CaptureOpts = {},
): QualityTier | null {
  const pinned = forcedQuality(search)
  if (pinned === null && opts.captureRoute !== true) return null
  engine.setAdaptiveQuality(false)
  return pinned ?? engine.quality
}

/** The two capture-only probes a run installs on its route's dev handle
 *  (`window.__PLAY__` for `?play=1`, `window.__FIGHT__` for `?fight=1`). */
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
 *
 * `opts` forwards to `applyCaptureQuality`: a capture-only route passes
 * `{ captureRoute: true }` to freeze by default; `?play=1` passes nothing and
 * freezes only on a pin.
 */
export function openCaptureSession(
  engine: AdaptiveEngine,
  search: string,
  opts: CaptureOpts = {},
): CaptureHooks {
  applyCaptureQuality(engine, search, opts)
  return {
    freezeQuality: (frozen = true) => engine.setAdaptiveQuality(!frozen),
    quality: () => engine.quality,
  }
}

/** The `?lab=1` dev sandbox's capture handle, published on `window.__LAB__` so a
 *  capture tool can read the tier the same way it reads `__PLAY__`/`__FIGHT__`. */
export interface LabProbe {
  /** Hold the tier still (frozen by default on the sandbox), or freezeQuality(false)
   *  to opt one run back into adaptation. */
  freezeQuality: (frozen?: boolean) => void
  /** The live tier, read straight off the engine on every call — NOT a snapshot,
   *  so a capture can assert the sandbox tier never drifted mid-window. */
  quality: () => QualityTier
}

/**
 * Install the `?lab=1` sandbox capture handle on `window.__LAB__`.
 *
 * `?lab=1` (ThreeLab → FightScene3D) is the ONLY caller. It is a capture/measure
 * sandbox where no human plays, so — like the other capture-only routes — it
 * freezes the tier by default (`captureRoute`). The subtlety that bit us:
 * FightScene3D is SHARED with FightStage ← CombatScreen (reached only via
 * `route === 'cards'`, the legacy card game — NOT the shipped fighter, which is
 * PlayableMatch → FightRenderer and never mounts FightScene3D). So this install
 * is gated on the sandbox and MUST NOT run on the interactive card-game route —
 * or a player loses adaptive recovery and a `__LAB__` global leaks onto that page.
 *
 * The handle is produced by `openCaptureSession`, so the freeze and the tier
 * probe are born from the SAME call: the freeze cannot rot without also dropping
 * the probe, exactly as `__FIGHT__`/`__PLAY__` are wired. `quality` reads
 * `engine.quality` live on every call — a snapshot would compare equal to itself
 * forever and vacuously certify a tier that had actually drifted.
 *
 * `globalThis` is `window` in the browser (so tools read `window.__LAB__`) and is
 * defined under node, so the whole install is exercisable with a spy — no GPU.
 */
export function installLabProbe(engine: AdaptiveEngine, search: string): LabProbe {
  const { freezeQuality, quality } = openCaptureSession(engine, search, { captureRoute: true })
  const probe: LabProbe = { freezeQuality, quality }
  ;(globalThis as unknown as { __LAB__?: LabProbe }).__LAB__ = probe
  return probe
}

/** Remove the `?lab=1` capture handle (sandbox route unmount). */
export function removeLabProbe(): void {
  delete (globalThis as unknown as { __LAB__?: LabProbe }).__LAB__
}
