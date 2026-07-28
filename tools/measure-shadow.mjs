// measure-shadow.mjs — NATIVE-1:1 (DPR 2) proof for the support-point contact
// shadow: (A) a dark core sits under EACH foot with a lighter gap between them
// (not one blob hovering in the leg gap), and (B) the shadow SHRINKS and SOFTENS
// as the fighter leaves the ground.
//
// WHY this exists: the old contact shadow was a single radial ellipse whose dark
// core sat at the body centroid — which in a wide fighting stance is the empty
// gap BETWEEN the feet, so the darkest point touched neither sole (a contradiction
// that reads worse than the "sprite floating over the floor" absence it replaced).
// The prior height-response number (39.1 grounded vs 49.8 airborne) came from an
// uncontrolled floor-band read and is not trusted. This tool measures both claims
// under control, at native resolution, and mutation-proves each one.
//
// ISOLATION (why the numbers are the shadow and not the sprite/floor/twinkle):
// the shadow is a DARK, static decal — NOT a bright additive VFX — so it CAN be
// isolated by differencing, and the honest way to do it is to toggle the shadow
// itself. For every configuration we render the SAME frozen frame twice: once with
// the shadow hidden (DEV hook __MUT_SHADOW_OFF__) and once with it on. The sprite,
// the floor texture and the fighter pose are pixel-identical between the two (the
// sim dt is 0, so uTime does not advance), so per column the darkening
// D(x) = luma_off(x) − luma_on(x) is the shadow's contribution ALONE. The ipo-prep
// city-lights twinkle on the render clock (house rule: "pause() freezes the SIM,
// not the RENDERER"), but they live up in the buildings; the measured strip is the
// floor directly under the feet, and an OFF↔OFF control pair (captured across the
// same wall-clock gap) reports the residual twinkle/noise floor so we can show the
// shadow signal dwarfs it.
//
// CAMERA PIN: FightCamera eases to frame the fighters, so a height change would
// pan/zoom the view and change the shadow's pixel size for reasons that are NOT my
// shrink logic. After settling on the grounded config we pin the camera
// (cameraRef.update → no-op) so grounded and airborne are shot through the exact
// same lens; only the fighter's height (and thus my shadow code) changes.
//
// MUTATION PROOFS (a PASS is meaningless unless the mutant goes red):
//  · anchoring: __MUT_SHADOW_CENTROID__ collapses to a single centred blob at the
//    centroid — the exact old defect. The "centre is a valley between two foot
//    cores" assertion MUST flip to "centre is the darkest point" and FAIL.
//  · height:   __MUT_SHADOW_NOLIFT__ forces lift = 0, so airborne renders at the
//    grounded size. The "airborne extent/depth < grounded" assertion MUST collapse
//    to a ~1.0 ratio and FAIL.
//
// The quantitative probe is backed by ANNOTATED NATIVE CROPS (grounded/airborne,
// reference line at the centroid) so the eye can confirm two cores + a light gap.
//
//   node tools/measure-shadow.mjs --port 5420 [--stage ipo-prep] [--a operator --b operator]
import { chromium } from 'playwright-core'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { execSync } from 'child_process'
import sharp from 'sharp'

const arg = (name, dflt) =>
  process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : dflt
const PORT = arg('--port', '5420')
const STAGE = arg('--stage', 'ipo-prep')
const A = arg('--a', 'operator')
const B = arg('--b', 'operator')
const OUT = arg('--out', 'shadow')
const SHA = execSync('git rev-parse --short HEAD').toString().trim()

const TARGET_URL = `http://localhost:${PORT}/?fight=1&p1=${A}&p2=${B}&stage=${STAGE}`
rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({
  headless: false,
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-angle=metal', '--window-position=4000,4000', '--hide-scrollbars'],
})
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 })
const errors = []
page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)) })

await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded' })

let ready = 0
for (let i = 0; i < 500 && ready < 10; i++) {
  let ok = false
  try {
    ok = await page.evaluate(() => {
      const r = window.__FIGHT__?.renderer
      return !!(window.__FIGHT__?.ready?.() && r && r.latest && r.latest.fighters?.length === 2)
    })
  } catch { ok = false }
  ready = ok ? ready + 1 : 0
  await page.waitForTimeout(40)
}
if (ready < 10) {
  console.log('FAILED: ?fight=1 never exposed a live renderer with a state snapshot')
  await browser.close(); process.exit(1)
}

