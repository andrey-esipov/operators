#!/usr/bin/env node
/**
 * sprite-crops.mjs — native 1:1 crops that sprite-pipeline can't take itself.
 *
 * Two questions, both of which its own instruments explicitly could not settle:
 *
 *   1. KEYLINE ON A BRIGHT STAGE. It verified the constant-weight ink line
 *      against `crisis` (near-black) and against a *synthetic* warm-floor
 *      composite. The real risk on a lit stage is the opposite of the dark-stage
 *      risk: not that the line vanishes, but that it reads as a hard cutout
 *      sticker edge. Only a real capture on `pre-pmf` settles it.
 *
 *   2. JUGGLE GHOSTING. Its temporal validator says the clip is coherent
 *      (maxRatio 1.44-1.80, zero flags) but delta-evenness structurally cannot
 *      detect double-imaging on the spin->fall morph tween. That needs frames.
 *
 * Both crops are emitted at NATIVE resolution. Downscaled contact sheets hid a
 * 4.1x upscale from everyone on this project for five sessions.
 *
 * The subject-containment guard is not optional: twice on this project a crop
 * silently stopped containing the fighter and the tool went on to report
 * confident numbers about an empty rectangle.
 */
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'
import sharp from 'sharp'

const PORT = Number(process.env.PORT || 5412)
const OUT = process.env.OUT || 'critique/sprite-crops'
const URLBASE = `http://localhost:${PORT}/`

mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({
  headless: true,
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-angle=metal', '--window-position=4000,4000', '--hide-scrollbars'],
})
const page = await browser.newPage({
  viewport: { width: 960, height: 540 },
  deviceScaleFactor: 2,
})

const errors = []
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })

async function boot(query) {
  await page.goto(URLBASE + query, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => window.__PLAY__?.ready?.() === true, { timeout: 30000 })
  // Let the first real frames land before anyone measures anything.
  await page.waitForTimeout(1200)
}

/** Raw RGBA + dims, so every measurement below is on native pixels. */
async function shot() {
  const buf = await page.screenshot({ type: 'png' })
  const img = sharp(buf)
  const { width, height } = await img.metadata()
  const data = await img.raw().toColourspace('srgb').toBuffer()
  return { data, width, height, buf }
}

/**
 * Locate a moving SUBJECT against a moving BACKGROUND.
 *
 * A plain threshold-any-pixel bbox does not work here and the reason is on this
 * project's watch list in my own handwriting: `pause()` freezes the sim, not the
 * renderer. Camera easing, god-rays and dust keep animating on render time, so
 * differencing two "frozen" frames lights up the entire 1920x810 frame. My first
 * run returned exactly that — bbox 0..1919 x 0..809, 265,729 px — and would have
 * cropped a keyline verdict out of the whole screen.
 *
 * The discriminator is CONCENTRATION, not magnitude: stage motion is diffuse and
 * low-contrast, a fighter is a compact opaque silhouette. So build a per-column
 * diff profile and keep only columns carrying the top decile of change, then do
 * the same by row inside those columns.
 */
function subjectBox(a, b, { keep = 0.90, tol = 30 } = {}) {
  const W = a.width, H = a.height
  const col = new Float64Array(W)
  const row = new Float64Array(H)
  let total = 0
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4
      const d = Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2])
      if (d > tol) { col[x] += d; row[y] += d; total += d }
    }
  }
  if (total < 1) return { x0: 0, y0: 0, x1: -1, y1: -1, n: 0, total }
  const cut = (arr) => {
    const sorted = [...arr].filter((v) => v > 0).sort((x, y) => y - x)
    if (!sorted.length) return Infinity
    let acc = 0, i = 0
    const target = sorted.reduce((s, v) => s + v, 0) * keep
    while (i < sorted.length && acc < target) { acc += sorted[i]; i++ }
    return sorted[Math.max(0, i - 1)]
  }
  const cCut = cut(col), rCut = cut(row)
  let x0 = 1e9, x1 = -1, y0 = 1e9, y1 = -1, n = 0
  for (let x = 0; x < W; x++) if (col[x] >= cCut) { if (x < x0) x0 = x; if (x > x1) x1 = x; n++ }
  for (let y = 0; y < H; y++) if (row[y] >= rCut) { if (y < y0) y0 = y; if (y > y1) y1 = y }
  return { x0, y0, x1, y1, n, total, cols: n }
}
const diffBox = subjectBox

async function crop(png, x, y, w, h, file) {
  x = Math.max(0, Math.min(png.width - 1, Math.round(x)))
  y = Math.max(0, Math.min(png.height - 1, Math.round(y)))
  w = Math.max(1, Math.min(png.width - x, Math.round(w)))
  h = Math.max(1, Math.min(png.height - y, Math.round(h)))
  await sharp(png.buf).extract({ left: x, top: y, width: w, height: h }).toFile(`${OUT}/${file}`)
  return { w, h, x, y }
}

/** Ink coverage: fraction of pixels materially darker than the local median. */
async function inkStats(file) {
  const img = sharp(`${OUT}/${file}`)
  const { width, height, channels } = await img.metadata()
  const d = await img.raw().toBuffer()
  const ch = channels
  const lum = []
  for (let i = 0; i < width * height * ch; i += ch) {
    lum.push(0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2])
  }
  const sorted = [...lum].sort((a, b) => a - b)
  const med = sorted[sorted.length >> 1]
  const p05 = sorted[Math.floor(sorted.length * 0.05)]
  const p95 = sorted[Math.floor(sorted.length * 0.95)]
  const dark = lum.filter((v) => v < med - 40).length / lum.length
  return { median: med.toFixed(1), p05: p05.toFixed(1), p95: p95.toFixed(1), darkFrac: (dark * 100).toFixed(1) }
}

