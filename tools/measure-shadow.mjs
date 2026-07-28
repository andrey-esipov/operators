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

// Re-install the frozen state with P1 at height Hcm and the given mutation flags,
// then step (dt=0, so the sprite/uTime are identical to the baseline).
async function setHeight(Hcm, { nolift = false, centroid = false, off = false } = {}) {
  await page.evaluate(({ Hcm, nolift, centroid, off }) => {
    const c = globalThis.__SHADOW_FROZEN__
    c.fighters[0].pos.y = Hcm
    c.fighters[0].grounded = Hcm === 0
    c.fighters[0].stance = Hcm === 0 ? 'idle' : 'jump-fall'
    globalThis.__MUT_SHADOW_NOLIFT__ = nolift ? 1 : 0
    globalThis.__MUT_SHADOW_CENTROID__ = centroid ? 1 : 0
    globalThis.__MUT_SHADOW_OFF__ = off ? 1 : 0
    window.__FIGHT__.step(2, 0)
  }, { Hcm, nolift, centroid, off })
}

async function setShadowOff(off) {
  await page.evaluate((off) => {
    globalThis.__MUT_SHADOW_OFF__ = off ? 1 : 0
    window.__FIGHT__.step(1, 0)
  }, off)
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

// Column darkness profile D(x) = luma(shadowOFF) − luma(shadowON), averaged over
// the floor strip rows, restricted to a horizontal window around P1's ground x.
async function darknessProfile(geo) {
  const halfW = Math.round(geo.pxPerWorld * 2.3) // ±2.3 world units ≈ ±122cm
  const x0 = Math.max(0, Math.round(geo.fgx - halfW))
  const x1 = Math.min(geo.W, Math.round(geo.fgx + halfW))
  const y0 = Math.max(0, Math.round(geo.fgy - geo.H * 0.05))
  const y1 = Math.min(geo.H, Math.round(geo.fgy + geo.H * 0.11))
  const region = { left: x0, top: y0, width: x1 - x0, height: y1 - y0 }

  await setShadowOff(true)
  const offShot = await guardedShot()
  await setShadowOff(false)
  const onShot = await guardedShot()

  const off = await sharp(offShot.buf).extract(region).raw().toBuffer({ resolveWithObject: true })
  const on = await sharp(onShot.buf).extract(region).raw().toBuffer({ resolveWithObject: true })
  const ch = off.info.channels, w = off.info.width, h = off.info.height
  const D = new Float64Array(w)
  for (let x = 0; x < w; x++) {
    let s = 0
    for (let y = 0; y < h; y++) {
      const i = (y * w + x) * ch
      const lOff = (off.data[i] + off.data[i + 1] + off.data[i + 2]) / 3
      const lOn = (on.data[i] + on.data[i + 1] + on.data[i + 2]) / 3
      s += lOff - lOn // positive where the shadow darkened the floor
    }
    D[x] = s / h
  }
  return { D, region, x0, centerCol: geo.fgx - x0, offBuf: offShot.buf, onBuf: onShot.buf,
    offLuma: offShot.luma, onLuma: onShot.luma, retakes: offShot.retakes + onShot.retakes }
}

// Extent (columns darkened past a threshold), depth (max darkening), integral.
function stats(D, thr = 8) {
  let extent = 0, depth = 0, integral = 0
  for (const d of D) { if (d > thr) extent++; if (d > depth) depth = d; if (d > 0) integral += d }
  return { extent, depth: +depth.toFixed(1), integral: +integral.toFixed(0) }
}

// Anchoring read: is the darkest column at the CENTRE (centroid blob) or are there
// two cores straddling the centre with a lighter valley between (support points)?
function anchoring(D, geo, centerCol) {
  // Centre column corresponding to the fighter's ground centroid within the strip.
  const c = Math.round(centerCol)
  const band = Math.max(3, Math.round(geo.pxPerWorld * 0.18)) // ±~10cm around centre
  let centerVal = 0, cn = 0
  for (let x = c - band; x <= c + band; x++) { if (x >= 0 && x < D.length) { centerVal += D[x]; cn++ } }
  centerVal /= Math.max(1, cn)
  // Peaks on each side, kept clear of the centre band.
  let peakL = 0, peakLx = -1, peakR = 0, peakRx = -1
  for (let x = 0; x < c - band; x++) if (D[x] > peakL) { peakL = D[x]; peakLx = x }
  for (let x = c + band + 1; x < D.length; x++) if (D[x] > peakR) { peakR = D[x]; peakRx = x }
  const minPeak = Math.min(peakL, peakR)
  const valleyRatio = minPeak > 0 ? centerVal / minPeak : 99
  return {
    centerVal: +centerVal.toFixed(1),
    peakL: +peakL.toFixed(1), peakR: +peakR.toFixed(1),
    peakLoffCm: +(((peakLx - c) / geo.pxPerWorld) * (180 / 3.4)).toFixed(0),
    peakRoffCm: +(((peakRx - c) / geo.pxPerWorld) * (180 / 3.4)).toFixed(0),
    valleyRatio: +valleyRatio.toFixed(2),
  }
}

// Save a native-1:1 annotated crop (a red hairline at the centroid) for the eye.
async function saveCrop(buf, geo, name) {
  const halfW = Math.round(geo.pxPerWorld * 2.3)
  const x0 = Math.max(0, Math.round(geo.fgx - halfW))
  const x1 = Math.min(geo.W, Math.round(geo.fgx + halfW))
  const y0 = Math.max(0, Math.round(geo.fgy - geo.H * 0.14))
  const y1 = Math.min(geo.H, Math.round(geo.fgy + geo.H * 0.13))
  const region = { left: x0, top: y0, width: x1 - x0, height: y1 - y0 }
  const cxInCrop = Math.round(geo.fgx - x0)
  const line = Buffer.from(
    `<svg width="${region.width}" height="${region.height}">
       <line x1="${cxInCrop}" y1="0" x2="${cxInCrop}" y2="${region.height}" stroke="red" stroke-width="1" opacity="0.7"/>
     </svg>`)
  await sharp(buf).extract(region)
    .composite([{ input: line, top: 0, left: 0 }])
    .toFile(`${OUT}/${name}.png`)
}

console.log(`contact-shadow probe @ ${TARGET_URL}  (DPR 2)  build ${SHA}`)
const geo = await setup()
console.log(`geo: W=${geo.W} H=${geo.H} fgx=${geo.fgx.toFixed(0)} fgy=${geo.fgy.toFixed(0)} pxPerWorld=${geo.pxPerWorld.toFixed(1)}`)
const inFrame = geo.fgx > 0 && geo.fgx < geo.W && geo.fgy > 0 && geo.fgy < geo.H
if (!inFrame) { console.log('FAILED: P1 ground point not in frame'); await browser.close(); process.exit(1) }

const report = { build: SHA, url: TARGET_URL, geo, configs: {}, verdicts: {}, errors }

// ---- Grounded (normal): anchoring + as the height baseline --------------------
await setHeight(0)
const gnd = await darknessProfile(geo)
await saveCrop(gnd.onBuf, geo, 'grounded_on')
await saveCrop(gnd.offBuf, geo, 'grounded_off')
report.configs.grounded = { ...stats(gnd.D), anchor: anchoring(gnd.D, geo, gnd.centerCol), retakes: gnd.retakes }

// ---- Grounded #2 (control): same config again → the instrument's own noise -----
await setHeight(0)
const gnd2 = await darknessProfile(geo)
report.configs.grounded2 = { ...stats(gnd2.D), retakes: gnd2.retakes }

// ---- Airborne apex (normal): must shrink + soften -----------------------------
const APEX = 155 // ≈ lift 0.96
await setHeight(APEX)
const air = await darknessProfile(geo)
await saveCrop(air.onBuf, geo, 'airborne_on')
report.configs.airborne = { ...stats(air.D), retakes: air.retakes }

// ---- Airborne apex (MUTANT __MUT_SHADOW_NOLIFT__): height response must vanish -
await setHeight(APEX, { nolift: true })
const airNL = await darknessProfile(geo)
await saveCrop(airNL.onBuf, geo, 'airborne_nolift_on')
report.configs.airborne_nolift = { ...stats(airNL.D), retakes: airNL.retakes }

// ---- Grounded (MUTANT __MUT_SHADOW_CENTROID__): anchoring must invert ----------
await setHeight(0, { centroid: true })
const gndC = await darknessProfile(geo)
await saveCrop(gndC.onBuf, geo, 'grounded_centroid_on')
report.configs.grounded_centroid = { ...stats(gndC.D), anchor: anchoring(gndC.D, geo, gndC.centerCol), retakes: gndC.retakes }
// reset flags
await setHeight(0)

// ================= verdicts =================
const g = report.configs.grounded, g2 = report.configs.grounded2
const aC = report.configs.airborne, aNL = report.configs.airborne_nolift
const gC = report.configs.grounded_centroid

// (A) ANCHORING — two cores under the feet, valley at the centroid.
const anchorPass = g.anchor.valleyRatio <= 0.7 && g.anchor.peakL > 10 && g.anchor.peakR > 10 &&
  g.anchor.peakLoffCm < -3 && g.anchor.peakRoffCm > 3
const anchorMutInverts = gC.anchor.valleyRatio >= 0.9 // centre is (near) the darkest → not a valley
report.verdicts.anchoring = {
  pass: anchorPass, mutantInverts: anchorMutInverts,
  detail: `grounded valleyRatio=${g.anchor.valleyRatio} (center=${g.anchor.centerVal} vs peaks L=${g.anchor.peakL}@${g.anchor.peakLoffCm}cm R=${g.anchor.peakR}@${g.anchor.peakRoffCm}cm); centroid-mutant valleyRatio=${gC.anchor.valleyRatio}`,
}

// (B) HEIGHT RESPONSE — airborne shrinks (extent) and softens (depth) vs grounded.
const extentRatio = g.extent > 0 ? aC.extent / g.extent : 99
const depthRatio = g.depth > 0 ? aC.depth / g.depth : 99
const ctrlExtentRatio = g.extent > 0 ? g2.extent / g.extent : 99
const nlExtentRatio = g.extent > 0 ? aNL.extent / g.extent : 99
const heightPass = extentRatio <= 0.85 && depthRatio <= 0.85
const controlOk = ctrlExtentRatio >= 0.9 && ctrlExtentRatio <= 1.1
const heightMutFlattens = nlExtentRatio >= 0.9 // NOLIFT airborne ≈ grounded extent
report.verdicts.height = {
  pass: heightPass, controlOk, mutantFlattens: heightMutFlattens,
  detail: `extent g=${g.extent} air=${aC.extent} (ratio ${extentRatio.toFixed(2)}); depth g=${g.depth} air=${aC.depth} (ratio ${depthRatio.toFixed(2)}); control g2/g extent=${ctrlExtentRatio.toFixed(2)}; NOLIFT air/g extent=${nlExtentRatio.toFixed(2)}`,
}

writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2))

