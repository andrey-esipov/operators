#!/usr/bin/env node
/**
 * End-to-end smoke test for the fight screen.
 *
 * Drives the real app (not the three lab) into a live match via the store hook
 * the game already exposes in dev (`window.__useGame`), casts a few moves so the
 * event pipeline actually fires, then reports **text only**: console errors,
 * page errors, WebGL status and frame stats. Screenshots are written to disk and
 * only their paths are printed — never their contents.
 *
 *   node tools/smoke-combat.mjs --port 5199 --render 3d --out /tmp/smoke
 */
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const argv = process.argv.slice(2)
const arg = (n, d) => {
  const i = argv.indexOf(`--${n}`)
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : d
}

const port = arg('port', '5199')
const render = arg('render', '3d')
const outDir = resolve(arg('out', '/tmp/smoke'))
const a = arg('a', 'chesky')
const b = arg('b', 'lenny')
const scenario = arg('scenario', 'hypergrowth')
const width = Number(arg('width', 1920))
const height = Number(arg('height', 1080))

mkdirSync(outDir, { recursive: true })

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const browser = await chromium.launch({
  executablePath: CHROME,
  headless: false,
  args: [
    '--use-angle=metal',
    '--enable-gpu',
    '--ignore-gpu-blocklist',
    '--hide-scrollbars',
    '--mute-audio',
    '--autoplay-policy=no-user-gesture-required',
    '--window-position=4000,4000',
    `--window-size=${width},${height}`,
  ],
})

const consoleErrors = []
  const resp404 = []
const pageErrors = []
const failedRequests = []
const shots = []

try {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 })
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 400)))
  page.on('response', (r) => { if (r.status() >= 400) resp404.push(`${r.status()} ${r.url()}`) })
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 400))
  })
  // Console 404s don't carry the URL — track responses so missing textures and
  // portraits are actually identifiable.
  page.on('response', (r) => {
    if (r.status() >= 400) failedRequests.push(`${r.status()} ${r.url().slice(0, 200)}`)
  })

  await page.goto(`http://localhost:${port}/?render=${render}`, { waitUntil: 'load', timeout: 40000 })
  await page.evaluate(() => document.fonts.ready)

  // The store is published on window in dev — drive the match from there rather
  // than click-walking the menus, which is slow and brittle.
  //
  // NOTE: use page.evaluate polling, not page.waitForFunction. waitForFunction
  // can run in Playwright's isolated utility world, which shares the DOM but not
  // the page's JS globals — so `window.__useGame` reads as undefined there.
  const pollFor = async (fn, label, timeoutMs = 30000) => {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      if (await page.evaluate(fn)) return
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`)
      await page.waitForTimeout(250)
    }
  }

  await pollFor(() => typeof window.__useGame === 'function', 'store hook', 20000)
  await page.evaluate(
    ({ a, b, scenario }) => window.__useGame.getState().startMatch(a, b, scenario),
    { a, b, scenario },
  )
  // startMatch holds on a ~4.2s pre-fight stage reveal before phase flips.
  await pollFor(() => window.__useGame.getState().phase === 'fight', 'fight phase', 30000)
  await page.waitForTimeout(2500)

  const shot = async (name) => {
    const p = `${outDir}/${name}.png`
    await page.screenshot({ path: p })
    shots.push(p)
  }
  await shot('01-neutral')

  // Cast four moves so cast/hit/shatter events and the HUD combo path all run.
  // 'z' is move 1 for whichever side is active; the AI answers on its own turn.
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press('z')
    await page.waitForTimeout(1400)
  }
  await shot('02-after-trades')

  const stats = await page.evaluate(() => {
    const canvas = document.querySelector('canvas')
    const gl = canvas && (canvas.getContext('webgl2') || canvas.getContext('webgl'))
    const s = window.__useGame.getState()
    return {
      canvasPresent: !!canvas,
      canvasSize: canvas ? `${canvas.width}x${canvas.height}` : null,
      webglContextLost: gl ? gl.isContextLost() : null,
      hudMounted: !!document.querySelector('.fight-hud'),
      phase: s.phase,
      logEntries: s.log.length,
      hpA: s.fighterA?.hp,
      hpB: s.fighterB?.hp,
    }
  })

  // Measure sustained frame rate over one second of real animation.
  const fps = await page.evaluate(
    () =>
      new Promise((res) => {
        let n = 0
        const t0 = performance.now()
        const tick = () => {
          n++
          if (performance.now() - t0 < 1000) requestAnimationFrame(tick)
          else res(Math.round((n * 1000) / (performance.now() - t0)))
        }
        requestAnimationFrame(tick)
      }),
  )

  console.log(JSON.stringify({ ok: pageErrors.length === 0, render, ...stats, fps, shots, pageErrors: pageErrors.slice(0, 8), failedRequests: failedRequests.slice(0, 12), consoleErrors: consoleErrors.slice(0, 8), resp404: resp404.slice(0, 12) }, null, 2))
  if (pageErrors.length) process.exitCode = 1
} catch (err) {
  console.log(JSON.stringify({ ok: false, error: String(err).slice(0, 500), pageErrors: pageErrors.slice(0, 8), consoleErrors: consoleErrors.slice(0, 8) }, null, 2))
  process.exitCode = 1
} finally {
  await browser.close()
}
