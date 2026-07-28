// super-envelope.mjs — capture the WARDEN's Ion Storm super from the first
// freeze frame through the beam's travel, recording per-frame the phase, the
// super-freeze countdown, the screen-atmosphere state (__PROJATMO__) and the
// live projectile debug (__PROJDBG__). The point is to judge the whole envelope
// as MOTION and STATE, not a single flash still — the super's dead back half was
// invisible in every still and obvious only across a strip (see house rules).
//
// Unlike super-strip.mjs this forces a warden archetype (p1=warden), because the
// screen-wide atmosphere only exists for the warden's super-beam; operator and
// vanguard supers are melee and never touch the ProjectileLayer.
//
// Also emits a native-1:1 "aliveness" number per frame: the mean luma of a
// centre crop, plus the frame-to-frame delta, so a dead run of frames shows up
// as a flat line in the data AND a visibly empty strip.
import { chromium } from 'playwright-core'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import sharp from 'sharp'

const flag = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d }
const PORT = flag('port', '5410')
const OUT = flag('out', 'critique/super-envelope')
const FRAMES = Number(flag('frames', '80'))
const STAGE = flag('stage', 'pre-pmf')
const A = flag('a', 'lenny'); const B = flag('b', 'spiegel')
const P1 = flag('p1', 'warden'); const P2 = flag('p2', 'operator')
const SEED = flag('seed', '')
const STRIP_EVERY = Number(flag('strip-every', '2')) // frames per strip cell
const q = new URLSearchParams({ fight: '1', stage: STAGE, a: A, b: B, p1: P1, p2: P2 })
if (SEED) q.set('seed', SEED)
const BASE = `http://localhost:${PORT}/?${q.toString()}`
rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({
  headless: false,
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-angle=metal', '--window-position=4000,4000', '--hide-scrollbars'],
})
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })
page.on('pageerror', (e) => console.log('  [pageerror]', e.message))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

await page.goto(BASE, { waitUntil: 'domcontentloaded' })
for (let i = 0; i < 120; i++) { if (await page.evaluate(() => !!window.__FIGHT__?.ready())) break; await sleep(250) }
if (!await page.evaluate(() => !!window.__FIGHT__?.ready())) { console.log('FAILED: never ready'); await browser.close(); process.exit(1) }
// Mutation hook: `--mutate no-super` disables the super-state wiring so the whole
// freeze-dim + owner charge collapses. Proves (house rule) the alive back half is
// carried BY that wiring — the measurement must fall back to the dead baseline.
const MUTATE = flag('mutate', '')
if (MUTATE === 'no-super') { await page.evaluate(() => { window.__MUT_NO_SUPER__ = true }); console.log('MUTATION: __MUT_NO_SUPER__ = true') }
await page.evaluate(() => { window.__FIGHT__.pause(); window.__FIGHT__.step(2) })
await sleep(200)

// Hunt to the warden super. We only accept a super whose OWNER is the warden
// (side with p1=warden -> index 0), so an operator/vanguard super doesn't false-
// trigger the capture. Detected via the freeze owner once the freeze arms.
let found = false, total = 0
for (let r = 0; r < 400 && !found; r++) {
  const res = await page.evaluate(() => {
    for (let i = 0; i < 30; i++) {
      window.__FIGHT__.step(1)
      const sf = window.__FIGHT__.superFreeze()
      if (sf.freeze > 0 && sf.who === 0) return { hit: true, i, freeze: sf.freeze }
    }
    return { hit: false, i: 30 }
  })
  total += res.i
  if (res.hit) { found = true; console.log(`warden super freeze armed at ~frame ${total} (freeze=${res.freeze})`) }
}
if (!found) { console.log('FAILED: never reached a warden super'); await browser.close(); process.exit(2) }

// Native crop for the aliveness read: centre 60% of the 1600x900 frame, where
// the fighter and beam live.
const CROP = { left: 320, top: 180, width: 960, height: 540 }

