// Item 1: capture the HUD in its BUSY state on the real route + real stage.
//
// Every HUD frame this project has ever produced is the PRISTINE state -- both
// bars full, no combo, empty super, timer in the 90s. A fighting-game HUD is
// not designed for that; it is designed for the moment everything happens at
// once, which is the only state where the elements have to compete for the eye.
// This composes that worst case ON the live pre-pmf stage (so contrast is
// judged against the background we actually ship) and photographs it:
//
//   - one fighter in CRIT (<=25%) with the hazard/pulse tier engaged,
//   - a 5+ hit combo counter mounted and popped, seeded then landed through the
//     REAL applyHit path (D.comboCount += 1 then emits the hit event),
//   - both super stocks full (charged/ready state),
//   - the round timer in single digits (low/blink state),
//   - the damage trail actively draining behind the front bar,
//   - the combo number deliberately stacked over the crit bar with the victim
//     juggled through that same top-left region -- the classic collision.
//
// It ASSERTS each of those is really in the DOM at capture, because a pretty
// screenshot that is silently missing the combo (or the crit class) would be
// exactly the "implemented != has ever been seen" lie this project keeps
// filing. pause() freezes the SIM, not the renderer/React, so framer pops and
// the bar-ease keep advancing on a "paused" frame -- which is what lets the
// trail drain and the combo settle while the sim is held.

import { chromium } from 'playwright-core'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import sharp from 'sharp'

const arg = (n, d) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : d)
const PORT = arg('--port', '5399')
const OUT = 'play-shots/busy'
// cpu=dummy: a passive training dummy that will not walk out of range or block,
// so the one jab we need to land actually connects deterministically.
const URL = `http://localhost:${PORT}/?a=spiegel&b=lenny&p1=warden&p2=operator&cpu=dummy`
const SHA = (() => { try { return execSync('git rev-parse --short HEAD').toString().trim() } catch { return '?' } })()

let reloaded = false
const isNavErr = (e) => /Execution context was destroyed|because of a navigation|Target closed|frame was detached/i.test(String(e))
const fatal = async (msg, browser) => { console.log(`FAILED: ${msg}`); await browser.close(); process.exit(1) }

const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-angle=metal', '--no-sandbox'],
})
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 })
const errors = []
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
page.on('pageerror', (e) => errors.push(String(e)))

console.log(`busy-state capture at ${URL}  build ${SHA} -> ${OUT}/`)
await page.goto(URL, { waitUntil: 'domcontentloaded' })
page.on('framenavigated', (f) => { if (f === page.mainFrame()) reloaded = true })

// --- setup: reach fight, then freeze -------------------------------------
try {
  await page.waitForFunction(() => window.__PLAY__?.ready?.(), null, { timeout: 30000 })
  await page.waitForFunction(() => window.__PLAY__?.state?.().phase === 'fight', null, { timeout: 20000 })
  await page.evaluate(() => window.__PLAY__.pause())
} catch (e) {
  if (reloaded || isNavErr(e)) await fatal('reloaded during setup (storm); rerun in a lull.', browser)
  throw e
}

// --- compose: seed a juggle, then land one real hit ----------------------
// The combo counter is EVENT-DRIVEN: it only mounts when a `hit` event fires,
// reading the defender's comboCount at that instant. There is no event-injection
// surface, so we must land one real jab. We pre-seed the defender's comboCount so
// that single real hit reads as mid-juggle (7 -> 8 = "8 HITS / GREAT"), place the
// two point-blank, and drive the jab through real input across stepped frames.
// A held key only "taps" once, and the pushboxes hold the pair ~100px apart at
// the edge of jab range, so we re-tap + re-close the gap every few frames until
// the hit lands -- proven in the diagnostic to connect within ~5 steps.
const seed = () =>
  page.evaluate(() => {
    const s = window.__PLAY__.state()
    const [A, D] = s.fighters // A = left/attacker (KeyU = player 0), D = right/defender
    A.facing = 1; D.facing = -1
    A.pos.x = 360; D.pos.x = 418          // clamps to ~330/430 -> point-blank
    A.pos.y = 0; D.pos.y = 0
    A.grounded = true; D.grounded = true
    A.stunRemaining = 0; D.stunRemaining = 0
    A.move = undefined
    D.comboCount = 7                       // one real hit -> 8 -> "8 HITS / GREAT"
  })

