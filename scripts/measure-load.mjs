// Measure the real main-thread cost of loading a fighter atlas: long tasks
// (the hitch/GC pause the atlas upload + buildAtlasTextures can cause) and
// time-to-first-fighter-pixels. Mirrors tools/fight-shots.mjs launch so the
// numbers are comparable to what the capture harness sees.
//
// Usage: node scripts/measure-load.mjs [--port 5399] [--a chesky --b lenny]
import { chromium } from 'playwright-core'

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d }
const PORT = arg('--port', '5399')
const A = arg('--a', 'chesky')
const B = arg('--b', 'lenny')
const URL = `http://localhost:${PORT}/?fight=1&a=${A}&b=${B}`

const browser = await chromium.launch({
  headless: false,
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-angle=metal', '--window-position=4000,4000', '--hide-scrollbars'],
})
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })

// Install a long-task observer BEFORE any app code runs. A synchronous
// atlas-build on the main thread shows up here as one large task.
await page.addInitScript(() => {
  window.__lt = []
  window.__t0 = performance.now()
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) window.__lt.push({ start: Math.round(e.startTime), dur: Math.round(e.duration) })
    }).observe({ entryTypes: ['longtask'] })
  } catch { /* longtask unsupported */ }
})

const navStart = Date.now()
await page.goto(URL, { waitUntil: 'domcontentloaded' })

// Poll the WebGL canvas for the first frame where the fighters are actually
// painted — real pixels, not "canvas exists". Reads back a downscaled snapshot
// and looks for non-background coverage in the two side thirds where fighters
// stand. This cannot pass on an empty stage.
const readyAt = await page.evaluate(async () => {
  const bgClose = (r, g, b, R, G, B) => Math.abs(r - R) + Math.abs(g - G) + Math.abs(b - B) < 40
  const start = performance.now()
  const deadline = start + 20000
  const canvas = () => document.querySelector('canvas')
  while (performance.now() < deadline) {
    const c = canvas()
    if (c) {
      const w = 160, h = 90
      const off = document.createElement('canvas'); off.width = w; off.height = h
      const cx = off.getContext('2d')
      cx.drawImage(c, 0, 0, w, h)
      const d = cx.getImageData(0, 0, w, h).data
      // background = median-ish corner sample
      const ci = ((5 * w) + 5) * 4
      const R = d[ci], G = d[ci + 1], B = d[ci + 2]
      let paintLeft = 0, paintRight = 0
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4
          if (bgClose(d[i], d[i + 1], d[i + 2], R, G, B)) continue
          if (x < w * 0.33) paintLeft++
          else if (x > w * 0.66) paintRight++
        }
      }
      if (paintLeft > 30 && paintRight > 30) return Math.round(performance.now() - window.__t0)
    }
    await new Promise((r) => setTimeout(r, 30))
  }
  return -1
})

// Let a couple more seconds of long tasks flush (late texture uploads).
await page.waitForTimeout(2500)
const lt = await page.evaluate(() => window.__lt.slice().sort((a, b) => b.dur - a.dur))
const nav = await page.evaluate(() => {
  const n = performance.getEntriesByType('navigation')[0] || {}
  return { dcl: Math.round(n.domContentLoadedEventEnd || 0), load: Math.round(n.loadEventEnd || 0) }
})

const wallReady = Date.now() - navStart
const total = lt.reduce((s, e) => s + e.dur, 0)
const over50 = lt.filter((e) => e.dur >= 50)
console.log(`\nmatchup: ${A} vs ${B}`)
console.log(`time to fighters painted:      ${readyAt >= 0 ? readyAt + 'ms' : 'NEVER (>20s)'}  (wall ${wallReady}ms)`)
console.log(`long tasks (>50ms):            ${over50.length}   total blocking ~${total}ms`)
console.log(`longest single task (a hitch): ${lt[0] ? lt[0].dur + 'ms @ ' + lt[0].start + 'ms' : 'none'}`)
console.log(`top 5 tasks:                   ${lt.slice(0, 5).map((e) => e.dur + 'ms').join(', ') || 'none'}`)

await browser.close()
