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

// A vite HMR reload tears down window.__PLAY__ underneath the run. Vite fires
// one on its first dep-optimizer pass, and any commit by a concurrent agent
// fires more -- both routine in this repo. The listener is registered *after*
// the initial goto so it only catches genuine reloads, never our own load.
//
// The reload is treated ASYMMETRICALLY, and the asymmetry is the whole point.
// During *setup* (waiting for the mount, catching FIGHT!) a reload is
// recoverable: the match restarts anyway, so retry from scratch. During
// *capture* (KO onward) a reload is FATAL: it silently restarts the match, and
// a tool that quietly re-latched would file frames of a fresh full-health match
// under `01-ko` -- exactly the lying-harness shape this project keeps hitting.
let reloaded = false
page.on('framenavigated', (f) => {
  if (f === page.mainFrame()) reloaded = true
})
// The `framenavigated` flag lags the failure it describes: page.evaluate throws
// "Execution context was destroyed" the instant a navigation starts, but the
// event that flips `reloaded` only fires a tick later. So the error message is
// the authoritative signal that a reload happened -- the flag alone would let a
// mid-capture reload slip through as a raw uncaught throw.
const isNavErr = (e) =>
  /Execution context was destroyed|because of a navigation|Target closed|frame was detached/i.test(
    String(e),
  )
const wasReloaded = (e) => reloaded || isNavErr(e)

// Return only announcement strings that are ACTUALLY VISIBLE -- painted, on
// screen, and not faded out. The old version returned any leaf element whose
// text merely contained the word, so it passed on a present-but-transparent
// node: a screenshot of a stage with no banner could still satisfy `banner()`.
// That is the exact lying-harness shape this project keeps hitting (an
// assertion the failure mode satisfies), and 00-fight tripped it -- the tool
// reported ["FIGHT!"] over a frame with no FIGHT! anywhere on it, because the
// announcement's framer wrapper was mid-exit at opacity ~0. Visibility, not
// presence, is the claim a capture is making, so measure visibility.
const banner = () =>
  page.evaluate(() => {
    const want = ['ROUND', 'FIGHT', 'K.O.', 'PERFECT', 'TIME OVER', 'WINS', 'VICTORY', 'REMATCH']
    const vw = window.innerWidth
    const vh = window.innerHeight
    const hits = []
    for (const el of document.querySelectorAll('div,span,h1,h2,p,button')) {
      if (el.children.length) continue
      const t = (el.textContent || '').trim()
      if (!t || !want.some((w) => t.toUpperCase().includes(w))) continue
      // Effective opacity is the product down the ancestor chain -- framer
      // animates the wrapper's opacity, so a mid-exit banner reads ~0 here
      // even though its own text node is nominally opaque.
      let op = 1
      let hidden = false
      for (let n = el; n && n !== document.body; n = n.parentElement) {
        const cs = getComputedStyle(n)
        op *= parseFloat(cs.opacity)
        if (cs.display === 'none' || cs.visibility === 'hidden') hidden = true
      }
      const r = el.getBoundingClientRect()
      const onScreen = r.width > 4 && r.height > 4 && r.right > 0 && r.left < vw && r.bottom > 0 && r.top < vh
      if (!hidden && onScreen && op >= 0.5) hits.push({ text: t, opacity: Math.round(op * 100) / 100 })
    }
    return hits
  })

// The visibility-aware banner returns {text,opacity}; callers want the strings.
const bannerText = async () => (await banner()).map((h) => h.text)

const shots = []
async function shot(name, expect, opts = {}) {
  const { settle = 0, soft = false } = opts
  await guard(name) // a reload before this capture would document a restarted match
  let seen, buf
  try {
    await page.evaluate(() => window.__PLAY__.pause())
    // Settle lets framer finish popping the banner IN before we look. Without
    // it, a capture fired the instant the phase flips reads the announcement at
    // opacity ~0 (still entering) and reports a false MISS over a saved frame
    // that -- captured a beat later -- clearly shows the banner. framer's rAF
    // runs even while the sim is paused, so the pop settles during this wait.
    if (settle) await page.waitForTimeout(settle)
    // Screenshot first, then read visibility. The capture is taken while the
    // banner is held; reading *after* it means a visible result guarantees the
    // saved pixels showed the banner (capture happened earlier, banner still
    // up). Reading before would let a banner that faded during PNG encoding
    // pass over a frame that no longer contains it -- a false OK.
    buf = await page.screenshot()
    seen = await bannerText()
  } catch (e) {
    await guard(name, e) // reload mid-capture: fail loudly instead of a raw TypeError
    throw e
  }
  writeFileSync(`${OUT}/${name}.png`, buf)
  await page.evaluate(() => window.__PLAY__.resume()).catch(async (e) => {
    await guard(name, e)
  })
  const ok = expect ? seen.some((t) => t.toUpperCase().includes(expect)) : true
  shots.push({ name, seen, expect, ok, soft })
  const tag = ok ? 'OK ' : soft ? 'soft' : 'MISS'
  console.log(`  ${name.padEnd(14)} ${tag}  banner=${JSON.stringify(seen)}`)
  return ok
}

