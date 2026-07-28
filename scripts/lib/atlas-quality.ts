/**
 * Shipped-atlas quality probe.
 *
 * The existing edge probes (scripts/lib/keyline.ts, scripts/lib/edge-aa.ts) run
 * on synthetic discs or on frames RE-DERIVED from the raws. Neither reads what
 * actually ships: `public/fighters/<id>/atlas.png`. A future bad pass — or a
 * re-export — can corrupt the committed atlas without any of those probes
 * noticing, because they never open the file. This probe closes that gap: it
 * measures the committed artifact, frame by frame, at native 1:1.
 *
 * It answers three questions the eye keeps getting wrong here:
 *
 *  1. Is the subject even in the crop? (House rule: a motion instrument once
 *     reported a confident "6.0 keys/sec" while measuring an EMPTY RECTANGLE.)
 *     `subjectPresent` refuses to score a frame whose silhouette is missing.
 *
 *  2. What edge does the SHADER actually sample? The committed atlas carries a
 *     smooth sub-pixel coverage ramp, but the load-time texture builder
 *     (AtlasTextures.buildAtlasTextures) re-thresholds alpha at >128 and
 *     re-feathers it. `simulateRuntimeAlpha` reproduces that transform exactly
 *     so we can measure the edge the fighter shader sees on screen — not the
 *     prettier one sitting in the PNG.
 *
 *  3. Did an over-cranked keyline/erode pass eat the fine geometry — lenny's
 *     mic boom, the fingers? `thinFeatureSurvival` (reused from keyline.ts)
 *     measures bright-pixel survival over genuine thin structures. This probe
 *     drives it from the REAL shipped frame, not a synthetic bar, and is proven
 *     failable in both directions via `--prove`.
 *
 * Run:  npx tsx scripts/lib/atlas-quality.ts --prove
 */
import sharp from 'sharp'
import fs from 'node:fs'
import path from 'node:path'
import {
  applyKeyline,
  thinFeatureSurvival,
  type RGBAImage,
} from './keyline'
import { conditionAlbedoAlpha, despeckle, featherAlpha } from '../../src/three/fight/edgeAlpha'

// ---------------------------------------------------------------------------
// Committed-atlas frame access

export interface AtlasFrame {
  name: string
  rect: { x: number; y: number; w: number; h: number }
}

export interface LoadedAtlas {
  id: string
  width: number
  height: number
  data: Uint8ClampedArray
  frames: AtlasFrame[]
}

/** Read a fighter's committed atlas.png + manifest into raw RGBA, once. */
export async function loadCommittedAtlas(id: string, root = '.'): Promise<LoadedAtlas> {
  const dir = path.join(root, 'public', 'fighters', id)
  const assets = JSON.parse(fs.readFileSync(path.join(dir, 'assets.json'), 'utf-8'))
  const { data, info } = await sharp(path.join(dir, 'atlas.png'))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  return {
    id,
    width: info.width,
    height: info.height,
    data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length),
    frames: assets.frames as AtlasFrame[],
  }
}

/** Copy one frame's sub-rect out of the atlas into a standalone RGBA image. */
export function cutFrame(atlas: LoadedAtlas, frame: AtlasFrame): RGBAImage {
  const { x, y, w, h } = frame.rect
  const out = new Uint8ClampedArray(w * h * 4)
  const AW = atlas.width
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const si = ((y + py) * AW + (x + px)) * 4
      const di = (py * w + px) * 4
      out[di] = atlas.data[si]
      out[di + 1] = atlas.data[si + 1]
      out[di + 2] = atlas.data[si + 2]
      out[di + 3] = atlas.data[si + 3]
    }
  }
  return { data: out, width: w, height: h }
}

// ---------------------------------------------------------------------------
// House-rule guard: is the fighter actually inside the crop?

export interface SubjectStat {
  area: number
  frac: number
  present: boolean
}

/** Silhouette coverage. A frame with almost no opaque pixels is an empty
 *  rectangle and must not be scored — every metric below would return a
 *  confident number about nothing. */
export function subjectPresent(img: RGBAImage, minFrac = 0.02, aTh = 8): SubjectStat {
  const { data, width: w, height: h } = img
  let area = 0
  for (let i = 3; i < data.length; i += 4) if (data[i] > aTh) area++
  const frac = area / (w * h)
  return { area, frac, present: frac >= minFrac }
}

// ---------------------------------------------------------------------------
// Edge metrics

const luma = (r: number, g: number, b: number) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255

export interface EdgeStat {
  boundary: number
  soft: number
  smoothness: number
  /** distinct partial-alpha levels present on the edge — sub-pixel richness. */
  levels: number
}

