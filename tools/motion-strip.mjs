// Motion instrument: capture N *consecutive* sim frames and measure smoothness.
//
// Why this exists. The critic has scored `stills 6.5 / motion 4.5` for several
// sessions, and a blind A/B on stills across two builds several sessions apart
// came back 5-4 and 6-3 -- indistinguishable. Its diagnosis was right and it
// committed it before the reveal: animation density is *temporal*, and a denser
// breathing loop is smoother over time, not a better frozen pose. So a still can
// never measure the thing the animation work changed, and every instrument this
// project owns is a still.
//
// Why it can't just sleep between screenshots. A DPR-2 screenshot takes long
// enough for the sim to advance ten frames or more, so "sample every 100ms"
// measures the screenshot's cost, not the animation. This drives
// `__PLAY__.step(1)` against a frozen sim, so frame k and frame k+1 are
// genuinely adjacent.
//
// What it reports. Per-frame mean absolute pixel difference over the fighter
// region, and from that:
//   held    - frames identical to their predecessor (a held drawing)
//   longest - the longest run of held frames (the "it froze" tell)
//   spikes  - deltas far above the median (a pose snapping, not easing)
// A 4-frame idle held across 60 sim frames gives long held runs and a few big
// spikes. A 10-frame breathing loop gives short runs and evenly-spread deltas.

import { chromium } from 'playwright-core'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import sharp from 'sharp'

const arg = (n, d) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : d)
const PORT = arg('--port', '5399')
const OUT = arg('--out', 'motion-strips')
const QUERY = arg('--query', 'a=spiegel&b=lenny&p1=warden&p2=operator&cpu=easy')
const FRAMES = Number(arg('--frames', '48'))
// Sim frames advanced per measured sample. Flip to 0 to mutation-test the
// instrument: with no animation the signal/floor ratio must collapse to ~1.0.
const STEP = Number(arg('--step', '1'))
const ACTION = arg('--action', 'idle')
// How much of the frame to discard as background, ranked by how much each pixel
// moves while the sim is frozen. 15% is enough to take the confetti and the
// window bank without touching the fighter, who is motionless in the control.
const MASK_PCT = Number(arg('--mask', '15'))
const SHA = arg('--build', execSync('git rev-parse --short HEAD').toString().trim())
const URL = `http://localhost:${PORT}/?${QUERY}`

const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-angle=metal', '--no-sandbox'],
})
// DPR 1 and a modest viewport: this tool trades resolution for frame count, and
// 48 full-res screenshots would take minutes. Native-res judgement is
// play-shots' job; this one measures change over time.
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 })
await page.goto(URL, { waitUntil: 'domcontentloaded' })
let reloaded = false
page.on('framenavigated', (f) => {
  if (f === page.mainFrame()) reloaded = true
})

const key = async (k, ms = 60) => {
  await page.keyboard.down(k)
  await page.waitForTimeout(ms)
  await page.keyboard.up(k)
}

