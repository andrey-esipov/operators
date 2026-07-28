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
 * after each event onset (peak, RMS dBFS, sub-200Hz + >2kHz fraction) and, on a
 * SECOND pre-master pass (bypassMaster), quantifies how much dynamic range the
 * mastering chain gives back vs takes away. It asserts:
 *
 *   1. PRE-ROLL SILENCE  — nothing sounds before the first event (audio is
 *      event-driven, not sprayed).
 *   2. EVERY EVENT AUDIBLE — whiff, hit(light/medium/heavy), counter-hit,
 *      block, parry, super-flash, ko each land real energy in their window.
 *   3. LOUDNESS LADDER — the deliberate mix hierarchy is REAL, not glued:
 *      whiff < light < medium < heavy < counter < ko, each step a real margin
 *      apart, and ko is the single loudest impact in the round. This is the
 *      assertion the pre-fix master made impossible (everything ≈ −12 dB); it is
 *      now the primary proof that weight reads as LEVEL, not spectrum alone.
 *   4. DYNAMIC RANGE — light→ko spans a wide band (the mix is not flat/fatiguing).
 *   5. SPECTRUM (kept, an orthogonal axis) — counter carries a brighter crit
 *      crack than a medium hit; whiff is airy; ko carries real low body.
 *
 * MUTATION SELF-TEST (prove this probe can go red on the real failure path,
 * driven browser-side through the reactor, not by faking PCM here):
 *   --mutate no-wiring    : never drive the reactor → ALL windows silent → the
 *                           exact shipped defect; every "audible" assertion FAILS.
 *   --mutate drop-hit     : skip only `hit` events → medium/heavy windows silent
 *                           while counter/block/etc still sound → per-event proof.
 *   --mutate flatten      : force ONE gain on every impact → the ladder collapses
 *                           (LOUDNESS LADDER + DYNAMIC RANGE fail) but everything
 *                           stays audible → proves the assertion targets the
 *                           HIERARCHY, not mere presence.
 *   --mutate crush-master : rebuild the pre-fix (crushing) master → the same
 *                           reactor gains level out → ladder fails → proves the
 *                           master relaxation, not just the gains, is load-bearing.
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
const MUTATE = arg('--mutate', 'none') // none | no-wiring | drop-hit | flatten | crush-master

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

/** Measure one time window [t, t+dur). Loudness/spectral read the DC-blocked
 *  signal (a punch is DC-biased; a real cone removes it). Two peak meters:
 *  `peak` is the RAW true-peak (what the DAC sees — the honest clip meter), while
 *  `peakDC` is the DC-blocked peak used for audibility/silence, because the
 *  offline context's node turn-on leaves a sub-sonic DC step in the raw pre-roll
 *  that isn't sound. (And the causal DC-block overshoots ~2x on a full-scale
 *  polarity flip, so it must NOT be trusted as the clip meter.) */
function windowStats(monoDC, monoRaw, sampleRate, t, dur = 0.25) {
  const a = Math.max(0, Math.floor(t * sampleRate))
  const b = Math.floor((t + dur) * sampleRate)
  const segDC = monoDC.subarray(a, Math.min(monoDC.length, b))
  const segRaw = monoRaw.subarray(a, Math.min(monoRaw.length, b))
  const rms = rmsOf(segDC)
  const { lowFrac, highFrac } = bandFracs(segDC, sampleRate)
  // Attack-window brightness: the >2kHz fraction of just the first ~45 ms, where
  // a hit's crack/snap lives before its body blooms. A counter's crit transient
  // is a bright flash that a 250 ms average dilutes to nothing — the transient is
  // the honest axis on which "brighter crack" is true.
  const atk = bandFracs(segDC.subarray(0, Math.min(segDC.length, Math.floor(0.045 * sampleRate))), sampleRate)
  return { peak: peakOf(segRaw), peakDC: peakOf(segDC), rmsDb: dB(rms), lowFrac, highFrac, highAtk: atk.highFrac }
}

// ── the scripted match: one event per lane, spaced so windows never overlap ─
// Times in seconds. `at` is centred (pan is irrelevant to energy once we mono).
const AT = { x: 0, y: 40 }
const SCRIPT = [
  { t: 0.30, label: 'whiff', ev: { type: 'whiff', at: AT, attacker: 0 } },
  { t: 1.20, label: 'hit-light', ev: { type: 'hit', at: AT, attacker: 0, level: 'light', damage: 6 } },
  { t: 2.10, label: 'hit-medium', ev: { type: 'hit', at: AT, attacker: 0, level: 'medium', damage: 12 } },
  { t: 3.00, label: 'hit-heavy', ev: { type: 'hit', at: AT, attacker: 0, level: 'heavy', damage: 92 } },
  { t: 3.90, label: 'counter', ev: { type: 'counter-hit', at: AT, attacker: 0, level: 'medium', damage: 40 } },
  { t: 5.00, label: 'block', ev: { type: 'block', at: AT, attacker: 0 } },
  { t: 5.90, label: 'parry', ev: { type: 'parry', at: AT, attacker: 0 } },
  { t: 7.00, label: 'super', ev: { type: 'super-flash', who: 0, moveId: 'ult' } },
  { t: 8.80, label: 'ko', ev: { type: 'ko', who: 1 } },
]

