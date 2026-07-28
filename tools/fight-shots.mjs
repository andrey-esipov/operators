// Capture the real-time fight renderer at key choreography beats for review.
//
// Determinism: we PAUSE the engine's rAF loop and advance only via stepFixed,
// so a captured frame depends solely on how many fixed steps we've taken, not
// on wall-clock timing. The scripted MockSim loops every ~596 sim frames; the
// SHOTS table below targets the frame each beat's payoff lands on (a hit spark
// is only on screen for a few frames, so these are tuned to the impact frame).
//
// Usage: node tools/fight-shots.mjs [--out DIR] [--port 5173] [--stage ID]
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'

const args = process.argv.slice(2)
const flag = (name, dflt) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : dflt
}

const OUT = flag('out', 'fight-shots')
const PORT = flag('port', '5173')
const STAGE = flag('stage', 'ipo-prep')
const A = flag('a', 'chesky')
const B = flag('b', 'lenny')
const BASE = `http://localhost:${PORT}/?fight=1&stage=${STAGE}&a=${A}&b=${B}`

mkdirSync(OUT, { recursive: true })

// [name, absolute sim-frame within the loop]
const SHOTS = [
  ['00-neutral', 40],  ['01-footsies', 110],
  ['02-dash-in', 162],
  ['03-heavy-hit', 177],
  ['04-hitstun', 202],
  ['05-jump-in', 305],
  ['06-block', 330],
  ['07-launcher', 385],
  ['08-juggle', 410],
  ['09-super-flash', 431],
  ['10-ko', 496],
]

const browser = await chromium.launch({
  headless: false,
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-angle=metal', '--window-position=4000,4000', '--hide-scrollbars'],
})
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })
page.on('pageerror', (e) => console.log('  [pageerror]', e.message))
page.on('console', (m) => { if (m.type() === 'error') console.log('  [console.error]', m.text()) })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Both fighters must actually be on screen in every shot.
//
// This tool once captured eleven "successful" screenshots of an empty stage
// and reported phase names for all of them, because a duplicated renderer was
// painting over the live one. A capture tool that only proves it wrote a file
// is worse than no tool: it converts a total failure into a green run. So ask
// the page where the fighters project to, and refuse to pass if they are not
// inside the frame.
const failures = []

const assertFightersOnScreen = async (name) => {
  const r = await page.evaluate(() => {
    const R = window.__FIGHT__.renderer
    const cam = R.engine.camera
    const cvs = R.engine.renderer.domElement
    return R.fighters.map((f) => {
      const p = f.mesh.position.clone()
      p.y += 0.9 // chest height, so a ground-level pivot alone can't pass
      p.project(cam)
      return {
        x: Math.round(((p.x + 1) / 2) * cvs.clientWidth),
        y: Math.round(((1 - p.y) / 2) * cvs.clientHeight),
        depth: +p.z.toFixed(3),
      }
    })
  })
  const w = 1600
  const h = 900
  const bad = r.filter((p) => p.depth > 1 || p.x < 0 || p.x > w || p.y < 0 || p.y > h)
  if (bad.length) {
    console.log(`  FAILED: ${name} — fighter off-screen ${JSON.stringify(r)}`)
    failures.push(name)
  }

  // Projection maths is happy whether or not a single texel gets shaded, so it
  // would have passed all 11 shots of the empty stage that started this. Ask
  // the renderer how many pixels the fighters actually paint, measured by an
  // isolated offscreen render that no other object can overdraw.
  const cov = await page.evaluate(() => window.__FIGHT__.coverage())
  if (cov.fraction < 0.004) {
    console.log(`  FAILED: ${name} — fighters painted ${cov.lit} px (${(cov.fraction * 100).toFixed(2)}% of frame); they are not visible`)
    failures.push(`${name}:coverage`)
  }
  return { proj: r, cov }
}
const shot = async (name) => {
  await page.screenshot({ path: `${OUT}/${name}.png` })
  console.log(`  wrote ${OUT}/${name}.png`)
}

// Vite's HMR reloads the page whenever a source file is saved, which destroys
// the execution context mid-scan and used to kill the run with an uncaught
// "Execution context was destroyed" exception after several minutes of work.
// With several agents editing this repo concurrently that is routine, not
// exceptional, so retry the whole capture rather than reporting a failure that
// says nothing about the game.
const NAVIGATED = /Execution context was destroyed|Target closed|frame was detached/i

