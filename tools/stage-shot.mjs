// Stage-still inspector: load one arena at NATIVE 1280x720 (DPR 1 — the exact
// resolution the reference match capture was judged at), freeze the sim at a
// neutral fight beat, and emit the full frame plus a grid of 1:1 crops.
//
// Why this exists alongside play-shots / motion-strip: those drive a moving
// match (fighters + camera move, beats are not clean neutral) at DPR 2. Judging
// static STAGE ART — placeholder window grids, silhouetted pillars, floor haze —
// needs a controlled, reproducible neutral still with FIXED crop regions so a
// before/after comparison is honest. Downscaling the full frame to eyeball it is
// exactly the operation that repairs the placeholder-texture artefact (it hid a
// 4.1x sprite upscale from six agents), so we ALWAYS view real 1:1 crops.
//
// Usage:
//   node tools/stage-shot.mjs --port 5399 --stage ipo-prep --out probe-out/ipo
//   optional: --a lenny --b spiegel  --crops "win:360,150,420,220;..."
//   --no-pause keeps the sim live (for motion). Default pauses for a clean still.

import { chromium } from 'playwright-core'
import { mkdirSync, writeFileSync } from 'node:fs'
import sharp from 'sharp'

const arg = (n, d) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : d)
const PORT = arg('--port', '5399')
const STAGE = arg('--stage', 'ipo-prep')
const OUT = arg('--out', `probe-out/${STAGE}`)
const A = arg('--a', 'lenny')
const B = arg('--b', 'spiegel')
const NO_PAUSE = process.argv.includes('--no-pause')
const CROPS_ARG = arg('--crops', '')
const URL = `http://localhost:${PORT}/?stage=${STAGE}&a=${A}&b=${B}&cpu=dummy`

const W = 1280, H = 720
mkdirSync(OUT, { recursive: true })

// A default 3x2 grid of overlapping 1:1 tiles covering the whole frame, so we
// always have full 1:1 coverage without guessing regions. Overlap keeps props
// that straddle a tile boundary intact.
function gridTiles() {
  const cols = 3, rows = 2
  const tw = 480, th = 320 // > W/cols, H/rows so tiles overlap
  const tiles = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = Math.round((W - tw) * (cols === 1 ? 0 : c / (cols - 1)))
      const y = Math.round((H - th) * (rows === 1 ? 0 : r / (rows - 1)))
      tiles.push({ name: `tile-${r}${c}`, x, y, w: tw, h: th })
    }
  }
  return tiles
}

function parseCrops(s) {
  if (!s) return null
  return s.split(';').filter(Boolean).map((spec) => {
    const [name, rest] = spec.split(':')
    const [x, y, w, h] = rest.split(',').map(Number)
    return { name, x, y, w, h }
  })
}

const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-angle=metal', '--no-sandbox'],
})
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 })

let reloaded = false
page.on('framenavigated', (f) => { if (f === page.mainFrame()) reloaded = true })

async function waitStableFight() {
  let stable = 0
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline && stable < 15) {
    let ok = false
    try {
      ok = await page.evaluate(() => !!window.__PLAY__?.ready?.() && window.__PLAY__.state().phase === 'fight')
    } catch { ok = false }
    stable = ok ? stable + 1 : 0
    await page.waitForTimeout(30)
  }
  return stable >= 15
}

async function main() {
  await page.goto(URL, { waitUntil: 'domcontentloaded' })

  // This shared tree reloads constantly (six other agents saving files), which
  // drops the page back to "loading match…" mid-capture. Retry the whole
  // settle+freeze until we get a live, painted, non-reloaded frame.
  const settleMs = Number(arg('--settle', '1600'))
  for (let attempt = 0; attempt < 8; attempt++) {
    if (!(await waitStableFight())) continue
    await page.mouse.click(800, 450)
    reloaded = false // arm only after warm-up
    // Let the round-intro "FIGHT!" banner clear before we freeze, or it paints a
    // translucent word across the stage art we came to inspect.
    await page.waitForTimeout(settleMs)
    if (!NO_PAUSE) {
      await page.evaluate(() => window.__PLAY__?.pause?.())
      await page.waitForTimeout(120)
    }
    const live = await page.evaluate(() => !!window.__PLAY__?.ready?.() && window.__PLAY__.state().phase === 'fight').catch(() => false)
    if (live && !reloaded) break
    if (!NO_PAUSE) await page.evaluate(() => window.__PLAY__?.resume?.()).catch(() => {})
    await page.waitForTimeout(400)
  }

  writeFileSync(`${OUT}/full.png`, await page.screenshot({ clip: { x: 0, y: 0, width: W, height: H } }))

  const crops = parseCrops(CROPS_ARG) ?? gridTiles()
  for (const cr of crops) {
    const buf = await page.screenshot({ clip: { x: cr.x, y: cr.y, width: cr.w, height: cr.h } })
    writeFileSync(`${OUT}/crop-${cr.name}.png`, buf)
    // 2x nearest-neighbour enlargement so texel detail is unambiguous in review
    // WITHOUT resampling away the very artefact we are hunting.
    const big = await sharp(buf).resize(cr.w * 2, cr.h * 2, { kernel: 'nearest' }).png().toBuffer()
    writeFileSync(`${OUT}/crop-${cr.name}@2x.png`, big)
  }

  console.log(`stage-shot: requested ${STAGE}  reloaded=${reloaded}`)
  console.log(`  wrote ${OUT}/full.png + ${crops.length} crops (1:1 and @2x nearest)`)
  await browser.close()
}

main().catch(async (e) => { console.error('FAILED:', e.message); await browser.close(); process.exit(1) })
