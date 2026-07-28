// Prove the counter-hit callout reacts to the sim's dedicated `counter-hit`
// event — the HUD treatment for the new counter mechanic.
//
// It drives the preview's deterministic surface (window.__FIGHTHUD__) with the
// sim PAUSED, then pushes a synthetic counter-hit through inject() — the exact
// per-frame path a real frame uses (hudRef.push(state, events)), so FightHud's
// `case 'counter-hit'` runs verbatim. The sim's *real* emission of the event is
// proven separately in src/fight/__tests__/okizeme.test.ts; this proves the
// HUD's reaction to it.
//
// The assertions read the callout out of the live DOM and assert its WINDOW,
// not mere eventual truth — the failure mode this project keeps getting burned
// by. Three bounds make it hard to satisfy while broken:
//   1. BEFORE injection the callout is ABSENT (the scan discriminates state).
//   2. It APPEARS fast (<= 320ms) and is STILL up at mid-life (~560ms) and then
//      GONE by ~1450ms — a callout that never shows, shows forever, or blinks
//      too briefly all go red.
//   3. A heavy counter reads "PUNISH COUNTER" (kicker present, kind=punish); a
//      light counter reads plain "COUNTER" (no kicker, kind=counter) — so a
//      mutant that hard-codes either identity is caught.
//
// Proven able to fail: commenting out `setCounter(...)` in FightHud's
// `case 'counter-hit'` turns every presence check red while the rest of the HUD
// stays green (see report).

import { chromium } from 'playwright-core'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'

const arg = (n, d) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : d)
const PORT = arg('--port', '5399')
const A = arg('--a', 'spiegel')
const B = arg('--b', 'lenny')
const OUT = arg('--out', 'fighthud-shots/counter')
const URL = `http://localhost:${PORT}/?fighthud=1&a=${A}&b=${B}&paused=1`
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
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 })
const errors = []
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
page.on('pageerror', (e) => errors.push(String(e)))

console.log(`counter probe (real sim, injected event) at ${URL}  build ${SHA} -> ${OUT}/`)
await page.goto(URL, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => window.__FIGHTHUD__?.ready?.(), null, { timeout: 30000 })

rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })

const readCallout = () =>
  page.evaluate(() => {
    const el = document.querySelector('[data-testid="fhud-counter"]')
    if (!el) return { present: false }
    const main = (document.querySelector('[data-testid="fhud-counter-main"]')?.textContent || '').trim()
    const kicker = (document.querySelector('.fhud-counter-kicker .fhud-word-fill')?.textContent || '').trim()
    return {
      present: true,
      kind: el.getAttribute('data-kind'),
      side: el.getAttribute('data-side'),
      main,
      kicker,
    }
  })

const inject = (attacker, level, damage) =>
  page.evaluate(
    (e) => window.__FIGHTHUD__.inject([{ type: 'counter-hit', at: { x: 0, y: 0 }, ...e }]),
    { attacker, level, damage },
  )

// Inject once, then poll the callout on a fixed cadence for `budgetMs`,
// recording a (t, present) timeline. Deriving the envelope from one clean loop
// (no screenshots in the middle) is what makes the window measurable — the
// identity is read at first sight, before anything can settle it away.
const sampleLifetime = async (attacker, level, damage, budgetMs = 1700) => {
  const base = Date.now()
  await inject(attacker, level, damage)
  const timeline = []
  let identity = null
  for (;;) {
    const c = await readCallout()
    const t = Date.now() - base
    timeline.push({ t, present: c.present })
    if (c.present && !identity) identity = c
    if (t > budgetMs) break
    await page.waitForTimeout(40)
  }
  const appearedAt = timeline.find((s) => s.present)?.t ?? -1
  const firstAbsentAfter = timeline.find((s) => s.present === false && s.t > appearedAt && appearedAt >= 0)?.t ?? -1
  const lastPresentAt = [...timeline].reverse().find((s) => s.present)?.t ?? -1
  return { appearedAt, firstAbsentAfter, lastPresentAt, identity: identity ?? { present: false } }
}

const checks = []

// ── 0. Discriminator: nothing is up before we inject. ─────────────────────
const before = await readCallout()
checks.push(['callout ABSENT before any counter-hit', before.present === false])

// ── 1. Heavy counter on the LEFT attacker -> "PUNISH COUNTER". ─────────────
const h = await sampleLifetime(0, 'heavy', 120)
const punish = h.identity
checks.push([`heavy counter APPEARS fast (${h.appearedAt}ms, <=320)`, h.appearedAt >= 0 && h.appearedAt <= 320])
checks.push(['heavy counter reads "COUNTER"', punish.main === 'COUNTER'])
checks.push(['heavy counter is kind=punish', punish.kind === 'punish'])
checks.push(['heavy counter shows the "PUNISH" kicker', punish.kicker === 'PUNISH'])
checks.push(['heavy counter leans to attacker side a', punish.side === 'a'])
// Window bounds: still up late in its life (catches a too-brief blink) AND
// actually clears (catches a callout that never leaves).
checks.push([`heavy counter STILL up late in life (last=${h.lastPresentAt}ms, >=800)`, h.lastPresentAt >= 800])
checks.push([
  `heavy counter CLEARS within its window (gone=${h.firstAbsentAfter}ms, 800..1500)`,
  h.firstAbsentAfter >= 800 && h.firstAbsentAfter <= 1500,
])

// ── 2. Light counter on the RIGHT attacker -> plain "COUNTER", no kicker. ──
const l = await sampleLifetime(1, 'light', 24)
const plain = l.identity
checks.push([`light counter APPEARS fast (${l.appearedAt}ms, <=320)`, l.appearedAt >= 0 && l.appearedAt <= 320])
checks.push(['light counter reads "COUNTER"', plain.main === 'COUNTER'])
checks.push(['light counter is kind=counter (NOT punish)', plain.kind === 'counter'])
checks.push(['light counter shows NO kicker', plain.kicker === ''])
checks.push(['light counter leans to attacker side b', plain.side === 'b'])

// ── Screenshots for native 1:1 review — fresh injects, short settle, timing
// already asserted above so these never race the envelope. ─────────────────
await inject(0, 'heavy', 120)
await page.waitForTimeout(300)
writeFileSync(`${OUT}/00-punish-counter.png`, await page.screenshot())
await page.waitForTimeout(1200) // let it clear before the next shot
await inject(1, 'light', 24)
await page.waitForTimeout(300)
writeFileSync(`${OUT}/01-plain-counter.png`, await page.screenshot())

let failed = 0
for (const [label, ok] of checks) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`)
  if (!ok) failed++
}
writeFileSync(`${OUT}/result.json`, JSON.stringify({ build: SHA, punish, plain, errors }, null, 2))
if (errors.length) console.log(`\n  ${errors.length} console errors: ${JSON.stringify(errors.slice(0, 4))}`)

await browser.close()
if (failed) {
  console.log(`\n=== ${failed} FAILURE(S) ===`)
  process.exit(1)
}
console.log('\n=== ALL PASS ===')
