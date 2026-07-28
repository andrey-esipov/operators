#!/usr/bin/env node
/**
 * Fighter / background SEPARATION gate.
 *
 * A fighting game lives or dies on silhouette read: on every stage, at every
 * moment, you must instantly see where the character ends and the world begins.
 * Ours used to leave that to chance — on dark stages the fighter popped, on
 * bright stages the body value sank into the wall directly behind it and only a
 * thin ~1px rim rescued the read. This tool MEASURES the read and ASSERTS a
 * floor across EVERY stage × several fighters, so the guarantee is enforced
 * instead of hoped for.
 *
 * Method (the calibration agent's difference method, reused verbatim so the
 * numbers are comparable to `calib_separation.json`):
 *   - screenshot A: both fighters drawn, frozen at a clean neutral;
 *   - screenshot B: the fighter MESHES hidden at the IDENTICAL camera;
 *   - |A - B| localizes the EXACT silhouette mask (mutation-proof: with the
 *     fighters already hidden the mask collapses to ~0px — see `--selftest`).
 * From that mask we read, per fighter:
 *   - fighterLum  : mean luminance of A over the mask (the body value block);
 *   - localBgLum  : mean luminance of B in a 10px ring just OUTSIDE the mask
 *                   (the wall the player actually sees around the silhouette);
 *   - contrast    : fighterLum - localBgLum (signed body-vs-local-bg contrast);
 *   - edgeContrast: |A_inside - B_outside| across the L/R silhouette boundary;
 *   - rimWidthPx  : width, in screen px, of the bright keyline just inside the
 *                   edge (peak-vs-interior detector, rebuilt to not fake a 0 at
 *                   the anti-aliased boundary pixel);
 *   - rimPeakDelta: peak keyline luminance above the body interior median.
 *
 * All numbers are RAW measured deltas (transparent), never thresholded booleans
 * that hide what happened. `--assert` adds a PASS/FAIL floor check on top.
 *
 * Runs its OWN static server over a prebuilt dist dir (no external server to
 * leave orphaned) and its OWN off-screen Chrome (killed on exit). One port, one
 * browser, cleaned up in a finally.
 *
 * Usage:
 *   node tools/measure-separation.mjs --dist dist-sepbase --out tools/_out/sep_before.json
 *   node tools/measure-separation.mjs --dist dist-sep --assert            # gate mode
 *   node tools/measure-separation.mjs --dist dist-sep --selftest          # mask-collapse mutation
 *   node tools/measure-separation.mjs --dist dist-sep --mutate keyline    # keyline-off mutation
 */
import { chromium } from 'playwright-core'
import { writeFileSync, existsSync, readFileSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, normalize } from 'node:path'
import sharp from 'sharp'

// ---- args -----------------------------------------------------------------
const argv = process.argv.slice(2)
const arg = (name, dflt) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[i + 1] : dflt
}
const has = (name) => argv.includes(`--${name}`)

const DIST = arg('dist', 'dist-sepbase')
const PORT = Number(arg('port', '5751'))
const OUT = arg('out', '')
const ASSERT = has('assert')
const SELFTEST = has('selftest')
const MUTATE = arg('mutate', '') // '', 'keyline', 'behind'
const STAGES = (arg('stages', 'pre-pmf,hypergrowth,plateau,ai-native,monetization,crisis,ipo-prep,distribution')).split(',')
// Each pair renders two DISTINCT fighter visuals (side 0 = a, side 1 = b). The
// default set covers 6 fighters spanning warm/cool/light/dark accents so the
// gate can never pass by validating a single lucky character (the roster
// blind-spot that has bitten this project before).
const PAIRS = (arg('pairs', 'chesky:lenny,doshi:turley,madhavan:spiegel')).split(',').map((p) => p.split(':'))

