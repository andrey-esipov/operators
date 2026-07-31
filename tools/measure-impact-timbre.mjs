/**
 * measure-impact-timbre.mjs — can weight be HEARD, not just measured in dB?
 *
 * `measure-fight-audio.mjs` proved the LOUDNESS ladder (a jab is quieter than a
 * KO). This tool proves the orthogonal axis the loudness ladder cannot see:
 * TIMBRE. In SF6 / Tekken 8 / Strive a jab and a heavy are not one sound at two
 * volumes — they are different *events* (a light is a high, tight snap; a heavy
 * is a low body with a long decay). This tool asks whether OUR weight classes
 * are timbrally distinct AT MATCHED LOUDNESS, i.e. once level is normalised out.
 *
 * It drives the ACTUAL FightAudioReactor (via /audiolab.html __AUDIOLAB__.render-
 * Timeline, the exact class the game wires), renders PRE-MASTER (bypassMaster — a
 * linear pad, so the master's loudness-dependent saturation cannot manufacture or
 * hide a spectral difference), and measures four LOUDNESS-INVARIANT descriptors —
 * the four axes weight actually lives on:
 *
 *   centroid  (Hz)  — spectral centre of mass  → BRIGHTNESS
 *   lowFrac   (<200Hz magnitude fraction)      → BODY / WEIGHT
 *   atkFrac   (energy fraction in first 20 ms) → TRANSIENT SHARPNESS
 *   tempMs    (temporal centroid, energy-mean time) → TAIL LENGTH / where energy sits
 *
 * All four are ratios/shapes, invariant to overall level, so comparing them IS
 * comparing "at matched loudness". A fingerprint distance is the Euclidean norm
 * over these four on fixed physical scales (NOT z-scored — so thresholds are
 * stable across a before/after run and cannot drift with the set).
 *
 * NOISE-AVERAGED, BECAUSE A PLAYER NEVER JUDGES ONE HIT. A single filtered-noise
 * impact is genuinely noisy hit-to-hit — its fine spectral stats swing with the
 * noise seed. The ear integrates many hits, averaging the noise out and hearing
 * the deterministic skeleton (pitched body, sub, ring). So the unit of "timbre
 * identity" is the NOISE-AVERAGED fingerprint: K=10 natural hits per class (the
 * game's own incrementing seed) with the descriptors averaged.
 *
 * TWO GUARDS, SAME SHAPE AS THE STAGE-IDENTITY INSTRUMENT:
 *   • DET FLOOR (non-vacuity) — render `heavy` ALONE twice with ONE fixed seed;
 *     identical spec+seed ⇒ byte-identical ⇒ distance ≈ 0. A dead/vacuous ruler
 *     could not hit 0 on demand, so this proves the metric measures SYNTH not noise.
 *   • WITHIN-CLASS WOBBLE (the nuisance displacement, analogue of stage self-
 *     displacement) — how far a class's noise-averaged fingerprint moves between two
 *     independent K/2-hit sub-samples. natMax = the worst wobble across classes.
 * The SEPARATION claim is then the exact margin argument the stage-identity proof
 * used: the smallest gap between two class means EXCEEDS the largest within-class
 * wobble — the classes are farther apart than noise moves any one of them. And
 * d(light,heavy) is large by construction, so the metric demonstrably RESPONDS.
 *
 * THE DEFECT, MADE CONCRETE: before the fix, medium/heavy/sweep/launcher are the
 * SAME `heavy` synth at different power, and power feeds only `gain` — so at
 * matched loudness their noise-averaged means collapse onto one point (pairwise
 * distance within the wobble). `--assert` fails SEPARATION there, and passes once
 * each weight class has its own timbre.
 *
 * Run (serve the harness first, ONE server, reap it):
 *   npx vite dev --port 5411 --host >_imp10/vite.log 2>&1 &
 *   node tools/measure-impact-timbre.mjs --port 5411            # table
 *   node tools/measure-impact-timbre.mjs --port 5411 --assert   # gate; echo $?
 *   node tools/measure-impact-timbre.mjs --port 5411 --json     # machine-readable
 */

