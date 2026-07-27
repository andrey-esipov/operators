/**
 * Per-frame validation.
 *
 * Generation is stochastic. At a thousand-plus frames a few percent come back
 * wrong — the wrong character, a pose the model refused, or a grey field the
 * segmenter failed to clear — and a silent bad frame is the worst outcome: it
 * ships as a glitch in an animation nobody looked at. So every generated frame
 * is measured before it is accepted, and anything that trips a hard check is
 * regenerated rather than kept.
 *
 * The checks are deliberately cheap pixel statistics, not a vision model:
 *
 *  - identity     palette-histogram similarity against the untouched stance.
 *                 A different character has a different colour distribution;
 *                 this is what catches the model redrawing someone else.
 *  - segmentation opaque-pixel density inside the bounding box. A silhouette
 *                 that fills its box means the grey background survived (the
 *                 same >82% heuristic the probe used).
 *  - presence     the character exists and is a sane size — not a speck, not
 *                 the whole frame.
 *  - registration after re-seating, the feet sit on the shared origin. This is
 *                 forced by construction, so a residual means anchor detection
 *                 failed (a floating pose with no ground band).
 *  - aspect       silhouette width:height against the pose's expected range —
 *                 a soft, wide tripwire for gross off-model output (a "crouch"
 *                 that came back tall, a "knockdown" that came back standing).
 *
 * Identity and segmentation are hard rejects. Aspect is a warning: the ranges
 * are wide and a legitimately unusual pose can sit just outside one, so it is
 * surfaced for review rather than burning regenerations on a frame that is
 * probably fine.
 */
import sharp from 'sharp'
import { findAnchor } from './sprite-pipeline'
import type { FrameSpec } from './frame-spec'

export interface FrameMetrics {
  identity: number
  density: number
  coverage: number
  aspect: number
  footDrift: number
  bottomDrift: number
}

export interface ValidationResult {
  passed: boolean
  /** Hard failures — worth spending a regeneration on. */
  rejects: string[]
  /** Soft concerns — surfaced for review, not auto-regenerated. */
  warnings: string[]
  metrics: FrameMetrics
}

/**
 * Quantised colour histogram over the opaque pixels only.
 *
 * 3 bits per channel (512 bins) is coarse enough that pixel-art dithering and
 * the model's minor palette wobble land in the same bucket, but fine enough
 * that a navy shirt and a red shirt do not. Background is excluded via alpha
 * so the grey field can't dominate and mask a character change.
 */
async function paletteHistogram(pngWithAlpha: Buffer): Promise<Float64Array> {
  const { data, info } = await sharp(pngWithAlpha)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const hist = new Float64Array(512)
  let total = 0
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] <= 16) continue
    const r = data[i] >> 5, g = data[i + 1] >> 5, b = data[i + 2] >> 5
    hist[(r << 6) | (g << 3) | b]++
    total++
  }
  if (total > 0) for (let i = 0; i < hist.length; i++) hist[i] /= total
  return hist
}

function cosine(a: Float64Array, b: Float64Array): number {
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  if (na === 0 || nb === 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

/** Precompute the reference histogram once per fighter, not once per frame. */
export async function referenceHistogram(segmentedStance: Buffer): Promise<Float64Array> {
  return paletteHistogram(segmentedStance)
}

/**
 * Calibrated on the probe: five known-good chesky poses (startup, active,
 * recovery, walk, crouch) scored 0.956–0.972 against the chesky stance, while
 * other roster members' stances scored 0.51–0.88 against it. Because every
 * frame is edited *from* the stance, drift all the way to another character is
 * nearly impossible; the realistic failure is a subtler recolour or outfit
 * change. 0.82 sits well below the 0.956 same-character floor — a wide margin
 * so an extreme pose (a lying knockdown, a full roundhouse) can shift the
 * colour proportions without a false reject — yet still rejects the gross
 * palette changes that a wrong redraw produces.
 */
const IDENTITY_MIN = 0.82
const DENSITY_MAX = 82
const MIN_COVERAGE = 2.5
const MAX_COVERAGE = 78
const DRIFT_TOL = 2.5

export async function validateFrame(
  segmented: Buffer,
  registered: Buffer,
  refHist: Float64Array,
  spec: Pick<FrameSpec, 'name' | 'aspect'>,
  origin: { x: number; y: number },
): Promise<ValidationResult> {
  const rejects: string[] = []
  const warnings: string[] = []

  const { data, info } = await sharp(segmented)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  let a
  try {
    a = await findAnchor(segmented)
  } catch {
    return {
      passed: false,
      rejects: ['empty: nothing left after segmentation'],
      warnings,
      metrics: { identity: 0, density: 0, coverage: 0, aspect: 0, footDrift: 0, bottomDrift: 0 },
    }
  }

  let opaque = 0
  for (let y = a.top; y <= a.bottom; y++) {
    for (let x = a.left; x <= a.right; x++) {
      if (data[(y * info.width + x) * 4 + 3] > 8) opaque++
    }
  }
  const density = (opaque / (a.width * a.height)) * 100
  const coverage = (opaque / (info.width * info.height)) * 100
  const aspect = a.width / a.height

  const hist = await paletteHistogram(segmented)
  const identity = cosine(refHist, hist)

  const regAnchor = await findAnchor(registered)
  const footDrift = Math.abs(regAnchor.footX - origin.x)
  const bottomDrift = Math.abs(regAnchor.bottom - origin.y)

  const metrics: FrameMetrics = { identity, density, coverage, aspect, footDrift, bottomDrift }

  if (identity < IDENTITY_MIN) rejects.push(`identity drift: ${identity.toFixed(3)} < ${IDENTITY_MIN}`)
  if (density > DENSITY_MAX) rejects.push(`segmentation: density ${density.toFixed(1)}% > ${DENSITY_MAX}% (background retained)`)
  if (coverage < MIN_COVERAGE) rejects.push(`presence: coverage ${coverage.toFixed(1)}% — character missing or a speck`)
  if (coverage > MAX_COVERAGE) rejects.push(`presence: coverage ${coverage.toFixed(1)}% — fills the frame`)
  if (footDrift > DRIFT_TOL) rejects.push(`registration: foot drift ${footDrift.toFixed(1)}px`)
  if (bottomDrift > DRIFT_TOL) rejects.push(`registration: bottom drift ${bottomDrift.toFixed(1)}px`)

  if (spec.aspect) {
    const [lo, hi] = spec.aspect
    if (aspect < lo * 0.8 || aspect > hi * 1.25) {
      warnings.push(`aspect ${aspect.toFixed(2)} outside expected [${lo}, ${hi}] — possible off-model pose`)
    }
  }

  return { passed: rejects.length === 0, rejects, warnings, metrics }
}
