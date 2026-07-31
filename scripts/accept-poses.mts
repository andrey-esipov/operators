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
 *  super    For a bespoke super cel (super-charge/super-release), the aspect-
 *           normalised silhouette IoU with the same-phase fireball cel must be
 *           < SUPER_MAX_FIREBALL_IOU. This is the other half of the "paid to
 *           smooth the WRONG pose" failure: visual-critic v12 measured the super
 *           as three recycled cels that "read as a fireball with a colour grade",
 *           so a generated super-release that is really a resized fireball is
 *           rejected mechanically — the super must have its own pose.
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
 *   fireball IoU:          a cel vs itself (a scaled clone)  1.000
 *                          fireball-release vs distinct poses (uppercut/hp/mp/hk)
 *                          0.31 .. 0.69  ->  max 0.69
 *                          => clean gap 0.69 .. 1.000; bar SUPER_MAX_FIREBALL_IOU=0.85
 * All three boundaries have margin on BOTH sides, so the gate neither false-
 * rejects real art nor admits the borrowed-pose failure mode. Re-run `--selftest`
 * if the roster's proportions change; it re-proves every boundary from live cels.
 *
 * USAGE
 * -----
 *   npx tsx scripts/accept-poses.mts <fighterId> [--dir <rawDir>] [--cels a,b,c]
 *   npx tsx scripts/accept-poses.mts <fighterId> --selftest
 *     --selftest  proves the gate against existing accepted cels + mutation-
 *                 proves it catches (a) a standing pose fed as a crouch/air cel
 *                 and (b) a fireball cel fed as a super release.
 *                 Requires no generated art, so it runs before a cent is spent.
 *
 * Exit codes: 0 all checked cels accepted; 1 a cel was rejected OR nothing was
 * checked (a vacuous pass is a gate failure — every gate must prove it looked at
 * something; this project has caught two lying harnesses that iterated 0 rows).
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
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
/** Aspect-normalised silhouette IoU at or above which a bespoke super cel is
 *  judged a RE-DRAW of the fireball cel of the same phase rather than its own
 *  pose — i.e. "a bigger fireball", the exact defect the super art is funded to
 *  remove (visual-critic v12: the super "reads as a fireball with a colour
 *  grade"). Both masks are scaled to fill an N×N box (see `celMask`), so pure
 *  scale/translation is normalised away and only the POSE differs. Calibrated
 *  by `--selftest` against live cels: an identical cel scores 1.0; genuinely
 *  different poses of the same character score well below this. */
const SUPER_MAX_FIREBALL_IOU = 0.85
/** Each bespoke super cel that has a same-phase fireball analog it must NOT
 *  clone. Recovery has no fireball analog and is not divergence-gated. */
const SUPER_FIREBALL_ANALOG: Record<string, string> = {
  'super-charge': 'special-fireball-charge',
  'super-release': 'special-fireball-release',
}
/** Aspect-normalised silhouette FILL RATIO (opaque cells / N²) at or above which
 *  a bespoke super cel is judged a formless BLOB/ORB rather than the figure — the
 *  "soft-disc bloom orb" the critic panned, which `impact-vfx` proved is intrinsic
 *  to the art and not the VFX (focusing the aura left the internal-structure
 *  metric flat). A limbed figure leaves gaps — between arms, between legs, around
 *  the torso — so its normalised mask is sparse; a filled disc is dense. This is
 *  the ONLY new super bar and it is deliberately ONE-DIRECTIONAL: it rejects
 *  too-solid (orb), never too-bright or too-saturated — the shipped super measured
 *  a flat 0.39% blown through freeze/travel/impact, so the super fails
 *  weak/empty/formless, NEVER "too hot"; and the pipeline's own validateFrame
 *  already floors density, so too-sparse is covered upstream. Calibrated from live
 *  references by `--selftest`: the ten most-solid chesky fighter cels top out at
 *  0.508 (special-uppercut); a synthetic filled disc is 0.785 (π/4). 0.65 sits in
 *  that gap with ~0.14 margin on each side. */
const SUPER_MAX_SOLIDITY = 0.65

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

