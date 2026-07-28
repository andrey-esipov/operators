// Is the juggled victim white for the whole juggle, or only on the contact
// frame? A single capture can't distinguish those, and the answer changes the
// fix completely: a persistent wash is a state-binding bug, while a one-frame
// peak is a flash-shape problem. Steps to the first juggle, then screenshots
// the same beat at increasing offsets so saturation can be measured over time.
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'

const OFFSETS = [0, 3, 6, 10, 16, 24]
const OUT = 'fight-shots/juggle'
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({
  headless: false,
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-angle=metal', '--window-position=4000,4000', '--hide-scrollbars'],
})
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })
await page.goto('http://localhost:5399/?fight=1&a=chesky&b=lenny', { waitUntil: 'domcontentloaded' })

for (let i = 0; i < 120; i++) {
  if (await page.evaluate(() => !!window.__FIGHT__?.ready())) break
  await page.waitForTimeout(250)
}
if (!(await page.evaluate(() => !!window.__FIGHT__?.ready()))) {
  console.log('FAILED: __FIGHT__ never became ready')
  await browser.close(); process.exit(1)
}

await page.evaluate(() => { window.__FIGHT__.pause(); window.__FIGHT__.step(2) })

let at = -1
for (let f = 0; f < 4000; f++) {
  const phase = await page.evaluate(() => {
    window.__FIGHT__.step(1)
    return window.__FIGHT__.phase()
  })
  if (phase === 'juggle') { at = f; break }
}
if (at < 0) {
  console.log('FAILED: no juggle occurred in 4000 frames')
  await browser.close(); process.exit(1)
}
console.log(`juggle began at frame ${at}`)

let stepped = 0
for (const off of OFFSETS) {
  while (stepped < off) {
    await page.evaluate(() => window.__FIGHT__.step(1))
    stepped++
  }
  const phase = await page.evaluate(() => window.__FIGHT__.phase())
  await page.screenshot({ path: `${OUT}/j+${String(off).padStart(2, '0')}.png` })
  console.log(`  wrote j+${off} (phase=${phase})`)
}
await browser.close()