const runCapture = async () => {
  seen.clear()
  failures.length = 0

  await page.goto(BASE, { waitUntil: 'networkidle' })

  // Wait for the harness to finish building atlases and expose the API.
  for (let i = 0; i < 120; i++) {
    const ok = await page.evaluate(() => !!window.__FIGHT__?.ready())
    if (ok) break
    await sleep(250)
  }
  const ready = await page.evaluate(() => !!window.__FIGHT__?.ready())
  if (!ready) {
    console.log('  FAILED: window.__FIGHT__ never became ready')
    failures.push('not-ready')
    return
  }

  // Freeze the loop, then warm a few frames so textures/pipeline are resident.
  await page.evaluate(() => {
    window.__FIGHT__.pause()
    window.__FIGHT__.step(2)
  })
  await sleep(200)

  await scanForBeats()
}

// Hunt for the beats rather than trusting fixed frame numbers.
//
// The frame targets in SHOTS were tuned against the scripted MockSim, whose
// beats landed on a fixed schedule. The real simulation is an AI-vs-AI fight,
// so frame 496 is no longer the KO — it is whatever those two happened to be
// doing. Captures kept their old names and quietly showed the wrong situation,
// which is the same "label says one thing, pixels say another" trap that had a
// DEFEAT screenshot actually capturing VICTORY for weeks.
//
// So: step frame by frame and capture the first time each situation actually
// occurs, naming the file after what the sim says it is.
const WANTED = ['intro', 'footsies', 'attack', 'hitstun', 'blocked', 'jump', 'juggle', 'super', 'ko']
const MAX_SCAN = Number(flag('scan', '2400'))
const seen = new Map()

async function scanForBeats() {
  for (let i = 0; i < MAX_SCAN && seen.size < WANTED.length; i++) {
    const phase = await page.evaluate(() => {
      window.__FIGHT__.step(1)
      return window.__FIGHT__.phase()
    })
    if (!WANTED.includes(phase) || seen.has(phase)) continue

    const idx = String(seen.size).padStart(2, '0')
    const name = `${idx}-${phase}`
    seen.set(phase, name)
    await sleep(60)
    await shot(name)
    const { proj, cov } = await assertFightersOnScreen(name)
    console.log(`    (${name} @ frame ${i}, phase=${phase}, on-screen=${JSON.stringify(proj.map((p) => [p.x, p.y]))}, painted=${(cov.fraction * 100).toFixed(2)}%)`)
  }

  // A situation that never occurs across the whole scan is a broken fight, not
  // a quiet skip: no `ko` means nobody ever died, no `blocked` means the AI
  // never defends. Exactly the kind of hole a "wrote 11 files" check sails past.
  const missing = WANTED.filter((p) => !seen.has(p))
  if (missing.length) {
    console.log(`  FAILED: never observed ${missing.join(', ')} in ${MAX_SCAN} frames`)
    failures.push(`missing:${missing.join('+')}`)
  }
}

const ATTEMPTS = Number(flag('attempts', '3'))
for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
  try {
    await runCapture()
    break
  } catch (err) {
    if (!NAVIGATED.test(String(err?.message ?? err)) || attempt === ATTEMPTS) throw err
    console.log(`  page reloaded mid-capture (concurrent edit → HMR); retrying ${attempt}/${ATTEMPTS - 1}`)
    await sleep(1500)
  }
}

// One more guard, on the pixels rather than the maths: a frame that is almost
// entirely one colour means the stage rendered and nothing else did.
const variance = await page.evaluate(() => {
  const cvs = document.querySelector('canvas')
  const c = document.createElement('canvas')
  c.width = 320; c.height = 180
  c.getContext('2d').drawImage(cvs, 0, 0, 320, 180)
  const d = c.getContext('2d').getImageData(0, 0, 320, 180).data
  let sum = 0, sum2 = 0, n = 0
  for (let i = 0; i < d.length; i += 4) { const L = (d[i] + d[i + 1] + d[i + 2]) / 3; sum += L; sum2 += L * L; n++ }
  const mean = sum / n
  return Math.sqrt(sum2 / n - mean * mean)
})
if (variance < 8) {
  console.log(`  FAILED: final frame is nearly flat (stddev ${variance.toFixed(1)}) — likely nothing rendered`)
  failures.push('flat-frame')
}

await browser.close()
if (failures.length) {
  console.log(`FAILED: ${failures.length} shot(s) did not pass: ${failures.join(', ')}`)
  process.exit(1)
}
console.log('done')
