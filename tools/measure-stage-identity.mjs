// measure-stage-identity.mjs
// ============================================================================
// Settles the visual-critic's UNQUANTIFIED claim that "DOF turns arena identity
// to mush" (stage value 4/10). The critic named DOF by eye with no metric. This
// turns the eye-judgement into a number, the way probe-dof.mjs did for the
// single-stage "DOF must defocus the stage yet keep fighters crisp" property.
//
// It distinguishes TWO things the phrase "identity to mush" conflates:
//
//   (1) DETAIL LEGIBILITY  — can you read the fine landmarks of ONE stage?
//       DOF softens this on purpose; softening the background is its separation
//       job (sharp fighter over soft world = depth). Measured as far-stage
//       edge-energy retained, full (DOF on) vs ?nodof.
//
//   (2) INTER-STAGE DISTINCTNESS — are the 8 arenas still different from EACH
//       OTHER after the post chain? THIS is what "identity to mush" must mean if
//       it is a defect: distinct source art rendering indistinguishable on
//       screen. Measured as pairwise fingerprint/palette distance across stages.
//
// FINDING (HEAD 15321ac, 8 stages, 1280x720 DPR1, quality=ultra):
//   Detail:       DOF removes ~28% (WIDE band, primary) / ~49-61% (RECT) of
//                 far-stage edge energy — dominant, consistent across all 8.
//                 Attribution (?nobloom/?nograde): grade/AgX ~0 median, bloom
//                 minor (~8%); DOF owns the softening.
//   Distinctness: DOF RETAINS 100% of structural distinctness (min 103%) and
//                 116% of palette; on-screen palette still passes all 28 stage
//                 pairs >= 10. The "identity to mush" claim, in the distinctness
//                 sense, is REFUTED: DOF softens per-stage detail but does not
//                 collapse the arenas toward each other.
//   Non-blind control (--assert): DOF displaces any ONE arena's fingerprint at
//                 most ~17.3, which is 74% of the smallest gap between two
//                 DIFFERENT arenas (23.44). max self-displacement < min gap, so
//                 blur provably cannot push one arena onto another. And because
//                 the self-displacements are non-zero and vary per stage
//                 (8.8-17.3), the fingerprint is proven to RESPOND to blur — the
//                 "100% retained" result is not a dead/flat metric reporting a
//                 trivial pass.
//
// TRADEOFF (one knob): DOF's background softening IS both the detail "cost" and
// the separation "benefit" — the same blur that removes ~28% of far-stage edge
// energy is what makes the (bit-exact sharp) fighter read as nearer than the
// (softened) world. There is no free lunch: recovering stage detail by lowering
// DOF's maxRadius costs exactly that depth cue. separation.measure-separation's
// gate (fighter-vs-local-bg luminance contrast + keyline rim) is blur-INVARIANT
// (blur preserves local mean luminance; the rim is a fighter-shader effect), so
// DOF's contribution is a perceptual depth cue ORTHOGONAL to that gate — it will
// not show up as a separation-gate delta, which is why it must be weighed by eye
// / by this instrument, not by the separation numbers.
//
// CAPTURE CAVEAT (the reason this pins quality and captures small): the shipped
// engine's adaptive-quality loop (Engine.maybeAdapt) downgrades ultra->low when
// sustained frame time exceeds ~22ms, and DOF is off at 'low'. On the slow
// offscreen capture page that downgrade fires within seconds at DPR2. At DPR1
// 1280x720 frames stay cheap enough that DOF holds indefinitely, so we capture
// there and verify window.__POST__.hasDof() before AND after each grab. A
// smaller/finer player resolution (1920x1080) blurs a SMALLER fraction of the
// frame than 720p, so the distinctness null result holds a fortiori there.
//
// USAGE
//   node tools/measure-stage-identity.mjs --capture [--port 5781] [--out FILE]
//        launch Chrome against a running vite dev server, capture 8 stages x
//        {full,nodof} to NDJSON (resumable: re-run resumes; a crash loses <=1).
//   node tools/measure-stage-identity.mjs --analyze FILE
//        CPU-only: print detail-survival, distinctness, and the control.
//   node tools/measure-stage-identity.mjs --assert FILE
//        analyze + exit non-zero unless identity is retained (max self-
//        displacement < min inter-arena gap AND 0 palette pairs below floor).
//
// Chrome reaping note: this tool always closes its own browser (finally). The
// --window-position marker is a SHARED convention in this repo's capture tools,
// so DO NOT reap Chrome by that marker while another capture fleet is live —
// reap only children of THIS tool's node PID.
// ============================================================================
import { mkdirSync, existsSync, readFileSync, appendFileSync, writeFileSync } from 'node:fs'

