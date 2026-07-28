// Two-sided confetti probe: the IPO ticker-tape must fall ONLY during a
// victory / round-over beat, never during neutral play.
//
// Why two-sided. The lying-harness pattern this project keeps hitting is "an
// assertion the failure mode can also satisfy". A one-sided check here is a
// trap in BOTH directions:
//   * "no confetti during neutral" is satisfied by deleting the tape entirely.
//   * "the tape exists" is satisfied by the original always-on paper storm.
// So this probe asserts BOTH, in one real match, against the real sim phase:
//     neutral   (phase=fight)      -> tape ABSENT and the gate is CLOSED
//     ceremony  (phase=match-end)  -> the gate is OPEN
// It reaches the ceremony side by draining a real cpu=dummy to a real KO twice
// (a real match-end, never a synthetic flag), so it exercises the true
// phase -> renderState.celebrate -> build.celebrate chain.
//
// How each side is measured — and why they differ:
//   NEUTRAL is measured in PIXELS. We count *cool-hued bright pixels* (blue /
//   mint) inside a fighter-free patch of the lower-centre drop zone. This warm
//   gold/black/purple stage has ~zero cool-bright pixels there (measured: 0),
//   so any that appear are ticker-tape. The tape is sparse and always falling,
//   so a single frame often catches none; we SUM across a ~1.6s burst.
//   Forced-on (gate stuck open) sums 236–383 here — so the check has teeth.
//
//   CEREMONY is measured on the GATE FLAG, not pixels. The win screen paints a
//   cyan "ENTER TO CONTINUE" prompt straight through the drop zone (~103 cool
//   px/frame), and the giant "WINS" banner occludes the centre where tape would
//   otherwise read — so a pixel sum on the ceremony side is a liar: it passes on
//   the prompt even with confetti deleted (measured: 103*12 = the whole sum).
//   Instead we read window.__STAGE__.celebrate() — the exact boolean the tape
//   gates on — proving the plumbing is live, immune to the UI overlay. Break
//   test: stub the phase->celebrate line and this flag stays false at match-end.
//
// The stage is PINNED to ipo-prep. Confetti lives only on that arena, and the
// route default has since moved to pre-pmf; capturing the default would let the
// neutral check pass for the wrong reason (a stage that never had confetti) and
// the break test could never fire.

import { chromium } from 'playwright-core'
import { mkdirSync, writeFileSync } from 'node:fs'
import sharp from 'sharp'

const arg = (n, d) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : d)
const PORT = arg('--port', '5399')
const OUT = arg('--out', 'probe-out/confetti')
const A = arg('--a', 'lenny')
const B = arg('--b', 'spiegel')
const NEUTRAL_ONLY = process.argv.includes('--neutral-only')
const URL = `http://localhost:${PORT}/?stage=ipo-prep&a=${A}&b=${B}&cpu=dummy`

// The drop-zone patch: lower-centre, between the two fighters (who stand in the
// left and right thirds and never cross the middle) and below the gold window
// bank (whose lit panes are the only other cool-bright thing on this stage).
// The tape is sparse and always falling, so a single frame often catches none;
// we SUM cool-bright pixels across a ~1.6s burst of frames instead, over which
// the tape reliably sweeps this box. A gated stage scores 0 across every frame.
const ZONE = {
  x: Number(arg('--x', '445')),
  y: Number(arg('--y', '335')),
  width: Number(arg('--w', '465')),
  height: Number(arg('--h', '295')),
}
const FULL = { x: 0, y: 0, width: 1280, height: 720 }

// Absolute threshold on the summed NEUTRAL count. Measured: the gated stage sums
// 0 over the burst; forcing the gate open sums 236–383. NEUTRAL_MAX sits in the
// wide gap between, so neither a stray frame nor a real paper storm is ambiguous.
// (The ceremony side is asserted on the gate flag, not a pixel count — see top.)
const NEUTRAL_MAX = 40

mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-angle=metal', '--no-sandbox'],
})
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 })

// Reload tripwire. React StrictMode double-mounts, and concurrent atlas regen in
// this shared tree reloads the page mid-run, silently resetting the sim. We
// watch for a main-frame navigation and retry rather than trust a spliced read.
let reloaded = false
page.on('framenavigated', (f) => {
  if (f === page.mainFrame()) reloaded = true
})

