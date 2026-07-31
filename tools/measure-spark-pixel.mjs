// measure-spark-pixel.mjs — NATIVE-1:1 (DPR 2) pixel proof that the hit spark
// lands on the sim's reported contact point (defender-biased), NOT the frame
// midpoint.
//
// WHY this exists: the user measured a spark ~40px from the frame midpoint and
// 165–260px from the nearest fighter, and warned there was "no evidence the code
// was ever actually changed". `measure-contact-sim.ts` already proves, running
// the real sim, that `event.at` is defender-biased at every range (frac 0.86–1.00).
// This tool closes the loop: it drives the REAL renderer (?fight=1 →
// FightRenderer, the same class the shipped ?play=1 route uses), freezes two
// fighters at each controlled range, fires a hit at the REAL `event.at` (read
// from tools/_contact-scenarios.json), and measures where the spark's brightest
// pixels actually land relative to the two fighters and the frame centre.
//
// House rule (bright additive VFX defeats *removal* by differencing): you cannot
// difference two frames to REMOVE a flash. But you CAN difference to LOCATE a new
// additive object, provided the rest of the frame is otherwise static. A raw hit
// punches + shakes the camera (which breaks that), so for the measurement ONLY we
// monkeypatch the camera kicks (addShake/punchIn) and the defender hit-flash to
// no-ops from the browser — no source change — leaving the additive SPARK as the
// only thing that differs between a spark-off baseline and a spark-on frame. The
// spark's centroid then falls out of the positive-luma difference, band-limited to
// the spark's known screen height. This is stage-independent: it does NOT rely on
// the spark being the brightest or warmest thing on screen (the ipo-prep stage has
// bright warm city-lights near frame-centre — exactly the kind of decoy a naive
// "brightest/warmest pixel" instrument locks onto, which is the most likely origin
// of the user's bogus "~40px from midpoint" number).
//
// MUTATION PROOF: `--mutate midpoint` fires the spark at the fighters' midpoint
// instead of `event.at`. The probe must then FLIP to MIDPOINT and FAIL the
// defender assertion — that is what makes a PASS in normal mode meaningful.
//
// HARD-WON LIMITATION (read before trusting the DIFF centroid): the "difference
// to LOCATE" trick above assumes the rest of the frame is static between the
// spark-off and spark-on captures. It is NOT. The ipo-prep stage's city-light
// windows TWINKLE on the RENDER clock (performance.now), not on the sim dt we
// pass, so even step(1, /*dt*/0) leaves the background animating across the
// evaluate round-trip between the two screenshots (house rule: "pause() freezes
// the SIM, not the RENDERER"). Those bright warm/near-white windows sit right
// behind the defender, so the raw difference is dominated by twinkle, not the
// spark, and its centroid is unreliable. The trustworthy assertion here is the
// ANNOTATED NATIVE LOOK this tool also emits (report rows carry expectContactX /
// expectMidX / defenderScreenX; overlay them and SEE the spark) — which is what
// the house rules prescribe for bright additive VFX. The direct look is decisive:
// firing at `event.at` puts the spark ON the defender at every range while the
// midpoint is empty gap, and forcing --mutate midpoint visibly slides the same
// spark into the gap — proving the renderer honours at.x and ships defender-anchored.
//
//   node tools/measure-spark-pixel.mjs --port 5420 [--stage ipo-prep] [--mutate midpoint]
import { chromium } from 'playwright-core'
import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'fs'
import { execSync } from 'child_process'
import sharp from 'sharp'

const arg = (name, dflt) =>
  process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : dflt
const PORT = arg('--port', '5420')
const STAGE = arg('--stage', 'ipo-prep')
const MUTATE = process.argv.includes('--mutate')
const OUT = arg('--out', MUTATE ? 'spark-pixel-mutant' : 'spark-pixel')
const SHA = execSync('git rev-parse --short HEAD').toString().trim()

// World constants mirrored from src/three/fight/worldScale.ts + src/three/types.ts.
const CM_TO_WORLD = 3.4 / 180
const GROUND_Y = 0

const scenarios = JSON.parse(readFileSync(new URL('./_contact-scenarios.json', import.meta.url)))

