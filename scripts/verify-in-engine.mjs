// Verify a generated atlas actually renders correctly IN THE ENGINE — not just
// in an APNG preview. An atlas can be contract-valid and still be wrong in-game
// (wrong pivot → floats/sinks, wrong stance name → animation never plays, wrong
// scale). Previews cannot catch any of those; only the real renderer can.
//
// We drive the live harness (already running on :5399, owned by another agent —
// we never start our own server) and do NOT depend on the harness having been
// wired to load real atlases: it still builds the stretched MOCK atlas. So we
// inject our real atlas at runtime through the renderer's own public API
// (window.__FIGHT__.renderer.setFighterAssets) and compare the pixels the engine
// paints before and after, at the same scripted beat.
//
// Anti-lying discipline (this repo has a documented history of green-yet-broken
// probes). Everything happens inside ONE warmed page load under the fully
// deterministic scripted MockSim (?sim=mock), so there is no cross-load timing
// to trust. At the hitstun beat we take:
//   A       — mock render
//   A'      — mock render again, no change            (zero-baseline control)
//   B       — after injecting the real atlas          (the thing under test)
// and assert:
//   * diff(A, A')  ~ 0            → the metric can report "identical"; it is not
//                                    rigged to always shout a big number.
//   * diff(A, B)   >= REAL_MIN    → the real atlas genuinely changed what the
//     over lenny's half             engine drew (mock draws the lying lose.png
//                                    for hitstun; the real atlas draws the
//                                    upright hurt recoil). If setFighterAssets
//                                    silently no-oped, this collapses toward the
//                                    control value and the run FAILS.
//   * coverage guard on A and B  → fighters actually paint pixels.
//
// Prove the change-assertion can fail: run with --no-inject. Then B is captured
// without swapping the atlas, diff(A,B) stays tiny, and the run exits non-zero.
//
// Usage: node scripts/verify-in-engine.mjs [--port 5399] [--a chesky] [--b lenny] [--no-inject]
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'
import path from 'node:path'

const args = process.argv.slice(2)
const flag = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d }
const has = (n) => args.includes(`--${n}`)

const PORT = flag('port', '5399')
const A = flag('a', 'chesky')
const B = flag('b', 'lenny')
const OUT = flag('out', '.sprite-gen/engine-shots')
const DO_INJECT = !has('no-inject')
// Absolute MockSim frames (the scripted loop the original capture SHOTS target).
const BEATS = { '00-neutral': 40, '03-heavy-hit': 177, '04-hitstun': 202, '10-ko': 496 }
const HITSTUN = BEATS['04-hitstun']
const BASE = `http://localhost:${PORT}/?fight=1&sim=mock&stage=ipo-prep&a=${A}&b=${B}`
const ACCENT = { [A]: '#E63946', [B]: '#4361EE' }

mkdirSync(OUT, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function rafSettle(page) {
  await page.evaluate(() => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res))))
}

async function seek(page, target) {
  const cur = await page.evaluate(() => window.__FIGHT__.frame())
  const delta = target - cur
  if (delta > 0) await page.evaluate((n) => window.__FIGHT__.seek(n), delta)
  await rafSettle(page)
  await sleep(120)
}

async function positions(page) {
  return page.evaluate(() => window.__FIGHT__.renderer.fighters.map((f) => ({ x: +f.mesh.position.x.toFixed(3), y: +f.mesh.position.y.toFixed(3) })))
}
const posDist = (a, b) => Math.max(...a.map((p, i) => Math.max(Math.abs(p.x - b[i].x), Math.abs(p.y - b[i].y))))

// Advance the scripted loop until it returns to the same state as `refPos` while
// in `refPhase`, and screenshot the closest match to `outPath`. This isolates
// the atlas: at a matched loop point the sim state is identical, so a mock-vs-
// real diff there is due ONLY to the swapped atlas, not to any fighter having
// slid a few cm between frames.
async function captureMatchingLoopPoint(page, refPos, refPhase, outPath, probeSide, { max = 1600 } = {}) {
  let best = Infinity
  let bestFrame = -1
  let bestProbe = null
  for (let i = 0; i < max; i++) {
    const phase = await page.evaluate(() => { window.__FIGHT__.step(1); return window.__FIGHT__.phase() })
    if (phase !== refPhase) continue
    const d = posDist(await positions(page), refPos)
    if (d < best) {
      best = d
      bestFrame = await page.evaluate(() => window.__FIGHT__.frame())
      await rafSettle(page)
      await page.screenshot({ path: outPath }) // full-stage, for human review only
      bestProbe = await fighterProbeGray(page, probeSide) // isolated fighter, for the assertion
      if (best <= 0.05) break // exact loop realignment — cannot do better
    }
  }
  return { dist: best, frame: bestFrame, probe: bestProbe }
}