// A reload tears down __PLAY__ underneath us. Vite fires one on its first
// dep-optimizer pass, and any edit to the repo fires more. During *setup* that
// is recoverable, because setup starts a fresh match anyway -- so retry. During
// *capture* it is fatal, because the strip would silently become frames of a
// restarted match filed under whatever action was requested. A tool that
// quietly re-latched in both cases is exactly the lying-harness shape.
const setup = async () => {
  reloaded = false
  // React StrictMode double-mounts in dev, briefly deleting window.__PLAY__, so
  // a single waitForFunction can latch onto a torn-down instance (or throw as
  // the object vanishes mid-evaluation). Require it present and fighting across
  // consecutive polls -- the same guard play-shots already needed.
  let stable = 0
  for (let i = 0; i < 400 && stable < 15; i++) {
    let ok = false
    try {
      ok = await page.evaluate(
        () => !!window.__PLAY__?.ready?.() && window.__PLAY__.state().phase === 'fight',
      )
    } catch {
      ok = false
    }
    stable = ok ? stable + 1 : 0
    await page.waitForTimeout(30)
  }
  if (stable < 15) return 'the game never reached a stable fighting state'
  if (!(await page.evaluate(() => typeof window.__PLAY__?.step === 'function')))
    return 'this build has no __PLAY__.step(); cannot capture consecutive frames'
  await page.waitForTimeout(600)

  // Put the fighter into the state we want to film, then freeze.
  if (ACTION === 'dash') {
    await key('ArrowRight', 40)
    await page.waitForTimeout(30)
    await page.keyboard.press('ArrowRight')
  } else if (ACTION === 'attack') {
    await key('ArrowRight', 300)
    await page.keyboard.press('KeyL')
  } else if (ACTION === 'jump') {
    await page.keyboard.press('ArrowUp')
  } else if (ACTION === 'hit') {
    // The critic capped motion at 5.5 because hitstop and reaction latency were
    // unmeasured -- "those decide whether it hurts" -- and no beat existed that
    // began at contact. Freezing a fixed time after pressing attack does not
    // work: the gap between the press and the hit varies with spacing, startup
    // and whether the CPU blocked, so the strip would start at a different point
    // in the reaction every run and the numbers would not be comparable.
    //
    // So detect the hit itself. Walk into range, swing, and poll the live state
    // for the defender's health actually dropping, then freeze on that frame.
    // Frame 0 of the strip is then contact, by construction, every time.
    const hpBefore = await page.evaluate(() => window.__PLAY__.state().fighters[1].health)
    await key('ArrowRight', 520)
    let connected = false
    for (let swing = 0; swing < 6 && !connected; swing++) {
      await page.keyboard.press('KeyL')
      for (let i = 0; i < 40; i++) {
        const hp = await page.evaluate(() => window.__PLAY__.state().fighters[1].health)
        if (hp < hpBefore) {
          connected = true
          break
        }
        await page.waitForTimeout(8)
      }
      if (!connected) await key('ArrowRight', 90)
    }
    // A strip that silently starts somewhere other than contact is worth less
    // than no strip, so refuse rather than film an unknown moment.
    if (!connected) return 'never landed a hit, so there is no contact frame to film from'
  }
  if (reloaded) return 'RELOADED'
  await page.evaluate(() => window.__PLAY__.pause())
  return null
}

let err = 'RELOADED'
for (let attempt = 0; attempt < 3 && err === 'RELOADED'; attempt++) {
  if (attempt > 0) console.log('  (page reloaded during setup, retrying)')
  err = await setup()
}
if (err) {
  console.log(`FAILED: ${err === 'RELOADED' ? 'the page kept reloading during setup' : err}.`)
  await browser.close()
  process.exit(1)
}

const guard = async (label) => {
  if (reloaded) {
    console.log(`FAILED: the page reloaded during ${label}. The strip would be a restarted match.`)
    await browser.close()
    process.exit(1)
  }
}

rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })

// Crop to the left fighter, so background parallax and the opponent don't
// contribute to a delta that is supposed to be about one character's animation.
// Cropped onto the left fighter's body, not the whole play area. Chosen by
// measuring, not by eye: a per-column change map of a real strip divided by the
// same map from a --step 0 run (pure renderer drift, no sim) showed the fighter
// columns carrying 5.8-11.5x more change than drift, while the right of the
// frame -- the window bank and the confetti -- carried only 1.4x. Including
// that region buries the animation in background noise.
const CLIP = {
  x: Number(arg('--x', '300')),
  y: Number(arg('--y', '90')),
  width: Number(arg('--w', '240')),
  height: Number(arg('--h', '560')),
}

