/**
 * Coverage anti-alias for a sprite silhouette edge.
 *
 * THE DEFECT (measured): key frames ship a 100% hard binary alpha (segmentation
 * writes 0/255, registration resizes `nearest`). At native 1:1 the silhouette is
 * a hard staircase, and an inked keyline laid along it staircases with it. This
 * is the single most visible remaining sprite artefact once 2x removed the
 * general softness.
 *
 * THE TRAP (named up front): "anti-alias the edge" naively means blur the image,
 * which drags background colour across the transparent boundary (a soft grey
 * halo) AND softens the interior into mush. Both are worse than the staircase.
 *
 * THE FIX: soften ONLY the alpha channel into a ~1px coverage ramp, keep every
 * fully-interior pixel's alpha at 255 and its RGB byte-identical (no interior
 * mush), and fill the RGB of newly-partial exterior pixels from the nearest
 * opaque neighbour (the inked edge colour) so the ramp is edge-coloured, not
 * background-grey (no halo).
 *
 * TWO PROBES, and per repo rule both are proven able to go red
 * (`npx tsx scripts/lib/edge-aa.ts --prove`):
 *   - edgeSmoothness: fraction of boundary pixels carrying a partial alpha. A
 *     hard binary edge scores ~0 and FAILS. Catches "did nothing".
 *   - interiorSharpness: mean RGB gradient over the solid interior. A blurred
 *     (mush) frame scores low and FAILS. Catches "softened everything".
 * A correct coverage-AA raises smoothness while holding interior sharpness, so
 * it is the only one of {hard, mush, correct} that passes both.
 */
import sharp from 'sharp'
import type { RGBAImage } from './keyline'

const luma = (r: number, g: number, b: number) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255

/**
 * Apply a coverage AA to the alpha edge in place. Returns pixels touched.
 * `radius` is the box half-width used to estimate coverage (1 => 3x3 => ~1px
 * ramp). Interior pixels (fully surrounded) are left exactly as they were.
 */
export function coverageAA(img: RGBAImage, opts: { radius?: number; alphaThreshold?: number } = {}): number {
  const r = opts.radius ?? 1
  const aTh = opts.alphaThreshold ?? 128
  const { data, width: w, height: h } = img
  const n = w * h
  const mask = new Uint8Array(n)
  for (let p = 0, i = 3; p < n; p++, i += 4) mask[p] = data[i] > aTh ? 1 : 0

  // Box coverage in [0,1]. Deep interior -> 1, deep exterior -> 0, boundary -> a
  // fraction that smooths the staircase. Separable would be faster; frames are
  // small and this runs offline, so a direct window is fine and clearer.
  const cov = new Float32Array(n)
  const win = (2 * r + 1) * (2 * r + 1)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0
      for (let dy = -r; dy <= r; dy++) {
        const yy = y + dy
        if (yy < 0 || yy >= h) continue
        for (let dx = -r; dx <= r; dx++) {
          const xx = x + dx
          if (xx < 0 || xx >= w) continue
          s += mask[yy * w + xx]
        }
      }
      cov[y * w + x] = s / win
    }
  }

  const src = data.slice() // read RGB from the unmodified copy
  let touched = 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x
      const c = cov[p]
      const i = p * 4
      if (mask[p] === 1) {
        // Interior/edge opaque pixel: only its alpha may drop where the shape is
        // locally concave; RGB is never touched, so no interior mush.
        const na = Math.round(Math.min(1, c) * 255)
        if (na !== data[i + 3]) { data[i + 3] = na; touched++ }
      } else {
        // Exterior pixel gaining coverage: raise alpha AND pull RGB from the
        // nearest opaque neighbour so the ramp is edge-coloured, not the stale
        // background grey underneath (this is what prevents a grey halo).
        if (c <= 0) continue
        let rr = 0, gg = 0, bb = 0, k = 0
        for (let dy = -r; dy <= r && k === 0; dy++) {
          const yy = y + dy
          if (yy < 0 || yy >= h) continue
          for (let dx = -r; dx <= r; dx++) {
            const xx = x + dx
            if (xx < 0 || xx >= w) continue
            if (mask[yy * w + xx] === 1) {
              const j = (yy * w + xx) * 4
              rr += src[j]; gg += src[j + 1]; bb += src[j + 2]; k++
            }
          }
        }
        if (!k) continue
        data[i] = Math.round(rr / k)
        data[i + 1] = Math.round(gg / k)
        data[i + 2] = Math.round(bb / k)
        data[i + 3] = Math.round(Math.min(1, c) * 255)
        touched++
      }
    }
  }
  return touched
}

/** Fraction of silhouette-boundary pixels carrying a partial (AA) alpha. */
export function edgeSmoothness(img: RGBAImage): { boundary: number; soft: number; smoothness: number } {
  const { data: d, width: w, height: h } = img
  const A = (x: number, y: number) => d[(y * w + x) * 4 + 3]
  let boundary = 0, soft = 0
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const a = A(x, y)
      if (a < 20) continue
      if (A(x - 1, y) < 20 || A(x + 1, y) < 20 || A(x, y - 1) < 20 || A(x, y + 1) < 20) {
        boundary++
        if (a < 245) soft++
      }
    }
  }
  return { boundary, soft, smoothness: soft / Math.max(1, boundary) }
}

