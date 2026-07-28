// How hard is the default CPU, measured rather than felt?
//
// A fighting game is judged on whether it is good to *play*, and nothing in
// this project has ever measured the player's side of that. The first real
// capture showed the human fighter knocked down within 420ms of the first
// input and a round lost in about two seconds.
//
// Three differential conditions over the same wall-clock window, same seed of
// behaviour, so the numbers mean something relative to each other:
//   idle   — no input at all (the floor: how fast does the CPU kill a statue?)
//   block  — hold back (what a defensive beginner does)
//   mash   — walk forward and press buttons (what an actual beginner does)
import { chromium } from 'playwright-core'

const PORT = process.argv.includes('--port')
  ? process.argv[process.argv.indexOf('--port') + 1]
  : '5399'
const WINDOW_MS = 12000

const browser = await chromium.launch({
  headless: false,
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-angle=metal', '--window-position=4000,4000', '--hide-scrollbars'],
})

async function run(label, drive) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' })
  const overlay = await page.evaluate(
    () => !!document.querySelector('vite-error-overlay'),
  )
  if (overlay) throw new Error('vite error overlay is covering the page')

  let stable = 0
  for (let i = 0; i < 400 && stable < 15; i++) {
    let ok = false
    try {
      ok = await page.evaluate(
        () => !!window.__PLAY__?.ready?.() && window.__PLAY__.state().phase === 'fight',
      )
    } catch {
      ok = false
    }
    stable = ok ? stable + 1 : 0
    await page.waitForTimeout(30)
  }
  if (stable < 15) throw new Error(`${label}: never reached a stable fight`)
  await page.mouse.click(640, 360)

  // Track rounds: health resets on a round boundary, so accumulate damage taken
  // rather than reading final health, which would under-report a player who
  // already lost a round inside the window.
  const start = Date.now()
  let prev = await page.evaluate(() => window.__PLAY__.state().fighters.map((f) => f.health))
  let takenP1 = 0
  let dealtP2 = 0
  let rounds = 0
  const poll = setInterval(async () => {
    try {
      const cur = await page.evaluate(() =>
        window.__PLAY__.state().fighters.map((f) => f.health),
      )
      if (cur[0] > prev[0] + 1 || cur[1] > prev[1] + 1) rounds++
      else {
        takenP1 += Math.max(0, prev[0] - cur[0])
        dealtP2 += Math.max(0, prev[1] - cur[1])
      }
      prev = cur
    } catch {
      /* transient teardown */
    }
  }, 60)

  await drive(page, start)
  await new Promise((r) => setTimeout(r, Math.max(0, WINDOW_MS - (Date.now() - start))))
  clearInterval(poll)
  await new Promise((r) => setTimeout(r, 120))

  const max = await page.evaluate(() => window.__PLAY__.state().fighters.map((f) => f.maxHealth ?? 1000))
  await page.close()
  return { label, takenP1, dealtP2, rounds, maxP1: max[0], maxP2: max[1] }
}

const results = []
results.push(await run('idle  (no input)', async () => {}))

results.push(
  await run('block (hold back)', async (page, start) => {
    await page.keyboard.down('ArrowLeft')
    while (Date.now() - start < WINDOW_MS) await page.waitForTimeout(100)
    await page.keyboard.up('ArrowLeft')
  }),
)

results.push(
  await run('mash  (walk + buttons)', async (page, start) => {
    const btns = ['j', 'k', 'l', 'u', 'i']
    let n = 0
    while (Date.now() - start < WINDOW_MS) {
      await page.keyboard.down('ArrowRight')
      await page.waitForTimeout(160)
      await page.keyboard.up('ArrowRight')
      const b = btns[n++ % btns.length]
      await page.keyboard.down(b)
      await page.waitForTimeout(50)
      await page.keyboard.up(b)
      await page.waitForTimeout(90)
    }
  }),
)

console.log(`\n  ${WINDOW_MS / 1000}s window, default CPU, player is p1\n`)
console.log('  condition                dmg taken   dmg dealt   ratio    rounds lost')
for (const r of results) {
  const ratio = r.dealtP2 > 0 ? (r.takenP1 / r.dealtP2).toFixed(1) + 'x' : '—'
  console.log(
    `  ${r.label.padEnd(24)} ${String(Math.round(r.takenP1)).padStart(6)}      ` +
      `${String(Math.round(r.dealtP2)).padStart(6)}   ${ratio.padStart(6)}    ${r.rounds}`,
  )
}
console.log(`\n  (p1 max health ${results[0].maxP1}, p2 max health ${results[0].maxP2})`)

await browser.close()