// Freeze both fighters idle+grounded, spaced wide enough that P2's shadow never
// enters P1's floor strip, then settle + PIN the camera. Returns the geometry of
// P1's ground point projected to screen (stable for the rest of the run).
async function setup() {
  return page.evaluate(() => {
    const r = window.__FIGHT__.renderer
    const clone = structuredClone(r.latest)
    clone.phase = 'fight'; clone.phaseTimer = 9999; clone.hitstop = 0; clone.superFreeze = 0
    const P1 = clone.fighters[0], P2 = clone.fighters[1]
    // Wide spacing so P2 (and its shadow) sits well outside P1's measured strip.
    P1.pos.x = -95; P1.pos.y = 0; P1.facing = 1; P1.stance = 'idle'; P1.grounded = true
    P1.vel.x = 0; P1.vel.y = 0; P1.stunRemaining = 0; P1.move = undefined
    P2.pos.x = 190; P2.pos.y = 0; P2.facing = -1; P2.stance = 'idle'; P2.grounded = true
    P2.vel.x = 0; P2.vel.y = 0; P2.stunRemaining = 0; P2.move = undefined
    globalThis.__SHADOW_FROZEN__ = clone
    r.setStep(() => ({ state: structuredClone(globalThis.__SHADOW_FROZEN__), events: [] }))
    window.__FIGHT__.pause()
    window.__FIGHT__.step(60) // settle the camera onto the grounded config
    // PIN: freeze the camera so height changes cannot pan/zoom the view.
    r.cameraRef.update = () => {}
    const canvas = r.engine.renderer.domElement
    const W = canvas.width, H = canvas.height
    const cam = r.engine.camera
    // Project P1's ground point (feet at y=0) and a +1-unit x reference for scale.
    const proj = (x, y) => {
      const v = r.fighter(0).mesh.position.clone(); v.set(x, y, 0); v.project(cam)
      return { x: (v.x * 0.5 + 0.5) * W, y: (-v.y * 0.5 + 0.5) * H }
    }
    const fx = r.fighter(0).mesh.position.x
    const g0 = proj(fx, 0)
    const gx1 = proj(fx + 1, 0)
    const pxPerWorld = Math.abs(gx1.x - g0.x)
    return { W, H, fgx: g0.x, fgy: g0.y, pxPerWorld, fx }
  })
}

// Re-install the frozen state with P1 at height Hcm and the given mutation flags.
// Changing the POSE needs a real-dt step: the renderer only pulls a fresh sim
// state when its fixed-step accumulator crosses one frame (FightRenderer._advance),
// so step(n, 0) would re-draw the OLD pose forever. The step callback returns a
// constant frozen clone regardless of dt, so a real-dt step advances no physics —
// it just latches the new pose. Within a config we then difference at dt=0, where
// the shadow-off flag is still honoured (it is read every render draw), so the
// the off/on pair shares one uTime.
async function setHeight(Hcm, { nolift = false, centroid = false, off = false } = {}) {
  await page.evaluate(({ Hcm, nolift, centroid, off }) => {
    const c = globalThis.__SHADOW_FROZEN__
    c.fighters[0].pos.y = Hcm
    c.fighters[0].grounded = Hcm === 0
    c.fighters[0].stance = Hcm === 0 ? 'idle' : 'jump-fall'
    globalThis.__MUT_SHADOW_NOLIFT__ = nolift ? 1 : 0
    globalThis.__MUT_SHADOW_CENTROID__ = centroid ? 1 : 0
    globalThis.__MUT_SHADOW_OFF__ = off ? 1 : 0
    window.__FIGHT__.step(4) // real-dt: latch the new pose into `latest` (prev+latest)
  }, { Hcm, nolift, centroid, off })
}

async function setShadowOff(off) {
  await page.evaluate((off) => {
    globalThis.__MUT_SHADOW_OFF__ = off ? 1 : 0
    window.__FIGHT__.step(1, 0)
  }, off)
}

