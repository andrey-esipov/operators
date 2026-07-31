// Diagnostic: capture beats under post QA-bisect flags to attribute a defect to
// the stage that produces it. One browser per variant. Writes into diag/.
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'

const args = process.argv.slice(2)
const flag = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d }
const PORT = flag('port', '5399')
const OUT = flag('out', 'diag')
mkdirSync(OUT, { recursive: true })

const VARIANTS = [
  ['all', ''],
  ['nofinalize', '&nofinalize=1'],
  ['nobloom', '&nobloom=1'],
  ['nolens', '&nolens=1'],
]
const BEATS = [['00-neutral', 40], ['03-heavy-hit', 177], ['04-hitstun', 202]]
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

for (const [vname, vparam] of VARIANTS) {
  const browser = await chromium.launch({
    headless: false,
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    args: ['--use-angle=metal', '--window-position=4000,4000', '--hide-scrollbars'],
  })
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })
  page.on('pageerror', (e) => console.log(`  [${vname} pageerror]`, e.message))
  const url = `http://localhost:${PORT}/?fight=1&stage=ipo-prep&a=chesky&b=lenny${vparam}`
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  let ok = false
  for (let i = 0; i < 120; i++) {
    ok = await page.evaluate(() => !!window.__FIGHT__?.ready())
    if (ok) break
    await sleep(250)
  }
  if (!ok) { console.log('  FAILED ready:', vname); await browser.close(); continue }
  await page.evaluate(() => { window.__FIGHT__.pause(); window.__FIGHT__.step(2) })
  let cur = await page.evaluate(() => window.__FIGHT__.frame())
  for (const [bname, target] of BEATS) {
    let delta = target - cur
    if (delta < 0) delta += 596
    for (let k = 0; k < delta; k++) await page.evaluate(() => window.__FIGHT__.step(1))
    cur = target
    await sleep(200)
    await page.screenshot({ path: `${OUT}/${bname}.${vname}.png` })
  }
  console.log('captured variant', vname)
  await browser.close()
}
console.log('done ->', OUT)