/** An aspect-normalised silhouette mask: the cel segmented, cropped to its
 *  bounding box, scaled to FILL an N×N box (aspect not preserved), and
 *  thresholded to 1-bit alpha. Filling the box normalises away scale and
 *  position, so two drawings of the SAME pose at different sizes map to the same
 *  mask (IoU→1) while a genuinely different pose does not. Used only to catch a
 *  super cel that is really a resized fireball. */
export async function celMask(rawBuf: Buffer, N = 64): Promise<Uint8Array> {
  const seg = await removeFlatBackground(rawBuf)
  const a = await findAnchor(seg)
  const { data, info } = await sharp(seg)
    .extract({ left: a.left, top: a.top, width: a.right - a.left + 1, height: a.bottom - a.top + 1 })
    .resize(N, N, { fit: 'fill' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const mask = new Uint8Array(N * N)
  const stride = info.width
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) mask[y * N + x] = data[(y * stride + x) * 4 + 3] > 16 ? 1 : 0
  }
  return mask
}

/** Intersection-over-union of two 1-bit masks of equal length. */
export function maskIoU(a: Uint8Array, b: Uint8Array): number {
  let inter = 0
  let uni = 0
  for (let i = 0; i < a.length; i++) {
    const x = a[i]
    const y = b[i]
    if (x || y) uni++
    if (x && y) inter++
  }
  return uni === 0 ? 0 : inter / uni
}

/** Opaque fraction of an aspect-normalised mask: a limbed figure leaves gaps and
 *  scores low; a filled disc/orb scores ~π/4. Pure so the self-test can
 *  mutation-prove the shape bar without disk. */
export function maskSolidity(m: Uint8Array): number {
  if (m.length === 0) return 0
  let on = 0
  for (let i = 0; i < m.length; i++) on += m[i]
  return on / m.length
}

/** Pure divergence verdict for a super cel: an IoU with its same-phase fireball
 *  analog at/above the bar means the pose was re-drawn from the fireball rather
 *  than given its own silhouette. Pure (takes the number) so the self-test can
 *  mutation-prove it without disk. */
export function judgeSuperDivergence(name: string, analog: string, iou: number): string | null {
  if (iou >= SUPER_MAX_FIREBALL_IOU) {
    return (
      `super cel reads as a bigger fireball: silhouette IoU ${iou.toFixed(3)} with ${analog} ` +
      `>= ${SUPER_MAX_FIREBALL_IOU} — the super must have its OWN pose, not a resized ${analog}`
    )
  }
  return null
}

/** Pure shape verdict for a super cel: a normalised fill ratio at/above the bar
 *  means the cel is a formless blob/orb, not the fighter — the exact defect the
 *  super art is funded to remove. The charge especially must read as the fighter
 *  GATHERING POWER via pose and silhouette, because its energy glow is occluded
 *  behind the fighter (renderOrder, "never erase the fighter") and the 60-frame
 *  freeze is the dominant slice of the move's screen time. Pure so the self-test
 *  can mutation-prove it without disk. */
export function judgeSuperShape(name: string, solidity: number): string | null {
  if (solidity >= SUPER_MAX_SOLIDITY) {
    return (
      `super cel reads as a formless orb, not a figure: silhouette fill ${solidity.toFixed(3)} ` +
      `>= ${SUPER_MAX_SOLIDITY} — the super must read as the fighter's POSE (its energy glow is ` +
      `occluded behind the fighter), not a soft disc of light`
    )
  }
  return null
}

