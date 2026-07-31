/**
 * Re-run segmentation + registration over already-generated raw frames.
 * Lets the segmentation maths be iterated on without paying for regeneration.
 *
 *   npx tsx scripts/reseg-probe.ts chesky
 */
import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { removeFlatBackground, findAnchor, registerFrame } from './lib/sprite-pipeline'

const FIGHTER = process.argv[2] || 'chesky'
const DIR = path.resolve(process.cwd(), '.sprite-probe', FIGHTER)

const HEIGHT_RATIO: Record<string, number> = {
  '0-stance': 1, '1-startup': 0.99, '2-active': 0.98,
  '3-recovery': 0.99, '4-walk-fwd': 1.0, '5-crouch': 0.72,
}

async function main() {
  const raws = fs.readdirSync(DIR).filter((f) => f.startsWith('raw-')).sort()
  const stance = path.resolve(process.cwd(), 'public/sprites', FIGHTER, 'stance.png')
  const items: { name: string; buf: Buffer }[] = [
    { name: '0-stance', buf: fs.readFileSync(stance) },
    ...raws.map((f) => ({ name: f.replace(/^raw-|\.png$/g, ''), buf: fs.readFileSync(path.join(DIR, f)) })),
  ]

  const CANVAS = 512, TARGET_H = 380, ORIGIN_X = 256, ORIGIN_Y = 470
  const out: { name: string; buf: Buffer }[] = []

  console.log(`\n--- reseg ${FIGHTER} ---`)
  for (const it of items) {
    const cut = await removeFlatBackground(it.buf)
    // Opaque-pixel share of the bounding box. A silhouette that fills its box
    // almost entirely means background survived segmentation.
    const { data, info } = await sharp(cut).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    const a = await findAnchor(cut)
    let opaque = 0
    for (let y = a.top; y <= a.bottom; y++) {
      for (let x = a.left; x <= a.right; x++) {
        if (data[(y * info.width + x) * 4 + 3] > 8) opaque++
      }
    }
    const density = (opaque / (a.width * a.height)) * 100
    const flag = density > 82 ? '  <-- SUSPECT: background likely retained' : ''
    console.log(`  ${it.name.padEnd(12)} bbox ${String(a.width).padStart(4)}x${String(a.height).padStart(4)}  density ${density.toFixed(1)}%${flag}`)

    const reg = await registerFrame(cut, {
      canvasW: CANVAS, canvasH: CANVAS, targetHeight: TARGET_H,
      originX: ORIGIN_X, originY: ORIGIN_Y, heightRatio: HEIGHT_RATIO[it.name] ?? 1,
    })
    fs.writeFileSync(path.join(DIR, `reg-${it.name}.png`), reg)
    out.push({ name: it.name, buf: reg })
  }

  const sheet = await sharp({
    create: { width: CANVAS * out.length, height: CANVAS, channels: 4, background: { r: 24, g: 26, b: 34, alpha: 1 } },
  }).composite(out.map((r, i) => ({ input: r.buf, left: i * CANVAS, top: 0 }))).png().toBuffer()
  fs.writeFileSync(path.join(DIR, 'contact-sheet.png'), sheet)
  console.log(`\nwrote contact sheet (${out.length} frames)`)
}

main().catch((e) => { console.error(e); process.exit(1) })
