// super-strip.mjs — capture the ENTIRE super-freeze frame by frame, so the hold
// can be judged as motion rather than inferred from a single flash still.
//
// Reuses the __FIGHT__ pause/step/phase API that fight-shots drives. Hunts to the
// first frame phase()==='super' (batched so it's fast), then screenshots every
// consecutive sim frame across the freeze + release, recording phase per frame so
// the freeze boundary is visible in the data, not guessed.
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'

const flag = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d }
const PORT = flag('port', '5399')
const OUT = flag('out', 'critique/super-strip')
const FRAMES = Number(flag('frames', '48'))
const STAGE = flag('stage', 'pre-pmf')
const A = flag('a', 'lenny'); const B = flag('b', 'spiegel')
const BASE = `http://localhost:${PORT}/?fight=1&stage=${STAGE}&a=${A}&b=${B}`
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({
  headless: false,
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-angle=metal', '--window-position=4000,4000', '--hide-scrollbars'],
})
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })
page.on('pageerror', (e) => console.log('  [pageerror]', e.message))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

await page.goto(BASE, { waitUntil: 'domcontentloaded' })
for (let i = 0; i < 120; i++) { if (await page.evaluate(() => !!window.__FIGHT__?.ready())) break; await sleep(250) }
if (!await page.evaluate(() => !!window.__FIGHT__?.ready())) { console.log('FAILED: never ready'); await browser.close(); process.exit(1) }
await page.evaluate(() => { window.__FIGHT__.pause(); window.__FIGHT__.step(2) })
await sleep(200)

// Hunt to the super, batched 40 sim-steps per round-trip, stopping ON the first
// super frame so the windup isn't overshot.
let found = false, total = 0
for (let r = 0; r < 200 && !found; r++) {
  const res = await page.evaluate(() => {
    for (let i = 0; i < 40; i++) { window.__FIGHT__.step(1); if (window.__FIGHT__.phase() === 'super') return { hit: true, i } }
    return { hit: false, i: 40 }
  })
  total += res.i
  if (res.hit) { found = true }
}
if (!found) { console.log('FAILED: never reached super phase in scan'); await browser.close(); process.exit(2) }
console.log(`super first seen at ~frame ${total} — capturing ${FRAMES} consecutive frames`)

const log = []
for (let f = 0; f < FRAMES; f++) {
  const phase = await page.evaluate(() => window.__FIGHT__.phase())
  const name = `f${String(f).padStart(3, '0')}`
  await page.screenshot({ path: `${OUT}/${name}.png` })
  log.push({ f, phase })
  await page.evaluate(() => window.__FIGHT__.step(1))
}
console.log(JSON.stringify(log))
// phase transition summary
let prev = null
for (const e of log) { if (e.phase !== prev) { console.log(`  frame ${e.f}: -> ${e.phase}`); prev = e.phase } }
await browser.close()
