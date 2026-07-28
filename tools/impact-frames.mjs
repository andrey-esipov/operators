// impact-frames.mjs — full-frame filmstrip across a REAL landed hit, so the
// three impact signals the attacker-crop can't see are all in frame at once:
// the victim's recoil, the hit spark, and any camera kick.
//
// Camera kick is the v8 open question ("no confirmed camera shake on contact").
// The eye can't be trusted on a few-px translation, so this measures it: a band
// of STATIC stage (the top rafters, which never animate) is cross-correlated
// between consecutive frames. If the rafters translate, the camera moved — that
// is a camera kick, in pixels, not a vibe.
//
// Lands a real hit by construction (polls the defender's health dropping, same
// contract as motion-strip --action hit) and refuses to film if none landed.
import { chromium } from 'playwright-core'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import sharp from 'sharp'

const arg = (n, d) => (process.argv.includes(`--${n}`) ? process.argv[process.argv.indexOf(`--${n}`) + 1] : d)
const PORT = arg('port', '5399')
const OUT = arg('out', 'critique/impact-frames')
const FRAMES = Number(arg('frames', '16'))
const QUERY = arg('query', 'a=spiegel&b=lenny&p1=operator&p2=operator&cpu=dummy')
const SHA = execSync('git rev-parse --short HEAD').toString().trim()
const URL = `http://localhost:${PORT}/?${QUERY}`

const browser = await chromium.launch({
  headless: false,
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-angle=metal', '--window-position=4000,4000', '--hide-scrollbars'],
})
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 })
page.on('pageerror', (e) => console.log('  [pageerror]', String(e.message).slice(0, 120)))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const key = async (k, ms = 60) => { await page.keyboard.down(k); await sleep(ms); await page.keyboard.up(k) }

await page.goto(URL, { waitUntil: 'domcontentloaded' })
let stable = 0
for (let i = 0; i < 400 && stable < 15; i++) {
  let ok = false
  try { ok = await page.evaluate(() => !!window.__PLAY__?.ready?.() && window.__PLAY__.state().phase === 'fight') } catch { ok = false }
  stable = ok ? stable + 1 : 0
  await sleep(30)
}
if (stable < 15) { console.log('FAILED: never reached a stable fight'); await browser.close(); process.exit(1) }
if (!(await page.evaluate(() => typeof window.__PLAY__?.step === 'function'))) { console.log('FAILED: no __PLAY__.step'); await browser.close(); process.exit(1) }
await page.mouse.click(800, 450)
await sleep(400)

// Land a real hit: pull the target into point-blank range and briefly stun it
// so it can't drift or jump out during the swing (a dummy sits at spawn range,
// beyond a normal's reach — the same whiff that fooled play-shots), then swing
// heavy until the defender's HP drops, and freeze on that exact frame. Frame 0
// of the strip is contact, by construction. The stun only creates the opening;
// the hit itself is a real move landing through the ordinary path.
const stageInRange = async () => {
  await page.evaluate(() => {
    const s = window.__PLAY__.state()
    const [me, foe] = s.fighters
    foe.pos.x = me.pos.x + (me.facing === 1 ? 130 : -130)
    foe.vel.x = 0
    foe.stunRemaining = 90
    me.stunRemaining = 0
  })
}
await stageInRange()
const hpBefore = await page.evaluate(() => window.__PLAY__.state().fighters[1].health)
let connected = false
for (let swing = 0; swing < 8 && !connected; swing++) {
  await stageInRange()
  await page.keyboard.press('KeyL')
  for (let i = 0; i < 40; i++) {
    const hp = await page.evaluate(() => window.__PLAY__.state().fighters[1].health)
    if (hp < hpBefore) { connected = true; break }
    await sleep(8)
  }
  if (!connected) await key('ArrowRight', 60)
}
if (!connected) { console.log('FAILED: never landed a hit, no contact frame to film'); await browser.close(); process.exit(1) }

await page.evaluate(() => window.__PLAY__.pause())
rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })

// Capture FULL frames across the impact window.
const paths = []
const states = []
for (let f = 0; f < FRAMES; f++) {
  const st = await page.evaluate(() => {
    const s = window.__PLAY__.state()
    return { hitstop: s.hitstop, p2hp: Math.round(s.fighters[1].health), p2st: s.fighters[1].stance, p2x: Math.round(s.fighters[1].pos.x), p1st: s.fighters[0].stance }
  })
  const p = `${OUT}/f${String(f).padStart(3, '0')}.png`
  await page.screenshot({ path: p })
  paths.push(p); states.push(st)
  await page.evaluate(() => window.__PLAY__.step(1))
}

// --- camera kick: cross-correlate a static rafters band between frames -------
// The top ~11% of pre-pmf is roof beams that never animate. Any horizontal or
// vertical shift there is the camera, not a fighter. Measure integer-px shift
// that minimises SAD over a small search window.
async function band(p) {
  const meta = await sharp(p).metadata()
  const top = Math.round(meta.height * 0.02)
  const h = Math.round(meta.height * 0.09)
  const { data, info } = await sharp(p).extract({ left: 0, top, width: meta.width, height: h }).greyscale().raw().toBuffer({ resolveWithObject: true })
  return { data, w: info.width, h: info.height }
}
function bestShift(a, b) {
  const R = 6 // search +/-6px
  let best = { sad: Infinity, dx: 0, dy: 0 }
  const stepX = 2, stepY = 2 // subsample for speed
  for (let dy = -R; dy <= R; dy++) {
    for (let dx = -R; dx <= R; dx++) {
      let sad = 0, n = 0
      for (let y = R; y < a.h - R; y += stepY) {
        for (let x = R; x < a.w - R; x += stepX) {
          const av = a.data[y * a.w + x]
          const bv = b.data[(y + dy) * b.w + (x + dx)]
          sad += Math.abs(av - bv); n++
        }
      }
      sad /= n
      if (sad < best.sad) best = { sad, dx, dy }
    }
  }
  return best
}
const bands = []
for (const p of paths) bands.push(await band(p))
const shifts = []
for (let i = 1; i < bands.length; i++) {
  const s = bestShift(bands[i - 1], bands[i])
  shifts.push({ f: i, dx: s.dx, dy: s.dy, mag: +Math.hypot(s.dx, s.dy).toFixed(2) })
}
const maxMag = Math.max(...shifts.map((s) => s.mag))

console.log(`impact-frames  build ${SHA}  ${FRAMES} full frames from contact`)
console.log('  frame  hitstop  p2hp  p2stance        camShift(px)')
for (let f = 0; f < states.length; f++) {
  const sh = f === 0 ? '' : `dx=${shifts[f - 1].dx} dy=${shifts[f - 1].dy} mag=${shifts[f - 1].mag}`
  console.log(`  f${String(f).padStart(3, '0')}   ${String(states[f].hitstop).padStart(5)}   ${String(states[f].p2hp).padStart(4)}  ${String(states[f].p2st).padEnd(14)} ${sh}`)
}
console.log(`  MAX camera shift across window: ${maxMag.toFixed(2)} px  (static-rafters cross-correlation)`)
console.log(`  ${maxMag < 1.5 ? 'VERDICT: no meaningful camera kick on contact (< 1.5px).' : `camera kicks up to ${maxMag}px on contact.`}`)
writeFileSync(`${OUT}/impact.json`, JSON.stringify({ build: SHA, query: QUERY, states, shifts, maxMag }, null, 2))
await browser.close()