// Measurement-only monkeypatch (no source change): hide P1's sprite quad and P2
// entirely so the contact shadow renders UNOCCLUDED (the sprite draws at
// renderOrder 10 over the shadow at 5, hiding the darkest part directly under each
// sole) and nothing else casts into P1's floor strip. The shadow stamps are
// separate meshes positioned from the sim state, so hiding the sprite does not
// move or resize them — it only stops the sprite painting over them.
async function setSpriteHidden(hidden) {
  await page.evaluate((hidden) => {
    const r = window.__FIGHT__.renderer
    r.fighter(0).mesh.visible = !hidden
    r.fighter(1).group.visible = !hidden
    window.__FIGHT__.step(1, 0)
  }, hidden)
}

async function stageLuma(buf) {
  const meta = await sharp(buf).metadata()
  const { data, info } = await sharp(buf)
    .extract({ left: 0, top: Math.round(meta.height * 0.14), width: meta.width, height: Math.round(meta.height * 0.6) })
    .resize(120).raw().toBuffer({ resolveWithObject: true })
  let sum = 0
  const n = data.length / info.channels
  for (let i = 0; i < data.length; i += info.channels) sum += (data[i] + data[i + 1] + data[i + 2]) / 3
  return sum / n
}

async function guardedShot() {
  let buf = await page.screenshot()
  let luma = await stageLuma(buf)
  let retakes = 0
  while (luma < 12 && retakes < 5) {
    retakes++
    await page.evaluate(() => window.__FIGHT__.step(1, 0))
    buf = await page.screenshot()
    luma = await stageLuma(buf)
  }
  return { buf, luma, retakes }
}

// The horizontal footprint of the shadow, isolated by differencing the SAME frozen
// frame with the shadow off vs on. Per column, D(x) = Σ_rows (luma_off − luma_on):
// the total darkening the shadow adds in that column. Because off and on differ
// ONLY in the shadow (sprite hidden, sim dt 0), the floor patchwork cancels. The
// stage twinkle runs on the render clock (it does NOT freeze at dt 0), so to prove
// it is not what we are measuring we capture a THIRD frame, off again, across the
// same wall-clock gap: N(x) = Σ_rows (luma_off − luma_off2) is the pure render-clock
// noise floor in this exact strip. A real shadow makes peak(D) ≫ peak(N).
async function shadowFootprint(geo) {
  const halfW = Math.round(geo.pxPerWorld * 2.3) // ±2.3 world units ≈ ±122cm
  const x0 = Math.max(0, Math.round(geo.fgx - halfW))
  const x1 = Math.min(geo.W, Math.round(geo.fgx + halfW))
  const y0 = Math.max(0, Math.round(geo.fgy - geo.H * 0.11))
  const y1 = Math.min(geo.H, Math.round(geo.fgy + geo.H * 0.06))
  const region = { left: x0, top: y0, width: x1 - x0, height: y1 - y0 }

  await setShadowOff(true)
  const offShot = await guardedShot()
  await setShadowOff(false)
  const onShot = await guardedShot()
  await setShadowOff(true)
  const off2Shot = await guardedShot() // noise-floor control, same wall-clock gap

  const off = await sharp(offShot.buf).extract(region).raw().toBuffer({ resolveWithObject: true })
  const on = await sharp(onShot.buf).extract(region).raw().toBuffer({ resolveWithObject: true })
  const off2 = await sharp(off2Shot.buf).extract(region).raw().toBuffer({ resolveWithObject: true })
  const ch = off.info.channels, w = off.info.width, h = off.info.height
  const lum = (buf, i) => (buf[i] + buf[i + 1] + buf[i + 2]) / 3
  const D = new Float64Array(w)
  const A = new Float64Array(w) // floor-normalised: Σ(off−on)/Σ(off) ⇒ pure shadow alpha
  const N = new Float64Array(w)
  let peak = 0, noisePeak = 0
  for (let x = 0; x < w; x++) {
    let s = 0, n = 0, floor = 0
    for (let y = 0; y < h; y++) {
      const i = (y * w + x) * ch
      const lo = lum(off.data, i)
      s += lo - lum(on.data, i)   // shadow darkening
      floor += lo                 // floor brightness in this column
      n += Math.abs(lo - lum(off2.data, i)) // render-clock jitter
    }
    D[x] = s; N[x] = n
    // Alpha = fraction of the floor the shadow removes. Dividing by the column's own
    // brightness cancels the stage's dark/bright floor stripes, which otherwise carve
    // FALSE valleys into a single wide blob (D = floorLuma × alpha) and can make a
    // centroid blob masquerade as two cores. Scaled ×1000 for integer readability.
    A[x] = floor > 1 ? (s / floor) * 1000 : 0
    if (s > peak) peak = s
    if (n > noisePeak) noisePeak = n
  }
  return { D, A, N, peak, noisePeak, region, x0, centerCol: geo.fgx - x0,
    offBuf: offShot.buf, onBuf: onShot.buf,
    retakes: offShot.retakes + onShot.retakes + off2Shot.retakes }
}

