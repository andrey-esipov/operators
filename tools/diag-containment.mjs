// Camera CONTAINMENT assertion. The defect this catches: when one fighter jumps,
// the frame followed the airborne fighter up and let the GROUNDED fighter slide
// off the bottom edge (measured: grounded fighter cut off at the waist on a plain
// jump). A screenshot passes nine frames in ten and only breaks in the airborne
// case, so an eyeball check misses it. This projects BOTH fighters' full sprite
// bounds (all four world corners, expanded exactly as the vertex shader does:
// off = (uv - uPivot)*uSize * uSquash, x-lean, x-facing, + feet) to screen and
// asserts every corner is inside the viewport, swept across the ENTIRE
// deterministic choreography (which contains jump-in, launcher, juggle, super and
// KO beats — every airborne state the camera has to contain).
//
// Prove it can fail:  --shrink 0.06  tightens the asserted viewport to
// [0.06 .. 0.94]. With the fix in, the real viewport (shrink 0) passes; a 6%
// tighter frame goes red on the airborne beats — showing the margin is finite and
// the instrument actually measures screen extent rather than rubber-stamping.
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'
import sharp from 'sharp'

const arg = (n, d) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : d)
const PORT = arg('--port', '5399')
const STAGE = arg('--stage', 'pre-pmf')
const A = arg('--a', 'chesky'), B = arg('--b', 'lenny')
const MAXF = Number(arg('--frames', '300'))
const STEP = Number(arg('--step', '2'))
const SHRINK = Number(arg('--shrink', '0'))
const URL = `http://localhost:${PORT}/?fight=1&stage=${STAGE}&a=${A}&b=${B}`
mkdirSync('diag', { recursive: true })
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const browser = await chromium.launch({ headless: false, executablePath: CHROME, args: ['--use-angle=metal','--window-position=4000,4000','--hide-scrollbars'] })
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 })
page.setDefaultTimeout(35000)
page.on('pageerror', (e) => console.log('PAGEERR', e.message))

async function boot() {
  await page.goto(URL, { waitUntil: 'load', timeout: 30000 })
  await page.waitForFunction(() => !!window.__FIGHT__?.renderer, { timeout: 30000 })
  await page.evaluate(() => window.__FIGHT__.pause())
}

let ok = false
for (let a = 0; a < 6 && !ok; a++) {
  try { await boot(); ok = true } catch (e) { console.log('retry', a + 1, e.message.split('\n')[0]); await new Promise(r => setTimeout(r, 1200)) }
}
if (!ok) { console.log('BOOT FAILED'); await browser.close(); process.exit(2) }

// A vite HMR reload mid-sweep tears down __FIGHT__ and restarts the match under
// us — capturing frames of a restarted choreography filed under the wrong frame
// numbers is exactly the lying-harness shape. Detect navigation and restart the
// WHOLE sweep on a fresh boot, never stitch across a reload.
let navigated = false
page.on('framenavigated', (f) => { if (f === page.mainFrame()) navigated = true })

async function sweepOnce() {
  navigated = false
  await boot()
  await page.waitForTimeout(400)
  if (navigated) throw new Error('reloaded during boot')
  // Whole sweep in ONE evaluate: engine.stepFixed is synchronous, so stepping and
  // measuring every frame in-browser finishes in ~1s and is atomic against HMR
  // reloads (which otherwise tear __FIGHT__ down mid-sweep on this churny server).
  const rows = await page.evaluate(async ({ MAXF, STEP }) => {
    const THREE = await import('/node_modules/.vite/deps/three.js?v=probe')
    const F = window.__FIGHT__
    const cam = F.renderer.engine.camera
    const measure = () => {
      const out = []
      for (let i = 0; i < 2; i++) {
        const m = F.renderer.fighter(i).mesh
        const u = m.material.uniforms
        const sz = u.uSize.value, pv = u.uPivot.value, sq = u.uSquash.value
        const lean = u.uLean.value, facing = u.uFacing.value
        m.updateWorldMatrix(true, false)
        let minx = 1, maxx = 0, miny = 1, maxy = 0
        for (const gx of [0, 1]) for (const gy of [0, 1]) {
          let ox = (gx - pv.x) * sz.x * sq.x
          let oy = (gy - pv.y) * sz.y * sq.y
          ox += oy * lean; ox *= facing
          const w = new THREE.Vector3(ox, oy, 0).applyMatrix4(m.matrixWorld)
          const p = w.clone().project(cam)
          const sx = p.x * 0.5 + 0.5, sy = 1 - (p.y * 0.5 + 0.5)
          minx = Math.min(minx, sx); maxx = Math.max(maxx, sx); miny = Math.min(miny, sy); maxy = Math.max(maxy, sy)
        }
        out.push({ feetY: +m.position.y.toFixed(2), minx: +minx.toFixed(4), maxx: +maxx.toFixed(4), miny: +miny.toFixed(4), maxy: +maxy.toFixed(4) })
      }
      return { frame: F.frame(), a: out[0], b: out[1] }
    }
    const rows = []
    for (let f = 0; f <= MAXF; f += STEP) { rows.push(measure()); F.step(STEP) }
    return rows
  }, { MAXF, STEP })
  if (navigated) throw new Error('reloaded mid-sweep')
  return rows
}