console.log('\n--- CONFIGS (D = floor darkening, luma; strip under P1) ---')
for (const [k, v] of Object.entries(report.configs))
  console.log(`  ${k.padEnd(18)} extent=${String(v.extent).padStart(3)}  depth=${String(v.depth).padStart(5)}  integral=${String(v.integral).padStart(5)}${v.anchor ? `  valleyRatio=${v.anchor.valleyRatio} (c=${v.anchor.centerVal} L=${v.anchor.peakL} R=${v.anchor.peakR})` : ''}`)

console.log('\n--- VERDICTS ---')
console.log(`  ANCHORING: ${report.verdicts.anchoring.pass ? 'PASS' : '*** FAIL'}  (centroid-mutant inverts: ${anchorMutInverts ? 'yes' : '*** NO'})`)
console.log(`    ${report.verdicts.anchoring.detail}`)
console.log(`  HEIGHT:    ${report.verdicts.height.pass ? 'PASS' : '*** FAIL'}  (control ok: ${controlOk ? 'yes' : '*** NO'}; NOLIFT flattens: ${heightMutFlattens ? 'yes' : '*** NO'})`)
console.log(`    ${report.verdicts.height.detail}`)
if (errors.length) { console.log(`\n  ${errors.length} console errors:`); for (const e of [...new Set(errors)].slice(0, 6)) console.log('    ' + e) }

const allPass = anchorPass && anchorMutInverts && heightPass && controlOk && heightMutFlattens
console.log(`\n  wrote ${OUT}/report.json + crops. OVERALL: ${allPass ? 'PASS' : '*** FAIL'}`)
await browser.close()
process.exit(allPass ? 0 : 1)
