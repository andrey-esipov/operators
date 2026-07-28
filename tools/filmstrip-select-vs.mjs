// Filmstrip of the select VS→FIGHT hand-off — owned by src/fighthud/**.
//
// A single frame cannot judge an envelope (house rule). This drives the launch
// beat once, then dumps a strip of frames at fixed elapsed offsets so the
// VS→FIGHT transition can be reviewed as motion: does VS recoil, does FIGHT!
// punch through, do the fighters slide outward smoothly (layout="position")
// rather than snapping? Frames are native 1:1 (DSF1, 1920x1080).
//
// Not an assertion gate — that is probe-select-vs.mjs. This is an eyes tool.

import { chromium } from 'playwright-core'
import { mkdirSync, writeFileSync } from 'node:fs'

const arg = (n, d) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : d)
const PORT = arg('--port', '5411')
const OUT = 'play-shots/select/film'
const URL = `http://localhost:${PORT}/?select=1`

const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-angle=metal', '--no-sandbox'],
})
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 })

await page.goto(URL, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => window.__SELECT__?.ready?.(), null, { timeout: 30000 })
await page.waitForFunction(() => window.__SELECT__?.state?.().portraitsReady === true, null, { timeout: 15000 })

// Compose chesky vs madhavan on the rocket deck, each setCursor its own tick.
await page.evaluate(() => window.__SELECT__.setCursor(0))
await page.waitForTimeout(90)
await page.evaluate(() => window.__SELECT__.confirm())
await page.waitForTimeout(90)
await page.evaluate(() => window.__SELECT__.setCursor(4))
await page.waitForTimeout(90)
await page.evaluate(() => window.__SELECT__.confirm())
await page.waitForTimeout(90)
await page.evaluate(() => window.__SELECT__.setCursor(1))
await page.waitForTimeout(120)

mkdirSync(OUT, { recursive: true })
let navigated = false
page.on('framenavigated', (f) => { if (f === page.mainFrame()) navigated = true })
const t0 = Date.now()
await page.evaluate(() => window.__SELECT__.confirm()) // → launch beat

// Capture back-to-back as fast as the screenshots allow, labelling each frame
// with its ACTUAL elapsed time + beat. Fixed wall-clock offsets drift once you
// account for ~150ms/screenshot and would sail past the 2350ms hand-off; a
// self-timing strip is honest about when each frame really landed. Stop before
// the nav so no evaluate hits a destroyed context.
let i = 0
while (Date.now() - t0 < 2250 && !navigated) {
  let beat
  try {
    beat = await page.evaluate(() => document.querySelector('[data-testid="fsel-launch"]')?.getAttribute('data-beat') ?? 'gone')
  } catch (e) {
    if (/context was destroyed|navigation|Target closed|detached/i.test(String(e))) break
    throw e
  }
  const off = Date.now() - t0
  const name = `${OUT}/vsfilm-${String(i).padStart(2, '0')}-${String(off).padStart(4, '0')}ms-${beat}.png`
  writeFileSync(name, await page.screenshot())
  console.log(`  ${name}`)
  i++
}

await browser.close()
console.log(`\n=== ${i} filmstrip frames in ${OUT} (navigated=${navigated}) ===`)
