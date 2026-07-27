/**
 * Generate one fighter's full animation set, end to end.
 *
 * Reads the fighter's stance sprite, generates every frame in the spec off
 * that one reference (so identity can't drift down a sequence), validates each
 * one, regenerates the failures, then segments, registers, packs an atlas and
 * writes the `FighterAssets` JSON plus review artefacts.
 *
 * Resumable by construction. Every accepted raw generation is cached under
 * .sprite-gen/<id>/raw and a state.json records each frame's metrics. A rerun
 * reuses cached raws (re-running only the cheap local segmentation/packing),
 * so a batch that dies at fighter 30 costs nothing to resume, and a frame that
 * was accepted never pays for regeneration twice.
 *
 *   npx tsx scripts/generate-animation-set.ts chesky
 *   npx tsx scripts/generate-animation-set.ts chesky --force   # ignore cache
 */
import fs from 'node:fs'
import path from 'node:path'
import { editPose, removeFlatBackground, registerFrame, findAnchor, mapLimit } from './lib/sprite-pipeline'
import {
  FRAMES,
  STANCE_FRAME,
  buildPrompt,
  type FrameSpec,
} from './lib/frame-spec'
import { referenceHistogram, validateFrame, type ValidationResult } from './lib/sprite-validate'
import { packAtlas, assertAnchorsPreserved, type RegisteredFrame } from './lib/atlas'
import { contactSheet, clipFilmstrip, previewHtml, FILMSTRIP_CLIPS, type RegMap } from './lib/preview'
import { clipApng } from './lib/apng'

// Shared registration frame, matching the probe. A 512 canvas with the feet at
// (256, 470) and a 380px neutral height leaves headroom above for a jump and
// to the sides for a full roundhouse without clipping.
const CANVAS = 512
const TARGET_H = 380
const ORIGIN = { x: 256, y: 470 }
const DEFAULT_HEIGHT_CM = 180
const MAX_ATTEMPTS = 3
const CONCURRENCY = 2

export interface FrameOutcome {
  name: string
  attempts: number
  passed: boolean
  fromCache: boolean
  rejects: string[]
  warnings: string[]
  metrics: ValidationResult['metrics']
}

export interface FighterSummary {
  id: string
  frames: FrameOutcome[]
  generated: number
  reused: number
  regenerations: number
  failedFrames: string[]
  missingFrames: string[]
  warnedFrames: string[]
  atlasSize: { width: number; height: number }
  anchorsOk: boolean
  ms: number
}

function score(r: ValidationResult): number {
  // Rank candidate generations when none pass: reward identity, penalise a
  // background that survived segmentation.
  return r.metrics.identity - Math.max(0, r.metrics.density - 82) * 0.02
}

async function segReg(raw: Buffer, spec: Pick<FrameSpec, 'heightRatio'>) {
  const seg = await removeFlatBackground(raw)
  const reg = await registerFrame(seg, {
    canvasW: CANVAS,
    canvasH: CANVAS,
    targetHeight: TARGET_H,
    originX: ORIGIN.x,
    originY: ORIGIN.y,
    heightRatio: spec.heightRatio,
  })
  return { seg, reg }
}

