// proj-isolate.mjs — show EXACTLY what a bolt paints, free of stage/debug.
//
// Steps a warden match (paused, deterministic) until a bolt is mid-travel, then
// screenshots the same region twice: layer ON, then layer OFF via the dev-only
// __MUT_NO_PROJ__ hook (advancing a single frame). Whatever vanishes between the
// two — beyond ~1px of fighter drift — is the bolt. A sharp diff (ON minus OFF)
// isolates the layer's contribution and is the house-rule "disable it, watch it
// go to zero" proof in image form.
import { chromium } from 'playwright-core'
import { mkdirSync, rmSync } from 'node:fs'
import sharp from 'sharp'

const flag = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d }
const PORT = flag('port', '5410')
const OUT = flag('out', 'critique/proj-isolate')
const WANT = flag('phase', 'travel') // which phase to freeze on
const q = new URLSearchParams({ fight: '1', stage: flag('stage', 'pre-pmf'), a: 'lenny', b: 'spiegel', p1: 'warden', p2: 'operator' })
const BASE = `http://localhost:${PORT}/?${q.toString()}`
rmSync(OUT, { recursive: true, force: true }); mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({
  headless: false,
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-angle=metal', '--window-position=4000,4000', '--hide-scrollbars'],
})
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
await page.goto(BASE, { waitUntil: 'domcontentloaded' })
// Wait for __FIGHT__ to exist AND stay defined across consecutive polls — React
// StrictMode double-mounts in dev and briefly deletes the global, so a single
// ready() check can win the race and then vanish before the next call.
let stable = 0
for (let i = 0; i < 200; i++) {
  const ok = await page.evaluate(() => !!window.__FIGHT__?.ready())
  stable = ok ? stable + 1 : 0
  if (stable >= 3) break
  await sleep(150)
}
if (stable < 3) { console.log('FAILED: __FIGHT__ never stabilised'); await browser.close(); process.exit(1) }
await page.evaluate(() => { window.__FIGHT__.pause(); window.__FIGHT__.step(2) })
await sleep(150)

// Hunt to a bolt in the requested phase with real coverage (a solid travel read).
let armed = false, total = 0
for (let r = 0; r < 300 && !armed; r++) {
  const res = await page.evaluate((want) => {
    for (let i = 0; i < 6; i++) {
      window.__FIGHT__.step(1)
      const p = window.__PROJDBG__ ? window.__PROJDBG__() : []
      const cov = window.__FIGHT__.projCoverage()
      if (p.length > 0 && p.some((b) => b.phase === want) && cov.fraction > 0.0004) return { hit: true, i, cov: cov.fraction }
    }
    return { hit: false, i: 6 }
  }, WANT)
  total += res.i
  if (res.hit) { armed = true; console.log(`bolt in '${WANT}' at ~frame ${total}, cov=${(res.cov * 1000).toFixed(2)}‰`) }
}
if (!armed) { console.log('FAILED: no bolt reached that phase'); await browser.close(); process.exit(2) }

await page.screenshot({ path: `${OUT}/on_full.png`, timeout: 15000 })
await page.evaluate(() => { window.__MUT_NO_PROJ__ = true })
// Re-render the SAME sim frame with dt=0 so nothing moves — only the projectile
// layer disappears. A non-zero step would drift the fighters a pixel and smear
// the diff with their edges (which is exactly what happened first time round).
await page.evaluate(() => window.__FIGHT__.step(1, 0))
await page.screenshot({ path: `${OUT}/off_full.png`, timeout: 15000 })

// Diff ON-OFF over the full frame to LOCATE the bolt (brightest diff cluster),
// then emit a true-1:1 crop centred there plus the raw on/off crops.
const on = await sharp(`${OUT}/on_full.png`).raw().toBuffer({ resolveWithObject: true })
const off = await sharp(`${OUT}/off_full.png`).raw().toBuffer({ resolveWithObject: true })
const W = on.info.width, H = on.info.height, ch = on.info.channels
const diff = Buffer.alloc(W * H * 3)
let bx = 0, by = 0, bmax = 0
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const i = (y * W + x) * ch, j = (y * W + x) * 3
  const dr = Math.abs(on.data[i] - off.data[i])
  const dg = Math.abs(on.data[i + 1] - off.data[i + 1])
  const db = Math.abs(on.data[i + 2] - off.data[i + 2])
  diff[j] = dr; diff[j + 1] = dg; diff[j + 2] = db
  const m = dr + dg + db
  if (m > bmax) { bmax = m; bx = x; by = y }
}
await sharp(diff, { raw: { width: W, height: H, channels: 3 } }).png().toFile(`${OUT}/diff_full.png`)
console.log(`brightest bolt paint at (${bx},${by}), diff sum=${bmax}`)
const cw = 300, chh = 220
const crop = { left: Math.max(0, bx - cw / 2 | 0), top: Math.max(0, by - chh / 2 | 0), width: cw, height: chh }
for (const [src, tag] of [['on_full', 'on'], ['off_full', 'off'], ['diff_full', 'diff']])
  await sharp(`${OUT}/${src}.png`).extract(crop).toFile(`${OUT}/${tag}_crop.png`)
console.log(`crops written to ${OUT}/{on,off,diff}_crop.png`)
await browser.close()
