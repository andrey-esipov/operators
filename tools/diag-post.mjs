// Diagnostic: capture a couple of beats under different post QA-bisect flags so
// we can attribute a visible defect (CA fringing, bloom blowout, lens flare) to
// the exact stage that produces it, instead of guessing. Writes into diag/.
//
// Usage: node tools/diag-post.mjs [--port 5399]
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'

const args = process.argv.slice(2)
const flag = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d }
const PORT = flag('port', '5399')
const OUT = flag('out', 'diag')
mkdirSync(OUT, { recursive: true })

// Each variant is a set of URL post-bisect params.
const VARIANTS = [
  ['all', ''],
  ['nofinalize', '&nofinalize=1'],   // removes chromatic aberration + sharpen
  ['nobloom', '&nobloom=1'],         // removes bloom + lens
  ['nolens', '&nolens=1'],           // removes lens dirt/anamorphic only
  ['nograde', '&nograde=1'],         // removes master grade
]
const BEATS = [['00-neutral', 40], ['03-heavy-hit', 177], ['04-hitstun', 202]]

const browser = await chromium.launch({
  headless: false,
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-angle=metal', '--window-position=4000,4000', '--hide-scrollbars'],
})
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

for (const [vname, vparam] of VARIANTS) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })
  const url = `http://localhost:${PORT}/?fight=1&stage=ipo-prep&a=chesky&b=lenny${vparam}`
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  // Wait for readiness.
  for (let i = 0; i < 60; i++) {
    const ready = await page.evaluate(() => !!window.__FIGHT__?.ready())
    if (ready) break
    await sleep(250)
  }
  await page.evaluate(() => { window.__FIGHT__.pause(); window.__FIGHT__.step(2) })
  let cur = await page.evaluate(() => window.__FIGHT__.frame())
  for (const [bname, target] of BEATS) {
    let delta = target - cur
    if (delta < 0) delta += 596
    await page.evaluate((n) => window.__FIGHT__.step(n), delta)
    cur = target
    await sleep(120)
    await page.screenshot({ path: `${OUT}/${bname}.${vname}.png` })
  }
  console.log('captured variant', vname)
  await page.close()
}
await browser.close()
console.log('done ->', OUT)
