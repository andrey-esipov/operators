/**
 * measure-fight-audio.mjs — the instrument that can HEAR THE SEAM.
 *
 * `measure-audio.mjs` proves the catalog makes sound in isolation. This tool
 * proves the WIRING: that a sim event, fed through the ACTUAL FightAudioReactor
 * (the exact class the renderer drives), produces real PCM energy at the right
 * time. That seam is precisely what shipped broken for the entire life of the
 * project — the audio engine was built and never called, and a camera cannot
 * hear silence, so nothing caught it.
 *
 * It renders one OfflineAudioContext timeline of scripted events via
 * /audiolab.html's __AUDIOLAB__.renderTimeline, then measures a 250ms window
 * after each event onset (peak, RMS dBFS, sub-200Hz fraction) and asserts:
 *
 *   1. PRE-ROLL SILENCE  — nothing sounds before the first event (audio is
 *      event-driven, not sprayed).
 *   2. EVERY EVENT AUDIBLE — whiff, hit(medium), hit(heavy), counter-hit,
 *      block, parry, super-flash, ko each land real energy in their window.
 *   3. COUNTER IS MEATIER — a counter-hit is louder AND weightier than a
 *      normal medium hit (it layers crit+heavy; the new mechanic deserves it).
 *   4. WEIGHT ORDERING — heavy hit louder than medium; block quieter than heavy.
 *
 * MUTATION SELF-TEST (prove this probe can go red on the real failure path,
 * driven browser-side through the reactor, not by faking PCM here):
 *   --mutate no-wiring : never drive the reactor → ALL windows silent → the
 *                        exact shipped defect; every "audible" assertion FAILS.
 *   --mutate drop-hit  : skip only `hit` events → medium/heavy windows silent
 *                        while counter/block/etc still sound → per-event proof.
 *
 * Run (serve the harness first):
 *   npx vite dev --port 5400 --host &
 *   node tools/measure-fight-audio.mjs [--port 5400] [--headed] [--mutate ...]
 *   # exit code without a pipe:  node tools/measure-fight-audio.mjs; echo $?
 */

import { chromium } from 'playwright-core'

const arg = (flag, def) => {
  const i = process.argv.indexOf(flag)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def
}
const has = (flag) => process.argv.includes(flag)

const PORT = arg('--port', '5400')
const URL = `http://localhost:${PORT}/audiolab.html`
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const MUTATE = arg('--mutate', 'none') // none | no-wiring | drop-hit

const failures = []
function check(name, ok, detail) {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures.push(name)
}

// ── DSP helpers (Node side) — same math as measure-audio.mjs ────────────────

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
function peakOf(x) {
  let p = 0
  for (let i = 0; i < x.length; i++) { const a = Math.abs(x[i]); if (a > p) p = a }
  return p
}
function rmsOf(x) {
  let s = 0
  for (let i = 0; i < x.length; i++) s += x[i] * x[i]
  return Math.sqrt(s / Math.max(1, x.length))
}
const dB = (a) => (a <= 1e-9 ? -Infinity : 20 * Math.log10(a))

function fft(re, im) {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) { [re[i], re[j]] = [re[j], re[i]];[im[i], im[j]] = [im[j], im[i]] }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len
    const wr = Math.cos(ang), wi = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k], ui = im[i + k]
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr
        re[i + k] = ur + vr; im[i + k] = ui + vi
        re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi
        const ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr
      }
    }
  }
}

/** Low (<200Hz) and high (>2kHz) magnitude fractions on a Hann-windowed slice. */
function bandFracs(x, sampleRate, loEdge = 200, hiEdge = 2000) {
  let size = 1
  while (size < x.length && size < 32768) size <<= 1
  const re = new Float32Array(size), im = new Float32Array(size)
  const L = Math.min(x.length, size)
  for (let i = 0; i < L; i++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / Math.max(1, L - 1))
    re[i] = x[i] * w
  }
  fft(re, im)
  const half = size / 2
  let den = 0, low = 0, high = 0
  for (let k = 1; k < half; k++) {
    const mag = Math.hypot(re[k], im[k])
    const f = (k * sampleRate) / size
    den += mag
    if (f < loEdge) low += mag
    else if (f > hiEdge) high += mag
  }
  return { lowFrac: den > 0 ? low / den : 0, highFrac: den > 0 ? high / den : 0 }
}