let comboMounted = false
try {
  await page.evaluate(() => document.body.focus())
  await seed()
  await page.keyboard.down('KeyU')
  for (let i = 0; i < 26 && !comboMounted; i++) {
    if (i > 0 && i % 5 === 0) {           // re-tap + re-close: fresh jab attempt
      await page.keyboard.up('KeyU')
      await seed()
      await page.keyboard.down('KeyU')
    }
    await page.evaluate(() => window.__PLAY__.step(1))
    await page.waitForTimeout(28)
    comboMounted = await page.evaluate(() => !!document.querySelector('[data-testid="fhud-combo"]'))
  }
  await page.keyboard.up('KeyU')
} catch (e) {
  if (reloaded || isNavErr(e)) await fatal('reloaded during the hit drive (storm); rerun in a lull.', browser)
  throw e
}

// --- compose: the worst-case levels, asserted after the hit --------------
// Re-assert AFTER stepping so the final frame is exactly the busy composition:
// attacker (combo side) in crit, defender mid with a draining trail, both super
// stocks full, timer in single digits, victim juggled through the combo region.
await page.evaluate(() => {
  const s = window.__PLAY__.state()
  const [A, D] = s.fighters
  A.health = Math.round(A.maxHealth * 0.15)   // crit + hazard, UNDER the left combo counter
  D.health = Math.round(D.maxHealth * 0.34)   // warn tier, front bar drains toward the trail
  A.meter = 2000; D.meter = 2000              // both stocks full -> charged/ready
  s.timer = 200                               // ~3s -> single-digit low/blink
  // Sling the victim to the LEFT/upper region the combo counter (left 8%) and the
  // attacker's crit bar both occupy, airborne, so the worst-case collision
  // (number vs bar vs body) is actually on screen to be judged.
  D.pos.x = 330; D.pos.y = 250; D.grounded = false; D.stance = 'juggle'
})
await page.waitForTimeout(320) // bars ease toward the new targets; trail lags => draining; combo pop settles

// --- read the state back: assert the busy elements are really present ----
let dom
try {
  dom = await page.evaluate(() => {
    const q = (s) => document.querySelector(s)
    const comboEl = q('[data-testid="fhud-combo"]')
    const countEl = q('[data-testid="fhud-combo-count"]')
    const count = countEl ? parseInt((countEl.textContent || '').replace(/\D+/g, ''), 10) : 0
    const critWraps = [...document.querySelectorAll('.fhud-hpwrap.crit')].map((w) => w.className)
    const charged = [...document.querySelectorAll('.fhud-superrow.charged')].length
    const timerLow = !!q('.fhud-timernum.low')
    return {
      comboPresent: !!comboEl,
      comboCount: count,
      comboRank: q('[data-testid="fhud-combo-rank"]')?.textContent ?? null,
      critCount: critWraps.length,
      superCharged: charged,
      timerLow,
    }
  })
} catch (e) {
  if (reloaded || isNavErr(e)) await fatal('reloaded before readback (storm); rerun in a lull.', browser)
  throw e
}

if (reloaded) await fatal('page reloaded during composition; the frame would be a restarted match.', browser)

rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })
const buf = await page.screenshot()
writeFileSync(`${OUT}/busy-full.png`, buf)
// Top HUD band + the combo/crit collision zone, at native res for a 1:1 read.
await sharp(buf).extract({ left: 0, top: 0, width: 3200, height: 360 }).toFile(`${OUT}/busy-top.png`)
await sharp(buf).extract({ left: 0, top: 0, width: 1200, height: 900 }).toFile(`${OUT}/busy-leftzone.png`)

console.log(`  combo: present=${dom.comboPresent} count=${dom.comboCount} rank=${dom.comboRank}`)
console.log(`  crit wraps: ${dom.critCount}   super charged rows: ${dom.superCharged}   timer low: ${dom.timerLow}`)
if (errors.length) console.log(`  ${errors.length} console errors: ${JSON.stringify(errors.slice(0, 3))}`)

// Honest gate: this capture only means something if the busy elements ARE up.
const checks = [
  ['combo mounted with count >= 5', dom.comboPresent && dom.comboCount >= 5],
  ['at least one bar in crit', dom.critCount >= 1],
  ['at least one super stock charged', dom.superCharged >= 1],
  ['timer in low state', dom.timerLow],
]
let failed = 0
for (const [label, ok] of checks) { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`); if (!ok) failed++ }

await browser.close()
if (failed) { console.log(`\n=== ${failed} busy element(s) never mounted; the frame is not the state we meant to judge ===`); process.exit(1) }
console.log(`\n=== busy frame composed; open ${OUT}/busy-top.png and busy-leftzone.png ===`)
