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
// Pin the tier explicitly. The route's own default is deliberately the easiest
// CPU (a first-time player's first match), but a difficulty measurement whose
// baseline can shift under it when that default changes is worthless for
// before/after comparison — which is the only thing this tool is for.
const CPU = process.argv.includes('--cpu')
  ? process.argv[process.argv.indexOf('--cpu') + 1]
  : 'medium'
// This tool is wall-clock driven, so a single run swings hard — combat-engine
// measured the mash ratio moving between roughly 0.6x and 3x across repeats of
// an unchanged build. A single number here has repeatedly looked like a result
// when it was noise, so the default is an aggregate and the spread is always
// printed next to it.
const RUNS = process.argv.includes('--runs')
  ? Math.max(1, Number(process.argv[process.argv.indexOf('--runs') + 1]))
  : 5
const URL = `http://localhost:${PORT}/?cpu=${CPU}`

const browser = await chromium.launch({
  headless: false,
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-angle=metal', '--window-position=4000,4000', '--hide-scrollbars'],
})

async function run(label, drive) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  await page.goto(URL, { waitUntil: 'domcontentloaded' })
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

const CONDITIONS = [
  ['idle  (no input)', async () => {}],
  [
    'block (hold back)',
    async (page, start) => {
      await page.keyboard.down('ArrowLeft')
      while (Date.now() - start < WINDOW_MS) await page.waitForTimeout(100)
      await page.keyboard.up('ArrowLeft')
    },
  ],
  [
    'mash  (walk + buttons)',
    async (page, start) => {
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
    },
  ],
]

// Five agents edit this repo concurrently, so vite tears the page down mid-run
// routinely. That surfaced as `Cannot read properties of undefined (reading
// 'state')` and lost a whole measurement pass. A reload isn't a result, it's a
// retry.
async function runResilient(label, drive) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      return await run(label, drive)
    } catch (e) {
      const msg = String(e)
      const transient = /undefined|destroyed|Target closed|never reached/.test(msg)
      if (!transient || attempt === 4) throw e
      process.stdout.write(`    (retrying ${label.trim()} — page reloaded)\n`)
      await new Promise((r) => setTimeout(r, 1500))
    }
  }
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

const byLabel = new Map(CONDITIONS.map(([l]) => [l, []]))
let maxP1 = 0
let maxP2 = 0
for (let r = 0; r < RUNS; r++) {
  process.stdout.write(`  run ${r + 1}/${RUNS}\n`)
  for (const [label, drive] of CONDITIONS) {
    const res = await runResilient(label, drive)
    byLabel.get(label).push(res)
    maxP1 = res.maxP1
    maxP2 = res.maxP2
  }
}

console.log(`\n  ${WINDOW_MS / 1000}s window x ${RUNS} runs, cpu=${CPU}, player is p1`)
console.log('  headline is the MEDIAN; range is min-max across runs\n')
console.log('  condition                dmg taken     dmg dealt      ratio    rounds lost')
for (const [label, rs] of byLabel) {
  const taken = rs.map((x) => x.takenP1)
  const dealt = rs.map((x) => x.dealtP2)
  const ratios = rs.filter((x) => x.dealtP2 > 0).map((x) => x.takenP1 / x.dealtP2)
  const tM = Math.round(median(taken))
  const dM = Math.round(median(dealt))
  const rM = ratios.length ? median(ratios).toFixed(1) + 'x' : '—'
  const rng = (xs) => `${Math.round(Math.min(...xs))}-${Math.round(Math.max(...xs))}`
  console.log(
    `  ${label.padEnd(24)} ${String(tM).padStart(5)} (${rng(taken).padEnd(9)}) ` +
      `${String(dM).padStart(5)} (${rng(dealt).padEnd(9)}) ${rM.padStart(6)}    ` +
      `${rs.reduce((a, x) => a + x.rounds, 0)}`,
  )
}
console.log(`\n  (p1 max health ${maxP1}, p2 max health ${maxP2})`)

await browser.close()
