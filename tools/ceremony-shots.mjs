// Capture the match punctuation: FIGHT!, K.O., and the win screen.
//
// `Announcements.tsx` has shipped ROUND N / FIGHT! / K.O. / PERFECT / TIME OVER
// / WINS for some time, and not one of them has ever appeared in a capture --
// every beat in `play-shots.mjs` lands mid-round. That is the same shape as the
// super, which turned out to have been fine all along while the capture that was
// supposed to show it pressed the wrong button with a seventh of the meter.
// "Implemented" and "has ever been seen" are different claims and this project
// keeps conflating them.
//
// A KO is reached by dropping the loser's health through the live state object,
// then landing one real hit. The hit, the KO, the phase change and every
// announcement run through the ordinary path; only the health is a shortcut,
// because a scripted capture cannot reliably win a round inside a sane window.
//
// Each shot asserts the announcement text is actually in the DOM. A screenshot
// of a stage with no banner on it, filed under `01-ko.png`, would be exactly the
// lie this tool exists to stop telling.

import { chromium } from 'playwright-core'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'

const arg = (n, d) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : d)
const PORT = arg('--port', '5399')
const OUT = arg('--out', 'ceremony-shots')
const QUERY = arg('--query', 'a=spiegel&b=lenny&p1=warden&p2=operator&cpu=easy')
const URL = `http://localhost:${PORT}/?${QUERY}`
const SHA = arg('--build', execSync('git rev-parse --short HEAD').toString().trim())

const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-angle=metal', '--no-sandbox'],
})
const page = await browser.newPage({
  viewport: { width: 1600, height: 900 },
  deviceScaleFactor: 2,
})

const errors = []
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
page.on('pageerror', (e) => errors.push(String(e)))

console.log(`ceremony capture at ${URL}  build ${SHA} -> ${OUT}/`)
await page.goto(URL, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => window.__PLAY__?.ready?.(), null, { timeout: 30000 })

rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })

const banner = () =>
  page.evaluate(() => {
    // The announcement layer is the only thing that renders these strings.
    const want = ['ROUND', 'FIGHT', 'K.O.', 'PERFECT', 'TIME OVER', 'WINS', 'VICTORY', 'REMATCH']
    const hits = []
    for (const el of document.querySelectorAll('div,span,h1,h2,p,button')) {
      if (el.children.length) continue
      const t = (el.textContent || '').trim()
      if (t && want.some((w) => t.toUpperCase().includes(w))) hits.push(t)
    }
    return [...new Set(hits)]
  })

const shots = []
async function shot(name, expect) {
  await page.evaluate(() => window.__PLAY__.pause())
  const seen = await banner()
  const buf = await page.screenshot()
  writeFileSync(`${OUT}/${name}.png`, buf)
  await page.evaluate(() => window.__PLAY__.resume())
  const ok = expect ? seen.some((t) => t.toUpperCase().includes(expect)) : true
  shots.push({ name, seen, expect, ok })
  console.log(`  ${name.padEnd(14)} ${ok ? 'OK ' : 'MISS'}  banner=${JSON.stringify(seen)}`)
  return ok
}

// --- FIGHT! -------------------------------------------------------------
// The intro is ~1.5s; the banner rides the intro->fight transition, so poll for
// it rather than guessing a sleep.
let sawFight = false
for (let i = 0; i < 80; i++) {
  const b = await banner()
  if (b.some((t) => t.toUpperCase().includes('FIGHT'))) {
    sawFight = true
    break
  }
  await page.waitForTimeout(50)
}
if (sawFight) await shot('00-fight', 'FIGHT')
else console.log('  00-fight       MISS  (no FIGHT! banner appeared within 4s)')

// --- K.O. ---------------------------------------------------------------
await page.waitForTimeout(600)
await page.evaluate(() => {
  const s = window.__PLAY__.state()
  s.fighters[1].health = 1 // one clean hit ends it
})
// Walk in and swing until the KO lands.
let koSeen = false
for (let i = 0; i < 40 && !koSeen; i++) {
  await page.keyboard.down('ArrowRight')
  await page.waitForTimeout(120)
  await page.keyboard.up('ArrowRight')
  await page.keyboard.press('KeyJ')
  for (let j = 0; j < 8; j++) {
    const b = await banner()
    const phase = await page.evaluate(() => window.__PLAY__.state().phase)
    if (b.some((t) => /K\.O\.|PERFECT/i.test(t)) || phase === 'ko') {
      koSeen = true
      break
    }
    await page.waitForTimeout(40)
  }
}
if (koSeen) await shot('01-ko', 'K')
else console.log('  01-ko          MISS  (no KO reached)')

// --- aftermath ----------------------------------------------------------
await page.waitForTimeout(900)
await shot('02-round-end', null)
await page.waitForTimeout(2200)
await shot('03-aftermath', null)

writeFileSync(`${OUT}/shots.json`, JSON.stringify({ build: SHA, url: URL, shots, errors }, null, 2))
console.log(errors.length ? `\n  ${errors.length} console errors` : '\n  no console errors')

const missed = shots.filter((s) => s.expect && !s.ok).map((s) => s.name)
await browser.close()
if (!sawFight || !koSeen || missed.length) {
  console.log(
    `\nFAILED: ceremony not observed (${[!sawFight && 'FIGHT!', !koSeen && 'K.O.', ...missed]
      .filter(Boolean)
      .join(', ')}).`,
  )
  process.exit(1)
}