import { chromium } from 'playwright-core'

const arg = (flag, def) => {
  const i = process.argv.indexOf(flag)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def
}
const has = (flag) => process.argv.includes(flag)

const PORT = arg('--port', '5411')
const URL = `http://localhost:${PORT}/audiolab.html`
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const ASSERT = has('--assert')
const JSON_OUT = has('--json')

// ── DSP (Node side) — same math as measure-fight-audio.mjs ──────────────────

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
function peakOf(x) { let p = 0; for (let i = 0; i < x.length; i++) { const a = Math.abs(x[i]); if (a > p) p = a } return p }
function rmsOf(x) { let s = 0; for (let i = 0; i < x.length; i++) s += x[i] * x[i]; return Math.sqrt(s / Math.max(1, x.length)) }
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

/** Hann-windowed spectrum of a slice → { centroid(Hz), lowFrac(<lo), highFrac(>hi) }. */
function spectrum(x, sampleRate, loEdge = 200, hiEdge = 2000) {
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
  let den = 0, low = 0, high = 0, num = 0
  for (let k = 1; k < half; k++) {
    const mag = Math.hypot(re[k], im[k])
    const f = (k * sampleRate) / size
    den += mag
    num += mag * f
    if (f < loEdge) low += mag
    else if (f > hiEdge) high += mag
  }
  return {
    centroid: den > 0 ? num / den : 0,
    lowFrac: den > 0 ? low / den : 0,
    highFrac: den > 0 ? high / den : 0,
  }
}

/** Causal one-pole DC blocker (~20Hz) — a punch is DC-biased; a real cone removes it. */
function dcBlock(x, sampleRate = 48000) {
  const R = 1 - (2 * Math.PI * 20) / sampleRate
  const y = new Float32Array(x.length)
  let prevX = 0, prevY = 0
  for (let i = 0; i < x.length; i++) {
    const xi = x[i]; const yi = xi - prevX + R * prevY
    y[i] = yi; prevX = xi; prevY = yi
  }
  return y
}

/** Temporal centroid (ms): energy-weighted mean time within the window, on a
 *  5ms-RMS envelope. The time-domain analogue of the spectral centroid — a
 *  robust "where does the energy sit" measure (early=tight snap, late=long
 *  body/tail). Far steadier under noise than a threshold crossing, which a
 *  single noisy dip can trip early. Own-window-relative, so level-invariant. */
function tempCentroidMs(seg, sampleRate) {
  const hop = Math.max(1, Math.floor(0.005 * sampleRate))
  let num = 0, den = 0, k = 0
  for (let i = 0; i + hop <= seg.length; i += hop, k++) {
    const e = rmsOf(seg.subarray(i, i + hop))
    num += (k * hop / sampleRate) * e
    den += e
  }
  return den > 0 ? (num / den) * 1000 : 0
}

/** Fraction of window energy in the first `ms` — a STABLE transient/impulsiveness
 *  descriptor. A tight snap front-loads its energy (high atkFrac); a long body
 *  spreads it (low atkFrac). Integrated over ~960 samples as a ratio, so it is
 *  level-invariant AND far steadier under the noise seed than a high-frequency
 *  fraction measured in a short window (that swings wildly because HF energy in a
 *  few-ms slice is mostly the noise realisation). Replaces highAtk in fpDist. */
function attackFrac(seg, sampleRate, ms = 20) {
  const n = Math.min(seg.length, Math.floor((ms / 1000) * sampleRate))
  let head = 0, all = 0
  for (let i = 0; i < seg.length; i++) { const e = seg[i] * seg[i]; all += e; if (i < n) head += e }
  return all > 0 ? head / all : 0
}

