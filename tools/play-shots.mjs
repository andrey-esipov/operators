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
import { execSync } from 'child_process'
import sharp from 'sharp'

// `--build` labels a capture driven against a *different* checkout (a baseline
// worktree on another port), where this repo's HEAD would be a lie.
const SHA =
  (process.argv.includes('--build')
    ? process.argv[process.argv.indexOf('--build') + 1]
    : null) ?? execSync('git rev-parse --short HEAD').toString().trim()

const PORT = process.argv.includes('--port')
  ? process.argv[process.argv.indexOf('--port') + 1]
  : '5399'
const arg = (name, dflt) =>
  process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : dflt
// `--query` pins the matchup and CPU tier. A blind A/B across builds needs both
// sides driven identically, and it needs a matchup the critic hasn't spent five
// sessions memorising.
const QUERY = arg('--query', '')
const OUT = arg('--out', 'play-shots')
const URL = `http://localhost:${PORT}/${QUERY ? '?' + QUERY.replace(/^\?/, '') : ''}`
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

await page.goto(URL, { waitUntil: 'domcontentloaded' })

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

// A reload doesn't merely interrupt a run — it swaps the build out underneath
// it. Recovering and carrying on yields a set whose first half is one build and
// second half another, and any judgement about consistency across that set is
// worthless. Worse, it looks fine: nine PNGs, plausible labels, no error. So
// stamp the page, and if the stamp is gone, throw the whole run away and start
// over rather than quietly shipping a mixed set.
class Reloaded extends Error {}
let generation = 0
const stampBuild = () =>
  page.evaluate((g) => {
    window.__CAP_GEN__ = g
  }, ++generation)
async function assertSameBuild() {
  let seen
  try {
    seen = await page.evaluate(() => window.__CAP_GEN__)
  } catch {
    throw new Reloaded('the execution context was destroyed')
  }
  if (seen !== generation) throw new Reloaded('vite reloaded the page')
}

const readState = () =>
  page.evaluate(() => {    const s = window.__PLAY__.state()
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

// Mean luma of the stage band only — below the HUD, above the super row. A
// WebGL canvas screenshotted at DPR 2 occasionally comes back as the cleared
// drawing buffer rather than the composited frame, which yields a perfectly
// black stage with the DOM HUD still painted over it. It looks like a
// catastrophic renderer bug and it is not one; the critic filed it as
// "full-screen blackout on a hitstun frame" off exactly such a frame.
async function stageLuma(buf) {
  const meta = await sharp(buf).metadata()
  const { data, info } = await sharp(buf)
    .extract({
      left: 0,
      top: Math.round(meta.height * 0.14),
      width: meta.width,
      height: Math.round(meta.height * 0.7),
    })
    .resize(120)
    .raw()
    .toBuffer({ resolveWithObject: true })
  let sum = 0
  const n = data.length / info.channels
  for (let i = 0; i < data.length; i += info.channels)
    sum += (data[i] + data[i + 1] + data[i + 2]) / 3
  return sum / n
}

async function shot(name) {
  // If the build changed under us this run is already void — bail before
  // spending three seconds on a screenshot that can't be compared to the rest.
  await assertSameBuild()
  // Freeze first. Reading state and then screenshotting a 3200x1800 page takes
  // long enough for the sim to advance a dozen frames, so an unpaused capture
  // can label a shot `hitstun` and show a fighter who already recovered. The
  // label and the pixels have to describe the same moment or this tool is just
  // another lying harness.
  await page.evaluate(() => window.__PLAY__.pause())
  const st = await state()
  let buf = await page.screenshot()
  let luma = await stageLuma(buf)
  // A live stage sits around 70-90. Anything under 12 while the sim says we're
  // mid-fight is a lost drawing buffer, not a dark scene — retake it rather
  // than shipping a black PNG that reads as a renderer catastrophe.
  let retakes = 0
  while (luma < 12 && st.phase === 'fight' && retakes < 4) {
    retakes++
    await page.evaluate(() => window.__PLAY__.resume())
    await page.waitForTimeout(120)
    await page.evaluate(() => window.__PLAY__.pause())
    buf = await page.screenshot()
    luma = await stageLuma(buf)
  }
  writeFileSync(`${OUT}/${name}.png`, buf)
  const after = await state()
  await page.evaluate(() => window.__PLAY__.resume())

  if (luma < 12 && st.phase === 'fight') {
    console.log(
      `FAILED: ${name} stage luma ${luma.toFixed(1)} after ${retakes} retakes — ` +
        `the canvas is genuinely black while the sim says phase=fight`,
    )
    // Leave nothing behind. A directory of PNGs is the thing people look at,
    // and a black frame sitting in it outlives the console message that
    // explained it.
    rmSync(OUT, { recursive: true, force: true })
    await browser.close()
    process.exit(1)
  }

  // Prove the freeze held across the screenshot rather than assuming it.
  const drift =
    after.p1.st !== st.p1.st || after.p2.st !== st.p2.st || after.p1.hp !== st.p1.hp
  shots.push({ name, ...st, drift, stageLuma: +luma.toFixed(1), retakes })
  console.log(
    `  ${name.padEnd(18)} phase=${st.phase} combo=${st.combo} ` +
      `p1[hp=${st.p1.hp} m=${st.p1.meter} ${st.p1.st}] p2[hp=${st.p2.hp} m=${st.p2.meter} ${st.p2.st}]` +
      (retakes ? `   (retook ${retakes}x — lost drawing buffer)` : '') +
      (drift ? '   *** DRIFTED DURING CAPTURE — label is not trustworthy' : ''),
  )
}

const key = async (k, ms = 60) => {
  await page.keyboard.down(k)
  await page.waitForTimeout(ms)
  await page.keyboard.up(k)
}

console.log(`capturing the real game at ${URL}  (DPR 2)  build ${SHA} -> ${OUT}/`)

async function runBeats() {
  shots.length = 0
  errors.length = 0
  rmSync(OUT, { recursive: true, force: true })
  mkdirSync(OUT, { recursive: true })

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

  // The last shot is as vulnerable as the first.
  await assertSameBuild()
}

const ATTEMPTS = 4
let captured = false
for (let attempt = 1; attempt <= ATTEMPTS && !captured; attempt++) {
  try {
    await stampBuild()
    await runBeats()
    captured = true
  } catch (e) {
    if (!(e instanceof Reloaded)) throw e
    console.log(`  restarting — ${e.message} (attempt ${attempt}/${ATTEMPTS})`)
    if (attempt === ATTEMPTS) {
      console.log('FAILED: could not complete a run without the build changing underneath it')
      rmSync(OUT, { recursive: true, force: true })
      await browser.close()
      process.exit(1)
    }
    await page.goto(URL, { waitUntil: 'domcontentloaded' })
    if (!(await settle())) {
      console.log('FAILED: play route never came back after a reload')
      await browser.close()
      process.exit(1)
    }
    await page.mouse.click(800, 450)
  }
}

writeFileSync(`${OUT}/shots.json`, JSON.stringify({ build: SHA, shots, errors }, null, 2))
console.log(errors.length ? `\n  ${errors.length} console/page errors:` : '\n  no console errors')
for (const e of [...new Set(errors)].slice(0, 8)) console.log(`    ${e}`)

await browser.close()