// ---- floors (the enforced guarantee) --------------------------------------
// Set from the measured "after" matrix (n=48: 8 stages × 3 pairs × 2 sides)
// with a safety margin below the worst observed value, so the gate is a
// REGRESSION guard: it passes the shipped build, fails the pre-keyline build,
// and fails when either separation term is mutated off. Every raw number is
// printed alongside its floor so a reader sees the exact headroom — no
// thresholded booleans hiding what happened. See sep_after.json for the full
// matrix these were derived from.
//
// Why these four, and why these values (after-worst → floor):
//   rimPeakDelta ≥ 60  (after-min 84; pre-keyline min 17, 18/48 under 70) — the
//     keyline's brightness above the body interior. This is the primary,
//     keyline-specific guard: it collapses the instant the keyline is removed.
//   rimWidthPx  ≥ 1.2  (after-min 1.3; pre-keyline min 0, 36/48 under 2px) — the
//     keyline's width. Dark-fighter rims run 2–5px and collapse to ~0 with the
//     keyline off; bright fighters read thin here but separate by value instead.
//   edgeContrast ≥ 32  (after-min 35.2; pre min 28.5, 20/48 under 35) — the mean
//     luminance step across the silhouette boundary (behind-suppression + edge).
//   contrast    ≥ -28  (after-min -23; pre min -45.3) — signed body-vs-LOCAL-bg
//     value. A BOUNDED NEGATIVE on purpose: on a few dark-fighter / bright-wall
//     combos the wall the eye sees is co-planar with the fighter, so the depth
//     gate (correctly) refuses to darken it — forcing it positive would mean
//     crushing that wall into a sticker halo, the exact "flatten the art" trade
//     the task forbids. Those reads are instead carried by the keyline (all 9
//     residual-negatives measure rim ≥2px, peak ≥181). The floor guards the
//     behind-suppression from regressing (mutating it off drops the worst toward
//     -45), and is reported transparently rather than hidden.
const FLOORS = {
  rimPeakDelta: Number(arg('minPeak', '60')), // keyline brightness over interior
  rimWidthPx: Number(arg('minRim', '1.2')), //   keyline width @900p, px
  edgeContrast: Number(arg('minEdge', '32')), // silhouette boundary step, /255
  contrast: Number(arg('minContrast', '-28')), // body vs LOCAL bg, /255 (signed)
}

const CM = 3.4 / 180
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---- tiny static server (SPA fallback to index.html) ----------------------
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.wasm': 'application/wasm', '.webp': 'image/webp' }
function startServer(root) {
  if (!existsSync(join(root, 'index.html'))) throw new Error(`no index.html under ${root} — build first`)
  const server = createServer((req, res) => {
    try {
      const url = decodeURIComponent((req.url || '/').split('?')[0])
      let p = normalize(join(root, url))
      if (!p.startsWith(normalize(root))) { res.writeHead(403); return res.end() }
      if (!existsSync(p) || statSync(p).isDirectory()) p = join(root, 'index.html')
      const body = readFileSync(p)
      res.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream', 'cache-control': 'no-store' })
      res.end(body)
    } catch (e) { res.writeHead(500); res.end(String(e)) }
  })
  return new Promise((resolve) => server.listen(PORT, () => resolve(server)))
}

// ---- luminance raster helpers ---------------------------------------------
async function lumRaw(buf) {
  const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true })
  return { data, w: info.width, h: info.height, ch: info.channels }
}
const L = (d, i) => (d[i] + d[i + 1] + d[i + 2]) / 3