/** Descriptors for the window [t, t+dur). DC-blocks the segment LOCALLY (fresh
 *  filter state) rather than relying on a globally-filtered signal, so two windows
 *  containing the same waveform (same spec + same seed) are processed identically —
 *  the fixed-seed determinism floor collapses to ~0. The fingerprint uses the four
 *  STABLE axes {centroid, lowFrac, atkFrac, tempMs}; highAtk is kept for the table
 *  only (informative but too noise-sensitive to gate on). */
function descriptors(monoRaw, sampleRate, t, dur = 0.25) {
  const a = Math.max(0, Math.floor(t * sampleRate))
  const b = Math.floor((t + dur) * sampleRate)
  const seg = dcBlock(monoRaw.subarray(a, Math.min(monoRaw.length, b)), sampleRate)
  const sp = spectrum(seg, sampleRate)
  const atk = spectrum(seg.subarray(0, Math.min(seg.length, Math.floor(0.045 * sampleRate))), sampleRate)
  return {
    centroid: sp.centroid,
    lowFrac: sp.lowFrac,
    highFrac: sp.highFrac,
    highAtk: atk.highFrac,
    atkFrac: attackFrac(seg, sampleRate),
    tempMs: tempCentroidMs(seg, sampleRate),
    rmsDb: dB(rmsOf(seg)),
    peak: peakOf(seg),
  }
}

// ── fingerprint distance on FIXED physical scales (stable thresholds) ────────
// The four STABLE axes weight lives on. Scales chosen so a "same synth, same seed"
// pair lands at ~0 and a genuinely different synth lands well over the 0.12 bar.
const SCALE = { centroid: 2000 /*Hz*/, lowFrac: 1, atkFrac: 1, tempMs: 100 /*ms*/ }
function fpDist(a, b) {
  const dc = (a.centroid - b.centroid) / SCALE.centroid
  const dl = (a.lowFrac - b.lowFrac) / SCALE.lowFrac
  const dh = (a.atkFrac - b.atkFrac) / SCALE.atkFrac
  const dd = (a.tempMs - b.tempMs) / SCALE.tempMs
  return Math.sqrt(dc * dc + dl * dl + dh * dh + dd * dd)
}

// ── the scripted hits: one per weight class, `heavy` twice (noise floor) ─────
const AT = { x: 0, y: 40 }
const DMG = 40 // fixed across classes: damage feeds only gain, so timbre is the sole variable
const SCRIPT = [
  { t: 0.6, label: 'light', level: 'light' },
  { t: 1.5, label: 'medium', level: 'medium' },
  { t: 2.4, label: 'heavy', level: 'heavy' },
  { t: 3.3, label: 'heavy2', level: 'heavy' }, // second heavy → metric noise floor
  { t: 4.2, label: 'sweep', level: 'sweep' },
  { t: 5.1, label: 'launcher', level: 'launcher' },
  { t: 6.0, label: 'crumple', level: 'crumple' },
].map((s) => ({ ...s, ev: { type: 'hit', at: AT, attacker: 0, level: s.level, damage: DMG } }))

const HEAVY_FAMILY = ['medium', 'heavy', 'sweep', 'launcher'] // the four that shared one synth

// ── run ─────────────────────────────────────────────────────────────────────

const failures = []
const check = (name, ok, detail) => {
  if (!JSON_OUT) console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures.push(name)
}

const browser = await chromium.launch({
  headless: !has('--headed'),
  executablePath: CHROME,
  args: [
    '--window-position=4000,4000', '--hide-scrollbars', '--autoplay-policy=no-user-gesture-required',
    '--disable-renderer-backgrounding', '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows', '--disable-features=CalculateNativeWinOcclusion',
  ],
})
const page = await browser.newPage()
page.on('pageerror', (e) => { failures.push(`pageerror: ${e.message}`) })