function stats(D, thr) {
  let extent = 0, depth = 0, integral = 0
  for (const d of D) { if (d > thr) extent++; if (d > depth) depth = d; if (d > 0) integral += d }
  return { extent, depth: +depth.toFixed(0), integral: +integral.toFixed(0) }
}

// Anchor-agnostic core count by TOPOGRAPHIC PROMINENCE on a smoothed profile:
// does the footprint have TWO real cores with a genuine gap (support points), or
// ONE hump (a centroid blob)? Naive "two peaks + low valley" is fooled by a thin
// noise notch inside a single wide ellipse, so we (1) smooth D over ~30cm to erase
// notches thinner than a foot, (2) take local maxima ≥ 0.30·max, then (3) accept a
// peak only if it is separated from every taller accepted peak by a valley that
// drops below 0.55·min(pair) — real prominence, the standard hill-vs-hill test.
function coreProfile(D, geo) {
  const cmPx = geo.pxPerWorld / (180 / 3.4) // px per cm
  const win = Math.max(5, Math.round(cmPx * 10)) // ~10cm smoothing: kills pixel noise,
  // preserves a real foot-to-foot gap (≈60cm) and the floor's own texture is already
  // divided out (we run this on the normalised alpha profile A, not raw D).
  const n = D.length
  const S = new Float64Array(n)
  for (let x = 0; x < n; x++) {
    let s = 0, c = 0
    for (let k = -win; k <= win; k++) { const j = x + k; if (j >= 0 && j < n) { s += D[j]; c++ } }
    S[x] = s / c
  }
  let gmax = 0
  for (const v of S) if (v > gmax) gmax = v
  const floor = 0.30 * gmax
  // Local maxima above the floor.
  const maxima = []
  for (let x = 1; x < n - 1; x++) if (S[x] >= floor && S[x] >= S[x - 1] && S[x] > S[x + 1]) maxima.push(x)
  maxima.sort((a, b) => S[b] - S[a])
  // Greedy prominence acceptance.
  const accepted = []
  for (const cand of maxima) {
    let isProminent = true
    for (const acc of accepted) {
      const lo = Math.min(cand, acc), hi = Math.max(cand, acc)
      let valley = Infinity
      for (let x = lo; x <= hi; x++) if (S[x] < valley) valley = S[x]
      if (valley > 0.55 * Math.min(S[cand], S[acc])) { isProminent = false; break } // same hump
    }
    if (isProminent) accepted.push(cand)
  }
  accepted.sort((a, b) => S[b] - S[a])
  const top = accepted.slice(0, 2).sort((a, b) => a - b)
  const gapCm = top.length === 2 ? ((top[1] - top[0]) / cmPx) : 0
  const nCores = accepted.length
  // Two support points ⇔ two prominent cores of COMPARABLE mass a real foot-width
  // apart. A single centred blob smooths to ONE hump (nCores 1); if floor residue
  // leaves a faint second bump it is small (ratio ≪ 0.5) and gets rejected here.
  const secondRatio = accepted.length >= 2 ? +(S[accepted[1]] / S[accepted[0]]).toFixed(2) : 0
  const bimodal = nCores >= 2 && gapCm >= 35 && secondRatio >= 0.5
  return {
    nCores, coreGapCm: +gapCm.toFixed(0), secondRatio,
    peaks: accepted.slice(0, 3).map((x) => +S[x].toFixed(0)),
    bimodal,
  }
}

