// Capture the React shell screens (menu / select / ceremony) for visual review.
//
// The shell is DOM, not the WebGL canvas, so none of the ThreeLab settle rules
// apply here — but the ceremony screens are ANIMATIONS, so we drive them through
// window.__game (see src/screens/ceremony/devExpose.ts) and hold a fixed delay
// after the phase flip so a captured frame is reproducible.
//
// Usage: node tools/shell-shots.mjs [--out DIR] [--port 5173]
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'

const args = process.argv.slice(2)
const flag = (name, dflt) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : dflt
}

const OUT = flag('out', 'shell-shots')
const PORT = flag('port', '5173')
const BASE = `http://localhost:${PORT}/`

mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({
  headless: false,
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-angle=metal', '--window-position=4000,4000', '--hide-scrollbars'],
})
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })
page.on('pageerror', (e) => console.log('  [pageerror]', e.message))

const shot = async (name) => {
  await page.screenshot({ path: `${OUT}/${name}.png` })
  console.log(`  wrote ${OUT}/${name}.png`)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

await page.goto(BASE, { waitUntil: 'networkidle' })
await sleep(600)
await shot('00-boot')

// The arcade boot gate wants a real gesture before anything else mounts.
await page.mouse.click(800, 450)
await sleep(2500)
await shot('01-menu')

// Warm the lazy chunks so a phase flip mounts synchronously (devExpose does
// this for ceremony, but character/stage select are separate chunks).
await page.evaluate(async () => {
  await Promise.all([
    import('/src/screens/CharacterSelect.tsx'),
    import('/src/screens/StageSelect.tsx'),
    import('/src/screens/PreFight.tsx'),
    import('/src/screens/RoundEnd.tsx'),
    import('/src/screens/MatchEnd.tsx'),
    import('/src/screens/ArcadeVictory.tsx'),
  ])
})
await sleep(1200)

const setPhase = async (phase, extra = {}) => {
  await page.evaluate(
    ([p, e]) => {
      const g = window.__game
      if (!g) throw new Error('window.__game missing — devExpose did not load')
      g.setState({ phase: p, ...e })
    },
    [phase, extra],
  )
}

await setPhase('character-select', { mode: 'versus' })
await sleep(2200)
await shot('02-character-select')

// Arcade is the default single-player path, and it renders a DIFFERENT select
// layout (the P2 bay collapses and the roster takes the space). Capturing only
// the versus layout left the layout most players see unreviewed.
await setPhase('character-select', { mode: 'arcade', selectedA: null, selectedB: null })
await sleep(2200)
await shot('02b-character-select-arcade')

await setPhase('stage-select', { selectedA: 'lenny', selectedB: 'brian' })
await sleep(2200)
await shot('03-stage-select')

// Ceremony screens through the deterministic harness when present.
const cer = await page.evaluate(() => typeof window.__ceremony)
console.log('  __ceremony:', cer)

for (const [name, kind, opts, holdMs] of [
  ['04-pre-fight', 'pre-fight', {}, 1800],
  ['05-round-end', 'round-end', { winner: 'a', round: 1 }, 1200],
  ['06-match-end', 'match-end', { winner: 'a', perfect: false }, 1400],
  ['07-arcade-victory', 'arcade-victory', { winner: 'a' }, 1400],
  // MatchEnd only renders DEFEATED when mode === 'arcade' (a P2 win in vs mode
  // is a legitimate VICTORY for P2). Without mode:'arcade' this shot silently
  // captured a second VICTORY screen, so the authored defeat framing — the
  // hero/foil flip onto the player's fallen fighter — was never reviewed.
  ['08-match-end-defeat', 'match-end', { winner: 'b', mode: 'arcade' }, 1400],
  ['09-match-end-vs-p2', 'match-end', { winner: 'b' }, 1400],
]) {
  try {
    if (cer === 'object') {
      await page.evaluate(
        async ([k, o]) => {
          await window.__ceremony.reset()
          await window.__ceremony.show(k, o)
        },
        [kind, opts],
      )
    } else {
      await setPhase(kind)
    }
    await sleep(holdMs)
    await shot(name)
  } catch (e) {
    console.log(`  FAILED ${name}: ${e.message}`)
  }
}

await browser.close()
console.log('done')
