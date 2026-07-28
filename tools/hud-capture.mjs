// Reusable HUD screenshot capture. Loads a URL on the running dev server and
// writes a PNG. Used to actually LOOK at HUD work — never infer success from a
// tool exiting 0.
//
//   node tools/hud-capture.mjs "<url>" <out.png> [waitMs]
//
// Uses the documented local Playwright config (system Chrome + Metal ANGLE);
// the HUD itself is pure DOM, but we keep the same config for parity.
import { chromium } from 'playwright-core'

const url = process.argv[2]
const out = process.argv[3]
const waitMs = Number(process.argv[4] ?? 1200)
if (!url || !out) {
  console.error('usage: node tools/hud-capture.mjs "<url>" <out.png> [waitMs]')
  process.exit(2)
}

const browser = await chromium.launch({
  headless: false,
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-angle=metal', '--window-position=4000,4000', '--hide-scrollbars'],
})
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })
page.on('console', (m) => {
  if (m.type() === 'error') console.log('  [console.error]', m.text())
})
await page.goto(url, { waitUntil: 'load' })
await page.waitForTimeout(waitMs)
await page.screenshot({ path: out })
console.log('wrote', out)
await browser.close()
