// Bespoke HUD acceptance probe. Drives a real match, then measures the live
// combat HUD against objective gates:
//   1. every visible HUD text node >= 11px; game-state text (timer, names,
//      HP numbers, turn prompt, DANGER) >= 14px.
//   2. no HUD element escapes the viewport at 1366x768, 1600x900, 1920x1080.
//   3. no visible HUD text resolves to a system-default / unloaded font
//      (i.e. its first font-family must actually be loaded per document.fonts).
//
// Scope: the WebGL FightHud (.fight-hud, styled by hud.css) plus the combat
// turn prompt owned by CombatScreen. The MoveCard deck is owned by another
// agent and is intentionally excluded.
import { chromium } from 'playwright-core'

const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`)
  return i >= 0 ? process.argv[i + 1] : d
}
const PORT = arg('port', '5310')

const SYSTEM_FONTS = new Set([
  'system-ui', '-apple-system', 'blinkmacsystemfont', 'segoe ui', 'roboto',
  'helvetica', 'helvetica neue', 'arial', 'arial narrow', 'sans-serif',
  'serif', 'ui-sans-serif', 'ui-serif', 'ui-monospace', 'monospace',
  'chakra petch', 'saira', // declared in hud.css but NOT loaded in this app
])

const browser = await chromium.launch({
  headless: false,
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-angle=metal', '--window-position=4000,4000', '--hide-scrollbars'],
})
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' })
await sleep(600)
await page.mouse.click(800, 450)
await sleep(1800)
await page.evaluate(async () => {
  await Promise.all([
    import('/src/screens/CombatScreen.tsx'),
    import('/src/screens/MatchEnd.tsx'),
    import('/src/screens/PreFight.tsx'),
  ])
})
await sleep(600)
await page.evaluate(() => window.__game.getState().startMatch('chesky', 'doshi', 'hypergrowth'))
await sleep(6500)
// Drive both fighters low so the DANGER badge is on screen and measured too.
await page.evaluate(() => {
  const s = window.__game.getState()
  window.__game.setState({
    fighterA: { ...s.fighterA, hp: Math.round(s.fighterA.maxHp * 0.14), superMeter: 100 },
    fighterB: { ...s.fighterB, hp: Math.round(s.fighterB.maxHp * 0.2), superMeter: 100 },
  })
})
await sleep(900)

// Ensure the fonts the HUD asks for are actually settled before we measure.
await page.evaluate(() => document.fonts.ready)

const collect = () => page.evaluate((SYS) => {
  const sysSet = new Set(SYS)
  const STATE_RE = /\bfh-timer\b|\bn\b|combat-turn-prompt|\bfh-hp-num\b/
  // Roots we own / control.
  const roots = [
    ...document.querySelectorAll('.fight-hud'),
    ...document.querySelectorAll('.combat-turn-prompt'),
  ]
  const seen = new Set()
  const out = []
  const vw = window.innerWidth, vh = window.innerHeight
  for (const root of roots) {
    const all = root.matches('.combat-turn-prompt') ? [root] : root.querySelectorAll('*')
    for (const el of all) {
      if (seen.has(el)) continue
      seen.add(el)
      // Only elements whose OWN text (not a child's) is rendered.
      const ownText = Array.from(el.childNodes)
        .filter((n) => n.nodeType === 3)
        .map((n) => n.textContent.trim())
        .join('')
      if (!ownText) continue
      const cs = getComputedStyle(el)
      if (cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) === 0) continue
      const r = el.getBoundingClientRect()
      if (r.width < 0.5 || r.height < 0.5) continue
      const fontSize = parseFloat(cs.fontSize)
      const first = cs.fontFamily.split(',')[0].trim().replace(/^["']|["']$/g, '')
      const firstLc = first.toLowerCase()
      const loaded = document.fonts.check(`${Math.round(fontSize)}px "${first}"`)
      const cls = typeof el.className === 'string' ? el.className : ''
      out.push({
        tag: el.tagName.toLowerCase(),
        cls: cls.slice(0, 60),
        text: ownText.slice(0, 30),
        fontSize: Math.round(fontSize * 10) / 10,
        first,
        systemFont: sysSet.has(firstLc),
        fontLoaded: loaded,
        isState: STATE_RE.test(cls),
        rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
        offscreen: r.left < -1 || r.top < -1 || r.right > vw + 1 || r.bottom > vh + 1,
        vw, vh,
      })
    }
  }
  return out
}, [...SYSTEM_FONTS])

const resolutions = [
  { w: 1366, h: 768 },
  { w: 1600, h: 900 },
  { w: 1920, h: 1080 },
]

const failures = []
let totalNodes = 0
for (const res of resolutions) {
  await page.setViewportSize({ width: res.w, height: res.h })
  await sleep(700)
  await page.evaluate(() => document.fonts.ready)
  const nodes = await collect()
  totalNodes += nodes.length
  console.log(`\n=== ${res.w}x${res.h} — ${nodes.length} HUD text nodes ===`)
  for (const n of nodes) {
    const flags = []
    if (n.fontSize < 11) flags.push(`SIZE<11 (${n.fontSize}px)`)
    if (n.isState && n.fontSize < 14) flags.push(`STATE<14 (${n.fontSize}px)`)
    if (n.systemFont) flags.push(`SYSTEM-FONT (${n.first})`)
    if (!n.fontLoaded) flags.push(`FONT-NOT-LOADED (${n.first})`)
    if (n.offscreen) flags.push(`OFFSCREEN rect=${JSON.stringify(n.rect)} vp=${n.vw}x${n.vh}`)
    const line = `  "${n.text}" [${n.cls || n.tag}] ${n.fontSize}px ${n.first}`
    if (flags.length) {
      failures.push(`${res.w}x${res.h} ${line} -> ${flags.join(', ')}`)
      console.log(`  ✗ ${line} -> ${flags.join(', ')}`)
    } else {
      console.log(`  ✓ ${line}`)
    }
  }
}

await browser.close()

console.log(`\n=========================================`)
console.log(`Measured ${totalNodes} HUD text nodes across ${resolutions.length} resolutions.`)
if (failures.length) {
  console.log(`\n❌ ${failures.length} FAILURES:`)
  for (const f of failures) console.log(`  - ${f}`)
  process.exit(1)
} else {
  console.log(`\n✅ ALL GATES PASSED (min font-size, state font-size, viewport containment, no system/unloaded fonts).`)
  process.exit(0)
}
