#!/usr/bin/env node
/**
 * Parallel-safe screenshot harness for the Three.js lab.
 *
 * Every sub-agent gets its own dev-server port and its own Chrome instance, so
 * many visual QA loops can run at once without stepping on each other.
 *
 *   node tools/shot.mjs --port 5173 --out /tmp/shots/x.png \
 *        --stage hypergrowth --a chesky --b lenny \
 *        --do 'hit:crit:right' --settle 30
 *
 * --do accepts a semicolon-separated list of commands:
 *   pose:<side>:<pose>      setPose
 *   hp:<side>:<v>           setHp   e.g. hp:b:0.08
 *   super:<side>:<v>        setSuper e.g. super:a:1
 *   hit:<flavor>[:<side>[:<power>]]   trigger an impact (side is 'a'|'b', default 'b')
 *   ko:<side>               KO         (side is 'a'|'b', default 'b')
 *   shatter:<side>          armour shatter (side is 'a'|'b', default 'b')
 *   wait:<frames>           advance N frames
 */
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const argv = process.argv.slice(2)
const arg = (name, dflt) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : dflt
}
const flag = (name) => argv.includes(`--${name}`)

const port = arg('port', '5173')
const out = resolve(arg('out', '/tmp/opshots/shot.png'))
const stage = arg('stage', 'hypergrowth')
const a = arg('a', 'chesky')
const b = arg('b', 'lenny')
const width = Number(arg('width', 1920))
const height = Number(arg('height', 1080))
const settle = Number(arg('settle', 30))
const quality = arg('quality', 'ultra')
const script = arg('do', '')
const timeoutMs = Number(arg('timeout', 60000))

mkdirSync(dirname(out), { recursive: true })

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
    '--window-position=4000,4000',
    `--window-size=${width},${height}`,
  ],
})

const errors = []
try {
  const page = await browser.newPage({
    viewport: { width, height },
    deviceScaleFactor: Number(arg('dpr', 2)),
  })
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })

  const url =
    `http://localhost:${port}/?lab=1&hud=0&quality=${quality}` +
    `&stage=${encodeURIComponent(stage)}&a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}` +
    (arg('params', '') ? `&${arg('params', '')}` : '')
  await page.goto(url, { waitUntil: 'load', timeout: timeoutMs })

  await page.waitForFunction(() => window.__OPS3D__?.ready?.() === true, null, {
    timeout: timeoutMs,
  })

  for (const raw of script.split(';').map((s) => s.trim()).filter(Boolean)) {
    const parts = raw.split(':')
    await page.evaluate(
      ([cmd, rest]) => {
        const api = window.__OPS3D__
        const n = (v) => Number(v)
        switch (cmd) {
          case 'pose': api.setPose(rest[0], rest[1]); break
          case 'hp': api.setHp(rest[0], n(rest[1])); break
          case 'super': api.setSuper(rest[0], n(rest[1])); break
          case 'hit': api.hit(rest[0], rest[1] ?? 'b', rest[2] ? n(rest[2]) : undefined); break
          case 'ko': api.ko(rest[0] ?? 'b'); break
          case 'shatter': api.shatter(rest[0] ?? 'b'); break
          case 'wait': api.settle(n(rest[0]) || 1); break
          case 'quality': api.quality(rest[0]); break
          case 'stage': api.setStage(rest[0]); break
          default: throw new Error('unknown shot command: ' + cmd)
        }
      },
      [parts[0], parts.slice(1)],
    )
  }

  await page.evaluate((n) => window.__OPS3D__.settle(n), settle)
  const canvas = page.locator('canvas').first()
  await canvas.screenshot({ path: out, animations: 'disabled' })
  if (flag('json')) {
    console.log(JSON.stringify({ ok: true, out, errors }))
  } else {
    console.log(`saved ${out}`)
    if (errors.length) console.log('ERRORS:\n' + errors.slice(0, 12).join('\n'))
  }
} catch (err) {
  console.log(JSON.stringify({ ok: false, error: String(err), errors: errors.slice(0, 12) }))
  process.exitCode = 1
} finally {
  await browser.close()
}
