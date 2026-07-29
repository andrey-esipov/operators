/**
 * Mechanical acceptance gate for generated pose cels — run over a staged
 * generation BEFORE any cel is packed into a shipping atlas, and BEFORE a human
 * looks at the art. It answers the one question the in-loop `validateFrame`
 * structurally cannot: is the pose in the RIGHT STANCE?
 *
 * WHY THIS EXISTS (the gap it closes)
 * ----------------------------------
 * The generation loop already runs `validateFrame` and auto-regenerates on a
 * fail, so every staged cel has passed identity / density / enclosed-hole /
 * anchor-drift. But `validateFrame`'s signature is `Pick<FrameSpec,'name'|
 * 'aspect'>` — it never sees `heightRatio`. So a *standing* figure drawn for a
 * *crouch* cel sails through identity/density/holes and is then SQUASHED to
 * crouch height at registration. That is exactly half of the defect Tier C was
 * funded to fix: `cr.LK`/`cr.MK` currently borrow standing `lk-active`/
 * `mk-active`, and `j.MK` borrows a grounded cel mid-air. Paying gpt-image-2 to
 * make a standing pose *smoother* for a crouching move spends money on the wrong
 * frame. This gate rejects it mechanically so that can't happen unseen at 125
 * images.
 *
 * THE CHECKS (all mechanical; no PNG is read by a human)
 * ------------------------------------------------------
 *  stance   For a CROUCH attack cel, the silhouette height (measured on the raw
 *           1024 gen, BEFORE registration squashes it) divided by the fighter's
 *           own stance height must be <= CROUCH_MAX_H. A standing figure
 *           measures ~0.95-1.00; a real crouch measures ~0.65-0.81 (see
 *           calibration below). The boundary sits in the empty gap between them.
 *  airborne For a JUMPING attack cel, the feet must clear the floor: the
 *           transparent band below the silhouette, as a fraction of body height,
 *           must be >= AIR_MIN_GAP. A grounded standing kick measures ~0.05; a
 *           real airborne pose measures 0.12-0.67.
 *  identity Composed from the pipeline's own state.json — the cel must have
 *           `passed` validateFrame during generation (identity cosine, density,
 *           enclosed-hole alpha cleanliness, anchor drift). Surfaced here so one
 *           report covers the whole bar, not just stance.
 *
 * CALIBRATION (measured against all 51 accepted chesky cels, this repo, HEAD)
 * --------------------------------------------------------------------------
 *   observed height ratio: real crouch cels  crouch 0.76 / crouch-2 0.81 /
 *                          block-crouch 0.65  ->  max 0.81
 *                          standing kicks     mk-active 0.998 / lk-active 0.947 /
 *                          hk-active 0.995    ->  min 0.947
 *                          => clean gap 0.81 .. 0.947; boundary CROUCH_MAX_H=0.85
 *   footGapFrac:           real jump cels     0.12 .. 0.67
 *                          standing kicks     mk-active 0.048 / lk-active 0.072
 *                          => boundary AIR_MIN_GAP=0.11
 * Both boundaries have margin on BOTH sides, so the gate neither false-rejects
 * real art nor admits the borrowed-stance failure mode. Re-run `--selftest` if
 * the roster's proportions change; it re-proves both boundaries from live cels.
 *
 * USAGE
 * -----
 *   npx tsx scripts/accept-poses.mts <fighterId> [--dir <rawDir>] [--cels a,b,c]
 *   npx tsx scripts/accept-poses.mts <fighterId> --selftest
 *     --selftest  proves the gate against existing accepted cels + mutation-
 *                 proves it catches a standing pose fed as a crouch/air cel.
 *                 Requires no generated art, so it runs before a cent is spent.
 *
 * Exit codes: 0 all checked cels accepted; 1 a cel was rejected OR nothing was
 * checked (a vacuous pass is a gate failure — every gate must prove it looked at
 * something; this project has caught two lying harnesses that iterated 0 rows).
 */
import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { removeFlatBackground, findAnchor } from './lib/sprite-pipeline'
import { FRAMES, type FrameSpec } from './lib/frame-spec'
import type { FighterSummary } from './generate-animation-set'

/** Silhouette height / stance height at or below which a cel reads as a crouch.
 *  Real crouches top out at 0.81, standing bottoms out at 0.947 (see header). */
const CROUCH_MAX_H = 0.85
/** Transparent band below the feet, as a fraction of body height, at or above
 *  which a cel reads as airborne. Standing kicks sit at ~0.05; jumps at 0.12+. */
const AIR_MIN_GAP = 0.11

export type StanceClass = 'crouch' | 'air' | 'standing'

/** Classify a cel's REQUIRED stance from its name. Precise per-family patterns,
 *  NOT a bare prefix: `cr[lmh][pk]` catches crlk/crmk/crhp… but not `crouch`;
 *  `j[lmh][pk]` catches jlk/jmk… but not `jump`/`juggle`. New Tier-C attack cels
 *  follow these names, so classification is unambiguous. */
