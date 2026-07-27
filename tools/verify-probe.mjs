// Verification + anti-lying proofs for the fight renderer.
//
// 1. Frame time: samples rAF deltas while the engine runs and reports the
//    average / p95 against the 16.67ms (60fps) budget.
// 2. Coverage probe CAN FAIL: reads fighterCoverage() with the fighters
//    visible (expect a healthy lit fraction), then hides both fighter groups,
//    re-reads (expect it to collapse toward zero -> RED), then restores and
//    re-reads (expect it to recover -> GREEN). This proves the probe actually
//    distinguishes "drawn" from "not drawn" rather than always reporting green.
// 3. Duplicate render loop: pauses the renderer, screenshots twice ~1.5s apart
//    with no stepping, and diffs. A still, paused frame must not change; a
//    non-trivial delta would mean a second loop owns the canvas (the documented
//    orphaned-renderer incident).
//
// Usage: node tools/verify-probe.mjs [--port 5399]
import { chromium } from 'playwright-core'
import sharp from 'sharp'

const flag = (n, d) => {
  const i = process.argv.indexOf(`--${n}`)
  return i >= 0 ? process.argv[i + 1] : d
}
const PORT = flag('port', '5399')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const browser = await chromium.launch({
  headless: false,
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-angle=metal', '--window-position=4000,4000', '--hide-scrollbars'],
})
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })
page.on('pageerror', (e) => console.log('  [pageerror]', e.message))
const url = `http://localhost:${PORT}/?fight=1&stage=ipo-prep&a=chesky&b=lenny`
await page.goto(url, { waitUntil: 'domcontentloaded' })

let ok = false
for (let i = 0; i < 120; i++) {
  ok = await page.evaluate(() => !!window.__FIGHT__?.ready())
  if (ok) break
  await sleep(250)
}
if (!ok) { console.log('FAILED to become ready'); await browser.close(); process.exit(1) }

// Let it run into a lively beat so there's motion/VFX on screen during timing.
await page.evaluate(() => window.__FIGHT__.resume())
await page.evaluate(() => window.__FIGHT__.seek(170))
// Warm shader compiles across a few heavy beats before timing so a one-off
// program-link hitch doesn't masquerade as a per-frame cost.
await page.evaluate(() => window.__FIGHT__.seek(60))
await sleep(300)

// --- 1a. Frame time via rAF (vsync/throttle-prone in an offscreen window) --
const timing = await page.evaluate(async () => {
  const dts = []
  let last = performance.now()
  await new Promise((resolve) => {
    let n = 0
    const tick = (t) => {
      dts.push(t - last)
      last = t
      if (++n >= 180) return resolve()
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
  dts.shift() // discard first (warm)
  const sorted = [...dts].sort((a, b) => a - b)
  const avg = dts.reduce((a, b) => a + b, 0) / dts.length
  const p50 = sorted[Math.floor(sorted.length * 0.5)]
  const p95 = sorted[Math.floor(sorted.length * 0.95)]
  const max = sorted[sorted.length - 1]
  return { avg, p50, p95, max, frames: dts.length }
})

// --- 1b. Synchronous render cost (bypasses rAF/vsync throttling) ----------
// Pause the engine and drive fixed steps back to back, timing the CPU submit
// for sim+render. This isolates the work the renderer does per frame from
// however the offscreen browser schedules rAF.
const sync = await page.evaluate(async () => {
  window.__FIGHT__.pause()
  const F = window.__FIGHT__
  for (let i = 0; i < 10; i++) F.step(1) // warm
  const samples = []
  for (let i = 0; i < 120; i++) {
    const t0 = performance.now()
    F.step(1)
    samples.push(performance.now() - t0)
  }
  window.__FIGHT__.resume()
  samples.sort((a, b) => a - b)
  const avg = samples.reduce((a, b) => a + b, 0) / samples.length
  return { avg, p50: samples[60], p95: samples[114], max: samples[119] }
})

console.log('\n=== FRAME TIME (60fps budget = 16.67ms) ===')
console.log(`  rAF loop : avg ${timing.avg.toFixed(2)}ms  p50 ${timing.p50.toFixed(2)}ms  p95 ${timing.p95.toFixed(2)}ms  max ${timing.max.toFixed(2)}ms`)
console.log(`  sync step: avg ${sync.avg.toFixed(2)}ms  p50 ${sync.p50.toFixed(2)}ms  p95 ${sync.p95.toFixed(2)}ms  max ${sync.max.toFixed(2)}ms  (CPU submit, no vsync)`)
console.log(`  -> sync p95 ${sync.p95 <= 16.67 ? 'WITHIN' : 'over'} 16.67ms budget`)

// --- 2. Coverage probe can fail -----------------------------------------
console.log('\n=== COVERAGE PROBE — proving it can go RED ===')
const covVisible = await page.evaluate(() => window.__FIGHT__.coverage())
console.log(`  fighters VISIBLE : lit=${covVisible.lit} fraction=${(covVisible.fraction * 100).toFixed(2)}%  (expect healthy)`)

const covHidden = await page.evaluate(() => {
  const r = window.__FIGHT__.renderer
  r.fighters.forEach((f) => (f.group.visible = false))
  const c = r.fighterCoverage()
  r.fighters.forEach((f) => (f.group.visible = true))
  return c
})
console.log(`  fighters HIDDEN  : lit=${covHidden.lit} fraction=${(covHidden.fraction * 100).toFixed(2)}%  (expect ~0 -> RED)`)

const covRestored = await page.evaluate(() => window.__FIGHT__.coverage())
console.log(`  fighters RESTORED: lit=${covRestored.lit} fraction=${(covRestored.fraction * 100).toFixed(2)}%  (expect healthy again)`)

const probeProven = covVisible.fraction > 0.02 && covHidden.fraction < 0.002 && covRestored.fraction > 0.02
console.log(`  -> coverage probe ${probeProven ? 'PROVEN FAILABLE (green->red->green)' : 'INCONCLUSIVE'}`)

// --- 3. Duplicate render loop check -------------------------------------
console.log('\n=== DUPLICATE RENDER LOOP CHECK (paused frame must be still) ===')
await page.evaluate(() => window.__FIGHT__.pause())
await sleep(300)
const a = await sharp(await page.screenshot()).raw().toBuffer()
await sleep(1500)
const b = await sharp(await page.screenshot()).raw().toBuffer()
let diff = 0
const N = Math.min(a.length, b.length)
const chan = 3 // sharp raw default: RGB, no alpha
for (let i = 0; i < N; i += chan) {
  if (Math.abs(a[i] - b[i]) > 8) diff++
}
const diffFrac = diff / (N / chan)
console.log(`  changed pixels between two paused screenshots 1.5s apart: ${(diffFrac * 100).toFixed(3)}%`)
console.log(`  -> ${diffFrac < 0.005 ? 'STILL (single loop, no orphan)' : 'MOVING (something else owns the canvas!)'}`)

await browser.close()
