// Capture the combat screen — the screen players actually live in, and the one
// nobody has reviewed. Drives a real match through the store (startMatch, then
// real move casts) rather than faking state, so the HUD, the 3D arena and the
// move deck are all showing values the sim actually produced.
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'

const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`)
  return i >= 0 ? process.argv[i + 1] : d
}
const OUT = arg('out', 'review-shots/combat')
const PORT = arg('port', '5173')
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({
  headless: false,
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-angle=metal', '--window-position=4000,4000', '--hide-scrollbars'],
})
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })
page.on('pageerror', (e) => console.log('  [pageerror]', e.message))
page.on('console', (m) => {
  if (m.type() === 'error' && !/audio|\.mp3|favicon/i.test(m.text()))
    console.log('  [console.error]', m.text().slice(0, 160))
})

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const shot = async (n) => {
  await page.screenshot({ path: `${OUT}/${n}.png` })
  console.log(`  wrote ${n}.png`)
}

const QS = arg('qs', '')
await page.goto(`http://localhost:${PORT}/${QS ? '?' + QS : ''}`, { waitUntil: 'networkidle' })
await sleep(600)
await page.mouse.click(800, 450)
await sleep(2500)

await page.evaluate(async () => {
  // MatchEnd pulls in ceremony/devExpose, which is what publishes window.__game.
  await Promise.all([
    import('/src/screens/CombatScreen.tsx'),
    import('/src/screens/MatchEnd.tsx'),
    import('/src/screens/PreFight.tsx'),
  ])
})
await sleep(800)

// Real match, real sim. PreFight cuts to fight on its own timer.
await page.evaluate(() => {
  window.__game.getState().startMatch('chesky', 'doshi', 'hypergrowth')
})
await sleep(6500)
console.log('  phase:', await page.evaluate(() => window.__game.getState().phase))
await shot('01-fight-neutral')

// Cast a move and catch the impact frame plus the settled post-hit HUD.
const cast = async (idx) => {
  const ok = await page.evaluate(async (i) => {
    const { getFighter } = await import('/src/data/fighters.ts')
    const st = window.__game.getState()
    if (st.activeSide !== 'a') return 'not-player-turn'
    const def = getFighter(st.selectedA)
    const rt = st.fighterA
    const playable = def.moves.filter(
      (m) => rt.momentum >= (m.type === 'ultimate' ? Math.min(m.momentum, 5) : m.momentum) &&
        !(m.type === 'ultimate' && rt.superMeter < 100) &&
        (rt.cooldowns[m.id] ?? 0) === 0,
    )
    const m = playable[Math.min(i, playable.length - 1)]
    if (!m) return 'none-playable'
    st.castMove(m)
    return m.name
  }, idx)
  console.log('  cast:', ok)
}

await cast(0)
await sleep(340)
await shot('02-fight-impact')
await sleep(2600)
await shot('03-fight-after-hit')

await cast(2)
await sleep(340)
await shot('04-fight-impact-heavy')
await sleep(2600)
await shot('05-fight-settled')

// Drive to low HP so the danger-state HUD is on screen.
await page.evaluate(() => {
  const s = window.__game.getState()
  window.__game.setState({
    fighterA: { ...s.fighterA, hp: Math.round(s.fighterA.maxHp * 0.14), super: 100 },
    fighterB: { ...s.fighterB, hp: Math.round(s.fighterB.maxHp * 0.22), super: 80 },
  })
})
await sleep(1400)
await shot('06-fight-danger')

await browser.close()
console.log('done')