/** Edge smoothness + sub-pixel level count over an alpha array. */
export function edgeMetrics(alpha: Uint8Array | Uint8ClampedArray, w: number, h: number): EdgeStat {
  const A = (x: number, y: number) => alpha[y * w + x]
  let boundary = 0, soft = 0
  const levelSet = new Set<number>()
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const a = A(x, y)
      if (a > 5 && a < 250) levelSet.add(a)
      if (a < 20) continue
      if (A(x - 1, y) < 20 || A(x + 1, y) < 20 || A(x, y - 1) < 20 || A(x, y + 1) < 20) {
        boundary++
        if (a < 245) soft++
      }
    }
  }
  return { boundary, soft, smoothness: soft / Math.max(1, boundary), levels: levelSet.size }
}

/** Pull the alpha channel out of an RGBA image. */
export function alphaOf(img: RGBAImage): Uint8Array {
  const n = img.width * img.height
  const a = new Uint8Array(n)
  for (let p = 0, i = 3; p < n; p++, i += 4) a[p] = img.data[i]
  return a
}

// ---------------------------------------------------------------------------
// The on-screen edge. `runtimeAlpha` runs the SHARED conditioning the renderer
// uses (src/three/fight/edgeAlpha), so this measures the exact alpha the shader
// samples — it cannot drift from the runtime. `legacyRuntimeAlpha` reproduces
// the pre-fix transform (hard threshold + 3-level feather) and exists only as a
// regression control: the fix must beat it.

/** The alpha the shader samples on screen, via the shared runtime conditioning. */
export function runtimeAlpha(img: RGBAImage): Uint8Array {
  const copy = img.data.slice()
  conditionAlbedoAlpha(copy, img.width, img.height)
  const n = img.width * img.height
  const a = new Uint8Array(n)
  for (let p = 0, i = 3; p < n; p++, i += 4) a[p] = copy[i]
  return a
}

/** Pre-fix transform: threshold at a>128, despeckle, 3-level feather. The bug. */
export function legacyRuntimeAlpha(img: RGBAImage): Uint8Array {
  const { data, width: w, height: h } = img
  const n = w * h
  const mask = new Uint8Array(n)
  for (let p = 0, i = 3; p < n; p++, i += 4) mask[p] = data[i] > 128 ? 255 : 0
  despeckle(mask, w, h)
  return featherAlpha(mask, w, h)
}

// ---------------------------------------------------------------------------
// Keyline presence: is there a darker ink rim inside the silhouette edge?

function erosion(mask: Uint8Array, w: number, h: number): Float32Array {
  const INF = 1e9
  const d = new Float32Array(w * h)
  for (let p = 0; p < d.length; p++) d[p] = mask[p] === 0 ? 0 : INF
  const A = 1, B = 1.41421356
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
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
  for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) {
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
  return d
}

export interface KeylineStat {
  rimLuma: number
  coreLuma: number
  /** rimLuma / coreLuma. A drawn ink keyline makes this < 1 (rim darker). */
  ratio: number
  present: boolean
}

/**
 * Mean luminance of the thin rim band (erosion depth 1..2) vs the near-core
 * (depth 4..8). A baked ink keyline darkens the rim, so ratio < 1. This is how
 * the probe confirms the "inked line" the roster ships with is actually there —
 * not a proxy for its on-screen weight, which is set by the edge (above).
 */
export function keylineStat(img: RGBAImage): KeylineStat {
  const { data, width: w, height: h } = img
  const n = w * h
  const mask = new Uint8Array(n)
  for (let p = 0, i = 3; p < n; p++, i += 4) mask[p] = data[i] > 128 ? 255 : 0
  const d = erosion(mask, w, h)
  let rimSum = 0, rimN = 0, coreSum = 0, coreN = 0
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    if (mask[p] === 0) continue
    const l = luma(data[i], data[i + 1], data[i + 2])
    if (d[p] >= 1 && d[p] <= 2) { rimSum += l; rimN++ }
    else if (d[p] >= 4 && d[p] <= 8) { coreSum += l; coreN++ }
  }
  const rimLuma = rimN ? rimSum / rimN : 0
  const coreLuma = coreN ? coreSum / coreN : 1
  const ratio = coreLuma > 0 ? rimLuma / coreLuma : 1
  return { rimLuma, coreLuma, ratio, present: ratio < 0.9 }
}

