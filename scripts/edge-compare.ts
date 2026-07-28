/**
 * Review artefact: identical edge window, hard-binary vs keyline+coverage-AA,
 * 6x magnified side by side, so the staircase fix is legible at 1:1. Left is the
 * current shipped registration (nearest, binary alpha); right is after the two
 * edge passes. Judged on a native crop per repo rule, never a downscaled sheet.
 *
 *   npx tsx scripts/edge-compare.ts <fighter> <frame> [heightRatio]
 */
import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { removeFlatBackground, registerFrame } from './lib/sprite-pipeline'
import { toRGBA, fromRGBA, applyKeyline } from './lib/keyline'
import { coverageAA, edgeSmoothness, interiorSharpness } from './lib/edge-aa'

const SCALE = 2, CANVAS = 512 * SCALE, TARGET_H = 380 * SCALE
const ORIGIN = { x: 256 * SCALE, y: 470 * SCALE }
const BAND = 1.5 * SCALE, DARKEN = 0.34, THIN_R = 2 * SCALE

async function main() {
  const [id = 'lenny', frame = 'hp-active', hr = '1.0'] = process.argv.slice(2)
  const raw = fs.readFileSync(path.join('.sprite-gen', id, 'raw', `${frame}.png`))
  const seg = await removeFlatBackground(raw)
  const reg = await registerFrame(seg, {
    canvasW: CANVAS, canvasH: CANVAS, targetHeight: TARGET_H,
    originX: ORIGIN.x, originY: ORIGIN.y, heightRatio: parseFloat(hr),
  })
  const hard = await toRGBA(reg)
  const aa = { data: hard.data.slice(), width: hard.width, height: hard.height }
  applyKeyline(aa, { band: BAND, darken: DARKEN, protectThin: true, coreDepth: THIN_R })
  const sBefore = interiorSharpness(aa)
  coverageAA(aa, { radius: 1 })
  const sAfter = interiorSharpness(aa)
  console.log(`hard smoothness ${(100 * edgeSmoothness(hard).smoothness).toFixed(1)}%  ->  AA ${(100 * edgeSmoothness(aa).smoothness).toFixed(1)}%`)
  console.log(`interior sharpness ${sBefore.toFixed(4)} -> ${sAfter.toFixed(4)} (${(100 * sAfter / sBefore).toFixed(1)}% retained)`)

  const win = { left: CANVAS / 2 + 40, top: 300, width: 90, height: 120 }
  // Auto-locate an OUTER silhouette edge: scan a band of rows, take the median
  // leftmost-opaque x, and centre the window on it. This puts the crop on the
  // body outline against the background (what the user judges), not interior.
  {
    const A = (x: number, y: number) => hard.data[(y * hard.width + x) * 4 + 3]
    const xs: number[] = []
    for (let y = 260; y < 520; y += 8) {
      for (let x = 0; x < hard.width; x++) { if (A(x, y) > 128) { xs.push(x); break } }
    }
    if (xs.length) {
      xs.sort((a, b) => a - b)
      const mx = xs[xs.length >> 1]
      win.left = Math.max(0, mx - 30)
      win.top = 300
    }
  }
  const mag = 6
  const grey = { r: 60, g: 60, b: 68 }
  const cropHard = await sharp(await fromRGBA(hard)).extract(win).resize({ width: win.width * mag, height: win.height * mag, kernel: 'nearest' }).flatten({ background: grey }).png().toBuffer()
  const cropAA = await sharp(await fromRGBA(aa)).extract(win).resize({ width: win.width * mag, height: win.height * mag, kernel: 'nearest' }).flatten({ background: grey }).png().toBuffer()
  const W = win.width * mag
  const combo = await sharp({ create: { width: W * 2 + 12, height: win.height * mag, channels: 4, background: { r: 20, g: 20, b: 24, alpha: 255 } } })
    .composite([{ input: cropHard, left: 0, top: 0 }, { input: cropAA, left: W + 12, top: 0 }]).png().toBuffer()
  const outDir = path.join('public', 'fighters', id, 'review')
  fs.mkdirSync(outDir, { recursive: true })
  const outPath = path.join(outDir, `edge-compare-${frame}.png`)
  fs.writeFileSync(outPath, combo)
  console.log(`wrote ${outPath}  (left=hard binary  right=keyline+coverage-AA, 6x)`)
}
main().catch((e) => { console.error(e); process.exit(1) })
