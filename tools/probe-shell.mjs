// Same safe-frame audit as probe-overflow.mjs, aimed at the shell screens that
// are NOT driven by the ceremony harness: start screen, main menu, character
// select, stage select. Reports anything whose box escapes the viewport (the
// bug class that put the arcade-victory CTAs below an unscrollable fold), plus
// any visible text still rendering in a default system UI face, which is the
// single loudest "this is a web page" tell on an arcade shell.
import { chromium } from 'playwright-core'

const PORT = process.argv.includes('--port')
  ? process.argv[process.argv.indexOf('--port') + 1]
  : '5173'
const BASE = `http://localhost:${PORT}/`

const VIEWPORTS = [
  { width: 1366, height: 768 },
  { width: 1600, height: 900 },
  { width: 1920, height: 1080 },
]

// Faces the project actually authors with. Anything else on visible text is a
// fallback that leaked through.
const AUTHORED = ['press start', 'anton', 'oswald', 'barlow', 'vt323', 'silkscreen', 'chakra']

const browser = await chromium.launch({
  headless: false,
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-angle=metal', '--window-position=4000,4000', '--hide-scrollbars'],
})

const audit = async (page, label) => {
  const r = await page.evaluate(
    ([authored]) => {
      const vw = window.innerWidth
      const vh = window.innerHeight
      const over = []
      const sysFont = []
      for (const el of document.querySelectorAll('body *')) {
        const b = el.getBoundingClientRect()
        const cs = getComputedStyle(el)
        if (cs.visibility === 'hidden' || cs.opacity === '0') continue
        const own = [...el.childNodes]
          .filter((n) => n.nodeType === 3)
          .map((n) => n.textContent.trim())
          .join(' ')
          .trim()
        if (b.width >= 4 && b.height >= 4 && own) {
          if (b.top < -2 || b.bottom > vh + 2 || b.left < -2 || b.right > vw + 2) {
            over.push({
              cls: (el.className || '').toString().slice(0, 46),
              text: own.slice(0, 40),
              t: Math.round(b.top), bt: Math.round(b.bottom),
              l: Math.round(b.left), r: Math.round(b.right),
            })
          }
        }
        if (!own || own.length < 2) continue
        const fam = cs.fontFamily.toLowerCase()
        const first = fam.split(',')[0].replace(/["']/g, '').trim()
        if (!authored.some((a) => fam.includes(a))) {
          sysFont.push({
            face: first,
            size: cs.fontSize,
            text: own.slice(0, 46),
            cls: (el.className || '').toString().slice(0, 40),
          })
        }
      }
      return { over: over.slice(0, 10), sysFont: sysFont.slice(0, 10), vw, vh }
    },
    [AUTHORED],
  )
  console.log(`\n--- ${label} (${r.vw}x${r.vh})`)
  if (!r.over.length) console.log('  fit: OK')
  for (const o of r.over)
    console.log(`  ESCAPES t=${o.t} b=${o.bt} l=${o.l} r=${o.r} [${o.cls}] "${o.text}"`)
  if (!r.sysFont.length) console.log('  fonts: all authored')
  for (const f of r.sysFont)
    console.log(`  SYSTEM-FONT ${f.face} @${f.size} [${f.cls}] "${f.text}"`)
}

for (const vp of VIEWPORTS) {
  const page = await browser.newPage({ viewport: vp })
  page.on('pageerror', (e) => console.log('  [pageerror]', e.message))
  console.log(`\n########## ${vp.width}x${vp.height} ##########`)
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await new Promise((r) => setTimeout(r, 700))
  await audit(page, 'start-screen')

  await page.mouse.click(vp.width / 2, vp.height / 2)
  await new Promise((r) => setTimeout(r, 2600))
  await audit(page, 'attract/menu')

  await page.evaluate(async () => {
    await Promise.all([
      import('/src/screens/CharacterSelect.tsx'),
      import('/src/screens/StageSelect.tsx'),
      import('/src/screens/PreFight.tsx'),
    ])
  })
  await new Promise((r) => setTimeout(r, 900))

  for (const [phase, extra, label] of [
    ['menu', {}, 'main-menu'],
    ['character-select', {}, 'character-select'],
    ['stage-select', { selectedA: 'chesky', selectedB: 'doshi' }, 'stage-select'],
  ]) {
    await page.evaluate(
      ([p, e]) => window.__game.setState({ phase: p, ...e }),
      [phase, extra],
    )
    await new Promise((r) => setTimeout(r, 1800))
    await audit(page, label)
  }
  await page.close()
}

await browser.close()