export interface Verdict {
  name: string
  cls: StanceClass
  ok: boolean
  reasons: string[]
  m: CelMeasure
  /** Silhouette IoU with the same-phase fireball analog, for super cels only. */
  fireballIoU?: number
  /** Aspect-normalised silhouette fill ratio, for super cels only (anti-orb). */
  solidity?: number
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
    // Super divergence: a bespoke super cel must NOT be a resized fireball. Only
    // gated when the same-phase fireball analog is actually on disk for this skin
    // (it always is for a playable skin — the fireball cels ship first); a
    // missing analog is reported, never a silent pass.
    // Bespoke super cels get two extra, super-only bars, both funded by the
    // visual-critic verdict that the super is "formless" and "a bigger fireball":
    //  (a) SHAPE — it must read as the FIGHTER (a limbed silhouette), never a
    //      formless orb (applies to all three keys, incl. recovery); and
    //  (b) DIVERGENCE — charge/release must not be a resized fireball.
    if (/^super-/.test(name)) {
      const mask = await celMask(fs.readFileSync(raw))
      const sol = maskSolidity(mask)
      v.solidity = sol
      const shapeReason = judgeSuperShape(name, sol)
      if (shapeReason) {
        v.reasons.push(shapeReason)
        v.ok = false
      }
      // Divergence is only gated when the same-phase fireball analog is on disk
      // (it always is for a playable skin — the fireball cels ship first); a
      // missing analog is reported, never a silent pass. Recovery has no analog.
      const analog = SUPER_FIREBALL_ANALOG[name]
      if (analog) {
        const analogRaw = path.join(rawDir, `${analog}.png`)
        if (!fs.existsSync(analogRaw)) {
          v.reasons.push(`super divergence UNCHECKED: analog ${analogRaw} absent`)
          v.ok = false
        } else {
          const iou = maskIoU(mask, await celMask(fs.readFileSync(analogRaw)))
          const reason = judgeSuperDivergence(name, analog, iou)
          v.fireballIoU = iou
          if (reason) {
            v.reasons.push(reason)
            v.ok = false
          }
        }
      }
    }
    out.push(v)
  }
  return out
}

