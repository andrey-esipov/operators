// Quick eyeball capture: DOF on vs off at native 1:1, plus a difference map,
// so I can SEE where the DOF pass acts before trusting any metric (house rule:
// review at 1:1, look before you measure). Not an assertion — a look.
import { chromium } from 'playwright-core'
import { mkdirSync, rmSync } from 'fs'
import sharp from 'sharp'

const arg = (k, d) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d)
const PORT = arg('--port', '5414')
const STAGE = arg('--stage', 'pre-pmf')
const OUT = `tools/_out/dof-look-${STAGE}`
const W = 3200, H = 1800
const base = `http://localhost:${PORT}/?stage=${STAGE}&cpu=dummy&quality=ultra&nofinalize`
// The reported defect pose: A downed on the left pylon, B flung high → big pull-out.
const POSE = { a: [-169, 0], b: [60, 430] }

rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({
  headless: false,
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-angle=metal', '--window-position=4000,4000', '--hide-scrollbars'],
})
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 })
const errors = []
page.on('pageerror', (e) => errors.push(String(e).slice(0, 240)))
page.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 240)))

async function stageLuma(buf) {
  const { data, info } = await sharp(buf).extract({ left: 0, top: Math.round(H * 0.14), width: W, height: Math.round(H * 0.7) }).resize(120).raw().toBuffer({ resolveWithObject: true })
  let s = 0; const n = data.length / info.channels
  for (let i = 0; i < data.length; i += info.channels) s += (data[i] + data[i + 1] + data[i + 2]) / 3
  return s / n
}
async function shot() {
  for (let i = 0; i < 10; i++) {
    let b = null
    try { b = await page.screenshot({ timeout: 8000 }) } catch { b = null }
    if (b && (await stageLuma(b)) >= 6) return b
    await page.waitForTimeout(150)
  }
  return null
}
async function settle() {
  let stable = 0
  for (let i = 0; i < 400 && stable < 12; i++) {
    let ok = false
    try {
      ok = await page.evaluate(() =>
        !!window.__PLAY__?.ready?.() &&
        window.__PLAY__.state().phase === 'fight' &&
        !!window.__STAGE__?.project &&
        !!window.__POST__)
    } catch { ok = false }
    stable = ok ? stable + 1 : 0
    await page.waitForTimeout(30)
  }
  return stable >= 12
}
async function compose() {
  await page.evaluate(() => { try { window.__PLAY__.resume() } catch {} })
  await page.evaluate(({ a, b }) => {
    const [fa, fb] = window.__PLAY__.state().fighters
    fa.pos.x = a[0]; fa.pos.y = a[1]; fa.vel.x = 0; fa.vel.y = 0
    fb.pos.x = b[0]; fb.pos.y = b[1]; fb.vel.x = 0; fb.vel.y = 0
    window.__PLAY__.pause()
  }, POSE)
  await page.waitForTimeout(1100)
}

async function load(url) {
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  if (!(await settle())) { console.log('FAILED settle', url); await browser.close(); process.exit(1) }
  await page.mouse.click(800, 450)
  await compose()
}

const save = async (buf, name) => {
  if (!buf) { console.log(`WARN: no buffer for ${name} (flaky capture)`); return false }
  await sharp(buf).jpeg({ quality: 90 }).toFile(`${OUT}/${name}.jpg`)
  return true
}

// DOF ON
await load(base)
const hasDof = await page.evaluate(() => window.__POST__?.hasDof?.())
console.log('hasDof (ultra):', hasDof)
const onBuf = await shot()
await save(onBuf, 'on_full')

// DOF DEFEAT (inject fighter-softening) — same load
await page.evaluate(() => window.__POST__.dofDefeat(true))
await page.waitForTimeout(500)
const defBuf = await shot()
await save(defBuf, 'defeat_full')
await page.evaluate(() => window.__POST__.dofDefeat(false))

// DOF OFF — reload with ?nodof
await load(base + '&nodof')
const hasDofOff = await page.evaluate(() => window.__POST__?.hasDof?.())
console.log('hasDof (nodof):', hasDofOff)
const offBuf = await shot()
await save(offBuf, 'off_full')

// Difference map ON vs OFF (both nofinalize, no sharpen). Amplify ×4 so faint
// stage defocus is visible; where DOF did nothing (ideally the fighters) stays black.
if (onBuf && offBuf) {
  const onRaw = await sharp(onBuf).removeAlpha().raw().toBuffer()
  const offRaw = await sharp(offBuf).removeAlpha().raw().toBuffer()
  const diff = Buffer.alloc(onRaw.length)
  for (let i = 0; i < onRaw.length; i++) diff[i] = Math.min(255, Math.abs(onRaw[i] - offRaw[i]) * 4)
  await sharp(diff, { raw: { width: W, height: H, channels: 3 } }).jpeg({ quality: 90 }).toFile(`${OUT}/diff_on_vs_off_x4.jpg`)
}

console.log(errors.length ? `console errors:\n  ${[...new Set(errors)].slice(0, 6).join('\n  ')}` : 'no console errors')
console.log('artifacts in', OUT)
await browser.close()
