// Pillars probe: the ipo-prep marble columns must read as LIT STONE, not the
// pure-black silhouettes the brief flagged. Signal: the mean luma of the two
// frontmost column shafts (tight boxes placed fully ON the shafts, above the
// fighters' heads and clear of the centre window bank AND the far-right sky).
// Each shaft must clear its own brightness floor.
//
// BOTH shafts must pass. That is what defeats the lying harness: the failure mode
// (dark column material + no fresnel rim) collapses the brightness of BOTH shafts
// at once, and the boxes sit tightly on column geometry that exists in the broken
// state too (same cylinders, dark material, no rim) — so no bright bleed-through
// from the facade or the sky can carry a black shaft over the line. (Texture
// variance was tried and rejected: a black shaft against the warm backdrop keeps
// high edge/interior variance, so std does NOT discriminate — brightness does.)
//
// Break test: in ipoPrep set the column body back to the old
// structureMat({color:0x2a3648, roughness:0.35, metalness:0.4}) and drop the
// fresnelShell rim (intensity 0) — measured LEFT 59.7->22.9, RIGHT 115.7->56.7,
// both boxes fall under their floors. If it still passes, the probe is a liar.
//
// Pinned to ?stage=ipo-prep — these columns live only there, and the route
// default moved to pre-pmf, so capturing the default would test the wrong arena.

import { chromium } from 'playwright-core'
import { mkdirSync, writeFileSync } from 'node:fs'
import sharp from 'sharp'

const arg = (n, d) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : d)
const PORT = arg('--port', '5399')
const OUT = arg('--out', 'probe-out/pillars')
const A = arg('--a', 'lenny')
const B = arg('--b', 'spiegel')
const MEASURE = process.argv.includes('--measure')
const URL = `http://localhost:${PORT}/?stage=ipo-prep&a=${A}&b=${B}&cpu=dummy`

// The two frontmost column shafts, sampled above the fighters' heads (y>=105,
// HUD ends ~90) and tightly on the shafts: LEFT avoids the far-left backdrop haze
// and the centre facade; RIGHT stops well short of the bright blue sky at x>=1120
// (that sky is identical in both states and would mask a black shaft).
const LEFT = { x: 90, y: 105, width: 80, height: 140 }
const RIGHT = { x: 1000, y: 105, width: 80, height: 140 }

// Per-box floors sit in the measured gap between the black silhouette and the lit
// marble. Measured (paused neutral, lenny×spiegel): fixed marble+rim scores LEFT
// 59.7 / RIGHT 115.7; the reverted black silhouette collapses to LEFT 22.9 /
// RIGHT 56.7. The right shaft reads brighter than the left (nearer the warm
// backdrop), so a single shared threshold has no room — each box gets its own
// floor, mid-gap, and BOTH must clear it.
const LEFT_MIN = Number(arg('--lmin', '40'))
const RIGHT_MIN = Number(arg('--rmin', '85'))

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

// Mean luma of a clip, computed from one screenshot buffer.
async function boxMean(clip) {
  const buf = await page.screenshot({ clip })
  const { data } = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  let s = 0, n = 0
  for (let i = 0; i + 2 < data.length; i += 3) {
    s += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
    n++
  }
  return n ? s / n : 0
}

async function measure() {
  const l = await boxMean(LEFT)
  const r = await boxMean(RIGHT)
  return { lMean: +l.toFixed(1), rMean: +r.toFixed(1) }
}

// Re-settle to a paused neutral frame past the round-intro banner. Used on first
// run and on retry after a concurrent-agent reload repaints mid-capture.
async function settle() {
  if (!(await waitStableFight())) throw new Error('never reached a stable fight phase')
  await page.mouse.click(800, 450)
  await page.waitForTimeout(1600)
  await page.evaluate(() => window.__PLAY__?.pause?.())
  await page.waitForTimeout(150)
}

async function main() {
  await page.goto(URL, { waitUntil: 'domcontentloaded' })

  // Retry the whole measure if a concurrent-agent reload repaints mid-capture
  // (this shared tree reloads often). A frame where BOTH shafts sum < 30 during a
  // paused neutral is the dark "loading match…" screen (luma ~12 each), not a real
  // black-silhouette measurement (which sums ~80) — retry rather than score it.
  let m = null
  for (let attempt = 0; attempt < 6; attempt++) {
    await settle()
    reloaded = false // arm the tripwire only now that warm-up churn is done
    m = await measure()
    if (!reloaded && m.lMean + m.rMean >= 30) break
    await page.waitForTimeout(400)
  }
  writeFileSync(`${OUT}/pillars.png`, await page.screenshot({ clip: { x: 0, y: 0, width: 1280, height: 720 } }))

  console.log('pillars probe — ipo-prep columns read as lit textured marble')
  console.log(`  LEFT  shaft  mean ${m.lMean}   (floor ${LEFT_MIN})`)
  console.log(`  RIGHT shaft  mean ${m.rMean}   (floor ${RIGHT_MIN})`)
  console.log(`  reloaded=${reloaded}`)

  if (MEASURE) { await browser.close(); return }

  const fails = []
  if (m.lMean < LEFT_MIN) fails.push(`LEFT mean ${m.lMean} < ${LEFT_MIN} (left shaft is dark — black silhouette)`)
  if (m.rMean < RIGHT_MIN) fails.push(`RIGHT mean ${m.rMean} < ${RIGHT_MIN} (right shaft is dark — black silhouette)`)
  if (fails.length) {
    console.log(`  FAIL  ${fails.join('; ')}`)
    console.log('=== PILLARS FAIL ===')
    await browser.close(); process.exit(1)
  }
  console.log('  PASS  both column shafts are lit stone, not black silhouettes')
  console.log('=== PILLARS PASS ===')
  await browser.close()
}

main().catch(async (e) => { console.error('FAILED:', e.message); await browser.close(); process.exit(1) })
