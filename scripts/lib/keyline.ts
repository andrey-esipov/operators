/**
 * Keyline pass: bake a constant-weight ink rim into a fighter sprite's
 * silhouette so it reads as *drawn* (Guilty Gear Strive / Skullgirls) rather
 * than *cut out*. The renderer already dilates the silhouette's own colour
 * outward and feathers a 1px antialias on top, so an inked rim here composes
 * into a clean drawn edge downstream.
 *
 * THE FAILURE MODE THIS GUARDS (named up front): a naive inward ink band eats
 * thin features. A 3px-wide mic boom or a finger is entirely within the band
 * from both sides, so a 2px band paints the whole thing ink and the feature's
 * real colour/highlight is destroyed. Two defences:
 *
 *   1. In the pass: only ink an edge pixel when the feature it belongs to is
 *      thick enough to have a non-edge CORE nearby. A thin feature has no core,
 *      so it is never inked. Thick features (torso, thigh) get their rim inked.
 *
 *   2. The probe `thinFeatureSurvival`: independently measures how much of the
 *      thin-feature detail (bright pixels, mean luminance) survives the pass and
 *      HARD-FAILS if too much is lost. Per repo rule this probe is proven able to
 *      go red — run `npx tsx scripts/lib/keyline.ts --prove`, which feeds it a
 *      deliberately over-aggressive pass and confirms it fails, then the real
 *      pass and confirms it passes.
 */
import sharp from 'sharp'

export interface KeylineOpts {
  /** Ink band width in pixels (atlas resolution). */
  band?: number
  /** RGB multiplier for inked pixels (lower = darker line). */
  darken?: number
  /** Protect thin features by requiring a nearby core. Default true. */
  protectThin?: boolean
  /** Depth (erosion dist) a pixel must exceed to count as a protecting core.
   *  Defaults to `band`. Set to the probe's thinRadius so the pass protects
   *  exactly what the probe guards — then thin pixels are skipped individually
   *  instead of the whole frame being rejected. */
  coreDepth?: number
  /** Alpha threshold for "opaque". */
  alphaThreshold?: number
}

export interface RGBAImage {
  data: Uint8ClampedArray
  width: number
  height: number
}

/** Erosion distance: for every opaque pixel, chamfer distance to nearest
 *  transparent pixel (i.e. how deep inside the silhouette it sits). */
function erosionDistance(mask: Uint8Array, w: number, h: number): Float32Array {
  const INF = 1e9
  const d = new Float32Array(w * h)
  for (let p = 0; p < d.length; p++) d[p] = mask[p] === 0 ? 0 : INF
  const A = 1, B = 1.41421356
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x
      if (d[p] === 0) continue
      let v = d[p]
      if (y > 0) {
        if (x > 0) v = Math.min(v, d[p - w - 1] + B)
        v = Math.min(v, d[p - w] + A)
        if (x < w - 1) v = Math.min(v, d[p - w + 1] + B)
      }
      if (x > 0) v = Math.min(v, d[p - 1] + A)
      d[p] = v
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const p = y * w + x
      if (d[p] === 0) continue
      let v = d[p]
      if (y < h - 1) {
        if (x < w - 1) v = Math.min(v, d[p + w + 1] + B)
        v = Math.min(v, d[p + w] + A)
        if (x > 0) v = Math.min(v, d[p + w - 1] + B)
      }
      if (x < w - 1) v = Math.min(v, d[p + 1] + A)
      d[p] = v
    }
  }
  return d
}

function luma(r: number, g: number, b: number) {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
}

/**
 * Apply an ink keyline in place. Returns the number of pixels inked. Pure
 * function over an RGBA image so it is testable without any file I/O.
 */