// ---------------------------------------------------------------------------
// 1. Keyline on the real lit stage
// ---------------------------------------------------------------------------
console.log('=== 1. KEYLINE on pre-pmf (real lit stage, native 1:1) ===')
await boot('?a=lenny&b=chesky&stage=pre-pmf&cpu=easy')
await page.evaluate(() => window.__PLAY__.pause())
await page.waitForTimeout(250)

// Locate the fighter by differencing two frames a few sim steps apart: the
// breathing idle moves the body and nothing else in a paused world does.
const base = await shot()
await page.evaluate(() => window.__PLAY__.step(6))
await page.waitForFunction(() => window.__PLAY__.stepsPending() === 0, { timeout: 5000 })
await page.waitForTimeout(200)
const moved = await shot()
const box = diffBox(base, moved)

const st = await page.evaluate(() => window.__PLAY__.state())
console.log(`  sim: p0 stance=${st.fighters[0].stance} y=${st.fighters[0].pos.y.toFixed(1)}  p1 stance=${st.fighters[1].stance}`)
console.log(`  moving-subject bbox: x ${box.x0}..${box.x1}  y ${box.y0}..${box.y1}  (${box.n} px changed)`)

if (box.n < 400) {
  console.log('  !! SUBJECT NOT FOUND — refusing to emit a keyline verdict on an empty crop.')
} else {
  const w = box.x1 - box.x0
  // Feet: bottom band of the moving silhouette, widened so the floor contact
  // and the shadow are both inside the frame.
  const fh = 190
  const fy = box.y1 - fh + 40
  const c = await crop(moved, box.x0 - 30, fy, w + 60, fh, 'keyline-feet-prepmf.png')
  console.log(`  -> keyline-feet-prepmf.png  ${c.w}x${c.h} native`)
  console.log(`  ink stats: ${JSON.stringify(await inkStats('keyline-feet-prepmf.png'))}`)
  await crop(moved, box.x0 - 20, box.y0 - 20, w + 40, Math.min(240, box.y1 - box.y0), 'keyline-head-prepmf.png')
  console.log('  -> keyline-head-prepmf.png (upper body, same frame)')
}

// ---------------------------------------------------------------------------
// 2. Juggle in motion — frame-by-frame, hunting the spin->fall morph
// ---------------------------------------------------------------------------
console.log('')
console.log('=== 2. JUGGLE filmstrip (ghosting check on spin->fall) ===')
await boot('?a=lenny&b=chesky&cpu=hard&stage=pre-pmf')

// A juggle is `stance === 'juggle'`, but an airborne hitstun is the same
// visual question (does the reaction clip read in motion), so accept either
// and say which we got. Also record every stance seen, so a miss reports what
// the game actually did instead of just "not found".
let found = null, who = -1
const seen = new Set()
for (let attempt = 0; attempt < 1400 && !found; attempt++) {
  const s = await page.evaluate(() => {
    const st = window.__PLAY__.state()
    return st.fighters.map((f) => ({ st: f.stance, y: f.pos.y }))
  })
  s.forEach((f) => seen.add(f.st))
  for (let i = 0; i < 2; i++) {
    if (s[i].st === 'juggle' || (s[i].st === 'hitstun' && s[i].y > 8)) {
      found = s.map((f) => f.st); who = i; break
    }
  }
  if (found) break
  await page.waitForTimeout(22)
}
console.log(`  stances observed while hunting: ${[...seen].sort().join(', ')}`)

if (!found) {
  console.log('  !! no juggle observed in the sample window — NOT emitting a filmstrip.')
} else {
  console.log(`  airborne reaction on fighter ${who} (stances: ${found.join(', ')})`)
  await page.evaluate(() => window.__PLAY__.pause())
  await page.waitForTimeout(120)

  const frames = []
  for (let i = 0; i < 14; i++) {
    const png = await shot()
    const s = await page.evaluate(() => window.__PLAY__.state())
    frames.push({ png, stance: s.fighters[who].stance, y: s.fighters[who].pos.y })
    await page.evaluate(() => window.__PLAY__.step(1))
    await page.waitForFunction(() => window.__PLAY__.stepsPending() === 0, { timeout: 4000 })
    await page.waitForTimeout(70)
  }

  // Track the victim across the strip by differencing consecutive frames.
  let gx0 = 1e9, gy0 = 1e9, gx1 = -1, gy1 = -1
  for (let i = 1; i < frames.length; i++) {
    const b = diffBox(frames[i - 1].png, frames[i].png, 30)
    if (b.n > 300) {
      gx0 = Math.min(gx0, b.x0); gy0 = Math.min(gy0, b.y0)
      gx1 = Math.max(gx1, b.x1); gy1 = Math.max(gy1, b.y1)
    }
  }
  if (gx1 < 0) {
    console.log('  !! nothing moved across 14 frames — the strip would be meaningless. Not emitting.')
  } else {
    console.log(`  motion envelope across strip: x ${gx0}..${gx1}  y ${gy0}..${gy1}`)
    for (const [i, f] of frames.entries()) {
      await crop(f.png, gx0 - 24, gy0 - 24, (gx1 - gx0) + 48, (gy1 - gy0) + 48, `juggle-${String(i).padStart(2, '0')}-${f.stance}.png`)
    }
    console.log(`  -> ${frames.length} native crops, stances: ${frames.map((f) => f.stance).join(' ')}`)
    console.log(`  -> victim height y: ${frames.map((f) => f.y.toFixed(0)).join(' ')}`)
  }
}

console.log('')
console.log(errors.length ? `CONSOLE ERRORS (${errors.length}): ${errors.slice(0, 3).join(' | ')}` : 'console clean')
await browser.close()