/** Mean RGB gradient magnitude over the SOLID interior (alpha 255, all 4
 *  neighbours opaque). Measures interior detail; collapses under a blur. */
export function interiorSharpness(img: RGBAImage): number {
  const { data: d, width: w, height: h } = img
  const op = (x: number, y: number) => d[(y * w + x) * 4 + 3] === 255
  let sum = 0, cnt = 0
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      if (!op(x, y) || !op(x - 1, y) || !op(x + 1, y) || !op(x, y - 1) || !op(x, y + 1)) continue
      const i = (y * w + x) * 4
      const iL = (y * w + x - 1) * 4, iR = (y * w + x + 1) * 4
      const iU = ((y - 1) * w + x) * 4, iD = ((y + 1) * w + x) * 4
      const gx = Math.abs(luma(d[iR], d[iR + 1], d[iR + 2]) - luma(d[iL], d[iL + 1], d[iL + 2]))
      const gy = Math.abs(luma(d[iD], d[iD + 1], d[iD + 2]) - luma(d[iU], d[iU + 1], d[iU + 2]))
      sum += gx + gy; cnt++
    }
  }
  return sum / Math.max(1, cnt)
}

export async function toRGBA(buf: Buffer): Promise<RGBAImage> {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  return { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height }
}
export async function fromRGBA(img: RGBAImage): Promise<Buffer> {
  return sharp(Buffer.from(img.data.buffer, img.data.byteOffset, img.data.length), {
    raw: { width: img.width, height: img.height, channels: 4 },
  }).png().toBuffer()
}

// ── proof harness ───────────────────────────────────────────────────────────
async function prove() {
  const W = 128, H = 128
  // A hard binary disc: solid interior, hard staircased edge.
  const mk = (): RGBAImage => {
    const data = new Uint8ClampedArray(W * H * 4)
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const p = (y * W + x) * 4
      const dx = x - 64, dy = y - 64
      const inside = dx * dx + dy * dy <= 40 * 40
      if (inside) {
        // interior detail: a checker so interiorSharpness is non-trivial
        const v = ((x >> 2) + (y >> 2)) % 2 ? 210 : 90
        data[p] = v; data[p + 1] = v; data[p + 2] = v; data[p + 3] = 255
      } else { data[p] = 128; data[p + 1] = 128; data[p + 2] = 128; data[p + 3] = 0 }
    }
    return { data, width: W, height: H }
  }
  const hard = mk()
  const hS = edgeSmoothness(hard), hSharp = interiorSharpness(hard)
  console.log(`HARD binary:   smoothness=${(100 * hS.smoothness).toFixed(1)}%  interiorSharp=${hSharp.toFixed(4)}`)

  // Degenerate "mush": gaussian blur the whole image (edge smooths but interior dies).
  const blurBuf = await sharp(await fromRGBA(mk())).blur(2.5).png().toBuffer()
  const mush = await toRGBA(blurBuf)
  const mS = edgeSmoothness(mush), mSharp = interiorSharpness(mush)
  console.log(`MUSH blur:     smoothness=${(100 * mS.smoothness).toFixed(1)}%  interiorSharp=${mSharp.toFixed(4)}`)

  // Correct coverage AA.
  const aa = mk()
  const touched = coverageAA(aa, { radius: 1 })
  const aS = edgeSmoothness(aa), aSharp = interiorSharpness(aa)
  console.log(`COVERAGE AA:   smoothness=${(100 * aS.smoothness).toFixed(1)}%  interiorSharp=${aSharp.toFixed(4)}  (touched ${touched}px)`)

  const SMOOTH_MIN = 0.5, SHARP_MIN = 0.6 * hSharp
  const hardVerdict = hS.smoothness >= SMOOTH_MIN
  const mushVerdict = mS.smoothness >= SMOOTH_MIN && mSharp >= SHARP_MIN
  const aaVerdict = aS.smoothness >= SMOOTH_MIN && aSharp >= SHARP_MIN
  console.log(`\nthresholds: smoothness>=${SMOOTH_MIN}  interiorSharp>=${SHARP_MIN.toFixed(4)}`)
  console.log(`  HARD passes? ${hardVerdict}  (want false — hard edge must be caught)`)
  console.log(`  MUSH passes? ${mushVerdict}  (want false — mush must be caught)`)
  console.log(`  AA   passes? ${aaVerdict}  (want true)`)
  if (!hardVerdict && !mushVerdict && aaVerdict) {
    console.log('\nPASS: probes reject BOTH the hard staircase and the mush, accept only the coverage AA.')
    process.exit(0)
  }
  console.log('\nFAIL: probe did not discriminate all three cases.')
  process.exit(1)
}

if (process.argv.includes('--prove')) prove().catch((e) => { console.error(e); process.exit(1) })