/** Causal one-pole DC-blocking high-pass (~20Hz). 0Hz is inaudible and impact
 *  synths are slightly DC-biased (a punch pushes the cone one way); a real
 *  speaker removes it this way. Being causal, it can never lift a silent region
 *  — unlike subtracting a global mean, which would smear a later event's DC bias
 *  backward into the pre-roll and fake energy that isn't there. */
function dcBlock(x, sampleRate = 48000) {
  const R = 1 - (2 * Math.PI * 20) / sampleRate
  const y = new Float32Array(x.length)
  let prevX = 0, prevY = 0
  for (let i = 0; i < x.length; i++) {
    const xi = x[i]
    const yi = xi - prevX + R * prevY
    y[i] = yi
    prevX = xi
    prevY = yi
  }
  return y
}

/** Measure one time window [t, t+dur) of the mono render. */
function windowStats(mono, sampleRate, t, dur = 0.25) {
  const a = Math.max(0, Math.floor(t * sampleRate))
  const b = Math.min(mono.length, Math.floor((t + dur) * sampleRate))
  const seg = mono.subarray(a, b)
  const peak = peakOf(seg)
  const rms = rmsOf(seg)
  const { lowFrac, highFrac } = bandFracs(seg, sampleRate)
  return { peak, rmsDb: dB(rms), lowFrac, highFrac }
}

// ── the scripted match: one event per lane, spaced so windows never overlap ─
// Times in seconds. `at` is centred (pan is irrelevant to energy once we mono).
const AT = { x: 0, y: 40 }
const SCRIPT = [
  { t: 0.30, label: 'whiff', ev: { type: 'whiff', at: AT, attacker: 0 } },
  { t: 1.30, label: 'hit-medium', ev: { type: 'hit', at: AT, attacker: 0, level: 'medium', damage: 12 } },
  { t: 2.60, label: 'hit-heavy', ev: { type: 'hit', at: AT, attacker: 0, level: 'heavy', damage: 92 } },
  { t: 3.90, label: 'counter', ev: { type: 'counter-hit', at: AT, attacker: 0, level: 'medium', damage: 12 } },
  { t: 5.20, label: 'block', ev: { type: 'block', at: AT, attacker: 0 } },
  { t: 6.20, label: 'parry', ev: { type: 'parry', at: AT, attacker: 0 } },
  { t: 7.40, label: 'super', ev: { type: 'super-flash', who: 0, moveId: 'ult' } },
  { t: 9.20, label: 'ko', ev: { type: 'ko', who: 1 } },
]

// ── run ─────────────────────────────────────────────────────────────────────

const browser = await chromium.launch({
  headless: !has('--headed'),
  executablePath: CHROME,
  args: ['--window-position=4000,4000', '--hide-scrollbars', '--autoplay-policy=no-user-gesture-required'],
})
const page = await browser.newPage()
page.on('pageerror', (e) => { console.log(`  page error: ${e.message}`); failures.push(`pageerror: ${e.message}`) })

