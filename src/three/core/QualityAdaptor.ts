import { QUALITY_ORDER, qualityRank, type QualityTier } from '../types'

// Runtime quality policy — the two levers that decide how many pixels we push
// and when we back off. Both are PURE functions of their inputs (no GPU, no
// Engine, no globals) so the whole policy is unit-testable with plain arrays and
// numbers. See src/three/core/__tests__/qualityAdaptor.node.test.ts.
//
// Why this module exists: frame cost in this renderer is FILL-bound. Every post
// pass (scene RenderPass, bloom, colour grade, finalize) is screen-space, so
// cost scales with the rendered pixel count = cssW*cssH*pixelRatio^2. Measured
// at 1080p on Metal: pixelRatio 2.0 (8.3M px) => ~5 fps; pixelRatio 1.0 (2.07M
// px) => ~30 fps — a 4x fill swing from a single number. The old policy chose
// pixelRatio 2.0 on any 8-core box (a core-count proxy that says nothing about
// fill rate) and then demoted over 90 FRAMES, which at 6 fps is 15s to react and
// ~45s to walk ultra->low one tier at a time. Both halves are fixed here.

/**
 * Target rendered-pixel budget the post stack can afford per frame. ~2.3M px is
 * 1080p at pixelRatio ~1.05 — the measured knee where a full low-tier post stack
 * still clears ~30 fps. Bigger render targets fall off a fill cliff (superlinear
 * with pixel count: bandwidth/ROP saturation, not CPU).
 */
export const TARGET_RENDER_PIXELS = 2_300_000

/**
 * Fill-aware device-pixel-ratio cap.
 *
 * Instead of trusting a tier's nominal ratio (which a core-count heuristic sets
 * with no knowledge of fill rate), clamp it to the largest ratio that keeps the
 * rendered pixel count at or under `targetPixels`. A bigger CSS viewport gets a
 * SMALLER ratio — exactly right, and precisely the fill signal a core count can
 * never provide (viewport px are a real, boot-available measure of fill load).
 *
 * Floored at 1.0: rendering below native is a visible blur, so it stays an
 * explicit art call, never an automatic one. On a non-Retina display
 * (deviceDpr == 1) the result is always 1.0, so this only ever bites where the
 * catastrophe actually lives — high-DPI panels.
 */
export function affordablePixelRatio(
  cssW: number,
  cssH: number,
  deviceDpr: number,
  tierCap: number,
  targetPixels: number = TARGET_RENDER_PIXELS,
): number {
  const cssPixels = Math.max(1, Math.floor(cssW) * Math.floor(cssH))
  const budget = Math.sqrt(targetPixels / cssPixels)
  const dpr = deviceDpr > 0 ? deviceDpr : 1
  return Math.max(1, Math.min(dpr, tierCap, budget))
}

export interface AdaptConfig {
  /** Demote sample window AND the minimum wall-time between demotions (ms). */
  windowMs: number
  /** Windowed p90 frame time above this demotes ONE tier (45fps => 22.2ms). */
  demoteAboveMs: number
  /** Windowed p90 above this jumps STRAIGHT to the floor (20fps => 50ms). */
  catastrophicMs: number
  /**
   * Windowed MEDIAN (p50) below this PROMOTES one tier — the recovery path that
   * makes a demotion reversible instead of a one-way fuse. It sits just under the
   * 60fps frame time (16.7ms) ON PURPOSE: vsync caps observable headroom, so a
   * fully healthy app on a 60Hz panel reports ~16.7ms and NOTHING faster. A
   * promote line below that could never fire, and recovery would be impossible on
   * any vsync-locked 60Hz display. p50 (not p90) keeps the decision robust
   * to vsync tail jitter; the anti-flap job is done by `maxSlowDemotesPerTier`,
   * not by a wide dead-band the vsync ceiling won't allow.
   */
  promoteBelowMs: number
  /**
   * Sustained-health window required to PROMOTE (ms). Deliberately LONGER than
   * `windowMs`: promotion is slow and cautious, demotion is fast — asymmetric
   * hysteresis so a bad promote is corrected in one demote window but a good one
   * is only earned after seconds of health.
   */
  promoteWindowMs: number
  /**
   * Wall-clock grace after the first sample during which no decision is made and
   * every boot sample is discarded, so the first-material-compile + atlas-upload
   * transient (~900ms) can never be the data a demotion is computed from. It is
   * WALL-CLOCK, not a frame count: a frame count would stretch as fps falls and
   * reintroduce exactly the load-dependent reaction the old 90-frame warmup had.
   */
  bootGraceMs: number
  /**
   * A single frame at/above this is UNMEASURABLE, not slow — a tab-restore, GC
   * pause, or first-compile stall is a scheduling gap, not sustained fill load.
   * Such a sample is DISCARDED (never scored) and re-arms the decision window,
   * because a value that means "we don't know how slow this was" must not be the
   * sample that decides the tier. Set well above the slowest SUSTAINED frame we
   * still react to (2fps=500ms is scored; 1fps=1000ms is treated as a pause), so
   * the catastrophic path still fires on a genuine collapse while a lone hitch
   * cannot floor a healthy session.
   */
  discontinuityMs: number
  /**
   * Oscillation cap. After this many SLOW demotions FROM a tier, stop promoting
   * back INTO it for the rest of the session, so a capability that sits right on
   * a tier boundary converges to the stable lower tier instead of flapping.
   */
  maxSlowDemotesPerTier: number
}

