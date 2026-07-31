// Item 3: blind bar-aspect-ratio test.
//
// The open question -- is the health bar's ~26.7:1 track aspect right? -- is
// unanswerable from memory of a shipped game (and this project has correctly
// refused to rebuild bar geometry from a half-remembered SF6). It IS answerable
// as a *measurement*: render a few candidate aspect ratios that differ in ONE
// variable, and have the visual-critic pick the most readable one BLIND.
//
// This generates the candidates. It does NOT edit the shipped CSS -- each ratio
// is an addStyleTag override of .fhud-hptrack height on the paused preview, so
// the only thing that changes between frames is the bar's height (hence its
// aspect). Everything else -- hue ramp, housing, skew, gloss, portrait, timer,
// the mid-fight damage state, the background -- is byte-identical, which is what
// makes it a clean single-variable A/B rather than a vibe check.
//
// Output:
//   critique/bar-ratio/cand-<hash>.png   HUD-band crops the critic scores COLD
//   critique/bar-ratio/gallery.json      hash -> nothing but an index (safe)
//   critique/bar-ratio/KEY.json          hash -> {heightPx, ratio} (hold outside critic's view)
//
// The blindness rule is the same as critique/blind-pairs.mjs: whoever scores
// must not read KEY.json until picks are written down. I am not the blind critic
// here; this tool only tees the question up so it can be answered honestly.

import { chromium } from 'playwright-core'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import sharp from 'sharp'

const arg = (n, d) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : d)
const PORT = arg('--port', '5399')
const OUT = 'critique/bar-ratio'
const URL = `http://localhost:${PORT}/?fighthud=1&a=spiegel&b=lenny&paused=1`
const SHA = (() => { try { return execSync('git rev-parse --short HEAD').toString().trim() } catch { return '?' } })()

// Candidate track heights (px). Width is fixed by layout (~588px), so height is
// the aspect knob. Shuffle so file order carries no signal.
const HEIGHTS = [16, 22, 32]
const shuffled = [...HEIGHTS].sort(() => Math.random() - 0.5)

const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-angle=metal', '--no-sandbox'],
})
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 })

let reloaded = false
const isNavErr = (e) => /Execution context was destroyed|because of a navigation|Target closed|frame was detached/i.test(String(e))

console.log(`bar-ratio candidates at ${URL}  build ${SHA} -> ${OUT}/`)
await page.goto(URL, { waitUntil: 'domcontentloaded' })
page.on('framenavigated', (f) => { if (f === page.mainFrame()) reloaded = true })
await page.waitForFunction(() => window.__FIGHTHUD__?.ready?.(), null, { timeout: 30000 })

// Drive to a mid-fight frame with asymmetric damage so BOTH the hue ramp along
// the bar and the recoverable chip-trail are on screen -- the bar states a
// readability test actually needs to judge.
await page.evaluate(() => {
  const F = window.__FIGHTHUD__
  for (let i = 0; i < 400 && F.state().phase !== 'fight'; i++) F.step(1)
  const s = F.state()
  s.fighters[0].health = Math.round(s.fighters[0].maxHealth * 0.62)
  s.fighters[1].health = Math.round(s.fighters[1].maxHealth * 0.38)
  F.step(1)
})
await page.waitForTimeout(900) // let the chip-trail drain animation settle

if (reloaded) { console.log('FAILED: page reloaded during setup; rerun in a lull.'); await browser.close(); process.exit(1) }

rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })

const TRACK_W = 588
const gallery = []
const key = []
let idx = 0
for (const h of shuffled) {
  // Single-variable override: only the track height changes.
  const tagHandle = await page.addStyleTag({ content: `.fhud-hptrack{height:${h}px !important;}` })
  await page.waitForTimeout(250)
  let buf
  try {
    buf = await page.screenshot()
  } catch (e) {
    if (isNavErr(e) || reloaded) { console.log('FAILED: reload during capture; rerun in a lull.'); await browser.close(); process.exit(1) }
    throw e
  }
  await tagHandle.evaluate((el) => el.remove()) // reset before the next candidate

  // Crop to the top HUD band (DPR 2 => 1800px tall; the assembly lives in the
  // top ~150 logical px = ~300 device px). Keep it generous so the critic sees
  // the whole bar-in-housing, not a sliver.
  const hash = createHash('sha1').update(`${SHA}:${h}:${idx}:${Math.random()}`).digest('hex').slice(0, 10)
  const name = `cand-${hash}.png`
  await sharp(buf).extract({ left: 0, top: 0, width: 3200, height: 320 }).toFile(`${OUT}/${name}`)
  const ratio = +(TRACK_W / h).toFixed(1)
  gallery.push({ index: idx, file: name })
  key.push({ file: name, heightPx: h, ratioApprox: `${ratio}:1` })
  console.log(`  cand ${idx}: height=${h}px  ~${ratio}:1  -> ${name}`)
  idx++
}

writeFileSync(`${OUT}/gallery.json`, JSON.stringify({ build: SHA, note: 'score cold; do not open KEY.json first', candidates: gallery }, null, 2))
writeFileSync(`${OUT}/KEY.json`, JSON.stringify({ build: SHA, key }, null, 2))
await browser.close()
console.log(`\nWrote ${idx} candidates + gallery.json (safe) + KEY.json (hold until picks are written).`)
