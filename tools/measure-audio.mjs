/**
 * measure-audio.mjs — the instrument that can HEAR.
 *
 * Every other tool in this repo is a camera, and a camera cannot detect
 * silence. This one renders each sound through the EXACT shipping mastering
 * chain offline (OfflineAudioContext, via /audiolab.html's __AUDIOLAB__.render)
 * and measures the resulting PCM: peak, RMS (dBFS), spectral centroid and the
 * fraction of energy below 200 Hz. It then asserts:
 *
 *   1. NON-SILENCE — every sound actually produces signal (peak/RMS above a
 *      floor a zero-buffer cannot clear).
 *   2. DISTINCTNESS — 'light' and 'heavy' are objectively different: heavy is
 *      weightier (more sub-200Hz energy, lower centroid) and louder. A build
 *      that renders the same synth for both (or silence) fails here.
 *
 * These are measurements, not proxies. Mutation-proof by breaking a renderer
 * and watching a specific number collapse.
 *
 * Run:  node tools/measure-audio.mjs [--port 5400] [--headed]
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

// Self-test mutations (prove this instrument can actually go red). None of
// these touch the repo — they corrupt the measurement in-flight so we can
// watch the assertions fail on a known-bad signal:
//   --mutate silence : zero every rendered buffer  → 'is audible' must FAIL
//   --mutate clone   : render 'light' for 'heavy'  → distinctness must FAIL
const MUTATE = arg('--mutate', '')

const failures = []
function check(name, ok, detail) {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures.push(name)
}

// ── DSP helpers (Node side) ────────────────────────────────────────────────

function b64ToF32(b64) {
  const bin = Buffer.from(b64, 'base64')
  // interleaved stereo Float32, little-endian
  return new Float32Array(bin.buffer, bin.byteOffset, Math.floor(bin.byteLength / 4))
}

/** De-interleave stereo → mono average. */
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

/** In-place iterative radix-2 FFT (re/im arrays, length must be pow2). */
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

/** Spectral centroid (Hz) and fraction of magnitude below `edge` Hz, computed
 *  on a Hann-windowed slice centred on the signal's peak. */
function spectrum(x, sampleRate, edge = 200) {
  // window around the peak sample
  let peakIdx = 0, peakVal = 0
  for (let i = 0; i < x.length; i++) { const a = Math.abs(x[i]); if (a > peakVal) { peakVal = a; peakIdx = i } }
  const N = 16384
  const start = Math.max(0, Math.min(x.length - N, peakIdx - N / 2))
  const seg = x.subarray(start, start + Math.min(N, x.length - start))
  // next pow2 >= seg.length
  let size = 1
  while (size < seg.length) size <<= 1
  const re = new Float32Array(size), im = new Float32Array(size)
  const L = seg.length
  for (let i = 0; i < L; i++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (L - 1)) // Hann
    re[i] = seg[i] * w
  }
  fft(re, im)
  const half = size / 2
  let num = 0, den = 0, low = 0
  for (let k = 1; k < half; k++) {
    const mag = Math.hypot(re[k], im[k])
    const f = (k * sampleRate) / size
    num += f * mag
    den += mag
    if (f < edge) low += mag
  }
  return { centroid: den > 0 ? num / den : 0, lowFrac: den > 0 ? low / den : 0 }
}