// ---- per-combo measurement (difference method) ----------------------------
async function measure(browser, stage, a, b) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 })
  const errs = []
  page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 140)))
  const mutParam = MUTATE ? `&mut=${MUTATE}` : ''
  await page.goto(`http://localhost:${PORT}/?fight=1&p1=operator&p2=operator&a=${a}&b=${b}&stage=${stage}${mutParam}`, { waitUntil: 'domcontentloaded' })

  // Install the requested mutation on the page BEFORE the first frame we read.
  if (MUTATE === 'keyline') await page.evaluate(() => { window.__MUT_KEYLINE_OFF__ = true })
  if (MUTATE === 'behind') await page.evaluate(() => { window.__MUT_SEP_BEHIND_OFF__ = true })

  let ready = 0
  for (let i = 0; i < 600 && ready < 10; i++) {
    let ok = false
    try { ok = await page.evaluate(() => { const r = window.__FIGHT__?.renderer; return !!(window.__FIGHT__?.ready?.() && r && r.latest && r.latest.fighters?.length === 2) }) } catch {}
    ready = ok ? ready + 1 : 0
    await sleep(40)
  }
  if (ready < 10) { await page.close(); return { stage, a, b, error: 'no __FIGHT__ renderer', errs: errs.slice(0, 3) } }

  // Freeze a clean neutral: both idle at +-150cm, no hitstop/vfx, settle camera.
  const geo = await page.evaluate(({ CM }) => {
    void CM
    const r = window.__FIGHT__.renderer
    const clone = structuredClone(r.latest)
    clone.phase = 'fight'; clone.phaseTimer = 9999; clone.hitstop = 0; clone.superFreeze = 0
    const A = clone.fighters[0], D = clone.fighters[1]
    A.pos.x = -150; A.pos.y = 0; A.facing = 1; A.stance = 'idle'; A.grounded = true; A.vel.x = 0; A.vel.y = 0; A.stunRemaining = 0; A.move = undefined
    D.pos.x = 150; D.pos.y = 0; D.facing = -1; D.stance = 'idle'; D.grounded = true; D.vel.x = 0; D.vel.y = 0; D.stunRemaining = 0; D.move = undefined
    r.setStep(() => ({ state: structuredClone(clone), events: [] }))
    window.__FIGHT__.pause(); window.__FIGHT__.step(60)
    const cam = r.engine.camera
    const canvas = r.engine.renderer.domElement
    const W = canvas.width, H = canvas.height
    const box = (side) => {
      const f = r.fighter(side); const px = f.mesh.position.x
      const V = f.mesh.position.clone()
      const sx = (wx, wy) => { const p = V.clone(); p.set(wx, wy, 0.02); p.project(cam); return { x: (p.x * 0.5 + 0.5) * W, y: (-p.y * 0.5 + 0.5) * H } }
      const cx = px
      const foot = sx(cx, 0.02), head = sx(cx, 3.35)
      const left = sx(cx - 0.62, 1.7), right = sx(cx + 0.62, 1.7)
      return { side, cxScreen: (left.x + right.x) / 2, halfWpx: Math.abs(right.x - left.x) / 2, topY: head.y, botY: foot.y }
    }
    return { W, H, boxes: [box(0), box(1)] }
  }, { CM })

  const bufA = await page.screenshot()
  await page.evaluate(() => {
    const r = window.__FIGHT__.renderer
    for (const s of [0, 1]) { const f = r.fighter(s); f.mesh.visible = false }
    window.__FIGHT__.step(1, 0)
  })
  const bufB = await page.screenshot()

  const RA = await lumRaw(bufA), RB = await lumRaw(bufB)
  const { w, h, ch } = RA

  // Stage-not-a-lost-buffer sanity (DPR WebGL screenshots occasionally return
  // the cleared buffer; the caller retries when this reads near-black).
  let stageMean = 0, sn = 0
  for (let y = (h * 0.15) | 0; y < (h * 0.8) | 0; y += 4) for (let x = 0; x < w; x += 4) { stageMean += L(RB.data, (y * w + x) * ch); sn++ }
  stageMean /= sn

  const per = []
  let maskTotal = 0
  for (const bx of geo.boxes) {
    const x0 = Math.max(0, (bx.cxScreen - bx.halfWpx * 1.25) | 0)
    const x1 = Math.min(w, (bx.cxScreen + bx.halfWpx * 1.25) | 0)
    const y0 = Math.max(0, (bx.topY - 6) | 0)
    const y1 = Math.min(h, (bx.botY - 4) | 0)
    const mask = new Uint8Array(w * h)
    let mCount = 0, fLumSum = 0
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const i = (y * w + x) * ch
      if (Math.abs(L(RA.data, i) - L(RB.data, i)) > 18) { mask[y * w + x] = 1; mCount++; fLumSum += L(RA.data, i) }
    }
    maskTotal += mCount
    const fighterLum = mCount ? fLumSum / mCount : 0
    let ringSum = 0, ringN = 0
    const R = 10
    for (let y = y0; y < y1; y++) for (let x = Math.max(0, x0 - R); x < Math.min(w, x1 + R); x++) {
      if (mask[y * w + x]) continue
      let near = false
      for (let dy = -R; dy <= R && !near; dy += 3) for (let dx = -R; dx <= R; dx += 3) {
        const yy = y + dy, xx = x + dx
        if (yy >= 0 && yy < h && xx >= 0 && xx < w && mask[yy * w + xx]) { near = true; break }
      }
      if (near) { ringSum += L(RB.data, (y * w + x) * ch); ringN++ }
    }
    const localBgLum = ringN ? ringSum / ringN : 0
    let ecSum = 0, ecN = 0
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      if (!mask[y * w + x]) continue
      for (const [dx] of [[-1, 0], [1, 0]]) {
        const xx = x + dx
        if (xx < 0 || xx >= w || mask[y * w + xx]) continue
        ecSum += Math.abs(L(RA.data, (y * w + x) * ch) - L(RB.data, (y * w + xx) * ch)); ecN++
      }
    }
    const edgeContrast = ecN ? ecSum / ecN : 0
    // Rim: on 3 scanlines, PEAK luminance in the near-edge band (<=8px inside
    // each boundary) vs the interior median. Width = count of edge-band px above
    // interior+25; does NOT break at the anti-aliased boundary pixel (the flaw
    // that faked a 0 in the calibration agent's first detector).
    const rimRuns = []; const rimPeaks = []
    for (const fy of [0.22, 0.45, 0.68]) {
      const y = (bx.topY + (bx.botY - bx.topY) * fy) | 0
      if (y < 0 || y >= h) continue
      const xsMasked = []
      for (let x = x0; x < x1; x++) if (mask[y * w + x]) xsMasked.push(x)
      if (xsMasked.length < 8) continue
      const lo = xsMasked[0], hi = xsMasked[xsMasked.length - 1]
      const interiorLums = []
      for (let x = lo + ((hi - lo) * 0.3) | 0; x < lo + ((hi - lo) * 0.7) | 0; x++) if (mask[y * w + x]) interiorLums.push(L(RA.data, (y * w + x) * ch))
      interiorLums.sort((p, q) => p - q)
      const interiorMed = interiorLums.length ? interiorLums[interiorLums.length >> 1] : fighterLum
      for (const [edge, dir] of [[lo, 1], [hi, -1]]) {
        let peak = 0, wide = 0
        for (let k = 0; k < 8; k++) {
          const x = edge + dir * k
          if (x < 0 || x >= w || !mask[y * w + x]) continue
          const l = L(RA.data, (y * w + x) * ch)
          if (l > peak) peak = l
          if (l > interiorMed + 25) wide++
        }
        rimPeaks.push(peak - interiorMed); rimRuns.push(wide)
      }
    }
    const rimWidthPx = rimRuns.length ? rimRuns.reduce((p, q) => p + q, 0) / rimRuns.length : 0
    const rimPeakDelta = rimPeaks.length ? Math.max(...rimPeaks) : 0
    per.push({
      side: bx.side, maskPx: mCount,
      fighterLum: +fighterLum.toFixed(1), localBgLum: +localBgLum.toFixed(1),
      contrast: +(fighterLum - localBgLum).toFixed(1),
      edgeContrast: +edgeContrast.toFixed(1),
      rimWidthPx: +rimWidthPx.toFixed(1),
      rimPeakDelta: +rimPeakDelta.toFixed(1),
      pctScreenH_charHeight: +(((bx.botY - bx.topY) / h) * 100).toFixed(1),
    })
  }
  await page.close()
  return { stage, a, b, stageMean: +stageMean.toFixed(1), maskTotalPx: maskTotal, per, errs: errs.slice(0, 3) }
}

