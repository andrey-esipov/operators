// Facade probe: the ipo-prep mid-ground window bank must read as ARCHITECTURE,
// not a flat field of random noise blocks. Two structural signals that the old
// 'data' noise grid fails but a real lit facade passes:
//
//   A) VERTICAL GRADIENT. A building facade is bright at its occupied base and
//      fades toward the dark sky at the top; random noise is uniform top-to-
//      bottom. We measure mean luma of the lower band vs the upper band of the
//      facade (side panels only, so the centre bell/rostrum glow cannot fake it)
//      and require lower/upper >= GRAD_MIN.
//   B) WARM/COOL MIX. The facade deliberately lights ~1 in 5 windows cool
//      (cyan office-fluorescent) against the warm gold majority — the warm/cool
//      contrast the brief asked for. The old 'data' mode is ~all gold (its only
//      cyan is a 2%-of-rows scanline at half brightness, below the bright
//      threshold), so its cool-window count collapses. We require COOL_MIN.
//
// Break test: revert ipoPrep's big-board from 'windows' back to 'data' and BOTH
// signals must fail. If it still passes, the probe is a liar.
//
// Pinned to ?stage=ipo-prep — the facade lives only there, and the route default
// moved to pre-pmf, so capturing the default would test the wrong arena.

import { chromium } from 'playwright-core'
import { mkdirSync, writeFileSync } from 'node:fs'
import sharp from 'sharp'

const arg = (n, d) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : d)
const PORT = arg('--port', '5399')
const OUT = arg('--out', 'probe-out/facade')
const A = arg('--a', 'lenny')
const B = arg('--b', 'spiegel')
const MEASURE = process.argv.includes('--measure')
const URL = `http://localhost:${PORT}/?stage=ipo-prep&a=${A}&b=${B}&cpu=dummy`

// Facade sample boxes: the LEFT and RIGHT window panels, above the floor and the
// fighters' heads, excluding the centre column where the bell rostrum glows.
const LEFT = { x: 360, y: 92, width: 200, height: 156 }
const RIGHT = { x: 720, y: 92, width: 200, height: 156 }

// Thresholds sit in the measured gap between the noise grid and the facade.
// Measured (paused neutral, lenny×spiegel): old 'data' noise scores gradient
// 1.16 / cool 374 (its "cool" is backdrop sky bleeding through the ~45% dark
// cells, not intentional windows); the 'windows' facade scores gradient 1.5 /
// cool 1800+. COOL is the strong discriminator (5x gap); GRADIENT is secondary.
// Both must pass, so reverting to 'data' fails on BOTH.
const GRAD_MIN = Number(arg('--grad', '1.30'))
const COOL_MIN = Number(arg('--cool', '900'))

mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-angle=metal', '--no-sandbox'],
})
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 })
let reloaded = false
page.on('framenavigated', (f) => { if (f === page.mainFrame()) reloaded = true })

async function waitStableFight() {
  let stable = 0
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline && stable < 15) {
    let ok = false
    try {
      ok = await page.evaluate(() => !!window.__PLAY__?.ready?.() && window.__PLAY__.state().phase === 'fight')
    } catch { ok = false }
    stable = ok ? stable + 1 : 0
    await page.waitForTimeout(30)
  }
  return stable >= 15
}

// One screenshot per box, all signals computed from the SAME buffer so a mid-run
// reload can never splice an upper band from one frame with a lower from another.
async function boxStats(clip) {
  const buf = await page.screenshot({ clip })
  const { data, info } = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  const W = info.width, H = info.height
  const lumaBand = (y0, y1) => {
    let s = 0, n = 0
    for (let y = Math.floor(H * y0); y < Math.floor(H * y1); y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 3
        s += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
        n++
      }
    }
    return n ? s / n : 0
  }
  let cool = 0
  for (let i = 0; i + 2 < data.length; i += 3) {
    const r = data[i], g = data[i + 1], b = data[i + 2]
    if (0.299 * r + 0.587 * g + 0.114 * b < 110) continue
    if (b > r + 35 && b > 150 && g > 110) cool++
  }
  return { upper: lumaBand(0.0, 0.4), lower: lumaBand(0.6, 1.0), cool }
}

async function measure() {
  let lowerSum = 0, upperSum = 0, cool = 0
  for (const box of [LEFT, RIGHT]) {
    const s = await boxStats(box)
    upperSum += s.upper; lowerSum += s.lower; cool += s.cool
  }
  const grad = lowerSum / Math.max(1, upperSum)
  return { grad: +grad.toFixed(3), lower: +lowerSum.toFixed(1), upper: +upperSum.toFixed(1), cool }
}

// Re-settle the sim to a paused neutral frame. Used on first run and on retry
// after a mid-run reload leaves the facade unpainted.
async function settle() {
  if (!(await waitStableFight())) throw new Error('never reached a stable fight phase')
  await page.mouse.click(800, 450)
  await page.waitForTimeout(400)
  await page.evaluate(() => window.__PLAY__?.pause?.())
  await page.waitForTimeout(150)
}

async function main() {
  await page.goto(URL, { waitUntil: 'domcontentloaded' })

  // Retry the whole measure if a concurrent-agent reload repaints mid-capture
  // (this shared tree reloads often) or leaves the facade dark. A facade that is
  // genuinely dark top AND bottom (upper+lower < 30) is an unpainted/blank frame,
  // not a real measurement — retry rather than score it.
  let m = null
  for (let attempt = 0; attempt < 6; attempt++) {
    await settle()
    reloaded = false // arm the tripwire only now that warm-up churn is done
    m = await measure()
    if (!reloaded && m.upper + m.lower >= 30) break
    await page.waitForTimeout(400)
  }
  writeFileSync(`${OUT}/facade.png`, await page.screenshot({ clip: { x: 0, y: 0, width: 1280, height: 720 } }))

  console.log('facade probe — ipo-prep window bank reads as architecture')
  console.log(`  vertical gradient (lower/upper luma): ${m.grad}   (lower ${m.lower}, upper ${m.upper})`)
  console.log(`  cool office-window pixels:            ${m.cool}`)
  console.log(`  reloaded=${reloaded}`)

  if (MEASURE) { await browser.close(); return }

  const fails = []
  if (m.grad < GRAD_MIN) fails.push(`gradient ${m.grad} < ${GRAD_MIN} (facade not base-bright — reads flat/uniform like noise)`)
  if (m.cool < COOL_MIN) fails.push(`cool windows ${m.cool} < ${COOL_MIN} (no warm/cool contrast — single-hue grid)`)
  if (fails.length) {
    console.log(`  FAIL  ${fails.join('; ')}`)
    console.log('=== FACADE FAIL ===')
    await browser.close(); process.exit(1)
  }
  console.log('  PASS  window bank has a base-to-sky gradient and warm/cool window mix')
  console.log('=== FACADE PASS ===')
  await browser.close()
}

main().catch(async (e) => { console.error('FAILED:', e.message); await browser.close(); process.exit(1) })
