// Falsifiable probe for the fighting-game HUD (src/fighthud/**).
//
// Every assertion here is designed so the failure mode it guards against would
// make it go RED — not merely "a file was written". Each reads a HUD value out
// of the live DOM and compares it to what the deterministic sim reports for the
// exact same frame. If the HUD stopped tracking the sim, these fail.
//
// I proved each critical assertion can fail by breaking the component and
// watching the probe go red, then restoring — see the report / README notes.
//
// Usage: node tools/fighthud-probe.mjs [--port 5399] [--out fighthud-shots]
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'

const args = process.argv.slice(2)
const flag = (name, dflt) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : dflt
}
const PORT = flag('port', '5399')
const OUT = flag('out', 'fighthud-shots')
const URL = `http://localhost:${PORT}/?fighthud=1&paused=1`

mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({
  headless: false,
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-angle=metal', '--window-position=4000,4000', '--hide-scrollbars'],
})
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })
page.on('pageerror', (e) => console.log('  [pageerror]', e.message))
page.on('console', (m) => {
  if (m.type() === 'error') console.log('  [console.error]', m.text())
})

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let failures = 0
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`)
  if (!ok) failures++
}

// Read the sim's authoritative numbers for the current frame.
const simState = () => page.evaluate(() => window.__FIGHTHUD__.state())
const simPhase = () => page.evaluate(() => window.__FIGHTHUD__.phase())
const step = (n) => page.evaluate((k) => window.__FIGHTHUD__.step(k), n)

// Read what the HUD is actually showing.
const hudRead = () =>
  page.evaluate(() => {
    const w = (sel) => {
      const el = document.querySelector(sel)
      return el ? parseFloat(el.style.width) : null
    }
    const txt = (sel) => document.querySelector(sel)?.textContent?.trim() ?? null
    const comboEl = document.querySelector('[data-testid=fhud-combo-count]')
    const comboNum = comboEl ? parseInt(comboEl.textContent.replace(/[^0-9]/g, ''), 10) : null
    return {
      hpFillA: w('[data-testid=fhud-hpfill-a]'),
      hpFillB: w('[data-testid=fhud-hpfill-b]'),
      superA0: w('[data-testid=fhud-superbar-a-0] .fhud-superfill'),
      timer: txt('[data-testid=fhud-timer]'),
      comboVisible: !!document.querySelector('[data-testid=fhud-combo]'),
      comboNum,
      announce: txt('[data-testid=fhud-announce-main]'),
      pipsWonA: document.querySelectorAll('[data-testid=fhud-pips-a] .fhud-pip.won').length,
      pipsWonTotal: document.querySelectorAll('.fhud-pip.won').length,
    }
  })

await page.goto(URL, { waitUntil: 'networkidle' })
await page.waitForFunction(() => window.__FIGHTHUD__?.ready(), null, { timeout: 15000 })
await sleep(300)

console.log('\n=== fighthud probe ===\n')

// ── 1. Root mounted ────────────────────────────────────────────────────
const rootExists = await page.evaluate(() => !!document.querySelector('[data-testid=fhud-root]'))
check('HUD root mounts', rootExists)

// ── 2. Announcement punctuates the round start ─────────────────────────
// Step through the intro into the fight; expect ROUND then FIGHT! to appear.
let sawRound = false
let sawFight = false
for (let i = 0; i < 130 && !(sawRound && sawFight); i++) {
  step(1)
  await sleep(16)
  const a = (await hudRead()).announce
  if (a && /^\d/.test(a)) sawRound = true // ROUND plate shows the number big
  if (a === 'FIGHT!') sawFight = true
}
check('ROUND announcement shown at start', sawRound)
check('FIGHT! announcement shown on fight start', sawFight)
await page.screenshot({ path: `${OUT}/01-intro.png` })

// ── 3. Timer counts DOWN ───────────────────────────────────────────────
await sleep(200)
const timerStart = (await hudRead()).timer
step(120) // ~2 sim-seconds
await sleep(120)
const timerLater = (await hudRead()).timer
check(
  'timer counts down',
  timerStart != null && timerLater != null && Number(timerLater) < Number(timerStart),
  `${timerStart} -> ${timerLater}`,
)

// ── 4. Health bar tracks the sim's health ──────────────────────────────
// Advance until someone has clearly taken damage, then let the bar settle and
// compare the drawn fill width to the true health fraction.
let dmgFrame = null
for (let i = 0; i < 900; i++) {
  step(1)
  const st = await simState()
  const hpA = st.fighters[0].health / st.fighters[0].maxHealth
  const hpB = st.fighters[1].health / st.fighters[1].maxHealth
  if (hpA < 0.85 || hpB < 0.85) {
    dmgFrame = { hpA, hpB }
    break
  }
  if (i % 4 === 0) await sleep(4)
}
await sleep(400) // let the eased fill converge to target
{
  const st = await simState()
  const hud = await hudRead()
  const trueA = (st.fighters[0].health / st.fighters[0].maxHealth) * 100
  const trueB = (st.fighters[1].health / st.fighters[1].maxHealth) * 100
  check('someone took damage during the match', dmgFrame != null)
  check(
    'health bar A matches sim health',
    hud.hpFillA != null && Math.abs(hud.hpFillA - trueA) < 4,
    `hud ${hud.hpFillA?.toFixed(1)}% vs sim ${trueA.toFixed(1)}%`,
  )
  check(
    'health bar B matches sim health',
    hud.hpFillB != null && Math.abs(hud.hpFillB - trueB) < 4,
    `hud ${hud.hpFillB?.toFixed(1)}% vs sim ${trueB.toFixed(1)}%`,
  )
  await page.screenshot({ path: `${OUT}/02-damage.png` })
}

// ── 5. Super meter builds (fill > 0 and matches sim) ───────────────────
{
  const st = await simState()
  const hud = await hudRead()
  const trueMeterBar0 = Math.min(1, st.fighters[0].meter / 1000) * 100
  check('super meter has built above zero', hud.superA0 != null && hud.superA0 > 1)
  check(
    'super meter A matches sim meter',
    hud.superA0 != null && Math.abs(hud.superA0 - trueMeterBar0) < 6,
    `hud ${hud.superA0?.toFixed(1)}% vs sim ${trueMeterBar0.toFixed(1)}%`,
  )
}

// ── 6. Combo counter shows the sim's combo count ───────────────────────
// Hunt for a live combo of 2+ and assert the printed number equals the sim's.
// The combo React state is set synchronously on the hit but committed by React
// a beat later; it then persists ~1.4s, so on detection we poll the DOM with
// retries rather than reading exactly once (which races the commit).
let comboMatch = null
for (let i = 0; i < 3000 && !comboMatch; i++) {
  step(1)
  const st = await simState()
  if (st.phase === 'match-end') break
  const maxC = Math.max(st.fighters[0].comboCount, st.fighters[1].comboCount)
  if (maxC >= 2) {
    for (let retry = 0; retry < 12 && !comboMatch; retry++) {
      await sleep(25)
      const hud = await hudRead()
      if (hud.comboVisible && hud.comboNum != null) {
        comboMatch = { simCombo: maxC, hudCombo: hud.comboNum }
        await sleep(140) // let the pop settle so the screenshot is representative
        await page.screenshot({ path: `${OUT}/03-combo.png` })
      }
    }
  }
  if (i % 3 === 0) await sleep(3)
}
check('combo counter appeared on a 2+ hit combo', comboMatch != null)
if (comboMatch) {
  check(
    'combo counter number matches sim comboCount',
    comboMatch.hudCombo === comboMatch.simCombo,
    `hud ${comboMatch.hudCombo} vs sim ${comboMatch.simCombo}`,
  )
}

// ── 7. K.O. announcement + pips reflect the sim's round wins ────────────
// Hunt for a knockout. Stop at the moment 'K.O.' is shown WITHOUT stepping
// further, so the HUD pips and the sim's wins array can be read at the same
// settled instant. (The harness sim loops matches, so a before/after pip
// delta across a long hunt can straddle a match reset and go backwards —
// comparing HUD-vs-sim at one instant is both robust and falsifiable.)
let sawKO = false
for (let i = 0; i < 4000 && !sawKO; i++) {
  step(2)
  const ph = await simPhase()
  const hud = await hudRead()
  if (hud.announce === 'K.O.') {
    sawKO = true
    await sleep(220) // settle past the crash-in so the plate is fully lit
    await page.screenshot({ path: `${OUT}/04-ko.png` })
    break
  }
  if (ph === 'match-end') break
  if (i % 4 === 0) await sleep(3)
}
check('K.O. announcement shown on a knockout', sawKO)
await sleep(220) // let the round-end pip commit
const stKO = await simState()
const hudKO = await hudRead()
const simWins = stKO.wins[0] + stKO.wins[1]
check(
  'HUD win pips match the sim round-win count (and a round was won)',
  hudKO.pipsWonTotal === simWins && simWins >= 1,
  `hud ${hudKO.pipsWonTotal} vs sim ${simWins}`,
)

console.log(`\n=== ${failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'} ===\n`)
await browser.close()
process.exit(failures === 0 ? 0 : 1)