async function injectReal(page, side, id, accent) {
  return page.evaluate(async ([side, id, accent]) => {
    const assets = await fetch(`/fighters/${id}/assets.json`).then((r) => {
      if (!r.ok) throw new Error(`assets.json ${r.status}`)
      return r.json()
    })
    const img = new Image()
    img.src = `/fighters/${id}/atlas.png`
    await img.decode()
    if (!img.naturalWidth) throw new Error('atlas decoded to 0px')
    await window.__FIGHT__.renderer.setFighterAssets(side, assets, img, accent)
    return { frames: assets.frames.length, clips: Object.keys(assets.clips).length, w: img.naturalWidth, h: img.naturalHeight }
  }, [side, id, accent])
}

// Render ONE fighter group alone (no stage, no particles, no post-processing) to
// the framebuffer and read back a small greyscale silhouette. This is the same
// trick fighterCoverage() uses to defeat "something painted over the fighter":
// an isolated readback is the only signal the drifting confetti/god-rays/bloom
// cannot contaminate. We compare lenny-only mock vs lenny-only real here, so the
// diff is purely his sprite — nothing else in the frame can move it.
async function fighterProbeGray(page, side, cols = 160, rows = 90) {
  return page.evaluate(([side, cols, rows]) => {
    const R = window.__FIGHT__.renderer
    const gl = R.engine.renderer, cam = R.engine.camera, scene = R.engine.scene
    const probe = new (scene.constructor)()
    scene.traverse((o) => { if (o.isLight) probe.add(o.clone()) })
    const g = R.fighters[side].group, parent = g.parent
    probe.add(g)
    const prev = gl.getRenderTarget()
    gl.setRenderTarget(null)
    gl.setClearColor(0x000000, 1)
    gl.clear(true, true, true)
    gl.render(probe, cam)
    const ctx = gl.getContext()
    const w = gl.domElement.width, h = gl.domElement.height
    const buf = new Uint8Array(w * h * 4)
    ctx.readPixels(0, 0, w, h, ctx.RGBA, ctx.UNSIGNED_BYTE, buf)
    gl.setRenderTarget(prev)
    if (parent) parent.add(g)
    const out = new Array(cols * rows).fill(0), cnt = new Array(cols * rows).fill(0)
    for (let y = 0; y < h; y++) {
      const ry = Math.min(rows - 1, (y * rows / h) | 0)
      for (let x = 0; x < w; x++) {
        const rx = Math.min(cols - 1, (x * cols / w) | 0)
        const i = (y * w + x) * 4
        const a = buf[i + 3] / 255
        const L = ((buf[i] + buf[i + 1] + buf[i + 2]) / 3) * a // black where transparent
        const k = ry * cols + rx
        out[k] += L; cnt[k]++
      }
    }
    for (let k = 0; k < out.length; k++) out[k] = cnt[k] ? out[k] / cnt[k] : 0
    return out
  }, [side, cols, rows])
}

// Compare two greyscale silhouettes: mean absolute delta and the fraction of
// cells that changed a lot (a whole-body pose change lights up many cells).
function grayDelta(a, b) {
  let sum = 0, big = 0
  for (let i = 0; i < a.length; i++) { const d = Math.abs(a[i] - b[i]); sum += d; if (d > 30) big++ }
  return { mean: sum / a.length, frac: big / a.length }
}

