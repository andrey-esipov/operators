// Independent coordinator-side fps verification. Deliberately NOT reusing the
// critic's probe: the point is to reproduce its headline with a separate
// implementation. Records EVERY rAF delta with no filtering, because the
// critic disclosed that its own earlier probe silently dropped >1000ms frames
// and thereby inflated fps.
import { chromium } from 'playwright-core'
import { execSync } from 'node:child_process'

const URL = process.argv[2]
const WARM_MS = Number(process.argv[3] ?? 9000)
const MEASURE_MS = Number(process.argv[4] ?? 20000)

function cpuSnapshot() {
  try {
    const out = execSync("ps -eo %cpu,comm | grep -iE 'chrom|node|esbuild|vite' | grep -v grep | awk '{s+=$1} END {printf \"%.0f\", s+0}'").toString()
    return Number(out) || 0
  } catch { return -1 }
}

const stats = (a) => {
  if (!a.length) return null
  const s = [...a].sort((x, y) => x - y)
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))]
  return { n: s.length, p50: +q(0.5).toFixed(1), p95: +q(0.95).toFixed(1), p99: +q(0.99).toFixed(1), max: +s[s.length - 1].toFixed(1) }
}

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const browser = await chromium.launch({
  headless: true,
  executablePath: CHROME,
  args: ['--use-angle=metal', '--enable-gpu', '--hide-scrollbars', '--mute-audio'],
})
try {
  const page = await browser.newPage({ viewport: { width: Number(process.env.VW||1280), height: Number(process.env.VH||720) }, deviceScaleFactor: Number(process.env.DPR||1) })
  const cpuStart = cpuSnapshot()
  await page.goto(URL, { waitUntil: 'load', timeout: 60000 })
  await page.waitForTimeout(WARM_MS)

  const res = await page.evaluate((ms) => new Promise((resolve) => {
    const deltas = []
    let last = performance.now()
    const t0 = last
    function tick(now) {
      deltas.push(now - last)
      last = now
      if (now - t0 < ms) requestAnimationFrame(tick)
      else resolve({ deltas, wall: now - t0 })
    }
    requestAnimationFrame(tick)
  }), MEASURE_MS)

  const cpuEnd = cpuSnapshot()

  // Liveness: a 60fps rAF loop on a STATIC screen would look identical to a
  // smooth game. Hash three screenshots taken across the window; if they are
  // all equal, nothing was animating and the fps number is meaningless.
  const { createHash } = await import('node:crypto')
  const shots = []
  for (let i = 0; i < 3; i++) {
    shots.push(createHash('md5').update(await page.screenshot({ type: 'jpeg', quality: 40 })).digest('hex').slice(0, 10))
    await page.waitForTimeout(700)
  }
  const animating = new Set(shots).size > 1
  const bodyText = (await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 120))) || ''

  const { deltas, wall } = res
  const frames = deltas.length
  const effFps = +(frames / (wall / 1000)).toFixed(1)
  const st = stats(deltas)
  const smoothFps = st ? +(1000 / st.p50).toFixed(1) : 0
  const stalls = deltas.filter((d) => d > 100).length
  const bigStalls = deltas.filter((d) => d > 400).length
  const stallTime = +deltas.filter((d) => d > 100).reduce((a, b) => a + b, 0).toFixed(0)

  console.log(JSON.stringify({
    url: URL, warmMs: WARM_MS, wallMs: +wall.toFixed(0), frames,
    effFps, smoothFps_fromP50: smoothFps,
    frameMs: st,
    stalls_gt100ms: stalls, stalls_gt400ms: bigStalls, stallTimeMs: stallTime,
    stallShareOfWall: +(100 * stallTime / wall).toFixed(1),
    animating, shotHashes: shots, bodyText,
    cotenantCpuStart: cpuStart, cotenantCpuEnd: cpuEnd,
  }, null, 2))
} finally {
  await browser.close()
}
