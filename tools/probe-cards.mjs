// Bespoke acceptance probe for the move-select rail (MoveCard).
// Drives a real match, then asserts on the LIVE combat rail:
//   1. Every visible text node in the rail renders at >= 12px computed size.
//   2. The damage NUMBER is strictly larger than the "DMG" label.
//   3. No card element escapes the viewport at 1366x768, 1600x900, 1920x1080.
//   4. No rail element resolves to a system-default font family.
// Run from the repo root: node tools/probe-cards.mjs --port 5311
import { chromium } from 'playwright-core'
console.error('\u26A0\uFE0F  [instrument-routing] tools/probe-cards.mjs drives the LEGACY CARD BATTLER combat UI (__game turn-based rail / .combat-turn-prompt), NOT the shipped fighter. Its numbers are INADMISSIBLE as shipped-fighter evidence. Provenance: tools/instrument-manifest.json.')

const PORT = process.argv.includes('--port')
  ? process.argv[process.argv.indexOf('--port') + 1]
  : '5311'
const BASE = `http://localhost:${PORT}/`

const VIEWPORTS = [
  { width: 1366, height: 768 },
  { width: 1600, height: 900 },
  { width: 1920, height: 1080 },
]

// Fonts we authored. Anything resolving to one of these is fine.
const ALLOWED_FONTS = ['press start 2p', 'vt323', 'courier new', 'monospace']
const SYSTEM_FONTS = ['system-ui', '-apple-system', 'inter', 'roboto', 'segoe', 'arial', 'helvetica', 'sans-serif']

const browser = await chromium.launch({
  headless: false,
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-angle=metal', '--window-position=4000,4000', '--hide-scrollbars'],
})

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let failures = 0
const fail = (m) => { failures++; console.log('  \u274c ' + m) }
const pass = (m) => console.log('  \u2705 ' + m)

for (const vp of VIEWPORTS) {
  const page = await browser.newPage({ viewport: vp })
  page.on('pageerror', (e) => console.log('  [pageerror]', e.message))
  console.log(`\n########## VIEWPORT ${vp.width}x${vp.height} ##########`)

  await page.goto(BASE, { waitUntil: 'networkidle' })
  await sleep(600)
  await page.mouse.click(Math.round(vp.width / 2), Math.round(vp.height / 2))
  await sleep(2500)
  await page.evaluate(async () => {
    await Promise.all([
      import('/src/screens/CombatScreen.tsx'),
      import('/src/screens/MatchEnd.tsx'),
      import('/src/screens/PreFight.tsx'),
    ])
  })
  await sleep(700)
  await page.evaluate(() => {
    window.__game.getState().startMatch('chesky', 'doshi', 'hypergrowth')
  })
  await sleep(6500)

  const r = await page.evaluate(({ vw, vh }) => {
    const cards = [...document.querySelectorAll('[data-move-card]')]
    const out = { nCards: cards.length, texts: [], overflow: [], fonts: [], dmgPairs: [] }
    const hasText = (el) =>
      [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length)
    for (const card of cards) {
      const b0 = card.getBoundingClientRect()
      if (b0.right > vw + 1 || b0.left < -1 || b0.bottom > vh + 1 || b0.top < -1) {
        out.overflow.push({ tag: card.getAttribute('data-move-card'), rect: [b0.left, b0.top, b0.right, b0.bottom] })
      }
      for (const el of card.querySelectorAll('*')) {
        const cs = getComputedStyle(el)
        if (cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) === 0) continue
        const b = el.getBoundingClientRect()
        if (b.width < 1 || b.height < 1) continue
        if (hasText(el)) {
          const fs = parseFloat(cs.fontSize)
          const label = (el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : el.tagName) +
            ' "' + el.textContent.trim().slice(0, 22) + '"'
          out.texts.push({ fs, label, family: cs.fontFamily })
          out.fonts.push({ family: cs.fontFamily.toLowerCase(), label })
        }
      }
      // damage number vs label
      const num = card.querySelector('[data-dmg-num]')
      const lab = card.querySelector('[data-dmg-label]')
      if (num && lab) {
        out.dmgPairs.push({
          num: parseFloat(getComputedStyle(num).fontSize),
          label: parseFloat(getComputedStyle(lab).fontSize),
          card: card.getAttribute('data-move-card'),
        })
      }
    }
    return out
  }, { vw: vp.width, vh: vp.height })

  if (r.nCards === 0) { fail(`no [data-move-card] elements found`); await page.close(); continue }
  pass(`found ${r.nCards} cards`)

  // 1. min font size
  const minText = r.texts.reduce((a, b) => (b.fs < a.fs ? b : a), r.texts[0])
  console.log(`  min font-size = ${minText.fs}px on ${minText.label}`)
  if (minText.fs >= 12) pass(`all ${r.texts.length} rail text nodes >= 12px`)
  else fail(`text below 12px: ${minText.fs}px on ${minText.label}`)

  // 2. dmg number > label
  let dmgOk = r.dmgPairs.length > 0
  for (const d of r.dmgPairs) {
    if (!(d.num > d.label)) { dmgOk = false; fail(`dmg number ${d.num}px not > label ${d.label}px on ${d.card}`) }
  }
  if (dmgOk) pass(`damage number > label on all ${r.dmgPairs.length} cards (e.g. ${r.dmgPairs[0].num}px > ${r.dmgPairs[0].label}px)`)
  else if (r.dmgPairs.length === 0) fail('no [data-dmg-num]/[data-dmg-label] pairs found')

  // 3. overflow
  if (r.overflow.length === 0) pass('no card escapes viewport')
  else r.overflow.forEach((o) => fail(`card ${o.tag} escapes viewport: ${o.rect.map((n) => Math.round(n)).join(',')}`))

  // 4. fonts
  const bad = r.fonts.filter((f) => SYSTEM_FONTS.some((s) => f.family.includes(s)) && !ALLOWED_FONTS.some((a) => f.family.includes(a)))
  if (bad.length === 0) pass('no system-default fonts in rail')
  else bad.forEach((f) => fail(`system font "${f.family}" on ${f.label}`))

  await page.close()
}

await browser.close()
console.log(`\n${failures === 0 ? '\u2705 ALL GATES PASS' : '\u274c ' + failures + ' FAILURE(S)'}`)
process.exit(failures === 0 ? 0 : 1)