// Amplified difference image (off − on, ×AMP) over the footprint box: a direct look
// at the shadow alone. Two bright cores + dark gap = support points; one central
// blob = the centroid defect; smaller/fainter = airborne.
async function saveDiff(offBuf, onBuf, region, name, amp = 10) {
  const off = await sharp(offBuf).extract(region).raw().toBuffer({ resolveWithObject: true })
  const on = await sharp(onBuf).extract(region).raw().toBuffer({ resolveWithObject: true })
  const ch = off.info.channels, w = off.info.width, h = off.info.height
  const out = Buffer.alloc(w * h * 3)
  for (let p = 0, s = 0; p < w * h; p++, s += ch) {
    const dl = ((off.data[s] + off.data[s + 1] + off.data[s + 2]) - (on.data[s] + on.data[s + 1] + on.data[s + 2])) / 3
    const v = Math.max(0, Math.min(255, dl * amp))
    out[p * 3] = v; out[p * 3 + 1] = v; out[p * 3 + 2] = v
  }
  await sharp(out, { raw: { width: w, height: h, channels: 3 } }).png().toFile(`${OUT}/${name}.png`)
}

// Native-1:1 annotated crop WITH the sprite visible (red hairline at the centroid)
// so the eye can confirm cores under the real feet.
async function saveHumanCrop(geo, name) {
  await setSpriteHidden(false)
  await setShadowOff(false)
  const shot = await guardedShot()
  const halfW = Math.round(geo.pxPerWorld * 2.3)
  const x0 = Math.max(0, Math.round(geo.fgx - halfW))
  const x1 = Math.min(geo.W, Math.round(geo.fgx + halfW))
  const y0 = Math.max(0, Math.round(geo.fgy - geo.H * 0.30))
  const y1 = Math.min(geo.H, Math.round(geo.fgy + geo.H * 0.05))
  const region = { left: x0, top: y0, width: x1 - x0, height: y1 - y0 }
  const cxInCrop = Math.round(geo.fgx - x0)
  const line = Buffer.from(
    `<svg width="${region.width}" height="${region.height}">
       <line x1="${cxInCrop}" y1="0" x2="${cxInCrop}" y2="${region.height}" stroke="red" stroke-width="1" opacity="0.7"/>
     </svg>`)
  await sharp(shot.buf).extract(region).composite([{ input: line, top: 0, left: 0 }]).toFile(`${OUT}/${name}.png`)
  await setSpriteHidden(true)
}

console.log(`contact-shadow probe @ ${TARGET_URL}  (DPR 2)  build ${SHA}`)
const geo = await setup()
console.log(`geo: W=${geo.W} H=${geo.H} fgx=${geo.fgx.toFixed(0)} fgy=${geo.fgy.toFixed(0)} pxPerWorld=${geo.pxPerWorld.toFixed(1)}`)
const inFrame = geo.fgx > 0 && geo.fgx < geo.W && geo.fgy > 0 && geo.fgy < geo.H
if (!inFrame) { console.log('FAILED: P1 ground point not in frame'); await browser.close(); process.exit(1) }

const report = { build: SHA, url: TARGET_URL, geo, configs: {}, verdicts: {}, errors }

// Human-facing crops first, WITH the sprite, so the eye can vet the cores.
await setHeight(0)
await saveHumanCrop(geo, 'human_grounded')
await setHeight(155)
await saveHumanCrop(geo, 'human_airborne')

// All quantitative captures run with the sprite hidden (unoccluded shadow).
await setSpriteHidden(true)

// ---- Grounded (normal): anchoring + isolation ---------------------------------
// Idle stance (frame 3), both soles planted wide → the two-support-point case.
await setHeight(0)
const gnd = await shadowFootprint(geo)
await saveDiff(gnd.offBuf, gnd.onBuf, gnd.region, 'diff_grounded')
const THR = Math.max(60, gnd.peak * 0.22) // fixed for every config (floor is identical)
report.configs.grounded = { ...stats(gnd.D, THR), peak: +gnd.peak.toFixed(0), noisePeak: +gnd.noisePeak.toFixed(0), bimod: coreProfile(gnd.A, geo), retakes: gnd.retakes }

// ---- Grounded #2 (control): same config again → the instrument's own noise -----
await setHeight(0)
const gnd2 = await shadowFootprint(geo)
report.configs.grounded2 = { ...stats(gnd2.D, THR), peak: +gnd2.peak.toFixed(0), retakes: gnd2.retakes }