// ---- mutation self-test: mask MUST collapse with fighters hidden ----------
async function selftest(browser, stage) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 })
  await page.goto(`http://localhost:${PORT}/?fight=1&p1=operator&p2=operator&stage=${stage}`, { waitUntil: 'domcontentloaded' })
  let ready = 0
  for (let i = 0; i < 600 && ready < 10; i++) { let ok = false; try { ok = await page.evaluate(() => !!window.__FIGHT__?.ready?.()) } catch {} ready = ok ? ready + 1 : 0; await sleep(40) }
  await page.evaluate(() => { const r = window.__FIGHT__.renderer; const c = structuredClone(r.latest); c.phase = 'fight'; c.phaseTimer = 9999; c.hitstop = 0; r.setStep(() => ({ state: structuredClone(c), events: [] })); window.__FIGHT__.pause(); window.__FIGHT__.step(60); for (const s of [0, 1]) r.fighter(s).mesh.visible = false; window.__FIGHT__.step(1, 0) })
  const a = await page.screenshot(); await page.evaluate(() => window.__FIGHT__.step(1, 0)); const b = await page.screenshot()
  const RA = await lumRaw(a), RB = await lumRaw(b); const { w, h, ch } = RA
  let changed = 0
  for (let y = (h * 0.2) | 0; y < (h * 0.8) | 0; y++) for (let x = (w * 0.3) | 0; x < (w * 0.7) | 0; x++) { const i = (y * w + x) * ch; if (Math.abs(L(RA.data, i) - L(RB.data, i)) > 18) changed++ }
  await page.close()
  return { stage, changedPxWithFightersHidden: changed }
}