const argv = process.argv
const arg = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d)
const has = (k) => argv.includes(k)

const PORT = arg('--port', '5781')
const STAGES = arg('--stages', 'pre-pmf,hypergrowth,plateau,ai-native,monetization,crisis,ipo-prep,distribution').split(',')
const VARIANTS = arg('--variants', 'full,nodof').split(',')
const VW = Number(arg('--vw', '1280')), VH = Number(arg('--vh', '720')), DPR = Number(arg('--dpr', '1'))

// ---- shared metric constants (identical to probe-dof.mjs) ------------------
const W = VW * DPR, H = VH * DPR, CH = 3
const T_EDGE = 24                                  // grain-robust edge threshold
const POSE = { a: [-70, 0], b: [70, 0] }           // park fighters apart+low so the upper band is pure far stage
const WIDE = { x0: Math.round(0.05 * W), y0: Math.round(0.08 * H), x1: Math.round(0.95 * W), y1: Math.round(0.40 * H) }
const RECT = { x0: Math.round(0.28 * W), y0: Math.round(0.12 * H), x1: Math.round(0.72 * W), y1: Math.round(0.36 * H) }
const SKY = { left: Math.round(0.10 * W), top: Math.round(0.12 * H), width: Math.round(0.80 * W), height: Math.round(0.22 * H) }
const PALETTE_FLOOR = 10                            // stage-audit's on-screen palette-distinctness floor

// ---- pure analysis helpers (CPU-only, no browser) --------------------------
const madist = (a, b) => { let d = 0; const n = Math.min(a.length, b.length); for (let i = 0; i < n; i++) d += Math.abs(a[i] - b[i]); return d / n }
const rgbdist = (a, b) => Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2)
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN)
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : NaN }
const fpBuf = (r) => Buffer.from(r.fp, 'base64')

