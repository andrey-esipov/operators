// Diagnose ceremony/menu screen overflow: is authored content being clipped
// outside the viewport? Reports scroll extent plus every element whose box
// escapes the viewport on any edge.
import { chromium } from 'playwright-core'

const PORT = process.argv.includes('--port')
  ? process.argv[process.argv.indexOf('--port') + 1]
  : '5173'
const BASE = `http://localhost:${PORT}/`

const browser = await chromium.launch({
  headless: false,
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-angle=metal', '--window-position=4000,4000', '--hide-scrollbars'],
})
const VIEWPORTS = [
  { width: 1366, height: 768 },
  { width: 1600, height: 900 },
  { width: 1920, height: 1080 },
]

for (const vp of VIEWPORTS) {
const page = await browser.newPage({ viewport: vp })
page.on('pageerror', (e) => console.log('  [pageerror]', e.message))
console.log(`\n########## VIEWPORT ${vp.width}x${vp.height} ##########`)

await page.goto(BASE, { waitUntil: 'networkidle' })
await new Promise((r) => setTimeout(r, 600))
await page.mouse.click(800, 450)
await new Promise((r) => setTimeout(r, 2500))

await page.evaluate(async () => {
  await Promise.all([
    import('/src/screens/PreFight.tsx'),
    import('/src/screens/RoundEnd.tsx'),
    import('/src/screens/MatchEnd.tsx'),
    import('/src/screens/ArcadeVictory.tsx'),
  ])
})

const probe = async (kind, opts, waitMs) => {
  await page.evaluate(
    async ([k, o]) => {
      await window.__ceremony.reset()
      await window.__ceremony.show(k, o)
    },
    [kind, opts],
  )
  await new Promise((r) => setTimeout(r, waitMs))
  const r = await page.evaluate(() => {
    const de = document.documentElement
    const vw = window.innerWidth
    const vh = window.innerHeight
    const over = []
    for (const el of document.querySelectorAll('body *')) {
      const b = el.getBoundingClientRect()
      if (b.width < 4 || b.height < 4) continue
      const cs = getComputedStyle(el)
      if (cs.visibility === 'hidden' || cs.opacity === '0') continue
      const escTop = b.top < -2
      const escBottom = b.bottom > vh + 2
      const escLeft = b.left < -2
      const escRight = b.right > vw + 2
      if (!(escTop || escBottom || escLeft || escRight)) continue
      // Only report leaves / text-bearing nodes so we don't list every wrapper.
      const text = (el.textContent || '').trim().slice(0, 44)
      if (!text) continue
      over.push({
        tag: el.tagName,
        cls: (el.className || '').toString().slice(0, 52),
        text,
        top: Math.round(b.top),
        bottom: Math.round(b.bottom),
        left: Math.round(b.left),
        right: Math.round(b.right),
      })
    }
    return {
      phase: window.__game?.getState().phase,
      scrollH: de.scrollHeight,
      scrollW: de.scrollWidth,
      vw,
      vh,
      over: over.slice(0, 14),
    }
  })
  console.log(`\n=== ${kind} @${waitMs}ms — phase=${r.phase} scroll=${r.scrollW}x${r.scrollH} vp=${r.vw}x${r.vh}`)
  for (const o of r.over) {
    console.log(
      `  ESCAPES  t=${o.top} b=${o.bottom} l=${o.left} r=${o.right}  <${o.tag}.${o.cls}> "${o.text}"`,
    )
  }
  if (!r.over.length) console.log('  (nothing escapes the viewport)')
}

await probe('pre-fight', {}, 1800)
await probe('round-end', { winner: 'a', round: 1 }, 1200)
await probe('match-end', { winner: 'a' }, 1400)
await probe('arcade-victory', { winner: 'a' }, 1400)
await page.close()
}

await browser.close()