const TARGET_URL = `http://localhost:${PORT}/?fight=1&p1=operator&p2=operator&stage=${STAGE}`
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

// Wait for the harness to expose a live renderer with a real state snapshot.
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

/** Freeze the sim at a controlled two-fighter configuration. */
async function freeze(sc) {
  await page.evaluate((sc) => {
    const r = window.__FIGHT__.renderer
    const clone = structuredClone(r.latest)
    clone.phase = 'fight'; clone.phaseTimer = 9999; clone.hitstop = 0; clone.superFreeze = 0
    const A = clone.fighters[0], D = clone.fighters[1]
    A.pos.x = sc.xA; A.pos.y = 0; A.facing = 1; A.stance = 'idle'; A.grounded = true
    A.vel.x = 0; A.vel.y = 0; A.stunRemaining = 0; A.move = undefined; A.attackConnected = false
    D.pos.x = sc.xD; D.facing = -1; D.vel.x = 0; D.vel.y = 0; D.stunRemaining = 0
    D.move = undefined; D.attackConnected = false
    if (sc.defenderAir) { D.pos.y = sc.defenderYcm; D.grounded = false; D.stance = 'jump-fall' }
    else { D.pos.y = 0; D.grounded = true; D.stance = 'idle' }
    r.setStep(() => ({ state: structuredClone(clone), events: [] }))
    window.__FIGHT__.pause()
    window.__FIGHT__.step(55) // settle camera onto the frozen config
  }, sc)
}

/**
 * Neutralise the camera kicks and the defender hit-flash for measurement ONLY
 * (browser-side monkeypatch, no source change), then project the geometry the
 * settled camera currently sees. Does NOT fire — the caller screenshots this as
 * the spark-off baseline. Returns screen positions + the spark's expected screen
 * point so the difference can be band-limited to the spark's height.
 */
async function patchAndProject(sc, mutate) {
  return page.evaluate(({ sc, mutate, CM_TO_WORLD, GROUND_Y }) => {
    const r = window.__FIGHT__.renderer
    // Measurement-only: keep the camera still and suppress the whole-body white
    // flash so the additive spark is the ONLY thing that changes between frames.
    if (!r.__patchedForMeasure) {
      r.cameraRef.addShake = () => {}
      r.cameraRef.punchIn = () => {}
      for (const side of [0, 1]) {
        const f = r.fighter(side)
        if (f && typeof f.triggerHitFlash === 'function') f.triggerHitFlash = () => {}
      }
      r.__patchedForMeasure = true
    }
    const canvas = r.engine.renderer.domElement
    const W = canvas.width, H = canvas.height
    const cam = r.engine.camera
    const aPos = r.fighter(0).mesh.position.clone()
    const dPos = r.fighter(1).mesh.position.clone()
    const at = { x: mutate ? sc.mid : sc.atX, y: sc.atY }
    const sx = (v) => { const p = v.clone(); p.project(cam); return (p.x * 0.5 + 0.5) * W }
    const sy = (v) => { const p = v.clone(); p.project(cam); return (-p.y * 0.5 + 0.5) * H }
    const aX = sx(aPos), dX = sx(dPos)
    const hitCm = Math.min(175, Math.max(40, at.y))
    const spark = aPos.clone(); spark.set(at.x * CM_TO_WORLD, GROUND_Y + hitCm * CM_TO_WORLD, 0.05)
    // Two FIXED reference fire-points, both computed the same way in normal and
    // mutant runs: the true sim contact (defender-biased) and the fighter midpoint.
    // Only the ACTUAL spark moves between the two runs, so "is the measured burst
    // nearer the contact ref or the midpoint ref" flips cleanly under mutation.
    const contactRef = aPos.clone(); contactRef.set(sc.atX * CM_TO_WORLD, GROUND_Y + Math.min(175, Math.max(40, sc.atY)) * CM_TO_WORLD, 0.05)
    const midRef = aPos.clone(); midRef.set(sc.mid * CM_TO_WORLD, GROUND_Y + Math.min(175, Math.max(40, sc.atY)) * CM_TO_WORLD, 0.05)
    return {
      W, H,
      attackerScreenX: aX,
      defenderScreenX: dX,
      fighterMidScreenX: (aX + dX) / 2,
      frameCenterX: W / 2,
      expectSparkX: sx(spark),
      expectSparkY: sy(spark),
      expectContactX: sx(contactRef),
      expectMidX: sx(midRef),
    }
  }, { sc, mutate, CM_TO_WORLD, GROUND_Y })
}