// ---- HEIGHT: three heights of the SAME jump-fall pose (frame 18) ---------------
// The grounded idle stance and the airborne jump-fall stance are DIFFERENT frames
// with different contacts landing on different floor luma, so grounded-vs-airborne
// would confound lift with pose. To isolate lift alone we hold ONE pose (jump-fall,
// frame 18) and vary only height: 60cm (lift≈.37), 155cm apex (lift≈.96), and 155cm
// with the lift MUTANT forced off (renders as if grounded). Same pose ⇒ same floor
// patch ⇒ the only thing that moves is the height response.
const APEX = 155 // ≈ lift 0.96
await setHeight(APEX)
const air = await shadowFootprint(geo)
await saveDiff(air.offBuf, air.onBuf, air.region, 'diff_airborne')
report.configs.airborne = { ...stats(air.D, THR), peak: +air.peak.toFixed(0), retakes: air.retakes }

const MID = 60 // ≈ lift 0.37 — same jump-fall pose, lower → shadow must be stronger
await setHeight(MID)
const mid = await shadowFootprint(geo)
await saveDiff(mid.offBuf, mid.onBuf, mid.region, 'diff_mid')
report.configs.mid60 = { ...stats(mid.D, THR), peak: +mid.peak.toFixed(0), retakes: mid.retakes }

// ---- Airborne apex (MUTANT __MUT_SHADOW_NOLIFT__): height response must vanish -
// Same frame-18 pose as `airborne`, lift forced to 0 → the apex shadow should snap
// back to full grounded strength. This is the red-team control for HEIGHT.
await setHeight(APEX, { nolift: true })
const airNL = await shadowFootprint(geo)
await saveDiff(airNL.offBuf, airNL.onBuf, airNL.region, 'diff_airborne_nolift')
report.configs.airborne_nolift = { ...stats(airNL.D, THR), peak: +airNL.peak.toFixed(0), retakes: airNL.retakes }

// ---- Grounded (MUTANT __MUT_SHADOW_CENTROID__): anchoring must invert ----------
await setHeight(0, { centroid: true })
const gndC = await shadowFootprint(geo)
await saveDiff(gndC.offBuf, gndC.onBuf, gndC.region, 'diff_grounded_centroid')
report.configs.grounded_centroid = { ...stats(gndC.D, THR), peak: +gndC.peak.toFixed(0), bimod: coreProfile(gndC.A, geo), retakes: gndC.retakes }
await setHeight(0) // reset flags

report.threshold = +THR.toFixed(0)

// ================= verdicts =================
const g = report.configs.grounded, g2 = report.configs.grounded2
const aC = report.configs.airborne, aMID = report.configs.mid60, aNL = report.configs.airborne_nolift
const gC = report.configs.grounded_centroid

// (0) ISOLATION — the shadow signal must dwarf the render-clock noise floor in the
// same strip, or the "darkening" could just be city-light twinkle.
const snr = g.noisePeak > 0 ? g.peak / g.noisePeak : 99
const isolationOk = snr >= 3 && g.peak > 200
report.verdicts.isolation = {
  pass: isolationOk,
  detail: `grounded shadow peak=${g.peak} vs off↔off noise peak=${g.noisePeak} (SNR ${snr.toFixed(1)}x, same wall-clock gap)`,
}

// (A) ANCHORING — two cores with a lighter gap (support points), not one blob.
const anchorPass = g.bimod.bimodal
const anchorMutInverts = !gC.bimod.bimodal // centroid blob must NOT read as bimodal
report.verdicts.anchoring = {
  pass: anchorPass, mutantInverts: anchorMutInverts,
  detail: `grounded: ${g.bimod.nCores} cores ${g.bimod.coreGapCm}cm apart, peaks=[${g.bimod.peaks}] → bimodal=${g.bimod.bimodal}; centroid-mutant: ${gC.bimod.nCores} cores ${gC.bimod.coreGapCm}cm, peaks=[${gC.bimod.peaks}] → bimodal=${gC.bimod.bimodal}`,
}