export function stanceClass(name: string): StanceClass {
  if (/^cr[lmh][pk](-|$)/.test(name)) return 'crouch'
  if (/^j[lmh][pk](-|$)/.test(name)) return 'air'
  return 'standing'
}

export interface CelMeasure {
  /** silhouette height / stance height, on the raw gen (pre-registration) */
  heightRatio: number
  /** transparent band below the feet / body height */
  footGapFrac: number
  /** opaque fraction of the silhouette bbox — a coarse density/continuity read */
  coverage: number
}

/** Measure the raw gen against the fighter's stance. All primitives are the
 *  pipeline's own (`removeFlatBackground` + `findAnchor`), so this can never
 *  drift from how the pipeline itself sees a silhouette. */
export async function measureCel(rawBuf: Buffer, stanceHeight: number): Promise<CelMeasure> {
  const seg = await removeFlatBackground(rawBuf)
  const a = await findAnchor(seg)
  const meta = await sharp(seg).metadata()
  const canvasH = meta.height ?? 0
  // coverage: opaque pixels inside the bbox / bbox area
  const { data, info } = await sharp(seg).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  let opaque = 0
  for (let y = a.top; y <= a.bottom; y++) {
    for (let x = a.left; x <= a.right; x++) {
      if (data[(y * info.width + x) * 4 + 3] > 16) opaque++
    }
  }
  const bboxArea = Math.max(1, (a.right - a.left + 1) * (a.bottom - a.top + 1))
  return {
    heightRatio: a.height / stanceHeight,
    footGapFrac: (canvasH - a.bottom) / Math.max(1, a.height),
    coverage: opaque / bboxArea,
  }
}

export interface Verdict {
  name: string
  cls: StanceClass
  ok: boolean
  reasons: string[]
  m: CelMeasure
}

/** Apply the calibrated stance/air thresholds to a measurement. Pure — takes
 *  numbers, returns a verdict — so the self-test can mutation-prove it without
 *  touching disk. */
export function judgeStance(name: string, cls: StanceClass, m: CelMeasure): Verdict {
  const reasons: string[] = []
  if (cls === 'crouch' && m.heightRatio > CROUCH_MAX_H) {
    reasons.push(
      `crouch pose too tall: height ratio ${m.heightRatio.toFixed(3)} > ${CROUCH_MAX_H} ` +
        `— a standing figure drawn for a crouch cel (it will be squashed at registration)`,
    )
  }
  if (cls === 'air' && m.footGapFrac < AIR_MIN_GAP) {
    reasons.push(
      `air pose grounded: foot gap ${m.footGapFrac.toFixed(3)} < ${AIR_MIN_GAP} ` +
        `— feet are on the floor for an airborne cel`,
    )
  }
  return { name, cls, ok: reasons.length === 0, reasons, m }
}

function readState(id: string): FighterSummary | null {
  const p = path.resolve('.sprite-gen', id, 'state.json')
  if (!fs.existsSync(p)) return null
  return JSON.parse(fs.readFileSync(p, 'utf8')) as FighterSummary
}

async function stanceHeightOf(id: string): Promise<number> {
  const stanceRaw = fs.readFileSync(path.resolve('public/sprites', id, 'stance.png'))
  const a = await findAnchor(await removeFlatBackground(stanceRaw))
  return a.height
}

/** Check a concrete set of staged cels on disk. Returns verdicts; the caller
 *  decides the exit code. */
export async function acceptCels(
  id: string,
  rawDir: string,
  celNames: string[],
): Promise<Verdict[]> {
  const stanceH = await stanceHeightOf(id)
  const state = readState(id)
  const passedByName = new Map((state?.frames ?? []).map((f) => [f.name, f]))
  const out: Verdict[] = []
  for (const name of celNames) {
    const raw = path.join(rawDir, `${name}.png`)
    if (!fs.existsSync(raw)) {
      out.push({ name, cls: stanceClass(name), ok: false, reasons: [`missing raw ${raw}`], m: { heightRatio: 0, footGapFrac: 0, coverage: 0 } })
      continue
    }
    const cls = stanceClass(name)
    const m = await measureCel(fs.readFileSync(raw), stanceH)
    const v = judgeStance(name, cls, m)
    // Compose the pipeline's own identity/alpha verdict, if we have it.
    const st = passedByName.get(name)
    if (st && !st.passed) v.reasons.push(`pipeline validateFrame rejected: ${st.rejects.join('; ')}`), (v.ok = false)
    out.push(v)
  }
  return out
}

