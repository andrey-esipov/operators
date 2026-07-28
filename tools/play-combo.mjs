// Drive a REAL match at ?play=1&cpu=dummy with real keyboard input, land a
// multi-hit combo on the stationary dummy, and verify the HUD combo counter
// against the live sim: appears at 2+, its peak matches the sim's peak, and it
// CLEARS after the combo drops. Everything is read from the real DOM + the real
// sim (window.__PLAY__), never inferred from a tool exit code.
import { chromium } from 'playwright-core'

const OUT = 'fighthud-shots'
const browser = await chromium.launch({
  headless: false,
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-angle=metal', '--window-position=4000,4000', '--hide-scrollbars'],
})
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })
await page.goto('http://localhost:5399/?play=1&cpu=dummy', { waitUntil: 'load' })
// Wait for a STABLE mount: React StrictMode double-mounts in dev, which briefly
// deletes window.__PLAY__ mid-boot. Require it present and in the fight phase
// across several consecutive polls so we don't drive a torn-down instance.
let stable = 0
for (let i = 0; i < 400 && stable < 15; i++) {
  let ok = false
  try {
    ok = await page.evaluate(() => !!window.__PLAY__?.ready?.() && window.__PLAY__.state().phase === 'fight')
  } catch {
    ok = false // transient context teardown during boot — treat as not-yet-stable
  }
  stable = ok ? stable + 1 : 0
  await page.waitForTimeout(30)
}
if (stable < 15) throw new Error('play route never settled into a stable fight phase')
await page.mouse.click(800, 450) // focus the canvas so window keydowns fire

const sample = () =>
  evalWithRetry(() => {
    const play = window.__PLAY__
    if (!play) return { gap: 0, simCombo: 0, dummyHp: 0, hudVisible: false, hudNum: null, hudRank: null, dead: true }
    const st = play.state()
    const el = document.querySelector('[data-testid=fhud-combo-count]')
    const wrap = document.querySelector('[data-testid=fhud-combo]')
    const rank = document.querySelector('[data-testid=fhud-combo-rank]')
    const hudNum = el ? parseInt(el.textContent.replace(/[^0-9]/g, ''), 10) : null
    return {
      gap: Math.round(st.fighters[1].pos.x - st.fighters[0].pos.x),
      simCombo: Math.max(st.fighters[0].comboCount, st.fighters[1].comboCount),
      dummyHp: Math.round(st.fighters[1].health),
      hudVisible: !!wrap,
      hudNum: wrap ? hudNum : null,
      hudRank: rank ? rank.textContent.trim() : null,
      // P1 actionability, for feedback-driven link timing.
      actionable: play.actionable ? play.actionable(0) : (st.fighters[0].stance !== 'attack' && st.hitstop === 0 && st.fighters[0].stunRemaining === 0),
      stance0: st.fighters[0].stance,
    }
  })

// A dev-server HMR reload (another agent saving a file, or StrictMode's
// double-mount) can destroy the page's execution context mid-evaluate. That is
// a transient environment blip, not a HUD failure, so retry a few times rather
// than crashing the probe on it.
async function evalWithRetry(fn, tries = 6) {
  for (let i = 0; ; i++) {
    try {
      return await page.evaluate(fn)
    } catch (err) {
      if (i >= tries - 1 || !/Execution context was destroyed|navigation/i.test(String(err))) throw err
      await page.waitForTimeout(120)
    }
  }
}

const timeline = []
const rec = async (tag) => {
  const s = await sample()
  timeline.push({ t: Date.now(), tag, ...s })
  return s
}

// ── Phase A: walk into the dummy until the pushboxes touch ────────────────
await page.keyboard.down('KeyD')
let closed = false
for (let i = 0; i < 200 && !closed; i++) {
  const s = await rec('walk')
  if (s.gap <= 95) closed = true
  else await page.waitForTimeout(20)
}
await page.keyboard.up('KeyD')
console.log('closed to gap:', (await sample()).gap)

// ── Phase B: feedback-driven jab links ────────────────────────────────────
// The sim has no input buffer and blocks cancel-into-same-id, so the reliable
// way to chain is to LINK: press LP again the instant P1 becomes actionable,
// while the dummy is still in the jab's 13f hitstun (jab is +5 on hit). We read
// actionability straight from the sim rather than guessing a fixed delay.
await page.keyboard.up('KeyD')
await page.waitForTimeout(40)

let firstShotDone = false
let peak = 0

const linkChain = async (label, presses) => {
  // re-close to point blank
  await page.keyboard.down('KeyD')
  for (let i = 0; i < 140; i++) { const s = await rec('reclose'); if (s.gap <= 100) break; await page.waitForTimeout(16) }
  await page.keyboard.up('KeyD')
  await page.waitForTimeout(30)
  for (let n = 0; n < presses; n++) {
    await page.keyboard.press('KeyU') // st.LP
    // wait until the jab has started, then until P1 is actionable again
    let sawAttack = false
    for (let k = 0; k < 20; k++) {
      const s = await rec(label)
      if (s.simCombo > peak) peak = s.simCombo
      if (!firstShotDone && s.hudVisible && s.hudNum >= 2) {
        await page.screenshot({ path: `${OUT}/play-combo-appears.png` }); firstShotDone = true
      }
      if (s.simCombo >= 3) await page.screenshot({ path: `${OUT}/play-combo-peak.png` })
      if (s.stance0 === 'attack') sawAttack = true
      if (sawAttack && s.actionable) break // press again immediately -> link
      await page.waitForTimeout(12)
    }
  }
}
await linkChain('linkA', 14)
await page.screenshot({ path: `${OUT}/play-combo-peak.png` })
await page.waitForTimeout(700)
await linkChain('linkB', 14)
// capture near the peak
await page.screenshot({ path: `${OUT}/play-combo-peak.png` })
await page.keyboard.up('KeyD')

// ── Phase C: stop, let the combo drop, verify the counter clears ──────────
await page.waitForTimeout(1800)
const cleared = await rec('cleared')
await page.screenshot({ path: `${OUT}/play-combo-cleared.png` })

// peak of what the HUD actually displayed
const hudPeak = Math.max(0, ...timeline.map((s) => s.hudNum ?? 0))
const simPeak = Math.max(0, ...timeline.map((s) => s.simCombo ?? 0))
const bestRank = timeline.map((s) => s.hudRank).filter(Boolean).pop() ?? null

console.log('--- timeline (combo window) ---')
for (const s of timeline.filter((s) => s.tag !== 'walk' && (s.simCombo > 0 || s.hudVisible))) {
  console.log(`  ${s.tag} gap=${s.gap} sim=${s.simCombo} hud=${s.hudNum} vis=${s.hudVisible} rank=${s.hudRank ?? '-'} dhp=${s.dummyHp}`)
}
console.log('--- results ---')
console.log('sim peak combo   :', simPeak)
console.log('hud peak combo   :', hudPeak)
console.log('hud best rank    :', bestRank)
console.log('cleared (after 1.8s idle) — hudVisible:', cleared.hudVisible, 'hudNum:', cleared.hudNum)

const checks = [
  ['HUD combo appeared at 2+', hudPeak >= 2],
  ['HUD peak matches sim peak', hudPeak === simPeak && simPeak >= 2],
  ['HUD combo cleared after the drop', cleared.hudVisible === false],
]
let fails = 0
for (const [name, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
  if (!ok) fails++
}
console.log(fails ? `=== ${fails} FAILURE(S) ===` : '=== ALL PASS ===')
await browser.close()
process.exit(fails ? 1 : 0)
