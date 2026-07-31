// Composition-fill instrument for the select suite — owned by src/fighthud/**.
//
// The v9 critic's #3 was quantitative in spirit but eyeballed: "all three
// screens strand a narrow centre grid in a huge dead purple void … it reads
// like a mobile layout stretched onto 16:9." This turns that into a number so a
// rebuild can be proven, not asserted, and a regression can be caught.
//
// Two measures, both over a 1600x900-class screenshot:
//
//   voidFraction   — share of pixels that are near the dead-purple background
//                    (dark AND low-chroma-purple). High = empty frame.
//   activeCells    — of a COLS×ROWS grid laid over the frame, how many tiles
//                    carry real content (luma spread OR a bright/among-accent
//                    pixel). High = the layout reaches into the corners and
//                    edges instead of clustering one island in the middle.
//   edgeActive     — activeCells restricted to the outer ring of tiles, the
//                    exact region an under-filled "mobile layout" leaves dead.
//
// Falsifiable by construction: run with --self-test and it renders a synthetic
// "empty void" frame and a synthetic "full-bleed" frame and asserts the metric
// separates them (void→high voidFraction/low activeCells, full→the inverse).
// Break the thresholds and --self-test goes red. This is the mutation proof the
// project demands of every instrument.

import sharp from 'sharp'
import { readFileSync } from 'node:fs'

const COLS = 16
const ROWS = 9
// The background void the critic named: #0b0713 / #150d22 / #241634 — all dark,
// all purple-blue (b >= r > g). A pixel is "void" if it is dark and sits in that
// hue box. Content — fighter art, painted stage thumbs, accent plates, white
// lettering — is either brighter or off that purple axis.
function isVoid(r, g, b) {
  const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b
  if (luma > 46) return false
  // near-neutral-dark or purple-blue-dark: g is the smallest channel, b >= r.
  return g <= r + 10 && b + 12 >= r && g < 46
}

// A tile is "active" if it has real luma spread (structure/edges) OR contains a
// clearly-lit pixel (art highlight, accent, text). Pure flat void tiles fail
// both.
function tileActive(px, x0, y0, tw, th, W) {
  let min = 255, max = 0, bright = 0, n = 0
  for (let y = y0; y < y0 + th; y += 2) {
    for (let x = x0; x < x0 + tw; x += 2) {
      const i = (y * W + x) * 3
      const r = px[i], g = px[i + 1], b = px[i + 2]
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b
      if (luma < min) min = luma
      if (luma > max) max = luma
      if (luma > 96) bright++
      n++
    }
  }
  const spread = max - min
  return spread > 40 || bright > n * 0.06
}

export async function measureFill(bufOrPath) {
  const input = typeof bufOrPath === 'string' ? readFileSync(bufOrPath) : bufOrPath
  const { data, info } = await sharp(input)
    .resize(1600, 900, { fit: 'fill' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const W = info.width, H = info.height
  let voidPx = 0
  for (let i = 0; i < data.length; i += 3) {
    if (isVoid(data[i], data[i + 1], data[i + 2])) voidPx++
  }
  const total = W * H
  const tw = Math.floor(W / COLS), th = Math.floor(H / ROWS)
  let active = 0, edgeActive = 0, edgeTotal = 0
  for (let ry = 0; ry < ROWS; ry++) {
    for (let cx = 0; cx < COLS; cx++) {
      const isEdge = ry === 0 || ry === ROWS - 1 || cx === 0 || cx === COLS - 1
      if (isEdge) edgeTotal++
      const on = tileActive(data, cx * tw, ry * th, tw, th, W)
      if (on) {
        active++
        if (isEdge) edgeActive++
      }
    }
  }
  return {
    voidFraction: +(voidPx / total).toFixed(4),
    activeCells: active,
    totalCells: COLS * ROWS,
    activeFraction: +(active / (COLS * ROWS)).toFixed(4),
    edgeActive,
    edgeTotal,
    edgeFraction: +(edgeActive / edgeTotal).toFixed(4),
  }
}

async function synth(kind) {
  if (kind === 'void') {
    // A narrow bright island dead-centre on a #150d22 void — the exact failure.
    const bg = { create: { width: 1600, height: 900, channels: 3, background: { r: 0x15, g: 0x0d, b: 0x22 } } }
    const island = await sharp({ create: { width: 360, height: 300, channels: 3, background: { r: 230, g: 210, b: 120 } } }).png().toBuffer()
    return sharp(bg).composite([{ input: island, left: 620, top: 300 }]).png().toBuffer()
  }
  // Full-bleed: bright structured content edge-to-edge.
  const noise = Buffer.alloc(1600 * 900 * 3)
  for (let i = 0; i < noise.length; i += 3) {
    const v = 120 + ((i * 2654435761) % 130)
    noise[i] = v; noise[i + 1] = v - 30; noise[i + 2] = v + 20
  }
  return sharp(noise, { raw: { width: 1600, height: 900, channels: 3 } }).png().toBuffer()
}

if (process.argv.includes('--self-test')) {
  const v = await measureFill(await synth('void'))
  const f = await measureFill(await synth('full'))
  console.log('void  frame:', JSON.stringify(v))
  console.log('full  frame:', JSON.stringify(f))
  const checks = [
    ['void frame reads mostly-empty (voidFraction > 0.55)', v.voidFraction > 0.55],
    ['full frame reads filled     (voidFraction < 0.05)', f.voidFraction < 0.05],
    ['void frame has few active cells (< 0.30)', v.activeFraction < 0.30],
    ['full frame fills the grid       (> 0.90)', f.activeFraction > 0.90],
    ['void frame leaves the edges dead (edgeFraction < 0.15)', v.edgeFraction < 0.15],
    ['full frame reaches the edges     (edgeFraction > 0.90)', f.edgeFraction > 0.90],
    ['metric separates the two (full.active > 3x void.active)', f.activeCells > 3 * Math.max(1, v.activeCells)],
  ]
  let bad = 0
  for (const [label, ok] of checks) { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`); if (!ok) bad++ }
  process.exit(bad ? 1 : 0)
} else if (process.argv[2] && !process.argv[2].startsWith('--')) {
  console.log(JSON.stringify(await measureFill(process.argv[2]), null, 2))
}