export const DEFAULT_ADAPT: AdaptConfig = {
  windowMs: 900,
  demoteAboveMs: 22.2,
  catastrophicMs: 50,
  promoteBelowMs: 17.5,
  promoteWindowMs: 3000,
  bootGraceMs: 1000,
  discontinuityMs: 1000,
  maxSlowDemotesPerTier: 2,
}

export type AdaptAction =
  | { kind: 'none' }
  | {
      kind: 'demote'
      from: QualityTier
      to: QualityTier
      p90: number
      reason: 'slow' | 'catastrophic'
      /** Wall-clock ms since the window armed — the reaction time. */
      reactionMs: number
    }
  | {
      kind: 'promote'
      from: QualityTier
      to: QualityTier
      /** The windowed MEDIAN that cleared the promote line. */
      p50: number
      /** Wall-clock ms of sustained health that earned the promotion. */
      sustainedMs: number
    }

/**
 * Pure, deterministic adaptive-quality controller.
 *
 * Feeds on (timestampMs, frameMs) samples and decides whether to demote OR
 * promote a quality tier. Everything is a pure function of the input arrays — no
 * GPU, no Engine, no wall clock — so the whole policy is unit-testable with plain
 * numbers (see qualityAdaptor.node.test.ts).
 *
 * Four properties keep this ADAPTATION and not a one-way fuse — the shape the
 * first cut of this controller shipped, which floored the tier on the boot
 * transient and never gave a pixel of it back:
 *
 *  1. RECOVERY. A demotion is reversible. A sustained healthy window promotes one
 *     tier back, up to — never above — the boot tier the detector chose. The
 *     hysteresis is asymmetric (demote on p90 over `windowMs`, promote on the
 *     median over the longer `promoteWindowMs`) and `maxSlowDemotesPerTier` caps
 *     oscillation at a tier boundary so it settles instead of flapping.
 *
 *  2. SLOW vs UNMEASURABLE. `frameMs` is the UNCLAMPED wall-clock frame time. A
 *     value at/above `discontinuityMs` (tab-restore, GC pause, first-compile
 *     stall) means "we don't know how slow rendering is", so it is DISCARDED, not
 *     scored as the worst case. The sim's 100ms dt clamp stays upstream where it
 *     belongs — a saturated value must never be the sample that decides the tier.
 *     A 10s tab-restore and a 101ms hitch are no longer indistinguishable.
 *
 *  3. BOOT EXCLUSION. The first `bootGraceMs` of samples are thrown away and the
 *     decision window starts fresh afterward, so the boot transient — ~900ms of
 *     shader compile + atlas upload, the least representative moment in the
 *     session — is never the data a demotion is computed from.
 *
 *  4. WALL-CLOCK REACTION. The decision window is wall-clock, so reaction time
 *     does not degrade as fps falls (the previous 90-frame warmup took 15s at
 *     6fps). A catastrophic reading still drops straight to the floor in one step.
 */
export class QualityAdaptor {
  readonly cfg: AdaptConfig
  private samples: { t: number; ms: number }[] = []
  /** Start of the current decision window — re-armed on boot, action, or pause. */
  private windowStart: number | null = null
  private firstSampleAt: number | null = null
  private booted = false
  /** The boot tier: promotion restores TOWARD it but never above it. */
  private ceiling: QualityTier | null = null
  /** Per-tier count of SLOW demotions from that tier (oscillation-cap input). */
  private slowDemotes: Partial<Record<QualityTier, number>> = {}

