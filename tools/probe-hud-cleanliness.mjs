// Guards the two HUD "debug tells" the critic flagged and I just fixed, so they
// can't silently regress:
//   1. No numeric HP readout printed over the health bars (no shipped fighter
//      shows one). We assert no digit renders anywhere inside .fhud-hpwrap.
//   2. The health fill is a *shaded* bar, not flat debug paint. We assert the
//      computed fill background is a multi-stop gradient.
//
// Per this repo's anti-lying rule every assertion is proven able to fail: after
// the real checks pass we MUTATE the live DOM/CSS to reintroduce each tell and
// confirm the same assertion goes red, then confirm the un-mutated page is
// green. An assertion that can't fail is worthless here.
import { chromium } from 'playwright-core'

const URL = 'http://localhost:5399/'
const browser = await chromium.launch({
  headless: false,
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-angle=metal', '--window-position=4000,4000', '--hide-scrollbars'],
})
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })

let failures = 0
const check = (name, pass) => {
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}`)
  if (!pass) failures++
}

await page.goto(URL, { waitUntil: 'load' })
// Wait for the HUD to actually mount (StrictMode double-mount guard).
let stable = 0
for (let i = 0; i < 400 && stable < 12; i++) {
  const ok = await page
    .evaluate(() => document.querySelectorAll('.fhud-hpwrap').length >= 2 && !!document.querySelector('.fhud-hpfill'))
    .catch(() => false)
  stable = ok ? stable + 1 : 0
  await page.waitForTimeout(30)
}
if (stable < 12) {
  console.error('HUD never mounted on the default route')
  await browser.close()
  process.exit(1)
}

// Read the two facts from the live DOM.
const read = () =>
  page.evaluate(() => {
    const wraps = [...document.querySelectorAll('.fhud-hpwrap')]
    // Digit anywhere inside a health wrap = a numeric HP readout regressed.
    const hpDigits = wraps.some((w) => /\d/.test(w.textContent || ''))
    const fill = document.querySelector('.fhud-hpfill')
    const bg = fill ? getComputedStyle(fill).backgroundImage : ''
    const stops = (bg.match(/rgb/g) || []).length
    return { hpDigits, isGradient: /gradient/.test(bg), stops, bg: bg.slice(0, 60) }
  })

// ── Real assertions ──────────────────────────────────────────────────────
let r = await read()
check('no numeric HP readout inside the health bars', r.hpDigits === false)
check('health fill is a shaded gradient (not flat paint)', r.isGradient === true)
check('health fill gradient has depth (>= 3 colour stops)', r.stops >= 3)

// ── Prove-can-fail #1: reintroduce a numeric HP readout ──────────────────
await page.evaluate(() => {
  const track = document.querySelector('.fhud-hptrack')
  const n = document.createElement('span')
  n.id = '__probe_hpnum__'
  n.textContent = '1000'
  track?.appendChild(n)
})
let m = await read()
check('MUTATION: injecting an HP number makes the digit check fail', m.hpDigits === true)
await page.evaluate(() => document.getElementById('__probe_hpnum__')?.remove())

// ── Prove-can-fail #2: flatten the fill to solid debug paint ─────────────
await page.evaluate(() => {
  const el = document.querySelector('.fhud-hpfill')
  if (el) el.style.background = '#22c55e'
})
let f = await read()
check('MUTATION: flattening the fill makes the gradient check fail', f.isGradient === false)

// ── Confirm the un-mutated page is still green ───────────────────────────
await page.evaluate(() => {
  const el = document.querySelector('.fhud-hpfill')
  if (el) el.style.background = ''
})
let after = await read()
check('post-mutation: real page still clean (no digits, gradient present)', after.hpDigits === false && after.isGradient === true)

// ── Super gauge must have a *charged* state, not look identical empty vs full ─
// The critic's note: a super gauge whose whole job is telegraphing "spendable
// now" looked the same charged or not. We assert the charging fill is a shaded
// gradient, and that flipping a stock to .full visibly changes its fill — the
// falsifiable part: delete the `.full .fhud-superfill` rule and this goes red.
const readSuper = () =>
  page.evaluate(() => {
    const bar = document.querySelector('.fhud-superbar')
    const fill = bar?.querySelector('.fhud-superfill')
    const row = document.querySelector('.fhud-superrow')
    const bg = fill ? getComputedStyle(fill).backgroundImage : ''
    return {
      chargingIsGradient: /gradient/.test(bg),
      chargingBg: bg,
      hasCharged: !!(bar && row),
    }
  })
let sp = await readSuper()
check('super gauge charging fill is a shaded gradient', sp.chargingIsGradient === true)

// Flip a stock to .full (and the row to .charged) and confirm the look changes.
const fullBg = await page.evaluate(() => {
  const bar = document.querySelector('.fhud-superbar')
  const row = document.querySelector('.fhud-superrow')
  bar?.classList.add('full')
  row?.classList.add('charged')
  const fill = bar?.querySelector('.fhud-superfill')
  const bg = fill ? getComputedStyle(fill).backgroundImage : ''
  const rdy = row ? getComputedStyle(row.querySelector('.fhud-superlabel-rdy')).opacity : '0'
  bar?.classList.remove('full')
  row?.classList.remove('charged')
  return { bg, rdy }
})
check('MUTATION: a charged (.full) stock renders a different fill than charging', fullBg.bg !== sp.chargingBg)
check('MUTATION: charged row reveals the READY label (opacity > 0)', parseFloat(fullBg.rdy) > 0)

// ── Health fill is a horizontal hue *ramp*, not a flat hue ────────────────
// The critic's finding: a single flat hue (at any saturation) reads as a UI
// control; a yellow→orange ramp across the bar reads as a gauge. A vertical
// gradient of one hue family would satisfy the "is a gradient" checks above
// while still being the flat programmer-green tell — so guard the ramp itself:
// the gradient must run horizontally and its stops must span a real hue range.
const rampInfo = () =>
  page.evaluate(() => {
    const toHue = (r, g, b) => {
      r /= 255; g /= 255; b /= 255
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn
      if (d === 0) return 0
      let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4
      h *= 60
      return h < 0 ? h + 360 : h
    }
    const fill = document.querySelector('.fhud-hpfill')
    const bg = fill ? getComputedStyle(fill).backgroundImage : ''
    const stops = [...bg.matchAll(/rgba?\(([^)]+)\)/g)].map((m) => m[1].split(',').slice(0, 3).map(Number))
    const hues = stops.map(([r, g, b]) => toHue(r, g, b))
    const spread = hues.length ? Math.max(...hues) - Math.min(...hues) : 0
    const horizontal = /(^|[\s(])(90deg|270deg|to right|to left)/.test(bg)
    return { spread, horizontal }
  })
let ramp = await rampInfo()
check('health fill runs a horizontal ramp (gradient is 90/270deg)', ramp.horizontal === true)
check('health fill spans a real hue range (yellow→orange, not a flat hue)', ramp.spread > 12)

// Prove-can-fail: replace the fill with the old flat programmer-green look — a
// vertical single-hue-family gradient. Both the horizontal and hue-spread
// assertions must go red.
await page.evaluate(() => {
  const el = document.querySelector('.fhud-hpfill')
  if (el) el.style.background = 'linear-gradient(180deg, #9acb2a 0%, #6a7d18 100%)'
})
let flatHue = await rampInfo()
check('MUTATION: a flat-hue vertical fill fails the ramp check', !(flatHue.horizontal && flatHue.spread > 12))
await page.evaluate(() => {
  const el = document.querySelector('.fhud-hpfill')
  if (el) el.style.background = ''
})

await browser.close()
console.log(failures ? `\n=== ${failures} FAILED ===` : '\n=== ALL PASS ===')
process.exit(failures ? 1 : 0)
