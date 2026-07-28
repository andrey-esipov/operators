// Drive a REAL match at ?play=1&cpu=dummy to an actual KO and verify the HUD's
// finishing-blow drama fires with real sim timing: the KO screen flash
// (ScreenFx) and the "K.O." announcement. Per the project's anti-lying rule,
// everything is read from the real DOM + live sim (window.__PLAY__) at the
// moment the sim's phase leaves 'fight' — never inferred from a tool exit code,
// and never from the ?fighthud=1 preview (which has fake timing).
import { chromium } from 'playwright-core'

const OUT = 'fighthud-shots'
const browser = await chromium.launch({
  headless: false,
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-angle=metal', '--window-position=4000,4000', '--hide-scrollbars'],
})
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })
await page.goto('http://localhost:5399/?play=1&cpu=dummy', { waitUntil: 'load' })

async function evalWithRetry(fn, arg, tries = 6) {
  for (let i = 0; ; i++) {
    try {
      return await page.evaluate(fn, arg)
    } catch (err) {
      if (i >= tries - 1 || !/Execution context was destroyed|navigation/i.test(String(err))) throw err
      await page.waitForTimeout(120)
    }
  }
}

// Wait for a stable fight phase (StrictMode double-mount guard).
let stable = 0
for (let i = 0; i < 400 && stable < 15; i++) {
  let ok = false
  try {
    ok = await page.evaluate(() => !!window.__PLAY__?.ready?.() && window.__PLAY__.state().phase === 'fight')
  } catch {
    ok = false
  }
  stable = ok ? stable + 1 : 0
  await page.waitForTimeout(30)
}
if (stable < 15) throw new Error('play route never settled into a stable fight phase')
await page.mouse.click(800, 450) // focus canvas for window keydowns

const sample = () =>
  evalWithRetry(() => {
    const play = window.__PLAY__
    if (!play) return { dead: true }
    const st = play.state()
    const q = (s) => document.querySelector(`[data-testid=${s}]`)
    const main = q('fhud-announce-main')
    return {
      phase: st.phase,
      hp1: Math.round(st.fighters[1].health),
      combo1: st.fighters[1].comboCount,
      gap: Math.round(st.fighters[1].pos.x - st.fighters[0].pos.x),
      actionable: play.actionable ? play.actionable(0) : (st.fighters[0].stance !== 'attack' && st.hitstop === 0 && st.fighters[0].stunRemaining === 0),
      koFx: !!q('fhud-fx-ko'),
      wipe: !!q('fhud-fx-wipe'),
      announce: main ? main.textContent.trim() : null,
    }
  })

// ── Drain the dummy to 0 HP ──────────────────────────────────────────────
// The dummy stands still and never blocks, so every hit lands. To KO quickly we
// land FRESH heavies (KeyO): combo scaling would decay a long string's hits to
// the ~5 dmg floor, so instead we only strike when the dummy's comboCount is 0
// (i.e. the previous hitstun has fully expired and the combo reset) — every hit
// then does full damage. We step back into range after each heavy's pushback.
// We watch the sim's phase: the moment it leaves 'fight' the KO has happened.
let sawKoFx = false
let sawKoText = false
let sawWipe = false
let koAt = null
let firstAfterFight = null
let lastLog = 0
const deadline = Date.now() + 120_000

async function press(key) {
  await page.keyboard.down(key)
  await page.waitForTimeout(16)
  await page.keyboard.up(key)
}

outer: while (Date.now() < deadline) {
  const s = await sample()
  if (s.dead) { await page.waitForTimeout(60); continue }

  if (s.phase !== 'fight') {
    // KO / round transition reached — capture the drama window.
    if (!koAt) {
      koAt = Date.now()
      firstAfterFight = s
      console.log('phase left fight →', s.phase, 'hp1=', s.hp1)
    }
    break outer
  }

  if (Date.now() - lastLog > 4000) { lastLog = Date.now(); console.log('  draining… hp1=', s.hp1, 'gap=', s.gap) }

  if (s.gap > 116) {
    await page.keyboard.down('KeyD')
    await page.waitForTimeout(80)
    await page.keyboard.up('KeyD')
    continue
  }
  // In range. Only strike when the dummy is at combo 0 (fresh, unscaled) and we
  // are actionable — otherwise wait for the previous hitstun to expire.
  if (s.actionable && s.combo1 === 0) {
    await press('KeyO') // st.HP — heavy, full damage on a fresh hit
    await page.waitForTimeout(40)
  } else {
    await page.waitForTimeout(24)
  }
}

// ── Capture the drama for ~2.2s after the phase left 'fight' ──────────────
// KO flash lives ~1.6s and the "K.O." announcement a beat longer; a round wipe
// then sweeps on the next round-start. Poll fast and screenshot the flash.
let shotFlash = false
const capEnd = Date.now() + 2600
while (Date.now() < capEnd) {
  const s = await sample()
  if (s.dead) { await page.waitForTimeout(40); continue }
  if (s.koFx) {
    sawKoFx = true
    if (!shotFlash) {
      shotFlash = true
      await page.screenshot({ path: `${OUT}/play-ko-flash.png` })
    }
  }
  if (s.announce && /K\.?O/i.test(s.announce)) {
    sawKoText = true
    await page.screenshot({ path: `${OUT}/play-ko-announce.png` })
  }
  if (s.wipe) sawWipe = true
  await page.waitForTimeout(30)
}

console.log('--- results ---')
console.log('phase after fight :', firstAfterFight?.phase, '(hp1 at KO:', firstAfterFight?.hp1, ')')
console.log('saw KO screen flash (fhud-fx-ko) :', sawKoFx)
console.log('saw "K.O." announcement          :', sawKoText)
console.log('saw round wipe (fhud-fx-wipe)    :', sawWipe, '(secondary — fires on next round-start)')

const checks = [
  ['Sim reached a KO (dummy HP hit 0, phase left fight)', firstAfterFight?.phase === 'ko' || firstAfterFight?.hp1 === 0],
  ['HUD KO screen flash fired in the real match', sawKoFx],
  ['HUD "K.O." announcement fired in the real match', sawKoText],
]
let fails = 0
for (const [name, ok] of checks) {
  if (!ok) fails++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
}
console.log(fails ? `=== ${fails} FAILURE(S) ===` : '=== ALL PASS ===')
await browser.close()
process.exit(fails ? 1 : 0)