  constructor(cfg: Partial<AdaptConfig> = {}) {
    this.cfg = { ...DEFAULT_ADAPT, ...cfg }
  }

  reset(): void {
    this.samples = []
    this.windowStart = null
    this.firstSampleAt = null
    this.booted = false
    this.ceiling = null
    this.slowDemotes = {}
  }

  sample(nowMs: number, frameMs: number, current: QualityTier): AdaptAction {
    if (this.ceiling == null) this.ceiling = current
    if (this.firstSampleAt == null) this.firstSampleAt = nowMs

    // (1) Validity. An unmeasurable frame — negative (the virtual step clock ran
    // ahead of wall time) or a pause/stall at/above the discontinuity ceiling —
    // says nothing about sustained load. Discard it and re-arm the window: after
    // a gap we must re-observe a full window before trusting the state.
    if (!(frameMs >= 0 && frameMs < this.cfg.discontinuityMs)) {
      this.windowStart = nowMs
      this.samples = []
      return { kind: 'none' }
    }

    // (2) Boot exclusion. Wait out a fixed wall-clock grace, discard everything
    // seen during it, then start the decision window fresh from the first
    // post-boot frame so the compile transient can't be what decides.
    if (!this.booted) {
      if (nowMs - this.firstSampleAt < this.cfg.bootGraceMs) return { kind: 'none' }
      this.booted = true
      this.windowStart = nowMs
      this.samples = []
    }

    if (this.windowStart == null) this.windowStart = nowMs
    this.samples.push({ t: nowMs, ms: frameMs })
    const keep = nowMs - Math.max(this.cfg.windowMs, this.cfg.promoteWindowMs)
    while (this.samples.length && this.samples[0].t < keep) this.samples.shift()

    const elapsed = nowMs - this.windowStart
    const rank = qualityRank(current)

    // DEMOTE — responsive window, tail-sensitive (p90).
    if (elapsed >= this.cfg.windowMs && this.countSince(nowMs - this.cfg.windowMs) >= 2) {
      const p90 = this.pctSince(nowMs - this.cfg.windowMs, 0.9)
      if (rank <= 0) {
        // At the floor: keep the clock moving if still slow, but never emit.
        if (p90 > this.cfg.demoteAboveMs) this.commit(nowMs)
      } else if (p90 > this.cfg.catastrophicMs) {
        this.commit(nowMs)
        return { kind: 'demote', from: current, to: QUALITY_ORDER[0], p90, reason: 'catastrophic', reactionMs: elapsed }
      } else if (p90 > this.cfg.demoteAboveMs) {
        this.slowDemotes[current] = (this.slowDemotes[current] ?? 0) + 1
        const to = QUALITY_ORDER[rank - 1]
        this.commit(nowMs)
        return { kind: 'demote', from: current, to, p90, reason: 'slow', reactionMs: elapsed }
      }
    }

    // PROMOTE — slow window, median-based, capped by the boot ceiling and the
    // per-tier oscillation limit. Demotion is evaluated FIRST above, so a
    // struggling frame can never be read as an invitation to promote.
    const ceilRank = qualityRank(this.ceiling ?? current)
    if (
      rank < ceilRank &&
      elapsed >= this.cfg.promoteWindowMs &&
      this.countSince(nowMs - this.cfg.promoteWindowMs) >= 2
    ) {
      const to = QUALITY_ORDER[rank + 1]
      const locked = (this.slowDemotes[to] ?? 0) >= this.cfg.maxSlowDemotesPerTier
      if (!locked) {
        const p50 = this.pctSince(nowMs - this.cfg.promoteWindowMs, 0.5)
        if (p50 < this.cfg.promoteBelowMs) {
          this.commit(nowMs)
          return { kind: 'promote', from: current, to, p50, sustainedMs: elapsed }
        }
      }
    }

    return { kind: 'none' }
  }

  private commit(nowMs: number): void {
    this.windowStart = nowMs
    this.samples = []
  }

  private countSince(sinceT: number): number {
    let n = 0
    for (const s of this.samples) if (s.t >= sinceT) n++
    return n
  }

  private pctSince(sinceT: number, p: number): number {
    const xs: number[] = []
    for (const s of this.samples) if (s.t >= sinceT) xs.push(s.ms)
    return percentile(xs, p)
  }
}

function percentile(xs: number[], p: number): number {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor(p * s.length))]
}
