// Camera-agent capture helper. Not part of the app bundle — a dev tool that
// drives the lab like tools/shot.mjs but can also fire camera-only beats
// (intro / round-end / victory) through the CameraDirector debug hook, and
// auto-downscales the 4K grab so it's viewable.
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'

const argv = process.argv.slice(2)
const arg = (n, d) => {
  const i = argv.indexOf(`--${n}`)
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : d
}
const port = arg('port', '5173')
const out = resolve(arg('out', 'shots-cam/x.png'))
const stage = arg('stage', 'hypergrowth')
const a = arg('a', 'chesky')
const b = arg('b', 'lenny')
const width = Number(arg('width', 1920))
const height = Number(arg('height', 1080))
const settle = arg('settle', '20')
const pre = Number(arg('pre', 0))
const script = arg('do', '')
const cam = arg('cam', '') // semicolon list of JSON events for __opsCamera.onEvent
const beats = arg('beats', '') // comma list of mode:t[:attacker] deterministic beat holds
const converge = Number(arg('converge', 26)) // frames to settle a held beat
const timeoutMs = 60000
mkdirSync(dirname(out), { recursive: true })
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: false,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--hide-scrollbars',
    '--mute-audio', '--window-position=4000,4000', `--window-size=${width},${height}`],
})
const errors = []
try {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2 })
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  const url = `http://localhost:${port}/?lab=1&hud=0&quality=ultra&stage=${encodeURIComponent(stage)}&a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`

  const runScript = async () => {
    for (const raw of script.split(';').map((s) => s.trim()).filter(Boolean)) {
      const parts = raw.split(':')
      await page.evaluate(([cmd, rest]) => {
        const api = window.__OPS3D__; const n = (v) => Number(v)
        switch (cmd) {
          case 'pose': api.setPose(rest[0], rest[1]); break
          case 'hp': api.setHp(n(rest[0]), n(rest[1])); break
          case 'super': api.setSuper(n(rest[0]), n(rest[1])); break
          case 'hit': api.hit(rest[0], rest[1] ?? 'b'); break
          case 'ko': api.ko(rest[0] ?? 'b'); break
          case 'shatter': api.shatter(rest[0] ?? 'b'); break
          case 'wait': api.settle(n(rest[0]) || 1); break
        }
      }, [parts[0], parts.slice(1)])
    }
    for (const ev of cam.split(';').map((s) => s.trim()).filter(Boolean)) {
      await page.evaluate((json) => {
        const c = window.__opsCamera
        if (c) c.onEvent(JSON.parse(json))
      }, ev)
    }
  }

  // Deterministic beat mode: hold each authored cinematic beat at a fixed
  // normalised t via the CameraDirector QA hook, settle the springs, and grab.
  // Decouples capture from the real-time hitstop so authored compositions can
  // be judged frame-by-frame. Beat token: `mode:t[:attacker]` e.g. super:0.32:a.
  if (beats) {
    const tokens = beats.split(',').map((s) => s.trim()).filter(Boolean)
    const written = []
    for (const tok of tokens) {
      const [mode, tStr, side] = tok.split(':')
      const t = Number(tStr)
      await page.goto(url, { waitUntil: 'load', timeout: timeoutMs })
      await page.waitForFunction(() => window.__OPS3D__?.ready?.() === true, null, { timeout: timeoutMs })
      if (pre > 0) await page.evaluate((n) => window.__OPS3D__.settle(n), pre)
      await runScript()
      await page.evaluate(([m, tv, s]) => {
        const c = window.__opsCamera
        if (!c) return
        const sides = {}
        if (m === 'super') sides.attacker = s || 'a'
        if (m === 'ko') { sides.loser = s || 'b'; sides.winner = (s || 'b') === 'a' ? 'b' : 'a' }
        if (m === 'closeup' || m === 'shatter') sides.focus = s || 'b'
        c.__debugBeat(m, tv, sides)
      }, [mode, t, side])
      await page.evaluate((n) => window.__OPS3D__.settle(n), converge)
      const canvas = page.locator('canvas').first()
      const label = `${mode}-${String(t).replace('.', '')}`
      const framePath = out.replace(/\.png$/, `-${label}.png`)
      mkdirSync(dirname(framePath), { recursive: true })
      await canvas.screenshot({ path: framePath, animations: 'disabled' })
      written.push(framePath)
    }
    console.log(JSON.stringify({ ok: true, out: written, errors: errors.slice(0, 6) }))
    for (const f of written) {
      try { execFileSync('sips', ['-Z', '1400', f, '--out', f.replace(/\.png$/, '-sm.png')], { stdio: 'ignore' }) } catch {}
    }
    await browser.close()
    process.exit(0)
  }

  // Sweep: comma-separated settle targets. Each is an ABSOLUTE frame offset from
  // the moment the script fires. To keep timing clean (4K screenshots let the
  // engine keep running, so incremental settle drifts), we re-navigate fresh for
  // every target when sweeping — same browser, so it stays fast.
  const steps = String(settle).split(',').map((s) => Number(s.trim())).filter((n) => !Number.isNaN(n))
  const written = []
  for (const target of steps) {
    await page.goto(url, { waitUntil: 'load', timeout: timeoutMs })
    await page.waitForFunction(() => window.__OPS3D__?.ready?.() === true, null, { timeout: timeoutMs })
    if (pre > 0) await page.evaluate((n) => window.__OPS3D__.settle(n), pre)
    await runScript()
    if (target > 0) await page.evaluate((n) => window.__OPS3D__.settle(n), target)
    const canvas = page.locator('canvas').first()
    const framePath = steps.length > 1 ? out.replace(/\.png$/, `-${target}.png`) : out
    mkdirSync(dirname(framePath), { recursive: true })
    await canvas.screenshot({ path: framePath, animations: 'disabled' })
    written.push(framePath)
  }
  console.log(JSON.stringify({ ok: true, out: written, errors: errors.slice(0, 6) }))
} catch (err) {
  console.log(JSON.stringify({ ok: false, error: String(err), errors: errors.slice(0, 6) }))
  process.exitCode = 1
} finally {
  await browser.close()
}

// Auto-downscale so the grabs are viewable.
try {
  const list = String(settle).split(',').map((s) => Number(s.trim())).filter((n) => !Number.isNaN(n))
  const outs = list.length > 1 ? list.map((t) => out.replace(/\.png$/, `-${t}.png`)) : [out]
  for (const f of outs) {
    const sm = f.replace(/\.png$/, '-sm.png')
    execFileSync('sips', ['-Z', '1400', f, '--out', sm], { stdio: 'ignore' })
  }
} catch {}
