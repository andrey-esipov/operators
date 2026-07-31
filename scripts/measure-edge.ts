/**
 * Measure a single KEY frame's silhouette edge: alpha histogram (hard binary vs
 * coverage ramp) plus a magnified edge crop so the staircase is visible at 1:1.
 * Key frames are nearest-resized and un-morphed, so they carry the hardest edge
 * — which is exactly what a held heavy-attack pose shows on screen.
 *
 *   npx tsx scripts/measure-edge.ts <fighter> <frame> [heightRatio]
 */
import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { removeFlatBackground, registerFrame } from './lib/sprite-pipeline'
import { toRGBA } from './lib/keyline'

const SCALE = 2
const CANVAS = 512 * SCALE
const TARGET_H = 380 * SCALE
const ORIGIN = { x: 256 * SCALE, y: 470 * SCALE }

function alphaStats(img: { data: Uint8ClampedArray; width: number; height: number }) {
  const d = img.data
  let zero = 0, full = 0, partial = 0
  const buckets = new Array(8).fill(0)
  for (let i = 3; i < d.length; i += 4) {
    const a = d[i]
    if (a === 0) zero++
    else if (a === 255) full++
    else { partial++; buckets[Math.min(7, a >> 5)]++ }
  }
  const opaqueish = full + partial
  return { zero, full, partial, buckets, partialOfEdge: partial / Math.max(1, opaqueish) }
}

/** Fraction of silhouette-boundary pixels that carry a partial (AA) alpha.
 *  A hard binary edge => ~0. A coverage-AA edge => high. */
function edgeSmoothness(img: { data: Uint8ClampedArray; width: number; height: number }) {
  const { data: d, width: w, height: h } = img
  const A = (x: number, y: number) => d[(y * w + x) * 4 + 3]
  let boundary = 0, soft = 0
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const a = A(x, y)
      if (a === 0) continue
      // boundary = opaque-ish pixel touching a fully transparent neighbour
      if (A(x - 1, y) === 0 || A(x + 1, y) === 0 || A(x, y - 1) === 0 || A(x, y + 1) === 0) {
        boundary++
        if (a < 250 && a > 5) soft++
      }
    }
  }
  return { boundary, soft, smoothness: soft / Math.max(1, boundary) }
}

async function main() {
  const [id = 'lenny', frame = 'hp-active', hr = '1.0'] = process.argv.slice(2)
  const raw = fs.readFileSync(path.join('.sprite-gen', id, 'raw', `${frame}.png`))
  const seg = await removeFlatBackground(raw)
  const reg = await registerFrame(seg, {
    canvasW: CANVAS, canvasH: CANVAS, targetHeight: TARGET_H,
    originX: ORIGIN.x, originY: ORIGIN.y, heightRatio: parseFloat(hr),
  })
  const img = await toRGBA(reg)
  const s = alphaStats(img)
  const e = edgeSmoothness(img)
  console.log(`${id}/${frame}:`)
  console.log(`  alpha  zero=${s.zero}  full=${s.full}  partial=${s.partial}  partialOfEdge=${(100 * s.partialOfEdge).toFixed(2)}%`)
  console.log(`  buckets(0..255/8): ${s.buckets.join(' ')}`)
  console.log(`  boundary px=${e.boundary}  soft(AA)=${e.soft}  smoothness=${(100 * e.smoothness).toFixed(1)}%  <- ~0% = hard staircase`)

  // Magnified edge crop so the staircase is legible. Find the tightest bbox,
  // then crop a small window on the leading (right) arm/shoulder edge and blow
  // it up 6x with nearest so pixels stay square.
  const outDir = path.join('public', 'fighters', id, 'review')
  fs.mkdirSync(outDir, { recursive: true })
  const win = { left: CANVAS / 2 + 40, top: 300, width: 90, height: 120 }
  const crop = await sharp(reg).extract(win).resize({ width: win.width * 6, height: win.height * 6, kernel: 'nearest' })
    .flatten({ background: { r: 60, g: 60, b: 68 } }).png().toBuffer()
  const outPath = path.join(outDir, `edge-${frame}.png`)
  fs.writeFileSync(outPath, crop)
  console.log(`  wrote ${outPath} (6x magnified edge on grey)`)
}
main().catch((e) => { console.error(e); process.exit(1) })