// A pixel is "ticker-tape" if it is bright and distinctly cool-hued (blue or
// mint) — the two tape colours absent from this warm gold/black/purple stage.
function countCool(data) {
  let n = 0
  for (let i = 0; i + 2 < data.length; i += 3) {
    const r = data[i], g = data[i + 1], b = data[i + 2]
    const luma = 0.299 * r + 0.587 * g + 0.114 * b
    if (luma < 110) continue
    if ((b > r + 35 && b > 150 && g > 110) || (g > r + 40 && g > b + 20 && g > 170)) n++
  }
  return n
}

// Sum cool-bright pixels in `clip` across a burst of frames. The sim runs during
// the burst (never paused), so falling tape sweeps the box; a gated stage holds
// the tape hidden and scores 0 every frame. Returns the sum and the single-frame
// peak, both reported.
async function coolBrightSum(clip, frames = 12, gapMs = 120) {
  let sum = 0
  let peak = 0
  for (let i = 0; i < frames; i++) {
    const buf = await page.screenshot({ clip })
    const { data } = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true })
    const n = countCool(data)
    sum += n
    if (n > peak) peak = n
    await page.waitForTimeout(gapMs)
  }
  return { sum, peak }
}

// page.evaluate, but tolerant of the execution context being torn down by a
// mid-run reload: retry a few times before giving up.
async function evalRetry(fn, tries = 40) {
  for (let i = 0; i < tries; i++) {
    try {
      return await page.evaluate(fn)
    } catch (e) {
      if (/context|destroyed|navigation|detached|Target closed/i.test(String(e))) {
        await page.waitForTimeout(60)
        continue
      }
      throw e
    }
  }
  throw new Error('evalRetry exhausted (page never settled)')
}

// Readiness needs to hold across StrictMode's double-mount, which briefly
// deletes window.__PLAY__. A single waitForFunction can catch the gap; we demand
// 15 consecutive good polls instead.
async function waitStableFight() {
  let stable = 0
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline && stable < 15) {
    let ok = false
    try {
      ok = await page.evaluate(() => !!window.__PLAY__?.ready?.() && window.__PLAY__.state().phase === 'fight')
    } catch {
      ok = false
    }
    stable = ok ? stable + 1 : 0
    await page.waitForTimeout(30)
  }
  return stable >= 15
}

const sample = () =>
  evalRetry(() => {
    const p = window.__PLAY__
    if (!p) return { dead: true }
    const st = p.state()
    return {
      phase: st.phase,
      hp1: Math.round(st.fighters[1].health),
      combo1: st.fighters[1].comboCount ?? 0,
      gap: Math.round(st.fighters[1].pos.x - st.fighters[0].pos.x),
      actionable: st.fighters[0].stance !== 'attack' && st.hitstop === 0 && (st.fighters[0].stunRemaining ?? 0) === 0,
    }
  })

// The exact boolean the ticker-tape gates on, read straight off the stage. This
// is the ceremony-side instrument: UI-immune, so the win-screen prompt/banner
// cannot fake it. Returns null if the dev hook is absent (treated as a failure).
const celebrateFlag = () => evalRetry(() => (window.__STAGE__ ? window.__STAGE__.celebrate() : null))

async function press(key, ms = 16) {
  await page.keyboard.down(key)
  await page.waitForTimeout(ms)
  await page.keyboard.up(key)
}

