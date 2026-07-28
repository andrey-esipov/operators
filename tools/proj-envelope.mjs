// proj-envelope.mjs — capture the WARDEN's normal fireballs as MOTION + STATE.
//
// Sibling of super-envelope.mjs, for the ProjectileLayer's regular bolts rather
// than the super beam. It steps the sim (cpu vs cpu) until a bolt actually
// spawns, then captures a native-1:1 filmstrip across the bolt's whole life —
// spawn tell, travel, and death — plus a per-frame data table.
//
// Why a bespoke tool and not motion-strip: motion-strip drives ONE fighter with
// a fixed --action and the warden's `idle` never throws. Letting both sides run
// under AI is the only way a fireball appears organically, and the warden (a
// zoner) throws constantly, so the hunt is short.
//
// The numbers are the honest part (house rule: bright additive VFX defeats
// pixel-diff, so judge state + a native look, never a diff):
//   proj   __PROJDBG__() — count/kind/phase/spawnFlash/flash of every live bolt
//   blown% share of near-white px in the FULL native frame (min(rgb) > 250).
//          This is the TASK-3 gate: a fireball must never white out the frame.
//   mid    mean luma of the central travel band (the bolt reads here)
//   fL/fR  mean luma of the two fighter columns — a blow-out flattens these to
//          white; a healthy fighter keeps mid luma with structure.
import { chromium } from 'playwright-core'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import sharp from 'sharp'

const flag = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d }
const PORT = flag('port', '5410')
const OUT = flag('out', 'critique/proj-envelope')
const FRAMES = Number(flag('frames', '54'))
const STAGE = flag('stage', 'pre-pmf')
const A = flag('a', 'lenny'); const B = flag('b', 'spiegel')
const P1 = flag('p1', 'warden'); const P2 = flag('p2', 'operator')
const SEED = flag('seed', '')
const STRIP_EVERY = Number(flag('strip-every', '2'))
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
await page.evaluate(() => { window.__FIGHT__.pause(); window.__FIGHT__.step(2) })
await sleep(200)

// Hunt to the first live bolt. A warden throws fireballs within a second or two
// of neutral, so this rarely runs long. We accept ANY live projectile (the
// warden owns the layer in this matchup; the operator has no projectiles).
let armed = false, total = 0
for (let r = 0; r < 200 && !armed; r++) {
  const res = await page.evaluate(() => {
    for (let i = 0; i < 20; i++) {
      window.__FIGHT__.step(1)
      const p = window.__PROJDBG__ ? window.__PROJDBG__() : []
      if (p.length > 0) return { hit: true, i, n: p.length }
    }
    return { hit: false, i: 20 }
  })
  total += res.i
  if (res.hit) { armed = true; console.log(`first bolt live at ~frame ${total} (${res.n} live)`) }
}
if (!armed) { console.log('FAILED: never saw a projectile'); await browser.close(); process.exit(2) }

const CROP = { left: 320, top: 210, width: 960, height: 480 } // centre 60%, travel band
const rows = []
let prevMid = null
for (let f = 0; f < FRAMES; f++) {
  const st = await page.evaluate(() => ({
    proj: window.__PROJDBG__ ? window.__PROJDBG__() : [],
    phase: window.__FIGHT__.phase(),
    cov: window.__FIGHT__.projCoverage(),
  }))
  const name = `f${String(f).padStart(3, '0')}`
  const buf = await page.screenshot({ path: `${OUT}/${name}.png`, timeout: 15000 })
  const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true })
  const W = info.width, H = info.height, ch = info.channels
  let blown = 0, npx = 0
  let midSum = 0, midN = 0, flSum = 0, flN = 0, frSum = 0, frN = 0
  const midY0 = H * 0.35, midY1 = H * 0.7
  const flX0 = W * 0.14, flX1 = W * 0.4, frX0 = W * 0.6, frX1 = W * 0.86
  for (let y = 0; y < H; y += 2) {
    for (let x = 0; x < W; x += 2) {
      const i = (y * W + x) * ch
      const r = data[i], g = data[i + 1], b = data[i + 2]
      npx++
      if (Math.min(r, g, b) > 250) blown++
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b
      if (y >= midY0 && y <= midY1) { midSum += luma; midN++ }
      if (y >= midY0 && y <= midY1) {
        if (x >= flX0 && x <= flX1) { flSum += luma; flN++ }
        if (x >= frX0 && x <= frX1) { frSum += luma; frN++ }
      }
    }
  }
  const mid = midSum / Math.max(1, midN)
  const row = {
    f, phase: st.phase,
    n: st.proj.length,
    kinds: [...new Set(st.proj.map((p) => p.kind))].join(','),
    phases: st.proj.map((p) => p.phase).join(','),
    spawn: Math.max(0, ...st.proj.map((p) => p.spawnFlashOpacity ?? 0)),
    flash: Math.max(0, ...st.proj.map((p) => p.flashOpacity ?? 0)),
    cov: st.cov ? Math.round(st.cov.fraction * 1e5) / 1e3 : 0, // projectile paint, ‰
    bbox: st.cov?.bbox ?? null,
    blown: Math.round((blown / npx) * 1000) / 10,
    mid: Math.round(mid * 10) / 10,
    fL: Math.round((flSum / Math.max(1, flN)) * 10) / 10,
    fR: Math.round((frSum / Math.max(1, frN)) * 10) / 10,
    dMid: prevMid == null ? 0 : Math.round(Math.abs(mid - prevMid) * 10) / 10,
  }
  prevMid = mid
  rows.push(row)
  await page.evaluate(() => window.__FIGHT__.step(1))
}

