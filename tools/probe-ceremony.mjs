// Prove the match ceremony on the *real* sim: FIGHT! -> K.O. -> ... -> WINS.
//
// This drives HarnessSim through the preview's deterministic step surface
// (window.__FIGHTHUD__), the same sim the real match runs. It forces a KO by
// zeroing the loser's health and stepping one real frame — the ko event, the
// phase machine and every announcement run through the ordinary path; only the
// health is a shortcut, exactly as tools/ceremony-shots.mjs does for play mode.
//
// The assertions read banner *text out of the DOM*. Two guards make this hard
// to satisfy while broken:
//   1. At the KO frame, WINS must be ABSENT — proving the text scan discriminates
//      states rather than always reporting a match. (If the WINS trigger fired on
//      every frame, or the scan were always-true, this goes red.)
//   2. At match-end, WINS must be PRESENT and its kicker must equal the winning
//      side's health-bar name — proving it names the right fighter, not a
//      hard-coded string.
//
// Proven able to fail: commenting out the match-end pushAnnounce in FightHud.tsx
// turns "match-end shows WINS" red while everything else stays green (reported).

import { chromium } from 'playwright-core'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'

const arg = (n, d) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : d)
const PORT = arg('--port', '5399')
const A = arg('--a', 'spiegel')
const B = arg('--b', 'lenny')
const OUT = arg('--out', 'fighthud-shots/ceremony')
const URL = `http://localhost:${PORT}/?fighthud=1&a=${A}&b=${B}`
const SHA = (() => {
  try {
    return execSync('git rev-parse --short HEAD').toString().trim()
  } catch {
    return '?'
  }
})()

const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-angle=metal', '--no-sandbox'],
})
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 })
const errors = []
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
page.on('pageerror', (e) => errors.push(String(e)))

// paused=1: the sim only advances when we call step(), so capture() can never
// let it auto-run past the beat we're trying to photograph.
console.log(`ceremony probe (real sim) at ${URL}&paused=1  build ${SHA} -> ${OUT}/`)
await page.goto(`${URL}&paused=1`, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => window.__FIGHTHUD__?.ready?.(), null, { timeout: 30000 })

rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })

// The only strings the announcement layer renders.
const bannerText = () =>
  page.evaluate(() => {
    const stack = document.querySelector('.fhud-announce-stack')
    if (!stack) return { present: false, words: [] }
    const words = [...stack.querySelectorAll('.fhud-word-fill')].map((el) => (el.textContent || '').trim())
    return { present: true, words }
  })
const sideName = (side) =>
  page.evaluate(
    (s) => (document.querySelector(`.fhud-hpwrap.${s} .fhud-name`)?.textContent || '').trim(),
    side,
  )
const realPhase = () => page.evaluate(() => window.__FIGHTHUD__.state().phase)

const checks = []
const capture = async (name) => {
  await page.waitForTimeout(680) // let framer settle the pop (rAF runs while sim is paused)
  writeFileSync(`${OUT}/${name}.png`, await page.screenshot())
}

// ── Drive: intro -> fight, then force a match-deciding KO. ────────────────
// Read the *real* phase off state(); __FIGHTHUD__.phase() is a beat label
// (idle/attack/hit...) during fight and never equals 'fight'.
await page.evaluate(() => {
  const F = window.__FIGHTHUD__
  for (let i = 0; i < 400 && F.state().phase !== 'fight'; i++) F.step(1)
  const s = F.state()
  // wins [1,0] so a single KO makes it [2,0] and round-end resolves to match-end.
  s.wins[0] = 1
  s.wins[1] = 0
  s.fighters[1].health = 0
  for (let i = 0; i < 30 && F.state().phase === 'fight'; i++) F.step(1)
})
const koPhase = await realPhase()
await page.waitForTimeout(700) // let React flush the KO announce before reading
const koBanner = await bannerText()
await capture('01-ko')
console.log(`  KO frame: phase=${koPhase} banner=${JSON.stringify(koBanner.words)}`)

const winName = await sideName('a')

// ── Drive: ko -> round-end -> match-end (phases just count down). ──────────
await page.evaluate(() => {
  const F = window.__FIGHTHUD__
  for (let i = 0; i < 600 && F.state().phase !== 'match-end'; i++) F.step(1)
})
const endPhase = await realPhase()
await page.waitForTimeout(700)
const winBanner = await bannerText()
await capture('02-wins')
console.log(`  WINS frame: phase=${endPhase} banner=${JSON.stringify(winBanner.words)}  winner="${winName}"`)

const hasWord = (b, w) => b.words.some((t) => t.toUpperCase() === w)
const anyIncludes = (b, w) => b.words.some((t) => t.toUpperCase().includes(w))

checks.push(['reached ko phase on a forced KO', koPhase === 'ko'])
checks.push(['KO frame shows the K.O. banner', anyIncludes(koBanner, 'K.O.') || anyIncludes(koBanner, 'K.O')])
// Discriminator: WINS must NOT be up yet at the KO — the winner still has to pose.
checks.push(['KO frame does NOT show WINS yet (scan discriminates)', !hasWord(koBanner, 'WINS')])
checks.push(['reached match-end phase', endPhase === 'match-end'])
checks.push(['match-end shows the WINS banner', hasWord(winBanner, 'WINS')])
checks.push([
  'WINS is attributed to the winning side (kicker == winner name)',
  winName.length > 0 && hasWord(winBanner, winName.toUpperCase()),
])

let failed = 0
for (const [label, ok] of checks) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`)
  if (!ok) failed++
}
writeFileSync(`${OUT}/result.json`, JSON.stringify({ build: SHA, koBanner, winBanner, winName, errors }, null, 2))
if (errors.length) console.log(`\n  ${errors.length} console errors: ${JSON.stringify(errors.slice(0, 4))}`)

await browser.close()
if (failed) {
  console.log(`\n=== ${failed} FAILURE(S) ===`)
  process.exit(1)
}
console.log('\n=== ALL PASS ===')
