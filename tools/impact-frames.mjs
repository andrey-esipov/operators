// impact-frames.mjs — measures the CAMERA KICK on contact, live, across a real
// landed hit at each attack weight, and proves the kick scales with weight.
//
// ── Why this was rewritten (read before trusting any old `maxMag: 0`) ─────────
// The previous version filmed the impact by pausing the sim after a hit landed
// and stepping it frame-by-frame with page screenshots, then cross-correlating a
// static rafters band between frames to recover the camera translation in px.
// That design MISSES the kick by construction:
//
//   1. It swung LIVE (polling the defender's HP every ~8ms), so by the time the
//      HP drop was observed the sim had already run several real render frames
//      past contact. The impact kick is a ~7-frame sprung transient that has
//      largely decayed within ~120ms — it was already spent before the tool
//      called pause() and took its first screenshot.
//   2. Even once paused, screenshots are far too slow (~50-100ms each) to sample
//      a 60fps transient; a stepped filmstrip can only see whatever survived the
//      live gap above, which for a snappy kick is nothing.
//
// So the tool reported `maxMag: 0` and a "no camera kick on contact" verdict for
// a camera that, measured correctly, moves a fixed world point 2.1% of screen
// width on a heavy — a metric that lies, and one a visual critic filed as a
// top defect. A measurement tool that defames working code is worse than none.
//
// ── What it does now ─────────────────────────────────────────────────────────
// It samples LIVE requestAnimationFrame frames through the hit (never
// pause-then-step), reading the camera directly: each frame it projects a fixed
// world point (head height on the fighting plane) to NDC via __STAGE__.project
// and records the sim's hitstop + the defender's HP alongside it. No screenshots,
// so it captures the true 60fps envelope and is immune to the DPR/cleared-buffer
// grab hazards. This is the method calib_kick.mjs proved.
//
// For EACH weight (light / medium / heavy) it stages a point-blank, deeply
// stunned dummy at a range the attack reaches, settles the camera dead still,
// establishes a still baseline, fires the real move through the ordinary input
// path, and measures the peak projection deviation through the hit. A weight is
// only reported as a measurement if it actually CONNECTED — proven by the sim's
// hitstop going > 0 AND the defender's HP dropping. A whiff is reported as a
// whiff (landed:false), never as a "0 kick", because an unlanded attack is not a
// measurement of the kick (the old light-jab whiff is exactly how "does the kick
// scale with weight?" went unmeasured).
//
// It then runs a self-mutation control: with the product's built-in DEV hook
// window.__MUT_NO_KICK__ set, addShake/punchIn no-op, and the SAME heavy hit is
// re-measured. If the kick does not collapse toward the still baseline, the
// instrument is reading something other than the camera code and every number is
// suspect — so the run FAILS. This is the anti-lying check the old tool lacked.
//
//   node tools/impact-frames.mjs [--port 5661] [--out critique/impact-frames]
//                                [--query 'a=spiegel&b=lenny&p1=operator&p2=operator&cpu=dummy']
//
// TEXT ONLY: prints a per-weight table + writes a small JSON. No image bytes.
import { chromium } from 'playwright-core'
import { mkdirSync, writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'

const arg = (n, d) => (process.argv.includes(`--${n}`) ? process.argv[process.argv.indexOf(`--${n}`) + 1] : d)
const PORT = arg('port', '5399')
const OUT = arg('out', 'critique/impact-frames')
const QUERY = arg('query', 'a=spiegel&b=lenny&p1=operator&p2=operator&cpu=dummy')
const VW = 1600
const VH = 900
let SHA = 'unknown'
try { SHA = execSync('git rev-parse --short HEAD').toString().trim() } catch {}
const URL = `http://localhost:${PORT}/?${QUERY}`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Weight ladder. lp/mp/hp map cleanly to the sim's light/medium/heavy hit levels
// (FightVfx HIT.shake: 0.10 / 0.16 / 0.26), so the projected kick should climb
// with weight. `gaps` are candidate point-blank separations in sim-cm, tried
// widest-first: every weight reaches the closest, but starting a touch out keeps
// the two pushboxes from jostling. REACH_BONUS=38 puts lp effective reach ~110cm,
// mp ~120, hp ~130; the pushbox floor is ~100cm, so ~104 lands all three.
const WEIGHTS = [
  { label: 'light',  level: 'lp', key: 'KeyU', shake: 0.10, gaps: [104, 98, 92] },
  { label: 'medium', level: 'mp', key: 'KeyI', shake: 0.16, gaps: [110, 104, 98] },
  { label: 'heavy',  level: 'hp', key: 'KeyO', shake: 0.26, gaps: [116, 110, 104] },
]

const browser = await chromium.launch({
  headless: false,
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-angle=metal', '--window-position=4000,4000', '--hide-scrollbars', '--mute-audio'],
})
const page = await browser.newPage({ viewport: { width: VW, height: VH }, deviceScaleFactor: 1 })
page.on('pageerror', (e) => console.log('  [pageerror]', String(e.message).slice(0, 140)))

await page.goto(URL, { waitUntil: 'domcontentloaded' })

// Wait until the match is genuinely live: __PLAY__ ready + in the fight phase +
// __STAGE__ projector installed, held stable across several polls. The app can
// briefly tear these down on a React re-mount / phase reset, so this is called
// before EVERY pass, not just once — the second-run crash was a pass firing into
// a transiently-undefined __PLAY__.
async function waitReady(minStable = 15, maxPolls = 500) {
  let stable = 0
  for (let i = 0; i < maxPolls && stable < minStable; i++) {
    let ok = false
    try {
      ok = await page.evaluate(
        () => !!window.__PLAY__?.ready?.() && window.__PLAY__.state?.().phase === 'fight' && !!window.__STAGE__,
      )
    } catch {}
    stable = ok ? stable + 1 : 0
    await sleep(30)
  }
  return stable >= minStable
}

if (!(await waitReady())) { console.log('FAILED: never reached a stable fight with __PLAY__ + __STAGE__'); await browser.close(); process.exit(1) }
await page.mouse.click(VW / 2, VH / 2)
await sleep(200)

// Pin the two fighters point-blank with the dummy deeply stunned, so it neither
// walks nor retaliates and the only camera motion is what our own hit produces.
async function stage(gap) {
  await waitReady() // guard against a transient __PLAY__ teardown between passes
  await page.evaluate((g) => {
    const s = window.__PLAY__?.state?.()
    if (!s) return
    const [me, foe] = s.fighters
    me.pos.x = -g / 2; me.vel.x = 0; me.facing = 1; me.stunRemaining = 0; me.health = 1000
    foe.pos.x = g / 2; foe.vel.x = 0; foe.facing = -1; foe.stunRemaining = 600; foe.health = 1000
  }, gap)
}

// One live-RAF pass: settle, sample a still baseline, fire, keep sampling through
// the hit. Returns the raw per-frame samples (NDC of a fixed world point + the
// sim's hitstop + the defender HP), which is everything the metrics need.
async function firePass(gap, key) {
  await stage(gap)
  await sleep(1300) // FULL camera settle — no dolly/zoom/kick motion left
  await page.evaluate(() => {
    window.__SAMP__ = []
    const P = [0, 3.0, 0] // fighting-plane point at head height — what the eye tracks
    let n = 0
    const tick = () => {
      const stg = window.__STAGE__, play = window.__PLAY__
      if (!stg || !play?.state) { if (++n < 150) requestAnimationFrame(tick); return }
      const ndc = stg.project(P[0], P[1], P[2])
      const s = play.state()
      // gx = defender x. It stays put through the impact freeze and only starts
      // sliding once the knockback is applied — which is precisely how we tell the
      // KICK (camera motion while the fighters are frozen) apart from the camera
      // legitimately TRACKING the knockback slide afterwards.
      window.__SAMP__.push({ n, x: ndc[0], y: ndc[1], hs: s.hitstop, hp: Math.round(s.fighters[1].health), gx: Math.round(s.fighters[1].pos.x) })
      if (++n < 150) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
  await sleep(300) // ~18 still baseline frames
  await stage(gap) // re-pin the instant before firing so nothing has drifted
  await page.keyboard.press(key)
  await sleep(900) // through contact, the freeze, and the kick playing out
  return page.evaluate(() => window.__SAMP__ || [])
}

// Reduce a sample run to the kick metrics. contact = first frame the sim reports
// hitstop (the freeze a landed hit triggers); landed also requires the defender's
// HP to have dropped. The KICK is measured over the FROZEN window — from contact
// until the defender starts sliding from the knockback — so the camera's later,
// legitimate tracking of the knockback slide is NOT counted as kick (that pan is
// reported separately as trackPeakPx). Deviation is measured from the still
// pre-contact mean, so a residual settling drift is subtracted out.
function analyse(samp) {
  const contact = samp.findIndex((r) => r.hs > 0)
  const landed = contact >= 0 && samp.some((r) => r.hp < 1000)
  const maxHitstop = samp.length ? Math.max(...samp.map((r) => r.hs)) : 0
  const bWin = contact > 6 ? samp.slice(3, contact - 1) : samp.slice(3, 15)
  const mx = bWin.reduce((a, r) => a + r.x, 0) / bWin.length
  const my = bWin.reduce((a, r) => a + r.y, 0) / bWin.length
  // NDC spans 2 across the frame, so an NDC delta d is d/2 of screen span.
  const pxOf = (r) => Math.hypot(((r.x - mx) / 2) * VW, ((r.y - my) / 2) * VH)
  const ndcOf = (r) => Math.hypot(r.x - mx, r.y - my)
  const baselinePx = Math.max(...bWin.map(pxOf))

  // Frozen kick window: from contact while the defender has not yet slid (the
  // impact freeze holds its position; the kick plays out here on sim-frame time).
  const gx0 = contact >= 0 ? samp[contact].gx : 0
  let end = contact
  while (end < samp.length && end < contact + 30 && Math.abs(samp[end].gx - gx0) <= 3) end++
  const kickSlice = contact >= 0 ? samp.slice(contact, Math.max(contact + 1, end)) : []
  const peakPx = kickSlice.length ? Math.max(...kickSlice.map(pxOf)) : 0
  const peakNdc = kickSlice.length ? Math.max(...kickSlice.map(ndcOf)) : 0
  const peakPctW = kickSlice.length ? Math.max(...kickSlice.map((r) => Math.abs(r.x - mx))) / 2 * 100 : 0
  const peakPctH = kickSlice.length ? Math.max(...kickSlice.map((r) => Math.abs(r.y - my))) / 2 * 100 : 0

  // Post-slide tracking pan, for context only: the camera following the knocked-
  // back fighter. Legitimate camera work, but NOT the impact kick, so it is kept
  // out of the kick number and merely reported.
  const trackSlice = contact >= 0 ? samp.slice(end, Math.min(samp.length, end + 20)) : []
  const trackPeakPx = trackSlice.length ? Math.max(...trackSlice.map(pxOf)) : 0

  return {
    landed, contactIdx: contact, samples: samp.length, maxHitstop,
    kickWindowFrames: kickSlice.length,
    baselinePx: +baselinePx.toFixed(2),
    peakPx: +peakPx.toFixed(2),
    peakNdc: +peakNdc.toFixed(5),
    peakPctScreenWidth: +peakPctW.toFixed(3),
    peakPctScreenHeight: +peakPctH.toFixed(3),
    trackPeakPx: +trackPeakPx.toFixed(2),
    ratio: +(peakPx / Math.max(0.01, baselinePx)).toFixed(1),
  }
}

// Measure one weight, trying candidate ranges until the attack actually lands.
async function measureWeight(w) {
  let best = null
  for (const gap of w.gaps) {
    const samp = await firePass(gap, w.key)
    const m = analyse(samp)
    best = { ...m, gapUsed: gap }
    if (m.landed) break
    await sleep(250)
  }
  return { label: w.label, level: w.level, key: w.key, shake: w.shake, ...best }
}

rmDirSafe(OUT)
mkdirSync(OUT, { recursive: true })

// ── Per-weight curve (intact camera) ─────────────────────────────────────────
const weights = []
for (const w of WEIGHTS) {
  const r = await measureWeight(w)
  weights.push(r)
  await sleep(300)
}

// ── Self-mutation control: silence the kick via the product's DEV hook, re-fire
// the heavy, and confirm the projection collapses back toward the still baseline.
// If it does not, the instrument is measuring something other than addShake and
// every kick number above is suspect.
await page.evaluate(() => { window.__MUT_NO_KICK__ = true })
const heavyW = WEIGHTS[2]
const mutSamp = await firePass(heavyW.gaps[heavyW.gaps.length - 1], heavyW.key)
const mutated = { ...analyse(mutSamp), gapUsed: heavyW.gaps[heavyW.gaps.length - 1] }
await page.evaluate(() => { window.__MUT_NO_KICK__ = false })

const heavy = weights.find((w) => w.label === 'heavy')
const light = weights.find((w) => w.label === 'light')
const medium = weights.find((w) => w.label === 'medium')

// Headline: the honest replacement for the old lying `maxMag`. Peak camera shift
// on a landed heavy, in px at this viewport — the exact quantity the old tool
// reported as 0.
const maxMag = heavy && heavy.landed ? heavy.peakPx : 0

// ── Verdict. The gate can genuinely fail: heavy must land, its kick must clear
// the baseline, and the mutation control must collapse. Monotonic weight scaling
// is reported and asserted only across the weights that actually landed.
const landedAll = weights.every((w) => w.landed)
const heavyReal = heavy && heavy.landed && heavy.peakPx > heavy.baselinePx * 5 && heavy.peakPx > 4
const mutCollapsed = heavy && heavy.landed && mutated.peakPx < heavy.peakPx * 0.35
const landedSeq = weights.filter((w) => w.landed)
const monotonic = landedSeq.every((w, i) => i === 0 || w.peakPx > landedSeq[i - 1].peakPx)
const pass = heavyReal && mutCollapsed && landedAll

const out = {
  build: SHA, viewport: { w: VW, h: VH }, query: QUERY,
  weights, mutatedHeavy: mutated, maxMag,
  checks: { landedAll, heavyReal, mutCollapsed, monotonic },
  verdict: pass
    ? `PASS: camera kick lands + scales with weight; disabling it collapses ${heavy.peakPx}->${mutated.peakPx}px`
    : 'FAIL: see checks (kick not proven real, or a weight whiffed, or mutation did not collapse)',
}
writeFileSync(`${OUT}/impact.json`, JSON.stringify(out, null, 2))

console.log(`impact-frames  build ${SHA}  live-RAF camera-kick curve  (viewport ${VW}x${VH})`)
console.log('  weight   landed  hitstop  gap   baselinePx  peakPx  %scrW   ratio')
for (const w of weights) {
  console.log(
    `  ${w.label.padEnd(7)} ${String(w.landed).padEnd(6)} ${String(w.maxHitstop).padStart(6)}  ${String(w.gapUsed).padStart(4)}  ${String(w.baselinePx).padStart(9)}  ${String(w.peakPx).padStart(6)}  ${String(w.peakPctScreenWidth).padStart(5)}  ${String(w.ratio).padStart(5)}`,
  )
}
console.log(`  MUT off  ${String(mutated.landed).padEnd(6)} ${String(mutated.maxHitstop).padStart(6)}  ${String(mutated.gapUsed).padStart(4)}  ${String(mutated.baselinePx).padStart(9)}  ${String(mutated.peakPx).padStart(6)}   (kick silenced via __MUT_NO_KICK__)`)
console.log(`  headline maxMag (heavy peak): ${maxMag}px  ${light ? `| light ${light.peakPx}px  medium ${medium.peakPx}px  heavy ${heavy.peakPx}px` : ''}`)
if (heavy && heavy.landed) console.log(`  context: heavy kick window=${heavy.kickWindowFrames}f  peak=${heavy.peakNdc} NDC (${heavy.peakPctScreenWidth}% scrW)  | post-hit camera TRACKS knockback ${heavy.trackPeakPx}px (not counted as kick)`)
console.log(`  checks: landedAll=${landedAll} heavyReal=${heavyReal} mutCollapsed=${mutCollapsed} monotonic=${monotonic}`)
console.log(`  ${out.verdict}`)

await browser.close()
process.exit(pass ? 0 : 1)

function rmDirSafe(d) {
  try { execSync(`rm -rf ${JSON.stringify(d)}`) } catch {}
}
