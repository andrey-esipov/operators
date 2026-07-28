/**
 * Review artefact: 1:1 native-resolution before/after crop of the keyline pass.
 * Per repo rule, keyline quality is judged on a NATIVE crop, not a downscaled
 * sheet (downscaling hides both jaggies and an over-eaten thin feature). This
 * segments one cached raw, registers it exactly as the generator does, then
 * writes side-by-side un-inked/inked crops of (a) a hard silhouette edge and
 * (b) the head/mic region where the thin boom lives.
 *
 *   npx tsx scripts/keyline-crop.ts <fighter> <frame> [rawName]
 */
import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { removeFlatBackground, registerFrame } from './lib/sprite-pipeline'
import { toRGBA, fromRGBA, applyKeyline, thinFeatureSurvival } from './lib/keyline'

const SCALE = 2
const CANVAS = 512 * SCALE
const TARGET_H = 380 * SCALE
const ORIGIN = { x: 256 * SCALE, y: 470 * SCALE }
const BAND = 1.5 * SCALE
const DARKEN = 0.34
const THIN_R = 2 * SCALE

async function main() {
  const [id = 'lenny', frame = 'idle-1', rawName = frame] = process.argv.slice(2)
  const rawPath = path.join('.sprite-gen', id, 'raw', `${rawName}.png`)
  const raw = fs.readFileSync(rawPath)
  const seg = await removeFlatBackground(raw)
  const reg = await registerFrame(seg, {
    canvasW: CANVAS, canvasH: CANVAS, targetHeight: TARGET_H,
    originX: ORIGIN.x, originY: ORIGIN.y, heightRatio: 1.02,
  })

  const before = await toRGBA(reg)
  const after = { data: before.data.slice(), width: before.width, height: before.height }
  const inked = applyKeyline(after, { band: BAND, darken: DARKEN, protectThin: true, coreDepth: THIN_R })
  const surv = thinFeatureSurvival(before, after, { thinRadius: THIN_R })
  console.log(`inked ${inked} px; thin-feature survival ${surv.survival.toFixed(3)} (bright ${surv.brightBefore}->${surv.brightAfter}) thinPx=${surv.thinPixels} ok=${surv.ok}`)

  const beforeBuf = await fromRGBA(before)
  const afterBuf = await fromRGBA(after)
  const outDir = path.join('public', 'fighters', id, 'review')
  fs.mkdirSync(outDir, { recursive: true })

  // Two crops at 1:1: upper body (head + mic boom) and a mid-body edge.
  const crops: Record<string, { left: number; top: number; width: number; height: number }> = {
    head: { left: CANVAS / 2 - 220, top: 60, width: 440, height: 360 },
    edge: { left: CANVAS / 2 - 260, top: 380, width: 520, height: 300 },
  }
  for (const [tag, c] of Object.entries(crops)) {
    const b = await sharp(beforeBuf).extract(c).png().toBuffer()
    const a = await sharp(afterBuf).extract(c).png().toBuffer()
    // Compose before|after side by side on a checker so alpha is legible.
    const W = c.width, H = c.height
    const combo = await sharp({
      create: { width: W * 2 + 12, height: H, channels: 4, background: { r: 40, g: 40, b: 48, alpha: 255 } },
    }).composite([{ input: b, left: 0, top: 0 }, { input: a, left: W + 12, top: 0 }]).png().toBuffer()
    const outPath = path.join(outDir, `keyline-${frame}-${tag}.png`)
    fs.writeFileSync(outPath, combo)
    console.log(`wrote ${outPath}  (left=un-inked  right=inked, 1:1)`)
  }
}
main().catch((e) => { console.error(e); process.exit(1) })
