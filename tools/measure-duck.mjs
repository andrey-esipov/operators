/**
 * measure-duck.mjs — proves the sidechain music duck is DOING REAL WORK.
 *
 * The loudness-ladder tool (measure-fight-audio.mjs) renders `dry` with the
 * music sink no-op'd, so it can prove impacts get louder by tier but it CANNOT
 * see the other half of "weight": the music bed ducking out from under a super
 * or KO so the moment reads with loudness *contrast*. A super's raw stinger is
 * one of the quieter one-shots (~−18 dB) — what sells it is that the whole bed
 * drops ~10 dB away underneath it. That duck lives only in live playback (an
 * MP3 through musicBus → musicDuck), exactly the "authored, only ever consumed
 * live, never measured" shape this project keeps shipping bugs into.
 *
 * This drives /audiolab's __AUDIOLAB__.renderDuckProbe, which routes a steady
 * tone through the REAL music bus and fires the SHIP duckMusicRamp curve, then
 * measures the bed's RMS in a pre-duck window vs a during-duck window.
 *
 * Asserts, per super(0.95) and KO(1.0):
 *   1. the bed ducks by a real margin (≥ 6 dB) while the event rings;
 *   2. KO ducks at least as deep as a super (bigger moment, harder pump);
 *   3. the bed RECOVERS afterwards (the pump is transient, not a mute).
 *
 * MUTATION SELF-TEST (built in, no source edit): the same probe with duck:false
 * renders the identical tone with the duck ramp NOT fired. The during-window
 * then equals the pre-window (drop ≈ 0 dB) and assertion 1 FAILS — proving the
 * measured drop is the duck, not the master or the tone shape.
 *
 * Run (serve the harness first — ONE dev server, unique port):
 *   npx vite dev --port 5533 --host &
 *   node tools/measure-duck.mjs [--port 5533]
 *   # exit code without a pipe:  node tools/measure-duck.mjs; echo $?
 */

import { chromium } from 'playwright-core'

const arg = (flag, def) => {
  const i = process.argv.indexOf(flag)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def
}
const has = (flag) => process.argv.includes(flag)

const PORT = arg('--port', '5533')
const URL = `http://localhost:${PORT}/audiolab.html`
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

const failures = []
function check(name, ok, detail) {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures.push(name)
}

function b64ToF32(b64) {
  const bin = Buffer.from(b64, 'base64')
  return new Float32Array(bin.buffer, bin.byteOffset, Math.floor(bin.byteLength / 4))
}
function toMono(inter) {
  const n = Math.floor(inter.length / 2)
  const m = new Float32Array(n)
  for (let i = 0; i < n; i++) m[i] = 0.5 * (inter[i * 2] + inter[i * 2 + 1])
  return m
}
function rmsOf(x, a, b) {
  let s = 0
  const lo = Math.max(0, a), hi = Math.min(x.length, b)
  for (let i = lo; i < hi; i++) s += x[i] * x[i]
  return Math.sqrt(s / Math.max(1, hi - lo))
}
const dB = (a) => (a <= 1e-9 ? -Infinity : 20 * Math.log10(a))

/** RMS(dB) of a [t, t+dur) window. */
function winDb(mono, sr, t, dur) {
  return dB(rmsOf(mono, Math.floor(t * sr), Math.floor((t + dur) * sr)))
}

async function measure(page, intensity, duck) {
  const res = await page.evaluate(
    ({ intensity, duck }) => window.__AUDIOLAB__.renderDuckProbe({ intensity, duck }),
    { intensity, duck },
  )
  const mono = toMono(b64ToF32(res.b64))
  const sr = res.sampleRate
  // Duck fires at 1.0s with a 12ms down-ramp; measure a settled slab just
  // before, a slab right inside the duck, and a slab after recovery.
  const pre = winDb(mono, sr, 0.55, 0.30)   // steady bed, before the duck
  const during = winDb(mono, sr, 1.03, 0.12) // deepest part of the duck
  const after = winDb(mono, sr, 1.75, 0.30)  // recovered tail
  return { pre, during, after, drop: pre - during, recover: after - during }
}

const browser = await chromium.launch({
  headless: !has('--headed'),
  executablePath: CHROME,
  args: ['--window-position=4000,4000', '--hide-scrollbars', '--autoplay-policy=no-user-gesture-required'],
})
const page = await browser.newPage()
page.on('pageerror', (e) => { console.log(`  page error: ${e.message}`); failures.push(`pageerror: ${e.message}`) })

try {
  await page.goto(URL, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => window.__AUDIOLAB__?.ready?.() && window.__AUDIOLAB__?.renderDuckProbe, null, { timeout: 30_000 })

  const superM = await measure(page, 0.95, true)
  const koM = await measure(page, 1.0, true)
  const control = await measure(page, 1.0, false) // duck OFF — the built-in mutation

  console.log('\n  event         pre(dB)  during(dB)  after(dB)   drop    recover')
  console.log('  ' + '-'.repeat(64))
  const row = (label, m) =>
    console.log(`  ${label.padEnd(12)} ${m.pre.toFixed(1).padStart(6)}  ${m.during.toFixed(1).padStart(9)}  ${m.after.toFixed(1).padStart(7)}   ${m.drop.toFixed(1).padStart(5)}   ${m.recover.toFixed(1).padStart(5)}`)
  row('super 0.95', superM)
  row('ko 1.0', koM)
  row('CONTROL off', control)
  console.log('')

  // 1. The bed ducks by a real margin while the event rings.
  check('super ducks the music bed (≥6dB)', superM.drop >= 6, `drop ${superM.drop.toFixed(1)}dB`)
  check('ko ducks the music bed (≥6dB)', koM.drop >= 6, `drop ${koM.drop.toFixed(1)}dB`)

  // 2. KO — the bigger moment — ducks at least as deep as a super.
  check('ko ducks at least as deep as a super', koM.drop >= superM.drop - 0.5,
    `ko ${koM.drop.toFixed(1)}dB vs super ${superM.drop.toFixed(1)}dB`)

  // 3. The pump is transient: the bed recovers, it is not a mute.
  check('the bed recovers after the duck (≥4dB back)', koM.recover >= 4, `+${koM.recover.toFixed(1)}dB`)

  // 4. MUTATION: duck OFF → no drop. Proves the measured drop is the duck.
  check('CONTROL (duck off) shows no meaningful drop (<1.5dB)', Math.abs(control.drop) < 1.5,
    `drop ${control.drop.toFixed(1)}dB`)
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
console.log('\nall checks passed — the music bed ducks under supers/KOs and recovers (loudness contrast is real)')