export async function generateFighter(
  id: string,
  opts: { force?: boolean; offline?: boolean; heightCm?: number; publicDir?: string; log?: (s: string) => void } = {},
): Promise<FighterSummary> {
  const log = opts.log ?? ((s: string) => console.log(s))
  const t0 = Date.now()

  const stancePath = path.resolve(process.cwd(), 'public/sprites', id, 'stance.png')
  if (!fs.existsSync(stancePath)) throw new Error(`no stance sprite for ${id}`)
  const stance = fs.readFileSync(stancePath)

  const cacheDir = path.resolve(process.cwd(), '.sprite-gen', id)
  const rawDir = path.join(cacheDir, 'raw')
  fs.mkdirSync(rawDir, { recursive: true })

  const outDir = path.resolve(process.cwd(), opts.publicDir ?? 'public/fighters', id)
  const reviewDir = path.join(outDir, 'review')
  fs.mkdirSync(reviewDir, { recursive: true })

  // Reference histogram from the segmented stance — the identity ground truth.
  const stanceSeg = await removeFlatBackground(stance)
  const refHist = await referenceHistogram(stanceSeg)

  // Frame 0 is the untouched stance; it is always on-model, no generation.
  const stanceReg = await registerFrame(stanceSeg, {
    canvasW: CANVAS, canvasH: CANVAS, targetHeight: TARGET_H,
    originX: ORIGIN.x, originY: ORIGIN.y, heightRatio: 1,
  })

  const registered: RegisteredFrame[] = [{ name: STANCE_FRAME, buf: stanceReg, origin: ORIGIN }]
  const regMap: RegMap = new Map([[STANCE_FRAME, { buf: stanceReg, w: CANVAS, h: CANVAS }]])
  const outcomes: FrameOutcome[] = [{
    name: STANCE_FRAME, attempts: 0, passed: true, fromCache: true,
    rejects: [], warnings: [], metrics: { identity: 1, density: 0, coverage: 0, aspect: 0, footDrift: 0, bottomDrift: 0, holeFrac: 0 },
  }]

  let generated = 0, reused = 0, regenerations = 0
  const missing: string[] = []

  const results = await mapLimit(FRAMES, CONCURRENCY, async (spec) => {
    const rawPath = path.join(rawDir, `${spec.name}.png`)
    let best: { raw: Buffer; result: ValidationResult; reg: Buffer } | null = null
    let attempts = 0
    let fromCache = false
    let genError: string | null = null

    // Try the cache first (unless forced), then generate up to MAX_ATTEMPTS.
    for (let round = 0; round < MAX_ATTEMPTS; round++) {
      let raw: Buffer
      if (round === 0 && !opts.force && fs.existsSync(rawPath)) {
        raw = fs.readFileSync(rawPath)
        fromCache = true
      } else if (opts.offline) {
        // Offline: never touch the API. With no cache there is nothing to do,
        // so leave the frame missing (it degrades to a dropped clip, not a hole
        // in an existing one) and move on.
        break
      } else {
        try {
          raw = await editPose(stance, buildPrompt(spec.pose), { label: `${id}/${spec.name}` })
        } catch (e) {
          // A safety-system 400 (or an exhausted retry budget) must not sink the
          // whole fighter — that is how a single blocked pose previously wiped an
          // entire roster entry. Record it, keep whatever best we already have,
          // and let the atlas packer drop any clip that ends up short a frame.
          genError = (e as Error).message.split('\n')[0].slice(0, 120)
          log(`    ${spec.name}: generation error — ${genError}`)
          break
        }
        attempts++
        fromCache = false
        if (round > 0) regenerations++
      }
      const { seg, reg } = await segReg(raw, spec)
      const result = await validateFrame(seg, reg, refHist, spec, ORIGIN)
      if (!best || score(result) > score(best.result)) best = { raw, result, reg }
      if (result.passed) break
      log(`    ${spec.name}: reject (${result.rejects.join('; ')})${round < MAX_ATTEMPTS - 1 ? ' — regenerating' : ' — keeping best'}`)
    }

    if (best) {
      // Persist the best raw so a resume never regenerates it.
      fs.writeFileSync(rawPath, best.raw)
      if (fromCache && best.result.passed) reused++
      else generated++
    }

    return { spec, best, attempts, fromCache, genError }
  })

  for (const r of results) {
    if (!r.best) {
      missing.push(r.spec.name)
      outcomes.push({
        name: r.spec.name,
        attempts: r.attempts,
        passed: false,
        fromCache: false,
        rejects: [r.genError ? `generation failed: ${r.genError}` : 'no cache (offline)'],
        warnings: [],
        metrics: { identity: 0, density: 0, coverage: 0, aspect: 0, footDrift: 0, bottomDrift: 0, holeFrac: 0 },
      })
      continue
    }
    registered.push({ name: r.spec.name, buf: r.best.reg, origin: ORIGIN })
    regMap.set(r.spec.name, { buf: r.best.reg, w: CANVAS, h: CANVAS })
    outcomes.push({
      name: r.spec.name,
      attempts: r.attempts,
      passed: r.best.result.passed,
      fromCache: r.fromCache,
      rejects: r.best.result.rejects,
      warnings: r.best.result.warnings,
      metrics: r.best.result.metrics,
    })
  }
  if (missing.length) log(`  MISSING (dropped from atlas): ${missing.join(', ')}`)

  // Pack the atlas and prove the anchors survived the trim.
  const atlasHref = `/fighters/${id}/atlas.png`
  const { atlas, assets } = await packAtlas(id, atlasHref, registered, opts.heightCm ?? DEFAULT_HEIGHT_CM)
  const meta = await import('sharp').then((m) => m.default(atlas).metadata())
  const anchorCheck = await assertAnchorsPreserved(atlas, assets)
  if (!anchorCheck.ok) log(`  ANCHOR WARNINGS:\n    ${anchorCheck.report.join('\n    ')}`)

  fs.writeFileSync(path.join(outDir, 'atlas.png'), atlas)
  fs.writeFileSync(path.join(outDir, 'assets.json'), JSON.stringify(assets, null, 2))

  // Review artefacts.
  const sheet = await contactSheet(
    registered.map((r) => ({ name: r.name, buf: r.buf })),
    180,
    8,
  )
  fs.writeFileSync(path.join(reviewDir, 'contact-sheet.png'), sheet)
  for (const clip of FILMSTRIP_CLIPS) {
    const strip = await clipFilmstrip(clip, regMap, 180)
    if (strip) fs.writeFileSync(path.join(reviewDir, `filmstrip-${clip}.png`), strip)
  }
  // Animated APNG per clip — the artefact that actually reveals motion quality
  // (a hitchy walk, a punch that skips) without opening the game. Skip the sim
  // move-id aliases (they contain a dot) so we render each unique clip once.
  let anims = 0
  for (const clipName of Object.keys(assets.clips)) {
    if (clipName.includes('.')) continue
    const buf = await clipApng(atlas, assets, clipName)
    if (buf) { fs.writeFileSync(path.join(reviewDir, `anim-${clipName}.png`), buf); anims++ }
  }
  log(`  wrote ${anims} animated previews`)
  // The preview lives beside the atlas; reference it relatively so the folder
  // is portable.
  fs.writeFileSync(path.join(reviewDir, 'preview.html'), previewHtml(assets, '../atlas.png'))

  const summary: FighterSummary = {
    id,
    frames: outcomes,
    generated,
    reused,
    regenerations,
    failedFrames: outcomes.filter((o) => !o.passed).map((o) => o.name),
    missingFrames: missing,
    warnedFrames: outcomes.filter((o) => o.warnings.length).map((o) => o.name),
    atlasSize: { width: meta.width ?? 0, height: meta.height ?? 0 },
    anchorsOk: anchorCheck.ok,
    ms: Date.now() - t0,
  }
  fs.writeFileSync(path.join(cacheDir, 'state.json'), JSON.stringify(summary, null, 2))
  return summary
}