const bufs = []
const floors = []
// Interleaved control. `pause()` freezes the *sim*, not the *renderer*: the
// camera keeps drifting, confetti keeps falling, and the stage keeps animating
// on render time. Measured, not assumed -- with stepping replaced by step(0) the
// median per-frame delta was 15.6, and the diff map lit up the whole frame
// (pillars, floor, window bank, and the fighter's silhouette edges), which is a
// camera shift, not sensor noise.
//
// So every frame is sampled twice -- but the two samples must span the *same
// wall clock*, or the comparison is worthless. A first version took the control
// as two back-to-back screenshots while the measured pair had an evaluate round
// trip in between; the mutant (step(1) -> step(0), i.e. no animation at all)
// scored 1.36x against the real run's 1.39x, because the ratio was measuring
// elapsed time, not sim advancement. So the control performs the identical
// operations -- evaluate, poll, screenshot -- and differs only in stepping zero
// frames instead of one.
const advance = async (n) => {
  // A reload during capture surfaces as a raw "Execution context was destroyed"
  // out of the evaluate, which escaped the guard below and crashed with a stack
  // trace instead of the intended message. Convert it here so the failure is
  // legible and still fatal -- capture-phase reloads must never be recovered
  // from silently, or the strip becomes frames of a restarted match.
  try {
    await page.evaluate((k) => window.__PLAY__.step(k), n)
  } catch (e) {
    console.log(`FAILED: the page reloaded mid-capture (${e.name}). The strip would be a restarted match.`)
    await browser.close()
    process.exit(1)
  }
  // Let the frozen sim actually consume the step before the next screenshot,
  // otherwise consecutive files are the same frame and the tool reports a
  // perfectly smooth animation that never moved.
  for (let w = 0; w < 20; w++) {
    if ((await page.evaluate(() => window.__PLAY__.stepsPending())) <= 0) break
    await page.waitForTimeout(16)
  }
  return page.screenshot({ clip: CLIP })
}

for (let i = 0; i < FRAMES; i++) {
  await guard(`frame ${i}`)
  const before = await page.screenshot({ clip: CLIP })
  const control = await advance(0)
  const stepped = await advance(STEP)
  floors.push([before, control])
  bufs.push([control, stepped])
  writeFileSync(`${OUT}/f${String(i).padStart(3, '0')}.png`, stepped)
}
await page.evaluate(() => window.__PLAY__.resume())

const grey = async (b) => (await sharp(b).greyscale().resize(160).raw().toBuffer({ resolveWithObject: true }))
const absMap = (x, y) => {
  const m = new Float32Array(x.data.length)
  for (let p = 0; p < x.data.length; p++) m[p] = Math.abs(x.data[p] - y.data[p])
  return m
}

// Per-pixel, not per-frame. The critic's charge against v1 was fair: on the two
// busy-background beats the scalar mean folded confetti and stage animation in
// with the fighter, so a livelier background read as a livelier character. The
// interleaved zero-step control already knows exactly which pixels move without
// the sim, so the background mask is derivable from data we were already
// collecting -- no new capture, no hand-drawn rectangle, no code change to the
// game. A hand-tuned crop is what put an empty rectangle in this tool once
// already; this replaces the judgement call with a measurement.
const floorMaps = []
for (const [a, aP] of floors) floorMaps.push(absMap(await grey(a), await grey(aP)))
const stepMaps = []
for (const [control, stepped] of bufs) stepMaps.push(absMap(await grey(control), await grey(stepped)))

const NPX = floorMaps[0].length
// A pixel's background activity is what it does while the sim is frozen.
// Confetti, camera easing and stage animation are all hot here; the fighter is
// not, because a frozen sim cannot move him.
const bgActivity = new Float32Array(NPX)
for (const m of floorMaps) for (let p = 0; p < NPX; p++) bgActivity[p] += m[p] / floorMaps.length

const order = [...bgActivity.keys()].sort((a, b) => bgActivity[a] - bgActivity[b])
const scoreAt = (pct) => {
  const keep = order.slice(0, Math.floor(NPX * (1 - pct / 100)))
  const mean = (m) => {
    let s = 0
    for (const p of keep) s += m[p]
    return s / keep.length
  }
  return { keep, sig: stepMaps.map(mean), flr: floorMaps.map(mean) }
}

const med = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]
// Report the sensitivity rather than defending one knob setting. If the reading
// only survives at one mask percentage it is a knob, not a measurement.
const SWEEP = [0, 5, MASK_PCT, 30].filter((v, i, a) => a.indexOf(v) === i).sort((a, b) => a - b)
const sweep = SWEEP.map((pct) => {
  const { sig, flr } = scoreAt(pct)
  return { pct, ratio: med(sig) / med(flr), signal: med(sig), floor: med(flr) }
})

