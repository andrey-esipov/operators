// Targeted single-frame generator: generate ONE named frame for a fighter via
// the exact edit-from-stance -> segment -> register -> validate path the full
// generator uses (identity + foot-drift gating, retry up to MAX_ATTEMPTS), and
// cache the accepted raw. Used to add just idle-4 to the shallow trio so the
// idle breathing loop unlocks, without regenerating the other density keys.
//   npx tsx scripts/gen-frame.ts <fighterId> <frameName>
import fs from 'fs'
import path from 'path'
import { editPose, removeFlatBackground, registerFrame } from './lib/sprite-pipeline'
import { referenceHistogram, validateFrame } from './lib/sprite-validate'
import { FRAMES, buildPrompt } from './lib/frame-spec'

const SCALE = 2
const CANVAS = 512 * SCALE
const TARGET_H = 380 * SCALE
const ORIGIN = { x: 256 * SCALE, y: 470 * SCALE }
const DRIFT_TOL = 2.5 * SCALE
const MAX_ATTEMPTS = 3

async function segReg(raw: Buffer, heightRatio?: number) {
  const seg = await removeFlatBackground(raw)
  const reg = await registerFrame(seg, {
    canvasW: CANVAS, canvasH: CANVAS, targetHeight: TARGET_H,
    originX: ORIGIN.x, originY: ORIGIN.y, heightRatio,
  })
  return { seg, reg }
}

async function main() {
  const id = process.argv[2]
  const frameNames = process.argv.slice(3)
  if (!id || frameNames.length === 0) throw new Error('usage: gen-frame.ts <fighterId> <frameName...>')

  const stancePath = path.resolve('public/sprites', id, 'stance.png')
  const stance = fs.readFileSync(stancePath)
  const rawDir = path.resolve('.sprite-gen', id, 'raw')
  fs.mkdirSync(rawDir, { recursive: true })

  const stanceSeg = await removeFlatBackground(stance)
  const refHist = await referenceHistogram(stanceSeg)

  for (const frameName of frameNames) {
    const spec = FRAMES.find((f) => f.name === frameName)
    if (!spec) { console.log(`  ${id}/${frameName}: NO SPEC — skipped`); continue }
    const rawPath = path.join(rawDir, `${spec.name}.png`)

    let best: { raw: Buffer; passed: boolean; rejects: string[]; drift: number } | null = null
    for (let round = 0; round < MAX_ATTEMPTS; round++) {
      const raw = await editPose(stance, buildPrompt(spec.pose), { label: `${id}/${spec.name}` })
      const { seg, reg } = await segReg(raw, spec.heightRatio)
      const result = await validateFrame(seg, reg, refHist, spec, ORIGIN, { driftTol: DRIFT_TOL })
      const cand = { raw, passed: result.passed, rejects: result.rejects, drift: result.metrics.footDrift }
      if (!best || (cand.passed && !best.passed)) best = cand
      console.log(`  ${id}/${spec.name} attempt ${round + 1}: ${result.passed ? 'PASS' : 'reject ' + result.rejects.join('; ')} (footDrift ${result.metrics.footDrift.toFixed(1)}px)`)
      if (result.passed) break
    }
    if (best) {
      fs.writeFileSync(rawPath, best.raw)
      console.log(`  -> cached ${rawPath}  passed=${best.passed}`)
    }
  }
}
main()