async function main() {
  console.log(`=== in-engine verification: ${A} vs ${B} on :${PORT} (sim=mock, inject=${DO_INJECT}) ===`)
  const browser = await chromium.launch({
    headless: false,
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    args: ['--use-angle=metal', '--window-position=4000,4000', '--hide-scrollbars'],
  })
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })
  page.on('pageerror', (e) => console.log('  [pageerror]', e.message))
  page.on('response', (r) => { if (r.status() >= 400) console.log(`  [http ${r.status()}] ${r.url()}`) })

  const fails = []
  try {
    await page.goto(BASE, { waitUntil: 'networkidle' })
    let ready = false
    for (let i = 0; i < 160; i++) { if (await page.evaluate(() => !!window.__FIGHT__?.ready())) { ready = true; break } await sleep(250) }
    if (!ready) { console.log('  FAILED: never ready'); process.exit(1) }

    // Warm: freeze the loop and run a handful of fixed steps so shaders compile
    // and textures are resident before we trust a screenshot.
    await page.evaluate(() => { window.__FIGHT__.pause(); window.__FIGHT__.step(6) })
    await rafSettle(page); await sleep(300)

    // --- hitstun beat: control pair + injected capture ---
    await seek(page, HITSTUN)
    const phaseRef = await page.evaluate(() => window.__FIGHT__.phase())
    const posRef = await positions(page)
    const covA = await page.evaluate(() => window.__FIGHT__.coverage())
    const pA = path.join(OUT, 'A-mock-hitstun.png'); await page.screenshot({ path: pA })
    const pA2 = path.join(OUT, 'A2-mock-hitstun.png'); await rafSettle(page); await page.screenshot({ path: pA2 })
    // Isolated lenny-only silhouettes for the control pair (same beat, no swap).
    const probeA = await fighterProbeGray(page, 1)
    const probeA2 = await fighterProbeGray(page, 1)
    console.log(`  reference beat: phase=${phaseRef} pos=${JSON.stringify(posRef)}`)

    if (DO_INJECT) {
      const ca = await injectReal(page, 0, A, ACCENT[A])
      const cb = await injectReal(page, 1, B, ACCENT[B])
      console.log(`  injected ${A} ${ca.frames}f/${ca.clips}c ${ca.w}x${ca.h} + ${B} ${cb.frames}f/${cb.clips}c ${cb.w}x${cb.h}`)
      if (ca.frames < 30 || cb.frames < 30 || ca.clips < 40 || cb.clips < 40) fails.push('thin-assets')
    } else {
      console.log('  --no-inject: NOT swapping the atlas (expected to FAIL the change assertion)')
    }

    // Return to the SAME point in the scripted loop (identical sim state) and
    // capture B there. Same fighter positions + same phase ⇒ same pose clip, so
    // the only thing that can move the pixels is the atlas we injected.
    const pB = path.join(OUT, 'B-real-hitstun.png')
    const match = await captureMatchingLoopPoint(page, posRef, phaseRef, pB, 1)
    console.log(`  matched loop point @f${match.frame} (state dist ${match.dist.toFixed(3)}cm from reference)`)
    if (match.frame < 0) { fails.push('no-loop-match'); }
    const covB = await page.evaluate(() => window.__FIGHT__.coverage())

    // Assertions run on the ISOLATED fighter silhouette (probe), which contains
    // zero stage FX — so drifting confetti/bloom cannot forge a "change".
    const control = grayDelta(probeA, probeA2)
    const change = (match.frame < 0 || !match.probe) ? { mean: 0, frac: 0 } : grayDelta(probeA, match.probe)
    console.log('\n-- isolated fighter-silhouette comparison (lenny alone, no stage FX) --')
    console.log(`  control  diff(A, A')  = mean ${control.mean.toFixed(2)}  frac ${(control.frac * 100).toFixed(2)}%   (identical mock renders)`)
    console.log(`  change   diff(A, B)   = mean ${change.mean.toFixed(2)}  frac ${(change.frac * 100).toFixed(2)}%   (${DO_INJECT ? 'real atlas, same sim state' : 'NO injection, same sim state'})`)
    console.log(`  coverage A=${(covA.fraction * 100).toFixed(2)}%  B=${(covB.fraction * 100).toFixed(2)}%`)

    const CONTROL_MAX = 0.5 // percent of cells
    const REAL_MIN = 4.0    // percent of cells — a whole-body pose swap lights up many cells
    const ctlOk = control.frac * 100 <= CONTROL_MAX
    console.log(`\n-- assertions --`)
    console.log(`  [${ctlOk ? 'OK ' : 'BUG'}] control big-change ${(control.frac * 100).toFixed(2)}% <= ${CONTROL_MAX}%  (isolated silhouette identical on a repeat render — metric not rigged)`)
    if (!ctlOk) fails.push('control-not-flat')
    const changeOk = change.frac * 100 >= REAL_MIN
    console.log(`  [${changeOk ? 'OK ' : 'BUG'}] change big-change ${(change.frac * 100).toFixed(2)}% >= ${REAL_MIN}%  (real atlas moved a large part of the isolated silhouette; with --no-inject this collapses to ~control and FAILS)`)
    if (!changeOk) fails.push('real-atlas-no-change')
    if (covA.fraction < 0.004) fails.push('coverage-A')
    if (covB.fraction < 0.004) fails.push('coverage-B')

    // --- review capture: first occurrence of each phase, injected/real ---
    if (DO_INJECT && !fails.length) {
      console.log('\n-- review shots (injected/real) --')
      const WANT = ['neutral', 'dash-in', 'hitstun', 'juggle', 'ko']
      const seen = new Set()
      for (let i = 0; i < 1600 && seen.size < WANT.length; i++) {
        const phase = await page.evaluate(() => { window.__FIGHT__.step(1); return window.__FIGHT__.phase() })
        if (!WANT.includes(phase) || seen.has(phase)) continue
        seen.add(phase)
        await rafSettle(page)
        const f = path.join(OUT, `real-${String(seen.size).padStart(2, '0')}-${phase}.png`)
        await page.screenshot({ path: f })
        const cov = await page.evaluate(() => window.__FIGHT__.coverage())
        console.log(`    real-${phase} painted=${(cov.fraction * 100).toFixed(2)}%`)
      }
    }
  } finally {
    await browser.close()
  }

  console.log('')
  if (fails.length) { console.log(`FAILED: ${fails.join(', ')}`); process.exit(1) }
  console.log(`PASS — real atlas renders in-engine and differs from mock as expected. Shots in ${OUT}/`)
}

main().catch((e) => { console.error(e); process.exit(1) })