async function run() {
  reloaded = false
  await page.goto(URL, { waitUntil: 'domcontentloaded' })
  if (!(await waitStableFight())) throw new Error('never reached a stable fight phase')
  await page.mouse.click(800, 450)
  await page.waitForTimeout(500)
  reloaded = false // arm the tripwire only now that we are past warm-up churn

  // ── NEUTRAL (phase=fight): no action taken, so the only thing that could put
  // cool-bright pixels in the drop zone is a paper storm that should not be here.
  const neutral = await coolBrightSum(ZONE)
  const neutralCelebrate = await celebrateFlag()
  writeFileSync(`${OUT}/neutral.png`, await page.screenshot({ clip: FULL }))
  if (reloaded) throw new Error('RELOADED')

  if (NEUTRAL_ONLY) return { neutral, neutralCelebrate, celeb: null, celebPhase: 'skipped', celebFlag: null }

  // ── Drive real KOs until the MATCH ends. This is best-of-N, so the dummy has
  // to go down more than once. `match-end` is the terminal, persistent
  // celebration phase; a single round's ko/round-end window is too brief to
  // sample without racing the next round's "FIGHT!" intro (which correctly
  // re-closes the gate — verified: an over-long wait lands on round 2 neutral
  // with the tape already cleared). ────────────────────────────────────────
  const deadline = Date.now() + 180_000
  let phase = 'fight'
  while (Date.now() < deadline) {
    if (reloaded) throw new Error('RELOADED')
    const s = await sample()
    if (s.dead) {
      await page.waitForTimeout(60)
      continue
    }
    phase = s.phase
    if (phase === 'match-end') break
    if (phase !== 'fight') {
      // ko / round-end / next-round intro — let the sim advance the round flow.
      await page.waitForTimeout(120)
      continue
    }
    if (s.gap > 116) {
      await press('KeyD', 80)
      continue
    }
    if (s.actionable && s.combo1 === 0) {
      await press('KeyO') // st.HP — heavy, full damage on a fresh hit
      await page.waitForTimeout(40)
    } else {
      await page.waitForTimeout(24)
    }
  }
  if (phase !== 'match-end') throw new Error('the match never concluded inside the deadline')

  // ── CEREMONY (phase=match-end, terminal): read the gate flag — the UI-immune
  // truth of whether the tape is allowed to fall. We also sum the drop-zone
  // pixels and screenshot for the record, but the pixel sum is NOT asserted:
  // the win-screen's cyan prompt sits in the zone and would let a pixel check
  // pass even with confetti gone. The flag can't be faked by the overlay. ──
  await page.waitForTimeout(1600)
  const celebPhase = (await sample()).phase
  const celebFlag = await celebrateFlag()
  const celeb = await coolBrightSum(ZONE)
  writeFileSync(`${OUT}/ceremony.png`, await page.screenshot({ clip: FULL }))

  return { neutral, neutralCelebrate, celeb, celebPhase, celebFlag }
}

let res = null
for (let attempt = 0; attempt < 3 && !res; attempt++) {
  try {
    res = await run()
  } catch (e) {
    if (String(e).includes('RELOADED')) {
      console.log('  (page reloaded mid-run — another agent edited; retrying)')
      continue
    }
    console.log(`FAILED: ${e.message || e}`)
    await browser.close()
    process.exit(2)
  }
}
if (!res) {
  console.log('FAILED: could not complete a clean run (repeated reloads)')
  await browser.close()
  process.exit(2)
}
await browser.close()

const { neutral, neutralCelebrate, celeb, celebPhase, celebFlag } = res

console.log('confetti probe — IPO ticker-tape gates on the celebration beat')
console.log(`  drop zone ${ZONE.x},${ZONE.y} ${ZONE.width}x${ZONE.height}   (cool-bright tape pixels, summed over a burst)`)
console.log(`  NEUTRAL  (phase=fight):     tape sum ${neutral.sum}  peak ${neutral.peak}   gate ${neutralCelebrate}`)

if (NEUTRAL_ONLY) {
  const ok = neutral.sum <= NEUTRAL_MAX && neutralCelebrate === false
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  neutral drop zone clear of tape (sum <= ${NEUTRAL_MAX}) and gate closed`)
  console.log(ok ? '=== NEUTRAL PASS ===' : '=== 1 FAILURE(S) ===')
  process.exit(ok ? 0 : 1)
}

// The ceremony pixel sum is reported for the record only. It is contaminated by
// the win-screen's cyan prompt, so it is NOT an assertion — the gate flag is.
console.log(`  CEREMONY (phase=${celebPhase}): tape sum ${celeb.sum} (prompt-contaminated, not asserted)  gate ${celebFlag}`)

const checks = [
  ['neutral drop zone clear of tape (no confetti during fight)', neutral.sum <= NEUTRAL_MAX],
  ['neutral gate is closed (celebrate=false during fight)', neutralCelebrate === false],
  ['ceremony reached a real celebration phase', celebPhase === 'ko' || celebPhase === 'round-end' || celebPhase === 'match-end'],
  ['ceremony gate is open (celebrate=true on the win) — the tape may fall', celebFlag === true],
]
let fails = 0
for (const [name, ok] of checks) {
  if (!ok) fails++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`)
}
console.log(fails ? `=== ${fails} FAILURE(S) ===` : '=== ALL PASS ===')
process.exit(fails ? 1 : 0)
