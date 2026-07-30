/**
 * Ghost score — detects double-exposure in synthesised in-between cels.
 *
 * ONE implementation, shared by the reporting tool (tools/tween-ghost-census.ts)
 * and the gate (src/three/fight/__tests__/tweenGhosting.node.test.ts). They must
 * not drift: a tool that grades differently from the gate is how a "verified"
 * number stops matching the thing that blocks a merge.
 *
 * WHAT IT MEASURES
 * The fraction of a cel's own body that sits at PARTIAL alpha. `inbetween.ts`
 * morphs two keys by optical flow; it forward-splats colour (correct — that moves
 * mass) but cross-dissolves ALPHA linearly. Where the flow finds no correspondence
 * — a limb crossing in front of another, a body rotating — one key is opaque and
 * the other transparent over a whole region, so the dissolve lands that region at
 * alpha≈127: a 50%-translucent ghost limb with the background showing through.
 * A hand-drawn cel has no such region: it is opaque inside and transparent
 * outside, with only a thin anti-aliased rim between.
 *
 * CALIBRATION — these numbers came from a blind critique, not from taste.
 * An art critic graded cels with no access to the score; the score then separated
 * its verdicts with no overlap, and ranked correctly within each verdict:
 *     hand-drawn keys        4.1 - 5.9 %   (roster-wide: mean 5.0%, max 8.2%)
 *     tweens graded CLEAN    6.6 - 17.9 %
 *     tweens graded BROKEN  23.5 - 40.7 %
 *
 * ⚠️ VALIDATED AS A DETECTOR, NOT AS AN OBJECTIVE. Read this before "improving"
 * any morph code against it. An alpha-sharpening variant drove walk tweens from
 * 34-41% to 6.9-17.1% — deep into the clean band — and the same blind critic then
 * graded the result WORSE than the ghost it replaced (2/10 vs 3/10): it had traded
 * soft translucency for ragged, doubled, speckled silhouette edges. This score
 * cannot see silhouette damage. Use it to FIND ghosting; never tune against it
 * without putting the output in front of an eye.
 */
import sharp from 'sharp'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Alpha cutoffs, as 0-255. Anything outside [SOFT_MIN, SOFT_MAX] is "decided"
 * (transparent or solid); anything inside is a partial pixel.
 *
 * The 15%/85% band is deliberately wide enough to ignore the anti-aliased rim
 * every drawn sprite carries. That rim is why a hand-drawn key scores 4-8% and
 * not 0% — the floor is a measured baseline, not zero, and a threshold set at or
 * near zero would red on clean art.
 */
export const SOFT_MIN = 38
export const SOFT_MAX = 217

/**
 * Erosion radius, in atlas pixels, for {@link thickGhostArea}. A partial-alpha
 * region must be wider than `2*RADIUS+1` (9px) to be counted.
 *
 * Chosen from a sweep over 2/3/4/6 against 329 hand-drawn cels: at 4, every
 * single hand-drawn key scores exactly 0.00%. That is the number that matters —
 * the detector must be incapable of firing on art a human drew.
 */
export const RADIUS = 4

/**
 * The RATCHET: today's high-water mark on {@link thickGhostArea}, in percent.
 *
 * ⚠️ THIS IS NOT A VALIDATED "BROKEN" LINE, and calling it one would be the
 * mistake this file's other warnings are about. Ground truth says only this:
 * hand-drawn cels read exactly 0.0%, so every non-zero reading is morph residue.
 * When cels a blind critic had graded were measured on this scale, the known-bad
 * (translucent doubled forearms) spanned 1.6-10.5% and the known-good spanned
 * 0-4.9% — they OVERLAP, so no threshold can separate them and any number claimed
 * to do so would be fitted, not measured.
 *
 * So this is used as a one-way ratchet instead: it holds the line where the art
 * is today and reds if any cel gets worse. Lower it whenever the worst reading
 * drops. Do not raise it to admit a new cel — that is the failure mode of every
 * threshold this project has had to retire.
 */
export const BROKEN_AT = 5.5

export interface CelScore {
  fighter: string
  clip: string
  name: string
  /** True when the cel was synthesised by the morph rather than drawn. */
  tween: boolean
  /** % of body lying in a partial-alpha region thicker than 2*RADIUS+1 px. */
  score: number
  /** Whole-cel partial-alpha ratio. Retained for population statistics only. */
  global: number
}

/**
 * Whole-cel fraction (%) of body pixels at partial alpha.
 *
 * ⚠️ NOT A DETECTOR. Kept for population statistics and cross-build comparison
 * only. It cleared a translucent doubled forearm at 13-21% because the ghost was
 * one limb averaged against a large static torso — see {@link thickGhostArea}.
 */
export function scoreRegion(
  atlas: Buffer | Uint8Array,
  atlasWidth: number,
  rect: { x: number; y: number; w: number; h: number },
): number {
  let mid = 0
  let body = 0
  for (let row = 0; row < rect.h; row++) {
    let o = ((rect.y + row) * atlasWidth + rect.x) * 4 + 3
    for (let col = 0; col < rect.w; col++, o += 4) {
      const a = atlas[o]
      if (a > SOFT_MIN) {
        body++
        if (a < SOFT_MAX) mid++
      }
    }
  }
  // Denominator is the body, not the canvas, so the score is invariant to how
  // tightly a cel is trimmed or where the packer placed it.
  return body ? (mid / body) * 100 : 0
}

