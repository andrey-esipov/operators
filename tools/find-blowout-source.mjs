#!/usr/bin/env node
/**
 * Finds which scene object is blowing a region of the frame to pure white.
 *
 *   node tools/find-blowout-source.mjs --port 5173 --flavor crit
 *
 * Sibling of find-nan-source.mjs. That one hunts dead channels; this one hunts
 * the opposite failure -- too much additive light stacked in one place, which in
 * a fighting game shows up as the hit spark erasing the character it landed on.
 *
 * It fires a hit, advances a fixed number of frames (so the measurement lands on
 * the same effect age every run), then re-composes the frame with one scene
 * subtree hidden at a time and reports the share of the DEFENDER's bounding box
 * that is pure white. Whichever subtree's removal collapses defBlown owns the
 * problem; the walk then recurses to name the exact mesh.
 *
 * Read the numbers as: defBlown above ~15% means the fighter is not readable
 * through the effect, which is a shipping blocker for the genre. Under ~8% is
 * where shipped fighting games sit at the peak of a heavy hit.
 */
import { chromium } from 'playwright-core'

const argv = process.argv.slice(2)
const arg = (n, d) => {
  const i = argv.indexOf(`--${n}`)
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : d
}
const port = arg('port', '5173')
const stage = arg('stage', 'hypergrowth')
const flavor = arg('flavor', 'crit')
const steps = Number(arg('steps', 3))

const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: false,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--hide-scrollbars',
    '--mute-audio', '--window-position=4000,4000', '--window-size=1600,900'],
})
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 })
  page.on('pageerror', (e) => console.log('PAGEERROR', String(e)))
  await page.goto(`http://localhost:${port}/?lab=1&hud=0&quality=ultra&stage=${stage}&a=chesky&b=lenny`,
    { waitUntil: 'load', timeout: 120000 })
  await page.waitForFunction(() => window.__OPS3D__?.ready?.() === true, null, { timeout: 120000 })
  await page.evaluate(() => window.__OPS3D__.engine.stop())
  await page.evaluate(() => window.__OPS3D__.step(20))
  await page.evaluate((f) => window.__OPS3D__.hit(f, 'b'), flavor)
  await page.evaluate((n) => window.__OPS3D__.step(n), steps)

  const out = await page.evaluate(() => {
    const e = window.__OPS3D__.engine
    const r = e.renderer
    const gl = r.getContext()
    const w = gl.drawingBufferWidth
    const h = gl.drawingBufferHeight
    const buf = new Uint8Array(w * h * 4)

    // Project the defender's world anchor to a screen box roughly one fighter
    // tall and one fighter wide, so the metric tracks the body and not the arena.
    const measure = () => {
      e.driver.render(0)
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf)
      let all = 0, allBlown = 0, box = 0, boxBlown = 0, boxWash = 0, g = 0, gn = 0
      // readPixels is bottom-up; the defender occupies the right-centre third.
      const x0 = Math.floor(w * 0.55), x1 = Math.floor(w * 0.80)
      const y0 = Math.floor(h * 0.32), y1 = Math.floor(h * 0.72)
      const L = (x, y) => { const i = (y * w + x) * 4; return (buf[i] + buf[i + 1] + buf[i + 2]) / 3 }
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x += 2) {
          const i = (y * w + x) * 4
          const blown = buf[i] > 250 && buf[i + 1] > 250 && buf[i + 2] > 250
          all++; if (blown) allBlown++
          if (x >= x0 && x < x1 && y >= y0 && y < y1) {
            box++
            if (blown) boxBlown++
            // The contact flare is warm gold, so a blob that completely hides the
            // character still scores 0% on a pure-white test. Track a coloured
            // wash too, and the box's edge energy -- that is what "can I still
            // see the fighter" actually reduces to.
            if (buf[i] > 235 && buf[i + 1] > 200) boxWash++
            if (x + 2 < x1 && y + 1 < y1) { g += Math.abs(L(x + 2, y) - L(x, y)) + Math.abs(L(x, y + 1) - L(x, y)); gn += 2 }
          }
        }
      }
      return {
        blown: +(allBlown / all * 100).toFixed(2),
        defBlown: +(boxBlown / box * 100).toFixed(1),
        defWash: +(boxWash / box * 100).toFixed(1),
        detail: +(g / Math.max(1, gn)).toFixed(2),
      }
    }

    const describe = (o) => ({
      name: o.name || o.type,
      kids: o.children.length,
      mat: o.material ? (o.material.name || o.material.type) : null,
      blending: o.material ? o.material.blending : null,
      geo: o.geometry ? o.geometry.type : null,
      count: o.isInstancedMesh ? o.count : (o.isPoints ? (o.geometry?.attributes?.position?.count ?? null) : null),
      type: o.type,
    })
    const base = measure()
    const scan = (parent, depth) => {
      const results = []
      for (const child of [...parent.children]) {
        if (!child.visible) continue
        child.visible = false
        const m = measure()
        child.visible = true
        const row = { depth, ...describe(child), ...m }
        results.push(row)
        if (m.defWash < base.defWash * 0.6 && depth < 3 && child.children.length) {
          row.inner = scan(child, depth + 1)
        }
      }
      return results
    }
    return { w, h, base, results: scan(e.scene, 0) }
  })
  console.log(JSON.stringify(out, null, 1))
} finally {
  await browser.close()
}
