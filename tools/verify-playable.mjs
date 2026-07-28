/**
 * Proves the fighter is actually playable by a human.
 *
 * The obvious version of this test — "press D, assert the fighter moved" —
 * passes even if input is completely unwired, because the CPU opponent walks
 * into you and pushboxes shove you along. That is exactly the shape of
 * assertion this repo keeps getting burned by: one the failure mode satisfies.
 *
 * So every check here is differential. We measure a control window with no keys
 * held, then the same length of window with a key held, and require the
 * difference to be large and in the correct direction. Drift that affects both
 * windows equally cancels out.
 *
 * Run: node tools/verify-playable.mjs [--headed]
 */

import { chromium } from 'playwright-core'

const URL = 'http://localhost:5399/?play=1&cpu=dummy'
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

const failures = []
function check(name, ok, detail) {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures.push(name)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const browser = await chromium.launch({
  headless: false,
  executablePath: CHROME,
  args: ['--use-angle=metal', '--window-position=4000,4000', '--hide-scrollbars'],
})
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })
page.on('pageerror', (e) => {
  console.log(`  page error: ${e.message}`)
  failures.push(`pageerror: ${e.message}`)
})

try {
  await page.goto(URL, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => window.__PLAY__?.ready?.(), null, { timeout: 60_000 })
  // Let the intro phase elapse so the fighters are actually actionable.
  await sleep(3000)

  const x = async () => page.evaluate(() => window.__PLAY__.state().fighters[0].pos.x)
  const snap = async () =>
    page.evaluate(() => {
      const s = window.__PLAY__.state()
      return { x: s.fighters[0].pos.x, stance: s.fighters[0].stance, phase: s.phase }
    })

  /**
   * Wait until P1 is actually free to act. Without this the checks are
   * order-dependent: the jump test ran during the previous test's attack
   * recovery and reported "jump is unwired" when jump was fine. A sequencing
   * artifact that reads as a product bug is exactly the kind of false report
   * this harness exists to avoid.
   */
  const IDLE = new Set(['idle', 'stand', 'neutral', 'crouch', 'walk-fwd', 'walk-back'])
  const waitNeutral = async (tries = 60) => {
    for (let i = 0; i < tries; i++) {
      if (IDLE.has((await snap()).stance)) return true
      await sleep(16)
    }
    return false
  }

  // --- 1. Fighters are actually painted (an invisible game is not a game) ---
  const cov = await page.evaluate(() => window.__PLAY__.coverage())
  check('fighters painted', cov.fraction > 0.01, `${(cov.fraction * 100).toFixed(2)}% of an isolated render`)

  // --- 2. Control window: how far does P1 drift with NO input? ---
  const c0 = await x()
  await sleep(1200)
  const c1 = await x()
  const drift = Math.abs(c1 - c0)
  check('idle drift is small', drift < 25, `drifted ${drift.toFixed(1)}cm in 1.2s with no keys`)

  // --- 3. Holding right must move right, far more than the drift ---
  await waitNeutral()
  const r0 = await x()
  await page.keyboard.down('d')
  await sleep(1200)
  await page.keyboard.up('d')
  const r1 = await x()
  const moved = r1 - r0
  check(
    'holding D walks right',
    moved > drift * 3 + 20,
    `moved ${moved.toFixed(1)}cm right vs ${drift.toFixed(1)}cm idle drift`,
  )

  // --- 4. Holding left must move left. Direction matters: a test that only
  //        checks "moved" passes on a stuck fighter being shoved by the CPU. ---
  await waitNeutral()
  const l0 = await x()
  await page.keyboard.down('a')
  await sleep(1200)
  await page.keyboard.up('a')
  const l1 = await x()
  const movedL = l1 - l0
  check(
    'holding A walks left',
    movedL < -(drift * 3 + 20),
    `moved ${movedL.toFixed(1)}cm left vs ${drift.toFixed(1)}cm idle drift`,
  )

  // --- 5. An attack button must produce an attack stance.
  //        Tested two ways on purpose. A held button is the easy case; a short
  //        tap is the one that matters, because `pressed` is derived by diffing
  //        polls, and a tap that begins and ends between two polls is invisible
  //        to the sim. Fighting games latch presses for exactly this reason. ---
  const attackWithin = async (frames) => {
    for (let k = 0; k < frames; k++) {
      const s = await snap()
      if (s.stance === 'attack') return true
      await sleep(16)
    }
    return false
  }

  await waitNeutral()
  await page.keyboard.down('u')
  const heldAttack = await attackWithin(20)
  await page.keyboard.up('u')
  check('holding U attacks', heldAttack, heldAttack ? 'stance reached "attack"' : 'never left neutral')

  await waitNeutral()
  let tapAttack = false
  for (let i = 0; i < 8 && !tapAttack; i++) {
    await page.keyboard.press('u')
    tapAttack = await attackWithin(8)
  }
  check('tapping U attacks', tapAttack, tapAttack ? 'short tap registered' : 'short taps are dropped')

  // --- 6. Jump must leave the ground ---
  await waitNeutral()
  await page.keyboard.down('w')
  let maxY = 0
  for (let i = 0; i < 40; i++) {
    const y = await page.evaluate(() => window.__PLAY__.state().fighters[0].pos.y)
    maxY = Math.max(maxY, y)
    await sleep(16)
  }
  await page.keyboard.up('w')
  check('pressing W jumps', maxY > 20, `apex ${maxY.toFixed(1)}cm`)

  // --- 7. The HUD is actually mounted over the game ---
  const hudBoxes = await page.evaluate(() => {
    const el = document.querySelector('[class*="hud"], [data-fighthud]')
    return el ? el.getBoundingClientRect().width : 0
  })
  check('HUD is mounted', hudBoxes > 0, hudBoxes ? `${Math.round(hudBoxes)}px wide` : 'no HUD element found')

  await page.screenshot({ path: 'fight-shots/playable.png' })
  console.log('\n  wrote fight-shots/playable.png')
} catch (e) {
  console.log(`\n  EXCEPTION: ${e.message}`)
  failures.push(`exception: ${e.message}`)
} finally {
  await browser.close()
}

if (failures.length) {
  console.log(`\n${failures.length} FAILED: ${failures.join(', ')}`)
  process.exit(1)
}
console.log('\nall checks passed — the fighter is playable')
