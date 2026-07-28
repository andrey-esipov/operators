// Character-select capture + handoff proof.
//
// Two jobs, both asserted so a green run means something:
//
//   A. Compose and photograph the BUSY select state -- one side LOCKED, the
//      other HOVERING -- on the real ?select=1 route. The pristine initial
//      frame (nothing picked) is not where a select screen either holds or
//      falls apart; the moment one nameplate has filled in and the cursor is
//      live on the grid is. It ASSERTS phase==='p2', p1 locked to the fighter
//      we chose, and a cursor cell present, because a pretty screenshot that
//      silently lost the lock would be exactly the "looks done, isn't" lie.
//
//   B. Prove the HANDOFF: drive select all the way through stage lock, follow
//      the navigation it triggers, and assert window.__PLAY__ boots a live
//      match with the fighters + stage we picked and reaches phase 'fight'.
//      This is the whole point of the screen -- a pick that doesn't start the
//      right match is worthless -- and it doubles as the check that an explicit
//      matchup in the query still boots straight into the fight.
//
// Proven falsifiable: skip the P1 confirm (SKIP_LOCK=1) and the "p1 locked"
// assertion goes red + exits 1.

import { chromium } from 'playwright-core'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import sharp from 'sharp'

const arg = (n, d) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : d)
const PORT = arg('--port', '5399')
const OUT = 'play-shots/select'
const SKIP_LOCK = process.env.SKIP_LOCK === '1' // falsifiability switch
const SHA = (() => { try { return execSync('git rev-parse --short HEAD').toString().trim() } catch { return '?' } })()

let reloaded = false
const isNavErr = (e) => /Execution context was destroyed|because of a navigation|Target closed|frame was detached/i.test(String(e))
const fail = async (msg, browser) => { console.log(`FAILED: ${msg}`); await browser.close(); process.exit(1) }

const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-angle=metal', '--no-sandbox'],
})
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 })
const errors = []
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
page.on('pageerror', (e) => errors.push(String(e)))

const SELECT_URL = `http://localhost:${PORT}/?select=1`
console.log(`select capture at ${SELECT_URL}  build ${SHA} -> ${OUT}/`)
await page.goto(SELECT_URL, { waitUntil: 'domcontentloaded' })
// framenavigated only guards the SELECT phase; the handoff navigation is expected.
const navGuard = (f) => { if (f === page.mainFrame()) reloaded = true }
page.on('framenavigated', navGuard)

const P1_SKIN = 'chesky'    // roster idx 0, operator/shoto
const P2_SKIN = 'madhavan'  // roster idx 4, vanguard/grappler
const P1_IDX = 0
const P2_IDX = 4

try {
  await page.waitForFunction(() => window.__SELECT__?.ready?.(), null, { timeout: 30000 })
} catch (e) {
  if (reloaded || isNavErr(e)) await fail('reloaded during setup (storm); rerun in a lull.', browser)
  throw e
}

// --- compose the busy state: P1 locked, P2 hovering ----------------------
// Every __SELECT__ drive re-checks the surface exists and that no reload has
// landed: a storm reload resets the picks, so continuing would compose (and
// then assert) the wrong state -- exactly the silent-wrong-frame failure this
// project keeps filing. During the SELECT phase a reload is therefore fatal.
const guardSelect = async (where) => {
  if (reloaded) await fail(`reloaded during ${where} (storm); rerun in a lull.`, browser)
  try {
    await page.waitForFunction(() => !!window.__SELECT__, null, { timeout: 3000 })
  } catch (e) {
    if (isNavErr(e)) await fail(`reloaded during ${where} (storm); rerun in a lull.`, browser)
    throw e
  }
}

await guardSelect('P1 compose')
await page.evaluate(([p1, skip]) => {
  window.__SELECT__.setCursor(p1)
  if (!skip) window.__SELECT__.confirm() // lock P1, advance to p2
}, [P1_IDX, SKIP_LOCK])
await page.waitForTimeout(120)
await guardSelect('P2 hover')
await page.evaluate((p2) => window.__SELECT__.setCursor(p2), P2_IDX) // hover P2, do NOT confirm
await page.waitForTimeout(260) // cursor pop + confirm-edge settle

