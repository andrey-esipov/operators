#!/usr/bin/env node
/**
 * Sprite-craft probe — answers two questions the EYE keeps getting wrong on
 * this project, numerically:
 *
 *   1. UPSCALE FACTOR. How many screen pixels does one authored art-pixel span?
 *      A 1:1 sprite is crisp; a 4.1x bilinear upscale went unnoticed for five
 *      sessions. We do NOT eyeball this. On a ROI known (by eye) to be sprite
 *      interior, we take the horizontal luma, high-pass it, and autocorrelate.
 *      The first lag with a strong positive peak is the art-pixel period. We
 *      also report the run-length distribution of near-constant plateaus: a
 *      hard nearest-neighbour upscale makes long identical runs; a bilinear one
 *      makes short ramped runs. (Autocorrelation once FALSIFIED an invented
 *      "nearest-neighbour blocking" complaint — so we print both.)
 *
 *   2. SILHOUETTE HALO. Is the warm outline tracing a fighter a directional
 *      rim-light (art — brightest on the backlit edge, dim on the other) or a
 *      uniform alpha-fringe / edge-bleed (artifact — same on every edge)? For a
 *      list of (y, xFront, xBack) edge points we sample a horizontal strip
 *      across each edge and report, just OUTSIDE the body, the warm-band peak
 *      (R-B), its width at half-max, and left/right symmetry.
 *
 * Reads a composited PNG (no alpha) with `sharp`. Coordinates are NATIVE pixels
 * of the captured frame (DPR2 => 3200x1800). Nothing is downscaled.
 *
 *   node tools/sprite-craft.mjs <frame.png> --roi L,T,W,H [--edges "y:xF:xB,..."]
 */
import sharp from 'sharp'

const argv = process.argv.slice(2)
const src = argv[0]
const arg = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d }
if (!src) { console.error('usage: sprite-craft.mjs <frame.png> --roi L,T,W,H [--edges y:xF:xB,...]'); process.exit(2) }

const { data, info } = await sharp(src).raw().toBuffer({ resolveWithObject: true })
const W = info.width, H = info.height, ch = info.channels
const idx = (x, y) => (y * W + x) * ch
const R = (x, y) => data[idx(x, y)]
const G = (x, y) => data[idx(x, y) + 1]
const B = (x, y) => data[idx(x, y) + 2]
const L = (x, y) => 0.2126 * R(x, y) + 0.7152 * G(x, y) + 0.0722 * B(x, y)
console.log(`frame ${W}x${H} channels ${ch}  src ${src}`)

// ---------- 1. UPSCALE via autocorrelation + run-length ----------
const roi = (arg('roi', '') || '').split(',').map(Number)
if (roi.length === 4) {
  const [L0, T0, Wr, Hr] = roi
  console.log(`\n== UPSCALE on ROI ${L0},${T0} ${Wr}x${Hr} ==`)
  // average several rows to suppress noise, keep horizontal structure
  const rows = []
  for (let y = T0; y < T0 + Hr; y += 3) {
    const row = new Float64Array(Wr)
    for (let x = 0; x < Wr; x++) row[x] = L(L0 + x, y)
    rows.push(row)
  }
  const avg = new Float64Array(Wr)
  for (const r of rows) for (let x = 0; x < Wr; x++) avg[x] += r[x] / rows.length
  // high-pass (subtract local mean) then autocorrelate lags 1..16
  const mean = avg.reduce((a, b) => a + b, 0) / Wr
  const hp = avg.map(v => v - mean)
  const ac = []
  let ac0 = 0
  for (let x = 0; x < Wr; x++) ac0 += hp[x] * hp[x]
  for (let lag = 1; lag <= 16; lag++) {
    let s = 0
    for (let x = 0; x + lag < Wr; x++) s += hp[x] * hp[x + lag]
    ac.push(s / ac0)
  }
  console.log('  autocorr lag1..16:', ac.map(v => v.toFixed(2)).join(' '))
  // first local max in lag>=2 is the dominant period (art-pixel width)
  let period = 1, best = -2
  for (let lag = 2; lag <= 14; lag++) {
    if (ac[lag - 1] > ac[lag - 2] && ac[lag - 1] >= ac[lag] && ac[lag - 1] > best) { best = ac[lag - 1]; period = lag }
  }
  console.log(`  dominant period ~= ${period}px (peak r=${best.toFixed(2)})  => ~${period}x upscale if source is 1 art-px`)
  // run-length of near-constant plateaus (threshold 4 luma) on the mid row
  const midY = T0 + (Hr >> 1)
  const runs = []
  let run = 1
  for (let x = 1; x < Wr; x++) {
    if (Math.abs(L(L0 + x, midY) - L(L0 + x - 1, midY)) <= 4) run++
    else { runs.push(run); run = 1 }
  }
  runs.push(run)
  const hist = {}
  for (const r of runs) { const b = r >= 8 ? '8+' : String(r); hist[b] = (hist[b] || 0) + 1 }
  const total = runs.length
  const meanRun = runs.reduce((a, b) => a + b, 0) / total
  console.log(`  run-length hist (midrow, dL<=4): ${JSON.stringify(hist)}  mean=${meanRun.toFixed(1)}px n=${total}`)
}

