// Measures the REAL, non-estimated cost of the shipped fighter atlases in a
// browser that matches the runtime: Chrome + ANGLE/Metal (headless Chrome here
// cannot make a WebGL context without --use-angle=metal).
//
// It reports, per atlas, the two costs that cannot be computed on paper —
//   - decode: img.decode() wall time for the committed PNG
//   - getImageData: the CPU readback buildAtlasTextures does before any of its
//     per-pixel passes run
// plus the one hardware limit that decides whether an 8192-wide atlas uploads
// at all: gl.MAX_TEXTURE_SIZE. VRAM is deterministic and computed separately.
//
// Usage: node tools/measure-atlas-cost.mjs [id ...]   (default: all atlases)
import { chromium } from 'playwright-core'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PUB = path.join(REPO, 'public')
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

const MIME = { '.png': 'image/png', '.json': 'application/json', '.html': 'text/html' }

function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      if (req.url === '/' || req.url === '/blank') {
        res.setHeader('content-type', 'text/html')
        return res.end('<!doctype html><meta charset=utf8><title>probe</title>')
      }
      const p = path.join(PUB, decodeURIComponent(req.url.split('?')[0]))
      if (!p.startsWith(PUB) || !fs.existsSync(p)) {
        res.statusCode = 404
        return res.end('nope')
      }
      res.setHeader('content-type', MIME[path.extname(p)] ?? 'application/octet-stream')
      fs.createReadStream(p).pipe(res)
    })
    srv.listen(0, () => resolve(srv))
  })
}

const ids =
  process.argv.slice(2).length > 0
    ? process.argv.slice(2)
    : fs
        .readdirSync(path.join(PUB, 'fighters'))
        .filter((d) => fs.existsSync(path.join(PUB, 'fighters', d, 'atlas.webp')))

const srv = await serve()
const port = srv.address().port
const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist'],
})
const page = await browser.newPage()
await page.goto(`http://localhost:${port}/blank`)

const gl = await page.evaluate(() => {
  const c = document.createElement('canvas')
  const g = c.getContext('webgl2')
  if (!g) return { webgl2: false }
  const dbg = g.getExtension('WEBGL_debug_renderer_info')
  return {
    webgl2: true,
    maxTexture: g.getParameter(g.MAX_TEXTURE_SIZE),
    maxTexUnits: g.getParameter(g.MAX_TEXTURE_IMAGE_UNITS),
    renderer: dbg ? g.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'unknown',
  }
})

const rows = []
for (const id of ids) {
  const r = await page.evaluate(async (url) => {
    const bytesResp = await fetch(url)
    const blob = await bytesResp.blob()
    // Median of 5 fresh decodes. A single img.decode() is noisy here — the
    // browser can rasterise lazily and a warm cache reads near-zero — so one
    // number would be a lie in either direction (house rule: the eye/one probe
    // is a hypothesis, not a verdict).
    const decodes = []
    let w = 0
    let h = 0
    for (let k = 0; k < 5; k++) {
      const bmpUrl = URL.createObjectURL(blob)
      const di = new Image()
      di.src = bmpUrl
      const t = performance.now()
      await di.decode()
      decodes.push(performance.now() - t)
      w = di.naturalWidth
      h = di.naturalHeight
      URL.revokeObjectURL(bmpUrl)
    }
    decodes.sort((a, b) => a - b)
    const decodeMs = decodes[2]
    const objUrl = URL.createObjectURL(blob)
    const img = new Image()
    img.src = objUrl
    await img.decode()
    const cv = document.createElement('canvas')
    cv.width = w
    cv.height = h
    const cx = cv.getContext('2d', { willReadFrequently: true })
    cx.drawImage(img, 0, 0)
    const t1 = performance.now()
    const data = cx.getImageData(0, 0, w, h)
    const readMs = performance.now() - t1
    // Count how many pixels carry a sub-pixel coverage ramp — the thing the fix
    // preserves; a cheap sanity read at native res.
    let partial = 0
    const px = data.data
    for (let i = 3; i < px.length; i += 4) if (px[i] > 16 && px[i] < 240) partial++
    URL.revokeObjectURL(objUrl)
    return { w, h, decodeMs, readMs, wireBytes: blob.size, partial, total: w * h }
  }, `http://localhost:${port}/fighters/${id}/atlas.webp`)
  rows.push({ id, ...r })
  console.error(`  measured ${id}`)
}

await browser.close()
srv.close()

const MIP = 4 / 3
// Mirror of ATLAS_MAP_POLICY in src/three/fight/AtlasTextures.ts (this tool is a
// standalone .mjs and can't import the TS module). The budget *gate* lives in
// atlasVramBudget.test.ts and imports the real policy; this is a reporting echo,
// so keep the two in sync if the policy changes.
const naiveVramMB = (w, h) => (3 * w * h * 4 * MIP) / 1048576 // pre-fix: 3× RGBA+mip
const policyVramMB = (w, h) => {
  const half = (n) => Math.ceil(n / 2)
  const albedo = w * h * 4 // full-res RGBA
  const normal = half(w) * half(h) * 2 // half-res RG8
  const height = half(w) * half(h) * 1 // half-res R8
  return ((albedo + normal + height) * MIP) / 1048576
}
console.log('\n=== GPU (Chrome + ANGLE/Metal) ===')
console.log(gl)
console.log('\n=== per-atlas (native 1:1, measured in-browser) ===')
console.log(
  ['id', 'w', 'h', 'wireMB', 'decodeMs', 'readMs', 'partial%', 'vramMB(naive)', 'vramMB(policy)'].join(
    '\t',
  ),
)
let vramLenny = 0
let naiveLenny = 0
for (const r of rows.sort((a, b) => b.w * b.h - a.w * a.h)) {
  const naive = naiveVramMB(r.w, r.h)
  const vram = policyVramMB(r.w, r.h)
  if (r.id === 'lenny') { vramLenny = vram; naiveLenny = naive }
  console.log(
    [
      r.id,
      r.w,
      r.h,
      (r.wireBytes / 1048576).toFixed(1),
      r.decodeMs.toFixed(1),
      r.readMs.toFixed(1),
      ((100 * r.partial) / r.total).toFixed(2),
      naive.toFixed(0),
      vram.toFixed(0),
    ].join('\t'),
  )
}
console.log(
  `\nlenny single-fighter GPU texture cost: ${vramLenny.toFixed(0)} MB (was ${naiveLenny.toFixed(0)} MB pre-fix)`,
)
console.log(
  `two-lenny match texture cost: ${(2 * vramLenny).toFixed(0)} MB (was ${(2 * naiveLenny).toFixed(0)} MB pre-fix)`,
)
console.log(
  `\n8192-wide upload safe? MAX_TEXTURE_SIZE=${gl.maxTexture} => ${
    gl.maxTexture >= 8192 ? 'YES on this GPU' : 'NO — would fail/clamp'
  }`,
)