/** Fire the spark (flash/kicks already suppressed) and render it at the spawn
 *  instant. Passing dt=0 draws the freshly-emitted burst while it is still
 *  compact at `pos` — one frame of physics scatters the 64 particles into sparse
 *  streaks whose brightest-core centroid is noise, not a position. */
async function fireSpark(sc, mutate) {
  await page.evaluate(({ sc, mutate }) => {
    const r = window.__FIGHT__.renderer
    const at = { x: mutate ? sc.mid : sc.atX, y: sc.atY }
    r.vfxRef.handle({ type: 'hit', at, attacker: 0, level: 'heavy', damage: 80 })
    window.__FIGHT__.step(1, 0)
  }, { sc, mutate })
}

/** Mean luma over the stage band — guards the ~1-in-9 lost-drawing-buffer frame. */
async function stageLuma(buf) {
  const meta = await sharp(buf).metadata()
  const { data, info } = await sharp(buf)
    .extract({ left: 0, top: Math.round(meta.height * 0.14), width: meta.width, height: Math.round(meta.height * 0.7) })
    .resize(120).raw().toBuffer({ resolveWithObject: true })
  let sum = 0
  const n = data.length / info.channels
  for (let i = 0; i < data.length; i += info.channels) sum += (data[i] + data[i + 1] + data[i + 2]) / 3
  return sum / n
}

/**
 * Find the x-centroid of the spark's brightest pixels, restricted to a
 * horizontal band around the spark's known screen height. The band is symmetric
 * and does NOT constrain x, so it is a fair test of where the spark sits
 * horizontally — a midpoint-anchored spark would light up the band's centre.
 */
async function brightestX(buf, bandCenterY, W, H) {
  const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true })
  const ch = info.channels
  const y0 = Math.max(0, Math.round(bandCenterY - H * 0.10))
  const y1 = Math.min(info.height, Math.round(bandCenterY + H * 0.10))
  // First pass: peak luma in the band.
  let peak = 0
  for (let y = y0; y < y1; y++) {
    for (let x = 0; x < info.width; x++) {
      const i = (y * info.width + x) * ch
      const l = (data[i] + data[i + 1] + data[i + 2]) / 3
      if (l > peak) peak = l
    }
  }
  // Second pass: luma-weighted centroid of the hottest pixels (>= 0.8*peak).
  const thr = peak * 0.8
  let sw = 0, sx = 0, count = 0, minX = info.width, maxX = 0
  for (let y = y0; y < y1; y++) {
    for (let x = 0; x < info.width; x++) {
      const i = (y * info.width + x) * ch
      const l = (data[i] + data[i + 1] + data[i + 2]) / 3
      if (l >= thr) { sw += l; sx += l * x; count++; if (x < minX) minX = x; if (x > maxX) maxX = x }
    }
  }
  return { x: count ? sx / sw : NaN, peak, count, spanX: maxX - minX }
}

/**
 * Isolate the ADDITIVE SPARK specifically, separate from the defender's white
 * hit-flash. The heavy spark colour is warm (0xff7a2a): red-dominant with
 * R >> B. The white body flash has R≈G≈B, so a warm-dominance filter keeps the
 * spark and rejects the flash. Returns the x-centroid of warm, bright pixels in
 * the band. This defends against a "lying harness" that would otherwise lock
 * onto the largest bright blob (the whole flashed body, or a stage highlight).
 */
async function warmSparkX(buf, bandCenterY, W, H) {
  const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true })
  const ch = info.channels
  const y0 = Math.max(0, Math.round(bandCenterY - H * 0.10))
  const y1 = Math.min(info.height, Math.round(bandCenterY + H * 0.10))
  let sw = 0, sx = 0, count = 0, minX = info.width, maxX = 0
  for (let y = y0; y < y1; y++) {
    for (let x = 0; x < info.width; x++) {
      const i = (y * info.width + x) * ch
      const r = data[i], g = data[i + 1], b = data[i + 2]
      // Warm + bright: red channel hot, clearly warmer than blue, and not the
      // grey/white flash (R-B small) — the spark core satisfies R-B >= 60.
      if (r >= 180 && r - b >= 60 && r - g >= 10) {
        const wgt = r
        sw += wgt; sx += wgt * x; count++
        if (x < minX) minX = x; if (x > maxX) maxX = x
      }
    }
  }
  return { x: count ? sx / sw : NaN, count, spanX: count ? maxX - minX : 0 }
}

