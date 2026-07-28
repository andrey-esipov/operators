// Settle "are the portraits real or letter badges?" at the DOM level on the
// REAL mount. The default route ('/') is PlayableMatch with chesky vs lenny,
// both of which ship atlases, so the HUD must resolve real portraits — not the
// initial-letter badge. Read straight from the rendered DOM (which testid is
// present, and the <img> src), never inferred from a tool exit code.
//
//   node tools/probe-portraits.mjs [baseUrl]
//
// Also checks the atlas-less fallback still works: a fighter with no atlas
// (?a=reid) must degrade to the letter badge, so the loading tile never sticks.
import { chromium } from 'playwright-core'

const base = process.argv[2] || 'http://localhost:5399'
const browser = await chromium.launch({
  headless: false,
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-angle=metal', '--window-position=4000,4000', '--hide-scrollbars'],
})
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })

async function read(url) {
  await page.goto(url, { waitUntil: 'load' })
  await page.waitForTimeout(4500) // let the atlas fetch resolve
  return page.evaluate(() => {
    const q = (s) => document.querySelector(`[data-testid=${s}]`)
    const cls = (side) => {
      const port = q(`fhud-portrait-${side}`)
      const badge = q(`fhud-badge-${side}`)
      if (port && !port.dataset.loading && port.querySelector('img')) return 'portrait'
      if (port && port.dataset.loading) return 'loading'
      if (badge) return `badge(${badge.textContent.trim()})`
      return 'none'
    }
    const img = (side) => q(`fhud-portrait-${side}`)?.querySelector('img')?.getAttribute('src') || null
    return { a: cls('a'), b: cls('b'), imgA: img('a'), imgB: img('b') }
  })
}

// 1) Default route: both fighters ship atlases → both must be real portraits.
const def = await read(`${base}/`)
console.log('default /       →', JSON.stringify(def))
// 2) Atlas-less fighter on side A → letter badge; chesky on B → portrait.
const fb = await read(`${base}/?play=1&a=reid&b=chesky`)
console.log('?a=reid&b=chesky →', JSON.stringify(fb))

const checks = [
  ['default: side A is a real portrait', def.a === 'portrait'],
  ['default: side B is a real portrait', def.b === 'portrait'],
  ['default: side A img is an atlas', /\/fighters\/.+\/atlas\.png/.test(def.imgA || '')],
  ['default: side B img is an atlas', /\/fighters\/.+\/atlas\.png/.test(def.imgB || '')],
  ['atlas-less fighter falls back to a letter badge', /^badge\(/.test(fb.a)],
  ['atlas fighter still a portrait alongside it', fb.b === 'portrait'],
]
let fails = 0
for (const [name, ok] of checks) {
  if (!ok) fails++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
}
console.log(fails ? `=== ${fails} FAILURE(S) ===` : '=== ALL PASS ===')
await browser.close()
process.exit(fails ? 1 : 0)
