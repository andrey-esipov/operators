#!/usr/bin/env node
/**
 * Finds the scene object responsible for a dead colour channel.
 *
 *   node tools/find-nan-source.mjs --port 5173 --stage hypergrowth --flavor crit
 *
 * A NaN produced anywhere in a shader survives every blend and is written out by
 * the final clamp as EXACTLY 0. The symptom is a region of the frame where one
 * channel is pinned to 0 while the others look fine, so the area reads as a
 * saturated false colour (a red NaN reads cyan) with hard geometric edges. It has
 * bitten this project twice: once from bloom's mipmap upsample chain, once from
 * pow() on a negative HDR reflection sample in the arena floor.
 *
 * This freezes the render loop, then re-composes the frame with one scene subtree
 * hidden at a time and reports the share of lit pixels holding a zero channel.
 * Whichever subtree's removal collapses that number owns the bug; the walk then
 * recurses into it to name the exact mesh.
 *
 * Read the numbers as: base zeroR of ~25%+ with a contiguous `band` is a real
 * defect. Under ~2% with band [-1,-1] is just genuinely dark pixels.
 */
import { chromium } from 'playwright-core'

const argv = process.argv.slice(2)
const arg = (n, d) => {
  const i = argv.indexOf(`--${n}`)
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : d
}
const port = arg('port', '5173')
const stage = arg('stage', 'hypergrowth')
const flavor = arg('flavor', '')

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
  await page.evaluate(() => window.__OPS3D__.settle(20))
  if (flavor) {
    await page.evaluate((f) => window.__OPS3D__.hit(f, 'b'), flavor)
    await page.evaluate(() => window.__OPS3D__.settle(5))
  }

  const out = await page.evaluate(() => {
    const e = window.__OPS3D__.engine
    e.running = false
    if (e.rafId) cancelAnimationFrame(e.rafId)
    const r = e.renderer
    const gl = r.getContext()
    const w = gl.drawingBufferWidth
    const h = gl.drawingBufferHeight
    const buf = new Uint8Array(w * h * 4)

    const measure = () => {
      e.driver.render(0)
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf)
      let lit = 0, zr = 0, zg = 0, zb = 0
      const rows = new Array(h).fill(0)
      const rowLit = new Array(h).fill(0)
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x += 3) {
          const i = (y * w + x) * 4
          const R = buf[i], G = buf[i + 1], B = buf[i + 2]
          if (Math.max(R, G, B) <= 12) continue
          lit++; rowLit[y]++
          if (R === 0) { zr++; rows[y]++ }
          if (G === 0) zg++
          if (B === 0) zb++
        }
      }
      // contiguous rows where >60% of lit pixels have R === 0
      let bandTop = -1, bandBot = -1
      for (let y = 0; y < h; y++) {
        const f = rowLit[y] ? rows[y] / rowLit[y] : 0
        if (f > 0.6) { if (bandTop < 0) bandTop = y; bandBot = y }
      }
      return {
        zeroR: lit ? +(zr / lit * 100).toFixed(1) : 0,
        zeroG: lit ? +(zg / lit * 100).toFixed(1) : 0,
        zeroB: lit ? +(zb / lit * 100).toFixed(1) : 0,
        band: [bandTop, bandBot],
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
        if (m.zeroR < base.zeroR * 0.5 && depth < 3 && child.children.length) {
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