export function applyKeyline(img: RGBAImage, opts: KeylineOpts = {}): number {
  const band = opts.band ?? 3
  const darken = opts.darken ?? 0.34
  const protectThin = opts.protectThin ?? true
  const coreDepth = opts.coreDepth ?? band
  const aTh = opts.alphaThreshold ?? 128
  const { data, width: w, height: h } = img
  const n = w * h

  const mask = new Uint8Array(n)
  for (let p = 0, i = 3; p < n; p++, i += 4) mask[p] = data[i] > aTh ? 255 : 0
  const dist = erosionDistance(mask, w, h)

  // Core = pixels deeper than coreDepth. A feature that has core within reach of
  // an edge pixel is thick enough to ink; a thin feature (no core) is left
  // untouched. Search radius covers coreDepth so the protection reaches a core
  // that sits just past the ink band.
  const R = Math.ceil(Math.max(band, coreDepth))
  let inked = 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x
      if (mask[p] === 0) continue
      if (dist[p] > band) continue // interior core: keep real colour
      if (protectThin) {
        let hasCore = false
        for (let dy = -R; dy <= R && !hasCore; dy++) {
          const yy = y + dy
          if (yy < 0 || yy >= h) continue
          for (let dx = -R; dx <= R; dx++) {
            const xx = x + dx
            if (xx < 0 || xx >= w) continue
            if (dist[yy * w + xx] > coreDepth) { hasCore = true; break }
          }
        }
        if (!hasCore) continue // thin feature — do not ink
      }
      const i = p * 4
      data[i] = data[i] * darken
      data[i + 1] = data[i + 1] * darken
      data[i + 2] = data[i + 2] * darken
      inked++
    }
  }
  return inked
}

export interface ThinSurvival {
  brightBefore: number
  brightAfter: number
  survival: number
  meanLumDropThin: number
  thinPixels: number
  ok: boolean
}

/**
 * Measure how much genuine thin-feature detail survived the keyline pass.
 *
 * "Thin feature" is NOT merely a shallow pixel — a thick torso's edge is shallow
 * too, and the pass is *supposed* to ink that. A thin feature is a narrow
 * structure: an opaque pixel that is shallow AND has no deep core anywhere in its
 * neighbourhood (a mic boom, a finger). This is the same no-core test the pass
 * uses to decide what to protect, so on a correct pass these pixels are never
 * inked and survival stays ~1. The probe is still an independent OUTCOME check:
 * it counts bright pixels before/after, so if the pass ever inks a thin feature
 * (e.g. protection is disabled, as in `--prove`), survival collapses and it fails.
 */
export function thinFeatureSurvival(
  before: RGBAImage,
  after: RGBAImage,
  opts: { thinRadius?: number; brightAt?: number; minSurvival?: number; maxDrop?: number } = {},
): ThinSurvival {
  const thinRadius = opts.thinRadius ?? 3
  const brightAt = opts.brightAt ?? 0.5
  const minSurvival = opts.minSurvival ?? 0.6
  const maxDrop = opts.maxDrop ?? 0.2
  const { data: b, width: w, height: h } = before
  const a = after.data
  const n = w * h

  const mask = new Uint8Array(n)
  for (let p = 0, i = 3; p < n; p++, i += 4) mask[p] = b[i] > 128 ? 255 : 0
  const dist = erosionDistance(mask, w, h)

  // A pixel is part of a thin structure only if it is shallow AND no deeper core
  // exists nearby. This excludes thick-feature rims (which have a core just
  // inside) so the probe measures the mic boom / fingers, not the torso edge.
  const R = Math.ceil(thinRadius)
  let brightBefore = 0, brightAfter = 0, thinPixels = 0, dropSum = 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x
      if (mask[p] === 0 || dist[p] > thinRadius) continue
      let hasCore = false
      for (let dy = -R; dy <= R && !hasCore; dy++) {
        const yy = y + dy
        if (yy < 0 || yy >= h) continue
        for (let dx = -R; dx <= R; dx++) {
          const xx = x + dx
          if (xx < 0 || xx >= w) continue
          if (dist[yy * w + xx] > thinRadius) { hasCore = true; break }
        }
      }
      if (hasCore) continue // thick-feature rim, not a thin structure
      thinPixels++
      const i = p * 4
      const lb = luma(b[i], b[i + 1], b[i + 2])
      const la = luma(a[i], a[i + 1], a[i + 2])
      if (lb > brightAt) brightBefore++
      if (la > brightAt) brightAfter++
      dropSum += Math.max(0, lb - la)
    }
  }
  const survival = brightBefore > 0 ? brightAfter / brightBefore : 1
  const meanLumDropThin = thinPixels > 0 ? dropSum / thinPixels : 0
  const ok = survival >= minSurvival && meanLumDropThin <= maxDrop
  return { brightBefore, brightAfter, survival, meanLumDropThin, thinPixels, ok }
}