// --- setup: wait for the mount, then catch FIGHT! ------------------------
// The intro is ~1.5s; the FIGHT! banner rides the intro->fight transition, so
// poll for it rather than guessing a sleep. Every await here can throw
// "Execution context was destroyed" if a reload lands mid-poll -- caught and
// reported as RELOADED so the outer loop retries the whole setup.
async function setup() {
  reloaded = false
  try {
    await page.waitForFunction(() => window.__PLAY__?.ready?.(), null, { timeout: 30000 })
    for (let i = 0; i < 80; i++) {
      if (reloaded) return 'RELOADED'
      const b = await bannerText()
      if (b.some((t) => t.toUpperCase().includes('FIGHT'))) return 'FIGHT'
      await page.waitForTimeout(50)
    }
  } catch (e) {
    if (wasReloaded(e)) return 'RELOADED'
    throw e
  }
  return 'NOFIGHT'
}

let setupResult = 'RELOADED'
for (let attempt = 0; attempt < 4 && setupResult === 'RELOADED'; attempt++) {
  if (attempt > 0) console.log('  (page reloaded during setup, retrying)')
  setupResult = await setup()
}
if (setupResult === 'RELOADED') {
  console.log('FAILED: the page kept reloading during setup; never caught a stable intro.')
  await browser.close()
  process.exit(1)
}

// A reload from this line on is fatal: capturing past it would document a
// restarted match under a KO/aftermath filename.
const guard = async (label, e) => {
  if (reloaded || (e && isNavErr(e))) {
    console.log(`FAILED: the page reloaded during ${label}; the capture would be a restarted match.`)
    await browser.close()
    process.exit(1)
  }
}

rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })

const sawFight = setupResult === 'FIGHT'
// FIGHT! is a sub-second flash (1100ms, fading at both ends). A DPR-2 screenshot
// of a 3200x1800 page takes long enough to race that window, so catching it on
// the *live* route is inherently flaky -- and a tool that FAILED the whole
// real-camera capture because a half-second flash slipped past would just train
// everyone to ignore it. Its visibility is instead GUARANTEED deterministically
// by tools/probe-ceremony.mjs, which holds the intro->fight beat in a paused
// preview where framer settles with no race. Here it is best-effort: captured
// when caught, reported honestly as `soft` when not, never fatal on its own.
if (sawFight) await shot('00-fight', 'FIGHT', { soft: true })
else console.log('  00-fight       soft  (no FIGHT! flash caught in the 4s window; see probe-ceremony)')

// --- K.O. ---------------------------------------------------------------
await guard('the K.O. setup')
await page.waitForTimeout(600)
try {
  await page.evaluate(() => {
    const s = window.__PLAY__.state()
    s.fighters[1].health = 1 // one clean hit ends it
  })
} catch (e) {
  await guard('the K.O. setup', e)
  throw e
}
// Walk in and swing until the KO lands.
let koSeen = false
for (let i = 0; i < 40 && !koSeen; i++) {
  await guard('the K.O. swing')
  await page.keyboard.down('ArrowRight')
  await page.waitForTimeout(120)
  await page.keyboard.up('ArrowRight')
  await page.keyboard.press('KeyJ')
  for (let j = 0; j < 8; j++) {
    let b, phase
    try {
      b = await bannerText()
      phase = await page.evaluate(() => window.__PLAY__.state().phase)
    } catch (e) {
      await guard('the K.O. swing', e) // a reload here is fatal; guard exits non-zero
      throw e
    }
    if (b.some((t) => /K\.O\.|PERFECT/i.test(t)) || phase === 'ko') {
      koSeen = true
      break
    }
    await page.waitForTimeout(40)
  }
}
if (koSeen) await shot('01-ko', 'K', { settle: 680 })
else console.log('  01-ko          MISS  (no KO reached)')

// --- aftermath ----------------------------------------------------------
await guard('the aftermath hold')
await page.waitForTimeout(900)
await shot('02-round-end', null)
await guard('the aftermath hold')
await page.waitForTimeout(2200)
await shot('03-aftermath', null)

writeFileSync(`${OUT}/shots.json`, JSON.stringify({ build: SHA, url: URL, shots, errors }, null, 2))
console.log(errors.length ? `\n  ${errors.length} console errors` : '\n  no console errors')

// FIGHT! is best-effort (soft), so its absence never fails the run; K.O. must be
// caught and must render. A soft-flagged miss is excluded from the fatal set.
const missed = shots.filter((s) => s.expect && !s.ok && !s.soft).map((s) => s.name)
await browser.close()
if (!koSeen || missed.length) {
  console.log(
    `\nFAILED: ceremony not observed (${[!koSeen && 'K.O.', ...missed].filter(Boolean).join(', ')}).`,
  )
  process.exit(1)
}