const log = []
let prevLuma = null
for (let f = 0; f < FRAMES; f++) {
  const st = await page.evaluate(() => ({
    phase: window.__FIGHT__.phase(),
    sf: window.__FIGHT__.superFreeze(),
    atmo: window.__PROJATMO__ ? window.__PROJATMO__() : null,
    charge: window.__PROJCHARGE__ ? window.__PROJCHARGE__() : null,
    proj: window.__PROJDBG__ ? window.__PROJDBG__() : [],
  }))
  const name = `f${String(f).padStart(3, '0')}`
  const buf = await page.screenshot({ path: `${OUT}/${name}.png`, timeout: 15000 })
  // Aliveness: mean luma of the centre crop + delta from the previous frame.
  const raw = await sharp(buf).extract(CROP).greyscale().raw().toBuffer()
  let sum = 0
  for (let i = 0; i < raw.length; i++) sum += raw[i]
  const luma = sum / raw.length
  const delta = prevLuma == null ? 0 : Math.abs(luma - prevLuma)
  prevLuma = luma
  log.push({
    f, phase: st.phase, freeze: st.sf.freeze,
    dim: st.atmo?.dim ?? 0, flash: st.atmo?.flash ?? 0,
    charge: st.charge?.charge ?? 0,
    projN: st.proj.length,
    projPhases: st.proj.map((p) => p.phase).join(','),
    luma: Math.round(luma * 10) / 10,
    delta: Math.round(delta * 10) / 10,
  })
  await page.evaluate(() => window.__FIGHT__.step(1))
}
writeFileSync(`${OUT}/log.json`, JSON.stringify(log, null, 2))

// Build a filmstrip: every STRIP_EVERY-th frame, downscaled, tiled in a row-major
// grid so the whole envelope is one image the eye can scan for a dead run.
const cells = log.filter((e) => e.f % STRIP_EVERY === 0)
const CW = 214, CH = 120, COLS = 8
const rows = Math.ceil(cells.length / COLS)
const composites = []
for (let i = 0; i < cells.length; i++) {
  const e = cells[i]
  const name = `f${String(e.f).padStart(3, '0')}`
  const cell = await sharp(`${OUT}/${name}.png`).resize(CW, CH, { fit: 'fill' }).toBuffer()
  const col = i % COLS, row = Math.floor(i / COLS)
  composites.push({ input: cell, left: col * CW, top: row * CH })
}
await sharp({ create: { width: COLS * CW, height: rows * CH, channels: 3, background: { r: 8, g: 8, b: 12 } } })
  .composite(composites)
  .png()
  .toFile(`${OUT}/strip.png`)

// Console summary: the phase/freeze/atmo table + a flag on any interior frame
// where NOTHING is happening (low luma AND no atmosphere AND no charge AND no
// projectile). The charge column is the back-half aliveness signal the baseline
// lacked entirely.
console.log('\n f  phase        frz  dim   flash chrg  proj  luma  d')
for (const e of log) {
  const dead = e.delta < 1.2 && e.dim < 0.02 && e.flash < 0.02 && e.charge < 0.02 && e.projN === 0 && e.f > 2
  console.log(
    `${String(e.f).padStart(2)} ${e.phase.padEnd(11)} ${String(e.freeze).padStart(3)}  ` +
    `${e.dim.toFixed(2)}  ${e.flash.toFixed(2)}  ${e.charge.toFixed(2)}  ${String(e.projN).padStart(2)}   ` +
    `${String(e.luma).padStart(5)} ${String(e.delta).padStart(4)}${dead ? '  <-- DEAD' : ''}`,
  )
}
const deadFrames = log.filter((e) => e.delta < 1.2 && e.dim < 0.02 && e.flash < 0.02 && e.charge < 0.02 && e.projN === 0 && e.f > 2)
console.log(`\nDEAD interior frames (no motion, no atmo, no charge, no projectile): ${deadFrames.length}/${FRAMES}`)
console.log(`strip -> ${OUT}/strip.png   log -> ${OUT}/log.json`)
await browser.close()