// ---------------------------------------------------------------------------
// Thin-geometry survival: brightness-INDEPENDENT feature-eating detector.
//
// Luma survival (keyline.ts) catches an ink pass darkening BRIGHT thin features
// (fingers, extended limbs). It is blind to a DARK thin feature — lenny's mic
// boom strut is near-black, so darkening or deleting it barely moves luma. The
// instrument for the boom is geometry: how much of the thin-feature AREA is
// still opaque after the pass. Erode the boom and this collapses regardless of
// its colour. Verified at native 1:1 that R=8 puts the boom strut in the set.

export interface GeomSurvival {
  thinPixels: number
  remaining: number
  survival: number
  ok: boolean
}

function thinMask(img: RGBAImage, thinRadius: number): Uint8Array {
  const { data, width: w, height: h } = img
  const n = w * h
  const mask = new Uint8Array(n)
  for (let p = 0, i = 3; p < n; p++, i += 4) mask[p] = data[i] > 128 ? 255 : 0
  const d = erosion(mask, w, h)
  const R = Math.ceil(thinRadius)
  const tm = new Uint8Array(n)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = y * w + x
    if (mask[p] === 0 || d[p] > thinRadius) continue
    let core = false
    for (let dy = -R; dy <= R && !core; dy++) {
      const yy = y + dy
      if (yy < 0 || yy >= h) continue
      for (let dx = -R; dx <= R; dx++) {
        const xx = x + dx
        if (xx < 0 || xx >= w) continue
        if (d[yy * w + xx] > thinRadius) { core = true; break }
      }
    }
    if (!core) tm[p] = 1
  }
  return tm
}

/** Fraction of the before-frame's thin-feature area still opaque afterwards. */
export function thinGeometrySurvival(
  before: RGBAImage,
  after: RGBAImage,
  opts: { thinRadius?: number; minKeep?: number } = {},
): GeomSurvival {
  const thinRadius = opts.thinRadius ?? 8
  const minKeep = opts.minKeep ?? 0.6
  const tm = thinMask(before, thinRadius)
  const a = after.data
  let thinPixels = 0, remaining = 0
  for (let p = 0; p < tm.length; p++) {
    if (!tm[p]) continue
    thinPixels++
    if (a[p * 4 + 3] > 128) remaining++
  }
  const survival = thinPixels ? remaining / thinPixels : 1
  return { thinPixels, remaining, survival, ok: survival >= minKeep }
}

// ---------------------------------------------------------------------------
// The two over-cranked passes this probe exists to catch. Kept separate so the
// proof can map each failure to its instrument: ink -> bright fingers (luma),
// erode -> dark mic boom (geometry).

/** Over-cranked INK pass: wide band, heavy darken, thin protection OFF. On a
 *  thin feature the whole width sits inside the band, so a bright finger is
 *  darkened end to end. */
export function overCrankInk(img: RGBAImage, opts: { band?: number; darken?: number } = {}): RGBAImage {
  const out: RGBAImage = { data: img.data.slice(), width: img.width, height: img.height }
  applyKeyline(out, { band: opts.band ?? 7, darken: opts.darken ?? 0.12, protectThin: false })
  return out
}

/** Over-cranked EROSION pass: strips the outer `px` ring off the silhouette,
 *  zeroing colour AND alpha. A thin strut narrower than 2*px vanishes. */
export function overCrankErode(img: RGBAImage, px = 2): RGBAImage {
  const out: RGBAImage = { data: img.data.slice(), width: img.width, height: img.height }
  const { width: w, height: h } = out
  const n = w * h
  const mask = new Uint8Array(n)
  for (let p = 0, i = 3; p < n; p++, i += 4) mask[p] = out.data[i] > 128 ? 255 : 0
  const d = erosion(mask, w, h)
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    if (mask[p] && d[p] <= px) { out.data[i] = 0; out.data[i + 1] = 0; out.data[i + 2] = 0; out.data[i + 3] = 0 }
  }
  return out
}

/** Both at once — the worst case. */
export function overCrank(img: RGBAImage, opts: { erode?: number; band?: number; darken?: number } = {}): RGBAImage {
  return overCrankErode(overCrankInk(img, opts), opts.erode ?? 2)
}

// ---------------------------------------------------------------------------
// Proof: the probe MUST be able to fail, in every dimension it asserts.

async function toRGBA(buf: Buffer): Promise<RGBAImage> {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  return { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height }
}