// native 1:1 crops. Prefer a bbox-tight crop around the bolt (the honest look at
// what the layer actually painted); fall back to the fixed travel band.
for (const f of [0, Math.floor(FRAMES / 3), Math.floor(FRAMES / 2), FRAMES - 6]) {
  if (f < 0 || f >= FRAMES) continue
  const r = rows[f]
  const nm = `${OUT}/native_f${String(f).padStart(3, '0')}.png`
  let crop = CROP
  if (r?.bbox) {
    const pad = 90
    const left = Math.max(0, Math.floor(r.bbox.minX - pad))
    const top = Math.max(0, Math.floor(r.bbox.minY - pad))
    const width = Math.min(1600 - left, Math.ceil(r.bbox.maxX - r.bbox.minX + pad * 2))
    const height = Math.min(900 - top, Math.ceil(r.bbox.maxY - r.bbox.minY + pad * 2))
    if (width > 20 && height > 20) crop = { left, top, width, height }
  }
  await sharp(`${OUT}/f${String(f).padStart(3, '0')}.png`).extract(crop).toFile(nm)
}

// composite strip (every STRIP_EVERY-th frame), cropped to the travel band
const cells = rows.filter((r) => r.f % STRIP_EVERY === 0)
const CW = 320, CH = 160
const composites = []
for (let k = 0; k < cells.length; k++) {
  const r = cells[k]
  const cell = await sharp(`${OUT}/f${String(r.f).padStart(3, '0')}.png`).extract(CROP).resize(CW, CH).png().toBuffer()
  composites.push({ input: cell, left: (k % 8) * CW, top: Math.floor(k / 8) * CH })
}
const rowsN = Math.ceil(cells.length / 8)
await sharp({ create: { width: CW * 8, height: CH * rowsN, channels: 3, background: { r: 8, g: 8, b: 12 } } })
  .composite(composites).png().toFile(`${OUT}/strip.png`)

writeFileSync(`${OUT}/data.json`, JSON.stringify(rows, null, 2))
console.log('\n  f  phase   n kinds        phases          spawn flash  cov‰ blown  mid   fL    fR   dMid')
let deadRun = 0, maxBlown = 0
for (const r of rows) {
  maxBlown = Math.max(maxBlown, r.blown)
  const dead = r.n === 0 && r.dMid < 1
  if (dead) deadRun++
  console.log(
    `${String(r.f).padStart(3)}  ${r.phase.padEnd(6)} ${String(r.n).padStart(2)} ${r.kinds.padEnd(12)} ${r.phases.padEnd(15)} ` +
    `${String(r.spawn).padStart(4)} ${String(r.flash).padStart(4)} ${String(r.cov).padStart(5)} ${String(r.blown).padStart(5)} ` +
    `${String(r.mid).padStart(5)} ${String(r.fL).padStart(5)} ${String(r.fR).padStart(5)} ${String(r.dMid).padStart(4)}`,
  )
}
console.log(`\n  frames=${rows.length}  maxBlown=${maxBlown}%  strip=${OUT}/strip.png`)
console.log(`  spawn-tell frames (spawnFlash>0): ${rows.filter((r) => r.spawn > 0).length}`)
console.log(`  death frames (flash>0): ${rows.filter((r) => r.flash > 0).length}`)
console.log(`  painting frames (cov>0): ${rows.filter((r) => r.cov > 0).length}`)
await browser.close()
