// Proves the health-bar damage trail: start a match, then knock a big chunk of
// HP off P1 and grab frames while the fill has snapped down but the ghost trail
// is still draining behind it.
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d }
const PORT = arg('port', '5310')
const OUT = arg('out', 'review-shots/trail')
mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch({
  headless: false,
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-angle=metal', '--window-position=4000,4000', '--hide-scrollbars'],
})
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' })
await sleep(600); await page.mouse.click(800, 450); await sleep(1600)
await page.evaluate(async () => { await Promise.all([import('/src/screens/CombatScreen.tsx'), import('/src/screens/MatchEnd.tsx'), import('/src/screens/PreFight.tsx')]) })
await sleep(600)
await page.evaluate(() => window.__game.getState().startMatch('chesky', 'doshi', 'hypergrowth'))
await sleep(6500)
// Knock P1 from full to ~45% in one blow.
await page.evaluate(() => {
  const s = window.__game.getState()
  window.__game.setState({ fighterA: { ...s.fighterA, hp: Math.round(s.fighterA.maxHp * 0.45) } })
})
for (const ms of [150, 350, 600, 1000]) {
  await sleep(ms - (globalThis.__last || 0))
  globalThis.__last = ms
  await page.screenshot({ path: `${OUT}/trail-${String(ms).padStart(4, '0')}.png` })
}
await browser.close(); console.log('trail frames written')