function analyze(res) {
  const inter = b64ToF32(res.b64)
  const mono = toMono(inter)
  const peak = peakOf(mono)
  const rms = rmsOf(mono)
  const { centroid, lowFrac } = spectrum(mono, res.sampleRate)
  return {
    name: res.name,
    seconds: res.length / res.sampleRate,
    peak,
    rmsDb: dB(rms),
    centroid,
    lowFrac,
  }
}

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
  await page.waitForFunction(() => window.__AUDIOLAB__?.ready?.(), null, { timeout: 30_000 })

  // Render every impact flavor + the feel/key sounds, DRY (isolate the synth
  // source from the shared reverb tail so distinctness is about the sound
  // itself, not a common decay).
  const NAMES = ['light', 'heavy', 'crit', 'combo', 'ex', 'ult', 'signature', 'shatter', 'ko',
    'whiff', 'footstep', 'cloth', 'meterCharge', 'superStinger', 'victory', 'defeat']

  const rows = {}
  for (const name of NAMES) {
    const renderName = MUTATE === 'clone' && name === 'heavy' ? 'light' : name
    const res = await page.evaluate((n) => window.__AUDIOLAB__.render(n, { dry: true }), renderName)
    if (MUTATE === 'silence') res.b64 = Buffer.alloc(res.length * 2 * 4).toString('base64')
    rows[name] = analyze(res)
  }
  // one WET render to prove the full mastered shipping chain is non-silent too
  const heavyWet = analyze(await page.evaluate(() => window.__AUDIOLAB__.render('heavy', {})))

  // ── table ──
  console.log('\n  sound        dur(s)   peak   rms(dB)  centroid(Hz)  <200Hz')
  console.log('  ' + '-'.repeat(62))
  for (const n of NAMES) {
    const r = rows[n]
    console.log(
      `  ${n.padEnd(12)} ${r.seconds.toFixed(2).padStart(5)}  ${r.peak.toFixed(3).padStart(5)}  ` +
      `${r.rmsDb.toFixed(1).padStart(6)}  ${Math.round(r.centroid).toString().padStart(9)}   ${(r.lowFrac * 100).toFixed(1).padStart(5)}%`,
    )
  }
  console.log(`  ${'heavy(wet)'.padEnd(12)} ${heavyWet.seconds.toFixed(2).padStart(5)}  ${heavyWet.peak.toFixed(3).padStart(5)}  ${heavyWet.rmsDb.toFixed(1).padStart(6)}  ${Math.round(heavyWet.centroid).toString().padStart(9)}   ${(heavyWet.lowFrac * 100).toFixed(1).padStart(5)}%`)
  console.log('')

  // ── 1. non-silence: nothing a zero-buffer could satisfy ──
  for (const n of NAMES) {
    check(`${n} is audible`, rows[n].peak > 0.02 && rows[n].rmsDb > -60,
      `peak ${rows[n].peak.toFixed(3)}, rms ${rows[n].rmsDb.toFixed(1)}dB`)
  }
  check('heavy(wet) survives the mastering chain', heavyWet.peak > 0.02 && heavyWet.rmsDb > -60,
    `peak ${heavyWet.peak.toFixed(3)}, rms ${heavyWet.rmsDb.toFixed(1)}dB`)

  // ── 2. light vs heavy are OBJECTIVELY different ──
  // MEASURED reality (not my prior hypothesis): a heavy hit is both WEIGHTIER
  // (dedicated sub 56→30Hz + 80Hz thump layers that light lacks entirely) AND
  // PUNCHIER (crack punch 4.5 vs 1.4 → a sharper transient), so it is louder,
  // has more sub-200Hz energy, a higher peak, AND a *higher* centroid. All four
  // deltas collapse to ~0 if both flavours render the same synth → mutation-safe.
  const light = rows.light, heavy = rows.heavy
  check('heavy is louder (higher RMS) than light',
    heavy.rmsDb > light.rmsDb + 1.0,
    `heavy ${heavy.rmsDb.toFixed(1)}dB vs light ${light.rmsDb.toFixed(1)}dB`)
  check('heavy has more sub-200Hz weight than light',
    heavy.lowFrac > light.lowFrac + 0.03,
    `heavy ${(heavy.lowFrac * 100).toFixed(1)}% vs light ${(light.lowFrac * 100).toFixed(1)}%`)
  check('heavy hits a higher peak than light',
    heavy.peak > light.peak + 0.05,
    `heavy ${heavy.peak.toFixed(3)} vs light ${light.peak.toFixed(3)}`)
  check('heavy timbre differs from light (centroid >10% apart)',
    Math.abs(heavy.centroid - light.centroid) / light.centroid > 0.10,
    `heavy ${Math.round(heavy.centroid)}Hz vs light ${Math.round(light.centroid)}Hz`)

  // crit should be its own thing, not a clone of heavy
  const crit = rows.crit
  check('crit is distinct from heavy',
    Math.abs(crit.centroid - heavy.centroid) > 150 || Math.abs(crit.rmsDb - heavy.rmsDb) > 1.5,
    `crit ${Math.round(crit.centroid)}Hz/${crit.rmsDb.toFixed(1)}dB vs heavy ${Math.round(heavy.centroid)}Hz/${heavy.rmsDb.toFixed(1)}dB`)
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
console.log('\nall checks passed — the engine makes sound, and light ≠ heavy by measurement')