/**
 * THE DETECTOR: % of the cel's body lying in a partial-alpha region THICK enough
 * that no anti-aliasing could have produced it.
 *
 * THE IDEA. Every drawn sprite has partial-alpha pixels — the anti-aliased rim
 * around its silhouette. That rim is one to two pixels thick. A morph ghost is a
 * whole limb at ~50% alpha: tens of pixels thick. Thickness, not presence, is
 * what distinguishes them, so this erodes the partial-alpha mask by {@link RADIUS}
 * and measures only what survives. A rim vanishes; a ghosted forearm does not.
 *
 * WHY IT REPLACED TWO EARLIER ATTEMPTS. Both failed their positive control, and
 * both failures are worth remembering because they are the same mistake twice:
 *   - A whole-cel partial-alpha ratio missed a translucent doubled forearm (one
 *     limb averaged against a static clean torso scored 13-21%, i.e. "clean").
 *   - A worst-local-window score saturated: hand-drawn keys reached 23-65% and
 *     critic-approved cels hit 100%, because a small window landing on hair or a
 *     drawstring is nearly all rim.
 * This one reads 0.00% on all 329 hand-drawn cels in the roster while still
 * ranking the morphed ones by severity.
 *
 * ⚠️ STILL A DETECTOR, NEVER AN OBJECTIVE. Do not tune the morph until this
 * number falls. That exact move has already produced a worse-looking result once:
 * alpha-sharpening drove the old score into the clean band by trading soft
 * translucency for ragged, doubled silhouette edges, which no alpha statistic can
 * see. Put the output in front of an eye.
 */
export function thickGhostArea(
  atlas: Buffer | Uint8Array,
  atlasWidth: number,
  rect: { x: number; y: number; w: number; h: number },
  radius = RADIUS,
): number {
  const { x, y, w, h } = rect
  const soft = new Uint8Array(w * h)
  let body = 0
  for (let row = 0; row < h; row++) {
    let o = ((y + row) * atlasWidth + x) * 4 + 3
    for (let col = 0; col < w; col++, o += 4) {
      const a = atlas[o]
      if (a > SOFT_MIN) {
        body++
        if (a < SOFT_MAX) soft[row * w + col] = 1
      }
    }
  }
  if (!body) return 0
  // Summed-area table so the erosion is O(1) per pixel rather than O(radius²).
  const S = new Int32Array((w + 1) * (h + 1))
  for (let row = 0; row < h; row++) {
    for (let col = 0; col < w; col++) {
      S[(row + 1) * (w + 1) + col + 1] =
        soft[row * w + col] + S[row * (w + 1) + col + 1] + S[(row + 1) * (w + 1) + col] - S[row * (w + 1) + col]
    }
  }
  const side = 2 * radius + 1
  const need = side * side
  let thick = 0
  for (let row = radius; row < h - radius; row++) {
    for (let col = radius; col < w - radius; col++) {
      if (!soft[row * w + col]) continue
      const r0 = row - radius
      const c0 = col - radius
      const r1 = row + radius + 1
      const c1 = col + radius + 1
      // Survives erosion only if the whole window is partial-alpha.
      if (S[r1 * (w + 1) + c1] - S[r0 * (w + 1) + c1] - S[r1 * (w + 1) + c0] + S[r0 * (w + 1) + c0] === need) thick++
    }
  }
  return (thick / body) * 100
}

/**
 * Score every cel of one fighter's SHIPPED atlas — the exact bytes the game
 * loads, not the generator's in-memory buffers. A packing or manifest defect
 * introduced after registration is visible here and invisible upstream.
 *
 * Returns one row per (clip, cel); a cel repeated inside a clip is scored once
 * per occurrence, so callers that want per-DRAWING stats must dedupe by name.
 */
export async function scoreFighter(id: string, publicDir = 'public'): Promise<CelScore[] | null> {
  const manifestPath = join(publicDir, 'fighters', id, 'assets.json')
  if (!existsSync(manifestPath)) return null
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  // `manifest.atlas` is a public-ROOT-relative URL ("/fighters/<id>/atlas.webp"),
  // which is what the browser requests. Resolve it against publicDir, NOT against
  // the fighter directory, or the path silently doubles.
  const atlasPath = join(publicDir, String(manifest.atlas).replace(/^\//, ''))
  // Decode once. A sharp .extract() per cel re-decodes the whole multi-megapixel
  // atlas each time and turns a 4-second census into a multi-minute one.
  const { data, info } = await sharp(readFileSync(atlasPath))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  const rows: CelScore[] = []
  for (const [clip, c] of Object.entries<any>(manifest.clips ?? {})) {
    for (const fi of c.frames ?? []) {
      const f = manifest.frames[fi]
      if (!f?.rect) continue
      rows.push({
        fighter: id,
        clip,
        name: f.name,
        tween: String(f.name).startsWith('tw-'),
        score: thickGhostArea(data, info.width, f.rect),
        global: scoreRegion(data, info.width, f.rect),
      })
    }
  }
  return rows
}

/** One row per unique (fighter, cel) — a drawing repeated across clips counts once. */
export function byDrawing(rows: CelScore[]): CelScore[] {
  const seen = new Map<string, CelScore>()
  for (const r of rows) {
    const k = `${r.fighter}/${r.name}`
    if (!seen.has(k)) seen.set(k, r)
  }
  return [...seen.values()]
}
