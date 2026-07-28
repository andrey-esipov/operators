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
  TWEENS,
  buildPrompt,
  CLIPS,
  type FrameSpec,
} from './lib/frame-spec'
import { referenceHistogram, validateFrame, type ValidationResult } from './lib/sprite-validate'
import { packAtlas, assertAnchorsPreserved, type RegisteredFrame } from './lib/atlas'
import { attackTimingForSkin } from './lib/fighter-timing'
import { contactSheet, clipFilmstrip, previewHtml, FILMSTRIP_CLIPS, type RegMap } from './lib/preview'
import { clipApng } from './lib/apng'
import { morph } from './lib/inbetween'
import { analyzeClip, type TemporalReport } from './lib/temporal'
import { toRGBA, fromRGBA, applyKeyline, thinFeatureSurvival } from './lib/keyline'
import { coverageAA, edgeSmoothness, interiorSharpness } from './lib/edge-aa'

// Shared registration frame, matching the probe. A 512 canvas with the feet at
// (256, 470) and a 380px neutral height leaves headroom above for a jump and
// to the sides for a full roundhouse without clipping.
//
// SCALE authors every frame at a multiple of that base. The gpt-image-2 source is
// 1024px and the segmented character stands ~940px tall in it, so a 1x (380px)
// cell throws away ~2.5x of real detail and reads as a 4x upscale on a retina
// display. SCALE=2 (760px cell) recovers that detail at ~1:1 with the source and
// still fits a single <=8192 atlas per fighter, staying inside the single-`atlas`
// FighterAssets contract. The renderer is resolution-independent — it derives
// world size from heightCm / refFrame.rect.h — so 2x pixels render at the same
// world size with twice the detail, no renderer change.
const SCALE = 2
const CANVAS = 512 * SCALE
const TARGET_H = 380 * SCALE
const ORIGIN = { x: 256 * SCALE, y: 470 * SCALE }
// Foot/bottom drift is measured in pixels, so its tolerance scales with SCALE.
const DRIFT_TOL = 2.5 * SCALE
// Keyline: a constant-weight ink rim so the sprite reads as drawn, not cut out.
// Band ~1.5 screen px at the authored 2x, features narrower than ~8px are "thin"
// and protected from being inked away (the mic boom, fingers).
const KEYLINE_BAND = 1.5 * SCALE
const KEYLINE_DARKEN = 0.34
const KEYLINE_THIN_RADIUS = 2 * SCALE
// Coverage-AA: soften the hard binary silhouette into a ~1px ramp. Guarded so a
// frame is only accepted if its interior stays at least this fraction as sharp.
const AA_MIN_INTERIOR_RATIO = 0.85
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
  temporalWarnings: string[]
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
      const result = await validateFrame(seg, reg, refHist, spec, ORIGIN, { driftTol: DRIFT_TOL })
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

  // ── Inbetweens ────────────────────────────────────────────────────────────
  // Synthesise each tween by flow-morphing its two neighbour keys (free, local,
  // deterministic). Skip any whose endpoints didn't survive generation — the
  // clip packer then drops the incomplete clip rather than point at a hole.
  let tweens = 0
  for (const tw of TWEENS) {
    const a = regMap.get(tw.from)
    const b = regMap.get(tw.to)
    if (!a || !b) continue
    try {
      const buf = await morph(a.buf, b.buf, tw.t, { flowRes: 128 })
      // A tween skips registration, so derive its foot anchor straight from its
      // own pixels (same bottom-band centroid the atlas check re-derives) rather
      // than assuming the shared ORIGIN — otherwise the stored anchor wouldn't
      // match the morphed feet and the renderer would ground it a few px off.
      const fa = await findAnchor(buf)
      const origin = { x: fa.footX, y: fa.bottom + 1 }
      registered.push({ name: tw.name, buf, origin })
      regMap.set(tw.name, { buf, w: CANVAS, h: CANVAS })
      tweens++
    } catch (e) {
      log(`    tween ${tw.name}: morph failed — ${(e as Error).message.split('\n')[0]}`)
    }
  }
  if (tweens) log(`  synthesised ${tweens} inbetween frame(s)`)

  // ── Keyline + coverage AA ────────────────────────────────────────────────
  // Two edge passes, once per frame, sharing a single RGBA round-trip:
  //   1. Keyline bakes a constant-weight ink rim so the silhouette reads as
  //      drawn, not cut out. Guarded by the thin-feature probe — if inking would
  //      eat a mic boom / fingers, the frame keeps its un-inked pixels.
  //   2. Coverage AA softens the hard binary silhouette into a ~1px ramp so the
  //      edge stops stair-stepping at native 1:1. It only ramps alpha and pulls
  //      the edge colour outward (never blurs interior RGB), guarded by the
  //      interior-sharpness probe so it can never mush the art. Runs AFTER the
  //      keyline so the ramp is inked-edge coloured, not background grey.
  // applyKeyline never touches alpha and coverageAA never touches interior RGB,
  // so foot anchors and the atlas trim survive both.
  let inkedFrames = 0, aaFrames = 0
  const keylineWarn: string[] = []
  const aaWarn: string[] = []
  // Tweens carry a self-derived anchor (keys are pinned to the fixed ORIGIN).
  // Since the edge passes below nudge the silhouette ~1px, re-derive each tween's
  // anchor from its FINAL pixels so the stored anchor describes what ships, not
  // the pre-edge morph — otherwise a prone tween's contact-centroid, whose
  // lower-band cutoff shifts with the ~1px height change, drifts past tolerance.
  const tweenNames = new Set(TWEENS.map((t) => t.name))
  for (const rf of registered) {
    const orig = await toRGBA(rf.buf)
    const work = { data: orig.data.slice(), width: orig.width, height: orig.height }
    let dirty = false

    applyKeyline(work, { band: KEYLINE_BAND, darken: KEYLINE_DARKEN, protectThin: true, coreDepth: KEYLINE_THIN_RADIUS })
    const surv = thinFeatureSurvival(orig, work, { thinRadius: KEYLINE_THIN_RADIUS })
    if (surv.ok) { dirty = true; inkedFrames++ }
    else {
      keylineWarn.push(`${rf.name}: thin-feature survival ${surv.survival.toFixed(2)} (bright ${surv.brightBefore}->${surv.brightAfter}) — shipped un-inked`)
      // revert keyline, keep original RGB for the AA step
      work.data.set(orig.data)
    }

    const sharpBefore = interiorSharpness(work)
    const preAA = work.data.slice()
    coverageAA(work, { radius: 1 })
    const sharpAfter = interiorSharpness(work)
    const smooth = edgeSmoothness(work).smoothness
    if (sharpAfter >= AA_MIN_INTERIOR_RATIO * sharpBefore) { dirty = true; aaFrames++ }
    else {
      aaWarn.push(`${rf.name}: interior sharpness ${sharpBefore.toFixed(3)}->${sharpAfter.toFixed(3)} (smooth ${(100 * smooth).toFixed(0)}%) — AA skipped`)
      work.data.set(preAA)
    }

    if (dirty) {
      const outBuf = await fromRGBA(work)
      rf.buf = outBuf
      const rm = regMap.get(rf.name)
      if (rm) rm.buf = outBuf
      if (tweenNames.has(rf.name)) {
        const fa = await findAnchor(outBuf)
        rf.origin = { x: fa.footX, y: fa.bottom + 1 }
      }
    }
  }
  log(`  keyline: inked ${inkedFrames}/${registered.length}  coverage-AA: ${aaFrames}/${registered.length}`)
  if (keylineWarn.length) log(`  KEYLINE (thin-feature) WARNINGS:\n    ${keylineWarn.join('\n    ')}`)
  if (aaWarn.length) log(`  AA (interior-sharpness) WARNINGS:\n    ${aaWarn.join('\n    ')}`)

  // ── Temporal coherence ────────────────────────────────────────────────────
  // Per-frame validation cannot see a stutter; measure the frame-to-frame
  // silhouette delta series of the high-traffic clips and flag any transition
  // wildly out of line with its neighbours. Warn (don't fail) — a flagged clip
  // is worth a human look, and the report records it.
  const temporalWarn: string[] = []
  for (const clipName of ['walk-fwd', 'walk-back', 'hurt', 'juggle', 'knockdown']) {
    const spec = CLIPS[clipName]
    if (!spec) continue
    const bufs = spec.frames.map((n) => regMap.get(n)?.buf).filter((b): b is Buffer => !!b)
    if (bufs.length < 3) continue
    let rep: TemporalReport
    try {
      rep = await analyzeClip(bufs)
    } catch {
      continue
    }
    if (!rep.ok) {
      const detail = rep.flags.map((f) => `${f.kind}@${f.at}(${f.delta.toFixed(3)}v${f.local.toFixed(3)})`).join(' ')
      temporalWarn.push(`${clipName}: ${detail}`)
      log(`    temporal: ${clipName} — ${detail}`)
    }
  }

  // Pack the atlas and prove the anchors survived the trim.
  const atlasHref = `/fighters/${id}/atlas.png`
  // Kick clips are laid out from this skin's archetype move timing so the
  // contact cel sits on the active window by construction (undefined for
  // unplayable card-art skins, which fall back to the static kick clips).
  const attackTiming = attackTimingForSkin(id)
  const { atlas, assets } = await packAtlas(id, atlasHref, registered, opts.heightCm ?? DEFAULT_HEIGHT_CM, attackTiming)
  const meta = await import('sharp').then((m) => m.default(atlas).metadata())
  // Anchor-preservation tolerance is pixel-absolute, so it scales with SCALE too.
  const anchorCheck = await assertAnchorsPreserved(atlas, assets, 1.5 * SCALE)
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
    temporalWarnings: temporalWarn,
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
  if (s.temporalWarnings.length) console.log(`  temporal flags: ${s.temporalWarnings.join(' | ')}`)
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
