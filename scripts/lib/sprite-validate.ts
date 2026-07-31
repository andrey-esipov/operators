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
  /** Largest fully-enclosed transparent region as a fraction of the bbox. */
  holeFrac: number
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
/**
 * Largest enclosed transparent hole allowed, as a fraction of the character's
 * bounding box. A correctly-segmented sprite still has small fully-enclosed
 * transparent pockets — the triangle between a raised forearm and the torso,
 * the loop of a cocked fist — which the segmenter deliberately clears. Measured
 * across every accepted frame of four fighters (chesky/lenny/altman/doshi,
 * ~140 frames) the largest such legitimate pocket was ~5% of the bbox. A
 * segmentation *failure* that erases part of the body leaves a hole many times
 * that. 0.14 sits far above the real-pocket ceiling and far below a torso-sized
 * erasure, so it catches the failure without touching a single honest frame.
 */
const HOLE_MAX = 0.14

/**
 * Largest fully-enclosed transparent region inside the silhouette, as a
 * fraction of the bbox. Transparent pixels reachable from the bbox border are
 * exterior (or edge-open notches like the gap between the legs) and don't
 * count; only transparent pixels the silhouette walls off entirely do. A big
 * enclosed void is a segmentation hole punched through the character.
 */
function largestEnclosedHole(
  data: Buffer | Uint8Array,
  imgW: number,
  a: { left: number; right: number; top: number; bottom: number; width: number; height: number },
): number {
  const bw = a.width, bh = a.height
  if (bw <= 2 || bh <= 2) return 0
  // 0 = transparent-unseen, 1 = opaque, 2 = transparent-reached-from-border.
  const cell = new Uint8Array(bw * bh)
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      const alpha = data[((a.top + y) * imgW + (a.left + x)) * 4 + 3]
      cell[y * bw + x] = alpha > 8 ? 1 : 0
    }
  }
  const stack: number[] = []
  const visit = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= bw || y >= bh) return
    const p = y * bw + x
    if (cell[p] !== 0) return
    cell[p] = 2
    stack.push(p)
  }
  for (let x = 0; x < bw; x++) { visit(x, 0); visit(x, bh - 1) }
  for (let y = 0; y < bh; y++) { visit(0, y); visit(bw - 1, y) }
  while (stack.length) {
    const p = stack.pop()!
    const x = p % bw, y = (p / bw) | 0
    visit(x + 1, y); visit(x - 1, y); visit(x, y + 1); visit(x, y - 1)
  }
  // Any cell still 0 is an enclosed transparent pixel; size its components.
  let largest = 0
  for (let s = 0; s < cell.length; s++) {
    if (cell[s] !== 0) continue
    let size = 0
    const q = [s]
    cell[s] = 3
    while (q.length) {
      const p = q.pop()!
      size++
      const x = p % bw, y = (p / bw) | 0
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]] as const) {
        if (nx < 0 || ny < 0 || nx >= bw || ny >= bh) continue
        const np = ny * bw + nx
        if (cell[np] === 0) { cell[np] = 3; q.push(np) }
      }
    }
    if (size > largest) largest = size
  }
  return largest / (bw * bh)
}

export async function validateFrame(
  segmented: Buffer,
  registered: Buffer,
  refHist: Float64Array,
  spec: Pick<FrameSpec, 'name' | 'aspect'>,
  origin: { x: number; y: number },
  opts: { driftTol?: number } = {},
): Promise<ValidationResult> {
  // Foot/bottom drift are the only pixel-ABSOLUTE checks here (everything else is
  // a ratio or percentage). When the pipeline authors at 2x resolution the same
  // real drift measures twice as many pixels, so the caller scales this with the
  // resolution factor — otherwise a frame that is fine at 1x falsely rejects at 2x.
  const driftTol = opts.driftTol ?? DRIFT_TOL
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
      metrics: { identity: 0, density: 0, coverage: 0, aspect: 0, footDrift: 0, bottomDrift: 0, holeFrac: 0 },
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
  const holeFrac = largestEnclosedHole(data, info.width, a)

  const hist = await paletteHistogram(segmented)
  const identity = cosine(refHist, hist)

  const regAnchor = await findAnchor(registered)
  const footDrift = Math.abs(regAnchor.footX - origin.x)
  const bottomDrift = Math.abs(regAnchor.bottom - origin.y)

  const metrics: FrameMetrics = { identity, density, coverage, aspect, footDrift, bottomDrift, holeFrac }

  if (identity < IDENTITY_MIN) rejects.push(`identity drift: ${identity.toFixed(3)} < ${IDENTITY_MIN}`)
  if (density > DENSITY_MAX) rejects.push(`segmentation: density ${density.toFixed(1)}% > ${DENSITY_MAX}% (background retained)`)
  if (holeFrac > HOLE_MAX) rejects.push(`segmentation: enclosed hole ${(holeFrac * 100).toFixed(1)}% of bbox > ${(HOLE_MAX * 100).toFixed(0)}% (body erased)`)
  if (coverage < MIN_COVERAGE) rejects.push(`presence: coverage ${coverage.toFixed(1)}% — character missing or a speck`)
  if (coverage > MAX_COVERAGE) rejects.push(`presence: coverage ${coverage.toFixed(1)}% — fills the frame`)
  if (footDrift > driftTol) rejects.push(`registration: foot drift ${footDrift.toFixed(1)}px`)
  if (bottomDrift > driftTol) rejects.push(`registration: bottom drift ${bottomDrift.toFixed(1)}px`)

  if (spec.aspect) {
    const [lo, hi] = spec.aspect
    if (aspect < lo * 0.8 || aspect > hi * 1.25) {
      warnings.push(`aspect ${aspect.toFixed(2)} outside expected [${lo}, ${hi}] — possible off-model pose`)
    }
  }

  return { passed: rejects.length === 0, rejects, warnings, metrics }
}