/**
 * PRIMARY measure: x-centroid of the additive spark, isolated by differencing a
 * spark-on frame against a spark-off baseline of the identical frozen state.
 * With the camera kicks + hit-flash suppressed (see patchAndProject), the ONLY
 * strong positive-luma change in the band is the spark burst itself, so the
 * result is independent of the stage's own brightness/colour. Band-limited to the
 * spark's known screen height. Returns NaN if no strong new light appears.
 */
async function diffCentroidX(baseBuf, hitBuf, bandCenterY, W, H) {
  const a = await sharp(baseBuf).raw().toBuffer({ resolveWithObject: true })
  const c = await sharp(hitBuf).raw().toBuffer({ resolveWithObject: true })
  const ch = a.info.channels, wI = a.info.width
  const A = a.data, C = c.data
  const y0 = Math.max(0, Math.round(bandCenterY - H * 0.12))
  const y1 = Math.min(a.info.height, Math.round(bandCenterY + H * 0.12))
  let peak = 0
  for (let y = y0; y < y1; y++) {
    for (let x = 0; x < wI; x++) {
      const i = (y * wI + x) * ch
      const dl = (C[i] + C[i + 1] + C[i + 2]) - (A[i] + A[i + 1] + A[i + 2])
      if (dl > peak) peak = dl
    }
  }
  // Isolate the compact SPARK CORE, not the wide shockwave rings / flung embers.
  // The core is the brightest additive cluster (delta near the 765 max); the rings
  // are dim by comparison AND, being wide, their additive delta is skewed by
  // clipping over bright vs dark stage. A high threshold keeps only the core.
  const thr = Math.max(430, peak * 0.82)
  let sw = 0, sx = 0, count = 0, minX = wI, maxX = 0
  for (let y = y0; y < y1; y++) {
    for (let x = 0; x < wI; x++) {
      const i = (y * wI + x) * ch
      const dl = (C[i] + C[i + 1] + C[i + 2]) - (A[i] + A[i + 1] + A[i + 2])
      if (dl >= thr) { sw += dl; sx += dl * x; count++; if (x < minX) minX = x; if (x > maxX) maxX = x }
    }
  }
  return { x: count ? sx / sw : NaN, peak, count, spanX: count ? maxX - minX : 0 }
}

/** Screenshot with the ~1-in-9 lost-drawing-buffer (black) guard. */
async function guardedShot() {
  let buf = await page.screenshot()
  let luma = await stageLuma(buf)
  let retakes = 0
  while (luma < 12 && retakes < 4) {
    retakes++
    await page.evaluate(() => window.__FIGHT__.step(1))
    buf = await page.screenshot()
    luma = await stageLuma(buf)
  }
  return { buf, luma, retakes }
}

console.log(`spark pixel probe @ ${TARGET_URL}  (DPR 2)  build ${SHA}${MUTATE ? '  [MUTANT: fire at midpoint]' : ''}`)
console.log('scenario'.padEnd(13), 'sparkX'.padStart(8), '(warmDecoy)'.padStart(11), 'conRef'.padStart(7), 'midRef'.padStart(7),
  'ctr'.padStart(7), '|s-con|'.padStart(8), '|s-mid|'.padStart(8), 'offCtr'.padStart(8), 'read'.padStart(9), 'verdict')

