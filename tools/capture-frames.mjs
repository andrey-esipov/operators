/**
 * Capture clean, deterministic combat frames for critique.
 *
 * Read this before changing it -- three separate harness bugs have produced
 * confident, wrong critiques of this game's composition:
 *
 * 1. __OPS3D__.settle(n) takes a FRAME COUNT, not seconds. Tools across this
 *    project called settle(1.5) / settle(2.0) believing they were waiting
 *    seconds; they were waiting ONE and TWO frames. Every frame ever judged
 *    here was captured ~30ms after load.
 * 2. The camera director opens in an 'intro' establishing fly-in with
 *    MODE_DUR 3.0s and only then hands over to the real combat framing. At
 *    ~30ms in, you are photographing the first frame of a fly-in -- wide, high
 *    and far back. That is where "camera too far" and "dead foreground" came
 *    from. Neither is a property of the game's actual framing.
 * 3. Pressing 'h' to hide the lab overlay toggles React state, which
 *    destabilises the stepped render loop -- the camera then diverges and
 *    flies off the fighters entirely. Hide the overlay by setting DOM display
 *    instead; it does not perturb the engine.
 *
 * So: step by frames, wait out the intro, and never send keystrokes mid-capture.
 */
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d }
const port = arg('port', '5173')
const out = arg('out', '/tmp/frames')
const stages = arg('stages', 'hypergrowth,crisis,aiNative,ipoPrep').split(',')
// 240 frames = 4.0s at the fixed 1/60 timestep: past the 3.0s intro with a
// second to spare for the neutral springs to settle.
const warm = +arg('warm', '360')
mkdirSync(out, { recursive: true })

// Hide only the lab panel itself. Matching on textContent alone is a trap:
// every ANCESTOR of the panel also has textContent starting with "THREE LAB",
// so a naive match hides the entire app and you photograph a blank page.
// Anchor on the exact header div, then hide its immediate panel parent.
const hideLabUi = () => {
  for (const el of Array.from(document.querySelectorAll('div'))) {
    if (el.textContent === 'THREE LAB \u2014 h to hide') {
      if (el.parentElement) el.parentElement.style.display = 'none'
      return
    }
  }
}

for (const stage of stages) {
  for (const mode of ['rest', 'impact']) {
    const browser = await chromium.launch({
      headless: false,
      executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      args: ['--use-angle=metal', '--window-position=4000,4000'],
    })
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
    await page.goto(`http://localhost:${port}/?lab=1&stage=${stage}`, { waitUntil: "load", timeout: 180000 })
    // Wait for ready(), not just for the engine handle. Stepping while assets
    // are still streaming burns frames that never reach the camera director, so
    // the intro does not actually advance and you capture a fly-in frame again.
    await page.waitForFunction(() => window.__OPS3D__?.ready?.(), null, { timeout: 90000 })
    // Step in chunks so one huge synchronous loop cannot starve the page.
    for (let i = 0; i < warm; i += 30) await page.evaluate(() => window.__OPS3D__.step(30))
    if (mode === 'impact') {
      await page.evaluate(() => window.__OPS3D__.hit('heavy', 'b'))
      await page.evaluate(() => window.__OPS3D__.step(3))
    }
    const cam = await page.evaluate(() => {
      const d = window.__opsCamera, c = window.__OPS3D__.engine.camera
      return { mode: d.mode, y: +c.position.y.toFixed(2), z: +c.position.z.toFixed(2), fov: +c.fov.toFixed(1) }
    })
    await page.evaluate(hideLabUi)
    await page.screenshot({ path: `${out}/${stage}-${mode}.png` })
    console.log(`${stage}-${mode}  camera=${JSON.stringify(cam)}`)
    await browser.close()
  }
}