// ---------- 2. HALO: rim-light vs uniform fringe ----------
const edges = arg('edges', '')
if (edges) {
  console.log('\n== SILHOUETTE HALO (warm band just outside body) ==')
  console.log('  edge y  side  outPeak(R-B)  widthHalfMax(px)  bodyWarm  bgWarm')
  const warmth = (x, y) => R(x, y) - B(x, y)
  const measure = (y, x, dir) => {
    // dir = -1 scan leftwards (outside is to the left, e.g. back edge on right side facing right)
    // We sample a 16px window centered on x; body is toward +? We detect by luma drop.
    const win = 18
    const prof = []
    for (let k = -win; k <= win; k++) prof.push({ k, w: warmth(x + k, y), l: L(x + k, y) })
    // outside = the side with lower luma structure change... instead: caller passes dir where +1 means body is to the RIGHT of x (outside left)
    const outside = prof.filter(p => (dir > 0 ? p.k < 0 : p.k > 0))
    const body = prof.filter(p => (dir > 0 ? p.k > 3 : p.k < -3))
    const bg = prof.filter(p => (dir > 0 ? p.k < -10 : p.k > 10))
    const peak = Math.max(...outside.map(p => p.w))
    const bgW = bg.reduce((a, p) => a + p.w, 0) / bg.length
    const bodyW = body.reduce((a, p) => a + p.w, 0) / body.length
    // width at half of (peak-bg) within a few px of edge
    const half = bgW + (peak - bgW) / 2
    const near = prof.filter(p => Math.abs(p.k) <= 10)
    const width = near.filter(p => p.w >= half).length
    return { peak, bgW, bodyW, width }
  }
  for (const tok of edges.split(',')) {
    const [y, xF, xB] = tok.split(':').map(Number)
    // front edge: body is to the RIGHT (interior), outside to the LEFT => dir +1
    const f = measure(y, xF, +1)
    // back edge: body is to the LEFT, outside to the RIGHT => dir -1
    const b = measure(y, xB, -1)
    console.log(`  y=${y} FRONT x=${xF}  outPeak=${(f.peak - f.bgW).toFixed(0)}  w~${f.width}px  body=${f.bodyW.toFixed(0)} bg=${f.bgW.toFixed(0)}`)
    console.log(`  y=${y} BACK  x=${xB}  outPeak=${(b.peak - b.bgW).toFixed(0)}  w~${b.width}px  body=${b.bodyW.toFixed(0)} bg=${b.bgW.toFixed(0)}`)
  }
  console.log('  (uniform front≈back => fringe/outline; front≪back or vice-versa => directional rim-light)')
}