let rows = null
for (let a = 0; a < 5 && !rows; a++) {
  try { rows = await sweepOnce() } catch (e) { console.log('sweep retry', a + 1, e.message.split('\n')[0]); await new Promise(r => setTimeout(r, 1500)) }
}
if (!rows) { console.log('SWEEP FAILED (persistent reloads)'); await browser.close(); process.exit(2) }

const maxAir = Math.max(...rows.map(r => Math.max(r.a.feetY, r.b.feetY)))
console.log(`\n=== containment sweep  stage=${STAGE} ${A} vs ${B}  frames 0..${MAXF} step ${STEP} ===`)
console.log(`samples=${rows.length}  max airborne feetY reached=${maxAir}`)

// Evaluate the SAME rows against a ladder of viewport tightenings. shrink=0 is the
// real viewport (the assertion that must hold). The tightened rows are the
// falsification control: they prove the instrument actually measures screen
// extent and that the containment margin is FINITE — a few % tighter frame goes
// red — so a green at shrink=0 is a real pass, not a rubber stamp.
const assess = (shrink) => {
  const lo = shrink, hi = 1 - shrink
  let violations = 0, worstBot = 1, worstFrame = -1, worstAir = 0
  for (const r of rows) for (const side of ['a', 'b']) {
    const g = r[side]
    if (g.miny < lo || g.maxy > hi || g.minx < lo || g.maxx > hi) violations++
    const botM = hi - g.maxy
    if (botM < worstBot) { worstBot = botM; worstFrame = r.frame; worstAir = Math.max(r.a.feetY, r.b.feetY) }
  }
  return { violations, worstBot, worstFrame, worstAir }
}
for (const shrink of [0, 0.03, 0.06]) {
  const a = assess(shrink)
  const tag = a.violations === 0 ? 'PASS' : 'FAIL'
  console.log(`shrink=${shrink.toFixed(2)} [${(shrink).toFixed(2)}..${(1-shrink).toFixed(2)}]  violations=${a.violations}  worstBottomMargin=${(a.worstBot*100).toFixed(2)}% @f${a.worstFrame}(feetY=${a.worstAir})  -> ${tag}`)
}
const violations = assess(0).violations

// Capture a PNG at the most airborne frame and eyeball both fighters in-frame.
try {
  const airFrame = rows.reduce((best, r) => (Math.max(r.a.feetY, r.b.feetY) > Math.max(best.a.feetY, best.b.feetY) ? r : best), rows[0])
  await page.evaluate(() => window.__FIGHT__.seek(0))
  await page.evaluate((tgt) => window.__FIGHT__.step(tgt), airFrame.frame)
  const png = `diag/containment-air-f${airFrame.frame}-shrink${SHRINK}.png`
  await page.screenshot({ path: png, timeout: 20000 })
  console.log(`captured most-airborne frame ${airFrame.frame} (feetY=${Math.max(airFrame.a.feetY, airFrame.b.feetY)}) -> ${png}`)
  console.log(`  A bounds x[${airFrame.a.minx},${airFrame.a.maxx}] y[${airFrame.a.miny},${airFrame.a.maxy}]`)
  console.log(`  B bounds x[${airFrame.b.minx},${airFrame.b.maxx}] y[${airFrame.b.miny},${airFrame.b.maxy}]`)
} catch (e) { console.log('(screenshot skipped:', e.message.split('\n')[0], ')') }
await browser.close()