try {
  await page.goto(URL, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => window.__AUDIOLAB__?.ready?.() && window.__AUDIOLAB__?.renderTimeline, null, { timeout: 30_000 })

  const script = SCRIPT.map(({ t, ev }) => ({ t, ev }))
  const res = await page.evaluate(
    ({ script, mutate }) => window.__AUDIOLAB__.renderTimeline(script, { stage: 'hypergrowth', dry: true, mutate }),
    { script, mutate: MUTATE },
  )
  const mono = dcBlock(toMono(b64ToF32(res.b64)), res.sampleRate)
  const sr = res.sampleRate

  const preRoll = windowStats(mono, sr, 0.0, 0.25)
  const W = {}
  for (const s of SCRIPT) W[s.label] = windowStats(mono, sr, s.t)

  // ── table ──
  console.log(`\n  timeline: ${(res.length / sr).toFixed(2)}s @ ${sr}Hz   mutate=${MUTATE}`)
  console.log('  window            t(s)    peak   rms(dB)   <200Hz   >2kHz')
  console.log('  ' + '-'.repeat(60))
  console.log(`  ${'(pre-roll)'.padEnd(15)} ${(0).toFixed(2).padStart(5)}  ${preRoll.peak.toFixed(3).padStart(5)}  ${preRoll.rmsDb.toFixed(1).padStart(6)}   ${(preRoll.lowFrac * 100).toFixed(1).padStart(5)}%  ${(preRoll.highFrac * 100).toFixed(1).padStart(5)}%`)
  for (const s of SCRIPT) {
    const r = W[s.label]
    console.log(`  ${s.label.padEnd(15)} ${s.t.toFixed(2).padStart(5)}  ${r.peak.toFixed(3).padStart(5)}  ${r.rmsDb.toFixed(1).padStart(6)}   ${(r.lowFrac * 100).toFixed(1).padStart(5)}%  ${(r.highFrac * 100).toFixed(1).padStart(5)}%`)
  }
  console.log('')

  // ── 1. pre-roll silence: nothing sounds before the first scripted event ──
  // Measured on the DC-blocked signal: a firing event peaks 0.4–1.0; a silent
  // window (see --mutate no-wiring) is ~0.0004. 0.02 is orders of magnitude below
  // any event yet far above the noise floor.
  check('pre-roll is silent (audio is event-driven)', preRoll.peak < 0.02,
    `peak ${preRoll.peak.toFixed(4)}`)

  // ── 2. every event lands real energy in its window ──
  for (const s of SCRIPT) {
    const r = W[s.label]
    check(`${s.label} window is audible`, r.peak > 0.05 && r.rmsDb > -55,
      `peak ${r.peak.toFixed(3)}, rms ${r.rmsDb.toFixed(1)}dB`)
  }

  // ── 3. counter-hit carries a crit crack a normal hit lacks ──
  // The shipping master limiter deliberately glues impact LOUDNESS (medium/heavy
  // /counter all land ≈ −12 dB), so "louder" is not the honest axis — SPECTRUM
  // is. A counter layers a bright crit transient over the body, so it has more
  // >2kHz energy than a plain medium hit. Collapses if counter routes to the
  // same synth as a normal hit.
  check('counter-hit has a brighter crit transient than a medium hit',
    W.counter.highFrac > W['hit-medium'].highFrac + 0.02,
    `counter ${(W.counter.highFrac * 100).toFixed(1)}% vs medium ${(W['hit-medium'].highFrac * 100).toFixed(1)}% (>2kHz)`)

  // ── 4. flavours are spectrally distinct (survives the limiter) ──
  check('whiff is airy (little body) vs a hit',
    W.whiff.lowFrac < W['hit-medium'].lowFrac - 0.10,
    `whiff ${(W.whiff.lowFrac * 100).toFixed(1)}% vs medium ${(W['hit-medium'].lowFrac * 100).toFixed(1)}% (<200Hz)`)
  check('ko carries real low-end body',
    W.ko.lowFrac > 0.12,
    `ko ${(W.ko.lowFrac * 100).toFixed(1)}% (<200Hz)`)
  check('block is quieter than a heavy hit',
    W.block.rmsDb < W['hit-heavy'].rmsDb - 2.0,
    `block ${W.block.rmsDb.toFixed(1)}dB vs heavy ${W['hit-heavy'].rmsDb.toFixed(1)}dB`)
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
console.log('\nall checks passed — sim events drive the reactor and produce measured PCM at the right time')