function printSummary(s: FighterSummary) {
  console.log(`\n=== ${s.id} ===`)
  console.log(`  frames: ${s.frames.length}  generated: ${s.generated}  reused: ${s.reused}  regenerations: ${s.regenerations}`)
  console.log(`  atlas: ${s.atlasSize.width}x${s.atlasSize.height}  anchors: ${s.anchorsOk ? 'OK' : 'DRIFT'}  time: ${(s.ms / 1000).toFixed(0)}s`)
  if (s.failedFrames.length) console.log(`  FAILED (kept best): ${s.failedFrames.join(', ')}`)
  if (s.missingFrames.length) console.log(`  MISSING (dropped): ${s.missingFrames.join(', ')}`)
  if (s.warnedFrames.length) console.log(`  warnings (review): ${s.warnedFrames.join(', ')}`)
}

async function main() {
  const id = process.argv[2]
  if (!id || id.startsWith('--')) throw new Error('usage: generate-animation-set.ts <fighterId> [--force] [--offline]')
  const force = process.argv.includes('--force')
  const offline = process.argv.includes('--offline')
  const s = await generateFighter(id, { force, offline })
  printSummary(s)
  console.log(`\nwrote public/fighters/${id}/{atlas.png, assets.json, review/}`)
}

// Only run as a CLI, not when imported by the batch driver.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(e); process.exit(1) })
}