function analyze(ndjson) {
  const rows = readFileSync(ndjson, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l))
  const by = {}
  for (const r of rows) (by[r.stage] ??= {})[r.variant] = r
  const stages = Object.keys(by)

  console.log('=== DETAIL SURVIVAL (far-stage edge energy; full = DOF on, nodof = DOF off) ===')
  console.log('  ratio = full/nodof; kill% = (1 - ratio)*100 = fraction of stage detail DOF removes')
  console.log('stage            RECT.full RECT.nodof  r    kill%   WIDE.full WIDE.nodof  r    kill%')
  const killR = [], killW = []
  for (const s of stages) {
    const f = by[s].full, n = by[s].nodof
    if (!f || !n) { console.log(`${s.padEnd(15)} INCOMPLETE`); continue }
    const rR = n.sRect ? f.sRect / n.sRect : NaN, rW = n.sWide ? f.sWide / n.sWide : NaN
    if (!Number.isNaN(rR)) killR.push(1 - rR)
    if (!Number.isNaN(rW)) killW.push(1 - rW)
    const p = (x, w) => String(x).padStart(w)
    console.log(`${s.padEnd(15)}${p(f.sRect, 9)}${p(n.sRect, 11)}  ${rR.toFixed(2)}  ${((1 - rR) * 100).toFixed(0).padStart(4)}%   ${p(f.sWide, 9)}${p(n.sWide, 11)}  ${rW.toFixed(2)}  ${((1 - rW) * 100).toFixed(0).padStart(4)}%`)
  }
  console.log(`\nDOF stage-detail kill:  RECT median ${(med(killR) * 100).toFixed(0)}% mean ${(mean(killR) * 100).toFixed(0)}%   WIDE median ${(med(killW) * 100).toFixed(0)}% mean ${(mean(killW) * 100).toFixed(0)}%`)

  function pairwise(variant, key, fn) {
    const present = stages.filter((s) => by[s][variant])
    const ds = [], labels = []
    for (let i = 0; i < present.length; i++) for (let j = i + 1; j < present.length; j++) {
      const A = key === 'fp' ? fpBuf(by[present[i]][variant]) : by[present[i]][variant][key]
      const B = key === 'fp' ? fpBuf(by[present[j]][variant]) : by[present[j]][variant][key]
      ds.push(fn(A, B)); labels.push(`${present[i]}~${present[j]}`)
    }
    const order = ds.map((d, i) => [d, labels[i]]).sort((a, b) => a[0] - b[0])
    return { n: ds.length, min: Math.min(...ds), mean: mean(ds), closest: order.slice(0, 3) }
  }
  console.log('\n=== INTER-STAGE DISTINCTNESS (all pairs; does DOF collapse arenas toward each other?) ===')
  const structFull = pairwise('full', 'fp', madist), structNodof = pairwise('nodof', 'fp', madist)
  const palFull = pairwise('full', 'pal', rgbdist), palNodof = pairwise('nodof', 'pal', rgbdist)
  for (const [name, full, nodof, floor] of [
    ['STRUCTURE (hi-freq grayscale fingerprint, mean|Δ| 0-255)', structFull, structNodof, null],
    ['PALETTE (sky mean-RGB euclidean — blur survivor / control)', palFull, palNodof, PALETTE_FLOOR],
  ]) {
    console.log(`\n${name}:`)
    console.log(`  full : ${full.n} pairs  min=${full.min.toFixed(2)}  mean=${full.mean.toFixed(2)}${floor ? `  pairs<${floor}: ${full.closest.filter((c) => c[0] < floor).length}` : ''}`)
    console.log(`  nodof: ${nodof.n} pairs  min=${nodof.min.toFixed(2)}  mean=${nodof.mean.toFixed(2)}`)
    console.log(`  DOF retains: min ${(full.min / nodof.min * 100).toFixed(0)}%  mean ${(full.mean / nodof.mean * 100).toFixed(0)}%  (100% = DOF doesn't collapse identity)`)
    console.log(`  closest full pairs: ${full.closest.map((c) => `${c[1]}=${c[0].toFixed(1)}`).join('  ')}`)
  }

  // ---- non-blind control: self-displacement vs smallest inter-arena gap ----
  const self = []
  for (const s of stages) if (by[s].full && by[s].nodof) self.push([s, madist(fpBuf(by[s].full), fpBuf(by[s].nodof))])
  self.sort((a, b) => a[1] - b[1])
  const disp = self.map((x) => x[1])
  const maxDisp = Math.max(...disp)
  const minGap = structFull.min
  console.log('\n=== NON-BLIND CONTROL: DOF self-displacement vs smallest inter-arena gap ===')
  console.log('  max self-displacement < min inter-arena gap  => blur cannot push one arena onto another')
  for (const [s, d] of self) console.log(`  DOF moves ${s.padEnd(14)} ${d.toFixed(2)}   (${(d / minGap * 100).toFixed(0)}% of min gap)`)
  console.log(`\n  self-displacement: min ${Math.min(...disp).toFixed(2)}  mean ${mean(disp).toFixed(2)}  max ${maxDisp.toFixed(2)}`)
  console.log(`  smallest inter-arena gap (DOF on): ${minGap.toFixed(2)}  [${structFull.closest[0][1]}]`)

  const palPairsBelow = palFull.closest.filter((c) => c[0] < PALETTE_FLOOR).length
  const distinct = maxDisp < minGap
  const nonBlind = Math.min(...disp) > 0.5     // metric responds to blur (not a dead/flat proxy)
  const palettePass = palPairsBelow === 0
  const pass = distinct && nonBlind && palettePass
  console.log(`\n  distinctness retained: ${distinct ? 'YES' : 'NO'} (max self-disp ${maxDisp.toFixed(2)} ${distinct ? '<' : '>='} min gap ${minGap.toFixed(2)})`)
  console.log(`  metric non-blind:      ${nonBlind ? 'YES' : 'NO'} (min self-disp ${Math.min(...disp).toFixed(2)} responds to blur)`)
  console.log(`  on-screen palette:     ${palettePass ? 'PASS' : 'FAIL'} (${palPairsBelow} pairs < ${PALETTE_FLOOR})`)
  console.log(`\n  IDENTITY RETAINED THROUGH POST CHAIN: ${pass ? 'PASS' : 'FAIL'}`)
  return pass
}

