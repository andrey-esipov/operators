// One-off: after a hit, list every top-level additive plane in the scene with
// its uniform key signature + scale, so an offender named only "Mesh" by
// find-blowout-source.mjs can be traced back to the code that spawns it.
import { chromium } from 'playwright-core'

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d }
const port = arg('--port', '5173')
const flavor = arg('--flavor', 'ult')

const browser = await chromium.launch({
  headless: false,
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-angle=metal', '--window-position=4000,4000'],
})
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
await page.goto(`http://localhost:${port}/?lab=1&stage=hypergrowth`, { waitUntil: 'load', timeout: 60000 })
await page.waitForFunction(() => !!window.__OPS3D__?.engine, null, { timeout: 60000 })
await page.evaluate(() => window.__OPS3D__.settle && window.__OPS3D__.settle(1.5))

const out = await page.evaluate((fl) => {
  window.__OPS3D__.hit(fl, 'b')
  window.__OPS3D__.step(3)
  const scene = window.__OPS3D__.engine.scene
  const rows = []
  for (const o of scene.children) {
    if (!o.isMesh || !o.material?.uniforms) continue
    rows.push({
      keys: Object.keys(o.material.uniforms).sort().join(','),
      scale: +o.scale.x.toFixed(2),
      pos: [o.position.x, o.position.y, o.position.z].map((v) => +v.toFixed(2)),
      vis: o.visible,
      mode: o.material.uniforms.uMode?.value ?? null,
      intensity: o.material.uniforms.uIntensity?.value ?? null,
    })
  }
  return rows
}, flavor)

console.log(JSON.stringify(out, null, 1))
await browser.close()