// The intended monotonic loudness ladder (quiet → loud). `super` is a sustained
// stinger, not a transient, so its 250ms-window RMS is not comparable to the
// transient hits — it is measured + reported but kept OUT of the strict ladder.
const LADDER = ['whiff', 'hit-light', 'hit-medium', 'hit-heavy', 'counter', 'ko']

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
  const raw = toMono(b64ToF32(res.b64))
  const mono = dcBlock(raw, res.sampleRate)
  const sr = res.sampleRate

  // Second pass, PRE-master: route the same reactor straight to the destination
  // so we can see the synth loudness before the mastering chain touches it, and
  // quantify how much dynamic range the master preserves. Only meaningful on the
  // real (unmutated) signal, so skip it under a mutation.
  let P = null
  if (MUTATE === 'none') {
    const pre = await page.evaluate(
      ({ script }) => window.__AUDIOLAB__.renderTimeline(script, { stage: 'hypergrowth', dry: true, bypassMaster: true }),
      { script },
    )
    const preRaw = toMono(b64ToF32(pre.b64))
    const preMono = dcBlock(preRaw, pre.sampleRate)
    P = {}
    for (const s of SCRIPT) P[s.label] = windowStats(preMono, preRaw, pre.sampleRate, s.t)
  }

  const preRoll = windowStats(mono, raw, sr, 0.0, 0.25)
  const W = {}
  for (const s of SCRIPT) W[s.label] = windowStats(mono, raw, sr, s.t)

  // Dynamic range across the transient ladder (light → ko), pre vs post master.
  // A flat mix compresses this span; a mix with real weight preserves it.
  const rng = (M) => M['ko'].rmsDb - M['hit-light'].rmsDb
  const postRange = rng(W)
  const preRange = P ? rng(P) : null

  // ── table ──
  console.log(`\n  timeline: ${(res.length / sr).toFixed(2)}s @ ${sr}Hz   mutate=${MUTATE}`)
  console.log('  window            t(s)    peak   rms(dB)  pre(dB)   Δmaster   <200Hz   >2kHz  atkHi')
  console.log('  ' + '-'.repeat(84))
  console.log(`  ${'(pre-roll)'.padEnd(15)} ${(0).toFixed(2).padStart(5)}  ${preRoll.peak.toFixed(3).padStart(5)}  ${preRoll.rmsDb.toFixed(1).padStart(6)}   ${'—'.padStart(6)}   ${'—'.padStart(6)}   ${(preRoll.lowFrac * 100).toFixed(1).padStart(5)}%  ${(preRoll.highFrac * 100).toFixed(1).padStart(5)}%  ${(preRoll.highAtk * 100).toFixed(1).padStart(4)}%`)
  for (const s of SCRIPT) {
    const r = W[s.label]
    const pre = P ? P[s.label].rmsDb : null
    // Δmaster = how the master changed this event's level (post − pre). The
    // pre pass is padded a fixed −12 dB for headroom, so the absolute Δ is
    // offset uniformly; what matters is that loud events are NOT pulled down
    // toward the quiet ones (the flattening signature).
    const dcol = pre === null ? '—' : (r.rmsDb - pre).toFixed(1)
    const pcol = pre === null ? '—' : pre.toFixed(1)
    console.log(`  ${s.label.padEnd(15)} ${s.t.toFixed(2).padStart(5)}  ${r.peak.toFixed(3).padStart(5)}  ${r.rmsDb.toFixed(1).padStart(6)}   ${pcol.padStart(6)}   ${dcol.padStart(6)}   ${(r.lowFrac * 100).toFixed(1).padStart(5)}%  ${(r.highFrac * 100).toFixed(1).padStart(5)}%  ${(r.highAtk * 100).toFixed(1).padStart(4)}%`)
  }
  console.log('')
  console.log(`  ladder light→ko dynamic range:  post ${postRange.toFixed(1)}dB${preRange !== null ? `   pre ${preRange.toFixed(1)}dB` : ''}`)
  console.log('')

  // ── 1. pre-roll silence: nothing sounds before the first scripted event ──
  // Measured on the DC-blocked signal: a firing event peaks 0.4–1.0; a silent
  // window (see --mutate no-wiring) is ~0.0004. 0.02 is orders of magnitude below
  // any event yet far above the noise floor.
  check('pre-roll is silent (audio is event-driven)', preRoll.peakDC < 0.02,
    `peak ${preRoll.peakDC.toFixed(4)}`)

  // ── 2. every event lands real energy in its window ──
  for (const s of SCRIPT) {
    const r = W[s.label]
    check(`${s.label} window is audible`, r.peakDC > 0.05 && r.rmsDb > -55,
      `peak ${r.peakDC.toFixed(3)}, rms ${r.rmsDb.toFixed(1)}dB`)
  }

  // ── 2b. TRUE-PEAK SAFETY — the master ends in a linear ceiling clamp because
  // the 4x soft-clip overshoots ±1 on the hottest transients (a counter is two
  // impacts summing at one instant). Without the clamp, counter/ko render at
  // ~1.07 and hard-clip at the DAC — an audible click on the showcase mechanic.
  // Measured on the RAW render (the DC-block is not a trustworthy peak meter).
  for (const s of SCRIPT) {
    check(`${s.label} does not clip (true peak < 0.99)`, W[s.label].peak < 0.99,
      `peak ${W[s.label].peak.toFixed(3)}`)
  }

  // ── 3. LOUDNESS LADDER — the fix, and the assertion the pre-fix master made
  // impossible. Weight must read as LEVEL: each tier is a real margin louder than
  // the one below. 1.2 dB is the step floor — comfortably above render/measure
  // jitter (<0.2 dB, deterministic seed) yet demanding true separation. Collapses
  // under --mutate flatten (one gain for all) AND --mutate crush-master (the old
  // levelling master), so BOTH halves of the fix are proved load-bearing.
  const STEP = 1.2
  for (let i = 1; i < LADDER.length; i++) {
    const lo = LADDER[i - 1], hi = LADDER[i]
    check(`ladder: ${hi} louder than ${lo} (≥${STEP}dB)`,
      W[hi].rmsDb >= W[lo].rmsDb + STEP,
      `${hi} ${W[hi].rmsDb.toFixed(1)}dB vs ${lo} ${W[lo].rmsDb.toFixed(1)}dB (Δ${(W[hi].rmsDb - W[lo].rmsDb).toFixed(1)})`)
  }
  // KO is the single loudest impact in the round — it must top every other window.
  {
    const others = SCRIPT.map((s) => s.label).filter((l) => l !== 'ko')
    const loudestOther = others.reduce((m, l) => (W[l].rmsDb > W[m].rmsDb ? l : m), others[0])
    check('ko is the loudest impact in the round',
      W.ko.rmsDb > W[loudestOther].rmsDb + 0.5,
      `ko ${W.ko.rmsDb.toFixed(1)}dB vs next-loudest ${loudestOther} ${W[loudestOther].rmsDb.toFixed(1)}dB`)
  }
  // The user's exact complaint, asserted head-on: a counter-hit — the read-reward
  // — must NOT be quieter than a plain medium hit. It was, before this work.
  check('counter-hit is louder than a medium hit (read-reward has weight)',
    W.counter.rmsDb > W['hit-medium'].rmsDb + STEP,
    `counter ${W.counter.rmsDb.toFixed(1)}dB vs medium ${W['hit-medium'].rmsDb.toFixed(1)}dB`)

  // ── 4. DYNAMIC RANGE — the mix is not flat. A jab-to-KO span this wide is what
  // stops the mix reading as cheap/fatiguing. The pre-fix master crushed this to
  // ~6 dB; the crush-master mutation reproduces that collapse and fails here.
  check('ladder has wide dynamic range (light→ko ≥ 9dB)',
    postRange >= 9,
    `light→ko ${postRange.toFixed(1)}dB`)

  // ── 5. SPECTRUM (kept — brightness/weight are a DIFFERENT axis from loudness) ─
  // A counter fires a bright crit crack (sizzle hp 3400) where a medium hit uses
  // the darker heavy synth (sizzle hp 1500). Over 250 ms both settle to the same
  // body, so the brightness is real in the ATTACK, not the average — measured on
  // the first 45 ms, where a hit's snap lives. Collapses if counter routes to the
  // same synth as a medium hit.
  check('counter-hit has a brighter attack transient than a medium hit',
    W.counter.highAtk > W['hit-medium'].highAtk + 0.02,
    `counter ${(W.counter.highAtk * 100).toFixed(1)}% vs medium ${(W['hit-medium'].highAtk * 100).toFixed(1)}% (>2kHz, first 45ms)`)
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