// --- read back + assert the busy composition -----------------------------
let s
try {
  s = await page.evaluate(() => {
    const st = window.__SELECT__.state()
    const lockedPlate = !!document.querySelector('.fsel-plate.a.locked')
    const cursorCell = document.querySelector('.fsel-cell.cursor')?.getAttribute('data-skin') ?? null
    const readout = document.querySelector('[data-testid="fsel-readout"]')?.textContent ?? null
    return { ...st, lockedPlate, cursorCell, readout }
  })
} catch (e) {
  if (reloaded || isNavErr(e)) await fail('reloaded before select readback (storm); rerun in a lull.', browser)
  throw e
}
if (reloaded) await fail('page reloaded during select composition.', browser)

rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })
const selBuf = await page.screenshot({ animations: 'disabled' })
writeFileSync(`${OUT}/select-busy.png`, selBuf)
await sharp(selBuf).extract({ left: 0, top: 0, width: 3200, height: 1000 }).toFile(`${OUT}/select-busy-top.png`)

console.log(`  phase=${s.phase} p1=${s.p1} p2(hover cell)=${s.cursorCell} lockedPlate=${s.lockedPlate}`)
console.log(`  readout: ${JSON.stringify((s.readout || '').replace(/\s+/g, ' ').trim().slice(0, 80))}`)

const selectChecks = [
  ['advanced to P2 phase', s.phase === 'p2'],
  [`P1 locked to ${P1_SKIN}`, s.p1 === P1_SKIN],
  ['P1 nameplate shows locked', s.lockedPlate],
  [`cursor hovering ${P2_SKIN}`, s.cursorCell === P2_SKIN],
]

// --- drive a stage frame too (busy stage-select) -------------------------
await guardSelect('P2 lock')
await page.evaluate((p2) => { window.__SELECT__.setCursor(p2); window.__SELECT__.confirm() }, P2_IDX) // lock P2 -> stage
await page.waitForTimeout(160)
await guardSelect('stage hover')
await page.evaluate(() => window.__SELECT__.setCursor(1)) // hover 2nd stage
await page.waitForTimeout(220)
const stageBuf = await page.screenshot({ animations: 'disabled' })
writeFileSync(`${OUT}/select-stage.png`, stageBuf)
const stagePhase = await page.evaluate(() => window.__SELECT__.state().phase)
console.log(`  stage phase=${stagePhase}`)

// --- Part B: the handoff. Lock a stage, follow the nav, assert the match. -
await guardSelect('stage lock')
await page.evaluate(() => window.__SELECT__.setCursor(0)) // pre-pmf
await page.waitForTimeout(140) // let the cursor commit before confirming (avoid stale-read)
await guardSelect('stage confirm')
page.off('framenavigated', navGuard) // navigation is expected from here
await page.evaluate(() => window.__SELECT__.confirm()) // lock pre-pmf -> launch -> navigates
let play
try {
  await page.waitForFunction(() => window.__PLAY__?.ready?.(), null, { timeout: 30000 })
  await page.waitForFunction(() => window.__PLAY__?.state?.().phase === 'fight', null, { timeout: 20000 })
  play = await page.evaluate(() => {
    const st = window.__PLAY__.state()
    return { phase: st.phase, url: location.search }
  })
} catch (e) {
  await fail(`handoff never reached a live fight: ${String(e).slice(0, 120)}`, browser)
}
const urlHasPick = play.url.includes(`a=${P1_SKIN}`) && play.url.includes(`b=${P2_SKIN}`) && play.url.includes('stage=pre-pmf')
console.log(`  handoff url=${play.url} phase=${play.phase}`)

const handoffChecks = [
  ['handoff URL carries the picked matchup', urlHasPick],
  ['match booted to phase fight', play.phase === 'fight'],
]

if (errors.length) console.log(`  ${errors.length} console errors: ${JSON.stringify(errors.slice(0, 3))}`)

const all = [...selectChecks, ...handoffChecks]
let failed = 0
for (const [label, ok] of all) { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`); if (!ok) failed++ }

await browser.close()
if (failed) { console.log(`\n=== ${failed} check(s) failed ===`); process.exit(1) }
console.log(`\n=== select captured + handoff proven; open ${OUT}/select-busy-top.png and select-stage.png ===`)