// ---- run ------------------------------------------------------------------
let server, browser
try {
  server = await startServer(DIST)
  browser = await chromium.launch({
    headless: false,
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    args: ['--use-angle=metal', '--window-position=4000,4000', '--hide-scrollbars'],
  })

  if (SELFTEST) {
    const out = []
    for (const s of STAGES) out.push(await selftest(browser, s))
    console.log('SELFTEST (mask px with fighters hidden — must be ~0):')
    for (const r of out) console.log(`  ${r.stage.padEnd(14)} ${r.changedPxWithFightersHidden}`)
    const worst = Math.max(...out.map((r) => r.changedPxWithFightersHidden))
    console.log(`  worst=${worst}px  ${worst <= 40 ? 'PASS (instrument reads only when a fighter is drawn)' : 'FAIL'}`)
    if (OUT) writeFileSync(OUT, JSON.stringify({ mode: 'selftest', dist: DIST, results: out }, null, 2))
    process.exit(worst <= 40 ? 0 : 1)
  }

  const results = []
  for (const stage of STAGES) {
    for (const [a, b] of PAIRS) {
      let r
      for (let attempt = 0; attempt < 3; attempt++) {
        r = await measure(browser, stage, a, b)
        if (!r.error && r.stageMean > 6) break // retry a lost (near-black) buffer
      }
      results.push(r)
      const tag = `${stage}/${a}-vs-${b}`
      if (r.error) console.log(`${tag.padEnd(34)} ERROR ${r.error}`)
      else console.log(`${tag.padEnd(34)} ` + r.per.map((p) => `s${p.side}[con=${p.contrast} edge=${p.edgeContrast} rim=${p.rimWidthPx}px peak=${p.rimPeakDelta}]`).join(' '))
    }
  }

  const out = { mode: MUTATE ? `mutate:${MUTATE}` : 'measure', dist: DIST, floors: FLOORS, stages: STAGES, pairs: PAIRS.map((p) => p.join(':')), results }
  if (OUT) { writeFileSync(OUT, JSON.stringify(out, null, 2)); console.log(`\nwrote ${OUT}`) }

  if (ASSERT) {
    const fails = []
    for (const r of results) {
      if (r.error) { fails.push(`${r.stage}/${r.a}-vs-${r.b}: ${r.error}`); continue }
      for (const p of r.per) {
        const who = `${r.stage}/${p.side === 0 ? r.a : r.b}(s${p.side})`
        if (p.rimPeakDelta < FLOORS.rimPeakDelta) fails.push(`${who}: rimPeakDelta ${p.rimPeakDelta} < ${FLOORS.rimPeakDelta}`)
        if (p.rimWidthPx < FLOORS.rimWidthPx) fails.push(`${who}: rimWidthPx ${p.rimWidthPx} < ${FLOORS.rimWidthPx}`)
        if (p.edgeContrast < FLOORS.edgeContrast) fails.push(`${who}: edgeContrast ${p.edgeContrast} < ${FLOORS.edgeContrast}`)
        if (p.contrast < FLOORS.contrast) fails.push(`${who}: contrast ${p.contrast} < ${FLOORS.contrast}`)
      }
    }
    console.log(`\n=== GATE: ${results.reduce((n, r) => n + (r.per?.length || 0), 0)} fighter-reads across ${STAGES.length} stages ===`)
    if (fails.length) { console.log('FAIL:'); for (const f of fails) console.log('  ✗ ' + f); process.exit(1) }
    console.log(`PASS — every read clears peak>=${FLOORS.rimPeakDelta}, rim>=${FLOORS.rimWidthPx}px, edge>=${FLOORS.edgeContrast}, bodyContrast>=${FLOORS.contrast}`)
  }
} finally {
  await browser?.close()
  server?.close()
}
