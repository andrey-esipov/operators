// Capture the real-time fight renderer at key choreography beats for review.
//
// Determinism: we PAUSE the engine's rAF loop and advance only via stepFixed,
// so a captured frame depends solely on how many fixed steps we've taken, not
// on wall-clock timing. The scripted MockSim loops every ~596 sim frames; the
// SHOTS table below targets the frame each beat's payoff lands on (a hit spark
// is only on screen for a few frames, so these are tuned to the impact frame).
//
// Usage: node tools/fight-shots.mjs [--out DIR] [--port 5173] [--stage ID]
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'

const args = process.argv.slice(2)
const flag = (name, dflt) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : dflt
}

const OUT = flag('out', 'fight-shots')
const PORT = flag('port', '5173')
const STAGE = flag('stage', 'ipo-prep')
const A = flag('a', 'chesky')
const B = flag('b', 'lenny')
const BASE = `http://localhost:${PORT}/?fight=1&stage=${STAGE}&a=${A}&b=${B}`

mkdirSync(OUT, { recursive: true })

// [name, absolute sim-frame within the loop]
const SHOTS = [
  ['00-neutral', 40],
  ['01-footsies', 110],
  ['02-dash-in', 162],
  ['03-heavy-hit', 177],
  ['04-hitstun', 202],
  ['05-jump-in', 305],
  ['06-block', 330],
  ['07-launcher', 385],
  ['08-juggle', 410],
  ['09-super-flash', 431],
  ['10-ko', 496],
]

const browser = await chromium.launch({
  headless: false,
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-angle=metal', '--window-position=4000,4000', '--hide-scrollbars'],
})
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })
page.on('pageerror', (e) => console.log('  [pageerror]', e.message))
page.on('console', (m) => { if (m.type() === 'error') console.log('  [console.error]', m.text()) })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const shot = async (name) => {
  await page.screenshot({ path: `${OUT}/${name}.png` })
  console.log(`  wrote ${OUT}/${name}.png`)
}

await page.goto(BASE, { waitUntil: 'networkidle' })

// Wait for the harness to finish building atlases and expose the API.
for (let i = 0; i < 120; i++) {
  const ok = await page.evaluate(() => !!window.__FIGHT__?.ready())
  if (ok) break
  await sleep(250)
}
const ready = await page.evaluate(() => !!window.__FIGHT__?.ready())
if (!ready) {
  console.log('  FAILED: window.__FIGHT__ never became ready')
  await browser.close()
  process.exit(1)
}

// Freeze the loop, then warm a few frames so textures/pipeline are resident.
await page.evaluate(() => {
  window.__FIGHT__.pause()
  window.__FIGHT__.step(2)
})
await sleep(200)

let cur = await page.evaluate(() => window.__FIGHT__.frame())
for (const [name, target] of SHOTS) {
  // Step forward to the target sim frame (loop-aware).
  const delta = ((target - cur) % 596 + 596) % 596
  await page.evaluate((n) => window.__FIGHT__.step(n), delta)
  cur = target
  const phase = await page.evaluate(() => window.__FIGHT__.phase())
  await sleep(60)
  await shot(name)
  console.log(`    (${name} @ frame ${target}, phase=${phase})`)
}

await browser.close()
console.log('done')