async function prove() {
  let allOk = true
  const say = (ok: boolean, msg: string) => { console.log(`  ${ok ? 'ok ' : 'RED'}  ${msg}`); if (!ok) allOk = false }

  const atlas = await loadCommittedAtlas('lenny')
  const frameByName = (n: string) => cutFrame(atlas, atlas.frames.find((f) => f.name === n)!)

  // Pick the shipped frame with the most BRIGHT thin pixels for the luma proof —
  // the most demanding real frame, not a hand-picked easy one.
  let brightFrame = 'idle-1', brightN = -1
  for (const f of atlas.frames) {
    const s = thinFeatureSurvival(cutFrame(atlas, f), cutFrame(atlas, f), {})
    if (s.brightBefore > brightN) { brightN = s.brightBefore; brightFrame = f.name }
  }

  console.log('1) empty-rectangle guard (house rule: never measure an empty crop)')
  const empty: RGBAImage = { data: new Uint8ClampedArray(64 * 64 * 4), width: 64, height: 64 }
  say(subjectPresent(empty).present === false, `empty crop -> present=false (${subjectPresent(empty).frac.toFixed(3)} coverage)`)
  const boom = frameByName('idle-1')
  say(subjectPresent(boom).present === true, `lenny idle-1 -> present=true (${(100 * subjectPresent(boom).frac).toFixed(1)}% coverage)`)

  console.log(`\n2) BRIGHT fingers — an over-cranked INK pass must go RED (frame ${brightFrame})`)
  const bf = frameByName(brightFrame)
  const inkCrank = overCrankInk(bf, { band: 7, darken: 0.12 })
  const rIdentL = thinFeatureSurvival(bf, bf, {})
  const rInk = thinFeatureSurvival(bf, inkCrank, {})
  say(rIdentL.ok === true, `identity -> luma survival ${rIdentL.survival.toFixed(2)} ok=${rIdentL.ok} (${rIdentL.brightBefore} bright thin px)`)
  say(rInk.ok === false, `ink over-crank -> bright thin px ${rInk.brightBefore}->${rInk.brightAfter} survival=${rInk.survival.toFixed(2)} ok=${rInk.ok}`)

  console.log('\n3) DARK mic boom — an over-cranked EROSION pass must go RED (geometry, brightness-independent)')
  for (const name of ['idle-1', 'idle-3']) {
    const img = frameByName(name)
    const gIdent = thinGeometrySurvival(img, img, {})
    const gErode = thinGeometrySurvival(img, overCrankErode(img, 2), {})
    say(gIdent.ok === true, `${name} identity -> geometry survival ${gIdent.survival.toFixed(2)} (${gIdent.thinPixels} thin px incl. boom strut)`)
    say(gErode.ok === false, `${name} 2px erosion -> ${gErode.remaining}/${gErode.thinPixels} survive = ${gErode.survival.toFixed(2)} ok=${gErode.ok}`)
  }

  console.log('\n4) on-screen edge: the shared runtime conditioning must keep the baked ramp')
  const bakedEdge = edgeMetrics(alphaOf(boom), boom.width, boom.height)
  const runtimeEdge = edgeMetrics(runtimeAlpha(boom), boom.width, boom.height)
  const legacyEdge = edgeMetrics(legacyRuntimeAlpha(boom), boom.width, boom.height)
  console.log(`     baked (shipped PNG):        smoothness=${(100 * bakedEdge.smoothness).toFixed(1)}%  levels=${bakedEdge.levels}`)
  console.log(`     runtime (shared, fixed):    smoothness=${(100 * runtimeEdge.smoothness).toFixed(1)}%  levels=${runtimeEdge.levels}`)
  console.log(`     legacy (pre-fix, control):  smoothness=${(100 * legacyEdge.smoothness).toFixed(1)}%  levels=${legacyEdge.levels}`)
  say(bakedEdge.levels >= 4, `shipped ramp is genuinely sub-pixel (levels ${bakedEdge.levels} >= 4)`)
  say(legacyEdge.levels <= 2, `pre-fix control reproduces the quantised edge (levels ${legacyEdge.levels} <= 2)`)
  say(runtimeEdge.levels > legacyEdge.levels && runtimeEdge.levels >= 4,
    `fix delivers the ramp to screen (levels ${runtimeEdge.levels} > legacy ${legacyEdge.levels})`)

  console.log('\n5) keyline presence: the shipped roster ships a drawn ink rim')
  const k = keylineStat(boom)
  say(k.present === true, `rim/core luma ${k.rimLuma.toFixed(3)}/${k.coreLuma.toFixed(3)} = ${k.ratio.toFixed(3)} (< 0.9 => inked)`)

  console.log(`\n${allOk ? 'PASS' : 'FAIL'}: probe discriminates in every dimension it asserts.`)
  if (!allOk) process.exit(1)
}

if (process.argv[1] && process.argv[1].endsWith('atlas-quality.ts') && process.argv.includes('--prove')) {
  prove().catch((e) => { console.error(e); process.exit(1) })
}

export { toRGBA }