function printTable(vs: Verdict[]): void {
  console.log('\ncel                cls       hRatio  footGap  cover   fbIoU   solid   verdict')
  for (const v of vs) {
    const tag = v.ok ? 'ACCEPT' : 'REJECT'
    const fb = v.fireballIoU === undefined ? '  -  ' : v.fireballIoU.toFixed(3)
    const sol = v.solidity === undefined ? '  -  ' : v.solidity.toFixed(3)
    console.log(
      `  ${v.name.padEnd(18)} ${v.cls.padEnd(9)} ${v.m.heightRatio.toFixed(3)}   ${v.m.footGapFrac.toFixed(3)}   ${v.m.coverage.toFixed(3)}   ${fb}   ${sol}   ${tag}`,
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

  // ── Super divergence: calibrate the "not a bigger fireball" bar on live cels,
  //    then mutation-prove it in BOTH directions. Needs no generated super art —
  //    it reads only cels every playable skin already ships, so it runs before a
  //    cent is spent, exactly like the stance bars above.
  console.log('\n=== super divergence: calibrate silhouette IoU on real cels ===')
  const fbRelease = await celMask(fs.readFileSync(path.join(rawDir, 'special-fireball-release.png')))
  const fbCharge = await celMask(fs.readFileSync(path.join(rawDir, 'special-fireball-charge.png')))
  // Same-pose upper bound: a cel vs ITSELF is a perfect clone -> IoU 1.0. This is
  // the "scaled-up fireball" a generated super must never score near.
  const selfIoU = maskIoU(fbRelease, fbRelease)
  // Genuinely-different poses of the SAME character: these are what a real
  // bespoke super should look like relative to the fireball, so they MUST sit
  // below the bar (else the gate would false-reject good art).
  const diffProbes = ['special-uppercut', 'hp-active', 'mp-active', 'hk-active']
  console.log(`  clone   fireball-release vs itself           IoU ${selfIoU.toFixed(3)} (must be >= ${SUPER_MAX_FIREBALL_IOU})`)
  let maxDiff = 0
  for (const n of diffProbes) {
    const iou = maskIoU(fbRelease, await celMask(fs.readFileSync(path.join(rawDir, `${n}.png`))))
    maxDiff = Math.max(maxDiff, iou)
    checked++
    const passes = iou < SUPER_MAX_FIREBALL_IOU
    if (!passes) fail++ // a distinct pose scoring >= bar would false-reject real art
    console.log(`  differ  fireball-release vs ${n.padEnd(20)} IoU ${iou.toFixed(3)}  -> ${passes ? 'below bar (good art passes)' : 'ABOVE BAR (would false-reject!)'}`)
  }
  console.log(`  => clean gap: distinct poses top out at ${maxDiff.toFixed(3)}, bar ${SUPER_MAX_FIREBALL_IOU}, clone 1.000`)

  console.log('\n=== mutation: a fireball cel fed as a super release MUST reject ===')
  // Forward: the fireball release IS the recycled super pose — feeding it as the
  // bespoke super-release is exactly the defect being removed; must red.
  const cloneReason = judgeSuperDivergence('super-release', 'special-fireball-release', selfIoU)
  // Reverse: a genuinely different pose fed as super-release must PASS, or the
  // gate is just rejecting everything (a stuck-red harness is as blind as a
  // stuck-green one).
  const upIoU = maskIoU(fbRelease, await celMask(fs.readFileSync(path.join(rawDir, 'special-uppercut.png'))))
  const distinctReason = judgeSuperDivergence('super-release', 'special-fireball-release', upIoU)
  console.log(`  fireball-as-super  IoU ${selfIoU.toFixed(3)} -> ${cloneReason ? 'REJECT (correct)' : 'ACCEPT (BUG!)'}`)
  console.log(`  distinct-as-super  IoU ${upIoU.toFixed(3)} -> ${distinctReason ? 'REJECT (BUG!)' : 'ACCEPT (correct)'}`)
  checked += 2
  if (!cloneReason) fail++ // clone must red
  if (distinctReason) fail++ // distinct must green

  // ── Super shape: the OTHER super-only bar. A bespoke super must read as the
  //    FIGHTER (a limbed silhouette), never a formless orb — the "soft-disc
  //    bloom" the critic panned and impact-vfx proved is intrinsic to the art.
  //    Calibrate the fill-ratio bar on real cels, then mutation-prove BOTH ways.
  //    Needs no generated super art; runs before a cent is spent.
  console.log('\n=== super shape: calibrate silhouette FILL RATIO (figure vs orb) ===')
  const shapeProbes = ['special-uppercut', 'special-fireball-release', 'special-fireball-charge', 'hp-active', 'block-stand']
  let maxFig = 0
  for (const n of shapeProbes) {
    const s = maskSolidity(await celMask(fs.readFileSync(path.join(rawDir, `${n}.png`))))
    maxFig = Math.max(maxFig, s)
    checked++
    const passes = s < SUPER_MAX_SOLIDITY
    if (!passes) fail++ // a real figure scoring >= bar would false-reject good art
    console.log(`  figure  ${n.padEnd(24)} fill ${s.toFixed(3)}  -> ${passes ? 'below bar (figure passes)' : 'ABOVE BAR (would false-reject!)'}`)
  }
  // A synthetic filled disc is the orb the super must never be: π/4 ≈ 0.785.
  const DN = 64
  const disc = new Uint8Array(DN * DN)
  const dc = (DN - 1) / 2, dr = DN / 2
  for (let y = 0; y < DN; y++) for (let x = 0; x < DN; x++) if ((x - dc) ** 2 + (y - dc) ** 2 <= dr * dr) disc[y * DN + x] = 1
  const discSol = maskSolidity(disc)
  console.log(`  => clean gap: figures top out at ${maxFig.toFixed(3)}, bar ${SUPER_MAX_SOLIDITY}, filled disc ${discSol.toFixed(3)}`)

  console.log('\n=== mutation: a formless orb fed as a super MUST reject ===')
  const orbReason = judgeSuperShape('super-charge', discSol)  // orb must red
  const figReason = judgeSuperShape('super-charge', maxFig)   // densest real figure must green
  console.log(`  orb-as-super     fill ${discSol.toFixed(3)} -> ${orbReason ? 'REJECT (correct)' : 'ACCEPT (BUG!)'}`)
  console.log(`  figure-as-super  fill ${maxFig.toFixed(3)} -> ${figReason ? 'REJECT (BUG!)' : 'ACCEPT (correct)'}`)
  checked += 2
  if (!orbReason) fail++ // orb must red
  if (figReason) fail++ // figure must green

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
    : FRAMES.map((f: FrameSpec) => f.name).filter((n) => stanceClass(n) !== 'standing' || /^super-/.test(n))

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

// Only run the CLI when invoked directly (`tsx accept-poses.mts ...`), not when
// imported for its exported gate functions (measurement scripts, tests).
if (process.argv[1] != null && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
