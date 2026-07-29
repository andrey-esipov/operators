#!/usr/bin/env node
/**
 * Per-stage performance benchmark.
 *
 * Stage perf was the one thing nobody had numbers for: eight arenas, each with
 * planar reflections, volumetric shafts and procedural PBR, and no idea which
 * one falls off a cliff. This walks every stage at a fixed quality tier and
 * reports frame-time percentiles plus the renderer's own draw/triangle counts.
 *
 * p95 matters more than mean here — a stage that averages 60fps but spikes to
 * 40ms on impact frames still feels broken.
 *
 * Run this on a QUIET machine. Frame timing is the one metric that cannot be
 * isolated from other GPU work; with parallel agents rendering, drop% swings
 * wildly run to run. Draw calls, triangles and geometry counts are stable
 * regardless, so those stay trustworthy under contention.
 *
 *   node tools/bench-stages.mjs --port 5173 --quality ultra --frames 240
 *   node tools/bench-stages.mjs --width 2560 --height 1440   # stress
 */
import { chromium } from 'playwright-core'
console.error('\u26A0\uFE0F  [instrument-routing] tools/bench-stages.mjs drives the LEGACY CARD BATTLER (?lab=1 / __OPS3D__ → FightScene3D + VfxSubsystem), NOT the shipped fighter. Its numbers are INADMISSIBLE as shipped-fighter evidence. Provenance: tools/instrument-manifest.json.')

const argv = process.argv.slice(2)
const arg = (n, d) => {
  const i = argv.indexOf(`--${n}`)
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : d
}

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const port = arg('port', '5173')
const quality = arg('quality', 'ultra')
const frames = Number(arg('frames', 240))
const width = Number(arg('width', 1920))
const height = Number(arg('height', 1080))

const STAGES = [
  'pre-pmf', 'hypergrowth', 'plateau', 'ai-native',
  'monetization', 'crisis', 'ipo-prep', 'distribution',
]

const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: false,
  args: ['--use-angle=metal', '--window-position=4000,4000', '--hide-scrollbars'],
})
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 })

let results = []
// Six agents are editing this tree concurrently, so vite HMR can destroy the
// page context mid-run. Measure in one shot and retry rather than reporting a
// half-finished table.
for (let attempt = 1; attempt <= 4; attempt++) {
  try {
    await page.goto(`http://localhost:${port}/?lab=1`, { waitUntil: 'load', timeout: 60000 })
    await page.waitForFunction(() => window.__OPS3D__?.ready?.(), null, { timeout: 90000 })

    results = await page.evaluate(
      async ({ stages, quality, frames }) => {
        const L = window.__OPS3D__
        const pct = (a, p) => a[Math.min(a.length - 1, Math.floor(a.length * p))]
        L.quality(quality)
        L.engine.setAdaptiveQuality(false)

        // Warm every stage first. Swapping a stage compiles its shaders, and
        // that one-time cost otherwise lands entirely on whichever stage is
        // measured first (it read as pre-pmf/hypergrowth "being slow" purely
        // for being early in the list).
        for (const s of stages) { L.setStage(s); await L.settle(20) }

        // The post pipeline turns off autoReset so it can accumulate stats
        // across passes. Own the reset here, otherwise counters climb forever
        // and every stage looks worse than the one before it.
        const info = L.engine.renderer.info
        info.autoReset = false

        const out = []
        for (const stage of stages) {
          L.setStage(stage)
          await L.settle(45)
          const dts = []
          let calls = 0, triangles = 0
          let last = performance.now()
          for (let i = 0; i < frames; i++) {
            info.reset()
            await new Promise((res) => requestAnimationFrame(res))
            const now = performance.now()
            dts.push(now - last); last = now
            calls = Math.max(calls, info.render.calls)
            triangles = Math.max(triangles, info.render.triangles)
            // Exercise the expensive path: impacts light the world, spawn VFX.
            if (i % 40 === 20) L.hit('crit', i % 80 === 20 ? 'b' : 'a', 1)
          }
          const sorted = dts.slice(8).sort((a, b) => a - b)
          const mean = sorted.reduce((a, b) => a + b, 0) / sorted.length
          out.push({
            stage,
            fps: +(1000 / mean).toFixed(1),
            p50: +pct(sorted, 0.5).toFixed(2),
            p95: +pct(sorted, 0.95).toFixed(2),
            worst: +sorted[sorted.length - 1].toFixed(2),
            // A vsync-locked app always shows p95 a touch over 16.7ms, so the
            // honest measure is what fraction of frames actually missed.
            dropped: +((sorted.filter((d) => d > 20).length / sorted.length) * 100).toFixed(1),
            calls, tris: triangles,
            textures: info.memory.textures,
            geometries: info.memory.geometries,
          })
        }
        return out
      },
      { stages: STAGES, quality, frames },
    )
    break
  } catch (err) {
    if (attempt === 4) throw err
    console.log(`  attempt ${attempt} interrupted (${String(err).slice(0, 60)}…) — retrying`)
  }
}
try {
  /* measured above */
} finally {
  await browser.close()
}

const DROP_LIMIT = 2      // % of frames over 20ms we're willing to accept
const CALL_LIMIT = 600    // draw calls before a stage needs instancing

console.log(`\n  ${width}x${height} · quality=${quality} · ${frames} frames/stage\n`)
console.log('  stage          fps    p50ms   p95ms   worst  drop%   calls    tris   geo')
console.log('  ' + '-'.repeat(76))
for (const r of results) {
  const notes = []
  if (r.dropped > DROP_LIMIT) notes.push('frame drops')
  if (r.calls > CALL_LIMIT) notes.push('draw calls')
  console.log(
    `  ${r.stage.padEnd(13)} ${String(r.fps).padStart(5)}  ${String(r.p50).padStart(6)}  ` +
    `${String(r.p95).padStart(6)}  ${String(r.worst).padStart(6)}  ${String(r.dropped).padStart(5)}  ` +
    `${String(r.calls).padStart(5)}  ${String(r.tris).padStart(6)}  ${String(r.geometries).padStart(4)}` +
    (notes.length ? `  <-- ${notes.join(' + ')}` : ''),
  )
}
console.log('')
const drops = results.filter((r) => r.dropped > DROP_LIMIT)
const calls = results.filter((r) => r.calls > CALL_LIMIT)
if (!drops.length && !calls.length) {
  console.log('  All 8 stages hold 60fps with headroom.')
} else {
  if (drops.length) console.log(`  Frame drops (>${DROP_LIMIT}% of frames over 20ms): ${drops.map((r) => `${r.stage} ${r.dropped}%`).join(', ')}`)
  if (calls.length) console.log(`  Draw-call outliers (>${CALL_LIMIT}): ${calls.map((r) => `${r.stage} ${r.calls}`).join(', ')} — candidates for instancing/merging`)
}
console.log('')