let out = null
try {
  await page.goto(URL, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => window.__AUDIOLAB__?.ready?.() && window.__AUDIOLAB__?.renderTimeline, null, { timeout: 30_000 })

  // ── NOISE-AVERAGED CLASS FINGERPRINTS ──────────────────────────────────────
  // A single filtered-noise impact is genuinely noisy hit-to-hit (its fine
  // spectral stats swing with the noise seed). A PLAYER never judges one hit — the
  // ear integrates many, averaging the noise out and hearing the deterministic
  // skeleton (pitched body, sub, ring). So the unit of "timbre identity" is the
  // NOISE-AVERAGED fingerprint: render K natural hits per class (the game's own
  // incrementing seed) and average the descriptors. PRE-MASTER (bypassMaster: a
  // linear −12 dB pad, no dynamics) so the master's loudness-dependent saturation
  // can neither manufacture nor mask a spectral difference — the honest "at matched
  // loudness" render. Each class is its own single-class timeline so no other
  // class's tail bleeds in (K hits spaced 1.0s, tails ~0.5s → clean).
  const FIXED = 0x51b7
  const ISO_T = 0.6
  const K = 10          // natural hits averaged per class
  const SPACING = 1.0
  const avg = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length
  const meanOf = (ds) => ({
    centroid: avg(ds.map((d) => d.centroid)), lowFrac: avg(ds.map((d) => d.lowFrac)),
    highFrac: avg(ds.map((d) => d.highFrac)), highAtk: avg(ds.map((d) => d.highAtk)),
    atkFrac: avg(ds.map((d) => d.atkFrac)), tempMs: avg(ds.map((d) => d.tempMs)),
    rmsDb: avg(ds.map((d) => d.rmsDb)),
  })
  const renderMany = async (ev) => {
    const script = Array.from({ length: K }, (_, i) => ({ t: 0.6 + i * SPACING, ev }))
    const r = await page.evaluate(
      (sc) => window.__AUDIOLAB__.renderTimeline(sc, { dry: true, bypassMaster: true }),
      script,
    )
    const mono = toMono(b64ToF32(r.b64))
    return { ds: script.map((x) => descriptors(mono, r.sampleRate, x.t)), sampleRate: r.sampleRate }
  }
  const D = {}       // per-class NOISE-AVERAGED fingerprint (K hits)
  const halfA = {}, halfB = {} // two independent K/2 sub-means → within-class wobble
  let sampleRate = 48000
  for (const s of SCRIPT) {
    if (s.label === 'heavy2') continue
    const { ds, sampleRate: sr } = await renderMany(s.ev)
    sampleRate = sr
    D[s.label] = meanOf(ds)
    halfA[s.label] = meanOf(ds.slice(0, K / 2))
    halfB[s.label] = meanOf(ds.slice(K / 2))
  }

  // DETERMINISM / NON-VACUITY: same spec + same seed, rendered ALONE twice, must
  // reproduce byte-for-byte → distance ~0. Proves the metric measures synth, not
  // noise (a vacuous ruler could not hit 0 on demand). Isolated single-hit renders.
  const renderOne = async (ev, opts) => {
    const r = await page.evaluate(
      ({ ev, t, o }) => window.__AUDIOLAB__.renderTimeline([{ t, ev }], o),
      { ev, t: ISO_T, o: { dry: true, bypassMaster: true, ...opts } },
    )
    return descriptors(toMono(b64ToF32(r.b64)), r.sampleRate, ISO_T)
  }
  const heavyEv = SCRIPT.find((s) => s.label === 'heavy').ev
  const detFloor = fpDist(await renderOne(heavyEv, { fixedSeed: FIXED }), await renderOne(heavyEv, { fixedSeed: FIXED }))

  // WITHIN-CLASS WOBBLE (the nuisance displacement, analogue of stage self-
  // displacement): how far a class's NOISE-AVERAGED fingerprint moves between two
  // independent K/2-hit samples. natMax = the worst such wobble across classes.
  // The separation claim is then the exact stage-identity margin argument: the
  // smallest gap between two class means exceeds the largest within-class wobble.
  const withinFloors = SCRIPT.filter((s) => s.label !== 'heavy2').map((s) => [s.label, fpDist(halfA[s.label], halfB[s.label])])
  const natMax = Math.max(...withinFloors.map((w) => w[1]))
  const natMean = avg(withinFloors.map((w) => w[1]))

  // POST-MASTER pass: the shipped chain, so we can confirm the loudness ladder is
  // preserved (the tuned HIT_GAIN half must not regress when timbre is added).
  const post = await page.evaluate(
    (script) => window.__AUDIOLAB__.renderTimeline(script, { dry: true }),
    SCRIPT.filter((s) => s.label !== 'heavy2').map(({ t, ev }) => ({ t, ev })),
  )
  const postMono = toMono(b64ToF32(post.b64))
  const Lp = {}  // post-master loudness
  for (const s of SCRIPT) { if (s.label === 'heavy2') continue; Lp[s.label] = descriptors(postMono, post.sampleRate, s.t) }

  const discrim = fpDist(D.light, D.heavy)       // known-distinct control (noise-averaged)
  const pairs = []
  for (let i = 0; i < HEAVY_FAMILY.length; i++)
    for (let j = i + 1; j < HEAVY_FAMILY.length; j++)
      pairs.push([HEAVY_FAMILY[i], HEAVY_FAMILY[j], fpDist(D[HEAVY_FAMILY[i]], D[HEAVY_FAMILY[j]])])
  const minPair = pairs.reduce((m, p) => (p[2] < m[2] ? p : m), pairs[0])

  out = {
    sampleRate,
    descriptors: D,
    loudnessDb: Object.fromEntries(Object.keys(Lp).map((k) => [k, +Lp[k].rmsDb.toFixed(2)])),
    detFloor, natMax, natMean, withinFloors, discrim, minPair, pairs,
  }

  if (JSON_OUT) {
    console.log(JSON.stringify(out, null, 2))
  } else {
    console.log(`\n  impact timbre @ ${sampleRate}Hz  (PRE-MASTER, K=${K} NOISE-AVERAGED per class, loudness-invariant descriptors)\n`)
    console.log('  class       centroidHz   <200Hz   >2kHz   atk20ms   tempMs   post-rms(dB)')
    console.log('  ' + '-'.repeat(76))
    for (const s of SCRIPT) {
      if (s.label === 'heavy2') continue
      const d = D[s.label]
      console.log(
        `  ${s.label.padEnd(10)} ${d.centroid.toFixed(0).padStart(8)}   ${(d.lowFrac * 100).toFixed(1).padStart(5)}%  ${(d.highFrac * 100).toFixed(1).padStart(5)}%  ${(d.atkFrac * 100).toFixed(1).padStart(5)}%  ${d.tempMs.toFixed(1).padStart(6)}    ${Lp[s.label].rmsDb.toFixed(1).padStart(7)}`,
      )
    }
    console.log('')
    console.log(`  DET FLOOR    d(heavy, heavy) fixed-seed    = ${detFloor.toFixed(3)}   (identical spec+seed → must be ~0; non-vacuity)`)
    console.log(`  WITHIN-CLASS max wobble of K=${K} mean       = ${natMax.toFixed(3)}   (mean ${natMean.toFixed(3)} — nuisance/noise displacement)`)
    console.log(`  CONTROL      d(light, heavy) noise-avg      = ${discrim.toFixed(3)}   (known-distinct — metric must respond)`)
    console.log(`  heavy-family pairwise timbre distance (noise-averaged means):`)
    for (const [a, b, d] of pairs)
      console.log(`     ${(`${a}/${b}`).padEnd(20)} ${d.toFixed(3)}${d <= natMax ? '   <-- WITHIN NOISE WOBBLE (same synth)' : ''}`)
    console.log(`  min heavy-family pair = ${minPair[0]}/${minPair[1]} @ ${minPair[2].toFixed(3)}   (must exceed within-class wobble ${natMax.toFixed(3)})\n`)
  }

  if (ASSERT) {
    // 0. DETERMINISM / NON-VACUITY: identical spec + identical seed must render
    //    identically. If this is not ~0 the metric is measuring noise, not synth,
    //    and every distance below is void. (This is what the fixed-seed pass buys.)
    check('deterministic floor ~0 (identical spec+seed → identical render)',
      detFloor < 0.02, `detFloor=${detFloor.toFixed(4)}`)
    // 1. NON-BLINDNESS: the metric responds to a genuine synth difference. If this
    //    fails the whole instrument is a dead ruler and every null below is void.
    check('metric responds to a known-distinct pair (light vs heavy)',
      discrim > 0.20 && discrim > natMax,
      `d(light,heavy)=${discrim.toFixed(3)}  natMax=${natMax.toFixed(3)}`)
    // 2. SEPARATION (the fix), as a MARGIN argument in the stage-identity shape:
    //    the smallest gap between two NOISE-AVERAGED class means exceeds the LARGEST
    //    within-class wobble (how far one class's mean moves between independent
    //    samples). Pre-fix the family collapses onto one point (one synth); post-fix
    //    each class sits farther from its neighbours than noise moves any of them.
    check('every weight class is timbrally distinct beyond the within-class noise wobble',
      minPair[2] > 0.12 && minPair[2] > natMax,
      `min pair ${minPair[0]}/${minPair[1]}=${minPair[2].toFixed(3)}  natMax=${natMax.toFixed(3)}`)
    // 3. DESIGN INVARIANTS — the identities are the intended ones, not just "different":
    //    sweep is the darkest; launcher the brightest; medium the tightest (shortest tail).
    check('sweep is the darkest of the heavy family (lowest centroid)',
      D.sweep.centroid < Math.min(D.medium.centroid, D.heavy.centroid, D.launcher.centroid),
      `sweep ${D.sweep.centroid.toFixed(0)}Hz`)
    check('launcher is the brightest of the heavy family (highest centroid)',
      D.launcher.centroid > Math.max(D.medium.centroid, D.heavy.centroid, D.sweep.centroid),
      `launcher ${D.launcher.centroid.toFixed(0)}Hz`)
    check('medium has the tightest tail of the heavy family (temporal centroid earliest)',
      D.medium.tempMs < Math.min(D.heavy.tempMs, D.sweep.tempMs, D.launcher.tempMs) + 0.5,
      `medium ${D.medium.tempMs.toFixed(1)}ms vs heavy ${D.heavy.tempMs.toFixed(1)} sweep ${D.sweep.tempMs.toFixed(1)} launcher ${D.launcher.tempMs.toFixed(1)}`)
    // 4. LOUDNESS LADDER NOT REGRESSED — adding timbre must not disturb the tuned
    //    HIT_GAIN levels: medium sits between light and heavy post-master.
    check('post-master loudness ladder preserved (light < medium < heavy)',
      Lp.light.rmsDb + 0.5 < Lp.medium.rmsDb && Lp.medium.rmsDb + 0.5 < Lp.heavy.rmsDb,
      `light ${Lp.light.rmsDb.toFixed(1)} medium ${Lp.medium.rmsDb.toFixed(1)} heavy ${Lp.heavy.rmsDb.toFixed(1)} dB`)
  }
} catch (e) {
  failures.push(`exception: ${e.message}`)
  if (!JSON_OUT) console.log(`\n  EXCEPTION: ${e.message}\n${e.stack}`)
} finally {
  await browser.close()
}

if (ASSERT) {
  if (failures.length) { console.log(`\n${failures.length} FAILED: ${failures.join(', ')}`); process.exit(1) }
  console.log('\nall checks passed — every weight class is timbrally distinct at matched loudness')
} else if (failures.length) {
  process.exit(1)
}
