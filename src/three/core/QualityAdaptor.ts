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
  /** Rolling sample window AND minimum wall-time between demotions (ms). */
  windowMs: number
  /** Windowed p90 frame time above this demotes ONE tier (45fps => 22.2ms). */
  demoteAboveMs: number
  /** Windowed p90 above this jumps STRAIGHT to the floor (20fps => 50ms). */
  catastrophicMs: number
}

export const DEFAULT_ADAPT: AdaptConfig = {
  windowMs: 900,
  demoteAboveMs: 22.2,
  catastrophicMs: 50,
}

export type AdaptAction =
  | { kind: 'none' }
  | {
      kind: 'demote'
      from: QualityTier
      to: QualityTier
      p90: number
      reason: 'slow' | 'catastrophic'
      /** Wall-clock ms since start / previous demotion — the reaction time. */
      reactionMs: number
    }

/**
 * Pure, deterministic adaptive-quality controller.
 *
 * Feeds on (timestampMs, frameMs) samples and decides whether to demote. The
 * decision window is WALL-CLOCK, not a frame count: the previous implementation
 * warmed up over 90 frames, so its reaction time was inversely proportional to
 * how badly it was needed (15s at 6fps). Here a bad stretch is caught within
 * ~windowMs no matter how few frames that is, and a catastrophic reading jumps
 * straight to the floor in ONE step instead of walking down one tier at a time.
 *
 * `frameMs` is the full-frame (present-gated) time — the quantity a player
 * actually feels, which on a fill-bound GPU is dominated by present wait the
 * CPU-side render timer never sees. The caller clamps pathological values
 * (tab-restore) upstream so one outlier can't dominate the windowed p90.
 */
export class QualityAdaptor {
  readonly cfg: AdaptConfig
  private samples: { t: number; ms: number }[] = []
  private windowStart: number | null = null
  private lastActionAt: number | null = null

  constructor(cfg: Partial<AdaptConfig> = {}) {
    this.cfg = { ...DEFAULT_ADAPT, ...cfg }
  }

  reset(): void {
    this.samples = []
    this.windowStart = null
    this.lastActionAt = null
  }

  sample(nowMs: number, frameMs: number, current: QualityTier): AdaptAction {
    if (this.windowStart == null) this.windowStart = nowMs
    this.samples.push({ t: nowMs, ms: frameMs })
    const cutoff = nowMs - this.cfg.windowMs
    while (this.samples.length && this.samples[0].t < cutoff) this.samples.shift()

    // Time-based warmup + cooldown, unified: require a fresh full window since
    // start (or since the last demotion) before acting again.
    const since = this.lastActionAt ?? this.windowStart
    if (nowMs - since < this.cfg.windowMs) return { kind: 'none' }
    if (this.samples.length < 2) return { kind: 'none' }

    const p90 = percentile(this.samples.map((s) => s.ms), 0.9)
    if (qualityRank(current) <= 0) {
      // Already at the floor: keep the cooldown clock moving so we don't churn.
      if (p90 > this.cfg.demoteAboveMs) this.lastActionAt = nowMs
      return { kind: 'none' }
    }

    const reactionMs = nowMs - since
    if (p90 > this.cfg.catastrophicMs) {
      this.commit(nowMs)
      return { kind: 'demote', from: current, to: QUALITY_ORDER[0], p90, reason: 'catastrophic', reactionMs }
    }
    if (p90 > this.cfg.demoteAboveMs) {
      const to = QUALITY_ORDER[qualityRank(current) - 1]
      this.commit(nowMs)
      return { kind: 'demote', from: current, to, p90, reason: 'slow', reactionMs }
    }
    return { kind: 'none' }
  }

  private commit(nowMs: number): void {
    this.lastActionAt = nowMs
    this.samples = []
  }
}

function percentile(xs: number[], p: number): number {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor(p * s.length))]
}