// ---------------------------------------------------------------------------
// Sharp adapters

export async function toRGBA(buf: Buffer): Promise<RGBAImage> {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  return { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height }
}

export async function fromRGBA(img: RGBAImage): Promise<Buffer> {
  return sharp(Buffer.from(img.data.buffer, img.data.byteOffset, img.data.length), {
    raw: { width: img.width, height: img.height, channels: 4 },
  }).png().toBuffer()
}

/** Ink a PNG buffer and return the inked PNG plus the thin-feature verdict. */
export async function keylinePng(
  buf: Buffer,
  opts: KeylineOpts & { thinRadius?: number } = {},
): Promise<{ png: Buffer; survival: ThinSurvival; inked: number }> {
  const before = await toRGBA(buf)
  const after: RGBAImage = { data: before.data.slice(), width: before.width, height: before.height }
  const inked = applyKeyline(after, opts)
  const survival = thinFeatureSurvival(before, after, { thinRadius: opts.thinRadius })
  return { png: await fromRGBA(after), survival, inked }
}

// ---------------------------------------------------------------------------
// Proof: the probe MUST be able to fail. Feed it an over-aggressive pass that
// eats a thin bright feature; confirm red. Then the real protected pass; green.

function makeTestFrame(): RGBAImage {
  const w = 120, h = 120
  const data = new Uint8ClampedArray(w * h * 4)
  const set = (x: number, y: number, r: number, g: number, b: number) => {
    const i = (y * w + x) * 4
    data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255
  }
  // A thick dark body blob (a torso).
  for (let y = 30; y < 100; y++) for (let x = 30; x < 80; x++) set(x, y, 40, 45, 90)
  // A THIN bright bar sticking out (a metallic mic boom), 3px wide, bright.
  for (let y = 20; y < 95; y++) for (let x = 88; x < 91; x++) set(x, y, 220, 225, 230)
  return { data, width: w, height: h }
}

async function prove() {
  const base = makeTestFrame()
  const thinBefore = thinFeatureSurvival(base, base, {}).brightBefore
  console.log(`test frame: ${thinBefore} bright thin-feature pixels (the mic boom)\n`)

  // 1) Over-aggressive: wide band, no thin protection -> should EAT the boom.
  const aggr: RGBAImage = { data: base.data.slice(), width: base.width, height: base.height }
  applyKeyline(aggr, { band: 6, darken: 0.15, protectThin: false })
  const rAggr = thinFeatureSurvival(base, aggr, {})
  console.log('AGGRESSIVE pass (band=6, no thin protection):')
  console.log(`  bright thin px ${rAggr.brightBefore} -> ${rAggr.brightAfter}  survival=${rAggr.survival.toFixed(2)}  meanLumDrop=${rAggr.meanLumDropThin.toFixed(3)}  ok=${rAggr.ok}`)

  // 2) Real protected pass: narrow band, thin protection -> boom SURVIVES.
  const safe: RGBAImage = { data: base.data.slice(), width: base.width, height: base.height }
  const inked = applyKeyline(safe, { band: 3, darken: 0.34, protectThin: true })
  const rSafe = thinFeatureSurvival(base, safe, {})
  console.log(`\nPROTECTED pass (band=3, protectThin, inked ${inked} px):`)
  console.log(`  bright thin px ${rSafe.brightBefore} -> ${rSafe.brightAfter}  survival=${rSafe.survival.toFixed(2)}  meanLumDrop=${rSafe.meanLumDropThin.toFixed(3)}  ok=${rSafe.ok}`)

  const proven = rAggr.ok === false && rSafe.ok === true
  console.log(`\n${proven ? 'PASS' : 'FAIL'}: probe went RED on the over-aggressive pass and GREEN on the protected pass.`)
  if (!proven) { console.error('Probe did not discriminate — it is worthless. Fix before trusting.'); process.exit(1) }
}

if (process.argv[1] && process.argv[1].endsWith('keyline.ts') && process.argv.includes('--prove')) {
  prove()
}