function printTable(vs: Verdict[]): void {
  console.log('\ncel                cls       hRatio  footGap  cover   verdict')
  for (const v of vs) {
    const tag = v.ok ? 'ACCEPT' : 'REJECT'
    console.log(
      `  ${v.name.padEnd(18)} ${v.cls.padEnd(9)} ${v.m.heightRatio.toFixed(3)}   ${v.m.footGapFrac.toFixed(3)}   ${v.m.coverage.toFixed(3)}   ${tag}`,
    )
    for (const r of v.reasons) console.log(`      ↳ ${r}`)
  }
}

/** Prove the gate before any art exists: (1) every real crouch/air cel passes
 *  its own class (no false-reject), (2) mutation — a standing cel fed as a
 *  crouch AND as an air cel is rejected. Prints before/after so a silent no-op
 *  mutation can't fake a green. */
async function selftest(id: string): Promise<number> {
  const stanceH = await stanceHeightOf(id)
  const rawDir = path.resolve('.sprite-gen', id, 'raw')
  const measure = async (name: string) => measureCel(fs.readFileSync(path.join(rawDir, `${name}.png`)), stanceH)

  // Real cels, mapped to the stance they actually are.
  const realCrouch = ['crouch', 'crouch-2', 'block-crouch']
  const realAir = ['jump-rise', 'jump-rise-2', 'jump-apex', 'jump-fall', 'jump-land']
  const standingProbe = 'mk-active' // the exact cel cr.MK currently borrows

  let fail = 0
  let checked = 0
  console.log('=== calibration: real cels must pass their own class ===')
  for (const n of realCrouch) {
    const m = await measure(n)
    const v = judgeStance(n, 'crouch', m)
    checked++
    if (!v.ok) fail++
    console.log(`  crouch  ${n.padEnd(14)} hRatio ${m.heightRatio.toFixed(3)}  -> ${v.ok ? 'ACCEPT' : 'REJECT ' + v.reasons[0]}`)
  }
  for (const n of realAir) {
    const m = await measure(n)
    const v = judgeStance(n, 'air', m)
    checked++
    if (!v.ok) fail++
    console.log(`  air     ${n.padEnd(14)} footGap ${m.footGapFrac.toFixed(3)}  -> ${v.ok ? 'ACCEPT' : 'REJECT ' + v.reasons[0]}`)
  }

  console.log('\n=== mutation: a STANDING cel fed as crouch/air MUST reject ===')
  const sm = await measure(standingProbe)
  const asCrouch = judgeStance(standingProbe, 'crouch', sm)
  const asAir = judgeStance(standingProbe, 'air', sm)
  console.log(`  ${standingProbe} measured: hRatio ${sm.heightRatio.toFixed(3)} (crouch bar <= ${CROUCH_MAX_H}), footGap ${sm.footGapFrac.toFixed(3)} (air bar >= ${AIR_MIN_GAP})`)
  console.log(`  fed as crouch -> ${asCrouch.ok ? 'ACCEPT (BUG!)' : 'REJECT (correct)'}${asCrouch.ok ? '' : ' :: ' + asCrouch.reasons[0]}`)
  console.log(`  fed as air    -> ${asAir.ok ? 'ACCEPT (BUG!)' : 'REJECT (correct)'}${asAir.ok ? '' : ' :: ' + asAir.reasons[0]}`)
  checked += 2
  if (asCrouch.ok) fail++ // mutation must red
  if (asAir.ok) fail++

  if (checked === 0) {
    console.error('VACUOUS: self-test checked 0 cels'); return 1
  }
  console.log(`\nself-test: ${checked} checks, ${fail} unexpected outcome(s)`) 
  return fail === 0 ? 0 : 1
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const id = argv.find((a) => !a.startsWith('--'))
  if (!id) {
    console.error('usage: accept-poses <fighterId> [--dir <rawDir>] [--cels a,b,c] | --selftest')
    process.exit(2)
  }
  if (argv.includes('--selftest')) {
    process.exit(await selftest(id))
  }
  const dirArg = argv[argv.indexOf('--dir') + 1]
  const rawDir = argv.includes('--dir') ? path.resolve(dirArg) : path.resolve('.sprite-gen', id, 'raw')
  const celsArg = argv[argv.indexOf('--cels') + 1]
  const cels = argv.includes('--cels')
    ? celsArg.split(',').map((s) => s.trim()).filter(Boolean)
    : FRAMES.map((f: FrameSpec) => f.name).filter((n) => stanceClass(n) !== 'standing')

  if (cels.length === 0) {
    console.error('VACUOUS: 0 cels selected to check — refusing to report a green over nothing')
    process.exit(1)
  }
  const verdicts = await acceptCels(id, rawDir, cels)
  printTable(verdicts)
  const rejected = verdicts.filter((v) => !v.ok)
  console.log(`\naccept-poses: checked ${verdicts.length} cel(s), ${rejected.length} rejected`)
  process.exit(rejected.length === 0 ? 1 - 1 : 1) // 0 all-accept, 1 any-reject
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