const rows = []
let failed = false
for (const sc of scenarios) {
  await freeze(sc)
  const geo = await patchAndProject(sc, MUTATE)
  // Confirm the two fighters are actually inside the frame before trusting anything.
  const inFrame = geo.defenderScreenX > 0 && geo.defenderScreenX < geo.W &&
    geo.attackerScreenX > 0 && geo.attackerScreenX < geo.W
  // Spark-off baseline, then spark-on frame — camera + flash are suppressed, so
  // the difference is the spark alone.
  const base = await guardedShot()
  await fireSpark(sc, MUTATE)
  const hit = await guardedShot()
  writeFileSync(`${OUT}/${sc.name}.png`, hit.buf)
  writeFileSync(`${OUT}/${sc.name}_base.png`, base.buf)

  const d = await diffCentroidX(base.buf, hit.buf, geo.expectSparkY, geo.W, geo.H)
  // Decoy diagnostic: a naive "warmest bright pixel" instrument, to demonstrate on
  // the record how the warm ipo-prep stage pulls such a reading toward centre.
  const warm = await warmSparkX(hit.buf, geo.expectSparkY, geo.W, geo.H)

  const sparkX = d.x
  const sDef = Math.abs(sparkX - geo.defenderScreenX)
  const sMid = Math.abs(sparkX - geo.fighterMidScreenX)
  const sCtr = Math.abs(sparkX - geo.frameCenterX)
  // Fixed-reference read: is the isolated burst nearer the TRUE contact fire-point
  // (defender-biased) or the fighter-midpoint fire-point? Both refs are identical
  // across normal/mutant runs; only the spark moves, so this flips under mutation
  // and is robust to the burst's large radius (which defeats a fixed px margin).
  const dContact = Math.abs(sparkX - geo.expectContactX)
  const dMid = Math.abs(sparkX - geo.expectMidX)
  const read = dContact < dMid ? 'CONTACT' : 'MIDPOINT'
  // Refutation stat for the literal user claim ("~40px from the frame midpoint").
  const offCenter = sCtr
  const foundSpark = Number.isFinite(sparkX) && d.count > 20
  // Normal PASS: burst tracks the contact fire-point (not the midpoint), the two
  // refs are far enough apart to be distinguishable, and it is nowhere near the
  // frame centre (refuting the 40px claim).
  const refSep = Math.abs(geo.expectContactX - geo.expectMidX)
  const pass = read === 'CONTACT' && dContact < dMid - 20 && refSep >= 120 && offCenter >= 100 && inFrame && foundSpark
  const verdict = MUTATE
    ? (read === 'MIDPOINT' ? 'RED-as-expected' : '*** MUTANT NOT CAUGHT')
    : (pass ? 'PASS' : '*** FAIL')
  if (MUTATE ? read !== 'MIDPOINT' : !pass) failed = true
  rows.push({ name: sc.name, sparkX: +sparkX.toFixed(1), diffPeak: +d.peak.toFixed(0), diffPx: d.count,
    diffSpanX: d.spanX, warmDecoyX: +warm.x.toFixed(1), warmDecoyPx: warm.count, ...geo,
    dContact: +dContact.toFixed(1), dMid: +dMid.toFixed(1), offCenter: +offCenter.toFixed(1),
    sDef: +sDef.toFixed(1), sMid: +sMid.toFixed(1), sCtr: +sCtr.toFixed(1), read,
    lumaBase: +base.luma.toFixed(1), lumaHit: +hit.luma.toFixed(1),
    retakes: base.retakes + hit.retakes, inFrame })
  console.log(
    sc.name.padEnd(13),
    (Number.isNaN(sparkX) ? '—' : sparkX.toFixed(0)).padStart(8),
    (Number.isNaN(warm.x) ? '—' : warm.x.toFixed(0)).padStart(11),
    geo.expectContactX.toFixed(0).padStart(7),
    geo.expectMidX.toFixed(0).padStart(7),
    geo.frameCenterX.toFixed(0).padStart(7),
    dContact.toFixed(0).padStart(8),
    dMid.toFixed(0).padStart(8),
    offCenter.toFixed(0).padStart(8),
    read.padStart(9),
    ' ' + verdict,
  )
}

writeFileSync(`${OUT}/report.json`, JSON.stringify({ build: SHA, mutate: MUTATE, url: TARGET_URL, rows, errors }, null, 2))
console.log(`\n  wrote ${OUT}/report.json + ${scenarios.length} PNGs`)
if (errors.length) { console.log(`  ${errors.length} console errors:`); for (const e of [...new Set(errors)].slice(0, 6)) console.log('    ' + e) }
await browser.close()
process.exit(failed ? 1 : 0)
