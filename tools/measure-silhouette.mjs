/**
 * Silhouette separation probe.
 *
 * A fighting game only reads if the characters are separated from the arena
 * behind them. This measures that relationship directly, per stage:
 *
 *   fighterLum  mean luminance inside the two projected fighter boxes
 *   bgLum       mean luminance of the ring immediately AROUND those boxes
 *               (what the silhouette is actually competing with -- a frame-wide
 *               background mean is useless, a bright wall behind one head
 *               averages away against a dark floor)
 *   contrast    fighterLum - bgLum, in 0..255. Positive = character reads.
 *
 * Harness rules that this script exists to obey (all three have produced
 * confident, wrong numbers in this project before):
 *   - __OPS3D__.settle(n) counts FRAMES, not seconds.
 *   - The camera opens in a 3.0s intro fly-in; step past it or you measure a
 *     shot the player never sees. We assert __opsCamera.mode afterwards.
 *   - Never send keystrokes mid-capture; hide the lab panel via DOM display.
 *
 * One page load per stage: particle pools, the post envelope and the light rig
 * all carry state, and sequential hits on one page drift the numbers upward.
 */
import { chromium } from 'playwright-core'
import { mkdirSync, writeFileSync } from 'node:fs'
console.error('\u26A0\uFE0F  [instrument-routing] tools/measure-silhouette.mjs drives the LEGACY CARD BATTLER (?lab=1 / __OPS3D__ → FightScene3D + VfxSubsystem), NOT the shipped fighter. Its numbers are INADMISSIBLE as shipped-fighter evidence. Provenance: tools/instrument-manifest.json.')

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d }
const port = arg('port', '5173')
const out = arg('out', '/tmp/silhouette')
const label = arg('label', 'run')
const extra = arg('extra', '')
const stages = arg('stages', 'crisis,hypergrowth,ipoPrep,aiNative,prePmf,plateau,monetization,distribution').split(',')
const warm = +arg('warm', '240')
mkdirSync(out, { recursive: true })

const hideLabUi = () => {
  for (const el of Array.from(document.querySelectorAll('div'))) {
    if (el.textContent === 'THREE LAB \u2014 h to hide') {
      if (el.parentElement) el.parentElement.style.display = 'none'
      return
    }
  }
}

/** Project the fighter head/feet anchors into 0..1 screen space. */
const readBoxes = () => {
  const eng = window.__OPS3D__.engine
  const cam = eng.camera
  const anchors = eng.anchors ?? window.__OPS3D__.anchors
  const proj = (v) => {
    const p = v.clone().project(cam)
    return { x: p.x * 0.5 + 0.5, y: 1 - (p.y * 0.5 + 0.5) }
  }
  const boxes = []
  for (const side of ['a', 'b']) {
    const head = anchors.get(`fighter:${side}:head`)
    const feet = anchors.get(`fighter:${side}:feet`)
    if (!head || !feet) continue
    const h = proj(head)
    const f = proj(feet)
    // Half-width from a fixed 0.62m world offset at the chest height.
    const chest = head.clone().lerp(feet, 0.5)
    const side2 = chest.clone()
    side2.x += 0.62
    const c0 = proj(chest)
    const c1 = proj(side2)
    const halfW = Math.abs(c1.x - c0.x)
    boxes.push({ cx: c0.x, halfW, top: Math.min(h.y, f.y), bot: Math.max(h.y, f.y) })
  }
  return { boxes, mode: window.__opsCamera?.mode ?? 'unknown' }
}

const results = []
for (const stage of stages) {
  const browser = await chromium.launch({
    headless: false,
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    args: ['--use-angle=metal', '--window-position=4000,4000'],
  })
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
  await page.goto(`http://localhost:${port}/?lab=1&stage=${stage}${extra ? '&' + extra : ''}`, { waitUntil: 'load', timeout: 180000 })
  await page.waitForFunction(() => window.__OPS3D__?.ready?.(), null, { timeout: 90000 })
  // PIN the camera to the neutral beat instead of waiting out the intro.
  //
  // Waiting is not measurable. The director's modeTime advances on SCALED dt
  // (Engine.frame(): dt = rawDt * timeScale), so every hitstop stretches the
  // 3.0s intro across an unpredictable number of frames -- measured 210..1320
  // frames for the same eight stages on two consecutive runs. Two runs
  // therefore land on completely different sim states (different idle phase,
  // different live VFX, maybe mid-hit-flash), and the frame-to-frame difference
  // swamps whatever you were trying to measure. __debugBeat pins the director
  // to the authored neutral pose on frame 0, so a fixed step count is now a
  // deterministic function and two runs are comparable.
  await page.evaluate(() => window.__opsCamera.__debugBeat('neutral', 1))
  const steps = warm
  for (let i = 0; i < warm; i += 30) await page.evaluate(() => window.__OPS3D__.step(30))
  const geo = await page.evaluate(readBoxes)
  if (geo.mode !== 'neutral') {
    console.error(`${stage}: REFUSING TO MEASURE -- camera mode is "${geo.mode}" after ${steps} frames, not "neutral"`)
    await browser.close()
    continue
  }
  await page.evaluate(hideLabUi)
  const png = `${out}/${label}-${stage}.png`
  await page.screenshot({ path: png })
  await browser.close()
  results.push({ stage, png, ...geo })
  console.log(`captured ${stage} (${geo.boxes.length} boxes, camera=${geo.mode}, ${steps} frames)`)
}

writeFileSync(`${out}/${label}-boxes.json`, JSON.stringify(results, null, 2))
console.log(`\nwrote ${out}/${label}-boxes.json`)