// ---- capture (browser) mode ------------------------------------------------
async function capture(ndjson) {
  const { chromium } = await import('playwright-core')
  const sharp = (await import('sharp')).default
  mkdirSync(ndjson.replace(/\/[^/]*$/, '') || '.', { recursive: true })
  const luma = (b, i) => b[i] * 0.299 + b[i + 1] * 0.587 + b[i + 2] * 0.114
  const rectEdgeEnergy = (buf, r) => {
    let sum = 0, n = 0
    for (let y = r.y0 + 1; y < r.y1 - 1; y++) for (let x = r.x0 + 1; x < r.x1 - 1; x++) {
      const i = (y * W + x) * CH
      const g = Math.abs(luma(buf, i + CH) - luma(buf, i - CH)) + Math.abs(luma(buf, i + W * CH) - luma(buf, i - W * CH))
      n++; if (g > T_EDGE) sum += g
    }
    return n ? +(sum / n).toFixed(3) : 0
  }
  const structFP = async (buf) => {
    const { data } = await sharp(buf).extract({ left: WIDE.x0, top: WIDE.y0, width: WIDE.x1 - WIDE.x0, height: WIDE.y1 - WIDE.y0 }).resize(96, 32, { fit: 'fill' }).grayscale().raw().toBuffer({ resolveWithObject: true })
    return Buffer.from(data).toString('base64')
  }
  const palette = async (buf) => {
    const { data, info } = await sharp(buf).extract(SKY).raw().toBuffer({ resolveWithObject: true })
    const ch = info.channels; let r = 0, g = 0, b = 0, n = 0
    for (let i = 0; i < data.length; i += ch) { r += data[i]; g += data[i + 1]; b += data[i + 2]; n++ }
    return [+(r / n).toFixed(1), +(g / n).toFixed(1), +(b / n).toFixed(1)]
  }
  const stageLuma = async (buf) => {
    const { data, info } = await sharp(buf).extract({ left: 0, top: Math.round(H * 0.14), width: W, height: Math.round(H * 0.7) }).resize(120).raw().toBuffer({ resolveWithObject: true })
    let s = 0; const n = data.length / info.channels
    for (let i = 0; i < data.length; i += info.channels) s += (data[i] + data[i + 1] + data[i + 2]) / 3
    return s / n
  }
  const shot = async (page) => {
    for (let i = 0; i < 8; i++) {
      let buf = null
      try { buf = await page.screenshot({ timeout: 8000 }) } catch { buf = null }
      try { if (buf && (await stageLuma(buf)) >= 6) return buf } catch { /* decode race */ }
      try { await page.waitForTimeout(150) } catch { return null }
    }
    return null
  }
  const fpQuick = (buf) => sharp(buf).extract({ left: 0, top: Math.round(H * 0.12), width: W, height: Math.round(H * 0.76) }).resize(160).removeAlpha().raw().toBuffer()

  const done = new Set()
  if (existsSync(ndjson)) for (const ln of readFileSync(ndjson, 'utf8').split('\n')) { if (!ln.trim()) continue; try { done.add((({ stage, variant }) => `${stage}/${variant}`)(JSON.parse(ln))) } catch {} }

  const browser = await chromium.launch({ headless: false, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--use-angle=metal', '--window-position=4000,4000', '--hide-scrollbars', '--no-sandbox'] })
  const ev = async (page, fn, d) => { try { return await page.evaluate(fn) } catch { return d } }

  async function once(stage, variant) {
    const base = `http://localhost:${PORT}/?stage=${stage}&cpu=dummy&quality=ultra&nofinalize`
    const url = variant === 'full' ? base : `${base}&${variant}`
    const wantDof = variant !== 'nodof'
    const page = await browser.newPage({ viewport: { width: VW, height: VH }, deviceScaleFactor: DPR })
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded' })
      let stable = 0
      for (let i = 0; i < 300 && stable < 10; i++) {
        const ok = await ev(page, () => !!window.__PLAY__?.ready?.() && window.__PLAY__.state().phase === 'fight' && !!window.__STAGE__?.project && !!window.__POST__, false)
        stable = ok ? stable + 1 : 0
        await page.waitForTimeout(30)
      }
      if (stable < 10) return { err: 'never settled' }
      try { await page.mouse.click(800, 450) } catch {}
      await ev(page, ({ a, b }) => {
        try { window.__PLAY__.resume() } catch {}
        const st = window.__PLAY__.state(); const [fa, fb] = st.fighters
        fa.pos.x = a[0]; fa.pos.y = a[1]; fa.vel.x = 0; fa.vel.y = 0
        fb.pos.x = b[0]; fb.pos.y = b[1]; fb.vel.x = 0; fb.vel.y = 0
        window.__PLAY__.pause()
      }, POSE)
      let prev = null
      for (let i = 0; i < 14; i++) {
        const b = await shot(page); if (!b) break
        let f; try { f = await fpQuick(b) } catch { break }
        if (prev && madist(prev, f) < 0.6) break
        prev = f; await page.waitForTimeout(260)
      }
      if ((await ev(page, () => window.__POST__?.hasDof?.(), null)) !== wantDof) return { err: 'tier dropped (pre)' }
      const buf = await shot(page); if (!buf) return { err: 'lost buffer' }
      if ((await ev(page, () => window.__POST__?.hasDof?.(), null)) !== wantDof) return { err: 'tier dropped (post)' }
      const raw = await sharp(buf).removeAlpha().raw().toBuffer()
      return { m: { stage, variant, hasDof: wantDof, sRect: rectEdgeEnergy(raw, RECT), sWide: rectEdgeEnergy(raw, WIDE), pal: await palette(buf), fp: await structFP(buf) } }
    } catch (e) { return { err: `throw:${String(e).slice(0, 60)}` } }
    finally { try { await page.close() } catch {} }
  }

  for (const stage of STAGES) for (const variant of VARIANTS) {
    const key = `${stage}/${variant}`
    if (done.has(key)) { console.log(`  skip ${key}`); continue }
    let m = null, last = ''
    for (let a = 0; a < 5 && !m; a++) { const r = await once(stage, variant); if (r.m) m = r.m; else last = r.err }
    if (m) { appendFileSync(ndjson, JSON.stringify(m) + '\n'); console.log(`  ok   ${key.padEnd(24)} sWide=${m.sWide} dof=${m.hasDof}`) }
    else console.log(`  FAIL ${key.padEnd(24)} ${last}`)
  }
  await browser.close()
  console.log('captured ->', ndjson)
}

// ---- entry -----------------------------------------------------------------
const mode = has('--capture') ? 'capture' : has('--assert') ? 'assert' : has('--analyze') ? 'analyze' : null
if (mode === 'capture') {
  await capture(arg('--out', 'stage-identity.ndjson'))
} else if (mode === 'analyze' || mode === 'assert') {
  const file = arg(mode === 'assert' ? '--assert' : '--analyze')
  if (!file || !existsSync(file)) { console.error(`no ndjson: ${file}`); process.exit(2) }
  const pass = analyze(file)
  if (mode === 'assert' && !pass) process.exit(1)
} else {
  console.log('usage: --capture [--out FILE] | --analyze FILE | --assert FILE')
  process.exit(2)
}