// (B) HEIGHT RESPONSE — all three configs are the SAME jump-fall pose (frame 18) at
// different heights, so lift is the only variable. Two independent assertions:
//   1. graded/monotonic: apex(155) < mid(60) < nolift(≈0) in both depth AND extent —
//      the shadow strengthens as the fighter descends.
//   2. lift is the cause (mutation): the real apex is a small fraction of the SAME
//      pose with lift forced off; if my lift code were a no-op they'd be equal.
const depthShrink = aNL.depth > 0 ? aC.depth / aNL.depth : 99   // apex vs same-pose no-lift
const extentShrink = aNL.extent > 0 ? aC.extent / aNL.extent : 99
const ctrlExtentRatio = g.extent > 0 ? g2.extent / g.extent : 99
const gradedDepth = aC.depth < aMID.depth && aMID.depth < aNL.depth
const gradedExtent = aC.extent <= aMID.extent && aMID.extent <= aNL.extent
const heightPass = gradedDepth && gradedExtent && depthShrink <= 0.4 && extentShrink <= 0.6
const controlOk = ctrlExtentRatio >= 0.85 && ctrlExtentRatio <= 1.15
const heightMutFlattens = aNL.depth >= 3 * Math.max(1, aC.depth) // lift OFF ⇒ apex ≈ grounded
report.verdicts.height = {
  pass: heightPass, controlOk, mutantFlattens: heightMutFlattens,
  detail: `same jump-fall pose — depth apex=${aC.depth} mid=${aMID.depth} nolift=${aNL.depth}; extent apex=${aC.extent} mid=${aMID.extent} nolift=${aNL.extent}; apex/nolift depth=${depthShrink.toFixed(3)} extent=${extentShrink.toFixed(3)}; graded=${gradedDepth && gradedExtent}; instrument control g2/g extent=${ctrlExtentRatio.toFixed(2)}`,
}

writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2))

// TEMP DEBUG: downsampled raw profiles to eyeball core structure.
{
  const ds = (D, bins = 90) => { const out = []; const step = D.length / bins; for (let b = 0; b < bins; b++) { let m = 0; for (let i = Math.floor(b * step); i < Math.floor((b + 1) * step); i++) if (D[i] > m) m = D[i]; out.push(Math.round(m)) } return out }
  writeFileSync(`${OUT}/profiles.json`, JSON.stringify({ grounded: ds(gnd.A), centroid: ds(gndC.A), mid: ds(mid.A), airborne: ds(air.A), grounded_D: ds(gnd.D), centroid_D: ds(gndC.D) }, null, 0))
}

console.log(`\n--- CONFIGS (D = Σrows floor darkening; strip under P1; THR=${report.threshold}) ---`)
for (const [k, v] of Object.entries(report.configs))
  console.log(`  ${k.padEnd(18)} extent=${String(v.extent).padStart(3)}  depth=${String(v.depth).padStart(5)}  integral=${String(v.integral).padStart(6)}  peak=${String(v.peak).padStart(5)}${v.bimod ? `  ${v.bimod.nCores}cores@${v.bimod.coreGapCm}cm peaks=[${v.bimod.peaks}] bimodal=${v.bimod.bimodal}` : ''}`)

console.log('\n--- VERDICTS ---')
console.log(`  ISOLATION: ${report.verdicts.isolation.pass ? 'PASS' : '*** FAIL'}`)
console.log(`    ${report.verdicts.isolation.detail}`)
console.log(`  ANCHORING: ${report.verdicts.anchoring.pass ? 'PASS' : '*** FAIL'}  (centroid-mutant inverts: ${anchorMutInverts ? 'yes' : '*** NO'})`)
console.log(`    ${report.verdicts.anchoring.detail}`)
console.log(`  HEIGHT:    ${report.verdicts.height.pass ? 'PASS' : '*** FAIL'}  (control ok: ${controlOk ? 'yes' : '*** NO'}; NOLIFT flattens: ${heightMutFlattens ? 'yes' : '*** NO'})`)
console.log(`    ${report.verdicts.height.detail}`)
if (errors.length) { console.log(`\n  ${errors.length} console errors:`); for (const e of [...new Set(errors)].slice(0, 6)) console.log('    ' + e) }

const allPass = isolationOk && anchorPass && anchorMutInverts && heightPass && controlOk && heightMutFlattens
console.log(`\n  wrote ${OUT}/report.json + crops. OVERALL: ${allPass ? 'PASS' : '*** FAIL'}`)
await browser.close()
process.exit(allPass ? 0 : 1)