const chosen = scoreAt(MASK_PCT)
const deltas = chosen.sig
const floorDeltas = chosen.flr
const median = med(deltas)
const floor = med(floorDeltas)

// The mask must not eat the subject. This tool has already reported a confident
// "6.0 keys/sec" about a rectangle the fighter had jumped out of, so a mask that
// silently removed the fighter is the same defect wearing a new hat. Masking
// background can only raise the ratio -- but only when there is signal to
// protect. Under `--step 0` nothing moves, both ratios sit at 1.0, and their
// difference is pure noise, so the check is inapplicable and says so rather than
// failing on a mutant it was never meant to judge.
const unmasked = sweep.find((s) => s.pct === 0).ratio
if (MASK_PCT > 0 && unmasked > 1.15 && median / floor < unmasked * 0.95) {
  console.log(
    `FAILED: masking the top ${MASK_PCT}% most background-active pixels LOWERED the ` +
      `signal ratio (${unmasked.toFixed(2)}x -> ${(median / floor).toFixed(2)}x). ` +
      `Removing background can only help, so the mask is removing the fighter.`,
  )
  process.exit(1)
}
if (unmasked <= 1.15) {
  console.log(`  (no motion above floor unmasked at ${unmasked.toFixed(2)}x — mask integrity check not applicable)`)
}
// "Held" has to be defined against the measured floor, not an absolute: a frame
// that only changed as much as the camera drift did is a held drawing.
const HELD = floor * 1.25
const held = deltas.filter((d) => d < HELD).length
let longest = 0
let run = 0
for (const d of deltas) {
  run = d < HELD ? run + 1 : 0
  longest = Math.max(longest, run)
}
const spikes = deltas.filter((d) => d > median * 4).length

console.log(`motion strip: ${ACTION}  ${FRAMES} consecutive sim frames  build ${SHA}`)
console.log(`  background mask        : top ${MASK_PCT}% most sim-frozen-active pixels dropped`)
console.log(`  noise floor (0 steps)  : ${floor.toFixed(2)}   <- residual camera drift`)
console.log(`  median delta (1 step)  : ${median.toFixed(2)}`)
console.log(`  signal / floor         : ${(median / floor).toFixed(2)}x`)
console.log(`  mask sensitivity       : ${sweep.map((s) => `${s.pct}%->${s.ratio.toFixed(2)}x`).join('  ')}`)
console.log(`  max                    : ${Math.max(...deltas).toFixed(2)}`)
console.log(`  held frames (<=floor)  : ${held}/${deltas.length}  (${((held / deltas.length) * 100).toFixed(0)}%)`)
console.log(`  longest held run       : ${longest} frames`)
console.log(`  spikes (>4x median)    : ${spikes}`)
console.log(`  strip written to       : ${OUT}/`)

writeFileSync(
  `${OUT}/motion.json`,
  JSON.stringify(
    { build: SHA, action: ACTION, frames: FRAMES, maskPct: MASK_PCT, sweep, floor, median, ratio: median / floor, held, longest, spikes, deltas, floorDeltas },
    null,
    2,
  ),
)

// A contact sheet so the strip can be looked at, not only measured.
const cols = 8
const thumbs = await Promise.all(bufs.map(([, stepped]) => sharp(stepped).resize(200).toBuffer()))
const meta = await sharp(thumbs[0]).metadata()
await sharp({
  create: {
    width: meta.width * cols,
    height: meta.height * Math.ceil(thumbs.length / cols),
    channels: 3,
    background: '#101014',
  },
})
  .composite(
    thumbs.map((input, i) => ({
      input,
      left: (i % cols) * meta.width,
      top: Math.floor(i / cols) * meta.height,
    })),
  )
  .png()
  .toFile(`${OUT}/contact-sheet.png`)
console.log(`  contact sheet          : ${OUT}/contact-sheet.png`)

await browser.close()
