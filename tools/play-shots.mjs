// Screenshot the REAL game — the route a player lands on — with the HUD mounted,
// while a human-equivalent input stream drives the match.
//
// `fight-shots.mjs` drives the AI-vs-AI dev harness, which has no HUD and no
// player. Everything the critic has scored came from there, so nothing has ever
// judged the thing the user actually opens. This does.
//
// Every shot is labelled with what the SIM says was happening, read from
// window.__PLAY__ at the instant of capture — never inferred from the filename.
import { chromium } from 'playwright-core'
import { mkdirSync, rmSync, writeFileSync } from 'fs'

const PORT = process.argv.includes('--port')
  ? process.argv[process.argv.indexOf('--port') + 1]
  : '5399'
const OUT = 'play-shots'
rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({
  headless: false,
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-angle=metal', '--window-position=4000,4000', '--hide-scrollbars'],
})
// DPR 2 — the display the game is actually judged on. Captures have always been
// DPR 1, which hides exactly the aliasing a retina screen shows.
const page = await browser.newPage({
  viewport: { width: 1600, height: 900 },
  deviceScaleFactor: 2,
})

const errors = []
page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text().slice(0, 200))
})

await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' })

// Vite's compile-error overlay covers the canvas while the app keeps running
// underneath, so every readiness probe still reports healthy and the shots are
// of a grey dialog. Fail loudly. (See the same guard in fight-shots.mjs.)
const overlay = await page.evaluate(() => {
  const el = document.querySelector('vite-error-overlay')
  if (!el) return null
  return el.shadowRoot?.querySelector('.message')?.textContent?.trim().slice(0, 300) ?? 'present'
})
if (overlay) {
  console.log(`FAILED: vite error overlay is covering the page —\n  ${overlay}`)
  await browser.close()
  process.exit(1)
}

// React StrictMode double-mounts in dev, briefly deleting window.__PLAY__.
// Require it present and fighting across consecutive polls so we never drive a
// torn-down instance.
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
if (stable < 15) {
  console.log('FAILED: play route never settled into a stable fight phase')
  await browser.close()
  process.exit(1)
}
await page.mouse.click(800, 450)

// Several agents edit this repo concurrently, so a vite HMR reload mid-run is
// routine. It tears down window.__PLAY__ for a moment; without this the tool
// reports a crash and loses the run, which reads like a game bug. Re-await a
// stable mount instead, then continue.
async function settle(maxMs = 20000) {
  const t0 = Date.now()
  let stable = 0
  while (Date.now() - t0 < maxMs && stable < 10) {
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
  return stable >= 10
}

const readState = () =>
  page.evaluate(() => {
    const s = window.__PLAY__.state()
    const f = (p) => ({
      hp: Math.round(p.health),
      meter: Math.round(p.meter ?? 0),
      st: p.stance,
    })
    return {
      phase: s.phase,
      combo: s.fighters[0]?.comboCount ?? s.fighters[1]?.comboCount ?? 0,
      hitstop: s.hitstop,
      p1: f(s.fighters[0]),
      p2: f(s.fighters[1]),
    }
  })

async function state() {
  try {
    return await readState()
  } catch {
    if (!(await settle())) throw new Error('play route never came back after a reload')
    await page.mouse.click(800, 450)
    return await readState()
  }
}

const shots = []
async function shot(name) {
  const st = await state()
  await page.screenshot({ path: `${OUT}/${name}.png` })
  shots.push({ name, ...st })
  console.log(
    `  ${name.padEnd(18)} phase=${st.phase} combo=${st.combo} ` +
      `p1[hp=${st.p1.hp} m=${st.p1.meter} ${st.p1.st}] p2[hp=${st.p2.hp} m=${st.p2.meter} ${st.p2.st}]`,
  )
}

const key = async (k, ms = 60) => {
  await page.keyboard.down(k)
  await page.waitForTimeout(ms)
  await page.keyboard.up(k)
}

console.log(`capturing the real game at http://localhost:${PORT}/  (DPR 2)`)
await shot('00-neutral')

await key('ArrowRight', 420)
await shot('01-approach')

await key('j', 40) // light
await page.waitForTimeout(40)
await shot('02-light-contact')

await key('k', 40) // medium
await page.waitForTimeout(30)
await shot('03-medium')

await key('l', 40) // heavy
await page.waitForTimeout(60)
await shot('04-heavy')

await key('ArrowUp', 60)
await page.waitForTimeout(200)
await shot('05-airborne')

await page.waitForTimeout(900)
await shot('06-recovered')

// Build meter, then throw the super.
for (let i = 0; i < 14; i++) {
  await key('j', 35)
  await page.waitForTimeout(70)
}
await shot('07-meter-built')

await key('u', 40)
await page.waitForTimeout(140)
await shot('08-super')

writeFileSync(`${OUT}/shots.json`, JSON.stringify({ shots, errors }, null, 2))
console.log(errors.length ? `\n  ${errors.length} console/page errors:` : '\n  no console errors')
for (const e of [...new Set(errors)].slice(0, 8)) console.log(`    ${e}`)

await browser.close()
